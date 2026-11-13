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
      try {
        if ("setAppBadge" in self.navigator) {
          // iOS 只接受数字角标；0 会清除，所以至少传 1。
          await self.navigator.setAppBadge(Math.max(1, Number(data.count) || 1));
        }
      } catch {
        // 角标失败不影响通知展示
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";

  event.waitUntil(
    (async () => {
      try {
        // iOS 需要用数字 0 清除角标
        if ("setAppBadge" in self.navigator) {
          await self.navigator.setAppBadge(0);
        } else if ("clearAppBadge" in self.navigator) {
          await self.navigator.clearAppBadge();
        }
      } catch {
        // 清除角标失败不影响打开页面
      }

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
