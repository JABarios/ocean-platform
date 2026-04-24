import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'

const router = Router()

router.use(authMiddleware)

router.get('/', async (req: AuthenticatedRequest, res) => {
  const users = await prisma.user.findMany({
    where: { status: 'Active' },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      institution: true,
      specialty: true,
    },
    orderBy: { displayName: 'asc' },
  })
  res.json(users)
})

export default router
