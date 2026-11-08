import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleChatRequest } from "../worker/src/chat.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const port = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (pathname === "/api/chat" || pathname === "/chat") {
    handleChat(request, response);
    return;
  }

  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(root, pathname.replace(/^\/+/, ""));

  if (!file.startsWith(`${root}${path.sep}`) && file !== root) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
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

    const chatRequest = new Request(`http://localhost:${port}${request.url}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? body : undefined,
      signal: abort.signal,
    });

    const result = await handleChatRequest(chatRequest, {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
      allowedOrigins: [], // 本地预览同源访问，不限制来源
      loadPapers: () => {
        const store = JSON.parse(
          fs.readFileSync(path.join(root, "data", "papers.json"), "utf8"),
        );
        return store.papers ?? [];
      },
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
      response.end(JSON.stringify({ error: "本地预览服务出错" }));
    } else {
      response.end();
    }
  }
}

server.listen(port, () => {
  console.log(`Preview: http://localhost:${port}`);
  console.log(
    process.env.DEEPSEEK_API_KEY
      ? "AI: 已设置 DEEPSEEK_API_KEY，/api/chat 可用"
      : "AI: 未设置 DEEPSEEK_API_KEY，/api/chat 会返回 503（设置后再试）",
  );
});
