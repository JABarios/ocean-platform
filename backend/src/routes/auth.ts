import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { getAppAvailableActions } from '../domain/workflows/appWorkflow'
import { buildVerificationUrl, sendVerificationEmail } from '../utils/email'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  displayName: z.string().min(2),
  institution: z.string().optional(),
  specialty: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const resendSchema = z.object({
  email: z.string().email(),
})

async function issueEmailVerification(userId: string, email: string, displayName: string) {
  await prisma.emailVerificationToken.updateMany({
    where: { userId, consumedAt: null },
    data: { consumedAt: new Date() },
  })

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

  await prisma.emailVerificationToken.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  })

  const verifyUrl = buildVerificationUrl(token)
  const delivery = await sendVerificationEmail({ to: email, displayName, verifyUrl })

  return {
    verifyUrl,
    emailSent: delivery.delivered,
  }
}

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos', issues: parsed.error.issues })
    return
  }

  const { email, password, displayName, institution, specialty } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    res.status(409).json({ error: 'El email ya está registrado' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.create({
    data: {
      email,
      displayName,
      institution,
      specialty,
      status: 'Pending',
      role: 'Clinician',
      passwordHash,
      preferences: "{}",
    },
  })

  const verification = await issueEmailVerification(user.id, user.email, user.displayName)

  res.status(201).json({
    requiresVerification: true,
    emailSent: verification.emailSent,
    message: verification.emailSent
      ? 'Te hemos enviado un correo de confirmación. Revisa tu bandeja para activar la cuenta.'
      : 'Cuenta creada. Como no hay proveedor de correo configurado, usa el enlace de verificación devuelto por la API.',
    verifyUrl: process.env.NODE_ENV === 'production' && verification.emailSent
      ? undefined
      : verification.verifyUrl,
  })
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }

  if (user.status !== 'Active') {
    res.status(401).json({ error: 'Debes confirmar tu correo antes de iniciar sesión' })
    return
  }

  if (!user.passwordHash) {
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    res.status(401).json({ error: 'Credenciales inválidas' })
    return
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  const token = jwt.sign(
    { userId: updatedUser.id, email: updatedUser.email, role: updatedUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({
    token,
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      role: updatedUser.role,
      availableActions: getAppAvailableActions(updatedUser.role),
    },
  })
})

router.get('/verify/:token', async (req, res) => {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { token: req.params.token },
    include: { user: true },
  })

  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    res.status(400).json({ error: 'El enlace de verificación no es válido o ha caducado' })
    return
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { status: 'Active' },
    }),
    prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
  ])

  res.json({ ok: true, message: 'Correo confirmado. Ya puedes iniciar sesión.' })
})

router.post('/resend-verification', async (req, res) => {
  const parsed = resendSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos inválidos' })
    return
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (!user || user.status === 'Active') {
    res.json({ ok: true, message: 'Si la cuenta existe y sigue pendiente, te hemos reenviado el correo.' })
    return
  }

  const verification = await issueEmailVerification(user.id, user.email, user.displayName)

  res.json({
    ok: true,
    emailSent: verification.emailSent,
    message: verification.emailSent
      ? 'Te hemos reenviado el correo de confirmación.'
      : 'No hay proveedor de correo configurado. Usa el enlace de verificación devuelto por la API.',
    verifyUrl: process.env.NODE_ENV === 'production' && verification.emailSent
      ? undefined
      : verification.verifyUrl,
  })
})

router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { lastLoginAt: new Date() },
    select: { id: true, email: true, displayName: true, institution: true, specialty: true, role: true, status: true, lastLoginAt: true },
  })
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  res.json({
    ...user,
    availableActions: getAppAvailableActions(user.role),
  })
})

export default router
