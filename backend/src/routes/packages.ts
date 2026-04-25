import { Router } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import { prisma } from '../utils/prisma'
import { uploadBlob, getBlobStream, deleteBlob } from '../utils/storage'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

// Multer almacena temporalmente en memoria (para blobs cifrados de < 500MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } })

// Subir paquete cifrado de un caso (multipart: field "caseId" + file "blob")
router.post('/upload', authMiddleware, upload.single('blob'), async (req: AuthenticatedRequest, res) => {
  const caseId = req.body.caseId
  const retentionPolicy = req.body.retentionPolicy || 'Temporal72h'

  if (!caseId || !req.file) {
    res.status(400).json({ error: 'Falta caseId o archivo blob' })
    return
  }

  // Verificar ownership
  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, ownerId: req.user!.id },
  })
  if (!caseItem) {
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const buffer = req.file.buffer
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')
  const key = `${caseId}/${hash}.enc`

  const blobLocation = await uploadBlob(key, buffer)

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000)

  const pkg = await prisma.casePackage.upsert({
    where: { caseId },
    update: {
      blobLocation,
      blobHash: hash,
      sizeBytes: buffer.length,
      uploadStatus: 'Ready',
      retentionPolicy,
      expiresAt: retentionPolicy === 'Teaching' ? null : expiresAt,
    },
    create: {
      caseId,
      blobLocation,
      blobHash: hash,
      sizeBytes: buffer.length,
      uploadStatus: 'Ready',
      retentionPolicy,
      expiresAt: retentionPolicy === 'Teaching' ? null : expiresAt,
    },
  })

  res.status(201).json({
    packageId: pkg.id,
    caseId,
    hash,
    sizeBytes: buffer.length,
    blobLocation,
  })
})

// Descargar paquete cifrado (solo revisor autorizado)
router.get('/download/:caseId', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const caseId = req.params.caseId

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
    },
    include: { package: true },
  })

  if (!caseItem || !caseItem.package) {
    res.status(404).json({ error: 'Paquete no encontrado o sin acceso' })
    return
  }

  const pkg = caseItem.package

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId,
      action: 'PackageDownloaded',
      target: pkg.id,
    },
  })

  try {
    const stream = await getBlobStream(pkg.blobLocation)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${caseId}.enc"`)
    stream.pipe(res)
  } catch {
    res.status(500).json({ error: 'Error al leer el paquete' })
  }
})

export default router
