// Service worker: แจ้งเตือนเด้งเข้ามือถือ (Web Push) — ไม่ได้เก็บแคชหน้าเว็บ
// ข้อความจากเซิร์ฟเวอร์ (src/lib/notifications.ts): { title, body, url, tag }

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "GLORY VITAL", body: event.data ? event.data.text() : "" };
  }
  // เสียง = เสียงแจ้งเตือนของเครื่อง (เว็บตั้งเสียงเองไม่ได้) · สั่น (Android) · เรื่องด่วน = ค้างบนจอจนกว่าจะกดปิด
  event.waitUntil(
    self.registration.showNotification(data.title || "GLORY VITAL", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag,
      renotify: !!data.tag,
      silent: false,
      vibrate: data.urgent ? [300, 120, 300, 120, 300] : [200, 100, 200],
      requireInteraction: !!data.urgent,
      data: { url: data.url || "/" },
    }),
  );
});

// กดแจ้งเตือน: มีหน้าเว็บเปิดอยู่ = สลับไปหน้านั้น / ไม่มี = เปิดใหม่
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.navigate(url).then((w) => (w || c).focus()).catch(() => c.focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
