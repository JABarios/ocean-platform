import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import { API_BASE } from '../api/client'

// ─── WASM types ───────────────────────────────────────────────────────────────

interface KappaInstance {
  openEDF: (path: string) => boolean
  getMeta: () => {
    numChannels: number
    sampleRate: number
    numSamples: number
    subjectId: string
    recordingDate: string
    channelLabels: string[]
  }
  setFilters: (hp: number, lp: number, notch: number) => void
  readEpoch: (
    offsetRecords: number,
    numRecords: number,
  ) => {
    nChannels: number
    nSamples: number
    sfreq: number
    channelNames: string[]
    channelTypes: string[]
    data: Float32Array[]
  } | null
}

interface KappaModuleInstance {
  KappaWasm: new () => KappaInstance
  FS: { writeFile: (path: string, data: Uint8Array) => void; unlink: (path: string) => void }
}

declare global {
  interface Window {
    KappaModule?: () => Promise<KappaModuleInstance>
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  EEG: '#60a5fa',
  EOG: '#34d399',
  ECG: '#f87171',
  EMG: '#fbbf24',
  RESP: '#a78bfa',
}
const DEFAULT_COLOR = '#94a3b8'
const LABEL_WIDTH = 76
const CHANNEL_HEIGHT = 80
const RECORDS_PER_PAGE = 10

type Phase =
  | 'key-input'
  | 'downloading'
  | 'decrypting'
  | 'loading-module'
  | 'opening'
  | 'viewing'
  | 'error'

interface EpochData {
  nChannels: number
  nSamples: number
  channelNames: string[]
  channelTypes: string[]
  data: Float32Array[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeScales(epoch: EpochData): { p2: number; p98: number }[] {
  return epoch.data.map((d) => {
    const sorted = Float32Array.from(d).sort()
    return {
      p2: sorted[Math.floor(sorted.length * 0.02)] ?? 0,
      p98: sorted[Math.floor(sorted.length * 0.98)] ?? 0,
    }
  })
}

function drawEpoch(
  canvas: HTMLCanvasElement,
  epoch: EpochData,
  scales: { p2: number; p98: number }[]
) {
  const totalHeight = epoch.nChannels * CHANNEL_HEIGHT
  canvas.width = canvas.offsetWidth || 1200
  canvas.height = totalHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const waveWidth = canvas.width - LABEL_WIDTH

  for (let c = 0; c < epoch.nChannels; c++) {
    const y0 = c * CHANNEL_HEIGHT
    const data = epoch.data[c]
    const type = epoch.channelTypes[c] ?? 'EEG'
    const name = epoch.channelNames[c] ?? `Ch${c + 1}`
    const color = CHANNEL_COLORS[type] ?? DEFAULT_COLOR
    const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
    const range = p98 - p2 || 1

    // Alternating row bg
    if (c % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.02)'
      ctx.fillRect(LABEL_WIDTH, y0, waveWidth, CHANNEL_HEIGHT)
    }

    // Label column
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, y0, LABEL_WIDTH, CHANNEL_HEIGHT)

    ctx.fillStyle = color
    ctx.font = 'bold 11px monospace'
    ctx.fillText(name.slice(0, 9), 4, y0 + 24)

    ctx.fillStyle = '#64748b'
    ctx.font = '9px monospace'
    ctx.fillText(type.slice(0, 6), 4, y0 + 38)

    // Waveform
    const margin = CHANNEL_HEIGHT * 0.1
    const drawH = CHANNEL_HEIGHT - margin * 2

    if (data.length < 2) continue

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.9

    for (let i = 0; i < data.length; i++) {
      const x = LABEL_WIDTH + (i / (data.length - 1)) * waveWidth
      const norm = (data[i] - p2) / range
      const y = y0 + margin + drawH * (1 - norm)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    // Separator
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y0 + CHANNEL_HEIGHT)
    ctx.lineTo(canvas.width, y0 + CHANNEL_HEIGHT)
    ctx.stroke()

    // Label border
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.beginPath()
    ctx.moveTo(LABEL_WIDTH, y0)
    ctx.lineTo(LABEL_WIDTH, y0 + CHANNEL_HEIGHT)
    ctx.stroke()
  }
}

// ─── Loading screen ───────────────────────────────────────────────────────────

function StatusScreen({ message, isError }: { message: string; isError?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0f172a',
      color: isError ? '#f87171' : '#94a3b8',
      fontFamily: 'monospace',
      fontSize: '1rem',
      gap: '1rem',
    }}>
      {!isError && (
        <div style={{
          width: 32,
          height: 32,
          border: '3px solid #334155',
          borderTop: '3px solid #60a5fa',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      )}
      <span>{message}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EEGViewer() {
  const { id } = useParams<{ id: string }>()
  const token = useAuthStore((s) => s.token)
  const { decryptFile } = useCrypto()

  const [phase, setPhase] = useState<Phase>('key-input')
  const [errorMsg, setErrorMsg] = useState('')
  const [keyInput, setKeyInput] = useState('')

  const [epoch, setEpoch] = useState<EpochData | null>(null)
  const [page, setPage] = useState(0)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [meta, setMeta] = useState<{ subjectId: string; recordingDate: string } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const kappaRef = useRef<KappaInstance | null>(null)
  const moduleRef = useRef<KappaModuleInstance | null>(null)

  // Compute scales once per epoch (cached)
  const scales = useMemo(() => {
    if (!epoch) return []
    return computeScales(epoch)
  }, [epoch])

  // ── Load WASM module (singleton) ────────────────────────────────────────────
  const loadModule = useCallback((): Promise<KappaModuleInstance> => {
    if (moduleRef.current) return Promise.resolve(moduleRef.current)

    return new Promise((resolve, reject) => {
      if (window.KappaModule) {
        window.KappaModule().then((m) => {
          moduleRef.current = m
          resolve(m)
        }).catch(reject)
        return
      }

      const script = document.createElement('script')
      script.src = '/wasm/kappa_wasm.js'
      script.onload = () => {
        const poll = setInterval(() => {
          if (window.KappaModule) {
            clearInterval(poll)
            window.KappaModule().then((m) => {
              moduleRef.current = m
              resolve(m)
            }).catch(reject)
          }
        }, 50)
        setTimeout(() => {
          clearInterval(poll)
          reject(new Error('KappaModule no disponible después de cargar el script'))
        }, 10000)
      }
      script.onerror = () => reject(new Error('No se pudo cargar kappa_wasm.js'))
      document.head.appendChild(script)
    })
  }, [])

  // ── Full pipeline ────────────────────────────────────────────────────────────
  const startViewer = useCallback(async (key: string) => {
    if (!id) return

    try {
      setPhase('downloading')
      const res = await fetch(`${API_BASE}/packages/download/${id}`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      })
      if (!res.ok) throw new Error(`Error al descargar (${res.status})`)
      const encryptedBuffer = await res.arrayBuffer()

      setPhase('decrypting')
      const decryptedBuffer = await decryptFile(encryptedBuffer, key)

      setPhase('loading-module')
      const Module = await loadModule()

      setPhase('opening')
      const kappa = new Module.KappaWasm()
      Module.FS.writeFile('/tmp/file.edf', new Uint8Array(decryptedBuffer))
      const opened = kappa.openEDF('/tmp/file.edf')
      if (!opened) throw new Error('openEDF devolvió false — archivo inválido o incompatible')

      const info = kappa.getMeta()
      kappa.setFilters(0.5, 45, 50)
      kappaRef.current = kappa
      setMeta({ subjectId: info.subjectId, recordingDate: info.recordingDate })
      setTotalSeconds(Math.floor(info.numSamples / info.sampleRate))

      const firstEpoch = kappa.readEpoch(0, RECORDS_PER_PAGE)
      if (!firstEpoch) throw new Error('readEpoch devolvió null')
      setEpoch(firstEpoch)
      setPage(0)
      sessionStorage.setItem(`ocean_eeg_key_${id}`, key)
      setPhase('viewing')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      const isBadKey =
        (err instanceof DOMException && err.name === 'OperationError') ||
        msg.includes('autenticación')
      setErrorMsg(isBadKey ? 'Clave incorrecta — el archivo no se pudo descifrar.' : msg)
      setPhase('error')
    }
  }, [id, token, decryptFile, loadModule])

  // ── Auto-start with key from sessionStorage ───────────────────────────────────
  useEffect(() => {
    if (!id || phase !== 'key-input') return
    const savedKey = sessionStorage.getItem(`ocean_eeg_key_${id}`)
    if (savedKey) {
      setKeyInput(savedKey)
      startViewer(savedKey)
    }
  }, [id, phase, startViewer])

  // ── Pagination ───────────────────────────────────────────────────────────────
  const goToPage = useCallback((newPage: number) => {
    const kappa = kappaRef.current
    if (!kappa) return
    const nextEpoch = kappa.readEpoch(newPage * RECORDS_PER_PAGE, RECORDS_PER_PAGE)
    if (!nextEpoch) return
    setEpoch(nextEpoch)
    setPage(newPage)
  }, [])

  const maxPage = Math.max(0, Math.ceil(totalSeconds / RECORDS_PER_PAGE) - 1)

  // ── Keyboard navigation ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'viewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && page > 0) goToPage(page - 1)
      if (e.key === 'ArrowRight' && page < maxPage) goToPage(page + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, page, maxPage, goToPage])

  // ── Canvas draw ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'viewing' || !epoch || !canvasRef.current) return
    drawEpoch(canvasRef.current, epoch, scales)
  }, [phase, epoch, scales])

  // ── Resize canvas on window resize ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'viewing' || !epoch || !canvasRef.current) return
    const canvas = canvasRef.current
    const ro = new ResizeObserver(() => drawEpoch(canvas, epoch, scales))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [phase, epoch, scales])

  // ── Cleanup MEMFS on unmount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      const mod = moduleRef.current
      if (mod) {
        try { mod.FS.unlink('/tmp/file.edf') } catch { /* already gone */ }
      }
    }
  }, [])

  // ── Submit key form ───────────────────────────────────────────────────────────
  const handleSubmitKey = (e: React.FormEvent) => {
    e.preventDefault()
    if (keyInput.trim()) startViewer(keyInput.trim())
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === 'key-input' || phase === 'error') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0f172a',
        fontFamily: 'system-ui, sans-serif',
        padding: '1rem',
      }}>
        <div style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: '2rem',
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}>
          <div>
            <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>
              Visor EEG
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem' }}>Caso {id}</div>
          </div>

          {phase === 'error' && (
            <div style={{
              background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 6,
              padding: '0.75rem',
              color: '#f87171',
              fontSize: '0.875rem',
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 6,
            padding: '0.75rem',
            color: '#fbbf24',
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}>
            <strong>🔐 Clave requerida</strong>
            <p style={{ margin: '0.4rem 0 0 0' }}>
              OCEAN no almacena la clave de descifrado. Se mostró una sola vez al crear este caso.
              Si eres el creador, recarga esta página — se intentará automáticamente durante esta sesión.
              Si no, pídele la clave al clínico que subió el EEG.
            </p>
          </div>

          <form onSubmit={handleSubmitKey} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              Clave de descifrado
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Pega la clave Base64…"
                autoFocus
                style={{
                  display: 'block',
                  marginTop: 6,
                  width: '100%',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '0.6rem 0.75rem',
                  color: '#e2e8f0',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </label>
            <button
              type="submit"
              disabled={!keyInput.trim()}
              style={{
                background: keyInput.trim() ? '#2563eb' : '#1e3a5f',
                color: keyInput.trim() ? '#fff' : '#64748b',
                border: 'none',
                borderRadius: 6,
                padding: '0.65rem',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: keyInput.trim() ? 'pointer' : 'not-allowed',
              }}
            >
              {phase === 'error' ? 'Reintentar' : 'Abrir EEG'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (phase !== 'viewing') {
    const messages: Record<Phase, string> = {
      'key-input': '',
      'downloading': 'Descargando paquete…',
      'decrypting': 'Descifrando…',
      'loading-module': 'Cargando módulo EEG…',
      'opening': 'Abriendo archivo…',
      'viewing': '',
      'error': '',
    }
    return <StatusScreen message={messages[phase]} />
  }

  const totalPages = maxPage + 1
  const timeOffsetSec = page * RECORDS_PER_PAGE

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0f172a',
      overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        padding: '0.5rem 1rem',
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#60a5fa', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem' }}>
          EEG · {id}
        </span>
        {meta && (
          <>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{meta.subjectId}</span>
            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>{meta.recordingDate}</span>
          </>
        )}
        <div style={{ flex: 1 }} />

        <span style={{ color: '#64748b', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          t = {timeOffsetSec}s
        </span>

        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0}
            title="Anterior (←)"
            style={navBtnStyle(page === 0)}
          >
            ←
          </button>
          <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontFamily: 'monospace', minWidth: 70, textAlign: 'center' }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={page >= maxPage}
            title="Siguiente (→)"
            style={navBtnStyle(page >= maxPage)}
          >
            →
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%' }}
        />
      </div>
    </div>
  )
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#1e293b' : '#334155',
    color: disabled ? '#334155' : '#e2e8f0',
    border: '1px solid #475569',
    borderRadius: 4,
    padding: '0.3rem 0.6rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.9rem',
    fontWeight: 700,
  }
}
