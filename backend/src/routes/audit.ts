import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'

const router = Router()

router.use(authMiddleware)

router.get('/', requireRole(['Admin']), async (req: AuthenticatedRequest, res) => {
  const { caseId, action, limit } = req.query

  const where: Record<string, unknown> = {}
  if (caseId) where.caseId = caseId as string
  if (action) where.action = action as string

  const events = await prisma.auditEvent.findMany({
    where,
    include: {
      actor: { select: { id: true, email: true, displayName: true } },
      case: { select: { id: true, title: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
  })

  res.json(events)
})

export default router
