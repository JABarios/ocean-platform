import { describe, expect, it } from '@jest/globals'
import { getAllowedClinicalEvents, getNextClinicalState } from '../src/domain/workflows/clinicalWorkflow'

describe('clinicalWorkflow', () => {
  it('Draft permite solicitar revisión y archivar', () => {
    expect(getAllowedClinicalEvents('Draft')).toEqual(['REQUEST_REVIEW', 'ARCHIVE_CASE'])
    expect(getNextClinicalState('Draft', 'REQUEST_REVIEW')).toBe('Requested')
    expect(getNextClinicalState('Draft', 'ARCHIVE_CASE')).toBe('Archived')
  })

  it('InReview permite resolver o archivar', () => {
    expect(getAllowedClinicalEvents('InReview')).toEqual(['RESOLVE_CASE', 'ARCHIVE_CASE'])
    expect(getNextClinicalState('InReview', 'RESOLVE_CASE')).toBe('Resolved')
    expect(getNextClinicalState('InReview', 'ARCHIVE_CASE')).toBe('Archived')
  })

  it('Archived no permite más transiciones', () => {
    expect(getAllowedClinicalEvents('Archived')).toEqual([])
    expect(getNextClinicalState('Archived', 'ARCHIVE_CASE')).toBeUndefined()
  })
})
