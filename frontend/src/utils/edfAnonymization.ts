import { extractEdfAnnotations, rewriteEdfAnnotations } from './edfAnnotations'

export type EdfAnnotationMode = 'keep' | 'remove' | 'replace' | 'clinical'

export interface EdfFieldReview {
  key: 'patient' | 'recording' | 'startDate' | 'startTime'
  label: string
  originalValue: string
  resultValue: string
  changed: boolean
}

export interface EdfAnnotationReview {
  totalAnnotations: number
  preservedCount: number
  removedCount: number
  suspiciousCount: number
  suspiciousSamples: string[]
  modeApplied: EdfAnnotationMode
  replacementText?: string
  requiresManualReview: boolean
}

export interface EdfDeidentificationCertificate {
  version: string
  generatedAt: string
  originalFilename: string
  uploadedFilename: string
  format: 'EDF' | 'EDF+' | 'EDF+D'
  headerBytes: number
  numSignals: number
  reviewedFields: Array<{
    key: string
    label: string
    originalValue: string
    resultValue: string
    changed: boolean
  }>
  annotationReview: EdfAnnotationReview
  anonymizedSha256: string | null
  notes: string[]
}

export interface EdfAnonymizationReport {
  format: 'EDF' | 'EDF+' | 'EDF+D'
  originalFilename: string
  anonymizedFilename: string
  patientFieldChanged: boolean
  recordingFieldChanged: boolean
  startDateChanged: boolean
  startTimeChanged: boolean
  numSignals: number
  headerBytes: number
  reviewedFields: EdfFieldReview[]
  annotationReview: EdfAnnotationReview
  anonymizedSha256: string | null
  certificate: EdfDeidentificationCertificate
}

const EDF_FIXED_HEADER_BYTES = 256
const PATIENT_OFFSET = 8
const PATIENT_LENGTH = 80
const RECORDING_OFFSET = 88
const RECORDING_LENGTH = 80
const START_DATE_OFFSET = 168
const START_DATE_LENGTH = 8
const START_TIME_OFFSET = 176
const START_TIME_LENGTH = 8
const HEADER_BYTES_OFFSET = 184
const HEADER_BYTES_LENGTH = 8
const RESERVED_OFFSET = 192
const RESERVED_LENGTH = 44
const NUM_SIGNALS_OFFSET = 252
const NUM_SIGNALS_LENGTH = 4

const ANON_PATIENT = 'X X X X'
const ANON_RECORDING = 'Startdate X X X X'
const ANON_START_DATE = '01.01.85'
const ANON_START_TIME = '00.00.00'
const CERTIFICATE_VERSION = 'OCEAN Local De-ID v1'
const DEFAULT_ANNOTATION_REPLACEMENT = 'ANOTACION ELIMINADA'

function decodeAscii(bytes: Uint8Array, offset: number, length: number) {
  return new TextDecoder('ascii').decode(bytes.slice(offset, offset + length))
}

function encodeFixedAscii(target: Uint8Array, offset: number, length: number, value: string) {
  const normalized = value.replace(/[^\x20-\x7E]/g, ' ').slice(0, length).padEnd(length, ' ')
  for (let i = 0; i < length; i += 1) {
    target[offset + i] = normalized.charCodeAt(i)
  }
}

function parsePositiveInt(raw: string, field: string) {
  const value = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Cabecera EDF inválida: ${field} no reconocible`)
  }
  return value
}

function detectFormat(reservedField: string): EdfAnonymizationReport['format'] {
  const normalized = reservedField.trim().toUpperCase()
  if (normalized.includes('EDF+D')) return 'EDF+D'
  if (normalized.includes('EDF+C') || normalized.includes('EDF+')) return 'EDF+'
  return 'EDF'
}

function summarizeValue(value: string, fallback = 'EMPTY'): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed
}

function buildDeidentifiedFilename(originalFilename: string): string {
  const extensionMatch = originalFilename.match(/(\.[^.]+)$/)
  const extension = extensionMatch?.[1] ?? '.edf'
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `ocean_local_deid_${stamp}${extension}`
}

function detectPotentialIdentifier(text: string): boolean {
  const normalized = text.toLowerCase()
  const keywordHit = /(paciente|patient|nombre|name|apellido|surname|nhc|historia|dni|sip|dob|birth|hospital|technician|doctor|dr\.|sra\.|sr\.)/.test(normalized)
  const longNumberHit = /\b\d{5,}\b/.test(text)
  const dateHit = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(text)
  return keywordHit || longNumberHit || dateHit
}

async function computeSha256Hex(bytes: Uint8Array): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null
  const source = new Uint8Array(bytes.byteLength)
  source.set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function anonymizeEdfFile(
  file: File,
  options?: {
    annotationMode?: EdfAnnotationMode
    annotationReplacementText?: string
  },
): Promise<{
  anonymizedFile: File
  report: EdfAnonymizationReport
}> {
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength < EDF_FIXED_HEADER_BYTES) {
    throw new Error('Archivo demasiado pequeño para ser un EDF válido')
  }

  const bytes = new Uint8Array(buffer)
  const headerBytes = parsePositiveInt(
    decodeAscii(bytes, HEADER_BYTES_OFFSET, HEADER_BYTES_LENGTH),
    'longitud de cabecera',
  )
  const numSignals = parsePositiveInt(
    decodeAscii(bytes, NUM_SIGNALS_OFFSET, NUM_SIGNALS_LENGTH),
    'número de señales',
  )

  const expectedHeaderBytes = EDF_FIXED_HEADER_BYTES + numSignals * EDF_FIXED_HEADER_BYTES
  if (headerBytes < expectedHeaderBytes || headerBytes > buffer.byteLength) {
    throw new Error('Cabecera EDF incoherente o truncada')
  }

  const reservedField = decodeAscii(bytes, RESERVED_OFFSET, RESERVED_LENGTH)
  const patientField = decodeAscii(bytes, PATIENT_OFFSET, PATIENT_LENGTH)
  const recordingField = decodeAscii(bytes, RECORDING_OFFSET, RECORDING_LENGTH)
  const startDateField = decodeAscii(bytes, START_DATE_OFFSET, START_DATE_LENGTH)
  const startTimeField = decodeAscii(bytes, START_TIME_OFFSET, START_TIME_LENGTH)
  const originalFilename = file.name
  const anonymizedFilename = buildDeidentifiedFilename(originalFilename)
  const annotationMode = options?.annotationMode ?? 'remove'
  const annotationReplacementText = options?.annotationReplacementText?.trim() || DEFAULT_ANNOTATION_REPLACEMENT

  const anonymizedBytes = new Uint8Array(buffer.slice(0))
  encodeFixedAscii(anonymizedBytes, PATIENT_OFFSET, PATIENT_LENGTH, ANON_PATIENT)
  encodeFixedAscii(anonymizedBytes, RECORDING_OFFSET, RECORDING_LENGTH, ANON_RECORDING)
  encodeFixedAscii(anonymizedBytes, START_DATE_OFFSET, START_DATE_LENGTH, ANON_START_DATE)
  encodeFixedAscii(anonymizedBytes, START_TIME_OFFSET, START_TIME_LENGTH, ANON_START_TIME)
  const reviewedFields: EdfFieldReview[] = [
    {
      key: 'patient',
      label: 'Patient field',
      originalValue: summarizeValue(patientField),
      resultValue: ANON_PATIENT,
      changed: patientField.trim() !== ANON_PATIENT,
    },
    {
      key: 'recording',
      label: 'Recording field',
      originalValue: summarizeValue(recordingField),
      resultValue: ANON_RECORDING,
      changed: recordingField.trim() !== ANON_RECORDING,
    },
    {
      key: 'startDate',
      label: 'Start date',
      originalValue: summarizeValue(startDateField),
      resultValue: ANON_START_DATE,
      changed: startDateField.trim() !== ANON_START_DATE,
    },
    {
      key: 'startTime',
      label: 'Start time',
      originalValue: summarizeValue(startTimeField),
      resultValue: ANON_START_TIME,
      changed: startTimeField.trim() !== ANON_START_TIME,
    },
  ]

  let annotations: ReturnType<typeof extractEdfAnnotations> = []
  try {
    annotations = extractEdfAnnotations(bytes)
  } catch {
    annotations = []
  }
  const annotationRewrite = rewriteEdfAnnotations(
    anonymizedBytes,
    annotationMode,
    annotationReplacementText,
  )
  const suspiciousSamples = annotations
    .map((annotation) => annotation.text.trim())
    .filter((text) => text.length > 0 && detectPotentialIdentifier(text))
    .slice(0, 5)
  const annotationReview: EdfAnnotationReview = {
    totalAnnotations: annotationRewrite.annotationsFound,
    preservedCount: annotationRewrite.preservedEntries,
    removedCount: annotationRewrite.removedEntries,
    suspiciousCount: suspiciousSamples.length,
    suspiciousSamples,
    modeApplied: annotationRewrite.modeApplied,
    replacementText: annotationMode === 'replace' ? annotationReplacementText : undefined,
    requiresManualReview: annotationMode === 'keep' && annotationRewrite.annotationsFound > 0,
  }
  const anonymizedSha256 = await computeSha256Hex(anonymizedBytes)
  const format = detectFormat(reservedField)
  const certificate: EdfDeidentificationCertificate = {
    version: CERTIFICATE_VERSION,
    generatedAt: new Date().toISOString(),
    originalFilename,
    uploadedFilename: anonymizedFilename,
    format,
    headerBytes,
    numSignals,
    reviewedFields,
    annotationReview,
    anonymizedSha256,
    notes: [
      'El archivo original no se sube a OCEAN.',
      'La copia generada reescribe identificadores directos de cabecera antes del cifrado.',
      annotationMode === 'remove'
        ? 'Las anotaciones EDF+ se eliminan de la copia subida.'
        : annotationMode === 'replace'
          ? `Las anotaciones EDF+ se reescriben con el texto neutro "${annotationReplacementText}".`
          : annotationMode === 'clinical'
            ? 'Las anotaciones EDF+ se filtran: se conservan solo etiquetas clínicas cortas de una lista blanca local.'
          : 'Las anotaciones EDF+ se conservan y requieren revisión manual antes de subir.',
      'La tabla de reversión no se almacena en OCEAN.',
    ],
  }

  return {
    anonymizedFile: new File([anonymizedBytes], anonymizedFilename, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    }),
    report: {
      format,
      originalFilename,
      anonymizedFilename,
      patientFieldChanged: reviewedFields[0].changed,
      recordingFieldChanged: reviewedFields[1].changed,
      startDateChanged: reviewedFields[2].changed,
      startTimeChanged: reviewedFields[3].changed,
      numSignals,
      headerBytes,
      reviewedFields,
      annotationReview,
      anonymizedSha256,
      certificate,
    },
  }
}
