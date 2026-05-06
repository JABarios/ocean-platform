import { MONTAGES, MONTAGE_OPTIONS } from './montages'
import type { MontageName } from './montages'

export interface EpochData {
  nChannels: number
  nSamples: number
  sfreq: number
  channelNames: string[]
  channelTypes: string[]
  data: Float32Array[]
}

export const LABEL_WIDTH = 76
export const WINDOW_OPTIONS = [10, 20, 30, 150] as const

const CHANNEL_COLORS: Record<string, string> = {
  EEG: '#1d4ed8',
  EOG: '#047857',
  ECG: '#dc2626',
  EMG: '#b45309',
  RESP: '#7c3aed',
}

const DEFAULT_COLOR = '#475569'
const LEFT_CHANNEL_COLOR = '#1d4ed8'
const RIGHT_CHANNEL_COLOR = '#b91c1c'
const CENTER_CHANNEL_COLOR = '#475569'

export { MONTAGES, MONTAGE_OPTIONS }
export type { MontageName }

export interface PersistedViewerState {
  positionSec: number
  windowSecs: number
  hp: number
  lp: number
  notch: number | boolean
  gainMult: number
  normalizeNonEEG: boolean
  montage: string
  excludedAverageReferenceChannels: string[]
  includedHiddenChannels: string[]
  dsaChannel: string
  artifactReject: boolean
  updatedAt?: string
}

export interface SanitizedViewerState {
  positionSec: number
  windowSecs: number
  hp: number
  lp: number
  notch: number
  gainMult: number
  normalizeNonEEG: boolean
  montage: MontageName
  excludedAverageReferenceChannels: string[]
  includedHiddenChannels: string[]
  dsaChannel: string
  artifactReject: boolean
}

export interface EpochReadRequest {
  startSec: number
  recordStartSec: number
  cropStartSec: number
  offsetRecords: number
  numRecords: number
  durationSec: number
}

export interface TriggerAverageOptions {
  triggerChannelName: string
  threshold: number
  preSec: number
  postSec: number
  detectionMode: 'event' | 'burst' | 'spindle' | 'slow'
  hp: number
  lp: number
  notch: number
  triggerSmoothPoints: number
  triggerDerivativeAfterSmooth: boolean
  averageHp: number
  averageLp: number
  averageNotch: number
  rectifyTrigger: boolean
  rectifyAverage: boolean
  refractorySec: number
  burstRearmFraction: number
  spindleSigmaLow: number
  spindleSigmaHigh: number
  spindleBroadLow: number
  spindleBroadHigh: number
  spindleAmplitudeStdMultiplier: number
  spindleMinSec: number
  spindleMaxSec: number
  spindleAdaptiveThresholdOverride?: number
  excludeArtifactEvents?: boolean
  artifactStatuses?: number[]
  artifactEpochSec?: number
  useN2ContextGate?: boolean
  n2ContextStatuses?: boolean[]
  n2ContextEpochSec?: number
  recordStartSec?: number
}

export interface TriggerEvent {
  sampleIndex: number
  onsetSec: number
}

export interface TriggeredAverageResult {
  averagedEpoch: EpochData | null
  rawAveragedEpoch: EpochData | null
  rawEvents: TriggerEvent[]
  events: TriggerEvent[]
  rawEventCount: number
  excludedContextCount: number
  excludedArtifactCount: number
  cleanArtifactCount: number
  suspectArtifactCount: number
  rejectedArtifactCount: number
  windowSamples: number
  preSamples: number
  postSamples: number
}

function getPercentile(sorted: Float32Array, ratio: number): number {
  if (sorted.length === 0) return 0
  const clampedRatio = Math.max(0, Math.min(1, ratio))
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(clampedRatio * (sorted.length - 1))))
  return sorted[index] ?? 0
}

export function computeTriggerThresholdRange(
  signal: Float32Array,
  lowPercentile = 0.02,
  highPercentile = 0.98,
  ceilingPercentile = 0.995,
  upperHeadroomFraction = 0.25,
): { min: number; max: number } | null {
  if (signal.length === 0) return null
  const sorted = Float32Array.from(signal).sort()
  const min = getPercentile(sorted, lowPercentile)
  const percentileMax = getPercentile(sorted, highPercentile)
  if (!Number.isFinite(min) || !Number.isFinite(percentileMax) || percentileMax <= min) return null
  const headroom = Math.max(0, upperHeadroomFraction) * (percentileMax - min)
  const ceilingMax = getPercentile(sorted, Math.max(highPercentile, ceilingPercentile))
  return { min, max: Math.max(percentileMax + headroom, ceilingMax) }
}

function canonicalizeChannelName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed

  let canonical = trimmed
    .replace(/^EEG[\s:_-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const upper = canonical.toUpperCase()
  const aliases: Record<string, string> = {
    T7: 'T3',
    T8: 'T4',
    P7: 'T5',
    P8: 'T6',
  }

  if (aliases[upper]) canonical = aliases[upper]
  return canonical
}

export function getChannelColor(name: string, type: string): string {
  if (type !== 'EEG') return CHANNEL_COLORS[type] ?? DEFAULT_COLOR

  const lead = name.split(' - ')[0]?.trim() ?? name.trim()
  if (/Z$/i.test(lead)) return CENTER_CHANNEL_COLOR

  const match = lead.match(/(\d+)(?!.*\d)/)
  if (!match) return CHANNEL_COLORS[type] ?? DEFAULT_COLOR

  const num = parseInt(match[1], 10)
  if (Number.isNaN(num)) return CHANNEL_COLORS[type] ?? DEFAULT_COLOR
  return num % 2 === 1 ? LEFT_CHANNEL_COLOR : RIGHT_CHANNEL_COLOR
}

function getContralateralLeadName(lead: string): string | null {
  const trimmed = lead.trim()
  if (!trimmed || /Z$/i.test(trimmed)) return null

  const aliases: Record<string, string> = {
    T3: 'T4',
    T4: 'T3',
    T5: 'T6',
    T6: 'T5',
    T7: 'T8',
    T8: 'T7',
    P7: 'P8',
    P8: 'P7',
  }
  const upper = trimmed.toUpperCase()
  if (aliases[upper]) return aliases[upper]

  const match = trimmed.match(/^(.*?)(\d+)([A-Za-z]*)$/)
  if (!match) return null

  const [, prefix, digits, suffix] = match
  const num = Number.parseInt(digits, 10)
  if (!Number.isFinite(num) || num <= 0) return null
  const paired = num % 2 === 1 ? num + 1 : num - 1
  return `${prefix}${paired}${suffix}`
}

export function getContralateralChannelName(
  selectedChannelName: string,
  availableChannelNames: string[],
): string | null {
  const [leadPart, ...suffixParts] = selectedChannelName.split(' - ')
  const counterpartLead = getContralateralLeadName(leadPart ?? selectedChannelName)
  if (!counterpartLead) return null

  const suffix = suffixParts.length > 0 ? ` - ${suffixParts.join(' - ')}` : ''
  const exact = `${counterpartLead}${suffix}`
  if (availableChannelNames.includes(exact)) return exact

  const canonicalCounterpart = canonicalizeChannelName(counterpartLead)
  const exactByCanonical = availableChannelNames.find((name) => {
    const [candidateLead, ...candidateSuffixParts] = name.split(' - ')
    const candidateSuffix = candidateSuffixParts.length > 0 ? ` - ${candidateSuffixParts.join(' - ')}` : ''
    return candidateSuffix === suffix && canonicalizeChannelName(candidateLead) === canonicalCounterpart
  })
  return exactByCanonical ?? null
}

export function getRecordsPerPage(windowSecs: number, recordDurationSec: number): number {
  if (recordDurationSec <= 0) return Math.max(1, windowSecs)
  return Math.max(1, Math.round(windowSecs / recordDurationSec))
}

export function getPageStepSeconds(windowSecs: number, _recordDurationSec: number): number {
  return Math.max(1, Math.round(windowSecs))
}

export function getEpochReadRequest(
  startSec: number,
  windowSecs: number,
  totalSeconds: number,
  recordDurationSec: number,
): EpochReadRequest {
  const safeWindowSecs = Math.max(1, Math.round(windowSecs))
  const safeRecordDurationSec = Number.isFinite(recordDurationSec) && recordDurationSec > 0
    ? recordDurationSec
    : 1
  const maxStartSec = Math.max(0, totalSeconds - safeWindowSecs)
  const clampedStartSec = Math.max(0, Math.min(maxStartSec, Math.floor(startSec)))
  const offsetRecords = Math.max(0, Math.floor(clampedStartSec / safeRecordDurationSec))
  const recordStartSec = offsetRecords * safeRecordDurationSec
  const cropStartSec = Math.max(0, clampedStartSec - recordStartSec)
  return {
    startSec: clampedStartSec,
    recordStartSec,
    cropStartSec,
    offsetRecords,
    numRecords: Math.max(1, Math.ceil((cropStartSec + safeWindowSecs) / safeRecordDurationSec)),
    durationSec: safeWindowSecs,
  }
}

export function getPageIndexForSecond(positionSec: number, windowSecs: number): number {
  const safeWindowSecs = Math.max(windowSecs, 1)
  return Math.floor(Math.max(0, positionSec) / safeWindowSecs)
}

export function getSecondBasedPageStart(
  targetSec: number,
  totalSeconds: number,
  windowSecs: number,
  pageDuration: number,
  center = false,
): number {
  const safePageDuration = Math.max(pageDuration, windowSecs)
  const startSec = center
    ? targetSec - safePageDuration / 2
    : targetSec
  const maxStartSec = Math.max(0, totalSeconds - safePageDuration)
  const clampedStartSec = Math.max(0, Math.min(maxStartSec, startSec))
  return Math.floor(clampedStartSec)
}

interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function reverseSignal(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[data.length - 1 - i]
  return out
}

function applyBiquad(data: Float32Array, coeffs: BiquadCoefficients): Float32Array {
  const out = new Float32Array(data.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i] ?? 0
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
    out[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return out
}

function applyZeroPhaseBiquad(data: Float32Array, coeffs: BiquadCoefficients): Float32Array {
  const forward = applyBiquad(data, coeffs)
  const backward = applyBiquad(reverseSignal(forward), coeffs)
  return reverseSignal(backward)
}

function createLowpassCoefficients(cutoffHz: number, sampleRate: number): BiquadCoefficients | null {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= sampleRate / 2) return null
  const q = Math.SQRT1_2
  const omega = (2 * Math.PI * cutoffHz) / sampleRate
  const sin = Math.sin(omega)
  const cos = Math.cos(omega)
  const alpha = sin / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: ((1 - cos) / 2) / a0,
    b1: (1 - cos) / a0,
    b2: ((1 - cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

function createHighpassCoefficients(cutoffHz: number, sampleRate: number): BiquadCoefficients | null {
  if (!Number.isFinite(cutoffHz) || cutoffHz <= 0 || cutoffHz >= sampleRate / 2) return null
  const q = Math.SQRT1_2
  const omega = (2 * Math.PI * cutoffHz) / sampleRate
  const sin = Math.sin(omega)
  const cos = Math.cos(omega)
  const alpha = sin / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

function createNotchCoefficients(centerHz: number, sampleRate: number): BiquadCoefficients | null {
  if (!Number.isFinite(centerHz) || centerHz <= 0 || centerHz >= sampleRate / 2) return null
  const q = 30
  const omega = (2 * Math.PI * centerHz) / sampleRate
  const sin = Math.sin(omega)
  const cos = Math.cos(omega)
  const alpha = sin / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: 1 / a0,
    b1: (-2 * cos) / a0,
    b2: 1 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

function filterSignalWithBand(
  signal: Float32Array,
  sampleRate: number,
  hp: number,
  lp: number,
  notch: number,
): Float32Array {
  let filtered = Float32Array.from(signal) as Float32Array

  const hpCoeffs = createHighpassCoefficients(hp, sampleRate)
  if (hpCoeffs) filtered = applyZeroPhaseBiquad(filtered, hpCoeffs) as Float32Array

  const lpCoeffs = createLowpassCoefficients(lp, sampleRate)
  if (lpCoeffs) filtered = applyZeroPhaseBiquad(filtered, lpCoeffs) as Float32Array

  const notchCoeffs = createNotchCoefficients(notch, sampleRate)
  if (notchCoeffs) filtered = applyBiquad(filtered, notchCoeffs) as Float32Array

  return filtered
}

function smoothSignal(signal: Float32Array, smoothPoints: number): Float32Array {
  const points = Math.max(1, Math.round(smoothPoints || 1))
  if (points <= 1) return signal
  const smoothed = new Float32Array(signal.length)
  let running = 0
  for (let i = 0; i < signal.length; i++) {
    running += signal[i] ?? 0
    if (i >= points) running -= signal[i - points] ?? 0
    const denom = Math.min(i + 1, points)
    smoothed[i] = running / Math.max(denom, 1)
  }
  return smoothed
}

function deriveSignal(signal: Float32Array): Float32Array {
  const derived = new Float32Array(signal.length)
  if (signal.length > 0) derived[0] = 0
  for (let i = 1; i < signal.length; i++) {
    derived[i] = (signal[i] ?? 0) - (signal[i - 1] ?? 0)
  }
  return derived
}

function computeSignalStd(signal: Float32Array): number {
  if (signal.length === 0) return 0
  let mean = 0
  for (let i = 0; i < signal.length; i++) mean += signal[i] ?? 0
  mean /= signal.length
  let variance = 0
  for (let i = 0; i < signal.length; i++) {
    const delta = (signal[i] ?? 0) - mean
    variance += delta * delta
  }
  variance /= signal.length
  return Math.sqrt(Math.max(variance, 0))
}

export function computeAdaptiveStdThreshold(signal: Float32Array, multiplier: number): number {
  if (signal.length === 0) return 0
  return Math.max(0, multiplier) * computeSignalStd(signal)
}

function movingMeanSquare(signal: Float32Array, windowSamples: number): Float32Array {
  const width = Math.max(1, Math.round(windowSamples))
  const out = new Float32Array(signal.length)
  let running = 0
  for (let i = 0; i < signal.length; i++) {
    const current = signal[i] ?? 0
    running += current * current
    if (i >= width) {
      const previous = signal[i - width] ?? 0
      running -= previous * previous
    }
    const denom = Math.min(i + 1, width)
    out[i] = running / Math.max(denom, 1)
  }
  return out
}

function computeSpindleSignals(
  signal: Float32Array,
  sampleRate: number,
  options: Pick<
    TriggerAverageOptions,
    | 'spindleSigmaLow'
    | 'spindleSigmaHigh'
    | 'spindleBroadLow'
    | 'spindleBroadHigh'
    | 'notch'
    | 'triggerSmoothPoints'
  >,
): { scoreSignal: Float32Array; rmsSignal: Float32Array; relPowerSignal: Float32Array } {
  const sigmaSignal = filterSignalWithBand(
    signal,
    sampleRate,
    options.spindleSigmaLow,
    options.spindleSigmaHigh,
    options.notch,
  )
  const broadSignal = filterSignalWithBand(
    signal,
    sampleRate,
    options.spindleBroadLow,
    options.spindleBroadHigh,
    options.notch,
  )
  const rmsWindowSamples = Math.max(1, Math.round(sampleRate * 0.3))
  const powerWindowSamples = Math.max(1, Math.round(sampleRate * 1))
  const sigmaMeanSquare = movingMeanSquare(sigmaSignal, rmsWindowSamples)
  const rmsSignal = Float32Array.from(sigmaMeanSquare, (value) => Math.sqrt(Math.max(value, 0)))
  const sigmaPower = movingMeanSquare(sigmaSignal, powerWindowSamples)
  const broadPower = movingMeanSquare(broadSignal, powerWindowSamples)
  const relPowerSignal = new Float32Array(signal.length)
  const scoreSignal = new Float32Array(signal.length)
  for (let i = 0; i < signal.length; i++) {
    const sigmaPowerValue = sigmaPower[i] ?? 0
    const broadPowerValue = broadPower[i] ?? 0
    const relPower = sigmaPowerValue / Math.max(broadPowerValue, 1e-6)
    relPowerSignal[i] = relPower
    scoreSignal[i] = relPower
  }
  return {
    scoreSignal: smoothSignal(scoreSignal, Math.max(1, Math.round(options.triggerSmoothPoints || 1))),
    rmsSignal: smoothSignal(rmsSignal, Math.max(1, Math.round(options.triggerSmoothPoints || 1))),
    relPowerSignal: smoothSignal(relPowerSignal, Math.max(1, Math.round(options.triggerSmoothPoints || 1))),
  }
}

const SLOW_WAVE_HP_HZ = 0.5
const SLOW_WAVE_LP_HZ = 2
const SLOW_WAVE_MIN_ZERO_CROSS_SEC = 0.3
const SLOW_WAVE_MAX_ZERO_CROSS_SEC = 1
const SLOW_WAVE_P2P_MULTIPLIER = 1.5

function computeSlowWaveSignals(
  signal: Float32Array,
  sampleRate: number,
  options: Pick<TriggerAverageOptions, 'notch' | 'triggerSmoothPoints'>,
): { filteredSignal: Float32Array; previewSignal: Float32Array } {
  const filteredSignal = filterSignalWithBand(
    signal,
    sampleRate,
    SLOW_WAVE_HP_HZ,
    SLOW_WAVE_LP_HZ,
    options.notch,
  )
  const negativeHalfWave = new Float32Array(filteredSignal.length)
  for (let i = 0; i < filteredSignal.length; i++) {
    negativeHalfWave[i] = Math.max(0, -(filteredSignal[i] ?? 0))
  }
  return {
    filteredSignal,
    previewSignal: smoothSignal(negativeHalfWave, Math.max(1, Math.round(options.triggerSmoothPoints || 1))),
  }
}

function detectSlowWaveEvents(
  slowSignal: Float32Array,
  sampleRate: number,
  negativePeakThreshold: number,
): TriggerEvent[] {
  if (slowSignal.length < 3 || sampleRate <= 0) return []
  const minSamples = Math.max(1, Math.round(SLOW_WAVE_MIN_ZERO_CROSS_SEC * sampleRate))
  const maxSamples = Math.max(minSamples, Math.round(SLOW_WAVE_MAX_ZERO_CROSS_SEC * sampleRate))
  const amplitudeThreshold = Math.max(0, negativePeakThreshold)
  const crossings: number[] = []
  for (let i = 1; i < slowSignal.length; i++) {
    const prev = slowSignal[i - 1] ?? 0
    const curr = slowSignal[i] ?? 0
    if (prev < 0 && curr >= 0) crossings.push(i)
  }

  const events: TriggerEvent[] = []
  for (let i = 0; i < crossings.length - 1; i++) {
    const start = crossings[i] ?? 0
    const end = crossings[i + 1] ?? 0
    const span = end - start
    if (span < minSamples || span > maxSamples) continue

    let troughValue = Number.POSITIVE_INFINITY
    let troughIndex = -1
    let peakValue = Number.NEGATIVE_INFINITY
    for (let j = start; j < end; j++) {
      const value = slowSignal[j] ?? 0
      if (value < troughValue) {
        troughValue = value
        troughIndex = j
      }
      if (value > peakValue) peakValue = value
    }

    const negativePeakAmplitude = Math.max(0, -troughValue)
    const peakToPeakAmplitude = peakValue - troughValue
    if (
      troughIndex >= 0 &&
      negativePeakAmplitude >= amplitudeThreshold &&
      peakToPeakAmplitude >= SLOW_WAVE_P2P_MULTIPLIER * amplitudeThreshold
    ) {
      events.push({ sampleIndex: troughIndex, onsetSec: troughIndex / sampleRate })
    }
  }
  return events
}

export function filterSignalForTrigger(
  signal: Float32Array,
  sampleRate: number,
  options: Pick<TriggerAverageOptions, 'hp' | 'lp' | 'notch' | 'rectifyTrigger' | 'triggerSmoothPoints' | 'triggerDerivativeAfterSmooth'>,
): Float32Array {
  let filtered = filterSignalWithBand(signal, sampleRate, options.hp, options.lp, options.notch)

  if (options.rectifyTrigger) {
    const rectified = new Float32Array(filtered.length)
    for (let i = 0; i < filtered.length; i++) rectified[i] = Math.abs(filtered[i] ?? 0)
    filtered = rectified
  }

  filtered = smoothSignal(filtered, options.triggerSmoothPoints)
  if (options.triggerDerivativeAfterSmooth) filtered = deriveSignal(filtered)

  return filtered
}

export function filterSignalForAverage(
  signal: Float32Array,
  sampleRate: number,
  options: Pick<TriggerAverageOptions, 'averageHp' | 'averageLp' | 'averageNotch' | 'rectifyAverage'>,
): Float32Array {
  let filtered = Float32Array.from(signal) as Float32Array

  const hpCoeffs = createHighpassCoefficients(options.averageHp, sampleRate)
  if (hpCoeffs) filtered = applyZeroPhaseBiquad(filtered, hpCoeffs) as Float32Array

  const lpCoeffs = createLowpassCoefficients(options.averageLp, sampleRate)
  if (lpCoeffs) filtered = applyZeroPhaseBiquad(filtered, lpCoeffs) as Float32Array

  const notchCoeffs = createNotchCoefficients(options.averageNotch, sampleRate)
  if (notchCoeffs) filtered = applyBiquad(filtered, notchCoeffs) as Float32Array

  if (options.rectifyAverage) {
    const rectified = new Float32Array(filtered.length)
    for (let i = 0; i < filtered.length; i++) rectified[i] = Math.abs(filtered[i] ?? 0)
    filtered = rectified
  }

  return filtered
}

export function detectThresholdCrossings(
  signal: Float32Array,
  sampleRate: number,
  threshold: number,
  refractorySec: number,
  mode: TriggerAverageOptions['detectionMode'] = 'event',
  burstRearmFraction = 0.1,
): TriggerEvent[] {
  if (signal.length < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) return []
  const refractorySamples = Math.max(1, Math.round(Math.max(0, refractorySec) * sampleRate))
  const events: TriggerEvent[] = []
  const signalRange = computeTriggerThresholdRange(signal)
  const rearmBaseRange = computeTriggerThresholdRange(signal, 0.02, 0.98, 0.98, 0)
  const rearmDelta = signalRange
    ? Math.max(0, Math.min(1, burstRearmFraction)) * ((rearmBaseRange ?? signalRange).max - (rearmBaseRange ?? signalRange).min)
    : 0
  const rearmThreshold = threshold - rearmDelta

  let nextAllowedIndex = 0
  let burstArmed = true

  for (let i = 1; i < signal.length; i++) {
    const prev = signal[i - 1] ?? 0
    const curr = signal[i] ?? 0
    if (mode === 'burst') {
      if (!burstArmed) {
        if (curr <= rearmThreshold) burstArmed = true
        continue
      }
    } else if (i < nextAllowedIndex) {
      continue
    }

    if (prev < threshold && curr >= threshold) {
      events.push({ sampleIndex: i, onsetSec: i / sampleRate })
      if (mode === 'burst') {
        burstArmed = false
      } else {
        nextAllowedIndex = i + refractorySamples
      }
    }
  }

  return events
}

function detectSpindleEvents(
  rmsSignal: Float32Array,
  relPowerSignal: Float32Array,
  sampleRate: number,
  manualRmsThreshold: number,
  amplitudeStdMultiplier: number,
  minSec: number,
  maxSec: number,
  adaptiveThresholdOverride?: number,
): TriggerEvent[] {
  if (rmsSignal.length < 2 || relPowerSignal.length !== rmsSignal.length || sampleRate <= 0) return []
  const rmsThreshold = Math.max(0, manualRmsThreshold)
  const minSamples = Math.max(1, Math.round(Math.max(0, minSec) * sampleRate))
  const maxSamples = Math.max(minSamples, Math.round(Math.max(minSec, maxSec) * sampleRate))
  const maxGapSamples = Math.max(1, Math.round(sampleRate * 0.5))
  const events: TriggerEvent[] = []
  const adaptiveRmsThreshold = adaptiveThresholdOverride ?? computeAdaptiveStdThreshold(rmsSignal, amplitudeStdMultiplier)
  const segmentPeakThreshold = Math.min(
    Math.max(rmsThreshold, 0),
    Math.max(adaptiveRmsThreshold, 0),
  )

  let segmentStart = -1
  let lastActiveIndex = -1
  for (let i = 0; i < rmsSignal.length; i++) {
    const active = (rmsSignal[i] ?? 0) >= rmsThreshold
    if (active && segmentStart < 0) {
      segmentStart = i
      lastActiveIndex = i
      continue
    }
    if (active) {
      lastActiveIndex = i
      continue
    }
    if (!active && segmentStart >= 0 && i - lastActiveIndex > maxGapSamples) {
      const segmentLength = lastActiveIndex - segmentStart + 1
      let peakRms = 0
      for (let j = segmentStart; j <= lastActiveIndex; j++) {
        peakRms = Math.max(peakRms, rmsSignal[j] ?? 0)
      }
      if (
        segmentLength >= minSamples &&
        segmentLength <= maxSamples &&
        peakRms >= segmentPeakThreshold
      ) {
        events.push({ sampleIndex: segmentStart, onsetSec: segmentStart / sampleRate })
      }
      segmentStart = -1
      lastActiveIndex = -1
    }
  }
  if (segmentStart >= 0 && lastActiveIndex >= segmentStart) {
    const segmentLength = lastActiveIndex - segmentStart + 1
    let peakRms = 0
    for (let j = segmentStart; j <= lastActiveIndex; j++) {
      peakRms = Math.max(peakRms, rmsSignal[j] ?? 0)
    }
    if (
      segmentLength >= minSamples &&
      segmentLength <= maxSamples &&
      peakRms >= segmentPeakThreshold
    ) {
      events.push({ sampleIndex: segmentStart, onsetSec: segmentStart / sampleRate })
    }
  }
  return events
}

export function computeTriggerPreviewSignal(
  signal: Float32Array,
  sampleRate: number,
  options: Pick<
    TriggerAverageOptions,
    | 'detectionMode'
    | 'hp'
    | 'lp'
    | 'notch'
    | 'rectifyTrigger'
    | 'triggerSmoothPoints'
    | 'triggerDerivativeAfterSmooth'
    | 'spindleSigmaLow'
    | 'spindleSigmaHigh'
    | 'spindleBroadLow'
    | 'spindleBroadHigh'
  >,
): Float32Array {
  if (options.detectionMode === 'spindle') {
    return computeSpindleSignals(signal, sampleRate, options).rmsSignal
  }
  if (options.detectionMode === 'slow') {
    return computeSlowWaveSignals(signal, sampleRate, options).previewSignal
  }
  return filterSignalForTrigger(signal, sampleRate, options)
}

export function computeTriggeredAverage(
  epoch: EpochData,
  options: TriggerAverageOptions,
): TriggeredAverageResult | null {
  const triggerIndex = epoch.channelNames.findIndex((name) => name === options.triggerChannelName)
  if (triggerIndex < 0 || epoch.nSamples <= 1 || epoch.sfreq <= 0) return null

  const filteredTrigger = computeTriggerPreviewSignal(epoch.data[triggerIndex], epoch.sfreq, options)
  const threshold = options.rectifyTrigger ? Math.abs(options.threshold) : options.threshold
  const detectedEvents = options.detectionMode === 'spindle'
    ? (() => {
        const spindleSignals = computeSpindleSignals(epoch.data[triggerIndex], epoch.sfreq, options)
        return detectSpindleEvents(
          spindleSignals.rmsSignal,
          spindleSignals.relPowerSignal,
          epoch.sfreq,
          threshold,
          options.spindleAmplitudeStdMultiplier,
          options.spindleMinSec,
          options.spindleMaxSec,
          options.spindleAdaptiveThresholdOverride,
        )
      })()
    : options.detectionMode === 'slow'
      ? (() => {
          const slowSignals = computeSlowWaveSignals(epoch.data[triggerIndex], epoch.sfreq, options)
          return detectSlowWaveEvents(
            slowSignals.filteredSignal,
            epoch.sfreq,
            Math.abs(threshold),
          )
        })()
    : detectThresholdCrossings(
        filteredTrigger,
        epoch.sfreq,
        threshold,
        options.refractorySec,
        options.detectionMode,
        options.burstRearmFraction,
      )

  const preSamples = Math.max(0, Math.round(Math.max(0, options.preSec) * epoch.sfreq))
  const postSamples = Math.max(1, Math.round(Math.max(0, options.postSec) * epoch.sfreq))
  const windowSamples = preSamples + postSamples + 1
  let excludedContextCount = 0
  const rawEvents = detectedEvents.filter((event) => {
    if (!options.useN2ContextGate || !options.n2ContextStatuses || !options.n2ContextEpochSec || options.n2ContextEpochSec <= 0) {
      return true
    }
    const absoluteOnsetSec = (options.recordStartSec ?? 0) + event.onsetSec
    const contextIndex = Math.floor(absoluteOnsetSec / options.n2ContextEpochSec)
    const isNremLike = options.n2ContextStatuses[contextIndex] ?? false
    if (!isNremLike) excludedContextCount += 1
    return isNremLike
  })
  let excludedArtifactCount = 0
  let cleanArtifactCount = 0
  let suspectArtifactCount = 0
  let rejectedArtifactCount = 0
  const validEvents = rawEvents.filter((event) => {
    if (event.sampleIndex < preSamples || event.sampleIndex + postSamples >= epoch.nSamples) return false
    if (!options.excludeArtifactEvents || !options.artifactStatuses || !options.artifactEpochSec || options.artifactEpochSec <= 0) {
      cleanArtifactCount += 1
      return true
    }
    const absoluteOnsetSec = (options.recordStartSec ?? 0) + event.onsetSec
    const artifactIndex = Math.floor(absoluteOnsetSec / options.artifactEpochSec)
    const artifactStatus = options.artifactStatuses[artifactIndex] ?? 0
    if (artifactStatus === 0) cleanArtifactCount += 1
    else if (artifactStatus === 1) suspectArtifactCount += 1
    else if (artifactStatus === 2) rejectedArtifactCount += 1
    const shouldExclude = artifactStatus === 2
    if (shouldExclude) excludedArtifactCount += 1
    return !shouldExclude
  })
  if (validEvents.length === 0) {
    return {
      averagedEpoch: null,
      rawAveragedEpoch: null,
      rawEvents,
      events: [],
      rawEventCount: rawEvents.length,
      excludedContextCount,
      excludedArtifactCount,
      cleanArtifactCount,
      suspectArtifactCount,
      rejectedArtifactCount,
      windowSamples,
      preSamples,
      postSamples,
    }
  }

  const averageSourceData = epoch.data.map((channelData) =>
    filterSignalForAverage(channelData, epoch.sfreq, options),
  )
  const rawAveragedData = epoch.data.map(() => new Float32Array(windowSamples))
  const averagedData = averageSourceData.map(() => new Float32Array(windowSamples))
  validEvents.forEach((event) => {
    const start = event.sampleIndex - preSamples
    const end = event.sampleIndex + postSamples + 1
    epoch.data.forEach((channelData, channelIndex) => {
      for (let i = start; i < end; i++) {
        const localIndex = i - start
        const sample = channelData[i] ?? 0
        rawAveragedData[channelIndex][localIndex] += sample
      }
    })
    averageSourceData.forEach((channelData, channelIndex) => {
      for (let i = start; i < end; i++) {
        const localIndex = i - start
        const sample = channelData[i] ?? 0
        averagedData[channelIndex][localIndex] += sample
      }
    })
  })

  for (const channel of rawAveragedData) {
    for (let i = 0; i < channel.length; i++) channel[i] /= validEvents.length
  }

  for (const channel of averagedData) {
    for (let i = 0; i < channel.length; i++) channel[i] /= validEvents.length
  }

  return {
    averagedEpoch: {
      ...epoch,
      nSamples: windowSamples,
      data: averagedData,
    },
    rawAveragedEpoch: {
      ...epoch,
      nSamples: windowSamples,
      data: rawAveragedData,
    },
    rawEvents,
    events: validEvents,
    rawEventCount: rawEvents.length,
    excludedContextCount,
    excludedArtifactCount,
    cleanArtifactCount,
    suspectArtifactCount,
    rejectedArtifactCount,
    windowSamples,
    preSamples,
    postSamples,
  }
}

export function getDsaChannels(epoch: EpochData | null): Array<{ index: number; name: string }> {
  if (!epoch) return []
  return epoch.channelNames
    .map((name, index) => ({
      index,
      name,
      type: epoch.channelTypes[index] ?? 'EEG',
    }))
    .filter((item) => item.type === 'EEG')
    .map(({ index, name }) => ({ index, name }))
}

function subtractSignals(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.min(a.length, b.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i]
  return out
}

function averageSignals(signals: Float32Array[], nSamples: number): Float32Array {
  const out = new Float32Array(nSamples)
  if (signals.length === 0) return out
  for (const signal of signals) {
    for (let i = 0; i < nSamples; i++) out[i] += signal[i] ?? 0
  }
  for (let i = 0; i < nSamples; i++) out[i] /= signals.length
  return out
}

function getAverageReferenceSourceNames(epoch: EpochData): string[] {
  const names = new Set<string>()
  for (const definition of MONTAGES.promedio.channels) {
    const [channelA] = definition
    names.add(channelA)
  }

  return epoch.channelNames.filter((name, index) => {
    if (!names.has(canonicalizeChannelName(name))) return false
    return (epoch.channelTypes[index] ?? 'EEG') === 'EEG'
  })
}

export function getAverageReferenceCandidates(epoch: EpochData | null): string[] {
  if (!epoch) return []
  return getAverageReferenceSourceNames(epoch)
}

function getVisibleSourceNamesForMontage(montageName: MontageName): Set<string> {
  if (montageName === 'raw') return new Set()

  const names = new Set<string>()
  for (const definition of MONTAGES[montageName].channels) {
    const [channelA] = definition as readonly string[]
    names.add(channelA)
  }
  return names
}

export function getMontageHiddenCandidates(epoch: EpochData | null, montageName: MontageName): string[] {
  if (!epoch || montageName === 'raw') return []

  const visibleNames = getVisibleSourceNamesForMontage(montageName)
  return epoch.channelNames.filter((name) => !visibleNames.has(canonicalizeChannelName(name)))
}

export function applyMontage(
  epoch: EpochData,
  montageName: MontageName,
  options?: {
    excludedAverageReferenceChannels?: ReadonlySet<string>
    includedHiddenChannels?: ReadonlySet<string>
  },
): EpochData {
  if (montageName === 'raw') return epoch

  const montageDefinition = MONTAGES[montageName]
  const definitions = montageDefinition.channels
  const byName = new Map<string, { data: Float32Array; type: string }>()
  epoch.channelNames.forEach((name, i) => {
    byName.set(canonicalizeChannelName(name), {
      data: epoch.data[i],
      type: epoch.channelTypes[i] ?? 'EEG',
    })
  })

  const zero = new Float32Array(epoch.nSamples)
  const hasSignal = (name: string) => byName.has(canonicalizeChannelName(name))
  const getSignal = (name: string) => byName.get(canonicalizeChannelName(name))?.data ?? zero
  const getType = (name: string) => byName.get(canonicalizeChannelName(name))?.type ?? 'EEG'

  const avgReference = montageDefinition.kind === 'average_reference'
    ? averageSignals(
        getAverageReferenceSourceNames(epoch)
          .filter((name) => !options?.excludedAverageReferenceChannels?.has(name))
          .map(getSignal),
        epoch.nSamples,
      )
    : null

  const linkedMastoidsReference = montageDefinition.kind === 'linked_mastoids'
    ? averageSignals(['A1', 'A2'].filter(hasSignal).map(getSignal), epoch.nSamples)
    : null

  const channelNames: string[] = []
  const channelTypes: string[] = []
  const data: Float32Array[] = []

  for (const definition of definitions) {
    if (montageDefinition.kind === 'hjorth') {
      const [active, ...neighbors] = definition as readonly string[]
      if (!hasSignal(active)) continue
      const availableNeighbors = neighbors.filter(hasSignal)
      if (availableNeighbors.length === 0) continue
      const neighborMean = averageSignals(availableNeighbors.map(getSignal), epoch.nSamples)
      channelNames.push(`${active} - AVG(${neighbors.join(',')})`)
      channelTypes.push(getType(active))
      data.push(subtractSignals(getSignal(active), neighborMean))
      continue
    }

    const [channelA, channelB] = definition as readonly [string, string]
    if (!hasSignal(channelA)) continue
    if (channelB !== 'AVG' && channelB !== 'LM' && !hasSignal(channelB)) continue
    if (channelB === 'LM' && !hasSignal('A1') && !hasSignal('A2')) continue
    const reference =
      channelB === 'AVG' ? avgReference :
      channelB === 'LM' ? linkedMastoidsReference :
      getSignal(channelB)

    channelNames.push(`${channelA} - ${channelB}`)
    channelTypes.push(getType(channelA))
    data.push(subtractSignals(getSignal(channelA), reference ?? zero))
  }

  if (options?.includedHiddenChannels?.size) {
    epoch.channelNames.forEach((name, index) => {
      if (!options.includedHiddenChannels?.has(name)) return
      channelNames.push(name)
      channelTypes.push(epoch.channelTypes[index] ?? 'EEG')
      data.push(epoch.data[index])
    })
  }

  return {
    ...epoch,
    nChannels: data.length,
    channelNames,
    channelTypes,
    data,
  }
}

export function shouldShowMetadataForPointer(x: number): boolean {
  return x >= 0 && x <= LABEL_WIDTH
}

export function getNextArtifactRejectState(currentDsaChannel: string, nextDsaChannel: string, currentArtifactReject: boolean): boolean {
  if (nextDsaChannel === 'off') return false
  if (currentDsaChannel === 'off') return true
  return currentArtifactReject
}

function pickPersistedWindow(windowSecs: number): number {
  if (!Number.isFinite(windowSecs)) return WINDOW_OPTIONS[0]
  const rounded = Math.round(windowSecs)
  if (WINDOW_OPTIONS.includes(rounded as typeof WINDOW_OPTIONS[number])) return rounded

  let best: number = WINDOW_OPTIONS[0]
  let bestDistance = Math.abs(rounded - best)
  for (const option of WINDOW_OPTIONS.slice(1)) {
    const distance = Math.abs(rounded - option)
    if (distance < bestDistance) {
      best = option
      bestDistance = distance
    }
  }
  return best
}

function sanitizeNotch(notch: number | boolean): number {
  if (notch === true) return 50
  if (notch === false) return 0
  if (!Number.isFinite(notch)) return 50
  if (notch === 50 || notch === 60) return notch
  return 0
}

export function sanitizePersistedViewerState(
  state: PersistedViewerState | null,
  epoch: EpochData,
  totalSeconds: number,
): SanitizedViewerState | null {
  if (!state) return null

  const montage = MONTAGE_OPTIONS.includes(state.montage as MontageName)
    ? state.montage as MontageName
    : 'promedio'

  const averageReferenceCandidates = new Set(getAverageReferenceCandidates(epoch))
  const hiddenMontageCandidates = new Set(getMontageHiddenCandidates(epoch, montage))
  const dsaChannels = new Set(getDsaChannels(epoch).map((channel) => String(channel.index)))

  const safePositionSec = Number.isFinite(state.positionSec)
    ? Math.max(0, Math.min(Math.round(state.positionSec), Math.max(0, totalSeconds)))
    : 0

  return {
    positionSec: safePositionSec,
    windowSecs: pickPersistedWindow(state.windowSecs),
    hp: Number.isFinite(state.hp) ? Math.max(0, state.hp) : 0.5,
    lp: Number.isFinite(state.lp) ? Math.max(1, state.lp) : 45,
    notch: sanitizeNotch(state.notch),
    gainMult: Number.isFinite(state.gainMult) ? Math.max(0.1, state.gainMult) : 1,
    normalizeNonEEG: Boolean(state.normalizeNonEEG),
    montage,
    excludedAverageReferenceChannels: (state.excludedAverageReferenceChannels ?? [])
      .filter((name) => averageReferenceCandidates.has(name)),
    includedHiddenChannels: (state.includedHiddenChannels ?? [])
      .filter((name) => hiddenMontageCandidates.has(name)),
    dsaChannel: dsaChannels.has(state.dsaChannel) ? state.dsaChannel : 'off',
    artifactReject: dsaChannels.has(state.dsaChannel) ? Boolean(state.artifactReject) : false,
  }
}
