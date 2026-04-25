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
  EEG:  '#1d4ed8',
  EOG:  '#047857',
  ECG:  '#dc2626',
  EMG:  '#b45309',
  RESP: '#7c3aed',
}
const DEFAULT_COLOR = '#475569'
const LABEL_WIDTH   = 76
const CHANNEL_HEIGHT = 80

const HP_OPTIONS: { label: string; value: number }[] = [
  { label: 'Ninguno', value: 0 },
  { label: '0.3 Hz',  value: 0.3 },
  { label: '0.5 Hz',  value: 0.5 },
  { label: '1 Hz',    value: 1 },
  { label: '5 Hz',    value: 5 },
]

const LP_OPTIONS: { label: string; value: number }[] = [
  { label: '15 Hz', value: 15 },
  { label: '30 Hz', value: 30 },
  { label: '45 Hz', value: 45 },
  { label: '70 Hz', value: 70 },
]

const WINDOW_OPTIONS = [10, 20, 30]

const GAIN_OPTIONS: { label: string; value: number }[] = [
  { label: '0.1×', value: 0.1 },
  { label: '0.5×', value: 0.5 },
  { label: '1×',   value: 1   },
  { label: '2×',   value: 2   },
  { label: '4×',   value: 4   },
  { label: '8×',   value: 8   },
]

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

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function computeScales(epoch: EpochData, gainMult: number): { p2: number; p98: number }[] {
  // Step 1: per-channel auto range (p2–p98) and median center
  const perChannel = epoch.data.map((d) => {
    const sorted = Float32Array.from(d).sort()
    return {
      p2:     sorted[Math.floor(sorted.length * 0.02)] ?? 0,
      p98:    sorted[Math.floor(sorted.length * 0.98)] ?? 0,
      center: sorted[Math.floor(sorted.length * 0.5)]  ?? 0,
    }
  })

  // Step 2: shared reference = median of all per-channel ranges
  const ranges = perChannel.map(s => s.p98 - s.p2).filter(r => r > 0).sort((a, b) => a - b)
  const refRange = ranges.length > 0
    ? ranges[Math.floor(ranges.length * 0.5)]  // median — robust against ECG/EMG outliers
    : 1

  // Step 3: apply multiplier — each channel centered on its own median, shared range
  const halfRange = (refRange / gainMult) / 2
  return perChannel.map(s => ({ p2: s.center - halfRange, p98: s.center + halfRange }))
}

function drawEpoch(
  canvas: HTMLCanvasElement,
  epoch: EpochData,
  scales: { p2: number; p98: number }[],
) {
  canvas.width  = canvas.offsetWidth || 1200
  canvas.height = epoch.nChannels * CHANNEL_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const waveWidth = canvas.width - LABEL_WIDTH

  // White background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  for (let c = 0; c < epoch.nChannels; c++) {
    const y0    = c * CHANNEL_HEIGHT
    const data  = epoch.data[c]
    const type  = epoch.channelTypes[c] ?? 'EEG'
    const name  = epoch.channelNames[c] ?? `Ch${c + 1}`
    const color = CHANNEL_COLORS[type] ?? DEFAULT_COLOR
    const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
    const range = p98 - p2 || 1

    // Alternating row
    if (c % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.018)'
      ctx.fillRect(LABEL_WIDTH, y0, waveWidth, CHANNEL_HEIGHT)
    }

    // Label column
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, y0, LABEL_WIDTH, CHANNEL_HEIGHT)

    ctx.fillStyle = color
    ctx.font = 'bold 11px monospace'
    ctx.fillText(name.slice(0, 9), 4, y0 + 24)

    ctx.fillStyle = '#64748b'
    ctx.font = '9px monospace'
    ctx.fillText(type.slice(0, 6), 4, y0 + 38)

    // Waveform
    if (data.length < 2) continue

    const margin = CHANNEL_HEIGHT * 0.1
    const drawH  = CHANNEL_HEIGHT - margin * 2

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth   = 1
    ctx.globalAlpha = 0.85

    for (let i = 0; i < data.length; i++) {
      const x    = LABEL_WIDTH + (i / (data.length - 1)) * waveWidth
      const norm = (data[i] - p2) / range
      const y    = y0 + margin + drawH * (1 - norm)
      if (i === 0) ctx.moveTo(x, y)
      else         ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    // Row separator
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(0, y0 + CHANNEL_HEIGHT)
    ctx.lineTo(canvas.width, y0 + CHANNEL_HEIGHT)
    ctx.stroke()

    // Label / waveform border
    ctx.strokeStyle = '#cbd5e1'
    ctx.beginPath()
    ctx.moveTo(LABEL_WIDTH, y0)
    ctx.lineTo(LABEL_WIDTH, y0 + CHANNEL_HEIGHT)
    ctx.stroke()
  }
}

// ─── Loading screen ───────────────────────────────────────────────────────────

function StatusScreen({ message }: { message: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', background: '#f1f5f9',
      color: '#64748b', fontFamily: 'monospace', fontSize: '1rem', gap: '1rem',
    }}>
      <div style={{
        width: 28, height: 28,
        border: '3px solid #e2e8f0', borderTop: '3px solid #2563eb',
        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
      }} />
      <span>{message}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ─── Toolbar select ───────────────────────────────────────────────────────────

function ToolbarSelect({
  label, value, onChange, children,
}: {
  label: string
  value: string | number
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 4,
          color: '#1e293b', fontSize: '0.8rem', padding: '0.2rem 0.4rem',
          cursor: 'pointer', outline: 'none',
        }}
      >
        {children}
      </select>
    </label>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EEGViewer() {
  const { id }       = useParams<{ id: string }>()
  const token        = useAuthStore((s) => s.token)
  const { decryptFile } = useCrypto()

  const [phase,    setPhase]    = useState<Phase>('key-input')
  const [errorMsg, setErrorMsg] = useState('')
  const [keyInput, setKeyInput] = useState('')

  const [epoch,        setEpoch]        = useState<EpochData | null>(null)
  const [page,         setPage]         = useState(0)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [meta,         setMeta]         = useState<{ subjectId: string; recordingDate: string } | null>(null)

  // Filter, window & gain state
  const [windowSecs, setWindowSecs] = useState(10)
  const [hp,         setHp]         = useState(0.5)
  const [lp,         setLp]         = useState(45)
  const [notch,      setNotch]      = useState(true)
  const [gainMult,   setGainMult]   = useState(1)   // multiplier over shared auto reference

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const kappaRef  = useRef<KappaInstance | null>(null)
  const moduleRef = useRef<KappaModuleInstance | null>(null)

  const scales = useMemo(() => epoch ? computeScales(epoch, gainMult) : [], [epoch, gainMult])

  // ── Load WASM module (singleton) ─────────────────────────────────────────────
  const loadModule = useCallback((): Promise<KappaModuleInstance> => {
    if (moduleRef.current) return Promise.resolve(moduleRef.current)

    return new Promise((resolve, reject) => {
      if (window.KappaModule) {
        window.KappaModule().then((m) => { moduleRef.current = m; resolve(m) }).catch(reject)
        return
      }
      const script = document.createElement('script')
      script.src = '/wasm/kappa_wasm.js'
      script.onload = () => {
        const poll = setInterval(() => {
          if (window.KappaModule) {
            clearInterval(poll)
            window.KappaModule().then((m) => { moduleRef.current = m; resolve(m) }).catch(reject)
          }
        }, 50)
        setTimeout(() => { clearInterval(poll); reject(new Error('KappaModule no disponible')) }, 10000)
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
      if (!kappa.openEDF('/tmp/file.edf')) throw new Error('openEDF devolvió false — archivo inválido')

      const info = kappa.getMeta()
      kappa.setFilters(0.5, 45, 50)   // defaults: HP 0.5, LP 45, notch 50
      kappaRef.current = kappa
      setMeta({ subjectId: info.subjectId, recordingDate: info.recordingDate })
      setTotalSeconds(Math.floor(info.numSamples / info.sampleRate))

      const firstEpoch = kappa.readEpoch(0, 10)
      if (!firstEpoch) throw new Error('readEpoch devolvió null')
      setEpoch(firstEpoch)
      setPage(0)
      sessionStorage.setItem(`ocean_eeg_key_${id}`, key)
      setPhase('viewing')
    } catch (err) {
      const msg      = err instanceof Error ? err.message : 'Error desconocido'
      const isBadKey = (err instanceof DOMException && err.name === 'OperationError') || msg.includes('autenticación')
      setErrorMsg(isBadKey ? 'Clave incorrecta — el archivo no se pudo descifrar.' : msg)
      setPhase('error')
    }
  }, [id, token, decryptFile, loadModule])

  // ── Auto-start from sessionStorage ───────────────────────────────────────────
  useEffect(() => {
    if (!id || phase !== 'key-input') return
    const saved = sessionStorage.getItem(`ocean_eeg_key_${id}`)
    if (saved) { setKeyInput(saved); startViewer(saved) }
  }, [id, phase, startViewer])

  // ── Filter & window handlers ─────────────────────────────────────────────────
  const refreshEpoch = useCallback((offsetPage: number, winSecs: number) => {
    const kappa = kappaRef.current
    if (!kappa) return
    const e = kappa.readEpoch(offsetPage * winSecs, winSecs)
    if (e) setEpoch(e)
  }, [])

  const handleHpChange = (val: string) => {
    const v = parseFloat(val)
    setHp(v)
    const kappa = kappaRef.current
    if (!kappa) return
    kappa.setFilters(v, lp, notch ? 50 : 0)
    refreshEpoch(page, windowSecs)
  }

  const handleLpChange = (val: string) => {
    const v = parseFloat(val)
    setLp(v)
    const kappa = kappaRef.current
    if (!kappa) return
    kappa.setFilters(hp, v, notch ? 50 : 0)
    refreshEpoch(page, windowSecs)
  }

  const handleNotchChange = (val: string) => {
    const on = val === '1'
    setNotch(on)
    const kappa = kappaRef.current
    if (!kappa) return
    kappa.setFilters(hp, lp, on ? 50 : 0)
    refreshEpoch(page, windowSecs)
  }

  const handleWindowChange = (val: string) => {
    const newWin = parseInt(val)
    const currentTime = page * windowSecs
    const newPage = Math.floor(currentTime / newWin)
    setWindowSecs(newWin)
    setPage(newPage)
    const kappa = kappaRef.current
    if (!kappa) return
    const e = kappa.readEpoch(newPage * newWin, newWin)
    if (e) setEpoch(e)
  }

  // ── Pagination ────────────────────────────────────────────────────────────────
  const maxPage = Math.max(0, Math.ceil(totalSeconds / windowSecs) - 1)

  const goToPage = useCallback((newPage: number) => {
    const kappa = kappaRef.current
    if (!kappa) return
    const e = kappa.readEpoch(newPage * windowSecs, windowSecs)
    if (!e) return
    setEpoch(e)
    setPage(newPage)
  }, [windowSecs])

  // ── Keyboard navigation ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'viewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  && page > 0)       goToPage(page - 1)
      if (e.key === 'ArrowRight' && page < maxPage)  goToPage(page + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, page, maxPage, goToPage])

  // ── Canvas draw ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'viewing' || !epoch || !canvasRef.current) return
    drawEpoch(canvasRef.current, epoch, scales)
  }, [phase, epoch, scales])

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
      try { moduleRef.current?.FS.unlink('/tmp/file.edf') } catch { /* already gone */ }
    }
  }, [])

  // ── Submit key form ───────────────────────────────────────────────────────────
  const handleSubmitKey = (e: React.FormEvent) => {
    e.preventDefault()
    if (keyInput.trim()) startViewer(keyInput.trim())
  }

  // ── Render: key input / error ─────────────────────────────────────────────────

  if (phase === 'key-input' || phase === 'error') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', background: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif', padding: '1rem',
      }}>
        <div style={{
          background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '2rem', width: '100%', maxWidth: 440,
          display: 'flex', flexDirection: 'column', gap: '1.25rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <div>
            <div style={{ color: '#2563eb', fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>
              Visor EEG
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Caso {id}</div>
          </div>

          {phase === 'error' && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
              padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem',
            }}>
              {errorMsg}
            </div>
          )}

          <div style={{
            background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6,
            padding: '0.75rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5,
          }}>
            <strong>Clave requerida</strong>
            <p style={{ margin: '0.4rem 0 0 0' }}>
              OCEAN no almacena la clave de descifrado. Se mostró una sola vez al crear el caso.
              Si eres el creador, recarga — se intentará automáticamente durante esta sesión.
            </p>
          </div>

          <form onSubmit={handleSubmitKey} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ color: '#475569', fontSize: '0.85rem' }}>
              Clave de descifrado
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Pega la clave Base64…"
                autoFocus
                style={{
                  display: 'block', marginTop: 6, width: '100%',
                  background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6,
                  padding: '0.6rem 0.75rem', color: '#1e293b',
                  fontFamily: 'monospace', fontSize: '0.8rem',
                  boxSizing: 'border-box', outline: 'none',
                }}
              />
            </label>
            <button
              type="submit"
              disabled={!keyInput.trim()}
              style={{
                background: keyInput.trim() ? '#2563eb' : '#e2e8f0',
                color: keyInput.trim() ? '#fff' : '#94a3b8',
                border: 'none', borderRadius: 6, padding: '0.65rem',
                fontWeight: 600, fontSize: '0.9rem',
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

  // ── Render: loading phases ────────────────────────────────────────────────────

  if (phase !== 'viewing') {
    const messages: Record<Phase, string> = {
      'key-input':      '',
      'downloading':    'Descargando paquete…',
      'decrypting':     'Descifrando…',
      'loading-module': 'Cargando módulo EEG…',
      'opening':        'Abriendo archivo…',
      'viewing':        '',
      'error':          '',
    }
    return <StatusScreen message={messages[phase]} />
  }

  // ── Render: viewer ────────────────────────────────────────────────────────────

  const totalPages    = maxPage + 1
  const timeOffsetSec = page * windowSecs

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100vh',
      background: '#f1f5f9', overflow: 'hidden',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '1rem',
        padding: '0.5rem 1rem', background: '#ffffff',
        borderBottom: '1px solid #e2e8f0', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {/* Identity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 4 }}>
          <span style={{ color: '#2563eb', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem' }}>
            EEG · {id}
          </span>
          {meta && (
            <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>
              {meta.subjectId} · {meta.recordingDate}
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Filter controls */}
        <ToolbarSelect label="F. Baja (HP)" value={hp} onChange={handleHpChange}>
          {HP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect label="F. Alta (LP)" value={lp} onChange={handleLpChange}>
          {LP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect label="Notch" value={notch ? '1' : '0'} onChange={handleNotchChange}>
          <option value="1">50 Hz</option>
          <option value="0">Off</option>
        </ToolbarSelect>

        <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />

        <ToolbarSelect label="Ventana" value={windowSecs} onChange={handleWindowChange}>
          {WINDOW_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}s</option>
          ))}
        </ToolbarSelect>

        <ToolbarSelect label="Ganancia" value={gainMult} onChange={(v) => setGainMult(parseFloat(v))}>
          {GAIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </ToolbarSelect>

        <div style={{ flex: 1 }} />

        {/* Pagination */}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>
            t = {timeOffsetSec}s
          </span>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0}
            title="Anterior (←)"
            style={navBtnStyle(page === 0)}
          >
            ←
          </button>
          <span style={{ color: '#475569', fontSize: '0.8rem', fontFamily: 'monospace', minWidth: 64, textAlign: 'center' }}>
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
      <div style={{ flex: 1, overflow: 'auto', background: '#f1f5f9' }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
      </div>
    </div>
  )
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? '#f1f5f9' : '#ffffff',
    color:        disabled ? '#cbd5e1' : '#1e293b',
    border:       `1px solid ${disabled ? '#e2e8f0' : '#cbd5e1'}`,
    borderRadius: 4,
    padding:      '0.3rem 0.65rem',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     '0.9rem',
    fontWeight:   700,
  }
}
