import { useEffect, useMemo, useState } from 'react'
import { api, friendlyError } from '../api/client'

type CleanupTaskName =
  | 'expiredRequests'
  | 'expiredPackages'
  | 'archivedPackages'
  | 'staleViewerStates'
  | 'oldDraftCases'

type RunnableCleanupTaskName =
  | 'expiredRequests'
  | 'expiredPackages'
  | 'archivedPackages'
  | 'staleViewerStates'

interface CleanupTaskReport {
  count: number
  totalBytes?: number
  items: Array<Record<string, unknown>>
}

interface CleanupReport {
  generatedAt: string
  tasks: Record<CleanupTaskName, CleanupTaskReport>
}

interface CleanupRunResult {
  task: RunnableCleanupTaskName
  affected: number
  freedBytes?: number
}

interface CleanupRunResponse {
  executedAt: string
  tasks: RunnableCleanupTaskName[]
  results: CleanupRunResult[]
}

const TASK_LABELS: Record<CleanupTaskName, string> = {
  expiredRequests: 'Solicitudes vencidas',
  expiredPackages: 'Paquetes vencidos',
  archivedPackages: 'Paquetes de archivados',
  staleViewerStates: 'Estados de visor antiguos',
  oldDraftCases: 'Drafts antiguos',
}

const RUNNABLE_TASKS: RunnableCleanupTaskName[] = [
  'expiredRequests',
  'expiredPackages',
  'archivedPackages',
  'staleViewerStates',
]

function formatBytes(bytes?: number) {
  const value = bytes ?? 0
  if (value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function CleanupAdmin() {
  const [report, setReport] = useState<CleanupReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [selectedTasks, setSelectedTasks] = useState<RunnableCleanupTaskName[]>([...RUNNABLE_TASKS])
  const [lastRun, setLastRun] = useState<CleanupRunResponse | null>(null)

  const refreshReport = async () => {
    setError('')
    setLoading(true)
    try {
      const next = await api.get<CleanupReport>('/cleanup/report')
      setReport(next)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshReport()
  }, [])

  const toggleTask = (task: RunnableCleanupTaskName) => {
    setSelectedTasks((current) =>
      current.includes(task)
        ? current.filter((item) => item !== task)
        : [...current, task],
    )
  }

  const totalRunnableBytes = useMemo(() => {
    if (!report) return 0
    return selectedTasks.reduce((sum, task) => sum + (report.tasks[task].totalBytes ?? 0), 0)
  }, [report, selectedTasks])

  const handleRun = async () => {
    if (selectedTasks.length === 0) {
      setError('Selecciona al menos una tarea segura para ejecutar.')
      return
    }

    const totalAffected = report
      ? selectedTasks.reduce((sum, task) => sum + report.tasks[task].count, 0)
      : 0

    const confirmed = window.confirm(
      `Se ejecutarán ${selectedTasks.length} tareas de limpieza sobre ${totalAffected} elementos candidatos. ¿Continuar?`,
    )
    if (!confirmed) return

    setRunning(true)
    setError('')
    try {
      const result = await api.post<CleanupRunResponse>('/cleanup/run', { tasks: selectedTasks })
      setLastRun(result)
      await refreshReport()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setRunning(false)
    }
  }

  if (loading && !report) {
    return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando reporte…</div>
  }

  return (
    <div className="cleanup-admin">
      <div className="cleanup-header">
        <div>
          <h2>Panel de limpieza</h2>
          <p className="cleanup-subtitle">
            Revisa candidatos, estima impacto y ejecuta solo tareas seguras.
          </p>
        </div>
        <div className="cleanup-header-actions">
          <button className="btn-secondary" onClick={refreshReport} disabled={loading || running}>
            {loading ? 'Actualizando…' : 'Actualizar reporte'}
          </button>
          <button className="btn-primary" onClick={handleRun} disabled={running || selectedTasks.length === 0}>
            {running ? 'Ejecutando…' : 'Ejecutar limpieza segura'}
          </button>
        </div>
      </div>

      {error && <div className="cleanup-error">{error}</div>}

      {report && (
        <>
          <div className="cleanup-summary card">
            <div>
              <span className="summary-label">Reporte generado</span>
              <strong>{new Date(report.generatedAt).toLocaleString()}</strong>
            </div>
            <div>
              <span className="summary-label">Tareas seleccionadas</span>
              <strong>{selectedTasks.length}</strong>
            </div>
            <div>
              <span className="summary-label">Bytes liberables</span>
              <strong>{formatBytes(totalRunnableBytes)}</strong>
            </div>
          </div>

          <div className="task-picker card">
            <h3>Tareas seguras ejecutables</h3>
            <div className="task-picker-grid">
              {RUNNABLE_TASKS.map((task) => {
                const checked = selectedTasks.includes(task)
                const taskReport = report.tasks[task]
                return (
                  <label key={task} className={`task-chip ${checked ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTask(task)}
                    />
                    <span className="task-chip-body">
                      <strong>{TASK_LABELS[task]}</strong>
                      <span>{taskReport.count} candidatos</span>
                      {'totalBytes' in taskReport && (
                        <span>{formatBytes(taskReport.totalBytes)}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="cleanup-cards">
            {(Object.keys(report.tasks) as CleanupTaskName[]).map((task) => {
              const taskReport = report.tasks[task]
              return (
                <section key={task} className="cleanup-card card">
                  <div className="cleanup-card-header">
                    <div>
                      <h3>{TASK_LABELS[task]}</h3>
                      <p>{task}</p>
                    </div>
                    <div className="cleanup-card-metrics">
                      <strong>{taskReport.count}</strong>
                      {typeof taskReport.totalBytes === 'number' && (
                        <span>{formatBytes(taskReport.totalBytes)}</span>
                      )}
                    </div>
                  </div>
                  {taskReport.items.length === 0 ? (
                    <p className="cleanup-empty">No hay candidatos actualmente.</p>
                  ) : (
                    <div className="cleanup-items">
                      {taskReport.items.slice(0, 8).map((item, index) => (
                        <pre key={index} className="cleanup-item">
                          {JSON.stringify(item, null, 2)}
                        </pre>
                      ))}
                      {taskReport.items.length > 8 && (
                        <div className="cleanup-more">
                          +{taskReport.items.length - 8} elementos más en el reporte
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}

      {lastRun && (
        <section className="cleanup-last-run card">
          <h3>Última ejecución</h3>
          <p className="cleanup-subtitle">
            {new Date(lastRun.executedAt).toLocaleString()}
          </p>
          <div className="cleanup-run-results">
            {lastRun.results.map((result) => (
              <div key={result.task} className="cleanup-run-result">
                <strong>{TASK_LABELS[result.task]}</strong>
                <span>{result.affected} afectados</span>
                {typeof result.freedBytes === 'number' && <span>{formatBytes(result.freedBytes)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      <style>{`
        .cleanup-admin {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .cleanup-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
        }
        .cleanup-header h2 {
          font-size: 1.2rem;
          font-weight: 600;
        }
        .cleanup-subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-top: 0.2rem;
        }
        .cleanup-header-actions {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        .cleanup-error {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
          padding: 0.7rem 0.9rem;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        .cleanup-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 1rem;
        }
        .summary-label {
          display: block;
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 0.2rem;
        }
        .task-picker h3,
        .cleanup-last-run h3 {
          font-size: 1rem;
          margin-bottom: 0.75rem;
        }
        .task-picker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 0.75rem;
        }
        .task-chip {
          display: flex;
          gap: 0.7rem;
          align-items: flex-start;
          padding: 0.8rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: pointer;
          background: #f8fafc;
        }
        .task-chip.selected {
          border-color: #93c5fd;
          background: #eff6ff;
        }
        .task-chip input {
          width: auto;
          margin-top: 0.15rem;
        }
        .task-chip-body {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          font-size: 0.84rem;
          color: var(--text-secondary);
        }
        .task-chip-body strong {
          color: var(--text);
        }
        .cleanup-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
          gap: 1rem;
        }
        .cleanup-card {
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }
        .cleanup-card-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
        }
        .cleanup-card-header h3 {
          font-size: 1rem;
          margin-bottom: 0.1rem;
        }
        .cleanup-card-header p {
          color: var(--text-secondary);
          font-size: 0.8rem;
          font-family: monospace;
        }
        .cleanup-card-metrics {
          text-align: right;
          display: flex;
          flex-direction: column;
          gap: 0.1rem;
        }
        .cleanup-card-metrics strong {
          font-size: 1.15rem;
        }
        .cleanup-card-metrics span {
          color: var(--text-secondary);
          font-size: 0.8rem;
        }
        .cleanup-empty {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
        .cleanup-items {
          display: flex;
          flex-direction: column;
          gap: 0.55rem;
        }
        .cleanup-item {
          margin: 0;
          background: #f8fafc;
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.7rem;
          font-size: 0.74rem;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
          color: #334155;
        }
        .cleanup-more {
          color: var(--text-secondary);
          font-size: 0.8rem;
        }
        .cleanup-run-results {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.75rem;
          margin-top: 0.8rem;
        }
        .cleanup-run-result {
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.75rem;
          background: #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .cleanup-run-result span {
          color: var(--text-secondary);
          font-size: 0.84rem;
        }
        @media (max-width: 720px) {
          .cleanup-header {
            flex-direction: column;
          }
          .cleanup-header-actions {
            width: 100%;
          }
        }
      `}</style>
    </div>
  )
}
