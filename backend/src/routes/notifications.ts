import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { serializeNotification } from '../utils/notifications'

const router = Router()

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
