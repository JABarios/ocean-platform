import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as apiClient from '../api/client'
import * as navigation from '../utils/navigation'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('api.client — manejo de errores', () => {
  it('lee el token desde ocean-auth y lo envía en Authorization', async () => {
    localStorage.getItem = vi.fn((key: string) => {
      if (key === 'ocean-auth') {
        return JSON.stringify({ state: { token: 'persisted-token' }, version: 0 })
      }
      return null
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
      text: () => Promise.resolve('{"status":"ok"}'),
    } as unknown as Response)
    global.fetch = fetchMock

    await apiClient.api.get('/health')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/health',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer persisted-token',
        }),
      }),
    )
  })

  it('en 401 limpia ocean-auth y recarga la página', async () => {
    localStorage.getItem = vi.fn((key: string) => {
      if (key === 'ocean-auth') {
        return JSON.stringify({ state: { token: 'persisted-token' }, version: 0 })
      }
      return null
    })

    const reloadSpy = vi.spyOn(navigation, 'reloadApplication').mockImplementation(() => undefined)

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    } as unknown as Response)

    await expect(apiClient.api.get('/cases')).rejects.toMatchObject({ status: 401 })
    expect(localStorage.removeItem).toHaveBeenCalledWith('ocean-auth')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('lee error JSON sin consumir el body dos veces', async () => {
    // Simula una respuesta 500 donde json() lanza porque el stream ya se leyó
    let textCalled = false
    const responseBody = JSON.stringify({ error: 'Error interno del backend' })

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => {
        textCalled = true
        return Promise.resolve(responseBody)
      },
      json: () => {
        if (textCalled) {
          // Simula el bug: json() falla si text() ya consumió el stream
          throw new TypeError("Failed to execute 'text' on 'Response': body stream already read")
        }
        return Promise.resolve(JSON.parse(responseBody))
      },
    } as unknown as Response)

    try {
      await apiClient.api.post('/cases', { title: 'Test' })
      expect.fail('Debería haber lanzado error')
    } catch (err: any) {
      expect(err.message).toBe('Error interno del backend')
      expect(err.status).toBe(500)
    }
  })

  it('lee error como texto plano cuando no es JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Error interno del servidor'),
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response)

    try {
      await apiClient.api.get('/cases')
      expect.fail('Debería haber lanzado error')
    } catch (err: any) {
      expect(err.message).toBe('Error interno del servidor')
      expect(err.status).toBe(500)
    }
  })

  it('maneja error de red cuando no hay conexión', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    try {
      await apiClient.api.get('/health')
      expect.fail('Debería haber lanzado error')
    } catch (err: any) {
      expect(err.message).toContain('No se pudo conectar')
      expect(err.status).toBe(0)
    }
  })
})
