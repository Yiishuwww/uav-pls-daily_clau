// 中文一句话摘要：智谱 GLM-4-Flash（免费模型，OpenAI 兼容接口）。
// 申请 key：https://open.bigmodel.cn/ → API 密钥
// 未配置 GLM_API_KEY 时自动跳过，不影响其他流程。

import { fetchJson } from "./http.js";
import { cleanText } from "./text.js";

const DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4-flash";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 给入选论文生成中文 1–2 句摘要（原地修改 summaryZh）。
 * 只处理没有 summaryZh、且有摘要的论文。
 */
export async function enrichChineseSummaries(papers, { config = {}, log = () => {} } = {}) {
  if (config.enabled === false) return { queried: 0, filled: 0 };

  const keyEnv = config.api_key_env || "GLM_API_KEY";
  const apiKey = process.env[keyEnv] || "";
  if (!apiKey) {
    log("中文摘要：未配置 GLM_API_KEY，跳过");
    return { queried: 0, filled: 0 };
  }

  const targets = papers.filter(
    (paper) => !paper.summaryZh && paper.abstract && paper.title,
  );
  if (targets.length === 0) {
    log("中文摘要：没有需要生成的论文");
    return { queried: 0, filled: 0 };
  }

  const maxPapers = Math.max(
    1,
    Math.min(Number(config.max_papers) || 50, 100),
  );
  const batch = targets.slice(0, maxPapers);
  const baseUrl = (config.base_url || DEFAULT_BASE).replace(/\/+$/, "");
  const model = config.model || DEFAULT_MODEL;

  let queried = 0;
  let filled = 0;
  let failures = 0;

  for (const paper of batch) {
    queried += 1;
    try {
      const data = await fetchJson(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "你是学术文献助手。请用中文概括论文，严格按以下格式输出 2-3 行：\n"
                + "研究问题：...\n方法：...\n主要结论：...\n"
                + "没有的信息可以省略；不要编造，不要使用 Markdown，不要重复标题。",
            },
            {
              role: "user",
              content:
                `标题：${paper.title}\n`
                + `摘要：${String(paper.abstract).slice(0, 1500)}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 220,
        }),
        timeout: 60_000,
        retries: 2,
      });

      const text = cleanText(data.choices?.[0]?.message?.content || "");
      if (text) {
        paper.summaryZh = text;
        filled += 1;
        failures = 0;
      }
    } catch (error) {
      failures += 1;
      log(`中文摘要生成失败：${String(paper.title).slice(0, 40)}：${error.message}`);
      if (failures >= 3) {
        log("中文摘要连续失败 3 次，停止本次生成");
        break;
      }
    }

    if (queried < batch.length) await sleep(300);
  }

  log(`中文摘要：生成 ${filled}/${queried} 篇`);
  return { queried, filled };
}
