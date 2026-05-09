import type { CaseItem, TeachingProposal } from '../types'

export function getTeachingSupportCount(proposal: TeachingProposal | null | undefined) {
  if (!proposal) return 0
  return proposal.supportCount ?? ((proposal._count?.recommendations ?? 0) + 1)
}

export function canProposeTeachingCase(input: {
  caseItem: CaseItem
  isOwner: boolean
  hasTeachingProposal: boolean
}) {
  return !input.hasTeachingProposal
    && input.isOwner
    && input.caseItem.teachingStatus === 'None'
    && (input.caseItem.status === 'Resolved' || input.caseItem.status === 'Archived')
}

export function canRecommendTeachingProposal(input: {
  proposal: TeachingProposal | null
  userId?: string
}) {
  const { proposal, userId } = input
  if (!proposal || !userId) return false
  if (!['Proposed', 'Recommended'].includes(proposal.status)) return false
  if (proposal.proposerId === userId) return false
  if (proposal.recommendations?.some((item) => item.authorId === userId)) return false
  return true
}

export function canRequestTeachingReviewAccess(input: {
  caseItem: CaseItem
  isOwner: boolean
  userId?: string
}) {
  if (!input.userId || input.isOwner) return false
  if (!['Proposed', 'Recommended'].includes(input.caseItem.teachingStatus)) return false
  return !(input.caseItem.reviewRequests || []).some((item) =>
    item.requestedBy === input.userId || item.targetUserId === input.userId
  )
}
