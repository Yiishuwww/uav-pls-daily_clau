// 生成物校验：JSON 可解析、网站内嵌数据与库一致、RSS 合法、静态资源齐全

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  console.error(`校验失败: ${message}`);
  process.exitCode = 1;
};

const storePath = path.join(root, "data", "papers.json");
const statusPath = path.join(root, "data", "status.json");
const htmlPath = path.join(root, "docs", "index.html");
const feedPath = path.join(root, "docs", "feed.xml");

for (const file of [storePath, statusPath, htmlPath, feedPath]) {
  if (!fs.existsSync(file)) {
    fail(`缺少文件 ${file}`);
    process.exit();
  }
}

const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
if (!Array.isArray(store.papers)) fail("papers.json 缺少 papers 数组");
const papers = store.papers ?? [];

const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
if (!Array.isArray(status.sources)) fail("status.json 缺少 sources 数组");

const html = fs.readFileSync(htmlPath, "utf8");
const marker = 'id="papers-data">';
const start = html.indexOf(marker);
if (start < 0) {
  fail("index.html 中找不到 papers-data");
} else {
  const jsonStart = start + marker.length;
  const jsonEnd = html.indexOf("</script>", jsonStart);
  const embedded = JSON.parse(html.slice(jsonStart, jsonEnd));
  if (!Array.isArray(embedded)) fail("内嵌论文数据不是数组");
  if (embedded.length !== papers.length) {
    fail(`内嵌数据 ${embedded.length} 条，与 papers.json 的 ${papers.length} 条不一致`);
  }
}

const feed = new XMLParser().parse(fs.readFileSync(feedPath, "utf8"));
const channel = feed?.rss?.channel;
if (!channel) {
  fail("feed.xml 缺少 rss/channel");
} else {
  const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  const expected = Math.min(100, papers.length);
  if (items.length !== expected) fail(`RSS 条目 ${items.length} 条，预期 ${expected} 条`);
}

for (const asset of ["assets/style.css", "assets/app.js", "data/papers.json"]) {
  if (!fs.existsSync(path.join(root, "docs", asset))) fail(`缺少静态资源 docs/${asset}`);
}

if (!process.exitCode) {
  console.log(`校验通过：${papers.length} 篇论文，RSS ${Math.min(100, papers.length)} 条`);
}
