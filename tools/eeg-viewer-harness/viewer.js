/**
 * Standalone EEG Viewer — vanilla JS harness.
 * Loads an EDF via /edf, mounts it into WASM MEMFS, and renders it.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_COLORS = {
  EEG:  '#1d4ed8',
  EOG:  '#047857',
  ECG:  '#dc2626',
  EMG:  '#b45309',
  RESP: '#7c3aed',
}
const DEFAULT_COLOR  = '#475569'
const LABEL_WIDTH    = 76
const CHANNEL_HEIGHT = 80
const SB_BAR_W       = 12
const SB_TARGET_PX   = Math.round(CHANNEL_HEIGHT * 0.75)

const GAIN_OPTIONS = [0.1, 0.3, 0.5, 0.7, 1, 2, 4]

// ─── State ────────────────────────────────────────────────────────────────────

let kappa = null
let moduleInstance = null
let epoch = null
let page = 0
let totalSeconds = 0
let meta = null

let windowSecs = 10
let hp = 0.5
let lp = 45
let notch = true
let gainMult = 1
let normalizeNonEEG = false

let mousePos = null
let mouseOn = false
let sbPos = null
let sbDrag = null
let renderMeta = null

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const els = {
  loading:   document.getElementById('loading'),
  loadMsg:   document.getElementById('load-msg'),
  error:     document.getElementById('error'),
  errorMsg:  document.getElementById('error-msg'),
  app:       document.getElementById('app'),
  canvas:    document.getElementById('main-canvas'),
  overlay:   document.getElementById('overlay'),
  wrap:      document.getElementById('canvas-wrap'),
  metaText:  document.getElementById('meta-text'),
  hp:        document.getElementById('hp-select'),
  lp:        document.getElementById('lp-select'),
  notch:     document.getElementById('notch-select'),
  window:    document.getElementById('window-select'),
  gain:      document.getElementById('gain-select'),
  normBtn:   document.getElementById('norm-btn'),
  prevBtn:   document.getElementById('prev-btn'),
  nextBtn:   document.getElementById('next-btn'),
  pageInfo:  document.getElementById('page-info'),
  timeOffset: document.getElementById('time-offset'),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setPhase(phase, msg = '') {
  const messages = {
    'loading-module': 'Loading EEG module…',
    'fetching':       'Fetching EDF file…',
    'opening':        'Opening EDF…',
    'viewing':        '',
    'error':          '',
  }
  const text = msg || messages[phase] || ''
  if (phase === 'error') {
    els.loading.style.display = 'none'
    els.app.style.display = 'none'
    els.error.style.display = 'flex'
    els.errorMsg.textContent = msg
  } else if (phase === 'viewing') {
    els.loading.style.display = 'none'
    els.error.style.display = 'none'
    els.app.style.display = 'flex'
  } else {
    els.loading.style.display = 'flex'
    els.error.style.display = 'none'
    els.app.style.display = 'none'
    els.loadMsg.textContent = text
  }
}

function zscoreNormalize(data) {
  const n = data.length
  if (n === 0) return data
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

function niceRound(v) {
  if (v <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  if (n < 1.5) return mag
  if (n < 3.5) return 2 * mag
  if (n < 7.5) return 5 * mag
  return 10 * mag
}

function fmtTimeGrid(sec) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    return s > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${h}:${String(m).padStart(2,'0')}`
  }
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2,'0')}`
  return `${sec}`
}

function computeScales(epochData, gainMult, normalizeNonEEG) {
  const perCh = epochData.data.map((d) => {
    const sorted = Float32Array.from(d).sort()
    return {
      p2:     sorted[Math.floor(sorted.length * 0.02)] ?? 0,
      p98:    sorted[Math.floor(sorted.length * 0.98)] ?? 0,
      center: sorted[Math.floor(sorted.length * 0.5)]  ?? 0,
    }
  })

  const refIdxs = normalizeNonEEG
    ? epochData.channelTypes.map((t, i) => (t === 'EEG' ? i : -1)).filter((i) => i >= 0)
    : perCh.map((_, i) => i)

  const refRanges = (refIdxs.length > 0 ? refIdxs : perCh.map((_, i) => i))
    .map((i) => perCh[i].p98 - perCh[i].p2)
    .filter((r) => r > 0)
    .sort((a, b) => a - b)

  const refRange = refRanges.length > 0 ? refRanges[Math.floor(refRanges.length * 0.5)] : 1
  const halfRange = refRange / gainMult / 2

  const scales = perCh.map((s, i) => {
    const type = epochData.channelTypes[i] ?? 'EEG'
    if (normalizeNonEEG && type !== 'EEG') return { p2: s.p2, p98: s.p98 }
    return { p2: s.center - halfRange, p98: s.center + halfRange }
  })

  return { scales, refRange }
}

function computeSBSize(canvasH, refRange, gainMult) {
  const drawH = CHANNEL_HEIGHT * 0.8
  const pxPerUV = (drawH * gainMult) / refRange
  const sbHalfMuV = niceRound(SB_TARGET_PX / (2 * pxPerUV))
  const sbPxH = Math.max(20, Math.min(canvasH * 0.35, sbHalfMuV * 2 * pxPerUV))
  return { sbHalfMuV, sbPxH }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function drawEpoch(canvas, epochData, scales, tStart, windowSecs) {
  canvas.width  = canvas.offsetWidth || 1200
  canvas.height = epochData.nChannels * CHANNEL_HEIGHT

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const W = canvas.width
  const waveW = W - LABEL_WIDTH

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, canvas.height)

  // Time grid
  {
    const tEnd = tStart + windowSecs
    const firstTick = Math.ceil(tStart + 1e-9)
    const MIN_LBL = 42

    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.09)'
    ctx.lineWidth   = 1
    ctx.setLineDash([2, 4])
    ctx.fillStyle    = '#94a3b8'
    ctx.font         = '9px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'

    let prevLblX = -Infinity
    for (let t = firstTick; t < tEnd; t++) {
      const x = LABEL_WIDTH + ((t - tStart) / windowSecs) * waveW
      if (x <= LABEL_WIDTH + 1 || x >= W - 1) continue
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
      if (x - prevLblX >= MIN_LBL) {
        ctx.fillText(fmtTimeGrid(t), x, 3)
        prevLblX = x
      }
    }
    ctx.restore()
  }

  // Channel rows
  for (let c = 0; c < epochData.nChannels; c++) {
    const y0    = c * CHANNEL_HEIGHT
    const data  = epochData.data[c]
    const type  = epochData.channelTypes[c] ?? 'EEG'
    const name  = epochData.channelNames[c]  ?? `Ch${c + 1}`
    const color = CHANNEL_COLORS[type]   ?? DEFAULT_COLOR
    const { p2, p98 } = scales[c] ?? { p2: 0, p98: 1 }
    const range = p98 - p2 || 1

    if (c % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.018)'
      ctx.fillRect(LABEL_WIDTH, y0, waveW, CHANNEL_HEIGHT)
    }

    ctx.fillStyle = '#f8fafc'
    ctx.fillRect(0, y0, LABEL_WIDTH, CHANNEL_HEIGHT)

    ctx.fillStyle = color
    ctx.font      = 'bold 11px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(name.slice(0, 9), 4, y0 + 24)

    ctx.fillStyle = '#64748b'
    ctx.font      = '9px monospace'
    ctx.fillText(type.slice(0, 6), 4, y0 + 38)

    if (data.length < 2) continue

    const margin = CHANNEL_HEIGHT * 0.1
    const drawH  = CHANNEL_HEIGHT - margin * 2

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

    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth   = 1
    ctx.beginPath(); ctx.moveTo(0, y0 + CHANNEL_HEIGHT); ctx.lineTo(W, y0 + CHANNEL_HEIGHT); ctx.stroke()

    ctx.strokeStyle = '#cbd5e1'
    ctx.beginPath(); ctx.moveTo(LABEL_WIDTH, y0); ctx.lineTo(LABEL_WIDTH, y0 + CHANNEL_HEIGHT); ctx.stroke()
  }
}

function drawOverlay(overlay, meta, mousePos, mouseOn, sbPos) {
  const { tStart, windowSecs, W, H, sbHalfMuV, sbPxH } = meta
  overlay.width  = W
  overlay.height = H

  const octx = overlay.getContext('2d')
  if (!octx) return

  const waveW = W - LABEL_WIDTH

  // Scale bar
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

  octx.fillStyle    = '#64748b'
  octx.font         = '9px monospace'
  octx.textBaseline = 'middle'
  const lY = sbY + sbPxH / 2
  if (sbX - LABEL_WIDTH > 44) {
    octx.textAlign = 'right'
    octx.fillText(`±${sbHalfMuV} µV`, sbX - 4, lY)
  } else {
    octx.textAlign = 'left'
    octx.fillText(`±${sbHalfMuV} µV`, sbX + SB_BAR_W + 4, lY)
  }
  octx.restore()

  // Cursor + tooltip
  if (!mouseOn || !mousePos || mousePos.x < LABEL_WIDTH || mousePos.x > W) return

  const { x } = mousePos
  octx.save()
  octx.strokeStyle = 'rgba(37,99,235,0.45)'
  octx.lineWidth   = 1
  octx.setLineDash([])
  octx.beginPath(); octx.moveTo(x, 0); octx.lineTo(x, H); octx.stroke()

  const t     = tStart + ((x - LABEL_WIDTH) / waveW) * windowSecs
  const label = `${t.toFixed(2)} s`
  octx.font = '10px monospace'
  const tw   = octx.measureText(label).width
  const tpW  = tw + 10, tpH = 18
  let tpX = x + 8, tpY = 6
  if (tpX + tpW > W - 4) tpX = x - tpW - 8

  octx.fillStyle   = 'rgba(248,250,252,0.95)'
  octx.strokeStyle = '#cbd5e1'
  octx.lineWidth   = 1
  octx.beginPath(); octx.rect(tpX, tpY, tpW, tpH); octx.fill(); octx.stroke()

  octx.fillStyle    = '#1d4ed8'
  octx.textAlign    = 'left'
  octx.textBaseline = 'middle'
  octx.fillText(label, tpX + 5, tpY + tpH / 2)
  octx.restore()
}

// ─── Main redraw ──────────────────────────────────────────────────────────────

function refreshOverlay() {
  if (!renderMeta) return
  drawOverlay(els.overlay, renderMeta, mousePos, mouseOn, sbPos)
}

function redraw() {
  if (!epoch || !els.canvas) return
  const processed = normalizeNonEEG
    ? { ...epoch, data: epoch.data.map((d, i) => (epoch.channelTypes[i] !== 'EEG' ? zscoreNormalize(d) : d)) }
    : epoch

  const { scales, refRange } = computeScales(processed, gainMult, normalizeNonEEG)
  const tStart = page * windowSecs

  drawEpoch(els.canvas, processed, scales, tStart, windowSecs)
  const { sbHalfMuV, sbPxH } = computeSBSize(els.canvas.height, refRange, gainMult)
  renderMeta = { tStart, windowSecs, W: els.canvas.width, H: els.canvas.height, sbHalfMuV, sbPxH }
  refreshOverlay()

  // Update pagination UI
  const maxPage = Math.max(0, Math.ceil(totalSeconds / windowSecs) - 1)
  els.prevBtn.disabled = page === 0
  els.nextBtn.disabled = page >= maxPage
  els.pageInfo.textContent = `${page + 1} / ${maxPage + 1}`
  els.timeOffset.textContent = `t = ${page * windowSecs}s`
}

function readAndRedraw() {
  if (!kappa) return
  const e = kappa.readEpoch(page * windowSecs, windowSecs)
  if (e) {
    epoch = e
    redraw()
  }
}

// ─── WASM loading ─────────────────────────────────────────────────────────────

function loadModule() {
  return new Promise((resolve, reject) => {
    if (moduleInstance) return resolve(moduleInstance)

    const attempt = () => {
      if (!window.KappaModule) {
        return reject(new Error('KappaModule not loaded — check script tag'))
      }
      window.KappaModule().then((m) => {
        moduleInstance = m
        resolve(m)
      }).catch(reject)
    }

    if (window.KappaModule) {
      attempt()
    } else {
      let waited = 0
      const poll = setInterval(() => {
        if (window.KappaModule) {
          clearInterval(poll)
          attempt()
        }
        waited += 50
        if (waited > 10000) {
          clearInterval(poll)
          reject(new Error('KappaModule not available after 10s'))
        }
      }, 50)
    }
  })
}

// ─── Fetch EDF and open ───────────────────────────────────────────────────────

async function init() {
  try {
    setPhase('loading-module')
    const Module = await loadModule()

    setPhase('fetching')
    const res = await fetch('/edf')
    if (!res.ok) throw new Error(`Failed to fetch EDF: ${res.status}`)
    const buf = await res.arrayBuffer()

    setPhase('opening')
    kappa = new Module.KappaWasm()
    Module.FS.writeFile('/tmp/file.edf', new Uint8Array(buf))
    if (!kappa.openEDF('/tmp/file.edf')) {
      throw new Error('openEDF returned false — invalid EDF')
    }

    const info = kappa.getMeta()
    kappa.setFilters(hp, lp, notch ? 50 : 0)
    meta = { subjectId: info.subjectId, recordingDate: info.recordingDate }
    totalSeconds = Math.floor(info.numSamples / info.sampleRate)

    const firstEpoch = kappa.readEpoch(0, windowSecs)
    if (!firstEpoch) throw new Error('readEpoch returned null')
    epoch = firstEpoch
    page = 0

    if (meta) {
      els.metaText.textContent = `${meta.subjectId} · ${meta.recordingDate}`
    }

    setPhase('viewing')
    requestAnimationFrame(redraw)
  } catch (err) {
    console.error(err)
    setPhase('error', err instanceof Error ? err.message : String(err))
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

els.wrap.addEventListener('mousemove', (e) => {
  const rect = els.canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  mousePos = { x, y }
  mouseOn = true

  if (sbDrag) {
    if (renderMeta) {
      const nx = Math.max(LABEL_WIDTH + 4, Math.min(renderMeta.W - SB_BAR_W - 4, sbDrag.startSBX + x - sbDrag.startMX))
      const ny = Math.max(4, Math.min(renderMeta.H - renderMeta.sbPxH - 4, sbDrag.startSBY + y - sbDrag.startMY))
      sbPos = { x: nx, y: ny }
    }
  }
  refreshOverlay()
})

els.wrap.addEventListener('mouseleave', () => {
  mouseOn = false
  sbDrag = null
  refreshOverlay()
})

els.wrap.addEventListener('mousedown', (e) => {
  if (!renderMeta) return
  const rect = els.canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  const sbX = sbPos ? sbPos.x : renderMeta.W - SB_BAR_W - 18
  const sbY = sbPos ? sbPos.y : renderMeta.H - renderMeta.sbPxH - 22
  const pad = 8
  if (x >= sbX - pad && x <= sbX + SB_BAR_W + pad && y >= sbY - pad && y <= sbY + renderMeta.sbPxH + pad) {
    sbDrag = { startMX: x, startMY: y, startSBX: sbX, startSBY: sbY }
    e.preventDefault()
  }
})

window.addEventListener('mouseup', () => {
  sbDrag = null
})

// Keyboard
window.addEventListener('keydown', (e) => {
  if (!epoch) return
  const maxPage = Math.max(0, Math.ceil(totalSeconds / windowSecs) - 1)
  if (e.key === 'ArrowLeft' && page > 0) {
    page--
    readAndRedraw()
  }
  if (e.key === 'ArrowRight' && page < maxPage) {
    page++
    readAndRedraw()
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const idx = GAIN_OPTIONS.indexOf(gainMult)
    gainMult = GAIN_OPTIONS[Math.min(idx + 1, GAIN_OPTIONS.length - 1)]
    els.gain.value = String(gainMult)
    redraw()
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const idx = GAIN_OPTIONS.indexOf(gainMult)
    gainMult = GAIN_OPTIONS[Math.max(idx - 1, 0)]
    els.gain.value = String(gainMult)
    redraw()
  }
})

// Controls
els.hp.addEventListener('change', (e) => {
  hp = parseFloat(e.target.value)
  if (kappa) { kappa.setFilters(hp, lp, notch ? 50 : 0); readAndRedraw() }
})
els.lp.addEventListener('change', (e) => {
  lp = parseFloat(e.target.value)
  if (kappa) { kappa.setFilters(hp, lp, notch ? 50 : 0); readAndRedraw() }
})
els.notch.addEventListener('change', (e) => {
  notch = e.target.value === '1'
  if (kappa) { kappa.setFilters(hp, lp, notch ? 50 : 0); readAndRedraw() }
})
els.window.addEventListener('change', (e) => {
  const newWin = parseInt(e.target.value)
  page = Math.floor((page * windowSecs) / newWin)
  windowSecs = newWin
  if (kappa) readAndRedraw()
})
els.gain.addEventListener('change', (e) => {
  gainMult = parseFloat(e.target.value)
  redraw()
})
els.normBtn.addEventListener('click', () => {
  normalizeNonEEG = !normalizeNonEEG
  els.normBtn.classList.toggle('active', normalizeNonEEG)
  els.normBtn.textContent = normalizeNonEEG ? 'z-score ✓' : 'z-score'
  redraw()
})
els.prevBtn.addEventListener('click', () => {
  if (page > 0) { page--; readAndRedraw() }
})
els.nextBtn.addEventListener('click', () => {
  const maxPage = Math.max(0, Math.ceil(totalSeconds / windowSecs) - 1)
  if (page < maxPage) { page++; readAndRedraw() }
})

// Resize observer
const ro = new ResizeObserver(() => {
  if (epoch) redraw()
})
ro.observe(els.canvas)

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  try { moduleInstance?.FS.unlink('/tmp/file.edf') } catch { /* ignore */ }
})

// ─── Start ────────────────────────────────────────────────────────────────────

init()
