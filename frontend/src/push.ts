import { api } from './api/client'

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

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

function normalizePublicKey(value: string) {
  return value.trim().replace(/\s+/g, '')
}

function validateVapidPublicKey(value: string) {
  const key = urlBase64ToUint8Array(value)
  if (key.length !== 65) {
    throw new Error('La clave pública de avisos push del servidor no es válida.')
  }
  return key
}

function pushActivationError(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error || '')
  if (message.toLowerCase().includes('push service error')) {
    return new Error(
      `El navegador rechazó el alta push (${name || 'Error'}: ${message || 'sin detalle'}). Suele deberse a una suscripción vieja del dispositivo, a que Chrome tenga bloqueadas notificaciones a nivel sistema o a un problema local del servicio push del navegador.`,
    )
  }
  if (error instanceof Error) {
    return new Error(`${error.name || 'Error'}: ${error.message || 'sin detalle'}`)
  }
  return new Error(`No se pudo activar los avisos push: ${String(error || 'sin detalle')}`)
}

async function ensureActivePushWorker() {
  let registration = await navigator.serviceWorker.ready
  await registration.update().catch(() => {})

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (registration.active) {
      return registration
    }
    await sleep(400)
    registration = await navigator.serviceWorker.ready
  }

  throw new Error('No active service worker. Recarga la página y espera unos segundos antes de activar avisos.')
}

export async function getPushDiagnostics() {
  const support = {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    standalone: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
  }

  if (!support.serviceWorker || !support.pushManager || !support.notification) {
    return {
      support,
      permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      workerScope: null,
      workerActive: false,
      subscribed: false,
      endpointPreview: null,
      vapidConfigured: false,
      vapidPublicKeyLength: 0,
      vapidPublicKeyPrefix: null,
    }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  const config = await api.get<{ configured: boolean; publicKey: string | null }>('/push/public-key')
  const normalizedKey = config.publicKey ? normalizePublicKey(config.publicKey) : ''

  return {
    support,
    permission: Notification.permission,
    workerScope: registration.scope,
    workerActive: Boolean(registration.active),
    workerInstalling: Boolean(registration.installing),
    workerWaiting: Boolean(registration.waiting),
    controlledPage: Boolean(navigator.serviceWorker.controller),
    subscribed: Boolean(subscription),
    endpointPreview: subscription?.endpoint ? subscription.endpoint.slice(0, 72) : null,
    vapidConfigured: config.configured,
    vapidPublicKeyLength: normalizedKey.length,
    vapidPublicKeyPrefix: normalizedKey ? normalizedKey.slice(0, 16) : null,
  }
}

export async function resetPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  const registration = await ensureActivePushWorker()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  try {
    await api.post('/push/unsubscribe', { endpoint: subscription.endpoint })
  } catch {
    // no bloqueamos el reset local por un fallo del backend
  }

  await subscription.unsubscribe()
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

  const registration = await ensureActivePushWorker()
  let subscription = await registration.pushManager.getSubscription()
  const applicationServerKey = validateVapidPublicKey(normalizePublicKey(config.publicKey))

  try {
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    }
  } catch (error) {
    if (subscription) {
      try {
        await subscription.unsubscribe()
      } catch {
        // ignoramos errores al limpiar una suscripción rota
      }
    }

    subscription = await registration.pushManager.getSubscription()
    if (subscription) {
      try {
        await subscription.unsubscribe()
      } catch {
        // ignoramos errores al limpiar una suscripción rota
      }
    }

    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })
    } catch (retryError) {
      console.warn('[OCEAN push] Error al suscribir dispositivo', retryError)
      throw pushActivationError(retryError)
    }
  }

  await api.post('/push/subscriptions', subscription.toJSON())
}

export async function disablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

  const registration = await ensureActivePushWorker()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  await api.post('/push/unsubscribe', { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}
