#!/usr/bin/env node
// 每日采集入口

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { collectArxiv } from "./collectors/arxiv.js";
import { collectOpenAlex } from "./collectors/openalex.js";
import { collectCrossref } from "./collectors/crossref.js";
import { collectDoaj } from "./collectors/doaj.js";
import { collectZenodo } from "./collectors/zenodo.js";
import { finalizePaper, mergeAll, sortPapers } from "./dedup.js";
import { evaluatePaper } from "./rank.js";
import { renderSite } from "./render.js";
import { loadStatus, loadStore, saveStatus, saveStore } from "./store.js";
import { addDays, cnNow, cnNowIso, cnToday } from "./text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function printHelp() {
  console.log(`
UAV 物理层安全论文日报

用法:
  node src/main.js [选项]

选项:
  --days N        回溯天数（默认 7；首次回填建议 90）
  --bootstrap     把新论文的 firstSeen 记为发表日期，避免"今日新增"被回填论文淹没
  --no-collect    不请求网络，直接用 data/papers.json 重新生成网站
  --no-render     只采集入库，不生成网站
  --quiet         安静模式
  -h, --help      显示帮助
`);
}

function parseArgs(argv) {
  const args = {
    days: 7,
    bootstrap: false,
    collect: true,
    render: true,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--days") args.days = Number(argv[(i += 1)]);
    else if (arg.startsWith("--days=")) args.days = Number(arg.split("=")[1]);
    else if (arg === "--bootstrap") args.bootstrap = true;
    else if (arg === "--no-collect") args.collect = false;
    else if (arg === "--no-render") args.render = false;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!Number.isFinite(args.days) || args.days < 1 || args.days > 365) {
    throw new Error("--days 必须是 1–365 之间的整数");
  }
  args.days = Math.floor(args.days);
  return args;
}

function loadYaml(file) {
  return parseYaml(fs.readFileSync(file, "utf8"));
}

function sourceLabel(name) {
  return {
    arxiv: "arXiv",
    openalex: "OpenAlex",
    crossref: "Crossref",
    doaj: "DOAJ",
    zenodo: "Zenodo",
  }[name] ?? name;
}

async function runSource(name, fn) {
  const started = Date.now();
  try {
    const papers = await fn();
    return {
      name,
      ok: true,
      count: papers.length,
      ms: Date.now() - started,
      papers,
      error: null,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      count: 0,
      ms: Date.now() - started,
      papers: [],
      error: error?.message ?? String(error),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = args.quiet ? () => {} : (message) => console.log(`[${cnNow()}] ${message}`);

  const keywords = loadYaml(path.join(ROOT, "config", "keywords.yaml"));
  const sources = loadYaml(path.join(ROOT, "config", "sources.yaml"));

  const today = cnToday();
  const since = addDays(today, -(args.days - 1));
  const store = loadStore(ROOT);
  const existing = store.papers ?? [];

  if (!args.collect) {
    log(`跳过采集，直接渲染 ${existing.length} 篇论文`);
    const status = loadStatus(ROOT);
    renderSite({ root: ROOT, papers: existing, status, log });
    log("网站已重新生成");
    return;
  }

  const bootstrap = args.bootstrap || existing.length === 0;
  log(`统计窗口 ${since} ~ ${today}${bootstrap ? "（回填模式）" : ""}`);

  const tasks = [];
  if (sources.arxiv?.enabled) {
    tasks.push(
      runSource("arxiv", () =>
        collectArxiv({ since, keywords, config: sources.arxiv, log }),
      ),
    );
  }
  if (sources.openalex?.enabled) {
    tasks.push(
      runSource("openalex", () =>
        collectOpenAlex({ since, today, keywords, config: sources.openalex, log }),
      ),
    );
  }
  if (sources.crossref?.enabled) {
    tasks.push(
      runSource("crossref", () =>
        collectCrossref({ since, today, keywords, config: sources.crossref, log }),
      ),
    );
  }
  if (sources.doaj?.enabled) {
    tasks.push(
      runSource("doaj", () =>
        collectDoaj({ since, config: sources.doaj, log }),
      ),
    );
  }
  if (sources.zenodo?.enabled) {
    tasks.push(
      runSource("zenodo", () =>
        collectZenodo({ since, config: sources.zenodo, log }),
      ),
    );
  }

  const results = await Promise.all(tasks);

  for (const result of results) {
    if (result.ok) {
      log(`${sourceLabel(result.name)} 完成：${result.count} 条，用时 ${(result.ms / 1000).toFixed(1)}s`);
    } else {
      log(`${sourceLabel(result.name)} 失败：${result.error}`);
    }
  }

  const status = {
    updatedAt: cnNowIso(),
    updatedCN: cnNow(),
    sources: results.map(({ name, ok, count, ms, error }) => ({ name, ok, count, ms, error })),
  };
  saveStatus(ROOT, status);

  const successCount = results.filter((result) => result.ok).length;
  if (successCount === 0) {
    log("所有数据源均失败，保留现有数据，不更新网站");
    process.exitCode = 1;
    return;
  }

  const incoming = results.flatMap((result) => result.papers);
  log(`原始记录合计 ${incoming.length} 条`);

  const stampFirstSeen = (hint) => {
    if (!hint || hint > today) return today;
    if (hint < since) return since;
    return hint;
  };

  for (const paper of incoming) {
    paper.isNew = true;
    paper.firstSeen = bootstrap
      ? stampFirstSeen(paper.firstSeenHint || paper.published)
      : today;
  }

  const merged = mergeAll(
    existing.map((paper) => ({ ...paper, isNew: false })),
    incoming,
  );

  let added = 0;
  const kept = [];
  for (const paper of merged) {
    const evaluation = evaluatePaper(paper, keywords, today);
    paper.score = evaluation.score;
    paper.tags = evaluation.tags;

    if (paper.isNew && !evaluation.pass) continue;
    if (paper.isNew) added += 1;
    kept.push(paper);
  }

  const papers = sortPapers(kept.map(finalizePaper));
  const nextStore = {
    version: 1,
    updatedAt: cnNowIso(),
    papers,
  };
  saveStore(ROOT, nextStore);

  log(`入库完成：总计 ${papers.length} 篇，本次新增 ${added} 篇`);

  if (args.render) {
    renderSite({ root: ROOT, papers, status, log });
    log("网站已生成：docs/index.html");
  }
}

main().catch((error) => {
  console.error(`\n运行失败: ${error.stack || error.message}`);
  process.exitCode = 1;
});
