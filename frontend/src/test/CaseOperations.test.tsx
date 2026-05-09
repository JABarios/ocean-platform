import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CaseOperations from '../pages/CaseOperations'
import { mockFetchSequence } from './mocks'
import type { User } from '../types'

let mockAuthState = {
  user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderOperations() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CaseOperations />
    </MemoryRouter>,
  )
}

describe('CaseOperations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('muestra acciones del caso y de las solicitudes según availableActions', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'case-1',
            title: 'Caso operativo',
            clinicalContext: 'Crisis focal',
            ageRange: 'Adulto',
            studyReason: 'Revisión',
            modality: 'EEG',
            status: 'Resolved',
            teachingStatus: 'None',
            ownerId: 'owner-1',
            tags: ['epilepsia'],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            availableActions: ['send_review_request', 'archive_case', 'propose_teaching'],
            reviewRequests: [
              {
                id: 'req-1',
                caseId: 'case-1',
                requestedBy: 'owner-1',
                targetUserId: 'reviewer-1',
                status: 'Rejected',
                createdAt: '2026-01-01T00:00:00.000Z',
                availableActions: ['resend_review_request', 'withdraw_review_request'],
                targetUser: { id: 'reviewer-1', displayName: 'Dr. Reviewer' },
              },
            ],
          },
        ],
      },
      {
        data: [
          { id: 'reviewer-1', email: 'reviewer@test.com', displayName: 'Dr. Reviewer', role: 'Reviewer', status: 'Active' },
        ],
      },
    ])

    renderOperations()

    expect(await screen.findByText('Caso operativo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Invitar revisor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Archivar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Proponer docencia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reenviar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retirar/i })).toBeInTheDocument()
  })
})
