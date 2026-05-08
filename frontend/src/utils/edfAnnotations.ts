export interface EdfAnnotation {
  onsetSec: number
  durationSec: number
  text: string
}

export interface EdfAnnotationRewriteResult {
  bytes: Uint8Array
  annotationsFound: number
  rewrittenEntries: number
  preservedEntries: number
  removedEntries: number
  modeApplied: 'keep' | 'remove' | 'replace' | 'clinical'
}

const EDF_FIXED_HEADER_BYTES = 256
const HEADER_BYTES_OFFSET = 184
const HEADER_BYTES_LENGTH = 8
const NUM_RECORDS_OFFSET = 236
const NUM_RECORDS_LENGTH = 8
const RECORD_DURATION_OFFSET = 244
const RECORD_DURATION_LENGTH = 8
const NUM_SIGNALS_OFFSET = 252
const NUM_SIGNALS_LENGTH = 4
const SIGNAL_HEADER_BYTES = 256

const FIELD_LABEL_LENGTH = 16
const FIELD_TRANSDUCER_LENGTH = 80
const FIELD_PHYSICAL_DIMENSION_LENGTH = 8
const FIELD_PHYSICAL_MIN_LENGTH = 8
const FIELD_PHYSICAL_MAX_LENGTH = 8
const FIELD_DIGITAL_MIN_LENGTH = 8
const FIELD_DIGITAL_MAX_LENGTH = 8
const FIELD_PREFILTER_LENGTH = 80
const FIELD_SAMPLES_PER_RECORD_LENGTH = 8
const FIELD_RESERVED_LENGTH = 32

const TAL_SEPARATOR = 20
const TAL_DURATION_MARKER = 21
const TAL_TERMINATOR = 0
const CLINICAL_ANNOTATION_WHITELIST = new Set([
  'HV',
  'HPV',
  'ELI',
  'EO',
  'EC',
  'IPS',
  'SLEEP',
  'AWAKE',
  'DROWSY',
  'SPINDLE',
  'SPIKE',
  'SPIKES',
  'K COMPLEX',
  'K-COMPLEX',
  'KC',
  'PHOTIC',
  'PHOTO',
  'SEIZURE',
  'CRISIS',
  'AROUSAL',
])

interface EdfAnnotationHeader {
  headerBytes: number
  numSignals: number
  numRecords: number
  recordDurationSec: number
  sampleSizeBytes: number
  signalLabels: string[]
  samplesPerRecord: number[]
}

function decodeAscii(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder('ascii').decode(bytes.slice(offset, offset + length))
}

function parsePositiveInt(raw: string, field: string): number {
  const value = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Cabecera EDF inválida: ${field} no reconocible`)
  }
  return value
}

function parseRecordCount(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '-1') {
    throw new Error('EDF con número de registros desconocido no soportado en visor web')
  }
  return parsePositiveInt(trimmed, 'número de registros')
}

function parsePositiveFloat(raw: string, field: string): number {
  const normalized = raw.trim().replace(',', '.')
  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Cabecera EDF inválida: ${field} no reconocible`)
  }
  return value
}

function parseHeader(bytes: Uint8Array): EdfAnnotationHeader {
  if (bytes.byteLength < EDF_FIXED_HEADER_BYTES) {
    throw new Error('Archivo demasiado pequeño para ser un EDF válido')
  }

  const headerBytes = parsePositiveInt(
    decodeAscii(bytes, HEADER_BYTES_OFFSET, HEADER_BYTES_LENGTH),
    'longitud de cabecera',
  )
  const numSignals = parsePositiveInt(
    decodeAscii(bytes, NUM_SIGNALS_OFFSET, NUM_SIGNALS_LENGTH),
    'número de señales',
  )
  const expectedHeaderBytes = EDF_FIXED_HEADER_BYTES + numSignals * SIGNAL_HEADER_BYTES
  if (headerBytes < expectedHeaderBytes || headerBytes > bytes.byteLength) {
    throw new Error('Cabecera EDF incoherente o truncada')
  }

  const numRecords = parseRecordCount(
    decodeAscii(bytes, NUM_RECORDS_OFFSET, NUM_RECORDS_LENGTH),
  )
  const recordDurationSec = parsePositiveFloat(
    decodeAscii(bytes, RECORD_DURATION_OFFSET, RECORD_DURATION_LENGTH),
    'duración de datarecord',
  )

  let cursor = EDF_FIXED_HEADER_BYTES
  const readSignalField = (length: number) => {
    const start = cursor
    cursor += length * numSignals
    return Array.from({ length: numSignals }, (_, index) =>
      decodeAscii(bytes, start + index * length, length).trim(),
    )
  }

  const signalLabels = readSignalField(FIELD_LABEL_LENGTH)
  cursor += FIELD_TRANSDUCER_LENGTH * numSignals
  cursor += FIELD_PHYSICAL_DIMENSION_LENGTH * numSignals
  cursor += FIELD_PHYSICAL_MIN_LENGTH * numSignals
  cursor += FIELD_PHYSICAL_MAX_LENGTH * numSignals
  cursor += FIELD_DIGITAL_MIN_LENGTH * numSignals
  cursor += FIELD_DIGITAL_MAX_LENGTH * numSignals
  cursor += FIELD_PREFILTER_LENGTH * numSignals
  const samplesPerRecord = readSignalField(FIELD_SAMPLES_PER_RECORD_LENGTH).map((value) =>
    parsePositiveInt(value, 'muestras por record'),
  )
  cursor += FIELD_RESERVED_LENGTH * numSignals

  if (cursor !== headerBytes) {
    throw new Error('Cabecera EDF incoherente: tamaño de señales no cuadra con headerBytes')
  }

  const sampleSizeBytes = bytes[0] === 0xff ? 3 : 2
  return {
    headerBytes,
    numSignals,
    numRecords,
    recordDurationSec,
    sampleSizeBytes,
    signalLabels,
    samplesPerRecord,
  }
}

function parseAnnotationChunk(chunk: Uint8Array): {
  onsetSec: number
  durationSec: number
  texts: string[]
} | null {
  const onsetBoundary = chunk.findIndex((value) => value === TAL_SEPARATOR || value === TAL_DURATION_MARKER)
  if (onsetBoundary <= 0) return null

  const onsetSec = Number.parseFloat(
    decodeAscii(chunk, 0, onsetBoundary).trim().replace(',', '.'),
  )
  if (!Number.isFinite(onsetSec)) return null

  let cursor = onsetBoundary
  let durationSec = -1

  if (chunk[cursor] === TAL_DURATION_MARKER) {
    cursor += 1
    const durationBoundary = chunk.findIndex((value, index) => index >= cursor && value === TAL_SEPARATOR)
    if (durationBoundary < 0) return null
    const parsedDuration = Number.parseFloat(
      decodeAscii(chunk, cursor, durationBoundary - cursor).trim().replace(',', '.'),
    )
    if (Number.isFinite(parsedDuration)) {
      durationSec = parsedDuration
    }
    cursor = durationBoundary
  }

  const texts: string[] = []
  while (cursor < chunk.length) {
    if (chunk[cursor] !== TAL_SEPARATOR) {
      cursor += 1
      continue
    }
    cursor += 1
    const nextBoundary = chunk.findIndex((value, index) => index >= cursor && value === TAL_SEPARATOR)
    const end = nextBoundary >= 0 ? nextBoundary : chunk.length
    const text = decodeAscii(chunk, cursor, end - cursor).trim()
    if (text.length > 0) {
      texts.push(text)
    }
    cursor = end
  }

  return { onsetSec, durationSec, texts }
}

function parseAnnotationSignal(signalBytes: Uint8Array): Array<{
  onsetSec: number
  durationSec: number
  texts: string[]
}> {
  const chunks: Uint8Array[] = []
  let start = 0

  for (let i = 0; i < signalBytes.length; i += 1) {
    if (signalBytes[i] !== TAL_TERMINATOR) continue
    if (i > start) {
      chunks.push(signalBytes.slice(start, i))
    }
    start = i + 1
  }

  return chunks
    .map((chunk) => parseAnnotationChunk(chunk))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

function formatTalOnset(value: number): string {
  if (!Number.isFinite(value)) return '+0'
  const abs = Math.abs(value)
  const compact = Number.isInteger(abs) ? String(abs) : abs.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return `${value >= 0 ? '+' : '-'}${compact}`
}

function formatTalDuration(value: number): string {
  if (!Number.isFinite(value) || value < 0) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function encodeAnnotationEntry(
  onsetSec: number,
  durationSec: number,
  texts: string[],
): Uint8Array {
  const bytes: number[] = []
  for (const char of formatTalOnset(onsetSec)) bytes.push(char.charCodeAt(0))
  if (durationSec >= 0) {
    bytes.push(TAL_DURATION_MARKER)
    for (const char of formatTalDuration(durationSec)) bytes.push(char.charCodeAt(0))
  }
  bytes.push(TAL_SEPARATOR)
  for (const text of texts) {
    for (const char of text) bytes.push(char.charCodeAt(0))
    bytes.push(TAL_SEPARATOR)
  }
  bytes.push(TAL_TERMINATOR)
  return new Uint8Array(bytes)
}

function normalizeAnnotationLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function isWhitelistedClinicalAnnotation(text: string): boolean {
  const normalized = normalizeAnnotationLabel(text)
  if (!normalized || normalized.length > 32) return false
  return CLINICAL_ANNOTATION_WHITELIST.has(normalized)
}

export function extractEdfAnnotations(input: ArrayBuffer | Uint8Array): EdfAnnotation[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const header = parseHeader(bytes)
  const annotationIndexes = header.signalLabels
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => label.startsWith('EDF Annotations'))
    .map(({ index }) => index)

  if (annotationIndexes.length === 0) return []

  const recordByteSize = header.samplesPerRecord
    .reduce((sum, samples) => sum + samples * header.sampleSizeBytes, 0)
  const expectedDataEnd = header.headerBytes + recordByteSize * header.numRecords
  if (expectedDataEnd > bytes.byteLength) {
    throw new Error('EDF truncado: faltan datarecords para leer anotaciones')
  }

  const channelByteOffsets: number[] = []
  let channelOffset = 0
  for (const samples of header.samplesPerRecord) {
    channelByteOffsets.push(channelOffset)
    channelOffset += samples * header.sampleSizeBytes
  }

  let startTimeOffsetSec = 0
  let startTimeOffsetInitialized = false
  const annotations: EdfAnnotation[] = []

  for (let recordIndex = 0; recordIndex < header.numRecords; recordIndex += 1) {
    const recordBase = header.headerBytes + recordIndex * recordByteSize

    for (let annotationSignalIndex = 0; annotationSignalIndex < annotationIndexes.length; annotationSignalIndex += 1) {
      const channelIndex = annotationIndexes[annotationSignalIndex]
      const byteOffset = channelByteOffsets[channelIndex]
      const byteLength = header.samplesPerRecord[channelIndex] * header.sampleSizeBytes
      const signalBytes = bytes.slice(recordBase + byteOffset, recordBase + byteOffset + byteLength)
      const signalEntries = parseAnnotationSignal(signalBytes)

      signalEntries.forEach((entry, entryIndex) => {
        if (!startTimeOffsetInitialized && annotationSignalIndex === 0 && entryIndex === 0) {
          startTimeOffsetSec = entry.onsetSec
          startTimeOffsetInitialized = true
        }

        entry.texts.forEach((text) => {
          annotations.push({
            onsetSec: entry.onsetSec - startTimeOffsetSec,
            durationSec: entry.durationSec,
            text,
          })
        })
      })
    }
  }

  return annotations
    .filter((annotation) => Number.isFinite(annotation.onsetSec))
    .sort((a, b) => a.onsetSec - b.onsetSec)
}

export function rewriteEdfAnnotations(
  input: ArrayBuffer | Uint8Array,
  mode: 'keep' | 'remove' | 'replace' | 'clinical',
  replacementText = 'ANOTACION ELIMINADA',
): EdfAnnotationRewriteResult {
  const bytes = input instanceof Uint8Array ? new Uint8Array(input.slice()) : new Uint8Array(input.slice(0))
  if (mode === 'keep') {
    const existing = extractEdfAnnotations(bytes)
    return {
      bytes,
      annotationsFound: existing.length,
      rewrittenEntries: 0,
      preservedEntries: existing.length,
      removedEntries: 0,
      modeApplied: mode,
    }
  }

  let header: EdfAnnotationHeader
  try {
    header = parseHeader(bytes)
  } catch {
    return {
      bytes,
      annotationsFound: 0,
      rewrittenEntries: 0,
      preservedEntries: 0,
      removedEntries: 0,
      modeApplied: mode,
    }
  }
  const annotationIndexes = header.signalLabels
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => label.startsWith('EDF Annotations'))
    .map(({ index }) => index)

  if (annotationIndexes.length === 0) {
    return {
      bytes,
      annotationsFound: 0,
      rewrittenEntries: 0,
      preservedEntries: 0,
      removedEntries: 0,
      modeApplied: mode,
    }
  }

  const recordByteSize = header.samplesPerRecord
    .reduce((sum, samples) => sum + samples * header.sampleSizeBytes, 0)
  const channelByteOffsets: number[] = []
  let channelOffset = 0
  for (const samples of header.samplesPerRecord) {
    channelByteOffsets.push(channelOffset)
    channelOffset += samples * header.sampleSizeBytes
  }

  let annotationsFound = 0
  let rewrittenEntries = 0
  let preservedEntries = 0
  let removedEntries = 0
  for (let recordIndex = 0; recordIndex < header.numRecords; recordIndex += 1) {
    const recordBase = header.headerBytes + recordIndex * recordByteSize
    for (const channelIndex of annotationIndexes) {
      const byteOffset = channelByteOffsets[channelIndex]
      const byteLength = header.samplesPerRecord[channelIndex] * header.sampleSizeBytes
      const start = recordBase + byteOffset
      const end = start + byteLength
      const signalBytes = bytes.slice(start, end)
      const signalEntries = parseAnnotationSignal(signalBytes)
      const rewritten = new Uint8Array(byteLength)
      let cursor = 0

      signalEntries.forEach((entry) => {
        annotationsFound += entry.texts.length
        const nextTexts =
          mode === 'replace' && entry.texts.length > 0
            ? entry.texts.map(() => replacementText)
            : mode === 'clinical' && entry.texts.length > 0
              ? entry.texts.filter((text) => isWhitelistedClinicalAnnotation(text))
            : []
        preservedEntries += nextTexts.length
        removedEntries += entry.texts.length - nextTexts.length
        if (mode === 'replace' && entry.texts.length > 0) {
          rewrittenEntries += entry.texts.length
        }
        if (mode === 'clinical' && entry.texts.length > nextTexts.length) {
          rewrittenEntries += entry.texts.length - nextTexts.length
        }
        const encoded = encodeAnnotationEntry(entry.onsetSec, entry.durationSec, nextTexts)
        if (cursor + encoded.length <= rewritten.length) {
          rewritten.set(encoded, cursor)
          cursor += encoded.length
        }
      })

      bytes.set(rewritten, start)
    }
  }

  return {
    bytes,
    annotationsFound,
    rewrittenEntries,
    preservedEntries,
    removedEntries,
    modeApplied: mode,
  }
}
