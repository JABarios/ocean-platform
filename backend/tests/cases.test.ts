import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase } from './helpers'

describe('GET /cases', () => {
  it('lista casos del usuario autenticado', async () => {
    const user = await createUser({ email: 'cases@ocean.local', displayName: 'Cases', password: 'pass' })
    await createCase(user.id, { title: 'Mi caso' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/cases').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Mi caso')
    expect(res.body[0].status).toBe('Draft')
  })
})

describe('POST /cases', () => {
  it('crea un nuevo caso', async () => {
    const user = await createUser({ email: 'create@ocean.local', displayName: 'Create', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'EEG anormal',
        clinicalContext: 'Paciente con crisis',
        ageRange: 'Adulto',
        studyReason: 'Caracterizar',
        modality: 'EEG',
      })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('EEG anormal')
    expect(res.body.status).toBe('Draft')
  })

  it('rechaza datos inválidos', async () => {
    const user = await createUser({ email: 'badcase@ocean.local', displayName: 'Bad', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '' })

    expect(res.status).toBe(400)
  })
})

describe('GET /cases/:id', () => {
  it('devuelve caso con acceso', async () => {
    const user = await createUser({ email: 'detail@ocean.local', displayName: 'Detail', password: 'pass' })
    const c = await createCase(user.id, { title: 'Detalle' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get(`/cases/${c.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Detalle')
  })

  it('rechaza caso sin acceso', async () => {
    const owner = await createUser({ email: 'owner@ocean.local', displayName: 'Owner', password: 'pass' })
    const intruder = await createUser({ email: 'intruder@ocean.local', displayName: 'Intruder', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(intruder.id, intruder.email, intruder.role)

    const res = await request(app).get(`/cases/${c.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /cases/:id/status', () => {
  it('cambia el estado del caso siguiendo transiciones válidas', async () => {
    const user = await createUser({ email: 'status@ocean.local', displayName: 'Status', password: 'pass' })
    const c = await createCase(user.id)
    const token = generateToken(user.id, user.email, user.role)

    // Draft → Requested
    let res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Requested' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Requested')

    // Requested → InReview
    res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'InReview' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('InReview')

    // InReview → Resolved
    res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Resolved' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Resolved')
    expect(res.body.resolvedAt).toBeDefined()
  })

  it('rechaza transición inválida', async () => {
    const user = await createUser({ email: 'badtx@ocean.local', displayName: 'BadTx', password: 'pass' })
    const c = await createCase(user.id)
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Resolved' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Transición no permitida')
  })

  it('solo el owner puede cambiar estado', async () => {
    const owner = await createUser({ email: 'own2@ocean.local', displayName: 'Owner2', password: 'pass' })
    const other = await createUser({ email: 'other@ocean.local', displayName: 'Other', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(other.id, other.email, other.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Resolved' })

    expect(res.status).toBe(404)
  })
})
