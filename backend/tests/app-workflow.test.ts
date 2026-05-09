import { getAppAvailableActions, hasAppAction } from '../src/domain/workflows/appWorkflow'

describe('appWorkflow', () => {
  it('admin obtiene todas las acciones administrativas de aplicación', () => {
    const actions = getAppAvailableActions('Admin')

    expect(actions).toEqual(
      expect.arrayContaining([
        'access_admin',
        'view_teaching_queue',
        'import_gallery',
        'manage_users',
        'view_audit_log',
        'run_cleanup',
      ]),
    )
  })

  it('curator solo obtiene acciones curatoriales, no de admin', () => {
    const actions = getAppAvailableActions('Curator')

    expect(actions).toEqual(expect.arrayContaining(['view_teaching_queue', 'import_gallery']))
    expect(actions).not.toContain('access_admin')
    expect(actions).not.toContain('manage_users')
  })

  it('clinician no obtiene acciones administrativas', () => {
    expect(getAppAvailableActions('Clinician')).toEqual([])
    expect(hasAppAction('Clinician', 'import_gallery')).toBe(false)
  })
})
