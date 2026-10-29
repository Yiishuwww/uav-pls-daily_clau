// 统一 HTTP 客户端：超时、重试、429/5xx 退避

const USER_AGENT =
  "uav-pls-daily/1.0 (academic literature digest; +https://github.com/)";

export class HttpError extends Error {
  constructor(message, { status = 0, retryable = true } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.retryable = retryable;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchText(
  url,
  {
    params,
    headers = {},
    timeout = 60_000,
    retries = 3,
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  } = {},
) {
  const target = new URL(url);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        target.searchParams.set(key, String(value));
      }
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(target, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          ...headers,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const retryable = response.status === 429 || response.status >= 500;
        const error = new HttpError(
          `HTTP ${response.status} ${target.host}${target.pathname}: ${body.slice(0, 240)}`,
          { status: response.status, retryable },
        );
        if (!retryable) throw error;
        lastError = error;
        if (attempt < retries) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : 1500 * 2 ** attempt;
          await sleep(wait);
        }
        continue;
      }

      return await response.text();
    } catch (error) {
      if (error instanceof HttpError && !error.retryable) throw error;
      lastError = error;
      if (attempt < retries) {
        await sleep(1500 * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new HttpError(`请求失败: ${target}`);
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, { ...options, accept: "application/json" });
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`返回内容不是合法 JSON: ${url}`, { retryable: false });
  }
}
