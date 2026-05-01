import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'
import type { User } from '../types'
import { AUTH_STORAGE_KEY, clearPersistedAuth } from './authStorage'

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterData) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
  setToken: (token: string | null) => void
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

      setToken: (token) => {
        set({ token })
      },

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await api.post<{ token: string; user: User }>('/auth/login', {
            email,
            password,
          })
          set({ token: res.token, user: res.user })
        } catch (err) {
          set({ isLoading: false })
          throw err
        } finally {
          set({ isLoading: false })
        }
      },

      register: async (data) => {
        set({ isLoading: true })
        try {
          const res = await api.post<{ token: string; user: User }>('/auth/register', data)
          set({ token: res.token, user: res.user })
        } catch (err) {
          set({ isLoading: false })
          throw err
        } finally {
          set({ isLoading: false })
        }
      },

      logout: () => {
        clearPersistedAuth()
        set({ token: null, user: null })
      },

      fetchMe: async () => {
        const token = get().token
        if (!token) return
        set({ isLoading: true })
        try {
          const user = await api.get<User>('/auth/me')
          set({ user, token })
        } catch {
          clearPersistedAuth()
          set({ token: null, user: null })
        } finally {
          set({ isLoading: false })
        }
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (state) => ({ token: state.token }),
    }
  )
)
