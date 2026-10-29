// arXiv 官方 Atom API 采集器（无需 key，单次请求约 3 秒限速）

import { XMLParser } from "fast-xml-parser";
import { fetchText } from "../http.js";
import { cleanText, dateOnly } from "../text.js";

const API = "https://export.arxiv.org/api/query";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return value["#text"] ?? "";
}

function arxivVariants(term) {
  const variants = new Set([term]);
  if (!term.includes(" ") && !term.endsWith("s")) {
    variants.add(`${term}s`);
  }
  return [...variants]
    .map((value) => (value.includes(" ") ? `"${value}"` : value))
    .map((value) => `abs:${value}`);
}

function buildQuery(keywords) {
  const pls = keywords.pls_terms.flatMap(arxivVariants).join(" OR ");
  const uav = keywords.uav_terms.flatMap(arxivVariants).join(" OR ");
  return `(${pls}) AND (${uav})`;
}

export async function collectArxiv({ since, keywords, config, log = () => {} }) {
  const query = buildQuery(keywords);
  log(`arXiv 查询: ${query.length} 字符`);

  const xml = await fetchText(API, {
    params: {
      search_query: query,
      start: 0,
      max_results: config.max_results ?? 300,
      sortBy: "submittedDate",
      sortOrder: "descending",
    },
    timeout: 90_000,
    accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
  });

  const doc = parser.parse(xml);
  const feed = doc.feed;
  if (!feed) throw new Error("arXiv 返回内容缺少 feed 节点");

  const entries = toArray(feed.entry);
  const papers = [];

  for (const entry of entries) {
    const title = cleanText(textOf(entry.title));
    const abstract = cleanText(textOf(entry.summary));
    const published = dateOnly(textOf(entry.published));
    if (!title || !published || published < since) continue;

    const idUrl = textOf(entry.id);
    const arxivId = idUrl.split("/abs/").pop().replace(/v\d+$/, "");
    if (!arxivId) continue;

    const links = toArray(entry.link);
    const absLink = links.find((link) => link["@_rel"] === "alternate")?.["@_href"];
    const pdfLink =
      links.find((link) => link["@_title"] === "pdf")?.["@_href"] ??
      links.find((link) => link["@_type"] === "application/pdf")?.["@_href"];

    const authors = toArray(entry.author)
      .map((author) => cleanText(textOf(author.name)))
      .filter(Boolean);

    const doi = cleanText(textOf(entry["arxiv:doi"])).toLowerCase() || undefined;
    const journalRef = cleanText(textOf(entry["arxiv:journal_ref"]));
    const publishedInJournal = Boolean(doi || journalRef);

    papers.push({
      title,
      authors,
      abstract,
      doi,
      arxivId,
      venue: journalRef || "arXiv",
      publisher: journalRef ? "" : "arXiv",
      type: publishedInJournal ? "journal-article" : "preprint",
      published,
      url: absLink || `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: pdfLink || `https://arxiv.org/pdf/${arxivId}`,
      sources: ["arxiv"],
      tags: [],
      score: 0,
    });
  }

  return papers;
}
