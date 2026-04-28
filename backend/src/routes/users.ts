import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'

const router = Router()

const VALID_ROLES = ['Clinician', 'Reviewer', 'Curator', 'Admin'] as const
const VALID_STATUSES = ['Active', 'Pending'] as const

const changeRoleSchema = z.object({
  role: z.enum(VALID_ROLES),
})

const changeStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
})

function summarizeReviewStatuses(statuses: string[]) {
  return statuses.reduce(
    (acc, status) => {
      if (status === 'Pending') acc.pending += 1
      if (status === 'Accepted') acc.active += 1
      if (status === 'Completed') acc.completed += 1
      acc.total += 1
      return acc
    },
    { pending: 0, active: 0, completed: 0, total: 0 }
  )
}

async function setUserStatus(actorId: string, userId: string, status: 'Active' | 'Pending') {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return { kind: 'not-found' as const }
  if (user.id === actorId && status !== 'Active') return { kind: 'self-delete' as const }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status },
  })

  await prisma.auditEvent.create({
    data: {
      actorId,
      action: status === 'Active' ? 'UserReactivated' : 'UserDeleted',
      metadata: JSON.stringify({ userId: user.id, email: user.email, from: user.status, to: status }),
    },
  })

  return { kind: 'ok' as const, user: updated }
}

router.use(authMiddleware)
router.use(requireRole(['Admin']))

router.get('/', async (_req: AuthenticatedRequest, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      institution: true,
      specialty: true,
      createdAt: true,
      lastLoginAt: true,
      groupMemberships: {
        select: {
          group: {
            select: { id: true, name: true },
          },
        },
      },
      ownedCases: {
        select: { id: true },
      },
      targetRequests: {
        select: { status: true },
      },
    },
    orderBy: [{ status: 'asc' }, { displayName: 'asc' }],
  })
  res.json(users.map((user) => {
    const reviewStats = summarizeReviewStatuses(user.targetRequests.map((request) => request.status))
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      institution: user.institution,
      specialty: user.specialty,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      groups: user.groupMemberships.map((membership) => membership.group),
      metrics: {
        casesCreated: user.ownedCases.length,
        pendingReviews: reviewStats.pending,
        activeReviews: reviewStats.active,
        completedReviews: reviewStats.completed,
        totalReviews: reviewStats.total,
      },
    }
  }))
})

router.patch('/:id/role', async (req: AuthenticatedRequest, res) => {
  const parsed = changeRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Rol inválido', validRoles: VALID_ROLES })
    return
  }

  const user = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { role: parsed.data.role },
    select: { id: true, email: true, displayName: true, role: true, institution: true, specialty: true },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      action: 'RoleChanged',
      metadata: JSON.stringify({ userId: user.id, from: user.role, to: parsed.data.role }),
    },
  })

  res.json(updated)
})

router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  const parsed = changeStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Estado inválido', validStatuses: VALID_STATUSES })
    return
  }

  const result = await setUserStatus(req.user!.id, req.params.id, parsed.data.status)
  if (result.kind === 'not-found') {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  if (result.kind === 'self-delete') {
    res.status(400).json({ error: 'No puedes desactivar tu propio usuario' })
    return
  }

  res.json({
    id: result.user.id,
    email: result.user.email,
    displayName: result.user.displayName,
    role: result.user.role,
    status: result.user.status,
    institution: result.user.institution,
    specialty: result.user.specialty,
    createdAt: result.user.createdAt,
    lastLoginAt: result.user.lastLoginAt,
  })
})

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const result = await setUserStatus(req.user!.id, req.params.id, 'Pending')
  if (result.kind === 'not-found') {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  if (result.kind === 'self-delete') {
    res.status(400).json({ error: 'No puedes borrar tu propio usuario' })
    return
  }

  res.status(204).send()
})

export default router
