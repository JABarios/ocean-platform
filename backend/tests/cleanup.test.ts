import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import request from 'supertest'
import app from '../src/index'
import { createCase, createCasePackage, createReviewRequest, createUser, generateToken, prisma } from './helpers'

describe('cleanup admin endpoints', () => {
  it('solo Admin puede pedir el reporte', async () => {
    const clinician = await createUser({ email: 'cleanup-clinician@ocean.local', displayName: 'Clinician', password: 'pass' })
    const token = generateToken(clinician.id, clinician.email, clinician.role)

    const res = await request(app)
      .get('/cleanup/report')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('genera reporte con candidatos de limpieza', async () => {
    const admin = await createUser({ email: 'cleanup-admin@ocean.local', displayName: 'Cleanup Admin', role: 'Admin' })
    const owner = await createUser({ email: 'cleanup-owner@ocean.local', displayName: 'Cleanup Owner', password: 'pass' })
    const draftCase = await createCase(owner.id, { title: 'Draft viejo', updatedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) })
    const expiringCase = await createCase(owner.id, { title: 'Caso con paquete vencido' })
    await prisma.casePackage.create({
      data: {
        caseId: expiringCase.id,
        blobLocation: '/tmp/fake-expired.enc',
        blobHash: 'expired-hash',
        sizeBytes: 1234,
        uploadStatus: 'Ready',
        retentionPolicy: 'Temporal72h',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    })
    const reviewer = await createUser({ email: 'cleanup-reviewer@ocean.local', displayName: 'Cleanup Reviewer', password: 'pass' })
    const expiredRequestCase = await createCase(owner.id, { title: 'Caso con request caducada' })
    await createReviewRequest({ caseId: expiredRequestCase.id, requestedBy: owner.id, targetUserId: reviewer.id })
    await prisma.reviewRequest.updateMany({
      where: { caseId: expiredRequestCase.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
    await prisma.viewerState.create({
      data: {
        userId: owner.id,
        packageHash: 'viewer-old-hash',
        updatedAt: new Date(Date.now() - 190 * 24 * 60 * 60 * 1000),
      },
    })

    const token = generateToken(admin.id, admin.email, admin.role)
    const res = await request(app)
      .get('/cleanup/report')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.tasks.expiredRequests.count).toBe(1)
    expect(res.body.tasks.expiredPackages.count).toBe(1)
    expect(res.body.tasks.staleViewerStates.count).toBe(1)
    expect(res.body.tasks.oldDraftCases.items.some((item: { id: string }) => item.id === draftCase.id)).toBe(true)
  })

  it('ejecuta limpieza segura para requests caducadas y viewer states viejos', async () => {
    const admin = await createUser({ email: 'cleanup-run-admin@ocean.local', displayName: 'Cleanup Runner', role: 'Admin' })
    const owner = await createUser({ email: 'cleanup-run-owner@ocean.local', displayName: 'Owner', password: 'pass' })
    const reviewer = await createUser({ email: 'cleanup-run-reviewer@ocean.local', displayName: 'Reviewer', password: 'pass' })
    const caseItem = await createCase(owner.id)
    await createReviewRequest({ caseId: caseItem.id, requestedBy: owner.id, targetUserId: reviewer.id })
    const requestRow = await prisma.reviewRequest.findFirstOrThrow({ where: { caseId: caseItem.id } })
    await prisma.reviewRequest.update({
      where: { id: requestRow.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
    await prisma.viewerState.create({
      data: {
        userId: owner.id,
        packageHash: 'old-viewer-state-hash',
        updatedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      },
    })

    const token = generateToken(admin.id, admin.email, admin.role)
    const res = await request(app)
      .post('/cleanup/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ tasks: ['expiredRequests', 'staleViewerStates'] })

    expect(res.status).toBe(200)
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task: 'expiredRequests', affected: 1 }),
        expect.objectContaining({ task: 'staleViewerStates', affected: 1 }),
      ]),
    )

    const updatedRequest = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: requestRow.id } })
    expect(updatedRequest.status).toBe('Expired')
    expect(await prisma.viewerState.count()).toBe(0)

    const auditActions = await prisma.auditEvent.findMany({
      where: { actorId: admin.id },
      select: { action: true },
    })
    expect(auditActions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['CleanupExpiredRequests', 'CleanupDeletedViewerStates']),
    )
  })

  it('elimina paquetes caducados y borra su blob', async () => {
    const admin = await createUser({ email: 'cleanup-pkg-admin@ocean.local', displayName: 'Pkg Admin', role: 'Admin' })
    const owner = await createUser({ email: 'cleanup-pkg-owner@ocean.local', displayName: 'Pkg Owner', password: 'pass' })
    const caseItem = await createCase(owner.id, { title: 'Paquete vencido' })
    const tempPath = path.join(os.tmpdir(), `ocean-cleanup-${Date.now()}.enc`)
    await fs.writeFile(tempPath, 'encrypted')

    await createCasePackage(caseItem.id, 'cleanup-pkg-hash', {
      blobLocation: tempPath,
      sizeBytes: 9,
      retentionPolicy: 'Temporal72h',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    const token = generateToken(admin.id, admin.email, admin.role)
    const res = await request(app)
      .post('/cleanup/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ tasks: ['expiredPackages'] })

    expect(res.status).toBe(200)
    expect(res.body.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task: 'expiredPackages', affected: 1, freedBytes: 9 }),
      ]),
    )
    expect(await prisma.casePackage.count()).toBe(0)
    await expect(fs.access(tempPath)).rejects.toThrow()
  })
})
