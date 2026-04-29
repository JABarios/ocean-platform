import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { EegRecord } from '../types'
import PageHeader from '../components/PageHeader'
import './EegRecords.css'

function formatDate(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(new Date(value))
}

export default function EegRecords() {
  const [records, setRecords] = useState<EegRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<EegRecord[]>('/packages/eegs')
      .then(setRecords)
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>

  return (
    <div className="eeg-records">
      <PageHeader
        title="EEGs"
        subtitle="Registros compartidos, reutilización por hash y casos vinculados."
        aside={(
          <div className="records-summary card">
            <strong>{records.length}</strong>
            <span>Registros visibles</span>
          </div>
        )}
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="records-list">
        {records.map((record) => (
          <article key={record.id} className="card record-card">
            <div className="record-top">
              <div>
                <div className="hash-row">
                  <strong>Hash</strong>
                  <code>{record.blobHash}</code>
                </div>
                <div className="record-meta">
                  {(record.sizeBytes ? `${(record.sizeBytes / 1024 / 1024).toFixed(1)} MB` : 'Tamaño —')} · {record.encryptionMode} · {formatDate(record.createdAt)}
                </div>
                <div className="record-meta">
                  {record.uploader?.displayName ? `Subido inicialmente por ${record.uploader.displayName}` : 'Subida inicial no disponible'}
                </div>
              </div>
              <div className="usage-pill">
                <strong>{record.usageCount}</strong>
                <span>{record.usageCount === 1 ? 'caso' : 'casos'}</span>
              </div>
            </div>

            <div className="linked-cases">
              {record.cases.map((item) => (
                <div key={item.packageId} className="linked-case-row">
                  <div>
                    <Link to={`/cases/${item.caseId}`} className="linked-case-title">
                      {item.title || 'Caso sin título'}
                    </Link>
                    <div className="record-meta">
                      {item.owner?.displayName || 'Propietario'} · {item.status || '—'} · {formatDate(item.createdAt)}
                    </div>
                  </div>
                  <div className="linked-case-actions">
                    <Link to={`/cases/${item.caseId}`}>Detalle</Link>
                    <Link to={`/cases/${item.caseId}/eeg`} target="_blank" rel="noreferrer">EEG</Link>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}

        {records.length === 0 && (
          <div className="card empty-card">Todavía no hay registros EEG visibles para tu usuario.</div>
        )}
      </div>

    </div>
  )
}
