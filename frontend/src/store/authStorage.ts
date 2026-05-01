const AUTH_STORAGE_KEY = 'ocean-auth'

interface PersistedAuthState {
  state?: {
    token?: string | null
  }
}

export function readPersistedAuthToken(): string | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as PersistedAuthState
    const token = parsed?.state?.token
    return typeof token === 'string' && token.trim().length > 0 ? token : null
  } catch {
    return null
  }
}

export function clearPersistedAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}

export { AUTH_STORAGE_KEY }
