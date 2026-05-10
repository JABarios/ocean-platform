import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import VerifyEmail from '../pages/VerifyEmail'
import { mockFetch } from './mocks'

describe('VerifyEmail', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('confirma el correo y muestra mensaje final', async () => {
    mockFetch({ message: 'Correo confirmado. Ya puedes iniciar sesión.' })

    render(
      <MemoryRouter initialEntries={['/verify-email/test-token']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/verify-email/:token" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Correo confirmado/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ir a iniciar sesión/i })).toBeInTheDocument()
  })
})
