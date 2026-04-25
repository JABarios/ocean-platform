import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../utils/prisma'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
  }
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' })
    return
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string }
    req.user = { id: decoded.userId, email: decoded.email, role: decoded.role }
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido' })
    return
  }
}

export async function attachUserOptional(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    next()
    return
  }
  const token = authHeader.split(' ')[1]
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string }
    req.user = { id: decoded.userId, email: decoded.email, role: decoded.role }
  } catch {
    // ignore invalid token on optional attach
  }
  next()
}

export function requireRole(roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Autenticación requerida' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Permiso insuficiente' })
      return
    }
    next()
  }
}
