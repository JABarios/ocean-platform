import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { CaseItem, ReviewRequest, TeachingProposal, User } from '../types'
import { useAuthStore } from '../store/authStore'
import PageHeader from '../components/PageHeader'
import './CaseOperations.css'

type CaseStatusFilter = 'all' | CaseItem['status']

function summarizeRequests(requests: ReviewRequest[] = []) {
  return requests.reduce(
    (acc, request) => {
      if (request.status === 'Pending') acc.pending += 1
      if (request.status === 'Accepted') acc.accepted += 1
      if (request.status === 'Rejected') acc.rejected += 1
      if (request.status === 'Expired') acc.expired += 1
      if (request.status === 'Completed') acc.completed += 1
      return acc
    },
    { pending: 0, accepted: 0, rejected: 0, expired: 0, completed: 0 }
  )
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value))
}

export default function CaseOperations() {
  const currentUser = useAuthStore((s) => s.user)
  const [cases, setCases] = useState<CaseItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CaseStatusFilter>('all')
  const [inviteCaseId, setInviteCaseId] = useState<string | null>(null)
  const [targetUserId, setTargetUserId] = useState('')
  const [message, setMessage] = useState('')
  const [proposalCaseId, setProposalCaseId] = useState<string | null>(null)
  const [proposalSummary, setProposalSummary] = useState('')
  const [proposalDifficulty, setProposalDifficulty] = useState('Intermediate')
  const [proposalTags, setProposalTags] = useState('')
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null)
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [managedCases, availableUsers] = await Promise.all([
          api.get<CaseItem[]>('/cases/managed'),
          api.get<User[]>('/users'),
        ])
        setCases(managedCases)
        setUsers(availableUsers)
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const summary = useMemo(() => ({
    total: cases.length,
    open: cases.filter((item) => item.status !== 'Archived').length,
    inReview: cases.filter((item) => item.status === 'InReview').length,
    requested: cases.filter((item) => item.status === 'Requested').length,
    resolved: cases.filter((item) => item.status === 'Resolved').length,
  }), [cases])

  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cases.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!q) return true
      const haystack = [
        item.title,
        item.clinicalContext,
        item.studyReason,
        item.ageRange,
        ...(item.tags || []),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [cases, search, statusFilter])

  const inviteCandidates = useMemo(() => (
    users.filter((user) => user.id !== currentUser?.id && user.status !== 'Pending')
  ), [users, currentUser?.id])

  const updateCaseStatus = async (caseId: string, statusClinical: CaseItem['status']) => {
    setBusyCaseId(caseId)
    setError('')
    try {
      const updated = await api.patch<CaseItem>(`/cases/${caseId}/status`, { statusClinical })
      setCases((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated, reviewRequests: item.reviewRequests } : item)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyCaseId(null)
    }
  }

  const inviteReviewer = async (caseId: string) => {
    if (!targetUserId) return
    setBusyCaseId(caseId)
    setError('')
    try {
      const created = await api.post<ReviewRequest>('/requests', {
        caseId,
        targetUserId,
        message,
      })
      const targetUser = users.find((user) => user.id === targetUserId)
      setCases((prev) => prev.map((item) => (
        item.id === caseId
          ? {
              ...item,
              status: item.status === 'Draft' ? 'Requested' : item.status,
              reviewRequests: [
                {
                  ...created,
                  targetUser: targetUser ? { id: targetUser.id, displayName: targetUser.displayName } : undefined,
                },
                ...(item.reviewRequests || []),
              ],
            }
          : item
      )))
      setInviteCaseId(null)
      setTargetUserId('')
      setMessage('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyCaseId(null)
    }
  }

  const submitTeachingProposal = async (caseId: string) => {
    if (!proposalSummary.trim()) return
    setBusyCaseId(caseId)
    setError('')
    try {
      await api.post<TeachingProposal>('/teaching/proposals', {
        caseId,
        summary: proposalSummary,
        difficulty: proposalDifficulty,
        tags: proposalTags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setCases((prev) => prev.map((item) => (
        item.id === caseId ? { ...item, teachingStatus: 'Proposed' } : item
      )))
      setProposalCaseId(null)
      setProposalSummary('')
      setProposalDifficulty('Intermediate')
      setProposalTags('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyCaseId(null)
    }
  }

  const resendRequest = async (caseId: string, requestId: string) => {
    setBusyRequestId(requestId)
    setError('')
    try {
      const updated = await api.post<ReviewRequest>(`/requests/${requestId}/resend`)
      setCases((prev) => prev.map((item) => (
        item.id === caseId
          ? {
              ...item,
              reviewRequests: (item.reviewRequests || []).map((request) => (
                request.id === requestId ? { ...request, ...updated } : request
              )),
            }
          : item
      )))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyRequestId(null)
    }
  }

  const withdrawRequest = async (caseId: string, requestId: string) => {
    setBusyRequestId(requestId)
    setError('')
    try {
      await api.del(`/requests/${requestId}`)
      setCases((prev) => prev.map((item) => (
        item.id === caseId
          ? {
              ...item,
              reviewRequests: (item.reviewRequests || []).filter((request) => request.id !== requestId),
            }
          : item
      )))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyRequestId(null)
    }
  }

  const deleteCase = async (caseId: string, title?: string) => {
    const confirmed = window.confirm(
      `Se borrará el caso${title ? ` "${title}"` : ''} con sus comentarios, invitaciones y paquete EEG asociado si queda huérfano.`
    )
    if (!confirmed) return

    setBusyCaseId(caseId)
    setError('')
    try {
      await api.del(`/cases/${caseId}`)
      setCases((prev) => prev.filter((item) => item.id !== caseId))
      if (inviteCaseId === caseId) {
        setInviteCaseId(null)
        setTargetUserId('')
        setMessage('')
      }
      if (proposalCaseId === caseId) {
        setProposalCaseId(null)
        setProposalSummary('')
        setProposalDifficulty('Intermediate')
        setProposalTags('')
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyCaseId(null)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>

  return (
    <div className="case-ops">
      <PageHeader
        title="Gestión de casos"
        subtitle="Coordina invitaciones, estado clínico y propuesta docente desde una sola bandeja."
        aside={(
          <div className="summary-grid">
            <div className="summary-card"><strong>{summary.total}</strong><span>Total</span></div>
            <div className="summary-card"><strong>{summary.open}</strong><span>Abiertos</span></div>
            <div className="summary-card"><strong>{summary.requested}</strong><span>Solicitados</span></div>
            <div className="summary-card"><strong>{summary.inReview}</strong><span>En revisión</span></div>
            <div className="summary-card"><strong>{summary.resolved}</strong><span>Resueltos</span></div>
          </div>
        )}
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="filters card">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, contexto, motivo o tags"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CaseStatusFilter)}>
          <option value="all">Todos los estados</option>
          <option value="Draft">Draft</option>
          <option value="Requested">Requested</option>
          <option value="InReview">InReview</option>
          <option value="Resolved">Resolved</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      <div className="case-list">
        {visibleCases.map((item) => {
          const requests = item.reviewRequests || []
          const requestSummary = summarizeRequests(requests)
          return (
            <article key={item.id} className="case-card card">
              <div className="case-card-header">
                <div>
                  <div className="case-title-row">
                    <Link to={`/cases/${item.id}`} className="case-title">{item.title || 'Caso sin título'}</Link>
                    <span className={`status-pill status-${item.status.toLowerCase()}`}>{item.status}</span>
                  </div>
                  <div className="case-meta">
                    {item.ageRange || 'Edad no indicada'} · {item.modality} · {formatDate(item.createdAt)}
                  </div>
                  {item.studyReason && <div className="case-meta">{item.studyReason}</div>}
                </div>
                <div className="case-links">
                  <Link to={`/cases/${item.id}`}>Ver detalle</Link>
                  {item.package && <Link to={`/cases/${item.id}/eeg`} target="_blank" rel="noreferrer">Abrir EEG</Link>}
                </div>
              </div>

              <div className="metrics-row">
                <div className="metric-box"><strong>{requests.length}</strong><span>Invitaciones</span></div>
                <div className="metric-box"><strong>{requestSummary.pending}</strong><span>Pendientes</span></div>
                <div className="metric-box"><strong>{requestSummary.accepted}</strong><span>Aceptadas</span></div>
                <div className="metric-box"><strong>{requestSummary.completed}</strong><span>Cerradas</span></div>
                <div className="metric-box"><strong>{item.package ? 'Sí' : 'No'}</strong><span>Paquete EEG</span></div>
              </div>

              {requests.length > 0 && (
                <div className="request-list">
                  {requests.map((request) => {
                    const canOwnerManageRequest = request.status === 'Pending' || request.status === 'Rejected' || request.status === 'Expired'
                    return (
                      <div key={request.id} className="request-row">
                        <div className="request-main">
                          <span className={`request-chip request-${request.status.toLowerCase()}`}>
                            {(request.targetUser?.displayName || request.targetGroup?.name || 'Destino')} · {request.status}
                          </span>
                          <span className="request-date">
                            {request.acceptedAt ? `Aceptada ${formatDate(request.acceptedAt)}` : `Creada ${formatDate(request.createdAt)}`}
                          </span>
                        </div>
                        {request.message && <div className="request-message">{request.message}</div>}
                        {canOwnerManageRequest && (
                          <div className="request-actions">
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => resendRequest(item.id, request.id)}
                              disabled={busyRequestId === request.id}
                            >
                              Reenviar
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => withdrawRequest(item.id, request.id)}
                              disabled={busyRequestId === request.id}
                            >
                              Retirar
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="actions-row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setInviteCaseId(inviteCaseId === item.id ? null : item.id)}
                  disabled={busyCaseId === item.id}
                >
                  Invitar revisor
                </button>
                {item.status === 'InReview' && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => updateCaseStatus(item.id, 'Resolved')}
                    disabled={busyCaseId === item.id}
                  >
                    Marcar resuelto
                  </button>
                )}
                {(item.status === 'Resolved' || item.status === 'Requested' || item.status === 'Draft') && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => updateCaseStatus(item.id, 'Archived')}
                    disabled={busyCaseId === item.id}
                  >
                    Archivar
                  </button>
                )}
                {(item.status === 'Resolved' || item.status === 'Archived') && item.teachingStatus === 'None' && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setProposalCaseId(proposalCaseId === item.id ? null : item.id)}
                    disabled={busyCaseId === item.id}
                  >
                    Proponer docencia
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary btn-danger-soft"
                  onClick={() => deleteCase(item.id, item.title)}
                  disabled={busyCaseId === item.id}
                >
                  Borrar caso
                </button>
              </div>

              {inviteCaseId === item.id && (
                <div className="invite-panel">
                  <select value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
                    <option value="">Selecciona un revisor</option>
                    {inviteCandidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName}{user.institution ? ` · ${user.institution}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Mensaje opcional para la invitación"
                  />
                  <div className="invite-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => inviteReviewer(item.id)}
                      disabled={!targetUserId || busyCaseId === item.id}
                    >
                      Enviar invitación
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setInviteCaseId(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {proposalCaseId === item.id && (
                <div className="invite-panel teaching-panel">
                  <input
                    value={proposalSummary}
                    onChange={(e) => setProposalSummary(e.target.value)}
                    placeholder="Resumen docente breve"
                  />
                  <select value={proposalDifficulty} onChange={(e) => setProposalDifficulty(e.target.value)}>
                    <option value="Basic">Basic</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                  <input
                    value={proposalTags}
                    onChange={(e) => setProposalTags(e.target.value)}
                    placeholder="Tags separados por comas"
                  />
                  <div className="invite-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => submitTeachingProposal(item.id)}
                      disabled={!proposalSummary.trim() || busyCaseId === item.id}
                    >
                      Enviar propuesta
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setProposalCaseId(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}

        {visibleCases.length === 0 && (
          <div className="card empty-card">No hay casos que coincidan con los filtros actuales.</div>
        )}
      </div>
    </div>
  )
}
