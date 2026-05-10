import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, friendlyError } from '../api/client'
import type { Group, GroupInvitation, User } from '../types'
import PageHeader from '../components/PageHeader'
import { useAuthStore } from '../store/authStore'
import './Groups.css'

export default function Groups() {
  const location = useLocation()
  const currentUser = useAuthStore((s) => s.user)
  const [groups, setGroups] = useState<Group[]>([])
  const [invitations, setInvitations] = useState<GroupInvitation[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  const [inviteUserId, setInviteUserId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null)

  const loadDashboard = async (preferredGroupId?: string | null) => {
    const [groupList, invitationList, userList] = await Promise.all([
      api.get<Group[]>('/groups'),
      api.get<GroupInvitation[]>('/groups/invitations'),
      api.get<User[]>('/users'),
    ])
    setGroups(groupList)
    setInvitations(invitationList)
    setUsers(userList)

    const nextSelectedGroupId = preferredGroupId ?? selectedGroupId ?? groupList[0]?.id ?? null
    setSelectedGroupId(nextSelectedGroupId)
    if (nextSelectedGroupId) {
      const detail = await api.get<Group>(`/groups/${nextSelectedGroupId}`)
      setSelectedGroup(detail)
    } else {
      setSelectedGroup(null)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const preferredGroupId = new URLSearchParams(location.search).get('groupId')
        await loadDashboard(preferredGroupId)
      } catch (err) {
        setError(friendlyError(err))
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  useEffect(() => {
    if (!selectedGroupId) return
    if (selectedGroup?.id === selectedGroupId) return
    const loadDetail = async () => {
      try {
        const detail = await api.get<Group>(`/groups/${selectedGroupId}`)
        setSelectedGroup(detail)
      } catch (err) {
        setError(friendlyError(err))
      }
    }
    loadDetail()
  }, [selectedGroupId])

  const acceptedUserIds = useMemo(() => (
    new Set(selectedGroup?.members?.map((member) => member.userId) || [])
  ), [selectedGroup?.members])

  const pendingUserIds = useMemo(() => (
    new Set(selectedGroup?.pendingInvitations?.map((member) => member.userId) || [])
  ), [selectedGroup?.pendingInvitations])

  const inviteCandidates = useMemo(() => (
    (Array.isArray(users) ? users : []).filter((user) =>
      user
      && user.id !== currentUser?.id
      && user.status !== 'Pending'
      && !acceptedUserIds.has(user.id)
      && !pendingUserIds.has(user.id),
    )
  ), [users, currentUser?.id, acceptedUserIds, pendingUserIds])

  const isCurrentUserAdmin = Boolean(
    selectedGroup?.members?.some((member) => member.userId === currentUser?.id && member.role === 'admin'),
  )
  const currentMembership = selectedGroup?.members?.find((member) => member.userId === currentUser?.id) || null
  const memberCount = selectedGroup?.members?.length ?? 0
  const pendingCount = selectedGroup?.pendingInvitations?.length ?? 0
  const totalAcceptedMembers = groups.reduce((sum, group) => sum + (group._count?.members ?? 0), 0)

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    setError('')
    try {
      const created = await api.post<Group>('/groups', {
        name: newGroupName,
        description: newGroupDescription,
      })
      setNewGroupName('')
      setNewGroupDescription('')
      await loadDashboard(created.id)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setCreatingGroup(false)
    }
  }

  const inviteMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGroupId || !inviteUserId) return
    setInviting(true)
    setError('')
    try {
      await api.post(`/groups/${selectedGroupId}/members`, { userId: inviteUserId })
      setInviteUserId('')
      const detail = await api.get<Group>(`/groups/${selectedGroupId}`)
      setSelectedGroup(detail)
      const updatedGroups = await api.get<Group[]>('/groups')
      setGroups(updatedGroups)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setInviting(false)
    }
  }

  const respondInvitation = async (invitationId: string, action: 'accept' | 'reject') => {
    setBusyInvitationId(invitationId)
    setError('')
    try {
      await api.post(`/groups/invitations/${invitationId}/${action}`)
      await loadDashboard(selectedGroupId)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyInvitationId(null)
    }
  }

  const removeMember = async (userId: string) => {
    if (!selectedGroupId) return
    setBusyMemberId(userId)
    setError('')
    try {
      await api.del(`/groups/${selectedGroupId}/members/${userId}`)
      const detail = await api.get<Group>(`/groups/${selectedGroupId}`)
      setSelectedGroup(detail)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusyMemberId(null)
    }
  }

  if (loading) {
    return <div style={{ color: 'var(--text-secondary)', padding: '2rem 0' }}>Cargando…</div>
  }

  return (
    <div className="groups-page">
      <PageHeader
        title="Grupos"
        subtitle="Círculos cerrados de trabajo en OCEAN: los crea un usuario, invita a quien quiere y cada invitado confirma si quiere entrar."
      />

      {error && <div className="card groups-error">{error}</div>}

      <section className="groups-summary">
        <article className="card group-summary-card">
          <span className="group-summary-value">{groups.length}</span>
          <span className="group-summary-label">grupos aceptados</span>
        </article>
        <article className="card group-summary-card">
          <span className="group-summary-value">{invitations.length}</span>
          <span className="group-summary-label">invitaciones pendientes</span>
        </article>
        <article className="card group-summary-card">
          <span className="group-summary-value">{totalAcceptedMembers}</span>
          <span className="group-summary-label">miembros en tus grupos</span>
        </article>
      </section>

      <section className="groups-grid">
        <aside className="groups-sidebar">
          <section className="card groups-panel">
            <div className="groups-panel-head">
              <h3>Mis grupos</h3>
              <span className="section-count">{groups.length}</span>
            </div>
            {groups.length === 0 ? (
              <p className="empty">Todavía no perteneces a ningún grupo aceptado.</p>
            ) : (
              <ul className="groups-list">
                {groups.map((group) => (
                  <li key={group.id}>
                    <button
                      type="button"
                      className={`group-row${selectedGroupId === group.id ? ' active' : ''}`}
                      onClick={() => setSelectedGroupId(group.id)}
                    >
                      <div className="group-row-copy">
                        <strong>{group.name}</strong>
                        {group.description && <span className="group-row-meta clamp-2">{group.description}</span>}
                      </div>
                      <span className="group-row-meta">{group._count?.members ?? 0} miembros</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card groups-panel">
            <div className="groups-panel-head">
              <h3>Invitaciones</h3>
              <span className="section-count">{invitations.length}</span>
            </div>
            {invitations.length === 0 ? (
              <p className="empty">No tienes invitaciones pendientes.</p>
            ) : (
              <ul className="invitation-list">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="invitation-card">
                    <div>
                      <strong>{invitation.group.name}</strong>
                      {invitation.group.description && <p>{invitation.group.description}</p>}
                    </div>
                    <div className="invitation-actions">
                      <button
                        className="btn-primary"
                        disabled={busyInvitationId === invitation.id}
                        onClick={() => respondInvitation(invitation.id, 'accept')}
                      >
                        Aceptar
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={busyInvitationId === invitation.id}
                        onClick={() => respondInvitation(invitation.id, 'reject')}
                      >
                        Rechazar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card groups-panel">
            <h3>Crear grupo</h3>
            <p className="ops-subtle">
              Crea un grupo cerrado para derivar EEGs a un círculo estable de revisión.
            </p>
            <form className="groups-form" onSubmit={createGroup}>
              <label>
                Nombre
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Epilepsia Valencia" />
              </label>
              <label>
                Descripción
                <textarea rows={3} value={newGroupDescription} onChange={(e) => setNewGroupDescription(e.target.value)} placeholder="Grupo cerrado para discutir casos de epilepsia." />
              </label>
              <button className="btn-primary" disabled={creatingGroup}>
                {creatingGroup ? 'Creando…' : 'Crear grupo'}
              </button>
            </form>
          </section>
        </aside>

        <section className="groups-main">
          {!selectedGroup ? (
            <div className="card groups-panel">
              <p className="empty">Selecciona un grupo para ver sus miembros y gestionar invitaciones.</p>
            </div>
          ) : (
            <>
              <section className="card groups-panel">
                <div className="groups-panel-head">
                  <div>
                    <h3>{selectedGroup.name}</h3>
                    {selectedGroup.description && <p className="ops-subtle">{selectedGroup.description}</p>}
                  </div>
                  <div className="groups-badges">
                    {currentMembership && <span className="badge">{currentMembership.role === 'admin' ? 'Admin' : 'Miembro'}</span>}
                    <span className="badge">{selectedGroup.type}</span>
                  </div>
                </div>

                <div className="group-detail-kpis">
                  <div className="group-detail-kpi">
                    <strong>{memberCount}</strong>
                    <span>miembros aceptados</span>
                  </div>
                  <div className="group-detail-kpi">
                    <strong>{pendingCount}</strong>
                    <span>invitaciones pendientes</span>
                  </div>
                  <div className="group-detail-kpi">
                    <strong>{isCurrentUserAdmin ? 'Sí' : 'No'}</strong>
                    <span>puedes invitar</span>
                  </div>
                </div>

                {isCurrentUserAdmin && (
                  <form className="groups-form inline" onSubmit={inviteMember}>
                    <label>
                      Invitar usuario
                      <select value={inviteUserId} onChange={(e) => setInviteUserId(e.target.value)}>
                        <option value="">Selecciona…</option>
                        {inviteCandidates.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.displayName} · {user.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="btn-primary" disabled={inviting || !inviteUserId}>
                      {inviting ? 'Invitando…' : 'Invitar'}
                    </button>
                  </form>
                )}
              </section>

              <section className="groups-detail-grid">
                <section className="card groups-panel">
                  <div className="groups-panel-head">
                    <h3>Miembros aceptados</h3>
                    <span className="section-count">{selectedGroup.members?.length ?? 0}</span>
                  </div>
                  <ul className="member-list">
                    {(selectedGroup.members || []).map((member) => (
                      <li key={member.id} className="member-row">
                        <div>
                          <strong>{member.user?.displayName || member.userId}</strong>
                          <span className="member-meta">{member.user?.email} · {member.role}</span>
                        </div>
                        {isCurrentUserAdmin && member.userId !== currentUser?.id && (
                          <button
                            className="btn-secondary"
                            disabled={busyMemberId === member.userId}
                            onClick={() => removeMember(member.userId)}
                          >
                            Quitar
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>

                {isCurrentUserAdmin && (
                  <section className="card groups-panel">
                    <div className="groups-panel-head">
                      <h3>Invitaciones pendientes</h3>
                      <span className="section-count">{selectedGroup.pendingInvitations?.length ?? 0}</span>
                    </div>
                    {selectedGroup.pendingInvitations?.length ? (
                      <ul className="member-list">
                        {selectedGroup.pendingInvitations.map((member) => (
                          <li key={member.id} className="member-row">
                            <div>
                              <strong>{member.user?.displayName || member.userId}</strong>
                              <span className="member-meta">{member.user?.email} · invitación pendiente</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">No hay invitaciones pendientes en este grupo.</p>
                    )}
                  </section>
                )}
              </section>
            </>
          )}
        </section>
      </section>
    </div>
  )
}
