import { getNextTeachingState } from '../domain/workflows/teachingWorkflow'

export const OPEN_TEACHING_STATUSES = ['Proposed', 'Recommended', 'Validated'] as const
export const COMMUNITY_TEACHING_STATUSES = ['Proposed', 'Recommended'] as const

export function buildCaseReadAccessWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { statusTeaching: { in: [...OPEN_TEACHING_STATUSES] } },
      {
        reviewRequests: {
          some: {
            OR: [
              { targetUserId: userId },
              { requestedBy: userId },
            ],
          },
        },
      },
    ],
  }
}

export function buildTeachingProposalReadAccessWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { statusTeaching: { in: [...OPEN_TEACHING_STATUSES] } },
      {
        reviewRequests: {
          some: {
            OR: [
              { targetUserId: userId, status: 'Accepted' },
              { requestedBy: userId },
            ],
          },
        },
      },
    ],
  }
}

export function buildCasePackageReadAccessWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      { statusTeaching: { in: [...OPEN_TEACHING_STATUSES] } },
      {
        reviewRequests: {
          some: {
            OR: [
              { targetUserId: userId, status: 'Accepted' },
              { requestedBy: userId },
            ],
          },
        },
      },
    ],
  }
}

export function buildTeachingContributorAccessWhere(userId: string) {
  return {
    OR: [
      { ownerId: userId },
      {
        reviewRequests: {
          some: {
            OR: [
              { targetUserId: userId, status: 'Accepted' },
              { requestedBy: userId },
            ],
          },
        },
      },
    ],
  }
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
