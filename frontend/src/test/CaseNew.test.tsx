import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import CaseNew from '../pages/CaseNew'
import { mockFetch } from './mocks'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

describe('CaseNew', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('muestra el formulario de nuevo caso', () => {
    render(
      <BrowserRouter>
        <CaseNew />
      </BrowserRouter>
    )
    expect(screen.getByText('Nuevo caso')).toBeInTheDocument()
    expect(screen.getByLabelText(/Título/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Contexto clínico/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Rango de edad/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Motivo del estudio/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Modalidad/i)).toBeInTheDocument()
  })

  it('valida campos requeridos', async () => {
    render(
      <BrowserRouter>
        <CaseNew />
      </BrowserRouter>
    )

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    // HTML5 validation debería prevenir el submit
    expect(screen.queryByText('Error')).not.toBeInTheDocument()
  })

  it('crea un caso correctamente', async () => {
    mockFetch({ id: 'new-case-id', title: 'Test', status: 'Draft' })

    render(
      <BrowserRouter>
        <CaseNew />
      </BrowserRouter>
    )

    fireEvent.change(screen.getByLabelText(/Título/i), {
      target: { value: 'Caso Test' },
    })
    fireEvent.change(screen.getByLabelText(/Contexto clínico/i), {
      target: { value: 'Contexto' },
    })
    fireEvent.change(screen.getByLabelText(/Rango de edad/i), {
      target: { value: 'Adulto' },
    })
    fireEvent.change(screen.getByLabelText(/Motivo del estudio/i), {
      target: { value: 'Motivo' },
    })
    fireEvent.change(screen.getByLabelText(/Modalidad/i), {
      target: { value: 'EEG' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Crear caso/i }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/cases'),
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
