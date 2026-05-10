import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import type { User } from '../types'

const mockUser = {
  id: 'user-1',
  email: 'user@ocean.local',
  displayName: 'Dr. User',
  role: 'Clinician',
} as User

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      token: 'test-token',
      user: mockUser,
      fetchMe: vi.fn(),
    }),
}))

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}))

vi.mock('../components/ProtectedRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../pages/Dashboard', () => ({ default: () => <div>Dashboard marker</div> }))
vi.mock('../pages/Login', () => ({ default: () => <div>Login</div> }))
vi.mock('../pages/Register', () => ({ default: () => <div>Register</div> }))
vi.mock('../pages/VerifyEmail', () => ({ default: () => <div>VerifyEmail</div> }))
vi.mock('../pages/CaseNew', () => ({ default: () => <div>CaseNew</div> }))
vi.mock('../pages/CaseDetail', () => ({ default: () => <div>CaseDetail</div> }))
vi.mock('../pages/EEGViewer', () => ({ default: () => <div>EEGViewer</div> }))
vi.mock('../pages/TeachingLibrary', () => ({ default: () => <div>TeachingLibrary</div> }))
vi.mock('../pages/TeachingQueue', () => ({ default: () => <div>TeachingQueue</div> }))
vi.mock('../pages/UserAdmin', () => ({ default: () => <div>UserAdmin</div> }))
vi.mock('../pages/CleanupAdmin', () => ({ default: () => <div>CleanupAdmin</div> }))
vi.mock('../pages/EegRecords', () => ({ default: () => <div>EegRecords</div> }))
vi.mock('../pages/Galleries', () => ({ default: () => <div>Galleries</div> }))
vi.mock('../pages/GalleryDetail', () => ({ default: () => <div>GalleryDetail</div> }))
vi.mock('../pages/AdminHome', () => ({ default: () => <div>AdminHome</div> }))
vi.mock('../pages/SharedLinkNew', () => ({ default: () => <div>SharedLinkNew</div> }))
vi.mock('../pages/OpenLocalEeg', () => ({ default: () => <div>OpenLocalEeg</div> }))
vi.mock('../pages/OpenCasesFeed', () => ({ default: () => <div>OpenCasesFeed</div> }))
vi.mock('../pages/Groups', () => ({ default: () => <div>Groups</div> }))
vi.mock('../pages/Notifications', () => ({ default: () => <div>Notifications</div> }))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}

describe('App routes', () => {
  it('redirige /cases a la bandeja principal', async () => {
    renderAt('/cases')
    expect(await screen.findByText('Dashboard marker')).toBeInTheDocument()
  })

  it('redirige /cases/manage a la bandeja principal', async () => {
    renderAt('/cases/manage')
    expect(await screen.findByText('Dashboard marker')).toBeInTheDocument()
  })
})
