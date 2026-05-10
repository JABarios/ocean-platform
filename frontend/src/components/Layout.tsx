import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hasAvailableAction } from '../utils/teachingState'
import { api } from '../api/client'
import './Layout.css'

export default function Layout({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const location = useLocation()
  const navigate = useNavigate()
  const [accountOpen, setAccountOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const accountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  useEffect(() => {
    if (!token) return

    let cancelled = false

    const loadUnreadCount = async () => {
      try {
        const response = await api.get<{ count: number }>('/notifications/unread-count')
        if (!cancelled) {
          setUnreadCount(response.count || 0)
        }
      } catch {
        if (!cancelled) {
          setUnreadCount(0)
        }
      }
    }

    loadUnreadCount()
    const timer = window.setInterval(loadUnreadCount, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [token, location.pathname])

  const handleLogout = () => {
    setAccountOpen(false)
    logout()
    navigate('/login')
  }

  const navLinkClass = (...paths: string[]) =>
    paths.some((path) => {
      if (path === '/') return location.pathname === '/'
      return location.pathname === path || location.pathname.startsWith(`${path}/`)
    })
      ? 'nav-link active'
      : 'nav-link'

  const exploreLinkClass = (...paths: string[]) =>
    paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
      ? 'subnav-link active'
      : 'subnav-link'

  const showExploreSubnav = ['/explore', '/galleries', '/library', '/eegs', '/queue'].some((path) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`)
  )
  const canAccessAdmin = hasAvailableAction(user?.availableActions, 'access_admin')
  const canViewTeachingQueue = hasAvailableAction(user?.availableActions, 'view_teaching_queue')

  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="logo">
            OCEAN
          </Link>
          <nav className="main-nav">
            <Link to="/" className={navLinkClass('/')}>
              Mis casos
            </Link>
            <Link to="/cases/open" className={navLinkClass('/cases/open')}>
              Casos abiertos
            </Link>
            <Link to="/groups" className={navLinkClass('/groups')}>
              Grupos
            </Link>
            <Link to="/explore" className={navLinkClass('/explore', '/galleries', '/eegs', '/library', '/queue')}>
              Explorar
            </Link>
            <Link to="/share/new" className={navLinkClass('/share/new', '/shared/new')}>
              Compartir EEG
            </Link>
            {canAccessAdmin && (
              <Link to="/admin" className={navLinkClass('/admin')}>
                Admin
              </Link>
            )}
          </nav>
          <div className="header-actions">
            {user && (
              <>
                <Link
                  to="/notifications"
                  className={`notification-link${location.pathname.startsWith('/notifications') ? ' active' : ''}`}
                  aria-label="Notificaciones"
                  title="Notificaciones"
                >
                  <span className="notification-link-icon" aria-hidden="true">
                    Campana
                  </span>
                  {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
                </Link>
                <div className="account-menu" ref={accountRef}>
                  <button
                    type="button"
                    className={`account-chip account-chip-button${accountOpen ? ' open' : ''}`}
                    title={user.email}
                    onClick={() => setAccountOpen((current) => !current)}
                  >
                    <span className="account-chip-name">{user.displayName}</span>
                  </button>
                  {accountOpen && (
                    <div className="account-dropdown">
                      <div className="account-dropdown-copy">
                        <strong>{user.displayName}</strong>
                        <span>{user.email}</span>
                      </div>
                      <button className="account-dropdown-action" onClick={handleLogout}>
                        Cerrar sesión
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        {showExploreSubnav && (
          <div className="subnav-shell">
            <div className="subnav explore-subnav">
              <Link to="/galleries" className={exploreLinkClass('/galleries', '/explore')}>
                Galerías
              </Link>
              <Link to="/library" className={exploreLinkClass('/library')}>
                Biblioteca
              </Link>
              <Link to="/eegs" className={exploreLinkClass('/eegs')}>
                EEG
              </Link>
              {canViewTeachingQueue && (
                <Link to="/queue" className={exploreLinkClass('/queue')}>
                  Casos propuestos
                </Link>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="main-content">{children}</main>
    </div>
  )
}
