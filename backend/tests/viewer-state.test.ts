import request from 'supertest'
import app from '../src/index'
import { createCase, createCasePackage, createReviewRequest, createUser, generateToken, prisma } from './helpers'

describe('viewer state', () => {
  it('guarda y recupera el estado del visor para el owner', async () => {
    const owner = await createUser({ email: 'viewer-owner@ocean.local', displayName: 'Viewer Owner', password: 'pass' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'hash-owner')
    const token = generateToken(owner.id, owner.email, owner.role)

    const saveRes = await request(app)
      .put(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        positionSec: 120,
        windowSecs: 30,
        hp: 1,
        lp: 30,
        notch: false,
        gainMult: 2,
        normalizeNonEEG: true,
        montage: 'promedio',
        excludedAverageReferenceChannels: ['Fp1', 'F7'],
        includedHiddenChannels: ['ECG'],
        dsaChannel: '3',
        artifactReject: true,
      })

    expect(saveRes.status).toBe(200)
    expect(saveRes.body.positionSec).toBe(120)
    expect(saveRes.body.excludedAverageReferenceChannels).toEqual(['Fp1', 'F7'])

    const getRes = await request(app)
      .get(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(getRes.status).toBe(200)
    expect(getRes.body).toMatchObject({
      positionSec: 120,
      windowSecs: 30,
      hp: 1,
      lp: 30,
      notch: false,
      gainMult: 2,
      normalizeNonEEG: true,
      montage: 'promedio',
      excludedAverageReferenceChannels: ['Fp1', 'F7'],
      includedHiddenChannels: ['ECG'],
      dsaChannel: '3',
      artifactReject: true,
    })
  })

  it('comparte el mismo estado entre casos distintos con el mismo blobHash para el mismo usuario', async () => {
    const owner = await createUser({ email: 'viewer-shared@ocean.local', displayName: 'Viewer Shared', password: 'pass' })
    const firstCase = await createCase(owner.id, { title: 'Caso A' })
    const secondCase = await createCase(owner.id, { title: 'Caso B' })
    await createCasePackage(firstCase.id, 'shared-hash')
    await createCasePackage(secondCase.id, 'shared-hash')
    const token = generateToken(owner.id, owner.email, owner.role)

    await request(app)
      .put(`/viewer-state/${firstCase.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        positionSec: 45,
        windowSecs: 20,
        hp: 0.5,
        lp: 45,
        notch: true,
        gainMult: 1,
        normalizeNonEEG: false,
        montage: 'doble_banana',
        excludedAverageReferenceChannels: [],
        includedHiddenChannels: ['A1'],
        dsaChannel: 'off',
        artifactReject: false,
      })

    const secondRes = await request(app)
      .get(`/viewer-state/${secondCase.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(secondRes.status).toBe(200)
    expect(secondRes.body).toMatchObject({
      positionSec: 45,
      windowSecs: 20,
      montage: 'doble_banana',
      includedHiddenChannels: ['A1'],
    })
  })

  it('mantiene estados separados por usuario aunque el EEG sea el mismo', async () => {
    const owner = await createUser({ email: 'viewer-owner2@ocean.local', displayName: 'Viewer Owner 2', password: 'pass' })
    const reviewer = await createUser({ email: 'viewer-reviewer@ocean.local', displayName: 'Viewer Reviewer', password: 'pass' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'same-hash')
    await createReviewRequest({ caseId: caseItem.id, requestedBy: owner.id, targetUserId: reviewer.id })

    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const reviewerToken = generateToken(reviewer.id, reviewer.email, reviewer.role)

    await request(app)
      .put(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        positionSec: 15,
        windowSecs: 10,
        hp: 0.5,
        lp: 45,
        notch: true,
        gainMult: 1,
        normalizeNonEEG: false,
        montage: 'promedio',
        excludedAverageReferenceChannels: ['Fp1'],
        includedHiddenChannels: [],
        dsaChannel: '2',
        artifactReject: true,
      })

    const reviewerRes = await request(app)
      .get(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${reviewerToken}`)

    expect(reviewerRes.status).toBe(200)
    expect(reviewerRes.body).toBeNull()
  })

  it('rechaza guardar si el caso no tiene paquete asociado', async () => {
    const owner = await createUser({ email: 'viewer-nopkg@ocean.local', displayName: 'Viewer NoPkg', password: 'pass' })
    const caseItem = await createCase(owner.id)
    const token = generateToken(owner.id, owner.email, owner.role)

    const res = await request(app)
      .put(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        positionSec: 0,
        windowSecs: 10,
        hp: 0.5,
        lp: 45,
        notch: true,
        gainMult: 1,
        normalizeNonEEG: false,
        montage: 'promedio',
        excludedAverageReferenceChannels: [],
        includedHiddenChannels: [],
        dsaChannel: 'off',
        artifactReject: false,
      })

    expect(res.status).toBe(404)
  })

  it('hace upsert en vez de duplicar estados para el mismo usuario y paquete', async () => {
    const owner = await createUser({ email: 'viewer-upsert@ocean.local', displayName: 'Viewer Upsert', password: 'pass' })
    const caseItem = await createCase(owner.id)
    await createCasePackage(caseItem.id, 'upsert-hash')
    const token = generateToken(owner.id, owner.email, owner.role)

    await request(app)
      .put(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        positionSec: 10,
        windowSecs: 10,
        hp: 0.5,
        lp: 45,
        notch: true,
        gainMult: 1,
        normalizeNonEEG: false,
        montage: 'promedio',
        excludedAverageReferenceChannels: [],
        includedHiddenChannels: [],
        dsaChannel: 'off',
        artifactReject: false,
      })

    await request(app)
      .put(`/viewer-state/${caseItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        positionSec: 90,
        windowSecs: 30,
        hp: 1,
        lp: 30,
        notch: false,
        gainMult: 2,
        normalizeNonEEG: true,
        montage: 'hjorth',
        excludedAverageReferenceChannels: ['Fp1'],
        includedHiddenChannels: ['ECG'],
        dsaChannel: '5',
        artifactReject: true,
      })

    const states = await prisma.viewerState.findMany()
    expect(states).toHaveLength(1)
    expect(states[0].positionSec).toBe(90)
    expect(states[0].montage).toBe('hjorth')
  })
})
