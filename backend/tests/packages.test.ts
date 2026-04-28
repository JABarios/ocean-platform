import request from 'supertest'
import app from '../src/index'
import { createCase, createCasePackage, createEegRecord, createReviewRequest, createUser, generateToken, prisma } from './helpers'

describe('EEG key custody', () => {
  it('owner can store an EEG decryption key in OCEAN', async () => {
    const owner = await createUser({ email: 'pkg-owner@ocean.local', displayName: 'Pkg Owner', password: 'pass123' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'pkg-hash-1')
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .post(`/packages/secret/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ keyBase64: 'test-key-base64' })

    expect(res.status).toBe(201)
    expect(res.body.stored).toBe(true)
    const stored = await prisma.eegAccessSecret.findUnique({ where: { caseId: caseItem.id } })
    expect(stored).not.toBeNull()
    expect(stored?.wrappedKey).not.toBe('test-key-base64')
  })

  it('accepted reviewer can recover the stored key with their own password', async () => {
    const owner = await createUser({ email: 'pkg-owner-2@ocean.local', displayName: 'Pkg Owner 2', password: 'pass123' })
    const reviewer = await createUser({ email: 'pkg-reviewer@ocean.local', displayName: 'Pkg Reviewer', password: 'review123' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'pkg-hash-2')
    await prisma.eegAccessSecret.create({
      data: {
        caseId: caseItem.id,
        wrappedKey: 'placeholder',
        createdBy: owner.id,
      },
    })
    await createReviewRequest({ caseId: caseItem.id, requestedBy: owner.id, targetUserId: reviewer.id })
    await prisma.reviewRequest.updateMany({
      where: { caseId: caseItem.id, targetUserId: reviewer.id },
      data: { status: 'Accepted', acceptedAt: new Date() },
    })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app)
      .post(`/packages/secret/${caseItem.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ keyBase64: 'real-key-base64' })

    const token = generateToken(reviewer.id, reviewer.email, reviewer.role)
    const res = await request(app)
      .post(`/packages/secret/${caseItem.id}/recover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'review123' })

    expect(res.status).toBe(200)
    expect(res.body.keyBase64).toBe('real-key-base64')
  })

  it('rechaza recuperación con contraseña incorrecta', async () => {
    const owner = await createUser({ email: 'pkg-owner-3@ocean.local', displayName: 'Pkg Owner 3', password: 'pass123' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'pkg-hash-3')
    const token = generateToken(owner.id, owner.email, owner.role)
    await request(app)
      .post(`/packages/secret/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ keyBase64: 'real-key-base64' })

    const res = await request(app)
      .post(`/packages/secret/${caseItem.id}/recover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'wrong-pass' })

    expect(res.status).toBe(401)
  })

  it('rechaza recuperación para usuario no autorizado', async () => {
    const owner = await createUser({ email: 'pkg-owner-4@ocean.local', displayName: 'Pkg Owner 4', password: 'pass123' })
    const outsider = await createUser({ email: 'pkg-outsider@ocean.local', displayName: 'Pkg Outsider', password: 'outsider123' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'pkg-hash-4')
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    await request(app)
      .post(`/packages/secret/${caseItem.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ keyBase64: 'real-key-base64' })

    const token = generateToken(outsider.id, outsider.email, outsider.role)
    const res = await request(app)
      .post(`/packages/secret/${caseItem.id}/recover`)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'outsider123' })

    expect(res.status).toBe(404)
  })
})

describe('EEG records', () => {
  it('lista un EEG compartido y sus casos vinculados', async () => {
    const owner = await createUser({ email: 'eeg-owner@ocean.local', displayName: 'EEG Owner', password: 'pass123' })
    const caseA = await createCase(owner.id, { title: 'Caso A' })
    const caseB = await createCase(owner.id, { title: 'Caso B' })
    const eegRecord = await createEegRecord({
      blobHash: 'shared-hash-123',
      blobLocation: 'shared/shared-hash-123.enc',
      sizeBytes: 4096,
      uploadedBy: owner.id,
    })
    await createCasePackage(caseA.id, 'shared-hash-123', { eegRecordId: eegRecord.id, blobLocation: eegRecord.blobLocation })
    await createCasePackage(caseB.id, 'shared-hash-123', { eegRecordId: eegRecord.id, blobLocation: eegRecord.blobLocation })
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .get('/packages/eegs')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].blobHash).toBe('shared-hash-123')
    expect(res.body[0].usageCount).toBe(2)
    expect(res.body[0].cases.map((item: { title: string }) => item.title).sort()).toEqual(['Caso A', 'Caso B'])
  })
})
