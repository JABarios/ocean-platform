import { getNextTeachingState } from '../domain/workflows/teachingWorkflow'
import {
  OPEN_TEACHING_STATUSES,
  buildCasePackageReadAccessWhere as buildCasePackageReadAccessWhereFromWorkflow,
  buildCaseReadAccessWhere as buildCaseReadAccessWhereFromWorkflow,
  buildTeachingContributorAccessWhere as buildTeachingContributorAccessWhereFromWorkflow,
  buildTeachingProposalReadAccessWhere as buildTeachingProposalReadAccessWhereFromWorkflow,
} from '../domain/workflows/caseAccessWorkflow'

export const COMMUNITY_TEACHING_STATUSES = ['Proposed', 'Recommended'] as const

export function buildCaseReadAccessWhere(userId: string) {
  return buildCaseReadAccessWhereFromWorkflow(userId)
}

export function buildTeachingProposalReadAccessWhere(userId: string) {
  return buildTeachingProposalReadAccessWhereFromWorkflow(userId)
}

export function buildCasePackageReadAccessWhere(userId: string) {
  return buildCasePackageReadAccessWhereFromWorkflow(userId)
}

export function buildTeachingContributorAccessWhere(userId: string) {
  return buildTeachingContributorAccessWhereFromWorkflow(userId)
}

export function proposalSupportCount(input: {
  proposerId: string
  recommendationsCount: number
}) {
  return input.recommendationsCount + 1
}

export function nextTeachingProposalStatus(currentStatus: string, supportCount: number) {
  return getNextTeachingState(
    {
      clinicalStatus: 'Resolved',
      teachingStatus: currentStatus,
      isOwner: false,
      isReviewer: false,
      isCurator: false,
      hasTeachingProposal: currentStatus !== 'None',
      hasRecommended: false,
      isProposer: false,
      hasReviewRelationship: false,
      isAuthenticated: true,
      supportCount,
    },
    { type: 'RECOMMEND' },
  )
}

export function canRequestReviewAccess(input: {
  teachingStatus: string
  isOwner: boolean
  hasReviewRelationship: boolean
}) {
  return COMMUNITY_TEACHING_STATUSES.includes(input.teachingStatus as typeof COMMUNITY_TEACHING_STATUSES[number])
    && !input.isOwner
    && !input.hasReviewRelationship
}
