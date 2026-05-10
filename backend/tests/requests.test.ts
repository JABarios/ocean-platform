import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest, createPushSubscription, prisma } from './helpers'
import webpush from 'web-push'

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn().mockResolvedValue(undefined),
  },
}))

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
  afterEach(() => {
    delete process.env.RESEND_API_KEY
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
    ;(global as any).fetch = undefined
    jest.clearAllMocks()
  })

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

  it('crea una notificación para el destinatario directo', async () => {
    const owner = await createUser({ email: 'req-notif-own@ocean.local', displayName: 'ReqNotifOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'req-notif-rev@ocean.local', displayName: 'ReqNotifRev', password: 'pass' })
    const c = await createCase(owner.id, { title: 'Caso notificado' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id })

    expect(res.status).toBe(201)

    const reviewerNotifications = await prisma.notification.findMany({
      where: { userId: reviewer.id },
    })

    expect(reviewerNotifications).toHaveLength(1)
    expect(reviewerNotifications[0].kind).toBe('review_request_received')
    expect(reviewerNotifications[0].reviewRequestId).toBe(res.body.id)
  })

  it('envía correo al destinatario directo si hay Resend configurado', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    ;(global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    })

    const owner = await createUser({ email: 'req-mail-owner@ocean.local', displayName: 'ReqMailOwner', password: 'pass' })
    const reviewer = await createUser({ email: 'req-mail-rev@ocean.local', displayName: 'ReqMailRev', password: 'pass' })
    const c = await createCase(owner.id, { title: 'Caso correo' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id, message: 'Revísalo cuando puedas' })

    expect(res.status).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((global as any).fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Caso correo'),
      }),
    )
  })

  it('envía push al destinatario si hay VAPID configurado y está suscrito', async () => {
    process.env.VAPID_PUBLIC_KEY = 'BEl7fakePublicKey1234567890abcdefghijklmnopqrstuv'
    process.env.VAPID_PRIVATE_KEY = 'fakePrivateKey1234567890abcdefghijklmnopqrstuv'
    process.env.VAPID_SUBJECT = 'mailto:test@ocean.local'

    const owner = await createUser({ email: 'req-push-owner@ocean.local', displayName: 'ReqPushOwner', password: 'pass' })
    const reviewer = await createUser({ email: 'req-push-rev@ocean.local', displayName: 'ReqPushRev', password: 'pass' })
    await createPushSubscription({ userId: reviewer.id, endpoint: 'https://push.example/reviewer-1' })
    const c = await createCase(owner.id, { title: 'Caso push' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, targetUserId: reviewer.id })

    expect(res.status).toBe(201)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(webpush.sendNotification).toHaveBeenCalled()
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

  it('permite enviar una solicitud a un grupo del que formas parte', async () => {
    const owner = await createUser({ email: 'req-group-own@ocean.local', displayName: 'ReqGroupOwn', password: 'pass' })
    const member = await createUser({ email: 'req-group-member@ocean.local', displayName: 'ReqGroupMember', password: 'pass' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const c = await createCase(owner.id)

    const group = await request(app)
      .post('/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Grupo epilepsia' })

    const invitation = await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: member.id })

    await request(app)
      .post(`/groups/invitations/${invitation.body.id}/accept`)
      .set('Authorization', `Bearer ${generateToken(member.id, member.email, member.role)}`)

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ caseId: c.id, targetGroupId: group.body.id, message: '¿Quién quiere revisar esto?' })

    expect(res.status).toBe(201)
    expect(res.body.targetGroupId).toBe(group.body.id)
  })

  it('rechaza enviar un caso a un grupo al que no perteneces', async () => {
    const owner = await createUser({ email: 'req-group-block-own@ocean.local', displayName: 'ReqGroupBlockOwn', password: 'pass' })
    const outsider = await createUser({ email: 'req-group-block-out@ocean.local', displayName: 'ReqGroupBlockOut', password: 'pass' })
    const outsiderToken = generateToken(outsider.id, outsider.email, outsider.role)
    const c = await createCase(owner.id)

    const group = await request(app)
      .post('/groups')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ name: 'Grupo ajeno' })

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${generateToken(owner.id, owner.email, owner.role)}`)
      .send({ caseId: c.id, targetGroupId: group.body.id })

    expect(res.status).toBe(403)
  })

  it('permite solicitar acceso a la revisión de un caso propuesto', async () => {
    const owner = await createUser({ email: 'acc-prop-own@ocean.local', displayName: 'AccPropOwn', password: 'pass' })
    const outsider = await createUser({ email: 'acc-prop-out@ocean.local', displayName: 'AccPropOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Proposed' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, message: 'Me interesa revisar este caso' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('Pending')
    expect(res.body.targetUserId).toBe(owner.id)
    expect(res.body.requestedBy).toBe(outsider.id)
  })

  it('rechaza solicitar acceso si el caso no está propuesto o recomendado', async () => {
    const owner = await createUser({ email: 'acc-draft-own@ocean.local', displayName: 'AccDraftOwn', password: 'pass' })
    const outsider = await createUser({ email: 'acc-draft-out@ocean.local', displayName: 'AccDraftOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'None' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    expect(res.status).toBe(400)
  })

  it('rechaza duplicar una solicitud de acceso a revisión', async () => {
    const owner = await createUser({ email: 'acc-dup-own@ocean.local', displayName: 'AccDupOwn', password: 'pass' })
    const outsider = await createUser({ email: 'acc-dup-out@ocean.local', displayName: 'AccDupOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Proposed' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    expect(res.status).toBe(409)
  })

  it('rechaza solicitar acceso si ya existe una invitación previa para ese usuario', async () => {
    const owner = await createUser({ email: 'acc-linked-own@ocean.local', displayName: 'AccLinkedOwn', password: 'pass' })
    const outsider = await createUser({ email: 'acc-linked-out@ocean.local', displayName: 'AccLinkedOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Proposed' })
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: outsider.id, status: 'Pending' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/relación de revisión/i)
  })

  it('rechaza que el owner solicite acceso a su propio caso', async () => {
    const owner = await createUser({ email: 'acc-self-own@ocean.local', displayName: 'AccSelfOwn', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Proposed' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/propietario/i)
  })

  it('crea audit event al solicitar acceso a revisión', async () => {
    const owner = await createUser({ email: 'acc-audit-own@ocean.local', displayName: 'AccAuditOwn', password: 'pass' })
    const outsider = await createUser({ email: 'acc-audit-out@ocean.local', displayName: 'AccAuditOut', password: 'pass' })
    const c = await createCase(owner.id, { statusTeaching: 'Recommended' })
    const token = generateToken(outsider.id, outsider.email, outsider.role)

    const res = await request(app)
      .post('/requests/request-access')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, message: 'Quiero participar' })

    expect(res.status).toBe(201)

    const audit = await prisma.auditEvent.findFirst({
      where: {
        caseId: c.id,
        actorId: outsider.id,
        action: 'ReviewAccessRequested',
        target: res.body.id,
      },
    })
    expect(audit).not.toBeNull()
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

  it('miembro aceptado de un grupo puede aceptar una solicitud dirigida al grupo', async () => {
    const owner = await createUser({ email: 'acc-group-own@ocean.local', displayName: 'AccGroupOwn', password: 'pass' })
    const member = await createUser({ email: 'acc-group-member@ocean.local', displayName: 'AccGroupMember', password: 'pass' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const c = await createCase(owner.id, { statusClinical: 'Requested' })

    const group = await request(app)
      .post('/groups')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Grupo sueño' })

    const invitation = await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: member.id })

    await request(app)
      .post(`/groups/invitations/${invitation.body.id}/accept`)
      .set('Authorization', `Bearer ${generateToken(member.id, member.email, member.role)}`)

    const reqToGroup = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ caseId: c.id, targetGroupId: group.body.id })

    const res = await request(app)
      .post(`/requests/${reqToGroup.body.id}/accept`)
      .set('Authorization', `Bearer ${generateToken(member.id, member.email, member.role)}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Accepted')
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

  it('notifica al solicitante cuando se acepta', async () => {
    const owner = await createUser({ email: 'acc-notif-own@ocean.local', displayName: 'AccNotifOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'acc-notif-rev@ocean.local', displayName: 'AccNotifRev', password: 'pass' })
    const c = await createCase(owner.id, { statusClinical: 'Requested', title: 'Caso aceptación' })
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id, status: 'Pending' })
    const pending = await request(app)
      .get('/requests/pending')
      .set('Authorization', `Bearer ${generateToken(reviewer.id, reviewer.email, reviewer.role)}`)

    const accept = await request(app)
      .post(`/requests/${pending.body[0].id}/accept`)
      .set('Authorization', `Bearer ${generateToken(reviewer.id, reviewer.email, reviewer.role)}`)

    expect(accept.status).toBe(200)

    const notifications = await prisma.notification.findMany({
      where: { userId: owner.id, kind: 'review_request_accepted' },
    })
    expect(notifications).toHaveLength(1)
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
    expect(res.body[0].availableActions).toEqual(
      expect.arrayContaining(['accept_review_request', 'reject_review_request']),
    )
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
  it('el solicitante ve acciones para reenviar o retirar cuando la invitación está rechazada', async () => {
    const owner = await createUser({ email: 'active-own@ocean.local', displayName: 'ActiveOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'active-rev@ocean.local', displayName: 'ActiveRev', password: 'pass' })
    const c = await createCase(owner.id)
    const req = await createReviewRequest({
      caseId: c.id,
      requestedBy: owner.id,
      targetUserId: reviewer.id,
      status: 'Rejected',
    })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app).get('/requests/active').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const item = res.body.find((entry: { id: string }) => entry.id === req.id)
    expect(item.availableActions).toEqual(
      expect.arrayContaining(['resend_review_request', 'withdraw_review_request']),
    )
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
