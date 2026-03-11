// ─────────────────────────────────────────────────────────────────────────────
// paginationEngine.js
// Direct port of the CSS-columns pagination engine from Script.js.
// Zero React dependency — operates on a DOM element ref passed in from
// ReaderView. This keeps the heavy DOM work isolated so React's reconciler
// never touches it.
// ─────────────────────────────────────────────────────────────────────────────

// ── Module-level state (mirrors original Script.js globals) ──────────────────

let _pageBreaks           = []
let _pageStyleEl          = null
let _currentRenderedChapter = -1
let _animating            = false
let _outgoingPage         = null
let _chapterBreaksCache   = {}

// ── HTML builders ─────────────────────────────────────────────────────────────

export function blocksToHTML(blocks) {
  return blocks.map(b => {
    if (!b?.text?.trim() && b?.type !== 'cover') return ''
    if (b.type === 'cover')      return `<img src="${b.src}" alt="Book cover">`
    if (b.type === 'pdfPage')    return `<img src="${b.src}" alt="" class="pdf-page-img">`
    if (b.type === 'heading')    return `<h2>${b.text}</h2>`
    if (b.type === 'subheading') return `<h3>${b.text}</h3>`
    return `<p>${b.text}</p>`
  }).join('')
}

export function blocksToDisplayHTML(blocks) {
  return blocks.map(b => {
    if (!b?.text?.trim() && b?.type !== 'cover') return ''
    if (b.type === 'cover')      return `<img src="${b.src}" alt="Book cover">`
    if (b.type === 'pdfPage')    return `<img src="${b.src}" alt="" class="pdf-page-img">`
    if (b.type === 'heading')    return `<h2>${b.text}</h2>`
    if (b.type === 'subheading') return `<h3>${b.text}</h3>`
    const wrapped = b.text.replace(/(\S+)/g, (w) => {
      const clean = w.replace(/[^a-zA-Z'\u2019-]/g, '')
      return `<span class="col-word" data-word="${clean}">${w}</span>`
    })
    return `<p>${wrapped}</p>`
  }).join('')
}

// ── CSS injection ─────────────────────────────────────────────────────────────

export function buildPageStyles(prefs) {
  const { fontSize: fs, lineSpacing: ls, fontFamily, justifyText } = prefs
  const paraGap = Math.round(fs * 0.55)
  return `
    .page-content {
      font-family: ${fontFamily};
      font-size: ${fs}px;
      line-height: ${ls};
      color: var(--readerText);
      padding: 36px 64px;
      box-sizing: border-box;
      word-break: break-word;
      hyphens: auto;
      height: 100%;
      overflow: hidden;
      text-rendering: optimizeLegibility;
    }
    .page-content p {
      margin: 0 0 ${paraGap}px 0;
      text-align: ${justifyText !== false ? 'justify' : 'left'};
      text-align-last: left;
      hanging-punctuation: first last;
      font-feature-settings: "kern" 1, "liga" 1, "onum" 1;
      orphans: 3; widows: 3;
    }
    .page-content p + p { text-indent: 2em; margin-bottom: 0; }
    .page-content h2 + p, .page-content h3 + p { text-indent: 0; }
    .page-content h2 {
      font-size: ${Math.round(fs * 1.65)}px; font-weight: 700;
      line-height: 1.2; font-family: Georgia, serif;
      margin: 0 0 ${Math.round(fs * 0.5)}px 0; letter-spacing: -0.01em;
    }
    .page-content h3 {
      font-size: ${Math.round(fs * 1.1)}px; font-weight: 400;
      line-height: 1.4; font-family: Georgia, serif;
      margin: 0 0 ${Math.round(fs * 0.4)}px 0;
      opacity: 0.72; letter-spacing: 0.02em; font-style: italic;
    }
    .page-content.chapter-title-page {
      display: flex; flex-direction: column;
      justify-content: center; align-items: center; text-align: center;
    }
    .page-content.chapter-title-page h2,
    .page-content.chapter-title-page h3 { width: 100%; text-align: center; }
    .page-content.chapter-title-page h2 { margin-bottom: ${Math.round(fs * 0.3)}px; }
    .page-content.chapter-title-page h3 { margin-bottom: 0; }
    .page-content.cover-page {
      padding: 0; display: flex; align-items: center; justify-content: center;
      background: var(--readerCard);
    }
    .page-content.cover-page img {
      max-width: 100%; max-height: 100%; object-fit: contain;
      display: block; border-radius: 4px; box-shadow: 0 8px 40px rgba(0,0,0,0.32);
    }
  `
}

export function ensurePageStyle(prefs) {
  const css = buildPageStyles(prefs)
  if (_pageStyleEl && _pageStyleEl.parentNode) {
    _pageStyleEl.textContent = css
  } else {
    _pageStyleEl = document.createElement('style')
    _pageStyleEl.textContent = css
    document.head.appendChild(_pageStyleEl)
  }
}

export function removePageStyle() {
  if (_pageStyleEl) { _pageStyleEl.remove(); _pageStyleEl = null }
}

// ── Core: compute page breaks ─────────────────────────────────────────────────

export function computePageBreaks(chapter, prefs, cardEl) {
  if (!chapter || !chapter.blocks.length) return [0]
  if (!cardEl) return [0]

  const cardW = cardEl.clientWidth || 720
  const cardH = cardEl.offsetHeight || 600

  const { fontSize: fs, lineSpacing: ls, fontFamily, justifyText, twoPage } = prefs
  const PAD_V = 36, PAD_H = 64
  const colW  = twoPage ? Math.floor(cardW / 2) - PAD_H * 2 : cardW - PAD_H * 2
  const pageH = cardH - PAD_V * 2
  if (pageH <= 0 || colW <= 0) return [0]

  const paraGap  = Math.round(fs * 0.55)
  const textAlign = justifyText !== false ? 'justify' : 'left'

  const probe = document.createElement('div')
  probe.style.cssText = `
    position: fixed; top: 0; left: -9999px;
    width: ${colW}px; height: auto; padding: 0; margin: 0; border: none;
    opacity: 0; pointer-events: none; z-index: -1; overflow: visible;
    font-family: ${fontFamily}; font-size: ${fs}px;
    line-height: ${ls}; word-break: break-word;
    hyphens: auto; box-sizing: border-box;
  `
  const probeStyle = document.createElement('style')
  probeStyle.textContent = `
    .gnos-probe p  { margin: 0 0 ${paraGap}px 0; text-align: ${textAlign};
                     text-align-last: left;
                     font-feature-settings: "kern" 1, "liga" 1, "onum" 1; }
    .gnos-probe p + p { text-indent: 2em; margin-bottom: 0; }
    .gnos-probe h2 { font-size: ${Math.round(fs * 1.65)}px; font-weight: 700;
                     line-height: 1.2; margin: 0 0 ${Math.round(fs * 0.5)}px 0; }
    .gnos-probe h3 { font-size: ${Math.round(fs * 1.1)}px; font-weight: 400;
                     line-height: 1.4; margin: 0 0 ${Math.round(fs * 0.4)}px 0; }
  `
  document.head.appendChild(probeStyle)
  probe.className = 'gnos-probe'
  document.body.appendChild(probe)

  function probeHeight() {
    const last = probe.lastElementChild
    if (!last) return 0
    const probeTop = probe.getBoundingClientRect().top
    return last.getBoundingClientRect().bottom - probeTop
  }

  function splitParaAtPageBoundary(text, prefixBlocks) {
    const words = text.split(' ')
    let lo = 1, hi = words.length - 1, bestSplit = 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      probe.innerHTML = blocksToHTML([...prefixBlocks, { type: 'para', text: words.slice(0, mid).join(' ') }])
      if (probeHeight() <= pageH) { bestSplit = mid; lo = mid + 1 }
      else { hi = mid - 1 }
    }
    if (bestSplit === 1 && prefixBlocks.length > 0) {
      bestSplit = 0
    } else if (bestSplit >= 2) {
      probe.innerHTML = blocksToHTML([...prefixBlocks, { type: 'para', text: words.slice(0, bestSplit).join(' ') }])
      const hFull = probeHeight()
      probe.innerHTML = blocksToHTML([...prefixBlocks, { type: 'para', text: words.slice(0, bestSplit - 1).join(' ') }])
      const hShort = probeHeight()
      if (hFull > hShort) {
        if (bestSplit - 1 >= 2) bestSplit--
        else if (prefixBlocks.length > 0) bestSplit = 0
      }
    }
    return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')]
  }

  const expanded = []
  for (const b of chapter.blocks) {
    if (!b?.text?.trim() && b?.type !== 'cover' && b?.type !== 'pdfPage') continue
    expanded.push({ ...b })
  }

  const breaks = [0]
  let pageBlocks = [], pageIsHeadingOnly = false

  for (let i = 0; i < expanded.length; i++) {
    const b = expanded[i]
    const isHeading = b.type === 'heading' || b.type === 'subheading'

    if (isHeading && pageBlocks.length > 0 && !pageIsHeadingOnly) {
      breaks.push(i); pageBlocks = []; pageIsHeadingOnly = false
    } else if (!isHeading && pageIsHeadingOnly) {
      breaks.push(i); pageBlocks = []; pageIsHeadingOnly = false
    }

    pageBlocks.push(b)
    pageIsHeadingOnly = pageBlocks.every(bl => bl.type === 'heading' || bl.type === 'subheading')
    probe.innerHTML = blocksToHTML(pageBlocks)

    if (probeHeight() > pageH) {
      if (b.type === 'para' && b.text.split(' ').length > 2) {
        const prefixForSplit = pageBlocks.length > 1 ? pageBlocks.slice(0, -1) : []
        const [first, rest] = splitParaAtPageBoundary(b.text, prefixForSplit)
        if (first && rest) {
          expanded.splice(i + 1, 0, { type: 'para', text: rest, continued: true })
          expanded[i] = { ...b, text: first }
          pageBlocks[pageBlocks.length - 1] = expanded[i]
          breaks.push(i + 1); pageBlocks = []; pageIsHeadingOnly = false
        } else if (pageBlocks.length > 1) {
          breaks.push(i); pageBlocks = [b]
          probe.innerHTML = blocksToHTML(pageBlocks)
          if (probeHeight() > pageH) {
            const [f2, r2] = splitParaAtPageBoundary(b.text, [])
            if (f2 && r2) {
              expanded.splice(i + 1, 0, { type: 'para', text: r2, continued: true })
              expanded[i] = { ...b, text: f2 }
              pageBlocks[0] = expanded[i]
              breaks.push(i + 1); pageBlocks = []
            }
          }
          pageIsHeadingOnly = false
        }
      } else if (pageBlocks.length > 1) {
        breaks.push(i); pageBlocks = [b]
        pageIsHeadingOnly = b.type === 'heading' || b.type === 'subheading'
        probe.innerHTML = blocksToHTML(pageBlocks)
      }
    }
  }

  document.body.removeChild(probe)
  probeStyle.remove()
  chapter._expanded = expanded
  return breaks
}

// ── Render a page into the card element ───────────────────────────────────────

export function renderPage(cardEl, chapters, currentChapter, currentPage, twoPage, animate) {
  if (!cardEl) return

  const chapter = chapters[currentChapter]
  if (!chapter) return

  if (currentChapter !== _currentRenderedChapter) {
    if (_chapterBreaksCache[currentChapter]) {
      _pageBreaks = _chapterBreaksCache[currentChapter]
    }
    _currentRenderedChapter = currentChapter
  }

  const totalPagesInChapter = _pageBreaks.length
  const pageIdx = Math.max(0, Math.min(currentPage, totalPagesInChapter - 1))
  const cardH   = cardEl.offsetHeight

  function makePageDiv(pIdx) {
    const source     = chapter._expanded || chapter.blocks
    const startBlock = _pageBreaks[pIdx]
    const endBlock   = _pageBreaks[pIdx + 1] ?? source.length
    const blocks     = source.slice(startBlock, endBlock)
    const div        = document.createElement('div')
    div.className    = 'page-content'
    div.style.height = cardH + 'px'
    div.innerHTML    = blocksToDisplayHTML(blocks)
    const nonEmpty   = blocks.filter(b => b?.text?.trim() || b?.type === 'cover' || b?.type === 'pdfPage')
    if (nonEmpty.length > 0) {
      if (nonEmpty.every(b => b.type === 'cover'))       div.classList.add('cover-page')
      else if (nonEmpty.every(b => b.type === 'heading' || b.type === 'subheading')) div.classList.add('chapter-title-page')
    }
    if (nonEmpty[0]?.continued) {
      const firstP = div.querySelector('p')
      if (firstP) firstP.style.textIndent = '0'
    }
    return div
  }

  let newSurface
  if (twoPage) {
    newSurface = document.createElement('div')
    newSurface.className = 'page-spread'
    newSurface.style.height = cardH + 'px'
    const rightPage = pageIdx + 1 < totalPagesInChapter
      ? makePageDiv(pageIdx + 1)
      : (() => { const e = document.createElement('div'); e.className = 'page-content'; e.style.height = cardH + 'px'; return e })()
    newSurface.appendChild(makePageDiv(pageIdx))
    newSurface.appendChild(rightPage)
  } else {
    newSurface = makePageDiv(pageIdx)
  }

  // Snap any in-flight animation
  if (_animating && _outgoingPage) {
    _outgoingPage.remove(); _outgoingPage = null; _animating = false
    cardEl.querySelectorAll('.page-content, .page-spread').forEach(el => el.remove())
  }

  if (animate) {
    const existing = cardEl.querySelector('.page-content, .page-spread')
    if (existing) {
      _animating = true; _outgoingPage = existing
      newSurface.style.cssText = 'position:absolute;inset:0;opacity:0;transition:opacity 0.18s ease;'
      cardEl.appendChild(newSurface)
      void newSurface.offsetWidth
      existing.style.cssText  = 'position:absolute;inset:0;opacity:1;transition:opacity 0.18s ease;'
      existing.style.opacity  = '0'
      newSurface.style.opacity = '1'
      const cleanup = () => {
        if (_outgoingPage === existing) {
          existing.remove()
          newSurface.style.cssText = ''
          _outgoingPage = null; _animating = false
        }
      }
      existing.addEventListener('transitionend', cleanup, { once: true })
      setTimeout(cleanup, 260)
    } else {
      cardEl.innerHTML = ''; cardEl.appendChild(newSurface)
    }
  } else {
    cardEl.innerHTML = ''; cardEl.appendChild(newSurface)
  }
}

// ── Cache management ──────────────────────────────────────────────────────────

export function precomputeAllChapters(chapters, prefs, cardEl) {
  _chapterBreaksCache = {}
  for (let i = 0; i < chapters.length; i++) {
    _chapterBreaksCache[i] = computePageBreaks(chapters[i], prefs, cardEl)
  }
}

export function invalidateCache() {
  _chapterBreaksCache = {}
  _currentRenderedChapter = -1
  _pageBreaks = []
}

export function getPageBreaks(chapterIdx) {
  return _chapterBreaksCache[chapterIdx] || _pageBreaks
}

export function getTotalPages() {
  return Math.max(1, Object.values(_chapterBreaksCache).reduce((s, b) => s + b.length, 0))
}

export function getGlobalPage(currentChapter, currentPage) {
  let offset = 0
  for (let i = 0; i < currentChapter; i++) {
    offset += (_chapterBreaksCache[i]?.length || 1)
  }
  return offset + currentPage
}

export function reset() {
  _pageBreaks = []
  _currentRenderedChapter = -1
  _chapterBreaksCache = {}
  _animating = false
  _outgoingPage = null
  removePageStyle()
}