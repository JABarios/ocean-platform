import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(['Closed', 'Open']).default('Closed'),
})

router.use(authMiddleware)

// Crear grupo
router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createGroupSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      type: parsed.data.type,
      members: {
        create: { userId: req.user!.id, role: 'admin' },
      },
    },
    include: { members: { include: { user: { select: { id: true, displayName: true, email: true } } } } },
  })

  res.status(201).json(group)
})

// Listar grupos del usuario
router.get('/', async (req: AuthenticatedRequest, res) => {
  const groups = await prisma.group.findMany({
    where: {
      members: { some: { userId: req.user!.id } },
    },
    include: {
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(groups)
})

// Detalle de grupo
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const group = await prisma.group.findFirst({
    where: {
      id: req.params.id,
      members: { some: { userId: req.user!.id } },
    },
    include: {
      members: {
        include: { user: { select: { id: true, displayName: true, email: true, role: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })

  if (!group) {
    res.status(404).json({ error: 'Grupo no encontrado o sin acceso' })
    return
  }

  res.json(group)
})

// Añadir miembro
router.post('/:id/members', async (req: AuthenticatedRequest, res) => {
  const { userId } = req.body
  if (!userId) {
    res.status(400).json({ error: 'userId requerido' })
    return
  }

  // Solo admin del grupo puede añadir miembros
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.role !== 'admin') {
    res.status(403).json({ error: 'Solo el administrador del grupo puede añadir miembros' })
    return
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } })
  if (!targetUser) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId: req.params.id } },
  })
  if (existing) {
    res.status(409).json({ error: 'El usuario ya es miembro del grupo' })
    return
  }

  const member = await prisma.groupMember.create({
    data: { userId, groupId: req.params.id, role: 'member' },
    include: { user: { select: { id: true, displayName: true, email: true } } },
  })

  res.status(201).json(member)
})

// Eliminar miembro
router.delete('/:id/members/:userId', async (req: AuthenticatedRequest, res) => {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.role !== 'admin') {
    res.status(403).json({ error: 'Solo el administrador del grupo puede eliminar miembros' })
    return
  }

  // Admin no puede eliminarse a sí mismo si es el único admin
  if (req.params.userId === req.user!.id) {
    res.status(400).json({ error: 'No puedes eliminarte a ti mismo del grupo' })
    return
  }

  const target = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.params.userId, groupId: req.params.id } },
  })
  if (!target) {
    res.status(404).json({ error: 'Miembro no encontrado' })
    return
  }

  await prisma.groupMember.delete({
    where: { userId_groupId: { userId: req.params.userId, groupId: req.params.id } },
  })

  res.status(204).send()
})

export default router
