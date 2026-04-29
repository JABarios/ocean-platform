import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import './Layout.css'

export default function Layout({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const navigate = useNavigate()

  const handleLogout = () => {
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

  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-inner">
          <Link to="/" className="logo">
            OCEAN
          </Link>
          <nav className="main-nav">
            <Link to="/" className={navLinkClass('/')}>
              Inicio
            </Link>
            <Link to="/cases/new" className={navLinkClass('/cases/new')}>
              Nuevo Caso
            </Link>
            <Link to="/cases" className={navLinkClass('/cases', '/cases/manage')}>
              Casos
            </Link>
            <Link to="/galleries" className={navLinkClass('/galleries')}>
              Galerías
            </Link>
            <Link to="/eegs" className={navLinkClass('/eegs')}>
              EEGs
            </Link>
            <Link to="/library" className={navLinkClass('/library')}>
              Biblioteca
            </Link>
            <Link to="/queue" className={navLinkClass('/queue')}>
              Cola docente
            </Link>
            {user?.role === 'Admin' && (
              <Link to="/admin" className={navLinkClass('/admin')}>
                Admin
              </Link>
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
    </div>
  )
}
