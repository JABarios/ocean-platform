import { Router } from 'express'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import {
  buildTelegramStartUrl,
  confirmTelegramLink,
  generateTelegramStartToken,
  getTelegramBotUsername,
  getTelegramWebhookSecret,
  isTelegramConfigured,
} from '../utils/telegram'

const router = Router()

router.post('/webhook/:secret', async (req, res) => {
  const expectedSecret = getTelegramWebhookSecret()
  if (!expectedSecret || req.params.secret !== expectedSecret) {
    res.status(404).json({ error: 'Endpoint no encontrado' })
    return
  }

  const message = req.body?.message
  const text = typeof message?.text === 'string' ? message.text.trim() : ''
  const chatId = message?.chat?.id ? String(message.chat.id) : ''
  const username = typeof message?.from?.username === 'string' ? message.from.username : null

  if (!text.startsWith('/start') || !chatId) {
    res.json({ ok: true })
    return
  }

  const token = text.split(/\s+/)[1]
  if (!token) {
    await confirmTelegramLink(chatId, 'Bot de OCEAN listo. Abre OCEAN y pulsa "Activar Telegram" para vincular tu cuenta.')
    res.json({ ok: true })
    return
  }

  const linkToken = await prisma.telegramLinkToken.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  })

  if (!linkToken || linkToken.consumedAt || linkToken.expiresAt < new Date()) {
    await confirmTelegramLink(chatId, 'Este enlace de OCEAN ya no es válido. Vuelve a la app y genera uno nuevo.')
    res.json({ ok: true })
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: {
        telegramChatId: chatId,
        NOT: { id: linkToken.userId },
      },
      data: {
        telegramChatId: null,
        telegramUsername: null,
        telegramLinkedAt: null,
        telegramNotificationsEnabled: false,
      },
    })

    await tx.user.update({
      where: { id: linkToken.userId },
      data: {
        telegramChatId: chatId,
        telegramUsername: username,
        telegramLinkedAt: new Date(),
        telegramNotificationsEnabled: true,
      },
    })

    await tx.telegramLinkToken.update({
      where: { id: linkToken.id },
      data: {
        consumedAt: new Date(),
      },
    })

    await tx.telegramLinkToken.deleteMany({
      where: {
        userId: linkToken.userId,
        consumedAt: null,
        NOT: { id: linkToken.id },
      },
    })
  })

  await confirmTelegramLink(chatId, `Tu cuenta de OCEAN ha quedado vinculada${linkToken.user?.displayName ? `, ${linkToken.user.displayName}` : ''}. Ya puedes cerrar Telegram y volver a OCEAN.`)
  res.json({ ok: true })
})

router.use(authMiddleware)

router.get('/status', async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      telegramChatId: true,
      telegramUsername: true,
      telegramLinkedAt: true,
      telegramNotificationsEnabled: true,
    },
  })

  res.json({
    configured: isTelegramConfigured(),
    botUsername: getTelegramBotUsername(),
    linked: Boolean(user?.telegramChatId),
    username: user?.telegramUsername || null,
    linkedAt: user?.telegramLinkedAt || null,
    notificationsEnabled: Boolean(user?.telegramChatId && user.telegramNotificationsEnabled),
  })
})

router.post('/link', async (req: AuthenticatedRequest, res) => {
  if (!isTelegramConfigured()) {
    res.status(400).json({ error: 'Telegram no está configurado todavía en el servidor' })
    return
  }

  await prisma.telegramLinkToken.deleteMany({
    where: {
      userId: req.user!.id,
      consumedAt: null,
    },
  })

  const token = generateTelegramStartToken()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000)
  const link = await prisma.telegramLinkToken.create({
    data: {
      userId: req.user!.id,
      token,
      expiresAt,
    },
  })

  res.status(201).json({
    botUsername: getTelegramBotUsername(),
    connectUrl: buildTelegramStartUrl(link.token),
    expiresAt: link.expiresAt,
  })
})

router.post('/unlink', async (req: AuthenticatedRequest, res) => {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: req.user!.id },
      data: {
        telegramChatId: null,
        telegramUsername: null,
        telegramLinkedAt: null,
        telegramNotificationsEnabled: false,
      },
    }),
    prisma.telegramLinkToken.deleteMany({
      where: { userId: req.user!.id },
    }),
  ])

  res.status(204).send()
})

export default router
