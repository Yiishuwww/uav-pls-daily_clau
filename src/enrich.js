// Semantic Scholar Graph API 摘要补全（按 DOI / arXiv ID 批量查询）。
// 无 key 也能用（共享限流）；免费 key 申请：
// https://www.semanticscholar.org/product/api#api-key-form

import { fetchJson } from "./http.js";
import { cleanText } from "./text.js";

const API = "https://api.semanticscholar.org/graph/v1/paper/batch";
const FIELDS = "title,abstract";
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

/**
 * 给缺少摘要的论文补全 abstract（原地修改）。
 * 只处理有 DOI 或 arXiv ID 的论文；失败时记录日志并继续。
 */
export async function enrichAbstracts(papers, { config = {}, log = () => {} } = {}) {
  if (config.enabled === false) return { queried: 0, filled: 0 };

  const targets = papers.filter((paper) => !hasAbstract(paper) && paperId(paper));
  if (targets.length === 0) {
    log("Semantic Scholar：没有需要补摘要的论文");
    return { queried: 0, filled: 0 };
  }

  const apiKey = process.env[config.api_key_env || "S2_API_KEY"] || "";
  const batchSize = Math.max(
    1,
    Math.min(Number(config.batch_size) || MAX_BATCH, MAX_BATCH),
  );
  let queried = 0;
  let filled = 0;

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
        if (!item || hasAbstract(chunk[index])) return;
        const abstract = cleanText(item.abstract);
        if (!abstract) return;
        chunk[index].abstract = abstract;
        filled += 1;
      });
    } catch (error) {
      log(`Semantic Scholar 补摘要失败：${error.message}`);
      break;
    }

    if (start + batchSize < targets.length) await sleep(1100);
  }

  log(`Semantic Scholar 补摘要：查询 ${queried} 篇，补全 ${filled} 篇`);
  return { queried, filled };
}
