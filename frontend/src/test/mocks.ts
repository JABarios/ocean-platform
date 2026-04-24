import { vi } from 'vitest'

export function mockFetch(response: any, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  } as Response)
}

export function mockFetchError(message: string, status = 500) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: message }),
    text: () => Promise.resolve(message),
  } as Response)
}

export function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
}
