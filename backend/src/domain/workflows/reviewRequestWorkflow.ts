export type ReviewRequestAction =
  | 'accept_review_request'
  | 'reject_review_request'
  | 'resend_review_request'
  | 'withdraw_review_request'

interface ReviewRequestWorkflowInput {
  status: string
  isRequester: boolean
  isTargetUser: boolean
  isTargetGroupMember?: boolean
}

export function getReviewRequestAvailableActions(input: ReviewRequestWorkflowInput): ReviewRequestAction[] {
  const actions: ReviewRequestAction[] = []

  if (input.status === 'Pending' && (input.isTargetUser || input.isTargetGroupMember)) {
    actions.push('accept_review_request', 'reject_review_request')
  }

  if (['Pending', 'Rejected', 'Expired'].includes(input.status) && input.isRequester) {
    actions.push('resend_review_request', 'withdraw_review_request')
  }

  return actions
}
