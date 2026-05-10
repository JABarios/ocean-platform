import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { NotificationItem } from '../types'
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushDiagnostics,
  getPushState,
  resetPushSubscription,
} from '../push'
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
  const [pushBusy, setPushBusy] = useState(false)
  const [pushState, setPushState] = useState<{
    supported: boolean
    permission: string
    subscribed: boolean
  }>({
    supported: false,
    permission: 'default',
    subscribed: false,
  })
  const [pushDiagnostics, setPushDiagnostics] = useState<any | null>(null)
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramStatus, setTelegramStatus] = useState<{
    configured: boolean
    botUsername: string | null
    linked: boolean
    username: string | null
    linkedAt: string | null
    notificationsEnabled: boolean
  } | null>(null)
  const [telegramConnectUrl, setTelegramConnectUrl] = useState<string | null>(null)

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
    getPushState().then(setPushState).catch(() => {})
    getPushDiagnostics().then(setPushDiagnostics).catch(() => {})
    loadTelegramStatus().catch(() => {})
  }, [])

  const loadTelegramStatus = async () => {
    const status = await api.get<{
      configured: boolean
      botUsername: string | null
      linked: boolean
      username: string | null
      linkedAt: string | null
      notificationsEnabled: boolean
    }>('/telegram/status')
    setTelegramStatus(status)
  }

  const refreshPushDebug = async () => {
    setPushState(await getPushState())
    setPushDiagnostics(await getPushDiagnostics())
  }

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

  const handleEnablePush = async () => {
    setPushBusy(true)
    setError('')
    try {
      await enablePushNotifications()
      await refreshPushDebug()
    } catch (err) {
      setError(friendlyError(err))
      getPushDiagnostics().then(setPushDiagnostics).catch(() => {})
    } finally {
      setPushBusy(false)
    }
  }

  const handleDisablePush = async () => {
    setPushBusy(true)
    setError('')
    try {
      await disablePushNotifications()
      await refreshPushDebug()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPushBusy(false)
    }
  }

  const handleEnableTelegram = async () => {
    setTelegramBusy(true)
    setError('')
    try {
      const data = await api.post<{ connectUrl: string | null; botUsername: string | null }>('/telegram/link')
      setTelegramConnectUrl(data.connectUrl)
      await loadTelegramStatus()
      if (data.connectUrl) {
        window.open(data.connectUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setTelegramBusy(false)
    }
  }

  const handleRefreshTelegram = async () => {
    setTelegramBusy(true)
    setError('')
    try {
      await loadTelegramStatus()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setTelegramBusy(false)
    }
  }

  const handleUnlinkTelegram = async () => {
    setTelegramBusy(true)
    setError('')
    try {
      await api.post('/telegram/unlink')
      setTelegramConnectUrl(null)
      await loadTelegramStatus()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setTelegramBusy(false)
    }
  }

  const handleResetPush = async () => {
    setPushBusy(true)
    setError('')
    try {
      await resetPushSubscription()
      await refreshPushDebug()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPushBusy(false)
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

      <section className="card notifications-push-card">
        <div>
          <p className="eyebrow">Dispositivo</p>
          <h2>Avisos push</h2>
          <p className="page-subtitle">
            Recibe avisos en este móvil incluso cuando OCEAN no esté abierto.
          </p>
          <div className="notifications-push-state">
            {!pushState.supported && <span className="badge">No soportado</span>}
            {pushState.supported && pushState.subscribed && <span className="badge badge-success">Activos</span>}
            {pushState.supported && !pushState.subscribed && pushState.permission !== 'denied' && (
              <span className="badge badge-pending">Inactivos</span>
            )}
            {pushState.supported && pushState.permission === 'denied' && (
              <span className="badge badge-danger">Bloqueados</span>
            )}
          </div>
        </div>
        <div className="notifications-push-actions">
          {pushState.supported && !pushState.subscribed && pushState.permission !== 'denied' && (
            <button className="btn-primary" onClick={handleEnablePush} disabled={pushBusy}>
              Activar avisos en este dispositivo
            </button>
          )}
          {pushState.supported && pushState.subscribed && (
            <button className="btn-secondary" onClick={handleDisablePush} disabled={pushBusy}>
              Desactivar avisos
            </button>
          )}
          {pushState.supported && (
            <button className="btn-secondary" onClick={handleResetPush} disabled={pushBusy}>
              Resetear suscripción
            </button>
          )}
          {pushState.permission === 'denied' && (
            <p className="muted">
              El navegador ha bloqueado los avisos. Toca reactivarlos desde la configuración del sitio.
            </p>
          )}
        </div>
      </section>

      <section className="card notifications-push-card">
        <div>
          <h2>Telegram</h2>
          <p className="page-subtitle">
            Avisos alternativos por bot de Telegram para invitaciones de revisión y grupos.
          </p>
          <div className="notifications-push-state">
            {!telegramStatus?.configured && <span className="badge">No configurado</span>}
            {telegramStatus?.configured && telegramStatus.linked && (
              <span className="badge badge-success">Activo</span>
            )}
            {telegramStatus?.configured && !telegramStatus.linked && (
              <span className="badge badge-pending">Inactivo</span>
            )}
          </div>
          {telegramStatus?.linked && (
            <p className="muted telegram-summary">
              Vinculado{telegramStatus.username ? ` como @${telegramStatus.username}` : ''}{telegramStatus.linkedAt ? ` · ${formatTimestamp(telegramStatus.linkedAt)}` : ''}
            </p>
          )}
          {!telegramStatus?.linked && telegramStatus?.botUsername && (
            <p className="muted telegram-summary">
              Se abrirá el bot @{telegramStatus.botUsername}. Pulsa <strong>Start</strong> en Telegram y vuelve luego a esta pantalla.
            </p>
          )}
          {!telegramStatus?.linked && telegramConnectUrl && (
            <p className="muted telegram-summary">
              Si Telegram no se abrió solo, usa este enlace:
              {' '}
              <a href={telegramConnectUrl} target="_blank" rel="noreferrer">abrir bot</a>
            </p>
          )}
        </div>
        <div className="notifications-push-actions">
          {telegramStatus?.configured && !telegramStatus.linked && (
            <button className="btn-primary" onClick={handleEnableTelegram} disabled={telegramBusy}>
              Activar Telegram
            </button>
          )}
          <button className="btn-secondary" onClick={handleRefreshTelegram} disabled={telegramBusy}>
            Refrescar Telegram
          </button>
          {telegramStatus?.linked && (
            <button className="btn-secondary" onClick={handleUnlinkTelegram} disabled={telegramBusy}>
              Desvincular Telegram
            </button>
          )}
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {pushDiagnostics && (
        <section className="card notifications-debug-card">
          <div className="notifications-debug-head">
            <div>
              <h2>Diagnóstico push</h2>
              <p className="page-subtitle">
                Datos del dispositivo para entender por qué falla el alta de avisos.
              </p>
            </div>
            <button className="btn-secondary" onClick={refreshPushDebug} disabled={pushBusy}>
              Refrescar diagnóstico
            </button>
          </div>
          <div className="notifications-debug-grid">
            <div><strong>Permission</strong><span>{pushDiagnostics.permission}</span></div>
            <div><strong>Service Worker</strong><span>{pushDiagnostics.support?.serviceWorker ? 'sí' : 'no'}</span></div>
            <div><strong>PushManager</strong><span>{pushDiagnostics.support?.pushManager ? 'sí' : 'no'}</span></div>
            <div><strong>Modo app</strong><span>{pushDiagnostics.support?.standalone ? 'standalone' : 'navegador'}</span></div>
            <div><strong>Worker activo</strong><span>{pushDiagnostics.workerActive ? 'sí' : 'no'}</span></div>
            <div><strong>Worker instalando</strong><span>{pushDiagnostics.workerInstalling ? 'sí' : 'no'}</span></div>
            <div><strong>Worker esperando</strong><span>{pushDiagnostics.workerWaiting ? 'sí' : 'no'}</span></div>
            <div><strong>Página controlada</strong><span>{pushDiagnostics.controlledPage ? 'sí' : 'no'}</span></div>
            <div><strong>Scope SW</strong><span>{pushDiagnostics.workerScope || '—'}</span></div>
            <div><strong>Suscripción actual</strong><span>{pushDiagnostics.subscribed ? 'sí' : 'no'}</span></div>
            <div><strong>Endpoint</strong><span>{pushDiagnostics.endpointPreview || '—'}</span></div>
            <div><strong>VAPID configurado</strong><span>{pushDiagnostics.vapidConfigured ? 'sí' : 'no'}</span></div>
            <div><strong>Longitud VAPID pública</strong><span>{pushDiagnostics.vapidPublicKeyLength || 0}</span></div>
            <div><strong>Prefijo VAPID</strong><span>{pushDiagnostics.vapidPublicKeyPrefix || '—'}</span></div>
          </div>
        </section>
      )}

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
