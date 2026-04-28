import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { EegRecord } from '../types'

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
      <div className="records-header">
        <div>
          <h2>EEGs</h2>
          <p className="records-subtle">Registros compartidos, reutilización por hash y casos vinculados.</p>
        </div>
        <div className="records-summary card">
          <strong>{records.length}</strong>
          <span>Registros visibles</span>
        </div>
      </div>

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

      <style>{`
        .eeg-records {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .records-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .records-header h2 {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .records-subtle, .record-meta {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
        .records-summary {
          min-width: 140px;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          align-items: center;
          justify-content: center;
        }
        .records-summary strong, .usage-pill strong {
          font-size: 1.15rem;
        }
        .records-summary span, .usage-pill span {
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .error-banner {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
          padding: 0.6rem 1rem;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        .records-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .record-card {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
        }
        .record-top, .linked-case-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
          align-items: flex-start;
        }
        .hash-row {
          display: flex;
          gap: 0.55rem;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 0.25rem;
        }
        .hash-row code {
          font-size: 0.8rem;
          background: #f8fafc;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 0.35rem 0.55rem;
          word-break: break-all;
        }
        .usage-pill {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          padding: 0.7rem 0.85rem;
          min-width: 90px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.2rem;
        }
        .linked-cases {
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
        }
        .linked-case-row {
          border-top: 1px solid var(--border);
          padding-top: 0.7rem;
        }
        .linked-case-title {
          font-weight: 600;
        }
        .linked-case-actions {
          display: flex;
          gap: 0.8rem;
          flex-wrap: wrap;
          font-size: 0.9rem;
        }
        .empty-card {
          color: var(--text-secondary);
          text-align: center;
        }
      `}</style>
    </div>
  )
}
