import crypto from 'crypto'
import { prisma } from './prisma'

function getBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN || ''
}

export function getTelegramBotUsername() {
  return process.env.TELEGRAM_BOT_USERNAME || null
}

export function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET || null
}

export function isTelegramConfigured() {
  return Boolean(getBotToken() && getTelegramBotUsername() && getTelegramWebhookSecret())
}

export function buildTelegramStartUrl(token: string) {
  const username = getTelegramBotUsername()
  if (!username) return null
  return `https://t.me/${username}?start=${token}`
}

export function buildTelegramWebhookUrl() {
  const secret = getTelegramWebhookSecret()
  const origin = process.env.APP_ORIGIN || 'http://localhost:5173'
  if (!secret) return null
  return `${origin}/api/telegram/webhook/${secret}`
}

export function generateTelegramStartToken() {
  return crypto.randomBytes(24).toString('base64url')
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = getBotToken()
  if (!token) {
    return { delivered: false, mode: 'disabled' as const }
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || String(response.status))
  }

  return { delivered: true, mode: 'telegram' as const }
}

export async function sendTelegramToUser(userId: string, payload: {
  text: string
  url?: string
}) {
  if (!isTelegramConfigured()) return

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      telegramChatId: true,
      telegramNotificationsEnabled: true,
    },
  })

  if (!user?.telegramChatId || !user.telegramNotificationsEnabled) return

  const message = payload.url ? `${payload.text}\n${payload.url}` : payload.text
  await sendTelegramMessage(user.telegramChatId, message)
}

export async function confirmTelegramLink(chatId: string, text: string) {
  try {
    await sendTelegramMessage(chatId, text)
  } catch (error) {
    console.warn('[OCEAN telegram] No se pudo enviar confirmación por Telegram', error)
  }
}
