import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { createLocalEegSession } from './localEegSession'
import './CaseNew.css'

export default function OpenLocalEeg() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    setSelectedFile(file)
    setError('')
  }

  const handleOpenLocal = () => {
    if (!selectedFile) {
      setError('Selecciona primero un archivo EDF.')
      return
    }
    const session = createLocalEegSession(selectedFile)
    navigate(`/open/${session.id}`)
  }

  return (
    <div className="case-new">
      <PageHeader
        title="Abrir EDF local"
        subtitle="Carga un archivo EDF desde este equipo y ábrelo en el navegador sin subirlo al servidor."
      />

      <div className="case-form card">
        <div className="anonymization-note" style={{ background: '#f8fafc', borderColor: '#cbd5e1', color: '#334155' }}>
          <strong style={{ color: '#0f172a' }}>Modo local</strong>
          <span>
            El archivo se lee solo en este navegador. No se envía a OCEAN, no se cifra para upload y no se almacena en servidor.
          </span>
        </div>

        <label>
          Archivo EEG (.edf)
          <input
            ref={fileInputRef}
            type="file"
            accept=".edf"
            onChange={handleFileChange}
          />
          <span className="file-hint">
            {selectedFile
              ? `${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(1)} MB)`
              : 'Selecciona un EDF local exportado desde tu sistema habitual.'}
          </span>
        </label>

        {error && <div className="auth-error">{error}</div>}

        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={handleOpenLocal}>
            Abrir localmente
          </button>
        </div>
      </div>
    </div>
  )
}
