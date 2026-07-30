// ─────────────────────────────────────────────────────────────────────────────
// PaginationEngine.js — CSS-columns pagination, single-render strip (D3)
//
// Render pipeline per chapter:
//   1. renderChapterContent()  — innerHTML into _strip (full multi-column)
//   2. measurePageCount()      — reads last-element rect to count columns
//   3. trimContainerWidth()    — shrinks _strip to real column count
//   4. showPage(idx, trans)    — translateX(-idx * (colW+colGap)) on the strip
//   5. revealContent()         — fades overlay out
//
// The chapter is laid out ONCE by the browser's column engine and stays in the
// DOM. Paging is a transform on the strip inside a clipped wrapper — no
// per-page cloning, no rect-driven extraction, no boundary splitting.
// Two-page spread: the wrapper is wide enough to show two columns; the caller
// advances the page index by 2 and the translate lands on the left column.
//
// Background chapter scanning uses a separate hidden container (_scanEl) so it
// never disturbs the visible strip.
// ─────────────────────────────────────────────────────────────────────────────

// ── Module state ──────────────────────────────────────────────────────────────
let _pageStyleEl  = null
let _wrapWords    = false
let _colW         = 0       // width of one CSS column (= one logical page)
let _colGap       = 0       // gap between columns
let _twoPage      = false
let _colH         = 0       // column / viewport height (px)
let _strip        = null    // the ONE rendered multi-column chapter (visible)
let _wrapper      = null    // overflow:hidden clip div
let _overlay      = null    // solid cover — hides render/layout work
let _scanEl       = null    // hidden measuring container for the background scan

let _lastNavTime  = 0
let _fadeTimer    = null

// Background chapter scan
let _scanAbort    = false

// Chapter cache — keyed by chapter index. Stores the rendered HTML + count so
// revisiting a chapter skips string building and page-count measurement.
// Cleared on invalidateCache() / handleRebuild (layout params change).
let _chapterCache = {}   // { [chIdx]: { count, html } }

// ── HTML builders ─────────────────────────────────────────────────────────────

export function blocksToHTML(blocks) {
  return blocks.map(b => {
    if (!b?.text?.trim() && b?.type !== 'cover' && b?.type !== 'image') return ''
    if (b.type === 'cover')      return `<img src="${b.src}" alt="Book cover" class="cover-img">`
    if (b.type === 'pdfPage')    return `<img src="${b.src}" alt="" class="pdf-page-img">`
    if (b.type === 'image')      return `<img src="${b.src}" alt="" class="epub-inline-img">`
    if (b.type === 'heading')    return `<h2>${b.text}</h2>`
    if (b.type === 'subheading') return `<h3>${b.text}</h3>`
    return `<p>${b.text}</p>`
  }).join('\n')
}

export function setWordWrapEnabled(enabled) { _wrapWords = !!enabled }

export function blocksToDisplayHTML(blocks) {
  return blocks.map(b => {
    if (!b?.text?.trim() && b?.type !== 'cover' && b?.type !== 'image') return ''
    if (b.type === 'cover')      return `<img src="${b.src}" alt="Book cover" class="cover-img">`
    if (b.type === 'pdfPage')    return `<img src="${b.src}" alt="" class="pdf-page-img">`
    if (b.type === 'image')      return `<img src="${b.src}" alt="" class="epub-inline-img">`
    if (b.type === 'heading')    return `<h2>${b.text}</h2>`
    if (b.type === 'subheading') return `<h3>${b.text}</h3>`
    if (_wrapWords) {
      const wrapped = b.text.replace(/(\S+)/g, w => {
        const clean = w.replace(/[^a-zA-Z'’-]/g, '')
        return `<span class="col-word" data-word="${clean}">${w}</span>`
      })
      return `<p>${wrapped}</p>`
    }
    return `<p>${b.text}</p>`
  }).join('\n')
}

// ── Typography CSS ────────────────────────────────────────────────────────────
// Padding is applied to child elements so it is consistent on every page.

export function buildPageStyles(prefs) {
  const fs      = prefs.fontSize    || 18
  const ls      = prefs.lineSpacing || 1.6
  const ff      = prefs.fontFamily  || 'Georgia, serif'
  const paraGap = Math.round(fs * 0.55)
  const justify = prefs.justifyText !== false ? 'justify' : 'left'

  return `
    .col-container {
      font-family: ${ff};
      font-size: ${fs}px;
      line-height: ${ls};
      color: var(--readerText);
      text-rendering: optimizeLegibility;
      hyphens: auto;
      -webkit-hyphenate-limit-before: 3;
      -webkit-hyphenate-limit-after: 3;
      -webkit-hyphenate-limit-lines: 2;
      font-kerning: normal;
      box-sizing: border-box;
    }
    .col-container > * {
      padding-left: 40px;
      padding-right: 40px;
      box-sizing: border-box;
    }
    .col-container > img {
      padding-left: 0;
      padding-right: 0;
    }
    .col-container > p:first-child,
    .col-container > h2:first-child,
    .col-container > h3:first-child { margin-top: 0; }
    .col-container p {
      margin: 0 0 ${paraGap}px;
      text-align: ${justify};
      hanging-punctuation: first last;
      font-feature-settings: "kern" 1, "liga" 1, "onum" 1;
      orphans: 2; widows: 2;
      text-indent: 2em;
      text-wrap: pretty;
    }
    .col-container h2 + p,
    .col-container h3 + p { text-indent: 0; }
    .col-container h2 {
      font-family: Georgia, serif;
      font-size: ${Math.round(fs * 1.45)}px;
      font-weight: 600; line-height: 1.25;
      text-align: center; letter-spacing: 0.05em;
      margin: 1.8em 0 0.9em; text-indent: 0;
      break-before: auto; break-inside: auto; break-after: avoid;
    }
    .col-container h3 {
      font-family: Georgia, serif;
      font-size: ${Math.round(fs * 1.1)}px;
      font-weight: 600; line-height: 1.3;
      margin: 1em 0 0.4em; text-indent: 0;
      break-before: auto; break-inside: auto; break-after: avoid;
    }
    .col-container .cover-img {
      display: block;
      width: 100%;
      height: var(--col-h, 600px);
      object-fit: contain;
      border-radius: 0;
    }
    .col-container .epub-inline-img {
      width: 100%;
      max-height: var(--col-h, 600px);
      height: auto; display: block; margin: 0 auto; border-radius: 4px;
      object-fit: contain;
    }
    .pdf-fill-page .pdf-page-img {
      width: 100% !important; height: 100% !important;
      object-fit: contain !important; display: block; background: #fff;
    }
    .highlight-words .col-word:hover {
      background: rgba(56,139,253,0.22); border-radius: 2px; cursor: default;
    }
    .col-word.reader-hl {
      border-radius: 1px; cursor: pointer;
    }
    .col-word.hl-yellow { background: rgba(255,210,0,0.55); box-shadow: 3px 0 0 rgba(255,210,0,0.55), -1px 0 0 rgba(255,210,0,0.55); color: #1a1200; }
    .col-word.hl-yellow:hover { background: rgba(255,210,0,0.75); box-shadow: 3px 0 0 rgba(255,210,0,0.75), -1px 0 0 rgba(255,210,0,0.75); }
    .col-word.hl-green  { background: rgba(72,199,116,0.5);  box-shadow: 3px 0 0 rgba(72,199,116,0.5),  -1px 0 0 rgba(72,199,116,0.5);  color: #0a2e14; }
    .col-word.hl-green:hover  { background: rgba(72,199,116,0.7);  box-shadow: 3px 0 0 rgba(72,199,116,0.7),  -1px 0 0 rgba(72,199,116,0.7);  }
    .col-word.hl-pink   { background: rgba(255,105,180,0.45); box-shadow: 3px 0 0 rgba(255,105,180,0.45), -1px 0 0 rgba(255,105,180,0.45); color: #3a0020; }
    .col-word.hl-pink:hover   { background: rgba(255,105,180,0.65); box-shadow: 3px 0 0 rgba(255,105,180,0.65), -1px 0 0 rgba(255,105,180,0.65); }
    .col-word.hl-blue   { background: rgba(79,195,247,0.45);  box-shadow: 3px 0 0 rgba(79,195,247,0.45),  -1px 0 0 rgba(79,195,247,0.45);  color: #001e30; }
    .col-word.hl-blue:hover   { background: rgba(79,195,247,0.65);  box-shadow: 3px 0 0 rgba(79,195,247,0.65),  -1px 0 0 rgba(79,195,247,0.65);  }
    .col-word.hl-purple { background: rgba(179,136,255,0.45); box-shadow: 3px 0 0 rgba(179,136,255,0.45), -1px 0 0 rgba(179,136,255,0.45); color: #1a0035; }
    .col-word.hl-purple:hover { background: rgba(179,136,255,0.65); box-shadow: 3px 0 0 rgba(179,136,255,0.65), -1px 0 0 rgba(179,136,255,0.65); }
    .col-word.tts-word-active {
      background: rgba(56,139,253,0.28); border-radius: 2px;
    }
    .underline-line .col-word.same-line {
      text-decoration: underline;
      text-decoration-color: rgba(56,139,253,0.55);
      text-underline-offset: 3px;
    }
  `
}

export function ensurePageStyle(prefs) {
  if (!_pageStyleEl) {
    _pageStyleEl = document.createElement('style')
    _pageStyleEl.id = 'gnos-page-style'
    document.head.appendChild(_pageStyleEl)
  }
  _pageStyleEl.textContent = buildPageStyles(prefs)
}

// ── Column setup ──────────────────────────────────────────────────────────────

// Top gap between the header border and the first line of text on every page.
const COL_TOP_PAD = 20

// Bottom gap reserving room for the on-paper page numbers (Books-style furniture).
const COL_BOTTOM_PAD = 28

// Extra pixels subtracted from strip column height vs wrapper height.
// CSS columns break this many pixels before the wrapper's edge, preventing
// last-line clipping when content renders fractionally taller.
const BOTTOM_SAFETY = 4

// Initial strip width in columns, before trimContainerWidth() narrows it.
const MAX_COLS = 100

function _columnCSS(heightPx, widthPx) {
  return [
    `column-width:${_colW}px`,
    'column-fill:auto',
    `column-gap:${_colGap}px`,
    `height:${heightPx}px`,
    `width:${widthPx}px`,
    'overflow-y:hidden',
    'word-break:break-word',
  ].join(';')
}

export function setupColumns(cardEl, prefs) {
  if (!cardEl) return

  cardEl.innerHTML = ''

  const w   = cardEl.clientWidth
  const h   = cardEl.clientHeight - COL_TOP_PAD - COL_BOTTOM_PAD
  const gap = prefs.twoPage ? 64 : 0

  _colW    = prefs.twoPage ? Math.floor((w - gap) / 2) : w
  _colGap  = gap
  _twoPage = !!prefs.twoPage
  _colH    = h

  _wrapper = document.createElement('div')
  // contain isolates the reader's (huge) column layout from the rest of the app —
  // strip re-layouts never invalidate outside the wrapper.
  _wrapper.style.cssText = `overflow:hidden;width:100%;height:100%;position:relative;padding-top:${COL_TOP_PAD}px;box-sizing:border-box;contain:layout style paint;`
  // Correct lang enables WebKit's real hyphenation dictionaries (hyphens:auto
  // is a no-op without it).
  if (prefs.lang) _wrapper.lang = prefs.lang

  // The strip: ONE multi-column render of the chapter. Visible. Paging is a
  // translateX of this element inside the clipped wrapper.
  const stripH = h - BOTTOM_SAFETY
  _strip = document.createElement('div')
  _strip.className = 'col-container page-content'
  // NO permanent will-change: the strip is the whole chapter (tens of thousands
  // of px wide). A permanent compositor layer of that size holds cold tiles that
  // stall the first flip into never-shown columns. Instead we promote only while
  // the user is actively flipping (promoteStrip) and drop it when idle.
  _strip.style.cssText = _columnCSS(stripH, MAX_COLS * (_colW + _colGap))
  _strip.style.setProperty('--col-h', stripH + 'px')

  // Hidden measuring container for the background scan — same column geometry,
  // never visible, never translated.
  _scanEl = document.createElement('div')
  _scanEl.className = 'col-container'   // NOT page-content — out of TTS/highlight queries
  _scanEl.style.cssText = _columnCSS(stripH, MAX_COLS * (_colW + _colGap)) +
    ';position:absolute;top:' + COL_TOP_PAD + 'px;left:0;opacity:0;pointer-events:none'
  _scanEl.style.setProperty('--col-h', stripH + 'px')

  // Overlay covers everything (z-index:1) while new content is being laid out.
  _overlay = document.createElement('div')
  _overlay.style.cssText = 'position:absolute;inset:0;background:var(--readerCard);z-index:1;pointer-events:none;'

  _wrapper.appendChild(_strip)
  _wrapper.appendChild(_scanEl)
  _wrapper.appendChild(_overlay)
  cardEl.appendChild(_wrapper)
}

// ── Chapter rendering ─────────────────────────────────────────────────────────
// Loads content into the strip and raises the overlay.
// Call measurePageCount() → trimContainerWidth() → showPage() inside a rAF,
// then revealContent().

export function renderChapterContent(blocks) {
  _scanAbort = true    // cancel any in-flight background scan
  if (!_strip) return
  if (_overlay) { _overlay.style.transition = 'none'; _overlay.style.opacity = '1' }
  // Full width for accurate column layout; trimContainerWidth narrows afterwards.
  _strip.style.width = (MAX_COLS * (_colW + _colGap)) + 'px'
  _strip.innerHTML = blocksToDisplayHTML(blocks)
}

// ── Double-buffered chapter swaps ─────────────────────────────────────────────
// Chapter transitions used to raise a solid overlay while the new chapter laid
// out in the visible strip — a jarring blank flash. Instead: render the new
// chapter into the hidden buffer (identical column geometry), then atomically
// swap the two elements' roles. The old page stays on screen until the exact
// frame the new one is ready; layout is never repeated on swap.

// Render blocks (or prebuilt cached HTML) into the hidden buffer.
export function renderChapterIntoBuffer(blocks, cachedHtml = null) {
  _scanAbort = true    // the buffer doubles as the scan container — take it over
  if (!_scanEl) return false
  _scanEl.style.width = (MAX_COLS * (_colW + _colGap)) + 'px'
  _scanEl.innerHTML = cachedHtml ?? blocksToDisplayHTML(blocks)
  return true
}

// Measure the buffer, swap it in as the visible strip, translate to pageIdx.
// The old strip becomes the next buffer. Returns the page count.
export function swapBufferToStrip(pageIdx) {
  if (!_scanEl || !_strip) return null
  const count = _measurePagesIn(_scanEl)
  const next = _scanEl, prev = _strip

  // Promote buffer → strip (visible, interactive, translated to the target page)
  next.className = 'col-container page-content'
  next.style.opacity = '1'
  next.style.pointerEvents = ''
  next.style.willChange = ''   // promoted only during active flipping (promoteStrip)
  next.style.transition = 'none'
  next.style.transform = `translateX(${-pageIdx * (_colW + _colGap)}px)`

  // Demote strip → buffer (hidden, inert, emptied)
  prev.className = 'col-container'
  prev.style.opacity = '0'
  prev.style.pointerEvents = 'none'
  prev.style.transition = 'none'
  prev.style.transform = 'none'
  prev.innerHTML = ''

  _strip = next
  _scanEl = prev
  trimContainerWidth(count)
  return count
}

export function raiseOverlay() {
  if (!_overlay) return
  _overlay.style.transition = 'none'
  _overlay.style.opacity    = '1'
}

export function revealContent() {
  if (!_overlay) return
  _overlay.style.transition = 'opacity 0.1s ease'
  _overlay.style.opacity    = '0'
}

// ── Page measurement ──────────────────────────────────────────────────────────
// Call inside a requestAnimationFrame after renderChapterContent().
// One rect read on the container + one on its last child.

function _measurePagesIn(el) {
  if (!el || _colW <= 0) return 1
  const lastEl = el.lastElementChild
  if (!lastEl) return 1
  const unit          = _colW + _colGap
  const containerRect = el.getBoundingClientRect()
  const elRect        = lastEl.getBoundingClientRect()
  const midX          = (elRect.left + elRect.right) / 2 - containerRect.left
  const colIdx        = Math.max(0, Math.floor(midX / unit))
  // Raw CSS-column count. In two-page mode the caller (ReaderView) uses step=2
  // to advance one spread at a time; each "page index" is one CSS column.
  return colIdx + 1
}

export function measurePageCount() {
  return _measurePagesIn(_strip)
}

// ── Chapter cache ─────────────────────────────────────────────────────────────

// Snapshot the rendered chapter so revisiting it skips HTML building + measure.
export function cacheCurrentChapter(chIdx, count) {
  if (!_strip) return
  _chapterCache[chIdx] = { count, html: _strip.innerHTML }
}

// Read-only cache lookup — callers route cached HTML through the buffer swap
// so the old page never blanks.
export function getCachedChapter(chIdx) {
  return _chapterCache[chIdx] || null
}

// Restore a previously-cached chapter into the strip.
// Returns the page count, or null on miss.
export function loadCachedChapter(chIdx) {
  const cached = _chapterCache[chIdx]
  if (!cached || !_strip) return null
  _scanAbort = true
  _strip.innerHTML = cached.html
  trimContainerWidth(cached.count)
  return cached.count
}

export function clearChapterCache() {
  _chapterCache = {}
}

// Kept for API compatibility with older call sites; the strip needs no
// per-page extraction.
export function getActivePage() {
  return _strip
}

// Layout metrics that define a pagination result — used to key the persistent
// page index (a stored index is only valid while these match).
export function getLayoutMetrics() {
  return { colW: Math.round(_colW), colH: Math.round(_colH), twoPage: _twoPage }
}

// ── Navigation ────────────────────────────────────────────────────────────────
// showPage translates the strip to column `pageIdx`. 'slide' animates the
// transform (direction falls out of the delta); 'fade' blinks the overlay;
// rapid successive calls (< 120 ms) skip animations to prevent backlog.

// Promote the strip to a compositor layer for the duration of an active flip
// session, then drop it when reading goes idle so the huge layer isn't held.
// Warming it once per session means tiles rasterize once and stay cached across
// that burst of turns; idle reading pays no layer-memory cost.
let _depromoteTimer = null
function promoteStrip() {
  if (!_strip) return
  if (_strip.style.willChange !== 'transform') _strip.style.willChange = 'transform'
  if (_depromoteTimer) clearTimeout(_depromoteTimer)
  _depromoteTimer = setTimeout(() => {
    _depromoteTimer = null
    if (_strip) _strip.style.willChange = ''
  }, 600)
}

export function showPage(pageIdx, transition) {
  if (!_strip) return

  const now   = Date.now()
  const rapid = now - _lastNavTime < 120
  _lastNavTime = now
  promoteStrip()

  if (_fadeTimer !== null) { clearTimeout(_fadeTimer); _fadeTimer = null }

  const x = -pageIdx * (_colW + _colGap)
  const target = `translateX(${x}px)`

  if (!rapid && transition === 'slide') {
    _strip.style.transition = 'transform 0.14s ease-out'
    _strip.style.transform  = target
    return
  }

  if (!rapid && transition === 'fade') {
    if (_overlay) { _overlay.style.transition = 'opacity 0.06s ease'; _overlay.style.opacity = '1' }
    _fadeTimer = setTimeout(() => {
      _fadeTimer = null
      _strip.style.transition = 'none'
      _strip.style.transform  = target
      if (!_overlay) return
      _overlay.style.transition = 'opacity 0.08s ease'
      _overlay.style.opacity    = '0'
    }, 60)
    return
  }

  // Instant or rapid-fire.
  _strip.style.transition = 'none'
  _strip.style.transform  = target
}

// ── Position anchoring ────────────────────────────────────────────────────────
// Page indices don't survive layout changes (font size, resize, two-page); the
// index of the first visible block element does. Record it before a rebuild,
// resolve it back to a page after — the reader reopens on the same paragraph.

export function getVisibleChildIndex(pageIdx) {
  if (!_strip) return 0
  const kids = _strip.children
  if (!kids.length) return 0
  const unit      = _colW + _colGap
  const stripRect = _strip.getBoundingClientRect()
  for (let i = 0; i < kids.length; i++) {
    const r   = kids[i].getBoundingClientRect()
    const col = Math.floor(((r.left + r.right) / 2 - stripRect.left) / unit)
    if (col >= pageIdx) return i
  }
  return kids.length - 1
}

export function pageOfChild(childIdx) {
  if (!_strip) return 0
  const kids = _strip.children
  if (!kids.length) return 0
  const el        = kids[Math.max(0, Math.min(childIdx, kids.length - 1))]
  const unit      = _colW + _colGap
  const stripRect = _strip.getBoundingClientRect()
  const r         = el.getBoundingClientRect()
  return Math.max(0, Math.floor(((r.left + r.right) / 2 - stripRect.left) / unit))
}

// ── Container width trimming ──────────────────────────────────────────────────
// Narrows the strip to the real column count so it doesn't keep a 100-column
// layout box around.

export function trimContainerWidth(pageCount) {
  if (!_strip || _colW <= 0) return
  const step     = _twoPage ? 2 : 1
  const colCount = pageCount * step
  // +1 column as a sub-pixel rounding buffer
  _strip.style.width = ((colCount + 1) * (_colW + _colGap)) + 'px'
}

// ── Cache / teardown ──────────────────────────────────────────────────────────

export function invalidateCache() {
  _scanAbort = true
  _chapterCache = {}
  _colW = 0; _colGap = 0
  _strip = null; _wrapper = null; _overlay = null; _scanEl = null
  if (_fadeTimer !== null) { clearTimeout(_fadeTimer); _fadeTimer = null }
  if (_depromoteTimer !== null) { clearTimeout(_depromoteTimer); _depromoteTimer = null }
  _lastNavTime = 0
}

// ── Background chapter scan ───────────────────────────────────────────────────
// Renders every chapter into the HIDDEN _scanEl one at a time, measures page
// count, and calls onChapterDone(chIdx, count) for each. Starts in an idle
// callback and yields between chapters so it never competes with interaction.
// Cancelled automatically when renderChapterContent() fires (chapter
// navigation) or explicitly via cancelScan().

export function cancelScan() {
  _scanAbort = true
}

const _idle = typeof requestIdleCallback === 'function'
  ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
  : (fn) => setTimeout(fn, 200)

// How many chapters either side of the current one keep their PRE-RENDERED HTML
// in the chapter cache (prewarm). Counts are kept for every chapter regardless.
const PREWARM_RADIUS = 2

// Scan order: neighbors of `around` (±1, ±2, …). With `neighborsOnly` this is
// the WHOLE scan — full-book scans laid out every chapter (a multi-hundred-ms
// synchronous column layout each) and froze the first page flips after open.
// Global page totals were dropped from the UI, so nothing needs far counts.
function _scanOrder(n, around, neighborsOnly = false) {
  const order = []
  if (around != null && around >= 0) {
    for (let d = 1; d <= PREWARM_RADIUS; d++) {
      if (around + d < n) order.push(around + d)
      if (around - d >= 0) order.push(around - d)
    }
  }
  if (!neighborsOnly) {
    for (let i = 0; i < n; i++) {
      if (i !== around && !order.includes(i)) order.push(i)
    }
  }
  return order
}

export function scanAllChapters(chapters, onChapterDone, opts = {}) {
  _scanAbort = false
  if (!_scanEl || _colW <= 0 || !chapters.length) return

  const around = opts.around ?? null
  const order  = _scanOrder(chapters.length, around, opts.neighborsOnly)
  let i = 0

  function step() {
    if (_scanAbort || !_scanEl || i >= order.length) {
      if (_scanEl) _scanEl.innerHTML = ''   // free the scan DOM when done
      return
    }

    // Back off while the user is reading/paging — a chapter layout here is a
    // guaranteed dropped frame. 3s covers a normal reading cadence (a flip every
    // 1.5–3s) so scan steps never collide with the next turn.
    if (Date.now() - _lastNavTime < 3000) {
      setTimeout(step, 3000)
      return
    }

    const chIdx = order[i++]
    // Skip chapters whose count is already known (persisted index / earlier
    // scan) so a full-index build never re-lays-out what it already measured —
    // this makes the builder resilient to the _scanAbort restarts that chapter
    // navigation triggers.
    if (opts.hasCount && opts.hasCount(chIdx)) { _idle(step); return }
    // Already prewarmed (e.g. re-scan after returning to a chapter) — skip the
    // expensive layout entirely and reuse the cached count.
    const cached = _chapterCache[chIdx]
    if (cached) {
      onChapterDone(chIdx, cached.count)
      _idle(step)
      return
    }

    _scanEl.innerHTML = blocksToDisplayHTML(chapters[chIdx].blocks)

    requestAnimationFrame(() => {
      if (_scanAbort || !_scanEl) return
      const count = _measurePagesIn(_scanEl)
      // Prewarm: the scan container has IDENTICAL column geometry to the strip,
      // so its rendered HTML is a valid cache entry — first visit to a nearby
      // chapter becomes an instant cache hit instead of a full re-layout.
      if (around != null && Math.abs(chIdx - around) <= PREWARM_RADIUS) {
        _chapterCache[chIdx] = { count, html: _scanEl.innerHTML }
      }
      onChapterDone(chIdx, count)
      _idle(step)   // yield — only continue when the main thread is free
    })
  }

  _idle(step)
}

// Evict prewarmed HTML far from the current chapter (counts live elsewhere;
// this only bounds memory held by big HTML strings).
export function prunePrewarm(around) {
  for (const k of Object.keys(_chapterCache)) {
    if (Math.abs(Number(k) - around) > PREWARM_RADIUS) delete _chapterCache[k]
  }
}

// ── Global page-count estimation ─────────────────────────────────────────────
// Sums known chapter page-counts; estimates unmeasured chapters using the
// average of measured ones to avoid wildly-low totals.

export function getTotalPages(chapterPageCounts, numChapters) {
  let measuredSum = 0, measuredCount = 0
  for (let i = 0; i < numChapters; i++) {
    const c = chapterPageCounts[i]
    if (c != null) { measuredSum += c; measuredCount++ }
  }
  const avg = measuredCount > 0 ? measuredSum / measuredCount : 10
  let total = 0
  for (let i = 0; i < numChapters; i++) total += chapterPageCounts[i] ?? avg
  return Math.round(total)
}
