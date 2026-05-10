import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import type { CaseItem, Comment, TeachingProposal, User, Group } from '../types'
import {
  getTeachingSupportCount,
  hasAvailableAction,
} from '../utils/teachingState'
import { statusLabel, teachingStatusLabel, visibilityLabel } from '../utils/caseStatus'
import PageHeader from '../components/PageHeader'
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
  const [groups, setGroups] = useState<Group[]>([])
  const [teachingProposal, setTeachingProposal] = useState<TeachingProposal | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  const [targetUserId, setTargetUserId] = useState('')
  const [targetGroupId, setTargetGroupId] = useState('')
  const [requestTargetMode, setRequestTargetMode] = useState<'user' | 'group'>('user')
  const [requestMessage, setRequestMessage] = useState('')
  const [requesting, setRequesting] = useState(false)
  const [accessRequestMessage, setAccessRequestMessage] = useState('')
  const [requestingAccess, setRequestingAccess] = useState(false)

  const [commentText, setCommentText] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [summary, setSummary] = useState('')
  const [keyFindings, setKeyFindings] = useState('')
  const [learningPoints, setLearningPoints] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [proposing, setProposing] = useState(false)
  const [recommending, setRecommending] = useState(false)

  const [statusBusy, setStatusBusy] = useState(false)
  const [visibilityValue, setVisibilityValue] = useState<'Private' | 'Institutional' | 'Public'>('Private')
  const [visibilityBusy, setVisibilityBusy] = useState(false)

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
        const [c, com, u, g] = await Promise.all([
          api.get<CaseItem>(`/cases/${id}`),
          api.get<Comment[]>(`/comments/case/${id}`),
          api.get<User[]>('/users'),
          api.get<Group[]>('/groups'),
        ])
        setCaseItem(c)
        setComments(com)
        setUsers(u)
        setGroups(g)
        try {
          const tp = await api.get<TeachingProposal | null>(`/teaching/proposals/case/${id}`)
          setTeachingProposal(tp)
        } catch (err) {
          console.warn('[OCEAN] No se pudo cargar la propuesta docente del caso', err)
          setTeachingProposal(null)
        }
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

  useEffect(() => {
    if (caseItem?.visibility) {
      setVisibilityValue(caseItem.visibility)
    }
  }, [caseItem?.visibility])

  const isOwner = caseItem ? caseItem.ownerId === user?.id : false
  const packageIsEncrypted = caseItem ? caseItem.package?.encryptionMode !== 'NONE' : true

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    if (requestTargetMode === 'user' && !targetUserId) return
    if (requestTargetMode === 'group' && !targetGroupId) return
    setRequesting(true)
    try {
      await api.post('/requests', {
        caseId: id,
        targetUserId: requestTargetMode === 'user' ? targetUserId : undefined,
        targetGroupId: requestTargetMode === 'group' ? targetGroupId : undefined,
        message: requestMessage,
      })
      setTargetUserId('')
      setTargetGroupId('')
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

  const requestReviewAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setRequestingAccess(true)
    try {
      await api.post('/requests/request-access', {
        caseId: id,
        message: accessRequestMessage,
      })
      setAccessRequestMessage('')
      alert('Solicitud de acceso enviada')
      const updatedCase = await api.get<CaseItem>(`/cases/${id}`)
      setCaseItem(updatedCase)
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setRequestingAccess(false)
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
      const updatedProposal = await api.get<TeachingProposal | null>(`/teaching/proposals/case/${id}`)
      setTeachingProposal(updatedProposal)
      setCaseItem((prev) => (prev ? { ...prev, teachingStatus: 'Proposed' } : prev))
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

  const recommendTeaching = async () => {
    if (!teachingProposal) return
    setRecommending(true)
    try {
      await api.post(`/teaching/proposals/${teachingProposal.id}/recommend`)
      const updatedProposal = await api.get<TeachingProposal | null>(`/teaching/proposals/case/${id}`)
      setTeachingProposal(updatedProposal)
      if (updatedProposal) {
        setCaseItem((prev) => (prev ? { ...prev, teachingStatus: updatedProposal.status as CaseItem['teachingStatus'] } : prev))
      }
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setRecommending(false)
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

  const updateVisibility = async () => {
    if (!id || !caseItem) return
    setVisibilityBusy(true)
    try {
      const updated = await api.patch<CaseItem>(`/cases/${id}/visibility`, { visibility: visibilityValue })
      setCaseItem(updated)
    } catch (err) {
      alert(friendlyError(err))
    } finally {
      setVisibilityBusy(false)
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
    a.download = `${id}.${packageIsEncrypted ? 'enc' : 'edf'}`
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

  const canPropose = hasAvailableAction(caseItem.availableActions, 'propose_teaching')
  const ownerCanPrepareProposalLater =
    isOwner && !canPropose && !teachingProposal
  const canRecommendProposal = hasAvailableAction(teachingProposal?.availableActions, 'recommend_teaching')
    || hasAvailableAction(caseItem.availableActions, 'recommend_teaching')
  const currentUserReviewLink = caseItem.reviewRequests?.find((request) =>
    request.requestedBy === user?.id || request.targetUserId === user?.id
  )
  const canRequestReviewAccess = hasAvailableAction(caseItem.availableActions, 'request_review_access')
  const canSendReviewRequest = hasAvailableAction(caseItem.availableActions, 'send_review_request')
  const canRequestReview = hasAvailableAction(caseItem.availableActions, 'request_review')
  const canStartReview = hasAvailableAction(caseItem.availableActions, 'start_review')
  const canResolveCase = hasAvailableAction(caseItem.availableActions, 'resolve_case')
  const canArchiveCase = hasAvailableAction(caseItem.availableActions, 'archive_case')
  const canComment = hasAvailableAction(caseItem.availableActions, 'comment_case')
  const canManageVisibility = isOwner || hasAvailableAction(user?.availableActions, 'access_admin')
  const canChangeStatus = isOwner && (canRequestReview || canStartReview || canResolveCase || canArchiveCase)
  const reviewAccessStatusLabel =
    currentUserReviewLink?.status === 'Pending'
      ? 'Has solicitado acceso a la revisión'
      : currentUserReviewLink?.status === 'Accepted'
        ? 'Ya participas en la revisión'
        : currentUserReviewLink?.status === 'Rejected'
          ? 'Tu solicitud de acceso fue rechazada'
          : currentUserReviewLink?.status === 'Expired'
          ? 'Tu solicitud de acceso expiró'
            : null
  const teachingSupportCount = getTeachingSupportCount(teachingProposal)

  return (
    <div className="case-detail">
      <PageHeader
        title={caseItem.title}
        subtitle="Caso clínico, discusión entre revisores y acceso seguro al paquete EEG."
        actions={<span className={statusBadgeClass(caseItem.status)}>{statusLabel(caseItem.status)}</span>}
      />

      <section className="case-summary-grid">
        <article className="card case-summary-card">
          <span className="field-label">Estado clínico</span>
          <strong>{statusLabel(caseItem.status)}</strong>
        </article>
        <article className="card case-summary-card">
          <span className="field-label">Visibilidad</span>
          <strong>{visibilityLabel(caseItem.visibility)}</strong>
        </article>
        <article className="card case-summary-card">
          <span className="field-label">Biblioteca</span>
          <strong>{teachingStatusLabel(caseItem.teachingStatus)}</strong>
        </article>
        <article className="card case-summary-card">
          <span className="field-label">EEG</span>
          <strong>{caseItem.package ? 'Adjunto' : 'Pendiente'}</strong>
        </article>
      </section>

      <div className="case-top-grid">
        <div className="case-main-column">
          <div className="case-fields card case-overview-card">
            <div className="case-section-head">
              <div>
                <span className="field-label">Resumen clínico</span>
                <h3>Contexto del caso</h3>
              </div>
            </div>
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
            <div className="field-row">
              <div className="field">
                <span className="field-label">Fecha</span>
                <p>{new Date(caseItem.createdAt).toLocaleString()}</p>
              </div>
              <div className="field">
                <span className="field-label">Propietario</span>
                <p>{caseItem.owner?.displayName || '—'}</p>
              </div>
            </div>
            <div className="field">
              <span className="field-label">Visibilidad</span>
              {canManageVisibility ? (
                <div className="inline-form">
                  <select
                    value={visibilityValue}
                    onChange={(e) => setVisibilityValue(e.target.value as 'Private' | 'Institutional' | 'Public')}
                  >
                    <option value="Private">Privado</option>
                    <option value="Institutional">Grupo</option>
                    <option value="Public">Público</option>
                  </select>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={updateVisibility}
                    disabled={visibilityBusy || visibilityValue === caseItem.visibility}
                  >
                    {visibilityBusy ? 'Guardando…' : 'Guardar visibilidad'}
                  </button>
                </div>
              ) : (
                <p>{visibilityLabel(caseItem.visibility)}</p>
              )}
              <span className="ops-subtle">
                {caseItem.visibility === 'Public'
                  ? 'Visible para cualquier usuario autenticado de OCEAN.'
                  : caseItem.visibility === 'Institutional'
                    ? 'Visible para los miembros aceptados del grupo destinatario.'
                    : 'Solo visible para el perímetro privado del caso.'}
              </span>
            </div>
          </div>

          <section id="comments" className="section card comments-card">
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
            {canComment ? (
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
            ) : (
              <p className="ops-subtle">
                {caseItem.visibility === 'Public'
                  ? 'Este caso es visible en la comunidad autenticada, pero tu cuenta no puede comentar aquí ahora mismo.'
                  : 'Solo pueden comentar el propietario del caso y quienes ya participan en la revisión.'}
              </p>
            )}
          </section>
        </div>

        <aside className="case-side-column">
          <section className="card action-priority-card">
            <div className="case-section-head">
              <div>
                <span className="field-label">Por dónde empezar</span>
                <h3>Qué puedes hacer ahora</h3>
              </div>
            </div>

            <div className="action-priority-list">
              {caseItem.package ? (
                <div className="action-priority-item">
                  <strong>Abrir el EEG</strong>
                  <span>Entra al visor de OCEAN para revisar la señal y navegar el caso.</span>
                </div>
              ) : (
                <div className="action-priority-item">
                  <strong>Esperar EEG adjunto</strong>
                  <span>Cuando el caso tenga paquete asociado, el acceso al visor aparecerá aquí.</span>
                </div>
              )}

              {canSendReviewRequest && (
                <div className="action-priority-item">
                  <strong>Pedir otra revisión</strong>
                  <span>Envía este caso a un colega o a un grupo desde la sección de revisión.</span>
                </div>
              )}

              {(canRequestReviewAccess || reviewAccessStatusLabel) && (
                <div className="action-priority-item">
                  <strong>Acceso a la revisión</strong>
                  <span>{reviewAccessStatusLabel || 'Puedes solicitar acceso si quieres entrar en la discusión clínica original.'}</span>
                </div>
              )}

              {(canPropose || Boolean(teachingProposal)) && (
                <div className="action-priority-item">
                  <strong>Valorar docencia</strong>
                  <span>{teachingProposal ? 'Este caso ya tiene estado docente y apoyos visibles.' : 'Cuando corresponda, puedes proponerlo a biblioteca.'}</span>
                </div>
              )}
            </div>

            {canChangeStatus && (
              <div className="status-actions">
                {canRequestReview && (
                  <button
                    className="btn-primary"
                    onClick={() => changeStatus('Requested')}
                    disabled={statusBusy}
                  >
                    Enviar solicitud
                  </button>
                )}
                {canStartReview && (
                  <button
                    className="btn-primary"
                    onClick={() => changeStatus('InReview')}
                    disabled={statusBusy}
                  >
                    Iniciar revisión
                  </button>
                )}
                {canResolveCase && (
                  <button
                    className="btn-primary"
                    onClick={() => changeStatus('Resolved')}
                    disabled={statusBusy}
                  >
                    Marcar como Resuelto
                  </button>
                )}
                {canArchiveCase && (
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
          </section>

          <section className="card eeg-access-card">
            <div className="eeg-access-copy">
              <span className="field-label">EEG</span>
              <h3>{caseItem.package ? 'Acceso al EEG del caso' : 'Este caso todavía no tiene un EEG adjunto'}</h3>
              <p>
                {caseItem.package
                  ? packageIsEncrypted
                    ? 'Empieza por el visor. Si necesitas trabajar fuera de OCEAN, descarga el paquete cifrado y descífralo aquí mismo.'
                    : 'Puedes abrir directamente el visor de OCEAN con el EEG enlazado desde la galería.'
                  : 'Cuando el caso tenga un paquete EEG asociado, aparecerá aquí el acceso directo al visor.'}
              </p>
            </div>
            {caseItem.package && (
              <div className="eeg-access-stack">
                <div className="eeg-access-actions">
                  <button
                    className="btn-primary"
                    onClick={() => window.open(`/cases/${id}/eeg`, '_blank')}
                  >
                    Ver EEG
                  </button>
                  <button className="btn-secondary" onClick={downloadEncrypted}>
                    {packageIsEncrypted ? 'Descargar .enc' : 'Descargar .edf'}
                  </button>
                </div>

                <div className="package-meta">
                  <span>Tamaño: {(caseItem.package.sizeBytes! / 1024 / 1024).toFixed(1)} MB</span>
                  <span>Hash: {caseItem.package.blobHash?.slice(0, 16)}…</span>
                </div>

                {packageIsEncrypted ? (
                  <>
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
                    </div>
                    {caseItem.storedKeyAvailable && (
                      <div className="stored-key-actions">
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
                      </div>
                    )}
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
                  </>
                ) : (
                  <div className="stored-key-banner">Este EEG procede de una galería de OCEAN y no requiere clave de descifrado.</div>
                )}
              </div>
            )}
          </section>

          {canSendReviewRequest ? (
            <section className="section card">
              <h3>Solicitar revisión</h3>
              <p className="ops-subtle">
                Envía este caso directamente a una persona o a uno de tus grupos de trabajo.
              </p>
              <form onSubmit={sendRequest} className="inline-form">
                <select
                  value={requestTargetMode}
                  onChange={(e) => setRequestTargetMode(e.target.value as 'user' | 'group')}
                >
                  <option value="user">A usuario</option>
                  <option value="group">A grupo</option>
                </select>
                {requestTargetMode === 'user' ? (
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
                ) : (
                  <select
                    value={targetGroupId}
                    onChange={(e) => setTargetGroupId(e.target.value)}
                    required
                  >
                    <option value="">Selecciona grupo…</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                )}
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
          ) : (
            (canRequestReviewAccess || reviewAccessStatusLabel) && (
              <section className="section card">
                <h3>Acceso a la revisión</h3>
                {canRequestReviewAccess ? (
                  <form onSubmit={requestReviewAccess} className="access-request-form">
                    <p className="ops-subtle">
                      Si quieres participar en la discusión clínica original, puedes solicitar acceso al propietario del caso.
                    </p>
                    <input
                      type="text"
                      placeholder="Mensaje opcional"
                      value={accessRequestMessage}
                      onChange={(e) => setAccessRequestMessage(e.target.value)}
                    />
                    <button className="btn-primary" disabled={requestingAccess}>
                      {requestingAccess ? 'Enviando…' : 'Solicitar acceso a la revisión'}
                    </button>
                  </form>
                ) : reviewAccessStatusLabel ? (
                  <p className="ops-subtle">{reviewAccessStatusLabel}</p>
                ) : null}
              </section>
            )
          )}

          <section className="card teaching-panel teaching-panel-side">
            <div className="teaching-panel-header">
              <div>
                <span className="field-label">Biblioteca</span>
                <h3>Estado docente del caso</h3>
              </div>
              <span className="badge">{teachingStatusLabel(caseItem.teachingStatus)}</span>
            </div>

            {!teachingProposal ? (
              <div className="teaching-panel-empty">
                <div className="teaching-panel-empty-copy">
                  <p>Este caso todavía no tiene propuesta para biblioteca.</p>
                  {ownerCanPrepareProposalLater && (
                    <span className="ops-subtle">
                      Podrás proponerlo cuando el caso esté resuelto o archivado.
                    </span>
                  )}
                </div>
                <div className="teaching-panel-empty-actions">
                  {canPropose && (
                    <button className="btn-secondary" onClick={() => setShowModal(true)}>
                      Proponer para biblioteca
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="teaching-proposal-card">
                <div className="teaching-proposal-top">
                  <div>
                    <div className="teaching-proposal-meta">
                      <span>Propuesto por {teachingProposal.proposer?.displayName || '—'}</span>
                      <span>{teachingSupportCount} apoyos</span>
                      {teachingProposal.difficulty && <span>{teachingProposal.difficulty}</span>}
                    </div>
                    <p className="teaching-summary">{teachingProposal.summary}</p>
                  </div>
                  <div className="teaching-proposal-actions">
                    {canRecommendProposal ? (
                      <button className="btn-secondary" onClick={recommendTeaching} disabled={recommending}>
                        {recommending ? 'Recomendando…' : 'Recomendar para biblioteca'}
                      </button>
                    ) : teachingProposal.proposerId === user?.id ? (
                      <span className="ops-subtle">Eres quien propuso este caso. Tu propuesta cuenta como primer apoyo.</span>
                    ) : teachingProposal.recommendations?.some((r) => r.authorId === user?.id) ? (
                      <span className="ops-subtle">Ya lo has recomendado.</span>
                    ) : teachingProposal.status === 'Validated' ? (
                      <span className="ops-subtle">Ya forma parte de la biblioteca.</span>
                    ) : null}
                  </div>
                </div>

                {(teachingProposal.keyFindings || teachingProposal.learningPoints) && (
                  <div className="teaching-proposal-body">
                    {teachingProposal.keyFindings && (
                      <div className="field">
                        <span className="field-label">Hallazgos clave</span>
                        <p>{teachingProposal.keyFindings}</p>
                      </div>
                    )}
                    {teachingProposal.learningPoints && (
                      <div className="field">
                        <span className="field-label">Puntos de aprendizaje</span>
                        <p>{teachingProposal.learningPoints}</p>
                      </div>
                    )}
                  </div>
                )}

                {teachingProposal.tags && teachingProposal.tags.length > 0 && (
                  <div className="case-tags">
                    {teachingProposal.tags.map((tag) => (
                      <span key={tag} className="badge">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>

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
