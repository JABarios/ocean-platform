import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../api/client'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('api.client — manejo de errores', () => {
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
      await api.post('/cases', { title: 'Test' })
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
      await api.get('/cases')
      expect.fail('Debería haber lanzado error')
    } catch (err: any) {
      expect(err.message).toBe('Error interno del servidor')
      expect(err.status).toBe(500)
    }
  })

  it('maneja error de red cuando no hay conexión', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    try {
      await api.get('/health')
      expect.fail('Debería haber lanzado error')
    } catch (err: any) {
      expect(err.message).toContain('No se pudo conectar')
      expect(err.status).toBe(0)
    }
  })
})
