import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Notifications from '../pages/Notifications'
import type { User } from '../types'
import { mockFetchSequence } from './mocks'

let mockAuthState = {
  user: { id: 'user-1', email: 'viewer@ocean.local', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderNotifications() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Notifications />
    </MemoryRouter>,
  )
}

describe('Notifications', () => {
  const defaultPreferences = {
    review_request_direct: { email: true, telegram: true, push: true },
    review_request_group: { email: true, telegram: true, push: true },
    group_invitation: { email: true, telegram: true, push: true },
    comment_on_case: { email: false, telegram: false, push: false },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra la lista de notificaciones', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'n1',
            kind: 'review_request_received',
            title: 'Nueva solicitud de revisión',
            body: 'Dr. Sender te ha enviado un caso para revisar.',
            caseId: 'case-1',
            createdAt: new Date().toISOString(),
            actor: { id: 'u2', displayName: 'Dr. Sender', email: 'sender@ocean.local' },
            case: { id: 'case-1', title: 'Caso 1', status: 'Requested' },
          },
        ],
      },
      {
        data: {
          configured: false,
          botUsername: null,
          linked: false,
          username: null,
          linkedAt: null,
          notificationsEnabled: false,
        },
      },
      {
        data: {
          preferences: defaultPreferences,
          channels: {
            emailConfigured: true,
            telegramConfigured: false,
            pushConfigured: false,
          },
        },
      },
    ])

    renderNotifications()

    expect(await screen.findByText('Nueva solicitud de revisión')).toBeInTheDocument()
    expect(screen.getByText(/Dr. Sender te ha enviado un caso/i)).toBeInTheDocument()
  })

  it('permite marcar todas como leídas', async () => {
    const fetchMock = mockFetchSequence([
      {
        data: [
          {
            id: 'n1',
            kind: 'comment_on_case',
            title: 'Nuevo comentario en caso',
            body: 'Han comentado en tu caso.',
            caseId: 'case-1',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        data: {
          configured: false,
          botUsername: null,
          linked: false,
          username: null,
          linkedAt: null,
          notificationsEnabled: false,
        },
      },
      {
        data: {
          preferences: defaultPreferences,
          channels: {
            emailConfigured: true,
            telegramConfigured: false,
            pushConfigured: false,
          },
        },
      },
      { data: {}, status: 204 },
    ])

    renderNotifications()

    fireEvent.click(await screen.findByRole('button', { name: /Marcar todas como leídas/i }))

    await waitFor(() => {
      const readAllCall = fetchMock.mock.calls.find(([url, opts]) =>
        url.includes('/notifications/read-all') && opts?.method === 'POST'
      )
      expect(readAllCall).toBeDefined()
    })
  })

  it('abre el grupo concreto cuando la notificación no tiene caseId', async () => {
    mockFetchSequence([
      {
        data: [
          {
            id: 'n-group',
            kind: 'group_invitation_received',
            title: 'Nueva invitación a grupo',
            body: 'Te han invitado a un grupo.',
            groupId: 'group-42',
            createdAt: new Date().toISOString(),
          },
        ],
      },
      {
        data: {
          configured: false,
          botUsername: null,
          linked: false,
          username: null,
          linkedAt: null,
          notificationsEnabled: false,
        },
      },
      {
        data: {
          preferences: defaultPreferences,
          channels: {
            emailConfigured: true,
            telegramConfigured: true,
            pushConfigured: true,
          },
        },
      },
    ])

    renderNotifications()

    const link = await screen.findByRole('link', { name: /Abrir/i })
    expect(link.getAttribute('href')).toBe('/groups?groupId=group-42')
  })

  it('permite cambiar una preferencia de canal', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },
      {
        data: {
          configured: false,
          botUsername: null,
          linked: false,
          username: null,
          linkedAt: null,
          notificationsEnabled: false,
        },
      },
      {
        data: {
          preferences: defaultPreferences,
          channels: {
            emailConfigured: true,
            telegramConfigured: true,
            pushConfigured: true,
          },
        },
      },
      {
        data: {
          preferences: {
            ...defaultPreferences,
            review_request_direct: { ...defaultPreferences.review_request_direct, email: false },
          },
        },
      },
    ])

    renderNotifications()

    fireEvent.click(await screen.findByRole('button', { name: /Canales y ajustes/i }))
    const toggles = await screen.findAllByRole('checkbox')
    fireEvent.click(toggles[0])

    await waitFor(() => {
      const preferenceCall = fetchMock.mock.calls.find(([url, opts]) =>
        url.includes('/notifications/preferences') && opts?.method === 'PATCH'
      )
      expect(preferenceCall).toBeDefined()
    })
  })
})
