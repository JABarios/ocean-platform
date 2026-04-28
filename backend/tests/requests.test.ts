import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest } from './helpers'

describe('POST /requests — validaciones', () => {
  it('rechaza si no se especifica destinatario', async () => {
    const owner = await createUser({ email: 'rq-notrgt@ocean.local', displayName: 'NoTrgt', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/destinatario/)
  })

  it('solo el owner puede crear solicitudes para su caso', async () => {
    const owner = await createUser({ email: 'rq-own@ocean.local', displayName: 'RqOwn', password: 'pass' })
    const intruder = await createUser({ email: 'rq-int@ocean.local', displayName: 'RqInt', password: 'pass' })
    const reviewer = await createUser({ email: 'rq-rev@ocean.local', displayName: 'RqRev', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(intruder.id, intruder.email, intruder.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id })

    expect(res.status).toBe(404)
  })
})

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

  it('tercero no puede aceptar solicitud ajena', async () => {
    const owner = await createUser({ email: 'acc-o2@ocean.local', displayName: 'AccO2', password: 'pass' })
    const reviewer = await createUser({ email: 'acc-r2@ocean.local', displayName: 'AccR2', password: 'pass' })
    const other = await createUser({ email: 'acc-ot@ocean.local', displayName: 'AccOt', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(other.id, other.email, other.role)

    const res = await request(app)
      .post(`/requests/${req.id}/accept`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('no puede aceptar una solicitud ya aceptada', async () => {
    const owner = await createUser({ email: 'acc-dup@ocean.local', displayName: 'AccDup', password: 'pass' })
    const reviewer = await createUser({ email: 'acc-duprev@ocean.local', displayName: 'AccDupRev', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    await request(app).post(`/requests/${req.id}/accept`).set('Authorization', `Bearer ${token}`)
    const res = await request(app).post(`/requests/${req.id}/accept`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
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

  it('no muestra solicitudes de otros usuarios', async () => {
    const owner = await createUser({ email: 'pend-o2@ocean.local', displayName: 'PendO2', password: 'pass' })
    const r1 = await createUser({ email: 'pend-r1@ocean.local', displayName: 'PendR1', password: 'pass' })
    const r2 = await createUser({ email: 'pend-r2@ocean.local', displayName: 'PendR2', password: 'pass' })
    const c = await createCase(owner.id)
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: r1.id })
    const token = generateToken(r2.id, r2.email, r2.role)

    const res = await request(app).get('/requests/pending').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('incluye el status del caso como "status" (no statusClinical)', async () => {
    const owner = await createUser({ email: 'pend-fld@ocean.local', displayName: 'PendFld', password: 'pass' })
    const reviewer = await createUser({ email: 'pend-fld-rev@ocean.local', displayName: 'PendFldRev', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Requested' })
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    const res = await request(app).get('/requests/pending').set('Authorization', `Bearer ${token}`)
    expect(res.body[0].case).toHaveProperty('status', 'Requested')
    expect(res.body[0].case).not.toHaveProperty('statusClinical')
  })
})

describe('GET /requests/active', () => {
  it('lista solicitudes aceptadas para el revisor', async () => {
    const owner = await createUser({ email: 'act-own@ocean.local', displayName: 'ActOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'act-rev@ocean.local', displayName: 'ActRev', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Requested' })
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const revToken = generateToken(reviewer.id, reviewer.email, reviewer.role)

    await request(app).post(`/requests/${req.id}/accept`).set('Authorization', `Bearer ${revToken}`)

    const res = await request(app).get('/requests/active').set('Authorization', `Bearer ${revToken}`)
    expect(res.status).toBe(200)
    expect(res.body.some((r: { id: string }) => r.id === req.id)).toBe(true)
  })

  it('lista solicitudes activas para el solicitante también', async () => {
    const owner = await createUser({ email: 'act-o2@ocean.local', displayName: 'ActO2', password: 'pass' })
    const reviewer = await createUser({ email: 'act-r2@ocean.local', displayName: 'ActR2', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Requested' })
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const revToken = generateToken(reviewer.id, reviewer.email, reviewer.role)
    const ownerToken = generateToken(owner.id, owner.email, owner.role)

    await request(app).post(`/requests/${req.id}/accept`).set('Authorization', `Bearer ${revToken}`)

    const res = await request(app).get('/requests/active').set('Authorization', `Bearer ${ownerToken}`)
    expect(res.status).toBe(200)
    expect(res.body.some((r: { id: string }) => r.id === req.id)).toBe(true)
  })
})

describe('request owner operations', () => {
  it('el solicitante puede reenviar una solicitud rechazada', async () => {
    const owner = await createUser({ email: 'resend-own@ocean.local', displayName: 'ResendOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'resend-rev@ocean.local', displayName: 'ResendRev', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id, status: 'Rejected' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post(`/requests/${req.id}/resend`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Pending')
    expect(res.body.expiresAt).toBeTruthy()
  })

  it('el solicitante puede retirar una solicitud pendiente', async () => {
    const owner = await createUser({ email: 'withdraw-own@ocean.local', displayName: 'WithdrawOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'withdraw-rev@ocean.local', displayName: 'WithdrawRev', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id, status: 'Pending' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .delete(`/requests/${req.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)

    const stillThere = await request(app)
      .get('/requests/active')
      .set('Authorization', `Bearer ${token}`)

    expect(stillThere.body.some((item: { id: string }) => item.id === req.id)).toBe(false)
  })
})
