import webpush from 'web-push'
import { prisma } from './prisma'

let vapidConfigured = false

function ensureVapidConfigured() {
  if (vapidConfigured) return true

  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@ocean.local'

  if (!publicKey || !privateKey) return false

  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export function getPublicPushKey() {
  return process.env.VAPID_PUBLIC_KEY || null
}

export async function sendPushToUser(userId: string, payload: {
  title: string
  body: string
  url: string
  tag?: string
}) {
  if (!ensureVapidConfigured()) return

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  })

  if (!subscriptions.length) return

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
  })

  await Promise.allSettled(subscriptions.map(async (subscription: {
    id: string
    endpoint: string
    p256dhKey: string
    authKey: string
  }) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dhKey,
          auth: subscription.authKey,
        },
      }, body)

      await prisma.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastUsedAt: new Date() },
      })
    } catch (error: any) {
      const statusCode = error?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({
          where: { id: subscription.id },
        }).catch(() => {})
        return
      }

      console.warn('[OCEAN push] No se pudo enviar push', error)
    }
  }))
}
