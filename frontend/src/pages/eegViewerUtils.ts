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
  notch: boolean
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
  notch: boolean
  gainMult: number
  normalizeNonEEG: boolean
  montage: MontageName
  excludedAverageReferenceChannels: string[]
  includedHiddenChannels: string[]
  dsaChannel: string
  artifactReject: boolean
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
    ? averageSignals([getSignal('A1'), getSignal('A2')], epoch.nSamples)
    : null

  const channelNames: string[] = []
  const channelTypes: string[] = []
  const data: Float32Array[] = []

  for (const definition of definitions) {
    if (montageDefinition.kind === 'hjorth') {
      const [active, ...neighbors] = definition as readonly string[]
      const neighborMean = averageSignals(neighbors.map(getSignal), epoch.nSamples)
      channelNames.push(`${active} - AVG(${neighbors.join(',')})`)
      channelTypes.push(getType(active))
      data.push(subtractSignals(getSignal(active), neighborMean))
      continue
    }

    const [channelA, channelB] = definition as readonly [string, string]
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
    notch: Boolean(state.notch),
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
