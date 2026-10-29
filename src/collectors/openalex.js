// OpenAlex API 采集器（无需 key；带 mailto 可进入 polite pool）

import { fetchJson } from "../http.js";
import { cleanText, dateOnly } from "../text.js";

const API = "https://api.openalex.org/works";

const TYPE_MAP = {
  article: "journal-article",
  review: "journal-article",
  preprint: "preprint",
  "proceedings-article": "conference",
  "book-chapter": "chapter",
  dissertation: "other",
  dataset: "other",
  report: "other",
};

function quote(term) {
  return term.includes(" ") ? `"${term}"` : term;
}

function buildStrictQuery(keywords) {
  const pls = keywords.pls_terms.map(quote).join(" OR ");
  const uav = keywords.uav_terms.map(quote).join(" OR ");
  return `(${pls}) AND (${uav})`;
}

function buildFallbackQueries(keywords) {
  const uav = 'UAV OR drone OR "unmanned aerial" OR UAS';
  const pls = keywords.pls_terms.slice(0, 10);
  return pls.map((term) => `${quote(term)} AND (${uav})`);
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex) return "";
  const slots = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) slots[position] = word;
  }
  return slots.filter(Boolean).join(" ");
}

function extractArxivId(work) {
  for (const location of work.locations ?? []) {
    const candidates = [location.landing_page_url, location.pdf_url].filter(Boolean);
    for (const url of candidates) {
      const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/i);
      if (match) return match[1].replace(/v\d+$/, "");
    }
  }
  return "";
}

function normalizeArxivVenue(name) {
  return name.toLowerCase().replace(/[^a-z]/g, "").includes("arxiv");
}

async function searchPage({ filter, page, perPage, mailto }) {
  return fetchJson(API, {
    params: {
      filter,
      "per-page": perPage,
      page,
      mailto: mailto || undefined,
    },
    timeout: 60_000,
  });
}

async function runSearch({ query, since, today, config, log }) {
  const filter = [
    `from_publication_date:${since}`,
    `to_publication_date:${today}`,
    `title_and_abstract.search:${query}`,
  ].join(",");

  const perPage = Math.min(config.per_page ?? 200, 200);
  const maxPages = config.max_pages ?? 3;
  const mailto = config.contact_email || "";
  const results = [];

  for (let page = 1; page <= maxPages; page += 1) {
    let data;
    try {
      data = await searchPage({ filter, page, perPage, mailto });
    } catch (error) {
      if (page > 1) {
        log(`OpenAlex 第 ${page} 页不可用（${error.message}），保留前 ${results.length} 条`);
        break;
      }
      throw error;
    }
    const batch = data.results ?? [];
    results.push(...batch);
    const total = data.meta?.count ?? 0;
    if (batch.length === 0 || results.length >= total) break;
  }

  log(`OpenAlex 检索 ${results.length} 条原始记录`);
  return results;
}

export async function collectOpenAlex({ since, today, keywords, config, log = () => {} }) {
  const strictQuery = buildStrictQuery(keywords);
  let raw;

  try {
    raw = await runSearch({ query: strictQuery, since, today, config, log });
  } catch (error) {
    if (error.status !== 400 && error.status !== 403) throw error;
    log("OpenAlex 布尔检索被拒绝，改用多组宽松检索");
    raw = [];
    for (const query of buildFallbackQueries(keywords)) {
      try {
        raw.push(...(await runSearch({ query, since, today, config, log })));
      } catch (inner) {
        if (inner.status !== 400) throw inner;
      }
    }
    const seen = new Set();
    raw = raw.filter((work) => {
      if (seen.has(work.id)) return false;
      seen.add(work.id);
      return true;
    });
  }

  const papers = [];
  for (const work of raw) {
    const title = cleanText(work.display_name || work.title);
    const published = dateOnly(work.publication_date);
    if (!title || !published || published < since || published > today) continue;

    const venueName = cleanText(work.primary_location?.source?.display_name);
    const arxivId = extractArxivId(work);
    const isArxiv = normalizeArxivVenue(venueName) || (!venueName && Boolean(arxivId));

    let type = TYPE_MAP[work.type] ?? "other";
    if (isArxiv) type = "preprint";
    if (!["journal-article", "conference", "preprint"].includes(type)) continue;

    const doi = (work.doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() || undefined;
    const authors = (work.authorships ?? [])
      .map((authorship) => cleanText(authorship.author?.display_name))
      .filter(Boolean);

    const pdfUrl =
      work.best_oa_location?.pdf_url ||
      work.primary_location?.pdf_url ||
      (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");

    papers.push({
      title,
      authors,
      abstract: cleanText(reconstructAbstract(work.abstract_inverted_index)),
      doi,
      arxivId: arxivId || undefined,
      venue: venueName || (isArxiv ? "arXiv" : ""),
      publisher: cleanText(work.primary_location?.source?.host_organization_name),
      type,
      published,
      url:
        work.primary_location?.landing_page_url ||
        (doi ? `https://doi.org/${doi}` : "") ||
        (arxivId ? `https://arxiv.org/abs/${arxivId}` : ""),
      pdfUrl,
      sources: ["openalex"],
      tags: [],
      score: 0,
    });
  }

  return papers;
}
