import {
  getNextReviewRequestState,
  getReviewRequestAvailableActions,
} from '../src/domain/workflows/reviewRequestWorkflow'

describe('reviewRequestWorkflow', () => {
  it('permite aceptar o rechazar una solicitud pendiente al destinatario', () => {
    const input = {
      status: 'Pending',
      isRequester: false,
      isTargetUser: true,
      isTargetGroupMember: false,
    }

    expect(getReviewRequestAvailableActions(input)).toEqual(
      expect.arrayContaining(['accept_review_request', 'reject_review_request']),
    )
    expect(getNextReviewRequestState(input, { type: 'ACCEPT' })).toBe('Accepted')
    expect(getNextReviewRequestState(input, { type: 'REJECT' })).toBe('Rejected')
  })

  it('permite reenviar y retirar al solicitante desde Rejected o Expired', () => {
    const rejected = {
      status: 'Rejected',
      isRequester: true,
      isTargetUser: false,
      isTargetGroupMember: false,
    }
    const expired = {
      status: 'Expired',
      isRequester: true,
      isTargetUser: false,
      isTargetGroupMember: false,
    }

    expect(getReviewRequestAvailableActions(rejected)).toEqual(
      expect.arrayContaining(['resend_review_request', 'withdraw_review_request']),
    )
    expect(getReviewRequestAvailableActions(expired)).toEqual(
      expect.arrayContaining(['resend_review_request', 'withdraw_review_request']),
    )
    expect(getNextReviewRequestState(rejected, { type: 'RESEND' })).toBe('Pending')
  })

  it('no deja reenviar ni retirar una solicitud aceptada', () => {
    const input = {
      status: 'Accepted',
      isRequester: true,
      isTargetUser: false,
      isTargetGroupMember: false,
    }

    expect(getReviewRequestAvailableActions(input)).toEqual([])
  })
})
