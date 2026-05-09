import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, API_BASE, friendlyError } from '../api/client'
import { useCrypto, isCryptoAvailable } from '../hooks/useCrypto'
import PageHeader from '../components/PageHeader'
import { anonymizeEdfFile, type EdfAnonymizationReport, type EdfAnnotationMode } from '../utils/edfAnonymization'
import type { Gallery, GalleryRecord } from '../types'
import './Auth.css'
import './CaseNew.css'

interface UploadResponse {
  id: string
  expiresAt: string
  sizeBytes?: number
  label?: string
  encryptionMode?: string
}

function getSharedViewerOrigin() {
  const configuredOrigin = import.meta.env.VITE_SHARED_LINK_ORIGIN?.trim()
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '')
  }
  return window.location.origin
}

function getAppOrigin() {
  const configuredOrigin = import.meta.env.VITE_APP_ORIGIN?.trim()
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '')
  }
  return `${window.location.protocol}//app.ocean-eeg.org`
}

function getWebsiteOrigin() {
  const configuredOrigin = import.meta.env.VITE_PUBLIC_SITE_ORIGIN?.trim()
  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, '')
  }
  return `${window.location.protocol}//ocean-eeg.org`
}

export default function SharedLinkNew() {
  const { encryptFile } = useCrypto()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const isStandaloneShare = location.pathname === '/share'
  const isInternalShare = !isStandaloneShare
  const [sourceMode, setSourceMode] = useState<'upload' | 'gallery'>(isStandaloneShare ? 'upload' : 'upload')

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
  const [createdSuccessfully, setCreatedSuccessfully] = useState(false)
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [annotationReviewConfirmed, setAnnotationReviewConfirmed] = useState(false)
  const [annotationMode, setAnnotationMode] = useState<EdfAnnotationMode>('remove')
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [selectedGalleryId, setSelectedGalleryId] = useState('')
  const [galleryRecords, setGalleryRecords] = useState<GalleryRecord[]>([])
  const [selectedGalleryRecordId, setSelectedGalleryRecordId] = useState('')
  const [loadingGalleries, setLoadingGalleries] = useState(false)
  const [loadingGalleryRecords, setLoadingGalleryRecords] = useState(false)

  const prettyExpiry = useMemo(() => {
    if (!expiresAt) return ''
    try {
      return new Date(expiresAt).toLocaleString('es-ES')
    } catch {
      return expiresAt
    }
  }, [expiresAt])

  useEffect(() => {
    if (!isInternalShare || sourceMode !== 'gallery' || galleries.length > 0) return
    setLoadingGalleries(true)
    api.get<Gallery[]>('/galleries')
      .then(setGalleries)
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoadingGalleries(false))
  }, [isInternalShare, sourceMode, galleries.length])

  useEffect(() => {
    if (!isInternalShare || sourceMode !== 'gallery' || !selectedGalleryId) {
      setGalleryRecords([])
      setSelectedGalleryRecordId('')
      return
    }
    setLoadingGalleryRecords(true)
    api.get<Gallery>(`/galleries/${selectedGalleryId}`)
      .then((gallery) => {
        setGalleryRecords(gallery.records || [])
        setSelectedGalleryRecordId('')
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoadingGalleryRecords(false))
  }, [isInternalShare, sourceMode, selectedGalleryId])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setEncrypting(true)
    setError('')
    setSharedUrl('')
    setExpiresAt('')
    setCreatedSuccessfully(false)
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
    if (sourceMode === 'upload' && (!encryptedBlob || !selectedFile)) return
    if (sourceMode === 'gallery' && !selectedGalleryRecordId) return
    setSaving(true)
    setError('')
    setCopied(false)
    setCreatedSuccessfully(false)

    try {
      let payload: UploadResponse
      let finalUrl = ''

      if (sourceMode === 'gallery') {
        payload = await api.post<UploadResponse>('/shared-links/from-gallery', {
          galleryRecordId: selectedGalleryRecordId,
          label: label.trim() || undefined,
        })
        finalUrl = `${getSharedViewerOrigin()}/v/${payload.id}`
      } else {
        const safeSelectedFile = selectedFile as File
        const safeEncryptedBlob = encryptedBlob as Blob
        const formData = new FormData()
        const uploadedFilename = anonymizationReport?.anonymizedFilename || safeSelectedFile.name
        formData.append('blob', safeEncryptedBlob, `${uploadedFilename}.enc`)
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

        payload = await res.json() as UploadResponse
        finalUrl = `${getSharedViewerOrigin()}/v/${payload.id}#${encodeURIComponent(decryptionKey)}`
        sessionStorage.setItem(`ocean_eeg_key_shared_${payload.id}`, decryptionKey)
      }

      setSharedUrl(finalUrl)
      setExpiresAt(payload.expiresAt)
      setCreatedSuccessfully(true)
    } catch (err) {
      setError(friendlyError(err))
      setCreatedSuccessfully(false)
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
        {isInternalShare && (
          <section className="source-selector">
            <div className="field-label">Origen del EEG</div>
            <div className="source-selector-row">
              <button
                type="button"
                className={sourceMode === 'upload' ? 'source-chip active' : 'source-chip'}
                onClick={() => {
                  setSourceMode('upload')
                  setSelectedGalleryId('')
                  setSelectedGalleryRecordId('')
                  setGalleryRecords([])
                }}
              >
                Subir desde mi ordenador
              </button>
              <button
                type="button"
                className={sourceMode === 'gallery' ? 'source-chip active' : 'source-chip'}
                onClick={() => {
                  setSourceMode('gallery')
                  setSelectedFile(null)
                  setEncryptedBlob(null)
                  setDecryptionKey('')
                  setIvBase64('')
                  setAnonymizationReport(null)
                  setReviewConfirmed(false)
                  setAnnotationReviewConfirmed(false)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                Elegir EEG desde una galería
              </button>
            </div>
          </section>
        )}

        <label>
          Etiqueta del enlace (opcional)
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej. PSG dudosa para segunda opinión"
          />
        </label>

        {sourceMode === 'upload' && (
          <div className={isCryptoAvailable() ? 'crypto-badge crypto-native' : 'crypto-badge crypto-fallback'}>
            {isCryptoAvailable()
              ? '🔒 Cifrado nativo del navegador (Web Crypto API)'
              : '⚠️ Cifrado de compatibilidad (node-forge) — para máxima seguridad usa HTTPS'}
          </div>
        )}

        {sourceMode === 'upload' ? (
          <>
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
          </>
        ) : (
          <div className="gallery-picker card">
            <div className="gallery-picker-copy">
              <strong>Compartir un EEG ya disponible en OCEAN</strong>
              <span>Este enlace reutilizará un EEG de galería y no te pedirá volver a subirlo desde tu ordenador.</span>
            </div>
            <label htmlFor="shared-gallery-select">
              Galería
              <select
                id="shared-gallery-select"
                value={selectedGalleryId}
                onChange={(e) => setSelectedGalleryId(e.target.value)}
                required={sourceMode === 'gallery'}
              >
                <option value="">Selecciona una galería…</option>
                {galleries.map((gallery) => (
                  <option key={gallery.id} value={gallery.id}>
                    {gallery.title} ({gallery.recordCount} EEGs)
                  </option>
                ))}
              </select>
              <span className="file-hint">
                {loadingGalleries ? 'Cargando galerías…' : 'Elige primero la colección de origen.'}
              </span>
            </label>

            <label htmlFor="shared-gallery-record-select">
              EEG de la galería
              <select
                id="shared-gallery-record-select"
                value={selectedGalleryRecordId}
                onChange={(e) => setSelectedGalleryRecordId(e.target.value)}
                required={sourceMode === 'gallery'}
                disabled={!selectedGalleryId || loadingGalleryRecords}
              >
                <option value="">Selecciona un registro…</option>
                {galleryRecords.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.label}
                    {record.metadata?.originalFilename ? ` · ${record.metadata.originalFilename}` : ''}
                  </option>
                ))}
              </select>
              <span className="file-hint">
                {loadingGalleryRecords
                  ? 'Cargando EEGs de la galería…'
                  : selectedGalleryId
                    ? 'Se generará un enlace efímero al EEG ya almacenado en OCEAN.'
                    : 'Primero selecciona una galería.'}
              </span>
            </label>
          </div>
        )}

        {sourceMode === 'upload' && anonymizationReport && (
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
              saving
              || createdSuccessfully
              || (sourceMode === 'upload' && (!encryptedBlob || encrypting || !reviewConfirmed || (!!anonymizationReport?.annotationReview.requiresManualReview && !annotationReviewConfirmed)))
              || (sourceMode === 'gallery' && !selectedGalleryRecordId)
            }
          >
            {saving ? 'Creando enlace…' : createdSuccessfully ? 'Enlace seguro creado' : 'Crear enlace seguro'}
          </button>
        </div>
      </form>
    </>
  )

  if (isStandaloneShare) {
    return (
      <div className="auth-page">
        <div className="auth-card card" style={{ maxWidth: '860px' }}>
          <div className="public-share-header">
            <p className="subtitle public-share-branding">
              Open Clinical EEG Archive Network (OCEAN)
            </p>
            <div className="public-share-actions">
              <div className="public-share-links">
                <a href={getAppOrigin()} className="public-share-button">
                  Entrar en OCEAN
                </a>
                <a href={getWebsiteOrigin()} className="public-share-button public-share-button-secondary">
                  Web de OCEAN
                </a>
              </div>
            </div>
          </div>
          <div style={{ marginBottom: '1.2rem' }}>
            <a href={getAppOrigin()} className="public-share-mobile-link">Entrar en OCEAN</a>
            <a href={getWebsiteOrigin()} className="public-share-mobile-link">Web de OCEAN</a>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return <div className="case-new">{content}</div>
}
