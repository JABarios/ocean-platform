import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [institution, setInstitution] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [error, setError] = useState('')
  const register = useAuthStore((s) => s.register)
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
      await register({ email, password, displayName, institution, specialty })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrarse')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <h1>Crear cuenta</h1>
        <p className="subtitle">Plataforma clínica OCEAN</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Nombre completo
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Correo electrónico
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
          <label>
            Institución
            <input
              type="text"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </label>
          <label>
            Especialidad
            <input
              type="text"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn-primary" disabled={isLoading}>
            {isLoading ? 'Creando cuenta…' : 'Registrarse'}
          </button>
        </form>
        <div className="auth-footer">
          <span>¿Ya tienes cuenta? </span>
          <Link to="/login">Inicia sesión</Link>
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
          max-width: 420px;
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
