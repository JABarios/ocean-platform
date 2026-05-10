export type GroupAvailableAction =
  | 'view_group'
  | 'invite_group_member'
  | 'remove_group_member'
  | 'respond_group_invitation'

interface GroupWorkflowInput {
  isMember: boolean
  membershipRole?: string | null
  membershipStatus?: string | null
}

export function getGroupAvailableActions(input: GroupWorkflowInput): GroupAvailableAction[] {
  const actions: GroupAvailableAction[] = []
  const isAccepted = input.membershipStatus === 'Accepted'
  const isPending = input.membershipStatus === 'Pending'
  if (input.isMember && isAccepted) {
    actions.push('view_group')
  }
  if (input.membershipRole === 'admin' && isAccepted) {
    actions.push('invite_group_member', 'remove_group_member')
  }
  if (isPending) {
    actions.push('respond_group_invitation')
  }
  return actions
}

export function canManageGroupMembers(membershipRole?: string | null) {
  return getGroupAvailableActions({
    isMember: Boolean(membershipRole),
    membershipRole,
    membershipStatus: 'Accepted',
  }).some((action) => action === 'invite_group_member' || action === 'remove_group_member')
}
