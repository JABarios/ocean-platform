import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { TeachingProposal } from '../types'
import { getTeachingSupportCount, hasAvailableAction } from '../utils/teachingState'
import { difficultyLabel, statusLabel, teachingStatusLabel } from '../utils/caseStatus'
import PageHeader from '../components/PageHeader'
import './TeachingQueue.css'

export default function TeachingQueue() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState<TeachingProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'Proposed' | 'Recommended'>('all')

  useEffect(() => {
    api.get<TeachingProposal[]>('/teaching/proposals')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter === 'all'
    ? items
    : items.filter((i) => i.status === filter)

  const summary = {
    total: items.length,
    proposed: items.filter((item) => item.status === 'Proposed').length,
    recommended: items.filter((item) => item.status === 'Recommended').length,
    validated: items.filter((item) => item.status === 'Validated').length,
  }

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
        Cargando casos propuestos…
      </div>
    )
  }

  return (
    <div className="queue">
      <PageHeader
        title="Casos propuestos"
        subtitle="Bandeja docente para revisar propuestas, ver apoyos y decidir qué casos pasan a biblioteca."
        aside={(
          <div className="queue-summary-grid">
            <div className="queue-summary-card">
              <strong>{summary.total}</strong>
              <span>en cola</span>
            </div>
            <div className="queue-summary-card">
              <strong>{summary.proposed}</strong>
              <span>propuestas</span>
            </div>
            <div className="queue-summary-card">
              <strong>{summary.recommended}</strong>
              <span>listas para curar</span>
            </div>
            <div className="queue-summary-card">
              <strong>{summary.validated}</strong>
              <span>validadas</span>
            </div>
          </div>
        )}
      />

      <div className="filters card">
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
          No hay casos propuestos en esta categoría.
        </div>
      ) : (
        <ul className="queue-list">
          {filtered.map((item) => (
            <li key={item.id} className="queue-item card">
              <div className="item-header">
                <h3>{item.case?.title || 'Caso sin título'}</h3>
                <div className="item-badges">
                  <span className={`badge badge-${item.status.toLowerCase()}`}>
                    {teachingStatusLabel(item.status)}
                  </span>
                  {item.difficulty && (
                    <span className="badge badge-draft">{difficultyLabel(item.difficulty)}</span>
                  )}
                  {item.case?.status && (
                    <span className="badge">{statusLabel(item.case.status)}</span>
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
                <span>Apoyos: {getTeachingSupportCount(item)}</span>
                {item.validatedAt && <span>Validado: {new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(item.validatedAt))}</span>}
              </div>

              {item.tags && item.tags.length > 0 && (
                <div className="item-tags">
                  {item.tags.map((t) => (
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}

              <div className="item-actions">
                {item.case?.id && (
                  <Link to={`/cases/${item.case.id}`} className="btn-secondary">
                    Ver caso
                  </Link>
                )}
                {hasAvailableAction(item.availableActions, 'recommend_teaching') ? (
                  <button
                    className="btn-secondary"
                    onClick={() => recommend(item.id)}
                  >
                    Recomendar
                  </button>
                ) : item.proposerId === user?.id ? (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Eres el proponente
                  </span>
                ) : item.recommendations?.some((r: any) => r.authorId === user?.id) ? (
                  <button className="btn-secondary" disabled>
                    Ya recomendado
                  </button>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Sin acciones disponibles
                  </span>
                )}

                {hasAvailableAction(item.availableActions, 'validate_teaching') && (
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

    </div>
  )
}
