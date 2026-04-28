import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { CaseItem, ReviewRequest, TeachingProposal, User } from '../types'
import { useAuthStore } from '../store/authStore'

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
      <div className="ops-header">
        <div>
          <h2>Gestión de casos</h2>
          <p className="ops-subtle">Coordina casos abiertos, invitaciones y cierre clínico desde una sola bandeja.</p>
        </div>
        <div className="summary-grid">
          <div className="summary-card"><strong>{summary.total}</strong><span>Total</span></div>
          <div className="summary-card"><strong>{summary.open}</strong><span>Abiertos</span></div>
          <div className="summary-card"><strong>{summary.requested}</strong><span>Solicitados</span></div>
          <div className="summary-card"><strong>{summary.inReview}</strong><span>En revisión</span></div>
          <div className="summary-card"><strong>{summary.resolved}</strong><span>Resueltos</span></div>
        </div>
      </div>

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
                  className="btn-danger"
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

      <style>{`
        .case-ops {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .ops-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .ops-header h2 {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .ops-subtle {
          color: var(--text-secondary);
          font-size: 0.92rem;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(90px, 1fr));
          gap: 0.75rem;
          min-width: min(100%, 520px);
        }
        .summary-card, .metric-box {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          padding: 0.7rem 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .summary-card strong, .metric-box strong {
          font-size: 1.05rem;
        }
        .summary-card span, .metric-box span {
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .btn-danger {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
        }
        .btn-danger:hover {
          background: #fee2e2;
        }
        .filters {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) 180px;
          gap: 0.75rem;
          padding: 0.9rem;
        }
        .filters input,
        .filters select,
        .invite-panel input,
        .invite-panel select,
        .teaching-panel input,
        .teaching-panel select {
          font-size: 0.85rem;
          padding: 0.55rem 0.65rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .error-banner {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
          padding: 0.6rem 1rem;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        .case-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .case-card {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .case-card-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .case-title-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .case-title {
          font-size: 1rem;
          font-weight: 600;
        }
        .case-meta {
          color: var(--text-secondary);
          font-size: 0.85rem;
          margin-top: 0.2rem;
        }
        .case-links {
          display: flex;
          gap: 0.9rem;
          flex-wrap: wrap;
          font-size: 0.9rem;
        }
        .status-pill {
          border-radius: 999px;
          padding: 0.18rem 0.55rem;
          font-size: 0.72rem;
          font-weight: 700;
        }
        .status-draft { background: #f3f4f6; color: #374151; }
        .status-requested { background: #eff6ff; color: #1d4ed8; }
        .status-inreview { background: #ecfeff; color: #0f766e; }
        .status-resolved { background: #ecfdf5; color: #047857; }
        .status-archived { background: #faf5ff; color: #7c3aed; }
        .metrics-row {
          display: grid;
          grid-template-columns: repeat(5, minmax(100px, 1fr));
          gap: 0.65rem;
        }
        .request-list {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .request-row {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: #fcfcfd;
          padding: 0.7rem 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
        .request-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .request-date {
          color: var(--text-secondary);
          font-size: 0.8rem;
        }
        .request-message {
          color: var(--text-primary);
          font-size: 0.88rem;
          line-height: 1.45;
        }
        .request-chip {
          border-radius: 999px;
          padding: 0.2rem 0.55rem;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .request-pending { background: #fff7ed; color: #c2410c; }
        .request-accepted { background: #ecfdf5; color: #047857; }
        .request-rejected { background: #fef2f2; color: #b91c1c; }
        .request-expired { background: #f3f4f6; color: #4b5563; }
        .request-completed { background: #eef2ff; color: #4338ca; }
        .more-chip { background: #f8fafc; color: #475569; }
        .request-actions {
          display: flex;
          gap: 0.55rem;
          flex-wrap: wrap;
        }
        .actions-row, .invite-actions {
          display: flex;
          gap: 0.65rem;
          flex-wrap: wrap;
        }
        .invite-panel {
          display: grid;
          grid-template-columns: minmax(220px, 260px) minmax(240px, 1fr) auto;
          gap: 0.65rem;
          align-items: center;
          padding-top: 0.2rem;
        }
        .teaching-panel {
          grid-template-columns: minmax(240px, 1.2fr) 180px minmax(220px, 1fr) auto;
        }
        .empty-card {
          color: var(--text-secondary);
          text-align: center;
        }
        @media (max-width: 980px) {
          .summary-grid, .metrics-row {
            grid-template-columns: repeat(2, minmax(110px, 1fr));
            width: 100%;
          }
          .filters, .invite-panel, .teaching-panel {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
