// 自然周周报：统计事实 + 可选 GLM-4-Flash 导语。
// 统计由代码计算，AI 只负责把事实写成 2–3 句中文，避免编造数字或趋势。

import path from "node:path";
import { fetchJson } from "./http.js";
import { readJson, writeJson } from "./store.js";
import { cleanText, cnNowIso, cnToday } from "./text.js";

const DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4-flash";
const SUMMARY_MAX_CHARS = 180;

function isIeeePaper(paper) {
  const doi = String(paper.doi || "").toLowerCase();
  return (paper.sources || []).includes("ieee")
    || doi.startsWith("10.1109/")
    || /\bieee\b/i.test(paper.publisher || "")
    || /\bieee\b/i.test(paper.venue || "");
}

function monthDay(isoDate) {
  return String(isoDate || "").slice(5).replace("-", ".");
}

function templateSummary({ rangeStart, rangeEnd, count, typeCounts, ieeeCount, topTags }) {
  if (count === 0) return "本周暂无新增论文。";

  const typeText = [
    typeCounts["journal-article"] ? `期刊 ${typeCounts["journal-article"]}` : "",
    typeCounts.conference ? `会议 ${typeCounts.conference}` : "",
    typeCounts.preprint ? `预印本 ${typeCounts.preprint}` : "",
  ].filter(Boolean).join("、");

  let text = `该周（${monthDay(rangeStart)}–${monthDay(rangeEnd)}）新增 ${count} 篇`;
  if (typeText) text += `：${typeText}`;
  text += ieeeCount > 0 ? `；其中 IEEE 论文 ${ieeeCount} 篇。` : "。";
  if (topTags.length > 0) {
    text += `热门主题：${topTags.slice(0, 3).map(([name]) => name).join("、")}。`;
  }
  return text;
}

/** 最近一个完整的自然周：上周一至上周日。 */
function lastCompletedWeek(today) {
  const date = new Date(`${today}T00:00:00Z`);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const thisMonday = new Date(date);
  thisMonday.setUTCDate(date.getUTCDate() - sinceMonday);

  const start = new Date(thisMonday);
  start.setUTCDate(thisMonday.getUTCDate() - 7);

  const end = new Date(thisMonday);
  end.setUTCDate(thisMonday.getUTCDate() - 1);

  return {
    rangeStart: start.toISOString().slice(0, 10),
    rangeEnd: end.toISOString().slice(0, 10),
  };
}

function buildFacts(papers, today) {
  const { rangeStart, rangeEnd } = lastCompletedWeek(today);
  const weekly = papers.filter(
    (paper) => paper.firstSeen && paper.firstSeen >= rangeStart && paper.firstSeen <= rangeEnd,
  );

  const typeCounts = { "journal-article": 0, conference: 0, preprint: 0 };
  const tagCounts = new Map();
  let ieeeCount = 0;

  for (const paper of weekly) {
    if (typeCounts[paper.type] != null) typeCounts[paper.type] += 1;
    if (isIeeePaper(paper)) ieeeCount += 1;
    for (const tag of paper.tags || []) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
    .slice(0, 4);

  const picks = [...weekly]
    .sort((a, b) =>
      (b.citationCount || 0) - (a.citationCount || 0)
      || (b.score || 0) - (a.score || 0)
      || (b.published || "").localeCompare(a.published || ""))
    .slice(0, 3)
    .map((paper) => ({
      id: paper.id,
      title: paper.title,
      type: paper.type,
      published: paper.published,
      citationCount: paper.citationCount || 0,
      url: paper.url || "",
    }));

  const fingerprint = [
    rangeStart,
    rangeEnd,
    weekly.map((paper) => paper.id).sort().join(","),
    topTags.map(([name, count]) => `${name}:${count}`).join(","),
    picks.map((paper) => paper.id).join(","),
  ].join("|");

  return {
    rangeStart,
    rangeEnd,
    count: weekly.length,
    typeCounts,
    ieeeCount,
    topTags,
    picks,
    fingerprint,
  };
}

function buildPrompt(facts) {
  const { rangeStart, rangeEnd, count, typeCounts, ieeeCount, topTags, picks } = facts;
  const typeText = [
    typeCounts["journal-article"] ? `期刊 ${typeCounts["journal-article"]}` : "",
    typeCounts.conference ? `会议 ${typeCounts.conference}` : "",
    typeCounts.preprint ? `预印本 ${typeCounts.preprint}` : "",
  ].filter(Boolean).join("、");

  return [
    "你是学术论文日报的编辑。请根据下面的统计数据，用 2-3 句简体中文写一段周报导语。",
    "要求：",
    "1. 只使用给出的信息，不要编造论文、数字、方法或趋势。",
    "2. 不要使用 Markdown，不要分点，不超过 120 字。",
    "3. 先概括这一周的新增情况，再点出 2-3 个热门主题；如果有值得关注的论文，可以提一篇标题。",
    "",
    `日期范围：${rangeStart} 至 ${rangeEnd}`,
    `新增论文：${count} 篇`,
    `类型分布：${typeText || "无"}`,
    `IEEE 论文：${ieeeCount} 篇`,
    `热门主题：${topTags.map(([name, n]) => `${name}（${n} 篇）`).join("、") || "无"}`,
    `值得关注：${picks.map((paper) => paper.title).join("；") || "无"}`,
  ].join("\n");
}

async function generateAiSummary(facts, config, log) {
  if (config.enabled === false) return null;
  const keyEnv = config.api_key_env || "GLM_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  if (!apiKey) {
    log("周报总结：未配置 GLM_API_KEY，使用模板");
    return null;
  }

  const baseUrl = (config.base_url || DEFAULT_BASE).replace(/\/+$/, "");
  const model = config.model || DEFAULT_MODEL;
  try {
    const data = await fetchJson(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: buildPrompt(facts) },
        ],
        temperature: 0.3,
        max_tokens: 220,
      }),
      timeout: 60_000,
      retries: 2,
    });
    const text = cleanText(data.choices?.[0]?.message?.content || "");
    if (!text) return null;
    return text.length > SUMMARY_MAX_CHARS
      ? `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`
      : text;
  } catch (error) {
    log(`周报总结生成失败：${error.message}`);
    return null;
  }
}

/**
 * 生成周报。每个自然周只生成一次，周内复用上一份报告。
 * generateSummary=false 时不请求网络，适合 --no-collect 或离线渲染。
 */
export async function buildWeeklyReport(
  papers,
  { config = {}, log = () => {}, previous = null, generateSummary = true, today = cnToday() } = {},
) {
  const facts = buildFacts(papers, today);
  const sameWeek = previous
    && previous.rangeStart === facts.rangeStart
    && previous.rangeEnd === facts.rangeEnd;
  const reusable = sameWeek
    && previous.summary
    // 模板导语允许在配置 key 后升级为 AI 导语。
    && (!generateSummary || previous.summarySource === "ai");

  if (reusable) return previous;

  let summary = "";
  let summarySource = "template";

  const aiSummary = generateSummary
    ? await generateAiSummary(facts, config, log)
    : null;
  if (aiSummary) {
    summary = aiSummary;
    summarySource = "ai";
  } else {
    summary = templateSummary(facts);
  }

  return {
    generatedAt: cnNowIso(),
    ...facts,
    summary,
    summarySource,
  };
}

export function loadWeekly(root) {
  return readJson(path.join(root, "data", "weekly.json"), null);
}

export function saveWeekly(root, report) {
  writeJson(path.join(root, "data", "weekly.json"), report);
}
