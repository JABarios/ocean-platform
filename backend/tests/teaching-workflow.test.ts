import { describe, expect, it } from '@jest/globals'
import { getTeachingAvailableActions } from '../src/domain/workflows/teachingWorkflow'
import { nextTeachingProposalStatus, proposalSupportCount } from '../src/utils/teachingState'

describe('teachingWorkflow', () => {
  it('permite proponer docencia al owner de un caso resuelto sin propuesta', () => {
    const actions = getTeachingAvailableActions({
      clinicalStatus: 'Resolved',
      teachingStatus: 'None',
      isOwner: true,
      isReviewer: false,
      isCurator: false,
      hasTeachingProposal: false,
      hasRecommended: false,
      isProposer: false,
      hasReviewRelationship: false,
      isAuthenticated: true,
    })

    expect(actions).toContain('propose_teaching')
  })

  it('permite recomendar y solicitar acceso en un caso propuesto visible', () => {
    const actions = getTeachingAvailableActions({
      clinicalStatus: 'Resolved',
      teachingStatus: 'Proposed',
      isOwner: false,
      isReviewer: false,
      isCurator: false,
      hasTeachingProposal: true,
      hasRecommended: false,
      isProposer: false,
      hasReviewRelationship: false,
      isAuthenticated: true,
    })

    expect(actions).toContain('recommend_teaching')
    expect(actions).toContain('request_review_access')
  })

  it('no permite recomendar la propia propuesta ni volver a pedir acceso si ya existe relación', () => {
    const actions = getTeachingAvailableActions({
      clinicalStatus: 'Resolved',
      teachingStatus: 'Proposed',
      isOwner: false,
      isReviewer: true,
      isCurator: false,
      hasTeachingProposal: true,
      hasRecommended: false,
      isProposer: true,
      hasReviewRelationship: true,
      isAuthenticated: true,
    })

    expect(actions).not.toContain('recommend_teaching')
    expect(actions).not.toContain('request_review_access')
  })
})

describe('teaching support counters', () => {
  it('la propuesta cuenta como primer apoyo implícito', () => {
    expect(proposalSupportCount({ proposerId: 'u1', recommendationsCount: 0 })).toBe(1)
  })

  it('la primera recomendación externa lleva Proposed a Recommended', () => {
    const supportCount = proposalSupportCount({ proposerId: 'u1', recommendationsCount: 1 })
    expect(nextTeachingProposalStatus('Proposed', supportCount)).toBe('Recommended')
  })
})
