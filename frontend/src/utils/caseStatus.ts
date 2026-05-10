import type { CaseItem } from '../types'

export function statusLabel(status: CaseItem['status']) {
  switch (status) {
    case 'Draft':
      return 'Borrador'
    case 'Requested':
      return 'Solicitado'
    case 'InReview':
      return 'En revisión'
    case 'Resolved':
      return 'Resuelto'
    case 'Archived':
      return 'Archivado'
    default:
      return status
  }
}
