import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import OpenCasesFeed from '../pages/OpenCasesFeed'
import type { User } from '../types'
import { mockFetchSequence } from './mocks'

let mockAuthState = {
  user: { id: 'viewer-1', email: 'viewer@test.com', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderFeed() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OpenCasesFeed />
    </MemoryRouter>,
  )
}

describe('OpenCasesFeed', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra los casos públicos cargados desde la API', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'case-1',
            title: 'Caso público A',
            clinicalContext: 'Patrón epileptiforme dudoso',
            studyReason: 'Segunda opinión',
            modality: 'EEG',
            visibility: 'Public',
            status: 'Requested',
            tags: ['epilepsia'],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-02T10:00:00.000Z',
            ownerId: 'owner-1',
            owner: { id: 'owner-1', displayName: 'Dra. López', email: 'lopez@ocean.local' },
          },
        ],
      },
    ])

    renderFeed()

    expect(await screen.findByText('Caso público A')).toBeInTheDocument()
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.getByText(/Propietario:\s*Dra\. López/i)).toBeInTheDocument()
  })

  it('permite filtrar por búsqueda libre', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'case-1',
            title: 'Caso público A',
            clinicalContext: 'Patrón epileptiforme dudoso',
            studyReason: 'Segunda opinión',
            modality: 'EEG',
            visibility: 'Public',
            status: 'Requested',
            tags: ['epilepsia'],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-02T10:00:00.000Z',
            ownerId: 'owner-1',
            owner: { id: 'owner-1', displayName: 'Dra. López', email: 'lopez@ocean.local' },
          },
          {
            id: 'case-2',
            title: 'Caso público B',
            clinicalContext: 'Sueño y ronquido',
            studyReason: 'Valoración de sueño',
            modality: 'V-EEG',
            visibility: 'Public',
            status: 'Resolved',
            tags: ['sueño'],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-02T10:00:00.000Z',
            ownerId: 'owner-2',
            owner: { id: 'owner-2', displayName: 'Dr. Pérez', email: 'perez@ocean.local' },
          },
        ],
      },
    ])

    renderFeed()
    await screen.findByText('Caso público A')

    fireEvent.change(screen.getByPlaceholderText(/Título, contexto, motivo/i), { target: { value: 'sueño' } })

    expect(screen.queryByText('Caso público A')).not.toBeInTheDocument()
    expect(screen.getByText('Caso público B')).toBeInTheDocument()
  })
})
