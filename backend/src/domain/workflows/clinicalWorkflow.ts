import { createMachine, getNextSnapshot } from 'xstate'

export const CLINICAL_STATES = ['Draft', 'Requested', 'InReview', 'Resolved', 'Archived'] as const

export type ClinicalState = typeof CLINICAL_STATES[number]

export type ClinicalEvent =
  | 'REQUEST_REVIEW'
  | 'START_REVIEW'
  | 'RESOLVE_CASE'
  | 'ARCHIVE_CASE'

const CLINICAL_EVENT_SEQUENCE: ClinicalEvent[] = [
  'REQUEST_REVIEW',
  'START_REVIEW',
  'RESOLVE_CASE',
  'ARCHIVE_CASE',
]

export const clinicalWorkflowMachine = createMachine({
  id: 'clinicalWorkflow',
  initial: 'Draft',
  states: {
    Draft: {
      on: {
        REQUEST_REVIEW: 'Requested',
        ARCHIVE_CASE: 'Archived',
      },
    },
    Requested: {
      on: {
        START_REVIEW: 'InReview',
        ARCHIVE_CASE: 'Archived',
      },
    },
    InReview: {
      on: {
        RESOLVE_CASE: 'Resolved',
        ARCHIVE_CASE: 'Archived',
      },
    },
    Resolved: {
      on: {
        ARCHIVE_CASE: 'Archived',
      },
    },
    Archived: {},
  },
})

function resolveClinicalSnapshot(state: string) {
  return clinicalWorkflowMachine.resolveState({
    value: state as ClinicalState,
  })
}

export function getNextClinicalState(state: string, event: ClinicalEvent) {
  const snapshot = resolveClinicalSnapshot(state)
  const nextSnapshot = getNextSnapshot(clinicalWorkflowMachine, snapshot, { type: event })
  return nextSnapshot.value !== snapshot.value ? nextSnapshot.value as ClinicalState : undefined
}

export function getAllowedClinicalEvents(state: string) {
  const snapshot = resolveClinicalSnapshot(state)
  return CLINICAL_EVENT_SEQUENCE.filter((event) =>
    clinicalWorkflowMachine.getTransitionData(snapshot, { type: event }).length > 0
  )
}
