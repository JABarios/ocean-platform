import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TeachingProposal } from '../types'
import './TeachingLibrary.css'

const DIFFICULTIES = ['Introductory', 'Intermediate', 'Advanced']

export default function TeachingLibrary() {
  const [items, setItems] = useState<TeachingProposal[]>([])
  const [loading, setLoading] = useState(true)
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchLibrary()
  }

  return (
    <div className="library">
      <h2>Biblioteca docente OCEAN</h2>
      <p className="subtitle">
        Casos validados por la comunidad como material de enseñanza.
      </p>

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
