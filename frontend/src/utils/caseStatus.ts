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

export function visibilityLabel(visibility?: 'Private' | 'Institutional' | 'Public') {
  switch (visibility) {
    case 'Institutional':
      return 'Grupo'
    case 'Public':
      return 'Público'
    case 'Private':
    default:
      return 'Privado'
  }
}

export function teachingStatusLabel(status?: CaseItem['teachingStatus']) {
  switch (status) {
    case 'None':
      return 'Sin propuesta'
    case 'Proposed':
      return 'Propuesto'
    case 'Recommended':
      return 'Recomendado'
    case 'Validated':
      return 'En biblioteca'
    case 'Rejected':
      return 'Rechazado'
    default:
      return status || '—'
  }
}

export function difficultyLabel(difficulty?: string) {
  switch (difficulty) {
    case 'Introductory':
      return 'Básico'
    case 'Intermediate':
      return 'Intermedio'
    case 'Advanced':
      return 'Avanzado'
    default:
      return difficulty || '—'
  }
}
