import { vi } from 'vitest'

type FetchMock = ReturnType<typeof vi.fn>

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  } as Response
}

export function mockFetch(response: unknown, status = 200): FetchMock {
  const mock = vi.fn().mockResolvedValue(makeResponse(response, status))
  vi.stubGlobal('fetch', mock)
  return mock
}

export function mockFetchError(message: string, status = 500): FetchMock {
  const mock = vi.fn().mockResolvedValue(makeResponse(message, status))
  vi.stubGlobal('fetch', mock)
  return mock
}

export function mockFetchNetworkError(): FetchMock {
  const mock = vi.fn().mockRejectedValue(new Error('Network error'))
  vi.stubGlobal('fetch', mock)
  return mock
}

// Mocks múltiples respuestas secuenciales (una por llamada a fetch).
// Devuelve la referencia al mock para inspeccionarlo en los tests.
export function mockFetchSequence(
  responses: Array<{ data: unknown; status?: number } | 'network_error'>
): FetchMock {
  let mock = vi.fn()
  for (const r of responses) {
    if (r === 'network_error') {
      mock = mock.mockRejectedValueOnce(new Error('Network error'))
    } else {
      mock = mock.mockResolvedValueOnce(makeResponse(r.data, r.status ?? 200))
    }
  }
  vi.stubGlobal('fetch', mock)
  return mock
}
