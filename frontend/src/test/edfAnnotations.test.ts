import { describe, expect, it } from 'vitest'
import { extractEdfAnnotations } from '../utils/edfAnnotations'

function writeFixedAscii(target: Uint8Array, offset: number, length: number, value: string) {
  const normalized = value.slice(0, length).padEnd(length, ' ')
  for (let i = 0; i < length; i += 1) {
    target[offset + i] = normalized.charCodeAt(i)
  }
}

function writeSignalSection(
  target: Uint8Array,
  startOffset: number,
  fieldLength: number,
  values: string[],
) {
  values.forEach((value, index) => {
    writeFixedAscii(target, startOffset + index * fieldLength, fieldLength, value)
  })
}

function encodeTal(onset: string, text: string, duration?: string) {
  const chars = onset
  const bytes: number[] = []
  for (const char of chars) bytes.push(char.charCodeAt(0))
  if (duration !== undefined) {
    bytes.push(21)
    for (const char of duration) bytes.push(char.charCodeAt(0))
  }
  bytes.push(20)
  for (const char of text) bytes.push(char.charCodeAt(0))
  bytes.push(20, 0)
  return bytes
}

function buildFakeEdfWithAnnotations() {
  const numSignals = 2
  const numRecords = 2
  const recordDurationSec = 1
  const samplesPerRecord = [4, 32]
  const headerBytes = 256 + numSignals * 256
  const bytesPerRecord = (samplesPerRecord[0] + samplesPerRecord[1]) * 2
  const totalBytes = headerBytes + numRecords * bytesPerRecord
  const bytes = new Uint8Array(totalBytes)

  writeFixedAscii(bytes, 0, 8, '0')
  writeFixedAscii(bytes, 8, 80, 'Paciente Test')
  writeFixedAscii(bytes, 88, 80, 'Recording Test')
  writeFixedAscii(bytes, 168, 8, '01.01.26')
  writeFixedAscii(bytes, 176, 8, '01.02.03')
  writeFixedAscii(bytes, 184, 8, String(headerBytes))
  writeFixedAscii(bytes, 192, 44, 'EDF+C')
  writeFixedAscii(bytes, 236, 8, String(numRecords))
  writeFixedAscii(bytes, 244, 8, String(recordDurationSec))
  writeFixedAscii(bytes, 252, 4, String(numSignals))

  let cursor = 256
  writeSignalSection(bytes, cursor, 16, ['C3-A2', 'EDF Annotations'])
  cursor += 16 * numSignals
  writeSignalSection(bytes, cursor, 80, ['', ''])
  cursor += 80 * numSignals
  writeSignalSection(bytes, cursor, 8, ['uV', ''])
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 8, ['-100', '-1'])
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 8, ['100', '1'])
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 8, ['-32768', '-32768'])
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 8, ['32767', '32767'])
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 80, ['', ''])
  cursor += 80 * numSignals
  writeSignalSection(bytes, cursor, 8, samplesPerRecord.map(String))
  cursor += 8 * numSignals
  writeSignalSection(bytes, cursor, 32, ['', ''])

  const annotationRecord0 = [
    ...encodeTal('+0', ''),
    ...encodeTal('+0.5', 'Evento alfa'),
  ]
  const annotationRecord1 = [
    ...encodeTal('+1', ''),
    ...encodeTal('+1.25', 'Crisis', '0.75'),
  ]

  const record0Base = headerBytes
  const record1Base = headerBytes + bytesPerRecord
  const annotationOffsetWithinRecord = samplesPerRecord[0] * 2
  bytes.set(annotationRecord0, record0Base + annotationOffsetWithinRecord)
  bytes.set(annotationRecord1, record1Base + annotationOffsetWithinRecord)

  return bytes
}

describe('EDF annotations', () => {
  it('extrae anotaciones EDF+ embebidas y normaliza el offset temporal', () => {
    const annotations = extractEdfAnnotations(buildFakeEdfWithAnnotations())

    expect(annotations).toEqual([
      { onsetSec: 0.5, durationSec: -1, text: 'Evento alfa' },
      { onsetSec: 1.25, durationSec: 0.75, text: 'Crisis' },
    ])
  })

  it('devuelve vacío cuando el EDF no tiene canal de anotaciones', () => {
    const bytes = buildFakeEdfWithAnnotations()
    writeFixedAscii(bytes, 256 + 16, 16, 'ECG')
    expect(extractEdfAnnotations(bytes)).toEqual([])
  })

  it('rechaza EDF truncados en la zona de datarecords', () => {
    const truncated = buildFakeEdfWithAnnotations().slice(0, -10)
    expect(() => extractEdfAnnotations(truncated)).toThrow(/EDF truncado/)
  })
})
