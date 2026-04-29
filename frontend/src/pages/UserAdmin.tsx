import { useEffect, useMemo, useState } from 'react'
import { api, friendlyError } from '../api/client'
import type { User } from '../types'
import { useAuthStore } from '../store/authStore'
import PageHeader from '../components/PageHeader'
import './UserAdmin.css'

const VALID_ROLES = ['Clinician', 'Reviewer', 'Curator', 'Admin'] as const
const VALID_STATUSES = ['all', 'Active', 'Pending'] as const
type Role = typeof VALID_ROLES[number]
type StatusFilter = typeof VALID_STATUSES[number]

function formatDate(value?: string) {
  if (!value) return 'Nunca'
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function UserAdmin() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    api.get<User[]>('/users')
      .then(setUsers)
      .catch((err) => setError(friendlyError(err)))
      .finally(() => setLoading(false))
  }, [])

  const changeRole = async (userId: string, role: Role) => {
    setBusy(userId)
    setError('')
    try {
      const updated = await api.patch<User>(`/users/${userId}/role`, { role })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const setUserStatus = async (user: User, status: 'Active' | 'Pending') => {
    const verb = status === 'Active' ? 'reactivar' : 'dar de baja'
    const confirmed = window.confirm(`Se va a ${verb} al usuario ${user.displayName}. ¿Continuar?`)
    if (!confirmed) return

    setBusy(user.id)
    setError('')
    try {
      const updated = await api.patch<User>(`/users/${user.id}/status`, { status })
      setUsers((prev) => prev.map((entry) => (entry.id === updated.id ? { ...entry, ...updated } : entry)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  const visibleUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false
      if (statusFilter !== 'all' && user.status !== statusFilter) return false
      if (!q) return true
      const haystack = [
        user.displayName,
        user.email,
        user.institution || '',
        user.specialty || '',
        ...(user.groups?.map((group) => group.name) || []),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }, [users, search, roleFilter, statusFilter])

  const summary = useMemo(() => ({
    total: users.length,
    active: users.filter((user) => user.status === 'Active').length,
    inactive: users.filter((user) => user.status !== 'Active').length,
    admins: users.filter((user) => user.role === 'Admin').length,
  }), [users])

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>

  return (
    <div className="user-admin">
      <PageHeader
        title="Administración de usuarios"
        subtitle="Control de acceso, actividad y carga operativa de la red clínica OCEAN."
        aside={(
          <div className="summary-grid">
            <div className="summary-card"><strong>{summary.total}</strong><span>Total</span></div>
            <div className="summary-card"><strong>{summary.active}</strong><span>Activos</span></div>
            <div className="summary-card"><strong>{summary.inactive}</strong><span>Inactivos</span></div>
            <div className="summary-card"><strong>{summary.admins}</strong><span>Admins</span></div>
          </div>
        )}
      />

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar card">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre, email, centro o grupo"
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as 'all' | Role)}>
          <option value="all">Todos los roles</option>
          {VALID_ROLES.map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Todos los estados</option>
          <option value="Active">Activos</option>
          <option value="Pending">Inactivos</option>
        </select>
      </div>

      <table className="users-table card">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Estado</th>
            <th>Rol</th>
            <th>Casos</th>
            <th>Revisiones</th>
            <th>Último acceso</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {visibleUsers.map((u) => (
            <tr key={u.id}>
              <td>
                <div className="user-cell">
                  <div className="user-top-row">
                    <strong>{u.displayName}</strong>
                    <span className={`status-pill ${u.status === 'Active' ? 'active' : 'inactive'}`}>
                      {u.status === 'Active' ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <div className="user-meta">{u.email}</div>
                  <div className="user-meta">
                    {[u.institution, u.specialty].filter(Boolean).join(' · ') || 'Sin centro / especialidad'}
                  </div>
                  {u.groups && u.groups.length > 0 && (
                    <div className="chip-row">
                      {u.groups.map((group) => (
                        <span key={group.id} className="group-chip">{group.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </td>
              <td>
                <div className="tiny-metric">
                  <span>{u.status === 'Active' ? 'Operativo' : 'Fuera de acceso'}</span>
                  <small>Alta: {formatDate(u.createdAt)}</small>
                </div>
              </td>
              <td>
                <select
                  value={u.role}
                  disabled={busy === u.id}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                >
                  {VALID_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td>
                <div className="tiny-metric">
                  <span>{u.metrics?.casesCreated ?? 0} creados</span>
                </div>
              </td>
              <td>
                <div className="tiny-metric">
                  <span>{u.metrics?.pendingReviews ?? 0} pend.</span>
                  <small>{u.metrics?.activeReviews ?? 0} activas · {u.metrics?.completedReviews ?? 0} cerradas</small>
                </div>
              </td>
              <td className="last-access-cell">{formatDate(u.lastLoginAt)}</td>
              <td>
                {u.id === currentUser?.id ? (
                  <span className="self-note">Tu cuenta</span>
                ) : u.status === 'Active' ? (
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => setUserStatus(u, 'Pending')}
                    disabled={busy === u.id}
                  >
                    Dar de baja
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setUserStatus(u, 'Active')}
                    disabled={busy === u.id}
                  >
                    Reactivar
                  </button>
                )}
              </td>
            </tr>
          ))}
          {visibleUsers.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-row">No hay usuarios que coincidan con los filtros.</td>
            </tr>
          )}
        </tbody>
      </table>

    </div>
  )
}
