self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? { title: "Kestrel", body: "A new job matched your criteria." };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Kestrel", {
      body: data.body,
      data: data.url,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.notification.data) event.waitUntil(self.clients.openWindow(event.notification.data));
});
