// ─────────────────────────────────────────────────────────────────────────────
// PaginationEngine.js — CSS-columns pagination
//
// Instead of computing page breaks in JS (probe DOM + getBoundingClientRect),
// content is rendered into a CSS multi-column container and the browser handles
// all text measurement natively.  Navigation is a CSS translateX — zero JS
// layout reads after the initial render.
// ─────────────────────────────────────────────────────────────────────────────

// ── Module state ─────────────────────────────────────────────────────────────
let _pageStyleEl  = null
let _wrapWords    = false
let _colW         = 0      // width of one CSS column (= one logical page)
let _colGap       = 0      // gap between columns (two-page mode only)
let _twoPage      = false
let _colH         = 0      // column / card height (px)
let _container    = null   // the multi-column div (scrolls left/right)
let _wrapper      = null   // overflow:hidden clip div
let _overlay      = null   // solid cover div — hides content during render without deferring GPU rasterization
let _lastNavTime  = 0      // timestamp of last showPage call (ms)
let _fadeTimer    = null   // pending setTimeout id for fade transitions

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
        const clean = w.replace(/[^a-zA-Z'\u2019-]/g, '')
        return `<span class="col-word" data-word="${clean}">${w}</span>`
      })
      return `<p>${wrapped}</p>`
    }
    return `<p>${b.text}</p>`
  }).join('\n')
}

// ── Typography CSS ─────────────────────────────────────────────────────────────
// Padding is applied to child elements rather than the container so that it
// is consistent across every CSS column (= every page).

export function buildPageStyles(prefs) {
  const fs       = prefs.fontSize    || 18
  const ls       = prefs.lineSpacing || 1.6
  const ff       = prefs.fontFamily  || 'Georgia, serif'
  const paraGap  = Math.round(fs * 0.55)
  const justify  = prefs.justifyText !== false ? 'justify' : 'left'

  return `
    .col-container {
      font-family: ${ff};
      font-size: ${fs}px;
      line-height: ${ls};
      color: var(--readerText);
      text-rendering: optimizeLegibility;
      hyphens: auto;
      box-sizing: border-box;
    }
    .col-container > * {
      padding-left: 64px;
      padding-right: 64px;
      box-sizing: border-box;
    }
    .col-container > img {
      padding-left: 0;
      padding-right: 0;
    }
    .col-container > p:first-child,
    .col-container > h2:first-child,
    .col-container > h3:first-child { margin-top: 36px; }
    .col-container p {
      margin: 0 0 ${paraGap}px;
      text-align: ${justify};
      hanging-punctuation: first last;
      font-feature-settings: "kern" 1, "liga" 1, "onum" 1;
      orphans: 3; widows: 3;
      text-indent: 2em;
    }
    .col-container h2 + p,
    .col-container h3 + p { text-indent: 0; }
    .col-container h2 {
      font-family: Georgia, serif;
      font-size: ${Math.round(fs * 1.65)}px;
      font-weight: 700; line-height: 1.2;
      margin: 1.2em 0 0.5em; text-indent: 0;
    }
    .col-container h3 {
      font-family: Georgia, serif;
      font-size: ${Math.round(fs * 1.1)}px;
      font-weight: 600; line-height: 1.3;
      margin: 1em 0 0.4em; text-indent: 0;
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
      background: rgba(255,210,0,0.65);
      box-shadow: 5px 0 0 rgba(255,210,0,0.65), -1px 0 0 rgba(255,210,0,0.65);
      border-radius: 1px; cursor: pointer; color: #1a1200;
    }
    .col-word.reader-hl:hover {
      background: rgba(255,210,0,0.85);
      box-shadow: 5px 0 0 rgba(255,210,0,0.85), -1px 0 0 rgba(255,210,0,0.85);
    }
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
// Call once after the card element is mounted (and again when prefs change).

// Top padding applied inside every column so text never starts flush against
// the header. Reducing column height by this amount keeps content from being
// clipped at the bottom.
const COL_TOP_PAD = 20

export function setupColumns(cardEl, prefs) {
  if (!cardEl) return

  cardEl.innerHTML = ''

  const w   = cardEl.clientWidth
  const h   = cardEl.clientHeight - COL_TOP_PAD
  const gap = prefs.twoPage ? 64 : 0

  _colW    = prefs.twoPage ? Math.floor((w - gap) / 2) : w
  _colGap  = gap
  _twoPage = !!prefs.twoPage
  _colH    = h

  _wrapper = document.createElement('div')
  // padding-top creates the gap between the header border and the first line
  // of text on every page. The wrapper stays overflow:hidden so nothing bleeds
  // outside the card; the container height is reduced by the same amount so
  // the last line of each page is never clipped by the wrapper's bottom edge.
  _wrapper.style.cssText = `overflow:hidden;width:100%;height:100%;position:relative;padding-top:${COL_TOP_PAD}px;box-sizing:border-box;`

  _container = document.createElement('div')
  // Keep 'page-content' class so existing selectors in ReaderView still work
  _container.className = 'col-container page-content'

  // Give the container an explicit wide CSS width so every CSS column falls
  // inside the container's own box (not in its scrollable overflow).
  // WebKit does not paint content in the scrollable-overflow region of a
  // multi-column container, which causes all pages after the first to appear
  // blank.  100 columns covers even very dense book chapters while keeping
  // browser layout work proportional to actual content.
  const containerW = 100 * (_colW + _colGap)

  _container.style.cssText = [
    `column-width:${_colW}px`,
    'column-fill:auto',
    `column-gap:${_colGap}px`,
    `height:${h}px`,
    `width:${containerW}px`,
    'overflow-y:hidden',
    'will-change:transform',
    'word-break:break-word',
  ].join(';')
  _container.style.setProperty('--col-h', h + 'px')

  // Overlay sits on top of the container at z-index 1. It is shown (opaque)
  // while new chapter content is being laid out and rasterized, then faded
  // out by revealContent(). Because the content underneath stays at opacity:1,
  // the browser rasterizes it eagerly — unlike opacity:0 on the wrapper which
  // causes WebKit to defer GPU rasterization entirely, producing the
  // "half-page then full-page" visual lag.
  _overlay = document.createElement('div')
  _overlay.style.cssText = 'position:absolute;inset:0;background:var(--readerCard);z-index:1;pointer-events:none;'

  _wrapper.appendChild(_container)
  _wrapper.appendChild(_overlay)
  cardEl.appendChild(_wrapper)
}

// ── Chapter rendering ─────────────────────────────────────────────────────────
// Sets innerHTML on the container and resets scroll position.
// Must call measurePageCount() after a rAF to let the browser lay out columns.

// pageIdx — optional logical page to start at (default 0).
// The wrapper is hidden with opacity:0 before the innerHTML swap so the user
// never sees a flash of partially-laid-out content. Call revealContent() once
// the two-rAF measurement cycle is done and the correct position is confirmed.
export function renderChapterContent(blocks, pageIdx = 0) {
  if (!_container) return
  const step   = _twoPage ? 2 : 1
  const offset = pageIdx * step * (_colW + _colGap)
  _container.style.transition = 'none'
  _container.style.transform  = `translateX(-${offset}px)`
  // Show overlay instantly so new content is hidden during layout/rasterization.
  // The container itself stays opacity:1 so the browser rasterizes it eagerly.
  if (_overlay) { _overlay.style.transition = 'none'; _overlay.style.opacity = '1' }
  _container.innerHTML = blocksToDisplayHTML(blocks)
}

// Fade the overlay out once layout is settled and the position is confirmed.
// Because content was rasterized at opacity:1 underneath, it is fully painted
// by the time the overlay becomes transparent.
export function revealContent() {
  if (!_overlay) return
  _overlay.style.transition = 'opacity 0.18s ease'
  _overlay.style.opacity    = '0'
}

// ── Page measurement ──────────────────────────────────────────────────────────
// Call inside a requestAnimationFrame after renderChapterContent().
// Returns the number of logical pages (columns / step) in the chapter.

export function measurePageCount() {
  if (!_container || _colW <= 0) return 1
  const lastEl = _container.lastElementChild
  if (!lastEl) return 1
  const unit = _colW + _colGap
  // getBoundingClientRect() returns the actual rendered position including
  // CSS-column offsets, unlike offsetLeft which WebKit reports incorrectly
  // inside multi-column containers.  Both rects are affected equally by any
  // translateX on the container, so the difference is always accurate.
  const containerRect = _container.getBoundingClientRect()
  const elRect        = lastEl.getBoundingClientRect()
  const midX          = (elRect.left + elRect.right) / 2 - containerRect.left
  const colIdx        = Math.max(0, Math.floor(midX / unit))
  return _twoPage ? Math.ceil((colIdx + 1) / 2) : colIdx + 1
}

// ── Navigation ────────────────────────────────────────────────────────────────
// Translates the container to reveal the given logical page.
// Each logical page = 1 CSS column in single-page mode, 2 in two-page mode.

// transition: false = instant, 'slide' = translateX animation, 'fade' = opacity cross-fade
// Animations are automatically skipped when pages are turned rapidly (< 180 ms apart)
// so the compositor never queues up a backlog of in-flight transitions.
export function showPage(pageIdx, transition) {
  if (!_container || !_wrapper) return
  const step   = _twoPage ? 2 : 1
  const offset = pageIdx * step * (_colW + _colGap)

  const now     = Date.now()
  const rapid   = now - _lastNavTime < 180   // user is navigating quickly — skip animation
  _lastNavTime  = now

  // Cancel any pending fade timer from a previous call
  if (_fadeTimer !== null) { clearTimeout(_fadeTimer); _fadeTimer = null }

  if (!rapid && transition === 'fade') {
    // Fade transition: use the overlay (not the wrapper) so content stays
    // opacity:1 and the GPU keeps its rasterized tiles during the cross-fade.
    if (_overlay) { _overlay.style.transition = 'opacity 0.14s ease'; _overlay.style.opacity = '1' }
    _fadeTimer = setTimeout(() => {
      _fadeTimer = null
      if (!_container || !_overlay) return
      _container.style.transition = 'none'
      _container.style.transform  = `translateX(-${offset}px)`
      _overlay.style.transition   = 'opacity 0.18s ease'
      _overlay.style.opacity      = '0'
    }, 140)
  } else if (!rapid && transition === 'slide') {
    _container.style.transition = 'transform 0.22s ease'
    _container.style.transform  = `translateX(-${offset}px)`
  } else {
    // Instant: no animation, or rapid-fire override
    _container.style.transition = 'none'
    _container.style.transform  = `translateX(-${offset}px)`
  }
}

// Shrink the container to the exact column count after measuring.
// The GPU compositor rasterizes the container in tiles; trimming from
// 100 pre-allocated columns to the real count slashes rasterization work
// and eliminates the "partial page then full page" visual lag.
// Called while the overlay is still opaque so the reflow is invisible.
export function trimContainerWidth(pageCount) {
  if (!_container || _colW <= 0) return
  const step       = _twoPage ? 2 : 1
  const colCount   = pageCount * step
  // +1 column as a safety buffer against sub-pixel rounding edge cases
  const trimmedW   = (colCount + 1) * (_colW + _colGap)
  _container.style.width = trimmedW + 'px'
}

// ── Cache / teardown ──────────────────────────────────────────────────────────

export function invalidateCache() {
  _colW = 0; _colGap = 0; _container = null; _wrapper = null; _overlay = null
  if (_fadeTimer !== null) { clearTimeout(_fadeTimer); _fadeTimer = null }
  _lastNavTime = 0
}

// Sums known chapter page-counts and estimates unmeasured chapters using the
// average of the ones already measured.  This avoids the wildly-low totals
// that come from defaulting every unmeasured chapter to 1.
export function getTotalPages(chapterPageCounts, numChapters) {
  let measuredSum   = 0
  let measuredCount = 0
  for (let i = 0; i < numChapters; i++) {
    const c = chapterPageCounts[i]
    if (c != null) { measuredSum += c; measuredCount++ }
  }
  const avg = measuredCount > 0 ? measuredSum / measuredCount : 10
  let total = 0
  for (let i = 0; i < numChapters; i++) {
    total += chapterPageCounts[i] ?? avg
  }
  return Math.round(total)
}
