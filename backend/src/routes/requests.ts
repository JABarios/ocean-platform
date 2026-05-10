import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { buildCaseUrl, sendReviewRequestEmail } from '../utils/email'
import { buildNotificationCaseTitle, createNotification, createNotificationsForUsers } from '../utils/notifications'
import { sendPushToUser } from '../utils/push'
import { sendTelegramToUser } from '../utils/telegram'
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
            where: { userId: viewerId, status: 'Accepted' },
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

async function notifyReviewRequest(params: {
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
}) {
  const caseItem = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: { id: true, title: true },
  })
  const requester = await prisma.user.findUnique({
    where: { id: params.requestedBy },
    select: { id: true, displayName: true },
  })

  if (!caseItem || !requester) return

  const caseTitle = caseItem.title?.trim() || `Caso ${caseItem.id.slice(0, 8)}`
  const caseUrl = buildCaseUrl(caseItem.id)

  if (params.targetUserId) {
    const targetUser = await prisma.user.findUnique({
      where: { id: params.targetUserId },
      select: { email: true, displayName: true, status: true },
    })
    if (!targetUser || targetUser.status !== 'Active') return

    await sendReviewRequestEmail({
      to: targetUser.email,
      displayName: targetUser.displayName,
      requesterName: requester.displayName,
      caseTitle,
      caseUrl,
      message: params.message,
    })
    return
  }

  if (params.targetGroupId) {
    const group = await prisma.group.findUnique({
      where: { id: params.targetGroupId },
      select: {
        name: true,
        members: {
          where: { status: 'Accepted' },
          select: {
            user: {
              select: { id: true, email: true, displayName: true, status: true },
            },
          },
        },
      },
    })
    if (!group) return

    const recipients = group.members
      .map((member) => member.user)
      .filter((user): user is NonNullable<typeof user> =>
        Boolean(user && user.id !== params.requestedBy && user.status === 'Active'),
      )

    await Promise.allSettled(recipients.map((user) =>
      sendReviewRequestEmail({
        to: user.email,
        displayName: user.displayName,
        requesterName: requester.displayName,
        caseTitle,
        caseUrl,
        message: params.message,
        groupName: group.name,
      }),
    ))
  }
}

async function pushReviewRequest(params: {
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
}) {
  const caseItem = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: { id: true, title: true },
  })
  const requester = await prisma.user.findUnique({
    where: { id: params.requestedBy },
    select: { displayName: true },
  })

  if (!caseItem || !requester) return

  const caseTitle = buildNotificationCaseTitle(caseItem)
  const pushPayload = {
    title: 'Nueva solicitud de revisión',
    body: `${requester.displayName} te ha enviado ${caseTitle} para revisar.`,
    url: buildCaseUrl(caseItem.id),
    tag: `review-request-${caseItem.id}`,
  }

  if (params.targetUserId) {
    await sendPushToUser(params.targetUserId, pushPayload)
    await sendTelegramToUser(params.targetUserId, {
      text: `${requester.displayName} te ha enviado ${caseTitle} para revisar en OCEAN.`,
      url: buildCaseUrl(caseItem.id),
    })
    return
  }

  if (params.targetGroupId) {
    const group = await prisma.group.findUnique({
      where: { id: params.targetGroupId },
      select: {
        members: {
          where: { status: 'Accepted' },
          select: { userId: true },
        },
      },
    })
    if (!group) return

    await Promise.allSettled(
      group.members
        .map((member) => member.userId)
        .filter((userId) => userId !== params.requestedBy)
        .flatMap((userId) => [
          sendPushToUser(userId, pushPayload),
          sendTelegramToUser(userId, {
            text: `${requester.displayName} ha enviado ${caseTitle} al grupo para revisar en OCEAN.`,
            url: buildCaseUrl(caseItem.id),
          }),
        ]),
    )
  }
}

async function createReviewRequestNotifications(params: {
  requestId: string
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
}) {
  const caseItem = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: { id: true, title: true },
  })
  const requester = await prisma.user.findUnique({
    where: { id: params.requestedBy },
    select: { displayName: true },
  })

  if (!caseItem || !requester) return

  const caseTitle = buildNotificationCaseTitle(caseItem)
  const title = 'Nueva solicitud de revisión'
  const body = `${requester.displayName} te ha enviado ${caseTitle} para revisar.`

  if (params.targetUserId) {
    await createNotification({
      userId: params.targetUserId,
      kind: 'review_request_received',
      title,
      body,
      caseId: params.caseId,
      reviewRequestId: params.requestId,
      actorUserId: params.requestedBy,
    })
    return
  }

  if (params.targetGroupId) {
    const group = await prisma.group.findUnique({
      where: { id: params.targetGroupId },
      select: {
        members: {
          where: { status: 'Accepted' },
          select: { userId: true },
        },
      },
    })

    if (!group) return

    await createNotificationsForUsers({
      userIds: group.members.map((member) => member.userId).filter((userId) => userId !== params.requestedBy),
      kind: 'review_request_received',
      title,
      body,
      caseId: params.caseId,
      groupId: params.targetGroupId,
      reviewRequestId: params.requestId,
      actorUserId: params.requestedBy,
    })
  }
}

async function createReviewDecisionNotification(params: {
  requestId: string
  caseId: string
  requestedBy: string
  actorUserId: string
  decision: 'accepted' | 'rejected'
}) {
  const [caseItem, actor] = await Promise.all([
    prisma.case.findUnique({
      where: { id: params.caseId },
      select: { id: true, title: true },
    }),
    prisma.user.findUnique({
      where: { id: params.actorUserId },
      select: { displayName: true },
    }),
  ])

  if (!caseItem || !actor || params.requestedBy === params.actorUserId) return

  await createNotification({
    userId: params.requestedBy,
    kind: params.decision === 'accepted' ? 'review_request_accepted' : 'review_request_rejected',
    title: params.decision === 'accepted' ? 'Solicitud aceptada' : 'Solicitud rechazada',
    body: `${actor.displayName} ha ${params.decision === 'accepted' ? 'aceptado' : 'rechazado'} tu solicitud sobre ${buildNotificationCaseTitle(caseItem)}.`,
    caseId: params.caseId,
    reviewRequestId: params.requestId,
    actorUserId: params.actorUserId,
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
            members: { some: { userId: req.user!.id, status: 'Accepted' } },
          },
          status: 'Pending',
        },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true, owner: { select: { displayName: true } } } },
      requester: { select: { id: true, displayName: true } },
      targetGroup: { select: { id: true, name: true } },
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
        {
          targetGroup: {
            members: { some: { userId: req.user!.id, status: 'Accepted' } },
          },
          status: 'Accepted',
        },
        { requestedBy: req.user!.id },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true } },
      requester: { select: { id: true, displayName: true } },
      targetUser: { select: { id: true, displayName: true } },
      targetGroup: { select: { id: true, name: true } },
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
        {
          targetGroup: {
            members: { some: { userId: req.user!.id, status: 'Accepted' } },
          },
          status: 'Expired',
        },
        { requestedBy: req.user!.id, status: 'Expired' },
      ],
    },
    include: {
      case: { select: { id: true, title: true, statusClinical: true, owner: { select: { displayName: true } } } },
      requester: { select: { id: true, displayName: true } },
      targetGroup: { select: { id: true, name: true } },
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
  if (targetUserId && targetGroupId) {
    res.status(400).json({ error: 'No puedes enviar la misma solicitud a un usuario y a un grupo a la vez' })
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

  if (targetGroupId) {
    const groupMembership = await prisma.groupMember.findUnique({
      where: { userId_groupId: { userId: req.user!.id, groupId: targetGroupId } },
      select: { status: true },
    })
    if (!groupMembership || groupMembership.status !== 'Accepted') {
      res.status(403).json({ error: 'Solo puedes enviar casos a grupos a los que perteneces' })
      return
    }
  }

  const request = await createReviewRequestForCase({
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
    message,
    auditAction: 'RequestSent',
  })

  await createReviewRequestNotifications({
    requestId: request.id,
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
  }).catch((err) => {
    console.warn('[OCEAN notifications] No se pudieron crear notificaciones de solicitud de revisión', err)
  })

  notifyReviewRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
    message,
  }).catch((err) => {
    console.warn('[OCEAN email] No se pudo notificar la solicitud de revisión', err)
  })

  pushReviewRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId,
    targetGroupId,
    message,
  }).catch((err) => {
    console.warn('[OCEAN push] No se pudo enviar el push de solicitud de revisión', err)
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

  await createReviewRequestNotifications({
    requestId: accessRequest.id,
    caseId,
    requestedBy: req.user!.id,
    targetUserId: caseItem.ownerId,
  }).catch((err) => {
    console.warn('[OCEAN notifications] No se pudieron crear notificaciones de solicitud de acceso', err)
  })

  notifyReviewRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId: caseItem.ownerId,
    message,
  }).catch((err) => {
    console.warn('[OCEAN email] No se pudo notificar la solicitud de acceso a revisión', err)
  })

  pushReviewRequest({
    caseId,
    requestedBy: req.user!.id,
    targetUserId: caseItem.ownerId,
    message,
  }).catch((err) => {
    console.warn('[OCEAN push] No se pudo enviar el push de solicitud de acceso', err)
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

  await createReviewDecisionNotification({
    requestId: updated.id,
    caseId: request.caseId,
    requestedBy: request.requestedBy,
    actorUserId: req.user!.id,
    decision: 'accepted',
  }).catch((err) => {
    console.warn('[OCEAN notifications] No se pudo crear la notificación de aceptación', err)
  })

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

  await createReviewDecisionNotification({
    requestId: updated.id,
    caseId: request.caseId,
    requestedBy: request.requestedBy,
    actorUserId: req.user!.id,
    decision: 'rejected',
  }).catch((err) => {
    console.warn('[OCEAN notifications] No se pudo crear la notificación de rechazo', err)
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
