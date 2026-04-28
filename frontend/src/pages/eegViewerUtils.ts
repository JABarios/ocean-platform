export interface EpochData {
  nChannels: number
  nSamples: number
  sfreq: number
  channelNames: string[]
  channelTypes: string[]
  data: Float32Array[]
}

export const LABEL_WIDTH = 76

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

export const MONTAGES = {
  raw: [],
  doble_banana: [
    ['Fp1', 'F7'], ['F7', 'T3'], ['T3', 'T5'], ['T5', 'O1'],
    ['Fp2', 'F8'], ['F8', 'T4'], ['T4', 'T6'], ['T6', 'O2'],
    ['Fp1', 'F3'], ['F3', 'C3'], ['C3', 'P3'], ['P3', 'O1'],
    ['Fp2', 'F4'], ['F4', 'C4'], ['C4', 'P4'], ['P4', 'O2'],
    ['Fz', 'Cz'], ['Cz', 'Pz'],
  ],
  transversal: [
    ['A1', 'Fp1'], ['F7', 'F3'], ['A1', 'T3'], ['T3', 'C3'], ['T5', 'P3'],
    ['F3', 'Fz'], ['C3', 'Cz'], ['P3', 'Pz'],
    ['Fz', 'F4'], ['Cz', 'C4'], ['Pz', 'P4'], ['A2', 'Fp2'], ['F4', 'F8'], ['A2', 'T4'], ['C4', 'T4'], ['P4', 'T6'],
  ],
  promedio: [
    ['Fp1', 'AVG'], ['F7', 'AVG'], ['F3', 'AVG'], ['T3', 'AVG'], ['C3', 'AVG'], ['T5', 'AVG'], ['P3', 'AVG'], ['O1', 'AVG'],
    ['Fz', 'AVG'], ['Cz', 'AVG'], ['Pz', 'AVG'],
    ['Fp2', 'AVG'], ['F4', 'AVG'], ['F8', 'AVG'], ['C4', 'AVG'], ['T4', 'AVG'], ['P4', 'AVG'], ['T6', 'AVG'], ['O2', 'AVG'],
  ],
  linked_mastoids: [
    ['Fp1', 'LM'], ['F7', 'LM'], ['F3', 'LM'], ['T3', 'LM'], ['C3', 'LM'], ['T5', 'LM'], ['P3', 'LM'], ['O1', 'LM'],
    ['Fz', 'LM'], ['Cz', 'LM'], ['Pz', 'LM'],
    ['Fp2', 'LM'], ['F4', 'LM'], ['F8', 'LM'], ['C4', 'LM'], ['T4', 'LM'], ['P4', 'LM'], ['T6', 'LM'], ['O2', 'LM'],
  ],
  hjorth: [
    ['Fp1', 'F3', 'F7', 'Fz'],
    ['F3', 'Fp1', 'F7', 'C3', 'Fz'],
    ['C3', 'F3', 'T3', 'P3', 'Cz'],
    ['P3', 'C3', 'T5', 'O1', 'Pz'],
    ['O1', 'P3', 'T5'],
    ['Fp2', 'F4', 'F8', 'Fz'],
    ['F4', 'Fp2', 'F8', 'C4', 'Fz'],
    ['C4', 'F4', 'T4', 'P4', 'Cz'],
    ['P4', 'C4', 'T6', 'O2', 'Pz'],
    ['O2', 'P4', 'T6'],
  ],
} as const

export type MontageName = keyof typeof MONTAGES

export const MONTAGE_OPTIONS: MontageName[] = [
  'promedio',
  'doble_banana',
  'raw',
  'transversal',
  'linked_mastoids',
  'hjorth',
]

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
  for (const definition of MONTAGES.promedio) {
    const [channelA] = definition
    names.add(channelA)
  }

  return epoch.channelNames.filter((name, index) => {
    if (!names.has(name)) return false
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
  for (const definition of MONTAGES[montageName]) {
    const [channelA] = definition as readonly string[]
    names.add(channelA)
  }
  return names
}

export function getMontageHiddenCandidates(epoch: EpochData | null, montageName: MontageName): string[] {
  if (!epoch || montageName === 'raw') return []

  const visibleNames = getVisibleSourceNamesForMontage(montageName)
  return epoch.channelNames.filter((name) => !visibleNames.has(name))
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

  const definitions = MONTAGES[montageName]
  const byName = new Map<string, { data: Float32Array; type: string }>()
  epoch.channelNames.forEach((name, i) => {
    byName.set(name, {
      data: epoch.data[i],
      type: epoch.channelTypes[i] ?? 'EEG',
    })
  })

  const zero = new Float32Array(epoch.nSamples)
  const getSignal = (name: string) => byName.get(name)?.data ?? zero
  const getType = (name: string) => byName.get(name)?.type ?? 'EEG'

  const avgReference = montageName === 'promedio'
    ? averageSignals(
        getAverageReferenceSourceNames(epoch)
          .filter((name) => !options?.excludedAverageReferenceChannels?.has(name))
          .map(getSignal),
        epoch.nSamples,
      )
    : null

  const linkedMastoidsReference = montageName === 'linked_mastoids'
    ? averageSignals([getSignal('A1'), getSignal('A2')], epoch.nSamples)
    : null

  const channelNames: string[] = []
  const channelTypes: string[] = []
  const data: Float32Array[] = []

  for (const definition of definitions) {
    if (montageName === 'hjorth') {
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
