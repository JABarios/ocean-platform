import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TeachingProposal } from '../types'

export default function TeachingLibrary() {
  const [items, setItems] = useState<TeachingProposal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<TeachingProposal[]>('/teaching/library')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>
        Cargando biblioteca…
      </div>
    )
  }

  return (
    <div className="library">
      <h2>Biblioteca docente OCEAN</h2>
      <p className="subtitle">
        Casos validados por la comunidad como material de enseñanza.
      </p>

      {items.length === 0 ? (
        <div className="card empty-state">
          La biblioteca docente está vacía. Los casos validados aparecerán aquí.
        </div>
      ) : (
        <ul className="library-list">
          {items.map((item) => (
            <li key={item.id} className="library-item card">
              <div className="item-header">
                <h3>{item.case?.title || 'Caso sin título'}</h3>
                <span className="badge badge-resolved">{item.difficulty}</span>
              </div>
              <p className="item-summary">{item.summary}</p>
              <div className="item-meta">
                <span>Propuesto por: {item.proposer?.displayName || '—'}</span>
                <span>
                  Validado:{' '}
                  {item.validatedAt
                    ? new Date(item.validatedAt).toLocaleDateString()
                    : '—'}
                </span>
              </div>
              {item.tags && item.tags.length > 0 && (
                <div className="item-tags">
                  {item.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .library {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .library h2 {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-top: -0.5rem;
        }
        .empty-state {
          color: var(--text-secondary);
          padding: 2rem;
          text-align: center;
        }
        .library-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .library-item {
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
        .item-summary {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.45;
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
      `}</style>
    </div>
  )
}
