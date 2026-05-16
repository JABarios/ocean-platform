import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Login from '../pages/Login'
import { mockFetch, mockFetchSequence } from './mocks'
import * as navigation from '../utils/navigation'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('Login', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localStorage.clear()
  })

  it('muestra el formulario de login', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>
    )
    expect(screen.getByText('Iniciar sesión')).toBeInTheDocument()
    expect(screen.getByLabelText(/Correo electrónico/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Contraseña/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entrar/i })).toBeInTheDocument()
  })

  it('loguea correctamente y navega al dashboard', async () => {
    mockFetch({
      token: 'test-token',
      user: { id: '1', email: 'test@ocean.local', displayName: 'Test', role: 'Clinician' },
    })

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'test@ocean.local' },
    })
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true })
    })
  })

  it('muestra error si las credenciales son inválidas', async () => {
    vi.spyOn(navigation, 'reloadApplication').mockImplementation(() => undefined)
    mockFetch({ error: 'Credenciales inválidas' }, 401)

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'wrong@ocean.local' },
    })
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    expect(await screen.findByText(/Credenciales inválidas/i)).toBeInTheDocument()
  })

  it('ofrece reenviar la confirmación si la cuenta está pendiente', async () => {
    const fetchMock = mockFetchSequence([
      { data: { error: 'Debes confirmar tu correo antes de iniciar sesión' }, status: 401 },
      { data: { message: 'No hay proveedor de correo configurado. Usa el enlace de verificación devuelto por la API.', emailSent: false, verifyUrl: 'http://localhost:5173/verify-email/test-token' } },
    ])

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'pending@ocean.local' },
    })
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    expect(await screen.findByText(/Debes confirmar tu correo/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reenviar confirmación/i }))
    expect(await screen.findByText(/Estado del correo:/i)).toBeInTheDocument()
    expect(screen.getByText(/sin envío real \/ fallback/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /http:\/\/localhost:5173\/verify-email\/test-token/i })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalled()
  })
})
