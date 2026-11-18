// Semantic Scholar Graph API 补全：摘要、引用量、TLDR、OA PDF。
// 无 key 也能用（共享限流）；免费 key 申请：
// https://www.semanticscholar.org/product/api#api-key-form

import { fetchJson } from "./http.js";
import { cleanText } from "./text.js";

const API = "https://api.semanticscholar.org/graph/v1/paper/batch";
const FIELDS = "title,abstract,citationCount,openAccessPdf,tldr";
const MAX_BATCH = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function paperId(paper) {
  if (paper.doi) return `DOI:${paper.doi}`;
  if (paper.arxivId) return `ARXIV:${paper.arxivId}`;
  return "";
}

function hasAbstract(paper) {
  return Boolean(String(paper.abstract ?? "").trim());
}

function pickTldr(item) {
  if (!item?.tldr) return "";
  if (typeof item.tldr === "string") return cleanText(item.tldr);
  return cleanText(item.tldr.text);
}

/**
 * 对有 DOI / arXiv ID 的论文补全摘要、引用量、TLDR、OA PDF（原地修改）。
 * 摘要只在原本缺失时填充；引用量和 TLDR 会随每次运行更新。
 */
export async function enrichSemanticScholar(papers, { config = {}, log = () => {} } = {}) {
  if (config.enabled === false) return { queried: 0, filled: 0 };

  const targets = papers.filter((paper) => paperId(paper));
  if (targets.length === 0) {
    log("Semantic Scholar：没有可查询的论文");
    return { queried: 0, filled: 0 };
  }

  const apiKey = process.env[config.api_key_env || "S2_API_KEY"] || "";
  const batchSize = Math.max(
    1,
    Math.min(Number(config.batch_size) || MAX_BATCH, MAX_BATCH),
  );
  let queried = 0;
  let filled = 0;
  let citations = 0;
  let tldrs = 0;

  for (let start = 0; start < targets.length; start += batchSize) {
    const chunk = targets.slice(start, start + batchSize);
    const ids = chunk.map(paperId);

    try {
      const results = await fetchJson(`${API}?fields=${FIELDS}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({ ids }),
        timeout: 60_000,
        // S2 无 key 时共享池经常 429；多给几次指数退避的机会。
        retries: Number(config.retries) || 4,
      });

      if (!Array.isArray(results)) {
        throw new Error("返回结构不是数组");
      }

      queried += chunk.length;
      results.forEach((item, index) => {
        if (!item) return;
        const paper = chunk[index];

        if (item.citationCount != null && Number.isFinite(Number(item.citationCount))) {
          paper.citationCount = Number(item.citationCount);
          citations += 1;
        }

        const tldr = pickTldr(item);
        if (tldr) {
          paper.tldr = tldr;
          tldrs += 1;
        }

        const oaPdf = String(item.openAccessPdf?.url || "").trim();
        if (oaPdf) paper.oaPdfUrl = oaPdf;

        if (hasAbstract(paper)) return;
        const abstract = cleanText(item.abstract);
        if (!abstract) return;
        paper.abstract = abstract;
        filled += 1;
      });
    } catch (error) {
      // 整批 ID 都未被 S2 收录时返回 400；跳过该批，不要影响后续批次。
      if (error.status === 400 && /no valid paper ids/i.test(error.message)) {
        log(`Semantic Scholar：本批 ${chunk.length} 篇均未收录，跳过`);
      } else {
        log(`Semantic Scholar 补全失败：${error.message}`);
        break;
      }
    }

    if (start + batchSize < targets.length) await sleep(1100);
  }

  log(
    `Semantic Scholar：查询 ${queried} 篇，补摘要 ${filled} 篇，`
      + `引用 ${citations} 篇，TLDR ${tldrs} 篇`,
  );
  return { queried, filled, citations, tldrs };
}

// 兼容旧调用名
export const enrichAbstracts = enrichSemanticScholar;
