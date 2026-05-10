import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import TeachingQueue from '../pages/TeachingQueue'
import { mockFetch, mockFetchSequence } from './mocks'
import type { User } from '../types'

let mockAuthState = {
  user: { id: 'viewer-1', email: 'viewer@test.com', displayName: 'Dr. Viewer', role: 'Clinician' } as User,
  token: 'test-token',
}

vi.mock('../store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
}))

function renderQueue() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TeachingQueue />
    </MemoryRouter>,
  )
}

describe('TeachingQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAuthState = {
      user: { id: 'viewer-1', email: 'viewer@test.com', displayName: 'Dr. Viewer', role: 'Clinician' },
      token: 'test-token',
    }
  })

  it('muestra los apoyos y el enlace para ver el caso', async () => {
    mockFetch([
      {
        id: 'proposal-1',
        caseId: 'case-1',
        proposerId: 'owner-1',
        status: 'Recommended',
        summary: 'Caso muy útil para docencia',
        difficulty: 'Intermediate',
        supportCount: 2,
        availableActions: ['recommend_teaching'],
        case: { id: 'case-1', title: 'Caso recomendado', status: 'Resolved' },
        proposer: { id: 'owner-1', displayName: 'Dr. Owner' },
        recommendations: [{ authorId: 'viewer-9' }],
      },
    ])

    renderQueue()

    expect(await screen.findByText('Caso recomendado')).toBeInTheDocument()
    expect(screen.getByText('Recomendado')).toBeInTheDocument()
    expect(screen.getByText('Intermedio')).toBeInTheDocument()
    expect(screen.getByText('Resuelto')).toBeInTheDocument()
    expect(screen.getByText('Apoyos: 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver caso/i })).toHaveAttribute('href', '/cases/case-1')
  })

  it('muestra "Ya recomendado" cuando el usuario actual ya apoyó la propuesta', async () => {
    mockFetch([
      {
        id: 'proposal-1',
        caseId: 'case-1',
        proposerId: 'owner-1',
        status: 'Proposed',
        summary: 'Caso apoyado por la comunidad',
        supportCount: 2,
        availableActions: [],
        case: { id: 'case-1', title: 'Caso propuesto', status: 'Resolved' },
        proposer: { id: 'owner-1', displayName: 'Dr. Owner' },
        recommendations: [{ authorId: 'viewer-1' }],
      },
    ])

    renderQueue()

    expect(await screen.findByText('Caso propuesto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ya recomendado/i })).toBeDisabled()
  })

  it('permite validar o rechazar cuando el usuario es curador', async () => {
    mockAuthState = {
      user: { id: 'curator-1', email: 'curator@test.com', displayName: 'Dr. Curator', role: 'Curator' },
      token: 'test-token',
    }

    const fetchMock = mockFetchSequence([
      {
        data: [
          {
            id: 'proposal-1',
            caseId: 'case-1',
            proposerId: 'owner-1',
            status: 'Recommended',
            summary: 'Caso listo para curación',
            supportCount: 3,
            availableActions: ['validate_teaching', 'reject_teaching'],
            case: { id: 'case-1', title: 'Caso curatorial', status: 'Resolved' },
            proposer: { id: 'owner-1', displayName: 'Dr. Owner' },
            recommendations: [{ authorId: 'viewer-2' }, { authorId: 'viewer-3' }],
          },
        ],
      },
      { data: {} },
      {
        data: [
          {
            id: 'proposal-1',
            caseId: 'case-1',
            proposerId: 'owner-1',
            status: 'Validated',
            summary: 'Caso listo para curación',
            supportCount: 3,
            availableActions: [],
            case: { id: 'case-1', title: 'Caso curatorial', status: 'Resolved' },
            proposer: { id: 'owner-1', displayName: 'Dr. Owner' },
            recommendations: [{ authorId: 'viewer-2' }, { authorId: 'viewer-3' }],
          },
        ],
      },
    ])

    renderQueue()

    const validateButton = await screen.findByRole('button', { name: /Validar/i })
    validateButton.click()

    await waitFor(() => {
      const validateCall = fetchMock.mock.calls.find(([url, opts]) =>
        url.includes('/teaching/proposals/proposal-1/validate') && opts?.method === 'POST',
      )
      expect(validateCall).toBeDefined()
      expect(JSON.parse(validateCall![1].body as string)).toEqual({ status: 'Validated' })
    })
  })
})
