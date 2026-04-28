import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthenticatedRequest, requireRole } from '../middleware/auth'
import { CleanupTaskName, getCleanupReport, runCleanupTasks, SAFE_CLEANUP_TASKS } from '../utils/cleanup'

const router = Router()

const runCleanupSchema = z.object({
  tasks: z.array(z.enum(SAFE_CLEANUP_TASKS as [string, ...string[]])).optional(),
})

router.use(authMiddleware)
router.use(requireRole(['Admin']))

router.get('/report', async (_req: AuthenticatedRequest, res) => {
  const report = await getCleanupReport()
  res.json(report)
})

router.post('/run', async (req: AuthenticatedRequest, res) => {
  const parsed = runCleanupSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'Payload de limpieza inválido', issues: parsed.error.issues })
    return
  }

  const tasks: CleanupTaskName[] = parsed.data.tasks && parsed.data.tasks.length > 0
    ? [...parsed.data.tasks] as CleanupTaskName[]
    : SAFE_CLEANUP_TASKS

  const result = await runCleanupTasks(tasks, req.user!.id)
  res.json(result)
})

export default router
