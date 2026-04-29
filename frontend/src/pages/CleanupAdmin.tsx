import { useEffect, useMemo, useState } from 'react'
import { api, friendlyError } from '../api/client'
import PageHeader from '../components/PageHeader'
import './CleanupAdmin.css'

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
      <PageHeader
        title="Panel de limpieza"
        subtitle="Revisa candidatos, estima impacto y ejecuta solo tareas seguras de mantenimiento."
        actions={(
          <>
            <button className="btn-secondary" onClick={refreshReport} disabled={loading || running}>
              {loading ? 'Actualizando…' : 'Actualizar reporte'}
            </button>
            <button className="btn-primary" onClick={handleRun} disabled={running || selectedTasks.length === 0}>
              {running ? 'Ejecutando…' : 'Ejecutar limpieza segura'}
            </button>
          </>
        )}
      />

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

    </div>
  )
}
