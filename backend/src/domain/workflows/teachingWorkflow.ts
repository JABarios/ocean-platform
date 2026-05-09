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
}

export function getTeachingAvailableActions(input: TeachingWorkflowInput): TeachingAction[] {
  const actions: TeachingAction[] = []

  const canProposeContributor = input.isOwner || input.isReviewer
  const canSeeCommunityLayer = ['Proposed', 'Recommended'].includes(input.teachingStatus)

  if (
    input.teachingStatus === 'None'
    && canProposeContributor
    && ['Resolved', 'Archived'].includes(input.clinicalStatus)
    && !input.hasTeachingProposal
  ) {
    actions.push('propose_teaching')
  }

  if (
    input.isAuthenticated
    && canSeeCommunityLayer
    && input.hasTeachingProposal
    && !input.isProposer
    && !input.hasRecommended
  ) {
    actions.push('recommend_teaching')
  }

  if (
    input.isAuthenticated
    && canSeeCommunityLayer
    && !input.isOwner
    && !input.hasReviewRelationship
  ) {
    actions.push('request_review_access')
  }

  if (input.isCurator && ['Proposed', 'Recommended'].includes(input.teachingStatus)) {
    actions.push('validate_teaching', 'reject_teaching')
  }

  return actions
}
