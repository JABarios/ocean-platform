interface ReviewRequestAccessLike {
  requestedBy?: string | null
  targetUserId?: string | null
  status?: string | null
}

interface CaseAccessLike {
  ownerId: string
  statusTeaching: string
  reviewRequests?: ReviewRequestAccessLike[]
}

export const OPEN_TEACHING_STATUSES = ['Proposed', 'Recommended', 'Validated'] as const

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

export function hasReviewRelationship(caseItem: CaseAccessLike, userId: string) {
  return (caseItem.reviewRequests ?? []).some((request) =>
    request.targetUserId === userId || request.requestedBy === userId,
  )
}

export function hasAcceptedReviewRelationship(caseItem: CaseAccessLike, userId: string) {
  return (caseItem.reviewRequests ?? []).some((request) =>
    (request.targetUserId === userId && request.status === 'Accepted') || request.requestedBy === userId,
  )
}

export function canReadCase(caseItem: CaseAccessLike, userId: string, role?: string) {
  if (role === 'Admin') return true
  if (caseItem.ownerId === userId) return true
  if (OPEN_TEACHING_STATUSES.includes(caseItem.statusTeaching as typeof OPEN_TEACHING_STATUSES[number])) return true
  return hasReviewRelationship(caseItem, userId)
}

export function canReadTeachingProposal(caseItem: CaseAccessLike, userId: string, role?: string) {
  if (role === 'Admin') return true
  if (caseItem.ownerId === userId) return true
  if (OPEN_TEACHING_STATUSES.includes(caseItem.statusTeaching as typeof OPEN_TEACHING_STATUSES[number])) return true
  return hasAcceptedReviewRelationship(caseItem, userId)
}

export function canContributeTeaching(caseItem: CaseAccessLike, userId: string, role?: string) {
  if (role === 'Admin') return true
  if (caseItem.ownerId === userId) return true
  return hasAcceptedReviewRelationship(caseItem, userId)
}
