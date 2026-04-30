import { promises as fsPromises } from 'fs'
import path from 'path'

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface GalleryMetadataShape {
  schemaVersion: 1
  datasetId?: string
  datasetVersion?: string
  datasetUrl?: string
  sourceDataset?: string
  caseCode?: string
  completeness?: 'unknown' | 'partial' | 'complete'
  recordImportedCount: number
  recordExpectedCount?: number
  seizureFileCount?: number
  subject?: {
    sex?: string
    ageYears?: number
  }
  samplingRateHz?: number
  channelCount?: number
  montage?: string
  importDirectoryName?: string
  importRelativePath?: string
  importedAt?: string
  notes?: string
  [key: string]: JsonValue | undefined
}

export interface GalleryRecordMetadataShape {
  schemaVersion: 1
  originalFilename: string
  sourceDataset?: string
  sourceCaseCode?: string
  startTime?: string
  endTime?: string
  durationSeconds?: number
  seizureCount?: number
  seizureWindows?: Array<{ startSec: number; endSec: number }>
  samplingRateHz?: number
  channelCount?: number
  montage?: string
  sourceUrl?: string
  notes?: string
  [key: string]: JsonValue | undefined
}

interface ManifestRecordEntry {
  label?: string
  tags?: string[]
  metadata?: Record<string, JsonValue>
}

interface GalleryImportManifest {
  title?: string
  description?: string
  source?: string
  license?: string
  visibility?: 'Institutional' | 'Public'
  tags?: string[]
  metadata?: Record<string, JsonValue>
  records?: Record<string, ManifestRecordEntry>
}

interface SummaryRecordEntry {
  filename: string
  startTime?: string
  endTime?: string
  durationSeconds?: number
  seizureCount?: number
  seizureWindows?: Array<{ startSec: number; endSec: number }>
}

interface ChbSummaryParseResult {
  caseCode?: string
  samplingRateHz?: number
  channelCount?: number
  montage?: string
  recordExpectedCount?: number
  seizureFileCount?: number
  records: Map<string, SummaryRecordEntry>
}

interface GalleryImportHints {
  galleryDefaults: Partial<{
    title: string
    description: string
    source: string
    license: string
    visibility: 'Institutional' | 'Public'
    tags: string[]
  }>
  galleryMetadata: GalleryMetadataShape
  recordHints: Map<string, { label?: string; tags: string[]; metadata: GalleryRecordMetadataShape }>
}

function uniqStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]))
}

function mergeObjects<T extends Record<string, any>>(base: T, extra?: Record<string, any>) {
  if (!extra) return base
  return { ...base, ...extra }
}

function inferCaseCodeFromFilenames(filenames: string[]) {
  const matches = filenames
    .map((filename) => filename.match(/^([a-z]+\d+)_\d+\.edf$/i)?.[1]?.toLowerCase())
    .filter(Boolean) as string[]
  if (!matches.length) return undefined
  return matches.every((match) => match === matches[0]) ? matches[0] : undefined
}

function parseClockToSeconds(value?: string) {
  if (!value) return undefined
  const parts = value.split(':').map((part) => Number(part))
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return undefined
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function parseChbSummary(content: string): ChbSummaryParseResult {
  const lines = content.split(/\r?\n/)
  const records = new Map<string, SummaryRecordEntry>()
  const sampleRateMatch = content.match(/Data Sampling Rate:\s*(\d+)\s*Hz/i)
  const channelCount = lines.filter((line) => /^\s*Channel \d+:/i.test(line)).length || undefined
  const caseCode = content.match(/File Name:\s*(chb\d+)_\d+\.edf/i)?.[1]?.toLowerCase()
  const seizureFileCount = lines.filter((line) => /Number of Seizures in File:\s*[1-9]/i.test(line)).length || undefined

  let current: SummaryRecordEntry | null = null

  for (const line of lines) {
    const fileMatch = line.match(/File Name:\s*(.+\.edf)/i)
    if (fileMatch) {
      if (current) records.set(current.filename, current)
      current = { filename: fileMatch[1].trim() }
      continue
    }

    if (!current) continue

    const startMatch = line.match(/File Start Time:\s*(.+)$/i)
    if (startMatch) {
      current.startTime = startMatch[1].trim()
      continue
    }

    const endMatch = line.match(/File End Time:\s*(.+)$/i)
    if (endMatch) {
      current.endTime = endMatch[1].trim()
      const startSeconds = parseClockToSeconds(current.startTime)
      const endSeconds = parseClockToSeconds(current.endTime)
      if (startSeconds !== undefined && endSeconds !== undefined) {
        current.durationSeconds = Math.max(0, endSeconds - startSeconds)
      }
      continue
    }

    const seizureCountMatch = line.match(/Number of Seizures in File:\s*(\d+)/i)
    if (seizureCountMatch) {
      current.seizureCount = Number(seizureCountMatch[1])
      if (!current.seizureWindows) current.seizureWindows = []
      continue
    }

    const seizureStartMatch = line.match(/Seizure Start Time:\s*(\d+)\s*seconds/i)
    if (seizureStartMatch) {
      if (!current.seizureWindows) current.seizureWindows = []
      current.seizureWindows.push({ startSec: Number(seizureStartMatch[1]), endSec: Number(seizureStartMatch[1]) })
      continue
    }

    const seizureEndMatch = line.match(/Seizure End Time:\s*(\d+)\s*seconds/i)
    if (seizureEndMatch && current.seizureWindows?.length) {
      current.seizureWindows[current.seizureWindows.length - 1].endSec = Number(seizureEndMatch[1])
    }
  }

  if (current) records.set(current.filename, current)

  return {
    caseCode,
    samplingRateHz: sampleRateMatch ? Number(sampleRateMatch[1]) : undefined,
    channelCount,
    montage: channelCount ? 'bipolar 10-20' : undefined,
    recordExpectedCount: records.size || undefined,
    seizureFileCount,
    records,
  }
}

function parseSubjectInfo(content: string, caseCode?: string) {
  if (!caseCode) return undefined
  const pattern = new RegExp(`^\\s*${caseCode}\\s+([FM])\\s+([0-9.]+)\\s*$`, 'im')
  const match = content.match(pattern)
  if (!match) return undefined
  return {
    sex: match[1],
    ageYears: Number(match[2]),
  }
}

async function readTextIfExists(filePath: string) {
  try {
    return await fsPromises.readFile(filePath, 'utf-8')
  } catch {
    return undefined
  }
}

async function readManifestIfExists(directoryPath: string) {
  const manifestPath = path.join(directoryPath, 'gallery-metadata.json')
  const text = await readTextIfExists(manifestPath)
  if (!text) return undefined
  try {
    return JSON.parse(text) as GalleryImportManifest
  } catch {
    return undefined
  }
}

async function collectDatasetHints(directoryPath: string, filenames: string[]) {
  const inferredCaseCode = inferCaseCodeFromFilenames(filenames)
  const manifest = await readManifestIfExists(directoryPath)
  const summaryPath = inferredCaseCode ? path.join(directoryPath, `${inferredCaseCode}-summary.txt`) : undefined
  const subjectInfoCandidates = [
    path.join(directoryPath, 'SUBJECT-INFO'),
    path.join(path.dirname(directoryPath), 'SUBJECT-INFO'),
  ]

  const summaryText = summaryPath ? await readTextIfExists(summaryPath) : undefined
  const subjectInfoText = await (async () => {
    for (const candidate of subjectInfoCandidates) {
      const text = await readTextIfExists(candidate)
      if (text) return text
    }
    return undefined
  })()

  const summary = summaryText ? parseChbSummary(summaryText) : undefined
  const caseCode = summary?.caseCode || inferredCaseCode
  const subject = subjectInfoText ? parseSubjectInfo(subjectInfoText, caseCode) : undefined

  const sourceDataset = manifest?.metadata?.sourceDataset as string | undefined
    || (caseCode?.startsWith('chb') ? 'CHB-MIT Scalp EEG Database' : undefined)
  const datasetId = manifest?.metadata?.datasetId as string | undefined
    || (caseCode?.startsWith('chb') ? 'chbmit' : undefined)
  const datasetVersion = manifest?.metadata?.datasetVersion as string | undefined
  const datasetUrl = manifest?.metadata?.datasetUrl as string | undefined
    || (caseCode?.startsWith('chb') ? 'https://physionet.org/content/chbmit/1.0.0/' : undefined)

  const recordExpectedCount = Number(manifest?.metadata?.recordExpectedCount ?? summary?.recordExpectedCount ?? 0) || undefined
  const completeness = recordExpectedCount
    ? filenames.length >= recordExpectedCount ? 'complete' : 'partial'
    : 'unknown'

  const galleryMetadata: GalleryMetadataShape = mergeObjects({
    schemaVersion: 1 as const,
    datasetId,
    datasetVersion,
    datasetUrl,
    sourceDataset,
    caseCode,
    completeness,
    recordImportedCount: filenames.length,
    recordExpectedCount,
    seizureFileCount: Number(manifest?.metadata?.seizureFileCount ?? summary?.seizureFileCount ?? 0) || undefined,
    subject,
    samplingRateHz: Number(manifest?.metadata?.samplingRateHz ?? summary?.samplingRateHz ?? 0) || undefined,
    channelCount: Number(manifest?.metadata?.channelCount ?? summary?.channelCount ?? 0) || undefined,
    montage: (manifest?.metadata?.montage as string | undefined) || summary?.montage,
    importDirectoryName: path.basename(directoryPath),
    importedAt: new Date().toISOString(),
  }, manifest?.metadata)

  const recordHints = new Map<string, { label?: string; tags: string[]; metadata: GalleryRecordMetadataShape }>()

  for (const filename of filenames) {
    const manifestRecord = manifest?.records?.[filename]
    const summaryRecord = summary?.records.get(filename)
    const generatedMetadata: GalleryRecordMetadataShape = mergeObjects({
      schemaVersion: 1 as const,
      originalFilename: filename,
      sourceDataset,
      sourceCaseCode: caseCode,
      startTime: summaryRecord?.startTime,
      endTime: summaryRecord?.endTime,
      durationSeconds: summaryRecord?.durationSeconds,
      seizureCount: summaryRecord?.seizureCount ?? 0,
      seizureWindows: summaryRecord?.seizureWindows ?? [],
      samplingRateHz: galleryMetadata.samplingRateHz,
      channelCount: galleryMetadata.channelCount,
      montage: galleryMetadata.montage,
      sourceUrl: datasetUrl ? `${datasetUrl}${caseCode ? `${caseCode}/` : ''}${filename}` : undefined,
    }, manifestRecord?.metadata)

    const tags = uniqStrings([
      ...(manifestRecord?.tags || []),
      summaryRecord?.seizureCount && summaryRecord.seizureCount > 0 ? 'seizure' : undefined,
      sourceDataset === 'CHB-MIT Scalp EEG Database' ? 'chb-mit' : undefined,
      caseCode,
    ])

    recordHints.set(filename, {
      label: manifestRecord?.label,
      tags,
      metadata: generatedMetadata,
    })
  }

  const galleryDefaults: GalleryImportHints['galleryDefaults'] = {
    title: manifest?.title || (caseCode ? `${sourceDataset || 'Galería EEG'} ${caseCode}` : undefined),
    description: manifest?.description,
    source: manifest?.source || sourceDataset,
    license: manifest?.license,
    visibility: manifest?.visibility,
    tags: uniqStrings([...(manifest?.tags || []), datasetId, caseCode]),
  }

  return {
    galleryDefaults,
    galleryMetadata,
    recordHints,
  } satisfies GalleryImportHints
}

export async function buildGalleryImportHints(directoryPath: string, filenames: string[]) {
  return await collectDatasetHints(directoryPath, filenames)
}
