// Si VITE_API_URL está definida en build-time, la usamos.
// Si no, inferimos desde window.location (misma IP que el frontend, puerto 4000).
// Esto evita recompilar cuando cambia la IP de la máquina.
export const API_BASE = import.meta.env.VITE_API_URL
  || `${window.location.protocol}//${window.location.hostname}:4000`

class ApiError extends Error {
  public status: number
  public detail?: string

  constructor(message: string, status: number, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
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

  const token = localStorage.getItem('ocean_token')
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

  let response: Response
  try {
    response = await fetch(url, options)
  } catch (err: any) {
    // Error de red (no llega al servidor)
    console.error(`[OCEAN API] No se pudo conectar a ${url}`, err)
    throw new ApiError(
      `No se pudo conectar al backend (${API_BASE}). ¿Está corriendo? ¿Es la URL correcta?`,
      0,
      err.message
    )
  }

  // CORS bloqueado o respuesta vacía (status 0 en algunos navegadores)
  if (response.status === 0 || (!response.ok && response.status === 0)) {
    console.error(`[OCEAN API] Posible error CORS o red bloqueada en ${url}`)
    throw new ApiError(
      `El navegador bloqueó la petición a ${url}. Posible error CORS: verifica que el backend permita el origen ${window.location.origin}`,
      0
    )
  }

  if (response.status === 401) {
    localStorage.removeItem('ocean_token')
    window.location.reload()
    return Promise.reject(new ApiError('Unauthorized', 401))
  }

  if (!response.ok) {
    // Leer el body UNA sola vez como texto, luego intentar parsear JSON
    const rawText = await response.text()
    let errorText = rawText
    try {
      const json = JSON.parse(rawText)
      errorText = json.error || JSON.stringify(json)
    } catch {
      // No es JSON válido, usar el texto crudo
    }
    console.error(`[OCEAN API] HTTP ${response.status} en ${url}: ${errorText}`)
    throw new ApiError(
      errorText || `Error HTTP ${response.status}`,
      response.status,
      `URL: ${url} | Método: ${method}`
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'Error desconocido'
}

export const api = {
  get: <T>(endpoint: string) => request<T>('GET', endpoint),
  post: <T>(endpoint: string, body?: unknown) => request<T>('POST', endpoint, body),
  patch: <T>(endpoint: string, body?: unknown) => request<T>('PATCH', endpoint, body),
  del: <T>(endpoint: string) => request<T>('DELETE', endpoint),
}
