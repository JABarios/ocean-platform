const VERSION = 'ocean-pwa-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg', '/icons/icon-maskable.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/wasm/')) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/')
        return cached || Response.error()
      }),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response
        }

        const copy = response.clone()
        caches.open(VERSION).then((cache) => {
          cache.put(event.request, copy).catch(() => {})
        })
        return response
      })
    }),
  )
})

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}
  const title = payload.title || 'OCEAN'
  const options = {
    body: payload.body || 'Tienes actividad nueva en OCEAN.',
    tag: payload.tag || 'ocean-notification',
    data: {
      url: payload.url || '/',
    },
    badge: '/icons/icon-192.svg',
    icon: '/icons/icon-192.svg',
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return undefined
    }),
  )
})
