// Crossref API 采集器（无需 key）
// 采用多组定向检索词 + publisher member，覆盖 IEEE / Elsevier / Springer / Wiley。

import { fetchJson } from "../http.js";
import { cleanText, countTerm, dateOnly, normalize } from "../text.js";

const API = "https://api.crossref.org/works";

const TYPE_MAP = {
  "journal-article": "journal-article",
  "proceedings-article": "conference",
  "posted-content": "preprint",
};

const SELECT_FIELDS = [
  "DOI",
  "title",
  "author",
  "abstract",
  "container-title",
  "publisher",
  "type",
  "published",
  "published-print",
  "published-online",
  "issued",
  "created",
  "URL",
  "link",
].join(",");

// 定向检索词：比一长串关键词的相关性排序好得多
const GENERAL_QUERIES = [
  "physical layer security UAV",
  "secrecy UAV",
  "covert communication UAV",
  "eavesdropper UAV",
  "anti jamming UAV",
  "physical layer security unmanned aerial vehicle",
  "jamming UAV",
];

// 每个出版商额外跑的两组核心检索
const MEMBER_QUERIES = [
  "physical layer security UAV",
  "secrecy UAV",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dateFromParts(value) {
  const parts = value?.["date-parts"]?.[0];
  if (!parts || !parts[0]) return "";
  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function pickPublished(item) {
  return (
    dateFromParts(item["published-online"]) ||
    dateFromParts(item["published-print"]) ||
    dateFromParts(item.published) ||
    dateFromParts(item.issued) ||
    dateOnly(item.created?.["date-time"])
  );
}

async function queryOnce({ query, filter, rows, mailto, useSelect = true }) {
  return fetchJson(API, {
    params: {
      "query.bibliographic": query,
      filter,
      rows,
      select: useSelect ? SELECT_FIELDS : undefined,
      mailto: mailto || undefined,
    },
    timeout: 60_000,
  });
}

function wantsSelectError(error) {
  return error.status === 400 && /select/i.test(error.message);
}

async function search({ query, filter, rows, mailto, log }) {
  try {
    return await queryOnce({ query, filter, rows, mailto, useSelect: true });
  } catch (error) {
    if (!wantsSelectError(error)) throw error;
    log("Crossref 不支持当前 select 字段组合，改为完整响应");
    return queryOnce({ query, filter, rows, mailto, useSelect: false });
  }
}

export async function collectCrossref({ since, today, keywords, config, log = () => {} }) {
  const mailto = config.contact_email || "";
  const dateFilter = `from-created-date:${since},until-created-date:${today}`;
  const generalRows = config.rows ?? 100;
  const memberRows = config.member_rows ?? 60;

  const jobs = GENERAL_QUERIES.map((query) => ({
    query,
    filter: dateFilter,
    rows: generalRows,
    label: "all",
  }));

  for (const member of config.members ?? []) {
    for (const query of MEMBER_QUERIES) {
      jobs.push({
        query,
        filter: `${dateFilter},member:${member.id}`,
        rows: memberRows,
        label: member.name || String(member.id),
      });
    }
  }

  const items = [];
  const seen = new Set();
  let successful = 0;

  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    try {
      const data = await search({
        query: job.query,
        filter: job.filter,
        rows: job.rows,
        mailto,
        log,
      });
      successful += 1;
      const batch = data.message?.items ?? [];
      let added = 0;
      for (const item of batch) {
        const key = String(item.DOI || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        items.push(item);
        added += 1;
      }
      log(`Crossref [${job.label}] "${job.query}"：${batch.length} 条，新增 ${added} 条`);
    } catch (error) {
      log(`Crossref [${job.label}] "${job.query}" 失败：${error.message}`);
    }

    if (index < jobs.length - 1) await sleep(1200);
  }

  if (successful === 0) {
    throw new Error("Crossref 所有检索均失败");
  }

  const papers = [];
  for (const item of items) {
    const title = cleanText(Array.isArray(item.title) ? item.title[0] : item.title);
    const published = pickPublished(item);
    if (!title || !published || published < since) continue;

    const type = TYPE_MAP[item.type];
    if (!type) continue;

    const doi = String(item.DOI || "").toLowerCase();
    if (!doi) continue;

    const authors = (item.author ?? [])
      .map((author) => cleanText([author.given, author.family].filter(Boolean).join(" ")))
      .filter(Boolean);

    const container = item["container-title"];
    const venue = cleanText(Array.isArray(container) ? container[0] : container);
    const publisher = cleanText(item.publisher);
    const pdfLink = (item.link ?? []).find((link) =>
      String(link["content-type"] || "").toLowerCase().includes("pdf"),
    );

    papers.push({
      title,
      authors,
      abstract: cleanText(item.abstract),
      doi,
      arxivId: undefined,
      venue: venue || publisher,
      publisher,
      type,
      published,
      url: `https://doi.org/${doi}`,
      pdfUrl: pdfLink?.URL || "",
      sources: ["crossref"],
      tags: [],
      score: 0,
    });
  }

  // 本地先粗筛：标题或摘要至少出现一个 PLS 词
  const filtered = papers.filter((paper) => {
    const text = normalize(`${paper.title} ${paper.abstract}`);
    return keywords.pls_terms.some((term) => countTerm(text, term) > 0);
  });

  log(`Crossref 去重后 ${papers.length} 条，含 PLS 词 ${filtered.length} 条`);
  return filtered;
}
