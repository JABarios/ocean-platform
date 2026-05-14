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
  computeAdaptiveStdThreshold,
  computeTriggerPreviewSignal,
  computeTriggerThresholdRange,
  computeTriggeredAverage,
  getAverageReferenceCandidates,
  getChannelColor,
  getContralateralChannelName,
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
import type { EpochData, MontageName, PersistedViewerState, TriggeredAverageResult } from './eegViewerUtils'
import type { CaseItem, SharedLinkBlobInfo } from '../types'
import { getEncryptedPackageFromCache, getEncryptedPackageSummaryFromCache, saveEncryptedPackageToCache } from './encryptedPackageCache'
import { extractEdfAnnotations } from '../utils/edfAnnotations'
import { clearLocalEegSession, createLocalEegSession, getLocalEegSession, replaceLocalEegSession } from './localEegSession'
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
    stageDeltaPct?: Float32Array
    stageThetaPct?: Float32Array
    stagePeakHz?: Float32Array
    nEpochs: number
    nFreqs: number
    freqMin: number
    freqMax: number
    freqStep: number
    epochSec: number
  } | null
  computeArtifactMask: () => {
    artifactEpochSec: number
    artifactStatuses: number[]
  } | null
  computeSpindleContextForChannel: (channelIndex: number, offsetRecords: number, nRecords: number) => {
    channelName: string
    nSamples: number
    sampleRate: number
    score: number
    isNremLike: boolean
  } | null
  computeSleepSketchTimeline: () => {
    epochSec: number
    relDelta: Float32Array
    relTheta: Float32Array
    relAlpha: Float32Array
    relSigma: Float32Array
    relBeta: Float32Array
    peakHz: Float32Array
    fmd4to12: Float32Array
    thetaAlphaRatio: Float32Array
    deltaAlphaRatio: Float32Array
    posteriorAlpha: Float32Array
    frontCentralDelta: Float32Array
    validFraction: Float32Array
    suspectFraction: Float32Array
    rejectedFraction: Float32Array
    spindleSupportFraction: Float32Array
    arousalFraction: Float32Array
    hjorthMobility: Float32Array
    hjorthComplexity: Float32Array
    labels: number[]
    confidence: Float32Array
    logisticLabels: number[]
    logisticConfidence: Float32Array
    logisticViterbiLabels: number[]
    logisticViterbiConfidence: Float32Array
  } | null
  computeStateSpectralTimeline: (assumeSleepPresent: boolean) => {
    epochSec: number
    assumeSleepPresent: boolean
    labels: number[]
    confidence: Float32Array
    alphaScore: Float32Array
    openEyeScore: Float32Array
    blinkScore: Float32Array
    relDelta: Float32Array
    relTheta: Float32Array
    relAlpha: Float32Array
    relSigma: Float32Array
    relBeta: Float32Array
    peakHz: Float32Array
    fmd4to12: Float32Array
    posteriorAlpha: Float32Array
    spindleSupportFraction: Float32Array
    slowWaveFraction: Float32Array
    arousalFraction: Float32Array
    validFraction: Float32Array
    rejectedFraction: Float32Array
    ocPosteriorAlphaThreshold: number
    ocPeakHzMin: number
    ocPeakHzMax: number
    ocMedianFmd: number
    sleepFmdThreshold: number
    blinkSupportThreshold: number
  } | null
  computeStateSpectralPanels: (assumeSleepPresent: boolean) => {
    freqs: Float32Array
    stateNames: string[]
    stateLabels: number[]
    epochCounts: number[]
    rawSpectra: Float32Array[]
    flatSpectra: Float32Array[]
    rawSpectraLeft: Float32Array[]
    rawSpectraRight: Float32Array[]
    flatSpectraLeft: Float32Array[]
    flatSpectraRight: Float32Array[]
    alphaPeakRaw: number[]
    alphaPeakFlat: number[]
    alphaPowerRaw: number[]
    deltaPowerRaw: number[]
    thetaPeakFlat: number[]
    sigmaPeakFlat: number[]
    aperiodicSlope: number[]
    aperiodicIntercept: number[]
    assumeSleepPresent: boolean
  } | null
  computeQeegGlobalTimeseries: () => {
    time_sec: number[]
    fmd4to12: number[]
    spectral_entropy: number[]
    sigma_beta_ratio: number[]
    delta_0p5to4: number[]
  } | null
}

interface KappaModuleInstance {
  KappaWasm: new () => KappaInstance
  FS: { writeFile: (path: string, data: Uint8Array) => void; unlink: (path: string) => void }
}

interface KappaModuleConfig {
  locateFile?: (path: string, prefix: string) => string
}

declare global {
  interface Window {
    KappaModule?: (config?: KappaModuleConfig) => Promise<KappaModuleInstance>
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
const TRIGGER_THRESHOLD_POSITIONS = 25
const TRIGGER_AVG_PRESETS_STORAGE_KEY = 'ocean-eeg-trigger-avg-presets-v1'

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
  stageDeltaPct?: Float32Array
  stageThetaPct?: Float32Array
  stagePeakHz?: Float32Array
  nEpochs: number
  nFreqs: number
  freqMin: number
  freqMax: number
  freqStep: number
  epochSec: number
}

interface ArtifactMaskData {
  artifactEpochSec: number
  artifactStatuses: number[]
}

interface N2ContextData {
  contextEpochSec: number
  channelIndex: number
  channelName: string
  statuses: boolean[]
  scores: number[]
}

interface SleepSketchTimelineData {
  epochSec: number
  relDelta: Float32Array
  relTheta: Float32Array
  relAlpha: Float32Array
  relSigma: Float32Array
  relBeta: Float32Array
  peakHz: Float32Array
  fmd4to12: Float32Array
  thetaAlphaRatio: Float32Array
  deltaAlphaRatio: Float32Array
  posteriorAlpha: Float32Array
  frontCentralDelta: Float32Array
  validFraction: Float32Array
  suspectFraction: Float32Array
  rejectedFraction: Float32Array
  spindleSupportFraction: Float32Array
  arousalFraction: Float32Array
  hjorthMobility?: Float32Array
  hjorthComplexity?: Float32Array
  labels: number[]
  confidence: Float32Array
  logisticLabels?: number[]
  logisticConfidence?: Float32Array
  logisticViterbiLabels?: number[]
  logisticViterbiConfidence?: Float32Array
}

interface StateSpectralTimelineData {
  epochSec: number
  assumeSleepPresent: boolean
  labels: number[]
  confidence: Float32Array
  alphaScore: Float32Array
  openEyeScore: Float32Array
  blinkScore: Float32Array
  relDelta: Float32Array
  relTheta: Float32Array
  relAlpha: Float32Array
  relSigma: Float32Array
  relBeta: Float32Array
  peakHz: Float32Array
  fmd4to12: Float32Array
  posteriorAlpha: Float32Array
  spindleSupportFraction: Float32Array
  slowWaveFraction: Float32Array
  arousalFraction: Float32Array
  validFraction: Float32Array
  rejectedFraction: Float32Array
  ocPosteriorAlphaThreshold: number
  ocPeakHzMin: number
  ocPeakHzMax: number
  ocMedianFmd: number
  sleepFmdThreshold: number
  blinkSupportThreshold: number
}

interface StateSpectralPanelData {
  freqs: Float32Array
  stateNames: string[]
  stateLabels: number[]
  epochCounts: number[]
  rawSpectra: Float32Array[]
  flatSpectra: Float32Array[]
  rawSpectraLeft: Float32Array[]
  rawSpectraRight: Float32Array[]
  flatSpectraLeft: Float32Array[]
  flatSpectraRight: Float32Array[]
  alphaPeakRaw: number[]
  alphaPeakFlat: number[]
  alphaPowerRaw: number[]
  deltaPowerRaw: number[]
  thetaPeakFlat: number[]
  sigmaPeakFlat: number[]
  aperiodicSlope: number[]
  aperiodicIntercept: number[]
  assumeSleepPresent: boolean
}

interface QeegGlobalTimeseriesData {
  time_sec: number[]
  fmd4to12: number[]
  spectral_entropy: number[]
  sigma_beta_ratio: number[]
  delta_0p5to4: number[]
}

interface PersistedTriggerAverageSettings {
  triggerChannelName: string
  showTriggerContralateralOverlay: boolean
  triggerDetectionMode: 'event' | 'burst' | 'spindle' | 'slow'
  triggerHp: number
  triggerLp: number
  triggerNotch: number
  triggerSmoothPoints: number
  triggerDerivativeAfterSmooth: boolean
  triggerRectify: boolean
  triggerBurstRearmFraction: number
  spindleSigmaLow: number
  spindleSigmaHigh: number
  spindleBroadLow: number
  spindleBroadHigh: number
  spindleAmplitudeStdMultiplier: number
  spindleMinSec: number
  spindleMaxSec: number
  averageHp: number
  averageLp: number
  averageNotch: number
  averageGainMult: number
  triggerRectifyAverage: boolean
  excludeArtifactEvents: boolean
  useN2ContextGate: boolean
  triggerThresholdStep: number
  triggerAverageScope: 'page' | 'record'
  triggerPreSec: number
  triggerPostSec: number
  triggerRefractorySec: number
}

type TriggerAveragePresetMap = Record<string, PersistedTriggerAverageSettings>

interface EmbeddedAnnotation {
  onsetSec: number
  durationSec: number
  text: string
}

interface ViewerAnnotation {
  id: string
  onsetSec: number
  durationSec: number
  text: string
  color: string
  source: 'trigger'
}

interface TriggerOverlayData {
  channelName: string
  threshold: number
  eventOnsetsSec: number[]
}

const N2_CONTEXT_WINDOW_SEC = 4

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

function canonicalizeRawChannelLabel(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  let canonical = trimmed
    .replace(/^EEG[\s:_-]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const aliases: Record<string, string> = {
    T7: 'T3',
    T8: 'T4',
    P7: 'T5',
    P8: 'T6',
  }
  return aliases[canonical.toUpperCase()] ?? canonical
}

function getSleepSketchStageLabels(data?: SleepSketchTimelineData | null): number[] {
  if (data?.logisticLabels?.length) return data.logisticLabels
  if (data?.logisticViterbiLabels?.length) return data.logisticViterbiLabels
  return data?.labels?.length ? data.labels : []
}

function getSleepSketchConfidence(data?: SleepSketchTimelineData | null): Float32Array | undefined {
  if (data?.logisticConfidence?.length) return data.logisticConfidence
  if (data?.logisticViterbiConfidence?.length) return data.logisticViterbiConfidence
  return data?.confidence?.length ? data.confidence : undefined
}

function resolveTriggerSourceChannelIndex(triggerChannelName: string, channelLabels: string[]): number {
  if (!triggerChannelName || channelLabels.length === 0) return -1
  const leadName = triggerChannelName.split(' - ')[0]?.trim() ?? triggerChannelName.trim()
  const canonicalLead = canonicalizeRawChannelLabel(leadName)
  return channelLabels.findIndex((label) => canonicalizeRawChannelLabel(label) === canonicalLead)
}

function summarizeScores(scores: number[]): { min: number; max: number; mean: number } | null {
  if (scores.length === 0) return null
  let min = scores[0] ?? 0
  let max = min
  let sum = 0
  for (const score of scores) {
    min = Math.min(min, score)
    max = Math.max(max, score)
    sum += score
  }
  return { min, max, mean: sum / scores.length }
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

function sleepSketchLabelColor(label: number): string {
  if (label === 3) return '#2563eb' // N3-like
  if (label === 2) return '#15803d' // N2-like
  if (label === 1) return '#f59e0b' // N1-like
  if (label === 0) return '#f8fafc' // Wake-like
  return '#cbd5e1' // Unknown
}

function stateSpectralLabelColor(label: number): string {
  if (label === 5) return '#1d4ed8' // N3
  if (label === 4) return '#15803d' // N2
  if (label === 3) return '#f59e0b' // N1
  if (label === 2) return '#7c3aed' // OC
  if (label === 1) return '#f97316' // OA
  if (label === 6) return '#dc2626' // Artifact
  return '#cbd5e1' // Unreliable
}

function stateSpectralShortLabel(label: number): string {
  if (label === 1) return 'OA'
  if (label === 2) return 'OC'
  if (label === 3) return 'N1'
  if (label === 4) return 'N2'
  if (label === 5) return 'N3'
  if (label === 6) return 'Art'
  return '?'
}

function LegendRow({
  title,
  items,
}: {
  title: string
  items: Array<{ label: string; color: string; border?: string }>
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center' }}>
      <span style={{ color: '#0f172a', fontWeight: 600, fontSize: '0.78rem', minWidth: 110 }}>{title}</span>
      {items.map((item) => (
        <span
          key={`${title}-${item.label}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            color: '#334155',
            fontSize: '0.76rem',
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: item.color,
              border: item.border ?? '1px solid rgba(15,23,42,0.12)',
              display: 'inline-block',
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function fmdHeatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const r = Math.round(220 + (37 - 220) * clamped)
  const g = Math.round(38 + (99 - 38) * clamped)
  const b = Math.round(38 + (235 - 38) * clamped)
  return `rgb(${r}, ${g}, ${b})`
}

function remapEpochValues<T>(values: ArrayLike<T> | null | undefined, targetLength: number): T[] {
  if (!values || targetLength <= 0) return []
  const sourceLength = values.length ?? 0
  if (sourceLength <= 0) return []
  if (sourceLength === targetLength) return Array.from(values)
  return Array.from({ length: targetLength }, (_, index) => {
    const sourceIndex = Math.min(sourceLength - 1, Math.floor((index * sourceLength) / targetLength))
    return values[sourceIndex] as T
  })
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

function computeScales(
  epoch: EpochData,
  gainMult: number,
  normalizeNonEEG: boolean,
  gainOverrides: Record<string, number>,
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

  const scales = perCh.map((s, i) => {
    const type = epoch.channelTypes[i] ?? 'EEG'
    if (normalizeNonEEG && type !== 'EEG') return { p2: s.p2, p98: s.p98 }
    const channelGain = gainOverrides[epoch.channelNames[i] ?? ''] ?? gainMult
    const halfRange = refRange / channelGain / 2
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
  viewerAnnotations?: ViewerAnnotation[],
  selectedViewerAnnotationId?: string | null,
  selectedChannelName?: string | null,
  triggerOverlay?: TriggerOverlayData | null,
  artifactStatuses?: number[],
  artifactEpochSec?: number,
  showArtifactReviewOverlay?: boolean,
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

    const isSelected = selectedChannelName === name
    ctx.fillStyle = isSelected ? '#fee2e2' : '#f7f1c7'
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

    ctx.strokeStyle = isSelected ? 'rgba(185,28,28,0.45)' : 'rgba(0,0,0,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(0, y0 + chanH); ctx.lineTo(W, y0 + chanH); ctx.stroke()

    ctx.strokeStyle = isSelected ? '#dc2626' : '#cbd5e1'
    ctx.beginPath(); ctx.moveTo(LABEL_WIDTH, y0); ctx.lineTo(LABEL_WIDTH, y0 + chanH); ctx.stroke()
    if (isSelected) {
      ctx.strokeStyle = '#dc2626'
      ctx.lineWidth = 2
      ctx.strokeRect(1, y0 + 1, LABEL_WIDTH - 2, Math.max(0, chanH - 2))
    }
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

  if (showArtifactReviewOverlay && artifactStatuses && artifactStatuses.length > 0 && artifactEpochSec && artifactEpochSec > 0) {
    const pageEnd = tStart + pageDuration
    ctx.save()
    for (let ep = 0; ep < artifactStatuses.length; ep++) {
      const status = artifactStatuses[ep] ?? 0
      if (status === 0) continue
      const segStart = ep * artifactEpochSec
      const segEnd = segStart + artifactEpochSec
      const visStart = Math.max(tStart, segStart)
      const visEnd = Math.min(pageEnd, segEnd)
      if (visEnd <= visStart) continue
      const x1 = LABEL_WIDTH + ((visStart - tStart) / pageDuration) * waveW
      const x2 = LABEL_WIDTH + ((visEnd - tStart) / pageDuration) * waveW
      ctx.fillStyle = status === 2 ? 'rgba(220, 38, 38, 0.16)' : 'rgba(245, 158, 11, 0.14)'
      for (const row of rowInfo) {
        if ((row.type ?? 'EEG') !== 'EEG') continue
        ctx.fillRect(x1, row.y0, Math.max(1, x2 - x1), chanH)
      }
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

  if (triggerOverlay && pageDuration > 0) {
    const triggerRow = rowInfo.find((row) => row.name === triggerOverlay.channelName)
    if (triggerRow) {
      const range = triggerRow.p98 - triggerRow.p2 || 1
      const margin = chanH * 0.08
      const drawH = chanH - margin * 2
      const clampedNorm = Math.max(0, Math.min(1, (triggerOverlay.threshold - triggerRow.p2) / range))
      const thresholdY = triggerRow.y0 + margin + drawH * (1 - clampedNorm)

      ctx.save()
      ctx.strokeStyle = 'rgba(220,38,38,0.95)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(LABEL_WIDTH, thresholdY)
      ctx.lineTo(W, thresholdY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(185,28,28,0.96)'
      ctx.font = '10px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`${triggerOverlay.threshold.toFixed(1)} µV`, W - 6, thresholdY - 3)

      triggerOverlay.eventOnsetsSec.forEach((eventOnsetSec) => {
        if (eventOnsetSec < tStart || eventOnsetSec >= tStart + pageDuration) return
        const x = LABEL_WIDTH + ((eventOnsetSec - tStart) / pageDuration) * waveW
        ctx.strokeStyle = 'rgba(16,185,129,0.9)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, triggerRow.y0)
        ctx.lineTo(x, triggerRow.y0 + chanH)
        ctx.stroke()
      })
      ctx.restore()
    }
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

  if (viewerAnnotations && viewerAnnotations.length > 0 && pageDuration > 0) {
    const visibleViewerAnnotations = viewerAnnotations.filter(
      (annotation) => annotation.onsetSec >= tStart && annotation.onsetSec < tStart + pageDuration,
    )

    if (visibleViewerAnnotations.length > 0) {
      ctx.save()
      visibleViewerAnnotations.forEach((annotation) => {
        const x = LABEL_WIDTH + ((annotation.onsetSec - tStart) / pageDuration) * waveW
        if (x <= LABEL_WIDTH + 1 || x >= W - 2) return
        const selected = annotation.id === selectedViewerAnnotationId
        const strokeColor = selected ? '#ea580c' : '#c026d3'
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = selected ? 3 : 2.2
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvas.height)
        ctx.stroke()

        ctx.fillStyle = strokeColor
        ctx.beginPath()
        ctx.moveTo(x, 2)
        ctx.lineTo(x - (selected ? 7 : 6), 12)
        ctx.lineTo(x + (selected ? 7 : 6), 12)
        ctx.closePath()
        ctx.fill()
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
  selectedTimeSec: number | null,
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

  // ── Cursor fijo seleccionado ───────────────────────────────────────────────
  if (
    selectedTimeSec !== null &&
    selectedTimeSec >= tStart &&
    selectedTimeSec <= tStart + pageDuration
  ) {
    const selectedX = LABEL_WIDTH + ((selectedTimeSec - tStart) / Math.max(pageDuration, 1e-6)) * waveW
    octx.save()
    octx.strokeStyle = 'rgba(37,99,235,0.45)'
    octx.lineWidth = 1
    octx.beginPath()
    octx.moveTo(selectedX, 0)
    octx.lineTo(selectedX, H)
    octx.stroke()
    octx.restore()
  }

  // ── Cursor hover + tooltip ────────────────────────────────────────────────
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

function NumericSuggestInput({
  label,
  value,
  onCommit,
  suggestions,
  width = 74,
  compact = false,
  step = 0.1,
  min = 0,
  max,
}: {
  label: string
  value: number
  onCommit: (value: number) => void
  suggestions: number[]
  width?: number
  compact?: boolean
  step?: number
  min?: number
  max?: number
}) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const listId = `${label.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-suggestions`

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input
        type="text"
        inputMode="decimal"
        list={listId}
        aria-label={label}
        title={`${label} — escribe cualquier valor o elige una sugerencia${Number.isFinite(step) ? ` (paso sugerido ${step})` : ''}`}
        value={text}
        onChange={(e) => {
          const nextText = e.target.value
          setText(nextText)
          const parsed = parseFloat(nextText)
          if (Number.isFinite(parsed)) {
            const clamped = Math.max(min, Math.min(max ?? parsed, parsed))
            onCommit(clamped)
          }
        }}
        onBlur={() => {
          const parsed = parseFloat(text)
          if (Number.isFinite(parsed)) {
            const clamped = Math.max(min, Math.min(max ?? parsed, parsed))
            onCommit(clamped)
            setText(String(clamped))
          } else {
            setText(String(value))
          }
        }}
        style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 4,
          color: '#1e293b',
          fontSize: compact ? '0.72rem' : '0.75rem',
          padding: compact ? '0.16rem 0.32rem' : '0.18rem 0.4rem',
          outline: 'none',
          width,
          maxWidth: width,
          lineHeight: 1.15,
        }}
      />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </label>
  )
}

function DSAHeatmap({
  data,
  sleepSketchData,
  artifactEnabled,
  loading,
  error,
  expanded,
  currentStartSec,
  currentEndSec,
  viewerAnnotations,
  selectedViewerAnnotationId,
  onEpochClick,
  onArtifactEpochClick,
  onViewerAnnotationSelect,
  onToggleExpand,
  onShowHypnogram,
  onShowSleepAnalyzer,
  onShowStateSpectra,
  showMetrics = true,
}: {
  data: DSAData | null
  sleepSketchData?: SleepSketchTimelineData | null
  artifactEnabled: boolean
  loading: boolean
  error: string
  expanded?: boolean
  currentStartSec: number
  currentEndSec: number
  viewerAnnotations?: ViewerAnnotation[]
  selectedViewerAnnotationId?: string | null
  onEpochClick: (epochIndex: number) => void
  onArtifactEpochClick: (epochIndex: number) => void
  onViewerAnnotationSelect?: (annotationId: string) => void
  onToggleExpand?: () => void
  onShowHypnogram?: () => void
  onShowSleepAnalyzer?: () => void
  onShowStateSpectra?: () => void
  showMetrics?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const width = wrap.clientWidth || 1200
    const metricRows = showMetrics ? 11 : 0
    const metricH = expanded ? 24 : 15
    const metricGap = expanded ? 5 : 3
    const metricBlockH = metricRows > 0 ? metricRows * metricH + (metricRows - 1) * metricGap : 0
    const height = (expanded ? 320 : 196) + metricBlockH + 10
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf4'
    ctx.fillRect(0, 0, width, height)

    if (!data) {
      ctx.fillStyle = '#64748b'
      ctx.font = expanded ? '14px monospace' : '12px monospace'
      ctx.fillText(loading ? 'Calculando DSA…' : (error || 'DSA desactivado'), 12, 26)
      return
    }

    const triggerAnnH = viewerAnnotations && viewerAnnotations.length > 0 ? 10 : 0
    const artifactH = artifactEnabled ? 12 : 0
    const stageH = 12
    const axisH = 18
    const freqW = 34
    const plotX = freqW
    const plotY = triggerAnnH + artifactH + stageH
    const plotW = Math.max(1, width - freqW - 2)
    const plotH = Math.max(1, height - triggerAnnH - artifactH - stageH - metricBlockH - axisH - 12)

    if (triggerAnnH > 0 && viewerAnnotations) {
      const totalSec = data.nEpochs * data.epochSec
      viewerAnnotations.forEach((annotation) => {
        const x = plotX + ((Math.max(0, Math.min(totalSec, annotation.onsetSec))) / Math.max(totalSec, 1e-6)) * plotW
        const selected = annotation.id === selectedViewerAnnotationId
        const markerColor = selected ? '#ea580c' : '#c026d3'
        ctx.fillStyle = markerColor
        ctx.fillRect(Math.max(plotX, x - (selected ? 3 : 2)), 0, selected ? 6 : 4, triggerAnnH)
      })
      ctx.strokeStyle = '#111827'
      ctx.strokeRect(plotX, 0, plotW, triggerAnnH)
      ctx.fillStyle = '#a21caf'
      ctx.font = expanded ? 'bold 11px monospace' : 'bold 9px monospace'
      ctx.fillText('Trig', 2, triggerAnnH - 2)
    }

    if (artifactEnabled && data.artifactStatuses.length > 0) {
      for (let ep = 0; ep < data.artifactStatuses.length; ep++) {
        const x1 = plotX + Math.floor((ep * plotW) / data.artifactStatuses.length)
        const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.artifactStatuses.length)
        ctx.fillStyle = artifactColor(data.artifactStatuses[ep] ?? 0)
        ctx.fillRect(x1, triggerAnnH, Math.max(1, x2 - x1), artifactH)
      }
      ctx.strokeStyle = '#111827'
      ctx.strokeRect(plotX, triggerAnnH, plotW, artifactH)
      ctx.fillStyle = '#64748b'
      ctx.font = expanded ? '11px monospace' : '9px monospace'
      ctx.fillText('Artef.', 2, triggerAnnH + artifactH - 3)
    }

    const sleepSketchLabels = getSleepSketchStageLabels(sleepSketchData)
    const stageSource = sleepSketchLabels.length
      ? remapEpochValues(sleepSketchLabels, data.nEpochs)
      : data.stages
    const stageCounts = stageSource.reduce<Record<number, number>>((acc, label) => {
      acc[label] = (acc[label] ?? 0) + 1
      return acc
    }, {})
    for (let ep = 0; ep < data.nEpochs; ep++) {
      const x1 = plotX + Math.floor((ep * plotW) / data.nEpochs)
      const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.nEpochs)
      ctx.fillStyle = sleepSketchLabels.length
        ? sleepSketchLabelColor(stageSource[ep] ?? 4)
        : stageColor(stageSource[ep] ?? 0)
      ctx.fillRect(x1, triggerAnnH + artifactH, Math.max(1, x2 - x1), stageH)
    }
    ctx.strokeStyle = '#111827'
    ctx.strokeRect(plotX, triggerAnnH + artifactH, plotW, stageH)
    if (sleepSketchLabels.length) {
      const legendY = triggerAnnH + artifactH + stageH - 3
      ctx.font = expanded ? '10px monospace' : '8px monospace'
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(`W${stageCounts[0] ?? 0}`, plotX + 4, legendY)
      ctx.fillStyle = '#f59e0b'
      ctx.fillText(`N1 ${stageCounts[1] ?? 0}`, plotX + 34, legendY)
      ctx.fillStyle = '#15803d'
      ctx.fillText(`N2 ${stageCounts[2] ?? 0}`, plotX + 80, legendY)
      ctx.fillStyle = '#2563eb'
      ctx.fillText(`N3 ${stageCounts[3] ?? 0}`, plotX + 126, legendY)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(`? ${stageCounts[4] ?? 0}`, plotX + 172, legendY)
    }

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
    const currentW = Math.max(2, currentX2 - currentX1)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(currentX1, plotY, currentW, plotH)
    ctx.strokeStyle = 'rgba(255,255,255,0.96)'
    ctx.lineWidth = 4
    ctx.strokeRect(currentX1, plotY, currentW, plotH)
    ctx.strokeStyle = 'rgba(15,23,42,0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(currentX1, plotY)
    ctx.lineTo(currentX1, plotY + plotH)
    ctx.moveTo(currentX1 + currentW, plotY)
    ctx.lineTo(currentX1 + currentW, plotY + plotH)
    ctx.stroke()

    const ticks = [1, 4, 8, 13, 20, 30]
    ctx.fillStyle = '#475569'
    ctx.strokeStyle = '#111827'
    ctx.font = expanded ? '11px monospace' : '9px monospace'
    for (const tick of ticks) {
      if (tick < data.freqMin || tick > data.freqMax) continue
      const y = plotY + plotH - ((tick - data.freqMin) / Math.max(1e-9, data.freqMax - data.freqMin)) * plotH
      ctx.beginPath()
      ctx.moveTo(freqW - 3, y)
      ctx.lineTo(freqW, y)
      ctx.stroke()
      ctx.fillText(String(tick), 2, y + 3)
    }

    const metricTop = plotY + plotH + 4
    if (showMetrics) {
      const metricDefs = [
        { label: 'δ', values: sleepSketchData?.relDelta, stroke: '#16a34a', fill: 'rgba(22,163,74,0.08)', kind: 'trace' as const },
        { label: 'θ', values: sleepSketchData?.relTheta, stroke: '#d97706', fill: 'rgba(217,119,6,0.08)', kind: 'trace' as const },
        { label: 'α', values: sleepSketchData?.relAlpha, stroke: '#7c3aed', fill: 'rgba(124,58,237,0.08)', kind: 'trace' as const },
        { label: 'σ', values: sleepSketchData?.relSigma, stroke: '#0f766e', fill: 'rgba(15,118,110,0.08)', kind: 'trace' as const },
        { label: 'β', values: sleepSketchData?.relBeta, stroke: '#dc2626', fill: 'rgba(220,38,38,0.08)', kind: 'trace' as const },
        { label: 'F4-12', values: sleepSketchData?.fmd4to12, stroke: '#475569', fill: 'rgba(71,85,105,0.08)', kind: 'heat' as const },
        { label: 'Valid', values: sleepSketchData?.validFraction, stroke: '#0f766e', fill: 'rgba(15,118,110,0.08)', kind: 'trace' as const },
        { label: 'Spn', values: sleepSketchData?.spindleSupportFraction, stroke: '#2563eb', fill: 'rgba(37,99,235,0.08)', kind: 'trace' as const },
        { label: 'Arou', values: sleepSketchData?.arousalFraction, stroke: '#ea580c', fill: 'rgba(234,88,12,0.08)', kind: 'trace' as const },
        { label: 'Conf', values: getSleepSketchConfidence(sleepSketchData), stroke: '#111827', fill: 'rgba(15,23,42,0.06)', kind: 'trace' as const },
        { label: 'Hyp', values: stageSource, stroke: '#64748b', fill: 'rgba(100,116,139,0.08)', kind: 'stage' as const },
      ]

      metricDefs.forEach((metric, rowIndex) => {
        const y = metricTop + rowIndex * (metricH + metricGap)
        ctx.fillStyle = metric.fill
        ctx.fillRect(plotX, y, plotW, metricH)
        if (metric.kind === 'stage') {
          for (let ep = 0; ep < data.nEpochs; ep++) {
            const x1 = plotX + Math.floor((ep * plotW) / data.nEpochs)
            const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.nEpochs)
            ctx.fillStyle = sleepSketchLabels.length
              ? sleepSketchLabelColor((metric.values[ep] ?? 4) as number)
              : stageColor((metric.values[ep] ?? 0) as number)
            ctx.fillRect(x1, y, Math.max(1, x2 - x1), metricH)
          }
        } else if (metric.kind === 'heat') {
          const rawValues = (metric.values ?? []) as ArrayLike<number>
          const finiteValues = Array.from(rawValues).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
          const p10 = finiteValues.length > 0 ? finiteValues[Math.floor((finiteValues.length - 1) * 0.1)] : 4
          const p90 = finiteValues.length > 0 ? finiteValues[Math.floor((finiteValues.length - 1) * 0.9)] : 12
          const lo = Math.min(p10, p90 - 1e-6)
          const hi = Math.max(p90, lo + 1e-6)
          for (let ep = 0; ep < data.nEpochs; ep++) {
            const x1 = plotX + Math.floor((ep * plotW) / data.nEpochs)
            const x2 = plotX + Math.floor(((ep + 1) * plotW) / data.nEpochs)
            const raw = (metric.values?.[ep] ?? 0) as number
            const t = Math.max(0, Math.min(1, (raw - lo) / (hi - lo)))
            ctx.fillStyle = fmdHeatColor(t)
            ctx.fillRect(x1, y, Math.max(1, x2 - x1), metricH)
          }
          ctx.fillStyle = '#334155'
          ctx.font = expanded ? '10px monospace' : '8px monospace'
          ctx.fillText(`${lo.toFixed(1)}-${hi.toFixed(1)} Hz`, plotX + plotW - 82, y + metricH - 2)
        } else {
          const finiteValues = (metric.values ?? []).filter((value) => Number.isFinite(value)) as number[]
          let localMin = finiteValues.length > 0 ? Math.min(...finiteValues) : 0
          let localMax = finiteValues.length > 0 ? Math.max(...finiteValues) : 1
          if (localMax - localMin < 1e-6) {
            const pad = Math.max(0.05, Math.abs(localMax) * 0.1 || 0.1)
            localMin -= pad
            localMax += pad
          } else {
            const pad = (localMax - localMin) * 0.08
            localMin -= pad
            localMax += pad
          }
          const localMid = localMin + (localMax - localMin) * 0.5
          const midT = Math.max(0, Math.min(1, (localMid - localMin) / Math.max(1e-9, localMax - localMin)))
          const midY = y + metricH - 1 - midT * Math.max(1, metricH - 2)
          ctx.strokeStyle = 'rgba(15,23,42,0.18)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(plotX, midY)
          ctx.lineTo(plotX + plotW, midY)
          ctx.stroke()
          ctx.strokeStyle = metric.stroke
          ctx.lineWidth = 1.5
          ctx.beginPath()
          for (let ep = 0; ep < data.nEpochs; ep++) {
            const raw = (metric.values?.[ep] ?? 0) as number
            const t = Math.max(0, Math.min(1, (raw - localMin) / Math.max(1e-9, localMax - localMin)))
            const x = plotX + ((ep + 0.5) / Math.max(data.nEpochs, 1)) * plotW
            const yy = y + metricH - 1 - t * Math.max(1, metricH - 2)
            if (ep === 0) ctx.moveTo(x, yy)
            else ctx.lineTo(x, yy)
          }
          ctx.stroke()
          ctx.fillStyle = '#334155'
          ctx.font = expanded ? '10px monospace' : '8px monospace'
          ctx.fillText(`${localMin.toFixed(2)}-${localMax.toFixed(2)}`, plotX + plotW - 66, y + metricH - 2)
        }
        ctx.strokeStyle = '#111827'
        ctx.strokeRect(plotX, y, plotW, metricH)
        ctx.fillStyle = '#64748b'
        ctx.font = expanded ? '11px monospace' : '9px monospace'
        ctx.fillText(metric.label, 4, y + metricH - 2)
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.fillRect(currentX1, y, currentW, metricH)
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeRect(currentX1, y, currentW, metricH)
      })
    }

    const totalSec = data.nEpochs * data.epochSec
    const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / data.nEpochs)))
    const timeY = metricTop + metricBlockH + 4
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
    ctx.font = expanded ? '13px monospace' : '11px monospace'
    ctx.fillText(`${data.channelName} · ${Math.round(totalSec / 60)} min`, plotX + 6, height - 4)
  }, [artifactEnabled, currentEndSec, currentStartSec, data, error, expanded, loading, selectedViewerAnnotationId, showMetrics, viewerAnnotations])

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
    const triggerAnnH = viewerAnnotations && viewerAnnotations.length > 0 ? 10 : 0
    const artifactH = artifactEnabled ? 12 : 0
    if (viewerAnnotations && viewerAnnotations.length > 0 && y <= triggerAnnH && onViewerAnnotationSelect) {
      const totalSec = data.nEpochs * data.epochSec
      const relAnn = (x - freqW) / plotW
      const targetSec = Math.max(0, Math.min(totalSec, relAnn * totalSec))
      let bestId: string | null = null
      let bestDist = Infinity
      viewerAnnotations.forEach((annotation) => {
        const dist = Math.abs(annotation.onsetSec - targetSec)
        if (dist < bestDist) {
          bestId = annotation.id
          bestDist = dist
        }
      })
      if (bestId) {
        onViewerAnnotationSelect(bestId)
        return
      }
    }
    if (artifactEnabled && y >= triggerAnnH && y <= triggerAnnH + artifactH && data.artifactStatuses.length > 0) {
      const relArtifact = (x - freqW) / plotW
      const clampedArtifact = Math.max(0, Math.min(0.999999, relArtifact))
      onArtifactEpochClick(Math.floor(clampedArtifact * data.artifactStatuses.length))
      return
    }
    const rel = (x - freqW) / plotW
    const clamped = Math.max(0, Math.min(0.999999, rel))
    onEpochClick(Math.floor(clamped * data.nEpochs))
  }, [artifactEnabled, data, onArtifactEpochClick, onEpochClick, onViewerAnnotationSelect, viewerAnnotations])

  return (
    <div
      ref={wrapRef}
      style={{
        flexShrink: 0,
        height: expanded ? 480 : 230,
        background: '#ffffff',
        borderTop: expanded ? 'none' : '1px solid #e2e8f0',
        padding: expanded ? '0.7rem 0.8rem 0.8rem 0.8rem' : '0.35rem 0.5rem 0.4rem 0.5rem',
        position: 'relative',
      }}
    >
      {(onToggleExpand || onShowHypnogram || onShowSleepAnalyzer || onShowStateSpectra) && (
        <div
          style={{
            position: 'absolute',
            top: expanded ? 10 : 8,
            right: expanded ? 12 : 8,
            zIndex: 2,
            display: 'flex',
            gap: 6,
          }}
        >
          {onShowHypnogram && (
            <button
              type="button"
              onClick={onShowHypnogram}
              style={{
                border: '1px solid #cbd5e1',
                background: 'rgba(255,255,255,0.92)',
                color: '#0f172a',
                borderRadius: 6,
                padding: expanded ? '0.35rem 0.55rem' : '0.2rem 0.45rem',
                fontSize: expanded ? '0.8rem' : '0.72rem',
                cursor: 'pointer',
              }}
            >
              Hipnograma
            </button>
          )}
          {onShowSleepAnalyzer && (
            <button
              type="button"
              onClick={onShowSleepAnalyzer}
              style={{
                border: '1px solid #cbd5e1',
                background: 'rgba(255,255,255,0.92)',
                color: '#0f172a',
                borderRadius: 6,
                padding: expanded ? '0.35rem 0.55rem' : '0.2rem 0.45rem',
                fontSize: expanded ? '0.8rem' : '0.72rem',
                cursor: 'pointer',
              }}
            >
              Analizador sueño
            </button>
          )}
          {onShowStateSpectra && (
            <button
              type="button"
              onClick={onShowStateSpectra}
              style={{
                border: '1px solid #cbd5e1',
                background: 'rgba(255,255,255,0.92)',
                color: '#0f172a',
                borderRadius: 6,
                padding: expanded ? '0.35rem 0.55rem' : '0.2rem 0.45rem',
                fontSize: expanded ? '0.8rem' : '0.72rem',
                cursor: 'pointer',
              }}
            >
              Espectros
            </button>
          )}
          {onToggleExpand && (
            <button
              type="button"
              onClick={onToggleExpand}
              style={{
                border: '1px solid #cbd5e1',
                background: 'rgba(255,255,255,0.92)',
                color: '#0f172a',
                borderRadius: 6,
                padding: expanded ? '0.35rem 0.55rem' : '0.2rem 0.45rem',
                fontSize: expanded ? '0.8rem' : '0.72rem',
                cursor: 'pointer',
              }}
            >
              {expanded ? 'Cerrar DSA' : 'Ampliar DSA'}
            </button>
          )}
        </div>
      )}
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', height: '100%', cursor: data ? 'pointer' : 'default' }}
      />
    </div>
  )
}

function HypnogramModal({
  dsaData,
  sleepSketchData,
  onClose,
}: {
  dsaData: DSAData | null
  sleepSketchData: SleepSketchTimelineData | null
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !dsaData) return

    const sleepSketchLabels = getSleepSketchStageLabels(sleepSketchData)
    const labels = sleepSketchLabels.length
      ? remapEpochValues(sleepSketchLabels, dsaData.nEpochs)
      : dsaData.stages
    const width = Math.max(900, wrap.clientWidth || 900)
    const height = 240
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf4'
    ctx.fillRect(0, 0, width, height)

    const counts = labels.reduce<Record<number, number>>((acc, label) => {
      acc[label] = (acc[label] ?? 0) + 1
      return acc
    }, {})

    const marginLeft = 72
    const marginRight = 16
    const top = 56
    const laneH = 112
    const plotW = width - marginLeft - marginRight
    const plotX = marginLeft

    const yForLabel = (label: number) => {
      if (label === 0) return top + laneH * 0.15
      if (label === 1) return top + laneH * 0.40
      if (label === 2) return top + laneH * 0.65
      if (label === 3) return top + laneH * 0.90
      return top + laneH * 0.98
    }

    ctx.strokeStyle = '#cbd5e1'
    ctx.lineWidth = 1
    ;[
      ['W', yForLabel(0)],
      ['N1', yForLabel(1)],
      ['N2', yForLabel(2)],
      ['N3', yForLabel(3)],
      ['?', yForLabel(4)],
    ].forEach(([label, y]) => {
      ctx.beginPath()
      ctx.moveTo(plotX, y as number)
      ctx.lineTo(plotX + plotW, y as number)
      ctx.stroke()
      ctx.fillStyle = '#334155'
      ctx.font = '12px monospace'
      ctx.fillText(label as string, 18, (y as number) + 4)
    })

    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    labels.forEach((label, epochIndex) => {
      const x = plotX + ((epochIndex + 0.5) / Math.max(labels.length, 1)) * plotW
      const y = yForLabel(label ?? 4)
      if (epochIndex === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()

    labels.forEach((label, epochIndex) => {
      const x = plotX + ((epochIndex + 0.5) / Math.max(labels.length, 1)) * plotW
      const y = yForLabel(label ?? 4)
      ctx.fillStyle = sleepSketchLabelColor(label ?? 4)
      ctx.fillRect(x - 5, y - 5, 10, 10)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 0.6
      ctx.strokeRect(x - 5, y - 5, 10, 10)
    })

    ctx.fillStyle = '#0f172a'
    ctx.font = 'bold 14px monospace'
    ctx.fillText(`${dsaData.channelName} · Hyp`, 16, 24)
    ctx.font = '12px monospace'
    ctx.fillText(
      `W ${counts[0] ?? 0} · N1 ${counts[1] ?? 0} · N2 ${counts[2] ?? 0} · N3 ${counts[3] ?? 0} · ? ${counts[4] ?? 0}`,
      16,
      42,
    )

    const totalSec = dsaData.nEpochs * dsaData.epochSec
    const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / dsaData.nEpochs)))
    const axisY = top + laneH + 26
    ctx.strokeStyle = '#111827'
    ctx.beginPath()
    ctx.moveTo(plotX, axisY)
    ctx.lineTo(plotX + plotW, axisY)
    ctx.stroke()
    ctx.fillStyle = '#475569'
    ctx.font = '11px monospace'
    for (let ep = 0; ep < dsaData.nEpochs; ep += tickEvery) {
      const x = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
      ctx.beginPath()
      ctx.moveTo(x, axisY)
      ctx.lineTo(x, axisY + 5)
      ctx.stroke()
      const tSec = ep * dsaData.epochSec
      const minutes = Math.floor(tSec / 60)
      const seconds = Math.floor(tSec % 60)
      ctx.fillText(`${minutes}:${pad2(seconds)}`, x + 2, axisY + 16)
    }
    ctx.fillStyle = '#64748b'
    ctx.fillText(`${Math.round(totalSec / 60)} min`, plotX + plotW - 54, height - 10)
  }, [dsaData, sleepSketchData])

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(96vw, 1400px)',
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 30px 80px rgba(15,23,42,0.35)',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.85rem 1rem',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ fontWeight: 700, color: '#0f172a' }}>Hipnograma heurístico</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 6,
              padding: '0.3rem 0.55rem',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
        <div ref={wrapRef} style={{ padding: '1rem', background: '#fffdf4' }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
        </div>
      </div>
    </div>
  )
}

function SleepAnalyzerModal({
  dsaData,
  sleepSketchData,
  qeegGlobalTimeseries,
  stateSpectralData,
  assumeSleepPresent,
  onAssumeSleepPresentChange,
  artifactEnabled,
  dsaLoading,
  sleepSketchLoading,
  dsaError,
  currentStartSec,
  currentEndSec,
  viewerAnnotations,
  selectedViewerAnnotationId,
  onClose,
  onEpochClick,
  onArtifactEpochClick,
  onViewerAnnotationSelect,
}: {
  dsaData: DSAData | null
  sleepSketchData: SleepSketchTimelineData | null
  qeegGlobalTimeseries: QeegGlobalTimeseriesData | null
  stateSpectralData: StateSpectralTimelineData | null
  assumeSleepPresent: boolean
  onAssumeSleepPresentChange: (next: boolean) => void
  artifactEnabled: boolean
  dsaLoading: boolean
  sleepSketchLoading: boolean
  dsaError: string
  currentStartSec: number
  currentEndSec: number
  viewerAnnotations?: ViewerAnnotation[]
  selectedViewerAnnotationId?: string | null
  onClose: () => void
  onEpochClick: (epochIndex: number) => void
  onArtifactEpochClick: (epochIndex: number) => void
  onViewerAnnotationSelect?: (annotationId: string) => void
}) {
  const fmdCanvasRef = useRef<HTMLCanvasElement>(null)
  const hypCanvasRef = useRef<HTMLCanvasElement>(null)
  const stateCanvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const redraw = useCallback(() => {
    const wrap = wrapRef.current
    const fmdCanvas = fmdCanvasRef.current
    const hypCanvas = hypCanvasRef.current
    const stateCanvas = stateCanvasRef.current
    if (!wrap || !fmdCanvas || !hypCanvas || !stateCanvas || !dsaData) return

    const width = Math.max(980, wrap.clientWidth || 980)
    const plotX = 72
    const plotW = width - plotX - 18
    const totalSec = dsaData.nEpochs * dsaData.epochSec
    const sleepSketchLabels = getSleepSketchStageLabels(sleepSketchData)
    const labels = sleepSketchLabels.length
      ? remapEpochValues(sleepSketchLabels, dsaData.nEpochs)
      : dsaData.stages
    const fmdValues = remapEpochValues(sleepSketchData?.fmd4to12, dsaData.nEpochs)
    const counts = labels.reduce<Record<number, number>>((acc, label) => {
      acc[label] = (acc[label] ?? 0) + 1
      return acc
    }, {})

    {
      const height = 230
      fmdCanvas.width = width
      fmdCanvas.height = height
      const ctx = fmdCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fffdf4'
        ctx.fillRect(0, 0, width, height)

        const qeegTimes = qeegGlobalTimeseries?.time_sec ?? []
        const qeegFmd = qeegGlobalTimeseries?.fmd4to12 ?? []
        const qeegSigmaBeta = qeegGlobalTimeseries?.sigma_beta_ratio ?? []
        const qeegDelta = qeegGlobalTimeseries?.delta_0p5to4 ?? []
        const hasQeegFmd = qeegTimes.length > 1 && qeegFmd.length === qeegTimes.length
        const finiteFmd = (hasQeegFmd ? qeegFmd : fmdValues).filter((value) => Number.isFinite(value))
        const hasQeegSigmaBeta = hasQeegFmd && qeegSigmaBeta.length === qeegTimes.length
        const hasQeegDelta = hasQeegFmd && qeegDelta.length === qeegTimes.length
        let fmdMin = finiteFmd.length ? Math.min(...finiteFmd) : 4
        let fmdMax = finiteFmd.length ? Math.max(...finiteFmd) : 12
        if (fmdMax - fmdMin < 1e-6) {
          fmdMin -= 0.5
          fmdMax += 0.5
        } else {
          const pad = (fmdMax - fmdMin) * 0.08
          fmdMin -= pad
          fmdMax += pad
        }
        const finiteSigmaBeta = hasQeegSigmaBeta ? qeegSigmaBeta.filter((value) => Number.isFinite(value)) : []
        const finiteDelta = hasQeegDelta ? qeegDelta.filter((value) => Number.isFinite(value)) : []
        let sigmaMin = finiteSigmaBeta.length ? Math.min(...finiteSigmaBeta) : 0
        let sigmaMax = finiteSigmaBeta.length ? Math.max(...finiteSigmaBeta) : 1
        if (sigmaMax - sigmaMin < 1e-12) {
          sigmaMin = Math.max(0, sigmaMin - 0.5)
          sigmaMax += 0.5
        } else {
          const pad = (sigmaMax - sigmaMin) * 0.08
          sigmaMin = Math.max(0, sigmaMin - pad)
          sigmaMax += pad
        }
        let deltaMin = finiteDelta.length ? Math.min(...finiteDelta) : 0
        let deltaMax = finiteDelta.length ? Math.max(...finiteDelta) : 1
        if (deltaMax - deltaMin < 1e-12) {
          deltaMin = Math.max(0, deltaMin - 0.5)
          deltaMax += 0.5
        } else {
          const pad = (deltaMax - deltaMin) * 0.08
          deltaMin = Math.max(0, deltaMin - pad)
          deltaMax += pad
        }

        const top = 34
        const bottomPad = 34
        const stageBandH = 12
        const laneTop = top + stageBandH + 8
        const laneH = height - laneTop - bottomPad

        for (let ep = 0; ep < dsaData.nEpochs; ep++) {
          const x1 = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
          const x2 = plotX + Math.floor(((ep + 1) * plotW) / dsaData.nEpochs)
          ctx.fillStyle = sleepSketchLabelColor(labels[ep] ?? 4)
          ctx.globalAlpha = 0.9
          ctx.fillRect(x1, top, Math.max(1, x2 - x1), stageBandH)
        }
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#cbd5e1'
        ctx.strokeRect(plotX, top, plotW, stageBandH)

        const gridTicks = 5
        for (let i = 0; i <= gridTicks; i++) {
          const t = i / gridTicks
          const y = laneTop + laneH - t * laneH
          ctx.strokeStyle = i === 0 ? '#94a3b8' : '#e2e8f0'
          ctx.lineWidth = i === 0 ? 1.2 : 1
          ctx.beginPath()
          ctx.moveTo(plotX, y)
          ctx.lineTo(plotX + plotW, y)
          ctx.stroke()
          const value = fmdMin + t * (fmdMax - fmdMin)
          ctx.fillStyle = '#64748b'
          ctx.font = '10px monospace'
          ctx.fillText(value.toFixed(1), 18, y + 3)
          if (hasQeegSigmaBeta) {
            const sigmaValue = sigmaMin + t * (sigmaMax - sigmaMin)
            ctx.fillStyle = '#1d4ed8'
            ctx.fillText(sigmaValue.toFixed(2), plotX + plotW + 6, y + 3)
          }
          if (hasQeegDelta) {
            const deltaValue = deltaMin + t * (deltaMax - deltaMin)
            ctx.fillStyle = '#b91c1c'
            ctx.fillText(deltaValue.toFixed(2), plotX + plotW + 54, y + 3)
          }
        }

        ctx.strokeStyle = '#94a3b8'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(plotX, laneTop)
        ctx.lineTo(plotX, laneTop + laneH)
        ctx.lineTo(plotX + plotW, laneTop + laneH)
        ctx.stroke()

        const medianFmd = finiteFmd.length
          ? finiteFmd.slice().sort((a, b) => a - b)[Math.floor(finiteFmd.length * 0.5)]
          : null
        if (medianFmd !== null) {
          const t = (medianFmd - fmdMin) / Math.max(1e-6, fmdMax - fmdMin)
          const y = laneTop + laneH - 1 - t * Math.max(1, laneH - 2)
          ctx.strokeStyle = 'rgba(15,23,42,0.20)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(plotX, y)
          ctx.lineTo(plotX + plotW, y)
          ctx.stroke()
          ctx.fillStyle = '#334155'
          ctx.font = '10px monospace'
          ctx.fillText(`med ${medianFmd.toFixed(2)} Hz`, plotX + plotW - 90, y - 4)
        }

        if (fmdValues.length > 0) {
          const sourceValues = hasQeegFmd ? qeegFmd : fmdValues
          const smoothedValues = sourceValues.map((_, ep) => {
            let sum = 0
            let count = 0
            for (let j = Math.max(0, ep - 2); j <= Math.min(sourceValues.length - 1, ep + 2); j++) {
              const value = sourceValues[j]
              if (Number.isFinite(value)) {
                sum += value
                count += 1
              }
            }
            return count > 0 ? sum / count : sourceValues[ep]
          })

          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = 2.3
          ctx.beginPath()
          sourceValues.forEach((value, ep) => {
            const tSec = hasQeegFmd ? Number(qeegTimes[ep] ?? 0) : (ep + 0.5) * dsaData.epochSec
            const x = plotX + (Math.max(0, Math.min(totalSec, tSec)) / Math.max(totalSec, 1e-6)) * plotW
            const t = Math.max(0, Math.min(1, ((value ?? fmdMin) - fmdMin) / Math.max(1e-6, fmdMax - fmdMin)))
            const y = laneTop + laneH - 1 - t * Math.max(1, laneH - 2)
            if (ep === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()

          ctx.strokeStyle = 'rgba(148,163,184,0.95)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          smoothedValues.forEach((value, ep) => {
            const tSec = hasQeegFmd ? Number(qeegTimes[ep] ?? 0) : (ep + 0.5) * dsaData.epochSec
            const x = plotX + (Math.max(0, Math.min(totalSec, tSec)) / Math.max(totalSec, 1e-6)) * plotW
            const t = Math.max(0, Math.min(1, ((value ?? fmdMin) - fmdMin) / Math.max(1e-6, fmdMax - fmdMin)))
            const y = laneTop + laneH - 1 - t * Math.max(1, laneH - 2)
            if (ep === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          })
          ctx.stroke()

          if (hasQeegSigmaBeta) {
            const smoothedSigmaBeta = qeegSigmaBeta.map((_, ep) => {
              let sum = 0
              let count = 0
              for (let j = Math.max(0, ep - 2); j <= Math.min(qeegSigmaBeta.length - 1, ep + 2); j++) {
                const value = qeegSigmaBeta[j]
                if (Number.isFinite(value)) {
                  sum += value
                  count += 1
                }
              }
              return count > 0 ? sum / count : qeegSigmaBeta[ep]
            })
            ctx.strokeStyle = 'rgba(37,99,235,0.38)'
            ctx.lineWidth = 1.8
            ctx.beginPath()
            smoothedSigmaBeta.forEach((value, ep) => {
              const tSec = Number(qeegTimes[ep] ?? 0)
              const x = plotX + (Math.max(0, Math.min(totalSec, tSec)) / Math.max(totalSec, 1e-6)) * plotW
              const t = Math.max(0, Math.min(1, ((value ?? sigmaMin) - sigmaMin) / Math.max(1e-12, sigmaMax - sigmaMin)))
              const y = laneTop + laneH - 1 - t * Math.max(1, laneH - 2)
              if (ep === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            })
            ctx.stroke()
          }
          if (hasQeegDelta) {
            const smoothedDelta = qeegDelta.map((_, ep) => {
              let sum = 0
              let count = 0
              for (let j = Math.max(0, ep - 2); j <= Math.min(qeegDelta.length - 1, ep + 2); j++) {
                const value = qeegDelta[j]
                if (Number.isFinite(value)) {
                  sum += value
                  count += 1
                }
              }
              return count > 0 ? sum / count : qeegDelta[ep]
            })
            ctx.strokeStyle = 'rgba(220,38,38,0.28)'
            ctx.lineWidth = 1.8
            ctx.beginPath()
            smoothedDelta.forEach((value, ep) => {
              const tSec = Number(qeegTimes[ep] ?? 0)
              const x = plotX + (Math.max(0, Math.min(totalSec, tSec)) / Math.max(totalSec, 1e-6)) * plotW
              const t = Math.max(0, Math.min(1, ((value ?? deltaMin) - deltaMin) / Math.max(1e-12, deltaMax - deltaMin)))
              const y = laneTop + laneH - 1 - t * Math.max(1, laneH - 2)
              if (ep === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            })
            ctx.stroke()
          }
        }

        ctx.fillStyle = '#0f172a'
        ctx.font = 'bold 13px monospace'
        ctx.fillText('FMD 4-12', 16, 20)
        ctx.font = '11px monospace'
        ctx.fillText(hasQeegFmd ? 'qEEG global · negro = cruda · gris = suavizada · azul = sigma/beta · rojo = delta' : 'SleepSketch · negro = cruda · gris = suavizada', plotX, 20)
        ctx.fillText(`${fmdMin.toFixed(2)}-${fmdMax.toFixed(2)} Hz`, 16, height - 12)
        if (hasQeegSigmaBeta) {
          ctx.fillStyle = '#1d4ed8'
          ctx.fillText(`σ/β ${sigmaMin.toFixed(2)}-${sigmaMax.toFixed(2)}`, plotX + plotW - 116, height - 12)
        }
        if (hasQeegDelta) {
          ctx.fillStyle = '#b91c1c'
          ctx.fillText(`δ ${deltaMin.toFixed(2)}-${deltaMax.toFixed(2)}`, plotX + plotW - 200, height - 12)
        }

        const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / dsaData.nEpochs)))
        const axisY = laneTop + laneH + 10
        ctx.strokeStyle = '#111827'
        ctx.beginPath()
        ctx.moveTo(plotX, axisY)
        ctx.lineTo(plotX + plotW, axisY)
        ctx.stroke()
        ctx.fillStyle = '#475569'
        ctx.font = '11px monospace'
        for (let ep = 0; ep < dsaData.nEpochs; ep += tickEvery) {
          const x = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
          ctx.beginPath()
          ctx.moveTo(x, axisY)
          ctx.lineTo(x, axisY + 5)
          ctx.stroke()
          const tSec = ep * dsaData.epochSec
          const minutes = Math.floor(tSec / 60)
          const seconds = Math.floor(tSec % 60)
          ctx.fillText(`${minutes}:${pad2(seconds)}`, x + 2, axisY + 16)
        }
        ctx.fillStyle = '#64748b'
        ctx.fillText(`${Math.round(totalSec / 60)} min`, plotX + plotW - 54, height - 12)
      }
    }

    {
      const height = 244
      hypCanvas.width = width
      hypCanvas.height = height
      const ctx = hypCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fffdf4'
        ctx.fillRect(0, 0, width, height)

        const top = 56
        const laneH = 112

        const yForLabel = (label: number) => {
          if (label === 0) return top + laneH * 0.15
          if (label === 1) return top + laneH * 0.40
          if (label === 2) return top + laneH * 0.65
          if (label === 3) return top + laneH * 0.90
          return top + laneH * 0.98
        }

        ctx.strokeStyle = '#cbd5e1'
        ctx.lineWidth = 1
        ;[
          ['W', yForLabel(0)],
          ['N1', yForLabel(1)],
          ['N2', yForLabel(2)],
          ['N3', yForLabel(3)],
          ['?', yForLabel(4)],
        ].forEach(([label, y]) => {
          ctx.beginPath()
          ctx.moveTo(plotX, y as number)
          ctx.lineTo(plotX + plotW, y as number)
          ctx.stroke()
          ctx.fillStyle = '#334155'
          ctx.font = '12px monospace'
          ctx.fillText(label as string, 18, (y as number) + 4)
        })

        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        labels.forEach((label, epochIndex) => {
          const x = plotX + ((epochIndex + 0.5) / Math.max(labels.length, 1)) * plotW
          const y = yForLabel(label ?? 4)
          if (epochIndex === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()

        labels.forEach((label, epochIndex) => {
          const x = plotX + ((epochIndex + 0.5) / Math.max(labels.length, 1)) * plotW
          const y = yForLabel(label ?? 4)
          ctx.fillStyle = sleepSketchLabelColor(label ?? 4)
          ctx.fillRect(x - 5, y - 5, 10, 10)
          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = 0.6
          ctx.strokeRect(x - 5, y - 5, 10, 10)
        })

        ctx.fillStyle = '#0f172a'
        ctx.font = 'bold 14px monospace'
        ctx.fillText(`${dsaData.channelName} · Hyp`, 16, 24)
        ctx.font = '12px monospace'
        ctx.fillText(
          `W ${counts[0] ?? 0} · N1 ${counts[1] ?? 0} · N2 ${counts[2] ?? 0} · N3 ${counts[3] ?? 0} · ? ${counts[4] ?? 0}`,
          16,
          42,
        )

        const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / dsaData.nEpochs)))
        const axisY = top + laneH + 26
        ctx.strokeStyle = '#111827'
        ctx.beginPath()
        ctx.moveTo(plotX, axisY)
        ctx.lineTo(plotX + plotW, axisY)
        ctx.stroke()
        ctx.fillStyle = '#475569'
        ctx.font = '11px monospace'
        for (let ep = 0; ep < dsaData.nEpochs; ep += tickEvery) {
          const x = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
          ctx.beginPath()
          ctx.moveTo(x, axisY)
          ctx.lineTo(x, axisY + 5)
          ctx.stroke()
          const tSec = ep * dsaData.epochSec
          const minutes = Math.floor(tSec / 60)
          const seconds = Math.floor(tSec % 60)
          ctx.fillText(`${minutes}:${pad2(seconds)}`, x + 2, axisY + 16)
        }
        ctx.fillStyle = '#64748b'
        ctx.fillText(`${Math.round(totalSec / 60)} min`, plotX + plotW - 54, height - 10)
      }
    }

    {
      const height = 186
      stateCanvas.width = width
      stateCanvas.height = height
      const ctx = stateCanvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#fffdf4'
        ctx.fillRect(0, 0, width, height)

        const top = 56
        const laneH = 70
        const timelineLabels = remapEpochValues(stateSpectralData?.labels, dsaData.nEpochs)
        const counts = timelineLabels.reduce<Record<number, number>>((acc, label) => {
          acc[label] = (acc[label] ?? 0) + 1
          return acc
        }, {})

        for (let ep = 0; ep < dsaData.nEpochs; ep++) {
          const x1 = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
          const x2 = plotX + Math.floor(((ep + 1) * plotW) / dsaData.nEpochs)
          const label = timelineLabels[ep] ?? 0
          ctx.fillStyle = stateSpectralLabelColor(label)
          ctx.globalAlpha = 0.82
          ctx.fillRect(x1, top, Math.max(1, x2 - x1), laneH)
        }
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#0f172a'
        ctx.strokeRect(plotX, top, plotW, laneH)

        ctx.fillStyle = '#0f172a'
        ctx.font = 'bold 14px monospace'
        ctx.fillText('Estados OA/OC/Sueño', 16, 24)
        ctx.font = '12px monospace'
        ctx.fillText(
          `OA ${counts[1] ?? 0} · OC ${counts[2] ?? 0} · N1 ${counts[3] ?? 0} · N2 ${counts[4] ?? 0} · N3 ${counts[5] ?? 0} · ? ${counts[0] ?? 0}`,
          16,
          42,
        )

        ctx.font = '11px monospace'
        ctx.fillStyle = '#475569'
        if (stateSpectralData?.blinkScore?.length) {
          const blinkValues = Array.from(stateSpectralData.blinkScore)
          const blinkMean = blinkValues.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / Math.max(1, blinkValues.length)
          ctx.fillText(
            `blink soporte ${blinkMean.toFixed(2)} · umbral ${stateSpectralData.blinkSupportThreshold.toFixed(2)}`,
            plotX,
            height - 30,
          )
        }
        if (stateSpectralData && Number.isFinite(stateSpectralData.ocMedianFmd) && Number.isFinite(stateSpectralData.sleepFmdThreshold)) {
          ctx.fillText(
            `OC FMD med ${stateSpectralData.ocMedianFmd.toFixed(2)} · sueño < ${stateSpectralData.sleepFmdThreshold.toFixed(2)} Hz`,
            plotX,
            height - 14,
          )
        }

        const axisY = top + laneH + 18
        const tickEvery = Math.max(1, Math.ceil(70 / Math.max(1, plotW / dsaData.nEpochs)))
        ctx.strokeStyle = '#111827'
        ctx.beginPath()
        ctx.moveTo(plotX, axisY)
        ctx.lineTo(plotX + plotW, axisY)
        ctx.stroke()
        for (let ep = 0; ep < dsaData.nEpochs; ep += tickEvery) {
          const x = plotX + Math.floor((ep * plotW) / dsaData.nEpochs)
          ctx.beginPath()
          ctx.moveTo(x, axisY)
          ctx.lineTo(x, axisY + 5)
          ctx.stroke()
          const tSec = ep * dsaData.epochSec
          const minutes = Math.floor(tSec / 60)
          const seconds = Math.floor(tSec % 60)
          ctx.fillText(`${minutes}:${pad2(seconds)}`, x + 2, axisY + 16)
        }
      }
    }

  }, [artifactEnabled, currentEndSec, currentStartSec, dsaData, dsaError, dsaLoading, onArtifactEpochClick, onEpochClick, onViewerAnnotationSelect, selectedViewerAnnotationId, sleepSketchData, sleepSketchLoading, stateSpectralData, viewerAnnotations])

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1350,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.2rem',
      }}
      onClick={onClose}
    >
      <div
        ref={wrapRef}
        style={{
          width: 'min(96vw, 1600px)',
          maxHeight: '92vh',
          overflow: 'auto',
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 30px 80px rgba(15,23,42,0.35)',
          padding: '0.85rem',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
          <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.98rem' }}>Analizador de sueño</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: '#334155',
                fontSize: '0.8rem',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={assumeSleepPresent}
                onChange={(event) => onAssumeSleepPresentChange(event.target.checked)}
              />
              Asumir que hay sueño
            </label>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                borderRadius: 6,
                padding: '0.32rem 0.62rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Cerrar
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              background: '#ffffff',
              padding: '0.65rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}
          >
            <LegendRow
              title="Leyenda común"
              items={[
                { label: 'W', color: sleepSketchLabelColor(0), border: '1px solid #94a3b8' },
                { label: 'OA', color: stateSpectralLabelColor(1) },
                { label: 'OC', color: stateSpectralLabelColor(2) },
                { label: 'N1', color: stateSpectralLabelColor(3) },
                { label: 'N2', color: stateSpectralLabelColor(4) },
                { label: 'N3', color: stateSpectralLabelColor(5) },
                { label: 'Artefacto', color: stateSpectralLabelColor(6) },
                { label: '?', color: stateSpectralLabelColor(0) },
              ]}
            />
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            <DSAHeatmap
              data={dsaData}
              sleepSketchData={sleepSketchData}
              loading={dsaLoading || sleepSketchLoading}
              expanded
              artifactEnabled={artifactEnabled}
              showMetrics={false}
              error={dsaError}
              currentStartSec={currentStartSec}
              currentEndSec={currentEndSec}
              viewerAnnotations={viewerAnnotations}
              selectedViewerAnnotationId={selectedViewerAnnotationId}
              onEpochClick={onEpochClick}
              onArtifactEpochClick={onArtifactEpochClick}
              onViewerAnnotationSelect={onViewerAnnotationSelect}
            />
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fffdf4' }}>
            <canvas ref={fmdCanvasRef} style={{ display: 'block', width: '100%' }} />
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fffdf4' }}>
            <canvas ref={hypCanvasRef} style={{ display: 'block', width: '100%' }} />
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fffdf4' }}>
            <canvas ref={stateCanvasRef} style={{ display: 'block', width: '100%' }} />
          </div>

        </div>
      </div>
    </div>
  )
}

function StateSpectraModal({
  stateSpectralPanels,
  onClose,
}: {
  stateSpectralPanels: StateSpectralPanelData | null
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [selectedStateIndex, setSelectedStateIndex] = useState(0)
  const [showAperiodicFit, setShowAperiodicFit] = useState(true)
  const [showLogFreqAxis, setShowLogFreqAxis] = useState(true)
  const [showLogPowerAxis, setShowLogPowerAxis] = useState(true)
  const [showGlobalOverlay, setShowGlobalOverlay] = useState(true)
  const [showHemispheres, setShowHemispheres] = useState(false)

  const redraw = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const width = Math.max(980, wrap.clientWidth || 980)
    const height = 380
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf4'
    ctx.fillRect(0, 0, width, height)

    const panels = stateSpectralPanels
    const freqArray = panels?.freqs ? Array.from(panels.freqs) : []
    const stateCount = panels?.stateNames?.length ?? 0
    const selected = stateCount > 0 ? Math.max(0, Math.min(selectedStateIndex, stateCount - 1)) : -1
    const raw = selected >= 0 ? Array.from(panels?.rawSpectra?.[selected] ?? []) : []
    const flat = selected >= 0 ? Array.from(panels?.flatSpectra?.[selected] ?? []) : []
    const rawLeft = selected >= 0 ? Array.from(panels?.rawSpectraLeft?.[selected] ?? []) : []
    const rawRight = selected >= 0 ? Array.from(panels?.rawSpectraRight?.[selected] ?? []) : []
    const flatLeft = selected >= 0 ? Array.from(panels?.flatSpectraLeft?.[selected] ?? []) : []
    const flatRight = selected >= 0 ? Array.from(panels?.flatSpectraRight?.[selected] ?? []) : []
    const epochCounts = Array.from(panels?.epochCounts ?? [])
    const totalStateEpochs = epochCounts.reduce((sum, value) => sum + Number(value ?? 0), 0)
    const activeStateCount = epochCounts.filter((value) => Number(value ?? 0) > 0).length
    const selectedEpochs = selected >= 0 ? Number(panels!.epochCounts[selected] ?? 0) : 0
    const selectedPct = totalStateEpochs > 0 ? (100 * selectedEpochs) / totalStateEpochs : 0
    const leftX = 24
    const top = 32
    const gap = 28
    const panelW = Math.floor((width - leftX * 2 - gap) / 2)
    const panelH = 180
    const rightX = leftX + panelW + gap
    const fMin = 0.5
    const fMax = 20
    const xForFreq = (f: number, x0: number) => {
      if (showLogFreqAxis) {
        const lo = Math.log10(fMin)
        const hi = Math.log10(fMax)
        const xx = (Math.log10(Math.max(fMin, f)) - lo) / Math.max(1e-6, hi - lo)
        return x0 + xx * panelW
      }
      return x0 + ((f - fMin) / (fMax - fMin)) * panelW
    }
    const transformPower = (rawValue: number) => (
      showLogPowerAxis
        ? Math.log10(Math.max(1e-9, rawValue) + 1e-6) + 6
        : rawValue
    )
    const buildSharedRange = (allSeries: Float32Array[] | undefined) => {
      let yMin = Number.POSITIVE_INFINITY
      let yMax = Number.NEGATIVE_INFINITY
      let nValid = 0
      for (const seriesLike of allSeries ?? []) {
        const series = Array.from(seriesLike ?? [])
        for (let i = 0; i < series.length && i < freqArray.length; i++) {
          const f = freqArray[i]
          if (f < fMin || f > fMax) continue
          const rawValue = Number(series[i] ?? 0)
          if (!(rawValue > 0)) continue
          const value = transformPower(rawValue)
          yMin = Math.min(yMin, value)
          yMax = Math.max(yMax, value)
          nValid += 1
        }
      }
      if (nValid === 0 || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return null
      let yRange = yMax - yMin
      if (!Number.isFinite(yRange) || yRange < 1e-3) yRange = Math.max(0.25, Math.abs(yMax) * 0.2)
      const yPad = yRange * 0.08
      const yLo = yMin - yPad
      const yHi = yMax + yPad
      return { yLo, yHi, ySpan: Math.max(1e-6, yHi - yLo) }
    }
    const rawSharedRange = buildSharedRange(panels?.rawSpectra)
    const flatSharedRange = buildSharedRange(panels?.flatSpectra)
    const rawHemisphereRange = buildSharedRange([...(panels?.rawSpectraLeft ?? []), ...(panels?.rawSpectraRight ?? [])])
    const flatHemisphereRange = buildSharedRange([...(panels?.flatSpectraLeft ?? []), ...(panels?.flatSpectraRight ?? [])])
    const buildGlobalSeries = (allSeries: Float32Array[] | undefined) => {
      if (!allSeries || allSeries.length === 0) return [] as number[]
      const maxLen = Math.max(...allSeries.map((series) => series?.length ?? 0), 0)
      if (maxLen <= 0) return [] as number[]
      const out = new Array<number>(maxLen).fill(0)
      const weight = new Array<number>(maxLen).fill(0)
      allSeries.forEach((seriesLike, seriesIndex) => {
        const series = Array.from(seriesLike ?? [])
        const epochWeight = Math.max(0, Number(epochCounts[seriesIndex] ?? 0))
        if (epochWeight <= 0) return
        for (let i = 0; i < series.length; i++) {
          const v = Number(series[i] ?? 0)
          if (!(v > 0)) continue
          out[i] += v * epochWeight
          weight[i] += epochWeight
        }
      })
      return out.map((v, i) => (weight[i] > 0 ? v / weight[i] : 0))
    }
    const globalRaw = buildGlobalSeries(panels?.rawSpectra)
    const globalFlat = buildGlobalSeries(panels?.flatSpectra)

    const drawSpectrum = (
      series: number[],
      title: string,
      x0: number,
      color: string,
      markers: Array<{ freq: number; label: string; color: string }>,
      sharedRange: { yLo: number; yHi: number; ySpan: number } | null,
      globalSeries: number[] | null,
      hemisphereSeries?: Array<{ series: number[]; color: string; label: string }>,
      aperiodicFit?: { slope: number; intercept: number } | null,
    ) => {
      ctx.strokeStyle = '#cbd5e1'
      ctx.strokeRect(x0, top, panelW, panelH)
      ctx.fillStyle = '#334155'
      ctx.font = '12px monospace'
      ctx.fillText(title, x0 + 8, top - 8)
      const hasHemisphereData = (hemisphereSeries ?? []).some((entry) => (entry.series?.length ?? 0) > 0)
      if ((series.length === 0 && !hasHemisphereData) || freqArray.length === 0) return
      let yMin = Number.POSITIVE_INFINITY
      let yMax = Number.NEGATIVE_INFINITY
      let nValid = 0
      const transformed: number[] = []
      for (let i = 0; i < series.length && i < freqArray.length; i++) {
        if (freqArray[i] < fMin || freqArray[i] > fMax) continue
        const rawValue = Number(series[i] ?? 0)
        const value = transformPower(rawValue)
        transformed.push(value)
        yMin = Math.min(yMin, value)
        yMax = Math.max(yMax, value)
        if (rawValue > 0) nValid += 1
      }
      if (nValid === 0 && !hasHemisphereData) {
        ctx.fillStyle = '#94a3b8'
        ctx.font = '11px monospace'
        ctx.fillText('sin espectro util', x0 + 12, top + 22)
        return
      }
      const yLo = sharedRange?.yLo ?? yMin
      const yHi = sharedRange?.yHi ?? yMax
      const ySpan = sharedRange?.ySpan ?? Math.max(1e-6, yHi - yLo)

      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, top + panelH)
      ctx.lineTo(x0 + panelW, top + panelH)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x0, top)
      ctx.lineTo(x0, top + panelH)
      ctx.stroke()

      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      const xTicks = showLogFreqAxis ? [0.5, 1, 2, 4, 8, 10, 12, 16, 20] : [2, 4, 8, 10, 12, 16, 20]
      for (const tick of xTicks) {
        const x = xForFreq(tick, x0)
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + panelH)
        ctx.stroke()
        ctx.strokeStyle = '#94a3b8'
        ctx.beginPath()
        ctx.moveTo(x, top + panelH)
        ctx.lineTo(x, top + panelH + 5)
        ctx.stroke()
        ctx.fillStyle = '#64748b'
        ctx.font = '10px monospace'
        ctx.fillText(String(tick), x - 6, top + panelH + 16)
        ctx.strokeStyle = '#e2e8f0'
      }

      for (const yTick of [0.2, 0.5, 0.8]) {
        const y = top + panelH - yTick * (panelH - 2)
        ctx.strokeStyle = '#e2e8f0'
        ctx.beginPath()
        ctx.moveTo(x0, y)
        ctx.lineTo(x0 + panelW, y)
        ctx.stroke()
        const value = yLo + yTick * ySpan
        ctx.fillStyle = '#64748b'
        ctx.font = '10px monospace'
        ctx.fillText(value.toFixed(1), x0 - 26, y + 3)
      }

      if (series.length > 0) {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        let moved = false
        let validIndex = 0
        for (let i = 0; i < series.length && i < freqArray.length; i++) {
          const f = freqArray[i]
          if (f < fMin || f > fMax) continue
          const x = xForFreq(f, x0)
          const scaled = transformed[validIndex] ?? 0
          validIndex += 1
          const t = (scaled - yLo) / ySpan
          const y = top + panelH - t * (panelH - 2)
          if (!moved) { ctx.moveTo(x, y); moved = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      if (showHemispheres && hemisphereSeries && hemisphereSeries.length > 0) {
        hemisphereSeries.forEach((entry, idx) => {
          if (!entry.series || entry.series.length === 0) return
          ctx.strokeStyle = entry.color
          ctx.lineWidth = 1.7
          ctx.beginPath()
          let movedH = false
          let found = 0
          for (let i = 0; i < entry.series.length && i < freqArray.length; i++) {
            const f = freqArray[i]
            if (f < fMin || f > fMax) continue
            const rawValue = Number(entry.series[i] ?? 0)
            if (!(rawValue > 0)) continue
            found += 1
            const x = xForFreq(f, x0)
            const scaled = transformPower(rawValue)
            const t = (scaled - yLo) / ySpan
            const y = top + panelH - t * (panelH - 2)
            if (!movedH) { ctx.moveTo(x, y); movedH = true } else ctx.lineTo(x, y)
          }
          if (found > 0) {
            ctx.stroke()
            ctx.fillStyle = entry.color
            ctx.font = '10px monospace'
            ctx.fillText(entry.label, x0 + panelW - 42, top + 14 + idx * 12)
          }
        })
      }

      if (showGlobalOverlay && globalSeries && globalSeries.length > 0) {
        ctx.strokeStyle = 'rgba(22,163,74,0.75)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        let globalMoved = false
        for (let i = 0; i < globalSeries.length && i < freqArray.length; i++) {
          const f = freqArray[i]
          if (f < fMin || f > fMax) continue
          const rawValue = Number(globalSeries[i] ?? 0)
          if (!(rawValue > 0)) continue
          const x = xForFreq(f, x0)
          const scaled = transformPower(rawValue)
          const t = (scaled - yLo) / ySpan
          const y = top + panelH - t * (panelH - 2)
          if (!globalMoved) { ctx.moveTo(x, y); globalMoved = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.fillStyle = '#15803d'
        ctx.font = '10px monospace'
        ctx.fillText('global', x0 + panelW - 42, top + 14)
      }

      if (showAperiodicFit && aperiodicFit && Number.isFinite(aperiodicFit.slope) && Number.isFinite(aperiodicFit.intercept)) {
        ctx.strokeStyle = '#dc2626'
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        ctx.beginPath()
        let fitMoved = false
        for (let i = 0; i < freqArray.length; i++) {
          const f = freqArray[i]
          if (f < fMin || f > fMax || f <= 0) continue
          const bg = Math.exp(aperiodicFit.intercept + aperiodicFit.slope * Math.log(f))
          const scaled = transformPower(bg)
          const x = xForFreq(f, x0)
          const t = (scaled - yLo) / ySpan
          const y = top + panelH - t * (panelH - 2)
          if (!fitMoved) { ctx.moveTo(x, y); fitMoved = true } else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = '#dc2626'
        ctx.font = '10px monospace'
        ctx.fillText('1/f fit', x0 + panelW - 48, top + 14)
      }

      markers.forEach((marker, index) => {
        if (!Number.isFinite(marker.freq) || marker.freq < fMin || marker.freq > fMax) return
        const x = xForFreq(marker.freq, x0)
        ctx.strokeStyle = marker.color
        ctx.lineWidth = 1.3
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + panelH)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = marker.color
        ctx.font = '10px monospace'
        ctx.fillText(`${marker.label} ${marker.freq.toFixed(1)}`, x + 4, top + 14 + index * 12)
      })

      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      ctx.fillText('Frecuencia (Hz)', x0 + Math.floor(panelW / 2) - 40, top + panelH + 32)
      ctx.save()
      ctx.translate(x0 - 42, top + Math.floor(panelH / 2) + 26)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(showLogPowerAxis ? 'Potencia (log)' : 'Potencia', 0, 0)
      ctx.restore()
      ctx.fillText(
        `${showLogPowerAxis ? 'log ' : ''}${yLo.toFixed(1)}..${yHi.toFixed(1)}`,
        x0 + panelW - 98,
        top - 8,
      )
    }

    const rawMarkers = selected >= 0
      ? [{ freq: Number(panels!.alphaPeakRaw[selected] ?? 0), label: 'IAF', color: '#0f766e' }]
      : []
    const flatMarkers = selected >= 0
      ? [
          { freq: Number(panels!.alphaPeakFlat[selected] ?? 0), label: 'IAF', color: '#0f766e' },
          { freq: Number(panels!.thetaPeakFlat[selected] ?? 0), label: 'TH', color: '#c2410c' },
          { freq: Number(panels!.sigmaPeakFlat[selected] ?? 0), label: 'SG', color: '#7c3aed' },
        ]
      : []

    drawSpectrum(
      showHemispheres ? [] : raw,
      'Raw PSD',
      leftX,
      '#0f172a',
      rawMarkers,
      showHemispheres ? rawHemisphereRange : rawSharedRange,
      globalRaw,
      showHemispheres
        ? [
            { series: rawLeft, color: '#2563eb', label: 'izq' },
            { series: rawRight, color: '#dc2626', label: 'der' },
          ]
        : undefined,
      selected >= 0
        ? {
            slope: Number(panels!.aperiodicSlope[selected] ?? 0),
            intercept: Number(panels!.aperiodicIntercept[selected] ?? 0),
          }
        : null,
    )
    drawSpectrum(
      showHemispheres ? [] : flat,
      'Flattened PSD',
      rightX,
      '#7c3aed',
      flatMarkers,
      showHemispheres ? flatHemisphereRange : flatSharedRange,
      globalFlat,
      showHemispheres
        ? [
            { series: flatLeft, color: '#2563eb', label: 'izq' },
            { series: flatRight, color: '#dc2626', label: 'der' },
          ]
        : undefined,
      null,
    )

    if (selected >= 0) {
      ctx.fillStyle = '#475569'
      ctx.font = '11px monospace'
      ctx.fillText(
        `${panels!.stateNames[selected]} · ${selectedEpochs} épocas (${selectedPct.toFixed(1)}%) · IAF raw ${Number(panels!.alphaPeakRaw[selected] ?? 0).toFixed(2)} Hz · IAF flat ${Number(panels!.alphaPeakFlat[selected] ?? 0).toFixed(2)} Hz`,
        24,
        top + panelH + 36,
      )
      ctx.fillText(
        `total ${totalStateEpochs} épocas útiles · ${activeStateCount} estados con espectro · theta flat ${Number(panels!.thetaPeakFlat[selected] ?? 0).toFixed(2)} Hz · sigma flat ${Number(panels!.sigmaPeakFlat[selected] ?? 0).toFixed(2)} Hz · 1/f ${Number(panels!.aperiodicSlope[selected] ?? 0).toFixed(2)}`,
        24,
        top + panelH + 54,
      )
    }

    if (stateCount > 0) {
      const tableTop = top + panelH + 82
      const rowH = 18
      const colX = [24, 110, 182, 266, 352, 438, 520]
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 11px monospace'
      ;['Estado', 'ep', 'IAF raw', 'IAF flat', 'theta', 'sigma', '1/f'].forEach((header, idx) => {
        ctx.fillText(header, colX[idx], tableTop)
      })
      ctx.strokeStyle = '#cbd5e1'
      ctx.beginPath()
      ctx.moveTo(24, tableTop + 6)
      ctx.lineTo(width - 24, tableTop + 6)
      ctx.stroke()

      for (let i = 0; i < stateCount; i++) {
        const y = tableTop + 18 + i * rowH
        const label = stateSpectralShortLabel(panels!.stateLabels[i] ?? 0)
        const active = i === selected
        if (active) {
          ctx.fillStyle = 'rgba(15,23,42,0.08)'
          ctx.fillRect(20, y - 12, width - 40, rowH)
        }
        ctx.fillStyle = active ? '#0f172a' : '#334155'
        ctx.font = active ? 'bold 11px monospace' : '11px monospace'
        ctx.fillText(label, colX[0], y)
        ctx.fillText(String(panels!.epochCounts[i] ?? 0), colX[1], y)
        ctx.fillText(Number(panels!.alphaPeakRaw[i] ?? 0).toFixed(2), colX[2], y)
        ctx.fillText(Number(panels!.alphaPeakFlat[i] ?? 0).toFixed(2), colX[3], y)
        ctx.fillText(Number(panels!.thetaPeakFlat[i] ?? 0).toFixed(2), colX[4], y)
        ctx.fillText(Number(panels!.sigmaPeakFlat[i] ?? 0).toFixed(2), colX[5], y)
        ctx.fillText(Number(panels!.aperiodicSlope[i] ?? 0).toFixed(2), colX[6], y)
      }
    }
  }, [selectedStateIndex, showAperiodicFit, showGlobalOverlay, showHemispheres, showLogFreqAxis, showLogPowerAxis, stateSpectralPanels])

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1360,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.2rem',
      }}
      onClick={onClose}
    >
      <div
        ref={wrapRef}
        style={{
          width: 'min(96vw, 1500px)',
          maxHeight: '92vh',
          overflow: 'auto',
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 30px 80px rgba(15,23,42,0.35)',
          padding: '0.85rem',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
          <div style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.98rem' }}>Espectros por estado</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              borderRadius: 6,
              padding: '0.32rem 0.62rem',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fffdf4', padding: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', marginBottom: '0.55rem', alignItems: 'center' }}>
            <span style={{ color: '#0f172a', fontWeight: 700, fontSize: '0.82rem', marginRight: '0.2rem' }}>
              PSD por estado
            </span>
            {(stateSpectralPanels?.stateNames ?? []).map((name, index) => {
              const label = stateSpectralShortLabel(stateSpectralPanels?.stateLabels?.[index] ?? 0)
              const active = index === selectedStateIndex
              return (
                <button
                  key={`${name}-${index}`}
                  type="button"
                  onClick={() => setSelectedStateIndex(index)}
                  style={{
                    border: `1px solid ${active ? '#0f172a' : '#cbd5e1'}`,
                    background: active ? '#0f172a' : '#ffffff',
                    color: active ? '#ffffff' : '#0f172a',
                    borderRadius: 7,
                    padding: '0.22rem 0.5rem',
                    fontSize: '0.76rem',
                    fontFamily: 'monospace',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              )
            })}
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155', fontSize: '0.76rem', marginLeft: '0.4rem', userSelect: 'none' }}>
              <input type="checkbox" checked={showAperiodicFit} onChange={(event) => setShowAperiodicFit(event.target.checked)} />
              Mostrar 1/f
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155', fontSize: '0.76rem', userSelect: 'none' }}>
              <input type="checkbox" checked={showGlobalOverlay} onChange={(event) => setShowGlobalOverlay(event.target.checked)} />
              Global verde
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155', fontSize: '0.76rem', userSelect: 'none' }}>
              <input type="checkbox" checked={showHemispheres} onChange={(event) => setShowHemispheres(event.target.checked)} />
              Hemisferios
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155', fontSize: '0.76rem', userSelect: 'none' }}>
              <input type="checkbox" checked={showLogFreqAxis} onChange={(event) => setShowLogFreqAxis(event.target.checked)} />
              X log
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#334155', fontSize: '0.76rem', userSelect: 'none' }}>
              <input type="checkbox" checked={showLogPowerAxis} onChange={(event) => setShowLogPowerAxis(event.target.checked)} />
              Y log
            </label>
          </div>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
        </div>
      </div>
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
  viewerAnnotations,
  selectedViewerAnnotationId,
  artifactStatuses,
  artifactEpochSec,
  onViewerAnnotationSelect,
  onSeek,
}: {
  totalSeconds: number
  currentStartSec: number
  currentEndSec: number
  annotations?: EmbeddedAnnotation[]
  viewerAnnotations?: ViewerAnnotation[]
  selectedViewerAnnotationId?: string | null
  artifactStatuses?: number[]
  artifactEpochSec?: number
  onViewerAnnotationSelect?: (annotationId: string) => void
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
    const triggerAnnH = viewerAnnotations && viewerAnnotations.length > 0 ? 10 : 0
    const trackY = 12
    const trackW = Math.max(1, width - padX * 2)
    const artifactH = artifactStatuses && artifactStatuses.length > 0 ? 10 : 0
    const trackH = artifactH > 0 ? 16 : 22
    const safeTotal = Math.max(totalSeconds, 1)

    if (triggerAnnH > 0 && viewerAnnotations) {
      viewerAnnotations.forEach((annotation) => {
        const markerX = trackX + (Math.max(0, Math.min(safeTotal, annotation.onsetSec)) / safeTotal) * trackW
        const selected = annotation.id === selectedViewerAnnotationId
        const markerColor = selected ? '#ea580c' : '#c026d3'
        ctx.fillStyle = markerColor
        ctx.fillRect(Math.max(trackX, markerX - (selected ? 3 : 2)), trackY, selected ? 6 : 4, triggerAnnH)
      })
      ctx.strokeStyle = '#cbd5e1'
      ctx.strokeRect(trackX, trackY, trackW, triggerAnnH)
    }

    if (artifactH > 0 && artifactEpochSec && artifactStatuses) {
      for (let ep = 0; ep < artifactStatuses.length; ep++) {
        const x1 = trackX + Math.floor((ep * trackW) / artifactStatuses.length)
        const x2 = trackX + Math.floor(((ep + 1) * trackW) / artifactStatuses.length)
        ctx.fillStyle = artifactColor(artifactStatuses[ep] ?? 0)
        ctx.fillRect(x1, trackY + triggerAnnH, Math.max(1, x2 - x1), artifactH)
      }
    }

    ctx.fillStyle = '#e2e8f0'
    ctx.fillRect(trackX, trackY + triggerAnnH + artifactH, trackW, trackH)
    ctx.strokeStyle = '#94a3b8'
    ctx.strokeRect(trackX, trackY + triggerAnnH + artifactH, trackW, trackH)

    const viewX1 = trackX + (Math.max(0, currentStartSec) / safeTotal) * trackW
    const viewX2 = trackX + (Math.min(safeTotal, currentEndSec) / safeTotal) * trackW
    ctx.fillStyle = 'rgba(37,99,235,0.18)'
    ctx.fillRect(viewX1, trackY + triggerAnnH + artifactH, Math.max(2, viewX2 - viewX1), trackH)
    ctx.strokeStyle = 'rgba(37,99,235,0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(viewX1, trackY + triggerAnnH + artifactH, Math.max(2, viewX2 - viewX1), trackH)

    ctx.beginPath()
    ctx.moveTo(viewX1, trackY + triggerAnnH + artifactH - 4)
    ctx.lineTo(viewX1, trackY + triggerAnnH + artifactH + trackH + 4)
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
      ctx.moveTo(x, trackY + triggerAnnH + artifactH + trackH)
      ctx.lineTo(x, trackY + triggerAnnH + artifactH + trackH + 4)
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
  }, [annotations, artifactEpochSec, artifactStatuses, currentEndSec, currentStartSec, selectedViewerAnnotationId, totalSeconds, viewerAnnotations])

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
    const y = e.clientY - rect.top
    const padX = 10
    const trackW = Math.max(1, rect.width - padX * 2)
    const triggerAnnH = viewerAnnotations && viewerAnnotations.length > 0 ? 10 : 0
    const trackY = 12
    if (viewerAnnotations && viewerAnnotations.length > 0 && y >= trackY && y <= trackY + triggerAnnH && onViewerAnnotationSelect) {
      const safeTotal = Math.max(totalSeconds, 1)
      const targetSec = Math.max(0, Math.min(safeTotal, ((x - padX) / trackW) * safeTotal))
      let bestId: string | null = null
      let bestDist = Infinity
      viewerAnnotations.forEach((annotation) => {
        const dist = Math.abs(annotation.onsetSec - targetSec)
        if (dist < bestDist) {
          bestId = annotation.id
          bestDist = dist
        }
      })
      if (bestId) {
        onViewerAnnotationSelect(bestId)
        return
      }
    }
    const rel = Math.max(0, Math.min(0.999999, (x - padX) / trackW))
    onSeek(rel * Math.max(totalSeconds, 1))
  }, [onSeek, onViewerAnnotationSelect, totalSeconds, viewerAnnotations])

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

function TriggerSignalPreview({
  signal,
  overlaySignal,
  overlayLabel,
  threshold,
  eventSampleIndexes,
  sampleRate,
  onThresholdStepChange,
  compact = false,
}: {
  signal: Float32Array
  overlaySignal?: Float32Array | null
  overlayLabel?: string | null
  threshold: number
  eventSampleIndexes: number[]
  sampleRate: number
  onThresholdStepChange: (nextStep: number) => void
  compact?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const scales = useMemo(() => {
    return computeTriggerThresholdRange(signal) ?? { min: -1, max: 1 }
  }, [signal])

  const projectStepFromY = useCallback((y: number, height: number) => {
    const top = 16
    const bottom = Math.max(top + 1, height - 18)
    const clampedY = Math.max(top, Math.min(bottom, y))
    const norm = 1 - ((clampedY - top) / Math.max(bottom - top, 1))
    return Math.max(0, Math.min(TRIGGER_THRESHOLD_POSITIONS - 1, Math.round(norm * (TRIGGER_THRESHOLD_POSITIONS - 1))))
  }, [scales])

  const redraw = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const width = wrap.clientWidth || 900
    const height = compact ? 112 : 220
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#fffdf6'
    ctx.fillRect(0, 0, width, height)

    const leftAxisW = compact ? 46 : 54
    const rightPad = 10
    const top = compact ? 10 : 16
    const bottomAxisH = compact ? 16 : 18
    const left = leftAxisW
    const right = width - rightPad
    const bottom = height - bottomAxisH
    const plotW = Math.max(1, right - left)
    const plotH = Math.max(1, bottom - top)
    const range = scales.max - scales.min || 1

    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.rect(left, top, plotW, plotH)
    ctx.stroke()

    const zeroLineY = top + plotH * (1 - ((0 - scales.min) / range))
    if (zeroLineY >= top && zeroLineY <= bottom) {
      ctx.strokeStyle = 'rgba(148,163,184,0.5)'
      ctx.beginPath()
      ctx.moveTo(left, zeroLineY)
      ctx.lineTo(right, zeroLineY)
      ctx.stroke()
    }

    ctx.fillStyle = '#64748b'
    ctx.font = compact ? '9px monospace' : '10px monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${scales.max.toFixed(1)}`, left - 6, top + 1)
    if (zeroLineY >= top && zeroLineY <= bottom) {
      ctx.fillText('0', left - 6, zeroLineY)
    }
    ctx.fillText(`${scales.min.toFixed(1)}`, left - 6, bottom - 1)
    ctx.save()
    ctx.translate(10, top + plotH / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('µV', 0, 0)
    ctx.restore()

    const drawSignal = (data: Float32Array, color: string, lineWidth: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      for (let i = 0; i < data.length; i++) {
        const x = left + (i / Math.max(data.length - 1, 1)) * plotW
        const clampedValue = Math.max(scales.min, Math.min(scales.max, data[i] ?? 0))
        const norm = (clampedValue - scales.min) / range
        const y = top + plotH * (1 - norm)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }

    if (overlaySignal && overlaySignal.length > 0) {
      drawSignal(overlaySignal, 'rgba(220, 38, 38, 0.8)', 1)
    }

    drawSignal(signal, '#0f766e', 1.2)

    if (overlayLabel) {
      ctx.fillStyle = '#b91c1c'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.font = compact ? '9px monospace' : '10px monospace'
      ctx.fillText(`contra: ${overlayLabel}`, right - 2, top + 2)
    }

    const thresholdNorm = (threshold - scales.min) / range
    const thresholdY = top + plotH * (1 - Math.max(0, Math.min(1, thresholdNorm)))
    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(left, thresholdY)
    ctx.lineTo(right, thresholdY)
    ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = '#dc2626'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.font = compact ? '9px monospace' : '10px monospace'
    ctx.fillText(`${threshold.toFixed(1)} µV`, left + 4, Math.max(top + 10, thresholdY - 2))

    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 1.6
    eventSampleIndexes.forEach((sampleIndex) => {
      const x = left + (sampleIndex / Math.max(signal.length - 1, 1)) * plotW
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.stroke()

      const triTop = Math.max(1, top - 1)
      ctx.fillStyle = '#dc2626'
      ctx.beginPath()
      ctx.moveTo(x, triTop)
      ctx.lineTo(x - 5, triTop + 8)
      ctx.lineTo(x + 5, triTop + 8)
      ctx.closePath()
      ctx.fill()
    })

    ctx.fillStyle = '#475569'
    ctx.font = compact ? '9px monospace' : '10px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const tickCount = compact ? 4 : 6
    for (let i = 0; i <= tickCount; i++) {
      const sampleIndex = Math.round((i / tickCount) * Math.max(signal.length - 1, 1))
      const x = left + (sampleIndex / Math.max(signal.length - 1, 1)) * plotW
      const t = sampleIndex / Math.max(sampleRate, 1)
      ctx.beginPath()
      ctx.moveTo(x, bottom)
      ctx.lineTo(x, bottom + 4)
      ctx.stroke()
      ctx.fillText(`${t.toFixed(2)}s`, x, bottom + 4)
    }

    const scaleBarSec = 2
    const totalDurationSec = signal.length / Math.max(sampleRate, 1)
    if (totalDurationSec >= scaleBarSec) {
      const scaleBarWidth = (scaleBarSec / totalDurationSec) * plotW
      const scaleBarY = Math.max(top + 12, bottom - 14)
      const scaleBarX2 = right - 10
      const scaleBarX1 = Math.max(left + 10, scaleBarX2 - scaleBarWidth)

      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(scaleBarX1, scaleBarY)
      ctx.lineTo(scaleBarX2, scaleBarY)
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(scaleBarX1, scaleBarY - 4)
      ctx.lineTo(scaleBarX1, scaleBarY + 4)
      ctx.moveTo(scaleBarX2, scaleBarY - 4)
      ctx.lineTo(scaleBarX2, scaleBarY + 4)
      ctx.stroke()

      ctx.fillStyle = '#0f172a'
      ctx.font = compact ? '9px monospace' : '10px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText('2 s', (scaleBarX1 + scaleBarX2) / 2, scaleBarY - 6)
    }
  }, [compact, eventSampleIndexes, overlayLabel, overlaySignal, sampleRate, scales, signal, threshold])

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

  const handlePointer = useCallback((clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    onThresholdStepChange(projectStepFromY(clientY - rect.top, rect.height))
  }, [onThresholdStepChange, projectStepFromY])

  return (
    <div ref={wrapRef} style={{ background: '#ffffff', border: compact ? 'none' : '1px solid #d1fae5', borderRadius: compact ? 0 : 10, padding: compact ? 0 : '0.5rem' }}>
      {!compact && (
        <div style={{ color: '#166534', fontSize: '0.76rem', marginBottom: 6 }}>
          Vista del canal trigger filtrado. Arrastra la línea roja aquí o usa `↑ / ↓` y `− / +`.
        </div>
      )}
      <canvas
        ref={canvasRef}
        onMouseDown={(e) => { draggingRef.current = true; handlePointer(e.clientY) }}
        onMouseMove={(e) => { if (draggingRef.current) handlePointer(e.clientY) }}
        onMouseUp={() => { draggingRef.current = false }}
        onMouseLeave={() => { draggingRef.current = false }}
        style={{ display: 'block', width: '100%', cursor: 'ns-resize' }}
      />
    </div>
  )
}

function TriggerAverageModal({
  result,
  averageScope,
  fullRecordLoading,
  fullRecordError,
  currentStartSec,
  currentEndSec,
  triggerChannelName,
  triggerSignal,
  showTriggerContralateralOverlay,
  onToggleTriggerContralateralOverlay,
  triggerOverlayChannelName,
  triggerOverlaySignal,
  triggerThreshold,
  triggerThresholdStep,
  triggerDetectionMode,
  triggerHp,
  triggerLp,
  triggerNotch,
  triggerSmoothPoints,
  triggerDerivativeAfterSmooth,
  triggerBurstRearmFraction,
  averageHp,
  averageLp,
  averageNotch,
  averageGainMult,
  triggerPreSec,
  triggerPostSec,
  triggerRefractorySec,
  triggerRectify,
  rectifyAverage,
  excludeArtifactEvents,
  useN2ContextGate,
  artifactEventsAvailable,
  artifactMaskLoading,
  n2ContextLoading,
  artifactStatuses,
  artifactEpochSec,
  n2ContextEnabled,
  n2ContextStatuses,
  n2ContextScores,
  n2ContextEpochSec,
  eventSampleIndexes,
  previewEventCount,
  viewerAnnotationsCount,
  onClose,
  onCreateViewerAnnotations,
  onClearViewerAnnotations,
  onStepViewerAnnotation,
  onTriggerChannelChange,
  onTriggerDetectionModeChange,
  onTriggerHpChange,
  onTriggerLpChange,
  onTriggerNotchChange,
  onTriggerSmoothPointsChange,
  onTriggerDerivativeAfterSmoothChange,
  onTriggerBurstRearmFractionChange,
  onAverageHpChange,
  onAverageLpChange,
  onAverageNotchChange,
  onAverageGainMultChange,
  onTriggerPreSecChange,
  onTriggerPostSecChange,
  onTriggerRefractorySecChange,
  onTriggerRectifyChange,
  onRectifyAverageChange,
  onExcludeArtifactEventsChange,
  onUseN2ContextGateChange,
  onAverageScopeChange,
  onThresholdChange,
  onThresholdNudge,
  onAutoThreshold,
  triggerChannelOptions,
  presetDraftName,
  presetNames,
  selectedPresetName,
  onPresetDraftNameChange,
  onPresetSelect,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
}: {
  result: TriggeredAverageResult | null
  averageScope: 'page' | 'record'
  fullRecordLoading: boolean
  fullRecordError: string
  currentStartSec: number
  currentEndSec: number
  triggerChannelName: string
  triggerSignal: Float32Array | null
  showTriggerContralateralOverlay: boolean
  onToggleTriggerContralateralOverlay: () => void
  triggerOverlayChannelName: string | null
  triggerOverlaySignal: Float32Array | null
  triggerThreshold: number
  triggerThresholdStep: number
  triggerDetectionMode: 'event' | 'burst' | 'spindle' | 'slow'
  triggerHp: number
  triggerLp: number
  triggerNotch: number
  triggerSmoothPoints: number
  triggerDerivativeAfterSmooth: boolean
  triggerBurstRearmFraction: number
  averageHp: number
  averageLp: number
  averageNotch: number
  averageGainMult: number
  triggerPreSec: number
  triggerPostSec: number
  triggerRefractorySec: number
  triggerRectify: boolean
  rectifyAverage: boolean
  excludeArtifactEvents: boolean
  useN2ContextGate: boolean
  artifactEventsAvailable: boolean
  artifactMaskLoading: boolean
  n2ContextLoading: boolean
  artifactStatuses?: number[]
  artifactEpochSec?: number
  n2ContextEnabled: boolean
  n2ContextStatuses?: boolean[]
  n2ContextScores?: number[]
  n2ContextEpochSec?: number
  eventSampleIndexes: number[]
  previewEventCount: number
  viewerAnnotationsCount: number
  onClose: () => void
  onCreateViewerAnnotations: () => void
  onClearViewerAnnotations: () => void
  onStepViewerAnnotation: (direction: -1 | 1) => void
  onTriggerChannelChange: (value: string) => void
  onTriggerDetectionModeChange: (value: 'event' | 'burst' | 'spindle' | 'slow') => void
  onTriggerHpChange: (value: number) => void
  onTriggerLpChange: (value: number) => void
  onTriggerNotchChange: (value: number) => void
  onTriggerSmoothPointsChange: (value: number) => void
  onTriggerDerivativeAfterSmoothChange: () => void
  onTriggerBurstRearmFractionChange: (value: number) => void
  onAverageHpChange: (value: number) => void
  onAverageLpChange: (value: number) => void
  onAverageNotchChange: (value: number) => void
  onAverageGainMultChange: (value: number) => void
  onTriggerPreSecChange: (value: number) => void
  onTriggerPostSecChange: (value: number) => void
  onTriggerRefractorySecChange: (value: number) => void
  onTriggerRectifyChange: () => void
  onRectifyAverageChange: () => void
  onExcludeArtifactEventsChange: () => void
  onUseN2ContextGateChange: () => void
  onAverageScopeChange: (value: 'page' | 'record') => void
  onThresholdChange: (value: number) => void
  onThresholdNudge: (delta: number) => void
  onAutoThreshold: () => void
  triggerChannelOptions: Array<{ name: string; type: string }>
  presetDraftName: string
  presetNames: string[]
  selectedPresetName: string
  onPresetDraftNameChange: (value: string) => void
  onPresetSelect: (value: string) => void
  onSavePreset: () => void
  onLoadPreset: () => void
  onDeletePreset: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [overlayAverageChannels, setOverlayAverageChannels] = useState(false)
  const [overlayCompareChannelA, setOverlayCompareChannelA] = useState('')
  const [overlayCompareChannelB, setOverlayCompareChannelB] = useState('')

  const averagedEpoch = result?.averagedEpoch ?? null
  const rawAveragedEpoch = result?.rawAveragedEpoch ?? null
  const preSamples = result?.preSamples ?? 0
  const eventCount = result?.events.length ?? 0
  const rawEventCount = result?.rawEventCount ?? 0
  const excludedContextCount = result?.excludedContextCount ?? 0
  const excludedArtifactCount = result?.excludedArtifactCount ?? 0
  const cleanArtifactCount = result?.cleanArtifactCount ?? 0
  const suspectArtifactCount = result?.suspectArtifactCount ?? 0
  const rejectedArtifactCount = result?.rejectedArtifactCount ?? 0
  const pageArtifactSummary = useMemo(() => {
    if (!artifactStatuses?.length || !artifactEpochSec || artifactEpochSec <= 0) return null
    const startEpochIndex = Math.max(0, Math.floor(currentStartSec / artifactEpochSec))
    const endEpochIndex = Math.min(
      artifactStatuses.length - 1,
      Math.max(startEpochIndex, Math.floor(Math.max(currentStartSec, currentEndSec - 1e-9) / artifactEpochSec)),
    )
    let clean = 0
    let suspect = 0
    let rejected = 0
    const states: string[] = []
    for (let epochIndex = startEpochIndex; epochIndex <= endEpochIndex; epochIndex++) {
      const status = artifactStatuses[epochIndex] ?? 0
      if (status === 0) clean += 1
      else if (status === 1) suspect += 1
      else if (status === 2) rejected += 1
      states.push(`${epochIndex}:${status}`)
    }
    return {
      startEpochIndex,
      endEpochIndex,
      clean,
      suspect,
      rejected,
      states,
    }
  }, [artifactEpochSec, artifactStatuses, currentEndSec, currentStartSec])
  const pageN2Summary = useMemo(() => {
    if (!n2ContextEnabled || !n2ContextStatuses?.length || !n2ContextEpochSec || n2ContextEpochSec <= 0) return null
    const startEpochIndex = Math.max(0, Math.floor(currentStartSec / n2ContextEpochSec))
    const endEpochIndex = Math.min(
      n2ContextStatuses.length - 1,
      Math.max(startEpochIndex, Math.floor(Math.max(currentStartSec, currentEndSec - 1e-9) / n2ContextEpochSec)),
    )
    let accepted = 0
    let rejected = 0
    const states: string[] = []
    const scores: number[] = []
    for (let epochIndex = startEpochIndex; epochIndex <= endEpochIndex; epochIndex++) {
      const ok = !!n2ContextStatuses[epochIndex]
      const score = n2ContextScores?.[epochIndex] ?? 0
      if (ok) accepted += 1
      else rejected += 1
      scores.push(score)
      states.push(`${epochIndex}:${ok ? 1 : 0}@${score.toFixed(2)}`)
    }
    return { startEpochIndex, endEpochIndex, accepted, rejected, states, scoreSummary: summarizeScores(scores) }
  }, [currentEndSec, currentStartSec, n2ContextEnabled, n2ContextEpochSec, n2ContextStatuses, n2ContextScores])
  const totalN2Accepted = useMemo(
    () => (n2ContextStatuses ?? []).filter(Boolean).length,
    [n2ContextStatuses],
  )
  const totalN2Rejected = Math.max(0, (n2ContextStatuses?.length ?? 0) - totalN2Accepted)
  const totalN2ScoreSummary = useMemo(
    () => summarizeScores(n2ContextScores ?? []),
    [n2ContextScores],
  )
  const { scales } = useMemo(
    () => averagedEpoch ? computeScales(averagedEpoch, averageGainMult, false, {}) : { scales: [] as { p2: number; p98: number }[], refRange: 1 },
    [averageGainMult, averagedEpoch],
  )
  const overlayCompareOptions = useMemo(
    () => averagedEpoch
      ? averagedEpoch.channelNames.filter((name) => name !== triggerChannelName)
      : [],
    [averagedEpoch, triggerChannelName],
  )

  useEffect(() => {
    setOverlayCompareChannelA((current) => (
      current && overlayCompareOptions.includes(current)
        ? current
        : overlayCompareOptions[0] ?? ''
    ))
    setOverlayCompareChannelB((current) => {
      if (current && overlayCompareOptions.includes(current) && current !== (overlayCompareOptions[0] ?? '')) return current
      return overlayCompareOptions.find((name) => name !== (overlayCompareOptions[0] ?? '')) ?? ''
    })
  }, [overlayCompareOptions])

  const redraw = useCallback(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !averagedEpoch) return

    const width = wrap.clientWidth || 1100
    const height = overlayAverageChannels
      ? Math.max(320, Math.min(560, averagedEpoch.nChannels * 14 + 120))
      : Math.max(320, averagedEpoch.nChannels * 36 + 36)
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const axisBottomH = 26
    const plotHeight = Math.max(120, height - axisBottomH)
    const chanH = overlayAverageChannels
      ? plotHeight
      : Math.max(MIN_CHAN_H, Math.floor(plotHeight / Math.max(averagedEpoch.nChannels, 1)))
    const totalCanvasH = overlayAverageChannels ? plotHeight + axisBottomH : chanH * averagedEpoch.nChannels + axisBottomH
    if (canvas.height !== totalCanvasH) canvas.height = totalCanvasH

    ctx.fillStyle = '#fffdf6'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const waveW = canvas.width - LABEL_WIDTH
    const gridColor = 'rgba(148, 163, 184, 0.14)'
    const zeroX = LABEL_WIDTH + (preSamples / Math.max(averagedEpoch.nSamples - 1, 1)) * waveW
    const drawGrid = (top: number, sectionHeight: number) => {
      const horizontalDivisions = 6
      ctx.save()
      const totalDurationSec = averagedEpoch.nSamples / Math.max(averagedEpoch.sfreq, 1)
      const startSec = -preSamples / Math.max(averagedEpoch.sfreq, 1)
      const endSec = startSec + totalDurationSec
      const firstWholeSecond = Math.ceil(startSec)
      const lastWholeSecond = Math.floor(endSec)
      ctx.strokeStyle = gridColor
      ctx.lineWidth = 1
      for (let second = firstWholeSecond; second <= lastWholeSecond; second++) {
        const sampleIndex = Math.round((second - startSec) * averagedEpoch.sfreq)
        const x = LABEL_WIDTH + (sampleIndex / Math.max(averagedEpoch.nSamples - 1, 1)) * waveW
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + sectionHeight)
        ctx.stroke()
      }
      for (let i = 0; i <= horizontalDivisions; i++) {
        const y = top + (i / horizontalDivisions) * sectionHeight
        ctx.beginPath()
        ctx.moveTo(LABEL_WIDTH, y)
        ctx.lineTo(canvas.width, y)
        ctx.stroke()
      }
      ctx.strokeStyle = 'rgba(220, 38, 38, 0.78)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(zeroX, top)
      ctx.lineTo(zeroX, top + sectionHeight)
      ctx.stroke()
      ctx.restore()
    }
    const rowInfo: Array<{ y0: number; name: string; type: string; data: Float32Array; p2: number; p98: number; color: string }> = []

    for (let c = 0; c < averagedEpoch.nChannels; c++) {
      const y0 = overlayAverageChannels ? 0 : c * chanH
      const data = averagedEpoch.data[c]
      const name = averagedEpoch.channelNames[c] ?? `Ch${c + 1}`
      const type = averagedEpoch.channelTypes[c] ?? 'EEG'
      const color = getChannelColor(name, type)
      const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
      rowInfo.push({ y0, name, type, data, p2, p98, color })

      if (!overlayAverageChannels && c % 2 === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.03)'
        ctx.fillRect(LABEL_WIDTH, y0, waveW, chanH)
      }

      ctx.fillStyle = overlayAverageChannels ? '#f8f4e8' : '#f8edd0'
      ctx.fillRect(0, overlayAverageChannels ? 0 : y0, LABEL_WIDTH, overlayAverageChannels ? plotHeight : chanH)
      ctx.fillStyle = color
      ctx.font = `bold ${Math.max(8, Math.min(11, Math.floor(chanH * 0.28)))}px monospace`
      ctx.textAlign = 'left'
      if (!overlayAverageChannels) {
        ctx.fillText(name.slice(0, 9), 4, y0 + chanH * 0.35)
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, y0 + chanH)
        ctx.lineTo(canvas.width, y0 + chanH)
        ctx.stroke()
      }
    }

    const drawTrace = (
      data: Float32Array,
      p2: number,
      p98: number,
      sectionTop: number,
      sectionHeight: number,
      color: string,
      lineWidth: number,
      alpha = 1,
    ) => {
      const range = p98 - p2 || 1
      const margin = sectionHeight * 0.08
      const drawH = sectionHeight - margin * 2
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.globalAlpha = alpha
      for (let i = 0; i < data.length; i++) {
        const x = LABEL_WIDTH + (i / Math.max(data.length - 1, 1)) * waveW
        const norm = ((data[i] ?? 0) - p2) / range
        const y = sectionTop + margin + drawH * (1 - norm)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    if (overlayAverageChannels) {
      const plotGap = 18
      const topSectionHeight = Math.max(84, Math.round(plotHeight * 0.34))
      const bottomSectionTop = topSectionHeight + plotGap
      const bottomSectionHeight = Math.max(84, plotHeight - bottomSectionTop)
      const triggerRow = rowInfo.find((row) => row.name === triggerChannelName) ?? rowInfo[0]
      const rawTriggerIndex = rawAveragedEpoch?.channelNames.findIndex((name) => name === triggerChannelName) ?? -1
      const rawTriggerData = rawTriggerIndex >= 0 && rawAveragedEpoch
        ? rawAveragedEpoch.data[rawTriggerIndex]
        : triggerRow?.data ?? null
      const rawTriggerScale = rawTriggerData
        ? computeScales({
            ...(rawAveragedEpoch ?? averagedEpoch),
            nChannels: 1,
            channelNames: [triggerChannelName || 'Trigger'],
            channelTypes: ['EEG'],
            data: [rawTriggerData],
          }, averageGainMult, false, {}).scales[0] ?? { p2: 0, p98: 1 }
        : { p2: 0, p98: 1 }
      const getRawOverlayChannel = (channelName: string) => {
        if (!channelName || !rawAveragedEpoch) return null
        const channelIndex = rawAveragedEpoch.channelNames.findIndex((name) => name === channelName)
        if (channelIndex < 0) return null
        const channelData = rawAveragedEpoch.data[channelIndex]
        const channelScale = computeScales({
          ...rawAveragedEpoch,
          nChannels: 1,
          channelNames: [channelName],
          channelTypes: ['EEG'],
          data: [channelData],
        }, averageGainMult, false, {}).scales[0] ?? { p2: 0, p98: 1 }
        return { channelData, channelScale }
      }
      const overlayChannelARaw = getRawOverlayChannel(overlayCompareChannelA)
      const overlayChannelBRaw = getRawOverlayChannel(overlayCompareChannelB)
      const topSignals = [rawTriggerData, overlayChannelARaw?.channelData ?? null, overlayChannelBRaw?.channelData ?? null]
        .filter((signal): signal is Float32Array => !!signal)
      let commonTopScale = rawTriggerScale
      if (topSignals.length > 0) {
        const combined = new Float32Array(topSignals.reduce((sum, signal) => sum + signal.length, 0))
        let offset = 0
        for (const signal of topSignals) {
          combined.set(signal, offset)
          offset += signal.length
        }
        const combinedRange = computeTriggerThresholdRange(combined, 0.02, 0.98, 0.98, 0)
        if (combinedRange) {
          commonTopScale = { p2: combinedRange.min, p98: combinedRange.max }
        }
      }
      const grandAverage = new Float32Array(averagedEpoch.nSamples)
      for (const row of rowInfo) {
        for (let i = 0; i < averagedEpoch.nSamples; i++) grandAverage[i] += row.data[i] ?? 0
      }
      for (let i = 0; i < averagedEpoch.nSamples; i++) grandAverage[i] /= Math.max(rowInfo.length, 1)
      const grandScale = computeScales({
        ...averagedEpoch,
        nChannels: 1,
        channelNames: ['AVG'],
        channelTypes: ['EEG'],
        data: [grandAverage],
      }, averageGainMult, false, {}).scales[0] ?? { p2: 0, p98: 1 }

      ctx.fillStyle = '#f8edd0'
      ctx.fillRect(0, 0, LABEL_WIDTH, plotHeight)
      ctx.fillStyle = '#fffdf6'
      ctx.fillRect(LABEL_WIDTH, 0, waveW, topSectionHeight)
      ctx.fillStyle = '#fffaf0'
      ctx.fillRect(LABEL_WIDTH, bottomSectionTop, waveW, bottomSectionHeight)
      drawGrid(0, topSectionHeight)
      drawGrid(bottomSectionTop, bottomSectionHeight)
      ctx.strokeStyle = 'rgba(148,163,184,0.45)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, topSectionHeight + plotGap / 2)
      ctx.lineTo(canvas.width, topSectionHeight + plotGap / 2)
      ctx.stroke()

      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`Trigger ${triggerRow?.name ?? ''}`.trim(), 4, 16)
      if (overlayCompareChannelA) {
        ctx.fillStyle = '#2563eb'
        ctx.fillText(overlayCompareChannelA.slice(0, 11), 4, 32)
      }
      if (overlayCompareChannelB) {
        ctx.fillStyle = '#059669'
        ctx.fillText(overlayCompareChannelB.slice(0, 11), 4, 48)
      }
      ctx.fillStyle = '#dc2626'
      ctx.fillText('AVG todos', 4, bottomSectionTop + 16)

      if (rawTriggerData) {
        drawTrace(rawTriggerData, commonTopScale.p2, commonTopScale.p98, 0, topSectionHeight, '#dc2626', 2.4, 1)
      }
      if (overlayChannelARaw) {
        drawTrace(overlayChannelARaw.channelData, commonTopScale.p2, commonTopScale.p98, 0, topSectionHeight, '#2563eb', 1.5, 0.95)
      }
      if (overlayChannelBRaw) {
        drawTrace(overlayChannelBRaw.channelData, commonTopScale.p2, commonTopScale.p98, 0, topSectionHeight, '#059669', 1.5, 0.95)
      }
      for (const row of rowInfo) {
        drawTrace(row.data, row.p2, row.p98, bottomSectionTop, bottomSectionHeight, 'rgba(100, 116, 139, 0.48)', 1, 0.85)
      }
      drawTrace(grandAverage, grandScale.p2, grandScale.p98, bottomSectionTop, bottomSectionHeight, '#dc2626', 2.8, 1)
    } else {
      for (const row of rowInfo) {
        drawGrid(row.y0, chanH)
        drawTrace(row.data, row.p2, row.p98, row.y0, chanH, row.color, 1, 1)
      }
    }

    const axisY = overlayAverageChannels ? plotHeight : chanH * averagedEpoch.nChannels
    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, axisY, canvas.width, axisBottomH)
    ctx.strokeStyle = '#94a3b8'
    ctx.beginPath()
    ctx.moveTo(LABEL_WIDTH, axisY)
    ctx.lineTo(canvas.width, axisY)
    ctx.stroke()

    const tickCount = 6
    ctx.fillStyle = '#475569'
    ctx.font = '10px monospace'
    for (let i = 0; i <= tickCount; i++) {
      const sampleIndex = Math.round((i / tickCount) * Math.max(averagedEpoch.nSamples - 1, 1))
      const relSec = (sampleIndex - preSamples) / averagedEpoch.sfreq
      const x = LABEL_WIDTH + (sampleIndex / Math.max(averagedEpoch.nSamples - 1, 1)) * waveW
      ctx.beginPath()
      ctx.moveTo(x, axisY)
      ctx.lineTo(x, axisY + 5)
      ctx.stroke()
      ctx.fillText(`${relSec >= 0 ? '+' : ''}${relSec.toFixed(2)}s`, Math.min(x + 2, canvas.width - 48), axisY + 16)
    }
  }, [averageGainMult, averagedEpoch, overlayAverageChannels, overlayCompareChannelA, overlayCompareChannelB, preSamples, rawAveragedEpoch, scales, triggerChannelName])

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

  return (
    <div
      style={{
        position: 'fixed',
        top: 18,
        right: 18,
        zIndex: 40,
        width: 'min(1320px, calc(100vw - 36px))',
        height: 'min(90vh, 960px)',
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: 12,
        boxShadow: '0 18px 50px rgba(15,23,42,0.24)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0.8rem 1rem',
        borderBottom: '1px solid #e2e8f0',
        background: '#fffdf6',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ color: '#0f172a', fontWeight: 700 }}>Promedio desencadenado</div>
          <div style={{ color: '#64748b', fontSize: '0.82rem' }}>
            Trigger: {triggerChannelName || 'sin canal'} · {averageScope === 'record' ? `Página: ${previewEventCount} eventos · Promedio registro: N=${eventCount}` : `Promedio página: N=${eventCount}`} · Rectif trigger: {triggerRectify ? 'sí' : 'no'} · Rectif promedio: {rectifyAverage ? 'sí' : 'no'}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.76rem' }}>
            Detectados: {rawEventCount} · Excluidos por contexto: {excludedContextCount} · Excluidos por artefacto: {excludedArtifactCount} · Usados: {eventCount}
          </div>
          <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
            Limpios: {cleanArtifactCount} · Suspect: {suspectArtifactCount} · Rejected: {rejectedArtifactCount}
          </div>
          {n2ContextEnabled && (
            <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
              Contexto N2 {pageN2Summary
                ? `· página ctx ${pageN2Summary.startEpochIndex}-${pageN2Summary.endEpochIndex} · N2 ${pageN2Summary.accepted} · fuera ${pageN2Summary.rejected} · registro N2 ${totalN2Accepted} · fuera ${totalN2Rejected}`
                : n2ContextLoading
                  ? '· calculando…'
                  : '· sin máscara disponible'}
            </div>
          )}
          {n2ContextEnabled && (
            <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
              Score N2 {pageN2Summary?.scoreSummary
                ? `· pág mean ${pageN2Summary.scoreSummary.mean.toFixed(2)} · min ${pageN2Summary.scoreSummary.min.toFixed(2)} · max ${pageN2Summary.scoreSummary.max.toFixed(2)}`
                : n2ContextLoading
                  ? '· calculando…'
                  : '· —'}{totalN2ScoreSummary
                ? ` · reg mean ${totalN2ScoreSummary.mean.toFixed(2)} · min ${totalN2ScoreSummary.min.toFixed(2)} · max ${totalN2ScoreSummary.max.toFixed(2)}`
                : ''}
            </div>
          )}
          <div style={{ color: '#64748b', fontSize: '0.74rem' }}>
            Página {fmtTimeGrid(Math.max(0, currentStartSec))}-{fmtTimeGrid(Math.max(0, currentEndSec))} · {pageArtifactSummary
              ? `ép ${pageArtifactSummary.startEpochIndex}-${pageArtifactSummary.endEpochIndex} · limpias ${pageArtifactSummary.clean} · suspect ${pageArtifactSummary.suspect} · rejected ${pageArtifactSummary.rejected}`
              : 'sin máscara de artefactos disponible'}
          </div>
          {n2ContextEnabled && pageN2Summary && (
            <div style={{ color: '#94a3b8', fontSize: '0.71rem', fontFamily: 'monospace' }}>
              ctx {pageN2Summary.states.join(' ')}
            </div>
          )}
          {pageArtifactSummary && (
            <div style={{ color: '#94a3b8', fontSize: '0.71rem', fontFamily: 'monospace' }}>
              {pageArtifactSummary.states.join(' ')}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            color: '#334155',
            padding: '0.45rem 0.7rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Cerrar
        </button>
      </div>
      <div style={{
        flex: 1,
        overflow: 'hidden',
        background: '#fffdf6',
        padding: '0.9rem 1rem',
        display: 'grid',
        gridTemplateColumns: 'minmax(290px, 340px) minmax(0, 1fr)',
        gap: '0.9rem',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
          minWidth: 0,
          overflowY: 'auto',
          paddingRight: '0.1rem',
        }}>
          <div style={{
            padding: '0.8rem 0.9rem',
            border: '1px solid #d1fae5',
            borderRadius: 10,
            background: '#f0fdf4',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7rem',
          }}>
            <div style={{
              paddingBottom: '0.2rem',
              borderBottom: '1px dashed #bbf7d0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}>
              <div style={{ color: '#166534', fontSize: '0.73rem', fontWeight: 700 }}>
                Opciones guardadas
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#166534', fontSize: '0.72rem' }}>
                  Nombre
                  <input
                    type="text"
                    value={presetDraftName}
                    onChange={(e) => onPresetDraftNameChange(e.target.value)}
                    placeholder="p. ej. husos C3"
                    style={{
                      width: 150,
                      background: '#ffffff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 4,
                      padding: '0.28rem 0.4rem',
                      color: '#166534',
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={onSavePreset}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #86efac',
                    borderRadius: 5,
                    color: '#166534',
                    fontSize: '0.76rem',
                    padding: '0.38rem 0.65rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Guardar opciones
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <ToolbarSelect label="Preset" value={selectedPresetName} onChange={onPresetSelect} width={170}>
                  <option value="">Selecciona…</option>
                  {presetNames.map((presetName) => (
                    <option key={presetName} value={presetName}>{presetName}</option>
                  ))}
                </ToolbarSelect>
                <button
                  type="button"
                  onClick={onLoadPreset}
                  disabled={!selectedPresetName}
                  style={{
                    background: selectedPresetName ? '#ffffff' : '#dcfce7',
                    border: '1px solid #86efac',
                    borderRadius: 5,
                    color: '#166534',
                    fontSize: '0.76rem',
                    padding: '0.38rem 0.65rem',
                    cursor: selectedPresetName ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                  }}
                >
                  Cargar
                </button>
                <button
                  type="button"
                  onClick={onDeletePreset}
                  disabled={!selectedPresetName}
                  style={{
                    background: selectedPresetName ? '#fff7ed' : '#ffedd5',
                    border: '1px solid #fdba74',
                    borderRadius: 5,
                    color: '#c2410c',
                    fontSize: '0.76rem',
                    padding: '0.38rem 0.65rem',
                    cursor: selectedPresetName ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                  }}
                >
                  Borrar
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.7rem', flexWrap: 'wrap' }}>
              <ToolbarSelect label="Canal trigger" value={triggerChannelName} onChange={onTriggerChannelChange} width={148}>
                {triggerChannelOptions.map((channel) => (
                  <option key={channel.name} value={channel.name}>{channel.name}</option>
                ))}
              </ToolbarSelect>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#475569', fontSize: '0.82rem', whiteSpace: 'nowrap', paddingBottom: '0.2rem' }}>
                <input
                  type="checkbox"
                  checked={showTriggerContralateralOverlay}
                  onChange={onToggleTriggerContralateralOverlay}
                />
                Mostrar contra
              </label>
            </div>
            <ToolbarSelect
              label="Modo detector"
              value={triggerDetectionMode}
              onChange={(value) => onTriggerDetectionModeChange(value as 'event' | 'burst' | 'spindle' | 'slow')}
              width={148}
            >
              <option value="event">Evento</option>
              <option value="burst">Burst</option>
              <option value="spindle">Husos</option>
              <option value="slow">Lentas</option>
            </ToolbarSelect>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {triggerDetectionMode === 'burst' ? (
                <NumericSuggestInput
                  label="Rearme"
                  value={triggerBurstRearmFraction}
                  onCommit={(value) => onTriggerBurstRearmFractionChange(Math.max(0, Math.min(0.5, value)))}
                  suggestions={[0, 0.05, 0.1, 0.15, 0.2]}
                  width={84}
                  step={0.01}
                  min={0}
                  max={0.5}
                />
              ) : (
                <NumericSuggestInput
                  label="Refract"
                  value={triggerRefractorySec}
                  onCommit={(value) => onTriggerRefractorySecChange(Math.max(0, Math.min(30, value)))}
                  suggestions={[0.05, 0.1, 0.25, 0.5, 1, 2]}
                  width={84}
                  step={0.05}
                  min={0}
                  max={30}
                />
              )}
              <NumericSuggestInput
                label="HP trig"
                value={triggerHp}
                onCommit={onTriggerHpChange}
                suggestions={HP_OPTIONS.map((option) => option.value)}
              />
              <NumericSuggestInput
                label="LP trig"
                value={triggerLp}
                onCommit={onTriggerLpChange}
                suggestions={[0, ...LP_OPTIONS.map((option) => option.value)]}
              />
              <NumericSuggestInput
                label="Smooth n"
                value={triggerSmoothPoints}
                onCommit={(value) => onTriggerSmoothPointsChange(Math.max(1, Math.round(value)))}
                suggestions={[1, 3, 5, 7, 9, 11, 21]}
                width={78}
                step={1}
                min={1}
              />
              <ToolbarSelect label="Notch trig" value={triggerNotch} onChange={(value) => onTriggerNotchChange(parseFloat(value) || 0)} width={94}>
                {NOTCH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{`N ${option.label}`}</option>)}
              </ToolbarSelect>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                <input type="checkbox" checked={triggerDerivativeAfterSmooth} onChange={onTriggerDerivativeAfterSmoothChange} />
                Derivada tras smooth
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: artifactEventsAvailable ? '#166534' : '#94a3b8', fontSize: '0.75rem' }}>
                <input type="checkbox" checked={excludeArtifactEvents} onChange={onExcludeArtifactEventsChange} disabled={!artifactEventsAvailable} />
                Excluir eventos en artefacto
              </label>
              {(triggerDetectionMode === 'spindle' || triggerDetectionMode === 'slow') && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                  <input type="checkbox" checked={useN2ContextGate} onChange={onUseN2ContextGateChange} />
                  Requerir contexto N2
                </label>
              )}
              {artifactMaskLoading && (
                <div style={{ color: '#92400e', fontSize: '0.73rem' }}>
                  Preparando máscara de artefactos…
                </div>
              )}
              {n2ContextLoading && (triggerDetectionMode === 'spindle' || triggerDetectionMode === 'slow') && useN2ContextGate && (
                <div style={{ color: '#1d4ed8', fontSize: '0.73rem' }}>
                  Calculando contexto N2…
                </div>
              )}
            </div>
            <div style={{
              paddingTop: '0.15rem',
              borderTop: '1px dashed #bbf7d0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}>
              <div style={{ color: '#166534', fontSize: '0.73rem', fontWeight: 700 }}>
                Filtros del promedio
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <NumericSuggestInput
                  label="HP prom"
                  value={averageHp}
                  onCommit={onAverageHpChange}
                  suggestions={HP_OPTIONS.map((option) => option.value)}
                />
                <NumericSuggestInput
                  label="LP prom"
                  value={averageLp}
                  onCommit={onAverageLpChange}
                  suggestions={[0, ...LP_OPTIONS.map((option) => option.value)]}
                />
                <ToolbarSelect label="Notch prom" value={averageNotch} onChange={(value) => onAverageNotchChange(parseFloat(value) || 0)} width={94}>
                  {NOTCH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{`N ${option.label}`}</option>)}
                </ToolbarSelect>
                <ToolbarSelect label="Gan prom" value={averageGainMult} onChange={(value) => onAverageGainMultChange(parseFloat(value) || 1)} width={92}>
                  {GAIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </ToolbarSelect>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={overlayAverageChannels}
                  onChange={() => setOverlayAverageChannels((value) => !value)}
                />
                Superponer canales
              </label>
              {overlayAverageChannels && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <ToolbarSelect
                    label="Compara A"
                    value={overlayCompareChannelA}
                    onChange={setOverlayCompareChannelA}
                    width={132}
                  >
                    <option value="">Ninguno</option>
                    {overlayCompareOptions.map((channelName) => (
                      <option key={`overlay-a-${channelName}`} value={channelName}>{channelName}</option>
                    ))}
                  </ToolbarSelect>
                  <ToolbarSelect
                    label="Compara B"
                    value={overlayCompareChannelB}
                    onChange={setOverlayCompareChannelB}
                    width={132}
                  >
                    <option value="">Ninguno</option>
                    {overlayCompareOptions.map((channelName) => (
                      <option key={`overlay-b-${channelName}`} value={channelName}>{channelName}</option>
                    ))}
                  </ToolbarSelect>
                </div>
              )}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#166534', fontSize: '0.72rem' }}>
              Umbral
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button type="button" onClick={() => onThresholdNudge(-1)} style={{ width: 28, height: 28, background: '#ffffff', border: '1px solid #86efac', borderRadius: 4, color: '#166534', cursor: 'pointer', fontWeight: 700 }}>−</button>
                <div style={{ minWidth: 128, background: '#ffffff', border: '1px solid #bbf7d0', borderRadius: 4, padding: '0.34rem 0.45rem', color: '#166534', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {`${triggerThresholdStep + 1}/${TRIGGER_THRESHOLD_POSITIONS} · ${triggerThreshold.toFixed(2)} µV`}
                </div>
                <button type="button" onClick={() => onThresholdNudge(1)} style={{ width: 28, height: 28, background: '#ffffff', border: '1px solid #86efac', borderRadius: 4, color: '#166534', cursor: 'pointer', fontWeight: 700 }}>+</button>
                {triggerDetectionMode === 'spindle' && (
                  <button
                    type="button"
                    onClick={onAutoThreshold}
                    style={{
                      marginLeft: 4,
                      height: 28,
                      background: '#ffffff',
                      border: '1px solid #86efac',
                      borderRadius: 4,
                      color: '#166534',
                      cursor: 'pointer',
                      fontWeight: 700,
                      padding: '0 0.55rem',
                    }}
                  >
                    Auto
                  </button>
                )}
              </div>
            </label>
            <div style={{
              paddingTop: '0.15rem',
              borderTop: '1px dashed #bbf7d0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.45rem',
            }}>
              <div style={{ color: '#166534', fontSize: '0.73rem', fontWeight: 700 }}>
                Marcas del visor
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={onCreateViewerAnnotations}
                  disabled={!result}
                  style={{
                    background: result ? '#fff7ed' : '#ffedd5',
                    border: '1px solid #fdba74',
                    borderRadius: 5,
                    color: '#c2410c',
                    fontSize: '0.76rem',
                    padding: '0.34rem 0.65rem',
                    cursor: result ? 'pointer' : 'not-allowed',
                    fontWeight: 700,
                  }}
                >
                  Marcar eventos
                </button>
                {viewerAnnotationsCount > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => onStepViewerAnnotation(-1)}
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        borderRadius: 5,
                        color: '#c2410c',
                        fontSize: '0.76rem',
                        padding: '0.28rem 0.5rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      ‹
                    </button>
                    <span style={{ color: '#c2410c', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {viewerAnnotationsCount} marcas
                    </span>
                    <button
                      type="button"
                      onClick={() => onStepViewerAnnotation(1)}
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        borderRadius: 5,
                        color: '#c2410c',
                        fontSize: '0.76rem',
                        padding: '0.28rem 0.5rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      onClick={onClearViewerAnnotations}
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fdba74',
                        borderRadius: 5,
                        color: '#c2410c',
                        fontSize: '0.76rem',
                        padding: '0.34rem 0.55rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                      }}
                    >
                      Limpiar
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#166534', fontSize: '0.72rem' }}>
              <span style={{ fontWeight: 700 }}>Ventana (s)</span>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Desde</span>
                  <input
                    type="number"
                    step="0.05"
                    min="-30"
                    max="0"
                    value={-triggerPreSec}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      const clamped = Math.max(-30, Math.min(0, Number.isFinite(parsed) ? parsed : -triggerPreSec))
                      onTriggerPreSecChange(Math.abs(clamped))
                    }}
                    style={{
                      width: 72,
                      background: '#ffffff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 4,
                      padding: '0.2rem 0.35rem',
                      color: '#166534',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Hasta</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="30"
                    value={triggerPostSec}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      const clamped = Math.max(0, Math.min(30, Number.isFinite(parsed) ? parsed : triggerPostSec))
                      onTriggerPostSecChange(clamped)
                    }}
                    style={{
                      width: 72,
                      background: '#ffffff',
                      border: '1px solid #bbf7d0',
                      borderRadius: 4,
                      padding: '0.2rem 0.35rem',
                      color: '#166534',
                    }}
                  />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                <input type="checkbox" checked={triggerRectify} onChange={onTriggerRectifyChange} />
                Rectificar trigger
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                <input type="checkbox" checked={rectifyAverage} onChange={onRectifyAverageChange} />
                Rectificar promedio
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#166534', fontSize: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={averageScope === 'record'}
                  onChange={(e) => onAverageScopeChange(e.target.checked ? 'record' : 'page')}
                />
                Promediar registro entero
              </label>
            </div>
          </div>
          {averageScope === 'record' && (
            <div style={{
              padding: '0.7rem 0.85rem',
              border: '1px solid #bbf7d0',
              borderRadius: 10,
              background: '#f0fdf4',
              color: '#166534',
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}>
              El trigger se ajusta sobre la página visible. Las marcas verdes del preview corresponden a esta página; el `N` del promedio corresponde al registro entero.
            </div>
          )}
          {averageScope === 'record' && fullRecordLoading && (
            <div style={{
              padding: '1rem',
              border: '1px dashed #86efac',
              borderRadius: 10,
              color: '#166534',
              background: '#f7fee7',
              fontSize: '0.88rem',
              lineHeight: 1.5,
            }}>
              Calculando el promedio sobre todo el registro…
            </div>
          )}
          <div style={{
            padding: '0.85rem 0.9rem',
            border: '1px solid #dbeafe',
            borderRadius: 10,
            background: '#f8fbff',
            color: '#475569',
            fontSize: '0.8rem',
            lineHeight: 1.5,
          }}>
            El panel derecho muestra todos los canales promediados. Mantén esta vista abierta mientras ajustas el trigger aquí a la izquierda.
          </div>
        </div>
        <div style={{
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: triggerSignal && triggerChannelName ? 'minmax(96px, 124px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
          gap: '0.9rem',
        }}>
          {triggerSignal && triggerChannelName && (
            <div style={{
              border: '1px solid #d1fae5',
              borderRadius: 10,
              background: '#ffffff',
              overflow: 'hidden',
              minHeight: 0,
            }}>
              <div style={{ padding: '0.35rem 0.55rem' }}>
                <TriggerSignalPreview
                  signal={triggerSignal}
                  overlaySignal={triggerOverlaySignal}
                  overlayLabel={triggerOverlayChannelName}
                  threshold={triggerThreshold}
                  eventSampleIndexes={eventSampleIndexes}
                  sampleRate={averagedEpoch?.sfreq ?? 1}
                  onThresholdStepChange={onThresholdChange}
                  compact
                />
              </div>
            </div>
          )}
        {averagedEpoch ? (
          <div style={{
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            background: '#fffef8',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '0.55rem 0.8rem',
              borderBottom: '1px solid #e2e8f0',
              background: '#fffdf4',
              color: '#475569',
              fontSize: '0.78rem',
              fontWeight: 600,
            }}>
              Resultado multicanal
            </div>
            <div ref={wrapRef} style={{ flex: 1, overflow: 'auto', minHeight: 0, background: '#fffdf6' }}>
              <canvas ref={canvasRef} style={{ display: 'block', width: '100%' }} />
            </div>
          </div>
        ) : (
          <div style={{
            minWidth: 0,
            padding: '1rem',
            border: '1px dashed #86efac',
            borderRadius: 10,
            color: '#166534',
            background: '#f7fee7',
            fontSize: '0.88rem',
            lineHeight: 1.5,
            overflow: 'auto',
          }}>
            {fullRecordError || (averageScope === 'record'
              ? 'No hay eventos válidos todavía en todo el registro. Ajusta el umbral, los filtros o la rectificación del trigger y verás enseguida si aparecen marcas verdes en la vista del canal.'
              : 'No hay eventos válidos todavía en esta ventana. Ajusta el umbral, los filtros o la rectificación del trigger y verás enseguida si aparecen marcas verdes en la vista del canal.')}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EEGViewer() {
  const { id, recordId, sharedId, localId, cacheId } = useParams<{ id?: string; recordId?: string; sharedId?: string; localId?: string; cacheId?: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const sourceKind: 'case' | 'gallery' | 'shared' | 'local' | 'cached' = cacheId ? 'cached' : localId ? 'local' : sharedId ? 'shared' : recordId ? 'gallery' : 'case'
  const sourceId = cacheId || localId || sharedId || recordId || id || ''
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
  const [selectedCursorTimeSec, setSelectedCursorTimeSec] = useState<number | null>(null)
  const [recordDurationSec, setRecordDurationSec] = useState(1)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [meta,         setMeta]         = useState<{ recordingDate: string; channelLabels: string[] } | null>(null)
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
  const [artifactReviewOverlay, setArtifactReviewOverlay] = useState(false)
  const [artifactMaskData, setArtifactMaskData] = useState<ArtifactMaskData | null>(null)
  const [artifactMaskLoading, setArtifactMaskLoading] = useState(false)
  const [sleepSketchData, setSleepSketchData] = useState<SleepSketchTimelineData | null>(null)
  const [sleepSketchLoading, setSleepSketchLoading] = useState(false)
  const [qeegGlobalTimeseries, setQeegGlobalTimeseries] = useState<QeegGlobalTimeseriesData | null>(null)
  const [qeegGlobalTimeseriesLoading, setQeegGlobalTimeseriesLoading] = useState(false)
  const [stateSpectralAssumeSleepPresent, setStateSpectralAssumeSleepPresent] = useState(true)
  const [stateSpectralData, setStateSpectralData] = useState<StateSpectralTimelineData | null>(null)
  const [stateSpectralLoading, setStateSpectralLoading] = useState(false)
  const [stateSpectralPanels, setStateSpectralPanels] = useState<StateSpectralPanelData | null>(null)
  const [stateSpectralPanelsLoading, setStateSpectralPanelsLoading] = useState(false)
  const [dsaData,         setDsaData]         = useState<DSAData | null>(null)
  const [dsaLoading,      setDsaLoading]      = useState(false)
  const [dsaError,        setDsaError]        = useState('')
  const [dsaExpanded,     setDsaExpanded]     = useState(false)
  const [hypnogramOpen,   setHypnogramOpen]   = useState(false)
  const [sleepAnalyzerOpen, setSleepAnalyzerOpen] = useState(false)
  const [stateSpectraOpen, setStateSpectraOpen] = useState(false)
  const [compactToolbar,  setCompactToolbar]  = useState(false)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [localPickerError, setLocalPickerError] = useState('')
  const [selectedChannelName, setSelectedChannelName] = useState<string | null>(null)
  const [channelGainOverrides, setChannelGainOverrides] = useState<Record<string, number>>({})
  const [triggerAvgOpen, setTriggerAvgOpen] = useState(false)
  const [triggerAvgModalOpen, setTriggerAvgModalOpen] = useState(false)
  const [triggerChannelName, setTriggerChannelName] = useState('')
  const [showTriggerContralateralOverlay, setShowTriggerContralateralOverlay] = useState(true)
  const [triggerDetectionMode, setTriggerDetectionMode] = useState<'event' | 'burst' | 'spindle' | 'slow'>('event')
  const [triggerHp, setTriggerHp] = useState(0)
  const [triggerLp, setTriggerLp] = useState(45)
  const [triggerNotch, setTriggerNotch] = useState(0)
  const [triggerSmoothPoints, setTriggerSmoothPoints] = useState(1)
  const [triggerDerivativeAfterSmooth, setTriggerDerivativeAfterSmooth] = useState(false)
  const [triggerRectify, setTriggerRectify] = useState(false)
  const [triggerBurstRearmFraction, setTriggerBurstRearmFraction] = useState(0.1)
  const [spindleSigmaLow, setSpindleSigmaLow] = useState(11)
  const [spindleSigmaHigh, setSpindleSigmaHigh] = useState(16)
  const [spindleBroadLow, setSpindleBroadLow] = useState(1)
  const [spindleBroadHigh, setSpindleBroadHigh] = useState(30)
  const [spindleAmplitudeStdMultiplier, setSpindleAmplitudeStdMultiplier] = useState(1)
  const [spindleMinSec, setSpindleMinSec] = useState(0.5)
  const [spindleMaxSec, setSpindleMaxSec] = useState(2)
  const [averageHp, setAverageHp] = useState(0)
  const [averageLp, setAverageLp] = useState(0)
  const [averageNotch, setAverageNotch] = useState(0)
  const [averageGainMult, setAverageGainMult] = useState(1)
  const [triggerRectifyAverage, setTriggerRectifyAverage] = useState(false)
  const [excludeArtifactEvents, setExcludeArtifactEvents] = useState(true)
  const [useN2ContextGate, setUseN2ContextGate] = useState(false)
  const [triggerThresholdStep, setTriggerThresholdStep] = useState(Math.round((TRIGGER_THRESHOLD_POSITIONS - 1) * 0.7))
  const [triggerAverageScope, setTriggerAverageScope] = useState<'page' | 'record'>('page')
  const [triggerPreSec, setTriggerPreSec] = useState(1)
  const [triggerPostSec, setTriggerPostSec] = useState(2)
  const [triggerRefractorySec, setTriggerRefractorySec] = useState(0.25)
  const [lockedRecordTriggerThresholdValue, setLockedRecordTriggerThresholdValue] = useState<number | null>(null)
  const [lockedRecordSpindleAdaptiveThreshold, setLockedRecordSpindleAdaptiveThreshold] = useState<number | null>(null)
  const [fullRecordTriggerAverageResult, setFullRecordTriggerAverageResult] = useState<TriggeredAverageResult | null>(null)
  const [fullRecordTriggerAverageLoading, setFullRecordTriggerAverageLoading] = useState(false)
  const [fullRecordTriggerAverageError, setFullRecordTriggerAverageError] = useState('')
  const [n2ContextData, setN2ContextData] = useState<N2ContextData | null>(null)
  const [n2ContextLoading, setN2ContextLoading] = useState(false)
  const [viewerAnnotations, setViewerAnnotations] = useState<ViewerAnnotation[]>([])
  const [selectedViewerAnnotationId, setSelectedViewerAnnotationId] = useState<string | null>(null)
  const [triggerAvgPresets, setTriggerAvgPresets] = useState<TriggerAveragePresetMap>({})
  const [triggerAvgPresetDraftName, setTriggerAvgPresetDraftName] = useState('')
  const [selectedTriggerAvgPresetName, setSelectedTriggerAvgPresetName] = useState('')

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)    // outer flex container (for height)
  const localFileInputRef = useRef<HTMLInputElement>(null)
  const kappaRef   = useRef<KappaInstance | null>(null)
  const moduleRef  = useRef<KappaModuleInstance | null>(null)
  const wasmCacheTokenRef = useRef<string>(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const currentEdfPathRef = useRef<string | null>(null)
  const dsaCacheRef = useRef<Map<string, DSAData>>(new Map())
  const artifactMaskCacheRef = useRef<ArtifactMaskData | null>(null)
  const sleepSketchCacheRef = useRef<SleepSketchTimelineData | null>(null)
  const qeegGlobalTimeseriesCacheRef = useRef<QeegGlobalTimeseriesData | null>(null)
  const stateSpectralCacheRef = useRef<Map<string, StateSpectralTimelineData>>(new Map())
  const stateSpectralPanelsCacheRef = useRef<Map<string, StateSpectralPanelData>>(new Map())
  const n2ContextCacheRef = useRef<Map<string, N2ContextData>>(new Map())
  const avgRefButtonRef = useRef<HTMLButtonElement>(null)
  const avgRefMenuRef = useRef<HTMLDivElement>(null)
  const extrasButtonRef = useRef<HTMLButtonElement>(null)
  const extrasMenuRef = useRef<HTMLDivElement>(null)
  const loadVersionRef = useRef(0)
  const triggerAverageLoadVersionRef = useRef(0)
  const restoreInFlightRef = useRef(false)
  const viewerStateReadyRef = useRef(false)
  const persistTimerRef = useRef<number | null>(null)
  const latestPreviewTriggerThresholdValueRef = useRef(0)
  const latestPreviewSpindleAdaptiveThresholdRef = useRef<number | null>(null)

  // Imperative overlay refs — no setState on mousemove
  const mousePosRef   = useRef<{ x: number; y: number } | null>(null)
  const mouseOnRef    = useRef(false)
  const metaHoverRef  = useRef(false)
  const sbPosRef      = useRef<{ x: number; y: number } | null>(null)
  const sbDragRef     = useRef<{ startMX: number; startMY: number; startSBX: number; startSBY: number } | null>(null)
  const triggerThresholdDragRef = useRef(false)
  const renderMetaRef = useRef<RenderMeta | null>(null)
  const touchSwipeRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TRIGGER_AVG_PRESETS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as TriggerAveragePresetMap
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      setTriggerAvgPresets(parsed)
    } catch {
      // ignore malformed presets
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.removeItem('ocean-eeg-trigger-avg-settings-v1')
    } catch {
      // ignore localStorage failures
    }
  }, [])

  const currentTriggerAverageSettings = useMemo<PersistedTriggerAverageSettings>(() => ({
    triggerChannelName,
    showTriggerContralateralOverlay,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    triggerRectify,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    averageHp,
    averageLp,
    averageNotch,
    averageGainMult,
    triggerRectifyAverage,
    excludeArtifactEvents,
    useN2ContextGate,
    triggerThresholdStep,
    triggerAverageScope,
    triggerPreSec,
    triggerPostSec,
    triggerRefractorySec,
  }), [
    triggerChannelName,
    showTriggerContralateralOverlay,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    triggerRectify,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    averageHp,
    averageLp,
    averageNotch,
    averageGainMult,
    triggerRectifyAverage,
    excludeArtifactEvents,
    useN2ContextGate,
    triggerThresholdStep,
    triggerAverageScope,
    triggerPreSec,
    triggerPostSec,
    triggerRefractorySec,
  ])

  // ── Derived data ─────────────────────────────────────────────────────────────

  const processEpochForViewer = useCallback((sourceEpoch: EpochData): EpochData => {
    const montaged = applyMontage(sourceEpoch, montage, {
      excludedAverageReferenceChannels: new Set(excludedAverageReferenceChannels),
      includedHiddenChannels: new Set(includedHiddenChannels),
    })
    if (!normalizeNonEEG) return montaged
    return {
      ...montaged,
      data: montaged.data.map((d, i) =>
        (montaged.channelTypes[i] ?? 'EEG') !== 'EEG' ? zscoreNormalize(d) : d
      ),
    }
  }, [excludedAverageReferenceChannels, includedHiddenChannels, montage, normalizeNonEEG])

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
    if (!epoch) return null
    return processEpochForViewer(epoch)
  }, [epoch, processEpochForViewer])

  const { scales, refRange } = useMemo(() => {
    if (!processedEpoch) return { scales: [] as { p2: number; p98: number }[], refRange: 1 }
    return computeScales(processedEpoch, gainMult, normalizeNonEEG, channelGainOverrides)
  }, [processedEpoch, gainMult, normalizeNonEEG, channelGainOverrides])

  const effectiveGainMult = selectedChannelName
    ? (channelGainOverrides[selectedChannelName] ?? gainMult)
    : gainMult
  const selectedChannelHasOwnGain = !!(selectedChannelName && Object.prototype.hasOwnProperty.call(channelGainOverrides, selectedChannelName))

  const triggerChannelOptions = useMemo(() => {
    if (!processedEpoch) return []
    return processedEpoch.channelNames.map((name, index) => ({
      name,
      type: processedEpoch.channelTypes[index] ?? 'EEG',
    }))
  }, [processedEpoch])

  useEffect(() => {
    if (triggerChannelOptions.length === 0) {
      setTriggerChannelName('')
      return
    }
    const channelStillVisible = triggerChannelOptions.some((channel) => channel.name === triggerChannelName)
    if (channelStillVisible) return
    const preferred = (selectedChannelName && triggerChannelOptions.find((channel) => channel.name === selectedChannelName))
      || triggerChannelOptions.find((channel) => channel.type === 'EEG')
      || triggerChannelOptions[0]
    setTriggerChannelName(preferred?.name ?? '')
  }, [triggerChannelName, triggerChannelOptions, selectedChannelName])

  const applyTriggerAverageSettings = useCallback((settings: PersistedTriggerAverageSettings) => {
    setTriggerChannelName(settings.triggerChannelName)
    setShowTriggerContralateralOverlay(settings.showTriggerContralateralOverlay)
    setTriggerDetectionMode(settings.triggerDetectionMode)
    setTriggerHp(settings.triggerHp)
    setTriggerLp(settings.triggerLp)
    setTriggerNotch(settings.triggerNotch)
    setTriggerSmoothPoints(Math.max(1, Math.round(settings.triggerSmoothPoints)))
    setTriggerDerivativeAfterSmooth(settings.triggerDerivativeAfterSmooth)
    setTriggerRectify(settings.triggerRectify)
    setTriggerBurstRearmFraction(Math.max(0, settings.triggerBurstRearmFraction))
    setSpindleSigmaLow(Math.max(0.5, settings.spindleSigmaLow))
    setSpindleSigmaHigh(Math.max(1, settings.spindleSigmaHigh))
    setSpindleBroadLow(Math.max(0.5, settings.spindleBroadLow))
    setSpindleBroadHigh(Math.max(1, settings.spindleBroadHigh))
    setSpindleAmplitudeStdMultiplier(Math.max(0, settings.spindleAmplitudeStdMultiplier))
    setSpindleMinSec(Math.max(0.1, settings.spindleMinSec))
    setSpindleMaxSec(Math.max(settings.spindleMinSec, settings.spindleMaxSec))
    setAverageHp(settings.averageHp)
    setAverageLp(settings.averageLp)
    setAverageNotch(settings.averageNotch)
    setAverageGainMult(Number.isFinite(settings.averageGainMult) && settings.averageGainMult > 0 ? settings.averageGainMult : 1)
    setTriggerRectifyAverage(settings.triggerRectifyAverage)
    setExcludeArtifactEvents(settings.excludeArtifactEvents)
    setUseN2ContextGate(!!settings.useN2ContextGate)
    setTriggerThresholdStep(Math.max(0, Math.min(TRIGGER_THRESHOLD_POSITIONS - 1, Math.round(settings.triggerThresholdStep))))
    setTriggerAverageScope(settings.triggerAverageScope)
    setTriggerPreSec(Math.max(0, settings.triggerPreSec))
    setTriggerPostSec(Math.max(0, settings.triggerPostSec))
    setTriggerRefractorySec(Math.max(0, settings.triggerRefractorySec))
  }, [])

  const saveTriggerAveragePreset = useCallback(() => {
    const trimmedName = triggerAvgPresetDraftName.trim()
    if (!trimmedName) return
    setTriggerAvgPresets((current) => {
      const next = {
        ...current,
        [trimmedName]: currentTriggerAverageSettings,
      }
      try {
        window.localStorage.setItem(TRIGGER_AVG_PRESETS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore localStorage failures
      }
      return next
    })
    setSelectedTriggerAvgPresetName(trimmedName)
  }, [currentTriggerAverageSettings, triggerAvgPresetDraftName])

  const loadTriggerAveragePreset = useCallback(() => {
    if (!selectedTriggerAvgPresetName) return
    const preset = triggerAvgPresets[selectedTriggerAvgPresetName]
    if (!preset) return
    applyTriggerAverageSettings(preset)
    setTriggerAvgPresetDraftName(selectedTriggerAvgPresetName)
  }, [applyTriggerAverageSettings, selectedTriggerAvgPresetName, triggerAvgPresets])

  const deleteTriggerAveragePreset = useCallback(() => {
    if (!selectedTriggerAvgPresetName) return
    setTriggerAvgPresets((current) => {
      if (!(selectedTriggerAvgPresetName in current)) return current
      const next = { ...current }
      delete next[selectedTriggerAvgPresetName]
      try {
        window.localStorage.setItem(TRIGGER_AVG_PRESETS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore localStorage failures
      }
      return next
    })
    setTriggerAvgPresetDraftName('')
    setSelectedTriggerAvgPresetName('')
  }, [selectedTriggerAvgPresetName])

  const triggerSignalPreview = useMemo(() => {
    if (!triggerAvgOpen || !processedEpoch || !triggerChannelName) return null
    const triggerIndex = processedEpoch.channelNames.findIndex((name) => name === triggerChannelName)
    if (triggerIndex < 0) return null
    return computeTriggerPreviewSignal(processedEpoch.data[triggerIndex], processedEpoch.sfreq, {
      detectionMode: triggerDetectionMode,
      hp: triggerHp,
      lp: triggerLp,
      notch: triggerNotch,
      triggerSmoothPoints,
      triggerDerivativeAfterSmooth,
      rectifyTrigger: triggerRectify,
      spindleSigmaLow,
      spindleSigmaHigh,
      spindleBroadLow,
      spindleBroadHigh,
    })
  }, [processedEpoch, triggerAvgOpen, triggerChannelName, triggerDetectionMode, triggerHp, triggerLp, triggerNotch, triggerRectify, triggerSmoothPoints, triggerDerivativeAfterSmooth, spindleSigmaLow, spindleSigmaHigh, spindleBroadLow, spindleBroadHigh])

  const triggerOverlayChannelName = useMemo(() => {
    if (!showTriggerContralateralOverlay || !triggerAvgOpen || !processedEpoch || !triggerChannelName) return null
    return getContralateralChannelName(triggerChannelName, processedEpoch.channelNames)
  }, [processedEpoch, showTriggerContralateralOverlay, triggerAvgOpen, triggerChannelName])

  const triggerOverlaySignalPreview = useMemo(() => {
    if (!triggerAvgOpen || !processedEpoch || !triggerOverlayChannelName) return null
    const overlayIndex = processedEpoch.channelNames.findIndex((name) => name === triggerOverlayChannelName)
    if (overlayIndex < 0) return null
    return computeTriggerPreviewSignal(processedEpoch.data[overlayIndex], processedEpoch.sfreq, {
      detectionMode: triggerDetectionMode,
      hp: triggerHp,
      lp: triggerLp,
      notch: triggerNotch,
      triggerSmoothPoints,
      triggerDerivativeAfterSmooth,
      rectifyTrigger: triggerRectify,
      spindleSigmaLow,
      spindleSigmaHigh,
      spindleBroadLow,
      spindleBroadHigh,
    })
  }, [processedEpoch, triggerAvgOpen, triggerOverlayChannelName, triggerDetectionMode, triggerHp, triggerLp, triggerNotch, triggerRectify, triggerSmoothPoints, triggerDerivativeAfterSmooth, spindleSigmaLow, spindleSigmaHigh, spindleBroadLow, spindleBroadHigh])

  const previewTriggerThresholdRange = useMemo(() => {
    if (!triggerSignalPreview || triggerSignalPreview.length === 0) return null
    return computeTriggerThresholdRange(triggerSignalPreview)
  }, [triggerSignalPreview])

  const previewTriggerThresholdValue = useMemo(() => {
    if (!previewTriggerThresholdRange) return 0
    const ratio = triggerThresholdStep / Math.max(TRIGGER_THRESHOLD_POSITIONS - 1, 1)
    return previewTriggerThresholdRange.min + ratio * (previewTriggerThresholdRange.max - previewTriggerThresholdRange.min)
  }, [previewTriggerThresholdRange, triggerThresholdStep])

  const autoSetTriggerThreshold = useCallback(() => {
    if (!triggerSignalPreview || triggerSignalPreview.length === 0 || !previewTriggerThresholdRange) return
    const sorted = Float32Array.from(triggerSignalPreview).sort()
    const autoRatio = triggerDetectionMode === 'spindle' ? 0.93 : 0.9
    const autoIndex = Math.max(0, Math.min(sorted.length - 1, Math.floor(autoRatio * (sorted.length - 1))))
    const autoValue = sorted[autoIndex] ?? 0
    const range = previewTriggerThresholdRange.max - previewTriggerThresholdRange.min
    if (!Number.isFinite(autoValue) || range <= 0) return
    const normalized = (autoValue - previewTriggerThresholdRange.min) / range
    const nextStep = Math.max(
      0,
      Math.min(
        TRIGGER_THRESHOLD_POSITIONS - 1,
        Math.round(normalized * (TRIGGER_THRESHOLD_POSITIONS - 1)),
      ),
    )
    setTriggerThresholdStep(nextStep)
  }, [triggerSignalPreview, previewTriggerThresholdRange, triggerDetectionMode])

  const previewSpindleAdaptiveThreshold = useMemo(() => {
    if (triggerDetectionMode !== 'spindle' || !triggerSignalPreview || triggerSignalPreview.length === 0) return null
    return computeAdaptiveStdThreshold(triggerSignalPreview, spindleAmplitudeStdMultiplier)
  }, [triggerDetectionMode, triggerSignalPreview, spindleAmplitudeStdMultiplier])

  useEffect(() => {
    latestPreviewTriggerThresholdValueRef.current = previewTriggerThresholdValue
    latestPreviewSpindleAdaptiveThresholdRef.current = previewSpindleAdaptiveThreshold
  }, [previewTriggerThresholdValue, previewSpindleAdaptiveThreshold])

  useEffect(() => {
    if (!triggerAvgOpen || triggerAverageScope !== 'record' || !triggerChannelName) {
      setLockedRecordTriggerThresholdValue(null)
      setLockedRecordSpindleAdaptiveThreshold(null)
      return
    }
    setLockedRecordTriggerThresholdValue((current) =>
      current === null ? latestPreviewTriggerThresholdValueRef.current : current,
    )
    setLockedRecordSpindleAdaptiveThreshold((current) =>
      current === null ? latestPreviewSpindleAdaptiveThresholdRef.current : current,
    )
  }, [triggerAvgOpen, triggerAverageScope, triggerChannelName])

  useEffect(() => {
    if (triggerAverageScope !== 'record' || !triggerAvgOpen) return
    setLockedRecordTriggerThresholdValue(latestPreviewTriggerThresholdValueRef.current)
    setLockedRecordSpindleAdaptiveThreshold(latestPreviewSpindleAdaptiveThresholdRef.current)
  }, [
    sourceKind,
    sourceId,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    triggerRectify,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    triggerThresholdStep,
    triggerPreSec,
    triggerPostSec,
    triggerRefractorySec,
    triggerRectifyAverage,
    averageHp,
    averageLp,
    averageNotch,
    averageGainMult,
    excludeArtifactEvents,
  ])

  const effectiveTriggerThresholdValue = triggerAverageScope === 'record' && lockedRecordTriggerThresholdValue !== null
    ? lockedRecordTriggerThresholdValue
    : previewTriggerThresholdValue

  const effectiveSpindleAdaptiveThreshold = triggerAverageScope === 'record' && lockedRecordSpindleAdaptiveThreshold !== null
    ? lockedRecordSpindleAdaptiveThreshold
    : previewSpindleAdaptiveThreshold

  const triggerN2ContextEligible = useN2ContextGate
    && (triggerDetectionMode === 'spindle' || triggerDetectionMode === 'slow')
  const triggerAverageWaitingForArtifacts = triggerAvgOpen && excludeArtifactEvents && artifactMaskLoading
  const triggerAverageWaitingForN2Context = triggerAvgOpen && triggerN2ContextEligible && n2ContextLoading
  const triggerAverageWaitingForPrerequisites = triggerAverageWaitingForArtifacts || triggerAverageWaitingForN2Context
  const effectiveN2ContextGate = triggerN2ContextEligible
    && !!n2ContextData?.statuses.length
    && !!n2ContextData?.contextEpochSec

  const triggerAverageResult = useMemo(() => {
    if (!triggerAvgOpen || !processedEpoch || !triggerChannelName || triggerAverageWaitingForPrerequisites) return null
    return computeTriggeredAverage(processedEpoch, {
      triggerChannelName,
      threshold: effectiveTriggerThresholdValue,
      preSec: triggerPreSec,
      postSec: triggerPostSec,
      detectionMode: triggerDetectionMode,
      hp: triggerHp,
      lp: triggerLp,
      notch: triggerNotch,
      triggerSmoothPoints,
      triggerDerivativeAfterSmooth,
      averageHp,
      averageLp,
      averageNotch,
      rectifyTrigger: triggerRectify,
      rectifyAverage: triggerRectifyAverage,
      refractorySec: triggerRefractorySec,
      burstRearmFraction: triggerBurstRearmFraction,
      spindleSigmaLow,
      spindleSigmaHigh,
      spindleBroadLow,
      spindleBroadHigh,
      spindleAmplitudeStdMultiplier,
      spindleMinSec,
      spindleMaxSec,
      spindleAdaptiveThresholdOverride: effectiveSpindleAdaptiveThreshold ?? undefined,
      excludeArtifactEvents,
      artifactStatuses: artifactMaskData?.artifactStatuses,
      artifactEpochSec: artifactMaskData?.artifactEpochSec,
      useN2ContextGate: effectiveN2ContextGate,
      n2ContextStatuses: n2ContextData?.statuses,
      n2ContextEpochSec: n2ContextData?.contextEpochSec,
      recordStartSec: recordOffset,
    })
  }, [
    processedEpoch,
    triggerAvgOpen,
    triggerChannelName,
    effectiveTriggerThresholdValue,
    triggerPreSec,
    triggerPostSec,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    averageHp,
    averageLp,
    averageNotch,
    triggerRectify,
    triggerRectifyAverage,
    triggerRefractorySec,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    effectiveSpindleAdaptiveThreshold,
    excludeArtifactEvents,
    artifactMaskData,
    effectiveN2ContextGate,
    n2ContextData,
    recordOffset,
    triggerAverageWaitingForPrerequisites,
  ])

  const scopeAlignedPageTriggerAverageResult = useMemo(() => {
    if (!triggerAvgOpen || !processedEpoch || !triggerChannelName || triggerAverageWaitingForPrerequisites) return null
    return computeTriggeredAverage(processedEpoch, {
      triggerChannelName,
      threshold: effectiveTriggerThresholdValue,
      preSec: triggerPreSec,
      postSec: triggerPostSec,
      detectionMode: triggerDetectionMode,
      hp: triggerHp,
      lp: triggerLp,
      notch: triggerNotch,
      triggerSmoothPoints,
      triggerDerivativeAfterSmooth,
      averageHp,
      averageLp,
      averageNotch,
      rectifyTrigger: triggerRectify,
      rectifyAverage: triggerRectifyAverage,
      refractorySec: triggerRefractorySec,
      burstRearmFraction: triggerBurstRearmFraction,
      spindleSigmaLow,
      spindleSigmaHigh,
      spindleBroadLow,
      spindleBroadHigh,
      spindleAmplitudeStdMultiplier,
      spindleMinSec,
      spindleMaxSec,
      spindleAdaptiveThresholdOverride: effectiveSpindleAdaptiveThreshold ?? undefined,
      excludeArtifactEvents,
      artifactStatuses: artifactMaskData?.artifactStatuses,
      artifactEpochSec: artifactMaskData?.artifactEpochSec,
      useN2ContextGate: effectiveN2ContextGate,
      n2ContextStatuses: n2ContextData?.statuses,
      n2ContextEpochSec: n2ContextData?.contextEpochSec,
      recordStartSec: recordOffset,
    })
  }, [
    processedEpoch,
    triggerAvgOpen,
    triggerChannelName,
    effectiveTriggerThresholdValue,
    triggerPreSec,
    triggerPostSec,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    averageHp,
    averageLp,
    averageNotch,
    triggerRectify,
    triggerRectifyAverage,
    triggerRefractorySec,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    effectiveSpindleAdaptiveThreshold,
    excludeArtifactEvents,
    artifactMaskData,
    effectiveN2ContextGate,
    n2ContextData,
    recordOffset,
    triggerAverageWaitingForPrerequisites,
  ])

  useEffect(() => {
    if (!triggerAvgOpen || triggerAverageScope !== 'record') {
      triggerAverageLoadVersionRef.current += 1
      setFullRecordTriggerAverageLoading(false)
      setFullRecordTriggerAverageError('')
      setFullRecordTriggerAverageResult(null)
      return
    }
    if (triggerAverageWaitingForArtifacts) {
      setFullRecordTriggerAverageLoading(true)
      setFullRecordTriggerAverageError('Preparando máscara de artefactos…')
      setFullRecordTriggerAverageResult(null)
      return
    }
    if (triggerAverageWaitingForN2Context) {
      setFullRecordTriggerAverageLoading(true)
      setFullRecordTriggerAverageError('Calculando contexto N2…')
      setFullRecordTriggerAverageResult(null)
      return
    }
    if (!triggerChannelName) {
      setFullRecordTriggerAverageLoading(false)
      setFullRecordTriggerAverageError('Selecciona un canal trigger.')
      setFullRecordTriggerAverageResult(null)
      return
    }

    const kappa = kappaRef.current
    if (!kappa) {
      setFullRecordTriggerAverageLoading(false)
      setFullRecordTriggerAverageError('El visor aún no está listo para leer el registro completo.')
      setFullRecordTriggerAverageResult(null)
      return
    }

    const requestVersion = ++triggerAverageLoadVersionRef.current
    setFullRecordTriggerAverageLoading(true)
    setFullRecordTriggerAverageError('')

    const timer = window.setTimeout(() => {
      try {
        const safeRecordDurationSec = Math.max(recordDurationSec, 1e-6)
        const totalRecords = Math.max(1, Math.ceil(Math.max(totalSeconds, safeRecordDurationSec) / safeRecordDurationSec))
        const rawFullEpoch = kappa.readEpoch(0, totalRecords)
        if (!rawFullEpoch) throw new Error('No se pudo leer el registro completo.')

        const processedFullEpoch = processEpochForViewer(rawFullEpoch)
        const nextResult = computeTriggeredAverage(processedFullEpoch, {
          triggerChannelName,
          threshold: effectiveTriggerThresholdValue,
          preSec: triggerPreSec,
          postSec: triggerPostSec,
          detectionMode: triggerDetectionMode,
          hp: triggerHp,
          lp: triggerLp,
          notch: triggerNotch,
          triggerSmoothPoints,
          triggerDerivativeAfterSmooth,
          averageHp,
          averageLp,
          averageNotch,
          rectifyTrigger: triggerRectify,
          rectifyAverage: triggerRectifyAverage,
          refractorySec: triggerRefractorySec,
          burstRearmFraction: triggerBurstRearmFraction,
          spindleSigmaLow,
          spindleSigmaHigh,
          spindleBroadLow,
          spindleBroadHigh,
          spindleAmplitudeStdMultiplier,
          spindleMinSec,
          spindleMaxSec,
          spindleAdaptiveThresholdOverride: effectiveSpindleAdaptiveThreshold ?? undefined,
          excludeArtifactEvents,
          artifactStatuses: artifactMaskData?.artifactStatuses,
          artifactEpochSec: artifactMaskData?.artifactEpochSec,
          useN2ContextGate: effectiveN2ContextGate,
          n2ContextStatuses: n2ContextData?.statuses,
          n2ContextEpochSec: n2ContextData?.contextEpochSec,
          recordStartSec: 0,
        })

        if (triggerAverageLoadVersionRef.current !== requestVersion) return
        setFullRecordTriggerAverageResult(nextResult)
        setFullRecordTriggerAverageError(nextResult ? '' : 'No hay eventos válidos en todo el registro con estos ajustes.')
      } catch (error) {
        if (triggerAverageLoadVersionRef.current !== requestVersion) return
        const message = error instanceof Error ? error.message : 'No se pudo calcular el promedio del registro completo.'
        setFullRecordTriggerAverageError(message)
        setFullRecordTriggerAverageResult(null)
      } finally {
        if (triggerAverageLoadVersionRef.current === requestVersion) {
          setFullRecordTriggerAverageLoading(false)
        }
      }
    }, 180)

    return () => window.clearTimeout(timer)
  }, [
    processEpochForViewer,
    recordDurationSec,
    totalSeconds,
    triggerAverageScope,
    triggerAvgOpen,
    triggerChannelName,
    triggerDetectionMode,
    triggerHp,
    triggerLp,
    triggerNotch,
    triggerSmoothPoints,
    triggerDerivativeAfterSmooth,
    averageHp,
    averageLp,
    averageNotch,
    triggerPostSec,
    triggerPreSec,
    triggerRectify,
    triggerRectifyAverage,
    triggerRefractorySec,
    triggerBurstRearmFraction,
    spindleSigmaLow,
    spindleSigmaHigh,
    spindleBroadLow,
    spindleBroadHigh,
    spindleAmplitudeStdMultiplier,
    spindleMinSec,
    spindleMaxSec,
    effectiveTriggerThresholdValue,
    effectiveSpindleAdaptiveThreshold,
    excludeArtifactEvents,
    artifactMaskData,
    effectiveN2ContextGate,
    n2ContextData,
    triggerAverageWaitingForArtifacts,
    triggerAverageWaitingForN2Context,
  ])

  const activeTriggerAverageResult = triggerAverageScope === 'record'
    ? fullRecordTriggerAverageResult
    : triggerAverageResult
  const triggerAveragePresetNames = useMemo(
    () => Object.keys(triggerAvgPresets).sort((a, b) => a.localeCompare(b, 'es')),
    [triggerAvgPresets],
  )

  const createViewerAnnotationsFromTrigger = useCallback(() => {
    if (!activeTriggerAverageResult || !triggerChannelName) return
    const baseEvents = activeTriggerAverageResult.events
    const nextAnnotations = baseEvents.map((event, index) => {
      const absoluteOnsetSec = triggerAverageScope === 'record'
        ? event.onsetSec
        : recordOffset + event.onsetSec
      return {
        id: `trigger-${sourceKind}-${sourceId}-${Math.round(absoluteOnsetSec * 1000)}-${index}`,
        onsetSec: absoluteOnsetSec,
        durationSec: 0,
        text: `${triggerChannelName} #${index + 1}`,
        color: 'rgba(249,115,22,0.95)',
        source: 'trigger' as const,
      }
    })
    setViewerAnnotations(nextAnnotations)
    setSelectedViewerAnnotationId(nextAnnotations[0]?.id ?? null)
  }, [activeTriggerAverageResult, recordOffset, sourceId, sourceKind, triggerAverageScope, triggerChannelName])

  const triggerOverlay = useMemo<TriggerOverlayData | null>(() => {
    if (!triggerAvgOpen || !processedEpoch || !triggerChannelName) return null
    return {
      channelName: triggerChannelName,
      threshold: effectiveTriggerThresholdValue,
      eventOnsetsSec: scopeAlignedPageTriggerAverageResult
        ? scopeAlignedPageTriggerAverageResult.events.map((event) => recordOffset + event.onsetSec)
        : [],
    }
  }, [
    processedEpoch,
    recordOffset,
    scopeAlignedPageTriggerAverageResult,
    triggerAvgOpen,
    triggerChannelName,
    effectiveTriggerThresholdValue,
  ])

  useEffect(() => {
    setTriggerAvgModalOpen(triggerAvgOpen)
  }, [triggerAvgOpen])

  useEffect(() => {
    if (!processedEpoch) return
    const visibleNames = new Set(processedEpoch.channelNames)
    if (selectedChannelName && !visibleNames.has(selectedChannelName)) {
      setSelectedChannelName(null)
    }
    setChannelGainOverrides((current) => {
      const nextEntries = Object.entries(current).filter(([channelName]) => visibleNames.has(channelName))
      if (nextEntries.length === Object.keys(current).length) return current
      return Object.fromEntries(nextEntries)
    })
  }, [processedEpoch, selectedChannelName])

  useEffect(() => {
    setViewerAnnotations([])
    setSelectedViewerAnnotationId(null)
  }, [sourceKind, sourceId])

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
    triggerAverageLoadVersionRef.current += 1
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
    setSelectedChannelName(null)
    setChannelGainOverrides({})
    setTriggerAvgOpen(false)
    setTriggerAvgModalOpen(false)
    setFullRecordTriggerAverageResult(null)
    setFullRecordTriggerAverageLoading(false)
    setFullRecordTriggerAverageError('')
    setDsaChannel('off')
    setArtifactReject(false)
    setDsaData(null)
    setDsaLoading(false)
    setDsaError('')
    setSleepSketchData(null)
    setSleepSketchLoading(false)
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
          encryptionMode: caseItem.package?.encryptionMode,
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
      : sourceKind === 'cached'
        ? Promise.resolve().then(async () => {
            const cached = await getEncryptedPackageSummaryFromCache(sourceId)
            if (!cached) throw new Error('El EEG cacheado ya no está disponible en este navegador.')
            return {
              blobHash: cached.blobHash,
              cacheKey: cached.blobHash,
              ageRange: undefined,
              sizeBytes: cached.sizeBytes,
              storedKeyAvailable: false,
              encryptionMode: 'AES256-GCM',
              label: cached.label || cached.caseId || `Cache ${sourceId}`,
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
        if (sourceKind === 'shared' || sourceKind === 'local' || sourceKind === 'cached') {
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
    drawOverlay(overlay, rm, mousePosRef.current, mouseOnRef.current, sbPosRef.current, selectedCursorTimeSec)
  }, [selectedCursorTimeSec])

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
    const chanH      = drawEpoch(
      canvas,
      processedEpoch,
      scales,
      tStart,
      pageDuration,
      containerH,
      edfAnnotations,
      viewerAnnotations,
      selectedViewerAnnotationId,
      selectedChannelName,
      triggerOverlay,
      artifactMaskData?.artifactStatuses,
      artifactMaskData?.artifactEpochSec,
      artifactReviewOverlay,
    )
    const { sbMuV, sbPxH } = computeSBSize(chanH, canvas.height)

    renderMetaRef.current = {
      tStart, pageDuration,
      chanH,
      W: canvas.width, H: canvas.height,
      sbMuV, sbPxH,
    }
    refreshOverlay()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedEpoch, scales, refRange, gainMult, recordOffset, pageDuration, refreshOverlay, edfAnnotations, viewerAnnotations, selectedViewerAnnotationId, selectedChannelName, triggerOverlay, artifactMaskData, artifactReviewOverlay])

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

  const getTriggerThresholdLayout = useCallback(() => {
    const rm = renderMetaRef.current
    if (!rm || !processedEpoch || !triggerAvgOpen || !triggerChannelName) return null
    const channelIndex = processedEpoch.channelNames.findIndex((name) => name === triggerChannelName)
    if (channelIndex < 0) return null
    const scale = scales[channelIndex]
    if (!scale) return null
    const y0 = channelIndex * rm.chanH
    const margin = rm.chanH * 0.08
    const drawH = rm.chanH - margin * 2
    const range = scale.p98 - scale.p2 || 1
    const norm = Math.max(0, Math.min(1, (effectiveTriggerThresholdValue - scale.p2) / range))
    const y = y0 + margin + drawH * (1 - norm)
    return {
      y,
      y0,
      y1: y0 + rm.chanH,
      p2: scale.p2,
      p98: scale.p98,
      margin,
      drawH,
    }
  }, [processedEpoch, scales, triggerAvgOpen, triggerChannelName, effectiveTriggerThresholdValue])

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
    } else if (triggerThresholdDragRef.current) {
      const triggerLayout = getTriggerThresholdLayout()
      if (triggerLayout) {
        const clampedY = Math.max(triggerLayout.y0 + triggerLayout.margin, Math.min(triggerLayout.y0 + triggerLayout.margin + triggerLayout.drawH, y))
        const norm = 1 - ((clampedY - (triggerLayout.y0 + triggerLayout.margin)) / Math.max(triggerLayout.drawH, 1))
        const nextStep = Math.max(0, Math.min(TRIGGER_THRESHOLD_POSITIONS - 1, Math.round(norm * (TRIGGER_THRESHOLD_POSITIONS - 1))))
        setTriggerThresholdStep(nextStep)
      }
    }
    refreshOverlay()
  }, [getTriggerThresholdLayout, refreshOverlay])

  const handleMouseLeave = useCallback(() => {
    mouseOnRef.current = false
    sbDragRef.current = null
    triggerThresholdDragRef.current = false
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
    const triggerLayout = getTriggerThresholdLayout()
    if (
      triggerLayout &&
      x >= LABEL_WIDTH &&
      x <= rm.W &&
      y >= triggerLayout.y0 &&
      y <= triggerLayout.y1 &&
      Math.abs(y - triggerLayout.y) <= 10
    ) {
      triggerThresholdDragRef.current = true
      e.preventDefault()
      return
    }
    if (x <= LABEL_WIDTH && processedEpoch) {
      const channelIndex = Math.max(0, Math.min(processedEpoch.nChannels - 1, Math.floor(y / Math.max(rm.chanH, 1))))
      const channelName = processedEpoch.channelNames[channelIndex]
      if (channelName) {
        setSelectedChannelName((current) => current === channelName ? null : channelName)
        if (triggerAvgOpen) setTriggerChannelName(channelName)
        e.preventDefault()
        return
      }
    }
    const sbX  = sbPosRef.current ? sbPosRef.current.x : rm.W - SB_BAR_W - 18
    const sbY  = sbPosRef.current ? sbPosRef.current.y : rm.H - rm.sbPxH - 22
    const pad  = 8
    if (x >= sbX - pad && x <= sbX + SB_BAR_W + pad && y >= sbY - pad && y <= sbY + rm.sbPxH + pad) {
      sbDragRef.current = { startMX: x, startMY: y, startSBX: sbX, startSBY: sbY }
      e.preventDefault()
      return
    }
    if (x >= LABEL_WIDTH && x <= rm.W && pageDuration > 0) {
      const waveW = rm.W - LABEL_WIDTH
      const selectedSec = rm.tStart + ((x - LABEL_WIDTH) / Math.max(waveW, 1)) * pageDuration
      setSelectedCursorTimeSec(Math.max(0, Math.min(totalSeconds, selectedSec)))
      refreshOverlay()
    }
  }, [getTriggerThresholdLayout, pageDuration, processedEpoch, refreshOverlay, totalSeconds, triggerAvgOpen])

  useEffect(() => {
    const onUp = () => {
      sbDragRef.current = null
      triggerThresholdDragRef.current = false
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [])

  // ── Load WASM module ──────────────────────────────────────────────────────────

  const loadModule = useCallback((): Promise<KappaModuleInstance> => {
    if (moduleRef.current) return Promise.resolve(moduleRef.current)
    return new Promise((resolve, reject) => {
      const version = encodeURIComponent(wasmCacheTokenRef.current)
      const instantiateModule = () => {
        if (!window.KappaModule) {
          reject(new Error('KappaModule no disponible'))
          return
        }
        window.KappaModule({
          locateFile: (path) => `/wasm/${path}?v=${version}`,
        }).then((m) => {
          moduleRef.current = m
          resolve(m)
        }).catch(reject)
      }
      if (window.KappaModule) {
        instantiateModule()
        return
      }
      const script = document.createElement('script')
      script.src = `/wasm/kappa_wasm.js?v=${version}`
      script.dataset.kappaWasmLoader = version
      script.onload = () => {
        const poll = setInterval(() => {
          if (window.KappaModule) {
            clearInterval(poll)
            instantiateModule()
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
    if (restoreInFlightRef.current) return
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
      let packageMeta = sourceKind === 'shared' || sourceKind === 'local' || sourceKind === 'cached' ? null : caseHoverMeta
      if (sourceKind === 'shared' || sourceKind === 'local' || sourceKind === 'cached' || !packageMeta?.blobHash) {
        try {
          if (sourceKind === 'case') {
            packageMeta = await api.get<CaseItem>(`/cases/${sourceId}`).then((caseItem) => ({
              blobHash: caseItem.package?.blobHash,
              cacheKey: caseItem.package?.blobHash,
              ageRange: caseItem.ageRange || undefined,
              sizeBytes: caseItem.package?.sizeBytes,
              encryptionMode: caseItem.package?.encryptionMode,
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
          } else if (sourceKind === 'cached') {
            const cached = await getEncryptedPackageSummaryFromCache(sourceId)
            if (!cached) throw new Error('El EEG cacheado ya no está disponible en este navegador.')
            packageMeta = {
              blobHash: cached.blobHash,
              cacheKey: cached.blobHash,
              ageRange: undefined,
              sizeBytes: cached.sizeBytes,
              encryptionMode: 'AES256-GCM',
              label: cached.label || cached.caseId || `Cache ${sourceId}`,
            }
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
        } else if (sourceKind === 'cached') {
          throw new Error('El EEG cacheado ya no está disponible en este navegador.')
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
              label: packageMeta?.label,
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
      sleepSketchCacheRef.current = null
      stateSpectralCacheRef.current.clear()
      stateSpectralPanelsCacheRef.current.clear()
      n2ContextCacheRef.current.clear()
      setDsaChannel('off')
      setArtifactReject(false)
      setDsaData(null)
      setDsaLoading(false)
      setDsaError('')
      setSleepSketchData(null)
      setSleepSketchLoading(false)
      setStateSpectralData(null)
      setStateSpectralLoading(false)
      setStateSpectralPanels(null)
      setStateSpectralPanelsLoading(false)
      setN2ContextData(null)
      setN2ContextLoading(false)
      setMeta({ recordingDate: info.recordingDate, channelLabels: info.channelLabels })
      const totalDurationSec = info.numSamples / info.sampleRate
      setTotalSeconds(totalDurationSec)
      const probeEpoch = kappa.readEpoch(0, 1)
      if (!probeEpoch) throw new Error('readEpoch(0, 1) devolvió null')
      const detectedRecordDurationSec = probeEpoch.nSamples / probeEpoch.sfreq
      setRecordDurationSec(detectedRecordDurationSec)
      let persistedState: PersistedViewerState | null = null
      if (sourceKind !== 'shared' && sourceKind !== 'local' && sourceKind !== 'cached') {
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
    if (sourceKind === 'cached') {
      const saved = sessionStorage.getItem(`ocean_eeg_key_${sourceKind}_${sourceId}`)
      if (saved) {
        setKeyInput(saved)
        startViewer(saved)
      }
      return
    }
    if ((sourceKind === 'gallery' || sourceKind === 'case') && caseHoverMeta?.encryptionMode === 'NONE') {
      startViewer('')
      return
    }
    if (sourceKind === 'shared') {
      if (caseHoverMeta?.encryptionMode === 'NONE') {
        startViewer('')
        return
      }
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

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    const rm = renderMetaRef.current
    if (!canvas || !rm || pageDuration <= 0) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    if (x < LABEL_WIDTH || x > rm.W) return
    const waveW = rm.W - LABEL_WIDTH
    const targetSec = rm.tStart + ((x - LABEL_WIDTH) / Math.max(waveW, 1)) * pageDuration
    const clampedTargetSec = Math.max(0, Math.min(totalSeconds, targetSec))
    setSelectedCursorTimeSec(clampedTargetSec)
    goToSecondPosition(clampedTargetSec, true)
  }, [goToSecondPosition, pageDuration, totalSeconds])

  const jumpToViewerAnnotation = useCallback((annotationId: string, center = true) => {
    const annotation = viewerAnnotations.find((item) => item.id === annotationId)
    if (!annotation) return
    setSelectedViewerAnnotationId(annotation.id)
    goToSecondPosition(annotation.onsetSec, center)
  }, [goToSecondPosition, viewerAnnotations])

  const stepViewerAnnotation = useCallback((direction: -1 | 1) => {
    if (viewerAnnotations.length === 0) return
    const currentIndex = selectedViewerAnnotationId
      ? viewerAnnotations.findIndex((item) => item.id === selectedViewerAnnotationId)
      : -1
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = Math.max(0, Math.min(viewerAnnotations.length - 1, fallbackIndex + direction))
    const next = viewerAnnotations[nextIndex]
    if (!next) return
    setSelectedViewerAnnotationId(next.id)
    goToSecondPosition(next.onsetSec, true)
  }, [goToSecondPosition, selectedViewerAnnotationId, viewerAnnotations])

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
      if (sourceKind === 'local' && sourceId) {
        replaceLocalEegSession(sourceId, {
          filename: file.name,
          sizeBytes: file.size,
          buffer,
        })
        try {
          if (currentEdfPathRef.current) moduleRef.current?.FS.unlink(currentEdfPathRef.current)
        } catch {
          // ignore cleanup failures before re-opening another local EDF
        }
        currentEdfPathRef.current = null
        kappaRef.current = null
        moduleRef.current = null
        loadVersionRef.current += 1
        setPhase('loading-module')
        setEpoch(null)
        setRecordOffset(0)
        setRecordDurationSec(1)
        setTotalSeconds(0)
        setMeta(null)
        setEdfAnnotations([])
        setAnnotationsOpen(false)
        setCaseHoverMeta({
          cacheKey: undefined,
          ageRange: undefined,
          sizeBytes: file.size,
          encryptionMode: 'NONE',
          label: file.name,
        })
        startViewer('')
      } else {
        const nextSession = createLocalEegSession({
          filename: file.name,
          sizeBytes: file.size,
          buffer,
        })
        if (sourceKind === 'local' && sourceId) clearLocalEegSession(sourceId)
        navigate(`/open/${nextSession.id}`)
      }
    } catch (err) {
      setLocalPickerError(err instanceof Error ? err.message : 'El navegador no pudo leer el archivo EDF seleccionado.')
    } finally {
      event.target.value = ''
    }
  }, [navigate, sourceId, sourceKind, startViewer])

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
  const handleGainChange = useCallback((val: string) => {
    const nextGain = parseFloat(val)
    if (selectedChannelName) {
      setChannelGainOverrides((current) => ({
        ...current,
        [selectedChannelName]: nextGain,
      }))
      return
    }
    setGainMult(nextGain)
  }, [selectedChannelName])
  const releaseSelectedChannelGainOverride = useCallback(() => {
    if (!selectedChannelName) return
    setChannelGainOverrides((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, selectedChannelName)) return current
      const next = { ...current }
      delete next[selectedChannelName]
      return next
    })
  }, [selectedChannelName])
  const nudgeTriggerThreshold = useCallback((delta: number) => {
    setTriggerThresholdStep((current) => Math.max(0, Math.min(TRIGGER_THRESHOLD_POSITIONS - 1, current + delta)))
  }, [])
  const handleWindowChange = (val: string) => {
    const newWin = parseInt(val)
    const targetCursorSec = selectedCursorTimeSec
    setWindowSecs(newWin)
    const kappa = kappaRef.current
    if (!kappa) return
    const nextStartSec = targetCursorSec !== null
      ? getSecondBasedPageStart(targetCursorSec, totalSeconds, newWin, newWin, true)
      : (() => {
          const nextStepSec = getPageStepSeconds(newWin, recordDurationSec)
          const nextPage = getPageIndexForSecond(recordOffset, nextStepSec)
          return nextPage * nextStepSec
        })()
    const result = readEpochWindow(kappa, nextStartSec, newWin, totalSeconds, recordDurationSec)
    if (!result) return
    setEpoch(result.epoch)
    setRecordOffset(result.startSec)
    setSelectedCursorTimeSec(null)
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
    setN2ContextData(null)
    setN2ContextLoading(false)
    setMobileControlsOpen(false)
    setSelectedChannelName(null)
    setChannelGainOverrides({})
    setTriggerAvgOpen(false)
    setTriggerAvgModalOpen(false)
    setTriggerDetectionMode('event')
    setTriggerHp(0)
    setTriggerLp(45)
    setTriggerNotch(0)
    setTriggerSmoothPoints(1)
    setTriggerDerivativeAfterSmooth(false)
    setTriggerRectify(false)
    setTriggerBurstRearmFraction(0.1)
    setTriggerRectifyAverage(false)
    setUseN2ContextGate(false)
    setTriggerThresholdStep(Math.round((TRIGGER_THRESHOLD_POSITIONS - 1) * 0.7))
    setTriggerPreSec(0.5)
    setTriggerPostSec(0.5)
    setTriggerRefractorySec(0.25)
    dsaCacheRef.current.clear()
    artifactMaskCacheRef.current = null
    n2ContextCacheRef.current.clear()
    sleepSketchCacheRef.current = null
    qeegGlobalTimeseriesCacheRef.current = null
    stateSpectralCacheRef.current.clear()
    stateSpectralPanelsCacheRef.current.clear()
  }, [recordDurationSec, totalSeconds])

  useEffect(() => {
    if (phase !== 'viewing') {
      setArtifactMaskData(null)
      setArtifactMaskLoading(false)
      return
    }

    if (artifactMaskCacheRef.current) {
      setArtifactMaskData(artifactMaskCacheRef.current)
      setArtifactMaskLoading(false)
      return
    }

    let cancelled = false
    setArtifactMaskData(null)
    setArtifactMaskLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeArtifactMask()
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular la máscara de artefactos')
        artifactMaskCacheRef.current = result
        setArtifactMaskData(result)
        setArtifactMaskLoading(false)
      } catch {
        if (cancelled) return
        setArtifactMaskData(null)
        setArtifactMaskLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'viewing') {
      setSleepSketchData(null)
      setSleepSketchLoading(false)
      return
    }

    if (sleepSketchCacheRef.current) {
      setSleepSketchData(sleepSketchCacheRef.current)
      setSleepSketchLoading(false)
      return
    }

    let cancelled = false
    setSleepSketchData(null)
    setSleepSketchLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeSleepSketchTimeline()
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular el timeline de sueño')
        sleepSketchCacheRef.current = result
        setSleepSketchData(result)
        setSleepSketchLoading(false)
      } catch {
        if (cancelled) return
        setSleepSketchData(null)
        setSleepSketchLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'viewing') {
      setQeegGlobalTimeseries(null)
      setQeegGlobalTimeseriesLoading(false)
      return
    }

    if (qeegGlobalTimeseriesCacheRef.current) {
      setQeegGlobalTimeseries(qeegGlobalTimeseriesCacheRef.current)
      setQeegGlobalTimeseriesLoading(false)
      return
    }

    let cancelled = false
    setQeegGlobalTimeseries(null)
    setQeegGlobalTimeseriesLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeQeegGlobalTimeseries()
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular la FMD qEEG global')
        qeegGlobalTimeseriesCacheRef.current = result
        setQeegGlobalTimeseries(result)
        setQeegGlobalTimeseriesLoading(false)
      } catch {
        if (cancelled) return
        setQeegGlobalTimeseries(null)
        setQeegGlobalTimeseriesLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    if (phase !== 'viewing') {
      setStateSpectralData(null)
      setStateSpectralLoading(false)
      return
    }

    const cacheKey = stateSpectralAssumeSleepPresent ? 'sleep-on' : 'sleep-off'
    const cached = stateSpectralCacheRef.current.get(cacheKey)
    if (cached) {
      setStateSpectralData(cached)
      setStateSpectralLoading(false)
      return
    }

    let cancelled = false
    setStateSpectralData(null)
    setStateSpectralLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeStateSpectralTimeline(stateSpectralAssumeSleepPresent)
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular el timeline de estados')
        stateSpectralCacheRef.current.set(cacheKey, result)
        setStateSpectralData(result)
        setStateSpectralLoading(false)
      } catch {
        if (cancelled) return
        setStateSpectralData(null)
        setStateSpectralLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, stateSpectralAssumeSleepPresent])

  useEffect(() => {
    if (phase !== 'viewing') {
      setStateSpectralPanels(null)
      setStateSpectralPanelsLoading(false)
      return
    }

    const cacheKey = stateSpectralAssumeSleepPresent ? 'sleep-on' : 'sleep-off'
    const cached = stateSpectralPanelsCacheRef.current.get(cacheKey)
    if (cached) {
      setStateSpectralPanels(cached)
      setStateSpectralPanelsLoading(false)
      return
    }

    let cancelled = false
    setStateSpectralPanels(null)
    setStateSpectralPanelsLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const result = kappaRef.current?.computeStateSpectralPanels(stateSpectralAssumeSleepPresent)
        if (cancelled) return
        if (!result) throw new Error('No se pudo calcular los espectros por estado')
        stateSpectralPanelsCacheRef.current.set(cacheKey, result)
        setStateSpectralPanels(result)
        setStateSpectralPanelsLoading(false)
      } catch {
        if (cancelled) return
        setStateSpectralPanels(null)
        setStateSpectralPanelsLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [phase, stateSpectralAssumeSleepPresent])

  const triggerSourceChannelIndex = useMemo(
    () => resolveTriggerSourceChannelIndex(triggerChannelName, meta?.channelLabels ?? []),
    [meta?.channelLabels, triggerChannelName],
  )

  useEffect(() => {
    if (phase !== 'viewing' || !triggerAvgOpen || !triggerN2ContextEligible) {
      setN2ContextData(null)
      setN2ContextLoading(false)
      return
    }

    const kappa = kappaRef.current
    if (!kappa || triggerSourceChannelIndex < 0 || !Number.isFinite(recordDurationSec) || recordDurationSec <= 0 || totalSeconds <= 0) {
      setN2ContextData(null)
      setN2ContextLoading(false)
      return
    }

    const recordsPerWindow = Math.max(1, Math.ceil(N2_CONTEXT_WINDOW_SEC / recordDurationSec))
    const contextEpochSec = recordsPerWindow * recordDurationSec
    const totalRecords = Math.max(1, Math.ceil(Math.max(totalSeconds, contextEpochSec) / recordDurationSec))
    const cacheKey = `${triggerSourceChannelIndex}|${recordsPerWindow}|${totalRecords}`
    const cached = n2ContextCacheRef.current.get(cacheKey)
    if (cached) {
      setN2ContextData(cached)
      setN2ContextLoading(false)
      return
    }

    let cancelled = false
    setN2ContextData(null)
    setN2ContextLoading(true)

    const timer = window.setTimeout(() => {
      try {
        const statuses: boolean[] = []
        const scores: number[] = []
        let channelName = meta?.channelLabels[triggerSourceChannelIndex] ?? triggerChannelName
        for (let offset = 0; offset < totalRecords; offset += recordsPerWindow) {
          const nRecords = Math.min(recordsPerWindow, totalRecords - offset)
          const result = kappa.computeSpindleContextForChannel(triggerSourceChannelIndex, offset, nRecords)
          if (!result) throw new Error('No se pudo calcular el contexto N2')
          channelName = result.channelName || channelName
          statuses.push(!!result.isNremLike)
          scores.push(Number.isFinite(result.score) ? result.score : 0)
        }
        if (cancelled) return
        const nextData: N2ContextData = {
          contextEpochSec,
          channelIndex: triggerSourceChannelIndex,
          channelName,
          statuses,
          scores,
        }
        n2ContextCacheRef.current.set(cacheKey, nextData)
        setN2ContextData(nextData)
        setN2ContextLoading(false)
      } catch {
        if (cancelled) return
        setN2ContextData(null)
        setN2ContextLoading(false)
      }
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    phase,
    triggerAvgOpen,
    triggerN2ContextEligible,
    triggerSourceChannelIndex,
    recordDurationSec,
    totalSeconds,
    meta?.channelLabels,
    triggerChannelName,
  ])

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
    if (!sourceId || sourceKind === 'shared' || sourceKind === 'local' || sourceKind === 'cached' || phase !== 'viewing' || restoreInFlightRef.current || !viewerStateReadyRef.current) return

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
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setArtifactReviewOverlay((current) => !current)
        return
      }
      if (triggerAvgOpen && triggerChannelName && e.key === 'ArrowUp' && !e.shiftKey) {
        e.preventDefault()
        nudgeTriggerThreshold(1)
        return
      }
      if (triggerAvgOpen && triggerChannelName && e.key === 'ArrowDown' && !e.shiftKey) {
        e.preventDefault()
        nudgeTriggerThreshold(-1)
        return
      }
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
        const currentGain = selectedChannelName
          ? (channelGainOverrides[selectedChannelName] ?? gainMult)
          : gainMult
        const idx = GAIN_OPTIONS.findIndex((o) => o.value === currentGain)
        const nextGain = GAIN_OPTIONS[Math.min(idx + 1, GAIN_OPTIONS.length - 1)].value
        if (selectedChannelName) {
          setChannelGainOverrides((current) => ({
            ...current,
            [selectedChannelName]: nextGain,
          }))
        } else {
          setGainMult(nextGain)
        }
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const currentGain = selectedChannelName
          ? (channelGainOverrides[selectedChannelName] ?? gainMult)
          : gainMult
        const idx = GAIN_OPTIONS.findIndex((o) => o.value === currentGain)
        const nextGain = GAIN_OPTIONS[Math.max(idx - 1, 0)].value
        if (selectedChannelName) {
          setChannelGainOverrides((current) => ({
            ...current,
            [selectedChannelName]: nextGain,
          }))
        } else {
          setGainMult(nextGain)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, currentPage, maxPage, goToPage, shiftBySeconds, selectedChannelName, channelGainOverrides, gainMult, triggerAvgOpen, triggerChannelName, nudgeTriggerThreshold])

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
            <NumericSuggestInput
              label="HP"
              value={hp}
              onCommit={(value) => handleHpChange(String(value))}
              suggestions={HP_OPTIONS.map((option) => option.value)}
            />
            <NumericSuggestInput
              label="LP"
              value={lp}
              onCommit={(value) => handleLpChange(String(value))}
              suggestions={[0, ...LP_OPTIONS.map((option) => option.value)]}
            />
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
        <button
          type="button"
          onClick={() => setTriggerAvgOpen((open) => !open)}
          title="Activar promedio EEG desencadenado por umbral"
          style={{
            background: triggerAvgOpen ? '#166534' : '#ecfdf5',
            border: `1px solid ${triggerAvgOpen ? '#166534' : '#86efac'}`,
            borderRadius: 4,
            color: triggerAvgOpen ? '#ffffff' : '#166534',
            fontSize: compactToolbar ? '0.72rem' : '0.75rem',
            padding: compactToolbar ? '0.18rem 0.38rem' : '0.16rem 0.48rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: 700,
          }}
        >
          {compactToolbar ? 'Trig Avg' : (triggerAvgOpen ? 'Trigger Avg ON' : 'Trigger Avg')}
        </button>

        {!compactToolbar && (
          <>
            {selectedChannelName && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '0.16rem 0.45rem',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
                color: '#991b1b',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>
                <span>{selectedChannelName}</span>
                {selectedChannelHasOwnGain && (
                  <button
                    type="button"
                    onClick={releaseSelectedChannelGainOverride}
                    title="Volver a encadenar este canal con la ganancia global"
                    style={{
                      background: '#ffffff',
                      border: '1px solid #fca5a5',
                      borderRadius: 4,
                      color: '#b91c1c',
                      fontSize: '0.72rem',
                      padding: '0.05rem 0.32rem',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    Reenc.
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedChannelName(null)}
                  title="Salir del modo de ajuste por canal"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #fca5a5',
                    borderRadius: 4,
                    color: '#b91c1c',
                    fontSize: '0.72rem',
                    padding: '0.05rem 0.32rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Global
                </button>
              </div>
            )}
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
            {artifactReviewOverlay && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.16rem 0.45rem',
                background: '#eff6ff',
                border: '1px solid #93c5fd',
                borderRadius: 4,
                color: '#1d4ed8',
                fontSize: '0.75rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
                Rev Artef · R
              </div>
            )}

            <ToolbarSelect label="Ganancia" value={effectiveGainMult} onChange={handleGainChange}>
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
          {selectedChannelName && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0.16rem 0.38rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              color: '#991b1b',
              fontSize: '0.72rem',
              whiteSpace: 'nowrap',
            }}>
              <span>{selectedChannelName}</span>
              {selectedChannelHasOwnGain && (
                <button
                  type="button"
                  onClick={releaseSelectedChannelGainOverride}
                  title="Volver a encadenar este canal con la ganancia global"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #fca5a5',
                    borderRadius: 4,
                    color: '#b91c1c',
                    fontSize: '0.68rem',
                    padding: '0.04rem 0.28rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  Reenc.
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedChannelName(null)}
                title="Salir del modo de ajuste por canal"
                style={{
                  background: '#ffffff',
                  border: '1px solid #fca5a5',
                  borderRadius: 4,
                  color: '#b91c1c',
                  fontSize: '0.68rem',
                  padding: '0.04rem 0.28rem',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Global
              </button>
            </div>
          )}
          <NumericSuggestInput
            label="HP"
            value={hp}
            onCommit={(value) => handleHpChange(String(value))}
            suggestions={HP_OPTIONS.map((option) => option.value)}
            compact
            width={64}
          />
          <NumericSuggestInput
            label="LP"
            value={lp}
            onCommit={(value) => handleLpChange(String(value))}
            suggestions={[0, ...LP_OPTIONS.map((option) => option.value)]}
            compact
            width={64}
          />
          <ToolbarSelect label="Notch" value={notch} onChange={handleNotchChange}>
            {NOTCH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{`Notch ${o.label}`}</option>)}
          </ToolbarSelect>
          <ToolbarSelect label="Gan" value={effectiveGainMult} onChange={handleGainChange}>
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
          {artifactReviewOverlay && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0.16rem 0.45rem',
              background: '#eff6ff',
              border: '1px solid #93c5fd',
              borderRadius: 4,
              color: '#1d4ed8',
              fontSize: '0.75rem',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}>
              Rev Artef · R
            </div>
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

      {triggerAvgOpen && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          flexWrap: 'wrap',
          padding: '0.45rem 0.6rem 0.55rem 0.6rem',
          background: '#f0fdf4',
          borderBottom: '1px solid #d1fae5',
          flexShrink: 0,
        }}>
          <div style={{
            flexBasis: '100%',
            color: '#166534',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            paddingBottom: '0.15rem',
          }}>
            1. Pulsa el nombre de un canal para usarlo como trigger. 2. Pulsa `Abrir promedio` para ajustar filtros, umbral y ventana dentro de la ventana emergente.
          </div>
          {selectedChannelName && selectedChannelName !== triggerChannelName && (
            <button
              type="button"
              onClick={() => setTriggerChannelName(selectedChannelName)}
              style={{
                background: '#ffffff',
                border: '1px solid #86efac',
                borderRadius: 4,
                color: '#166534',
                fontSize: '0.75rem',
                padding: '0.28rem 0.55rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Usar {selectedChannelName}
            </button>
          )}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingBottom: 2, marginLeft: 'auto' }}>
            <span style={{ color: '#166534', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
              {triggerAverageScope === 'record'
                ? (
                    fullRecordTriggerAverageLoading
                      ? 'Calculando N en todo el registro…'
                      : fullRecordTriggerAverageResult
                        ? `N=${fullRecordTriggerAverageResult.events.length} en todo el registro`
                        : (fullRecordTriggerAverageError || 'N=0 en todo el registro')
                  )
                : (
                    triggerAverageResult
                      ? `N=${triggerAverageResult.events.length} en esta ventana`
                      : 'N=0 en esta ventana'
                  )}
            </span>
            <button
              type="button"
              disabled={triggerAverageScope === 'record' ? !triggerChannelName : !triggerAverageResult}
              onClick={() => setTriggerAvgModalOpen(true)}
              style={{
                background: (triggerAverageScope === 'record' ? !!triggerChannelName : !!triggerAverageResult) ? '#16a34a' : '#dcfce7',
                border: 'none',
                borderRadius: 5,
                color: '#ffffff',
                fontSize: '0.76rem',
                padding: '0.34rem 0.65rem',
                cursor: (triggerAverageScope === 'record' ? !!triggerChannelName : !!triggerAverageResult) ? 'pointer' : 'not-allowed',
                fontWeight: 700,
              }}
            >
              Abrir promedio
            </button>
          </div>
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
            onDoubleClick={handleDoubleClick}
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
          sleepSketchData={sleepSketchData}
          loading={dsaLoading || sleepSketchLoading}
          expanded={false}
          artifactEnabled={artifactReject}
          error={dsaError}
          currentStartSec={tStart}
          currentEndSec={tStart + pageDuration}
          viewerAnnotations={viewerAnnotations}
          selectedViewerAnnotationId={selectedViewerAnnotationId}
          onToggleExpand={() => setDsaExpanded(true)}
          onShowHypnogram={() => setHypnogramOpen(true)}
          onShowSleepAnalyzer={() => setSleepAnalyzerOpen(true)}
          onShowStateSpectra={() => setStateSpectraOpen(true)}
          onEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.epochSec)
          }}
          onArtifactEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.artifactEpochSec)
          }}
          onViewerAnnotationSelect={(annotationId) => jumpToViewerAnnotation(annotationId)}
        />
      ) : (
        <TimelineBar
          totalSeconds={totalSeconds}
          currentStartSec={tStart}
          currentEndSec={Math.min(totalSeconds, tStart + pageDuration)}
          annotations={edfAnnotations}
          viewerAnnotations={viewerAnnotations}
          selectedViewerAnnotationId={selectedViewerAnnotationId}
          artifactStatuses={artifactReject ? artifactMaskData?.artifactStatuses : undefined}
          artifactEpochSec={artifactReject ? artifactMaskData?.artifactEpochSec : undefined}
          onViewerAnnotationSelect={(annotationId) => jumpToViewerAnnotation(annotationId)}
          onSeek={(targetSec) => goToSecondPosition(targetSec, true)}
        />
      )}
      {dsaExpanded && dsaChannel !== 'off' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
          }}
          onClick={() => setDsaExpanded(false)}
        >
          <div
            style={{
              width: 'min(96vw, 1600px)',
              background: '#ffffff',
              borderRadius: 14,
              boxShadow: '0 30px 80px rgba(15,23,42,0.35)',
              overflow: 'hidden',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <DSAHeatmap
              data={dsaData}
              sleepSketchData={sleepSketchData}
              loading={dsaLoading || sleepSketchLoading}
              expanded
              artifactEnabled={artifactReject}
              error={dsaError}
              currentStartSec={tStart}
              currentEndSec={tStart + pageDuration}
              viewerAnnotations={viewerAnnotations}
              selectedViewerAnnotationId={selectedViewerAnnotationId}
              onToggleExpand={() => setDsaExpanded(false)}
              onShowHypnogram={() => setHypnogramOpen(true)}
              onShowSleepAnalyzer={() => setSleepAnalyzerOpen(true)}
              onShowStateSpectra={() => setStateSpectraOpen(true)}
              onEpochClick={(epochIndex) => {
                if (!dsaData) return
                goToDSAEpoch(epochIndex, dsaData.epochSec)
              }}
              onArtifactEpochClick={(epochIndex) => {
                if (!dsaData) return
                goToDSAEpoch(epochIndex, dsaData.artifactEpochSec)
              }}
              onViewerAnnotationSelect={(annotationId) => jumpToViewerAnnotation(annotationId)}
            />
          </div>
        </div>
      )}
      {hypnogramOpen && dsaChannel !== 'off' && (
        <HypnogramModal
          dsaData={dsaData}
          sleepSketchData={sleepSketchData}
          onClose={() => setHypnogramOpen(false)}
        />
      )}
      {sleepAnalyzerOpen && dsaChannel !== 'off' && (
        <SleepAnalyzerModal
          dsaData={dsaData}
          sleepSketchData={sleepSketchData}
          qeegGlobalTimeseries={qeegGlobalTimeseries}
          stateSpectralData={stateSpectralData}
          assumeSleepPresent={stateSpectralAssumeSleepPresent}
          onAssumeSleepPresentChange={setStateSpectralAssumeSleepPresent}
          artifactEnabled={artifactReject}
          dsaLoading={dsaLoading}
          sleepSketchLoading={sleepSketchLoading || qeegGlobalTimeseriesLoading || stateSpectralLoading || stateSpectralPanelsLoading}
          dsaError={dsaError}
          currentStartSec={tStart}
          currentEndSec={tStart + pageDuration}
          viewerAnnotations={viewerAnnotations}
          selectedViewerAnnotationId={selectedViewerAnnotationId}
          onClose={() => setSleepAnalyzerOpen(false)}
          onEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.epochSec)
          }}
          onArtifactEpochClick={(epochIndex) => {
            if (!dsaData) return
            goToDSAEpoch(epochIndex, dsaData.artifactEpochSec)
          }}
          onViewerAnnotationSelect={(annotationId) => jumpToViewerAnnotation(annotationId)}
        />
      )}
      {stateSpectraOpen && dsaChannel !== 'off' && (
        <StateSpectraModal
          stateSpectralPanels={stateSpectralPanels}
          onClose={() => setStateSpectraOpen(false)}
        />
      )}
      {triggerAvgModalOpen && triggerAvgOpen && (
        <TriggerAverageModal
          result={activeTriggerAverageResult}
          averageScope={triggerAverageScope}
          fullRecordLoading={fullRecordTriggerAverageLoading}
          fullRecordError={fullRecordTriggerAverageError}
          currentStartSec={tStart}
          currentEndSec={Math.min(totalSeconds, tStart + pageDuration)}
          triggerChannelName={triggerChannelName}
          triggerSignal={triggerSignalPreview}
          showTriggerContralateralOverlay={showTriggerContralateralOverlay}
          onToggleTriggerContralateralOverlay={() => setShowTriggerContralateralOverlay((value) => !value)}
          triggerOverlayChannelName={triggerOverlayChannelName}
          triggerOverlaySignal={triggerOverlaySignalPreview}
          triggerThreshold={effectiveTriggerThresholdValue}
          triggerThresholdStep={triggerThresholdStep}
          triggerDetectionMode={triggerDetectionMode}
          triggerHp={triggerHp}
          triggerLp={triggerLp}
          triggerNotch={triggerNotch}
          triggerSmoothPoints={triggerSmoothPoints}
          triggerDerivativeAfterSmooth={triggerDerivativeAfterSmooth}
          triggerBurstRearmFraction={triggerBurstRearmFraction}
          averageHp={averageHp}
          averageLp={averageLp}
          averageNotch={averageNotch}
          averageGainMult={averageGainMult}
          triggerPreSec={triggerPreSec}
          triggerPostSec={triggerPostSec}
          triggerRefractorySec={triggerRefractorySec}
          triggerRectify={triggerRectify}
          rectifyAverage={triggerRectifyAverage}
          excludeArtifactEvents={excludeArtifactEvents}
          useN2ContextGate={useN2ContextGate}
          artifactEventsAvailable={!!artifactMaskData?.artifactStatuses?.length && !!artifactMaskData?.artifactEpochSec}
          artifactMaskLoading={artifactMaskLoading}
          n2ContextLoading={n2ContextLoading}
          artifactStatuses={artifactMaskData?.artifactStatuses}
          artifactEpochSec={artifactMaskData?.artifactEpochSec}
          n2ContextEnabled={useN2ContextGate}
          n2ContextStatuses={n2ContextData?.statuses}
          n2ContextScores={n2ContextData?.scores}
          n2ContextEpochSec={n2ContextData?.contextEpochSec}
          eventSampleIndexes={scopeAlignedPageTriggerAverageResult?.rawEvents.map((event) => event.sampleIndex) ?? []}
          previewEventCount={scopeAlignedPageTriggerAverageResult?.rawEvents.length ?? 0}
          viewerAnnotationsCount={viewerAnnotations.length}
          onClose={() => setTriggerAvgModalOpen(false)}
          onCreateViewerAnnotations={createViewerAnnotationsFromTrigger}
          onClearViewerAnnotations={() => {
            setViewerAnnotations([])
            setSelectedViewerAnnotationId(null)
          }}
          onStepViewerAnnotation={stepViewerAnnotation}
          onExcludeArtifactEventsChange={() => setExcludeArtifactEvents((value) => !value)}
          onUseN2ContextGateChange={() => setUseN2ContextGate((value) => !value)}
          onTriggerChannelChange={setTriggerChannelName}
          onTriggerDetectionModeChange={setTriggerDetectionMode}
          onTriggerHpChange={setTriggerHp}
          onTriggerLpChange={setTriggerLp}
          onTriggerNotchChange={setTriggerNotch}
          onTriggerSmoothPointsChange={setTriggerSmoothPoints}
          onTriggerDerivativeAfterSmoothChange={() => setTriggerDerivativeAfterSmooth((value) => !value)}
          onTriggerBurstRearmFractionChange={setTriggerBurstRearmFraction}
          onAverageHpChange={setAverageHp}
          onAverageLpChange={setAverageLp}
          onAverageNotchChange={setAverageNotch}
          onAverageGainMultChange={setAverageGainMult}
          onTriggerPreSecChange={setTriggerPreSec}
          onTriggerPostSecChange={setTriggerPostSec}
          onTriggerRefractorySecChange={setTriggerRefractorySec}
          onTriggerRectifyChange={() => setTriggerRectify((value) => !value)}
          onRectifyAverageChange={() => setTriggerRectifyAverage((value) => !value)}
          onAverageScopeChange={setTriggerAverageScope}
          onThresholdChange={(value) => setTriggerThresholdStep(value)}
          onThresholdNudge={nudgeTriggerThreshold}
          onAutoThreshold={autoSetTriggerThreshold}
          triggerChannelOptions={triggerChannelOptions}
          presetDraftName={triggerAvgPresetDraftName}
          presetNames={triggerAveragePresetNames}
          selectedPresetName={selectedTriggerAvgPresetName}
          onPresetDraftNameChange={setTriggerAvgPresetDraftName}
          onPresetSelect={(value) => {
            setSelectedTriggerAvgPresetName(value)
            if (value) setTriggerAvgPresetDraftName(value)
          }}
          onSavePreset={saveTriggerAveragePreset}
          onLoadPreset={loadTriggerAveragePreset}
          onDeletePreset={deleteTriggerAveragePreset}
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
