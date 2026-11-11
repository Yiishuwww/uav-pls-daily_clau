// BibTeX 生成：供服务端写 docs/data/papers.bib 使用。
// 前端 src/static/app.js 内有一份等价实现，改格式时两边要保持一致。

const BIB_ESCAPES = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  "$": "\\$",
  "#": "\\#",
  "_": "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeBib(value) {
  return String(value ?? "").replace(/[\\&%$#_{}~^]/g, (char) => BIB_ESCAPES[char]);
}

export function bibKey(paper) {
  const firstAuthor =
    String(paper.authors?.[0] || "")
      .split(/\s+/)
      .filter(Boolean)
      .pop() || "paper";
  const year = String(paper.published || "").slice(0, 4) || "0000";
  const word =
    String(paper.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .find((item) => item.length > 2) || "untitled";
  return `${firstAuthor}${year}${word}`.replace(/[^a-zA-Z0-9]/g, "");
}

export function paperToBibtex(paper, key = bibKey(paper)) {
  const type =
    paper.type === "journal-article"
      ? "article"
      : paper.type === "conference"
        ? "inproceedings"
        : "misc";

  const fields = [];
  fields.push(["title", escapeBib(paper.title)]);
  if (paper.authors?.length) {
    fields.push(["author", paper.authors.map(escapeBib).join(" and ")]);
  }

  const year = String(paper.published || "").slice(0, 4);
  if (year) fields.push(["year", year]);

  if (paper.venue) {
    const field =
      type === "article" ? "journal" : type === "inproceedings" ? "booktitle" : "howpublished";
    fields.push([field, escapeBib(paper.venue)]);
  }

  if (paper.publisher && paper.publisher !== paper.venue) {
    fields.push(["publisher", escapeBib(paper.publisher)]);
  }

  if (paper.doi) fields.push(["doi", paper.doi]);
  if (paper.url) fields.push(["url", paper.url]);
  if (paper.arxivId) {
    fields.push(["eprint", paper.arxivId]);
    fields.push(["archivePrefix", "arXiv"]);
  }
  if (paper.tags?.length) {
    fields.push(["keywords", paper.tags.map(escapeBib).join(", ")]);
  }

  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
  return `@${type}{${key},\n${body}\n}`;
}

export function papersToBibtex(papers) {
  const used = new Map();
  const entries = [];
  for (const paper of papers) {
    const base = bibKey(paper);
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    const key = count === 0 ? base : `${base}${String.fromCharCode(96 + count)}`;
    entries.push(paperToBibtex(paper, key));
  }
  return `${entries.join("\n\n")}\n`;
}
