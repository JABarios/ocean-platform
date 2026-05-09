export interface User {
  id: string
  email: string
  displayName: string
  role: string
  status?: string
  institution?: string
  specialty?: string
  createdAt?: string
  lastLoginAt?: string
  groups?: Array<{ id: string; name: string }>
  metrics?: {
    casesCreated: number
    pendingReviews: number
    activeReviews: number
    completedReviews: number
    totalReviews: number
  }
}

export interface CasePackage {
  id: string
  caseId: string
  eegRecordId?: string
  packageFormatVersion?: string
  encryptionMode?: string
  blobLocation?: string
  blobHash?: string
  sizeBytes?: number
  uploadStatus: string
  retentionPolicy: string
  expiresAt?: string
  createdAt: string
}

export interface EegRecord {
  id: string
  blobHash: string
  blobLocation: string
  sizeBytes?: number
  encryptionMode: string
  createdAt: string
  updatedAt: string
  usageCount: number
  uploader?: Pick<User, 'id' | 'displayName' | 'email'>
  cases: Array<{
    caseId: string
    packageId: string
    title?: string
    status?: string
    owner?: Pick<User, 'id' | 'displayName'>
    retentionPolicy: string
    createdAt: string
  }>
}

export interface GalleryMetadata {
  schemaVersion: 1
  datasetId?: string
  datasetVersion?: string
  datasetUrl?: string
  sourceDataset?: string
  caseCode?: string
  completeness?: 'unknown' | 'partial' | 'complete'
  recordImportedCount: number
  recordExpectedCount?: number
  seizureFileCount?: number
  subject?: {
    sex?: string
    ageYears?: number
  }
  samplingRateHz?: number
  channelCount?: number
  montage?: string
  importDirectoryName?: string
  importRelativePath?: string
  importedAt?: string
  notes?: string
  [key: string]: unknown
}

export interface GalleryRecordMetadata {
  schemaVersion: 1
  originalFilename: string
  sourceDataset?: string
  sourceCaseCode?: string
  startTime?: string
  endTime?: string
  durationSeconds?: number
  seizureCount?: number
  seizureWindows?: Array<{ startSec: number; endSec: number }>
  samplingRateHz?: number
  channelCount?: number
  montage?: string
  sourceUrl?: string
  notes?: string
  [key: string]: unknown
}

export interface GalleryRecord {
  id: string
  label: string
  sortOrder: number
  tags: string[]
  metadata: GalleryRecordMetadata
  createdAt: string
  eegRecord?: {
    id: string
    blobHash: string
    sizeBytes?: number
    encryptionMode: string
    createdAt: string
    updatedAt: string
  }
}

export interface Gallery {
  id: string
  title: string
  description?: string
  source?: string
  license?: string
  visibility: 'Institutional' | 'Public'
  tags: string[]
  metadata?: GalleryMetadata
  createdAt: string
  updatedAt: string
  recordCount: number
  createdBy?: Pick<User, 'id' | 'displayName' | 'email'>
  records?: GalleryRecord[]
}

export interface SharedLinkBlobInfo {
  id: string
  label?: string
  sizeBytes?: number
  originalFilename?: string
  encryptionMode: string
  expiresAt: string
  ivBase64?: string
  createdAt: string
}

export type ClinicalAvailableAction =
  | 'send_review_request'
  | 'comment_case'
  | 'request_review'
  | 'start_review'
  | 'resolve_case'
  | 'archive_case'

export type TeachingAvailableAction =
  | 'propose_teaching'
  | 'recommend_teaching'
  | 'request_review_access'
  | 'validate_teaching'
  | 'reject_teaching'

export type ReviewRequestAvailableAction =
  | 'accept_review_request'
  | 'reject_review_request'
  | 'resend_review_request'
  | 'withdraw_review_request'

export type AvailableAction = ClinicalAvailableAction | TeachingAvailableAction

export interface CaseItem {
  id: string
  title: string
  clinicalContext: string
  ageRange: string
  studyReason: string
  modality: string
  tags: string[]
  status: 'Draft' | 'Requested' | 'InReview' | 'Resolved' | 'Archived'
  teachingStatus: 'None' | 'Proposed' | 'Recommended' | 'Validated' | 'Rejected'
  ownerId: string
  owner?: { id: string; displayName: string; email: string }
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  package?: CasePackage
  reviewRequests?: ReviewRequest[]
  storedKeyAvailable?: boolean
  availableActions?: AvailableAction[]
}

export interface ReviewRequest {
  id: string
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Expired' | 'Completed'
  createdAt: string
  acceptedAt?: string
  expiresAt?: string
  case?: Pick<CaseItem, 'id' | 'title' | 'status'>
  requester?: Pick<User, 'id' | 'displayName'>
  targetUser?: Pick<User, 'id' | 'displayName'>
  targetGroup?: { id: string; name: string }
  availableActions?: ReviewRequestAvailableAction[]
}

export interface Comment {
  id: string
  caseId: string
  authorId: string
  type: 'Comment' | 'Conclusion' | 'TeachingNote'
  content: string
  createdAt: string
  author?: Pick<User, 'id' | 'displayName'>
}

export interface TeachingProposalPayload {
  summary: string
  keyFindings: string
  learningPoints: string
  difficulty: string
  tags: string[]
}

export interface TeachingProposal {
  id: string
  caseId: string
  proposerId: string
  status: 'Proposed' | 'Recommended' | 'Validated' | 'Rejected'
  summary: string
  keyFindings?: string
  learningPoints?: string
  difficulty?: string
  tags?: string[]
  validatedAt?: string
  validatedBy?: string
  rejectionReason?: string
  supportCount?: number
  case?: Pick<CaseItem, 'id' | 'title' | 'clinicalContext' | 'ageRange' | 'modality' | 'tags' | 'status'>
  proposer?: Pick<User, 'id' | 'displayName'>
  recommendations?: Array<{ authorId: string; author?: Pick<User, 'id' | 'displayName'>; rationale?: string }>
  _count?: { recommendations: number }
  availableActions?: TeachingAvailableAction[]
}
