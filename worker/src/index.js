// Cloudflare Worker 入口：/api/chat 代理 DeepSeek，并附带健康检查。

import { handleChatRequest } from "./chat.js";

const DEFAULT_PAPERS_URL =
  "https://yiishuwww.github.io/uav-pls-daily_clau/data/papers.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "uav-pls-chat",
        configured: Boolean(env.DEEPSEEK_API_KEY),
        model: env.DEEPSEEK_MODEL || "deepseek-chat",
      });
    }

    if (url.pathname !== "/api/chat" && url.pathname !== "/chat") {
      return new Response("Not found", { status: 404 });
    }

    return handleChatRequest(request, {
      apiKey: env.DEEPSEEK_API_KEY,
      model: env.DEEPSEEK_MODEL || "deepseek-chat",
      baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
      loadPapers: () => loadPapers(env),
    });
  },
};

async function loadPapers(env) {
  const papersUrl = env.PAPERS_URL || DEFAULT_PAPERS_URL;

  const response = await fetch(papersUrl, {
    cf: { cacheTtl: 600, cacheEverything: true },
    headers: { "User-Agent": "uav-pls-chat-worker" },
  });

  if (!response.ok) {
    throw new Error(`papers.json 请求失败: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.papers)) {
    throw new Error("papers.json 格式不正确");
  }

  return data.papers;
}

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
