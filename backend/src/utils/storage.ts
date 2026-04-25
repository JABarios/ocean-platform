import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, createWriteStream, promises as fsPromises } from 'fs'
import { Readable } from 'stream'
import path from 'path'

const USE_S3 = process.env.STORAGE_TYPE === 's3' || !!process.env.S3_ENDPOINT

let s3Client: S3Client | null = null
const BUCKET = process.env.S3_BUCKET || 'ocean-cases'

if (USE_S3) {
  s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
    forcePathStyle: true,
  })
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads/cases'

async function ensureDir() {
  if (!USE_S3) {
    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true })
  }
}

export async function uploadBlob(key: string, buffer: Buffer): Promise<string> {
  await ensureDir()

  if (USE_S3 && s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentType: 'application/octet-stream',
      })
    )
    return `s3://${BUCKET}/${key}`
  }

  // Filesystem fallback
  const filePath = path.join(UPLOAD_DIR, key)
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  await fsPromises.writeFile(filePath, buffer)
  return filePath
}

export async function getBlobStream(key: string): Promise<Readable> {
  if (USE_S3 && s3Client && key.startsWith('s3://')) {
    const s3Key = key.replace(`s3://${BUCKET}/`, '')
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
      })
    )
    return response.Body as Readable
  }

  // Filesystem
  return createReadStream(key)
}

export async function deleteBlob(key: string): Promise<void> {
  if (USE_S3 && s3Client && key.startsWith('s3://')) {
    const s3Key = key.replace(`s3://${BUCKET}/`, '')
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: s3Key,
      })
    )
    return
  }

  await fsPromises.unlink(key).catch(() => {})
}

export async function generatePresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  if (USE_S3 && s3Client && key.startsWith('s3://')) {
    const s3Key = key.replace(`s3://${BUCKET}/`, '')
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }),
      { expiresIn: expiresInSeconds }
    )
  }

  // En filesystem local no hay presigned URLs; devolvemos una URL interna
  return `/api/packages/download?key=${encodeURIComponent(key)}`
}
