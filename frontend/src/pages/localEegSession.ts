export interface LocalEegSession {
  id: string
  filename: string
  sizeBytes: number
  buffer: ArrayBuffer
  createdAt: number
}

interface PersistedLocalEegRecord {
  id: string
  filename: string
  sizeBytes: number
  createdAt: number
  payload: Blob | ArrayBuffer
}

const sessions = new Map<string, LocalEegSession>()
const DB_NAME = 'ocean-local-edf'
const STORE_NAME = 'sessions'
const DB_VERSION = 1
const LAST_LOCAL_SESSION_ID_KEY = 'ocean-last-local-edf-session-id'

function supportsLocalEegPersistence(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openLocalEegDb(): Promise<IDBDatabase | null> {
  if (!supportsLocalEegPersistence()) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la caché local del EDF'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T | null> {
  return openLocalEegDb().then((db) => {
    if (!db) return null

    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const store = tx.objectStore(STORE_NAME)
      run(store, resolve, reject)
      tx.oncomplete = () => db.close()
      tx.onerror = () => {
        db.close()
        reject(tx.error ?? new Error('Error de transacción IndexedDB'))
      }
      tx.onabort = () => {
        db.close()
        reject(tx.error ?? new Error('Transacción IndexedDB abortada'))
      }
    })
  })
}

function rememberLastLocalSessionId(id: string) {
  try {
    window.localStorage.setItem(LAST_LOCAL_SESSION_ID_KEY, id)
  } catch {
    // ignore localStorage failures
  }
}

function readLastLocalSessionId(): string | null {
  try {
    return window.localStorage.getItem(LAST_LOCAL_SESSION_ID_KEY)
  } catch {
    return null
  }
}

function persistLocalEegSession(session: LocalEegSession): void {
  rememberLastLocalSessionId(session.id)
  void withStore<void>('readwrite', (store, done, fail) => {
    const clearRequest = store.clear()
    clearRequest.onerror = () => fail(clearRequest.error)
    clearRequest.onsuccess = () => {
      const request = store.put({
        id: session.id,
        filename: session.filename,
        sizeBytes: session.sizeBytes,
        createdAt: session.createdAt,
        payload: new Blob([session.buffer], { type: 'application/octet-stream' }),
      } satisfies PersistedLocalEegRecord)
      request.onsuccess = () => done()
      request.onerror = () => fail(request.error)
    }
  }).catch((err) => {
    console.warn('[OCEAN EEG] No se pudo persistir el último EDF local', err)
  })
}

async function loadPersistedLocalEegSession(id: string): Promise<LocalEegSession | null> {
  if (!id) return null

  const record = await withStore<PersistedLocalEegRecord | null>('readonly', (store, done, fail) => {
    const request = store.get(id)
    request.onsuccess = () => done((request.result as PersistedLocalEegRecord | undefined) ?? null)
    request.onerror = () => fail(request.error)
  })

  if (!record?.payload) return null
  const buffer = record.payload instanceof Blob ? await record.payload.arrayBuffer() : record.payload
  return {
    id: record.id,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    createdAt: record.createdAt,
    buffer,
  }
}

function buildLocalEegSession(id: string, file: { filename: string; sizeBytes: number; buffer: ArrayBuffer }): LocalEegSession {
  return {
    id,
    filename: file.filename,
    sizeBytes: file.sizeBytes,
    buffer: file.buffer,
    createdAt: Date.now(),
  }
}

export function createLocalEegSession(file: { filename: string; sizeBytes: number; buffer: ArrayBuffer }): LocalEegSession {
  const session = buildLocalEegSession(crypto.randomUUID(), file)
  sessions.set(session.id, session)
  persistLocalEegSession(session)
  return session
}

export function getLocalEegSession(id: string): LocalEegSession | null {
  return sessions.get(id) ?? null
}

export async function getOrRestoreLocalEegSession(id: string): Promise<LocalEegSession | null> {
  const existing = sessions.get(id)
  if (existing) return existing
  const restored = await loadPersistedLocalEegSession(id)
  if (restored) sessions.set(restored.id, restored)
  return restored
}

export async function getLastLocalEegSession(): Promise<LocalEegSession | null> {
  const lastId = readLastLocalSessionId()
  if (!lastId) return null
  return getOrRestoreLocalEegSession(lastId)
}

export function replaceLocalEegSession(id: string, file: { filename: string; sizeBytes: number; buffer: ArrayBuffer }): LocalEegSession {
  const session = buildLocalEegSession(id, file)
  sessions.set(id, session)
  persistLocalEegSession(session)
  return session
}

export function clearLocalEegSession(id: string) {
  sessions.delete(id)
}
