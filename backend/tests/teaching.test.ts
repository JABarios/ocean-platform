import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, createCase, createReviewRequest } from './helpers'

describe('POST /teaching/proposals', () => {
  it('propone un caso resuelto para docencia', async () => {
    const user = await createUser({ email: 'teach@ocean.local', displayName: 'Teach', password: 'pass' })
    const c = await createCase(user.id, { statusClinical: 'Resolved' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        caseId: c.id,
        summary: 'Caso didáctico',
        keyFindings: 'Hallazgo principal',
        learningPoints: 'Aprendizaje',
        difficulty: 'Intermediate',
        tags: ['epilepsia'],
      })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('Proposed')
  })

  it('rechaza caso no resuelto', async () => {
    const user = await createUser({ email: 'teach2@ocean.local', displayName: 'Teach2', password: 'pass' })
    const c = await createCase(user.id, { statusClinical: 'Draft' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, summary: 'X' })

    expect(res.status).toBe(400)
  })
})

describe('POST /teaching/proposals/:id/recommend', () => {
  it('recomienda una propuesta ajena', async () => {
    const proposer = await createUser({ email: 'prop@ocean.local', displayName: 'Prop', password: 'pass' })
    const recommender = await createUser({ email: 'rec@ocean.local', displayName: 'Rec', password: 'pass' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const propToken = generateToken(proposer.id, proposer.email, proposer.role)

    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${propToken}`)
      .send({ caseId: c.id, summary: 'S', keyFindings: 'K', learningPoints: 'L', difficulty: 'Intermediate' })

    const recToken = generateToken(recommender.id, recommender.email, recommender.role)
    const res = await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/recommend`)
      .set('Authorization', `Bearer ${recToken}`)

    expect(res.status).toBe(201)
  })

  it('rechaza recomendar la propia propuesta', async () => {
    const proposer = await createUser({ email: 'self@ocean.local', displayName: 'Self', password: 'pass' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const token = generateToken(proposer.id, proposer.email, proposer.role)

    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({ caseId: c.id, summary: 'S', keyFindings: 'K', learningPoints: 'L', difficulty: 'Intermediate' })

    const res = await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/recommend`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/propia propuesta/)
  })

  it('marca como Recommended tras 2 recomendaciones', async () => {
    const proposer = await createUser({ email: 'thr@ocean.local', displayName: 'Thr', password: 'pass' })
    const r1 = await createUser({ email: 'r1@ocean.local', displayName: 'R1', password: 'pass' })
    const r2 = await createUser({ email: 'r2@ocean.local', displayName: 'R2', password: 'pass' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const pToken = generateToken(proposer.id, proposer.email, proposer.role)

    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${pToken}`)
      .send({ caseId: c.id, summary: 'S', keyFindings: 'K', learningPoints: 'L', difficulty: 'Intermediate' })

    await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/recommend`)
      .set('Authorization', `Bearer ${generateToken(r1.id, r1.email, r1.role)}`)

    await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/recommend`)
      .set('Authorization', `Bearer ${generateToken(r2.id, r2.email, r2.role)}`)

    const queue = await request(app)
      .get('/teaching/proposals')
      .set('Authorization', `Bearer ${pToken}`)

    const item = queue.body.find((p: any) => p.id === propRes.body.id)
    expect(item.status).toBe('Recommended')
  })
})

describe('POST /teaching/proposals/:id/validate', () => {
  it('solo curador puede validar', async () => {
    const proposer = await createUser({ email: 'val-p@ocean.local', displayName: 'ValP', password: 'pass' })
    const curator = await createUser({ email: 'val-c@ocean.local', displayName: 'ValC', password: 'pass', role: 'Curator' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const pToken = generateToken(proposer.id, proposer.email, proposer.role)

    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${pToken}`)
      .send({ caseId: c.id, summary: 'S', keyFindings: 'K', learningPoints: 'L', difficulty: 'Intermediate' })

    const cToken = generateToken(curator.id, curator.email, curator.role)
    const res = await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/validate`)
      .set('Authorization', `Bearer ${cToken}`)
      .send({ status: 'Validated' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('Validated')
  })

  it('rechaza validación de no-curador', async () => {
    const proposer = await createUser({ email: 'val-np@ocean.local', displayName: 'ValNP', password: 'pass' })
    const clinician = await createUser({ email: 'val-nc@ocean.local', displayName: 'ValNC', password: 'pass' })
    const c = await createCase(proposer.id, { statusClinical: 'Resolved' })
    const pToken = generateToken(proposer.id, proposer.email, proposer.role)

    const propRes = await request(app)
      .post('/teaching/proposals')
      .set('Authorization', `Bearer ${pToken}`)
      .send({ caseId: c.id, summary: 'S', keyFindings: 'K', learningPoints: 'L', difficulty: 'Intermediate' })

    const cToken = generateToken(clinician.id, clinician.email, clinician.role)
    const res = await request(app)
      .post(`/teaching/proposals/${propRes.body.id}/validate`)
      .set('Authorization', `Bearer ${cToken}`)
      .send({ status: 'Validated' })

    expect(res.status).toBe(403)
  })
})

describe('GET /teaching/library', () => {
  it('lista solo casos validados', async () => {
    const user = await createUser({ email: 'lib@ocean.local', displayName: 'Lib', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app).get('/teaching/library').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
