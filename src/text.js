// 文本清洗、归一化、检索词匹配与日期工具

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input) {
  return String(input ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const isHex = code[1]?.toLowerCase() === "x";
      const value = isHex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** 去标签、解实体、压缩空白。用于标题、摘要、期刊名。 */
export function cleanText(input) {
  if (input == null) return "";
  let s = String(input);
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** 匹配专用归一化：小写、连字符变空格、去标点。 */
export function normalize(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/&/g, " and ")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 生成带词边界的检索词正则（容忍简单复数）。 */
export function termRegex(term) {
  const t = normalize(term);
  if (!t) return null;
  const body = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${body}(?:s|es)?(?![a-z0-9])`, "g");
}

/** 统计归一化文本中某检索词出现次数。 */
export function countTerm(normalizedText, term) {
  const re = termRegex(term);
  if (!re) return 0;
  return (normalizedText.match(re) || []).length;
}

/** 返回某检索词在归一化文本中的所有起始位置。 */
export function termPositions(normalizedText, term) {
  const re = termRegex(term);
  if (!re) return [];
  const positions = [];
  let match;
  while ((match = re.exec(normalizedText)) !== null) {
    positions.push(match.index);
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return positions;
}

/** 标题去重键：去掉开头冠词，保留归一化文本。 */
export function titleKey(title) {
  return normalize(title).replace(/^(a|an|the) /, "");
}

export function shortHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 北京时间当天 YYYY-MM-DD。 */
export function cnToday(now = new Date()) {
  return new Date(now.getTime() + CN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 北京时间 YYYY-MM-DD HH:mm。 */
export function cnNow(now = new Date()) {
  return new Date(now.getTime() + CN_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

/** 带 +08:00 的 ISO 时间戳。 */
export function cnNowIso(now = new Date()) {
  return `${new Date(now.getTime() + CN_OFFSET_MS).toISOString().slice(0, 19)}+08:00`;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 从任意日期字符串中提取 YYYY-MM-DD。 */
export function dateOnly(value) {
  if (!value) return "";
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
