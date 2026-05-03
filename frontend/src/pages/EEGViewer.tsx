import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useCrypto } from '../hooks/useCrypto'
import { API_BASE, api } from '../api/client'
import {
  LABEL_WIDTH,
  MONTAGE_OPTIONS,
  WINDOW_OPTIONS,
  applyMontage,
  getAverageReferenceCandidates,
  getChannelColor,
  getDsaChannels,
  getEpochReadRequest,
  getMontageHiddenCandidates,
  getNextArtifactRejectState,
  getPageIndexForSecond,
  getPageStepSeconds,
  getSecondBasedPageStart,
  sanitizePersistedViewerState,
  shouldShowMetadataForPointer,
} from './eegViewerUtils'
import type { EpochData, MontageName, PersistedViewerState } from './eegViewerUtils'
import type { CaseItem, SharedLinkBlobInfo } from '../types'
import { getEncryptedPackageFromCache, saveEncryptedPackageToCache } from './encryptedPackageCache'
import { extractEdfAnnotations } from '../utils/edfAnnotations'
import { clearLocalEegSession, createLocalEegSession, getLocalEegSession } from './localEegSession'
import './EEGViewer.css'

// ─── WASM types ───────────────────────────────────────────────────────────────

interface KappaInstance {
  openEDF: (path: string) => boolean
  getMeta: () => {
    numChannels: number
    sampleRate: number
    numSamples: number
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

const NOTCH_OPTIONS: { label: string; value: number }[] = [
  { label: 'Off', value: 0 },
  { label: '50 Hz', value: 50 },
  { label: '60 Hz', value: 60 },
]

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

function readEpochWindow(
  kappa: KappaInstance,
  startSec: number,
  windowSecs: number,
  totalSeconds: number,
  recordDurationSec: number,
): { epoch: EpochData; startSec: number } | null {
  const {
    startSec: normalizedStartSec,
    cropStartSec,
    offsetRecords,
    numRecords,
    durationSec,
  } = getEpochReadRequest(
    startSec,
    windowSecs,
    totalSeconds,
    recordDurationSec,
  )
  const epoch = kappa.readEpoch(offsetRecords, numRecords)
  if (!epoch) return null
  const cropStartSample = Math.max(0, Math.round(cropStartSec * epoch.sfreq))
  const cropSampleCount = Math.max(1, Math.round(durationSec * epoch.sfreq))
  const cropEndSample = Math.min(epoch.nSamples, cropStartSample + cropSampleCount)
  const croppedEpoch: EpochData = {
    ...epoch,
    nSamples: Math.max(0, cropEndSample - cropStartSample),
    data: epoch.data.map((channel) => channel.slice(cropStartSample, cropEndSample)),
  }
  return {
    epoch: croppedEpoch,
    startSec: normalizedStartSec,
  }
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

interface EmbeddedAnnotation {
  onsetSec: number
  durationSec: number
  text: string
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
  annotations?: EmbeddedAnnotation[],
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

  // ── Embedded annotations on current page ───────────────────────────────────
  if (annotations && annotations.length > 0 && pageDuration > 0) {
    const visibleAnnotations = annotations.filter(
      (annotation) => annotation.onsetSec >= tStart && annotation.onsetSec < tStart + pageDuration,
    )

    if (visibleAnnotations.length > 0) {
      ctx.save()
      ctx.strokeStyle = 'rgba(220,38,38,0.82)'
      ctx.fillStyle = 'rgba(185,28,28,0.95)'
      ctx.lineWidth = 1
      ctx.font = '9px monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'

      visibleAnnotations.forEach((annotation, index) => {
        const x = LABEL_WIDTH + ((annotation.onsetSec - tStart) / pageDuration) * waveW
        if (x <= LABEL_WIDTH + 1 || x >= W - 2) return
        const textY = 12 + (index % 3) * 10
        const label = annotation.text.trim().slice(0, 28)

        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvas.height)
        ctx.stroke()

        if (label) {
          ctx.fillText(label, Math.min(x + 3, W - 120), textY)
        }
      })
      ctx.restore()
    }
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
    <div className="viewer-status-screen">
      <div className="viewer-status-spinner" />
      <span>{message}</span>
    </div>
  )
}

// ─── Toolbar select ───────────────────────────────────────────────────────────

function ToolbarSelect({
  label, value, onChange, children, width, compact = false,
}: {
  label: string; value: string | number
  onChange: (v: string) => void; children: React.ReactNode
  width?: number
  compact?: boolean
}) {
  return (
    <label style={{ display: 'flex' }}>
      <select value={value} title={label} aria-label={label} onChange={(e) => onChange(e.target.value)} style={{
        background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 4,
        color: '#1e293b', fontSize: compact ? '0.72rem' : '0.75rem', padding: compact ? '0.14rem 0.28rem' : '0.16rem 0.35rem',
        cursor: 'pointer', outline: 'none',
        width,
        maxWidth: width,
        lineHeight: 1.15,
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

function AnnotationPanel({
  annotations,
  currentStartSec,
  currentEndSec,
  onClose,
  onSelect,
}: {
  annotations: EmbeddedAnnotation[]
  currentStartSec: number
  currentEndSec: number
  onClose: () => void
  onSelect: (targetSec: number) => void
}) {
  const activeIndex = annotations.findIndex(
    (annotation) => annotation.onsetSec >= currentStartSec - 0.01 && annotation.onsetSec < currentEndSec + 0.01,
  )
  const focusIndex = activeIndex >= 0 ? activeIndex : annotations.findIndex((annotation) => annotation.onsetSec >= currentStartSec)
  const centerIndex = focusIndex >= 0 ? focusIndex : Math.max(annotations.length - 1, 0)
  const maxRenderedAnnotations = 400
  const startIndex = annotations.length > maxRenderedAnnotations
    ? Math.max(
        0,
        Math.min(
          Math.max(annotations.length - maxRenderedAnnotations, 0),
          centerIndex - Math.floor(maxRenderedAnnotations / 2),
        ),
      )
    : 0
  const visibleAnnotations = annotations.slice(startIndex, startIndex + maxRenderedAnnotations)
  const currentMarkerIndex = (() => {
    const localIndex = visibleAnnotations.findIndex((annotation) => annotation.onsetSec >= currentStartSec - 0.01)
    return localIndex >= 0 ? localIndex : visibleAnnotations.length
  })()

  return (
    <aside className="viewer-annotations-panel viewer-annotations-panel-open">
      <div className="viewer-annotations-header">
        <span>Anotaciones EDF+</span>
        <div className="viewer-annotations-header-actions">
          <span>{annotations.length}</span>
          <button
            type="button"
            className="viewer-annotations-close"
            onClick={onClose}
            title="Ocultar anotaciones EDF+"
          >
            ✕
          </button>
        </div>
      </div>
      {annotations.length > maxRenderedAnnotations && (
        <div className="viewer-annotations-summary">
          Mostrando {visibleAnnotations.length} de {annotations.length}
        </div>
      )}
      <div className="viewer-annotations-list">
        {visibleAnnotations.map((annotation, visibleIndex) => {
          const index = startIndex + visibleIndex
          const onPage = annotation.onsetSec >= currentStartSec - 0.01 && annotation.onsetSec < currentEndSec + 0.01
          return (
            <div key={`${annotation.onsetSec}-${annotation.text}-${index}`} className="viewer-annotation-entry">
              {currentMarkerIndex === visibleIndex && <div className="viewer-annotation-position-marker" />}
              <button
                type="button"
                onClick={() => onSelect(annotation.onsetSec)}
                className={`viewer-annotation-item${onPage ? ' viewer-annotation-item-active' : ''}`}
                title={annotation.durationSec >= 0
                  ? `${fmtTimeGrid(Math.max(0, Math.round(annotation.onsetSec)))} · ${annotation.text} · ${annotation.durationSec.toFixed(2)} s`
                  : `${fmtTimeGrid(Math.max(0, Math.round(annotation.onsetSec)))} · ${annotation.text}`
                }
              >
                <span className="viewer-annotation-time">
                  {fmtTimeGrid(Math.max(0, Math.round(annotation.onsetSec)))}
                </span>
                <span className="viewer-annotation-text">{annotation.text}</span>
              </button>
            </div>
          )
        })}
        {currentMarkerIndex === visibleAnnotations.length && <div className="viewer-annotation-position-marker" />}
      </div>
    </aside>
  )
}

function TimelineBar({
  totalSeconds,
  currentStartSec,
  currentEndSec,
  annotations,
  artifactStatuses,
  artifactEpochSec,
  onSeek,
}: {
  totalSeconds: number
  currentStartSec: number
  currentEndSec: number
  annotations?: EmbeddedAnnotation[]
  artifactStatuses?: number[]
  artifactEpochSec?: number
  onSeek: (targetSec: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const width = wrap.clientWidth || 1200
    const height = 58
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf4'
    ctx.fillRect(0, 0, width, height)

    const padX = 10
    const trackX = padX
    const trackY = 12
    const trackW = Math.max(1, width - padX * 2)
    const artifactH = artifactStatuses && artifactStatuses.length > 0 ? 10 : 0
    const trackH = artifactH > 0 ? 16 : 22

    if (artifactH > 0 && artifactEpochSec && artifactStatuses) {
      for (let ep = 0; ep < artifactStatuses.length; ep++) {
        const x1 = trackX + Math.floor((ep * trackW) / artifactStatuses.length)
        const x2 = trackX + Math.floor(((ep + 1) * trackW) / artifactStatuses.length)
        ctx.fillStyle = artifactColor(artifactStatuses[ep] ?? 0)
        ctx.fillRect(x1, trackY, Math.max(1, x2 - x1), artifactH)
      }
    }

    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(trackX, trackY + artifactH, trackW, trackH)
    ctx.strokeStyle = '#94a3b8'
    ctx.strokeRect(trackX, trackY + artifactH, trackW, trackH)

    const safeTotal = Math.max(totalSeconds, 1)
    const viewX1 = trackX + (Math.max(0, currentStartSec) / safeTotal) * trackW
    const viewX2 = trackX + (Math.min(safeTotal, currentEndSec) / safeTotal) * trackW
    ctx.fillStyle = 'rgba(37,99,235,0.18)'
    ctx.fillRect(viewX1, trackY + artifactH, Math.max(2, viewX2 - viewX1), trackH)
    ctx.strokeStyle = 'rgba(37,99,235,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(viewX1, trackY + artifactH, Math.max(2, viewX2 - viewX1), trackH)

    ctx.beginPath()
    ctx.moveTo(viewX1, trackY + artifactH - 4)
    ctx.lineTo(viewX1, trackY + artifactH + trackH + 4)
    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 2
    ctx.stroke()

    const approxTicks = Math.max(2, Math.floor(trackW / 90))
    const tickStepSec = safeTotal / approxTicks
    ctx.font = '10px monospace'
    ctx.fillStyle = '#475569'
    ctx.strokeStyle = '#64748b'
    for (let i = 0; i <= approxTicks; i++) {
      const tSec = Math.round(i * tickStepSec)
      const x = trackX + (tSec / safeTotal) * trackW
      ctx.beginPath()
      ctx.moveTo(x, trackY + artifactH + trackH)
      ctx.lineTo(x, trackY + artifactH + trackH + 4)
      ctx.stroke()
      ctx.fillText(fmtTimeGrid(tSec), x + 2, height - 6)
    }

    ctx.fillStyle = '#64748b'
    ctx.fillText(
      `${fmtTimeGrid(Math.max(0, Math.round(currentStartSec)))} / ${fmtTimeGrid(Math.max(0, Math.round(totalSeconds)))}`,
      trackX,
      9,
    )

    if (annotations && annotations.length > 0) {
      ctx.save()
      ctx.strokeStyle = '#6d28d9'
      ctx.lineWidth = 2
      annotations.forEach((annotation) => {
        const markerX = trackX + (Math.max(0, Math.min(safeTotal, annotation.onsetSec)) / safeTotal) * trackW
        ctx.beginPath()
        ctx.moveTo(markerX, 2)
        ctx.lineTo(markerX, trackY - 1)
        ctx.stroke()
      })
      ctx.restore()
    }
  }, [annotations, artifactEpochSec, artifactStatuses, currentEndSec, currentStartSec, totalSeconds])

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
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const padX = 10
    const trackW = Math.max(1, rect.width - padX * 2)
    const rel = Math.max(0, Math.min(0.999999, (x - padX) / trackW))
    onSeek(rel * Math.max(totalSeconds, 1))
  }, [onSeek, totalSeconds])

  return (
    <div
      ref={wrapRef}
      style={{
        flexShrink: 0,
        height: 58,
        background: '#ffffff',
        borderTop: '1px solid #e2e8f0',
        padding: '0.15rem 0.5rem 0.2rem 0.5rem',
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', height: '100%', cursor: 'pointer' }}
      />
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EEGViewer() {
  const { id, recordId, sharedId, localId } = useParams<{ id?: string; recordId?: string; sharedId?: string; localId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const sourceKind: 'case' | 'gallery' | 'shared' | 'local' = localId ? 'local' : sharedId ? 'shared' : recordId ? 'gallery' : 'case'
  const sourceId = localId || sharedId || recordId || id || ''
  const token           = useAuthStore((s) => s.token)
  const { decryptFile } = useCrypto()

  const [phase,    setPhase]    = useState<Phase>('key-input')
  const [errorMsg, setErrorMsg] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [storedPassword, setStoredPassword] = useState('')
  const [showStoredKeyModal, setShowStoredKeyModal] = useState(false)
  const [recoveringStoredKey, setRecoveringStoredKey] = useState(false)

  const [epoch,        setEpoch]        = useState<EpochData | null>(null)
  const [recordOffset, setRecordOffset] = useState(0)
  const [recordDurationSec, setRecordDurationSec] = useState(1)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [meta,         setMeta]         = useState<{ recordingDate: string } | null>(null)
  const [edfAnnotations, setEdfAnnotations] = useState<EmbeddedAnnotation[]>([])
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [caseHoverMeta, setCaseHoverMeta] = useState<{ blobHash?: string; cacheKey?: string; ageRange?: string; sizeBytes?: number; storedKeyAvailable?: boolean; encryptionMode?: string; label?: string } | null>(null)
  const [showMeta,     setShowMeta]     = useState(false)

  const [windowSecs,      setWindowSecs]      = useState(10)
  const [hp,              setHp]              = useState(0.5)
  const [lp,              setLp]              = useState(45)
  const [notch,           setNotch]           = useState(50)
  const [gainMult,        setGainMult]        = useState(1)
  const [normalizeNonEEG, setNormalizeNonEEG] = useState(false)
  const [montage,         setMontage]         = useState<MontageName>('promedio')
  const [excludedAverageReferenceChannels, setExcludedAverageReferenceChannels] = useState<string[]>([])
  const [includedHiddenChannels, setIncludedHiddenChannels] = useState<string[]>([])
  const [avgRefOpen, setAvgRefOpen] = useState(false)
  const [avgRefMenuPos, setAvgRefMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [extrasMenuPos, setExtrasMenuPos] = useState<{ top: number; left: number } | null>(null)
  const [dsaChannel,      setDsaChannel]      = useState('off')
  const [artifactReject,  setArtifactReject]  = useState(false)
  const [dsaData,         setDsaData]         = useState<DSAData | null>(null)
  const [dsaLoading,      setDsaLoading]      = useState(false)
  const [dsaError,        setDsaError]        = useState('')
  const [compactToolbar,  setCompactToolbar]  = useState(false)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [localPickerError, setLocalPickerError] = useState('')

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)    // outer flex container (for height)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const kappaRef   = useRef<KappaInstance | null>(null)
  const moduleRef  = useRef<KappaModuleInstance | null>(null)
  const currentEdfPathRef = useRef<string | null>(null)
  const dsaCacheRef = useRef<Map<string, DSAData>>(new Map())
  const avgRefButtonRef = useRef<HTMLButtonElement>(null)
  const avgRefMenuRef = useRef<HTMLDivElement>(null)
  const extrasButtonRef = useRef<HTMLButtonElement>(null)
  const extrasMenuRef = useRef<HTMLDivElement>(null)
  const loadVersionRef = useRef(0)
  const restoreInFlightRef = useRef(false)
  const viewerStateReadyRef = useRef(false)
  const persistTimerRef = useRef<number | null>(null)

  // Imperative overlay refs — no setState on mousemove
  const mousePosRef   = useRef<{ x: number; y: number } | null>(null)
  const mouseOnRef    = useRef(false)
  const metaHoverRef  = useRef(false)
  const sbPosRef      = useRef<{ x: number; y: number } | null>(null)
  const sbDragRef     = useRef<{ startMX: number; startMY: number; startSBX: number; startSBY: number } | null>(null)
  const renderMetaRef = useRef<RenderMeta | null>(null)
  const touchSwipeRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────────

  const montagedEpoch = useMemo(() => {
    if (!epoch) return null
    return applyMontage(epoch, montage, {
      excludedAverageReferenceChannels: new Set(excludedAverageReferenceChannels),
      includedHiddenChannels: new Set(includedHiddenChannels),
    })
  }, [epoch, montage, excludedAverageReferenceChannels, includedHiddenChannels])

  const averageReferenceCandidates = useMemo(() => getAverageReferenceCandidates(epoch), [epoch])
  const hiddenMontageCandidates = useMemo(() => getMontageHiddenCandidates(epoch, montage), [epoch, montage])

  useEffect(() => {
    setExcludedAverageReferenceChannels((current) =>
      current.filter((name) => averageReferenceCandidates.includes(name)),
    )
  }, [averageReferenceCandidates])

  useEffect(() => {
    setIncludedHiddenChannels((current) =>
      current.filter((name) => hiddenMontageCandidates.includes(name)),
    )
  }, [hiddenMontageCandidates])

  useEffect(() => {
    if (montage !== 'promedio') setAvgRefOpen(false)
  }, [montage])

  useEffect(() => {
    if (montage === 'raw') setExtrasOpen(false)
  }, [montage])

  useEffect(() => {
    if (!avgRefOpen) {
      setAvgRefMenuPos(null)
      return
    }

    const updateMenuPosition = () => {
      const rect = avgRefButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setAvgRefMenuPos({
        top: rect.bottom + 6,
        left: rect.left,
      })
    }

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (
        avgRefButtonRef.current?.contains(target) ||
        avgRefMenuRef.current?.contains(target)
      ) return
      setAvgRefOpen(false)
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    document.addEventListener('mousedown', handleOutside)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [avgRefOpen])

  useEffect(() => {
    if (!extrasOpen) {
      setExtrasMenuPos(null)
      return
    }

    const updateMenuPosition = () => {
      const rect = extrasButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setExtrasMenuPos({
        top: rect.bottom + 6,
        left: rect.left,
      })
    }

    const handleOutside = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (
        extrasButtonRef.current?.contains(target) ||
        extrasMenuRef.current?.contains(target)
      ) return
      setExtrasOpen(false)
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    document.addEventListener('mousedown', handleOutside)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      document.removeEventListener('mousedown', handleOutside)
    }
  }, [extrasOpen])

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
  const pageStepSec = getPageStepSeconds(windowSecs, recordDurationSec)

  const currentPage = getPageIndexForSecond(recordOffset, pageStepSec)
  const maxPage = Math.max(0, Math.ceil(totalSeconds / Math.max(pageStepSec, 1)) - 1)
  const dsaChannels = useMemo(() => getDsaChannels(epoch), [epoch])

  useEffect(() => {
    loadVersionRef.current += 1
    restoreInFlightRef.current = false
    viewerStateReadyRef.current = false
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
      persistTimerRef.current = null
    }
    try { moduleRef.current?.FS.unlink('/tmp/file.edf') } catch { /* noop */ }
    try {
      if (currentEdfPathRef.current) moduleRef.current?.FS.unlink(currentEdfPathRef.current)
    } catch { /* noop */ }
    currentEdfPathRef.current = null
    kappaRef.current = null
    dsaCacheRef.current.clear()
    renderMetaRef.current = null
    sbPosRef.current = null
    sbDragRef.current = null
    mousePosRef.current = null
    mouseOnRef.current = false
    metaHoverRef.current = false
    touchSwipeRef.current = null

    setPhase('key-input')
    setErrorMsg('')
    setEpoch(null)
    setRecordOffset(0)
    setRecordDurationSec(1)
    setTotalSeconds(0)
    setMeta(null)
    setEdfAnnotations([])
    setAnnotationsOpen(false)
    setCaseHoverMeta(null)
    setShowMeta(false)
    setWindowSecs(10)
    setHp(0.5)
    setLp(45)
    setNotch(50)
    setGainMult(1)
    setNormalizeNonEEG(false)
    setMontage('promedio')
    setExcludedAverageReferenceChannels([])
    setIncludedHiddenChannels([])
    setAvgRefOpen(false)
    setAvgRefMenuPos(null)
    setExtrasOpen(false)
    setExtrasMenuPos(null)
    setMobileControlsOpen(false)
    setLocalPickerError('')
    setDsaChannel('off')
    setArtifactReject(false)
    setDsaData(null)
    setDsaLoading(false)
    setDsaError('')
  }, [sourceId, sourceKind])

  useEffect(() => {
    if (!sourceId) return
    let cancelled = false

    const request = sourceKind === 'case'
      ? api.get<CaseItem>(`/cases/${sourceId}`).then((caseItem) => ({
          blobHash: caseItem.package?.blobHash,
          cacheKey: caseItem.package?.blobHash,
          ageRange: caseItem.ageRange || undefined,
          sizeBytes: caseItem.package?.sizeBytes,
          storedKeyAvailable: !!caseItem.storedKeyAvailable,
          encryptionMode: caseItem.package ? 'AES256-GCM' : undefined,
          label: caseItem.title || `Caso ${sourceId}`,
        }))
      : sourceKind === 'shared'
        ? fetch(`${API_BASE}/shared-links/${sourceId}`, {
            headers: {
              'Cache-Control': 'no-store',
            },
          }).then(async (res) => {
            if (!res.ok) throw new Error(`Error al cargar shared link (${res.status})`)
            return res.json() as Promise<SharedLinkBlobInfo>
          }).then((sharedLink) => ({
            blobHash: undefined,
            cacheKey: `shared-link:${sharedLink.id}`,
            ageRange: undefined,
            sizeBytes: sharedLink.sizeBytes,
            storedKeyAvailable: false,
            encryptionMode: sharedLink.encryptionMode,
            label: sharedLink.label || sharedLink.originalFilename || `Shared link ${sourceId}`,
          }))
      : sourceKind === 'local'
        ? Promise.resolve().then(() => {
            const session = getLocalEegSession(sourceId)
            if (!session) throw new Error('El archivo local ya no está disponible. Vuelve a /open y selecciónalo de nuevo.')
            return {
              blobHash: undefined,
              cacheKey: undefined,
              ageRange: undefined,
              sizeBytes: session.sizeBytes,
              storedKeyAvailable: false,
              encryptionMode: 'NONE',
              label: session.filename,
            }
          })
      : api.get<any>(`/galleries/records/${sourceId}`).then((record) => ({
          blobHash: record.eegRecord?.blobHash,
          cacheKey: record.eegRecord?.blobHash,
          ageRange: typeof record.metadata?.ageRange === 'string' ? record.metadata.ageRange : undefined,
          sizeBytes: record.eegRecord?.sizeBytes,
          storedKeyAvailable: false,
          encryptionMode: record.eegRecord?.encryptionMode,
          label: record.label || `Registro ${sourceId}`,
        }))

    request
      .then((meta) => {
        if (cancelled) return
        setCaseHoverMeta(meta)
      })
      .catch((err) => {
        if (cancelled) return
        if (sourceKind === 'shared' || sourceKind === 'local') {
          setErrorMsg(err instanceof Error ? err.message : 'No se pudo abrir el shared link')
          setPhase('error')
          return
        }
        console.warn('[OCEAN EEG] No se pudo cargar la metadata del origen para el hover', err)
      })

    return () => {
      cancelled = true
    }
  }, [sourceId, sourceKind])

  useEffect(() => {
    const mediaNarrow = window.matchMedia('(max-width: 900px)')
    const mediaTouch = window.matchMedia('(pointer: coarse)')
    const updateCompactToolbar = () => {
      setCompactToolbar(mediaNarrow.matches || mediaTouch.matches)
    }

    updateCompactToolbar()
    mediaNarrow.addEventListener('change', updateCompactToolbar)
    mediaTouch.addEventListener('change', updateCompactToolbar)
    return () => {
      mediaNarrow.removeEventListener('change', updateCompactToolbar)
      mediaTouch.removeEventListener('change', updateCompactToolbar)
    }
  }, [])

  useEffect(() => {
    if (!compactToolbar) setMobileControlsOpen(false)
  }, [compactToolbar])

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
    const tStart     = recordOffset
    const chanH      = drawEpoch(canvas, processedEpoch, scales, tStart, pageDuration, containerH, edfAnnotations)
    const { sbMuV, sbPxH } = computeSBSize(chanH, canvas.height)

    renderMetaRef.current = {
      tStart, pageDuration,
      chanH,
      W: canvas.width, H: canvas.height,
      sbMuV, sbPxH,
    }
    refreshOverlay()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedEpoch, scales, refRange, gainMult, recordOffset, pageDuration, refreshOverlay, edfAnnotations])

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

  const toggleHiddenMontageChannel = useCallback((name: string) => {
    setIncludedHiddenChannels((current) =>
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
    if (!sourceId) return
    const runVersion = loadVersionRef.current
    const isStale = () => loadVersionRef.current !== runVersion
    try {
      setEdfAnnotations([])
      setAnnotationsOpen(false)
      restoreInFlightRef.current = true
      viewerStateReadyRef.current = false
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      let packageMeta = sourceKind === 'shared' || sourceKind === 'local' ? null : caseHoverMeta
      if (sourceKind === 'shared' || sourceKind === 'local' || !packageMeta?.blobHash) {
        try {
          if (sourceKind === 'case') {
            packageMeta = await api.get<CaseItem>(`/cases/${sourceId}`).then((caseItem) => ({
              blobHash: caseItem.package?.blobHash,
              cacheKey: caseItem.package?.blobHash,
              ageRange: caseItem.ageRange || undefined,
              sizeBytes: caseItem.package?.sizeBytes,
              encryptionMode: caseItem.package ? 'AES256-GCM' : undefined,
              label: caseItem.title || `Caso ${sourceId}`,
            }))
          } else if (sourceKind === 'gallery') {
            packageMeta = await api.get<any>(`/galleries/records/${sourceId}`).then((record) => ({
              blobHash: record.eegRecord?.blobHash,
              cacheKey: record.eegRecord?.blobHash,
              ageRange: typeof record.metadata?.ageRange === 'string' ? record.metadata.ageRange : undefined,
              sizeBytes: record.eegRecord?.sizeBytes,
              encryptionMode: record.eegRecord?.encryptionMode,
              label: record.label || `Registro ${sourceId}`,
            }))
          } else if (sourceKind === 'shared') {
            packageMeta = await fetch(`${API_BASE}/shared-links/${sourceId}`, {
              headers: { 'Cache-Control': 'no-store' },
            }).then(async (res) => {
              if (!res.ok) throw new Error(`Error al cargar shared link (${res.status})`)
              return res.json() as Promise<SharedLinkBlobInfo>
            }).then((sharedLink) => ({
              cacheKey: `shared-link:${sharedLink.id}`,
              ageRange: undefined,
              sizeBytes: sharedLink.sizeBytes,
              encryptionMode: sharedLink.encryptionMode,
              label: sharedLink.label || sharedLink.originalFilename || `Shared link ${sourceId}`,
            }))
          } else {
            const session = getLocalEegSession(sourceId)
            if (!session) throw new Error('El archivo local ya no está disponible. Vuelve a /open y selecciónalo de nuevo.')
            packageMeta = {
              cacheKey: undefined,
              ageRange: undefined,
              sizeBytes: session.sizeBytes,
              encryptionMode: 'NONE',
              label: session.filename,
            }
          }
          if (isStale()) return
          setCaseHoverMeta(packageMeta)
        } catch (err) {
          if (isStale()) return
          console.warn('[OCEAN EEG] No se pudo refrescar la metadata del origen antes de abrir el visor', err)
        }
      }

      const encryptedCacheKey = packageMeta?.cacheKey || packageMeta?.blobHash
      let encryptedBuffer = encryptedCacheKey
        ? await getEncryptedPackageFromCache(encryptedCacheKey)
        : null
      if (isStale()) return

      if (!encryptedBuffer) {
        if (sourceKind === 'local') {
          const session = getLocalEegSession(sourceId)
          if (!session) throw new Error('El archivo local ya no está disponible. Vuelve a /open y selecciónalo de nuevo.')
          encryptedBuffer = session.buffer.slice(0)
        } else {
          setPhase('downloading')
          const downloadPath = sourceKind === 'case'
            ? `${API_BASE}/packages/download/${sourceId}`
            : sourceKind === 'gallery'
              ? `${API_BASE}/galleries/records/${sourceId}/download`
              : `${API_BASE}/shared-links/${sourceId}/download`
          const headers: Record<string, string> = sourceKind === 'shared'
            ? { 'Cache-Control': 'no-store' }
            : { Authorization: `Bearer ${token ?? ''}` }
          const res = await fetch(downloadPath, { headers })
          if (!res.ok) throw new Error(`Error al descargar (${res.status})`)
          encryptedBuffer = await res.arrayBuffer()
          if (isStale()) return

          if ((sourceKind === 'case' || sourceKind === 'shared') && encryptedCacheKey) {
            saveEncryptedPackageToCache({
              blobHash: encryptedCacheKey,
              caseId: `${sourceKind}:${sourceId}`,
              sizeBytes: packageMeta?.sizeBytes,
              payload: encryptedBuffer,
            }).catch((err) => {
              console.warn('[OCEAN EEG] No se pudo guardar el paquete cifrado en caché local', err)
            })
          }
        }
      }

      let decryptedBuffer: ArrayBuffer
      if (packageMeta?.encryptionMode === 'NONE') {
        decryptedBuffer = encryptedBuffer
      } else {
        setPhase('decrypting')
        decryptedBuffer = await decryptFile(encryptedBuffer, key)
      }
      if (isStale()) return

      try {
        const parsedAnnotations = extractEdfAnnotations(new Uint8Array(decryptedBuffer))
        if (isStale()) return
        setEdfAnnotations(parsedAnnotations)
        setAnnotationsOpen(parsedAnnotations.length > 0)
      } catch (err) {
        if (isStale()) return
        console.warn('[OCEAN EEG] No se pudieron leer las anotaciones EDF+ embebidas', err)
        setEdfAnnotations([])
        setAnnotationsOpen(false)
      }

      setPhase('loading-module')
      const Module = await loadModule()
      if (isStale()) return

      setPhase('opening')
      const kappa = new Module.KappaWasm()
      const memfsPath = `/tmp/file-${Date.now()}-${Math.random().toString(36).slice(2)}.edf`
      try {
        if (currentEdfPathRef.current) Module.FS.unlink(currentEdfPathRef.current)
      } catch { /* noop */ }
      Module.FS.writeFile(memfsPath, new Uint8Array(decryptedBuffer))
      currentEdfPathRef.current = memfsPath
      if (!kappa.openEDF(memfsPath)) throw new Error('openEDF devolvió false — archivo inválido')
      if (isStale()) return

      const info = kappa.getMeta()
      if (isStale()) return
      kappaRef.current = kappa
      sbPosRef.current = null
      dsaCacheRef.current.clear()
      setDsaChannel('off')
      setArtifactReject(false)
      setDsaData(null)
      setDsaLoading(false)
      setDsaError('')
      setMeta({ recordingDate: info.recordingDate })
      const totalDurationSec = info.numSamples / info.sampleRate
      setTotalSeconds(totalDurationSec)
      const probeEpoch = kappa.readEpoch(0, 1)
      if (!probeEpoch) throw new Error('readEpoch(0, 1) devolvió null')
      const detectedRecordDurationSec = probeEpoch.nSamples / probeEpoch.sfreq
      setRecordDurationSec(detectedRecordDurationSec)
      let persistedState: PersistedViewerState | null = null
      if (sourceKind !== 'shared' && sourceKind !== 'local') {
        try {
          const viewerStatePath = sourceKind === 'case'
            ? `/viewer-state/${sourceId}`
            : `/viewer-state/gallery/${sourceId}`
          persistedState = await api.get<PersistedViewerState | null>(viewerStatePath)
        } catch (err) {
          if (isStale()) return
          console.warn('[OCEAN EEG] No se pudo recuperar el estado guardado del visor', err)
        }
      }

      const restoredState = sanitizePersistedViewerState(persistedState, probeEpoch, totalDurationSec)
      const nextWindowSecs = restoredState?.windowSecs ?? 10
      const nextHp = restoredState?.hp ?? 0.5
      const nextLp = restoredState?.lp ?? 45
      const nextNotch = restoredState?.notch ?? 50
      const nextGainMult = restoredState?.gainMult ?? 1
      const nextNormalizeNonEEG = restoredState?.normalizeNonEEG ?? false
      const nextMontage = restoredState?.montage ?? 'promedio'
      const nextExcludedAverageReferenceChannels = restoredState?.excludedAverageReferenceChannels ?? []
      const nextIncludedHiddenChannels = restoredState?.includedHiddenChannels ?? []
      const nextDsaChannel = restoredState?.dsaChannel ?? 'off'
      const nextArtifactReject = restoredState?.artifactReject ?? false
      const nextPositionSec = restoredState?.positionSec ?? 0

      kappa.setFilters(nextHp, nextLp, nextNotch)
      const firstRead = readEpochWindow(kappa, nextPositionSec, nextWindowSecs, totalDurationSec, detectedRecordDurationSec)
      if (!firstRead) throw new Error('readEpoch devolvió null')
      if (isStale()) return
      setWindowSecs(nextWindowSecs)
      setHp(nextHp)
      setLp(nextLp)
      setNotch(nextNotch)
      setGainMult(nextGainMult)
      setNormalizeNonEEG(nextNormalizeNonEEG)
      setMontage(nextMontage)
      setExcludedAverageReferenceChannels(nextExcludedAverageReferenceChannels)
      setIncludedHiddenChannels(nextIncludedHiddenChannels)
      setDsaChannel(nextDsaChannel)
      setArtifactReject(nextArtifactReject)
      setEpoch(firstRead.epoch)
      setRecordOffset(firstRead.startSec)
      if (packageMeta?.encryptionMode !== 'NONE') {
        sessionStorage.setItem(`ocean_eeg_key_${sourceKind}_${sourceId}`, key)
      }
      setPhase('viewing')
      window.setTimeout(() => {
        if (isStale()) return
        restoreInFlightRef.current = false
        viewerStateReadyRef.current = true
      }, 0)
    } catch (err) {
      if (isStale()) return
      const msg      = err instanceof Error ? err.message : 'Error desconocido'
      const isBadKey = (err instanceof DOMException && err.name === 'OperationError') || msg.includes('autenticación')
      restoreInFlightRef.current = false
      viewerStateReadyRef.current = false
      setEdfAnnotations([])
      setAnnotationsOpen(false)
      setErrorMsg(isBadKey ? 'Clave incorrecta — el archivo no se pudo descifrar.' : msg)
      setPhase('error')
    }
  }, [sourceId, sourceKind, token, decryptFile, loadModule, caseHoverMeta])

  // ── Auto-start from sessionStorage ───────────────────────────────────────────

  useEffect(() => {
    if (!sourceId || phase !== 'key-input') return
    if (sourceKind === 'local') {
      startViewer('')
      return
    }
    if (sourceKind === 'gallery' && caseHoverMeta?.encryptionMode === 'NONE') {
      startViewer('')
      return
    }
    if (sourceKind === 'shared') {
      const fromHash = location.hash.startsWith('#')
        ? decodeURIComponent(location.hash.slice(1))
        : ''
      if (fromHash) {
        setKeyInput(fromHash)
        startViewer(fromHash)
        return
      }
    }
    const saved = sessionStorage.getItem(`ocean_eeg_key_${sourceKind}_${sourceId}`)
    if (saved) { setKeyInput(saved); startViewer(saved) }
  }, [sourceId, sourceKind, caseHoverMeta?.encryptionMode, phase, startViewer, location.hash])

  const recoverStoredKey = useCallback(async () => {
    if (!sourceId || !storedPassword.trim() || sourceKind !== 'case') return
    setRecoveringStoredKey(true)
    try {
      const res = await api.post<{ keyBase64: string }>(`/packages/secret/${sourceId}/recover`, {
        password: storedPassword,
      })
      sessionStorage.setItem(`ocean_eeg_key_case_${sourceId}`, res.keyBase64)
      setKeyInput(res.keyBase64)
      setStoredPassword('')
      setShowStoredKeyModal(false)
      startViewer(res.keyBase64)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo recuperar la clave custodiada')
      setPhase('error')
      setShowStoredKeyModal(false)
    } finally {
      setRecoveringStoredKey(false)
    }
  }, [sourceId, sourceKind, startViewer, storedPassword])

  // ── Filter & window handlers ──────────────────────────────────────────────────

  const refreshEpoch = useCallback((nextStartSec: number, nextWindowSecs: number) => {
    const kappa = kappaRef.current
    if (!kappa) return
    const result = readEpochWindow(kappa, nextStartSec, nextWindowSecs, totalSeconds, recordDurationSec)
    if (!result) return
    setEpoch(result.epoch)
    setRecordOffset(result.startSec)
  }, [recordDurationSec, totalSeconds])

  // ── Pagination ────────────────────────────────────────────────────────────────

  const goToPage = useCallback((newPage: number) => {
    const nextStartSec = newPage * pageStepSec
    const kappa = kappaRef.current
    if (!kappa) return
    const result = readEpochWindow(kappa, nextStartSec, windowSecs, totalSeconds, recordDurationSec)
    if (!result) return
    setEpoch(result.epoch)
    setRecordOffset(result.startSec)
  }, [pageStepSec, recordDurationSec, totalSeconds, windowSecs])

  const goToSecondPosition = useCallback((targetSec: number, center = false) => {
    const nextStartSec = getSecondBasedPageStart(targetSec, totalSeconds, windowSecs, pageDuration, center)
    const kappa = kappaRef.current
    if (!kappa) return
    const result = readEpochWindow(kappa, nextStartSec, windowSecs, totalSeconds, recordDurationSec)
    if (!result) return
    setEpoch(result.epoch)
    setRecordOffset(result.startSec)
  }, [pageDuration, recordDurationSec, totalSeconds, windowSecs])

  const shiftBySeconds = useCallback((deltaSec: number) => {
    const currentStartSec = recordOffset
    goToSecondPosition(currentStartSec + deltaSec)
  }, [goToSecondPosition, recordOffset])

  const goToDSAEpoch = useCallback((epochIndex: number, epochSec: number) => {
    const targetSec = Math.max(0, epochIndex * epochSec)
    goToSecondPosition(targetSec, true)
  }, [goToSecondPosition])

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!compactToolbar) return
    const touch = e.touches[0]
    if (!touch) return
    touchSwipeRef.current = { startX: touch.clientX, startY: touch.clientY, active: true }
  }, [compactToolbar])

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!compactToolbar) return
    const swipe = touchSwipeRef.current
    touchSwipeRef.current = null
    if (!swipe?.active) return
    const touch = e.changedTouches[0]
    if (!touch) return

    const dx = touch.clientX - swipe.startX
    const dy = touch.clientY - swipe.startY
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)

    if (absDx < 48 || absDy > 40 || absDx < absDy * 1.2) return
    if (dx < 0 && currentPage < maxPage) goToPage(currentPage + 1)
    if (dx > 0 && currentPage > 0) goToPage(currentPage - 1)
  }, [compactToolbar, currentPage, maxPage, goToPage])

  const handleSelectAnotherLocalEdf = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    setLocalPickerError('')
    try {
      const buffer = await file.arrayBuffer()
      const nextSession = createLocalEegSession({
        filename: file.name,
        sizeBytes: file.size,
        buffer,
      })
      if (sourceKind === 'local' && sourceId) clearLocalEegSession(sourceId)
      navigate(`/open/${nextSession.id}`)
    } catch (err) {
      setLocalPickerError(err instanceof Error ? err.message : 'El navegador no pudo leer el archivo EDF seleccionado.')
    } finally {
      event.target.value = ''
    }
  }, [navigate, sourceId, sourceKind])

  const handleHpChange = (val: string) => {
    const v = parseFloat(val); setHp(v)
    kappaRef.current?.setFilters(v, lp, notch)
    refreshEpoch(recordOffset, windowSecs)
  }
  const handleLpChange = (val: string) => {
    const v = parseFloat(val); setLp(v)
    kappaRef.current?.setFilters(hp, v, notch)
    refreshEpoch(recordOffset, windowSecs)
  }
  const handleNotchChange = (val: string) => {
    const nextNotch = parseFloat(val)
    setNotch(nextNotch)
    kappaRef.current?.setFilters(hp, lp, nextNotch)
    refreshEpoch(recordOffset, windowSecs)
  }
  const handleWindowChange = (val: string) => {
    const newWin = parseInt(val)
    const nextStepSec = getPageStepSeconds(newWin, recordDurationSec)
    const nextPage = getPageIndexForSecond(recordOffset, nextStepSec)
    const nextStartSec = nextPage * nextStepSec
    setWindowSecs(newWin)
    const kappa = kappaRef.current
    if (!kappa) return
    const result = readEpochWindow(kappa, nextStartSec, newWin, totalSeconds, recordDurationSec)
    if (!result) return
    setEpoch(result.epoch)
    setRecordOffset(result.startSec)
  }

  const resetViewerState = useCallback(() => {
    const defaultWindowSecs = 10
    const defaultHp = 0.5
    const defaultLp = 45
    const defaultNotch = 50
    const defaultGainMult = 1
    const defaultMontage: MontageName = 'promedio'
    kappaRef.current?.setFilters(defaultHp, defaultLp, defaultNotch)

    const kappa = kappaRef.current
    if (kappa) {
      const firstRead = readEpochWindow(kappa, 0, defaultWindowSecs, totalSeconds, recordDurationSec)
      if (firstRead) {
        setEpoch(firstRead.epoch)
        setRecordOffset(firstRead.startSec)
      }
    }

    setWindowSecs(defaultWindowSecs)
    setHp(defaultHp)
    setLp(defaultLp)
    setNotch(defaultNotch)
    setGainMult(defaultGainMult)
    setNormalizeNonEEG(false)
    setMontage(defaultMontage)
    setExcludedAverageReferenceChannels([])
    setIncludedHiddenChannels([])
    setAvgRefOpen(false)
    setExtrasOpen(false)
    setDsaChannel('off')
    setArtifactReject(false)
    setDsaData(null)
    setDsaLoading(false)
    setDsaError('')
    setMobileControlsOpen(false)
    dsaCacheRef.current.clear()
  }, [recordDurationSec, totalSeconds])

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

    const cacheKey = `${channelIndex}|${hp}|${lp}|${notch}|${artifactReject ? 1 : 0}`
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

  useEffect(() => {
    if (!sourceId || sourceKind === 'shared' || sourceKind === 'local' || phase !== 'viewing' || restoreInFlightRef.current || !viewerStateReadyRef.current) return

    const payload: PersistedViewerState = {
      positionSec: Math.max(0, Math.round(recordOffset)),
      windowSecs,
      hp,
      lp,
      notch,
      gainMult,
      normalizeNonEEG,
      montage,
      excludedAverageReferenceChannels,
      includedHiddenChannels,
      dsaChannel,
      artifactReject,
    }

    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      const viewerStatePath = sourceKind === 'case'
        ? `/viewer-state/${sourceId}`
        : `/viewer-state/gallery/${sourceId}`
      api.put(viewerStatePath, payload).catch((err) => {
        console.warn('[OCEAN EEG] No se pudo guardar el estado del visor', err)
      })
    }, 800)

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
    }
  }, [
    sourceId,
    sourceKind,
    phase,
    recordOffset,
    windowSecs,
    hp,
    lp,
    notch,
    gainMult,
    normalizeNonEEG,
    montage,
    excludedAverageReferenceChannels,
    includedHiddenChannels,
    dsaChannel,
    artifactReject,
  ])

  // ── Keyboard navigation ───────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'viewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        shiftBySeconds(-1)
        return
      }
      if (e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault()
        shiftBySeconds(1)
        return
      }
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
  }, [phase, currentPage, maxPage, goToPage, shiftBySeconds])

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      try {
        if (currentEdfPathRef.current) moduleRef.current?.FS.unlink(currentEdfPathRef.current)
      } catch { /* already gone */ }
      currentEdfPathRef.current = null
    }
  }, [])

  // ── Key input / error ─────────────────────────────────────────────────────────

  if (sourceKind === 'local' && phase === 'error') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100vh', background: '#f1f5f9',
        fontFamily: 'system-ui, sans-serif', padding: '1rem',
      }}>
        <div style={{
          background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8,
          padding: '2rem', width: '100%', maxWidth: 440,
          display: 'flex', flexDirection: 'column', gap: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <div style={{ color: '#2563eb', fontWeight: 700, fontSize: '1.1rem' }}>Visor EEG local</div>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem' }}>
            {errorMsg}
          </div>
          <a
            href="/open"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#2563eb',
              color: '#fff',
              borderRadius: 6,
              padding: '0.7rem 0.9rem',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Volver a abrir un EDF local
          </a>
        </div>
      </div>
    )
  }

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
            <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
              {sourceKind === 'case'
                ? `Caso ${sourceId}`
                : sourceKind === 'gallery'
                  ? (caseHoverMeta?.label || `Registro ${sourceId}`)
                  : sourceKind === 'shared'
                    ? (caseHoverMeta?.label || `Shared link ${sourceId}`)
                    : (caseHoverMeta?.label || `EDF local ${sourceId}`)}
            </div>
          </div>
          {phase === 'error' && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '0.75rem', color: '#dc2626', fontSize: '0.875rem' }}>
              {errorMsg}
            </div>
          )}
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.75rem', color: '#92400e', fontSize: '0.8rem', lineHeight: 1.5 }}>
            <strong>Clave requerida</strong>
            <p style={{ margin: '0.4rem 0 0 0' }}>
              {sourceKind === 'case'
                ? 'Si ya tienes la clave, pégala aquí. Si eres un usuario invitado de confianza, puedes recuperarla con tu contraseña de OCEAN.'
                : sourceKind === 'gallery'
                  ? 'Este EEG de galería debería abrirse sin clave manual. Si ves esta pantalla, revisa el formato del registro importado.'
                  : 'La clave viaja en el fragmento del enlace. Si no ha entrado sola, pégala aquí manualmente.'}
            </p>
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
            {sourceKind === 'case' && caseHoverMeta?.storedKeyAvailable && (
              <button
                type="button"
                onClick={() => setShowStoredKeyModal(true)}
                style={{
                  background: '#ffffff',
                  color: '#2563eb',
                  border: '1px solid #93c5fd',
                  borderRadius: 6,
                  padding: '0.65rem',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Usar clave guardada en OCEAN
              </button>
            )}
          </form>
        </div>
        {showStoredKeyModal && (
          <div
            onClick={() => {
              if (recoveringStoredKey) return
              setShowStoredKeyModal(false)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem',
              zIndex: 30,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 420,
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '1rem',
                boxShadow: '0 10px 30px rgba(15,23,42,0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.8rem',
              }}
            >
              <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '1rem' }}>Recuperar acceso EEG</div>
              <div style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5 }}>
                Confirma tu contraseña de OCEAN y la plataforma aplicará la clave custodiada sin mostrarla en pantalla.
              </div>
              <label style={{ color: '#475569', fontSize: '0.85rem' }}>
                Contraseña
                <input
                  type="password"
                  value={storedPassword}
                  onChange={(e) => setStoredPassword(e.target.value)}
                  placeholder="Tu contraseña de OCEAN"
                  autoFocus
                  style={{
                    display: 'block',
                    marginTop: 6,
                    width: '100%',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '0.6rem 0.75rem',
                    color: '#1e293b',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowStoredKeyModal(false)}
                  style={{
                    background: '#ffffff',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    borderRadius: 6,
                    padding: '0.6rem 0.85rem',
                    fontWeight: 600,
                    cursor: recoveringStoredKey ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={recoverStoredKey}
                  disabled={recoveringStoredKey || !storedPassword.trim()}
                  style={{
                    background: recoveringStoredKey || !storedPassword.trim() ? '#bfdbfe' : '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '0.6rem 0.85rem',
                    fontWeight: 600,
                    cursor: recoveringStoredKey || !storedPassword.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {recoveringStoredKey ? 'Validando…' : 'Usar clave guardada'}
                </button>
              </div>
            </div>
          </div>
        )}
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

  const tStart        = recordOffset
  const totalPages    = maxPage + 1
  const timeOffsetSec = tStart.toFixed(1)
  const showAvgRefControl = montage === 'promedio' && averageReferenceCandidates.length > 0
  const showExtrasControl = montage !== 'raw' && hiddenMontageCandidates.length > 0
  const showArtifactControl = dsaChannel !== 'off'

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100dvh',
      minHeight: '100vh',
      paddingTop: 'env(safe-area-inset-top, 0px)',
      background: '#f1f5f9',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: compactToolbar ? '0.32rem' : '0.65rem', flexWrap: 'nowrap',
        overflowX: compactToolbar ? 'hidden' : 'auto',
        padding: compactToolbar ? '0.22rem 0.42rem' : '0.35rem 0.6rem', background: '#ffffff',
        borderBottom: '1px solid #e2e8f0', flexShrink: 0,
      }}>
        {sourceKind === 'local' && (
          <>
            <input
              ref={localFileInputRef}
              type="file"
              accept=".edf"
              onChange={handleSelectAnotherLocalEdf}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => localFileInputRef.current?.click()}
              style={{
                background: '#dbeafe',
                border: '1px solid #93c5fd',
                borderRadius: 4,
                color: '#1d4ed8',
                fontSize: compactToolbar ? '0.72rem' : '0.75rem',
                padding: compactToolbar ? '0.18rem 0.42rem' : '0.18rem 0.55rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: 700,
                flexShrink: 0,
              }}
              title="Cargar otro archivo EDF local sin salir del visor"
            >
              {compactToolbar ? 'Abrir EDF' : 'Abrir otro EDF'}
            </button>
            {localPickerError && !compactToolbar && (
              <span style={{ color: '#dc2626', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                {localPickerError}
              </span>
            )}
          </>
        )}

        {!compactToolbar && (
          <>
            <ToolbarSelect label="HP" value={hp} onChange={handleHpChange}>
              {HP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`HP ${o.label}`}</option>)}
            </ToolbarSelect>
            <ToolbarSelect label="LP" value={lp} onChange={handleLpChange}>
              {LP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`LP ${o.label}`}</option>)}
            </ToolbarSelect>
            <ToolbarSelect label="Notch" value={notch} onChange={handleNotchChange}>
              {NOTCH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Notch ${o.label}`}</option>)}
            </ToolbarSelect>

            <div style={{ width: 1, height: 36, background: '#e2e8f0', flexShrink: 0 }} />
          </>
        )}

        <ToolbarSelect label="Vent" value={windowSecs} onChange={handleWindowChange} width={compactToolbar ? 62 : undefined} compact={compactToolbar}>
          {WINDOW_OPTIONS.map((s) => <option key={s} value={s}>{`Vent ${s}s`}</option>)}
        </ToolbarSelect>
        <ToolbarSelect label="Mont" value={montage} onChange={(v) => setMontage(v as MontageName)} width={compactToolbar ? 82 : 108} compact={compactToolbar}>
          {MONTAGE_OPTIONS.map((name) => <option key={name} value={name}>{name}</option>)}
        </ToolbarSelect>
        {!compactToolbar && showAvgRefControl && (
          <div>
            <button
              ref={avgRefButtonRef}
              type="button"
              onClick={() => setAvgRefOpen((open) => !open)}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                padding: '0.16rem 0.42rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                userSelect: 'none',
                color: '#1e293b',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{`AVG ${averageReferenceCandidates.length - excludedAverageReferenceChannels.length}/${averageReferenceCandidates.length}`}</span>
              <span style={{ color: '#64748b' }}>{avgRefOpen ? '▴' : '▾'}</span>
            </button>
          </div>
        )}
        {!compactToolbar && showExtrasControl && (
          <div>
            <button
              ref={extrasButtonRef}
              type="button"
              onClick={() => setExtrasOpen((open) => !open)}
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                padding: '0.16rem 0.42rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                userSelect: 'none',
                color: '#1e293b',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              <span>{`Extras ${includedHiddenChannels.length}/${hiddenMontageCandidates.length}`}</span>
              <span style={{ color: '#64748b' }}>{extrasOpen ? '▴' : '▾'}</span>
            </button>
          </div>
        )}
        <ToolbarSelect label="DSA" value={dsaChannel} onChange={handleDsaChannelChange} width={compactToolbar ? 84 : 112} compact={compactToolbar}>
          <option value="off">DSA OFF</option>
          {dsaChannels.map((channel) => <option key={channel.index} value={channel.index}>{`DSA ${channel.name}`}</option>)}
        </ToolbarSelect>

        {!compactToolbar && (
          <>
            {showArtifactControl && (
              <label style={{ display: 'flex', cursor: dsaChannel === 'off' ? 'not-allowed' : 'pointer' }}>
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
                  {artifactReject ? 'Artef ✓' : 'Artef Off'}
                </button>
              </label>
            )}

            <ToolbarSelect label="Ganancia" value={gainMult} onChange={(v) => setGainMult(parseFloat(v))}>
              {GAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Gan ${o.label}`}</option>)}
            </ToolbarSelect>

            <div style={{ width: 1, height: 32, background: '#e2e8f0', flexShrink: 0 }} />

            <label style={{ display: 'flex', cursor: 'pointer' }}>
              <button
                onClick={() => setNormalizeNonEEG((v) => !v)}
                title="Normalizar canales no-EEG a z-score (media=0, σ=1)"
                style={{
                  background: normalizeNonEEG ? '#dbeafe' : '#f8fafc',
                  border: `1px solid ${normalizeNonEEG ? '#93c5fd' : '#cbd5e1'}`,
                  borderRadius: 4, color: normalizeNonEEG ? '#1d4ed8' : '#475569',
                  fontSize: '0.75rem', padding: '0.16rem 0.38rem',
                  cursor: 'pointer', fontWeight: normalizeNonEEG ? 600 : 400,
                  minWidth: 66,
                }}
              >
                {normalizeNonEEG ? 'Norm z ✓' : 'Norm z'}
              </button>
            </label>

            <label style={{ display: 'flex' }}>
              <button
                onClick={resetViewerState}
                title="Restaurar montaje y controles por defecto para este EEG"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  color: '#475569',
                  fontSize: '0.75rem',
                  padding: '0.16rem 0.52rem',
                  cursor: 'pointer',
                  minWidth: 62,
                }}
              >
                Reset
              </button>
            </label>
          </>
        )}

        {compactToolbar && (
          <button
            type="button"
            onClick={() => setMobileControlsOpen((open) => !open)}
            style={{
              background: mobileControlsOpen ? '#dbeafe' : '#f8fafc',
              border: `1px solid ${mobileControlsOpen ? '#93c5fd' : '#cbd5e1'}`,
              borderRadius: 4,
              color: mobileControlsOpen ? '#1d4ed8' : '#334155',
              fontSize: '0.72rem',
              padding: '0.18rem 0.38rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: mobileControlsOpen ? 600 : 500,
            }}
          >
            Controles {mobileControlsOpen ? '▴' : '▾'}
          </button>
        )}

        {edfAnnotations.length > 0 && (
          <button
            type="button"
            onClick={() => setAnnotationsOpen((open) => !open)}
            title={annotationsOpen ? 'Ocultar anotaciones EDF+' : 'Mostrar anotaciones EDF+'}
            style={{
              background: annotationsOpen ? '#ede9fe' : '#f8fafc',
              border: `1px solid ${annotationsOpen ? '#c4b5fd' : '#cbd5e1'}`,
              borderRadius: 4,
              color: annotationsOpen ? '#5b21b6' : '#334155',
              fontSize: compactToolbar ? '0.72rem' : '0.75rem',
              padding: compactToolbar ? '0.18rem 0.38rem' : '0.16rem 0.48rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontWeight: annotationsOpen ? 700 : 500,
            }}
          >
            {compactToolbar ? '📝' : `📝 EDF+ (${edfAnnotations.length})`}
          </button>
        )}

        <div style={{ flex: 1, minWidth: 8 }} />

        <div style={{ display: 'flex', gap: compactToolbar ? '0.2rem' : '0.3rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ color: '#94a3b8', fontSize: compactToolbar ? '0.6rem' : '0.7rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>t={timeOffsetSec}s</span>
          <button onClick={() => shiftBySeconds(-1)} disabled={tStart <= 0} title="Retroceder 1 segundo (Shift+←)" style={navBtnStyle(tStart <= 0)}>-1s</button>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0} title="Anterior (←)" style={navBtnStyle(currentPage === 0)}>←</button>
          <span style={{ color: '#475569', fontSize: compactToolbar ? '0.66rem' : '0.75rem', fontFamily: 'monospace', minWidth: compactToolbar ? 38 : 54, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {currentPage + 1} / {totalPages}
          </span>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= maxPage} title="Siguiente (→)" style={navBtnStyle(currentPage >= maxPage)}>→</button>
          <button onClick={() => shiftBySeconds(1)} disabled={tStart + pageDuration >= totalSeconds} title="Avanzar 1 segundo (Shift+→)" style={navBtnStyle(tStart + pageDuration >= totalSeconds)}>+1s</button>
        </div>
      </div>

      {compactToolbar && mobileControlsOpen && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '0.55rem',
          flexWrap: 'wrap',
          padding: '0.35rem 0.6rem 0.5rem 0.6rem',
          background: '#fffaf0',
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
        }}>
          <ToolbarSelect label="HP" value={hp} onChange={handleHpChange}>
            {HP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`HP ${o.label}`}</option>)}
          </ToolbarSelect>
          <ToolbarSelect label="LP" value={lp} onChange={handleLpChange}>
            {LP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`LP ${o.label}`}</option>)}
          </ToolbarSelect>
          <ToolbarSelect label="Notch" value={notch} onChange={handleNotchChange}>
            {NOTCH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Notch ${o.label}`}</option>)}
          </ToolbarSelect>
          <ToolbarSelect label="Gan" value={gainMult} onChange={(v) => setGainMult(parseFloat(v))}>
            {GAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Gan ${o.label}`}</option>)}
          </ToolbarSelect>

          <label style={{ display: 'flex', cursor: 'pointer' }}>
            <button
              onClick={() => setNormalizeNonEEG((v) => !v)}
              title="Normalizar canales no-EEG a z-score (media=0, σ=1)"
              style={{
                background: normalizeNonEEG ? '#dbeafe' : '#f8fafc',
                border: `1px solid ${normalizeNonEEG ? '#93c5fd' : '#cbd5e1'}`,
                borderRadius: 4, color: normalizeNonEEG ? '#1d4ed8' : '#475569',
                fontSize: '0.75rem', padding: '0.16rem 0.38rem',
                cursor: 'pointer', fontWeight: normalizeNonEEG ? 600 : 400,
                minWidth: 58,
              }}
            >
              {normalizeNonEEG ? 'Norm z ✓' : 'Norm z'}
            </button>
          </label>

          {showArtifactControl && (
            <label style={{ display: 'flex', cursor: 'pointer' }}>
              <button
                onClick={() => setArtifactReject((v) => !v)}
                title="Excluir épocas con artefacto del DSA y mostrar barra de artefactos"
                style={{
                  background: artifactReject ? '#dcfce7' : '#f8fafc',
                  border: `1px solid ${artifactReject ? '#86efac' : '#cbd5e1'}`,
                  borderRadius: 4, color: artifactReject ? '#166534' : '#475569',
                  fontSize: '0.75rem', padding: '0.16rem 0.45rem',
                  cursor: 'pointer',
                  fontWeight: artifactReject ? 600 : 400,
                }}
              >
                {artifactReject ? 'Artef ✓' : 'Artef Off'}
              </button>
            </label>
          )}

          {showAvgRefControl && (
            <div>
              <button
                ref={avgRefButtonRef}
                type="button"
                onClick={() => setAvgRefOpen((open) => !open)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  padding: '0.16rem 0.42rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  userSelect: 'none',
                  color: '#1e293b',
                  fontSize: '0.75rem',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{`AVG ${averageReferenceCandidates.length - excludedAverageReferenceChannels.length}/${averageReferenceCandidates.length}`}</span>
                <span style={{ color: '#64748b' }}>{avgRefOpen ? '▴' : '▾'}</span>
              </button>
            </div>
          )}

          {showExtrasControl && (
            <div>
              <button
                ref={extrasButtonRef}
                type="button"
                onClick={() => setExtrasOpen((open) => !open)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  padding: '0.16rem 0.42rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  userSelect: 'none',
                  color: '#1e293b',
                  fontSize: '0.75rem',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{`Extras ${includedHiddenChannels.length}/${hiddenMontageCandidates.length}`}</span>
                <span style={{ color: '#64748b' }}>{extrasOpen ? '▴' : '▾'}</span>
              </button>
            </div>
          )}

          <label style={{ display: 'flex' }}>
            <button
              onClick={resetViewerState}
              title="Restaurar montaje y controles por defecto para este EEG"
              style={{
                background: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                color: '#475569',
                fontSize: '0.75rem',
                padding: '0.16rem 0.52rem',
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </label>
        </div>
      )}

      {avgRefOpen && avgRefMenuPos && (
        <div
          ref={avgRefMenuRef}
          style={{
            position: 'fixed',
            top: avgRefMenuPos.top,
            left: avgRefMenuPos.left,
            zIndex: 20,
            background: 'rgba(255,255,255,0.98)',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
            padding: '0.45rem',
            minWidth: 176,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
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
      )}

      {extrasOpen && extrasMenuPos && (
        <div
          ref={extrasMenuRef}
          style={{
            position: 'fixed',
            top: extrasMenuPos.top,
            left: extrasMenuPos.left,
            zIndex: 20,
            background: 'rgba(255,255,255,0.98)',
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            boxShadow: '0 10px 24px rgba(15,23,42,0.12)',
            padding: '0.45rem',
            minWidth: 176,
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: 6 }}>
            Incluye canales que no aparecen por defecto en este montaje.
          </div>
          {hiddenMontageCandidates.map((name) => {
            const checked = includedHiddenChannels.includes(name)
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
                  onChange={() => toggleHiddenMontageChannel(name)}
                />
                <span>{name}</span>
              </label>
            )
          })}
        </div>
      )}

      {/* Canvas area — overflow:hidden so canvas fills exact height */}
      <div className="viewer-main-row">
        <div
          ref={wrapRef}
          style={{ flex: 1, height: '100%', overflow: 'hidden', background: '#f1f5f9' }}
        >
          <div
            style={{ position: 'relative', lineHeight: 0, height: '100%' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
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
                <div>
                  Hash: {caseHoverMeta?.blobHash?.trim() || `${sourceKind}-${sourceId}`}
                </div>
                {caseHoverMeta?.ageRange && (
                  <div>Edad: {caseHoverMeta.ageRange}</div>
                )}
                <div>{meta.recordingDate}</div>
              </div>
            )}
            {edfAnnotations.length > 0 && annotationsOpen && (
              <AnnotationPanel
                annotations={edfAnnotations}
                currentStartSec={tStart}
                currentEndSec={Math.min(totalSeconds, tStart + pageDuration)}
                onClose={() => setAnnotationsOpen(false)}
                onSelect={(targetSec) => goToSecondPosition(targetSec, true)}
              />
            )}
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
            <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', pointerEvents: 'none' }} />
          </div>
        </div>
      </div>

      {dsaChannel !== 'off' ? (
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
      ) : (
        <TimelineBar
          totalSeconds={totalSeconds}
          currentStartSec={tStart}
          currentEndSec={Math.min(totalSeconds, tStart + pageDuration)}
          annotations={edfAnnotations}
          artifactStatuses={artifactReject ? dsaData?.artifactStatuses : undefined}
          artifactEpochSec={artifactReject ? dsaData?.artifactEpochSec : undefined}
          onSeek={(targetSec) => goToSecondPosition(targetSec, true)}
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
