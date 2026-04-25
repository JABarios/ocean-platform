import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

import authRoutes from './routes/auth'
import caseRoutes from './routes/cases'
import requestRoutes from './routes/requests'
import commentRoutes from './routes/comments'
import teachingRoutes from './routes/teaching'
import userRoutes from './routes/users'
import packageRoutes from './routes/packages'
import groupRoutes from './routes/groups'
import auditRoutes from './routes/audit'
import { startCleanupJob } from './utils/cleanup'

dotenv.config()

// Validación de configuración obligatoria (solo fuera de test)
if (process.env.NODE_ENV !== 'test') {
  for (const key of ['JWT_SECRET', 'DATABASE_URL']) {
    if (!process.env[key]) throw new Error(`[OCEAN] Variable requerida no configurada: ${key}`)
  }
  if (process.env.JWT_SECRET === 'dev-secret-change-me') {
    throw new Error('[OCEAN] JWT_SECRET tiene el valor por defecto. Configura un secreto propio en producción.')
  }
}

const app = express()
const PORT = process.env.PORT || 4000

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN === '*'
    ? '*'
    : process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173']

// Log de configuración al arrancar
console.log(`[OCEAN] CORS_ORIGIN configurado: ${JSON.stringify(corsOrigin)}`)

app.use((req, res, next) => {
  const origin = req.headers.origin || '(sin origin)'
  console.log(`[OCEAN] ${req.method} ${req.url} | Origin: ${origin} | IP: ${req.ip || req.socket.remoteAddress}`)
  next()
})

app.use(cors({
  origin: corsOrigin,
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/auth', authRoutes)
app.use('/users', userRoutes)
app.use('/cases', caseRoutes)
app.use('/requests', requestRoutes)
app.use('/comments', commentRoutes)
app.use('/teaching', teachingRoutes)
app.use('/packages', packageRoutes)
app.use('/groups', groupRoutes)
app.use('/audit', auditRoutes)

// 404 handler (ruta no encontrada)
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Endpoint no encontrado' })
})

// Error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[OCEAN ERROR] ${req.method} ${req.url} —`, err.message || err)
  res.status(500).json({ error: 'Error interno del servidor', detail: err.message || undefined })
})

startCleanupJob()

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`OCEAN API escuchando en http://localhost:${PORT}`)
    console.log(`Storage: ${process.env.STORAGE_TYPE === 's3' ? 'MinIO/S3' : 'filesystem local'}`)
  })
}

export default app
