import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'

const router = Router()

const proposeSchema = z.object({
  caseId: z.string().uuid(),
  summary: z.string().min(1),
  keyFindings: z.string().optional(),
  learningPoints: z.string().optional(),
  difficulty: z.enum(['Introductory', 'Intermediate', 'Advanced']).default('Intermediate'),
  tags: z.array(z.string()).default([]),
})

const validateSchema = z.object({
  status: z.enum(['Validated', 'Rejected']),
  rejectionReason: z.string().optional(),
})

router.use(authMiddleware)

// Listar propuestas docentes (cola de curación)
router.get('/proposals', async (req: AuthenticatedRequest, res) => {
  const status = req.query.status as string | undefined
  const where = status ? { status } : { status: { in: ['Proposed', 'Recommended'] } }

  const items = await prisma.teachingProposal.findMany({
    where,
    include: {
      case: {
        select: {
          id: true,
          title: true,
          clinicalContext: true,
          ageRange: true,
          modality: true,
          tags: true,
          statusClinical: true,
          owner: { select: { displayName: true } },
        },
      },
      proposer: { select: { id: true, displayName: true } },
      recommendations: {
        include: { author: { select: { id: true, displayName: true } } },
      },
      _count: { select: { recommendations: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  const response = items.map((item) => ({
    ...item,
    tags: item.tags ? JSON.parse(item.tags) : [],
    case: item.case
      ? {
          ...item.case,
          tags: item.case.tags ? JSON.parse(item.case.tags) : [],
          status: item.case.statusClinical,
          statusClinical: undefined,
        }
      : item.case,
  }))
  res.json(response)
})

// Listar biblioteca docente (casos validados) — acceso público a usuarios autenticados
router.get('/library', async (req: AuthenticatedRequest, res) => {
  const items = await prisma.teachingProposal.findMany({
    where: { status: 'Validated' },
    include: {
      case: {
        select: {
          id: true,
          title: true,
          clinicalContext: true,
          ageRange: true,
          modality: true,
          tags: true,
          owner: { select: { displayName: true } },
        },
      },
      proposer: { select: { displayName: true } },
      _count: { select: { recommendations: true } },
    },
    orderBy: { validatedAt: 'desc' },
  })
  const response = items.map((item) => ({
    ...item,
    tags: item.tags ? JSON.parse(item.tags) : [],
    case: item.case
      ? { ...item.case, tags: item.case.tags ? JSON.parse(item.case.tags) : [] }
      : item.case,
  }))
  res.json(response)
})

// Proponer caso para docencia
router.post('/proposals', async (req: AuthenticatedRequest, res) => {
  const parsed = proposeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const { caseId, summary, keyFindings, learningPoints, difficulty, tags } = parsed.data

  const caseItem = await prisma.case.findFirst({
    where: {
      id: caseId,
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
      statusClinical: { in: ['Resolved', 'Archived'] },
    },
  })

  if (!caseItem) {
    res.status(400).json({ error: 'Caso no disponible para proponer (debe estar Resuelto o Archivado y tener acceso)' })
    return
  }

  let proposal: Awaited<ReturnType<typeof prisma.teachingProposal.create>>
  try {
    proposal = await prisma.$transaction(async (tx) => {
      const existing = await tx.teachingProposal.findFirst({
        where: { caseId, status: { in: ['Proposed', 'Recommended', 'Validated'] } },
      })
      if (existing) {
        throw Object.assign(new Error('duplicate'), { code: 'DUPLICATE_PROPOSAL' })
      }
      const created = await tx.teachingProposal.create({
        data: {
          caseId,
          proposerId: req.user!.id,
          summary,
          keyFindings,
          learningPoints,
          difficulty,
          tags: JSON.stringify(tags),
          status: 'Proposed',
        },
      })
      await tx.case.update({
        where: { id: caseId },
        data: { statusTeaching: 'Proposed' },
      })
      return created
    })
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException & { code?: string }).code === 'DUPLICATE_PROPOSAL') {
      res.status(409).json({ error: 'Este caso ya tiene una propuesta docente activa' })
      return
    }
    throw err
  }

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId,
      action: 'TeachingProposed',
      target: proposal.id,
    },
  })

  res.status(201).json(proposal)
})

// Recomendar una propuesta docente
router.post('/proposals/:id/recommend', async (req: AuthenticatedRequest, res) => {
  const proposal = await prisma.teachingProposal.findUnique({
    where: { id: req.params.id },
    include: {
      case: true,
    },
  })

  if (!proposal || proposal.status === 'Rejected') {
    res.status(404).json({ error: 'Propuesta no encontrada' })
    return
  }

  // No se permite recomendar la propia propuesta
  if (proposal.proposerId === req.user!.id) {
    res.status(403).json({ error: 'No puedes recomendar tu propia propuesta' })
    return
  }

  const existingRec = await prisma.teachingRecommendation.findFirst({
    where: { proposalId: req.params.id, authorId: req.user!.id },
  })
  if (existingRec) {
    res.status(409).json({ error: 'Ya has recomendado esta propuesta' })
    return
  }

  const rec = await prisma.teachingRecommendation.create({
    data: {
      proposalId: req.params.id,
      authorId: req.user!.id,
      rationale: req.body.rationale,
    },
  })

  // Si alcanza umbral (ej. 2), marcar como Recommended
  const count = await prisma.teachingRecommendation.count({
    where: { proposalId: req.params.id },
  })
  if (count >= 2 && proposal.status === 'Proposed') {
    await prisma.$transaction([
      prisma.teachingProposal.update({
        where: { id: req.params.id },
        data: { status: 'Recommended' },
      }),
      prisma.case.update({
        where: { id: proposal.caseId },
        data: { statusTeaching: 'Recommended' },
      }),
    ])
  }

  res.status(201).json(rec)
})

// Validar/rechazar propuesta (solo Curator o Admin)
router.post('/proposals/:id/validate', requireRole(['Curator', 'Admin']), async (req: AuthenticatedRequest, res) => {
  const parsed = validateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const proposal = await prisma.teachingProposal.findUnique({
    where: { id: req.params.id },
  })
  if (!proposal) {
    res.status(404).json({ error: 'Propuesta no encontrada' })
    return
  }

  const [updated] = await prisma.$transaction([
    prisma.teachingProposal.update({
      where: { id: req.params.id },
      data: {
        status: parsed.data.status,
        validatedBy: req.user!.id,
        validatedAt: new Date(),
        rejectionReason: parsed.data.status === 'Rejected' ? parsed.data.rejectionReason : null,
      },
    }),
    prisma.case.update({
      where: { id: proposal.caseId },
      data: { statusTeaching: parsed.data.status === 'Validated' ? 'Validated' : 'Rejected' },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: req.user!.id,
        caseId: proposal.caseId,
        action: parsed.data.status === 'Validated' ? 'TeachingValidated' : 'TeachingRejected',
        target: proposal.id,
        metadata: JSON.stringify({ reason: parsed.data.rejectionReason }),
      },
    }),
  ])

  res.json(updated)
})

export default router
