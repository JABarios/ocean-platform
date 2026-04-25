import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken } from './helpers'

describe('POST /groups', () => {
  it('crea un grupo y añade al creador como admin', async () => {
    const user = await createUser({ email: 'grp-own@ocean.local', displayName: 'GrpOwn', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Grupo de Neurofisiología', description: 'Equipo EEG' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Grupo de Neurofisiología')
    expect(res.body.members).toHaveLength(1)
    expect(res.body.members[0].role).toBe('admin')
    expect(res.body.members[0].user.id).toBe(user.id)
  })

  it('rechaza nombre vacío', async () => {
    const user = await createUser({ email: 'grp-bad@ocean.local', displayName: 'GrpBad', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })

    expect(res.status).toBe(400)
  })
})

describe('GET /groups', () => {
  it('lista solo los grupos del usuario', async () => {
    const user = await createUser({ email: 'grp-list@ocean.local', displayName: 'GrpList', password: 'pass' })
    const other = await createUser({ email: 'grp-other@ocean.local', displayName: 'GrpOther', password: 'pass' })
    const tokenUser = generateToken(user.id, user.email, user.role)
    const tokenOther = generateToken(other.id, other.email, other.role)

    await request(app).post('/groups').set('Authorization', `Bearer ${tokenUser}`).send({ name: 'Mi Grupo' })
    await request(app).post('/groups').set('Authorization', `Bearer ${tokenOther}`).send({ name: 'Otro Grupo' })

    const res = await request(app).get('/groups').set('Authorization', `Bearer ${tokenUser}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Mi Grupo')
  })
})

describe('GET /groups/:id', () => {
  it('miembro puede ver detalle del grupo', async () => {
    const user = await createUser({ email: 'grp-det@ocean.local', displayName: 'GrpDet', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${token}`).send({ name: 'Detalle' })
    const res = await request(app).get(`/groups/${created.body.id}`).set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.members).toHaveLength(1)
  })

  it('no-miembro recibe 404', async () => {
    const owner = await createUser({ email: 'grp-o2@ocean.local', displayName: 'GrpO2', password: 'pass' })
    const intruder = await createUser({ email: 'grp-int@ocean.local', displayName: 'GrpInt', password: 'pass' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const intruderToken = generateToken(intruder.id, intruder.email, intruder.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Privado' })
    const res = await request(app).get(`/groups/${created.body.id}`).set('Authorization', `Bearer ${intruderToken}`)

    expect(res.status).toBe(404)
  })
})

describe('POST /groups/:id/members', () => {
  it('admin puede añadir un miembro', async () => {
    const owner = await createUser({ email: 'grp-adm@ocean.local', displayName: 'GrpAdm', password: 'pass' })
    const newMember = await createUser({ email: 'grp-mem@ocean.local', displayName: 'GrpMem', password: 'pass' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${token}`).send({ name: 'AddMember' })
    const res = await request(app)
      .post(`/groups/${created.body.id}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userId: newMember.id })

    expect(res.status).toBe(201)
    expect(res.body.user.id).toBe(newMember.id)
  })

  it('no-admin no puede añadir miembros', async () => {
    const owner = await createUser({ email: 'grp-oa@ocean.local', displayName: 'GrpOA', password: 'pass' })
    const member = await createUser({ email: 'grp-ma@ocean.local', displayName: 'GrpMA', password: 'pass' })
    const outsider = await createUser({ email: 'grp-out@ocean.local', displayName: 'GrpOut', password: 'pass' })
    const ownerToken = generateToken(owner.id, owner.email, owner.role)
    const memberToken = generateToken(member.id, member.email, member.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Perm' })
    await request(app).post(`/groups/${created.body.id}/members`).set('Authorization', `Bearer ${ownerToken}`).send({ userId: member.id })

    const res = await request(app)
      .post(`/groups/${created.body.id}/members`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ userId: outsider.id })

    expect(res.status).toBe(403)
  })

  it('no puede añadir miembro duplicado', async () => {
    const owner = await createUser({ email: 'grp-dup@ocean.local', displayName: 'GrpDup', password: 'pass' })
    const member = await createUser({ email: 'grp-dupM@ocean.local', displayName: 'GrpDupM', password: 'pass' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${token}`).send({ name: 'Dup' })
    await request(app).post(`/groups/${created.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: member.id })
    const res = await request(app).post(`/groups/${created.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: member.id })

    expect(res.status).toBe(409)
  })
})

describe('DELETE /groups/:id/members/:userId', () => {
  it('admin puede eliminar un miembro', async () => {
    const owner = await createUser({ email: 'grp-del@ocean.local', displayName: 'GrpDel', password: 'pass' })
    const member = await createUser({ email: 'grp-delM@ocean.local', displayName: 'GrpDelM', password: 'pass' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${token}`).send({ name: 'Delete' })
    await request(app).post(`/groups/${created.body.id}/members`).set('Authorization', `Bearer ${token}`).send({ userId: member.id })

    const res = await request(app)
      .delete(`/groups/${created.body.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })

  it('admin no puede eliminarse a sí mismo', async () => {
    const owner = await createUser({ email: 'grp-self@ocean.local', displayName: 'GrpSelf', password: 'pass' })
    const token = generateToken(owner.id, owner.email, owner.role)

    const created = await request(app).post('/groups').set('Authorization', `Bearer ${token}`).send({ name: 'Self' })
    const res = await request(app)
      .delete(`/groups/${created.body.id}/members/${owner.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })
})
