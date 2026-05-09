import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { CaseItem, ReviewRequest } from '../types'
import PageHeader from '../components/PageHeader'
import { useAuthStore } from '../store/authStore'
import './Dashboard.css'

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

export default function Dashboard() {
  const currentUser = useAuthStore((s) => s.user)
  const seeingAllCases = currentUser?.role === 'Admin'
  const [cases, setCases] = useState<CaseItem[]>([])
  const [pending, setPending] = useState<ReviewRequest[]>([])
  const [active, setActive] = useState<ReviewRequest[]>([])
  const [expired, setExpired] = useState<ReviewRequest[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const statusCounts = cases.reduce(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { Draft: 0, Requested: 0, InReview: 0, Resolved: 0, Archived: 0 } as Record<CaseItem['status'], number>
  )

  const recentCases = [...cases].sort((a, b) => {
    return new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime()
  })

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [c, p, a, e] = await Promise.all([
          api.get<CaseItem[]>('/cases'),
          api.get<ReviewRequest[]>('/requests/pending'),
          api.get<ReviewRequest[]>('/requests/active'),
          api.get<ReviewRequest[]>('/requests/expired'),
        ])
        setCases(c)
        setPending(p)
        setActive(a)
        setExpired(e)
      } catch {
        // errors handled by client
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const respondRequest = async (id: string, action: 'Accepted' | 'Rejected') => {
    const endpoint = action === 'Accepted' ? 'accept' : 'reject'
    try {
      await api.post(`/requests/${id}/${endpoint}`)
      setPending((prev) => prev.filter((r) => r.id !== id))
      const updated = await api.get<ReviewRequest[]>('/requests/active')
      setActive(updated)
    } catch (err) {
      alert(friendlyError(err))
    }
  }

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>
        Cargando…
      </div>
    )
  }

  return (
    <div className="dashboard">
      <PageHeader
        title="Mis casos"
        subtitle={seeingAllCases
          ? 'Vista general del trabajo clínico: casos abiertos, revisiones pendientes y actividad reciente.'
          : 'Tu bandeja de trabajo en OCEAN: qué tienes pendiente, qué estás revisando y qué casos siguen abiertos.'}
        actions={(
          <button className="btn-primary" onClick={() => navigate('/cases/new')}>
            Nuevo caso
          </button>
        )}
      />

      <section className="dashboard-summary-grid">
        <article className="card summary-card">
          <span className="summary-label">Casos abiertos</span>
          <strong>{statusCounts.Draft + statusCounts.Requested + statusCounts.InReview}</strong>
          <span className="summary-help">
            {statusCounts.Draft} borradores · {statusCounts.Requested} solicitados · {statusCounts.InReview} en revisión
          </span>
        </article>
        <article className="card summary-card">
          <span className="summary-label">Revisiones pendientes</span>
          <strong>{pending.length}</strong>
          <span className="summary-help">Invitaciones que requieren tu respuesta</span>
        </article>
        <article className="card summary-card">
          <span className="summary-label">Revisiones activas</span>
          <strong>{active.length}</strong>
          <span className="summary-help">Casos que ya estás revisando</span>
        </article>
        <article className="card summary-card">
          <span className="summary-label">Resueltos</span>
          <strong>{statusCounts.Resolved}</strong>
          <span className="summary-help">
            {statusCounts.Archived > 0 ? `${statusCounts.Archived} archivados aparte` : 'Pendientes de cierre o archivo'}
          </span>
        </article>
      </section>

      <section className="dashboard-work-grid">
        <section className="dashboard-section">
          <div className="section-head">
            <h3>Requiere respuesta</h3>
            {pending.length > 0 && <span className="section-count">{pending.length}</span>}
          </div>
          {pending.length === 0 ? (
            <p className="empty">No tienes revisiones pendientes.</p>
          ) : (
            <ul className="request-list">
              {pending.map((r) => (
                <li key={r.id} className="request-row card request-row-emphasis">
                  <div className="request-info">
                    <div className="request-case">
                      {r.case ? r.case.title : `Caso ${r.caseId}`}
                    </div>
                    <div className="request-subline">
                      {r.requester?.displayName ? `Solicita: ${r.requester.displayName}` : 'Solicitud de revisión'}
                    </div>
                    {r.message && (
                      <div className="request-message">{r.message}</div>
                    )}
                  </div>
                  <div className="request-actions">
                    <button
                      className="btn-primary"
                      onClick={() => respondRequest(r.id, 'Accepted')}
                    >
                      Aceptar
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => respondRequest(r.id, 'Rejected')}
                    >
                      Rechazar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dashboard-section">
          <div className="section-head">
            <h3>En revisión contigo</h3>
            {active.length > 0 && <span className="section-count">{active.length}</span>}
          </div>
          {active.length === 0 ? (
            <p className="empty">No tienes revisiones activas.</p>
          ) : (
            <ul className="request-list">
              {active.map((r) => (
                <li key={r.id} className="request-row card">
                  <div className="request-info">
                    <div className="request-case">
                      {r.case ? r.case.title : `Caso ${r.caseId}`}
                    </div>
                    {r.message && (
                      <div className="request-message">{r.message}</div>
                    )}
                  </div>
                  <Link to={`/cases/${r.caseId}`}>Ver caso</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <section className="dashboard-section">
        <div className="section-head">
          <h3>{seeingAllCases ? 'Casos recientes' : 'Tus casos recientes'}</h3>
          {cases.length > 0 && <span className="section-count">{cases.length}</span>}
        </div>
        {cases.length === 0 ? (
          <p className="empty">{seeingAllCases ? 'No hay casos registrados.' : 'No tienes casos creados.'}</p>
        ) : (
          <ul className="case-list">
            {recentCases.map((c) => (
              <li key={c.id} className="case-row card">
                <div className="case-main">
                  <div className="case-meta">
                    <Link to={`/cases/${c.id}`} className="case-title">
                      {c.title}
                    </Link>
                    <span className={statusBadgeClass(c.status)}>{c.status}</span>
                  </div>
                  <div className="case-secondary">
                    {seeingAllCases && c.owner && (
                      <span>Propietario: {c.owner.displayName}</span>
                    )}
                    {c.modality && <span>{c.modality}</span>}
                    {c.studyReason && <span>{c.studyReason}</span>}
                  </div>
                  {c.tags.length > 0 && (
                    <div className="case-tags">
                      {c.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="badge">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="case-side">
                  <span className="case-date">
                    {new Date(c.updatedAt ?? c.createdAt).toLocaleDateString()}
                  </span>
                  <Link to={`/cases/${c.id}`}>Abrir</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {expired.length > 0 && (
        <section className="dashboard-section">
          <div className="section-head">
            <h3 className="expired-title">Solicitudes vencidas</h3>
            <span className="section-count muted">{expired.length}</span>
          </div>
          <ul className="request-list">
            {expired.map((r) => (
              <li key={r.id} className="request-row card expired-row">
                <div className="request-info">
                  <div className="request-case">
                    {r.case ? r.case.title : `Caso ${r.caseId}`}
                  </div>
                  <span className="expired-label">Expiró sin respuesta</span>
                </div>
                <Link to={`/cases/${r.caseId}`}>Ver caso</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  )
}
