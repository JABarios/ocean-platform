import { Link, Navigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { useAuthStore } from '../store/authStore'
import './AdminHome.css'

const adminTools = [
  {
    title: 'Usuarios',
    description: 'Controla acceso, roles, actividad e inactividad de la red clínica.',
    to: '/admin/users',
  },
  {
    title: 'Limpieza',
    description: 'Revisa candidatos de mantenimiento, paquetes vencidos y estados antiguos.',
    to: '/admin/cleanup',
  },
]

const workspaceShortcuts = [
  {
    title: 'Nuevo caso',
    description: 'Crea un caso como cualquier clínico y prepara un EEG para revisión.',
    to: '/cases/new',
  },
  {
    title: 'Casos',
    description: 'Supervisa el flujo completo de casos abiertos, resueltos y archivados.',
    to: '/cases',
  },
  {
    title: 'Galerías',
    description: 'Gestiona colecciones de EEGs anonimizados o de libre distribución.',
    to: '/galleries',
  },
  {
    title: 'EEGs',
    description: 'Consulta registros reutilizados, deduplicación por hash y usos asociados.',
    to: '/eegs',
  },
]

export default function AdminHome() {
  const user = useAuthStore((s) => s.user)

  if (user?.role !== 'Admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="admin-home">
      <PageHeader
        title="Administración"
        subtitle="Herramientas de gobierno y mantenimiento, manteniendo además el mismo flujo clínico que el resto de usuarios."
      />

      <section className="admin-home-section">
        <div className="section-title">Panel admin</div>
        <div className="admin-home-grid">
          {adminTools.map((tool) => (
            <Link key={tool.to} to={tool.to} className="admin-home-card card">
              <div className="admin-home-card-top">
                <strong>{tool.title}</strong>
                <span className="admin-home-card-arrow">→</span>
              </div>
              <p>{tool.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="admin-home-section">
        <div className="section-title">Espacio de trabajo</div>
        <p className="admin-home-subtle">
          Como admin sigues teniendo el mismo panel clínico que un usuario normal. Estos accesos rápidos te llevan a las áreas principales.
        </p>
        <div className="admin-home-grid">
          {workspaceShortcuts.map((item) => (
            <Link key={item.to} to={item.to} className="admin-home-card card">
              <div className="admin-home-card-top">
                <strong>{item.title}</strong>
                <span className="admin-home-card-arrow">→</span>
              </div>
              <p>{item.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
