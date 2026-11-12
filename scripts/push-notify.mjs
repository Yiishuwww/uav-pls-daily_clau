#!/usr/bin/env node
// 把当天新增论文通过 Web Push 推送到所有已订阅设备。
// 需要环境变量 PUSH_API_URL 和 PUSH_SEND_SECRET；未配置时自动跳过。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "../src/http.js";
import { cnToday } from "../src/text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_TITLES = 3;

const log = (message) => console.log(`[push] ${message}`);

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function readNewPapers() {
  const store = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "papers.json"), "utf8"),
  );
  const papers = Array.isArray(store.papers) ? store.papers : [];
  const today = cnToday();
  return {
    today,
    papers: papers.filter((paper) => paper.firstSeen === today),
  };
}

function buildPayload(papers, today) {
  const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const title = `UAV PLS 日报 ${today}：${papers.length} 篇新论文`;
  const lines = papers
    .slice(0, MAX_TITLES)
    .map((paper) => `• ${truncate(paper.title, 80)}`);

  if (papers.length > MAX_TITLES) {
    lines.push(`另有 ${papers.length - MAX_TITLES} 篇，打开查看`);
  }

  return {
    title,
    body: lines.join("\n"),
    url: site ? `${site}/?period=today` : "",
    count: papers.length,
  };
}

async function main() {
  const base = (process.env.PUSH_API_URL || "").replace(/\/+$/, "");
  const secret = process.env.PUSH_SEND_SECRET || "";
  if (!base || !secret) {
    log("未配置 PUSH_API_URL / PUSH_SEND_SECRET，跳过");
    return;
  }

  const { today, papers } = readNewPapers();
  if (papers.length === 0) {
    log(`今天（${today}）没有新论文，跳过`);
    return;
  }

  const payload = buildPayload(papers, today);
  log(`准备推送 ${papers.length} 篇新论文到 ${base}`);

  const text = await fetchText(`${base}/api/push/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(payload),
    accept: "application/json",
    timeout: 30_000,
    retries: 2,
  });

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`推送接口返回非 JSON：${text.slice(0, 160)}`);
  }

  if (!result?.ok) {
    throw new Error(`推送失败：${result?.error || "未知错误"}`);
  }

  log(
    `完成：订阅 ${result.total ?? 0} 个，成功 ${result.sent ?? 0}，`
      + `失效 ${result.gone ?? 0}，失败 ${result.failed ?? 0}`,
  );
}

main().catch((error) => {
  console.error(`[push] 运行失败：${error?.message || error}`);
  process.exitCode = 1;
});
