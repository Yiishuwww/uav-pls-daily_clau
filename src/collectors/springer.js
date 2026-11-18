// Springer Nature Meta API 采集器。
// 免费 key：https://dev.springernature.com/ → 创建 Meta API key
// 文档：https://dev.springernature.com/docs/supported-query-params/

import { fetchJson } from "../http.js";
import { cleanText, dateOnly } from "../text.js";

const API = "https://api.springernature.com/meta/v2/json";

// 用多条短查询，避免单条布尔式过长；日期由 datefrom/dateto 约束。
const DEFAULT_QUERIES = [
  '(("physical layer security" OR secrecy OR eavesdropper) AND (UAV OR drone))',
  '((covert OR wiretap OR "artificial noise") AND (UAV OR drone))',
  '(("secure transmission" OR jamming) AND (UAV OR drone))',
];

const TYPE_MAP = {
  article: "journal-article",
  conferencepaper: "conference",
  chapter: "chapter",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mapType(contentType) {
  const key = String(contentType || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return TYPE_MAP[key] || "";
}

function pickAuthors(record) {
  const creators = Array.isArray(record.creators) ? record.creators : [];
  return creators
    .map((creator) => cleanText(creator?.creator ?? creator?.name ?? creator))
    .filter(Boolean);
}

function pickPublished(record) {
  return (
    dateOnly(record.publicationDate)
    || dateOnly(record.onlineDate)
    || dateOnly(record.publicationDate?.date)
  );
}

function pickAbstract(record) {
  if (typeof record.abstract === "string") return cleanText(record.abstract);
  if (record.abstract?.text) return cleanText(record.abstract.text);
  return "";
}

/** 把 Springer 原始 records 转成统一 Paper；单独导出便于离线测试。 */
export function parseSpringerRecords(records, since) {
  const papers = [];
  const seen = new Set();

  for (const record of records) {
    const title = cleanText(record.title);
    if (!title) continue;

    const type = mapType(record.contentType);
    if (!type) continue;

    const doi = String(record.doi || "")
      .toLowerCase()
      .replace(/^https?:\/\/doi\.org\//, "")
      .trim();
    const published = pickPublished(record);
    if (!published || published < since) continue;

    const key = doi || title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const venue =
      cleanText(record.publicationName)
      || cleanText(record.bookTitle)
      || "Springer";

    papers.push({
      title,
      authors: pickAuthors(record),
      abstract: pickAbstract(record),
      doi: doi || undefined,
      arxivId: undefined,
      venue,
      publisher: cleanText(record.publisher) || "Springer",
      type,
      published,
      url: doi ? `https://doi.org/${doi}` : cleanText(record.url),
      pdfUrl: "",
      sources: ["springer"],
      tags: [],
      score: 0,
    });
  }

  return papers;
}

export async function collectSpringer({ since, today, config = {}, log = () => {} }) {
  const keyEnv = config.api_key_env || "SPRINGER_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  if (!apiKey) {
    throw new Error(
      `未设置 ${keyEnv}；请到 https://dev.springernature.com/ 申请免费 Meta API key`,
    );
  }

  const queries =
    Array.isArray(config.queries) && config.queries.length > 0
      ? config.queries
      : DEFAULT_QUERIES;
  const pageSize = Math.max(1, Math.min(Number(config.page_size) || 100, 100));
  const maxPages = Math.max(1, Math.min(Number(config.max_pages) || 3, 10));
  // Basic 免费 key 不支持服务端日期筛选（403 premium）；默认在本地按日期过滤。
  // Premium key 可在 sources.yaml 设置 date_filter: true。
  const useDateFilter = config.date_filter === true;

  if (!useDateFilter) {
    log("Springer Basic key：不使用服务端日期筛选，改为本地过滤，必要时会多翻页");
  }

  const records = [];
  const seen = new Set();
  let successful = 0;
  let lastError = "";

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    let queryOk = false;
    let added = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const q = useDateFilter
        ? `${query} datefrom:${since} dateto:${today}`
        : query;
      let data;
      try {
        data = await fetchJson(API, {
          params: {
            q,
            api_key: apiKey,
            s: page * pageSize + 1,
            p: pageSize,
          },
          timeout: 60_000,
          retries: 2,
        });
      } catch (error) {
        lastError = error.message;
        log(`Springer 查询失败（第 ${index + 1} 条，第 ${page + 1} 页）：${error.message}`);
        break;
      }

      if (!Array.isArray(data.records)) {
        lastError = String(data.apiMessage || "缺少 records");
        log(`Springer 返回结构异常：${lastError}`);
        break;
      }

      queryOk = true;
      const batch = data.records;
      for (const record of batch) {
        const key = String(record.doi || record.title || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        records.push(record);
        added += 1;
      }

      if (batch.length < pageSize || !data.nextPage) break;
    }

    if (queryOk) successful += 1;
    log(`Springer 查询 ${index + 1}/${queries.length}：新增 ${added} 条`);
    // Basic key 约 100 次/分钟；三条查询之间留一点间隔。
    if (index < queries.length - 1) await sleep(700);
  }

  if (successful === 0) {
    throw new Error(`Springer 所有查询均失败${lastError ? `：${lastError}` : ""}`);
  }

  const papers = parseSpringerRecords(records, since);
  log(`Springer 原始记录 ${records.length} 条，时间窗内 ${papers.length} 条`);
  return papers;
}
