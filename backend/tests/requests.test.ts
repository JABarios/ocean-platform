import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest } from './helpers'

describe('POST /requests', () => {
  it('crea una solicitud de revisión', async () => {
    const owner = await createUser({ email: 'req-owner@ocean.local', displayName: 'ReqOwner', password: 'pass' })
    const reviewer = await createUser({ email: 'req-rev@ocean.local', displayName: 'ReqRev', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id, message: 'Revisa esto' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('Pending')
    expect(res.body.message).toBe('Revisa esto')
  })

  it('cambia caso a Requested si estaba en Draft', async () => {
    const owner = await createUser({ email: 'req-draft@ocean.local', displayName: 'ReqDraft', password: 'pass' })
    const reviewer = await createUser({ email: 'req-rev2@ocean.local', displayName: 'ReqRev2', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Draft' })
    const token = generateToken(owner.id, owner.email, owner.role)

    await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id })

    const caseRes = await request(app)
      .get(`/cases/${c.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(caseRes.body.status).toBe('Requested')
  })
})

describe('POST /requests/:id/accept', () => {
  it('acepta una solicitud y pasa caso a InReview', async () => {
    const owner = await createUser({ email: 'acc-own@ocean.local', displayName: 'AccOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'acc-rev@ocean.local', displayName: 'AccRev', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Requested' })
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    const res = await request(app)
      .post(`/requests/${req.id}/accept`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Accepted')
  })
})

describe('POST /requests/:id/reject', () => {
  it('rechaza una solicitud', async () => {
    const owner = await createUser({ email: 'rej-own@ocean.local', displayName: 'RejOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'rej-rev@ocean.local', displayName: 'RejRev', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    const res = await request(app)
      .post(`/requests/${req.id}/reject`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Rejected')
  })
})

describe('GET /requests/pending', () => {
  it('lista solicitudes pendientes para el usuario', async () => {
    const owner = await createUser({ email: 'pend-own@ocean.local', displayName: 'PendOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'pend-rev@ocean.local', displayName: 'PendRev', password: 'pass' })
    const c = await createCase(owner.id)
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    const res = await request(app).get('/requests/pending').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })
})
