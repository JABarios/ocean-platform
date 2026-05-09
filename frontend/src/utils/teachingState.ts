import type {
  AppAvailableAction,
  AvailableAction,
  GalleryAvailableAction,
  ReviewRequestAvailableAction,
  TeachingAvailableAction,
  TeachingProposal,
} from '../types'

export function hasAvailableAction(
  actions:
    | AvailableAction[]
    | TeachingAvailableAction[]
    | ReviewRequestAvailableAction[]
    | AppAvailableAction[]
    | GalleryAvailableAction[]
    | undefined,
  action:
    | AvailableAction
    | TeachingAvailableAction
    | ReviewRequestAvailableAction
    | AppAvailableAction
    | GalleryAvailableAction,
) {
  return actions?.includes(action as never) ?? false
}

export function getTeachingSupportCount(proposal: TeachingProposal | null | undefined) {
  if (!proposal) return 0
  return proposal.supportCount ?? ((proposal._count?.recommendations ?? 0) + 1)
}
