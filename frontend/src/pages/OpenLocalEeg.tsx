import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { createLocalEegSession, getLastLocalEegSession } from './localEegSession'
import { deleteEncryptedPackageFromCache, listEncryptedPackagesFromCache, type CachedEncryptedPackageSummary } from './encryptedPackageCache'
import './CaseNew.css'

export default function OpenLocalEeg() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [cachedEntries, setCachedEntries] = useState<CachedEncryptedPackageSummary[]>([])
  const [loadingCache, setLoadingCache] = useState(true)
  const [cacheError, setCacheError] = useState('')
  const [busyCacheId, setBusyCacheId] = useState<string | null>(null)

  const refreshCache = async () => {
    setLoadingCache(true)
    setCacheError('')
    try {
      const entries = await listEncryptedPackagesFromCache()
      setCachedEntries(entries)
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : 'No se pudo leer la caché local del navegador.')
    } finally {
      setLoadingCache(false)
    }
  }

  useEffect(() => {
    void refreshCache()
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setError('')
  }

  const handleOpenLocal = async () => {
    const currentFile = fileInputRef.current?.files?.[0] ?? selectedFile
    if (!currentFile) {
      setError('Selecciona primero un archivo EDF.')
      return
    }
    setOpening(true)
    setError('')
    try {
      const buffer = await currentFile.arrayBuffer()
      const session = createLocalEegSession({
        filename: currentFile.name,
        sizeBytes: currentFile.size,
        buffer,
      })
      navigate(`/open/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El navegador no pudo leer el archivo EDF local.')
    } finally {
      setOpening(false)
    }
  }

  const handleOpenLastLocal = async () => {
    setError('')
    setOpening(true)
    try {
      const session = await getLastLocalEegSession()
      if (!session) {
        setError('No hay un EDF local reciente guardado en este navegador.')
        return
      }
      navigate(`/open/${session.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reabrir el último EDF local.')
    } finally {
      setOpening(false)
    }
  }

  const openCachedEntry = (entry: CachedEncryptedPackageSummary) => {
    navigate(`/open/cache/${encodeURIComponent(entry.blobHash)}`)
  }

  const deleteCachedEntry = async (entry: CachedEncryptedPackageSummary) => {
    setBusyCacheId(entry.blobHash)
    setCacheError('')
    try {
      await deleteEncryptedPackageFromCache(entry.blobHash)
      await refreshCache()
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : 'No se pudo borrar el EEG cacheado.')
    } finally {
      setBusyCacheId(null)
    }
  }

  const formatBytes = (sizeBytes: number) => {
    if (sizeBytes >= 1024 * 1024 * 1024) return `${(sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
    if (sizeBytes >= 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`
    return `${sizeBytes} B`
  }

  const describeOrigin = (entry: CachedEncryptedPackageSummary) => {
    if (entry.caseId.startsWith('shared:')) return `Shared link · ${entry.caseId.slice('shared:'.length)}`
    if (entry.caseId.startsWith('case:')) return `Caso · ${entry.caseId.slice('case:'.length)}`
    if (entry.caseId.startsWith('gallery:')) return `Galería · ${entry.caseId.slice('gallery:'.length)}`
    return entry.caseId
  }

  return (
    <div className="case-new">
      <PageHeader
        title="Abrir EDF local"
        subtitle="Carga un archivo EDF desde este equipo o reabre EEG cifrados guardados en este navegador."
      />

      <div className="case-form card">
        <div className="anonymization-note" style={{ background: '#f8fafc', borderColor: '#cbd5e1', color: '#334155' }}>
          <strong style={{ color: '#0f172a' }}>Modo local</strong>
          <span>
            El archivo se lee solo en este navegador. No se envía a OCEAN, no se cifra para upload y no se almacena en servidor.
          </span>
        </div>

        <label>
          Archivo EEG (.edf)
          <input
            ref={fileInputRef}
            type="file"
            accept=".edf"
            onChange={handleFileChange}
          />
          <span className="file-hint">
            {selectedFile
              ? `${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(1)} MB)`
              : 'Selecciona un EDF local exportado desde tu sistema habitual.'}
          </span>
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={handleOpenLocal} disabled={opening}>
            {opening ? 'Leyendo EDF…' : 'Abrir localmente'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void handleOpenLastLocal()} disabled={opening}>
            Abrir último EDF
          </button>
        </div>
      </div>

      <div className="case-form card" style={{ marginTop: '1rem' }}>
        <div className="anonymization-note" style={{ background: '#fffdf4', borderColor: '#fde68a', color: '#854d0e' }}>
          <strong style={{ color: '#92400e' }}>EEG guardados en este navegador</strong>
          <span>
            Aquí aparecen los blobs cifrados cacheados localmente tras abrir casos o shared links. Permanecen cifrados y puedes reabrirlos o borrarlos.
          </span>
        </div>

        {cacheError && <div className="auth-error">{cacheError}</div>}

        {loadingCache ? (
          <div className="file-hint">Cargando caché local…</div>
        ) : cachedEntries.length === 0 ? (
          <div className="file-hint">No hay EEG cifrados guardados en este navegador.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {cachedEntries.map((entry) => (
              <div
                key={entry.blobHash}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  padding: '0.85rem 0.95rem',
                  background: '#ffffff',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                  <strong style={{ color: '#0f172a' }}>{entry.label || 'EEG cifrado local'}</strong>
                  <span className="file-hint">{describeOrigin(entry)}</span>
                  <span className="file-hint">
                    {formatBytes(entry.sizeBytes)} · {new Date(entry.savedAt).toLocaleString('es-ES')}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn-primary" onClick={() => openCachedEntry(entry)}>
                    Abrir
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void deleteCachedEntry(entry)}
                    disabled={busyCacheId === entry.blobHash}
                  >
                    {busyCacheId === entry.blobHash ? 'Borrando…' : 'Borrar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
