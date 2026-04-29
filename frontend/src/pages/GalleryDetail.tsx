import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { api, friendlyError } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { Gallery } from '../types'
import './GalleryDetail.css'

function formatDate(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value))
}

function formatSize(bytes?: number) {
  if (!bytes) return '—'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function GalleryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canManage = user?.role === 'Admin' || user?.role === 'Curator'
  const [gallery, setGallery] = useState<Gallery | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    source: '',
    license: '',
    visibility: 'Institutional',
    tags: '',
  })

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError('')
    api.get<Gallery>(`/galleries/${id}`)
      .then((data) => {
        setGallery(data)
        setForm({
          title: data.title,
          description: data.description || '',
          source: data.source || '',
          license: data.license || '',
          visibility: data.visibility,
          tags: data.tags.join(', '),
        })
      })
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (!id) return
    setSaving(true)
    setError('')
    try {
      const updated = await api.patch<Gallery>(`/galleries/${id}`, {
        ...form,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setGallery((current) => current ? { ...current, ...updated, records: current.records } : current)
      setEditing(false)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!id || !gallery) return
    const confirmed = window.confirm(`Se borrará la galería "${gallery.title}" completa. ¿Continuar?`)
    if (!confirmed) return
    setDeleting(true)
    setError('')
    try {
      await api.del(`/galleries/${id}`)
      navigate('/galleries')
    } catch (err) {
      setError(friendlyError(err))
      setDeleting(false)
    }
  }

  const filteredRecords = useMemo(() => {
    if (!gallery?.records) return []
    const needle = query.trim().toLowerCase()
    if (!needle) return gallery.records
    return gallery.records.filter((record) => {
      const tags = record.tags.join(' ')
      const filename = typeof record.metadata?.originalFilename === 'string' ? record.metadata.originalFilename : ''
      return `${record.label} ${tags} ${filename}`.toLowerCase().includes(needle)
    })
  }, [gallery, query])

  if (loading) return <div className="gallery-detail">Cargando galería…</div>

  return (
    <div className="gallery-detail">
      <PageHeader
        title={gallery?.title || 'Galería'}
        subtitle={gallery?.description || 'Colección de EEGs preparada para navegación directa y apertura en visor.'}
        aside={gallery ? (
          <div className="gallery-detail-summary card">
            <strong>{gallery.recordCount}</strong>
            <span>{gallery.recordCount === 1 ? 'registro' : 'registros'}</span>
          </div>
        ) : undefined}
      />

      {error && <div className="error-banner">{error}</div>}
      {!gallery && !error && <div className="card empty-card">Galería no encontrada.</div>}

      {gallery && (
        <>
          {canManage && (
            <section className="card gallery-manage">
              <div className="gallery-manage-header">
                <div className="section-title">Gestión de la galería</div>
                <div className="case-links">
                  {!editing && (
                    <button className="btn-secondary" type="button" onClick={() => setEditing(true)}>
                      Editar ficha
                    </button>
                  )}
                  <button className="btn-danger" type="button" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Borrando…' : 'Borrar galería'}
                  </button>
                </div>
              </div>

              {editing && (
                <form className="gallery-edit-form" onSubmit={handleSave}>
                  <input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} required />
                  <input value={form.source} onChange={(e) => setForm((current) => ({ ...current, source: e.target.value }))} placeholder="Fuente" />
                  <input value={form.license} onChange={(e) => setForm((current) => ({ ...current, license: e.target.value }))} placeholder="Licencia" />
                  <select value={form.visibility} onChange={(e) => setForm((current) => ({ ...current, visibility: e.target.value }))}>
                    <option value="Institutional">Institutional</option>
                    <option value="Public">Public</option>
                  </select>
                  <input value={form.tags} onChange={(e) => setForm((current) => ({ ...current, tags: e.target.value }))} placeholder="tags separados por comas" />
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                    rows={3}
                    placeholder="Descripción"
                  />
                  <div className="case-links">
                    <button className="btn-primary" type="submit" disabled={saving}>
                      {saving ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                    <button className="btn-secondary" type="button" onClick={() => setEditing(false)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          <section className="card gallery-detail-meta">
            <div><strong>Fuente:</strong> {gallery.source || '—'}</div>
            <div><strong>Licencia:</strong> {gallery.license || '—'}</div>
            <div><strong>Visibilidad:</strong> {gallery.visibility}</div>
            <div><strong>Creada:</strong> {formatDate(gallery.createdAt)}</div>
          </section>

          <section className="card gallery-filters">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filtrar por etiqueta, nombre o fichero original…"
            />
          </section>

          <section className="gallery-record-grid">
            {filteredRecords.map((record) => (
              <article key={record.id} className="card gallery-record-card">
                <div className="gallery-record-top">
                  <div>
                    <div className="gallery-record-title">{record.label}</div>
                    <div className="case-meta">
                      {formatSize(record.eegRecord?.sizeBytes)} · {record.eegRecord?.encryptionMode || '—'} · {formatDate(record.createdAt)}
                    </div>
                    {typeof record.metadata?.originalFilename === 'string' && (
                      <div className="case-meta">Origen: {record.metadata.originalFilename}</div>
                    )}
                  </div>
                  <div className="hash-mini">
                    <span>Hash</span>
                    <code>{record.eegRecord?.blobHash?.slice(0, 12) || '—'}</code>
                  </div>
                </div>

                {record.tags.length > 0 && (
                  <div className="gallery-tag-row">
                    {record.tags.map((tag) => <span key={tag} className="badge">{tag}</span>)}
                  </div>
                )}

                <div className="case-links">
                  <Link to={`/galleries/records/${record.id}/eeg`} target="_blank" rel="noreferrer">
                    Abrir EEG
                  </Link>
                </div>
              </article>
            ))}

            {filteredRecords.length === 0 && (
              <div className="card empty-card">No hay registros que coincidan con el filtro actual.</div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
