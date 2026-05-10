import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { getPublicPushKey, isPushConfigured } from '../utils/push'

const router = Router()

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

router.use(authMiddleware)

router.get('/public-key', (_req: AuthenticatedRequest, res) => {
  res.json({
    configured: isPushConfigured(),
    publicKey: getPublicPushKey(),
  })
})

router.post('/subscriptions', async (req: AuthenticatedRequest, res) => {
  const parsed = subscriptionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Suscripción push inválida' })
    return
  }

  const subscription = await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: req.user!.id,
      p256dhKey: parsed.data.keys.p256dh,
      authKey: parsed.data.keys.auth,
      userAgent: req.get('user-agent') || null,
    },
    create: {
      userId: req.user!.id,
      endpoint: parsed.data.endpoint,
      p256dhKey: parsed.data.keys.p256dh,
      authKey: parsed.data.keys.auth,
      userAgent: req.get('user-agent') || null,
    },
  })

  res.status(201).json({
    id: subscription.id,
    endpoint: subscription.endpoint,
  })
})

router.post('/unsubscribe', async (req: AuthenticatedRequest, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''
  if (!endpoint) {
    res.status(400).json({ error: 'Endpoint requerido' })
    return
  }

  await prisma.pushSubscription.deleteMany({
    where: {
      userId: req.user!.id,
      endpoint,
    },
  })

  res.status(204).send()
})

export default router
