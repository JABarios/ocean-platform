import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeachingLibrary from '../pages/TeachingLibrary'
import { mockFetchSequence } from './mocks'
import type { User } from '../types'

let mockAuthState = {
  user: { id: 'viewer-1', email: 'viewer@test.com', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderLibrary() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TeachingLibrary />
    </MemoryRouter>,
  )
}

describe('TeachingLibrary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra la dificultad y el estado del caso en español', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'proposal-1',
            caseId: 'case-1',
            proposerId: 'owner-1',
            status: 'Validated',
            summary: 'Caso docente muy útil',
            difficulty: 'Intermediate',
            validatedAt: '2026-05-10T10:00:00.000Z',
            tags: ['epilepsia'],
            case: {
              id: 'case-1',
              title: 'Caso biblioteca',
              status: 'Resolved',
              clinicalContext: 'Contexto',
              ageRange: 'Adulto',
              modality: 'EEG',
              tags: [],
            },
            proposer: { id: 'owner-1', displayName: 'Dr. Owner' },
          },
        ],
      },
      { data: [] },
    ])

    renderLibrary()

    expect(await screen.findByText('Caso biblioteca')).toBeInTheDocument()
    expect(screen.getAllByText('Intermedio').length).toBeGreaterThan(0)
    expect(screen.getByText('Resuelto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir caso/i })).toHaveAttribute('href', '/cases/case-1')
  })
})
