const DB_NAME = 'ocean-eeg-cache'
const STORE_NAME = 'encrypted-packages'
const DB_VERSION = 1
const MAX_CACHE_BYTES = 512 * 1024 * 1024

interface CachedEncryptedPackageRecord {
  blobHash: string
  caseId: string
  sizeBytes: number
  savedAt: number
  payload: Blob | ArrayBuffer
}

function supportsEncryptedPackageCache(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openCacheDb(): Promise<IDBDatabase | null> {
  if (!supportsEncryptedPackageCache()) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'blobHash' })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'))
  })
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void,
): Promise<T | null> {
  return openCacheDb().then((db) => {
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

export async function getEncryptedPackageFromCache(blobHash: string): Promise<ArrayBuffer | null> {
  if (!blobHash) return null

  const record = await withStore<CachedEncryptedPackageRecord | null>('readonly', (store, done, fail) => {
    const request = store.get(blobHash)
    request.onsuccess = () => done((request.result as CachedEncryptedPackageRecord | undefined) ?? null)
    request.onerror = () => fail(request.error)
  })

  if (!record?.payload) return null
  if (record.payload instanceof Blob) return record.payload.arrayBuffer()
  return record.payload
}

async function listCachedRecords(): Promise<CachedEncryptedPackageRecord[]> {
  const records = await withStore<CachedEncryptedPackageRecord[]>('readonly', (store, done, fail) => {
    const request = store.getAll()
    request.onsuccess = () => done((request.result as CachedEncryptedPackageRecord[] | undefined) ?? [])
    request.onerror = () => fail(request.error)
  })
  return records ?? []
}

async function deleteEncryptedPackage(blobHash: string): Promise<void> {
  await withStore<void>('readwrite', (store, done, fail) => {
    const request = store.delete(blobHash)
    request.onsuccess = () => done()
    request.onerror = () => fail(request.error)
  })
}

async function pruneEncryptedPackageCache(): Promise<void> {
  const records = await listCachedRecords()
  let totalBytes = records.reduce((sum, record) => sum + (record.sizeBytes || 0), 0)
  if (totalBytes <= MAX_CACHE_BYTES) return

  const ordered = [...records].sort((a, b) => a.savedAt - b.savedAt)
  for (const record of ordered) {
    await deleteEncryptedPackage(record.blobHash)
    totalBytes -= record.sizeBytes || 0
    if (totalBytes <= MAX_CACHE_BYTES) break
  }
}

export async function saveEncryptedPackageToCache(params: {
  blobHash: string
  caseId: string
  sizeBytes?: number
  payload: ArrayBuffer
}): Promise<void> {
  const { blobHash, caseId, sizeBytes, payload } = params
  if (!blobHash || payload.byteLength === 0) return

  await withStore<void>('readwrite', (store, done, fail) => {
    const record: CachedEncryptedPackageRecord = {
      blobHash,
      caseId,
      sizeBytes: sizeBytes ?? payload.byteLength,
      savedAt: Date.now(),
      payload: new Blob([payload], { type: 'application/octet-stream' }),
    }
    const request = store.put(record)
    request.onsuccess = () => done()
    request.onerror = () => fail(request.error)
  })

  await pruneEncryptedPackageCache()
}
