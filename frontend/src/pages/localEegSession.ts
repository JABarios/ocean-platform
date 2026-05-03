export interface LocalEegSession {
  id: string
  filename: string
  sizeBytes: number
  buffer: ArrayBuffer
  createdAt: number
}

const sessions = new Map<string, LocalEegSession>()

export function createLocalEegSession(file: { filename: string; sizeBytes: number; buffer: ArrayBuffer }): LocalEegSession {
  const session: LocalEegSession = {
    id: crypto.randomUUID(),
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    buffer: file.buffer,
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
