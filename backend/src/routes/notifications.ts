import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { serializeNotification } from '../utils/notifications'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} from '../utils/notificationPreferences'

const router = Router()

const notificationPreferencesSchema = z.object({
  review_request_direct: z.object({
    email: z.boolean().optional(),
    telegram: z.boolean().optional(),
    push: z.boolean().optional(),
  }).partial().optional(),
  review_request_group: z.object({
    email: z.boolean().optional(),
    telegram: z.boolean().optional(),
    push: z.boolean().optional(),
  }).partial().optional(),
  group_invitation: z.object({
    email: z.boolean().optional(),
    telegram: z.boolean().optional(),
    push: z.boolean().optional(),
  }).partial().optional(),
  comment_on_case: z.object({
    email: z.boolean().optional(),
    telegram: z.boolean().optional(),
    push: z.boolean().optional(),
  }).partial().optional(),
}).partial()

router.use(authMiddleware)

router.get('/', async (req: AuthenticatedRequest, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    include: {
      actor: { select: { id: true, displayName: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  res.json(notifications.map(serializeNotification))
})

router.get('/unread-count', async (req: AuthenticatedRequest, res) => {
  const count = await prisma.notification.count({
    where: {
      userId: req.user!.id,
      readAt: null,
    },
  })

  res.json({ count })
})

router.get('/preferences', async (req: AuthenticatedRequest, res) => {
  const preferences = await getUserNotificationPreferences(req.user!.id)

  res.json({
    preferences,
    defaults: DEFAULT_NOTIFICATION_PREFERENCES,
    channels: {
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME),
      pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    },
  })
})

router.patch('/preferences', async (req: AuthenticatedRequest, res) => {
  const parsed = notificationPreferencesSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const preferences = await updateUserNotificationPreferences(req.user!.id, parsed.data)
  res.json({ preferences })
})

router.post('/:id/read', async (req: AuthenticatedRequest, res) => {
  const existing = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      userId: req.user!.id,
    },
  })

  if (!existing) {
    res.status(404).json({ error: 'Notificación no encontrada' })
    return
  }

  const updated = await prisma.notification.update({
    where: { id: existing.id },
    data: {
      readAt: existing.readAt || new Date(),
    },
    include: {
      actor: { select: { id: true, displayName: true, email: true } },
    },
  })

  res.json(serializeNotification(updated))
})

router.post('/read-all', async (req: AuthenticatedRequest, res) => {
  await prisma.notification.updateMany({
    where: {
      userId: req.user!.id,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })

  res.status(204).send()
})

export default router
