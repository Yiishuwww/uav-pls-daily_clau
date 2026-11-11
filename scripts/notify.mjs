#!/usr/bin/env node
// 把当天新增论文推送到微信。
// 支持：企业微信群机器人 WECHAT_WEBHOOK / PushPlus PUSHPLUS_TOKEN / Server酱 SERVERCHAN_KEY
// 用法：node scripts/notify.mjs [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchText } from "../src/http.js";
import { cnToday } from "../src/text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_ITEMS = Math.max(1, Number(process.env.NOTIFY_MAX_ITEMS) || 10);
const DRY_RUN = process.argv.includes("--dry-run");

const log = (message) => console.log(`[notify] ${message}`);

function escapeMarkdown(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(value, max) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function paperUrl(paper) {
  return paper.url || (paper.doi ? `https://doi.org/${paper.doi}` : "") || "";
}

function formatPaper(paper, index) {
  const title = truncate(paper.title, 110);
  const url = paperUrl(paper);
  const heading = url
    ? `${index + 1}. [${escapeMarkdown(title)}](${url})`
    : `${index + 1}. ${escapeMarkdown(title)}`;
  const meta = [paper.venue, paper.published].filter(Boolean).join(" · ");
  const tags = (paper.tags || []).slice(0, 3).join(" / ");
  const detail = [meta, tags].filter(Boolean).join(" · ");
  return detail ? `${heading}\n> ${escapeMarkdown(detail)}` : heading;
}

function buildMessage(papers, today) {
  const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const title = `UAV PLS 日报 ${today}：${papers.length} 篇新论文`;
  const lines = [`# ${title}`, ""];

  for (const [index, paper] of papers.slice(0, MAX_ITEMS).entries()) {
    lines.push(formatPaper(paper, index), "");
  }
  if (papers.length > MAX_ITEMS) {
    lines.push(`另有 ${papers.length - MAX_ITEMS} 篇，详见网站。`, "");
  }
  if (site) lines.push(`[打开网站](${site}/)`);

  return { title, content: lines.join("\n").trim() };
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

async function postJson(url, payload) {
  return fetchText(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    accept: "application/json",
    timeout: 20_000,
    retries: 2,
  });
}

async function sendWechat({ content }) {
  const text = await postJson(process.env.WECHAT_WEBHOOK, {
    msgtype: "markdown",
    markdown: { content },
  });
  const data = JSON.parse(text);
  if (Number(data.errcode) !== 0) {
    throw new Error(`企业微信返回 ${data.errcode}: ${data.errmsg || "未知错误"}`);
  }
}

async function sendPushPlus({ title, content }) {
  const text = await postJson("https://www.pushplus.plus/send", {
    token: process.env.PUSHPLUS_TOKEN,
    title,
    content,
    template: "markdown",
  });
  const data = JSON.parse(text);
  if (Number(data.code) !== 200) {
    throw new Error(`PushPlus 返回 ${data.code}: ${data.msg || "未知错误"}`);
  }
}

async function sendServerChan({ title, content }) {
  const key = process.env.SERVERCHAN_KEY;
  const body = new URLSearchParams({
    title: truncate(title, 32),
    desp: content,
  }).toString();
  const text = await fetchText(
    `https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      accept: "application/json",
      timeout: 20_000,
      retries: 2,
    },
  );
  const data = JSON.parse(text);
  if (Number(data.code) !== 0) {
    throw new Error(`Server酱返回 ${data.code}: ${data.message || data.msg || "未知错误"}`);
  }
}

function redact(message, secrets) {
  let text = String(message ?? "");
  for (const secret of secrets) {
    if (secret && secret.length > 4) text = text.split(secret).join("***");
  }
  return text;
}

async function main() {
  const { today, papers } = readNewPapers();
  if (papers.length === 0) {
    log(`今天（${today}）没有新论文，跳过推送`);
    return;
  }

  const message = buildMessage(papers, today);
  log(`准备推送 ${papers.length} 篇新论文`);

  if (DRY_RUN) {
    console.log(message.title);
    console.log(message.content);
    return;
  }

  const channels = [];
  if (process.env.WECHAT_WEBHOOK) {
    channels.push({ name: "企业微信群机器人", run: sendWechat });
  }
  if (process.env.PUSHPLUS_TOKEN) {
    channels.push({ name: "PushPlus", run: sendPushPlus });
  }
  if (process.env.SERVERCHAN_KEY) {
    channels.push({ name: "Server酱", run: sendServerChan });
  }

  if (channels.length === 0) {
    log("未配置推送渠道（WECHAT_WEBHOOK / PUSHPLUS_TOKEN / SERVERCHAN_KEY），跳过");
    return;
  }

  const secrets = [
    process.env.WECHAT_WEBHOOK,
    process.env.PUSHPLUS_TOKEN,
    process.env.SERVERCHAN_KEY,
  ].filter(Boolean);

  let ok = 0;
  for (const channel of channels) {
    try {
      await channel.run(message);
      ok += 1;
      log(`${channel.name} 发送成功`);
    } catch (error) {
      log(`${channel.name} 发送失败：${redact(error?.message || error, secrets)}`);
    }
  }

  if (ok === 0) process.exitCode = 1;
}

main().catch((error) => {
  const secrets = [
    process.env.WECHAT_WEBHOOK,
    process.env.PUSHPLUS_TOKEN,
    process.env.SERVERCHAN_KEY,
  ].filter(Boolean);
  console.error(`[notify] 运行失败：${redact(error?.stack || error?.message || error, secrets)}`);
  process.exitCode = 1;
});
