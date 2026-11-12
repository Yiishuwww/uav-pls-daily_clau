// IEEE Xplore 官方 Metadata API 采集器。
// 免费申请 key：https://developer.ieee.org/ → Get an API Key
// 然后设置环境变量 IEEE_API_KEY（GitHub Actions 中使用同名 Secret）。

import { fetchJson } from "../http.js";
import { cleanText } from "../text.js";

const API = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

// IEEE 对单条查询的词数有限制，拆成多条短布尔式，避免长查询被拒。
const DEFAULT_QUERIES = [
  '("physical layer security" OR secrecy) AND (UAV OR drone)',
  '(covert OR eavesdropper OR wiretap) AND (UAV OR drone)',
  '("artificial noise" OR jamming) AND (UAV OR drone)',
];

const MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** IEEE 的日期可能是 "2026-05-12"、"23-24 July 2026"、"2026" 或 "20261111"，统一成 YYYY-MM-DD。 */
export function parseIeeeDate(value) {
  const raw = cleanText(value);
  if (!raw) return "";

  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];

  // insert_date 常见格式：20261111
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  // IEEE 有时只给年月，如 "2026-05"。
  const yearMonth = raw.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`;

  // 兼容 "January 2026"、"23-24 July 2026"、"15 Feb.15, 2026"
  const yearMatch = raw.match(/\b(?:19|20)\d{2}\b/);
  const monthMatch = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?/i);
  if (yearMatch && monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase()];
    if (month) return `${yearMatch[0]}-${String(month).padStart(2, "0")}-01`;
  }

  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return "";
}

function mapType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (value.includes("conference")) return "conference";
  if (
    value.includes("journal")
    || value.includes("magazine")
    || value.includes("early access")
  ) {
    return "journal-article";
  }
  return "";
}

function pickDoi(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, "")
    .trim();
}

function pickAuthors(article) {
  const list = Array.isArray(article.authors)
    ? article.authors
    : article.authors?.authors ?? [];
  return list.map((author) => cleanText(author.full_name)).filter(Boolean);
}

/** 把 IEEE 原始 articles 转成统一 Paper；单独导出便于离线测试。 */
export function parseIeeeArticles(articles, since) {
  const papers = [];
  const seen = new Set();

  for (const article of articles) {
    const title = cleanText(article.title);
    if (!title) continue;

    const number = String(article.article_number || "");
    const doi = pickDoi(article.doi);
    const key = (doi || number || title.toLowerCase()).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const type = mapType(article.content_type);
    if (!type) continue;

    const pubRaw = cleanText(article.publication_date);
    const pubDate = parseIeeeDate(pubRaw);
    const inserted = parseIeeeDate(article.insert_date);
    const yearOnly = !pubRaw || /^\d{4}$/.test(pubRaw);

    // 只有年份或没有出版日期时，用 IEEE 入库日期展示，避免显示成 1 月 1 日。
    const published =
      (yearOnly ? inserted : pubDate)
      || pubDate
      || inserted
      || parseIeeeDate(article.publication_year);
    if (!published) continue;

    // 日更关心“最近入库”，也兼容出版日期落在窗口内的记录。
    if (!((inserted && inserted >= since) || (pubDate && pubDate >= since))) continue;

    const url =
      article.html_url
      || (number ? `https://ieeexplore.ieee.org/document/${number}` : "");

    papers.push({
      title,
      authors: pickAuthors(article),
      abstract: cleanText(article.abstract),
      doi: doi || undefined,
      arxivId: undefined,
      venue: cleanText(article.publication_title),
      publisher:
        typeof article.publisher === "string" && article.publisher.trim()
          ? cleanText(article.publisher)
          : "IEEE",
      type,
      published,
      url: url || (doi ? `https://doi.org/${doi}` : ""),
      pdfUrl: article.pdf_url || "",
      sources: ["ieee"],
      tags: [],
      score: 0,
    });
  }

  return papers;
}

export async function collectIeee({ since, today, config = {}, log = () => {} }) {
  const keyEnv = config.api_key_env || "IEEE_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  if (!apiKey) {
    throw new Error(
      `未设置 ${keyEnv}；请到 https://developer.ieee.org/ 免费申请 IEEE Xplore Metadata API key`,
    );
  }

  const queries =
    Array.isArray(config.queries) && config.queries.length > 0
      ? config.queries
      : DEFAULT_QUERIES;
  const pageSize = Math.max(1, Math.min(Number(config.page_size) || 200, 200));
  const maxPages = Math.max(1, Math.min(Number(config.max_pages) || 3, 10));
  const startYear = since.slice(0, 4);
  // Early Access 的期号可能排到明年，多覆盖一年。
  const endYear = String(Number(today.slice(0, 4)) + 1);

  const articles = [];
  const seen = new Set();
  let successful = 0;

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    let queryOk = false;
    let added = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const params = {
        apikey: apiKey,
        // 注意：v1 接口会忽略 booleantext，必须用 querytext。
        querytext: query,
        start_year: startYear,
        end_year: endYear,
        start_record: page * pageSize + 1,
        max_records: pageSize,
      };

      let data;
      try {
        data = await fetchJson(API, {
          params,
          timeout: 60_000,
          retries: 2,
        });

        if (!Array.isArray(data.articles)) {
          const message =
            data.error || data.message || JSON.stringify(data).slice(0, 160);
          throw new Error(`返回结构异常：${message}`);
        }
      } catch (error) {
        log(`IEEE 查询失败（第 ${index + 1} 条，第 ${page + 1} 页）：${error.message}`);
        break;
      }

      queryOk = true;
      const batch = data.articles;
      for (const article of batch) {
        const key =
          pickDoi(article.doi)
          || String(article.article_number || "")
          || cleanText(article.title).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        articles.push(article);
        added += 1;
      }

      const total = Number(data.total_records ?? 0);
      if (batch.length < pageSize || (page + 1) * pageSize >= total) break;
    }

    if (queryOk) successful += 1;
    log(`IEEE 查询 ${index + 1}/${queries.length}：新增 ${added} 条`);
    if (index < queries.length - 1) await sleep(600);
  }

  if (successful === 0) throw new Error("IEEE Xplore 所有查询均失败");

  const papers = parseIeeeArticles(articles, since);
  log(`IEEE 原始记录 ${articles.length} 条，时间窗内 ${papers.length} 条`);
  return papers;
}
