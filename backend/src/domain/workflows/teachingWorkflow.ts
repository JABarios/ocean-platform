import { getNextSnapshot, setup } from 'xstate'

export const TEACHING_STATES = ['None', 'Proposed', 'Recommended', 'Validated', 'Rejected'] as const

export type TeachingState = typeof TEACHING_STATES[number]

export type TeachingAction =
  | 'propose_teaching'
  | 'recommend_teaching'
  | 'request_review_access'
  | 'validate_teaching'
  | 'reject_teaching'

export interface TeachingWorkflowInput {
  clinicalStatus: string
  teachingStatus: string
  isOwner: boolean
  isReviewer: boolean
  isCurator: boolean
  hasTeachingProposal: boolean
  hasRecommended: boolean
  isProposer: boolean
  hasReviewRelationship: boolean
  isAuthenticated: boolean
  supportCount?: number
}

type TeachingWorkflowEvent =
  | { type: 'PROPOSE' }
  | { type: 'RECOMMEND' }
  | { type: 'REQUEST_REVIEW_ACCESS' }
  | { type: 'VALIDATE' }
  | { type: 'REJECT' }

const TEACHING_ACTION_EVENTS: Array<{ action: TeachingAction; event: TeachingWorkflowEvent }> = [
  { action: 'propose_teaching', event: { type: 'PROPOSE' } },
  { action: 'recommend_teaching', event: { type: 'RECOMMEND' } },
  { action: 'request_review_access', event: { type: 'REQUEST_REVIEW_ACCESS' } },
  { action: 'validate_teaching', event: { type: 'VALIDATE' } },
  { action: 'reject_teaching', event: { type: 'REJECT' } },
]

function canProposeTeaching(context: TeachingWorkflowInput) {
  return (context.isOwner || context.isReviewer)
    && ['Resolved', 'Archived'].includes(context.clinicalStatus)
    && !context.hasTeachingProposal
}

function canRecommendTeaching(context: TeachingWorkflowInput) {
  return context.isAuthenticated
    && context.hasTeachingProposal
    && !context.isProposer
    && !context.hasRecommended
}

function hasRecommendationThreshold(context: TeachingWorkflowInput) {
  return (context.supportCount ?? 0) >= 2
}

function canRequestReviewAccess(context: TeachingWorkflowInput) {
  return context.isAuthenticated
    && !context.isOwner
    && !context.hasReviewRelationship
}

function canValidateTeaching(context: TeachingWorkflowInput) {
  return context.isCurator
}

export const teachingWorkflowMachine = setup({
  types: {
    context: {} as TeachingWorkflowInput,
    input: {} as TeachingWorkflowInput,
    events: {} as TeachingWorkflowEvent,
  },
  guards: {
    canProposeTeaching: ({ context }) => canProposeTeaching(context),
    canRecommendTeaching: ({ context }) => canRecommendTeaching(context),
    hasRecommendationThreshold: ({ context }) => hasRecommendationThreshold(context),
    canRequestReviewAccess: ({ context }) => canRequestReviewAccess(context),
    canValidateTeaching: ({ context }) => canValidateTeaching(context),
  },
}).createMachine({
  id: 'teachingWorkflow',
  context: ({ input }) => input,
  initial: 'boot',
  states: {
    boot: {
      always: [
        { target: 'None', guard: ({ context }) => context.teachingStatus === 'None' },
        { target: 'Proposed', guard: ({ context }) => context.teachingStatus === 'Proposed' },
        { target: 'Recommended', guard: ({ context }) => context.teachingStatus === 'Recommended' },
        { target: 'Validated', guard: ({ context }) => context.teachingStatus === 'Validated' },
        { target: 'Rejected', guard: ({ context }) => context.teachingStatus === 'Rejected' },
      ],
    },
    None: {
      on: {
        PROPOSE: {
          target: 'Proposed',
          guard: 'canProposeTeaching',
        },
      },
    },
    Proposed: {
      on: {
        RECOMMEND: [
          {
            target: 'Recommended',
            guard: ({ context }) => canRecommendTeaching(context) && hasRecommendationThreshold(context),
          },
          {
            target: 'Proposed',
            guard: 'canRecommendTeaching',
          },
        ],
        REQUEST_REVIEW_ACCESS: {
          guard: 'canRequestReviewAccess',
        },
        VALIDATE: {
          target: 'Validated',
          guard: 'canValidateTeaching',
        },
        REJECT: {
          target: 'Rejected',
          guard: 'canValidateTeaching',
        },
      },
    },
    Recommended: {
      on: {
        RECOMMEND: {
          target: 'Recommended',
          guard: 'canRecommendTeaching',
        },
        REQUEST_REVIEW_ACCESS: {
          guard: 'canRequestReviewAccess',
        },
        VALIDATE: {
          target: 'Validated',
          guard: 'canValidateTeaching',
        },
        REJECT: {
          target: 'Rejected',
          guard: 'canValidateTeaching',
        },
      },
    },
    Validated: {},
    Rejected: {},
  },
})

function resolveTeachingSnapshot(input: TeachingWorkflowInput) {
  return teachingWorkflowMachine.resolveState({
    value: input.teachingStatus as TeachingState,
    context: input,
  })
}

export function getTeachingAvailableActions(input: TeachingWorkflowInput): TeachingAction[] {
  const snapshot = resolveTeachingSnapshot(input)
  return TEACHING_ACTION_EVENTS
    .filter(({ event }) => teachingWorkflowMachine.getTransitionData(snapshot, event).length > 0)
    .map(({ action }) => action)
}

export function getNextTeachingState(input: TeachingWorkflowInput, event: TeachingWorkflowEvent) {
  const snapshot = resolveTeachingSnapshot(input)
  const nextSnapshot = getNextSnapshot(teachingWorkflowMachine, snapshot, event)
  return nextSnapshot.value as TeachingState
}
