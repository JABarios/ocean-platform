import { api } from './api/client'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }

  return outputArray
}

export async function getPushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { supported: false, permission: 'unsupported' as const, subscribed: false }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  }
}

export async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Este dispositivo no soporta avisos push web.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Necesitas permitir las notificaciones para activar los avisos.')
  }

  const config = await api.get<{ configured: boolean; publicKey: string | null }>('/push/public-key')
  if (!config.configured || !config.publicKey) {
    throw new Error('Los avisos push no están configurados todavía en el servidor.')
  }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    })
  }

  await api.post('/push/subscriptions', subscription.toJSON())
}

export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  await api.post('/push/unsubscribe', { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}
