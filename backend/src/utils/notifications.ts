import { prisma } from './prisma'

type NotificationKind =
  | 'review_request_received'
  | 'review_request_accepted'
  | 'review_request_rejected'
  | 'group_invitation_received'
  | 'comment_on_case'

export async function createNotification(params: {
  userId: string
  kind: NotificationKind
  title: string
  body: string
  caseId?: string
  groupId?: string
  reviewRequestId?: string
  commentId?: string
  actorUserId?: string
}) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      caseId: params.caseId,
      groupId: params.groupId,
      reviewRequestId: params.reviewRequestId,
      commentId: params.commentId,
      actorUserId: params.actorUserId,
    },
  })
}

export async function createNotificationsForUsers(params: {
  userIds: string[]
  kind: NotificationKind
  title: string
  body: string
  caseId?: string
  groupId?: string
  reviewRequestId?: string
  commentId?: string
  actorUserId?: string
}) {
  const uniqueUserIds = [...new Set(params.userIds.filter(Boolean))]
  if (!uniqueUserIds.length) return

  await prisma.notification.createMany({
    data: uniqueUserIds.map((userId) => ({
      userId,
      kind: params.kind,
      title: params.title,
      body: params.body,
      caseId: params.caseId,
      groupId: params.groupId,
      reviewRequestId: params.reviewRequestId,
      commentId: params.commentId,
      actorUserId: params.actorUserId,
    })),
  })
}

export function serializeNotification(item: any) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: item.body,
    caseId: item.caseId,
    groupId: item.groupId,
    reviewRequestId: item.reviewRequestId,
    commentId: item.commentId,
    readAt: item.readAt,
    createdAt: item.createdAt,
    actor: item.actor
      ? {
          id: item.actor.id,
          displayName: item.actor.displayName,
          email: item.actor.email,
        }
      : undefined,
    case: item.caseId
      ? {
          id: item.caseId,
        }
      : undefined,
    group: item.groupId
      ? {
          id: item.groupId,
        }
      : undefined,
    reviewRequest: item.reviewRequestId
      ? {
          id: item.reviewRequestId,
          status: item.reviewRequest?.status || '',
        }
      : undefined,
  }
}

export function buildNotificationCaseTitle(caseItem?: { id: string; title?: string | null }) {
  return caseItem?.title?.trim() || (caseItem ? `Caso ${caseItem.id.slice(0, 8)}` : 'Caso')
}
