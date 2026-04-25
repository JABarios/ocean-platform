export interface User {
  id: string
  email: string
  displayName: string
  role: string
  institution?: string
  specialty?: string
}

export interface CasePackage {
  id: string
  caseId: string
  blobHash?: string
  sizeBytes?: number
  uploadStatus: string
  retentionPolicy: string
  expiresAt?: string
  createdAt: string
}

export interface CaseItem {
  id: string
  title: string
  clinicalContext: string
  ageRange: string
  studyReason: string
  modality: string
  status: 'Draft' | 'Requested' | 'InReview' | 'Resolved' | 'Archived'
  ownerId: string
  createdAt: string
  updatedAt: string
  package?: CasePackage
}

export interface ReviewRequest {
  id: string
  caseId: string
  requestedBy: string
  targetUserId?: string
  targetGroupId?: string
  message?: string
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Completed'
  createdAt: string
  case?: CaseItem
}

export interface Comment {
  id: string
  caseId: string
  authorId: string
  content: string
  createdAt: string
  author?: User
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
  status: string
  summary: string
  keyFindings?: string
  learningPoints?: string
  difficulty?: string
  tags?: string[]
  validatedAt?: string
  validatedBy?: string
  case?: CaseItem
  proposer?: User
  recommendations?: Array<{ authorId: string; author?: User; rationale?: string }>
  _count?: { recommendations: number }
}
