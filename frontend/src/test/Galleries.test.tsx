import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import Galleries from '../pages/Galleries'
import { mockFetch } from './mocks'
import type { User } from '../types'

let mockAuthState = {
  user: null as User | null,
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderGalleries() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Galleries />
    </MemoryRouter>,
  )
}

describe('Galleries', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthState = {
      user: {
        id: 'user-1',
        email: 'viewer@ocean.local',
        displayName: 'Dr. Viewer',
        role: 'Clinician',
        availableActions: [],
      },
    }
  })

  it('muestra el formulario de importación cuando la app lo permite', async () => {
    mockAuthState.user = {
      ...mockAuthState.user!,
      role: 'Curator',
      availableActions: ['view_teaching_queue', 'import_gallery'],
    }
    mockFetch([])

    renderGalleries()

    expect(await screen.findByText(/Importar galería desde directorio del servidor/i)).toBeInTheDocument()
  })

  it('oculta el formulario de importación para un clínico normal', async () => {
    mockFetch([])

    renderGalleries()

    expect(await screen.findByText(/Galerías visibles/i)).toBeInTheDocument()
    expect(screen.queryByText(/Importar galería desde directorio del servidor/i)).not.toBeInTheDocument()
  })

  it('muestra la visibilidad de la galería en español', async () => {
    mockFetch([
      {
        id: 'gallery-1',
        title: 'Galería pública',
        visibility: 'Public',
        tags: [],
        recordCount: 2,
        createdAt: '2026-05-10T10:00:00.000Z',
        updatedAt: '2026-05-10T10:00:00.000Z',
      },
    ])

    renderGalleries()

    expect(await screen.findByText('Galería pública')).toBeInTheDocument()
    expect(screen.getByText('Público')).toBeInTheDocument()
  })
})
