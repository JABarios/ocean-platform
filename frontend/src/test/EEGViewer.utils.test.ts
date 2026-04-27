import { describe, expect, it } from 'vitest'
import {
  MONTAGE_OPTIONS,
  applyMontage,
  getChannelColor,
  getNextArtifactRejectState,
  getRecordsPerPage,
  shouldShowMetadataForPointer,
} from '../pages/eegViewerUtils'
import type { EpochData } from '../pages/eegViewerUtils'

function makeEpoch(signals: Record<string, number[]>, types?: Record<string, string>): EpochData {
  const channelNames = Object.keys(signals)
  return {
    nChannels: channelNames.length,
    nSamples: channelNames.length > 0 ? signals[channelNames[0]].length : 0,
    sfreq: 100,
    channelNames,
    channelTypes: channelNames.map((name) => types?.[name] ?? 'EEG'),
    data: channelNames.map((name) => Float32Array.from(signals[name])),
  }
}

function asArray(signal: Float32Array): number[] {
  return Array.from(signal)
}

describe('EEG viewer utils', () => {
  it('mantiene el orden esperado de montajes en el selector', () => {
    expect(MONTAGE_OPTIONS).toEqual([
      'promedio',
      'doble_banana',
      'transversal',
      'linked_mastoids',
      'hjorth',
    ])
  })

  it('calcula records por página usando la duración real del record', () => {
    expect(getRecordsPerPage(10, 0.5)).toBe(20)
    expect(getRecordsPerPage(10, 2)).toBe(5)
    expect(getRecordsPerPage(10, 0)).toBe(10)
  })

  it('colorea canales izquierdos, derechos y de línea media como está definido', () => {
    expect(getChannelColor('Fp1 - AVG', 'EEG')).toBe('#1d4ed8')
    expect(getChannelColor('Fp2 - AVG', 'EEG')).toBe('#b91c1c')
    expect(getChannelColor('Cz - AVG', 'EEG')).toBe('#475569')
    expect(getChannelColor('EOG1', 'EOG')).toBe('#047857')
  })

  it('aplica montaje promedio restando la media instantánea a cada canal y preserva el orden', () => {
    const epoch = makeEpoch({
      Fp1: [10, 20],
      F7: [20, 30],
      F3: [30, 40],
      T3: [40, 50],
      C3: [50, 60],
      T5: [60, 70],
      P3: [70, 80],
      O1: [80, 90],
      Fz: [90, 100],
      Cz: [100, 110],
      Pz: [110, 120],
      Fp2: [120, 130],
      F4: [130, 140],
      F8: [140, 150],
      C4: [150, 160],
      T4: [160, 170],
      P4: [170, 180],
      T6: [180, 190],
      O2: [190, 200],
    })

    const result = applyMontage(epoch, 'promedio')
    const avg0 = 100
    const avg1 = 110

    expect(result.channelNames.slice(0, 4)).toEqual([
      'Fp1 - AVG',
      'F7 - AVG',
      'F3 - AVG',
      'T3 - AVG',
    ])
    expect(asArray(result.data[0])).toEqual([10 - avg0, 20 - avg1])
    expect(asArray(result.data[10])).toEqual([110 - avg0, 120 - avg1])
    expect(asArray(result.data[result.data.length - 1])).toEqual([190 - avg0, 200 - avg1])
  })

  it('aplica linked mastoids usando la media de A1 y A2 como referencia común', () => {
    const epoch = makeEpoch({
      A1: [2, 4],
      A2: [6, 8],
      Fp1: [20, 24],
      F7: [10, 12],
      F3: [30, 36],
      T3: [14, 18],
      C3: [22, 28],
      T5: [16, 20],
      P3: [18, 22],
      O1: [12, 14],
      Fz: [40, 44],
      Cz: [42, 46],
      Pz: [38, 42],
      Fp2: [26, 28],
      F4: [32, 34],
      F8: [24, 26],
      C4: [28, 32],
      T4: [18, 20],
      P4: [16, 18],
      T6: [14, 16],
      O2: [10, 12],
    })

    const result = applyMontage(epoch, 'linked_mastoids')
    const lm = [4, 6]

    expect(result.channelNames[0]).toBe('Fp1 - LM')
    expect(asArray(result.data[0])).toEqual([20 - lm[0], 24 - lm[1]])
    expect(asArray(result.data[8])).toEqual([40 - lm[0], 44 - lm[1]])
  })

  it('aplica hjorth restando la media de vecinos listados', () => {
    const epoch = makeEpoch({
      Fp1: [10, 20],
      F3: [30, 50],
      F7: [20, 40],
      Fz: [40, 60],
      C3: [35, 55],
      T3: [15, 25],
      P3: [45, 65],
      Cz: [50, 70],
      T5: [25, 35],
      O1: [55, 75],
      Fp2: [12, 22],
      F4: [32, 52],
      F8: [22, 42],
      C4: [36, 56],
      T4: [16, 26],
      P4: [46, 66],
      Pz: [52, 72],
      T6: [26, 36],
      O2: [56, 76],
    })

    const result = applyMontage(epoch, 'hjorth')

    expect(result.channelNames[0]).toBe('Fp1 - AVG(F3,F7,Fz)')
    expect(asArray(result.data[0])).toEqual([-20, -30])
    expect(result.channelNames[1]).toBe('F3 - AVG(Fp1,F7,C3,Fz)')
    expect(asArray(result.data[1])).toEqual([3.75, 6.25])
  })

  it('muestra metadata solo dentro de la banda izquierda de etiquetas', () => {
    expect(shouldShowMetadataForPointer(0)).toBe(true)
    expect(shouldShowMetadataForPointer(76)).toBe(true)
    expect(shouldShowMetadataForPointer(77)).toBe(false)
    expect(shouldShowMetadataForPointer(-1)).toBe(false)
  })

  it('activa artefactos al encender DSA y los apaga al desactivarlo', () => {
    expect(getNextArtifactRejectState('off', '3', false)).toBe(true)
    expect(getNextArtifactRejectState('3', '5', true)).toBe(true)
    expect(getNextArtifactRejectState('3', '5', false)).toBe(false)
    expect(getNextArtifactRejectState('5', 'off', true)).toBe(false)
  })
})
