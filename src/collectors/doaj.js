// DOAJ（Directory of Open Access Journals）采集器，无需 key。
// DOAJ 的复杂布尔查询不稳定，这里用多条单字段查询 + 本地 PLS/UAV 过滤。

import { fetchJson } from "../http.js";
import { cleanText, dateOnly } from "../text.js";

const API = "https://doaj.org/api/v2/search/articles";

const QUERIES = [
  'bibjson.title:"physical layer security"',
  'bibjson.abstract:"physical layer security"',
  "bibjson.title:secrecy",
  'bibjson.abstract:"secrecy rate"',
  "bibjson.title:eavesdropper",
  "bibjson.title:wiretap",
  "bibjson.title:covert",
  'bibjson.abstract:"covert communication"',
  'bibjson.title:"artificial noise"',
  'bibjson.abstract:"secure transmission"',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function queryTerm(query) {
  const quoted = query.match(/"([^"]+)"/);
  return (quoted?.[1] ?? query.split(":").pop() ?? "").toLowerCase();
}

function parseRecordDates(bibjson, indexedDate, since) {
  const year = Number(bibjson.year);
  if (!Number.isFinite(year) || year <= 0) return null;

  const rawMonth = String(bibjson.month ?? "").trim();
  const month = /^\d+$/.test(rawMonth) ? Number(rawMonth) : 0;
  const hasMonth = month >= 1 && month <= 12;
  const published = hasMonth
    ? `${year}-${String(month).padStart(2, "0")}-01`
    : (indexedDate || `${year}-01-01`);

  // 优先用 DOAJ 入库日期判断是否属于本次时间窗，避免月份缺失被误当成 1 月
  if (indexedDate) {
    if (indexedDate < since) return null;
  } else {
    if (year < Number(since.slice(0, 4))) return null;
    if (hasMonth && published.slice(0, 7) < since.slice(0, 7)) return null;
  }

  return { published, firstSeenHint: indexedDate || published };
}

async function searchOnce(query, page, pageSize, log) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const data = await fetchJson(`${API}/${encodeURIComponent(query)}`, {
      params: {
        page,
        pageSize,
        sort: "created_date:desc",
      },
      timeout: 60_000,
      retries: 2,
    });

    const echoed = String(data.query ?? "").toLowerCase();
    const total = Number(data.total);
    if (echoed.includes(queryTerm(query)) && Number.isFinite(total) && total < 1_000_000) {
      return data;
    }

    log(`DOAJ 查询未生效（接口返回全库），重试 ${attempt + 1}/3`);
    await sleep(1500);
  }
  throw new Error(`DOAJ 查询持续异常: ${query}`);
}

export async function collectDoaj({ since, config, log = () => {} }) {
  const pageSize = Math.min(config.page_size ?? 100, 100);
  const maxPages = Math.max(1, config.max_pages ?? 1);
  const results = [];
  const seen = new Set();
  let successful = 0;

  for (let index = 0; index < QUERIES.length; index += 1) {
    const query = QUERIES[index];
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const data = await searchOnce(query, page, pageSize, log);
        successful += 1;

        const batch = data.results ?? [];
        let added = 0;
        for (const result of batch) {
          const bibjson = result.bibjson ?? {};
          const doi = toArray(bibjson.identifier)
            .find((identifier) => String(identifier.type).toLowerCase() === "doi")?.id;
          const key = String(doi || cleanText(bibjson.title)).toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          results.push(result);
          added += 1;
        }

        log(`DOAJ ${query} 第 ${page} 页：${batch.length} 条，新增 ${added} 条`);
        if (batch.length < pageSize) break;
      }
    } catch (error) {
      log(`DOAJ 查询失败（${query}）：${error.message}`);
    }

    if (index < QUERIES.length - 1) await sleep(1100);
  }

  if (successful === 0) throw new Error("DOAJ 所有查询均失败");

  const papers = [];
  for (const result of results) {
    const bibjson = result.bibjson ?? {};
    const title = cleanText(bibjson.title);
    const dates = parseRecordDates(bibjson, dateOnly(result.created_date), since);
    if (!title || !dates) continue;

    const doi = String(
      toArray(bibjson.identifier).find(
        (identifier) => String(identifier.type).toLowerCase() === "doi",
      )?.id ?? "",
    ).toLowerCase();
    const authors = toArray(bibjson.author)
      .map((author) => cleanText(author.name))
      .filter(Boolean);
    const journal = bibjson.journal ?? {};
    const languages = toArray(journal.language).map((language) =>
      String(language).toUpperCase(),
    );
    if (languages.length > 0 && !languages.some((language) => language.startsWith("EN"))) {
      continue;
    }
    const links = toArray(bibjson.link);
    const pdfUrl =
      links.find((link) => String(link.content_type || "").toLowerCase().includes("pdf"))?.url
      || "";
    const fulltext = links.find((link) => link.type === "fulltext")?.url || "";

    papers.push({
      title,
      authors,
      abstract: cleanText(bibjson.abstract),
      doi: doi || undefined,
      arxivId: undefined,
      venue: cleanText(journal.title),
      publisher: cleanText(journal.publisher),
      type: "journal-article",
      published: dates.published,
      firstSeenHint: dates.firstSeenHint,
      url: doi ? `https://doi.org/${doi}` : fulltext,
      pdfUrl,
      sources: ["doaj"],
      tags: [],
      score: 0,
    });
  }

  return papers;
}
