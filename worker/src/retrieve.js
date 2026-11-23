// 轻量论文检索：在调用大模型前挑出最相关的论文，降低 token 消耗。
// 使用英文词 + 中文二元组的 BM25，只依赖 Web 标准 API。

const MAX_SELECTED = 16;
const K1 = 1.2;
const B = 0.75;
const MAX_INDEXED_ABSTRACT = 1200;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their",
  "this", "to", "was", "were", "which", "with", "using", "used", "based", "via",
]);

// 论文对象在 FC/Worker 的内存缓存里会复用，分词结果可以按对象缓存。
const PAPER_INDEX = new WeakMap();

/**
 * 返回 [{ paper, n }]，n 是该论文在页面数组中的原始编号（从 1 开始）。
 * 保留原始编号，前端才能继续把 [n] 定位到正确的卡片。
 */
export function selectRelevantPapers(
  papers,
  question,
  filters = null,
  { today = utcToday(), extraText = "" } = {},
) {
  if (!Array.isArray(papers) || papers.length === 0) return [];

  const all = papers.map((paper, index) => ({ paper, n: index + 1 }));
  const filtered = all.filter(({ paper }) => matchesFilters(paper, filters, today));
  const candidates = filtered.length > 0 ? filtered : all;

  const latestIntent = /最新|最近|新论文|latest|newest|recent/i.test(question);
  const citationIntent = /引用|高引|cited|citation|influential/i.test(question);
  const queryTokens = [
    ...new Set(tokenize([question, filters?.tag, filters?.q, extraText].filter(Boolean).join(" "))),
  ];

  const docs = candidates.map(({ paper, n }) => ({ paper, n, ...indexedPaper(paper) }));

  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const documentFrequency = new Map();
  for (const doc of docs) {
    for (const token of new Set(doc.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const scored = docs.map((doc) => {
    let score = 0;
    for (const token of queryTokens) {
      const tf = doc.tf.get(token) || 0;
      if (tf === 0) continue;
      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (doc.length / avgLength)));
    }

    const paper = doc.paper;
    if (filters?.tag && filters.tag !== "all" && (paper.tags || []).includes(filters.tag)) {
      score += 2;
    }

    if (latestIntent) {
      const age = daysBetween(paper.firstSeen || paper.published || "", today);
      if (age >= 0 && age <= 7) score += 3;
      else if (age >= 0 && age <= 30) score += 1.5;
    }

    if (citationIntent) {
      score += Math.log1p(Number(paper.citationCount) || 0) * 0.8;
    }

    return { ...doc, score };
  });

  const best = scored.reduce((max, item) => Math.max(max, item.score), 0);
  if (best <= 0) {
    scored.sort((a, b) => {
      if (latestIntent) {
        return (b.paper.firstSeen || "").localeCompare(a.paper.firstSeen || "");
      }
      if (citationIntent) {
        return (Number(b.paper.citationCount) || 0) - (Number(a.paper.citationCount) || 0);
      }
      return (b.paper.score || 0) - (a.paper.score || 0)
        || (b.paper.firstSeen || "").localeCompare(a.paper.firstSeen || "");
    });
  } else {
    scored.sort((a, b) => b.score - a.score
      || (Number(b.paper.citationCount) || 0) - (Number(a.paper.citationCount) || 0));
  }

  const selected = scored.slice(0, MAX_SELECTED).map(({ paper, n }) => ({ paper, n }));
  const seen = new Set(selected.map((item) => item.n));

  // 用户或历史消息里明确引用过的 [n]，即使不在前 16 篇也要带上。
  for (const n of mentionedIndices(`${question}\n${extraText}`, papers.length)) {
    if (seen.has(n)) continue;
    selected.push({ paper: papers[n - 1], n });
    seen.add(n);
  }

  return selected;
}

function indexedPaper(paper) {
  const cached = PAPER_INDEX.get(paper);
  if (cached) return cached;

  const tokens = tokenize(paperText(paper));
  const tf = new Map();
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
  const indexed = { tokens, tf, length: tokens.length };
  PAPER_INDEX.set(paper, indexed);
  return indexed;
}

function paperText(paper) {
  const title = String(paper.title || "");
  const tags = (paper.tags || []).join(" ");
  const abstract = String(paper.abstract || "").slice(0, MAX_INDEXED_ABSTRACT);
  const summary = String(paper.summaryZh || "");
  const tldr = String(paper.tldr || "");
  return [
    title, title, title,
    tags, tags,
    summary, summary,
    tldr, tldr,
    abstract,
    paper.venue,
    paper.publisher,
    (paper.authors || []).join(" "),
  ].filter(Boolean).join(" ");
}

function tokenize(input) {
  const text = String(input || "").toLowerCase();
  const tokens = [];
  for (const match of text.matchAll(/[a-z0-9]+|[一-鿿]+/g)) {
    const part = match[0];
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length > 1 && !STOPWORDS.has(part)) tokens.push(part);
      continue;
    }
    if (part.length === 1) {
      tokens.push(part);
      continue;
    }
    for (let index = 0; index < part.length - 1; index += 1) {
      tokens.push(part.slice(index, index + 2));
    }
  }
  return tokens;
}

function matchesFilters(paper, filters, today) {
  if (!filters || typeof filters !== "object") return true;

  if (filters.from && paper.firstSeen < filters.from) return false;
  if (filters.to && paper.firstSeen > filters.to) return false;
  if (filters.period === "today" && paper.firstSeen !== today) return false;
  if (filters.period === "7d" && !(paper.firstSeen >= addDays(today, -6))) return false;
  if (filters.period === "30d" && !(paper.firstSeen >= addDays(today, -29))) return false;
  if (filters.type && filters.type !== "all" && paper.type !== filters.type) return false;
  if (filters.month && filters.month !== "all" && !(paper.published || "").startsWith(filters.month)) {
    return false;
  }
  if (filters.tag && filters.tag !== "all" && !(paper.tags || []).includes(filters.tag)) {
    return false;
  }
  if (filters.source === "ieee" && !isIeeePaper(paper)) return false;
  if (filters.source === "other" && isIeeePaper(paper)) return false;

  if (filters.q) {
    const haystack = [
      paper.title,
      (paper.authors || []).join(" "),
      paper.abstract,
      paper.summaryZh,
      paper.tldr,
      paper.venue,
      paper.publisher,
      paper.doi,
      paper.arxivId,
      (paper.tags || []).join(" "),
    ].join(" ").toLowerCase();
    const terms = String(filters.q).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) return false;
  }

  return true;
}

function isIeeePaper(paper) {
  const doi = String(paper.doi || "").toLowerCase();
  return (paper.sources || []).includes("ieee")
    || doi.startsWith("10.1109/")
    || /\bieee\b/i.test(paper.publisher || "")
    || /\bieee\b/i.test(paper.venue || "");
}

function mentionedIndices(text, total) {
  const out = new Set();
  for (const match of String(text || "").matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && n <= total) out.add(n);
  }
  return out;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, today) {
  if (!from) return -1;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return -1;
  return Math.round((end - start) / 86400000);
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}
