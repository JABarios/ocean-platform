import request from 'supertest'
import app from '../src/index'
import { createTelegramLinkToken, createUser, generateToken, prisma } from './helpers'

describe('telegram notifications', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'telegram-test-token'
    process.env.TELEGRAM_BOT_USERNAME = 'ocean_test_bot'
    process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-secret'
    process.env.APP_ORIGIN = 'https://app.ocean-eeg.org'
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    } as any) as any
  })

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_BOT_USERNAME
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    delete process.env.APP_ORIGIN
    jest.restoreAllMocks()
  })

  it('expone el estado y permite generar enlace de conexión', async () => {
    const user = await createUser({ email: 'telegram-status@ocean.local', displayName: 'Telegram Status', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    const status = await request(app)
      .get('/telegram/status')
      .set('Authorization', `Bearer ${token}`)

    expect(status.status).toBe(200)
    expect(status.body.configured).toBe(true)
    expect(status.body.linked).toBe(false)
    expect(status.body.botUsername).toBe('ocean_test_bot')

    const link = await request(app)
      .post('/telegram/link')
      .set('Authorization', `Bearer ${token}`)

    expect(link.status).toBe(201)
    expect(link.body.connectUrl).toContain('https://t.me/ocean_test_bot?start=')
  })

  it('vincula la cuenta al recibir /start con token válido', async () => {
    const user = await createUser({ email: 'telegram-link@ocean.local', displayName: 'Telegram Link', password: 'pass' })
    const linkToken = await createTelegramLinkToken({
      userId: user.id,
      token: 'token-telegram-ok',
    })

    const res = await request(app)
      .post(`/telegram/webhook/${process.env.TELEGRAM_WEBHOOK_SECRET}`)
      .send({
        message: {
          text: `/start ${linkToken.token}`,
          chat: { id: 123456789 },
          from: { username: 'juantelegram' },
        },
      })

    expect(res.status).toBe(200)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.telegramChatId).toBe('123456789')
    expect(updated?.telegramUsername).toBe('juantelegram')
    expect(updated?.telegramNotificationsEnabled).toBe(true)
  })

  it('permite desvincular Telegram', async () => {
    const user = await createUser({ email: 'telegram-off@ocean.local', displayName: 'Telegram Off', password: 'pass' })
    const token = generateToken(user.id, user.email, user.role)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: '12345',
        telegramUsername: 'telegramoff',
        telegramLinkedAt: new Date(),
        telegramNotificationsEnabled: true,
      },
    })

    const res = await request(app)
      .post('/telegram/unlink')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)

    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.telegramChatId).toBeNull()
    expect(updated?.telegramNotificationsEnabled).toBe(false)
  })
})
