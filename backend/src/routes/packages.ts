import { Router } from 'express'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import { promises as fsPromises } from 'fs'
import { createReadStream } from 'fs'
import path from 'path'
import { prisma } from '../utils/prisma'
import { uploadBlob, getBlobStream } from '../utils/storage'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { wrapCaseKey, unwrapCaseKey } from '../utils/keyCustody'

const router = Router()

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads/cases')
const TEMP_DIR = path.join(UPLOAD_DIR, 'tmp')

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fsPromises.mkdir(TEMP_DIR, { recursive: true })
      cb(null, TEMP_DIR)
    },
    filename: (_req, _file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.enc.tmp`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
})

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
    await fsPromises.unlink(req.file.path).catch(() => {})
    res.status(404).json({ error: 'Caso no encontrado' })
    return
  }

  const tmpPath = req.file.path
  const sizeBytes = req.file.size

  // Calcular hash por streaming sin cargar en memoria
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
    res.status(500).json({ error: 'Error al procesar el archivo' })
    return
  }

  const key = `${caseId}/${hash}.enc`
  let blobLocation: string
  try {
    blobLocation = await uploadBlob(key, createReadStream(tmpPath))
  } catch {
    await fsPromises.unlink(tmpPath).catch(() => {})
    res.status(500).json({ error: 'Error al almacenar el archivo' })
    return
  }

  await fsPromises.unlink(tmpPath).catch(() => {})

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000)

  const pkg = await prisma.casePackage.upsert({
    where: { caseId },
    update: {
      blobLocation,
      blobHash: hash,
      sizeBytes,
      uploadStatus: 'Ready',
      retentionPolicy,
      expiresAt: retentionPolicy === 'Teaching' ? null : expiresAt,
    },
    create: {
      caseId,
      blobLocation,
      blobHash: hash,
      sizeBytes,
      uploadStatus: 'Ready',
      retentionPolicy,
      expiresAt: retentionPolicy === 'Teaching' ? null : expiresAt,
    },
  })

  res.status(201).json({
    packageId: pkg.id,
    caseId,
    hash,
    sizeBytes,
    blobLocation,
  })
})

router.post('/secret/:caseId', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const caseId = req.params.caseId
  const keyBase64 = typeof req.body?.keyBase64 === 'string' ? req.body.keyBase64.trim() : ''

  if (!keyBase64) {
    res.status(400).json({ error: 'Clave de descifrado requerida' })
    return
  }

  const caseItem = await prisma.case.findFirst({
    where: { id: caseId, ownerId: req.user!.id },
    include: { package: true },
  })
  if (!caseItem || !caseItem.package) {
    res.status(404).json({ error: 'Caso o paquete no encontrado' })
    return
  }

  const wrappedKey = wrapCaseKey(keyBase64)
  await prisma.eegAccessSecret.upsert({
    where: { caseId },
    update: {
      wrappedKey,
      createdBy: req.user!.id,
    },
    create: {
      caseId,
      wrappedKey,
      createdBy: req.user!.id,
    },
  })

  await prisma.auditEvent.create({
    data: {
      actorId: req.user!.id,
      caseId,
      action: 'PackageKeyStored',
      target: caseItem.package.id,
    },
  })

  res.status(201).json({ stored: true })
})

router.post('/secret/:caseId/recover', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const caseId = req.params.caseId
  const password = typeof req.body?.password === 'string' ? req.body.password : ''

  if (!password) {
    res.status(400).json({ error: 'Contraseña requerida' })
    return
  }

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
    include: {
      package: true,
      accessSecret: true,
    },
  })

  if (!caseItem || !caseItem.package || !caseItem.accessSecret) {
    res.status(404).json({ error: 'Clave custodiada no disponible para este caso' })
    return
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, passwordHash: true },
  })

  if (!dbUser?.passwordHash) {
    res.status(401).json({ error: 'No se pudo validar la contraseña' })
    return
  }

  const valid = await bcrypt.compare(password, dbUser.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Contraseña incorrecta' })
    return
  }

  const keyBase64 = unwrapCaseKey(caseItem.accessSecret.wrappedKey)

  await prisma.$transaction([
    prisma.eegAccessSecret.update({
      where: { caseId },
      data: { lastRecoveredAt: new Date() },
    }),
    prisma.auditEvent.create({
      data: {
        actorId: req.user!.id,
        caseId,
        action: 'PackageKeyRecovered',
        target: caseItem.package.id,
      },
    }),
  ])

  res.json({ keyBase64 })
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
