const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

async function request<T>(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${endpoint}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const persistedAuth = localStorage.getItem('ocean-auth')
  const token = persistedAuth
    ? (JSON.parse(persistedAuth) as { state?: { token?: string } }).state?.token ?? null
    : null
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const options: RequestInit = {
    method,
    headers,
  }

  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)

  if (response.status === 401) {
    localStorage.removeItem('ocean-auth')
    window.location.reload()
    return Promise.reject(new Error('Unauthorized'))
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(endpoint: string) => request<T>('GET', endpoint),
  post: <T>(endpoint: string, body?: unknown) => request<T>('POST', endpoint, body),
  patch: <T>(endpoint: string, body?: unknown) => request<T>('PATCH', endpoint, body),
  del: <T>(endpoint: string) => request<T>('DELETE', endpoint),
}
