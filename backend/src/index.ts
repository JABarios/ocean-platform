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
import { startCleanupJob } from './utils/cleanup'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 4000

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? undefined : ['http://localhost:5173', 'http://127.0.0.1:5173'],
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

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

startCleanupJob()

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`OCEAN API escuchando en http://localhost:${PORT}`)
    console.log(`Storage: ${process.env.STORAGE_TYPE === 's3' ? 'MinIO/S3' : 'filesystem local'}`)
  })
}

export default app
