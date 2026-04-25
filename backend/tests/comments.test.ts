import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest } from './helpers'

describe('POST /comments/case/:caseId — validaciones', () => {
  it('rechaza body vacío', async () => {
    const owner = await createUser({ email: 'cm-empty@ocean.local', displayName: 'CmEmpty', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '' })

    expect(res.status).toBe(400)
  })

  it('intruder no puede comentar', async () => {
    const owner = await createUser({ email: 'cm-o@ocean.local', displayName: 'CmO', password: 'pass' })
    const intruder = await createUser({ email: 'cm-int@ocean.local', displayName: 'CmInt', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(intruder.id, intruder.email, intruder.role)

    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Texto malicioso' })

    expect(res.status).toBe(404)
  })
})

describe('POST /comments/case/:caseId', () => {
  it('añade un comentario al caso', async () => {
    const owner = await createUser({ email: 'comm-own@ocean.local', displayName: 'CommOwn', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Buen caso', type: 'Comment' })

    expect(res.status).toBe(201)
    expect(res.body.content).toBe('Buen caso') // renombrado en respuesta
  })

  it('permite comentar si eres revisor aceptado', async () => {
    const owner = await createUser({ email: 'comm-o2@ocean.local', displayName: 'CommO2', password: 'pass' })
    const reviewer = await createUser({ email: 'comm-r2@ocean.local', displayName: 'CommR2', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'InReview' })
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    // Aceptar
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const reqs = await request(app).get('/requests/pending').set('Authorization', `Bearer ${generateToken(reviewer.id, reviewer.email, reviewer.role)}`)
    await request(app).post(`/requests/${reqs.body[0].id}/accept`).set('Authorization', `Bearer ${generateToken(reviewer.id, reviewer.email, reviewer.role)}`)

    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)
    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Conclusión del revisor', type: 'Conclusion' })

    expect(res.status).toBe(201)
    expect(res.body.type).toBe('Conclusion')
  })
})

describe('GET /comments/case/:caseId', () => {
  it('lista comentarios del caso', async () => {
    const owner = await createUser({ email: 'comm-l@ocean.local', displayName: 'CommL', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Comentario 1' })

    const res = await request(app)
      .get(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].content).toBe('Comentario 1')
  })

  it('respuesta usa campo "content", no "body"', async () => {
    const owner = await createUser({ email: 'cm-field@ocean.local', displayName: 'CmField', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    await request(app).post(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`).send({ body: 'Test' })
    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.body[0]).toHaveProperty('content')
    expect(res.body[0]).not.toHaveProperty('body')
  })

  it('intruder no puede leer comentarios (P1-6)', async () => {
    const owner = await createUser({ email: 'cm-ro@ocean.local', displayName: 'CmRO', password: 'pass' })
    const intruder = await createUser({ email: 'cm-ri@ocean.local', displayName: 'CmRI', password: 'pass' })
    const c = await createCase(owner.id)
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app).post(`/comments/case/${c.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ body: 'Privado' })

    const token = generateToken(intruder.id, intruder.email, intruder.role)
    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('devuelve lista vacía si no hay comentarios', async () => {
    const owner = await createUser({ email: 'cm-zero@ocean.local', displayName: 'CmZero', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })
})
