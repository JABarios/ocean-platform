import request from 'supertest'
import app from '../src/index'
import { createCase, createNotification, createUser, generateToken } from './helpers'

describe('GET /notifications', () => {
  it('lista las notificaciones del usuario en orden reciente', async () => {
    const user = await createUser({ email: 'notif-user@ocean.local', displayName: 'NotifUser', password: 'pass' })
    const actor = await createUser({ email: 'notif-actor@ocean.local', displayName: 'NotifActor', password: 'pass' })
    const caseItem = await createCase(actor.id, { title: 'Caso notificable' })
    const token = generateToken(user.id, user.email, user.role)

    await createNotification({
      userId: user.id,
      actorUserId: actor.id,
      caseId: caseItem.id,
      kind: 'comment_on_case',
      title: 'Nuevo comentario en caso',
      body: 'NotifActor ha comentado en Caso notificable.',
    })

    const res = await request(app)
      .get('/notifications')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].title).toBe('Nuevo comentario en caso')
    expect(res.body[0].actor.displayName).toBe('NotifActor')
    expect(res.body[0].case.id).toBe(caseItem.id)
  })
})

describe('GET /notifications/unread-count', () => {
  it('devuelve el número de no leídas', async () => {
    const user = await createUser({ email: 'notif-count@ocean.local', displayName: 'NotifCount', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    await createNotification({ userId: user.id, title: 'No leída 1', body: 'A' })
    await createNotification({ userId: user.id, title: 'No leída 2', body: 'B' })
    await createNotification({ userId: user.id, title: 'Leída', body: 'C', readAt: new Date() })

    const res = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(2)
  })
})

describe('POST /notifications/:id/read', () => {
  it('marca una notificación como leída', async () => {
    const user = await createUser({ email: 'notif-read@ocean.local', displayName: 'NotifRead', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const notification = await createNotification({ userId: user.id, title: 'Pendiente', body: 'Leer' })

    const res = await request(app)
      .post(`/notifications/${notification.id}/read`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.readAt).toBeTruthy()
  })
})

describe('POST /notifications/read-all', () => {
  it('marca todas las notificaciones como leídas', async () => {
    const user = await createUser({ email: 'notif-all@ocean.local', displayName: 'NotifAll', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    await createNotification({ userId: user.id, title: 'A', body: 'A' })
    await createNotification({ userId: user.id, title: 'B', body: 'B' })

    const res = await request(app)
      .post('/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)

    const count = await request(app)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)

    expect(count.body.count).toBe(0)
  })
})
