export interface LocalEegSession {
  id: string
  file: File
  createdAt: number
}

const sessions = new Map<string, LocalEegSession>()

export function createLocalEegSession(file: File): LocalEegSession {
  const session: LocalEegSession = {
    id: crypto.randomUUID(),
    file,
    createdAt: Date.now(),
  }
  sessions.set(session.id, session)
  return session
}

export function getLocalEegSession(id: string): LocalEegSession | null {
  return sessions.get(id) ?? null
}

export function clearLocalEegSession(id: string) {
  sessions.delete(id)
}
