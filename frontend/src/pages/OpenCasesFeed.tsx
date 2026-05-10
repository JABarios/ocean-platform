import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { CaseItem } from '../types'
import PageHeader from '../components/PageHeader'
import './OpenCasesFeed.css'

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

export default function OpenCasesFeed() {
  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'All' | CaseItem['status']>('All')

  useEffect(() => {
    const load = async () => {
      try {
        const data = await api.get<CaseItem[]>('/cases/open')
        setCases(data)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredCases = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return cases.filter((item) => {
      const matchesStatus = statusFilter === 'All' || item.status === statusFilter
      const haystack = [
        item.title,
        item.clinicalContext,
        item.studyReason,
        item.modality,
        item.owner?.displayName,
        ...(item.tags ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const matchesQuery = !normalized || haystack.includes(normalized)
      return matchesStatus && matchesQuery
    })
  }, [cases, query, statusFilter])

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>
  }

  return (
    <div className="open-cases-feed">
      <PageHeader
        title="Casos abiertos"
        subtitle="Consulta abierta a la comunidad autenticada de OCEAN: casos públicos que cualquier colega puede revisar y comentar."
      />

      <section className="card open-cases-toolbar">
        <label className="open-cases-field">
          <span className="field-label">Buscar</span>
          <input
            type="text"
            placeholder="Título, contexto, motivo, propietario o tag"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="open-cases-field">
          <span className="field-label">Estado clínico</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'All' | CaseItem['status'])}>
            <option value="All">Todos</option>
            <option value="Draft">Draft</option>
            <option value="Requested">Requested</option>
            <option value="InReview">InReview</option>
            <option value="Resolved">Resolved</option>
            <option value="Archived">Archived</option>
          </select>
        </label>
        <div className="open-cases-metrics">
          <strong>{filteredCases.length}</strong>
          <span>casos visibles</span>
        </div>
      </section>

      {filteredCases.length === 0 ? (
        <section className="card">
          <p className="empty">No hay casos públicos que encajen con ese filtro.</p>
        </section>
      ) : (
        <ul className="open-cases-list">
          {filteredCases.map((item) => (
            <li key={item.id} className="card open-case-row">
              <div className="open-case-main">
                <div className="open-case-top">
                  <Link to={`/cases/${item.id}`} className="case-title">
                    {item.title}
                  </Link>
                  <div className="open-case-badges">
                    <span className="badge badge-public">Public</span>
                    <span className={statusBadgeClass(item.status)}>{item.status}</span>
                  </div>
                </div>
                <p className="open-case-context">{item.clinicalContext}</p>
                <div className="open-case-meta">
                  {item.owner && <span>Propietario: {item.owner.displayName}</span>}
                  {item.modality && <span>{item.modality}</span>}
                  {item.studyReason && <span>{item.studyReason}</span>}
                </div>
                {(item.tags?.length ?? 0) > 0 && (
                  <div className="case-tags">
                    {item.tags.map((tag) => (
                      <span key={tag} className="badge">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="open-case-side">
                <span className="case-date">{new Date(item.updatedAt ?? item.createdAt).toLocaleDateString()}</span>
                <Link to={`/cases/${item.id}`}>Abrir caso</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
