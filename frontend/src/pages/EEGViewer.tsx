import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import { API_BASE } from '../api/client'
import {
  LABEL_WIDTH,
  MONTAGE_OPTIONS,
  applyMontage,
  getAverageReferenceCandidates,
  getChannelColor,
  getNextArtifactRejectState,
  getRecordsPerPage,
  shouldShowMetadataForPointer,
} from './eegViewerUtils'
import type { EpochData, MontageName } from './eegViewerUtils'

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
  computeDSAForChannel: (channelIndex: number, artifactRejectEnabled: boolean) => {
    artifactEpochSec: number
    artifactStatuses: number[]
    channelName: string
    normPow: Float32Array[]
    stages: number[]
    nEpochs: number
    nFreqs: number
    freqMin: number
    freqMax: number
    freqStep: number
    epochSec: number
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

const SCALE_BAR_VALUES_UV = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]

type Phase =
  | 'key-input'
  | 'downloading'
  | 'decrypting'
  | 'loading-module'
  | 'opening'
  | 'viewing'
  | 'error'

interface RenderMeta {
  tStart: number
  pageDuration: number   // actual seconds in this page = nSamples / sfreq
  chanH: number          // px per channel row (dynamic, fits all channels)
  W: number
  H: number
  sbMuV: number
  sbPxH: number
}

interface DSAData {
  artifactEpochSec: number
  artifactStatuses: number[]
  channelName: string
  normPow: Float32Array[]
  stages: number[]
  nEpochs: number
  nFreqs: number
  freqMin: number
  freqMax: number
  freqStep: number
  epochSec: number
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

function pickScaleBarValue(refRange: number): number {
  const safeRange = Number.isFinite(refRange) && refRange > 0 ? refRange : 1
  const targetMuV = Math.max(1, safeRange / 4)

  let best = SCALE_BAR_VALUES_UV[0]
  for (const candidate of SCALE_BAR_VALUES_UV) {
    best = candidate
    if (candidate >= targetMuV) break
  }
  return best
}

function stageColor(stage: number): string {
  if (stage === 1) return '#facc15'
  if (stage === 2) return '#60a5fa'
  return '#ffffff'
}

function jetColor(t: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const x = clamp(t)
  const r = clamp(1.5 - Math.abs(4 * x - 3))
  const g = clamp(1.5 - Math.abs(4 * x - 2))
  const b = clamp(1.5 - Math.abs(4 * x - 1))
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

function artifactColor(status: number): string {
  if (status === 2) return '#ef4444'
  if (status === 1) return '#f59e0b'
  return '#22c55e'
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

  ctx.fillStyle = '#fffde8'
  ctx.fillRect(0, 0, W, canvas.height)

  // ── Channel rows ───────────────────────────────────────────────────────────
  for (let c = 0; c < epoch.nChannels; c++) {
    const y0    = c * chanH
    const data  = epoch.data[c]
    const type  = epoch.channelTypes[c] ?? 'EEG'
    const name  = epoch.channelNames[c]  ?? `Ch${c + 1}`
    const color = getChannelColor(name, type)
    const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
    rowInfo.push({ y0, data, type, name, color, p2, p98 })

    if (c % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.03)'
      ctx.fillRect(LABEL_WIDTH, y0, waveW, chanH)
    }

    ctx.fillStyle = '#f7f1c7'
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
    ctx.strokeStyle = 'rgba(100,116,139,0.45)'
    ctx.lineWidth   = 1
    ctx.setLineDash([])
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
  const { tStart, pageDuration, W, H, sbMuV, sbPxH } = meta
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
    octx.textAlign = 'right'; octx.fillText(`${sbMuV} µV`, sbX - 4, lY)
  } else {
    octx.textAlign = 'left';  octx.fillText(`${sbMuV} µV`, sbX + SB_BAR_W + 4, lY)
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
      <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.1 }}>
        {label}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{
        background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 4,
        color: '#1e293b', fontSize: '0.75rem', padding: '0.16rem 0.35rem',
        cursor: 'pointer', outline: 'none',
      }}>
        {children}
      </select>
    </label>
  )
}

function DSAHeatmap({
  data,
  artifactEnabled,
  loading,
  error,
  currentStartSec,
  currentEndSec,
  onEpochClick,
  onArtifactEpochClick,
}: {
  data: DSAData | null
  artifactEnabled: boolean
  loading: boolean
  error: string
  currentStartSec: number
  currentEndSec: number
  onEpochClick: (epochIndex: number) => void
  onArtifactEpochClick: (epochIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const width = wrap.clientWidth || 1200
    const height = 178
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf4'
    ctx.fillRect(0, 0, width, height)

    if (!data) {
      ctx.fillStyle = '#64748b'
      ctx.font = '12px monospace'
      ctx.fillText(loading ? 'Calculando DSA…' : (error || 'DSA desactivado'), 12, 26)
      return
    }

    const artifactH = artifactEnabled ? 12 : 0
    const stageH = 12
    const axisH = 18
    const freqW = 34
    const plotX = freqW
    const plotY = artifactH + stageH
    const plotW = Math.max(1, width - freqW - 2)
    const plotH = Math.max(1, height - artifactH - stageH - axisH - 2)

    if (artifactEnabled && data.artifactStatuses.length > 0) {
      for (let ep = 0; ep < data.artifactStatuses.length; ep++) {
        const x1 = plotX + Math.floor((ep * plotW) / data.artifactStatuses.length)
        const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.artifactStatuses.length)
        ctx.fillStyle = artifactColor(data.artifactStatuses[ep] ?? 0)
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), artifactH)
      }
      ctx.strokeStyle = '#111827'
      ctx.strokeRect(plotX, 0, plotW, artifactH)
      ctx.fillStyle = '#64748b'
      ctx.font = '9px monospace'
      ctx.fillText('Artef.', 2, artifactH - 3)
    }

    for (let ep = 0; ep < data.nEpochs; ep++) {
      const x1 = plotX + Math.floor((ep * plotW) / data.nEpochs)
      const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.nEpochs)
      ctx.fillStyle = stageColor(data.stages[ep] ?? 0)
      ctx.fillRect(x1, artifactH, Math.max(1, x2 - x1), stageH)
    }
    ctx.strokeStyle = '#111827'
    ctx.strokeRect(plotX, artifactH, plotW, stageH)

    for (let fi = 0; fi < data.nFreqs; fi++) {
      const f = data.freqMin + fi * data.freqStep
      const y2 = plotY + plotH - ((f - data.freqMin) / Math.max(1e-9, data.freqMax - data.freqMin)) * plotH
      const y1 = plotY + plotH - (((f + data.freqStep) - data.freqMin) / Math.max(1e-9, data.freqMax - data.freqMin)) * plotH
      for (let ep = 0; ep < data.nEpochs; ep++) {
        const x1 = plotX + Math.floor((ep * plotW) / data.nEpochs)
        const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.nEpochs)
        ctx.fillStyle = jetColor(data.normPow[fi]?.[ep] ?? 0)
        ctx.fillRect(x1, Math.floor(y1), Math.max(1, x2 - x1), Math.max(1, Math.ceil(y2 - y1)))
      }
    }

    const currentX1 = plotX + (currentStartSec / (data.nEpochs * data.epochSec)) * plotW
    const currentX2 = plotX + (currentEndSec / (data.nEpochs * data.epochSec)) * plotW
    ctx.strokeStyle = 'rgba(37,99,235,0.85)'
    ctx.lineWidth = 2
    ctx.strokeRect(currentX1, plotY, Math.max(2, currentX2 - currentX1), plotH)

    const ticks = [1, 4, 8, 13, 20, 30]
    ctx.fillStyle = '#475569'
    ctx.strokeStyle = '#111827'
    ctx.font = '9px monospace'
    for (const tick of ticks) {
      if (tick < data.freqMin || tick > data.freqMax) continue
      const y = plotY + plotH - ((tick - data.freqMin) / Math.max(1e-9, data.freqMax - data.freqMin)) * plotH
      ctx.beginPath()
      ctx.moveTo(freqW - 3, y)
      ctx.lineTo(freqW, y)
      ctx.stroke()
      ctx.fillText(String(tick), 2, y + 3)
    }

    const totalSec = data.nEpochs * data.epochSec
    const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / data.nEpochs)))
    const timeY = plotY + plotH
    ctx.fillStyle = '#e5e7eb'
    ctx.fillRect(plotX, timeY, plotW, axisH)
    ctx.strokeStyle = '#111827'
    ctx.beginPath()
    ctx.moveTo(plotX, timeY)
    ctx.lineTo(plotX + plotW, timeY)
    ctx.stroke()
    ctx.fillStyle = '#475569'
    for (let ep = 0; ep < data.nEpochs; ep += tickEvery) {
      const x = plotX + Math.floor((ep * plotW) / data.nEpochs)
      ctx.beginPath()
      ctx.moveTo(x, timeY)
      ctx.lineTo(x, timeY + 4)
      ctx.stroke()
      const tSec = ep * data.epochSec
      const minutes = Math.floor(tSec / 60)
      const seconds = Math.floor(tSec % 60)
      ctx.fillText(`${minutes}:${pad2(seconds)}`, x + 2, timeY + 12)
    }

    ctx.fillStyle = '#64748b'
    ctx.font = '11px monospace'
    ctx.fillText(`${data.channelName} · ${Math.round(totalSec / 60)} min`, plotX + 6, height - 4)
  }, [artifactEnabled, currentEndSec, currentStartSec, data, error, loading])

  useEffect(() => {
    redraw()
  }, [redraw])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [redraw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const freqW = 34
    const plotW = Math.max(1, (canvasRef.current?.width ?? rect.width) - freqW - 2)
    const artifactH = artifactEnabled ? 12 : 0
    if (artifactEnabled && y <= artifactH && data.artifactStatuses.length > 0) {
      const relArtifact = (x - freqW) / plotW
      const clampedArtifact = Math.max(0, Math.min(0.999999, relArtifact))
      onArtifactEpochClick(Math.floor(clampedArtifact * data.artifactStatuses.length))
      return
    }
    const rel = (x - freqW) / plotW
    const clamped = Math.max(0, Math.min(0.999999, rel))
    onEpochClick(Math.floor(clamped * data.nEpochs))
  }, [artifactEnabled, data, onArtifactEpochClick, onEpochClick])

  return (
    <div
      ref={wrapRef}
      style={{
        flexShrink: 0,
        height: 178,
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        padding: '0.35rem 0.5rem 0.4rem 0.5rem',
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', height: '100%', cursor: data ? 'pointer' : 'default' }}
      />
    </div>
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
  const [showMeta,     setShowMeta]     = useState(false)

  const [windowSecs,      setWindowSecs]      = useState(10)
  const [hp,              setHp]              = useState(0.5)
  const [lp,              setLp]              = useState(45)
  const [notch,           setNotch]           = useState(true)
  const [gainMult,        setGainMult]        = useState(1)
  const [normalizeNonEEG, setNormalizeNonEEG] = useState(false)
  const [montage,         setMontage]         = useState<MontageName>('promedio')
  const [excludedAverageReferenceChannels, setExcludedAverageReferenceChannels] = useState<string[]>([])
  const [dsaChannel,      setDsaChannel]      = useState('off')
  const [artifactReject,  setArtifactReject]  = useState(false)
  const [dsaData,         setDsaData]         = useState<DSAData | null>(null)
  const [dsaLoading,      setDsaLoading]      = useState(false)
  const [dsaError,        setDsaError]        = useState('')

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)    // outer flex container (for height)
  const kappaRef   = useRef<KappaInstance | null>(null)
  const moduleRef  = useRef<KappaModuleInstance | null>(null)
  const dsaCacheRef = useRef<Map<string, DSAData>>(new Map())

  // Imperative overlay refs — no setState on mousemove
  const mousePosRef   = useRef<{ x: number; y: number } | null>(null)
  const mouseOnRef    = useRef(false)
  const metaHoverRef  = useRef(false)
  const sbPosRef      = useRef<{ x: number; y: number } | null>(null)
  const sbDragRef     = useRef<{ startMX: number; startMY: number; startSBX: number; startSBY: number } | null>(null)
  const renderMetaRef = useRef<RenderMeta | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────────

  const montagedEpoch = useMemo(() => {
    if (!epoch) return null
    return applyMontage(epoch, montage, {
      excludedAverageReferenceChannels: new Set(excludedAverageReferenceChannels),
    })
  }, [epoch, montage, excludedAverageReferenceChannels])

  const averageReferenceCandidates = useMemo(() => getAverageReferenceCandidates(epoch), [epoch])

  useEffect(() => {
    setExcludedAverageReferenceChannels((current) =>
      current.filter((name) => averageReferenceCandidates.includes(name)),
    )
  }, [averageReferenceCandidates])

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
  const dsaChannels = useMemo(() => {
    if (!epoch) return [] as Array<{ index: number; name: string }>
    return epoch.channelNames
      .map((name, index) => ({
        index,
        name,
        type: epoch.channelTypes[index] ?? 'EEG',
      }))
      .filter((item) => item.type === 'EEG')
      .map(({ index, name }) => ({ index, name }))
  }, [epoch])

  // ── Overlay redraw (imperative — reads refs, no React re-render) ─────────────

  const refreshOverlay = useCallback(() => {
    const overlay = overlayRef.current
    const rm      = renderMetaRef.current
    if (!overlay || !rm) return
    drawOverlay(overlay, rm, mousePosRef.current, mouseOnRef.current, sbPosRef.current)
  }, [])

  // ── Scale bar size (function inside component to close over refRange/gainMult) ─

  function computeSBSize(chanH: number, totalH: number): { sbMuV: number; sbPxH: number } {
    const drawH = chanH * 0.8
    const safeRange = Number.isFinite(refRange) && refRange > 0 ? refRange : 1
    const pxPerUV = (drawH * gainMult) / safeRange

    const sbMuV = pickScaleBarValue(safeRange)

    const rawPx = Number.isFinite(pxPerUV) && pxPerUV > 0 ? sbMuV * pxPerUV : 0
    const sbPxH = Math.max(20, Math.min(totalH * 0.35, rawPx))
    return { sbMuV, sbPxH }
  }

  // ── Shared draw logic (called from effect and ResizeObserver) ────────────────

  const redraw = useCallback(() => {
    const canvas    = canvasRef.current
    const container = wrapRef.current
    if (!canvas || !container || !processedEpoch) return

    const containerH = container.clientHeight || processedEpoch.nChannels * 60
    const tStart     = recordOffset * recordDurationSec
    const chanH      = drawEpoch(canvas, processedEpoch, scales, tStart, pageDuration, containerH)
    const { sbMuV, sbPxH } = computeSBSize(chanH, canvas.height)

    renderMetaRef.current = {
      tStart, pageDuration,
      chanH,
      W: canvas.width, H: canvas.height,
      sbMuV, sbPxH,
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
    const nextShowMeta = shouldShowMetadataForPointer(x)
    if (metaHoverRef.current !== nextShowMeta) {
      metaHoverRef.current = nextShowMeta
      setShowMeta(nextShowMeta)
    }

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
    mouseOnRef.current = false
    sbDragRef.current = null
    if (metaHoverRef.current) {
      metaHoverRef.current = false
      setShowMeta(false)
    }
    refreshOverlay()
  }, [refreshOverlay])

  const handleDsaChannelChange = useCallback((value: string) => {
    setDsaChannel(value)
    setArtifactReject((current) => getNextArtifactRejectState(dsaChannel, value, current))
  }, [dsaChannel])

  const toggleAverageReferenceChannel = useCallback((name: string) => {
    setExcludedAverageReferenceChannels((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    )
  }, [])

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
      dsaCacheRef.current.clear()
      setDsaChannel('off')
      setArtifactReject(false)
      setDsaData(null)
      setDsaLoading(false)
      setDsaError('')
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

  // ── Pagination ────────────────────────────────────────────────────────────────

  const goToPage = useCallback((newPage: number) => {
    const nextRecordOffset = newPage * recordsPerPage
    const e = kappaRef.current?.readEpoch(nextRecordOffset, recordsPerPage)
    if (!e) return
    setEpoch(e)
    setRecordOffset(nextRecordOffset)
  }, [recordsPerPage])

  const goToDSAEpoch = useCallback((epochIndex: number, epochSec: number) => {
    const targetSec = Math.max(0, epochIndex * epochSec)
    const targetRecordOffset = Math.floor(targetSec / Math.max(recordDurationSec, 1e-9))
    const targetPage = Math.max(0, Math.min(maxPage, Math.floor(targetRecordOffset / recordsPerPage)))
    goToPage(targetPage)
  }, [goToPage, maxPage, recordDurationSec, recordsPerPage])

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

  useEffect(() => {
    if (phase !== 'viewing' || dsaChannel === 'off') {
      setDsaData(null)
      setDsaLoading(false)
      setDsaError('')
      return
    }

    const channelIndex = parseInt(dsaChannel, 10)
    if (!Number.isFinite(channelIndex)) {
      setDsaData(null)
      setDsaLoading(false)
      setDsaError('Canal DSA inválido')
      return
    }

    const cacheKey = `${channelIndex}|${hp}|${lp}|${notch ? 1 : 0}|${artifactReject ? 1 : 0}`
    const cached = dsaCacheRef.current.get(cacheKey)
    if (cached) {
      setDsaData(cached)
      setDsaLoading(false)
      setDsaError('')
      return
    }

    let cancelled = false
    setDsaLoading(true)
    setDsaError('')
    setDsaData(null)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeDSAForChannel(channelIndex, artifactReject)
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular el DSA')
        dsaCacheRef.current.set(cacheKey, result)
        setDsaData(result)
        setDsaLoading(false)
      } catch (err) {
        if (cancelled) return
        setDsaError(err instanceof Error ? err.message : 'Error al calcular DSA')
        setDsaLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, dsaChannel, hp, lp, notch, artifactReject])

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
        display: 'flex', alignItems: 'flex-end', gap: '0.65rem', flexWrap: 'nowrap',
        overflowX: 'auto',
        padding: '0.35rem 0.6rem', background: '#ffffff',
        borderBottom: '1px solid #e2e8f0', flexShrink: 0,
      }}>
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
        {montage === 'promedio' && averageReferenceCandidates.length > 0 && (
          <details style={{ position: 'relative' }}>
            <summary style={{
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              cursor: 'pointer',
              userSelect: 'none',
            }}>
              <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.1 }}>
                Ref AVG
              </span>
              <span style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                color: '#1e293b',
                fontSize: '0.75rem',
                padding: '0.16rem 0.35rem',
                whiteSpace: 'nowrap',
              }}>
                {averageReferenceCandidates.length - excludedAverageReferenceChannels.length}/{averageReferenceCandidates.length}
              </span>
            </summary>
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 6,
              zIndex: 4,
              background: 'rgba(255,255,255,0.98)',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
              padding: '0.45rem',
              minWidth: 176,
              maxHeight: 240,
              overflowY: 'auto',
            }}>
              <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: 6 }}>
                Desmarca canales ruidosos de la referencia media.
              </div>
              {averageReferenceCandidates.map((name) => {
                const checked = !excludedAverageReferenceChannels.includes(name)
                return (
                  <label key={name} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.75rem',
                    color: '#334155',
                    padding: '0.14rem 0',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAverageReferenceChannel(name)}
                    />
                    <span>{name}</span>
                  </label>
                )
              })}
            </div>
          </details>
        )}
        <ToolbarSelect label="DSA" value={dsaChannel} onChange={handleDsaChannelChange}>
          <option value="off">Desactivado</option>
          {dsaChannels.map((channel) => <option key={channel.index} value={channel.index}>{channel.name}</option>)}
        </ToolbarSelect>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: dsaChannel === 'off' ? 'not-allowed' : 'pointer' }}>
          <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.1 }}>Artefactos</span>
          <button
            onClick={() => { if (dsaChannel !== 'off') setArtifactReject((v) => !v) }}
            disabled={dsaChannel === 'off'}
            title="Excluir épocas con artefacto del DSA y mostrar barra de artefactos"
            style={{
              background: artifactReject ? '#dcfce7' : '#f8fafc',
              border: `1px solid ${artifactReject ? '#86efac' : '#cbd5e1'}`,
              borderRadius: 4, color: artifactReject ? '#166534' : '#475569',
              fontSize: '0.75rem', padding: '0.16rem 0.45rem',
              cursor: dsaChannel === 'off' ? 'not-allowed' : 'pointer',
              fontWeight: artifactReject ? 600 : 400,
              opacity: dsaChannel === 'off' ? 0.6 : 1,
            }}
          >
            {artifactReject ? 'on ✓' : 'off'}
          </button>
        </label>

        <ToolbarSelect label="Ganancia" value={gainMult} onChange={(v) => setGainMult(parseFloat(v))}>
          {GAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </ToolbarSelect>

        <div style={{ width: 1, height: 32, background: '#e2e8f0', flexShrink: 0 }} />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer' }}>
          <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.1 }}>Norm. no-EEG</span>
          <button
            onClick={() => setNormalizeNonEEG((v) => !v)}
            title="Normalizar canales no-EEG a z-score (media=0, σ=1)"
            style={{
              background: normalizeNonEEG ? '#dbeafe' : '#f8fafc',
              border: `1px solid ${normalizeNonEEG ? '#93c5fd' : '#cbd5e1'}`,
              borderRadius: 4, color: normalizeNonEEG ? '#1d4ed8' : '#475569',
              fontSize: '0.75rem', padding: '0.16rem 0.45rem',
              cursor: 'pointer', fontWeight: normalizeNonEEG ? 600 : 400,
            }}
          >
            {normalizeNonEEG ? 'z-score ✓' : 'z-score'}
          </button>
        </label>

        <div style={{ flex: 1, minWidth: 8 }} />

        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>t={timeOffsetSec}s</span>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} title="Anterior (←)" style={navBtnStyle(currentPage === 0)}>←</button>
          <span style={{ color: '#475569', fontSize: '0.75rem', fontFamily: 'monospace', minWidth: 54, textAlign: 'center', whiteSpace: 'nowrap' }}>
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
          {meta && showMeta && (
            <div style={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 2,
              background: 'rgba(255,255,255,0.88)',
              border: '1px solid rgba(203,213,225,0.9)',
              borderRadius: 6,
              padding: '0.3rem 0.45rem',
              color: '#475569',
              fontSize: '0.68rem',
              fontFamily: 'monospace',
              lineHeight: 1.35,
              pointerEvents: 'none',
              backdropFilter: 'blur(2px)',
            }}>
              <div>{meta.subjectId.trim() || `Caso ${id}`}</div>
              <div>{meta.recordingDate}</div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
          <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents: 'none' }} />
        </div>
      </div>

      {dsaChannel !== 'off' && (
        <DSAHeatmap
          data={dsaData}
          artifactEnabled={artifactReject}
          loading={dsaLoading}
          error={dsaError}
          currentStartSec={tStart}
          currentEndSec={tStart + pageDuration}
          onEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.epochSec)
          }}
          onArtifactEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.artifactEpochSec)
          }}
        />
      )}
    </div>
  )
}

function navBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? '#f1f5f9' : '#ffffff', color: disabled ? '#cbd5e1' : '#1e293b',
    border: `1px solid ${disabled ? '#e2e8f0' : '#cbd5e1'}`, borderRadius: 4,
    padding: '0.22rem 0.48rem', cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.82rem', fontWeight: 700,
  }
}
