import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, prisma } from './helpers'

describe('POST /auth/register', () => {
  it('registra un nuevo usuario', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'test@ocean.local',
      password: 'password123',
      displayName: 'Dr. Test',
      institution: 'Hospital Test',
      specialty: 'Neurofisiología',
    })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body.user.id).toBeDefined()
    expect(res.body.user.email).toBe('test@ocean.local')
  })

  it('rechaza email duplicado', async () => {
    await createUser({ email: 'dup@ocean.local', displayName: 'Dup', password: 'pass123' })
    const res = await request(app).post('/auth/register').send({
      email: 'dup@ocean.local',
      password: 'password123',
      displayName: 'Otro',
    })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/ya está registrado/)
  })

  it('rechaza datos inválidos', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'not-an-email',
      password: '123',
      displayName: 'A',
    })
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/login', () => {
  it('loguea con credenciales válidas', async () => {
    await createUser({ email: 'login@ocean.local', displayName: 'Login', password: 'secret123' })
    const res = await request(app).post('/auth/login').send({
      email: 'login@ocean.local',
      password: 'secret123',
    })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(res.body.user.email).toBe('login@ocean.local')
  })

  it('rechaza credenciales inválidas', async () => {
    const res = await request(app).post('/auth/login').send({
      email: 'nobody@ocean.local',
      password: 'wrong',
    })
    expect(res.status).toBe(401)
  })
})

describe('GET /auth/me', () => {
  it('devuelve el perfil autenticado', async () => {
    const user = await createUser({ email: 'me@ocean.local', displayName: 'Me', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.email).toBe('me@ocean.local')
  })

  it('rechaza sin token', async () => {
    const res = await request(app).get('/auth/me')
    expect(res.status).toBe(401)
  })

  it('rechaza token con usuario inexistente en BD', async () => {
    const token = generateToken('00000000-0000-0000-0000-000000000000', 'ghost@ocean.local', 'Clinician')
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })
})

describe('authMiddleware — usuario inactivo', () => {
  it('bloquea usuario con status Pending', async () => {
    const user = await createUser({ email: 'inactive@ocean.local', displayName: 'Inactive', password: 'pass' })
    await prisma.user.update({ where: { id: user.id }, data: { status: 'Pending' } })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/cases').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/inactivo/)
  })

  it('bloquea usuario desactivado (status Inactive)', async () => {
    const user = await createUser({ email: 'disabled@ocean.local', displayName: 'Disabled', password: 'pass' })
    await prisma.user.update({ where: { id: user.id }, data: { status: 'Inactive' } })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/cases').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })

  it('usa el rol actual de BD, rechaza acción de Curator si fue degradado', async () => {
    const proposer = await createUser({ email: 'rp@ocean.local', displayName: 'RP', password: 'pass' })
    const demoted = await createUser({ email: 'rolechange@ocean.local', displayName: 'RoleChange', password: 'pass', role: 'Curator' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const pToken = generateToken(proposer.id, proposer.email, proposer.role)
    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${pToken}`)
      .send({ caseId: c.id, summary: 'S', difficulty: 'Intermediate' })

    // Degradar a Clinician en BD pero usar token antiguo con rol Curator
    await prisma.user.update({ where: { id: demoted.id }, data: { role: 'Clinician' } })
    const staleToken = generateToken(demoted.id, demoted.email, 'Curator')

    const res = await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/validate`)
      .set('Authorization', `Bearer ${staleToken}`)
      .send({ status: 'Validated' })

    expect(res.status).toBe(403)
  })
})
