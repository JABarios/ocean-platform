export async function registerPwaServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  if (import.meta.env.DEV) return

  try {
    await navigator.serviceWorker.register('/sw.js')
  } catch (error) {
    console.warn('[OCEAN PWA] No se pudo registrar el service worker', error)
  }
}
