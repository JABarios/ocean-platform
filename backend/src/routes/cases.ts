import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { deleteBlob } from '../utils/storage'
import { buildCaseReadAccessWhere } from '../domain/workflows/caseAccessWorkflow'
import { getAllowedClinicalEvents, getNextClinicalState } from '../domain/workflows/clinicalWorkflow'
import { decorateCaseReviewRequests, getCaseAvailableActions } from '../domain/workflows/caseWorkflow'
import { hasAppAction } from '../domain/workflows/appWorkflow'

const router = Router()

const createCaseSchema = z.object({
  title: z.string().min(1).optional(),
  clinicalContext: z.string().optional(),
  ageRange: z.string().optional(),
  studyReason: z.string().optional(),
  modality: z.string().default('EEG'),
  tags: z.array(z.string()).default([]),
  visibility: z.enum(['Private', 'Institutional', 'Public']).default('Private'),
  galleryRecordId: z.string().uuid().optional(),
})

const updateStatusSchema = z.object({
  statusClinical: z.enum(['Draft', 'Requested', 'InReview', 'Resolved', 'Archived']),
})

const updateVisibilitySchema = z.object({
  visibility: z.enum(['Private', 'Institutional', 'Public']),
})

router.use(authMiddleware)

function canSeeAllCases(req: AuthenticatedRequest) {
  return req.user ? hasAppAction(req.user.role, 'access_admin') : false
}

function safeParseJson(value: any): any {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function getCaseInclude(viewerId?: string) {
  return {
    owner: { select: { id: true, displayName: true, email: true } },
    package: true,
    accessSecret: { select: { id: true } },
    reviewRequests: {
      include: {
        requester: { select: { id: true, displayName: true } },
        targetUser: { select: { id: true, displayName: true, email: true } },
        targetGroup: {
          select: {
            id: true,
            name: true,
            members: viewerId
              ? {
                  where: { userId: viewerId, status: 'Accepted' },
                  select: { userId: true, status: true },
                }
              : false,
          },
        },
      },
    },
    comments: {
      orderBy: { createdAt: 'asc' as const },
      include: { author: { select: { id: true, displayName: true } } },
    },
    teachingProposals: {
      where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      include: {
        recommendations: {
          select: { authorId: true },
        },
      },
    },
  }
}

function toCaseResponse(caseObj: any, viewer?: { id: string; role: string }) {
  const plain = JSON.parse(JSON.stringify(caseObj))
  plain.status = plain.statusClinical
  plain.teachingStatus = plain.statusTeaching
  plain.tags = safeParseJson(plain.tags) ?? []
  plain.summaryMetrics = safeParseJson(plain.summaryMetrics)
  plain.storedKeyAvailable = !!plain.accessSecret
  plain.availableActions = getCaseAvailableActions(caseObj, viewer)
  plain.reviewRequests = decorateCaseReviewRequests(plain.reviewRequests, viewer)
  delete plain.accessSecret
  return plain
}

async function safeDeleteBlob(blobLocation: string) {
  try {
    await deleteBlob(blobLocation)
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.name === 'NoSuchKey') return
    throw err
  }
}

router.get('/', async (req: AuthenticatedRequest, res) => {
  const cases = await prisma.case.findMany({
    where: canSeeAllCases(req) ? undefined : { ownerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { reviewRequests: true, comments: true } },
      owner: { select: { id: true, displayName: true, email: true } },
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
        },
      },
      teachingProposals: {
        where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          recommendations: {
            select: { authorId: true },
          },
        },
      },
    },
  })

  res.json(cases.map((item) => toCaseResponse(item, req.user!)))
})

router.get('/managed', async (req: AuthenticatedRequest, res) => {
  const cases = await prisma.case.findMany({
    where: canSeeAllCases(req) ? undefined : { ownerId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, displayName: true, email: true } },
      package: true,
      accessSecret: { select: { id: true } },
      reviewRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
          requester: { select: { id: true, displayName: true } },
          targetUser: { select: { id: true, displayName: true, email: true } },
          targetGroup: { select: { id: true, name: true } },
        },
      },
      teachingProposals: {
        where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          recommendations: {
            select: { authorId: true },
          },
        },
      },
      _count: { select: { comments: true } },
    },
  })

  res.json(cases.map((item) => toCaseResponse(item, req.user!)))
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createCaseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues })
    return
  }

  const data = parsed.data
  let galleryRecord: any = null
  if (data.galleryRecordId) {
    galleryRecord = await prisma.galleryRecord.findUnique({
      where: { id: data.galleryRecordId },
      include: {
        eegRecord: true,
      },
    })
    if (!galleryRecord) {
      res.status(404).json({ error: 'Registro de galería no encontrado' })
      return
    }
  }

  const newCase = await prisma.$transaction(async (tx) => {
    const createdCase = await tx.case.create({
      data: {
        title: data.title,
        clinicalContext: data.clinicalContext,
        ageRange: data.ageRange,
        studyReason: data.studyReason,
        modality: data.modality,
        visibility: data.visibility,
        tags: JSON.stringify(data.tags),
        ownerId: req.user!.id,
        statusClinical: 'Draft',
        statusTeaching: 'None',
      },
    })

    if (galleryRecord) {
      await tx.casePackage.create({
        data: {
          caseId: createdCase.id,
          eegRecordId: galleryRecord.eegRecord.id,
          packageFormatVersion: '1.0',
          encryptionMode: galleryRecord.eegRecord.encryptionMode,
          blobLocation: galleryRecord.eegRecord.blobLocation,
          blobHash: galleryRecord.eegRecord.blobHash,
          sizeBytes: galleryRecord.eegRecord.sizeBytes,
          uploadStatus: 'Ready',
          retentionPolicy: 'Teaching',
          expiresAt: null,
        },
      })
    }

    return createdCase
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: newCase.id,
      action: 'CaseCreated',
      target: newCase.id,
      metadata: JSON.stringify({
        galleryRecordId: data.galleryRecordId ?? null,
      }),
    },
  })

  res.status(201).json(toCaseResponse(newCase, req.user!))
})

router.get('/open', async (req: AuthenticatedRequest, res) => {
  const cases = await prisma.case.findMany({
    where: { visibility: 'Public' },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { reviewRequests: true, comments: true } },
      owner: { select: { id: true, displayName: true, email: true } },
      reviewRequests: {
        select: {
          requestedBy: true,
          targetUserId: true,
          status: true,
        },
      },
      teachingProposals: {
        where: { status: { in: ['Proposed', 'Recommended', 'Validated'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          recommendations: {
            select: { authorId: true },
          },
        },
      },
    },
  })

  res.json(cases.map((item) => toCaseResponse(item, req.user!)))
})

router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const caseItem = await prisma.case.findFirst({
    where: {
      id: req.params.id,
      ...(canSeeAllCases(req) ? {} : buildCaseReadAccessWhere(req.user!.id)),
    },
    include: getCaseInclude(req.user!.id),
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
  }

  res.json(toCaseResponse(caseItem, req.user!))
})

router.patch('/:id/visibility', async (req: AuthenticatedRequest, res) => {
  const parsed = updateVisibilitySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Visibilidad inválida' })
    return
  }

  const caseItem = await prisma.case.findUnique({
    where: { id: req.params.id },
    select: { id: true, ownerId: true, visibility: true },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const isAdmin = hasAppAction(req.user!.role, 'access_admin')
  if (caseItem.ownerId !== req.user!.id && !isAdmin) {
    res.status(404).json({ error: 'Caso no encontrado o sin acceso' })
    return
  }

  const updated = await prisma.case.update({
    where: { id: req.params.id },
    data: { visibility: parsed.data.visibility },
    include: getCaseInclude(),
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId: updated.id,
      action: 'VisibilityChanged',
      target: updated.id,
      metadata: JSON.stringify({
        from: caseItem.visibility,
        to: parsed.data.visibility,
      }),
    },
  })

  res.json(toCaseResponse(updated, req.user!))
})

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

  const allowedNextStates = getAllowedClinicalEvents(caseItem.statusClinical)
    .map((event) => getNextClinicalState(caseItem.statusClinical, event))
    .filter(Boolean)

  if (!allowedNextStates.includes(parsed.data.statusClinical)) {
    res.status(400).json({
      error: `Transición no permitida: ${caseItem.statusClinical} → ${parsed.data.statusClinical}`,
    })
    return
  }

  const updateData: any = { statusClinical: parsed.data.statusClinical }
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

  const hydrated = await prisma.case.findUnique({
    where: { id: updated.id },
    include: getCaseInclude(),
  })

  res.json(toCaseResponse(hydrated ?? updated, req.user!))
})

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const canDeleteAnyCase = req.user ? hasAppAction(req.user.role, 'access_admin') : false
  const caseItem = await prisma.case.findFirst({
    where: canDeleteAnyCase
      ? { id: req.params.id }
      : { id: req.params.id, ownerId: req.user!.id },
    include: {
      package: {
        select: {
          id: true,
          eegRecordId: true,
          blobLocation: true,
        },
      },
    },
  })

  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.comment.deleteMany({ where: { caseId: caseItem.id } })
    await tx.reviewRequest.deleteMany({ where: { caseId: caseItem.id } })
    await tx.teachingProposal.deleteMany({ where: { caseId: caseItem.id } })
    await tx.auditEvent.deleteMany({ where: { caseId: caseItem.id } })
    await tx.eegAccessSecret.deleteMany({ where: { caseId: caseItem.id } })
    await tx.casePackage.deleteMany({ where: { caseId: caseItem.id } })
    await tx.case.delete({ where: { id: caseItem.id } })
    await tx.auditEvent.create({
      data: {
        actorId: req.user!.id,
        action: 'CaseDeleted',
        target: caseItem.id,
        metadata: JSON.stringify({
          title: caseItem.title,
          eegRecordId: caseItem.package?.eegRecordId ?? null,
        }),
      },
    })
  })

  if (caseItem.package?.eegRecordId) {
    const [remainingCaseUsages, remainingGalleryUsages] = await Promise.all([
      prisma.casePackage.count({
        where: { eegRecordId: caseItem.package.eegRecordId },
      }),
      prisma.galleryRecord.count({
        where: { eegRecordId: caseItem.package.eegRecordId },
      }),
    ])

    if (remainingCaseUsages === 0 && remainingGalleryUsages === 0) {
      await safeDeleteBlob(caseItem.package.blobLocation)
      await prisma.eegRecord.deleteMany({ where: { id: caseItem.package.eegRecordId } })
    }
  }

  res.json({ deleted: true, caseId: caseItem.id })
})

export default router
