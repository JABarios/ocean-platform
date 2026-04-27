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
const SB_BAR_W      = 12
const MIN_CHAN_H    = 10   // px — allow dense montages to fit in one screen

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

const WINDOW_OPTIONS = [10, 20, 30, 150]

const GAIN_OPTIONS: { label: string; value: number }[] = [
  { label: '0.1×', value: 0.1 },
  { label: '0.3×', value: 0.3 },
  { label: '0.5×', value: 0.5 },
  { label: '0.7×', value: 0.7 },
  { label: '1×',   value: 1   },
  { label: '2×',   value: 2   },
  { label: '4×',   value: 4   },
]

const MONTAGES = {
  doble_banana: [
    ['Fp1', 'F7'], ['F7', 'T3'], ['T3', 'T5'], ['T5', 'O1'],
    ['Fp2', 'F8'], ['F8', 'T4'], ['T4', 'T6'], ['T6', 'O2'],
    ['Fp1', 'F3'], ['F3', 'C3'], ['C3', 'P3'], ['P3', 'O1'],
    ['Fp2', 'F4'], ['F4', 'C4'], ['C4', 'P4'], ['P4', 'O2'],
    ['Fz', 'Cz'], ['Cz', 'Pz'],
  ],
  transversal: [
    ['F7', 'F3'], ['F3', 'Fz'], ['Fz', 'F4'], ['F4', 'F8'],
    ['T3', 'C3'], ['C3', 'Cz'], ['Cz', 'C4'], ['C4', 'T4'],
    ['T5', 'P3'], ['P3', 'Pz'], ['Pz', 'P4'], ['P4', 'T6'],
    ['A1', 'T3'], ['A1', 'Fp1'],
    ['A2', 'T4'], ['A2', 'Fp2'],
  ],
  promedio: [
    ['Fp1', 'AVG'], ['Fp2', 'AVG'],
    ['F7', 'AVG'], ['F3', 'AVG'], ['Fz', 'AVG'], ['F4', 'AVG'], ['F8', 'AVG'],
    ['T3', 'AVG'], ['C3', 'AVG'], ['Cz', 'AVG'], ['C4', 'AVG'], ['T4', 'AVG'],
    ['T5', 'AVG'], ['P3', 'AVG'], ['Pz', 'AVG'], ['P4', 'AVG'], ['T6', 'AVG'],
    ['O1', 'AVG'], ['O2', 'AVG'],
  ],
  linked_mastoids: [
    ['Fp1', 'LM'], ['Fp2', 'LM'],
    ['F7', 'LM'], ['F3', 'LM'], ['Fz', 'LM'], ['F4', 'LM'], ['F8', 'LM'],
    ['T3', 'LM'], ['C3', 'LM'], ['Cz', 'LM'], ['C4', 'LM'], ['T4', 'LM'],
    ['T5', 'LM'], ['P3', 'LM'], ['Pz', 'LM'], ['P4', 'LM'], ['T6', 'LM'],
    ['O1', 'LM'], ['O2', 'LM'],
  ],
  hjorth: [
    ['Fp1', 'F3', 'F7', 'Fz'],
    ['Fp2', 'F4', 'F8', 'Fz'],
    ['F3', 'Fp1', 'F7', 'C3', 'Fz'],
    ['F4', 'Fp2', 'F8', 'C4', 'Fz'],
    ['C3', 'F3', 'T3', 'P3', 'Cz'],
    ['C4', 'F4', 'T4', 'P4', 'Cz'],
    ['P3', 'C3', 'T5', 'O1', 'Pz'],
    ['P4', 'C4', 'T6', 'O2', 'Pz'],
    ['O1', 'P3', 'T5'],
    ['O2', 'P4', 'T6'],
  ],
} as const

const MONTAGE_OPTIONS = Object.keys(MONTAGES) as Array<keyof typeof MONTAGES>

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
  sfreq: number          // samples per second — needed for correct time axis
  channelNames: string[]
  channelTypes: string[]
  data: Float32Array[]
}

type MontageName = keyof typeof MONTAGES

interface RenderMeta {
  tStart: number
  pageDuration: number   // actual seconds in this page = nSamples / sfreq
  chanH: number          // px per channel row (dynamic, fits all channels)
  W: number
  H: number
  sbHalfMuV: number
  sbPxH: number
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function zscoreNormalize(data: Float32Array): Float32Array {
  const n = data.length
  let sum = 0
  for (let i = 0; i < n; i++) sum += data[i]
  const mean = sum / n
  let sq = 0
  for (let i = 0; i < n; i++) { const d = data[i] - mean; sq += d * d }
  const std = Math.max(Math.sqrt(sq / n), 0.1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (data[i] - mean) / std
  return out
}

function niceRound(v: number): number {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  if (n < 1.5) return mag
  if (n < 3.5) return 2 * mag
  if (n < 7.5) return 5 * mag
  return 10 * mag
}

function fmtTimeGrid(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return s > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${h}:${pad2(m)}`
  }
  if (sec >= 60) return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`
  return `${sec}`
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

function getRecordsPerPage(windowSecs: number, recordDurationSec: number): number {
  if (recordDurationSec <= 0) return Math.max(1, windowSecs)
  return Math.max(1, Math.round(windowSecs / recordDurationSec))
}

function subtractSignals(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.min(a.length, b.length)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i]
  return out
}

function averageSignals(signals: Float32Array[], nSamples: number): Float32Array {
  const out = new Float32Array(nSamples)
  if (signals.length === 0) return out
  for (const signal of signals) {
    for (let i = 0; i < nSamples; i++) out[i] += signal[i] ?? 0
  }
  for (let i = 0; i < nSamples; i++) out[i] /= signals.length
  return out
}

function applyMontage(epoch: EpochData, montageName: MontageName): EpochData {
  const definitions = MONTAGES[montageName]
  const byName = new Map<string, { data: Float32Array; type: string }>()
  epoch.channelNames.forEach((name, i) => {
    byName.set(name, {
      data: epoch.data[i],
      type: epoch.channelTypes[i] ?? 'EEG',
    })
  })

  const zero = new Float32Array(epoch.nSamples)
  const getSignal = (name: string) => byName.get(name)?.data ?? zero
  const getType = (name: string) => byName.get(name)?.type ?? 'EEG'

  const avgReference = montageName === 'promedio'
    ? averageSignals(epoch.data, epoch.nSamples)
    : null

  const linkedMastoidsReference = montageName === 'linked_mastoids'
    ? averageSignals([getSignal('A1'), getSignal('A2')], epoch.nSamples)
    : null

  const channelNames: string[] = []
  const channelTypes: string[] = []
  const data: Float32Array[] = []

  for (const definition of definitions) {
    if (montageName === 'hjorth') {
      const [active, ...neighbors] = definition as readonly string[]
      const neighborMean = averageSignals(neighbors.map(getSignal), epoch.nSamples)
      channelNames.push(`${active} - AVG(${neighbors.join(',')})`)
      channelTypes.push(getType(active))
      data.push(subtractSignals(getSignal(active), neighborMean))
      continue
    }

    const [channelA, channelB] = definition as readonly [string, string]
    const reference =
      channelB === 'AVG' ? avgReference :
      channelB === 'LM' ? linkedMastoidsReference :
      getSignal(channelB)

    channelNames.push(`${channelA} - ${channelB}`)
    channelTypes.push(getType(channelA))
    data.push(subtractSignals(getSignal(channelA), reference ?? zero))
  }

  return {
    ...epoch,
    nChannels: data.length,
    channelNames,
    channelTypes,
    data,
  }
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function computeScales(
  epoch: EpochData,
  gainMult: number,
  normalizeNonEEG: boolean,
): { scales: { p2: number; p98: number }[]; refRange: number } {
  const perCh = epoch.data.map((d) => {
    const sorted = Float32Array.from(d).sort()
    return {
      p2:     sorted[Math.floor(sorted.length * 0.02)] ?? 0,
      p98:    sorted[Math.floor(sorted.length * 0.98)] ?? 0,
      center: sorted[Math.floor(sorted.length * 0.5)]  ?? 0,
    }
  })

  // Shared reference from EEG channels when normalizing (avoids z-scored channels skewing scale)
  const refIdxs = normalizeNonEEG
    ? epoch.channelTypes.map((t, i) => (t === 'EEG' ? i : -1)).filter((i) => i >= 0)
    : perCh.map((_, i) => i)

  const refRanges = (refIdxs.length > 0 ? refIdxs : perCh.map((_, i) => i))
    .map((i) => perCh[i].p98 - perCh[i].p2)
    .filter((r) => r > 0)
    .sort((a, b) => a - b)

  const refRange  = refRanges.length > 0 ? refRanges[Math.floor(refRanges.length * 0.5)] : 1
  const halfRange = refRange / gainMult / 2

  const scales = perCh.map((s, i) => {
    const type = epoch.channelTypes[i] ?? 'EEG'
    if (normalizeNonEEG && type !== 'EEG') return { p2: s.p2, p98: s.p98 }
    return { p2: s.center - halfRange, p98: s.center + halfRange }
  })

  return { scales, refRange }
}

function drawEpoch(
  canvas: HTMLCanvasElement,
  epoch: EpochData,
  scales: { p2: number; p98: number }[],
  tStart: number,
  pageDuration: number,   // actual seconds — derived from nSamples / sfreq
  containerH: number,
): number {                // returns chanH used
  canvas.width  = canvas.offsetWidth || 1200
  const chanH   = Math.max(MIN_CHAN_H, Math.floor(containerH / Math.max(epoch.nChannels, 1)))
  canvas.height = epoch.nChannels * chanH

  const ctx = canvas.getContext('2d')
  if (!ctx) return chanH

  const W     = canvas.width
  const waveW = W - LABEL_WIDTH
  const rowInfo: Array<{ y0: number; data: Float32Array; type: string; name: string; color: string; p2: number; p98: number }> = []

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, canvas.height)

  // ── Channel rows ───────────────────────────────────────────────────────────
  for (let c = 0; c < epoch.nChannels; c++) {
    const y0    = c * chanH
    const data  = epoch.data[c]
    const type  = epoch.channelTypes[c] ?? 'EEG'
    const name  = epoch.channelNames[c]  ?? `Ch${c + 1}`
    const color = CHANNEL_COLORS[type]   ?? DEFAULT_COLOR
    const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
    rowInfo.push({ y0, data, type, name, color, p2, p98 })

    if (c % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.018)'
      ctx.fillRect(LABEL_WIDTH, y0, waveW, chanH)
    }

    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, y0, LABEL_WIDTH, chanH)

    // Label text — adapt font size to row height
    const fontSize = Math.max(8, Math.min(11, Math.floor(chanH * 0.28)))
    ctx.fillStyle = color
    ctx.font      = `bold ${fontSize}px monospace`
    ctx.textAlign = 'left'
    ctx.fillText(name.slice(0, 9), 4, y0 + chanH * 0.35)
    if (chanH >= 40) {
      ctx.fillStyle = '#64748b'
      ctx.font      = `${Math.max(7, fontSize - 2)}px monospace`
      ctx.fillText(type.slice(0, 6), 4, y0 + chanH * 0.62)
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(0, y0 + chanH); ctx.lineTo(W, y0 + chanH); ctx.stroke()

    ctx.strokeStyle = '#cbd5e1'
    ctx.beginPath(); ctx.moveTo(LABEL_WIDTH, y0); ctx.lineTo(LABEL_WIDTH, y0 + chanH); ctx.stroke()
  }

  // ── Time grid — draw after row backgrounds so lines stay visible ───────────
  {
    const tEnd      = tStart + pageDuration
    const firstTick = Math.ceil(tStart + 1e-9)
    const MIN_LBL   = 42

    ctx.save()
    ctx.strokeStyle = 'rgba(37,99,235,0.22)'
    ctx.lineWidth   = 1
    ctx.setLineDash([3, 4])
    ctx.fillStyle    = '#64748b'
    ctx.font         = '9px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'

    let prevLblX = -Infinity
    for (let t = firstTick; t < tEnd; t++) {
      const x = LABEL_WIDTH + ((t - tStart) / pageDuration) * waveW
      if (x <= LABEL_WIDTH + 1 || x >= W - 1) continue
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
      if (x - prevLblX >= MIN_LBL) { ctx.fillText(fmtTimeGrid(t), x, 3); prevLblX = x }
    }
    ctx.restore()
  }

  // ── Waveforms ───────────────────────────────────────────────────────────────
  for (const row of rowInfo) {
    const { y0, data, color, p2, p98 } = row
    const range = p98 - p2 || 1
    if (data.length < 2) continue

    const margin = chanH * 0.08
    const drawH  = chanH - margin * 2

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth   = 1
    ctx.globalAlpha = 0.85

    for (let i = 0; i < data.length; i++) {
      const x    = LABEL_WIDTH + (i / (data.length - 1)) * waveW
      const norm = (data[i] - p2) / range
      const y    = y0 + margin + drawH * (1 - norm)
      if (i === 0) ctx.moveTo(x, y)
      else         ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  return chanH
}

function drawOverlay(
  overlay: HTMLCanvasElement,
  meta: RenderMeta,
  mousePos: { x: number; y: number } | null,
  mouseOn: boolean,
  sbPos: { x: number; y: number } | null,
): void {
  const { tStart, pageDuration, W, H, sbHalfMuV, sbPxH } = meta
  overlay.width  = W
  overlay.height = H

  const octx = overlay.getContext('2d')
  if (!octx) return

  const waveW = W - LABEL_WIDTH

  // ── Scale bar ──────────────────────────────────────────────────────────────
  const sbX    = sbPos ? sbPos.x : W - SB_BAR_W - 18
  const sbY    = sbPos ? sbPos.y : H - sbPxH - 22
  const sbMidX = sbX + SB_BAR_W / 2

  octx.save()
  octx.strokeStyle = '#64748b'
  octx.lineWidth   = 2
  octx.setLineDash([])
  octx.beginPath(); octx.moveTo(sbMidX, sbY); octx.lineTo(sbMidX, sbY + sbPxH); octx.stroke()
  octx.beginPath(); octx.moveTo(sbX, sbY); octx.lineTo(sbX + SB_BAR_W, sbY); octx.stroke()
  octx.beginPath(); octx.moveTo(sbX, sbY + sbPxH); octx.lineTo(sbX + SB_BAR_W, sbY + sbPxH); octx.stroke()

  octx.fillStyle = '#64748b'; octx.font = '9px monospace'; octx.textBaseline = 'middle'
  const lY = sbY + sbPxH / 2
  if (sbX - LABEL_WIDTH > 44) {
    octx.textAlign = 'right'; octx.fillText(`±${sbHalfMuV} µV`, sbX - 4, lY)
  } else {
    octx.textAlign = 'left';  octx.fillText(`±${sbHalfMuV} µV`, sbX + SB_BAR_W + 4, lY)
  }
  octx.restore()

  // ── Cursor + tooltip ───────────────────────────────────────────────────────
  if (!mouseOn || !mousePos || mousePos.x < LABEL_WIDTH || mousePos.x > W) return

  const { x } = mousePos
  octx.save()
  octx.strokeStyle = 'rgba(37,99,235,0.45)'
  octx.lineWidth   = 1
  octx.setLineDash([])
  octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, H); octx.stroke()

  const t    = tStart + ((x - LABEL_WIDTH) / waveW) * pageDuration
  const lbl  = `${t.toFixed(2)} s`
  octx.font  = '10px monospace'
  const tw   = octx.measureText(lbl).width
  const tpW  = tw + 10, tpH = 18
  let tpX    = x + 8, tpY = 6
  if (tpX + tpW > W - 4) tpX = x - tpW - 8

  octx.fillStyle   = 'rgba(248,250,252,0.95)'
  octx.strokeStyle = '#cbd5e1'; octx.lineWidth = 1
  octx.beginPath(); octx.rect(tpX, tpY, tpW, tpH); octx.fill(); octx.stroke()
  octx.fillStyle = '#1d4ed8'; octx.textAlign = 'left'; octx.textBaseline = 'middle'
  octx.fillText(lbl, tpX + 5, tpY + tpH / 2)
  octx.restore()
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
  label: string; value: string | number
  onChange: (v: string) => void; children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 4,
        color: '#1e293b', fontSize: '0.8rem', padding: '0.2rem 0.4rem',
        cursor: 'pointer', outline: 'none',
      }}>
        {children}
      </select>
    </label>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EEGViewer() {
  const { id }          = useParams<{ id: string }>()
  const token           = useAuthStore((s) => s.token)
  const { decryptFile } = useCrypto()

  const [phase,    setPhase]    = useState<Phase>('key-input')
  const [errorMsg, setErrorMsg] = useState('')
  const [keyInput, setKeyInput] = useState('')

  const [epoch,        setEpoch]        = useState<EpochData | null>(null)
  const [recordOffset, setRecordOffset] = useState(0)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [recordDurationSec, setRecordDurationSec] = useState(1)
  const [meta,         setMeta]         = useState<{ subjectId: string; recordingDate: string } | null>(null)

  const [windowSecs,      setWindowSecs]      = useState(10)
  const [hp,              setHp]              = useState(0.5)
  const [lp,              setLp]              = useState(45)
  const [notch,           setNotch]           = useState(true)
  const [gainMult,        setGainMult]        = useState(1)
  const [normalizeNonEEG, setNormalizeNonEEG] = useState(false)
  const [montage,         setMontage]         = useState<MontageName>('doble_banana')

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)    // outer flex container (for height)
  const kappaRef   = useRef<KappaInstance | null>(null)
  const moduleRef  = useRef<KappaModuleInstance | null>(null)

  // Imperative overlay refs — no setState on mousemove
  const mousePosRef   = useRef<{ x: number; y: number } | null>(null)
  const mouseOnRef    = useRef(false)
  const sbPosRef      = useRef<{ x: number; y: number } | null>(null)
  const sbDragRef     = useRef<{ startMX: number; startMY: number; startSBX: number; startSBY: number } | null>(null)
  const renderMetaRef = useRef<RenderMeta | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────────

  const montagedEpoch = useMemo(() => {
    if (!epoch) return null
    return applyMontage(epoch, montage)
  }, [epoch, montage])

  const processedEpoch = useMemo(() => {
    if (!montagedEpoch) return null
    if (!normalizeNonEEG) return montagedEpoch
    return {
      ...montagedEpoch,
      data: montagedEpoch.data.map((d, i) =>
        (montagedEpoch.channelTypes[i] ?? 'EEG') !== 'EEG' ? zscoreNormalize(d) : d
      ),
    }
  }, [montagedEpoch, normalizeNonEEG])

  const { scales, refRange } = useMemo(() => {
    if (!processedEpoch) return { scales: [] as { p2: number; p98: number }[], refRange: 1 }
    return computeScales(processedEpoch, gainMult, normalizeNonEEG)
  }, [processedEpoch, gainMult, normalizeNonEEG])

  // Actual page duration in seconds (not records!) — fixes time grid
  const pageDuration = processedEpoch
    ? processedEpoch.nSamples / processedEpoch.sfreq
    : windowSecs

  const totalRecords = Math.max(1, Math.ceil(totalSeconds / Math.max(recordDurationSec, 1e-9)))
  const recordsPerPage = getRecordsPerPage(windowSecs, recordDurationSec)
  const currentPage = Math.floor(recordOffset / recordsPerPage)
  const maxPage = Math.max(0, Math.ceil(totalRecords / recordsPerPage) - 1)

  // ── Overlay redraw (imperative — reads refs, no React re-render) ─────────────

  const refreshOverlay = useCallback(() => {
    const overlay = overlayRef.current
    const rm      = renderMetaRef.current
    if (!overlay || !rm) return
    drawOverlay(overlay, rm, mousePosRef.current, mouseOnRef.current, sbPosRef.current)
  }, [])

  // ── Scale bar size (function inside component to close over refRange/gainMult) ─

  function computeSBSize(chanH: number, totalH: number): { sbHalfMuV: number; sbPxH: number } {
    const drawH     = chanH * 0.8
    const sbTarget  = Math.round(chanH * 0.75)
    const pxPerUV   = (drawH * gainMult) / refRange
    const sbHalfMuV = niceRound(sbTarget / (2 * pxPerUV))
    const sbPxH     = Math.max(20, Math.min(totalH * 0.35, sbHalfMuV * 2 * pxPerUV))
    return { sbHalfMuV, sbPxH }
  }

  // ── Shared draw logic (called from effect and ResizeObserver) ────────────────

  const redraw = useCallback(() => {
    const canvas    = canvasRef.current
    const container = wrapRef.current
    if (!canvas || !container || !processedEpoch) return

    const containerH = container.clientHeight || processedEpoch.nChannels * 60
    const tStart     = recordOffset * recordDurationSec
    const chanH      = drawEpoch(canvas, processedEpoch, scales, tStart, pageDuration, containerH)
    const { sbHalfMuV, sbPxH } = computeSBSize(chanH, canvas.height)

    renderMetaRef.current = {
      tStart, pageDuration,
      chanH,
      W: canvas.width, H: canvas.height,
      sbHalfMuV, sbPxH,
    }
    refreshOverlay()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedEpoch, scales, refRange, gainMult, recordOffset, recordDurationSec, pageDuration, refreshOverlay])

  // ── Draw effect ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'viewing') return
    redraw()
  }, [phase, redraw])

  // ── Resize observer (watches the outer container for height + width changes) ──

  useEffect(() => {
    if (phase !== 'viewing' || !wrapRef.current) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [phase, redraw])

  // ── Mouse handlers ────────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x    = e.clientX - rect.left
    const y    = e.clientY - rect.top
    mousePosRef.current = { x, y }
    mouseOnRef.current  = true

    if (sbDragRef.current) {
      const { startMX, startMY, startSBX, startSBY } = sbDragRef.current
      const rm = renderMetaRef.current
      if (rm) {
        const nx = Math.max(LABEL_WIDTH + 4, Math.min(rm.W - SB_BAR_W - 4, startSBX + x - startMX))
        const ny = Math.max(4, Math.min(rm.H - rm.sbPxH - 4, startSBY + y - startMY))
        sbPosRef.current = { x: nx, y: ny }
      }
    }
    refreshOverlay()
  }, [refreshOverlay])

  const handleMouseLeave = useCallback(() => {
    mouseOnRef.current = false; sbDragRef.current = null; refreshOverlay()
  }, [refreshOverlay])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const rm     = renderMetaRef.current
    if (!canvas || !rm) return
    const rect = canvas.getBoundingClientRect()
    const x    = e.clientX - rect.left
    const y    = e.clientY - rect.top
    const sbX  = sbPosRef.current ? sbPosRef.current.x : rm.W - SB_BAR_W - 18
    const sbY  = sbPosRef.current ? sbPosRef.current.y : rm.H - rm.sbPxH - 22
    const pad  = 8
    if (x >= sbX - pad && x <= sbX + SB_BAR_W + pad && y >= sbY - pad && y <= sbY + rm.sbPxH + pad) {
      sbDragRef.current = { startMX: x, startMY: y, startSBX: sbX, startSBY: sbY }
      e.preventDefault()
    }
  }, [])

  useEffect(() => {
    const onUp = () => { sbDragRef.current = null }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // ── Load WASM module ──────────────────────────────────────────────────────────

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

  // ── Full pipeline ─────────────────────────────────────────────────────────────

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
      kappa.setFilters(0.5, 45, 50)
      kappaRef.current = kappa
      sbPosRef.current = null
      setMeta({ subjectId: info.subjectId, recordingDate: info.recordingDate })
      setTotalSeconds(Math.floor(info.numSamples / info.sampleRate))
      const probeEpoch = kappa.readEpoch(0, 1)
      if (!probeEpoch) throw new Error('readEpoch(0, 1) devolvió null')
      const probeDurationSec = probeEpoch.nSamples / probeEpoch.sfreq
      setRecordDurationSec(probeDurationSec)

      const firstEpoch = kappa.readEpoch(0, getRecordsPerPage(windowSecs, probeDurationSec))
      if (!firstEpoch) throw new Error('readEpoch devolvió null')
      setEpoch(firstEpoch)
      setRecordOffset(0)
      sessionStorage.setItem(`ocean_eeg_key_${id}`, key)
      setPhase('viewing')
    } catch (err) {
      const msg      = err instanceof Error ? err.message : 'Error desconocido'
      const isBadKey = (err instanceof DOMException && err.name === 'OperationError') || msg.includes('autenticación')
      setErrorMsg(isBadKey ? 'Clave incorrecta — el archivo no se pudo descifrar.' : msg)
      setPhase('error')
    }
  }, [id, token, decryptFile, loadModule, windowSecs])

  // ── Auto-start from sessionStorage ───────────────────────────────────────────

  useEffect(() => {
    if (!id || phase !== 'key-input') return
    const saved = sessionStorage.getItem(`ocean_eeg_key_${id}`)
    if (saved) { setKeyInput(saved); startViewer(saved) }
  }, [id, phase, startViewer])

  // ── Filter & window handlers ──────────────────────────────────────────────────

  const refreshEpoch = useCallback((nextRecordOffset: number, nextRecordsPerPage: number) => {
    const e = kappaRef.current?.readEpoch(nextRecordOffset, nextRecordsPerPage)
    if (e) setEpoch(e)
  }, [])

  const handleHpChange = (val: string) => {
    const v = parseFloat(val); setHp(v)
    kappaRef.current?.setFilters(v, lp, notch ? 50 : 0)
    refreshEpoch(recordOffset, recordsPerPage)
  }
  const handleLpChange = (val: string) => {
    const v = parseFloat(val); setLp(v)
    kappaRef.current?.setFilters(hp, v, notch ? 50 : 0)
    refreshEpoch(recordOffset, recordsPerPage)
  }
  const handleNotchChange = (val: string) => {
    const on = val === '1'; setNotch(on)
    kappaRef.current?.setFilters(hp, lp, on ? 50 : 0)
    refreshEpoch(recordOffset, recordsPerPage)
  }
  const handleWindowChange = (val: string) => {
    const newWin = parseInt(val)
    const nextRecordsPerPage = getRecordsPerPage(newWin, recordDurationSec)
    const nextPage = Math.floor(recordOffset / nextRecordsPerPage)
    const nextRecordOffset = nextPage * nextRecordsPerPage
    setWindowSecs(newWin)
    const e = kappaRef.current?.readEpoch(nextRecordOffset, nextRecordsPerPage)
    if (!e) return
    setEpoch(e)
    setRecordOffset(nextRecordOffset)
  }

  // ── Pagination ────────────────────────────────────────────────────────────────

  const goToPage = useCallback((newPage: number) => {
    const nextRecordOffset = newPage * recordsPerPage
    const e = kappaRef.current?.readEpoch(nextRecordOffset, recordsPerPage)
    if (!e) return
    setEpoch(e)
    setRecordOffset(nextRecordOffset)
  }, [recordsPerPage])

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'viewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft'  && currentPage > 0)        goToPage(currentPage - 1)
      if (e.key === 'ArrowRight' && currentPage < maxPage)  goToPage(currentPage + 1)
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setGainMult((prev) => {
          const idx = GAIN_OPTIONS.findIndex((o) => o.value === prev)
          return GAIN_OPTIONS[Math.min(idx + 1, GAIN_OPTIONS.length - 1)].value
        })
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setGainMult((prev) => {
          const idx = GAIN_OPTIONS.findIndex((o) => o.value === prev)
          return GAIN_OPTIONS[Math.max(idx - 1, 0)].value
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, currentPage, maxPage, goToPage])

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      try { moduleRef.current?.FS.unlink('/tmp/file.edf') } catch { /* already gone */ }
    }
  }, [])

  // ── Key input / error ─────────────────────────────────────────────────────────

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
            <div style={{ color: '#2563eb', fontWeight: 700, fontSize: '1.1rem', marginBottom: 4 }}>Visor EEG</div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Caso {id}</div>
          </div>
          {phase === 'error' && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem' }}>
              {errorMsg}
            </div>
          )}
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.75rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5 }}>
            <strong>Clave requerida</strong>
            <p style={{ margin: '0.4rem 0 0 0' }}>OCEAN no almacena la clave de descifrado. Se mostró una sola vez al crear el caso.</p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (keyInput.trim()) startViewer(keyInput.trim()) }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <label style={{ color: '#475569', fontSize: '0.85rem' }}>
              Clave de descifrado
              <input
                type="text" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Pega la clave Base64…" autoFocus
                style={{
                  display: 'block', marginTop: 6, width: '100%',
                  background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6,
                  padding: '0.6rem 0.75rem', color: '#1e293b',
                  fontFamily: 'monospace', fontSize: '0.8rem', boxSizing: 'border-box', outline: 'none',
                }}
              />
            </label>
            <button
              type="submit" disabled={!keyInput.trim()}
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

  // ── Loading ───────────────────────────────────────────────────────────────────

  if (phase !== 'viewing') {
    const messages: Record<Phase, string> = {
      'key-input': '', 'downloading': 'Descargando paquete…', 'decrypting': 'Descifrando…',
      'loading-module': 'Cargando módulo EEG…', 'opening': 'Abriendo archivo…', 'viewing': '', 'error': '',
    }
    return <StatusScreen message={messages[phase]} />
  }

  // ── Viewer ────────────────────────────────────────────────────────────────────

  const tStart        = recordOffset * recordDurationSec
  const totalPages    = maxPage + 1
  const timeOffsetSec = tStart.toFixed(1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#f1f5f9', overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap',
        padding: '0.5rem 1rem', background: '#ffffff',
        borderBottom: '1px solid #e2e8f0', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginRight: 4 }}>
          <span style={{ color: '#2563eb', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem' }}>EEG · {id}</span>
          {meta && <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{meta.subjectId} · {meta.recordingDate}</span>}
        </div>

        <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />

        <ToolbarSelect label="F. Baja (HP)" value={hp} onChange={handleHpChange}>
          {HP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="F. Alta (LP)" value={lp} onChange={handleLpChange}>
          {LP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Notch" value={notch ? '1' : '0'} onChange={handleNotchChange}>
          <option value="1">50 Hz</option>
          <option value="0">Off</option>
        </ToolbarSelect>

        <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />

        <ToolbarSelect label="Ventana" value={windowSecs} onChange={handleWindowChange}>
          {WINDOW_OPTIONS.map((s) => <option key={s} value={s}>{s}s</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Montaje" value={montage} onChange={(v) => setMontage(v as MontageName)}>
          {MONTAGE_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Ganancia" value={gainMult} onChange={(v) => setGainMult(parseFloat(v))}>
          {GAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </ToolbarSelect>

        <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer' }}>
          <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Norm. no-EEG</span>
          <button
            onClick={() => setNormalizeNonEEG((v) => !v)}
            title="Normalizar canales no-EEG a z-score (media=0, σ=1)"
            style={{
              background: normalizeNonEEG ? '#dbeafe' : '#f8fafc',
              border: `1px solid ${normalizeNonEEG ? '#93c5fd' : '#cbd5e1'}`,
              borderRadius: 4, color: normalizeNonEEG ? '#1d4ed8' : '#475569',
              fontSize: '0.8rem', padding: '0.2rem 0.6rem',
              cursor: 'pointer', fontWeight: normalizeNonEEG ? 600 : 400,
            }}
          >
            {normalizeNonEEG ? 'z-score ✓' : 'z-score'}
          </button>
        </label>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>t = {timeOffsetSec}s</span>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} title="Anterior (←)" style={navBtnStyle(currentPage === 0)}>←</button>
          <span style={{ color: '#475569', fontSize: '0.8rem', fontFamily: 'monospace', minWidth: 64, textAlign: 'center' }}>
            {currentPage + 1} / {totalPages}
          </span>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= maxPage} title="Siguiente (→)" style={navBtnStyle(currentPage >= maxPage)}>→</button>
        </div>
      </div>

      {/* Canvas area — overflow:hidden so canvas fills exact height */}
      <div
        ref={wrapRef}
        style={{ flex: 1, overflow: 'hidden', background: '#f1f5f9' }}
      >
        <div
          style={{ position: 'relative', lineHeight: 0 }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
        >
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
          <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents: 'none' }} />
        </div>
      </div>
    </div>
  )
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#f1f5f9' : '#ffffff', color: disabled ? '#cbd5e1' : '#1e293b',
    border: `1px solid ${disabled ? '#e2e8f0' : '#cbd5e1'}`, borderRadius: 4,
    padding: '0.3rem 0.65rem', cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.9rem', fontWeight: 700,
  }
}
