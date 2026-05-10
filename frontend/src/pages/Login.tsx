import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { api, API_BASE } from '../api/client'
import './Auth.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [debugInfo, setDebugInfo] = useState('')
  const [resendMessage, setResendMessage] = useState('')
  const [resending, setResending] = useState(false)
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
    setResendMessage('')
    try {
      await login(email, password)
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
      console.error('[OCEAN Login] Error completo:', err)
    }
  }

  const resendVerification = async () => {
    if (!email) return
    setResending(true)
    setResendMessage('')
    try {
      const res = await api.post<{ message: string; verifyUrl?: string }>('/auth/resend-verification', { email })
      setResendMessage(res.verifyUrl ? `${res.message} ${res.verifyUrl}` : res.message)
    } catch (err) {
      setResendMessage(err instanceof Error ? err.message : 'No se pudo reenviar el correo')
    } finally {
      setResending(false)
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
              {/confirmar tu correo/i.test(error) && (
                <button type="button" className="btn-secondary auth-inline-button" onClick={resendVerification} disabled={resending || !email}>
                  {resending ? 'Reenviando…' : 'Reenviar confirmación'}
                </button>
              )}
            </div>
          )}
          {resendMessage && <div className="auth-success">{resendMessage}</div>}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="auth-footer">
          <span>¿No tienes cuenta? </span>
          <Link to="/register">Regístrate</Link>
        </div>
        <div className="auth-quick-links">
          <div className="auth-quick-row">
            <span>¿Solo quieres anonimizar y compartir un EEG?</span>
            <Link to="/share" className="auth-quick-link">
              Ir a Share
            </Link>
          </div>
          <div className="auth-quick-row">
            <span>¿Solo quieres ver un EEG local en tu navegador?</span>
            <Link to="/open" className="auth-quick-link">
              Ir a Open
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
