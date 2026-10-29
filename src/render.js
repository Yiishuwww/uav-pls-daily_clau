// 静态网站与 RSS 生成

import fs from "node:fs";
import path from "node:path";
import { addDays, cnNow, cnToday, xmlEscape } from "./text.js";

const SOURCE_LABELS = {
  arxiv: "arXiv",
  openalex: "OpenAlex",
  crossref: "Crossref",
};

function sourceStatusHtml(status) {
  const sources = status?.sources ?? [];
  if (sources.length === 0) {
    return '<span class="src ok"><i></i>本地缓存</span>';
  }
  return sources
    .map((source) => {
      const label = SOURCE_LABELS[source.name] || source.name;
      const detail = source.ok
        ? `${source.count} 条，${(source.ms / 1000).toFixed(1)} 秒`
        : `失败：${source.error || "未知错误"}`;
      return `<span class="src ${source.ok ? "ok" : "fail"}" title="${xmlEscape(detail)}"><i></i>${xmlEscape(label)}</span>`;
    })
    .join("");
}

function renderIndexHtml({ papers, status, today, total, todayCount, weekCount, siteUrl }) {
  const papersForSite = papers.map((paper) => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract,
    doi: paper.doi,
    arxivId: paper.arxivId,
    venue: paper.venue,
    publisher: paper.publisher,
    type: paper.type,
    published: paper.published,
    firstSeen: paper.firstSeen,
    url: paper.url,
    pdfUrl: paper.pdfUrl,
    tags: paper.tags,
    sources: paper.sources,
  }));

  const papersJson = JSON.stringify(papersForSite).replace(/</g, "\\u003c");
  const updated = status?.updatedCN || cnNow();
  const rssHref = siteUrl ? `${siteUrl}/feed.xml` : "feed.xml";
  const jsonHref = "data/papers.json";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UAV 物理层安全论文日报</title>
<meta name="description" content="每日自动汇总 arXiv、OpenAlex、Crossref 中无人机物理层安全（Physical Layer Security for UAV Communications）方向的最新论文。">
<link rel="stylesheet" href="assets/style.css">
<link rel="alternate" type="application/rss+xml" title="UAV 物理层安全论文日报 RSS" href="${xmlEscape(rssHref)}">
</head>
<body data-today="${xmlEscape(today)}">
<header class="site-head">
  <div class="wrap head-inner">
    <div class="brand">
      <h1>UAV 物理层安全论文日报</h1>
      <div class="en">Physical Layer Security for UAV Communications · Daily Digest</div>
    </div>
    <div class="head-stats">
      <div class="stat"><span class="num">${total}</span><span class="lbl">总收录</span></div>
      <div class="stat"><span class="num">${todayCount}</span><span class="lbl">今日新增</span></div>
      <div class="stat"><span class="num">${weekCount}</span><span class="lbl">近 7 天</span></div>
    </div>
  </div>
  <div class="wrap head-meta">
    <span>更新于 ${xmlEscape(updated)}（UTC+8）</span>
    <span class="srcs">${sourceStatusHtml(status)}</span>
    <button type="button" id="theme-toggle" class="theme-btn" aria-label="切换深色模式" title="切换深色模式">☾</button>
  </div>
</header>

<div class="toolbar">
  <div class="wrap">
    <div class="toolbar-row">
      <div class="seg" role="group" aria-label="时间范围">
        <button type="button" data-period="today">今日<span class="count" id="count-today">0</span></button>
        <button type="button" data-period="7d">近 7 天<span class="count" id="count-week">0</span></button>
        <button type="button" data-period="30d" class="active">近 30 天<span class="count" id="count-30d">0</span></button>
        <button type="button" data-period="all">全部<span class="count" id="count-all">0</span></button>
      </div>
      <label class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
        <input id="search" type="search" placeholder="搜索标题、作者、摘要、标签…" autocomplete="off" aria-label="搜索论文">
      </label>
    </div>
    <div class="toolbar-row two">
      <div class="chips" id="tags" aria-label="主题标签"></div>
      <div class="selects">
        <select id="type-filter" aria-label="论文类型">
          <option value="all">全部类型</option>
          <option value="journal-article">期刊</option>
          <option value="conference">会议</option>
          <option value="preprint">预印本</option>
        </select>
        <select id="month-filter" aria-label="按月份筛选">
          <option value="all">全部月份</option>
        </select>
      </div>
    </div>
  </div>
</div>

<main class="wrap">
  <div class="list-head">
    <span id="result-count">共 0 篇</span>
    <span class="list-hint">按发表时间排序</span>
  </div>
  <div id="list"></div>
  <div id="empty" class="empty" hidden>
    <div class="empty-title">没有符合条件的论文</div>
    <div>试试切换时间范围，或清空搜索与标签。</div>
  </div>
  <button type="button" id="load-more" class="load-more" hidden>加载更多</button>
</main>

<footer>
  <div class="wrap">
    <div>数据来源：arXiv API · OpenAlex · Crossref（IEEE / Elsevier / Springer / Wiley 的期刊元数据经 Crossref 覆盖）</div>
    <div>仅收录公开元数据，不存储论文全文。每日 07:00（北京时间）自动更新。</div>
    <div><a href="${xmlEscape(rssHref)}">RSS 订阅</a> · <a href="${xmlEscape(jsonHref)}">JSON 数据</a> · 预印本论文以灰色「预印本」标记</div>
  </div>
</footer>

<script type="application/json" id="papers-data">${papersJson}</script>
<script src="assets/app.js" defer></script>
</body>
</html>
`;
}

function buildRss(papers, siteUrl) {
  const items = papers.slice(0, 100).map((paper) => {
    const link = paper.url || (paper.arxivId ? `https://arxiv.org/abs/${paper.arxivId}` : "");
    const pubDate = paper.published
      ? new Date(`${paper.published}T00:00:00Z`).toUTCString()
      : new Date().toUTCString();
    const categories = (paper.tags ?? [])
      .map((tag) => `      <category>${xmlEscape(tag)}</category>`)
      .join("\n");
    const description =
      paper.abstract ||
      [paper.venue, paper.published, (paper.tags ?? []).join(", ")].filter(Boolean).join(" · ");
    return `    <item>
      <title>${xmlEscape(paper.title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="false">${xmlEscape(paper.id || link)}</guid>
      <pubDate>${xmlEscape(pubDate)}</pubDate>
      <description>${xmlEscape(description)}</description>
${categories}
    </item>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>UAV 物理层安全论文日报</title>
    <link>${xmlEscape(siteUrl || "")}</link>
    <description>Physical Layer Security for UAV Communications · 每日自动汇总最新论文</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>uav-pls-daily</generator>
${items}
  </channel>
</rss>
`;
}

export function renderSite({ root, papers, status, log = () => {} }) {
  const docsDir = path.join(root, "docs");
  const assetsDir = path.join(docsDir, "assets");
  const dataDir = path.join(docsDir, "data");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const today = cnToday();
  const last7 = addDays(today, -6);
  const total = papers.length;
  const todayCount = papers.filter((paper) => paper.firstSeen === today).length;
  const weekCount = papers.filter((paper) => paper.firstSeen >= last7).length;

  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");

  const html = renderIndexHtml({
    papers,
    status,
    today,
    total,
    todayCount,
    weekCount,
    siteUrl,
  });

  fs.writeFileSync(path.join(docsDir, "index.html"), html, "utf8");
  fs.writeFileSync(
    path.join(dataDir, "papers.json"),
    `${JSON.stringify({ updatedAt: status?.updatedAt || "", total, papers }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(docsDir, "feed.xml"), buildRss(papers, siteUrl), "utf8");
  fs.writeFileSync(path.join(docsDir, ".nojekyll"), "", { flag: "a" });

  const staticDir = path.join(root, "src", "static");
  for (const file of ["style.css", "app.js"]) {
    fs.copyFileSync(path.join(staticDir, file), path.join(assetsDir, file));
  }

  log(`渲染完成：共 ${total} 篇，今日 ${todayCount} 篇，近 7 天 ${weekCount} 篇`);
}
