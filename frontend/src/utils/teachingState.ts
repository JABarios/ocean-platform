import type { AvailableAction, TeachingAvailableAction, TeachingProposal } from '../types'

export function hasAvailableAction(
  actions: AvailableAction[] | TeachingAvailableAction[] | undefined,
  action: AvailableAction | TeachingAvailableAction,
) {
  return actions?.includes(action as never) ?? false
}

export function getTeachingSupportCount(proposal: TeachingProposal | null | undefined) {
  if (!proposal) return 0
  return proposal.supportCount ?? ((proposal._count?.recommendations ?? 0) + 1)
}
