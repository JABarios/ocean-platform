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
import galleryRoutes from './routes/galleries'
import groupRoutes from './routes/groups'
import auditRoutes from './routes/audit'
import viewerStateRoutes from './routes/viewer-state'
import cleanupRoutes from './routes/cleanup'
import { startCleanupJob } from './utils/cleanup'

dotenv.config()

const KNOWN_DEV_SECRETS = ['dev-secret-change-me', 'dev-secret-ocean-platform-2026']

// Validación de configuración obligatoria (solo fuera de test)
if (process.env.NODE_ENV !== 'test') {
  const requiredKeys = ['JWT_SECRET', 'DATABASE_URL']
  if (process.env.NODE_ENV === 'production') {
    requiredKeys.push('KEY_CUSTODY_SECRET')
  }

  for (const key of requiredKeys) {
    if (!process.env[key]) throw new Error(`[OCEAN] Variable requerida no configurada: ${key}`)
  }

  if (KNOWN_DEV_SECRETS.includes(process.env.JWT_SECRET!)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[OCEAN] JWT_SECRET tiene un valor de desarrollo conocido. Genera uno propio con: openssl rand -hex 64')
    }
    console.warn('[OCEAN] ⚠️  JWT_SECRET usa valor de desarrollo. En producción genera uno propio con: openssl rand -hex 64')
  }

  if (process.env.KEY_CUSTODY_SECRET) {
    if (KNOWN_DEV_SECRETS.includes(process.env.KEY_CUSTODY_SECRET)) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[OCEAN] KEY_CUSTODY_SECRET tiene un valor de desarrollo conocido. Genera uno propio con: openssl rand -hex 64')
      }
      console.warn('[OCEAN] ⚠️  KEY_CUSTODY_SECRET usa un valor de desarrollo. Se recomienda separarlo de JWT_SECRET.')
    }

    if (process.env.KEY_CUSTODY_SECRET === process.env.JWT_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[OCEAN] KEY_CUSTODY_SECRET no puede coincidir con JWT_SECRET en producción.')
      }
      console.warn('[OCEAN] ⚠️  KEY_CUSTODY_SECRET coincide con JWT_SECRET. En producción deben ser secretos separados.')
    }
  } else {
    console.warn('[OCEAN] ⚠️  KEY_CUSTODY_SECRET no configurado. En desarrollo se reutilizará JWT_SECRET solo como fallback temporal.')
  }
}

const app = express()
const PORT = process.env.PORT || 4000
const shouldLogRequests =
  (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test')
  || process.env.LOG_REQUESTS === 'true'

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN === '*'
    ? '*'
    : process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173']

if (process.env.NODE_ENV !== 'test') {
  console.log(`[OCEAN] CORS_ORIGIN configurado: ${JSON.stringify(corsOrigin)}`)
}

if (shouldLogRequests) {
  app.use((req, _res, next) => {
    const origin = req.headers.origin || '(sin origin)'
    console.log(`[OCEAN] ${req.method} ${req.url} | Origin: ${origin} | IP: ${req.ip || req.socket.remoteAddress}`)
    next()
  })
}

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
app.use('/galleries', galleryRoutes)
app.use('/groups', groupRoutes)
app.use('/audit', auditRoutes)
app.use('/viewer-state', viewerStateRoutes)
app.use('/cleanup', cleanupRoutes)

// 404 handler (ruta no encontrada)
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Endpoint no encontrado' })
})

// Error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[OCEAN ERROR] ${req.method} ${req.url} —`, err.message || err)
  res.status(500).json({ error: 'Error interno del servidor', detail: err.message || undefined })
})

if (process.env.NODE_ENV !== 'test') {
  startCleanupJob()
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`OCEAN API escuchando en http://localhost:${PORT}`)
    console.log(`Storage: ${process.env.STORAGE_TYPE === 's3' ? 'MinIO/S3' : 'filesystem local'}`)
  })
}

export default app
