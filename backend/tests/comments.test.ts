import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest, prisma } from './helpers'

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

  it('usuario autenticado sí puede comentar un caso público', async () => {
    const owner = await createUser({ email: 'cm-pub-own2@ocean.local', displayName: 'CmPubOwn2', password: 'pass' })
    const outsider = await createUser({ email: 'cm-pub-out2@ocean.local', displayName: 'CmPubOut2', password: 'pass' })
    const c = await createCase(owner.id, { visibility: 'Public' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Yo también lo quiero comentar' })

    expect(res.status).toBe(201)
    expect(res.body.content).toBe('Yo también lo quiero comentar')
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

  it('notifica al owner cuando otro usuario comenta un caso público', async () => {
    const owner = await createUser({ email: 'comm-notif-own@ocean.local', displayName: 'CommNotifOwn', password: 'pass' })
    const outsider = await createUser({ email: 'comm-notif-out@ocean.local', displayName: 'CommNotifOut', password: 'pass' })
    const c = await createCase(owner.id, { visibility: 'Public', title: 'Caso comentado' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post(`/comments/case/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Comentario comunitario' })

    expect(res.status).toBe(201)

    const notifications = await prisma.notification.findMany({
      where: { userId: owner.id, kind: 'comment_on_case' },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].commentId).toBe(res.body.id)
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

  it('rechaza vincular el comentario a una solicitud de otro caso', async () => {
    const owner = await createUser({ email: 'comm-link-own@ocean.local', displayName: 'CommLinkOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'comm-link-rev@ocean.local', displayName: 'CommLinkRev', password: 'pass' })
    const caseA = await createCase(owner.id, { statusClinical: 'InReview' })
    const caseB = await createCase(owner.id, { statusClinical: 'InReview' })
    const requestB = await createReviewRequest({ caseId: caseB.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post(`/comments/case/${caseA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Comentario mal vinculado', requestId: requestB.id })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no pertenece a este caso/i)
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

  it('usuario autenticado puede leer comentarios de un caso propuesto', async () => {
    const owner = await createUser({ email: 'cm-pub-own@ocean.local', displayName: 'CmPubOwn', password: 'pass' })
    const outsider = await createUser({ email: 'cm-pub-out@ocean.local', displayName: 'CmPubOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Proposed' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app).post(`/comments/case/${c.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ body: 'Comentario visible' })

    const token = generateToken(outsider.id, outsider.email, outsider.role)
    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].content).toBe('Comentario visible')
  })

  it('usuario autenticado puede leer comentarios de un caso público', async () => {
    const owner = await createUser({ email: 'cm-public-read-own@ocean.local', displayName: 'CmPublicReadOwn', password: 'pass' })
    const outsider = await createUser({ email: 'cm-public-read-out@ocean.local', displayName: 'CmPublicReadOut', password: 'pass' })
    const c = await createCase(owner.id, { visibility: 'Public' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app).post(`/comments/case/${c.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ body: 'Comentario público' })

    const token = generateToken(outsider.id, outsider.email, outsider.role)
    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].content).toBe('Comentario público')
  })

  it('admin puede leer comentarios de cualquier caso', async () => {
    const owner = await createUser({ email: 'cm-admin-own@ocean.local', displayName: 'CmAdminOwn', password: 'pass' })
    const admin = await createUser({
      email: 'cm-admin@ocean.local',
      displayName: 'CmAdmin',
      password: 'pass',
      role: 'Admin',
    })
    const c = await createCase(owner.id)
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app).post(`/comments/case/${c.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ body: 'Visible para admin' })

    const token = generateToken(admin.id, admin.email, admin.role)
    const res = await request(app).get(`/comments/case/${c.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].content).toBe('Visible para admin')
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
