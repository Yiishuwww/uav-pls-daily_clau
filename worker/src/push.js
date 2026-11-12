// Web Push：保存浏览器订阅，并用 VAPID 发送推送。
// 需要 KV 绑定 PUSH_SUBSCRIPTIONS，以及 VAPID_PUBLIC_KEY / VAPID_PRIVATE_JWK /
// VAPID_SUBJECT / PUSH_SEND_SECRET 四个配置。

import { buildPushHTTPRequest } from "@pushforge/builder";

const KV_KEY = "subscriptions";
const MAX_SUBSCRIPTIONS = 1000;
const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization";

export async function handlePushRequest(request, env, allowedOrigins = []) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, allowedOrigins);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  try {
    switch (url.pathname) {
      case "/api/push/vapid-public-key":
        return json({ publicKey: env.VAPID_PUBLIC_KEY || "" }, 200, cors);
      case "/api/push/subscribe":
        return await handleSubscribe(request, env, cors, allowedOrigins);
      case "/api/push/unsubscribe":
        return await handleUnsubscribe(request, env, cors, allowedOrigins);
      case "/api/push/send":
        return await handleSend(request, env, cors);
      case "/api/push/status":
        return await handleStatus(env, cors);
      default:
        return json({ error: "Not found" }, 404, cors);
    }
  } catch (error) {
    return json({ error: error?.message || String(error) }, 500, cors);
  }
}

async function handleSubscribe(request, env, cors, allowedOrigins) {
  if (!originAllowed(request, allowedOrigins)) {
    return json({ error: "Origin not allowed" }, 403, cors);
  }
  if (!env.PUSH_SUBSCRIPTIONS) {
    return json({ error: "未绑定 PUSH_SUBSCRIPTIONS KV" }, 503, cors);
  }

  const body = await request.json().catch(() => null);
  const subscription = normalizeSubscription(body);
  if (!subscription) {
    return json({ error: "订阅格式不正确" }, 400, cors);
  }

  const list = await readSubscriptions(env);
  const index = list.findIndex((item) => item.endpoint === subscription.endpoint);
  if (index >= 0) list[index] = subscription;
  else list.push(subscription);

  if (list.length > MAX_SUBSCRIPTIONS) {
    return json({ error: "订阅数已达上限" }, 429, cors);
  }

  await env.PUSH_SUBSCRIPTIONS.put(KV_KEY, JSON.stringify(list));
  return json({ ok: true, count: list.length }, 200, cors);
}

async function handleUnsubscribe(request, env, cors, allowedOrigins) {
  if (!originAllowed(request, allowedOrigins)) {
    return json({ error: "Origin not allowed" }, 403, cors);
  }
  if (!env.PUSH_SUBSCRIPTIONS) {
    return json({ ok: true, count: 0 }, 200, cors);
  }

  const body = await request.json().catch(() => null);
  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) {
    return json({ error: "缺少 endpoint" }, 400, cors);
  }

  const list = await readSubscriptions(env);
  const next = list.filter((item) => item.endpoint !== endpoint);
  if (next.length !== list.length) {
    await env.PUSH_SUBSCRIPTIONS.put(KV_KEY, JSON.stringify(next));
  }
  return json({ ok: true, count: next.length }, 200, cors);
}

async function handleSend(request, env, cors) {
  const secret = env.PUSH_SEND_SECRET || "";
  const authorization = request.headers.get("Authorization") || "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401, cors);
  }
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_SUBJECT) {
    return json({ error: "VAPID 未配置" }, 503, cors);
  }
  if (!env.PUSH_SUBSCRIPTIONS) {
    return json({ error: "未绑定 PUSH_SUBSCRIPTIONS KV" }, 503, cors);
  }

  const body = await request.json().catch(() => null);
  const title = String(body?.title || "UAV PLS 论文日报").slice(0, 120);
  const message = String(body?.body || "").slice(0, 500);
  const targetUrl = String(body?.url || "").slice(0, 500);
  const count = Math.max(1, Number(body?.count) || 1);

  const list = await readSubscriptions(env);
  const keep = [];
  let sent = 0;
  let gone = 0;
  let failed = 0;

  for (const subscription of list) {
    try {
      const push = await buildPushHTTPRequest({
        privateJWK: env.VAPID_PRIVATE_JWK,
        subscription: { endpoint: subscription.endpoint, keys: subscription.keys },
        message: {
          payload: { title, body: message, url: targetUrl, count },
          adminContact: env.VAPID_SUBJECT,
          options: { ttl: 86400, urgency: "normal", topic: "uav-pls-daily" },
        },
      });

      const response = await fetch(push.endpoint, {
        method: "POST",
        headers: push.headers,
        body: push.body,
      });

      if (response.ok) {
        sent += 1;
        keep.push(subscription);
      } else if (response.status === 404 || response.status === 410) {
        gone += 1;
      } else {
        failed += 1;
        keep.push(subscription);
        console.log(`[push] send failed ${response.status}`);
      }
    } catch (error) {
      failed += 1;
      keep.push(subscription);
      console.log(`[push] send error: ${error?.message || error}`);
    }
  }

  if (gone > 0) {
    await env.PUSH_SUBSCRIPTIONS.put(KV_KEY, JSON.stringify(keep));
  }

  return json({ ok: true, total: list.length, sent, gone, failed }, 200, cors);
}

async function handleStatus(env, cors) {
  const list = await readSubscriptions(env);
  return json({ count: list.length }, 200, cors);
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

async function readSubscriptions(env) {
  if (!env.PUSH_SUBSCRIPTIONS) return [];
  const value = await env.PUSH_SUBSCRIPTIONS.get(KV_KEY, "json");
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) =>
      item
      && /^https:\/\//i.test(String(item.endpoint || ""))
      && item.keys?.p256dh
      && item.keys?.auth,
  );
}

function originAllowed(request, allowedOrigins) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return true;
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

function corsHeaders(origin, allowedOrigins) {
  const headers = {
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
