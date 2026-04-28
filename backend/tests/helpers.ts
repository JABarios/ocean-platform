import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

export async function createUser(data: {
  email: string
  displayName: string
  role?: string
  password?: string
}) {
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null
  const user = await prisma.user.create({
    data: {
      email: data.email,
      displayName: data.displayName,
      role: data.role || 'Clinician',
      status: 'Active',
      passwordHash,
    },
  })
  return user
}

export function generateToken(userId: string, email: string, role: string) {
  return jwt.sign({ userId, email, role }, JWT_SECRET, { expiresIn: '7d' })
}

export async function createCase(ownerId: string, data?: Partial<any>) {
  return prisma.case.create({
    data: {
      ownerId,
      title: data?.title || 'Caso test',
      clinicalContext: data?.clinicalContext || 'Contexto',
      ageRange: data?.ageRange || 'Adulto',
      studyReason: data?.studyReason || 'Motivo',
      modality: data?.modality || 'EEG',
      statusClinical: data?.statusClinical || 'Draft',
      statusTeaching: 'None',
      ...data,
    },
  })
}

export async function createReviewRequest(data: {
  caseId: string
  requestedBy: string
  targetUserId: string
}) {
  return prisma.reviewRequest.create({
    data: {
      caseId: data.caseId,
      requestedBy: data.requestedBy,
      targetUserId: data.targetUserId,
      status: 'Pending',
    },
  })
}

export async function createCasePackage(caseId: string, blobHash = 'hash-shared-edf', overrides?: {
  blobLocation?: string
  sizeBytes?: number
  uploadStatus?: string
  retentionPolicy?: string
  expiresAt?: Date | null
}) {
  return prisma.casePackage.create({
    data: {
      caseId,
      blobLocation: overrides?.blobLocation || `${caseId}/${blobHash}.enc`,
      blobHash,
      sizeBytes: overrides?.sizeBytes,
      uploadStatus: overrides?.uploadStatus || 'Ready',
      retentionPolicy: overrides?.retentionPolicy || 'Temporal72h',
      expiresAt: overrides?.expiresAt,
    },
  })
}

export { prisma }
