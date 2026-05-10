import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Register from '../pages/Register'
import { mockFetch } from './mocks'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('Register', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('muestra mensaje de confirmación tras registrarse', async () => {
    mockFetch({
      requiresVerification: true,
      emailSent: false,
      message: 'Cuenta creada. Como no hay proveedor de correo configurado, usa el enlace de verificación devuelto por la API.',
      verifyUrl: 'http://localhost:5173/verify-email/test-token',
    })

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Register />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText(/Nombre completo/i), { target: { value: 'Dr. Test' } })
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), { target: { value: 'test@ocean.local' } })
    fireEvent.change(screen.getByLabelText(/^Contraseña$/i), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrarse/i }))

    expect(await screen.findByText(/Cuenta creada/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /http:\/\/localhost:5173\/verify-email\/test-token/i })).toBeInTheDocument()
  })
})
