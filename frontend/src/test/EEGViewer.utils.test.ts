import { describe, expect, it } from 'vitest'
import {
  computeTriggerThresholdRange,
  computeTriggeredAverage,
  detectThresholdCrossings,
  filterSignalForAverage,
  filterSignalForTrigger,
  MONTAGE_OPTIONS,
  applyMontage,
  getAverageReferenceCandidates,
  getChannelColor,
  getMontageHiddenCandidates,
  getEpochReadRequest,
  getNextArtifactRejectState,
  getPageIndexForSecond,
  getPageStepSeconds,
  getRecordsPerPage,
  getSecondBasedPageStart,
  sanitizePersistedViewerState,
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
      'raw',
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

  it('calcula el paso real de página según el span de records EDF', () => {
    expect(getPageStepSeconds(20, 1)).toBe(20)
    expect(getPageStepSeconds(20, 4.5)).toBe(20)
    expect(getPageStepSeconds(10, 30)).toBe(10)
  })

  it('calcula la página actual usando segundos reales y no records EDF', () => {
    expect(getPageIndexForSecond(0, 10)).toBe(0)
    expect(getPageIndexForSecond(9.9, 10)).toBe(0)
    expect(getPageIndexForSecond(10, 10)).toBe(1)
    expect(getPageIndexForSecond(21, 10)).toBe(2)
  })

  it('traduce segundos a records más recorte interno sin repetir página al final del registro', () => {
    expect(getEpochReadRequest(20, 20, 95, 4.5)).toEqual({
      startSec: 20,
      recordStartSec: 18,
      cropStartSec: 2,
      offsetRecords: 4,
      numRecords: 5,
      durationSec: 20,
    })

    expect(getEpochReadRequest(90, 20, 95, 4.5)).toEqual({
      startSec: 75,
      recordStartSec: 72,
      cropStartSec: 3,
      offsetRecords: 16,
      numRecords: 6,
      durationSec: 20,
    })

    expect(getEpochReadRequest(500, 20, 95, 4.5)).toEqual({
      startSec: 75,
      recordStartSec: 72,
      cropStartSec: 3,
      offsetRecords: 16,
      numRecords: 6,
      durationSec: 20,
    })
  })

  it('calcula el inicio de página por segundos reales para la navegación fina', () => {
    expect(getSecondBasedPageStart(1, 120, 10, 10, false)).toBe(1)
    expect(getSecondBasedPageStart(21, 120, 10, 10, false)).toBe(21)
    expect(getSecondBasedPageStart(21.8, 120, 10, 10, false)).toBe(21)
    expect(getSecondBasedPageStart(30, 120, 10, 10, true)).toBe(25)
    expect(getSecondBasedPageStart(119, 120, 10, 10, false)).toBe(110)
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

  it('expone un montaje raw que preserva el orden y los datos originales', () => {
    const epoch = makeEpoch({
      Fp1: [1, 2],
      EOG1: [3, 4],
      Cz: [5, 6],
    }, {
      Fp1: 'EEG',
      EOG1: 'EOG',
      Cz: 'EEG',
    })

    const result = applyMontage(epoch, 'raw')

    expect(result).toBe(epoch)
    expect(result.channelNames).toEqual(['Fp1', 'EOG1', 'Cz'])
    expect(asArray(result.data[1])).toEqual([3, 4])
  })

  it('permite excluir canales concretos de la referencia promedio', () => {
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
      EOG1: [999, 999],
    }, {
      EOG1: 'EOG',
    })

    const candidates = getAverageReferenceCandidates(epoch)
    expect(candidates).not.toContain('EOG1')

    const fullAverage = applyMontage(epoch, 'promedio')
    const excluded = applyMontage(epoch, 'promedio', {
      excludedAverageReferenceChannels: new Set(['O2']),
    })

    expect(asArray(fullAverage.data[0])).toEqual([-90, -90])
    expect(asArray(excluded.data[0])).toEqual([-85, -85])
  })

  it('reconoce canales EEG con prefijos habituales al construir promedio y Ref AVG', () => {
    const epoch = makeEpoch({
      'EEG Fp1': [10, 20],
      'EEG F7': [20, 30],
      'EEG F3': [30, 40],
      'EEG T3': [40, 50],
      'EEG C3': [50, 60],
      'EEG T5': [60, 70],
      'EEG P3': [70, 80],
      'EEG O1': [80, 90],
      'EEG Fz': [90, 100],
      'EEG Cz': [100, 110],
      'EEG Pz': [110, 120],
      'EEG Fp2': [120, 130],
      'EEG F4': [130, 140],
      'EEG F8': [140, 150],
      'EEG C4': [150, 160],
      'EEG T4': [160, 170],
      'EEG P4': [170, 180],
      'EEG T6': [180, 190],
      'EEG O2': [190, 200],
    })

    const candidates = getAverageReferenceCandidates(epoch)
    expect(candidates).toContain('EEG F7')
    expect(candidates).toContain('EEG O2')

    const result = applyMontage(epoch, 'promedio')
    expect(result.channelNames[0]).toBe('Fp1 - AVG')
    expect(result.channelNames[1]).toBe('F7 - AVG')
    expect(asArray(result.data[0])).toEqual([-90, -90])
  })

  it('no inventa canales planos en promedio cuando faltan electrodos del montaje', () => {
    const epoch = makeEpoch({
      Fp1: [10, 20],
      F7: [20, 30],
      Cz: [30, 40],
      ECG: [1, 2],
    }, {
      ECG: 'ECG',
    })

    const result = applyMontage(epoch, 'promedio')

    expect(result.channelNames).toEqual([
      'Fp1 - AVG',
      'F7 - AVG',
      'Cz - AVG',
    ])
    expect(result.nChannels).toBe(3)
  })

  it('no marca como ocultos canales ya cubiertos por el montaje si vienen con prefijo EEG', () => {
    const epoch = makeEpoch({
      'EEG Fp1': [10, 20],
      'EEG F7': [20, 30],
      ECG: [1, 2],
    }, {
      ECG: 'ECG',
    })

    const hidden = getMontageHiddenCandidates(epoch, 'promedio')
    expect(hidden).toEqual(['ECG'])
  })

  it('lista canales ocultos por el montaje y permite añadirlos al trazado', () => {
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
      A1: [1, 2],
      ECG: [3, 4],
    }, {
      ECG: 'ECG',
    })

    const hidden = getMontageHiddenCandidates(epoch, 'promedio')
    expect(hidden).toEqual(['A1', 'ECG'])

    const result = applyMontage(epoch, 'promedio', {
      includedHiddenChannels: new Set(['ECG']),
    })

    expect(result.channelNames[result.channelNames.length - 1]).toBe('ECG')
    expect(asArray(result.data[result.data.length - 1])).toEqual([3, 4])
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

  it('en linked mastoids usa el mastoide disponible sin promediar con cero', () => {
    const epoch = makeEpoch({
      A1: [2, 4],
      Fp1: [20, 24],
      F7: [10, 12],
      Cz: [40, 44],
    })

    const result = applyMontage(epoch, 'linked_mastoids')

    expect(result.channelNames).toEqual([
      'Fp1 - LM',
      'F7 - LM',
      'Cz - LM',
    ])
    expect(asArray(result.data[0])).toEqual([18, 20])
    expect(asArray(result.data[2])).toEqual([38, 40])
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

  it('sanea el estado persistido del visor frente a canales y montajes inválidos', () => {
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
      ECG: [1, 2],
    }, {
      ECG: 'ECG',
    })

    const result = sanitizePersistedViewerState({
      positionSec: 9999,
      windowSecs: 21,
      hp: 1,
      lp: 30,
      notch: false,
      gainMult: 2,
      normalizeNonEEG: true,
      montage: 'inventado',
      excludedAverageReferenceChannels: ['Fp1', 'BAD'],
      includedHiddenChannels: ['ECG', 'BAD'],
      dsaChannel: '999',
      artifactReject: true,
    }, epoch, 120)

    expect(result).toEqual({
      positionSec: 120,
      windowSecs: 20,
      hp: 1,
      lp: 30,
      notch: 0,
      gainMult: 2,
      normalizeNonEEG: true,
      montage: 'promedio',
      excludedAverageReferenceChannels: ['Fp1'],
      includedHiddenChannels: ['ECG'],
      dsaChannel: 'off',
      artifactReject: false,
    })
  })

  it('conserva un canal DSA válido y su flag de artefactos al restaurar estado', () => {
    const epoch = makeEpoch({
      Fp1: [1, 2],
      Fp2: [3, 4],
      ECG: [5, 6],
    }, {
      ECG: 'ECG',
    })

    const result = sanitizePersistedViewerState({
      positionSec: 12,
      windowSecs: 30,
      hp: 0.5,
      lp: 45,
      notch: true,
      gainMult: 1,
      normalizeNonEEG: false,
      montage: 'raw',
      excludedAverageReferenceChannels: ['Fp1'],
      includedHiddenChannels: ['ECG'],
      dsaChannel: '1',
      artifactReject: true,
    }, epoch, 60)

    expect(result?.dsaChannel).toBe('1')
    expect(result?.artifactReject).toBe(true)
    expect(result?.montage).toBe('raw')
    expect(result?.includedHiddenChannels).toEqual([])
    expect(result?.notch).toBe(50)
  })

  it('acepta notch a 60 Hz y conserva compatibilidad con estados antiguos', () => {
    const epoch = makeEpoch({
      Fp1: [1, 2],
      Fp2: [3, 4],
    })

    const modern = sanitizePersistedViewerState({
      positionSec: 0,
      windowSecs: 10,
      hp: 0.5,
      lp: 45,
      notch: 60,
      gainMult: 1,
      normalizeNonEEG: false,
      montage: 'raw',
      excludedAverageReferenceChannels: [],
      includedHiddenChannels: [],
      dsaChannel: 'off',
      artifactReject: false,
    }, epoch, 60)

    const legacy = sanitizePersistedViewerState({
      positionSec: 0,
      windowSecs: 10,
      hp: 0.5,
      lp: 45,
      notch: true,
      gainMult: 1,
      normalizeNonEEG: false,
      montage: 'raw',
      excludedAverageReferenceChannels: [],
      includedHiddenChannels: [],
      dsaChannel: 'off',
      artifactReject: false,
    }, epoch, 60)

    expect(modern?.notch).toBe(60)
    expect(legacy?.notch).toBe(50)
  })

  it('detecta cruces de umbral con período refractario', () => {
    const signal = Float32Array.from([0, 1, 5, 8, 2, 0, 1, 6, 9, 1, 0, 7])
    const events = detectThresholdCrossings(signal, 10, 4, 0.25)
    expect(events.map((event) => event.sampleIndex)).toEqual([2, 7, 11])
  })

  it('usa percentiles robustos para la escala del trigger', () => {
    const signal = Float32Array.from([0, 1, 2, 3, 4, 5, 1000])
    const range = computeTriggerThresholdRange(signal)
    expect(range).toEqual({ min: 0, max: 6.25 })
  })

  it('en modo burst espera a que la señal se rearme antes de disparar otro trigger', () => {
    const signal = Float32Array.from([0, 6, 8, 7, 6, 5.5, 4.2, 6.1, 7, 4.8, 2, 6.5])
    const events = detectThresholdCrossings(signal, 100, 5, 0.25, 'burst', 0.1)
    expect(events.map((event) => event.sampleIndex)).toEqual([1, 7, 11])
  })

  it('rectifica la señal de trigger cuando se pide', () => {
    const signal = Float32Array.from([-5, -2, 0, 2, 5])
    const filtered = filterSignalForTrigger(signal, 100, {
      hp: 0,
      lp: 0,
      notch: 0,
      triggerSmoothPoints: 1,
      triggerDerivativeAfterSmooth: false,
      rectifyTrigger: true,
    })
    expect(Array.from(filtered)).toEqual([5, 2, 0, 2, 5])
  })

  it('suaviza la señal trigger con una media móvil de n puntos', () => {
    const signal = Float32Array.from([0, 0, 9, 0, 0])
    const filtered = filterSignalForTrigger(signal, 100, {
      hp: 0,
      lp: 0,
      notch: 0,
      triggerSmoothPoints: 3,
      triggerDerivativeAfterSmooth: false,
      rectifyTrigger: false,
    })
    expect(Array.from(filtered)).toEqual([0, 0, 3, 3, 3])
  })

  it('puede calcular la derivada después del smooth en la señal trigger', () => {
    const signal = Float32Array.from([0, 0, 9, 0, 0])
    const filtered = filterSignalForTrigger(signal, 100, {
      hp: 0,
      lp: 0,
      notch: 0,
      triggerSmoothPoints: 3,
      triggerDerivativeAfterSmooth: true,
      rectifyTrigger: false,
    })
    expect(Array.from(filtered)).toEqual([0, 0, 3, 0, 0])
  })

  it('puede filtrar también las señales que se promedian', () => {
    const signal = Float32Array.from([-2, -1, 4, -3, -4])
    const filtered = filterSignalForAverage(signal, 100, {
      averageHp: 0,
      averageLp: 0,
      averageNotch: 0,
      rectifyAverage: true,
    })
    expect(Array.from(filtered)).toEqual([2, 1, 4, 3, 4])
  })

  it('calcula el promedio desencadenado sobre la ventana actual', () => {
    const epoch = makeEpoch({
      Trigger: [0, 0, 6, 0, 0, 0, 7, 0, 0],
      C3: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      C4: [9, 8, 7, 6, 5, 4, 3, 2, 1],
    })

    const result = computeTriggeredAverage(epoch, {
      triggerChannelName: 'Trigger',
      threshold: 5,
      preSec: 0.01,
      postSec: 0.01,
      detectionMode: 'event',
      hp: 0,
      lp: 0,
      notch: 0,
      triggerSmoothPoints: 1,
      triggerDerivativeAfterSmooth: false,
      averageHp: 0,
      averageLp: 0,
      averageNotch: 0,
      rectifyTrigger: false,
      rectifyAverage: false,
      refractorySec: 0.02,
      burstRearmFraction: 0.1,
    })

    expect(result?.events.map((event) => event.sampleIndex)).toEqual([2, 6])
    expect(result?.averagedEpoch.nSamples).toBe(3)
    expect(asArray(result!.averagedEpoch.data[1])).toEqual([4, 5, 6])
    expect(asArray(result!.averagedEpoch.data[2])).toEqual([6, 5, 4])
  })

  it('puede rectificar la salida promediada', () => {
    const epoch = makeEpoch({
      Trigger: [0, 0, 6, 0, 0],
      C3: [-2, -1, 4, -3, -4],
    })

    const result = computeTriggeredAverage(epoch, {
      triggerChannelName: 'Trigger',
      threshold: 5,
      preSec: 0.01,
      postSec: 0.01,
      detectionMode: 'event',
      hp: 0,
      lp: 0,
      notch: 0,
      triggerSmoothPoints: 1,
      triggerDerivativeAfterSmooth: false,
      averageHp: 0,
      averageLp: 0,
      averageNotch: 0,
      rectifyTrigger: false,
      rectifyAverage: true,
      refractorySec: 0.02,
      burstRearmFraction: 0.1,
    })

    expect(asArray(result!.averagedEpoch.data[1])).toEqual([1, 4, 3])
  })
})
