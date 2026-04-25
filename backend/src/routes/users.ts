import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'

const router = Router()

const VALID_ROLES = ['Clinician', 'Reviewer', 'Curator', 'Admin'] as const

const changeRoleSchema = z.object({
  role: z.enum(VALID_ROLES),
})

router.use(authMiddleware)

router.get('/', async (_req: AuthenticatedRequest, res) => {
  const users = await prisma.user.findMany({
    where: { status: 'Active' },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      institution: true,
      specialty: true,
    },
    orderBy: { displayName: 'asc' },
  })
  res.json(users)
})

router.patch('/:id/role', requireRole(['Admin']), async (req: AuthenticatedRequest, res) => {
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

export default router
