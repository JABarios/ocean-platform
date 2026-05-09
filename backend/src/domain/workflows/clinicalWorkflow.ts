export const CLINICAL_STATES = ['Draft', 'Requested', 'InReview', 'Resolved', 'Archived'] as const

export type ClinicalState = typeof CLINICAL_STATES[number]

export type ClinicalEvent =
  | 'REQUEST_REVIEW'
  | 'START_REVIEW'
  | 'RESOLVE_CASE'
  | 'ARCHIVE_CASE'

const CLINICAL_TRANSITIONS: Record<ClinicalState, Partial<Record<ClinicalEvent, ClinicalState>>> = {
  Draft: {
    REQUEST_REVIEW: 'Requested',
    ARCHIVE_CASE: 'Archived',
  },
  Requested: {
    START_REVIEW: 'InReview',
    ARCHIVE_CASE: 'Archived',
  },
  InReview: {
    RESOLVE_CASE: 'Resolved',
    ARCHIVE_CASE: 'Archived',
  },
  Resolved: {
    ARCHIVE_CASE: 'Archived',
  },
  Archived: {},
}

export function getNextClinicalState(state: string, event: ClinicalEvent) {
  const transitions = CLINICAL_TRANSITIONS[state as ClinicalState]
  return transitions?.[event]
}

export function getAllowedClinicalEvents(state: string) {
  const transitions = CLINICAL_TRANSITIONS[state as ClinicalState]
  return transitions ? Object.keys(transitions) as ClinicalEvent[] : []
}
