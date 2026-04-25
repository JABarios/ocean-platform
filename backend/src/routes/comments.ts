import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const createCommentSchema = z.object({
  body: z.string().min(1),
  type: z.enum(['Comment', 'Conclusion', 'TeachingNote']).default('Comment'),
  requestId: z.string().uuid().optional(),
})

router.use(authMiddleware)

// Listar comentarios de un caso
router.get('/case/:caseId', async (req: AuthenticatedRequest, res) => {
  const comments = await prisma.comment.findMany({
    where: { caseId: req.params.caseId },
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, displayName: true } },
    },
  })
  const response = comments.map((c: any) => {
    const plain = JSON.parse(JSON.stringify(c))
    plain.content = plain.body
    delete plain.body
    return plain
  })
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
      OR: [
        { ownerId: req.user!.id },
        {
          reviewRequests: {
            some: {
              OR: [
                { targetUserId: req.user!.id, status: 'Accepted' },
                { requestedBy: req.user!.id },
              ],
            },
          },
        },
      ],
    },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
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

  const plain = JSON.parse(JSON.stringify(comment))
  plain.content = plain.body
  delete plain.body
  res.status(201).json(plain)
})

export default router
