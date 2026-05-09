import { hasAcceptedReviewRelationship, OPEN_TEACHING_STATUSES } from './caseAccessWorkflow'

export type CasePackageAction =
  | 'upload_case_package'
  | 'store_case_package_secret'
  | 'recover_case_package_secret'
  | 'download_case_package'
  | 'list_reusable_eegs'

interface ReviewRequestLike {
  requestedBy?: string | null
  targetUserId?: string | null
  status?: string | null
}

interface CasePackageWorkflowInput {
  ownerId: string
  statusTeaching: string
  reviewRequests?: ReviewRequestLike[]
  hasPackage?: boolean
  hasStoredSecret?: boolean
  viewerId: string
  viewerRole?: string
}

export function getCasePackageAvailableActions(input: CasePackageWorkflowInput): CasePackageAction[] {
  const actions: CasePackageAction[] = []
  const isOwner = input.ownerId === input.viewerId
  const isAdmin = input.viewerRole === 'Admin'
  const hasOpenTeachingVisibility = OPEN_TEACHING_STATUSES.includes(
    input.statusTeaching as typeof OPEN_TEACHING_STATUSES[number],
  )
  const hasReviewAccess = hasAcceptedReviewRelationship(
    {
      ownerId: input.ownerId,
      statusTeaching: input.statusTeaching,
      reviewRequests: input.reviewRequests,
    },
    input.viewerId,
  )

  if (isOwner) {
    actions.push('upload_case_package')
    if (input.hasPackage) {
      actions.push('store_case_package_secret')
    }
  }

  if (input.hasPackage && (isAdmin || isOwner || hasReviewAccess || hasOpenTeachingVisibility)) {
    actions.push('download_case_package', 'list_reusable_eegs')
  }

  if (input.hasPackage && input.hasStoredSecret && (isAdmin || isOwner || hasReviewAccess)) {
    actions.push('recover_case_package_secret')
  }

  return actions
}

export function canUploadCasePackage(input: CasePackageWorkflowInput) {
  return getCasePackageAvailableActions(input).includes('upload_case_package')
}

export function canStoreCasePackageSecret(input: CasePackageWorkflowInput) {
  return getCasePackageAvailableActions(input).includes('store_case_package_secret')
}

export function canRecoverCasePackageSecret(input: CasePackageWorkflowInput) {
  return getCasePackageAvailableActions(input).includes('recover_case_package_secret')
}

export function canDownloadCasePackage(input: CasePackageWorkflowInput) {
  return getCasePackageAvailableActions(input).includes('download_case_package')
}
