import os from 'os'
import path from 'path'
import { promises as fsPromises } from 'fs'
import request from 'supertest'
import app from '../src/index'
import { createUser, generateToken, prisma } from './helpers'

describe('Galleries', () => {
  it('curator puede importar una galería desde un directorio local del servidor', async () => {
    const curator = await createUser({
      email: 'gallery-curator@ocean.local',
      displayName: 'Gallery Curator',
      role: 'Curator',
      password: 'pass123',
    })
    const token = generateToken(curator.id, curator.email, curator.role)

    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ocean-gallery-'))
    await fsPromises.writeFile(path.join(tmpDir, 'alpha.edf'), Buffer.from('fake-edf-alpha'))
    await fsPromises.writeFile(path.join(tmpDir, 'beta.edf'), Buffer.from('fake-edf-beta'))

    const res = await request(app)
      .post('/galleries/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'CHB-MIT chb01',
        source: 'PhysioNet',
        license: 'Open data',
        visibility: 'Institutional',
        tags: ['mit', 'publico'],
        directoryPath: tmpDir,
      })

    expect(res.status).toBe(201)
    expect(res.body.title).toBe('CHB-MIT chb01')
    expect(res.body.recordCount).toBe(2)
    expect(res.body.records).toHaveLength(2)

    const gallery = await prisma.gallery.findUnique({
      where: { id: res.body.id },
      include: { records: true },
    })
    expect(gallery).not.toBeNull()
    expect(gallery?.records).toHaveLength(2)
  })

  it('lista galerías y devuelve su detalle con registros', async () => {
    const curator = await createUser({
      email: 'gallery-reader@ocean.local',
      displayName: 'Gallery Reader',
      role: 'Curator',
      password: 'pass123',
    })
    const token = generateToken(curator.id, curator.email, curator.role)

    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ocean-gallery-'))
    await fsPromises.writeFile(path.join(tmpDir, 'gamma.edf'), Buffer.from('fake-edf-gamma'))

    const createRes = await request(app)
      .post('/galleries/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Galería detalle',
        source: 'Servidor local',
        license: 'Libre',
        visibility: 'Public',
        tags: ['demo'],
        directoryPath: tmpDir,
      })

    const galleryId = createRes.body.id
    const recordId = createRes.body.records[0].id

    const listRes = await request(app)
      .get('/galleries')
      .set('Authorization', `Bearer ${token}`)

    expect(listRes.status).toBe(200)
    expect(listRes.body[0].recordCount).toBeGreaterThan(0)

    const detailRes = await request(app)
      .get(`/galleries/${galleryId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(detailRes.status).toBe(200)
    expect(detailRes.body.id).toBe(galleryId)
    expect(detailRes.body.records).toHaveLength(1)

    const recordRes = await request(app)
      .get(`/galleries/records/${recordId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(recordRes.status).toBe(200)
    expect(recordRes.body.id).toBe(recordId)
    expect(recordRes.body.gallery.id).toBe(galleryId)
    expect(recordRes.body.eegRecord.encryptionMode).toBe('NONE')
  })

  it('permite actualizar y borrar una galería, limpiando EEGs huérfanos', async () => {
    const curator = await createUser({
      email: 'gallery-manager@ocean.local',
      displayName: 'Gallery Manager',
      role: 'Curator',
      password: 'pass123',
    })
    const token = generateToken(curator.id, curator.email, curator.role)

    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ocean-gallery-'))
    await fsPromises.writeFile(path.join(tmpDir, 'delta.edf'), Buffer.from('fake-edf-delta'))

    const createRes = await request(app)
      .post('/galleries/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Galería editable',
        source: 'Local',
        license: 'Libre',
        visibility: 'Institutional',
        tags: ['editable'],
        directoryPath: tmpDir,
      })

    const galleryId = createRes.body.id
    const eegRecordId = createRes.body.records[0].eegRecord.id

    const updateRes = await request(app)
      .patch(`/galleries/${galleryId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Galería editada',
        source: 'Servidor local',
        license: 'CC',
        visibility: 'Public',
        tags: ['editada', 'publica'],
      })

    expect(updateRes.status).toBe(200)
    expect(updateRes.body.title).toBe('Galería editada')
    expect(updateRes.body.visibility).toBe('Public')

    const deleteRes = await request(app)
      .delete(`/galleries/${galleryId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(deleteRes.status).toBe(200)
    expect(deleteRes.body).toEqual({ deleted: true, galleryId })
    expect(await prisma.gallery.findUnique({ where: { id: galleryId } })).toBeNull()
    expect(await prisma.eegRecord.findUnique({ where: { id: eegRecordId } })).toBeNull()
  })

  it('rechaza importaciones fuera del directorio base permitido', async () => {
    const curator = await createUser({
      email: 'gallery-forbidden@ocean.local',
      displayName: 'Gallery Forbidden',
      role: 'Curator',
      password: 'pass123',
    })
    const token = generateToken(curator.id, curator.email, curator.role)

    const outsideDir = await fsPromises.mkdtemp(path.join(process.cwd(), 'gallery-outside-'))
    await fsPromises.writeFile(path.join(outsideDir, 'omega.edf'), Buffer.from('fake-edf-omega'))

    const res = await request(app)
      .post('/galleries/import')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Galería prohibida',
        source: 'Fuera de raíz',
        license: 'Libre',
        visibility: 'Institutional',
        tags: ['forbidden'],
        directoryPath: outsideDir,
      })

    expect(res.status).toBe(403)
    expect(res.body.error).toMatch(/fuera del directorio permitido/i)

    await fsPromises.rm(outsideDir, { recursive: true, force: true })
  })
})
