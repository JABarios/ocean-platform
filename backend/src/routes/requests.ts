import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { getReviewRequestAvailableActions } from '../domain/workflows/reviewRequestWorkflow'

const router = Router()

const createRequestSchema = z.object({
  caseId: z.string().uuid(),
  targetUserId: z.string().uuid().optional(),
  targetGroupId: z.string().uuid().optional(),
  message: z.string().optional(),
})

const requestAccessSchema = z.object({
  caseId: z.string().uuid(),
  message: z.string().optional(),
})

router.use(authMiddleware)

function serializeRequest(item: any, viewer: { id: string }) {
  return {
    ...item,
    availableActions: getReviewRequestAvailableActions({
      status: item.status,
      isRequester: item.requestedBy === viewer.id,
      isTargetUser: item.targetUserId === viewer.id,
    }),
    case: item.case ? { ...item.case, status: item.case.statusClinical, statusClinical: undefined } : item.case,
  }
}

async function createPendingRequest(params: {
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
}) {
  return prisma.reviewRequest.create({
    data: {
      caseId: params.caseId,
      requestedBy: params.requestedBy,
      targetUserId: params.targetUserId,
      targetGroupId: params.targetGroupId,
      message: params.message,
      status: 'Pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
}

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
  const response = requests.map((r) => serializeRequest(r, req.user!))
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
  const response = requests.map((r) => serializeRequest(r, req.user!))
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
  const response = requests.map((r) => serializeRequest(r, req.user!))
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

  const request = await createPendingRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
    message,
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

// Solicitar acceso a la revisión de un caso propuesto
router.post('/request-access', async (req: AuthenticatedRequest, res) => {
  const parsed = requestAccessSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const { caseId, message } = parsed.data
  const caseItem = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      ownerId: true,
      statusTeaching: true,
      reviewRequests: {
        select: {
          id: true,
          requestedBy: true,
          targetUserId: true,
          status: true,
        },
      },
    },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  if (!['Proposed', 'Recommended'].includes(caseItem.statusTeaching)) {
    res.status(400).json({ error: 'Solo puedes solicitar acceso a casos propuestos o recomendados' })
    return
  }

  if (caseItem.ownerId === req.user!.id) {
    res.status(400).json({ error: 'Ya eres el propietario del caso' })
    return
  }

  const alreadyLinked = caseItem.reviewRequests.some((item) =>
    item.requestedBy === req.user!.id || item.targetUserId === req.user!.id
  )
  if (alreadyLinked) {
    res.status(409).json({ error: 'Ya existe una relación de revisión con este caso' })
    return
  }

  const accessRequest = await createPendingRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId: caseItem.ownerId,
    message,
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId,
      action: 'ReviewAccessRequested',
      target: accessRequest.id,
    },
  })

  res.status(201).json(accessRequest)
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

// Reenviar solicitud del propietario
router.post('/:id/resend', async (req: AuthenticatedRequest, res) => {
  const existing = await prisma.reviewRequest.findFirst({
    where: {
      id: req.params.id,
      requestedBy: req.user!.id,
      status: { in: ['Pending', 'Rejected', 'Expired'] },
    },
  })

  if (!existing) {
    res.status(404).json({ error: 'Solicitud no encontrada o no reenviable' })
    return
  }

  const updated = await prisma.reviewRequest.update({
    where: { id: req.params.id },
    data: {
      status: 'Pending',
      acceptedAt: null,
      completedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: existing.caseId,
      action: 'RequestResent',
      target: existing.id,
    },
  })

  res.json(updated)
})

// Retirar solicitud del propietario
router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const existing = await prisma.reviewRequest.findFirst({
    where: {
      id: req.params.id,
      requestedBy: req.user!.id,
      status: { in: ['Pending', 'Rejected', 'Expired'] },
    },
  })

  if (!existing) {
    res.status(404).json({ error: 'Solicitud no encontrada o no retirable' })
    return
  }

  await prisma.reviewRequest.delete({
    where: { id: req.params.id },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: existing.caseId,
      action: 'RequestWithdrawn',
      target: existing.id,
    },
  })

  res.status(204).send()
})

export default router
