import { getAppAvailableActions } from './appWorkflow'

export type GalleryAvailableAction =
  | 'edit_gallery'
  | 'delete_gallery'

export function getGalleryAvailableActions(role: string): GalleryAvailableAction[] {
  const appActions = getAppAvailableActions(role)
  if (!appActions.includes('import_gallery')) return []
  return ['edit_gallery', 'delete_gallery']
}
