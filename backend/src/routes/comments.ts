import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { canCommentOnCase } from '../domain/workflows/caseWorkflow'
import { canReadCase } from '../domain/workflows/caseAccessWorkflow'
import { buildNotificationCaseTitle, createNotificationsForUsers } from '../utils/notifications'
import { buildCaseUrl } from '../utils/email'
import { sendPushToUser } from '../utils/push'

const router = Router()

const createCommentSchema = z.object({
  body: z.string().min(1),
  type: z.enum(['Comment', 'Conclusion', 'TeachingNote']).default('Comment'),
  requestId: z.string().uuid().optional(),
})

router.use(authMiddleware)

async function createCommentNotifications(params: {
  caseId: string
  commentId: string
  authorId: string
}) {
  const caseItem = await prisma.case.findUnique({
    where: { id: params.caseId },
    select: {
      id: true,
      title: true,
      ownerId: true,
      reviewRequests: {
        where: {
          status: { in: ['Pending', 'Accepted', 'Completed'] },
        },
        select: {
          requestedBy: true,
          targetUserId: true,
          targetGroup: {
            select: {
              members: {
                where: { status: 'Accepted' },
                select: { userId: true },
              },
            },
          },
        },
      },
    },
  })

  const author = await prisma.user.findUnique({
    where: { id: params.authorId },
    select: { displayName: true },
  })

  if (!caseItem || !author) return

  const recipients = new Set<string>()
  if (caseItem.ownerId !== params.authorId) {
    recipients.add(caseItem.ownerId)
  }

  for (const request of caseItem.reviewRequests) {
    if (request.requestedBy && request.requestedBy !== params.authorId) {
      recipients.add(request.requestedBy)
    }
    if (request.targetUserId && request.targetUserId !== params.authorId) {
      recipients.add(request.targetUserId)
    }
    for (const member of request.targetGroup?.members || []) {
      if (member.userId !== params.authorId) {
        recipients.add(member.userId)
      }
    }
  }

  if (!recipients.size) return

  await createNotificationsForUsers({
    userIds: [...recipients],
    kind: 'comment_on_case',
    title: 'Nuevo comentario en caso',
    body: `${author.displayName} ha comentado en ${buildNotificationCaseTitle(caseItem)}.`,
    caseId: params.caseId,
    commentId: params.commentId,
    actorUserId: params.authorId,
  })

  const pushPayload = {
    title: 'Nuevo comentario en caso',
    body: `${author.displayName} ha comentado en ${buildNotificationCaseTitle(caseItem)}.`,
    url: buildCaseUrl(caseItem.id),
    tag: `case-comment-${caseItem.id}`,
  }

  await Promise.allSettled([...recipients].map((userId) => sendPushToUser(userId, pushPayload)))
}

// Listar comentarios de un caso
router.get('/case/:caseId', async (req: AuthenticatedRequest, res) => {
  const caseItem = await prisma.case.findFirst({
    where: {
      id: req.params.caseId,
    },
    select: {
      ownerId: true,
      statusTeaching: true,
      visibility: true,
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
          targetGroup: {
            select: {
              members: {
                where: { userId: req.user!.id, status: 'Accepted' },
                select: { userId: true, status: true },
              },
            },
          },
        },
      },
    },
  })

  if (!caseItem || !canReadCase(caseItem, req.user!.id, req.user?.role)) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
  }

  const comments = await prisma.comment.findMany({
    where: { caseId: req.params.caseId },
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, displayName: true } },
    },
  })
  const response = comments.map((c) => ({
    ...c,
    content: c.body,
    body: undefined,
  }))
  res.json(response)
})

// Crear comentario en un caso
router.post('/case/:caseId', async (req: AuthenticatedRequest, res) => {
  const parsed = createCommentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const caseItem = await prisma.case.findFirst({
    where: {
      id: req.params.caseId,
    },
    select: {
      ownerId: true,
      statusClinical: true,
      statusTeaching: true,
      visibility: true,
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
          targetGroup: {
            select: {
              members: {
                where: { userId: req.user!.id, status: 'Accepted' },
                select: { userId: true, status: true },
              },
            },
          },
        },
      },
    },
  })

  if (!caseItem || !canCommentOnCase(caseItem, req.user!)) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
  }

  if (parsed.data.requestId) {
    const request = await prisma.reviewRequest.findUnique({
      where: { id: parsed.data.requestId },
      select: {
        caseId: true,
        requestedBy: true,
        targetUserId: true,
        status: true,
      },
    })

    if (!request || request.caseId !== req.params.caseId) {
      res.status(400).json({ error: 'La solicitud vinculada no pertenece a este caso' })
      return
    }
  }

  const comment = await prisma.comment.create({
    data: {
      caseId: req.params.caseId,
      authorId: req.user!.id,
      requestId: parsed.data.requestId,
      body: parsed.data.body,
      type: parsed.data.type,
    },
    include: {
      author: { select: { id: true, displayName: true } },
    },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: req.params.caseId,
      action: 'Commented',
      target: comment.id,
    },
  })

  await createCommentNotifications({
    caseId: req.params.caseId,
    commentId: comment.id,
    authorId: req.user!.id,
  }).catch((err) => {
    console.warn('[OCEAN notifications] No se pudieron crear notificaciones de comentario', err)
  })

  res.status(201).json({ ...comment, content: comment.body, body: undefined })
})

export default router
