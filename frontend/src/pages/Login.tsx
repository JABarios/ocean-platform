import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { API_BASE } from '../api/client'
import './Auth.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [debugInfo, setDebugInfo] = useState('')
  const login = useAuthStore((s) => s.login)
  const token = useAuthStore((s) => s.token)
  const isLoading = useAuthStore((s) => s.isLoading)
  const navigate = useNavigate()

  useEffect(() => {
    if (token) {
      navigate('/', { replace: true })
    }
  }, [token, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setDebugInfo(`Intentando conectar a: ${API_BASE}/auth/login`)
    try {
      await login(email, password)
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      console.error('[OCEAN Login] Error completo:', err)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <h1>Iniciar sesión</h1>
        <p className="subtitle">Plataforma clínica OCEAN</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="auth-error">
              <div>{error}</div>
              {debugInfo && <div className="auth-debug">{debugInfo}</div>}
            </div>
          )}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="auth-footer">
          <span>¿No tienes cuenta? </span>
          <Link to="/register">Regístrate</Link>
        </div>
      </div>
    </div>
  )
}
