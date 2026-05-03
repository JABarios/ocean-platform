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

export interface ChannelOverrideSettings {
  hp: number
  lp: number
  notch: number
  gainMult: number
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

interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

function makeLowpassCoefficients(sampleRate: number, cutoffHz: number, q = 0.707): BiquadCoefficients | null {
  if (!(sampleRate > 0) || !(cutoffHz > 0) || cutoffHz >= sampleRate * 0.499) return null
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: ((1 - cosW0) / 2) / a0,
    b1: (1 - cosW0) / a0,
    b2: ((1 - cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function makeHighpassCoefficients(sampleRate: number, cutoffHz: number, q = 0.707): BiquadCoefficients | null {
  if (!(sampleRate > 0) || !(cutoffHz > 0) || cutoffHz >= sampleRate * 0.499) return null
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: ((1 + cosW0) / 2) / a0,
    b1: (-(1 + cosW0)) / a0,
    b2: ((1 + cosW0) / 2) / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function makeNotchCoefficients(sampleRate: number, notchHz: number, q = 0.707): BiquadCoefficients | null {
  if (!(sampleRate > 0) || !(notchHz > 0) || notchHz >= sampleRate * 0.499) return null
  const w0 = (2 * Math.PI * notchHz) / sampleRate
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * q)
  const a0 = 1 + alpha
  return {
    b0: 1 / a0,
    b1: (-2 * cosW0) / a0,
    b2: 1 / a0,
    a1: (-2 * cosW0) / a0,
    a2: (1 - alpha) / a0,
  }
}

function applyBiquad(signal: Float32Array, coeffs: BiquadCoefficients): Float32Array {
  const out = new Float32Array(signal.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i]
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
    out[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return out
}

function applyZeroPhase(signal: Float32Array, coeffs: BiquadCoefficients | null): Float32Array {
  if (!coeffs) return signal
  const forward = applyBiquad(signal, coeffs)
  const reversed = Float32Array.from(forward).reverse()
  const backward = applyBiquad(reversed, coeffs)
  return Float32Array.from(backward).reverse()
}

export function applyDisplayFilters(
  signal: Float32Array,
  sampleRate: number,
  filters: Pick<ChannelOverrideSettings, 'hp' | 'lp' | 'notch'>,
): Float32Array {
  let next = signal
  next = applyZeroPhase(next, makeHighpassCoefficients(sampleRate, filters.hp))
  next = applyZeroPhase(next, makeLowpassCoefficients(sampleRate, filters.lp))
  const notchCoeffs = makeNotchCoefficients(sampleRate, filters.notch)
  if (notchCoeffs) next = applyBiquad(next, notchCoeffs)
  return next
}

export function applyChannelDisplayOverrides(
  epoch: EpochData,
  overrides: Record<string, ChannelOverrideSettings>,
): EpochData {
  const overrideNames = Object.keys(overrides)
  if (overrideNames.length === 0) return epoch

  let changed = false
  const data = epoch.data.map((channelData, index) => {
    const channelName = epoch.channelNames[index]
    const override = overrides[channelName]
    if (!override) return channelData
    changed = true
    return applyDisplayFilters(channelData, epoch.sfreq, override)
  })

  if (!changed) return epoch
  return {
    ...epoch,
    data,
  }
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
