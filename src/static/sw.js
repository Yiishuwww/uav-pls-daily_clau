// Service Worker：导航走网络优先，静态资源走缓存优先并后台更新。

const CACHE = "uav-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/assets/")) {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, request));
  }
});

function staleWhileRevalidate(event, request) {
  const cachePromise = caches.open(CACHE);
  const responsePromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await cachePromise;
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  event.waitUntil(responsePromise);

  return cachePromise.then(async (cache) => (
    (await cache.match(request))
    || (await responsePromise)
    || Response.error()
  ));
}

function networkFirst(event, request) {
  const responsePromise = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    });

  event.waitUntil(responsePromise.catch(() => {}));

  return responsePromise.catch(async () => (
    (await caches.open(CACHE)).match(request)
  )).then((cached) => cached || Response.error());
}
