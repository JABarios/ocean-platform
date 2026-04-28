import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { CaseItem, ReviewRequest } from '../types'
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
  const [cases, setCases] = useState<CaseItem[]>([])
  const [pending, setPending] = useState<ReviewRequest[]>([])
  const [active, setActive] = useState<ReviewRequest[]>([])
  const [expired, setExpired] = useState<ReviewRequest[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

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
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <button className="btn-primary" onClick={() => navigate('/cases/new')}>
          Solicitar nueva revisión
        </button>
      </div>

      <section className="dashboard-section">
        <h3>Mis Casos</h3>
        {cases.length === 0 ? (
          <p className="empty">No tienes casos creados.</p>
        ) : (
          <ul className="case-list">
            {cases.map((c) => (
              <li key={c.id} className="case-row card">
                <div className="case-meta">
                  <Link to={`/cases/${c.id}`} className="case-title">
                    {c.title}
                  </Link>
                  <span className={statusBadgeClass(c.status)}>{c.status}</span>
                </div>
                <span className="case-date">
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-section">
        <h3>Revisiones Pendientes</h3>
        {pending.length === 0 ? (
          <p className="empty">No tienes revisiones pendientes.</p>
        ) : (
          <ul className="request-list">
            {pending.map((r) => (
              <li key={r.id} className="request-row card">
                <div className="request-info">
                  <div className="request-case">
                    {r.case ? r.case.title : `Caso ${r.caseId}`}
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
        <h3>Revisiones Activas</h3>
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

      {expired.length > 0 && (
        <section className="dashboard-section">
          <h3 className="expired-title">Solicitudes vencidas ({expired.length})</h3>
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
