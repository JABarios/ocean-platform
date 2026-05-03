import { Response, Router } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import { promises as fsPromises } from 'fs'
import { createReadStream } from 'fs'
import path from 'path'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { uploadBlob, getBlobStream } from '../utils/storage'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads/cases')
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp-shared')
const SHARED_LINK_HOURS = 24

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fsPromises.mkdir(TEMP_DIR, { recursive: true })
      cb(null, TEMP_DIR)
    },
    filename: (_req, _file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.shared.enc.tmp`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
})

const uploadSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  ivBase64: z.string().trim().min(8).max(256).optional(),
  originalFilename: z.string().trim().min(1).max(255).optional(),
})

function applyNoStoreHeaders(res: Response) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
}

async function findAccessibleSharedLink(id: string) {
  return prisma.sharedLinkBlob.findUnique({
    where: { id },
    include: {
      creator: {
        select: { id: true, displayName: true, email: true },
      },
    },
  })
}

router.post('/upload', upload.single('blob'), async (req: AuthenticatedRequest, res) => {
  const parsed = uploadSchema.safeParse(req.body ?? {})
  if (!parsed.success || !req.file) {
    if (req.file?.path) {
      await fsPromises.unlink(req.file.path).catch(() => {})
    }
    res.status(400).json({ error: 'Payload de shared link inválido', issues: parsed.success ? undefined : parsed.error.issues })
    return
  }

  const tmpPath = req.file.path
  const sizeBytes = req.file.size
  let hash: string
  try {
    hash = await new Promise<string>((resolve, reject) => {
      const hasher = crypto.createHash('sha256')
      const stream = createReadStream(tmpPath)
      stream.on('data', (chunk) => hasher.update(chunk))
      stream.on('end', () => resolve(hasher.digest('hex')))
      stream.on('error', reject)
    })
  } catch {
    await fsPromises.unlink(tmpPath).catch(() => {})
    res.status(500).json({ error: 'Error al procesar el blob cifrado del shared link' })
    return
  }

  const id = crypto.randomUUID()
  const key = `shared-links/${id}/${hash}.enc`
  let blobLocation: string
  try {
    blobLocation = await uploadBlob(key, createReadStream(tmpPath))
  } catch {
    await fsPromises.unlink(tmpPath).catch(() => {})
    res.status(500).json({ error: 'Error al almacenar el blob cifrado del shared link' })
    return
  }

  await fsPromises.unlink(tmpPath).catch(() => {})

  const expiresAt = new Date(Date.now() + SHARED_LINK_HOURS * 60 * 60 * 1000)
  const sharedLink = await prisma.sharedLinkBlob.create({
    data: {
      id,
      createdBy: req.user?.id,
      blobLocation,
      blobHash: hash,
      ivBase64: parsed.data.ivBase64,
      sizeBytes,
      originalFilename: parsed.data.originalFilename,
      label: parsed.data.label || parsed.data.originalFilename || `EEG compartido ${id.slice(0, 8)}`,
      encryptionMode: 'AES256-GCM',
      expiresAt,
    },
  })

  res.status(201).json({
    id: sharedLink.id,
    expiresAt: sharedLink.expiresAt.toISOString(),
    sizeBytes: sharedLink.sizeBytes,
    label: sharedLink.label,
  })
})

router.get('/:id', async (req, res) => {
  applyNoStoreHeaders(res)
  const sharedLink = await findAccessibleSharedLink(req.params.id)
  if (!sharedLink) {
    res.status(404).json({ error: 'Enlace compartido no encontrado' })
    return
  }
  if (sharedLink.revokedAt) {
    res.status(410).json({ error: 'Este enlace compartido ha sido revocado' })
    return
  }
  if (sharedLink.expiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: 'Este enlace compartido ha caducado' })
    return
  }

  res.json({
    id: sharedLink.id,
    label: sharedLink.label,
    sizeBytes: sharedLink.sizeBytes,
    originalFilename: sharedLink.originalFilename,
    encryptionMode: sharedLink.encryptionMode,
    expiresAt: sharedLink.expiresAt.toISOString(),
    ivBase64: sharedLink.ivBase64,
    createdAt: sharedLink.createdAt.toISOString(),
  })
})

router.get('/:id/download', async (req, res) => {
  applyNoStoreHeaders(res)
  const sharedLink = await findAccessibleSharedLink(req.params.id)
  if (!sharedLink) {
    res.status(404).json({ error: 'Enlace compartido no encontrado' })
    return
  }
  if (sharedLink.revokedAt) {
    res.status(410).json({ error: 'Este enlace compartido ha sido revocado' })
    return
  }
  if (sharedLink.expiresAt.getTime() <= Date.now()) {
    res.status(410).json({ error: 'Este enlace compartido ha caducado' })
    return
  }

  const stream = await getBlobStream(sharedLink.blobLocation)
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${sharedLink.id}.enc"`)
  stream.pipe(res)
})

router.post('/:id/revoke', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const sharedLink = await prisma.sharedLinkBlob.findFirst({
    where: { id: req.params.id, createdBy: req.user!.id },
  })

  if (!sharedLink) {
    res.status(404).json({ error: 'Enlace compartido no encontrado' })
    return
  }

  if (sharedLink.revokedAt) {
    res.json({ revoked: true, alreadyRevoked: true })
    return
  }

  await prisma.sharedLinkBlob.update({
    where: { id: sharedLink.id },
    data: { revokedAt: new Date() },
  })

  res.json({ revoked: true })
})

export default router
