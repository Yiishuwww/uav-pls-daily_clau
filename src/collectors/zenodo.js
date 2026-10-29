// Zenodo 采集器。公开检索无需 key；设置 ZENODO_TOKEN 可提高限额。

import { fetchJson } from "../http.js";
import { cleanText, dateOnly } from "../text.js";

const API = "https://zenodo.org/api/records";

const QUERY =
  '("physical layer security" OR secrecy OR eavesdropper OR wiretap OR covert ' +
  'OR "artificial noise" OR "secure transmission") ' +
  'AND (UAV OR drone OR "unmanned aerial" OR UAS)';

const SUBTYPE_MAP = {
  article: "journal-article",
  preprint: "preprint",
  workingpaper: "preprint",
  technicalnote: "preprint",
  conferencepaper: "conference",
};

export async function collectZenodo({ since, config, log = () => {} }) {
  const token = process.env.ZENODO_TOKEN || "";
  // Zenodo 未认证请求每页最多 25 条；带 token 可到 100 条。
  const size = token ? Math.min(config.page_size ?? 100, 100) : 25;
  const maxPages = token ? 1 : Math.max(1, Math.min(config.max_pages ?? 2, 2));
  const hits = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchJson(API, {
      params: { q: QUERY, size, sort: "newest", page },
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 60_000,
      retries: 2,
    });
    total = Number(data.hits?.total ?? 0);
    const batch = data.hits?.hits ?? [];
    hits.push(...batch);
    if (batch.length < size || hits.length >= total) break;
  }

  log(`Zenodo 检索 ${total || hits.length} 条原始记录`);
  return parseZenodoHits(hits, since);
}

/** 把 Zenodo 原始 hits 转成统一 Paper；单独导出便于离线测试。 */
export function parseZenodoHits(hits, since) {
  const papers = [];
  for (const record of hits) {
    const meta = record.metadata ?? {};
    const resourceType = meta.resource_type ?? {};
    if (resourceType.type !== "publication") continue;

    const type = SUBTYPE_MAP[resourceType.subtype];
    if (!type) continue;

    const published = dateOnly(meta.publication_date || meta.date || record.created);
    if (!published || published < since) continue;

    const title = cleanText(meta.title);
    if (!title) continue;

    const doi = String(record.doi || meta.doi || "").toLowerCase() || undefined;
    const authors = (meta.creators ?? [])
      .map((creator) => cleanText(creator.name))
      .filter(Boolean);
    const journal = meta.journal ?? {};
    const imprint = meta.imprint ?? {};
    const files = Array.isArray(record.files) ? record.files : [];
    const pdfFile = files.find((file) =>
      String(file.key || "").toLowerCase().endsWith(".pdf") || file.type === "pdf",
    );

    papers.push({
      title,
      authors,
      abstract: cleanText(meta.description),
      doi,
      arxivId: undefined,
      venue:
        cleanText(journal.title)
        || (type === "preprint" ? "Zenodo" : cleanText(imprint.publisher) || "Zenodo"),
      publisher: cleanText(imprint.publisher) || "Zenodo",
      type,
      published,
      url: record.links?.html || (doi ? `https://doi.org/${doi}` : ""),
      pdfUrl: pdfFile?.links?.self || "",
      sources: ["zenodo"],
      tags: [],
      score: 0,
    });
  }
  return papers;
}
