// Springer Nature Meta API 摘要补全：只按 DOI 查询，不做全文检索。
// Basic 免费 key 不支持字段限制和日期筛选，但 DOI 简单查询可用。

import { fetchJson } from "./http.js";
import { cleanText } from "./text.js";

const API = "https://api.springernature.com/meta/v2/json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pickDoi(record) {
  return String(record.doi || record.identifier || "")
    .toLowerCase()
    .replace(/^doi:/, "")
    .replace(/^https?:\/\/doi\.org\//, "")
    .trim();
}

function pickAbstract(record) {
  if (typeof record.abstract === "string") return cleanText(record.abstract);
  if (record.abstract?.text) return cleanText(record.abstract.text);
  return "";
}

function pickAuthors(record) {
  const creators = Array.isArray(record.creators) ? record.creators : [];
  return creators
    .map((creator) => cleanText(creator?.creator ?? creator?.name ?? creator))
    .filter(Boolean);
}

function pickVenue(record) {
  return cleanText(record.publicationName) || cleanText(record.bookTitle);
}

function isSpringerPaper(paper) {
  const doi = String(paper.doi || "").toLowerCase();
  if (
    doi.startsWith("10.1007/")
    || doi.startsWith("10.1038/")
    || doi.startsWith("10.1186/")
  ) {
    return true;
  }
  return /springer|nature portfolio|biomed central/i.test(
    `${paper.publisher || ""} ${paper.venue || ""}`,
  );
}

/**
 * 给缺摘要的 Springer / Nature 论文按 DOI 补摘要（原地修改）。
 * 只处理已有 DOI 的论文；失败时记录日志并继续。
 */
export async function enrichSpringer(papers, { config = {}, log = () => {} } = {}) {
  if (config.enabled === false) return { queried: 0, filled: 0 };

  const keyEnv = config.api_key_env || "SPRINGER_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  if (!apiKey) {
    log("Springer 摘要补全：未配置 key，跳过");
    return { queried: 0, filled: 0 };
  }

  const targets = papers.filter(
    (paper) => !String(paper.abstract || "").trim() && paper.doi && isSpringerPaper(paper),
  );
  if (targets.length === 0) {
    log("Springer 摘要补全：没有需要补的论文");
    return { queried: 0, filled: 0 };
  }

  const maxPapers = Math.max(
    1,
    Math.min(Number(config.max_papers) || 20, 50),
  );
  const batch = targets.slice(0, maxPapers);
  let queried = 0;
  let filled = 0;

  for (const paper of batch) {
    queried += 1;
    try {
      const data = await fetchJson(API, {
        params: {
          q: paper.doi,
          api_key: apiKey,
          s: 1,
          p: 3,
        },
        timeout: 60_000,
        retries: 2,
      });

      if (!Array.isArray(data.records)) {
        log(`Springer 补摘要返回异常：${data.apiMessage || "缺少 records"}`);
        continue;
      }

      const match = data.records.find(
        (record) => pickDoi(record) === String(paper.doi).toLowerCase(),
      );
      if (!match) {
        log(`Springer 未找到 DOI：${paper.doi}`);
        continue;
      }

      const abstract = pickAbstract(match);
      if (!abstract) {
        log(`Springer 记录没有摘要：${paper.doi}`);
        continue;
      }

      paper.abstract = abstract;
      if (!paper.authors?.length) {
        const authors = pickAuthors(match);
        if (authors.length) paper.authors = authors;
      }
      if (!paper.venue) {
        const venue = pickVenue(match);
        if (venue) paper.venue = venue;
      }
      if (!paper.publisher) paper.publisher = "Springer Nature";
      paper.sources = [...new Set([...(paper.sources ?? []), "springer"])];
      filled += 1;
    } catch (error) {
      log(`Springer 补摘要失败 ${paper.doi}：${error.message}`);
    }

    if (queried < batch.length) await sleep(700);
  }

  log(`Springer 摘要补全：查询 ${queried} 篇，补全 ${filled} 篇`);
  return { queried, filled };
}
