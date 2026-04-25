import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const createRequestSchema = z.object({
  caseId: z.string().uuid(),
  targetUserId: z.string().uuid().optional(),
  targetGroupId: z.string().uuid().optional(),
  message: z.string().optional(),
})

router.use(authMiddleware)

// Listar solicitudes donde el usuario es destinatario (pendientes)
router.get('/pending', async (req: AuthenticatedRequest, res) => {
  const requests = await prisma.reviewRequest.findMany({
    where: {
      OR: [
        { targetUserId: req.user!.id, status: 'Pending' },
        {
          targetGroup: {
            members: { some: { userId: req.user!.id } },
          },
          status: 'Pending',
        },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true, owner: { select: { displayName: true } } } },
      requester: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const response = requests.map((r) => ({
    ...r,
    case: r.case ? { ...r.case, status: r.case.statusClinical, statusClinical: undefined } : r.case,
  }))
  res.json(response)
})

// Listar solicitudes activas (aceptadas) del usuario
router.get('/active', async (req: AuthenticatedRequest, res) => {
  const requests = await prisma.reviewRequest.findMany({
    where: {
      OR: [
        { targetUserId: req.user!.id, status: 'Accepted' },
        { requestedBy: req.user!.id },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true } },
      requester: { select: { id: true, displayName: true } },
      targetUser: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  const response = requests.map((r) => ({
    ...r,
    case: r.case ? { ...r.case, status: r.case.statusClinical, statusClinical: undefined } : r.case,
  }))
  res.json(response)
})

// Listar solicitudes expiradas del usuario (como destinatario o solicitante)
router.get('/expired', async (req: AuthenticatedRequest, res) => {
  const requests = await prisma.reviewRequest.findMany({
    where: {
      OR: [
        { targetUserId: req.user!.id, status: 'Expired' },
        { requestedBy: req.user!.id, status: 'Expired' },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true, owner: { select: { displayName: true } } } },
      requester: { select: { id: true, displayName: true } },
    },
    orderBy: { expiresAt: 'desc' },
  })
  const response = requests.map((r) => ({
    ...r,
    case: r.case ? { ...r.case, status: r.case.statusClinical, statusClinical: undefined } : r.case,
  }))
  res.json(response)
})

// Crear solicitud de revisión
router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const { caseId, targetUserId, targetGroupId, message } = parsed.data
  if (!targetUserId && !targetGroupId) {
    res.status(400).json({ error: 'Debe especificar un destinatario o grupo' })
    return
  }

  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, ownerId: req.user!.id },
  })
  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const request = await prisma.reviewRequest.create({
    data: {
      caseId,
      requestedBy: req.user!.id,
      targetUserId,
      targetGroupId,
      message,
      status: 'Pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
    },
  })

  // Si el caso estaba en Draft, pasar a Requested
  if (caseItem.statusClinical === 'Draft') {
    await prisma.case.update({
      where: { id: caseId },
      data: { statusClinical: 'Requested' },
    })
  }

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId,
      action: 'RequestSent',
      target: request.id,
    },
  })

  res.status(201).json(request)
})

// Aceptar solicitud
router.post('/:id/accept', async (req: AuthenticatedRequest, res) => {
  const request = await prisma.reviewRequest.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { targetUserId: req.user!.id },
        {
          targetGroup: {
            members: { some: { userId: req.user!.id } },
          },
        },
      ],
      status: 'Pending',
    },
  })

  if (!request) {
    res.status(404).json({ error: 'Solicitud no encontrada o no disponible' })
    return
  }

  const [updated] = await prisma.$transaction([
    prisma.reviewRequest.update({
      where: { id: req.params.id },
      data: { status: 'Accepted', acceptedAt: new Date() },
    }),
    prisma.case.update({
      where: { id: request.caseId },
      data: { statusClinical: 'InReview' },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: req.user!.id,
        caseId: request.caseId,
        action: 'RequestAccepted',
        target: request.id,
      },
    }),
  ])

  res.json(updated)
})

// Rechazar solicitud
router.post('/:id/reject', async (req: AuthenticatedRequest, res) => {
  const request = await prisma.reviewRequest.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { targetUserId: req.user!.id },
        {
          targetGroup: {
            members: { some: { userId: req.user!.id } },
          },
        },
      ],
      status: 'Pending',
    },
  })

  if (!request) {
    res.status(404).json({ error: 'Solicitud no encontrada' })
    return
  }

  const updated = await prisma.reviewRequest.update({
    where: { id: req.params.id },
    data: { status: 'Rejected' },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: request.caseId,
      action: 'RequestRejected',
      target: request.id,
    },
  })

  res.json(updated)
})

export default router
