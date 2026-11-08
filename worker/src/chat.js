// DeepSeek 对话请求处理：Cloudflare Worker 与本地预览服务器共用。
// 只依赖 Web 标准 API（Request / Response / fetch / ReadableStream），不依赖 Node 专有模块。

import { buildSystemPrompt, buildUserContent } from "./prompt.js";

const MAX_QUESTION_CHARS = 1000;
const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 6000;
const MAX_HISTORY_ITEM_CHARS = 2000;
const MAX_OUTPUT_TOKENS = 1200;
const UPSTREAM_TIMEOUT_MS = 120000;

const FILTER_KEYS = ["period", "q", "tag", "type", "month", "sort"];

/**
 * 处理一次 /api/chat 请求。
 *
 * options:
 *   apiKey          DeepSeek API Key
 *   model           模型名，默认 deepseek-chat
 *   baseUrl         API 根地址，默认 https://api.deepseek.com
 *   allowedOrigins  允许的浏览器 Origin 列表；为空表示不校验
 *   loadPapers      () => Promise<Array>，返回论文数组
 */
export async function handleChatRequest(request, options = {}) {
  const {
    apiKey,
    model = "deepseek-chat",
    baseUrl = "https://api.deepseek.com",
    allowedOrigins = [],
    loadPapers,
  } = options;

  const origin = request.headers.get("origin") || "";
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "只支持 POST 请求" }, 405, cors);
  }

  if (allowedOrigins.length > 0 && origin && !allowedOrigins.includes(origin)) {
    return jsonResponse({ error: "请求来源不被允许" }, 403, cors);
  }

  if (!apiKey) {
    return jsonResponse({ error: "AI 服务未配置 API 密钥" }, 503, cors);
  }

  if (typeof loadPapers !== "function") {
    return jsonResponse({ error: "AI 服务配置错误" }, 500, cors);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "请求体不是合法 JSON" }, 400, cors);
  }

  const question = typeof payload?.question === "string" ? payload.question.trim() : "";
  if (!question) {
    return jsonResponse({ error: "问题不能为空" }, 400, cors);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return jsonResponse({ error: `问题不能超过 ${MAX_QUESTION_CHARS} 个字符` }, 400, cors);
  }

  const history = normalizeHistory(payload?.history);
  const filters = normalizeFilters(payload?.filters);

  let papers;
  try {
    papers = await loadPapers();
  } catch (error) {
    console.error("[chat] 读取论文库失败:", error?.message || error);
    return jsonResponse({ error: "论文库读取失败，请稍后再试" }, 502, cors);
  }
  if (!Array.isArray(papers) || papers.length === 0) {
    return jsonResponse({ error: "论文库为空，暂时无法回答" }, 503, cors);
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = buildSystemPrompt({ papers, today });
  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: buildUserContent(question, filters) },
  ];

  const upstreamAbort = new AbortController();
  let timer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_TIMEOUT_MS);
  const onClientAbort = () => upstreamAbort.abort();
  request.signal?.addEventListener("abort", onClientAbort, { once: true });

  const cleanup = () => {
    clearTimeout(timer);
    timer = null;
    request.signal?.removeEventListener("abort", onClientAbort);
  };

  let upstream;
  try {
    upstream = await fetchDeepSeek({
      apiKey,
      model,
      baseUrl,
      messages,
      signal: upstreamAbort.signal,
    });
  } catch (error) {
    cleanup();
    console.error("[chat] 请求 DeepSeek 失败:", error?.message || error);
    return jsonResponse({ error: "无法连接 AI 服务，请稍后再试" }, 502, cors);
  }

  if (!upstream.ok) {
    cleanup();
    const detail = await readErrorBody(upstream);
    console.error("[chat] DeepSeek 返回错误:", upstream.status, detail.slice(0, 500));

    const message =
      upstream.status === 401 || upstream.status === 403
        ? "AI 服务密钥无效或没有权限"
        : upstream.status === 402
          ? "AI 服务账户余额不足"
          : upstream.status === 429
            ? "请求太频繁，请稍后再试"
            : `AI 服务暂时不可用（${upstream.status}）`;
    return jsonResponse({ error: message }, upstream.status === 429 ? 429 : 502, cors);
  }

  if (!upstream.body) {
    cleanup();
    return jsonResponse({ error: "AI 服务没有返回内容" }, 502, cors);
  }

  const contentType = upstream.headers.get("content-type") || "";

  // 某些兼容网关不返回流式 SSE，而是直接返回 JSON；这里一并兼容。
  if (contentType.includes("application/json")) {
    cleanup();
    try {
      const data = await upstream.json();
      const answer = extractAnswer(data);
      if (!answer) {
        return jsonResponse({ error: "AI 没有返回内容" }, 502, cors);
      }
      return jsonResponse({ answer }, 200, cors);
    } catch {
      return jsonResponse({ error: "AI 返回内容格式异常" }, 502, cors);
    }
  }

  const stream = toSseStream(upstream.body, cleanup);

  return new Response(stream, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function fetchDeepSeek({ apiKey, model, baseUrl, messages, signal }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    messages,
    stream: true,
    max_tokens: MAX_OUTPUT_TOKENS,
  };

  // deepseek-reasoner 不支持 temperature 等采样参数。
  if (!String(model).includes("reasoner")) {
    body.temperature = 0.3;
  }

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
}

function toSseStream(body, cleanup) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let closed = false;

  return new ReadableStream({
    async start(controller) {
      const emit = (event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).replace(/\r$/, "").trim();
            buffer = buffer.slice(index + 1);

            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;

            if (data === "[DONE]") {
              emit({ done: true });
              closed = true;
              controller.close();
              return;
            }

            let chunk;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }

            const text = chunk?.choices?.[0]?.delta?.content;
            if (typeof text === "string" && text) {
              emit({ text });
            }
          }
        }

        if (!closed) {
          emit({ done: true });
          closed = true;
        }
        controller.close();
      } catch (error) {
        console.error("[chat] 流式转发中断:", error?.message || error);
        if (!closed) {
          closed = true;
          try {
            emit({ error: "回答生成中断，请重试" });
          } catch {
            // 客户端已断开时 enqueue 会抛错，忽略即可。
          }
        }
        try {
          controller.close();
        } catch {
          // 已关闭。
        }
      } finally {
        cleanup();
      }
    },

    cancel(reason) {
      closed = true;
      cleanup();
      return reader.cancel(reason);
    },
  });
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];

  const items = [];
  let total = 0;

  for (const item of input) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) continue;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;

    const clipped = content.slice(0, MAX_HISTORY_ITEM_CHARS);
    items.push({ role: item.role, content: clipped });
    total += clipped.length;
  }

  while (items.length > 0 && items[0].role !== "user") {
    total -= items.shift().content.length;
  }

  while (items.length > MAX_HISTORY_MESSAGES || total > MAX_HISTORY_CHARS) {
    const removed = items.shift();
    total -= removed.content.length;
  }

  while (items.length > 0 && items[0].role !== "user") {
    total -= items.shift().content.length;
  }

  return items;
}

function normalizeFilters(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};

  for (const key of FILTER_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, 80);
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (origin && Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return "";
  }
}

function extractAnswer(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}
