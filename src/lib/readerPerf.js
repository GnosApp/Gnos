/* readerPerf.js — opt-in profiling for the reader's page-flip pipeline.
 *
 * OFF by default: every hook is a no-op until you turn it on, so shipping this
 * costs a boolean check per flip.
 *
 * Turn on in the app's devtools console:
 *     __readerPerf.on()          // start collecting
 *     …read for a bit, flip pages, cross chapters…
 *     __readerPerf.report()      // printed summary + returns the raw data
 *     __readerPerf.off()         // stop
 *
 * What it answers — the three suspects for flip lag:
 *   1. chapterLoad  — how long a chapter takes to lay out (CSS multi-column does
 *                     the WHOLE chapter at once) and how often we MISS the cache.
 *   2. flipToPaint  — input → actual painted frame for a within-chapter flip.
 *                     This is the number the user feels.
 *   3. reactRender  — how much of that is ReaderView re-rendering (setCurPage).
 */

let ON = false
const data = {
  flips: [],        // { ms, dropped, page }
  chapterLoads: [], // { ms, chapter, cached, count }
  reactRenders: [], // ms
  longFrames: [],   // { ms, since }
  scanSteps: [],    // { ms, chapter } — background index-build layouts
  tasks: {},        // { [label]: ms[] } — everything else that might stall
}

/** Time one background scan layout, so long frames can be ATTRIBUTED rather
 *  than guessed at. If scanLayout total ≈ longFrames total, the index build is
 *  the cause; if not, something else is stalling the thread. */
export function markScanStep(ms, chapter) {
  if (!ON) return
  data.scanSteps.push({ ms: +ms.toFixed(1), chapter })
}

/** Generic labelled task timing, for attributing the stall time that ISN'T the
 *  scan. Exposed as a global so other modules (storage, the notebook disk
 *  watcher) can report without importing this file — avoiding an import cycle,
 *  since this module dynamically imports storage to save the report. */
export function markTask(label, ms) {
  if (!ON) return
  ;(data.tasks[label] ||= []).push(+ms.toFixed(1))
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function stats(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const sum = s.reduce((a, b) => a + b, 0)
  const at = q => s[Math.min(s.length - 1, Math.floor(s.length * q))]
  return {
    n: s.length,
    avg: +(sum / s.length).toFixed(1),
    p50: +at(0.5).toFixed(1),
    p95: +at(0.95).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  }
}

export const perfOn = () => ON

/** Measure input → next painted frame. Call at the moment of the flip. */
export function markFlip(page) {
  if (!ON) return
  const t0 = now()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ms = now() - t0
      // >32ms ≈ missed at least one 60fps frame → user-visible hitch
      data.flips.push({ ms: +ms.toFixed(1), dropped: ms > 32, page })
    })
  })
}

/** Wrap a chapter load. `cached` = did we hit the prewarm/visited cache. */
export function markChapterStart() { return ON ? now() : null }
export function markChapterEnd(t0, { chapter, cached, count } = {}) {
  if (!ON || t0 == null) return
  data.chapterLoads.push({ ms: +(now() - t0).toFixed(1), chapter, cached: !!cached, count })
}

/** Time one ReaderView render pass (call at top of render, end in an effect). */
export function markRender(ms) {
  if (!ON) return
  data.reactRenders.push(+ms.toFixed(1))
}

// Long-frame observer — catches main-thread stalls that aren't tied to a flip
// (background index build, image decode, store writes).
// Anything above this isn't a main-thread stall — it's the window being
// backgrounded or the machine sleeping, where rAF simply stops firing. A real
// jank frame is tens/hundreds of ms; a measured session logged a bogus 207-SECOND
// "long frame" that swamped the totals and made the scan attribution read 1%.
const SUSPEND_MS = 5000

let _lfRaf = null, _lfLast = 0
function longFrameLoop() {
  const t = now()
  if (_lfLast) {
    const delta = t - _lfLast
    const suspended = (typeof document !== 'undefined' && document.hidden) || delta > SUSPEND_MS
    if (delta > 50 && !suspended) data.longFrames.push({ ms: +delta.toFixed(1), since: +t.toFixed(0) })
  }
  _lfLast = t
  _lfRaf = requestAnimationFrame(longFrameLoop)
}

function reset() {
  data.flips.length = 0
  data.chapterLoads.length = 0
  data.reactRenders.length = 0
  data.longFrames.length = 0
  data.scanSteps.length = 0
  data.tasks = {}
}

function report() {
  const cached = data.chapterLoads.filter(c => c.cached)
  const missed = data.chapterLoads.filter(c => !c.cached)
  const dropped = data.flips.filter(f => f.dropped)
  const out = {
    flipToPaint: stats(data.flips.map(f => f.ms)),
    flipsWithDroppedFrames: `${dropped.length}/${data.flips.length}`,
    chapterLoad_cacheHIT: stats(cached.map(c => c.ms)),
    chapterLoad_cacheMISS: stats(missed.map(c => c.ms)),
    cacheHitRate: data.chapterLoads.length
      ? `${Math.round((cached.length / data.chapterLoads.length) * 100)}% (${cached.length}/${data.chapterLoads.length})`
      : 'no chapter loads',
    reactRender: stats(data.reactRenders),
    longFrames_over50ms: stats(data.longFrames.map(f => f.ms)),
    scanLayout: stats(data.scanSteps.map(s => s.ms)),
    // Attribution: how much of the long-frame time the background index build
    // accounts for. High % = the scan IS the stall; low % = look elsewhere.
    stallsExplainedByScan: (() => {
      const lf = data.longFrames.reduce((a, b) => a + b.ms, 0)
      const sc = data.scanSteps.reduce((a, b) => a + b.ms, 0)
      if (!lf) return 'no long frames'
      return `${Math.round((sc / lf) * 100)}% (scan ${Math.round(sc)}ms of ${Math.round(lf)}ms)`
    })(),
    // Labelled breakdown of everything else that could be eating the thread —
    // total ms per label, biggest first. This is what identifies the ~89% of
    // stall time that the scan and chapter loads do NOT account for.
    taskTotals: (() => {
      const rows = Object.entries(data.tasks)
        .map(([label, arr]) => [label, Math.round(arr.reduce((a, b) => a + b, 0)), arr.length])
        .sort((a, b) => b[1] - a[1])
      if (!rows.length) return 'none recorded'
      return rows.map(([l, total, n]) => `${l} ${total}ms/${n}`).join('  ·  ')
    })(),
  }
  /* eslint-disable no-console */
  console.log('%c[reader-perf] summary (ms)', 'font-weight:bold')
  console.table(out)
  console.log('[reader-perf] verdict:', verdict(out))
  console.log('[reader-perf] raw:', data)
  /* eslint-enable no-console */
  return out
}

// Point at the dominant cost so the fix is targeted, not guessed.
function verdict(o) {
  const notes = []
  if (o.chapterLoad_cacheMISS && o.chapterLoad_cacheMISS.p50 > 80)
    notes.push(`chapter cache MISSES are slow (p50 ${o.chapterLoad_cacheMISS.p50}ms) → full-chapter column layout is the bottleneck; prewarm harder or window the layout`)
  const hitRate = parseInt(o.cacheHitRate, 10)
  if (!Number.isNaN(hitRate) && hitRate < 70)
    notes.push(`low cache hit rate (${o.cacheHitRate}) → neighbor prewarm isn't keeping up with how fast chapters are crossed`)
  if (o.reactRender && o.reactRender.p95 > 8)
    notes.push(`ReaderView re-render is heavy (p95 ${o.reactRender.p95}ms) → split page furniture from the view so setCurPage doesn't re-render everything`)
  if (o.flipToPaint && o.flipToPaint.p95 > 32)
    notes.push(`flips are missing frames (p95 ${o.flipToPaint.p95}ms to paint)`)
  if (o.longFrames_over50ms && o.longFrames_over50ms.n > 10)
    notes.push(`${o.longFrames_over50ms.n} long frames (max ${o.longFrames_over50ms.max}ms) → background work is stalling the main thread while reading`)
  return notes.length ? notes : ['nothing above threshold — flips look healthy in this sample']
}

// ── Devtools-free reporting ──────────────────────────────────────────────────
// Opening the inspector blanks the app window (WKWebView repaint bug), so the
// report must be readable WITHOUT devtools: it renders as an in-app overlay and
// is written to the app's local (per-machine) cache as `reader_perf_report.json`
// — a debug snapshot has no business syncing across devices via the archive.

function fmt(s) { return s ? `n=${s.n}  p50=${s.p50}  p95=${s.p95}  max=${s.max}` : '—' }

function showOverlay(o) {
  if (typeof document === 'undefined') return
  document.getElementById('gnos-perf-overlay')?.remove()
  const el = document.createElement('div')
  el.id = 'gnos-perf-overlay'
  el.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px',
    'max-width:min(520px,92vw)', 'max-height:70vh', 'overflow:auto',
    'background:var(--surface,#1c1c1e)', 'color:var(--text,#fff)',
    'border:1px solid var(--border,#444)', 'border-radius:12px',
    'padding:14px 16px', 'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    'box-shadow:0 16px 48px rgba(0,0,0,0.5)', 'white-space:pre-wrap',
  ].join(';')
  const verdictLines = (o._verdict || []).map(v => `  • ${v}`).join('\n')
  el.textContent =
    `READER PERF (ms)\n` +
    `─────────────────────────────\n` +
    `flip → paint    ${fmt(o.flipToPaint)}\n` +
    `dropped frames  ${o.flipsWithDroppedFrames}\n` +
    `chapter HIT     ${fmt(o.chapterLoad_cacheHIT)}\n` +
    `chapter MISS    ${fmt(o.chapterLoad_cacheMISS)}\n` +
    `cache hit rate  ${o.cacheHitRate}\n` +
    `React render    ${fmt(o.reactRender)}\n` +
    `long frames     ${fmt(o.longFrames_over50ms)}\n` +
    `scan layout     ${fmt(o.scanLayout)}\n` +
    `stalls = scan?  ${o.stallsExplainedByScan}\n` +
    `other work      ${o.taskTotals}\n` +
    `─────────────────────────────\nVERDICT\n${verdictLines}\n\n` +
    `saved locally: reader_perf_report.json`
  const close = document.createElement('button')
  close.textContent = 'close'
  close.style.cssText = 'margin-top:10px;padding:4px 10px;border-radius:6px;border:1px solid var(--border,#444);background:none;color:inherit;cursor:pointer;font:inherit'
  close.onclick = () => el.remove()
  el.appendChild(close)
  document.body.appendChild(el)
}

async function saveReport(o) {
  try {
    const { setLocalJSON } = await import('@/lib/storage')
    await setLocalJSON('reader_perf_report', { at: new Date().toISOString(), ...o, raw: data })
  } catch { /* non-fatal — the overlay still shows the numbers */ }
}

/** Full report: console (if open) + on-screen overlay + written to disk. */
function reportAll() {
  const o = report()
  o._verdict = verdict(o)
  showOverlay(o)
  saveReport(o)
  return o
}

if (typeof window !== 'undefined') {
  window.__readerPerf = {
    on() { ON = true; reset(); if (!_lfRaf) { _lfLast = 0; longFrameLoop() } return 'reader-perf ON — read/flip, then __readerPerf.report()' },
    off() { ON = false; if (_lfRaf) { cancelAnimationFrame(_lfRaf); _lfRaf = null } return 'reader-perf OFF' },
    report: reportAll, reset, data,
  }
  // Global hook so modules that this file (indirectly) depends on — storage,
  // the notebook disk watcher — can report timings without an import cycle.
  window.__perfTask = markTask
  // Driven by the `/perf …` search commands so no devtools are needed.
  window.addEventListener('gnos:perf-cmd', e => {
    const cmd = e.detail?.cmd
    if (cmd === 'on') window.__readerPerf.on()
    else if (cmd === 'off') { window.__readerPerf.off(); document.getElementById('gnos-perf-overlay')?.remove() }
    else if (cmd === 'report') reportAll()
  })
}
