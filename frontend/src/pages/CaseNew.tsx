import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, API_BASE, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useCrypto, isCryptoAvailable } from '../hooks/useCrypto'
import type { CaseItem, Gallery, GalleryRecord } from '../types'
import PageHeader from '../components/PageHeader'
import { anonymizeEdfFile, type EdfAnonymizationReport, type EdfAnnotationMode } from '../utils/edfAnonymization'
import './CaseNew.css'

export default function CaseNew() {
  const [searchParams] = useSearchParams()
  const initialGalleryId = searchParams.get('galleryId') || ''
  const initialGalleryRecordId = searchParams.get('recordId') || ''
  const initialSourceMode =
    searchParams.get('source') === 'gallery' || !!initialGalleryId || !!initialGalleryRecordId
      ? 'gallery'
      : 'upload'

  const [sourceMode, setSourceMode] = useState<'upload' | 'gallery'>(initialSourceMode)
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
  const [anonymizationReport, setAnonymizationReport] = useState<EdfAnonymizationReport | null>(null)
  const [reviewConfirmed, setReviewConfirmed] = useState(false)
  const [annotationReviewConfirmed, setAnnotationReviewConfirmed] = useState(false)
  const [annotationMode, setAnnotationMode] = useState<EdfAnnotationMode>('remove')
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [selectedGalleryId, setSelectedGalleryId] = useState(initialGalleryId)
  const [galleryRecords, setGalleryRecords] = useState<GalleryRecord[]>([])
  const [selectedGalleryRecordId, setSelectedGalleryRecordId] = useState(initialGalleryRecordId)
  const [loadingGalleries, setLoadingGalleries] = useState(false)
  const [loadingGalleryRecords, setLoadingGalleryRecords] = useState(false)
  const [pendingGalleryRecordId, setPendingGalleryRecordId] = useState(initialGalleryRecordId)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const token = useAuthStore((s) => s.token)
  const { encryptFile } = useCrypto()
  const navigate = useNavigate()

  const ageOptions = ['Neonato', 'Lactante', 'Niño', 'Adolescente', 'Adulto', '>65']
  const modalityOptions = ['EEG', 'V-EEG', 'cEEG']

  useEffect(() => {
    if (sourceMode !== 'gallery' || galleries.length > 0) return
    setLoadingGalleries(true)
    api.get<Gallery[]>('/galleries')
      .then(setGalleries)
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoadingGalleries(false))
  }, [sourceMode, galleries.length])

  useEffect(() => {
    if (sourceMode !== 'gallery' || !selectedGalleryId) {
      setGalleryRecords([])
      setSelectedGalleryRecordId('')
      return
    }
    setLoadingGalleryRecords(true)
    api.get<Gallery>(`/galleries/${selectedGalleryId}`)
      .then((gallery) => {
        const records = gallery.records || []
        setGalleryRecords(records)
        if (pendingGalleryRecordId && records.some((record) => record.id === pendingGalleryRecordId)) {
          setSelectedGalleryRecordId(pendingGalleryRecordId)
          setPendingGalleryRecordId('')
        } else if (!selectedGalleryRecordId || !records.some((record) => record.id === selectedGalleryRecordId)) {
          setSelectedGalleryRecordId('')
        }
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoadingGalleryRecords(false))
  }, [sourceMode, selectedGalleryId, pendingGalleryRecordId, selectedGalleryRecordId])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setEncrypting(true)
    setError('')
    setReviewConfirmed(false)
    setAnnotationReviewConfirmed(false)
    try {
      const { anonymizedFile, report } = await anonymizeEdfFile(file, { annotationMode })
      const result = await encryptFile(anonymizedFile)
      setEncryptedBlob(result.encryptedWithIv)
      setDecryptionKey(result.keyBase64)
      setAnonymizationReport(report)
    } catch {
      setError('Error al anonimizar o cifrar el archivo EDF')
      setSelectedFile(null)
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (sourceMode === 'upload' && !encryptedBlob) {
      setError('Selecciona un archivo EEG para crear el caso.')
      return
    }

    if (sourceMode === 'gallery' && !selectedGalleryRecordId) {
      setError('Selecciona un EEG de la galería antes de crear el caso.')
      return
    }

    setSaving(true)
    try {
      // 1. Crear caso
      const created = await api.post<CaseItem>('/cases', {
        title,
        clinicalContext,
        ageRange,
        studyReason,
        modality,
        galleryRecordId: sourceMode === 'gallery' ? selectedGalleryRecordId : undefined,
      })

      // 2. Subir blob cifrado si existe
      if (sourceMode === 'upload' && encryptedBlob) {
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
      <PageHeader
        title="Nuevo caso"
        subtitle="Desidentificación local verificable antes del cifrado: revisa la copia que se subirá y deja trazabilidad del proceso."
      />
      <form onSubmit={handleSubmit} className="case-form card">
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
                  : 'Selecciona un archivo .edf. OCEAN genera una copia desidentificada local y solo esa copia se cifra y se sube.'}
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
              <strong>Reutilizar un EEG de galería</strong>
              <span>Este caso enlazará un EEG ya disponible en OCEAN, sin volver a subirlo desde tu ordenador.</span>
            </div>
            <label htmlFor="gallery-select">
              Galería
              <select
                id="gallery-select"
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
            <label htmlFor="gallery-record-select">
              EEG de la galería
              <select
                id="gallery-record-select"
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
                  ? 'Ese EEG quedará enlazado al nuevo caso tal como está almacenado en OCEAN.'
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
              El archivo original no se subirá al caso. Solo se cifrará y subirá la copia desidentificada resumida aquí.
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

        {sourceMode === 'upload' && decryptionKey && (
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

        {error && <div className="auth-error">{error}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => navigate('/')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={
              saving
              || encrypting
              || (sourceMode === 'upload' && !encryptedBlob)
              || (sourceMode === 'upload' && (!!anonymizationReport && !reviewConfirmed))
              || (sourceMode === 'upload' && (!!anonymizationReport?.annotationReview.requiresManualReview && !annotationReviewConfirmed))
              || (sourceMode === 'gallery' && !selectedGalleryRecordId)
            }
          >
            {saving ? 'Guardando…' : 'Crear caso'}
          </button>
        </div>
      </form>

    </div>
  )
}
