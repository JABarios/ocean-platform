import { getNextSnapshot, setup } from 'xstate'

export type ReviewRequestAction =
  | 'accept_review_request'
  | 'reject_review_request'
  | 'resend_review_request'
  | 'withdraw_review_request'

export type ReviewRequestState =
  | 'Pending'
  | 'Accepted'
  | 'Rejected'
  | 'Expired'
  | 'Completed'

type ReviewRequestWorkflowEvent =
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'RESEND' }
  | { type: 'WITHDRAW' }

interface ReviewRequestWorkflowInput {
  status: string
  isRequester: boolean
  isTargetUser: boolean
  isTargetGroupMember?: boolean
}

const REVIEW_REQUEST_ACTION_EVENTS: Array<{ action: ReviewRequestAction; event: ReviewRequestWorkflowEvent }> = [
  { action: 'accept_review_request', event: { type: 'ACCEPT' } },
  { action: 'reject_review_request', event: { type: 'REJECT' } },
  { action: 'resend_review_request', event: { type: 'RESEND' } },
  { action: 'withdraw_review_request', event: { type: 'WITHDRAW' } },
]

export const reviewRequestWorkflowMachine = setup({
  types: {
    context: {} as ReviewRequestWorkflowInput,
    input: {} as ReviewRequestWorkflowInput,
    events: {} as ReviewRequestWorkflowEvent,
  },
  guards: {
    canTargetRespond: ({ context }) =>
      Boolean(context.isTargetUser || context.isTargetGroupMember),
    canRequesterResend: ({ context }) => context.isRequester,
    canRequesterWithdraw: ({ context }) => context.isRequester,
  },
}).createMachine({
  id: 'reviewRequestWorkflow',
  context: ({ input }) => input,
  initial: 'boot',
  states: {
    boot: {
      always: [
        { target: 'Pending', guard: ({ context }) => context.status === 'Pending' },
        { target: 'Accepted', guard: ({ context }) => context.status === 'Accepted' },
        { target: 'Rejected', guard: ({ context }) => context.status === 'Rejected' },
        { target: 'Expired', guard: ({ context }) => context.status === 'Expired' },
        { target: 'Completed', guard: ({ context }) => context.status === 'Completed' },
      ],
    },
    Pending: {
      on: {
        ACCEPT: { target: 'Accepted', guard: 'canTargetRespond' },
        REJECT: { target: 'Rejected', guard: 'canTargetRespond' },
        WITHDRAW: { target: 'Completed', guard: 'canRequesterWithdraw' },
      },
    },
    Accepted: {},
    Rejected: {
      on: {
        RESEND: { target: 'Pending', guard: 'canRequesterResend' },
        WITHDRAW: { target: 'Completed', guard: 'canRequesterWithdraw' },
      },
    },
    Expired: {
      on: {
        RESEND: { target: 'Pending', guard: 'canRequesterResend' },
        WITHDRAW: { target: 'Completed', guard: 'canRequesterWithdraw' },
      },
    },
    Completed: {},
  },
})

function resolveReviewRequestSnapshot(input: ReviewRequestWorkflowInput) {
  return reviewRequestWorkflowMachine.resolveState({
    value: input.status as ReviewRequestState,
    context: input,
  })
}

export function getReviewRequestAvailableActions(input: ReviewRequestWorkflowInput): ReviewRequestAction[] {
  const snapshot = resolveReviewRequestSnapshot(input)
  return REVIEW_REQUEST_ACTION_EVENTS
    .filter(({ event }) => reviewRequestWorkflowMachine.getTransitionData(snapshot, event).length > 0)
    .map(({ action }) => action)
}

export function getNextReviewRequestState(input: ReviewRequestWorkflowInput, event: ReviewRequestWorkflowEvent) {
  const snapshot = resolveReviewRequestSnapshot(input)
  const nextSnapshot = getNextSnapshot(reviewRequestWorkflowMachine, snapshot, event)
  return nextSnapshot.value as ReviewRequestState
}
