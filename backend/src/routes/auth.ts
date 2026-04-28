import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

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
  const now = new Date()
  const user = await prisma.user.create({
    data: {
      email,
      displayName,
      institution,
      specialty,
      status: 'Active',
      role: 'Clinician',
      passwordHash,
      preferences: "{}",
      lastLoginAt: now,
    },
  })

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role } })
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
    res.status(401).json({ error: 'Usuario inactivo' })
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

  res.json({ token, user: { id: updatedUser.id, email: updatedUser.email, displayName: updatedUser.displayName, role: updatedUser.role } })
})

router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, displayName: true, institution: true, specialty: true, role: true, status: true },
  })
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado' })
    return
  }
  res.json(user)
})

export default router
