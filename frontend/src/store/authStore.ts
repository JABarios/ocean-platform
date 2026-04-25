import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'
import type { User } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
}

interface RegisterData {
  email: string
  password: string
  displayName: string
  institution?: string
  specialty?: string
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await api.post<{ token: string; user: User }>('/auth/login', {
            email,
            password,
          })
          set({ token: res.token, user: res.user })
        } finally {
          set({ isLoading: false })
        }
      },

      register: async (data) => {
        set({ isLoading: true })
        try {
          const res = await api.post<{ token: string; user: User }>('/auth/register', data)
          set({ token: res.token, user: res.user })
        } finally {
          set({ isLoading: false })
        }
      },

      logout: () => {
        set({ token: null, user: null })
      },

      fetchMe: async () => {
        if (!get().token) return
        set({ isLoading: true })
        try {
          const user = await api.get<User>('/auth/me')
          set({ user })
        } catch {
          set({ token: null, user: null })
        } finally {
          set({ isLoading: false })
        }
      },
    }),
    {
      name: 'ocean-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
)
