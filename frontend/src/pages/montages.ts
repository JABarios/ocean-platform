export type BipolarMontageChannel = readonly [active: string, reference: string]
export type HjorthMontageChannel = readonly [active: string, ...neighbors: string[]]
export type MontageChannelDefinition = BipolarMontageChannel | HjorthMontageChannel

export interface MontageDefinition {
  label: string
  kind: 'raw' | 'bipolar' | 'average_reference' | 'linked_mastoids' | 'hjorth'
  channels: readonly MontageChannelDefinition[]
}

export const MONTAGES = {
  raw: {
    label: 'raw',
    kind: 'raw',
    channels: [],
  },
  doble_banana: {
    label: 'doble_banana',
    kind: 'bipolar',
    channels: [
      ['Fp1', 'F7'], ['F7', 'T3'], ['T3', 'T5'], ['T5', 'O1'],
      ['Fp2', 'F8'], ['F8', 'T4'], ['T4', 'T6'], ['T6', 'O2'],
      ['Fp1', 'F3'], ['F3', 'C3'], ['C3', 'P3'], ['P3', 'O1'],
      ['Fp2', 'F4'], ['F4', 'C4'], ['C4', 'P4'], ['P4', 'O2'],
      ['Fz', 'Cz'], ['Cz', 'Pz'],
    ],
  },
  transversal: {
    label: 'transversal',
    kind: 'bipolar',
    channels: [
      ['A1', 'Fp1'], ['F7', 'F3'], ['A1', 'T3'], ['T3', 'C3'], ['T5', 'P3'],
      ['F3', 'Fz'], ['C3', 'Cz'], ['P3', 'Pz'],
      ['Fz', 'F4'], ['Cz', 'C4'], ['Pz', 'P4'], ['A2', 'Fp2'], ['F4', 'F8'], ['A2', 'T4'], ['C4', 'T4'], ['P4', 'T6'],
    ],
  },
  promedio: {
    label: 'promedio',
    kind: 'average_reference',
    channels: [
      ['Fp1', 'AVG'], ['F7', 'AVG'], ['F3', 'AVG'], ['T3', 'AVG'], ['C3', 'AVG'], ['T5', 'AVG'], ['P3', 'AVG'], ['O1', 'AVG'],
      ['Fz', 'AVG'], ['Cz', 'AVG'], ['Pz', 'AVG'],
      ['Fp2', 'AVG'], ['F4', 'AVG'], ['F8', 'AVG'], ['C4', 'AVG'], ['T4', 'AVG'], ['P4', 'AVG'], ['T6', 'AVG'], ['O2', 'AVG'],
    ],
  },
  linked_mastoids: {
    label: 'linked_mastoids',
    kind: 'linked_mastoids',
    channels: [
      ['Fp1', 'LM'], ['F7', 'LM'], ['F3', 'LM'], ['T3', 'LM'], ['C3', 'LM'], ['T5', 'LM'], ['P3', 'LM'], ['O1', 'LM'],
      ['Fz', 'LM'], ['Cz', 'LM'], ['Pz', 'LM'],
      ['Fp2', 'LM'], ['F4', 'LM'], ['F8', 'LM'], ['C4', 'LM'], ['T4', 'LM'], ['P4', 'LM'], ['T6', 'LM'], ['O2', 'LM'],
    ],
  },
  hjorth: {
    label: 'hjorth',
    kind: 'hjorth',
    channels: [
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
  },
} as const satisfies Record<string, MontageDefinition>

export type MontageName = keyof typeof MONTAGES

export const MONTAGE_OPTIONS = [
  'promedio',
  'doble_banana',
  'raw',
  'transversal',
  'linked_mastoids',
  'hjorth',
] as const satisfies readonly MontageName[]
