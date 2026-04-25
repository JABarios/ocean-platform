import { useEffect, useState } from 'react'
import { api, friendlyError } from '../api/client'
import type { User } from '../types'

const VALID_ROLES = ['Clinician', 'Reviewer', 'Curator', 'Admin'] as const
type Role = typeof VALID_ROLES[number]

export default function UserAdmin() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

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
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>

  return (
    <div className="user-admin">
      <h2>Administración de usuarios</h2>
      {error && <div className="error-banner">{error}</div>}

      <table className="users-table card">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Email</th>
            <th>Institución</th>
            <th>Rol</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.displayName}</td>
              <td className="email-cell">{u.email}</td>
              <td>{u.institution || '—'}</td>
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
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .user-admin {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .user-admin h2 {
          font-size: 1.2rem;
          font-weight: 600;
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
          padding: 0.6rem 0.75rem;
          font-weight: 600;
          border-bottom: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .users-table td {
          padding: 0.6rem 0.75rem;
          border-bottom: 1px solid var(--border);
          vertical-align: middle;
        }
        .users-table tr:last-child td {
          border-bottom: none;
        }
        .email-cell {
          color: var(--text-secondary);
          font-size: 0.85rem;
        }
        .users-table select {
          font-size: 0.85rem;
          padding: 0.25rem 0.4rem;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--surface);
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
