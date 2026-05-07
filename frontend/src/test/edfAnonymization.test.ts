import { describe, expect, it } from 'vitest'
import { anonymizeEdfFile } from '../utils/edfAnonymization'

function writeFixedAscii(target: Uint8Array, offset: number, length: number, value: string) {
  const normalized = value.slice(0, length).padEnd(length, ' ')
  for (let i = 0; i < length; i += 1) {
    target[offset + i] = normalized.charCodeAt(i)
  }
}

function buildFakeEdf(overrides?: {
  patient?: string
  recording?: string
  startDate?: string
  startTime?: string
  reserved?: string
  numSignals?: number
}) {
  const numSignals = overrides?.numSignals ?? 2
  const headerBytes = 256 + numSignals * 256
  const totalBytes = headerBytes + 32
  const bytes = new Uint8Array(totalBytes)

  writeFixedAscii(bytes, 0, 8, '0')
  writeFixedAscii(bytes, 8, 80, overrides?.patient ?? 'Juan Perez 01-JAN-1980')
  writeFixedAscii(bytes, 88, 80, overrides?.recording ?? 'Startdate 29-APR-2026 Valencia')
  writeFixedAscii(bytes, 168, 8, overrides?.startDate ?? '29.04.26')
  writeFixedAscii(bytes, 176, 8, overrides?.startTime ?? '13.37.00')
  writeFixedAscii(bytes, 184, 8, String(headerBytes))
  writeFixedAscii(bytes, 192, 44, overrides?.reserved ?? 'EDF+C')
  writeFixedAscii(bytes, 236, 8, '1')
  writeFixedAscii(bytes, 244, 8, '1')
  writeFixedAscii(bytes, 252, 4, String(numSignals))

  return new File([bytes], 'sample.edf', { type: 'application/octet-stream' })
}

async function readTextSlice(file: File, offset: number, length: number) {
  const buffer = await file.arrayBuffer()
  return new TextDecoder('ascii').decode(new Uint8Array(buffer).slice(offset, offset + length))
}

describe('EDF anonymization', () => {
  it('reescribe los campos sensibles de la cabecera antes del cifrado', async () => {
    const source = buildFakeEdf()
    const { anonymizedFile, report } = await anonymizeEdfFile(source)

    expect(report.format).toBe('EDF+')
    expect(report.originalFilename).toBe('sample.edf')
    expect(report.anonymizedFilename).toMatch(/^ocean_local_deid_\d{14}\.edf$/)
    expect(anonymizedFile.name).toBe(report.anonymizedFilename)
    expect(report.patientFieldChanged).toBe(true)
    expect(report.recordingFieldChanged).toBe(true)
    expect(report.startDateChanged).toBe(true)
    expect(report.startTimeChanged).toBe(true)
    expect(report.reviewedFields).toHaveLength(4)
    expect(report.annotationReview.totalAnnotations).toBe(0)
    expect(report.certificate.uploadedFilename).toBe(report.anonymizedFilename)
    expect(report.certificate.notes[0]).toMatch(/archivo original no se sube/i)
    expect(report.anonymizedSha256).toMatch(/^[0-9a-f]{64}$/)

    await expect(readTextSlice(anonymizedFile, 8, 80)).resolves.toContain('X X X X')
    await expect(readTextSlice(anonymizedFile, 88, 80)).resolves.toContain('Startdate X X X X')
    await expect(readTextSlice(anonymizedFile, 168, 8)).resolves.toBe('01.01.85')
    await expect(readTextSlice(anonymizedFile, 176, 8)).resolves.toBe('00.00.00')
  })

  it('detecta EDF clásico y conserva el tamaño de cabecera', async () => {
    const source = buildFakeEdf({ reserved: '' })
    const { anonymizedFile, report } = await anonymizeEdfFile(source)

    expect(report.format).toBe('EDF')
    expect(report.headerBytes).toBe(768)
    expect(report.numSignals).toBe(2)
    expect(anonymizedFile.size).toBe(source.size)
  })

  it('rechaza cabeceras incoherentes', async () => {
    const broken = buildFakeEdf()
    const brokenBuffer = new Uint8Array(await broken.arrayBuffer())
    writeFixedAscii(brokenBuffer, 252, 4, '20')
    const inconsistent = new File([brokenBuffer], 'broken.edf', { type: 'application/octet-stream' })
    await expect(anonymizeEdfFile(inconsistent)).rejects.toThrow(/Cabecera EDF incoherente/)
  })

  it('elimina las anotaciones EDF+ por defecto en la política de desidentificación', async () => {
    const source = buildFakeEdf({ numSignals: 2 })
    const { report } = await anonymizeEdfFile(source)

    expect(report.annotationReview.modeApplied).toBe('remove')
    expect(report.annotationReview.preservedCount).toBe(0)
    expect(report.annotationReview.requiresManualReview).toBe(false)
    expect(report.certificate.notes.join(' ')).toMatch(/anotaciones edf\+ se eliminan/i)
  })

  it('puede informar del modo clínico filtrado para anotaciones EDF+', async () => {
    const source = buildFakeEdf({ numSignals: 2 })
    const { report } = await anonymizeEdfFile(source, { annotationMode: 'clinical' })

    expect(report.annotationReview.modeApplied).toBe('clinical')
    expect(report.annotationReview.totalAnnotations).toBe(0)
    expect(report.annotationReview.preservedCount).toBe(0)
    expect(report.annotationReview.removedCount).toBe(0)
    expect(report.certificate.notes.join(' ')).toMatch(/lista blanca local/i)
  })
})
