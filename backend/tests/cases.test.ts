import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest, prisma } from './helpers'

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

  it('devuelve lista vacía para usuario sin casos', async () => {
    const user = await createUser({ email: 'empty@ocean.local', displayName: 'Empty', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/cases').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('no lista casos de otros usuarios', async () => {
    const u1 = await createUser({ email: 'u1@ocean.local', displayName: 'U1', password: 'pass' })
    const u2 = await createUser({ email: 'u2@ocean.local', displayName: 'U2', password: 'pass' })
    await createCase(u1.id, { title: 'Caso de U1' })
    const token = generateToken(u2.id, u2.email, u2.role)

    const res = await request(app).get('/cases').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(0)
  })

  it('GET /cases/managed incluye solicitudes y paquete para la gestión operativa', async () => {
    const owner = await createUser({ email: 'managed@ocean.local', displayName: 'Managed', password: 'pass' })
    const reviewer = await createUser({ email: 'managed-reviewer@ocean.local', displayName: 'Managed Reviewer', password: 'pass' })
    const group = await prisma.group.create({ data: { name: 'Grupo EEG' } })
    const groupRequestCase = await createCase(owner.id, { title: 'Caso con grupo' })
    const c = await createCase(owner.id, { title: 'Caso gestionado', statusClinical: 'Requested' })
    await prisma.casePackage.create({
      data: {
        caseId: c.id,
        blobLocation: `${c.id}/file.enc`,
        blobHash: 'hash-managed',
        uploadStatus: 'Ready',
      },
    })
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    await prisma.reviewRequest.create({
      data: {
        caseId: groupRequestCase.id,
        requestedBy: owner.id,
        targetGroupId: group.id,
        status: 'Pending',
      },
    })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app).get('/cases/managed').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const row = res.body.find((item: { id: string }) => item.id === c.id)
    expect(row).toBeTruthy()
    expect(Array.isArray(row.reviewRequests)).toBe(true)
    expect(row.reviewRequests[0].targetUser.displayName).toBe('Managed Reviewer')
    expect(row.package.blobHash).toBe('hash-managed')

    const groupRow = res.body.find((item: { id: string }) => item.id === groupRequestCase.id)
    expect(groupRow.reviewRequests[0].targetGroup.name).toBe('Grupo EEG')
  })
})

describe('POST /cases — respuesta serializada', () => {
  it('devuelve tags como array, no como string', async () => {
    const user = await createUser({ email: 'tags@ocean.local', displayName: 'Tags', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Con tags', tags: ['epilepsia', 'EEG'] })

    expect(res.status).toBe(201)
    expect(Array.isArray(res.body.tags)).toBe(true)
    expect(res.body.tags).toContain('epilepsia')
  })

  it('devuelve campos status y teachingStatus en la respuesta', async () => {
    const user = await createUser({ email: 'fields@ocean.local', displayName: 'Fields', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Campos test' })

    expect(res.body).toHaveProperty('status', 'Draft')
    expect(res.body).toHaveProperty('teachingStatus', 'None')
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

  it('revisor con solicitud pendiente puede ver el caso', async () => {
    const owner = await createUser({ email: 'rv-own@ocean.local', displayName: 'RvOwn', password: 'pass' })
    const reviewer = await createUser({ email: 'rv-rev@ocean.local', displayName: 'RvRev', password: 'pass' })
    const c = await createCase(owner.id)
    await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)

    const res = await request(app).get(`/cases/${c.id}`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
  })

  it('crea auditEvent al crear caso', async () => {
    const user = await createUser({ email: 'audit@ocean.local', displayName: 'Audit', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Caso con audit' })

    const audit = await prisma.auditEvent.findFirst({ where: { caseId: res.body.id, action: 'CaseCreated' } })
    expect(audit).not.toBeNull()
  })
})

describe('PATCH /cases/:id/status', () => {
  it('cambia el estado del caso (Draft → Archived)', async () => {
    const user = await createUser({ email: 'status@ocean.local', displayName: 'Status', password: 'pass' })
    const c = await createCase(user.id)
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Archived' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Archived')
  })

  it('rechaza transición de estado inválida', async () => {
    const user = await createUser({ email: 'badtrans@ocean.local', displayName: 'BadTrans', password: 'pass' })
    const c = await createCase(user.id)
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Resolved' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Transición no permitida/)
  })

  it('Requested → InReview es transición válida', async () => {
    const user = await createUser({ email: 'sm1@ocean.local', displayName: 'SM1', password: 'pass' })
    const c = await createCase(user.id, { statusClinical: 'Requested' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'InReview' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('InReview')
  })

  it('InReview → Resolved es transición válida y registra resolvedAt', async () => {
    const user = await createUser({ email: 'sm2@ocean.local', displayName: 'SM2', password: 'pass' })
    const c = await createCase(user.id, { statusClinical: 'InReview' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Resolved' })
    expect(res.status).toBe(200)
    expect(res.body.resolvedAt).toBeTruthy()
  })

  it('Archived no permite ninguna transición', async () => {
    const user = await createUser({ email: 'sm3@ocean.local', displayName: 'SM3', password: 'pass' })
    const c = await createCase(user.id, { statusClinical: 'Archived' })
    const token = generateToken(user.id, user.email, user.role)

    for (const target of ['Draft', 'Requested', 'InReview', 'Resolved']) {
      const res = await request(app)
        .patch(`/cases/${c.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ statusClinical: target })
      expect(res.status).toBe(400)
    }
  })

  it('solo el owner puede cambiar estado', async () => {
    const owner = await createUser({ email: 'own2@ocean.local', displayName: 'Owner2', password: 'pass' })
    const other = await createUser({ email: 'other@ocean.local', displayName: 'Other', password: 'pass' })
    const c = await createCase(owner.id)
    const token = generateToken(other.id, other.email, other.role)

    const res = await request(app)
      .patch(`/cases/${c.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ statusClinical: 'Archived' })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /cases/:id', () => {
  it('permite al owner borrar un caso y limpia EEG huérfano', async () => {
    const owner = await createUser({ email: 'delete-owner@ocean.local', displayName: 'Delete Owner', password: 'pass' })
    const c = await createCase(owner.id, { title: 'Caso a borrar' })
    const eegRecord = await prisma.eegRecord.create({
      data: {
        blobHash: 'hash-delete-case',
        blobLocation: '/tmp/ocean-delete-case.enc',
        uploadedBy: owner.id,
      },
    })
    await prisma.casePackage.create({
      data: {
        caseId: c.id,
        eegRecordId: eegRecord.id,
        blobLocation: eegRecord.blobLocation,
        blobHash: eegRecord.blobHash,
        uploadStatus: 'Ready',
      },
    })
    const reviewer = await createUser({ email: 'delete-reviewer@ocean.local', displayName: 'Delete Reviewer', password: 'pass' })
    const reviewRequest = await createReviewRequest({ caseId: c.id, requestedBy: owner.id, targetUserId: reviewer.id })
    await prisma.comment.create({
      data: {
        caseId: c.id,
        authorId: owner.id,
        requestId: reviewRequest.id,
        body: 'Comentario asociado',
      },
    })
    await prisma.eegAccessSecret.create({
      data: {
        caseId: c.id,
        wrappedKey: 'wrapped-key',
        createdBy: owner.id,
      },
    })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .delete(`/cases/${c.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ deleted: true, caseId: c.id })
    expect(await prisma.case.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await prisma.casePackage.findFirst({ where: { caseId: c.id } })).toBeNull()
    expect(await prisma.reviewRequest.findFirst({ where: { caseId: c.id } })).toBeNull()
    expect(await prisma.comment.findFirst({ where: { caseId: c.id } })).toBeNull()
    expect(await prisma.eegAccessSecret.findFirst({ where: { caseId: c.id } })).toBeNull()
    expect(await prisma.eegRecord.findUnique({ where: { id: eegRecord.id } })).toBeNull()
    const deletionAudit = await prisma.auditEvent.findFirst({
      where: { actorId: owner.id, action: 'CaseDeleted', target: c.id },
    })
    expect(deletionAudit).not.toBeNull()
  })

  it('no permite borrar un caso ajeno', async () => {
    const owner = await createUser({ email: 'delete-foreign-owner@ocean.local', displayName: 'Delete Foreign Owner', password: 'pass' })
    const intruder = await createUser({ email: 'delete-intruder@ocean.local', displayName: 'Delete Intruder', password: 'pass' })
    const c = await createCase(owner.id, { title: 'Caso protegido' })
    const token = generateToken(intruder.id, intruder.email, intruder.role)

    const res = await request(app)
      .delete(`/cases/${c.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect(await prisma.case.findUnique({ where: { id: c.id } })).not.toBeNull()
  })
})
