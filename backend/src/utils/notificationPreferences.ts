import { prisma } from './prisma'

export type NotificationPreferenceEvent =
  | 'review_request_direct'
  | 'review_request_group'
  | 'group_invitation'
  | 'comment_on_case'

export type NotificationPreferenceChannel = 'email' | 'telegram' | 'push'

export type NotificationPreferences = Record<
  NotificationPreferenceEvent,
  Record<NotificationPreferenceChannel, boolean>
>

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  review_request_direct: {
    email: true,
    telegram: true,
    push: true,
  },
  review_request_group: {
    email: true,
    telegram: true,
    push: true,
  },
  group_invitation: {
    email: true,
    telegram: true,
    push: true,
  },
  comment_on_case: {
    email: false,
    telegram: false,
    push: false,
  },
}

function normalizePreferences(value: unknown): NotificationPreferences {
  const source = (value && typeof value === 'object') ? value as Record<string, any> : {}
  const normalized = {} as NotificationPreferences

  for (const eventKey of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as NotificationPreferenceEvent[]) {
    normalized[eventKey] = { ...DEFAULT_NOTIFICATION_PREFERENCES[eventKey] }
    const eventSource = source[eventKey]

    if (eventSource && typeof eventSource === 'object') {
      for (const channelKey of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES[eventKey]) as NotificationPreferenceChannel[]) {
        if (typeof eventSource[channelKey] === 'boolean') {
          normalized[eventKey][channelKey] = eventSource[channelKey]
        }
      }
    }
  }

  return normalized
}

export function parseNotificationPreferences(raw: string | null | undefined) {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES }

  try {
    return normalizePreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export async function getUserNotificationPreferences(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })

  return parseNotificationPreferences(user?.preferences)
}

export async function updateUserNotificationPreferences(
  userId: string,
  patch: Partial<Record<NotificationPreferenceEvent, Partial<Record<NotificationPreferenceChannel, boolean>>>>,
) {
  const current = await getUserNotificationPreferences(userId)

  for (const eventKey of Object.keys(patch) as NotificationPreferenceEvent[]) {
    const eventPatch = patch[eventKey]
    if (!eventPatch) continue

    for (const channelKey of Object.keys(eventPatch) as NotificationPreferenceChannel[]) {
      if (typeof eventPatch[channelKey] === 'boolean') {
        current[eventKey][channelKey] = eventPatch[channelKey] as boolean
      }
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { preferences: JSON.stringify(current) },
  })

  return current
}

export async function shouldDeliverNotification(
  userId: string,
  event: NotificationPreferenceEvent,
  channel: NotificationPreferenceChannel,
) {
  const preferences = await getUserNotificationPreferences(userId)
  return preferences[event]?.[channel] ?? DEFAULT_NOTIFICATION_PREFERENCES[event][channel]
}
