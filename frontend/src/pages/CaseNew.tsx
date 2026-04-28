import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, API_BASE, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useCrypto, isCryptoAvailable } from '../hooks/useCrypto'
import type { CaseItem } from '../types'

export default function CaseNew() {
  const [title, setTitle] = useState('')
  const [clinicalContext, setClinicalContext] = useState('')
  const [ageRange, setAgeRange] = useState('')
  const [studyReason, setStudyReason] = useState('')
  const [modality, setModality] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [encrypting, setEncrypting] = useState(false)
  const [encryptedBlob, setEncryptedBlob] = useState<Blob | null>(null)
  const [decryptionKey, setDecryptionKey] = useState('')
  const [storedKeyInOcean, setStoredKeyInOcean] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const token = useAuthStore((s) => s.token)
  const { encryptFile } = useCrypto()
  const navigate = useNavigate()

  const ageOptions = ['Neonato', 'Lactante', 'Niño', 'Adolescente', 'Adulto', '>65']
  const modalityOptions = ['EEG', 'V-EEG', 'cEEG']

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setEncrypting(true)
    setError('')
    try {
      const result = await encryptFile(file)
      setEncryptedBlob(result.encryptedWithIv)
      setDecryptionKey(result.keyBase64)
    } catch {
      setError('Error al cifrar el archivo')
      setSelectedFile(null)
    } finally {
      setEncrypting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // 1. Crear caso
      const created = await api.post<CaseItem>('/cases', {
        title,
        clinicalContext,
        ageRange,
        studyReason,
        modality,
      })

      // 2. Subir blob cifrado si existe
      if (encryptedBlob) {
        const formData = new FormData()
        formData.append('caseId', created.id)
        formData.append('blob', encryptedBlob, `${created.id}.enc`)
        formData.append('retentionPolicy', 'Temporal72h')

        const uploadRes = await fetch(`${API_BASE}/packages/upload`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token || ''}`,
          },
          body: formData,
        })
        if (!uploadRes.ok) {
          const errText = await uploadRes.text()
          throw new Error(`Error al subir el paquete: ${errText || uploadRes.status}`)
        }
        const uploadPayload = await uploadRes.json() as { reusedExisting?: boolean }
        if (uploadPayload.reusedExisting) {
          alert('Este EEG ya existía en OCEAN y se ha reutilizado en vez de subir una copia nueva.')
        }

        if (decryptionKey) {
          try {
            const custodyRes = await api.post<{ stored: boolean }>(`/packages/secret/${created.id}`, {
              keyBase64: decryptionKey,
            })
            setStoredKeyInOcean(!!custodyRes.stored)
          } catch (err) {
            console.warn('[OCEAN] No se pudo custodiar la clave del EEG', err)
            alert('Caso creado, pero no se pudo guardar la clave en OCEAN. Guárdala manualmente antes de salir.')
          }

          // Guardar clave en sessionStorage para que el creador pueda ver el EEG sin pegarla
          sessionStorage.setItem(`ocean_eeg_key_${created.id}`, decryptionKey)
        }
      }

      navigate(`/cases/${created.id}`)
    } catch (err) {
      setError(friendlyError(err))
      setSaving(false)
    }
  }

  return (
    <div className="case-new">
      <h2>Nuevo caso</h2>
      <form onSubmit={handleSubmit} className="case-form card">
        <label>
          Título
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <label>
          Contexto clínico
          <textarea
            rows={4}
            value={clinicalContext}
            onChange={(e) => setClinicalContext(e.target.value)}
            required
          />
        </label>

        <label>
          Rango de edad
          <select
            value={ageRange}
            onChange={(e) => setAgeRange(e.target.value)}
            required
          >
            <option value="">Selecciona…</option>
            {ageOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>

        <label>
          Motivo del estudio
          <textarea
            rows={3}
            value={studyReason}
            onChange={(e) => setStudyReason(e.target.value)}
            required
          />
        </label>

        <label>
          Modalidad
          <select
            value={modality}
            onChange={(e) => setModality(e.target.value)}
            required
          >
            <option value="">Selecciona…</option>
            {modalityOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
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
              : 'Selecciona un archivo .edf (se cifra localmente en tu navegador)'}
          </span>
        </label>

        {decryptionKey && (
          <div className="key-box card">
            <div className="key-label">Clave de descifrado</div>
            <div className="key-value">{decryptionKey}</div>
            <p className="key-hint">
              Guarda esta clave si vas a compartir el acceso fuera de OCEAN.
              <strong> Los usuarios invitados podrán recuperarla con su contraseña de OCEAN.</strong>
            </p>
            {storedKeyInOcean && (
              <p className="key-hint">
                Clave custodiada en OCEAN: el propietario y revisores invitados podrán usarla sin verla en pantalla.
              </p>
            )}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/')}
          >
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Crear caso'}
          </button>
        </div>
      </form>

      <style>{`
        .case-new {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .case-new h2 {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .case-form {
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
          max-width: 700px;
        }
        .case-form label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .error {
          color: var(--danger);
          font-size: 0.85rem;
        }
        .file-hint {
          font-size: 0.8rem;
          color: var(--text-secondary);
          font-weight: 400;
        }
        .key-box {
          background: #f0fdf4;
          border: 1px solid #86efac;
          padding: 0.75rem 1rem;
        }
        .key-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: #15803d;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .key-value {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8rem;
          word-break: break-all;
          color: #14532d;
          margin-top: 0.25rem;
        }
        .key-hint {
          font-size: 0.8rem;
          color: #166534;
          margin-top: 0.35rem;
        }
        .form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.5rem;
          margin-top: 0.5rem;
        }
        .crypto-badge {
          font-size: 0.8rem;
          padding: 0.4rem 0.75rem;
          border-radius: 6px;
          font-weight: 500;
        }
        .crypto-native {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #86efac;
        }
        .crypto-fallback {
          background: #fffbeb;
          color: #92400e;
          border: 1px solid #fcd34d;
        }
      `}</style>
    </div>
  )
}
