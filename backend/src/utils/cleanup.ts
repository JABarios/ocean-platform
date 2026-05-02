import cron from 'node-cron'
import { prisma } from './prisma'
import { deleteBlob } from './storage'

const OLD_DRAFT_DAYS = 60
const STALE_VIEWER_STATE_DAYS = 180
const ARCHIVED_PACKAGE_GRACE_DAYS = 7

export type CleanupTaskName =
  | 'expiredRequests'
  | 'expiredPackages'
  | 'archivedPackages'
  | 'expiredSharedLinks'
  | 'staleViewerStates'
  | 'oldDraftCases'

export const SAFE_CLEANUP_TASKS: CleanupTaskName[] = [
  'expiredRequests',
  'expiredPackages',
  'archivedPackages',
  'expiredSharedLinks',
  'staleViewerStates',
]

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function summarizeCasePackage(pkg: {
  id: string
  caseId: string
  blobHash: string | null
  sizeBytes: number | null
  expiresAt: Date | null
  retentionPolicy: string
  case?: { title: string | null; statusClinical: string; statusTeaching: string } | null
}) {
  return {
    id: pkg.id,
    caseId: pkg.caseId,
    blobHash: pkg.blobHash,
    sizeBytes: pkg.sizeBytes ?? 0,
    expiresAt: pkg.expiresAt?.toISOString() ?? null,
    retentionPolicy: pkg.retentionPolicy,
    caseTitle: pkg.case?.title ?? null,
    caseStatus: pkg.case?.statusClinical ?? null,
    teachingStatus: pkg.case?.statusTeaching ?? null,
  }
}

async function writeCleanupAudit(params: {
  actorId?: string
  action: string
  target?: string
  caseId?: string | null
  metadata?: Record<string, unknown>
}) {
  if (!params.actorId) return
  await prisma.auditEvent.create({
    data: {
      actorId: params.actorId,
      caseId: params.caseId ?? null,
      action: params.action,
      target: params.target,
      metadata: JSON.stringify(params.metadata ?? {}),
    },
  })
}

async function safeDeleteBlob(blobLocation: string) {
  try {
    await deleteBlob(blobLocation)
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.name === 'NoSuchKey') return
    throw err
  }
}

export async function getCleanupReport() {
  const now = new Date()

  const [expiredRequests, expiredPackages, archivedPackages, expiredSharedLinks, staleViewerStates, oldDraftCases] = await Promise.all([
    prisma.reviewRequest.findMany({
      where: { status: 'Pending', expiresAt: { lt: now } },
      select: { id: true, caseId: true, expiresAt: true, targetUserId: true, targetGroupId: true },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.casePackage.findMany({
      where: {
        expiresAt: { lt: now },
        retentionPolicy: { not: 'Teaching' },
      },
      include: {
        case: { select: { title: true, statusClinical: true, statusTeaching: true } },
      },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.casePackage.findMany({
      where: {
        retentionPolicy: 'UntilReviewClose',
        case: {
          statusClinical: 'Archived',
          statusTeaching: 'None',
          resolvedAt: { lt: daysAgo(ARCHIVED_PACKAGE_GRACE_DAYS) },
        },
      },
      include: {
        case: { select: { title: true, statusClinical: true, statusTeaching: true } },
      },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.sharedLinkBlob.findMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { not: null } },
        ],
      },
      select: {
        id: true,
        label: true,
        sizeBytes: true,
        expiresAt: true,
        revokedAt: true,
      },
      orderBy: { expiresAt: 'asc' },
    }),
    prisma.viewerState.findMany({
      where: { updatedAt: { lt: daysAgo(STALE_VIEWER_STATE_DAYS) } },
      select: { id: true, userId: true, packageHash: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.case.findMany({
      where: {
        statusClinical: 'Draft',
        updatedAt: { lt: daysAgo(OLD_DRAFT_DAYS) },
        comments: { none: {} },
        reviewRequests: { none: {} },
        teachingProposals: { none: {} },
        package: null,
      },
      select: {
        id: true,
        title: true,
        ownerId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'asc' },
    }),
  ])

  return {
    generatedAt: now.toISOString(),
    tasks: {
      expiredRequests: {
        count: expiredRequests.length,
        items: expiredRequests,
      },
      expiredPackages: {
        count: expiredPackages.length,
        totalBytes: expiredPackages.reduce((sum: number, pkg) => sum + (pkg.sizeBytes ?? 0), 0),
        items: expiredPackages.map(summarizeCasePackage),
      },
      archivedPackages: {
        count: archivedPackages.length,
        totalBytes: archivedPackages.reduce((sum: number, pkg) => sum + (pkg.sizeBytes ?? 0), 0),
        items: archivedPackages.map(summarizeCasePackage),
      },
      expiredSharedLinks: {
        count: expiredSharedLinks.length,
        totalBytes: expiredSharedLinks.reduce((sum: number, item) => sum + (item.sizeBytes ?? 0), 0),
        items: expiredSharedLinks.map((item) => ({
          id: item.id,
          label: item.label,
          sizeBytes: item.sizeBytes ?? 0,
          expiresAt: item.expiresAt.toISOString(),
          revokedAt: item.revokedAt?.toISOString() ?? null,
        })),
      },
      staleViewerStates: {
        count: staleViewerStates.length,
        items: staleViewerStates.map((state) => ({
          id: state.id,
          userId: state.userId,
          packageHash: state.packageHash,
          updatedAt: state.updatedAt.toISOString(),
        })),
      },
      oldDraftCases: {
        count: oldDraftCases.length,
        items: oldDraftCases.map((caseItem) => ({
          id: caseItem.id,
          title: caseItem.title,
          ownerId: caseItem.ownerId,
          updatedAt: caseItem.updatedAt.toISOString(),
        })),
      },
    },
  }
}

export async function expirePendingRequests(actorId?: string) {
  const candidates = await prisma.reviewRequest.findMany({
    where: { status: 'Pending', expiresAt: { lt: new Date() } },
    select: { id: true, caseId: true },
  })

  if (candidates.length === 0) {
    return { task: 'expiredRequests' as const, affected: 0 }
  }

  await prisma.reviewRequest.updateMany({
    where: { id: { in: candidates.map((candidate) => candidate.id) } },
    data: { status: 'Expired' },
  })

  await writeCleanupAudit({
    actorId,
    action: 'CleanupExpiredRequests',
    target: 'review_requests',
    metadata: {
      requestIds: candidates.map((candidate) => candidate.id),
      count: candidates.length,
    },
  })

  return { task: 'expiredRequests' as const, affected: candidates.length }
}

async function deleteCasePackages(params: {
  actorId?: string
  action: string
  packages: Array<{
    id: string
    caseId: string
    blobLocation: string
    sizeBytes: number | null
  }>
  task: 'expiredPackages' | 'archivedPackages'
}) {
  let deleted = 0
  let freedBytes = 0

  for (const pkg of params.packages) {
    await safeDeleteBlob(pkg.blobLocation)
    await prisma.casePackage.delete({ where: { id: pkg.id } })
    deleted += 1
    freedBytes += pkg.sizeBytes ?? 0

    await writeCleanupAudit({
      actorId: params.actorId,
      caseId: pkg.caseId,
      action: params.action,
      target: pkg.id,
      metadata: {
        caseId: pkg.caseId,
        sizeBytes: pkg.sizeBytes ?? 0,
      },
    })
  }

  return { task: params.task, affected: deleted, freedBytes }
}

export async function cleanupExpiredPackages(actorId?: string) {
  const packages = await prisma.casePackage.findMany({
    where: {
      expiresAt: { lt: new Date() },
      retentionPolicy: { not: 'Teaching' },
    },
    select: { id: true, caseId: true, blobLocation: true, sizeBytes: true },
  })

  return deleteCasePackages({
    actorId,
    action: 'CleanupDeletedExpiredPackage',
    packages,
    task: 'expiredPackages',
  })
}

export async function cleanupArchivedPackages(actorId?: string) {
  const packages = await prisma.casePackage.findMany({
    where: {
      retentionPolicy: 'UntilReviewClose',
      case: {
        statusClinical: 'Archived',
        statusTeaching: 'None',
        resolvedAt: { lt: daysAgo(ARCHIVED_PACKAGE_GRACE_DAYS) },
      },
    },
    select: { id: true, caseId: true, blobLocation: true, sizeBytes: true },
  })

  return deleteCasePackages({
    actorId,
    action: 'CleanupDeletedArchivedPackage',
    packages,
    task: 'archivedPackages',
  })
}

export async function cleanupExpiredSharedLinks(actorId?: string) {
  const items = await prisma.sharedLinkBlob.findMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null } },
      ],
    },
    select: {
      id: true,
      blobLocation: true,
      sizeBytes: true,
      label: true,
    },
  })

  let deleted = 0
  let freedBytes = 0

  for (const item of items) {
    await safeDeleteBlob(item.blobLocation)
    await prisma.sharedLinkBlob.delete({ where: { id: item.id } })
    deleted += 1
    freedBytes += item.sizeBytes ?? 0
  }

  if (deleted > 0) {
    await writeCleanupAudit({
      actorId,
      action: 'CleanupDeletedExpiredSharedLinks',
      target: 'shared_link_blobs',
      metadata: {
        count: deleted,
        freedBytes,
        sharedLinkIds: items.map((item) => item.id),
      },
    })
  }

  return { task: 'expiredSharedLinks' as const, affected: deleted, freedBytes }
}

export async function cleanupStaleViewerStates(actorId?: string) {
  const states = await prisma.viewerState.findMany({
    where: { updatedAt: { lt: daysAgo(STALE_VIEWER_STATE_DAYS) } },
    select: { id: true },
  })

  if (states.length === 0) {
    return { task: 'staleViewerStates' as const, affected: 0 }
  }

  await prisma.viewerState.deleteMany({
    where: { id: { in: states.map((state) => state.id) } },
  })

  await writeCleanupAudit({
    actorId,
    action: 'CleanupDeletedViewerStates',
    target: 'viewer_states',
    metadata: {
      count: states.length,
      stateIds: states.map((state) => state.id),
    },
  })

  return { task: 'staleViewerStates' as const, affected: states.length }
}

export async function runCleanupTasks(tasks: CleanupTaskName[], actorId?: string) {
  const results = []

  for (const task of tasks) {
    if (task === 'expiredRequests') results.push(await expirePendingRequests(actorId))
    if (task === 'expiredPackages') results.push(await cleanupExpiredPackages(actorId))
    if (task === 'archivedPackages') results.push(await cleanupArchivedPackages(actorId))
    if (task === 'expiredSharedLinks') results.push(await cleanupExpiredSharedLinks(actorId))
    if (task === 'staleViewerStates') results.push(await cleanupStaleViewerStates(actorId))
  }

  return {
    executedAt: new Date().toISOString(),
    tasks,
    results,
  }
}

export function startCleanupJob() {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await runCleanupTasks(['expiredRequests', 'expiredPackages', 'expiredSharedLinks'])
      console.log('[cleanup] Ejecución horaria:', JSON.stringify(result))
    } catch (err) {
      console.error('[cleanup] Error en la limpieza horaria:', err)
    }
  })

  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await runCleanupTasks(['archivedPackages', 'staleViewerStates'])
      console.log('[cleanup] Ejecución diaria:', JSON.stringify(result))
    } catch (err) {
      console.error('[cleanup] Error en la limpieza diaria:', err)
    }
  })
}
