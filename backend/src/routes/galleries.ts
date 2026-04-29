import { Router } from 'express'
import { createReadStream, promises as fsPromises } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'
import { uploadBlob, getBlobStream } from '../utils/storage'
import { deleteBlob } from '../utils/storage'

const router = Router()

router.use(authMiddleware)

const importGallerySchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  source: z.string().max(240).optional(),
  license: z.string().max(240).optional(),
  visibility: z.enum(['Institutional', 'Public']).default('Institutional'),
  tags: z.array(z.string().min(1).max(40)).default([]),
  directoryPath: z.string().min(1),
})

const updateGallerySchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  source: z.string().max(240).optional(),
  license: z.string().max(240).optional(),
  visibility: z.enum(['Institutional', 'Public']).default('Institutional'),
  tags: z.array(z.string().min(1).max(40)).default([]),
})

function safeParseJson(value: string | null | undefined, fallback: any) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

async function sha256ForFile(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hasher = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hasher.update(chunk))
    stream.on('end', () => resolve(hasher.digest('hex')))
    stream.on('error', reject)
  })
}

async function fileSize(filePath: string) {
  const stats = await fsPromises.stat(filePath)
  return stats.size
}

async function safeDeleteBlob(blobLocation: string) {
  try {
    await deleteBlob(blobLocation)
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.name === 'NoSuchKey') return
    throw err
  }
}

function toGalleryListItem(gallery: any) {
  return {
    id: gallery.id,
    title: gallery.title,
    description: gallery.description,
    source: gallery.source,
    license: gallery.license,
    visibility: gallery.visibility,
    tags: safeParseJson(gallery.tags, []),
    createdAt: gallery.createdAt,
    updatedAt: gallery.updatedAt,
    createdBy: gallery.creator ? {
      id: gallery.creator.id,
      displayName: gallery.creator.displayName,
      email: gallery.creator.email,
    } : undefined,
    recordCount: gallery._count?.records ?? gallery.records?.length ?? 0,
  }
}

function toGalleryRecord(record: any) {
  return {
    id: record.id,
    label: record.label,
    sortOrder: record.sortOrder,
    tags: safeParseJson(record.tags, []),
    metadata: safeParseJson(record.metadata, {}),
    createdAt: record.createdAt,
    eegRecord: record.eegRecord ? {
      id: record.eegRecord.id,
      blobHash: record.eegRecord.blobHash,
      sizeBytes: record.eegRecord.sizeBytes,
      encryptionMode: record.eegRecord.encryptionMode,
      createdAt: record.eegRecord.createdAt,
      updatedAt: record.eegRecord.updatedAt,
    } : undefined,
  }
}

router.get('/', async (_req: AuthenticatedRequest, res) => {
  const galleries = await prisma.gallery.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      creator: { select: { id: true, displayName: true, email: true } },
      _count: { select: { records: true } },
    },
  })

  res.json(galleries.map(toGalleryListItem))
})

router.get('/:id', async (req: AuthenticatedRequest, res) => {
  const gallery = await prisma.gallery.findUnique({
    where: { id: req.params.id },
    include: {
      creator: { select: { id: true, displayName: true, email: true } },
      records: {
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        include: {
          eegRecord: true,
        },
      },
    },
  })

  if (!gallery) {
    res.status(404).json({ error: 'Galería no encontrada' })
    return
  }

  res.json({
    ...toGalleryListItem(gallery),
    records: gallery.records.map(toGalleryRecord),
  })
})

router.get('/records/:recordId', async (req: AuthenticatedRequest, res) => {
  const record = await prisma.galleryRecord.findUnique({
    where: { id: req.params.recordId },
    include: {
      gallery: {
        select: {
          id: true,
          title: true,
          source: true,
          license: true,
          visibility: true,
        },
      },
      eegRecord: true,
    },
  })

  if (!record) {
    res.status(404).json({ error: 'Registro de galería no encontrado' })
    return
  }

  res.json({
    id: record.id,
    label: record.label,
    sortOrder: record.sortOrder,
    tags: safeParseJson(record.tags, []),
    metadata: safeParseJson(record.metadata, {}),
    createdAt: record.createdAt,
    gallery: record.gallery,
    eegRecord: {
      id: record.eegRecord.id,
      blobHash: record.eegRecord.blobHash,
      sizeBytes: record.eegRecord.sizeBytes,
      encryptionMode: record.eegRecord.encryptionMode,
      createdAt: record.eegRecord.createdAt,
      updatedAt: record.eegRecord.updatedAt,
    },
  })
})

router.get('/records/:recordId/download', async (req: AuthenticatedRequest, res) => {
  const record = await prisma.galleryRecord.findUnique({
    where: { id: req.params.recordId },
    include: { eegRecord: true },
  })

  if (!record) {
    res.status(404).json({ error: 'Registro de galería no encontrado' })
    return
  }

  const stream = await getBlobStream(record.eegRecord.blobLocation)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename="${record.label}.edf"`)
  stream.pipe(res)
})

router.patch('/:id', requireRole(['Curator', 'Admin']), async (req: AuthenticatedRequest, res) => {
  const parsed = updateGallerySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos de galería inválidos', issues: parsed.error.issues })
    return
  }

  const existing = await prisma.gallery.findUnique({
    where: { id: req.params.id },
    include: {
      creator: { select: { id: true, displayName: true, email: true } },
      _count: { select: { records: true } },
    },
  })

  if (!existing) {
    res.status(404).json({ error: 'Galería no encontrada' })
    return
  }

  const gallery = await prisma.gallery.update({
    where: { id: req.params.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      source: parsed.data.source,
      license: parsed.data.license,
      visibility: parsed.data.visibility,
      tags: JSON.stringify(parsed.data.tags),
    },
    include: {
      creator: { select: { id: true, displayName: true, email: true } },
      _count: { select: { records: true } },
    },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      action: 'GalleryUpdated',
      target: gallery.id,
      metadata: JSON.stringify({
        title: gallery.title,
      }),
    },
  })

  res.json(toGalleryListItem(gallery))
})

router.delete('/:id', requireRole(['Curator', 'Admin']), async (req: AuthenticatedRequest, res) => {
  const gallery = await prisma.gallery.findUnique({
    where: { id: req.params.id },
    include: {
      records: {
        include: {
          eegRecord: true,
        },
      },
    },
  })

  if (!gallery) {
    res.status(404).json({ error: 'Galería no encontrada' })
    return
  }

  const candidateRecords = gallery.records.map((record) => ({
    eegRecordId: record.eegRecordId,
    blobLocation: record.eegRecord.blobLocation,
  }))

  await prisma.$transaction(async (tx) => {
    await tx.galleryRecord.deleteMany({ where: { galleryId: gallery.id } })
    await tx.gallery.delete({ where: { id: gallery.id } })
    await tx.auditEvent.create({
      data: {
        actorId: req.user!.id,
        action: 'GalleryDeleted',
        target: gallery.id,
        metadata: JSON.stringify({
          title: gallery.title,
          recordCount: candidateRecords.length,
        }),
      },
    })
  })

  for (const candidate of candidateRecords) {
    const [remainingCaseUsages, remainingGalleryUsages] = await Promise.all([
      prisma.casePackage.count({ where: { eegRecordId: candidate.eegRecordId } }),
      prisma.galleryRecord.count({ where: { eegRecordId: candidate.eegRecordId } }),
    ])

    if (remainingCaseUsages === 0 && remainingGalleryUsages === 0) {
      await safeDeleteBlob(candidate.blobLocation)
      await prisma.eegRecord.deleteMany({ where: { id: candidate.eegRecordId } })
    }
  }

  res.json({ deleted: true, galleryId: gallery.id })
})

router.post('/import', requireRole(['Curator', 'Admin']), async (req: AuthenticatedRequest, res) => {
  const parsed = importGallerySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos de importación inválidos', issues: parsed.error.issues })
    return
  }

  const data = parsed.data
  const directoryPath = path.resolve(data.directoryPath)
  let stats
  try {
    stats = await fsPromises.stat(directoryPath)
  } catch {
    res.status(404).json({ error: 'Directorio no encontrado en el servidor' })
    return
  }
  if (!stats.isDirectory()) {
    res.status(400).json({ error: 'La ruta indicada no es un directorio' })
    return
  }

  const filenames = (await fsPromises.readdir(directoryPath))
    .filter((name) => name.toLowerCase().endsWith('.edf'))
    .sort((a, b) => a.localeCompare(b))

  if (filenames.length === 0) {
    res.status(400).json({ error: 'No se encontraron archivos EDF en el directorio indicado' })
    return
  }

  const gallery = await prisma.gallery.create({
    data: {
      title: data.title,
      description: data.description,
      source: data.source,
      license: data.license,
      visibility: data.visibility,
      tags: JSON.stringify(data.tags),
      createdBy: req.user!.id,
    },
  })

  const importedRecords: any[] = []

  for (const [index, filename] of filenames.entries()) {
    const sourcePath = path.join(directoryPath, filename)
    const blobHash = await sha256ForFile(sourcePath)
    const sizeBytes = await fileSize(sourcePath)

    let eegRecord = await prisma.eegRecord.findUnique({ where: { blobHash } })
    if (!eegRecord) {
      const storageKey = `galleries/${gallery.id}/${filename}`
      const blobLocation = await uploadBlob(storageKey, createReadStream(sourcePath))
      eegRecord = await prisma.eegRecord.create({
        data: {
          blobHash,
          blobLocation,
          sizeBytes,
          encryptionMode: 'NONE',
          uploadedBy: req.user!.id,
        },
      })
    }

    const galleryRecord = await prisma.galleryRecord.create({
      data: {
        galleryId: gallery.id,
        eegRecordId: eegRecord.id,
        label: path.parse(filename).name,
        sortOrder: index,
        metadata: JSON.stringify({ originalFilename: filename }),
        tags: JSON.stringify([]),
      },
      include: {
        eegRecord: true,
      },
    })

    importedRecords.push(galleryRecord)
  }

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      action: 'GalleryImported',
      target: gallery.id,
      metadata: JSON.stringify({
        title: gallery.title,
        source: gallery.source,
        directoryPath,
        recordCount: importedRecords.length,
      }),
    },
  })

  res.status(201).json({
    ...toGalleryListItem({
      ...gallery,
      creator: null,
      _count: { records: importedRecords.length },
    }),
    records: importedRecords.map(toGalleryRecord),
  })
})

export default router
