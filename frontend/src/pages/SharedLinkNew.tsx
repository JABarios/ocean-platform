import { useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { API_BASE, friendlyError } from '../api/client'
import { useCrypto, isCryptoAvailable } from '../hooks/useCrypto'
import PageHeader from '../components/PageHeader'
import { anonymizeEdfFile, type EdfAnonymizationReport, type EdfAnnotationMode } from '../utils/edfAnonymization'
import './Auth.css'
import './CaseNew.css'

interface UploadResponse {
  id: string
  expiresAt: string
  sizeBytes?: number
  label?: string
}

function getSharedViewerOrigin() {
  const configuredOrigin = import.meta.env.VITE_SHARED_LINK_ORIGIN?.trim()
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '')
  }
  return window.location.origin
}

export default function SharedLinkNew() {
  const { encryptFile } = useCrypto()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const isStandaloneShare = location.pathname === '/share'

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
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [annotationReviewConfirmed, setAnnotationReviewConfirmed] = useState(false)
  const [annotationMode, setAnnotationMode] = useState<EdfAnnotationMode>('remove')

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
    setReviewConfirmed(false)
    setAnnotationReviewConfirmed(false)
    try {
      const { anonymizedFile, report } = await anonymizeEdfFile(file, { annotationMode })
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

  const downloadCertificate = () => {
    if (!anonymizationReport) return
    const blob = new Blob([JSON.stringify(anonymizationReport.certificate, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${anonymizationReport.anonymizedFilename.replace(/\.edf$/i, '')}_deid_certificate.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!encryptedBlob || !selectedFile) return
    setSaving(true)
    setError('')
    setCopied(false)

    try {
      const formData = new FormData()
      const uploadedFilename = anonymizationReport?.anonymizedFilename || selectedFile.name
      formData.append('blob', encryptedBlob, `${uploadedFilename}.enc`)
      formData.append('originalFilename', uploadedFilename)
      formData.append('ivBase64', ivBase64)
      if (label.trim()) formData.append('label', label.trim())

      const res = await fetch(`${API_BASE}/shared-links/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Error HTTP ${res.status}`)
      }

      const payload = await res.json() as UploadResponse
      const url = `${getSharedViewerOrigin()}/v/${payload.id}#${encodeURIComponent(decryptionKey)}`
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

  const content = (
    <>
      <PageHeader
        title="Comparte un EEG de forma segura"
        subtitle="OCEAN genera una copia desidentificada en tu navegador, te enseña qué cambia y solo sube esa copia cifrada."
      />
      <form onSubmit={handleCreate} className="case-form card">
        <label>
          Etiqueta del enlace (opcional)
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
          Archivo EEG (.edf / EDF+)
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
                : 'Selecciona un EDF. OCEAN genera una copia desidentificada local, la cifra y no sube el archivo original.'}
          </span>
        </label>

        <label>
          Tratamiento de anotaciones EDF+
          <select
            value={annotationMode}
            onChange={(e) => setAnnotationMode(e.target.value as EdfAnnotationMode)}
          >
            <option value="remove">Quitar todas las anotaciones EDF+</option>
            <option value="clinical">Conservar solo etiquetas clínicas conocidas</option>
            <option value="replace">Sustituir el texto por “ANOTACION ELIMINADA”</option>
          </select>
          <span className="file-hint">
            Las anotaciones pueden contener texto libre con identificadores. Por defecto se eliminan antes del cifrado; el modo clínico conserva solo marcas cortas conocidas como HV, HPV, ELI, EO, EC o photic.
          </span>
        </label>

        {anonymizationReport && (
          <div className="deid-review card">
            <div className="deid-review-header">
              <div>
                <div className="deid-review-kicker">OCEAN Local De-ID</div>
                <strong>Desidentificación local verificable</strong>
              </div>
              <button type="button" className="btn-secondary" onClick={downloadCertificate}>
                Descargar certificado JSON
              </button>
            </div>
            <p className="deid-review-lead">
              El archivo original no se subirá. Solo se subirá la copia desidentificada y cifrada que ves resumida aquí.
            </p>
            <div className="deid-review-meta">
              <span><strong>Original:</strong> {anonymizationReport.originalFilename}</span>
              <span><strong>Copia subida:</strong> {anonymizationReport.anonymizedFilename}</span>
              <span><strong>Formato:</strong> {anonymizationReport.format}</span>
            </div>
            <table className="deid-table">
              <thead>
                <tr>
                  <th>Campo EDF</th>
                  <th>Original</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {anonymizationReport.reviewedFields.map((field) => (
                  <tr key={field.key}>
                    <td>{field.label}</td>
                    <td>{field.originalValue}</td>
                    <td>{field.resultValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="deid-review-annotation-box">
              <strong>Anotaciones EDF+</strong>
              {anonymizationReport.annotationReview.totalAnnotations > 0 ? (
                <>
                  <span>
                    Se han detectado {anonymizationReport.annotationReview.totalAnnotations} anotaciones EDF+.
                    {anonymizationReport.annotationReview.modeApplied === 'remove'
                      ? ' Se han eliminado de la copia subida.'
                      : anonymizationReport.annotationReview.modeApplied === 'clinical'
                        ? ` Se han conservado ${anonymizationReport.annotationReview.preservedCount} etiquetas clínicas conocidas y se han eliminado ${anonymizationReport.annotationReview.removedCount} anotaciones no permitidas.`
                      : anonymizationReport.annotationReview.modeApplied === 'replace'
                        ? ` Se han reescrito con el texto neutro "${anonymizationReport.annotationReview.replacementText}".`
                        : ' Se conservan y requieren revisión manual antes de subir.'}
                  </span>
                  {anonymizationReport.annotationReview.suspiciousCount > 0 && (
                    <div className="deid-review-warning">
                      Posibles identificadores encontrados: {anonymizationReport.annotationReview.suspiciousSamples.join(' · ')}
                    </div>
                  )}
                </>
              ) : (
                <span>No se han detectado anotaciones EDF+ embebidas.</span>
              )}
            </div>
            {anonymizationReport.anonymizedSha256 && (
              <div className="deid-review-hash">
                <strong>SHA-256 de la copia desidentificada:</strong> {anonymizationReport.anonymizedSha256}
              </div>
            )}
            <label className="deid-review-check">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(e) => setReviewConfirmed(e.target.checked)}
              />
              <span>He revisado la copia desidentificada y entiendo que OCEAN no subirá el archivo original.</span>
            </label>
            {anonymizationReport.annotationReview.requiresManualReview && (
              <label className="deid-review-check">
                <input
                  type="checkbox"
                  checked={annotationReviewConfirmed}
                  onChange={(e) => setAnnotationReviewConfirmed(e.target.checked)}
                />
                <span>He revisado las anotaciones EDF+ y no contienen identificadores directos antes de subir esta copia.</span>
              </label>
            )}
          </div>
        )}

        {sharedUrl && (
          <div className="key-box card">
            <div className="key-label">Enlace compartible</div>
            <div className="key-value" style={{ wordBreak: 'break-all' }}>{sharedUrl}</div>
            <p className="key-hint">
              Caduca automáticamente a las 24 horas.
              La persona que reciba el enlace podrá abrir el EEG en el navegador sin iniciar sesión.
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
          <button
            type="submit"
            className="btn-primary"
            disabled={
              !encryptedBlob
              || saving
              || encrypting
              || !reviewConfirmed
              || (!!anonymizationReport?.annotationReview.requiresManualReview && !annotationReviewConfirmed)
            }
          >
            {saving ? 'Creando enlace…' : 'Crear enlace seguro'}
          </button>
        </div>
      </form>
    </>
  )

  if (isStandaloneShare) {
    return (
      <div className="auth-page">
        <div className="auth-card card" style={{ maxWidth: '860px' }}>
          <div style={{ marginBottom: '1.2rem' }}>
            <h1 style={{ marginBottom: '0.3rem' }}>Compartir un EEG</h1>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              <Link to="/login" className="public-share-platform-link">Plataforma clínica OCEAN</Link>
            </p>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return <div className="case-new">{content}</div>
}
