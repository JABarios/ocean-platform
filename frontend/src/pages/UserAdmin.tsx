import { useEffect, useMemo, useState } from 'react'
import { api, friendlyError } from '../api/client'
import type { User } from '../types'
import { useAuthStore } from '../store/authStore'

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
      <div className="header-row">
        <div>
          <h2>Administración de usuarios</h2>
          <p className="subtle-copy">Control de acceso, actividad y carga de revisión de la red OCEAN.</p>
        </div>
        <div className="summary-grid">
          <div className="summary-card"><strong>{summary.total}</strong><span>Total</span></div>
          <div className="summary-card"><strong>{summary.active}</strong><span>Activos</span></div>
          <div className="summary-card"><strong>{summary.inactive}</strong><span>Inactivos</span></div>
          <div className="summary-card"><strong>{summary.admins}</strong><span>Admins</span></div>
        </div>
      </div>

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

      <style>{`
        .user-admin {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .header-row {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .user-admin h2 {
          font-size: 1.2rem;
          font-weight: 600;
          margin-bottom: 0.25rem;
        }
        .subtle-copy {
          color: var(--text-secondary);
          font-size: 0.92rem;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(90px, 1fr));
          gap: 0.75rem;
          min-width: min(100%, 420px);
        }
        .summary-card {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          padding: 0.75rem 0.9rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .summary-card strong {
          font-size: 1.2rem;
        }
        .summary-card span {
          color: var(--text-secondary);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .toolbar {
          display: grid;
          grid-template-columns: minmax(240px, 1fr) 180px 180px;
          gap: 0.75rem;
          padding: 0.9rem;
        }
        .toolbar input,
        .toolbar select,
        .users-table select {
          font-size: 0.85rem;
          padding: 0.5rem 0.65rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .error-banner {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fca5a5;
          padding: 0.6rem 1rem;
          border-radius: 6px;
          font-size: 0.9rem;
        }
        .users-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .users-table th {
          text-align: left;
          padding: 0.7rem 0.8rem;
          font-weight: 600;
          border-bottom: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .users-table td {
          padding: 0.8rem;
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }
        .users-table tr:last-child td {
          border-bottom: none;
        }
        .user-cell {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .user-top-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .user-meta,
        .last-access-cell,
        .self-note {
          color: var(--text-secondary);
          font-size: 0.84rem;
        }
        .chip-row {
          display: flex;
          gap: 0.35rem;
          flex-wrap: wrap;
          margin-top: 0.15rem;
        }
        .group-chip,
        .status-pill {
          border-radius: 999px;
          padding: 0.15rem 0.55rem;
          font-size: 0.72rem;
          font-weight: 600;
          white-space: nowrap;
        }
        .group-chip {
          background: #eef2ff;
          color: #3730a3;
        }
        .status-pill.active {
          background: #ecfdf5;
          color: #047857;
        }
        .status-pill.inactive {
          background: #fff7ed;
          color: #c2410c;
        }
        .tiny-metric {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .tiny-metric small {
          color: var(--text-secondary);
          font-size: 0.78rem;
        }
        .danger-btn,
        .secondary-btn {
          border-radius: 999px;
          padding: 0.35rem 0.7rem;
          font-size: 0.78rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .danger-btn {
          border: 1px solid #fecaca;
          background: #fff1f2;
          color: #b91c1c;
        }
        .secondary-btn {
          border: 1px solid #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .danger-btn:disabled,
        .secondary-btn:disabled,
        .users-table select:disabled {
          opacity: 0.65;
          cursor: wait;
        }
        .empty-row {
          text-align: center;
          color: var(--text-secondary);
          padding: 1.5rem;
        }
        @media (max-width: 980px) {
          .toolbar {
            grid-template-columns: 1fr;
          }
          .summary-grid {
            grid-template-columns: repeat(2, minmax(110px, 1fr));
            width: 100%;
          }
          .users-table {
            display: block;
            overflow-x: auto;
          }
        }
      `}</style>
    </div>
  )
}
