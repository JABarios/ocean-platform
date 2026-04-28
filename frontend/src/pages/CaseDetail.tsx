import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import type { CaseItem, Comment, User } from '../types'
import './CaseDetail.css'

function statusBadgeClass(status: CaseItem['status']) {
  switch (status) {
    case 'Draft':
      return 'badge badge-draft'
    case 'Requested':
      return 'badge badge-requested'
    case 'InReview':
      return 'badge badge-inreview'
    case 'Resolved':
      return 'badge badge-resolved'
    case 'Archived':
      return 'badge badge-archived'
    default:
      return 'badge'
  }
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  const [caseItem, setCaseItem] = useState<CaseItem | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  const [targetUserId, setTargetUserId] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [requesting, setRequesting] = useState(false)

  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [summary, setSummary] = useState('')
  const [keyFindings, setKeyFindings] = useState('')
  const [learningPoints, setLearningPoints] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [proposing, setProposing] = useState(false)

  const [statusBusy, setStatusBusy] = useState(false)

  const [decryptKey, setDecryptKey] = useState('')
  const [storedDecryptKey, setStoredDecryptKey] = useState('')
  const [revealedStoredKey, setRevealedStoredKey] = useState('')
  const [decrypting, setDecrypting] = useState(false)
  const [decryptedUrl, setDecryptedUrl] = useState('')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [recoveringKey, setRecoveringKey] = useState(false)
  const [passwordAction, setPasswordAction] = useState<'use' | 'reveal'>('use')

  const { decryptFile } = useCrypto()

  useEffect(() => {
    return () => {
      if (decryptedUrl) URL.revokeObjectURL(decryptedUrl)
    }
  }, [decryptedUrl])

  useEffect(() => {
    if (!id) return
    const fetchAll = async () => {
      try {
        const [c, com, u] = await Promise.all([
          api.get<CaseItem>(`/cases/${id}`),
          api.get<Comment[]>(`/comments/case/${id}`),
          api.get<User[]>('/users'),
        ])
        setCaseItem(c)
        setComments(com)
        setUsers(u)
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : 'Error al cargar el caso')
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [id])

  useEffect(() => {
    if (!id) return
    const saved = sessionStorage.getItem(`ocean_eeg_key_${id}`)
    if (saved) {
      setStoredDecryptKey(saved)
      setDecryptKey('')
    }
  }, [id])

  const isOwner = caseItem ? caseItem.ownerId === user?.id : false

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !targetUserId) return
    setRequesting(true)
    try {
      await api.post('/requests', {
        caseId: id,
        targetUserId,
        message: requestMessage,
      })
      setTargetUserId('')
      setRequestMessage('')
      alert('Solicitud enviada')
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setRequesting(false)
    }
  }

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !commentText.trim()) return
    setSendingComment(true)
    try {
      const newComment = await api.post<Comment>(`/comments/case/${id}`, {
        body: commentText,
      })
      setComments((prev) => [...prev, newComment])
      setCommentText('')
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setSendingComment(false)
    }
  }

  const submitTeaching = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setProposing(true)
    try {
      await api.post('/teaching/proposals', {
        caseId: id,
        summary,
        keyFindings,
        learningPoints,
        difficulty,
        tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean),
      })
      setShowModal(false)
      setSummary('')
      setKeyFindings('')
      setLearningPoints('')
      setDifficulty('')
      setTagsText('')
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setProposing(false)
    }
  }

  const changeStatus = async (newStatus: string) => {
    if (!id) return
    setStatusBusy(true)
    try {
      const updated = await api.patch<CaseItem>(`/cases/${id}/status`, { statusClinical: newStatus })
      setCaseItem(updated)
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setStatusBusy(false)
    }
  }

  const downloadEncrypted = async () => {
    if (!id) return
    const base = import.meta.env.VITE_API_URL || 'http://localhost:4000'
    const response = await fetch(`${base}/packages/download/${id}`, {
      headers: { Authorization: `Bearer ${token || ''}` },
    })
    if (!response.ok) {
      alert('Error al descargar el paquete')
      return
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}.enc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDecrypt = async () => {
    const effectiveKey = decryptKey.trim() || storedDecryptKey
    if (!id || !effectiveKey) return
    setDecrypting(true)
    try {
      sessionStorage.setItem(`ocean_eeg_key_${id}`, effectiveKey)
      const base = import.meta.env.VITE_API_URL || 'http://localhost:4000'
      const response = await fetch(`${base}/packages/download/${id}`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      })
      if (!response.ok) throw new Error('Error al descargar')

      const encryptedBuffer = await response.arrayBuffer()
      const decryptedBuffer = await decryptFile(encryptedBuffer, effectiveKey)

      const blob = new Blob([decryptedBuffer], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      setDecryptedUrl(url)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'OperationError') {
        alert('Clave incorrecta — el archivo no se pudo descifrar.')
      } else {
        alert('Error al descifrar: ' + (err instanceof Error ? err.message : 'Error desconocido'))
      }
    } finally {
      setDecrypting(false)
    }
  }

  const recoverStoredKey = async () => {
    if (!id || !passwordConfirm.trim()) return
    setRecoveringKey(true)
    try {
      const res = await api.post<{ keyBase64: string }>(`/packages/secret/${id}/recover`, {
        password: passwordConfirm,
      })
      setStoredDecryptKey(res.keyBase64)
      sessionStorage.setItem(`ocean_eeg_key_${id}`, res.keyBase64)
      if (passwordAction === 'reveal') {
        setRevealedStoredKey(res.keyBase64)
      }
      setPasswordConfirm('')
      setShowPasswordModal(false)
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setRecoveringKey(false)
    }
  }

  const copyRevealedKey = async () => {
    if (!revealedStoredKey) return
    try {
      await navigator.clipboard.writeText(revealedStoredKey)
      alert('Clave copiada al portapapeles')
    } catch {
      alert('No se pudo copiar automáticamente. Puedes seleccionarla manualmente.')
    }
  }

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>
        Cargando…
      </div>
    )
  }

  if (fetchError) {
    return <div className="card" style={{ color: 'var(--error, #e53e3e)' }}>{fetchError}</div>
  }

  if (!caseItem) {
    return <div className="card">Caso no encontrado.</div>
  }

  const canPropose =
    isOwner && (caseItem.status === 'Resolved' || caseItem.status === 'Archived')

  return (
    <div className="case-detail">
      <div className="case-header">
        <h2>{caseItem.title}</h2>
        <span className={statusBadgeClass(caseItem.status)}>{caseItem.status}</span>
      </div>

      <div className="case-fields card">
        <div className="field">
          <span className="field-label">Contexto clínico</span>
          <p>{caseItem.clinicalContext}</p>
        </div>
        <div className="field-row">
          <div className="field">
            <span className="field-label">Rango de edad</span>
            <p>{caseItem.ageRange}</p>
          </div>
          <div className="field">
            <span className="field-label">Modalidad</span>
            <p>{caseItem.modality}</p>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Motivo del estudio</span>
          <p>{caseItem.studyReason}</p>
        </div>
        <div className="field">
          <span className="field-label">Fecha</span>
          <p>{new Date(caseItem.createdAt).toLocaleString()}</p>
        </div>

        {isOwner && (
          <div className="status-actions">
            {caseItem.status === 'Draft' && (
              <button
                className="btn-primary"
                onClick={() => changeStatus('Requested')}
                disabled={statusBusy}
              >
                Enviar solicitud
              </button>
            )}
            {caseItem.status === 'Requested' && (
              <button
                className="btn-primary"
                onClick={() => changeStatus('InReview')}
                disabled={statusBusy}
              >
                Iniciar revisión
              </button>
            )}
            {caseItem.status === 'InReview' && (
              <button
                className="btn-primary"
                onClick={() => changeStatus('Resolved')}
                disabled={statusBusy}
              >
                Marcar como Resuelto
              </button>
            )}
            {caseItem.status === 'Resolved' && (
              <button
                className="btn-secondary"
                onClick={() => changeStatus('Archived')}
                disabled={statusBusy}
              >
                Archivar
              </button>
            )}
          </div>
        )}
      </div>

      {canPropose && (
        <div className="teaching-action">
          <button className="btn-secondary" onClick={() => setShowModal(true)}>
            Proponer para docencia
          </button>
        </div>
      )}

      <section className="section card">
        <h3>Solicitar revisión</h3>
        <form onSubmit={sendRequest} className="inline-form">
          <select
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            required
          >
            <option value="">Selecciona usuario…</option>
            {users
              .filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
          </select>
          <input
            type="text"
            placeholder="Mensaje opcional"
            value={requestMessage}
            onChange={(e) => setRequestMessage(e.target.value)}
          />
          <button className="btn-primary" disabled={requesting}>
            {requesting ? 'Enviando…' : 'Solicitar'}
          </button>
        </form>
      </section>

      {caseItem.package && (
        <section className="section card">
          <h3>Paquete EEG</h3>
          <div className="package-meta">
            <span>Tamaño: {(caseItem.package.sizeBytes! / 1024 / 1024).toFixed(1)} MB</span>
            <span>Hash: {caseItem.package.blobHash?.slice(0, 16)}…</span>
          </div>
          <div className="package-actions">
            <button className="btn-secondary" onClick={downloadEncrypted}>
              Descargar .enc (cifrado)
            </button>
            <button
              className="btn-primary"
              onClick={() => window.open(`/cases/${id}/eeg`, '_blank')}
            >
              Ver EEG
            </button>
          </div>
          <div className="decrypt-box">
            <input
              type="text"
              placeholder="Pega la clave de descifrado…"
              value={decryptKey}
              onChange={(e) => {
                setDecryptKey(e.target.value)
                if (e.target.value) setStoredDecryptKey('')
              }}
            />
            <button
              className="btn-primary"
              onClick={handleDecrypt}
              disabled={decrypting || (!decryptKey.trim() && !storedDecryptKey)}
            >
              {decrypting ? 'Descifrando…' : 'Descifrar y descargar .edf'}
            </button>
            {caseItem.storedKeyAvailable && (
              <>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => {
                    setPasswordAction('use')
                    setShowPasswordModal(true)
                  }}
                >
                  Usar clave guardada en OCEAN
                </button>
                {isOwner && (
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => {
                      setPasswordAction('reveal')
                      setShowPasswordModal(true)
                    }}
                  >
                    Mostrar clave
                  </button>
                )}
              </>
            )}
          </div>
          {storedDecryptKey && (
            <div className="stored-key-banner">Clave recuperada desde OCEAN y lista para usar en este caso.</div>
          )}
          {revealedStoredKey && isOwner && (
            <div className="revealed-key-box">
              <div className="revealed-key-header">
                <strong>Clave custodiada revelada</strong>
                <button type="button" className="btn-secondary" onClick={copyRevealedKey}>
                  Copiar clave
                </button>
              </div>
              <div className="revealed-key-value">{revealedStoredKey}</div>
              <div className="revealed-key-hint">Compártela solo si necesitas dar acceso manual fuera del flujo confiado de OCEAN.</div>
            </div>
          )}
          {decryptedUrl && (
            <a
              className="btn-primary"
              href={decryptedUrl}
              download={`${caseItem.title || 'caso'}.edf`}
            >
              Guardar .edf descifrado
            </a>
          )}
        </section>
      )}

      <section className="section card">
        <h3>Comentarios</h3>
        {comments.length === 0 ? (
          <p className="empty">No hay comentarios.</p>
        ) : (
          <ul className="comment-list">
            {comments.map((c) => (
              <li key={c.id} className="comment">
                <div className="comment-author">
                  {c.author ? c.author.displayName : 'Usuario'}
                </div>
                <div className="comment-content">{c.content}</div>
                <div className="comment-date">
                  {new Date(c.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={sendComment} className="comment-form">
          <textarea
            rows={2}
            placeholder="Escribe un comentario…"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            required
          />
          <button className="btn-primary" disabled={sendingComment}>
            {sendingComment ? 'Enviando…' : 'Comentar'}
          </button>
        </form>
      </section>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>Proponer para docencia</h3>
            <form onSubmit={submitTeaching} className="modal-form">
              <label>
                Resumen
                <textarea
                  rows={3}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  required
                />
              </label>
              <label>
                Hallazgos clave
                <textarea
                  rows={3}
                  value={keyFindings}
                  onChange={(e) => setKeyFindings(e.target.value)}
                  required
                />
              </label>
              <label>
                Puntos de aprendizaje
                <textarea
                  rows={3}
                  value={learningPoints}
                  onChange={(e) => setLearningPoints(e.target.value)}
                  required
                />
              </label>
              <label>
                Dificultad
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  required
                >
                  <option value="">Selecciona…</option>
                  <option value="Introductory">Básico</option>
                  <option value="Intermediate">Intermedio</option>
                  <option value="Advanced">Avanzado</option>
                </select>
              </label>
              <label>
                Etiquetas (separadas por comas)
                <input
                  type="text"
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="epilepsia, sueño, neonato"
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={proposing}>
                  {proposing ? 'Enviando…' : 'Proponer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()}>
            <h3>{passwordAction === 'reveal' ? 'Mostrar clave EEG' : 'Recuperar acceso EEG'}</h3>
            <p className="modal-copy">
              {passwordAction === 'reveal'
                ? 'Confirma tu contraseña de OCEAN para revelar la clave custodiada y poder compartirla manualmente.'
                : 'Confirma tu contraseña de OCEAN para usar la clave custodiada del caso.'}
            </p>
            <div className="modal-form">
              <label>
                Contraseña
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="Tu contraseña de OCEAN"
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPasswordModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={recoverStoredKey}
                  disabled={recoveringKey || !passwordConfirm.trim()}
                >
                  {recoveringKey ? 'Validando…' : passwordAction === 'reveal' ? 'Mostrar clave' : 'Usar clave guardada'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
