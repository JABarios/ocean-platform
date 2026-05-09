import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { TeachingProposal } from '../types'
import PageHeader from '../components/PageHeader'
import './TeachingLibrary.css'

const DIFFICULTIES = ['Introductory', 'Intermediate', 'Advanced']

export default function TeachingLibrary() {
  const [items, setItems] = useState<TeachingProposal[]>([])
  const [proposalItems, setProposalItems] = useState<TeachingProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProposals, setLoadingProposals] = useState(true)
  const [q, setQ] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [tagsInput, setTagsInput] = useState('')

  const fetchLibrary = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (difficulty) params.set('difficulty', difficulty)
    if (tagsInput.trim()) params.set('tags', tagsInput.trim())
    const qs = params.toString()
    api.get<TeachingProposal[]>(`/teaching/library${qs ? `?${qs}` : ''}`)
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchLibrary() }, [])

  useEffect(() => {
    setLoadingProposals(true)
    api.get<TeachingProposal[]>('/teaching/proposals')
      .then(setProposalItems)
      .catch(() => {})
      .finally(() => setLoadingProposals(false))
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchLibrary()
  }

  const proposedCount = proposalItems.filter((item) => item.status === 'Proposed').length
  const recommendedCount = proposalItems.filter((item) => item.status === 'Recommended').length
  const recentProposalItems = proposalItems.slice(0, 3)

  return (
    <div className="library">
      <PageHeader
        title="Biblioteca docente"
        subtitle="Casos validados por la comunidad como material de enseñanza y consulta."
      />

      <section className="library-overview card">
        <div className="library-overview-copy">
          <h3>Propuestas en curso</h3>
          <p>
            La biblioteca muestra solo los casos ya validados. Las propuestas y recomendaciones pendientes
            se consultan en casos propuestos.
          </p>
        </div>
        <div className="library-overview-stats">
          <span>{loadingProposals ? '…' : proposedCount} propuestas</span>
          <span>{loadingProposals ? '…' : recommendedCount} recomendados</span>
        </div>
        <div className="library-overview-actions">
          <Link to="/queue" className="btn-secondary">
            Ver casos propuestos
          </Link>
        </div>
      </section>

      {!loadingProposals && recentProposalItems.length > 0 && (
        <section className="library-proposals card">
          <div className="library-proposals-header">
            <h3>Propuestas recientes</h3>
            <Link to="/queue">Ver todas</Link>
          </div>
          <ul className="library-proposals-list">
            {recentProposalItems.map((item) => (
              <li key={item.id} className="library-proposal-row">
                <div className="library-proposal-main">
                  <strong>{item.case?.title || 'Caso sin título'}</strong>
                  <span>
                    Propuesto por {item.proposer?.displayName || '—'}
                    {item.case?.id ? ` · ` : ''}
                    {item.case?.id && <Link to={`/cases/${item.case.id}`}>Ver caso</Link>}
                  </span>
                </div>
                <span className={`badge ${item.status === 'Recommended' ? 'badge-resolved' : 'badge-draft'}`}>
                  {item.status === 'Recommended' ? 'Recomendado' : 'Propuesto'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={handleSearch} className="search-bar card">
        <input
          type="text"
          placeholder="Buscar por título, resumen…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="">Todas las dificultades</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Tags (epilepsia, EEG…)"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
        />
        <button type="submit" className="btn-primary">Buscar</button>
      </form>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>
      ) : items.length === 0 ? (
        <div className="card empty-state">
          {q || difficulty || tagsInput
            ? 'No se encontraron resultados para los filtros aplicados.'
            : 'La biblioteca docente está vacía. Los casos validados aparecerán aquí.'}
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
                    <span key={t} className="tag">{t}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
