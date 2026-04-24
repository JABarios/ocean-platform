import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
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
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al iniciar sesión')
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
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <div className="auth-footer">
          <span>¿No tienes cuenta? </span>
          <Link to="/register">Regístrate</Link>
        </div>
      </div>
      <style>{`
        .auth-page {
          min-height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1rem;
        }
        .auth-card {
          width: 100%;
          max-width: 400px;
        }
        .auth-card h1 {
          font-size: 1.25rem;
          margin-bottom: 0.25rem;
        }
        .subtitle {
          color: var(--text-secondary);
          font-size: 0.9rem;
          margin-bottom: 1.25rem;
        }
        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .auth-form label {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-secondary);
        }
        .error {
          color: var(--danger);
          font-size: 0.85rem;
        }
        .auth-footer {
          margin-top: 1rem;
          font-size: 0.85rem;
          text-align: center;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  )
}
