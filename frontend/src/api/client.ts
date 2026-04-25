// Fallback dinámico: si no hay VITE_API_URL en build-time, usa la IP
// desde la que se cargó el frontend (funciona en localhost y en red local).
export const API_BASE = import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:4000`

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return 'Sin conexión con el servidor. Comprueba tu red.'
    if (err.status === 403) return 'No tienes permiso para realizar esta acción.'
    if (err.status === 404) return 'El recurso no fue encontrado.'
    return err.message
  }
  return err instanceof Error ? err.message : 'Error inesperado.'
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

  const token = localStorage.getItem('ocean_token')
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
