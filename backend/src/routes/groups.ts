import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { canManageGroupMembers } from '../domain/workflows/groupWorkflow'
import { buildGroupsUrl, sendGroupInvitationEmail } from '../utils/email'
import { createNotification } from '../utils/notifications'
import { sendPushToUser } from '../utils/push'
import { sendTelegramToUser } from '../utils/telegram'

const router = Router()

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(['Closed', 'Open']).default('Closed'),
})

const inviteMemberSchema = z.object({
  userId: z.string().uuid(),
})

const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  type: z.enum(['Closed', 'Open']).optional(),
})

router.use(authMiddleware)

function serializeMembership(member: any) {
  return {
    id: member.id,
    userId: member.userId,
    groupId: member.groupId,
    role: member.role,
    status: member.status,
    invitedBy: member.invitedBy,
    invitedAt: member.invitedAt,
    respondedAt: member.respondedAt,
    joinedAt: member.joinedAt,
    user: member.user,
  }
}

async function getAcceptedMembership(groupId: string, userId: string) {
  return prisma.groupMember.findUnique({
    where: { userId_groupId: { userId, groupId } },
  })
}

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
        create: {
          userId: req.user!.id,
          role: 'admin',
          status: 'Accepted',
          invitedBy: req.user!.id,
          respondedAt: new Date(),
        },
      },
    },
    include: {
      members: {
        include: { user: { select: { id: true, displayName: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      },
    },
  })

  res.status(201).json({
    ...group,
    members: group.members.map(serializeMembership),
  })
})

// Listar grupos aceptados del usuario
router.get('/', async (req: AuthenticatedRequest, res) => {
  const groups = await prisma.group.findMany({
    where: {
      members: {
        some: {
          userId: req.user!.id,
          status: 'Accepted',
        },
      },
    },
    include: {
      members: {
        where: { status: 'Accepted' },
        select: { id: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(groups.map((group) => ({
    ...group,
    _count: { members: group.members.length },
    members: undefined,
  })))
})

// Invitaciones pendientes del usuario
router.get('/invitations', async (req: AuthenticatedRequest, res) => {
  const invitations = await prisma.groupMember.findMany({
    where: {
      userId: req.user!.id,
      status: 'Pending',
    },
    include: {
      group: {
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
        },
      },
    },
    orderBy: { invitedAt: 'desc' },
  })

  res.json(invitations.map((item) => ({
    id: item.id,
    groupId: item.groupId,
    role: item.role,
    status: item.status,
    invitedBy: item.invitedBy,
    invitedAt: item.invitedAt,
    respondedAt: item.respondedAt,
    group: item.group,
  })))
})

// Detalle de grupo
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.status !== 'Accepted') {
    res.status(404).json({ error: 'Grupo no encontrado o sin acceso' })
    return
  }

  const group = await prisma.group.findFirst({
    where: { id: req.params.id },
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

  const acceptedMembers = group.members.filter((member) => member.status === 'Accepted').map(serializeMembership)
  const pendingInvitations = membership.role === 'admin'
    ? group.members.filter((member) => member.status === 'Pending').map(serializeMembership)
    : []

  res.json({
    ...group,
    members: acceptedMembers,
    pendingInvitations,
  })
})

// Editar grupo
router.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateGroupSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.status !== 'Accepted' || !canManageGroupMembers(membership.role)) {
    res.status(403).json({ error: 'Solo un administrador del grupo puede editarlo' })
    return
  }

  const group = await prisma.group.update({
    where: { id: req.params.id },
    data: parsed.data,
  })

  res.json(group)
})

// Invitar miembro
router.post('/:id/members', async (req: AuthenticatedRequest, res) => {
  const parsed = inviteMemberSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.status !== 'Accepted' || !canManageGroupMembers(membership.role)) {
    res.status(403).json({ error: 'Solo el administrador del grupo puede invitar miembros' })
    return
  }

  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    select: { name: true },
  })
  if (!group) {
    res.status(404).json({ error: 'Grupo no encontrado' })
    return
  }

  const targetUser = await prisma.user.findUnique({ where: { id: parsed.data.userId } })
  if (!targetUser) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }

  const existing = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: parsed.data.userId, groupId: req.params.id } },
  })
  if (existing?.status === 'Accepted') {
    res.status(409).json({ error: 'El usuario ya es miembro del grupo' })
    return
  }
  if (existing?.status === 'Pending') {
    res.status(409).json({ error: 'El usuario ya tiene una invitación pendiente' })
    return
  }

  const member = existing
    ? await prisma.groupMember.update({
        where: { userId_groupId: { userId: parsed.data.userId, groupId: req.params.id } },
        data: {
          role: 'member',
          status: 'Pending',
          invitedBy: req.user!.id,
          invitedAt: new Date(),
          respondedAt: null,
        },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      })
    : await prisma.groupMember.create({
        data: {
          userId: parsed.data.userId,
          groupId: req.params.id,
          role: 'member',
          status: 'Pending',
          invitedBy: req.user!.id,
        },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      })

  const inviter = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { displayName: true },
  })

  if (member.user && inviter) {
    await createNotification({
      userId: member.user.id,
      kind: 'group_invitation_received',
      title: 'Nueva invitación a grupo',
      body: `${inviter.displayName} te ha invitado al grupo ${group.name}.`,
      actorUserId: req.user!.id,
    }).catch((err) => {
      console.warn('[OCEAN notifications] No se pudo crear la notificación de invitación al grupo', err)
    })

    sendGroupInvitationEmail({
      to: member.user.email,
      displayName: member.user.displayName,
      inviterName: inviter.displayName,
      groupName: group.name,
      groupsUrl: buildGroupsUrl(),
    }).catch((err) => {
      console.warn('[OCEAN email] No se pudo enviar la invitación al grupo', err)
    })

    sendPushToUser(member.user.id, {
      title: 'Nueva invitación a grupo',
      body: `${inviter.displayName} te ha invitado al grupo ${group.name}.`,
      url: buildGroupsUrl(),
      tag: `group-invite-${req.params.id}`,
    }).catch((err) => {
      console.warn('[OCEAN push] No se pudo enviar el push de invitación a grupo', err)
    })

    sendTelegramToUser(member.user.id, {
      text: `${inviter.displayName} te ha invitado al grupo ${group.name} en OCEAN.`,
      url: buildGroupsUrl(),
    }).catch((err) => {
      console.warn('[OCEAN telegram] No se pudo enviar el aviso de Telegram de invitación a grupo', err)
    })
  }

  res.status(201).json(serializeMembership(member))
})

// Aceptar invitación
router.post('/invitations/:membershipId/accept', async (req: AuthenticatedRequest, res) => {
  const membership = await prisma.groupMember.findFirst({
    where: {
      id: req.params.membershipId,
      userId: req.user!.id,
      status: 'Pending',
    },
    include: {
      group: true,
    },
  })
  if (!membership) {
    res.status(404).json({ error: 'Invitación no encontrada' })
    return
  }

  const updated = await prisma.groupMember.update({
    where: { id: membership.id },
    data: {
      status: 'Accepted',
      respondedAt: new Date(),
      joinedAt: new Date(),
    },
    include: { user: { select: { id: true, displayName: true, email: true } } },
  })

  res.json({
    ...serializeMembership(updated),
    group: membership.group,
  })
})

// Rechazar invitación
router.post('/invitations/:membershipId/reject', async (req: AuthenticatedRequest, res) => {
  const membership = await prisma.groupMember.findFirst({
    where: {
      id: req.params.membershipId,
      userId: req.user!.id,
      status: 'Pending',
    },
  })
  if (!membership) {
    res.status(404).json({ error: 'Invitación no encontrada' })
    return
  }

  await prisma.groupMember.delete({
    where: { id: membership.id },
  })

  res.status(204).send()
})

// Eliminar miembro
router.delete('/:id/members/:userId', async (req: AuthenticatedRequest, res) => {
  const membership = await prisma.groupMember.findUnique({
    where: { userId_groupId: { userId: req.user!.id, groupId: req.params.id } },
  })
  if (!membership || membership.status !== 'Accepted' || !canManageGroupMembers(membership.role)) {
    res.status(403).json({ error: 'Solo el administrador del grupo puede eliminar miembros' })
    return
  }

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
