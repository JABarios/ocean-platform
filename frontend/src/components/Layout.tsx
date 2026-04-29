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
            <Link to="/eegs" className={navLinkClass('/eegs')}>
              EEGs
            </Link>
            <Link to="/galleries" className={navLinkClass('/galleries')}>
              Galerías
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
    </div>
  )
}
