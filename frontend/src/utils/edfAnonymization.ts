export interface EdfAnonymizationReport {
  format: 'EDF' | 'EDF+' | 'EDF+D'
  patientFieldChanged: boolean
  recordingFieldChanged: boolean
  startDateChanged: boolean
  startTimeChanged: boolean
  numSignals: number
  headerBytes: number
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

export async function anonymizeEdfFile(file: File): Promise<{
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

  const anonymizedBytes = new Uint8Array(buffer.slice(0))
  encodeFixedAscii(anonymizedBytes, PATIENT_OFFSET, PATIENT_LENGTH, ANON_PATIENT)
  encodeFixedAscii(anonymizedBytes, RECORDING_OFFSET, RECORDING_LENGTH, ANON_RECORDING)
  encodeFixedAscii(anonymizedBytes, START_DATE_OFFSET, START_DATE_LENGTH, ANON_START_DATE)
  encodeFixedAscii(anonymizedBytes, START_TIME_OFFSET, START_TIME_LENGTH, ANON_START_TIME)

  return {
    anonymizedFile: new File([anonymizedBytes], file.name, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
    }),
    report: {
      format: detectFormat(reservedField),
      patientFieldChanged: patientField.trim() !== ANON_PATIENT,
      recordingFieldChanged: recordingField.trim() !== ANON_RECORDING,
      startDateChanged: startDateField.trim() !== ANON_START_DATE,
      startTimeChanged: startTimeField.trim() !== ANON_START_TIME,
      numSignals,
      headerBytes,
    },
  }
}
