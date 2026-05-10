import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EegRecords from '../pages/EegRecords'
import { mockFetch } from './mocks'
import type { User } from '../types'

let mockAuthState = {
  user: { id: 'viewer-1', email: 'viewer@test.com', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderRecords() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <EegRecords />
    </MemoryRouter>,
  )
}

describe('EegRecords', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra el estado del caso vinculado en español', async () => {
    mockFetch([
      {
        id: 'record-1',
        blobHash: 'abc123',
        blobLocation: '/tmp/eeg.enc',
        encryptionMode: 'AES256-GCM',
        createdAt: '2026-05-10T10:00:00.000Z',
        updatedAt: '2026-05-10T10:00:00.000Z',
        usageCount: 2,
        cases: [
          {
            caseId: 'case-1',
            packageId: 'pkg-1',
            title: 'Caso EEG',
            status: 'InReview',
            owner: { id: 'owner-1', displayName: 'Dr. Owner' },
            retentionPolicy: 'UntilReviewClose',
            createdAt: '2026-05-10T10:00:00.000Z',
          },
        ],
      },
    ])

    renderRecords()

    expect(await screen.findByText('Caso EEG')).toBeInTheDocument()
    expect(screen.getByText((content) => content.includes('En revisión'))).toBeInTheDocument()
  })
})
