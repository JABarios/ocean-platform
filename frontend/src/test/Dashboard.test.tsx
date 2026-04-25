import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Dashboard from '../pages/Dashboard'
import { mockFetchSequence } from './mocks'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const PENDING_REQUEST = {
  id: 'req-1',
  caseId: 'case-1',
  requestedBy: 'owner-1',
  targetUserId: 'reviewer-1',
  status: 'Pending',
  message: 'Revisa esto por favor',
  createdAt: '2026-01-01T00:00:00.000Z',
  case: { id: 'case-1', title: 'Caso Pendiente', status: 'Requested' },
  requester: { id: 'owner-1', displayName: 'Dr. Owner' },
}

const ACTIVE_REQUEST = {
  id: 'req-2',
  caseId: 'case-2',
  requestedBy: 'owner-1',
  targetUserId: 'reviewer-1',
  status: 'Accepted',
  createdAt: '2026-01-01T00:00:00.000Z',
  case: { id: 'case-2', title: 'Caso en Revisión', status: 'InReview' },
  requester: { id: 'owner-1', displayName: 'Dr. Owner' },
  targetUser: { id: 'reviewer-1', displayName: 'Dr. Reviewer' },
}

function renderDashboard() {
  return render(
    <BrowserRouter>
      <Dashboard />
    </BrowserRouter>
  )
}

describe('Dashboard — carga inicial', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra estado de carga inicialmente', () => {
    mockFetchSequence([{ data: [] }, { data: [] }, { data: [] }])
    renderDashboard()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('muestra casos del usuario tras cargar', async () => {
    mockFetchSequence([
      { data: [{ id: '1', title: 'Caso A', status: 'Draft', createdAt: '2026-01-01' }] },
      { data: [] },
      { data: [] },
    ])
    renderDashboard()
    expect(await screen.findByText('Caso A')).toBeInTheDocument()
  })

  it('muestra mensaje vacío cuando no hay casos', async () => {
    mockFetchSequence([{ data: [] }, { data: [] }, { data: [] }])
    renderDashboard()
    expect(await screen.findByText('No tienes casos creados.')).toBeInTheDocument()
  })

  it('muestra revisiones pendientes con su mensaje', async () => {
    mockFetchSequence([
      { data: [] },
      { data: [PENDING_REQUEST] },
      { data: [] },
    ])
    renderDashboard()
    expect(await screen.findByText('Caso Pendiente')).toBeInTheDocument()
    expect(await screen.findByText('Revisa esto por favor')).toBeInTheDocument()
  })

  it('muestra revisiones activas', async () => {
    mockFetchSequence([{ data: [] }, { data: [] }, { data: [ACTIVE_REQUEST] }])
    renderDashboard()
    expect(await screen.findByText('Caso en Revisión')).toBeInTheDocument()
  })

  it('muestra mensaje vacío cuando no hay pendientes', async () => {
    mockFetchSequence([{ data: [] }, { data: [] }, { data: [] }])
    renderDashboard()
    expect(await screen.findByText('No tienes revisiones pendientes.')).toBeInTheDocument()
  })
})

describe('Dashboard — respondRequest (el test que habría pillado el bug)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('aceptar llama a /requests/:id/accept, NO a /accepted', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },                                           // GET /cases
      { data: [PENDING_REQUEST] },                           // GET /requests/pending
      { data: [] },                                           // GET /requests/active
      { data: { ...PENDING_REQUEST, status: 'Accepted' } },  // POST accept
      { data: [] },                                           // GET /requests/active (refresh)
    ])

    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST')
      expect(postCall).toBeDefined()
      expect(postCall![0]).toContain('/requests/req-1/accept')
      expect(postCall![0]).not.toContain('accepted') // habría fallado con el bug
    })
  })

  it('rechazar llama a /requests/:id/reject, NO a /rejected', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },
      { data: [PENDING_REQUEST] },
      { data: [] },
      { data: { ...PENDING_REQUEST, status: 'Rejected' } }, // POST reject
      { data: [] },                                          // GET /requests/active (refresh)
    ])

    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === 'POST')
      expect(postCall).toBeDefined()
      expect(postCall![0]).toContain('/requests/req-1/reject')
      expect(postCall![0]).not.toContain('rejected') // habría fallado con el bug
    })
  })

  it('tras aceptar, la solicitud desaparece de pendientes', async () => {
    mockFetchSequence([
      { data: [] },
      { data: [PENDING_REQUEST] },
      { data: [] },
      { data: { ...PENDING_REQUEST, status: 'Accepted' } },
      { data: [] },
    ])

    renderDashboard()
    expect(await screen.findByText('Caso Pendiente')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Aceptar/i }))

    await waitFor(() => {
      expect(screen.queryByText('Caso Pendiente')).not.toBeInTheDocument()
    })
  })

  it('tras aceptar, se refresca GET /requests/active', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },
      { data: [PENDING_REQUEST] },
      { data: [] },
      { data: { ...PENDING_REQUEST, status: 'Accepted' } },
      { data: [ACTIVE_REQUEST] },
    ])

    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Aceptar/i }))

    await waitFor(() => {
      const activeCalls = fetchMock.mock.calls.filter(
        ([url, opts]) => url.includes('/requests/active') && (!opts?.method || opts.method === 'GET')
      )
      expect(activeCalls.length).toBeGreaterThanOrEqual(2) // carga inicial + refresh
    })
  })

  it('tras rechazar, también se refresca GET /requests/active', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },
      { data: [PENDING_REQUEST] },
      { data: [] },
      { data: { ...PENDING_REQUEST, status: 'Rejected' } },
      { data: [] },
    ])

    renderDashboard()
    fireEvent.click(await screen.findByRole('button', { name: /Rechazar/i }))

    await waitFor(() => {
      const postIdx = fetchMock.mock.calls.findIndex(([, opts]) => opts?.method === 'POST')
      const callsAfterPost = fetchMock.mock.calls.slice(postIdx + 1)
      expect(callsAfterPost.some(([url]) => url.includes('/requests/active'))).toBe(true)
    })
  })
})

describe('Dashboard — botón nuevo caso', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra botón para crear nuevo caso', async () => {
    mockFetchSequence([{ data: [] }, { data: [] }, { data: [] }])
    renderDashboard()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Solicitar nueva revisión/i })).toBeInTheDocument()
    })
  })
})
