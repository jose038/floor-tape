self.addEventListener('push', (event) => {
  let payload = { title: 'Floor Tape', body: 'A new disclosure is on the tape.', url: '/' }
  try {
    payload = { ...payload, ...(event.data ? event.data.json() : {}) }
  } catch {
    /* keep the fallback copy */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(self.clients.openWindow(url))
})
