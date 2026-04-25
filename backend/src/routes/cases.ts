import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const createCaseSchema = z.object({
  title: z.string().min(1).optional(),
  clinicalContext: z.string().optional(),
  ageRange: z.string().optional(),
  studyReason: z.string().optional(),
  modality: z.string().default('EEG'),
  tags: z.array(z.string()).default([]),
})

const updateStatusSchema = z.object({
  statusClinical: z.enum(['Draft', 'Requested', 'InReview', 'Resolved', 'Archived']),
})

router.use(authMiddleware)

function safeParseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function toCaseResponse(caseObj: Record<string, unknown>) {
  return {
    ...caseObj,
    status: caseObj.statusClinical,
    teachingStatus: caseObj.statusTeaching,
    tags: safeParseJson(caseObj.tags) ?? [],
    summaryMetrics: safeParseJson(caseObj.summaryMetrics),
  }
}

// Listar casos del usuario autenticado
router.get('/', async (req: AuthenticatedRequest, res) => {
  const cases = await prisma.case.findMany({
    where: { ownerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { reviewRequests: true, comments: true } },
    },
  })
  res.json(cases.map(toCaseResponse))
})

// Crear caso
router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createCaseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues })
    return
  }

  const data = parsed.data
  const newCase = await prisma.case.create({
    data: {
      title: data.title,
      clinicalContext: data.clinicalContext,
      ageRange: data.ageRange,
      studyReason: data.studyReason,
      modality: data.modality,
      tags: JSON.stringify(data.tags),
      ownerId: req.user!.id,
      statusClinical: 'Draft',
      statusTeaching: 'None',
    },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: newCase.id,
      action: 'CaseCreated',
      target: newCase.id,
    },
  })

  res.status(201).json(toCaseResponse(newCase))
})

// Obtener caso por ID
router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const caseItem = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      OR: [
        { ownerId: req.user!.id },
        {
          reviewRequests: {
            some: {
              OR: [
                { targetUserId: req.user!.id },
                { requestedBy: req.user!.id },
              ],
            },
          },
        },
      ],
    },
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      package: true,
      reviewRequests: {
        include: {
          requester: { select: { id: true, displayName: true } },
          targetUser: { select: { id: true, displayName: true } },
        },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, displayName: true } } },
      },
    },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
  }

  res.json(toCaseResponse(caseItem))
})

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Requested', 'Archived'],
  Requested: ['Draft', 'InReview', 'Archived'],
  InReview: ['Resolved', 'Archived'],
  Resolved: ['Archived'],
  Archived: [],
}

// Actualizar estado clínico
router.patch('/:id/status', async (req: AuthenticatedRequest, res) => {
  const parsed = updateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Estado inválido' })
    return
  }

  const caseItem = await prisma.case.findFirst({
    where: { id: req.params.id, ownerId: req.user!.id },
  })
  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const allowed = VALID_TRANSITIONS[caseItem.statusClinical] ?? []
  if (!allowed.includes(parsed.data.statusClinical)) {
    res.status(400).json({
      error: `Transición no permitida: ${caseItem.statusClinical} → ${parsed.data.statusClinical}`,
    })
    return
  }

  const updateData: { statusClinical: string; resolvedAt?: Date } = {
    statusClinical: parsed.data.statusClinical,
  }
  if (parsed.data.statusClinical === 'Resolved') {
    updateData.resolvedAt = new Date()
  }

  const updated = await prisma.case.update({
    where: { id: req.params.id },
    data: updateData,
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: updated.id,
      action: 'StatusChanged',
      target: updated.id,
      metadata: JSON.stringify({ newStatus: parsed.data.statusClinical }),
    },
  })

  res.json(toCaseResponse(updated))
})

export default router
