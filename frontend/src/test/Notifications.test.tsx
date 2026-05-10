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
})
