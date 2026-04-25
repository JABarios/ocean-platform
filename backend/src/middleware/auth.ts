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

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido' })
    return
  }

  const token = authHeader.split(' ')[1]
  let decoded: { userId: string; email: string; role: string }
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string; role: string }
  } catch {
    res.status(401).json({ error: 'Token inválido' })
    return
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, email: true, role: true, status: true },
  })

  if (!dbUser || dbUser.status !== 'Active') {
    res.status(401).json({ error: 'Usuario inactivo o no encontrado' })
    return
  }

  req.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role }
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
