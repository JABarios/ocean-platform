import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Groups from '../pages/Groups'
import type { User } from '../types'
import { mockFetchSequence } from './mocks'

let mockAuthState = {
  user: { id: 'user-1', email: 'viewer@ocean.local', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderGroups() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Groups />
    </MemoryRouter>,
  )
}

describe('Groups', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('muestra grupos aceptados e invitaciones pendientes', async () => {
    mockFetchSequence([
      { data: [{ id: 'g1', name: 'Epilepsia', description: 'Grupo EEG', type: 'Closed', _count: { members: 3 } }] },
      { data: [{ id: 'inv-1', groupId: 'g2', role: 'member', status: 'Pending', group: { id: 'g2', name: 'Sueño', description: 'Grupo de sueño', type: 'Closed' } }] },
      { data: [] },
      { data: { id: 'g1', name: 'Epilepsia', description: 'Grupo EEG', type: 'Closed', members: [], pendingInvitations: [] } },
    ])

    renderGroups()

    expect((await screen.findAllByText('Epilepsia')).length).toBeGreaterThan(0)
    expect(screen.getByText('Sueño')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Aceptar/i })).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('miembros en tus grupos')).toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties of undefined/i)).not.toBeInTheDocument()
  })

  it('permite crear un grupo nuevo', async () => {
    const fetchMock = mockFetchSequence([
      { data: [] },
      { data: [] },
      { data: [] },
      { data: { id: 'g-new', name: 'Nuevo grupo', description: '', type: 'Closed' } },
      { data: [{ id: 'g-new', name: 'Nuevo grupo', description: '', type: 'Closed', _count: { members: 1 } }] },
      { data: [] },
      { data: [] },
      { data: { id: 'g-new', name: 'Nuevo grupo', description: '', type: 'Closed', members: [], pendingInvitations: [] } },
      { data: { id: 'g-new', name: 'Nuevo grupo', description: '', type: 'Closed', members: [], pendingInvitations: [] } },
    ])

    renderGroups()

    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Nuevo grupo' } })
    fireEvent.click(screen.getByRole('button', { name: /Crear grupo/i }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) => url.includes('/groups') && opts?.method === 'POST')
      expect(postCall).toBeDefined()
      expect(JSON.parse(postCall![1].body as string).name).toBe('Nuevo grupo')
    })
  })
})
