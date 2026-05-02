import { useMemo, useRef, useState } from 'react'
import { API_BASE, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useCrypto, isCryptoAvailable } from '../hooks/useCrypto'
import PageHeader from '../components/PageHeader'
import { anonymizeEdfFile, type EdfAnonymizationReport } from '../utils/edfAnonymization'
import './CaseNew.css'

interface UploadResponse {
  id: string
  expiresAt: string
  sizeBytes?: number
  label?: string
}

export default function SharedLinkNew() {
  const token = useAuthStore((s) => s.token)
  const { encryptFile } = useCrypto()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [label, setLabel] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [anonymizationReport, setAnonymizationReport] = useState<EdfAnonymizationReport | null>(null)
  const [encryptedBlob, setEncryptedBlob] = useState<Blob | null>(null)
  const [decryptionKey, setDecryptionKey] = useState('')
  const [ivBase64, setIvBase64] = useState('')
  const [saving, setSaving] = useState(false)
  const [encrypting, setEncrypting] = useState(false)
  const [error, setError] = useState('')
  const [sharedUrl, setSharedUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [copied, setCopied] = useState(false)

  const prettyExpiry = useMemo(() => {
    if (!expiresAt) return ''
    try {
      return new Date(expiresAt).toLocaleString('es-ES')
    } catch {
      return expiresAt
    }
  }, [expiresAt])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setEncrypting(true)
    setError('')
    setSharedUrl('')
    setExpiresAt('')
    try {
      const { anonymizedFile, report } = await anonymizeEdfFile(file)
      const result = await encryptFile(anonymizedFile)
      setEncryptedBlob(result.encryptedWithIv)
      setDecryptionKey(result.keyBase64)
      setIvBase64(result.ivBase64)
      setAnonymizationReport(report)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al anonimizar o cifrar el EDF')
      setSelectedFile(null)
      setEncryptedBlob(null)
      setDecryptionKey('')
      setIvBase64('')
      setAnonymizationReport(null)
    } finally {
      setEncrypting(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!encryptedBlob || !selectedFile) return
    setSaving(true)
    setError('')
    setCopied(false)

    try {
      const formData = new FormData()
      formData.append('blob', encryptedBlob, `${selectedFile.name}.enc`)
      formData.append('originalFilename', selectedFile.name)
      formData.append('ivBase64', ivBase64)
      if (label.trim()) formData.append('label', label.trim())

      const res = await fetch(`${API_BASE}/shared-links/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token || ''}`,
        },
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Error HTTP ${res.status}`)
      }

      const payload = await res.json() as UploadResponse
      const url = `${window.location.origin}/v/${payload.id}#${encodeURIComponent(decryptionKey)}`
      sessionStorage.setItem(`ocean_eeg_key_shared_${payload.id}`, decryptionKey)
      setSharedUrl(url)
      setExpiresAt(payload.expiresAt)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const copyLink = async () => {
    if (!sharedUrl) return
    try {
      await navigator.clipboard.writeText(sharedUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="case-new">
      <PageHeader
        title="Shared Link"
        subtitle="Genera un enlace efímero cifrado para interconsulta rápida. El EDF se anonimiza y cifra antes de salir del navegador."
      />
      <form onSubmit={handleCreate} className="case-form card">
        <label>
          Etiqueta del enlace
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej. PSG dudosa para segunda opinión"
          />
        </label>

        <div className={isCryptoAvailable() ? 'crypto-badge crypto-native' : 'crypto-badge crypto-fallback'}>
          {isCryptoAvailable()
            ? '🔒 Cifrado nativo del navegador (Web Crypto API)'
            : '⚠️ Cifrado de compatibilidad (node-forge) — para máxima seguridad usa HTTPS'}
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
              : encrypting
                ? 'Cifrando…'
                : 'Selecciona un EDF. OCEAN anonimiza cabecera y cifra el archivo antes de subirlo.'}
          </span>
        </label>

        {anonymizationReport && (
          <div className="anonymization-note">
            <strong>Anonimización EDF aplicada</strong>
            <span>
              Formato {anonymizationReport.format} · paciente, identificación de registro, fecha y hora de inicio
              reescritos antes del cifrado.
            </span>
          </div>
        )}

        {sharedUrl && (
          <div className="key-box card">
            <div className="key-label">Enlace compartible</div>
            <div className="key-value" style={{ wordBreak: 'break-all' }}>{sharedUrl}</div>
            <p className="key-hint">
              Caduca automáticamente a las 24 horas.
              {prettyExpiry ? ` Expira: ${prettyExpiry}.` : ''}
            </p>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={copyLink}>
                {copied ? 'Copiado' : 'Copiar enlace'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="form-actions">
          <button type="submit" className="btn-primary" disabled={!encryptedBlob || saving || encrypting}>
            {saving ? 'Creando enlace…' : 'Crear shared link'}
          </button>
        </div>
      </form>
    </div>
  )
}
