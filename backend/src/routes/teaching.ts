import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireAppAction } from '../middleware/auth'
import {
  nextTeachingProposalStatus,
  proposalSupportCount,
} from '../utils/teachingState'
import {
  buildTeachingContributorAccessWhere,
  buildTeachingProposalReadAccessWhere,
} from '../domain/workflows/caseAccessWorkflow'
import { getTeachingAvailableActions } from '../domain/workflows/teachingWorkflow'
import { hasAppAction } from '../domain/workflows/appWorkflow'

const router = Router()

class DuplicateProposalError extends Error {
  constructor() { super('Este caso ya tiene una propuesta docente activa') }
}

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

function serializeProposal(item: any, viewer?: { id: string; role: string }) {
  const explicitRecommendationCount = item._count?.recommendations ?? item.recommendations?.length ?? 0
  const supportCount = proposalSupportCount({
    proposerId: item.proposerId,
    recommendationsCount: explicitRecommendationCount,
  })
  const reviewRequests = item.case?.reviewRequests ?? []
  const availableActions = viewer
    ? getTeachingAvailableActions({
        clinicalStatus: item.case?.statusClinical ?? 'Resolved',
        teachingStatus: item.status,
        isOwner: item.case?.ownerId === viewer.id,
        isReviewer: reviewRequests.some((request: any) =>
          (request.targetUserId === viewer.id && request.status === 'Accepted') || request.requestedBy === viewer.id,
        ),
        isCurator: hasAppAction(viewer.role, 'view_teaching_queue'),
        hasTeachingProposal: true,
        hasRecommended: Boolean(item.recommendations?.some((recommendation: any) => recommendation.authorId === viewer.id)),
        isProposer: item.proposerId === viewer.id,
        hasReviewRelationship: reviewRequests.some((request: any) =>
          request.targetUserId === viewer.id || request.requestedBy === viewer.id,
        ),
        isAuthenticated: true,
        supportCount,
      })
    : []

  return {
    ...item,
    availableActions,
    supportCount,
    tags: item.tags ? JSON.parse(item.tags) : [],
    case: item.case
      ? {
          ...item.case,
          tags: item.case.tags ? JSON.parse(item.case.tags) : [],
          status: item.case.statusClinical,
          statusClinical: undefined,
        }
      : item.case,
  }
}

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
          ownerId: true,
          owner: { select: { displayName: true } },
          reviewRequests: {
            select: {
              requestedBy: true,
              targetUserId: true,
              status: true,
            },
          },
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

  const response = items.map((item) => serializeProposal(item, req.user!))
  res.json(response)
})

router.get('/proposals/case/:caseId', async (req: AuthenticatedRequest, res) => {
  const caseId = req.params.caseId

  const accessibleCase = await prisma.case.findFirst({
    where: {
      id: caseId,
      ...buildTeachingProposalReadAccessWhere(req.user!.id),
    },
    select: { id: true },
  })

  if (!accessibleCase) {
    res.status(404).json({ error: 'Propuesta no encontrada' })
    return
  }

  const item = await prisma.teachingProposal.findFirst({
    where: {
      caseId,
      status: { in: ['Proposed', 'Recommended', 'Validated'] },
    },
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
          ownerId: true,
          owner: { select: { displayName: true } },
          reviewRequests: {
            select: {
              requestedBy: true,
              targetUserId: true,
              status: true,
            },
          },
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

  if (!item) {
    res.json(null)
    return
  }

  res.json(serializeProposal(item, req.user!))
})

// Listar biblioteca docente (casos validados) — acceso público a usuarios autenticados
router.get('/library', async (req: AuthenticatedRequest, res) => {
  const { q, difficulty, tags } = req.query

  const where: Record<string, unknown> = { status: 'Validated' }

  if (q) {
    const search = q as string
    where.OR = [
      { summary: { contains: search } },
      { case: { title: { contains: search } } },
      { case: { clinicalContext: { contains: search } } },
    ]
  }

  if (difficulty) {
    where.difficulty = difficulty as string
  }

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
          ownerId: true,
          owner: { select: { displayName: true } },
          reviewRequests: {
            select: {
              requestedBy: true,
              targetUserId: true,
              status: true,
            },
          },
        },
      },
      proposer: { select: { displayName: true } },
      _count: { select: { recommendations: true } },
    },
    orderBy: { validatedAt: 'desc' },
  })
  let response = items.map((item) => serializeProposal(item, req.user!))

  // Filtro por tags (post-query, SQLite no soporta JSON contains nativo)
  if (tags) {
    const tagList = (tags as string).split(',').map((t) => t.trim().toLowerCase())
    response = response.filter((item) =>
      tagList.every((tag) => item.tags.some((t: string) => t.toLowerCase().includes(tag)))
    )
  }

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
      ...buildTeachingContributorAccessWhere(req.user!.id),
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
        throw new DuplicateProposalError()
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
    if (err instanceof DuplicateProposalError) {
      res.status(409).json({ error: err.message })
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

  if (!proposal || !['Proposed', 'Recommended'].includes(proposal.status)) {
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
  const nextStatus = nextTeachingProposalStatus(proposal.status, proposalSupportCount({
    proposerId: proposal.proposerId,
    recommendationsCount: count,
  }))
  if (nextStatus !== proposal.status) {
    await prisma.teachingProposal.update({
      where: { id: req.params.id },
      data: { status: nextStatus },
    })
    await prisma.case.update({
      where: { id: proposal.caseId },
      data: { statusTeaching: nextStatus },
    })
  }

  res.status(201).json(rec)
})

// Validar/rechazar propuesta (solo Curator o Admin)
router.post('/proposals/:id/validate', requireAppAction('view_teaching_queue'), async (req: AuthenticatedRequest, res) => {
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

  const updated = await prisma.teachingProposal.update({
    where: { id: req.params.id },
    data: {
      status: parsed.data.status,
      validatedBy: req.user!.id,
      validatedAt: new Date(),
      rejectionReason: parsed.data.status === 'Rejected' ? parsed.data.rejectionReason : null,
    },
  })

  await prisma.case.update({
    where: { id: proposal.caseId },
    data: { statusTeaching: parsed.data.status === 'Validated' ? 'Validated' : 'Rejected' },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: proposal.caseId,
      action: parsed.data.status === 'Validated' ? 'TeachingValidated' : 'TeachingRejected',
      target: proposal.id,
      metadata: JSON.stringify({ reason: parsed.data.rejectionReason }),
    },
  })

  res.json(updated)
})

export default router
