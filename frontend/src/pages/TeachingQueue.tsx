import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { TeachingProposal } from '../types'

export default function TeachingQueue() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState<TeachingProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'Proposed' | 'Recommended'>('all')

  const isCurator = user?.role === 'Curator' || user?.role === 'Admin'

  useEffect(() => {
    api.get<TeachingProposal[]>('/teaching/proposals')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all'
    ? items
    : items.filter((i) => i.status === filter)

  const recommend = async (id: string) => {
    try {
      await api.post(`/teaching/proposals/${id}/recommend`)
      const updated = await api.get<TeachingProposal[]>('/teaching/proposals')
      setItems(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error')
    }
  }

  const validate = async (id: string, status: 'Validated' | 'Rejected') => {
    try {
      await api.post(`/teaching/proposals/${id}/validate`, { status })
      const updated = await api.get<TeachingProposal[]>('/teaching/proposals')
      setItems(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error')
    }
  }

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>
        Cargando cola de propuestas…
      </div>
    )
  }

  return (
    <div className="queue">
      <h2>Cola de propuestas docentes</h2>
      <p className="subtitle">
        Casos propuestos por la comunidad pendientes de validación curatorial.
      </p>

      <div className="filters">
        {(['all', 'Proposed', 'Recommended'] as const).map((f) => (
          <button
            key={f}
            className={filter === f ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Todas' : f === 'Proposed' ? 'Propuestas' : 'Recomendadas'}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          No hay propuestas docentes en esta categoría.
        </div>
      ) : (
        <ul className="queue-list">
          {filtered.map((item) => (
            <li key={item.id} className="queue-item card">
              <div className="item-header">
                <h3>{item.case?.title || 'Caso sin título'}</h3>
                <div className="item-badges">
                  <span className={`badge badge-${item.status.toLowerCase()}`}>
                    {item.status}
                  </span>
                  {item.difficulty && (
                    <span className="badge badge-draft">{item.difficulty}</span>
                  )}
                </div>
              </div>

              <div className="item-body">
                <div className="field">
                  <span className="field-label">Resumen</span>
                  <p>{item.summary}</p>
                </div>
                {item.keyFindings && (
                  <div className="field">
                    <span className="field-label">Hallazgos clave</span>
                    <p>{item.keyFindings}</p>
                  </div>
                )}
                {item.learningPoints && (
                  <div className="field">
                    <span className="field-label">Puntos de aprendizaje</span>
                    <p>{item.learningPoints}</p>
                  </div>
                )}
              </div>

              <div className="item-meta">
                <span>Propuesto por: {item.proposer?.displayName || '—'}</span>
                <span>Recomendaciones: {item._count?.recommendations ?? 0}</span>
              </div>

              {item.tags && item.tags.length > 0 && (
                <div className="item-tags">
                  {item.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}

              <div className="item-actions">
                {item.proposerId === user?.id ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Eres el proponente
                  </span>
                ) : (
                  <button
                    className="btn-secondary"
                    onClick={() => recommend(item.id)}
                    disabled={item.recommendations?.some((r: any) => r.authorId === user?.id)}
                  >
                    {item.recommendations?.some((r: any) => r.authorId === user?.id)
                      ? 'Ya recomendado'
                      : 'Recomendar'}
                  </button>
                )}

                {isCurator && (
                  <>
                    <button
                      className="btn-primary"
                      onClick={() => validate(item.id, 'Validated')}
                    >
                      Validar
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => validate(item.id, 'Rejected')}
                    >
                      Rechazar
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .queue {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .queue h2 {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-top: -0.5rem;
        }
        .filters {
          display: flex;
          gap: 0.5rem;
        }
        .filters button {
          padding: 0.35rem 0.75rem;
          font-size: 0.85rem;
        }
        .empty-state {
          color: var(--text-secondary);
          padding: 2rem;
          text-align: center;
        }
        .queue-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .queue-item {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }
        .item-header h3 {
          font-size: 1rem;
          font-weight: 600;
        }
        .item-badges {
          display: flex;
          gap: 0.4rem;
        }
        .item-body {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .field-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
          margin-bottom: 0.15rem;
        }
        .field p {
          font-size: 0.9rem;
          color: var(--text);
        }
        .item-meta {
          display: flex;
          gap: 1.5rem;
          font-size: 0.8rem;
          color: var(--text-secondary);
        }
        .item-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .tag {
          background: #eef2ff;
          color: #3730a3;
          padding: 0.15rem 0.5rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 500;
        }
        .item-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.25rem;
        }
        .badge-proposed { background: #dbeafe; color: #1e40af; }
        .badge-recommended { background: #fef3c7; color: #92400e; }
      `}</style>
    </div>
  )
}
