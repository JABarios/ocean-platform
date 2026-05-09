export type GroupAvailableAction =
  | 'view_group'
  | 'add_group_member'
  | 'remove_group_member'

interface GroupWorkflowInput {
  isMember: boolean
  membershipRole?: string | null
}

export function getGroupAvailableActions(input: GroupWorkflowInput): GroupAvailableAction[] {
  const actions: GroupAvailableAction[] = []
  if (input.isMember) {
    actions.push('view_group')
  }
  if (input.membershipRole === 'admin') {
    actions.push('add_group_member', 'remove_group_member')
  }
  return actions
}

export function canManageGroupMembers(membershipRole?: string | null) {
  return getGroupAvailableActions({
    isMember: Boolean(membershipRole),
    membershipRole,
  }).some((action) => action === 'add_group_member' || action === 'remove_group_member')
}
