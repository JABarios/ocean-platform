import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken } from './helpers'

describe('GET /users', () => {
  it('lista usuarios activos', async () => {
    const user = await createUser({ email: 'u1@ocean.local', displayName: 'U1', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.some((u: { email: string }) => u.email === 'u1@ocean.local')).toBe(true)
  })

  it('no incluye passwordHash en la respuesta', async () => {
    const user = await createUser({ email: 'u2@ocean.local', displayName: 'U2', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

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

  it('no-Admin recibe 403', async () => {
    const clinician = await createUser({ email: 'noadmin@ocean.local', displayName: 'NoAdmin', password: 'pass' })
    const target = await createUser({ email: 'target@ocean.local', displayName: 'Target', password: 'pass' })
    const token = generateToken(clinician.id, clinician.email, clinician.role)

    const res = await request(app)
      .patch(`/users/${target.id}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'Curator' })

    expect(res.status).toBe(403)
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

    const { prisma } = await import('./helpers')
    const audit = await prisma.auditEvent.findFirst({ where: { actorId: admin.id, action: 'RoleChanged' } })
    expect(audit).not.toBeNull()
  })
})
