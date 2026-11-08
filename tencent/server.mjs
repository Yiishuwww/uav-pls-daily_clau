// 腾讯云 SCF Web 函数入口：监听 9000 端口，提供 /health 和 /api/chat。
// 复用 worker/src/chat.js 里的请求处理与 DeepSeek 流式转发逻辑。
//
// 部署包由 `npm run build:tencent` 生成到 dist/tencent/。

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { fileURLToPath } from "node:url";

import { handleChatRequest } from "./worker/src/chat.js";

// 腾讯云机器访问 GitHub Pages 时优先走 IPv4，避免 IPv6 不通导致超时。
dns.setDefaultResultOrder("ipv4first");

const here = path.dirname(fileURLToPath(import.meta.url));
const bundledPapersPath = path.join(here, "papers.json");
const port = Number(process.env.PORT || 9000);
const host = "0.0.0.0";

const PAPERS_URL =
  process.env.PAPERS_URL ||
  "https://yiishuwww.github.io/uav-pls-daily_clau/data/papers.json";
const PAPERS_CACHE_MS = 10 * 60 * 1000;

const allowedOrigins = String(
  process.env.ALLOWED_ORIGINS ||
    "https://yiishuwww.github.io,http://localhost:3000,http://127.0.0.1:3000",
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function readBundledPapers() {
  try {
    const data = JSON.parse(fs.readFileSync(bundledPapersPath, "utf8"));
    return Array.isArray(data) ? data : data.papers ?? [];
  } catch (error) {
    console.error("[papers] 读取内置数据失败:", error?.message || error);
    return [];
  }
}

// 启动时立即载入内置论文，保证第一次请求不用等远程拉取；
// 后台再尝试从 GitHub Pages 更新，成功后替换缓存。
let papersCache = { at: 0, papers: readBundledPapers(), refreshing: false };
let lastRefreshAttempt = 0;

function refreshPapers() {
  if (papersCache.refreshing) return;
  if (Date.now() - lastRefreshAttempt < PAPERS_CACHE_MS) return;

  papersCache.refreshing = true;
  lastRefreshAttempt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  fetch(PAPERS_URL, {
    signal: controller.signal,
    headers: { "User-Agent": "uav-pls-chat-tencent" },
  })
    .then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data?.papers) && data.papers.length > 0) {
        papersCache = { at: Date.now(), papers: data.papers, refreshing: false };
        console.log(`[papers] 已从远程更新 ${data.papers.length} 篇`);
      }
    })
    .catch((error) => {
      console.error("[papers] 远程更新失败，继续使用内置数据:", error?.message || error);
    })
    .finally(() => {
      clearTimeout(timer);
      papersCache.refreshing = false;
    });
}

async function loadPapers() {
  if (Date.now() - papersCache.at > PAPERS_CACHE_MS) {
    refreshPapers();
  }
  return papersCache.papers;
}

const server = http.createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  if (pathname === "/" || pathname === "/health" || pathname.endsWith("/health")) {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      JSON.stringify({
        ok: true,
        service: "uav-pls-chat-tencent",
        configured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        papers: papersCache.papers?.length ?? "not-loaded",
      }),
    );
    return;
  }

  if (pathname === "/api/chat" || pathname.endsWith("/api/chat")) {
    await handleChat(request, response);
    return;
  }

  response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

async function handleChat(request, response) {
  const abort = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) abort.abort();
  });

  try {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024) {
        response.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "请求体过大" }));
        return;
      }
      chunks.push(chunk);
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const headers = {};
    for (const key of ["content-type", "origin", "accept", "user-agent"]) {
      const value = request.headers[key];
      if (value) headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    const chatRequest = new Request(`http://localhost${request.url}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? body : undefined,
      signal: abort.signal,
    });

    const result = await handleChatRequest(chatRequest, {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      allowedOrigins,
      loadPapers,
    });

    const responseHeaders = {};
    for (const [key, value] of result.headers) {
      responseHeaders[key] = value;
    }
    response.writeHead(result.status, responseHeaders);

    if (!result.body) {
      response.end(await result.text());
      return;
    }

    const reader = result.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      response.write(value);
    }
    response.end();
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error("[chat]", error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "AI 服务出错" }));
    } else {
      response.end();
    }
  }
}

server.listen(port, host, () => {
  console.log(`uav-pls-chat-tencent listening on ${host}:${port}`);
  console.log(
    process.env.DEEPSEEK_API_KEY
      ? "AI: DEEPSEEK_API_KEY 已配置"
      : "AI: 未配置 DEEPSEEK_API_KEY，/api/chat 会返回 503",
  );
});
