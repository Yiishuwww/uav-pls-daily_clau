// 跨源去重与字段合并
// 匹配顺序：DOI → arXiv ID → 归一化标题 → 标题模糊匹配（≥94%）

import { distance } from "fastest-levenshtein";
import { shortHash, titleKey } from "./text.js";

const TYPE_RANK = {
  other: 0,
  preprint: 1,
  chapter: 2,
  conference: 2,
  "journal-article": 3,
};

export function normalizeDoi(doi) {
  return String(doi ?? "")
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, "")
    .trim();
}

export function normalizeArxivId(id) {
  return String(id ?? "")
    .toLowerCase()
    .replace(/^arxiv:/, "")
    .replace(/v\d+$/, "")
    .trim();
}

function rank(paper) {
  return TYPE_RANK[paper.type] ?? 0;
}

function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function isArxivVenue(venue) {
  return !venue || /^arxiv\b/i.test(venue);
}

function fuzzySame(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a[0] !== b[0]) return false;

  // "Part I" / "Part II" 这类姊妹论文标题极像，不能合并
  const partPattern = /\bpart\s+(i|ii|iii|iv|v|vi|1|2|3|4|5|6)\b/;
  const partA = a.match(partPattern);
  const partB = b.match(partPattern);
  if (partA && partB && partA[1] !== partB[1]) return false;

  const maxLen = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > Math.max(6, maxLen * 0.12)) return false;
  return 1 - distance(a, b) / maxLen >= 0.94;
}

function prepare(paper) {
  const doi = normalizeDoi(paper.doi) || undefined;
  const arxivId = normalizeArxivId(paper.arxivId) || undefined;
  return {
    ...paper,
    doi,
    arxivId,
    type: paper.type || "preprint",
    authors: Array.isArray(paper.authors) ? paper.authors.filter(Boolean) : [],
    sources: [...new Set(paper.sources ?? [])],
    tags: paper.tags ?? [],
    score: paper.score ?? 0,
    firstSeen: paper.firstSeen || "",
    isNew: Boolean(paper.isNew),
    _titleKey: titleKey(paper.title),
  };
}

function chooseTitle(a, b) {
  const rankA = rank(a);
  const rankB = rank(b);
  if (rankB > rankA) return b.title || a.title;
  if (rankA > rankB) return a.title || b.title;
  return (b.title?.length ?? 0) > (a.title?.length ?? 0) ? b.title : a.title;
}

function chooseVenue(a, b) {
  const aEmpty = isArxivVenue(a.venue);
  const bEmpty = isArxivVenue(b.venue);
  if (aEmpty && !bEmpty) return b.venue;
  if (!aEmpty && bEmpty) return a.venue;
  if (rank(b) > rank(a)) return b.venue || a.venue;
  return a.venue || b.venue;
}

function choosePublisher(a, b) {
  const aArxiv = !a.publisher || /^arxiv$/i.test(a.publisher);
  const bArxiv = !b.publisher || /^arxiv$/i.test(b.publisher);
  if (aArxiv && !bArxiv) return b.publisher;
  if (!aArxiv && bArxiv) return a.publisher;
  return a.publisher || b.publisher;
}

function mergeInto(target, source) {
  const targetRank = rank(target);
  const sourceRank = rank(source);
  const best = sourceRank > targetRank ? source : target;
  const worst = best === source ? target : source;

  const title = chooseTitle(target, source);
  const abstract =
    (source.abstract?.length ?? 0) > (target.abstract?.length ?? 0)
      ? source.abstract
      : target.abstract;
  const authors =
    (source.authors?.length ?? 0) > (target.authors?.length ?? 0)
      ? source.authors
      : target.authors;

  const published =
    targetRank === sourceRank
      ? earliest(target.published, source.published)
      : best.published || worst.published;

  Object.assign(target, {
    title,
    abstract,
    authors,
    type: best.type,
    venue: chooseVenue(target, source),
    publisher: choosePublisher(target, source),
    published,
    doi: target.doi || source.doi,
    arxivId: target.arxivId || source.arxivId,
    url: best.url || worst.url,
    pdfUrl: best.pdfUrl || worst.pdfUrl,
    sources: [...new Set([...(target.sources ?? []), ...(source.sources ?? [])])],
    firstSeen: earliest(target.firstSeen, source.firstSeen),
    isNew: target.isNew && source.isNew,
  });
  target._titleKey = titleKey(target.title);
}

function registerMaps(paper, maps) {
  if (paper.doi) maps.byDoi.set(paper.doi, paper);
  if (paper.arxivId) maps.byArxiv.set(paper.arxivId, paper);
  if (paper._titleKey) maps.byTitle.set(paper._titleKey, paper);
}

export function mergeAll(existing, incoming) {
  const out = [];
  const maps = {
    byDoi: new Map(),
    byArxiv: new Map(),
    byTitle: new Map(),
  };

  for (const raw of [...existing, ...incoming]) {
    if (!raw?.title) continue;
    const paper = prepare(raw);

    let match =
      (paper.doi && maps.byDoi.get(paper.doi)) ||
      (paper.arxivId && maps.byArxiv.get(paper.arxivId)) ||
      (paper._titleKey && maps.byTitle.get(paper._titleKey)) ||
      null;

    if (!match) {
      match = out.find((candidate) => fuzzySame(paper._titleKey, candidate._titleKey)) ?? null;
    }

    if (match) {
      mergeInto(match, paper);
      registerMaps(match, maps);
    } else {
      out.push(paper);
      registerMaps(paper, maps);
    }
  }

  return out;
}

/** 生成稳定 id、补齐链接，清理内部字段。 */
export function finalizePaper(paper) {
  const doi = normalizeDoi(paper.doi) || undefined;
  const arxivId = normalizeArxivId(paper.arxivId) || undefined;

  let id;
  if (doi) id = `doi:${doi}`;
  else if (arxivId) id = `arxiv:${arxivId}`;
  else id = `title:${shortHash(titleKey(paper.title))}`;

  let url = paper.url || "";
  if (doi) url = `https://doi.org/${doi}`;
  else if (!url && arxivId) url = `https://arxiv.org/abs/${arxivId}`;

  const pdfUrl = paper.pdfUrl || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");

  const { _titleKey, isNew, ...rest } = paper;
  return {
    ...rest,
    id,
    doi,
    arxivId,
    url,
    pdfUrl,
    sources: [...new Set(paper.sources ?? [])],
    tags: [...new Set(paper.tags ?? [])],
  };
}

export function sortPapers(papers) {
  return papers.sort((a, b) => {
    const byPublished = (b.published || "").localeCompare(a.published || "");
    if (byPublished !== 0) return byPublished;
    const byFirstSeen = (b.firstSeen || "").localeCompare(a.firstSeen || "");
    if (byFirstSeen !== 0) return byFirstSeen;
    return (b.score || 0) - (a.score || 0);
  });
}
