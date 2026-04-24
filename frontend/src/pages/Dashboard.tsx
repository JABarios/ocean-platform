import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseItem, ReviewRequest } from '../types'

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
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [c, p, a] = await Promise.all([
          api.get<CaseItem[]>('/cases'),
          api.get<ReviewRequest[]>('/requests/pending'),
          api.get<ReviewRequest[]>('/requests/active'),
        ])
        setCases(c)
        setPending(p)
        setActive(a)
      } catch {
        // errors handled by client
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  const respondRequest = async (id: string, action: 'Accepted' | 'Rejected') => {
    try {
      const endpoint = action === 'Accepted' ? 'accept' : 'reject'
      await api.post(`/requests/${id}/${endpoint}`)
      setPending((prev) => prev.filter((r) => r.id !== id))
      if (action === 'Accepted') {
        const updated = await api.get<ReviewRequest[]>('/requests/active')
        setActive(updated)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error')
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

      <style>{`
        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .dashboard-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .dashboard-header h2 {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .dashboard-section h3 {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 0.75rem;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .empty {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
        .case-list,
        .request-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .case-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.75rem 1rem;
        }
        .case-meta {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .case-title {
          font-weight: 500;
        }
        .case-date {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        .request-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.75rem 1rem;
        }
        .request-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .request-case {
          font-weight: 500;
        }
        .request-message {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        .request-actions {
          display: flex;
          gap: 0.5rem;
        }
      `}</style>
    </div>
  )
}
