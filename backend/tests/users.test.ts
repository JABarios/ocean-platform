import request from 'supertest'
import app from '../src/index'
import { createCase, createReviewRequest, createUser, generateToken, prisma } from './helpers'

describe('GET /users', () => {
  it('Admin lista usuarios con activos e inactivos', async () => {
    const admin = await createUser({ email: 'admin-list@ocean.local', displayName: 'Admin List', role: 'Admin' })
    const active = await createUser({ email: 'active@ocean.local', displayName: 'Active User', password: 'pass' })
    const inactive = await createUser({ email: 'inactive@ocean.local', displayName: 'Inactive User', password: 'pass' })
    await prisma.user.update({ where: { id: inactive.id }, data: { status: 'Pending' } })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.some((u: { id: string; status: string }) => u.id === active.id && u.status === 'Active')).toBe(true)
    expect(res.body.some((u: { id: string; status: string }) => u.id === inactive.id && u.status === 'Pending')).toBe(true)
  })

  it('no-Admin recibe 403', async () => {
    const user = await createUser({ email: 'u-forbidden@ocean.local', displayName: 'Forbidden', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('incluye métricas y grupos del usuario', async () => {
    const admin = await createUser({ email: 'admin-metrics@ocean.local', displayName: 'Admin Metrics', role: 'Admin' })
    const reviewer = await createUser({ email: 'reviewer-metrics@ocean.local', displayName: 'Reviewer Metrics', password: 'pass' })
    const owner = await createUser({ email: 'owner-metrics@ocean.local', displayName: 'Owner Metrics', password: 'pass' })
    const group = await prisma.group.create({ data: { name: 'Epilepsia Valencia' } })
    await prisma.groupMember.create({ data: { userId: reviewer.id, groupId: group.id } })
    const c1 = await createCase(owner.id, { title: 'Caso 1' })
    const c2 = await createCase(owner.id, { title: 'Caso 2' })
    await createReviewRequest({ caseId: c1.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const accepted = await createReviewRequest({ caseId: c2.id, requestedBy: owner.id, targetUserId: reviewer.id })
    await prisma.reviewRequest.update({
      where: { id: accepted.id },
      data: { status: 'Completed', completedAt: new Date() },
    })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    const row = res.body.find((entry: { id: string }) => entry.id === reviewer.id)

    expect(res.status).toBe(200)
    expect(row.groups).toEqual([{ id: group.id, name: 'Epilepsia Valencia' }])
    expect(row.metrics.pendingReviews).toBe(1)
    expect(row.metrics.completedReviews).toBe(1)
    expect(row.metrics.totalReviews).toBe(2)
  })

  it('no incluye passwordHash en la respuesta', async () => {
    const admin = await createUser({ email: 'admin-hidden@ocean.local', displayName: 'Admin Hidden', role: 'Admin' })
    await createUser({ email: 'u2@ocean.local', displayName: 'U2', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.body[0]).not.toHaveProperty('passwordHash')
  })
})

describe('PATCH /users/:id/role', () => {
  it('Admin puede cambiar el rol de un usuario', async () => {
    const admin = await createUser({ email: 'admin@ocean.local', displayName: 'Admin', role: 'Admin' })
    const clinician = await createUser({ email: 'cli@ocean.local', displayName: 'Cli', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${clinician.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Curator' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('Curator')
  })

  it('usuario inexistente devuelve 404', async () => {
    const admin = await createUser({ email: 'admin2@ocean.local', displayName: 'Admin2', role: 'Admin' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch('/users/00000000-0000-0000-0000-000000000000/role')
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Curator' })

    expect(res.status).toBe(404)
  })

  it('rol inválido devuelve 400', async () => {
    const admin = await createUser({ email: 'admin3@ocean.local', displayName: 'Admin3', role: 'Admin' })
    const user = await createUser({ email: 'user3@ocean.local', displayName: 'User3', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${user.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'SuperAdmin' })

    expect(res.status).toBe(400)
  })

  it('cambio de rol crea AuditEvent', async () => {
    const admin = await createUser({ email: 'admin4@ocean.local', displayName: 'Admin4', role: 'Admin' })
    const user = await createUser({ email: 'user4@ocean.local', displayName: 'User4', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    await request(app)
      .patch(`/users/${user.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Reviewer' })

    const audit = await prisma.auditEvent.findFirst({ where: { actorId: admin.id, action: 'RoleChanged' } })
    expect(audit).not.toBeNull()
  })
})

describe('PATCH /users/:id/status', () => {
  it('Admin puede dar de baja a un usuario activo', async () => {
    const admin = await createUser({ email: 'admin-status@ocean.local', displayName: 'Admin Status', role: 'Admin' })
    const user = await createUser({ email: 'status-me@ocean.local', displayName: 'Status Me', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${user.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Pending' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Pending')
  })

  it('Admin puede reactivar a un usuario inactivo', async () => {
    const admin = await createUser({ email: 'admin-reactivate@ocean.local', displayName: 'Admin Reactivate', role: 'Admin' })
    const user = await createUser({ email: 'reactivate-me@ocean.local', displayName: 'Reactivate Me', password: 'pass' })
    await prisma.user.update({ where: { id: user.id }, data: { status: 'Pending' } })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${user.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Active' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Active')
  })

  it('estado inválido devuelve 400', async () => {
    const admin = await createUser({ email: 'admin-invalid-status@ocean.local', displayName: 'Admin Invalid Status', role: 'Admin' })
    const user = await createUser({ email: 'invalid-status@ocean.local', displayName: 'Invalid Status', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${user.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Deleted' })

    expect(res.status).toBe(400)
  })

  it('no permite desactivar el propio usuario', async () => {
    const admin = await createUser({ email: 'admin-self@ocean.local', displayName: 'Admin Self', role: 'Admin' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .patch(`/users/${admin.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'Pending' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No puedes desactivar tu propio usuario')
  })
})

describe('DELETE /users/:id', () => {
  it('sigue dando de baja por compatibilidad', async () => {
    const admin = await createUser({ email: 'admin-delete@ocean.local', displayName: 'Admin Delete', role: 'Admin' })
    const user = await createUser({ email: 'delete-me@ocean.local', displayName: 'Delete Me', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .delete(`/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)

    const deletedUser = await prisma.user.findUnique({ where: { id: user.id } })
    expect(deletedUser?.status).toBe('Pending')
  })

  it('el usuario dado de baja ya no puede iniciar sesión', async () => {
    const admin = await createUser({ email: 'admin-delete-login@ocean.local', displayName: 'Admin Delete Login', role: 'Admin' })
    const user = await createUser({ email: 'disabled@ocean.local', displayName: 'Disabled', password: 'ocean123' })
    const token = generateToken(admin.id, admin.email, admin.role)

    await request(app)
      .delete(`/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .post('/auth/login')
      .send({ email: user.email, password: 'ocean123' })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Usuario inactivo')
  })

  it('no permite borrarse a uno mismo', async () => {
    const admin = await createUser({ email: 'admin-self-delete@ocean.local', displayName: 'Admin Self Delete', role: 'Admin' })
    const token = generateToken(admin.id, admin.email, admin.role)

    const res = await request(app)
      .delete(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No puedes borrar tu propio usuario')
  })

  it('borrado de usuario crea AuditEvent', async () => {
    const admin = await createUser({ email: 'admin-audit-delete@ocean.local', displayName: 'Admin Audit Delete', role: 'Admin' })
    const user = await createUser({ email: 'user-audit-delete@ocean.local', displayName: 'User Audit Delete', password: 'pass' })
    const token = generateToken(admin.id, admin.email, admin.role)

    await request(app)
      .delete(`/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`)

    const audit = await prisma.auditEvent.findFirst({ where: { actorId: admin.id, action: 'UserDeleted' } })
    expect(audit).not.toBeNull()
  })
})

describe('Auth user activity', () => {
  it('actualiza lastLoginAt al iniciar sesión', async () => {
    const user = await createUser({ email: 'login-time@ocean.local', displayName: 'Login Time', password: 'ocean123' })
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: null } })

    const before = await prisma.user.findUnique({ where: { id: user.id } })
    expect(before?.lastLoginAt).toBeNull()

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'login-time@ocean.local', password: 'ocean123' })

    expect(res.status).toBe(200)
    const after = await prisma.user.findUnique({ where: { id: user.id } })
    expect(after?.lastLoginAt).not.toBeNull()
  })
})
