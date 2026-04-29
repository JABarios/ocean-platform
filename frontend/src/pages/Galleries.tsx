import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { api, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { Gallery } from '../types'
import './Galleries.css'

function formatDate(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value))
}

export default function Galleries() {
  const user = useAuthStore((s) => s.user)
  const canImport = user?.role === 'Admin' || user?.role === 'Curator'
  const [galleries, setGalleries] = useState<Gallery[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [importForm, setImportForm] = useState({
    title: '',
    description: '',
    source: '',
    license: '',
    visibility: 'Institutional',
    tags: '',
    directoryPath: '',
  })

  const loadGalleries = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get<Gallery[]>('/galleries')
      setGalleries(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGalleries()
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return galleries
    return galleries.filter((gallery) => {
      const haystack = [
        gallery.title,
        gallery.description,
        gallery.source,
        gallery.license,
        gallery.tags.join(' '),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [galleries, query])

  const handleImport = async (event: FormEvent) => {
    event.preventDefault()
    setImporting(true)
    setError('')
    try {
      await api.post('/galleries/import', {
        ...importForm,
        tags: importForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setImportForm({
        title: '',
        description: '',
        source: '',
        license: '',
        visibility: 'Institutional',
        tags: '',
        directoryPath: '',
      })
      await loadGalleries()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="galleries-page">
      <PageHeader
        title="Galerías"
        subtitle="Colecciones de EEGs anonimizados o de libre distribución, separadas del flujo clínico de casos."
        aside={(
          <div className="gallery-summary card">
            <strong>{galleries.length}</strong>
            <span>Galerías visibles</span>
          </div>
        )}
      />

      {error && <div className="error-banner">{error}</div>}

      <section className="card gallery-filters">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título, fuente, licencia o tags…"
        />
      </section>

      {canImport && (
        <section className="card gallery-import">
          <div className="section-title">Importar galería desde directorio del servidor</div>
          <p className="ops-subtle">
            OCEAN no descarga datasets por sí mismo. El directorio debe contener EDFs ya preparados por scripts externos.
          </p>
          <form className="gallery-import-form" onSubmit={handleImport}>
            <input
              value={importForm.title}
              onChange={(e) => setImportForm((current) => ({ ...current, title: e.target.value }))}
              placeholder="Título de la galería"
              required
            />
            <input
              value={importForm.directoryPath}
              onChange={(e) => setImportForm((current) => ({ ...current, directoryPath: e.target.value }))}
              placeholder="/ruta/en/el/servidor/al/directorio"
              required
            />
            <input
              value={importForm.source}
              onChange={(e) => setImportForm((current) => ({ ...current, source: e.target.value }))}
              placeholder="Fuente (p. ej. CHB-MIT)"
            />
            <input
              value={importForm.license}
              onChange={(e) => setImportForm((current) => ({ ...current, license: e.target.value }))}
              placeholder="Licencia / condiciones"
            />
            <input
              value={importForm.tags}
              onChange={(e) => setImportForm((current) => ({ ...current, tags: e.target.value }))}
              placeholder="Tags separados por comas"
            />
            <select
              value={importForm.visibility}
              onChange={(e) => setImportForm((current) => ({ ...current, visibility: e.target.value }))}
            >
              <option value="Institutional">Institutional</option>
              <option value="Public">Public</option>
            </select>
            <textarea
              value={importForm.description}
              onChange={(e) => setImportForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Descripción breve de la colección"
              rows={3}
            />
            <div className="gallery-import-actions">
              <button className="btn-primary" type="submit" disabled={importing}>
                {importing ? 'Importando…' : 'Importar galería'}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="gallery-grid">
        {filtered.map((gallery) => (
          <article key={gallery.id} className="card gallery-card">
            <div className="gallery-card-top">
              <div>
                <div className="gallery-title-row">
                  <Link to={`/galleries/${gallery.id}`} className="gallery-title-link">{gallery.title}</Link>
                  <span className="status-pill status-archived">{gallery.visibility}</span>
                </div>
                <div className="case-meta">
                  {gallery.source || 'Fuente —'} · {gallery.license || 'Licencia —'} · {formatDate(gallery.createdAt)}
                </div>
              </div>
              <div className="usage-pill">
                <strong>{gallery.recordCount}</strong>
                <span>{gallery.recordCount === 1 ? 'EEG' : 'EEGs'}</span>
              </div>
            </div>

            {gallery.description && <p className="gallery-description">{gallery.description}</p>}

            {gallery.tags.length > 0 && (
              <div className="gallery-tag-row">
                {gallery.tags.map((tag) => <span key={tag} className="badge">{tag}</span>)}
              </div>
            )}

            <div className="case-links">
              <Link to={`/galleries/${gallery.id}`}>Abrir galería</Link>
            </div>
          </article>
        ))}

        {!loading && filtered.length === 0 && (
          <div className="card empty-card">
            {galleries.length === 0
              ? 'Todavía no hay galerías cargadas.'
              : 'No hay galerías que coincidan con el filtro actual.'}
          </div>
        )}

        {loading && (
          <div className="card empty-card">Cargando galerías…</div>
        )}
      </section>
    </div>
  )
}
