self.addEventListener("push", event => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { /* Show a generic notification. */ }
  event.waitUntil(self.registration.showNotification(message.title || "Muse 商店新订单", {
    body: message.body || "有新订单，请打开工作台查看。",
    icon: "/sites/muse/store-logo.png",
    badge: "/sites/muse/store-logo.png",
    tag: message.tag || "muse-order",
    data: { url: "/admin/" },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async clients => {
    const existing = clients.find(client => new URL(client.url).pathname.startsWith("/admin/"));
    if (existing) return existing.focus();
    return self.clients.openWindow("/admin/");
  }));
});
