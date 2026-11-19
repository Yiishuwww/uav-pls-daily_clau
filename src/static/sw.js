// 最小 Service Worker：PWA 安装与更新。
// 不缓存页面与数据，始终请求最新内容。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {});
