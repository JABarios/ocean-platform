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
  status?: string
}) {
  return prisma.reviewRequest.create({
    data: {
      caseId: data.caseId,
      requestedBy: data.requestedBy,
      targetUserId: data.targetUserId,
      status: data.status || 'Pending',
    },
  })
}

export async function createCasePackage(caseId: string, blobHash = 'hash-shared-edf', overrides?: {
  eegRecordId?: string
  blobLocation?: string
  sizeBytes?: number
  uploadStatus?: string
  retentionPolicy?: string
  expiresAt?: Date | null
}) {
  return prisma.casePackage.create({
    data: {
      caseId,
      eegRecordId: overrides?.eegRecordId,
      blobLocation: overrides?.blobLocation || `${caseId}/${blobHash}.enc`,
      blobHash,
      sizeBytes: overrides?.sizeBytes,
      uploadStatus: overrides?.uploadStatus || 'Ready',
      retentionPolicy: overrides?.retentionPolicy || 'Temporal72h',
      expiresAt: overrides?.expiresAt,
    },
  })
}

export async function createEegRecord(data?: {
  blobHash?: string
  blobLocation?: string
  sizeBytes?: number
  uploadedBy?: string
}) {
  return prisma.eegRecord.create({
    data: {
      blobHash: data?.blobHash || `hash-${Math.random().toString(36).slice(2)}`,
      blobLocation: data?.blobLocation || `shared/${Math.random().toString(36).slice(2)}.enc`,
      sizeBytes: data?.sizeBytes,
      uploadedBy: data?.uploadedBy,
    },
  })
}

export async function createGallery(data: {
  title: string
  createdBy?: string
  source?: string
  license?: string
  visibility?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}) {
  return prisma.gallery.create({
    data: {
      title: data.title,
      createdBy: data.createdBy,
      source: data.source,
      license: data.license,
      visibility: data.visibility || 'Institutional',
      tags: JSON.stringify(data.tags || []),
      metadata: JSON.stringify(data.metadata || {}),
    },
  })
}

export async function createGalleryRecord(data: {
  galleryId: string
  eegRecordId: string
  label: string
  sortOrder?: number
  metadata?: Record<string, unknown>
  tags?: string[]
}) {
  return prisma.galleryRecord.create({
    data: {
      galleryId: data.galleryId,
      eegRecordId: data.eegRecordId,
      label: data.label,
      sortOrder: data.sortOrder || 0,
      metadata: JSON.stringify(data.metadata || {}),
      tags: JSON.stringify(data.tags || []),
    },
  })
}

export { prisma }
