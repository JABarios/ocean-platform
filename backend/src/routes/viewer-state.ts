import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const viewerStateSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24).default(0),
  windowSecs: z.number().int().min(1).max(600).default(10),
  hp: z.number().min(0).max(100).default(0.5),
  lp: z.number().min(1).max(200).default(45),
  notch: z.boolean().default(true),
  gainMult: z.number().positive().max(100).default(1),
  normalizeNonEEG: z.boolean().default(false),
  montage: z.string().min(1).max(64).default('promedio'),
  excludedAverageReferenceChannels: z.array(z.string()).default([]),
  includedHiddenChannels: z.array(z.string()).default([]),
  dsaChannel: z.string().min(1).max(128).default('off'),
  artifactReject: z.boolean().default(false),
})

router.use(authMiddleware)

async function findAccessibleCaseWithPackage(req: AuthenticatedRequest, caseId: string) {
  return prisma.case.findFirst({
    where: {
      id: caseId,
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
    include: { package: true },
  })
}

function toViewerStateResponse(state: {
  positionSec: number
  windowSecs: number
  hp: number
  lp: number
  notch: boolean
  gainMult: number
  normalizeNonEEG: boolean
  montage: string
  excludedAverageReferenceChannels: string | null
  includedHiddenChannels: string | null
  dsaChannel: string | null
  artifactReject: boolean
  updatedAt: Date
}) {
  const parseList = (value: string | null) => {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  return {
    positionSec: state.positionSec,
    windowSecs: state.windowSecs,
    hp: state.hp,
    lp: state.lp,
    notch: state.notch,
    gainMult: state.gainMult,
    normalizeNonEEG: state.normalizeNonEEG,
    montage: state.montage,
    excludedAverageReferenceChannels: parseList(state.excludedAverageReferenceChannels),
    includedHiddenChannels: parseList(state.includedHiddenChannels),
    dsaChannel: state.dsaChannel || 'off',
    artifactReject: state.artifactReject,
    updatedAt: state.updatedAt.toISOString(),
  }
}

router.get('/:caseId', async (req: AuthenticatedRequest, res) => {
  const caseItem = await findAccessibleCaseWithPackage(req, req.params.caseId)
  if (!caseItem || !caseItem.package?.blobHash) {
    res.json(null)
    return
  }

  const state = await prisma.viewerState.findUnique({
    where: {
      userId_packageHash: {
        userId: req.user!.id,
        packageHash: caseItem.package.blobHash,
      },
    },
  })

  if (!state) {
    res.json(null)
    return
  }

  res.json(toViewerStateResponse(state))
})

router.put('/:caseId', async (req: AuthenticatedRequest, res) => {
  const parsed = viewerStateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Estado de visor inválido', issues: parsed.error.issues })
    return
  }

  const caseItem = await findAccessibleCaseWithPackage(req, req.params.caseId)
  if (!caseItem || !caseItem.package?.blobHash) {
    res.status(404).json({ error: 'Caso o paquete no encontrado' })
    return
  }

  const data = parsed.data
  const state = await prisma.viewerState.upsert({
    where: {
      userId_packageHash: {
        userId: req.user!.id,
        packageHash: caseItem.package.blobHash,
      },
    },
    update: {
      positionSec: data.positionSec,
      windowSecs: data.windowSecs,
      hp: data.hp,
      lp: data.lp,
      notch: data.notch,
      gainMult: data.gainMult,
      normalizeNonEEG: data.normalizeNonEEG,
      montage: data.montage,
      excludedAverageReferenceChannels: JSON.stringify(data.excludedAverageReferenceChannels),
      includedHiddenChannels: JSON.stringify(data.includedHiddenChannels),
      dsaChannel: data.dsaChannel,
      artifactReject: data.artifactReject,
    },
    create: {
      userId: req.user!.id,
      packageHash: caseItem.package.blobHash,
      positionSec: data.positionSec,
      windowSecs: data.windowSecs,
      hp: data.hp,
      lp: data.lp,
      notch: data.notch,
      gainMult: data.gainMult,
      normalizeNonEEG: data.normalizeNonEEG,
      montage: data.montage,
      excludedAverageReferenceChannels: JSON.stringify(data.excludedAverageReferenceChannels),
      includedHiddenChannels: JSON.stringify(data.includedHiddenChannels),
      dsaChannel: data.dsaChannel,
      artifactReject: data.artifactReject,
    },
  })

  res.json(toViewerStateResponse(state))
})

export default router
