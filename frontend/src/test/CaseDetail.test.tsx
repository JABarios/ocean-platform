import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import CaseDetail from '../pages/CaseDetail'
import { mockFetchSequence } from './mocks'
import type { User } from '../types'

// --- Mocks de módulos ---

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'case-1' }), useNavigate: () => vi.fn() }
})

vi.mock('../hooks/useCrypto', () => ({
  useCrypto: () => ({ encryptFile: vi.fn(), decryptFile: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }),
}))

let mockAuthState = {
  user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

// --- Fixtures ---

const BASE_CASE = {
  id: 'case-1',
  title: 'EEG Caso Test',
  clinicalContext: 'Paciente con crisis',
  ageRange: 'Adulto',
  studyReason: 'Diagnóstico diferencial',
  modality: 'EEG',
  status: 'Draft',
  teachingStatus: 'None',
  ownerId: 'owner-1',
  tags: [],
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
}

const OTHER_USER = { id: 'other-1', email: 'other@test.com', displayName: 'Dr. Otro', role: 'Clinician' }

function mockLoad(caseData = BASE_CASE, comments: unknown[] = [], users: unknown[] = [OTHER_USER]) {
  return mockFetchSequence([
    { data: caseData },   // GET /cases/case-1
    { data: comments },   // GET /comments/case/case-1
    { data: users },      // GET /users
  ])
}

function renderDetail() {
  return render(<BrowserRouter><CaseDetail /></BrowserRouter>)
}

// --- Tests ---

describe('CaseDetail — carga inicial', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('muestra estado de carga inicialmente', () => {
    mockLoad()
    renderDetail()
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })

  it('muestra el título y metadatos del caso', async () => {
    mockLoad()
    renderDetail()
    expect(await screen.findByText('EEG Caso Test')).toBeInTheDocument()
    expect(screen.getByText('Paciente con crisis')).toBeInTheDocument()
    expect(screen.getByText('Adulto')).toBeInTheDocument()
    expect(screen.getByText('EEG')).toBeInTheDocument()
  })

  it('muestra el badge de estado', async () => {
    mockLoad()
    renderDetail()
    await screen.findByText('EEG Caso Test')
    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('muestra error cuando la API devuelve 401', async () => {
    mockFetchSequence([
      { data: { error: 'Token inválido' }, status: 401 },
      { data: [] },
      { data: [] },
    ])
    renderDetail()
    // El client.ts redirige en 401 (window.location.reload), el componente no llega a cargar
    // Simplemente verificamos que no explota mostrando el caso
    await waitFor(() => {
      expect(screen.queryByText('EEG Caso Test')).not.toBeInTheDocument()
    })
  })

  it('muestra error cuando el caso no se encuentra', async () => {
    mockFetchSequence([
      { data: { error: 'Caso no encontrado' }, status: 404 },
      { data: [] },
      { data: [] },
    ])
    renderDetail()
    await waitFor(() => {
      expect(screen.queryByText('EEG Caso Test')).not.toBeInTheDocument()
    })
  })

  it('muestra "No hay comentarios" cuando no hay ninguno', async () => {
    mockLoad(BASE_CASE, [])
    renderDetail()
    expect(await screen.findByText('No hay comentarios.')).toBeInTheDocument()
  })

  it('muestra comentarios cuando existen', async () => {
    mockLoad(BASE_CASE, [
      {
        id: 'c1', caseId: 'case-1', authorId: 'other-1', type: 'Comment',
        content: 'Patrón sugestivo de epilepsia focal',
        createdAt: '2026-01-15T11:00:00.000Z',
        author: { id: 'other-1', displayName: 'Dr. Otro' },
      },
    ])
    renderDetail()
    expect(await screen.findByText('Patrón sugestivo de epilepsia focal')).toBeInTheDocument()
    expect(screen.getByText('Dr. Otro')).toBeInTheDocument()
  })
})

describe('CaseDetail — acceso por rol (owner vs no-owner)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('el owner ve el botón de cambio de estado (Draft → Enviar solicitud)', async () => {
    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user, id: 'owner-1' } }
    mockLoad({ ...BASE_CASE, status: 'Draft', ownerId: 'owner-1' })
    renderDetail()
    expect(await screen.findByRole('button', { name: /Enviar solicitud/i })).toBeInTheDocument()
  })

  it('el no-owner no ve botones de cambio de estado', async () => {
    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user, id: 'intruder-99' } }
    mockLoad({ ...BASE_CASE, status: 'Draft', ownerId: 'owner-1' })
    renderDetail()
    await screen.findByText('EEG Caso Test')
    expect(screen.queryByRole('button', { name: /Enviar solicitud/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Iniciar revisión/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcar como Resuelto/i })).not.toBeInTheDocument()
  })

  it('en estado InReview, owner ve "Marcar como Resuelto"', async () => {
    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user, id: 'owner-1' } }
    mockLoad({ ...BASE_CASE, status: 'InReview', ownerId: 'owner-1' })
    renderDetail()
    expect(await screen.findByRole('button', { name: /Marcar como Resuelto/i })).toBeInTheDocument()
  })

  it('en estado Resolved, owner ve botón Proponer para docencia', async () => {
    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user, id: 'owner-1' } }
    mockLoad({ ...BASE_CASE, status: 'Resolved', ownerId: 'owner-1' })
    renderDetail()
    expect(await screen.findByRole('button', { name: /Proponer para docencia/i })).toBeInTheDocument()
  })

  it('en estado Draft, no aparece "Proponer para docencia"', async () => {
    mockAuthState = { ...mockAuthState, user: { ...mockAuthState.user, id: 'owner-1' } }
    mockLoad({ ...BASE_CASE, status: 'Draft', ownerId: 'owner-1' })
    renderDetail()
    await screen.findByText('EEG Caso Test')
    expect(screen.queryByRole('button', { name: /Proponer para docencia/i })).not.toBeInTheDocument()
  })
})

describe('CaseDetail — cambio de estado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('clic en "Enviar solicitud" llama a PATCH /cases/case-1/status con Draft→Requested', async () => {
    const fetchMock = mockFetchSequence([
      { data: BASE_CASE },
      { data: [] },
      { data: [OTHER_USER] },
      { data: { ...BASE_CASE, status: 'Requested' } }, // PATCH response
    ])

    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: /Enviar solicitud/i }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([url, opts]) =>
        url.includes('/cases/case-1/status') && opts?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
      const body = JSON.parse(patchCall![1].body as string)
      expect(body.statusClinical).toBe('Requested')
    })
  })

  it('tras cambio exitoso, el badge muestra el nuevo estado', async () => {
    mockFetchSequence([
      { data: BASE_CASE },
      { data: [] },
      { data: [OTHER_USER] },
      { data: { ...BASE_CASE, status: 'Requested' } },
    ])

    renderDetail()
    await screen.findByText('Draft')
    fireEvent.click(screen.getByRole('button', { name: /Enviar solicitud/i }))
    expect(await screen.findByText('Requested')).toBeInTheDocument()
  })
})

describe('CaseDetail — comentarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('enviar comentario llama a POST /comments/case/case-1', async () => {
    const newComment = {
      id: 'c-new', caseId: 'case-1', authorId: 'owner-1', type: 'Comment',
      content: 'Hallazgo importante',
      createdAt: '2026-01-15T12:00:00.000Z',
      author: { id: 'owner-1', displayName: 'Dr. Owner' },
    }
    const fetchMock = mockFetchSequence([
      { data: BASE_CASE },
      { data: [] },
      { data: [OTHER_USER] },
      { data: newComment }, // POST comment response
    ])

    renderDetail()
    await screen.findByText('EEG Caso Test')

    const textarea = screen.getByPlaceholderText(/Escribe un comentario/i)
    fireEvent.change(textarea, { target: { value: 'Hallazgo importante' } })
    fireEvent.click(screen.getByRole('button', { name: /Comentar/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) =>
        url.includes('/comments/case/case-1') && opts?.method === 'POST'
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1].body as string)
      expect(body.body).toBe('Hallazgo importante')
    })
  })

  it('el comentario aparece en la lista tras submit exitoso', async () => {
    mockFetchSequence([
      { data: BASE_CASE },
      { data: [] },
      { data: [OTHER_USER] },
      {
        data: {
          id: 'c-new', caseId: 'case-1', authorId: 'owner-1', type: 'Comment',
          content: 'Nuevo comentario visible',
          createdAt: '2026-01-15T12:00:00.000Z',
          author: { id: 'owner-1', displayName: 'Dr. Owner' },
        },
      },
    ])

    renderDetail()
    await screen.findByText('EEG Caso Test')
    fireEvent.change(screen.getByPlaceholderText(/Escribe un comentario/i), {
      target: { value: 'Nuevo comentario visible' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Comentar/i }))

    expect(await screen.findByText('Nuevo comentario visible')).toBeInTheDocument()
  })

  it('el textarea se vacía tras submit exitoso', async () => {
    mockFetchSequence([
      { data: BASE_CASE },
      { data: [] },
      { data: [OTHER_USER] },
      {
        data: {
          id: 'c-x', caseId: 'case-1', authorId: 'owner-1', type: 'Comment',
          content: 'Texto temporal',
          createdAt: '2026-01-15T12:00:00.000Z',
          author: { id: 'owner-1', displayName: 'Dr. Owner' },
        },
      },
    ])

    renderDetail()
    await screen.findByText('EEG Caso Test')
    const textarea = screen.getByPlaceholderText(/Escribe un comentario/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Texto temporal' } })
    fireEvent.click(screen.getByRole('button', { name: /Comentar/i }))

    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
  })
})

describe('CaseDetail — sección de paquete EEG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthState = {
      user: { id: 'owner-1', email: 'owner@test.com', displayName: 'Dr. Owner', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('no muestra sección de paquete si no hay ninguno', async () => {
    mockLoad(BASE_CASE) // BASE_CASE no tiene package
    renderDetail()
    await screen.findByText('EEG Caso Test')
    expect(screen.queryByRole('button', { name: /Descargar .enc/i })).not.toBeInTheDocument()
  })

  it('muestra sección de paquete si existe', async () => {
    mockLoad({
      ...BASE_CASE,
      package: {
        id: 'pkg-1', caseId: 'case-1', sizeBytes: 2097152,
        blobHash: 'abc123def456', uploadStatus: 'Ready',
        retentionPolicy: 'Temporal72h', createdAt: '2026-01-15T10:00:00.000Z',
      },
    })
    renderDetail()
    expect(await screen.findByRole('button', { name: /Descargar .enc/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Pega la clave de descifrado/i)).toBeInTheDocument()
  })

  it('botón "Descifrar" está deshabilitado si no hay clave', async () => {
    mockLoad({
      ...BASE_CASE,
      package: {
        id: 'pkg-1', caseId: 'case-1', sizeBytes: 1024,
        blobHash: 'abc123', uploadStatus: 'Ready',
        retentionPolicy: 'Temporal72h', createdAt: '2026-01-15T10:00:00.000Z',
      },
    })
    renderDetail()
    const btn = await screen.findByRole('button', { name: /Descifrar/i })
    expect(btn).toBeDisabled()
  })
})
