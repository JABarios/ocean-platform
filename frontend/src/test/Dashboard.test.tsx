import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'
import { makeResponse, mockFetchSequence } from './mocks'
import type { User } from '../types'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

let mockAuthState = {
  user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderDashboard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('muestra estado de carga inicialmente', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    renderDashboard()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('muestra casos del usuario', async () => {
    mockFetchSequence([
      {
        data: [
          { id: '1', title: 'Caso A', status: 'Draft', tags: ['epilepsia'], createdAt: '2024-01-01', updatedAt: '2024-01-01' },
          { id: '2', title: 'Caso B', status: 'Resolved', tags: [], createdAt: '2024-01-02', updatedAt: '2024-01-02' },
        ],
      },
      { data: [] },
      { data: [] },
      { data: [] },
    ])

    renderDashboard()

    expect(await screen.findByText('Caso A')).toBeInTheDocument()
    expect(screen.getByText('Caso B')).toBeInTheDocument()
    expect(screen.getByText('Tus casos recientes')).toBeInTheDocument()
  })

  it('muestra mensaje cuando no hay casos', async () => {
    mockFetchSequence([
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [] },
    ])

    renderDashboard()

    expect(await screen.findByText('No tienes casos creados.')).toBeInTheDocument()
  })

  it('muestra revisiones pendientes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/cases')) return makeResponse([])
      if (url.includes('/requests/pending')) {
        return makeResponse([
          { id: 'r1', caseId: '1', case: { title: 'Caso Pendiente', status: 'Requested' }, message: 'Revisa esto', requester: { id: 'u1', displayName: 'Dr. Owner' } },
        ])
      }
      if (url.includes('/requests/active')) return makeResponse([])
      if (url.includes('/requests/expired')) return makeResponse([])
      return makeResponse({}, 404)
    }))

    renderDashboard()

    expect(await screen.findByText('Caso Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Revisa esto')).toBeInTheDocument()
  })

  it('muestra botón para nuevo caso', async () => {
    mockFetchSequence([
      { data: [] },
      { data: [] },
      { data: [] },
      { data: [] },
    ])

    renderDashboard()

    expect(await screen.findByRole('button', { name: /Nuevo caso/i })).toBeInTheDocument()
  })
})
