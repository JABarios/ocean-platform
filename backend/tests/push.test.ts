import request from 'supertest'
import app from '../src/index'
import { createPushSubscription, createUser, generateToken, prisma } from './helpers'

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn().mockResolvedValue(undefined),
  },
}))

describe('push subscriptions', () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'BEl7fakePublicKey1234567890abcdefghijklmnopqrstuv'
    process.env.VAPID_PRIVATE_KEY = 'fakePrivateKey1234567890abcdefghijklmnopqrstuv'
    process.env.VAPID_SUBJECT = 'mailto:test@ocean.local'
  })

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
  })

  it('expone la clave pública si está configurado', async () => {
    const user = await createUser({ email: 'push-key@ocean.local', displayName: 'PushKey', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .get('/push/public-key')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(true)
    expect(res.body.publicKey).toBe(process.env.VAPID_PUBLIC_KEY)
  })

  it('guarda una suscripción push del usuario', async () => {
    const user = await createUser({ email: 'push-save@ocean.local', displayName: 'PushSave', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const res = await request(app)
      .post('/push/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint: 'https://push.example/subscription-1',
        keys: {
          p256dh: 'abc123',
          auth: 'def456',
        },
      })

    expect(res.status).toBe(201)

    const saved = await prisma.pushSubscription.findUnique({
      where: { endpoint: 'https://push.example/subscription-1' },
    })
    expect(saved?.userId).toBe(user.id)
  })

  it('permite desuscribirse por endpoint', async () => {
    const user = await createUser({ email: 'push-off@ocean.local', displayName: 'PushOff', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)
    const subscription = await createPushSubscription({
      userId: user.id,
      endpoint: 'https://push.example/subscription-off',
    })

    const res = await request(app)
      .post('/push/unsubscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint: subscription.endpoint })

    expect(res.status).toBe(204)

    const saved = await prisma.pushSubscription.findUnique({
      where: { endpoint: subscription.endpoint },
    })
    expect(saved).toBeNull()
  })
})
