const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

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

  const options: RequestInit = { method, headers }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(url, options)
  } catch {
    throw new ApiError('No se pudo conectar con el servidor', 0)
  }

  if (response.status === 401) {
    localStorage.removeItem('ocean-auth')
    window.location.reload()
    throw new ApiError('Unauthorized', 401)
  }

  if (!response.ok) {
    // Intentar parsear JSON primero; si falla, usar texto plano
    let message: string
    try {
      const json = await response.json()
      message = json?.error ?? JSON.stringify(json)
    } catch {
      message = (await response.text()) || `HTTP ${response.status}`
    }
    throw new ApiError(message, response.status)
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
