import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import {
  getNextReviewRequestState,
  getReviewRequestAvailableActions,
} from '../domain/workflows/reviewRequestWorkflow'
import { getAllowedClinicalEvents, getNextClinicalState } from '../domain/workflows/clinicalWorkflow'
import { getCaseAvailableActions } from '../domain/workflows/caseWorkflow'

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

function getReviewRequestWorkflowInput(item: any, viewer: { id: string }, isTargetGroupMember = false) {
  return {
    status: item.status,
    isRequester: item.requestedBy === viewer.id,
    isTargetUser: item.targetUserId === viewer.id,
    isTargetGroupMember,
  }
}

async function loadRequestWithViewerScope(requestId: string, viewerId: string) {
  return prisma.reviewRequest.findUnique({
    where: { id: requestId },
    include: {
      targetGroup: {
        select: {
          id: true,
          members: {
            where: { userId: viewerId },
            select: { userId: true },
          },
        },
      },
    },
  })
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

async function createReviewRequestForCase(params: {
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
  auditAction: string
}) {
  const request = await createPendingRequest({
    caseId: params.caseId,
    requestedBy: params.requestedBy,
    targetUserId: params.targetUserId,
    targetGroupId: params.targetGroupId,
    message: params.message,
  })

  const caseItem = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: { id: true, statusClinical: true },
  })

  if (
    caseItem
    && getAllowedClinicalEvents(caseItem.statusClinical).includes('REQUEST_REVIEW')
    && getNextClinicalState(caseItem.statusClinical, 'REQUEST_REVIEW') === 'Requested'
  ) {
    await prisma.case.update({
      where: { id: params.caseId },
      data: { statusClinical: 'Requested' },
    })
  }

  await prisma.auditEvent.create({
    data: {
      actorId: params.requestedBy,
      caseId: params.caseId,
      action: params.auditAction,
      target: request.id,
    },
  })

  return request
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

  const caseItem = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      ownerId: true,
      statusClinical: true,
      statusTeaching: true,
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
        },
      },
      teachingProposals: {
        where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
        take: 1,
        select: {
          proposerId: true,
          recommendations: { select: { authorId: true } },
        },
      },
    },
  })
  if (!caseItem || !getCaseAvailableActions(caseItem, req.user!).includes('send_review_request')) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const request = await createReviewRequestForCase({
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
    message,
    auditAction: 'RequestSent',
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
      statusClinical: true,
      statusTeaching: true,
      reviewRequests: {
        select: {
          id: true,
          requestedBy: true,
          targetUserId: true,
          status: true,
        },
      },
      teachingProposals: {
        where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
        take: 1,
        select: {
          proposerId: true,
          recommendations: { select: { authorId: true } },
        },
      },
    },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  if (!getCaseAvailableActions(caseItem, req.user!).includes('request_review_access')) {
    const alreadyLinked = caseItem.reviewRequests.some((item) =>
      item.requestedBy === req.user!.id || item.targetUserId === req.user!.id
    )
    if (alreadyLinked) {
      res.status(409).json({ error: 'Ya existe una relación de revisión con este caso' })
      return
    }
    if (caseItem.ownerId === req.user!.id) {
      res.status(400).json({ error: 'Ya eres el propietario del caso' })
      return
    }
    res.status(400).json({ error: 'Solo puedes solicitar acceso a casos propuestos o recomendados' })
    return
  }

  const accessRequest = await createReviewRequestForCase({
    caseId,
    requestedBy: req.user!.id,
    targetUserId: caseItem.ownerId,
    message,
    auditAction: 'ReviewAccessRequested',
  })

  res.status(201).json(accessRequest)
})

// Aceptar solicitud
router.post('/:id/accept', async (req: AuthenticatedRequest, res) => {
  const request = await loadRequestWithViewerScope(req.params.id, req.user!.id)

  if (!request) {
    res.status(404).json({ error: 'Solicitud no encontrada o no disponible' })
    return
  }

  const isTargetGroupMember = Boolean(request.targetGroup?.members?.length)
  const workflowInput = getReviewRequestWorkflowInput(request, req.user!, isTargetGroupMember)
  if (!getReviewRequestAvailableActions(workflowInput).includes('accept_review_request')) {
    res.status(404).json({ error: 'Solicitud no encontrada o no disponible' })
    return
  }

  const nextStatus = getNextReviewRequestState(workflowInput, { type: 'ACCEPT' })
  const caseItem = await prisma.case.findUnique({
    where: { id: request.caseId },
    select: { id: true, statusClinical: true },
  })
  const nextClinicalStatus = caseItem
    && getAllowedClinicalEvents(caseItem.statusClinical).includes('START_REVIEW')
    ? getNextClinicalState(caseItem.statusClinical, 'START_REVIEW')
    : undefined

  const [updated] = await prisma.$transaction([
    prisma.reviewRequest.update({
      where: { id: req.params.id },
      data: { status: nextStatus, acceptedAt: new Date() },
    }),
    ...(nextClinicalStatus
      ? [
          prisma.case.update({
            where: { id: request.caseId },
            data: { statusClinical: nextClinicalStatus },
          }),
        ]
      : []),
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
  const request = await loadRequestWithViewerScope(req.params.id, req.user!.id)

  if (!request) {
    res.status(404).json({ error: 'Solicitud no encontrada' })
    return
  }

  const isTargetGroupMember = Boolean(request.targetGroup?.members?.length)
  const workflowInput = getReviewRequestWorkflowInput(request, req.user!, isTargetGroupMember)
  if (!getReviewRequestAvailableActions(workflowInput).includes('reject_review_request')) {
    res.status(404).json({ error: 'Solicitud no encontrada' })
    return
  }

  const nextStatus = getNextReviewRequestState(workflowInput, { type: 'REJECT' })

  const updated = await prisma.reviewRequest.update({
    where: { id: req.params.id },
    data: { status: nextStatus },
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
  const existing = await loadRequestWithViewerScope(req.params.id, req.user!.id)

  if (!existing) {
    res.status(404).json({ error: 'Solicitud no encontrada o no reenviable' })
    return
  }

  const workflowInput = getReviewRequestWorkflowInput(existing, req.user!)
  if (!getReviewRequestAvailableActions(workflowInput).includes('resend_review_request')) {
    res.status(404).json({ error: 'Solicitud no encontrada o no reenviable' })
    return
  }

  const nextStatus = getNextReviewRequestState(workflowInput, { type: 'RESEND' })

  const updated = await prisma.reviewRequest.update({
    where: { id: req.params.id },
    data: {
      status: nextStatus,
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
  const existing = await loadRequestWithViewerScope(req.params.id, req.user!.id)

  if (!existing) {
    res.status(404).json({ error: 'Solicitud no encontrada o no retirable' })
    return
  }

  const workflowInput = getReviewRequestWorkflowInput(existing, req.user!)
  if (!getReviewRequestAvailableActions(workflowInput).includes('withdraw_review_request')) {
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
