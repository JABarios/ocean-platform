import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { NotificationItem } from '../types'
import './Notifications.css'

function formatTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

function destinationForNotification(item: NotificationItem) {
  if (item.caseId) return `/cases/${item.caseId}`
  return '/groups'
}

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const unreadCount = useMemo(() => items.filter((item) => !item.readAt).length, [items])

  const loadNotifications = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get<NotificationItem[]>('/notifications')
      setItems(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
  }, [])

  const markOneRead = async (notificationId: string) => {
    try {
      const updated = await api.post<NotificationItem>(`/notifications/${notificationId}/read`)
      setItems((current) => current.map((item) => (item.id === notificationId ? updated : item)))
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  const handleMarkAllRead = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post('/notifications/read-all')
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="notifications-page">
      <section className="page-hero card notifications-hero">
        <div>
          <p className="eyebrow">Actividad</p>
          <h1>Notificaciones</h1>
          <p className="page-subtitle">
            Avisos internos sobre revisiones, grupos y comentarios recientes.
          </p>
        </div>
        <div className="notifications-hero-actions">
          <div className="notification-kpi">
            <span className="notification-kpi-value">{unreadCount}</span>
            <span className="notification-kpi-label">sin leer</span>
          </div>
          <button className="btn-secondary" onClick={handleMarkAllRead} disabled={busy || unreadCount === 0}>
            Marcar todas como leídas
          </button>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="card muted">Cargando notificaciones…</div>
      ) : items.length === 0 ? (
        <div className="card muted">No tienes notificaciones todavía.</div>
      ) : (
        <div className="notifications-list">
          {items.map((item) => (
            <article key={item.id} className={`card notification-card${item.readAt ? '' : ' unread'}`}>
              <div className="notification-card-main">
                <div className="notification-card-head">
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.body}</p>
                  </div>
                  {!item.readAt && <span className="badge badge-pending">Nueva</span>}
                </div>
                <div className="notification-card-meta">
                  <span>{formatTimestamp(item.createdAt)}</span>
                  {item.actor?.displayName && <span>Por {item.actor.displayName}</span>}
                  {item.case?.title && <span>{item.case.title}</span>}
                </div>
              </div>
              <div className="notification-card-actions">
                <Link className="btn-primary" to={destinationForNotification(item)}>
                  Abrir
                </Link>
                {!item.readAt && (
                  <button className="btn-secondary" onClick={() => markOneRead(item.id)}>
                    Marcar como leída
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
