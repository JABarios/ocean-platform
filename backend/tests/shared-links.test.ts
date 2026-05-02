import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import request from 'supertest'
import app from '../src/index'
import { createSharedLinkBlob, createUser, generateToken, prisma } from './helpers'

describe('shared links', () => {
  it('crea un enlace efímero cifrado para un usuario autenticado', async () => {
    const owner = await createUser({ email: 'shared-owner@ocean.local', displayName: 'Shared Owner', password: 'pass123' })
    const token = generateToken(owner.id, owner.email, owner.role)
    const tempPath = path.join(os.tmpdir(), `ocean-shared-${Date.now()}.enc`)
    await fs.writeFile(tempPath, 'shared-encrypted-payload')

    const res = await request(app)
      .post('/shared-links/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('label', 'Interconsulta nocturna')
      .field('originalFilename', 'sleep.edf')
      .field('ivBase64', 'ZmFrZS1pdi1iYXNlNjQ=')
      .attach('blob', tempPath)

    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()
    expect(res.body.label).toBe('Interconsulta nocturna')

    const stored = await prisma.sharedLinkBlob.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(stored.createdBy).toBe(owner.id)
    expect(stored.originalFilename).toBe('sleep.edf')
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('expone metadata pública y descarga del blob mientras el enlace sigue vivo', async () => {
    const tempPath = path.join(os.tmpdir(), `ocean-shared-public-${Date.now()}.enc`)
    await fs.writeFile(tempPath, 'ciphertext-body')
    const link = await createSharedLinkBlob({
      blobLocation: tempPath,
      label: 'Consulta rápida',
      sizeBytes: 15,
    })

    const metaRes = await request(app).get(`/shared-links/${link.id}`)
    expect(metaRes.status).toBe(200)
    expect(metaRes.body.label).toBe('Consulta rápida')
    expect(metaRes.headers['cache-control']).toContain('no-store')

    const downloadRes = await request(app).get(`/shared-links/${link.id}/download`)
    expect(downloadRes.status).toBe(200)
    expect(downloadRes.text).toBe('ciphertext-body')
  })

  it('permite revocar el enlace al creador y deja de servirlo', async () => {
    const owner = await createUser({ email: 'shared-revoke@ocean.local', displayName: 'Revoker', password: 'pass123' })
    const token = generateToken(owner.id, owner.email, owner.role)
    const tempPath = path.join(os.tmpdir(), `ocean-shared-revoke-${Date.now()}.enc`)
    await fs.writeFile(tempPath, 'ciphertext-revoke')
    const link = await createSharedLinkBlob({
      createdBy: owner.id,
      blobLocation: tempPath,
    })

    const revokeRes = await request(app)
      .post(`/shared-links/${link.id}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    expect(revokeRes.status).toBe(200)
    expect(revokeRes.body.revoked).toBe(true)

    const publicRes = await request(app).get(`/shared-links/${link.id}`)
    expect(publicRes.status).toBe(410)
  })
})
