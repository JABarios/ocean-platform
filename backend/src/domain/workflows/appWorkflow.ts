import { setup } from 'xstate'

export type AppAvailableAction =
  | 'access_admin'
  | 'view_teaching_queue'
  | 'import_gallery'
  | 'manage_users'
  | 'view_audit_log'
  | 'run_cleanup'

type AppWorkflowEvent =
  | { type: 'ACCESS_ADMIN' }
  | { type: 'VIEW_TEACHING_QUEUE' }
  | { type: 'IMPORT_GALLERY' }
  | { type: 'MANAGE_USERS' }
  | { type: 'VIEW_AUDIT_LOG' }
  | { type: 'RUN_CLEANUP' }

interface AppWorkflowInput {
  role: string
}

const APP_ACTION_EVENTS: Array<{ action: AppAvailableAction; event: AppWorkflowEvent }> = [
  { action: 'access_admin', event: { type: 'ACCESS_ADMIN' } },
  { action: 'view_teaching_queue', event: { type: 'VIEW_TEACHING_QUEUE' } },
  { action: 'import_gallery', event: { type: 'IMPORT_GALLERY' } },
  { action: 'manage_users', event: { type: 'MANAGE_USERS' } },
  { action: 'view_audit_log', event: { type: 'VIEW_AUDIT_LOG' } },
  { action: 'run_cleanup', event: { type: 'RUN_CLEANUP' } },
]

export const appWorkflowMachine = setup({
  types: {
    context: {} as AppWorkflowInput,
    input: {} as AppWorkflowInput,
    events: {} as AppWorkflowEvent,
  },
  guards: {
    isAdmin: ({ context }) => context.role === 'Admin',
    isCuratorOrAdmin: ({ context }) => context.role === 'Admin' || context.role === 'Curator',
  },
}).createMachine({
  id: 'appWorkflow',
  context: ({ input }) => input,
  initial: 'ready',
  states: {
    ready: {
      on: {
        ACCESS_ADMIN: { guard: 'isAdmin' },
        MANAGE_USERS: { guard: 'isAdmin' },
        VIEW_AUDIT_LOG: { guard: 'isAdmin' },
        RUN_CLEANUP: { guard: 'isAdmin' },
        VIEW_TEACHING_QUEUE: { guard: 'isCuratorOrAdmin' },
        IMPORT_GALLERY: { guard: 'isCuratorOrAdmin' },
      },
    },
  },
})

function resolveAppSnapshot(role: string) {
  return appWorkflowMachine.resolveState({
    value: 'ready',
    context: { role },
  })
}

export function getAppAvailableActions(role: string): AppAvailableAction[] {
  const snapshot = resolveAppSnapshot(role)
  return APP_ACTION_EVENTS
    .filter(({ event }) => appWorkflowMachine.getTransitionData(snapshot, event).length > 0)
    .map(({ action }) => action)
}

export function hasAppAction(role: string, action: AppAvailableAction) {
  return getAppAvailableActions(role).includes(action)
}
