import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'
import { mockFetch, makeResponse } from './mocks'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra estado de carga inicialmente', () => {
    mockFetch({ cases: [], pending: [], active: [] })
    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    )
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('muestra casos del usuario', async () => {
    mockFetch([
      { id: '1', title: 'Caso A', status: 'Draft', createdAt: '2024-01-01' },
      { id: '2', title: 'Caso B', status: 'Resolved', createdAt: '2024-01-02' },
    ])

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Caso A')).toBeInTheDocument()
      expect(screen.getByText('Caso B')).toBeInTheDocument()
    })
  })

  it('muestra mensaje cuando no hay casos', async () => {
    mockFetch([])

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('No tienes casos creados.')).toBeInTheDocument()
    })
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

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Caso Pendiente')).toBeInTheDocument()
      expect(screen.getByText('Revisa esto')).toBeInTheDocument()
    })
  })

  it('muestra botón para nuevo caso', async () => {
    mockFetch([])

    render(
      <BrowserRouter>
        <Dashboard />
      </BrowserRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Solicitar nueva revisión/i })).toBeInTheDocument()
    })
  })
})
