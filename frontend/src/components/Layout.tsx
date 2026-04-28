import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function Layout({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const navLinkClass = (path: string) =>
    location.pathname === path ? 'nav-link active' : 'nav-link'

  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="logo">
            OCEAN
          </Link>
          <nav className="main-nav">
            <Link to="/" className={navLinkClass('/')}>
              Dashboard
            </Link>
            <Link to="/cases/new" className={navLinkClass('/cases/new')}>
              Nuevo Caso
            </Link>
            <Link to="/cases/manage" className={navLinkClass('/cases/manage')}>
              Gestión
            </Link>
            <Link to="/library" className={navLinkClass('/library')}>
              Biblioteca Docente
            </Link>
            <Link to="/queue" className={navLinkClass('/queue')}>
              Cola de propuestas
            </Link>
            {user?.role === 'Admin' && (
              <>
                <Link to="/admin/users" className={navLinkClass('/admin/users')}>
                  Usuarios
                </Link>
                <Link to="/admin/cleanup" className={navLinkClass('/admin/cleanup')}>
                  Limpieza
                </Link>
              </>
            )}
          </nav>
          <div className="header-actions">
            {user && (
              <span className="user-name" title={user.email}>
                {user.displayName}
              </span>
            )}
            <button className="btn-secondary" onClick={handleLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main className="main-content">{children}</main>
      <style>{`
        .layout {
          min-height: 100%;
          display: flex;
          flex-direction: column;
        }
        .app-header {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .header-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 0 1.25rem;
          height: 56px;
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }
        .logo {
          font-weight: 700;
          font-size: 1.1rem;
          color: var(--text);
          letter-spacing: 0.05em;
        }
        .main-nav {
          display: flex;
          gap: 1rem;
          flex: 1;
        }
        .nav-link {
          color: var(--text-secondary);
          font-size: 0.9rem;
          font-weight: 500;
          padding: 0.35rem 0.2rem;
          border-bottom: 2px solid transparent;
          transition: color 0.15s;
        }
        .nav-link:hover,
        .nav-link.active {
          color: var(--text);
          border-bottom-color: var(--primary);
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .user-name {
          font-size: 0.85rem;
          color: var(--text-secondary);
          max-width: 160px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .main-content {
          flex: 1;
          max-width: 1100px;
          width: 100%;
          margin: 0 auto;
          padding: 1.5rem 1.25rem;
        }
      `}</style>
    </div>
  )
}
