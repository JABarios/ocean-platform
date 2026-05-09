import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra el formulario de nuevo caso', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CaseNew />
      </MemoryRouter>
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
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CaseNew />
      </MemoryRouter>
    )

    const form = document.querySelector('form')!
    fireEvent.submit(form)

    // HTML5 validation debería prevenir el submit
    expect(screen.queryByText('Error')).not.toBeInTheDocument()
  })

  it('mantiene deshabilitada la creación local hasta que haya un EEG preparado', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CaseNew />
      </MemoryRouter>
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

    expect(screen.getByRole('button', { name: /Crear caso/i })).toBeDisabled()
  })

  it('no permite crear un caso local sin haber seleccionado un EEG', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CaseNew />
      </MemoryRouter>
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

    expect(screen.getByRole('button', { name: /Crear caso/i })).toBeDisabled()
  })

  it('permite crear un caso enlazando un EEG de galería', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 'g1', title: 'Galería A', recordCount: 2 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'g1',
          title: 'Galería A',
          recordCount: 2,
          records: [
            { id: 'r1', label: 'EEG 1', metadata: { originalFilename: 'a.edf' } },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ id: 'new-case-id', title: 'Caso desde galería', status: 'Draft' }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <CaseNew />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /Elegir EEG desde una galería/i }))
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/galleries'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.change(screen.getByLabelText(/Título/i), {
      target: { value: 'Caso desde galería' },
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
    fireEvent.change(document.getElementById('gallery-select') as HTMLSelectElement, {
      target: { value: 'g1' },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/galleries/g1'),
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.change(document.getElementById('gallery-record-select') as HTMLSelectElement, {
      target: { value: 'r1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Crear caso/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) =>
        String(url).includes('/cases') && opts?.method === 'POST'
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(postCall![1].body as string)
      expect(body.galleryRecordId).toBe('r1')
    })
  })
})
