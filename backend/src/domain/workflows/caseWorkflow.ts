import { getAllowedClinicalEvents, getNextClinicalState } from './clinicalWorkflow'
import { getTeachingAvailableActions } from './teachingWorkflow'

interface CaseWorkflowViewer {
  id: string
  role: string
}

interface ReviewRequestLike {
  requestedBy?: string | null
  targetUserId?: string | null
  status?: string | null
}

interface TeachingProposalLike {
  proposerId?: string | null
  recommendations?: Array<{ authorId: string }>
}

interface CaseWorkflowCase {
  ownerId: string
  statusClinical: string
  statusTeaching: string
  reviewRequests?: ReviewRequestLike[]
  teachingProposals?: TeachingProposalLike[]
}

function getCaseWorkflowFacts(caseObj: CaseWorkflowCase, viewer: CaseWorkflowViewer) {
  const reviewRequests = caseObj.reviewRequests ?? []
  const activeTeachingProposal = caseObj.teachingProposals?.[0] ?? null
  const isOwner = caseObj.ownerId === viewer.id
  const isReviewer = reviewRequests.some((request) =>
    (request.targetUserId === viewer.id && request.status === 'Accepted') || request.requestedBy === viewer.id,
  )
  const hasReviewRelationship = reviewRequests.some((request) =>
    request.targetUserId === viewer.id || request.requestedBy === viewer.id,
  )

  return {
    reviewRequests,
    activeTeachingProposal,
    isOwner,
    isReviewer,
    hasReviewRelationship,
  }
}

export function getCaseAvailableActions(caseObj: CaseWorkflowCase, viewer?: CaseWorkflowViewer) {
  if (!viewer) return []

  const {
    reviewRequests,
    activeTeachingProposal,
    isOwner,
    isReviewer,
    hasReviewRelationship,
  } = getCaseWorkflowFacts(caseObj, viewer)

  const clinicalActions: string[] = []
  if (isOwner) {
    clinicalActions.push('send_review_request')
  }
  if (isOwner || isReviewer) {
    clinicalActions.push('comment_case')
  }
  if (isOwner) {
    for (const event of getAllowedClinicalEvents(caseObj.statusClinical)) {
      const nextState = getNextClinicalState(caseObj.statusClinical, event)
      if (nextState === 'Requested') clinicalActions.push('request_review')
      if (nextState === 'InReview') clinicalActions.push('start_review')
      if (nextState === 'Resolved') clinicalActions.push('resolve_case')
      if (nextState === 'Archived') clinicalActions.push('archive_case')
    }
  }

  const teachingActions = getTeachingAvailableActions({
    clinicalStatus: caseObj.statusClinical,
    teachingStatus: caseObj.statusTeaching,
    isOwner,
    isReviewer,
    isCurator: viewer.role === 'Curator' || viewer.role === 'Admin',
    hasTeachingProposal: Boolean(activeTeachingProposal),
    hasRecommended: Boolean(activeTeachingProposal?.recommendations?.some((item) => item.authorId === viewer.id)),
    isProposer: activeTeachingProposal?.proposerId === viewer.id,
    hasReviewRelationship,
    isAuthenticated: true,
  })

  return [...clinicalActions, ...teachingActions]
}

export function canCommentOnCase(caseObj: CaseWorkflowCase, viewer: CaseWorkflowViewer) {
  return getCaseAvailableActions(caseObj, viewer).includes('comment_case')
}
