import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { canCommentOnCase } from '../domain/workflows/caseWorkflow'
import { canReadCase } from '../domain/workflows/caseAccessWorkflow'

const router = Router()

const createCommentSchema = z.object({
  body: z.string().min(1),
  type: z.enum(['Comment', 'Conclusion', 'TeachingNote']).default('Comment'),
  requestId: z.string().uuid().optional(),
})

router.use(authMiddleware)

// Listar comentarios de un caso
router.get('/case/:caseId', async (req: AuthenticatedRequest, res) => {
  const caseItem = await prisma.case.findFirst({
    where: {
      id: req.params.caseId,
    },
    select: {
      ownerId: true,
      statusTeaching: true,
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
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
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
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

  res.status(201).json({ ...comment, content: comment.body, body: undefined })
})

export default router
