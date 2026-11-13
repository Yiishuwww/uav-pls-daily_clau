// 阿里云 FC / 腾讯云 SCF 的 Web Push 接口。
// 订阅保存在 GitHub secret Gist（免费），VAPID 发送使用 @pushforge/builder。
//
// 需要的环境变量：
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK, VAPID_SUBJECT
//   PUSH_SEND_SECRET
//   GITHUB_GIST_ID, GITHUB_TOKEN（Gist 读写权限）

import { webcrypto } from "node:crypto";
import { buildPushHTTPRequest } from "@pushforge/builder";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const GIST_FILE = "subscriptions.json";
const MAX_BODY = 64 * 1024;
const MAX_SUBSCRIPTIONS = 1000;

export async function handlePushHttp(request, response, { allowedOrigins = [] } = {}) {
  const url = new URL(request.url, "http://localhost");
  const pushIndex = url.pathname.indexOf("/api/push/");
  // 兼容 FC 2.0 的 /2016-08-15/proxy/... 前缀
  const pathname = pushIndex >= 0 ? url.pathname.slice(pushIndex) : url.pathname;
  const origin = request.headers.origin || "";
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === "OPTIONS") {
    response.writeHead(204, cors);
    response.end();
    return;
  }

  try {
    switch (pathname) {
      case "/api/push/vapid-public-key":
        sendJson(response, 200, { publicKey: process.env.VAPID_PUBLIC_KEY || "" }, cors);
        return;
      case "/api/push/subscribe":
        await handleSubscribe(request, response, origin, allowedOrigins, cors);
        return;
      case "/api/push/unsubscribe":
        await handleUnsubscribe(request, response, origin, allowedOrigins, cors);
        return;
      case "/api/push/send":
        await handleSend(request, response, cors);
        return;
      case "/api/push/status":
        await handleStatus(response, cors);
        return;
      default:
        sendJson(response, 404, { error: "Not found" }, cors);
    }
  } catch (error) {
    const status = Number(error?.status) || 500;
    sendJson(response, status, { error: error?.message || String(error) }, cors);
  }
}

async function handleSubscribe(request, response, origin, allowedOrigins, cors) {
  if (!originAllowed(origin, allowedOrigins)) {
    sendJson(response, 403, { error: "Origin not allowed" }, cors);
    return;
  }
  if (!gistConfigured()) {
    sendJson(response, 503, { error: "未配置 GITHUB_GIST_ID / GITHUB_TOKEN" }, cors);
    return;
  }

  const body = await readJson(request);
  const subscription = normalizeSubscription(body);
  if (!subscription) {
    sendJson(response, 400, { error: "订阅格式不正确" }, cors);
    return;
  }

  const list = await readSubscriptions();
  const index = list.findIndex((item) => item.endpoint === subscription.endpoint);
  if (index >= 0) list[index] = subscription;
  else list.push(subscription);

  if (list.length > MAX_SUBSCRIPTIONS) {
    sendJson(response, 429, { error: "订阅数已达上限" }, cors);
    return;
  }

  await writeSubscriptions(list);
  sendJson(response, 200, { ok: true, count: list.length }, cors);
}

async function handleUnsubscribe(request, response, origin, allowedOrigins, cors) {
  if (!originAllowed(origin, allowedOrigins)) {
    sendJson(response, 403, { error: "Origin not allowed" }, cors);
    return;
  }
  if (!gistConfigured()) {
    sendJson(response, 200, { ok: true, count: 0 }, cors);
    return;
  }

  const body = await readJson(request);
  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) {
    sendJson(response, 400, { error: "缺少 endpoint" }, cors);
    return;
  }

  const list = await readSubscriptions();
  const next = list.filter((item) => item.endpoint !== endpoint);
  if (next.length !== list.length) await writeSubscriptions(next);
  sendJson(response, 200, { ok: true, count: next.length }, cors);
}

async function handleSend(request, response, cors) {
  const secret = process.env.PUSH_SEND_SECRET || "";
  const authorization = request.headers.authorization || "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    sendJson(response, 401, { error: "Unauthorized" }, cors);
    return;
  }
  if (!process.env.VAPID_PRIVATE_JWK || !process.env.VAPID_SUBJECT) {
    sendJson(response, 503, { error: "VAPID 未配置" }, cors);
    return;
  }
  if (!gistConfigured()) {
    sendJson(response, 503, { error: "未配置 GITHUB_GIST_ID / GITHUB_TOKEN" }, cors);
    return;
  }

  const body = await readJson(request);
  const title = String(body?.title || "UAV PLS 论文日报").slice(0, 120);
  const message = String(body?.body || "").slice(0, 500);
  const targetUrl = String(body?.url || "").slice(0, 500);
  const count = Math.max(1, Number(body?.count) || 1);

  const list = await readSubscriptions();
  const keep = [];
  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const subscription of list) {
    try {
      const push = await buildPushHTTPRequest({
        privateJWK: process.env.VAPID_PRIVATE_JWK,
        subscription: { endpoint: subscription.endpoint, keys: subscription.keys },
        message: {
          payload: { title, body: message, url: targetUrl, count },
          adminContact: process.env.VAPID_SUBJECT,
          options: { ttl: 86400, urgency: "normal", topic: "uav-pls-daily" },
        },
      });

      const pushResponse = await fetch(push.endpoint, {
        method: "POST",
        headers: push.headers,
        body: push.body,
      });

      if (pushResponse.ok) {
        sent += 1;
        keep.push(subscription);
      } else if (pushResponse.status === 404 || pushResponse.status === 410) {
        gone += 1;
      } else {
        failed += 1;
        keep.push(subscription);
        console.log(`[push] send failed ${pushResponse.status}`);
      }
    } catch (error) {
      failed += 1;
      keep.push(subscription);
      console.log(`[push] send error: ${error?.message || error}`);
    }
  }

  if (gone > 0) await writeSubscriptions(keep);
  sendJson(response, 200, { ok: true, total: list.length, sent, gone, failed }, cors);
}

async function handleStatus(response, cors) {
  if (!gistConfigured()) {
    sendJson(response, 200, { configured: false, count: 0 }, cors);
    return;
  }
  const list = await readSubscriptions();
  sendJson(response, 200, { configured: true, count: list.length }, cors);
}

async function readSubscriptions() {
  const response = await fetch(`https://api.github.com/gists/${process.env.GITHUB_GIST_ID}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw httpError(502, `Gist 读取失败 ${response.status}`);
  }
  const data = await response.json();
  const content = data?.files?.[GIST_FILE]?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed?.subscriptions)
    ? parsed.subscriptions
    : Array.isArray(parsed)
      ? parsed
      : [];
  return list.filter(
    (item) =>
      item
      && /^https:\/\//i.test(String(item.endpoint || ""))
      && item.keys?.p256dh
      && item.keys?.auth,
  );
}

async function writeSubscriptions(list) {
  const content = JSON.stringify({ subscriptions: list }, null, 2);
  const response = await fetch(`https://api.github.com/gists/${process.env.GITHUB_GIST_ID}`, {
    method: "PATCH",
    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files: { [GIST_FILE]: { content } } }),
  });
  if (!response.ok) {
    throw httpError(502, `Gist 写入失败 ${response.status}`);
  }
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "uav-pls-push",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function gistConfigured() {
  return Boolean(process.env.GITHUB_GIST_ID && process.env.GITHUB_TOKEN);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "请求体过大");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "JSON 格式不正确");
  }
}

function normalizeSubscription(value) {
  const endpoint = String(value?.endpoint || "").trim();
  const p256dh = String(value?.keys?.p256dh || "").trim();
  const auth = String(value?.keys?.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: value?.expirationTime ?? null,
    addedAt: new Date().toISOString(),
  };
}

function originAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
