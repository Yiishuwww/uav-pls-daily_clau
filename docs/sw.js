// 最小 Service Worker：PWA 安装、Web Push 与主屏幕角标。
// 当前没有推送后端，push 事件会在以后接入 Web Push 时使用。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 让浏览器把站点视为可安装 PWA；实际请求仍走网络。
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "UAV PLS 论文日报";
  const options = {
    body: data.body || "有新的论文更新",
    icon: "assets/icon-192.png",
    badge: "assets/icon-192.png",
    tag: "uav-pls-daily",
    data: { url: data.url || "./" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      if ("setAppBadge" in navigator) {
        const count = Number(data.count) || 1;
        await navigator.setAppBadge(count);
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
