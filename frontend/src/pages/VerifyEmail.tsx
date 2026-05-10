import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import './Auth.css'

export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('Confirmando tu correo…')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setError('Enlace de verificación inválido')
      return
    }

    const run = async () => {
      try {
        const res = await api.get<{ message: string }>(`/auth/verify/${token}`)
        setMessage(res.message)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo confirmar el correo')
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [token])

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <h1>Confirmación de correo</h1>
        <p className="subtitle">Plataforma clínica OCEAN</p>
        {loading ? <div>{message}</div> : error ? <div className="auth-error">{error}</div> : <div className="auth-success">{message}</div>}
        <div className="auth-footer">
          <Link to="/login">Ir a iniciar sesión</Link>
        </div>
      </div>
    </div>
  )
}
