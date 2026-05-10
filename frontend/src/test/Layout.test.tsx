import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import Layout from '../components/Layout'
import type { User } from '../types'
import { mockFetchSequence } from './mocks'

let mockAuthState = {
  user: null as User | null,
  token: undefined as string | undefined,
  logout: vi.fn(),
}

const mockNavigate = vi.fn()

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderLayout(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Layout>
        <div>Contenido</div>
      </Layout>
    </MemoryRouter>,
  )
}

describe('Layout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockAuthState = {
      user: {
        id: 'user-1',
        email: 'viewer@ocean.local',
        displayName: 'Dr. Viewer',
        role: 'Clinician',
        availableActions: [],
      },
      token: undefined,
      logout: vi.fn(),
    }
  })

  it('muestra Casos propuestos cuando la app expone esa acción', () => {
    mockAuthState.user = {
      ...mockAuthState.user!,
      role: 'Curator',
      availableActions: ['view_teaching_queue', 'import_gallery'],
    }

    renderLayout('/galleries')

    expect(screen.getByRole('link', { name: /Casos propuestos/i })).toBeInTheDocument()
  })

  it('oculta Admin y Casos propuestos cuando el usuario no tiene esas acciones', () => {
    renderLayout('/galleries')

    expect(screen.queryByRole('link', { name: /^Admin$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Casos propuestos/i })).not.toBeInTheDocument()
  })

  it('muestra el acceso a Casos abiertos para usuarios autenticados', () => {
    renderLayout('/')

    expect(screen.getByRole('link', { name: /Casos abiertos/i })).toBeInTheDocument()
  })

  it('muestra el acceso a notificaciones', async () => {
    mockFetchSequence([{ data: { count: 2 } }])
    mockAuthState.token = 'test-token'
    renderLayout('/')

    expect(await screen.findByRole('link', { name: /Notificaciones/i })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
