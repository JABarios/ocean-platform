import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Login from '../pages/Login'
import { mockFetch } from './mocks'

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
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('muestra el formulario de login', () => {
    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>
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
      <BrowserRouter>
        <Login />
      </BrowserRouter>
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
    mockFetch({ error: 'Unauthorized' }, 401)

    render(
      <BrowserRouter>
        <Login />
      </BrowserRouter>
    )

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'wrong@ocean.local' },
    })
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }))

    expect(await screen.findByText(/Unauthorized/i)).toBeInTheDocument()
  })
})
