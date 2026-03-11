import { useEffect, useRef, useState } from 'react'
import useAppStore, { useAppStoreShallow } from '@/store/useAppStore'
import { loadBookContent } from '@/lib/storage'
import { generateCoverColor } from '@/lib/utils'
import { applyTheme } from '@/lib/themes'
import {
  ensurePageStyle, renderPage, precomputeAllChapters,
  invalidateCache, getPageBreaks, getTotalPages,
  getGlobalPage, reset as resetEngine
} from '@/lib/paginationEngine'
import { GnosNavButton } from '@/components/SideNav'

// ── SettingsPanel ─────────────────────────────────────────────────────────────

function Toggle({ on, onClick }) {
  return (
    <div className={`toggle-track ${on ? 'on' : 'off'}`} onClick={onClick}>
      <div className="toggle-thumb" />
    </div>
  )
}

function SettingsPanel({ prefs, themes, onPrefChange, onRebuild }) {
  const { fontSize, lineSpacing, fontFamily, justifyText, tapToTurn, twoPage, highlightWords, underlineLine, themeKey } = prefs
  return (
    <div className="settings-panel" style={{ display: 'block' }} onClick={e => e.stopPropagation()}>
      <div className="section-label">THEME</div>
      <div className="radio-list" style={{ marginBottom: 14 }}>
        {Object.entries(themes).map(([k, t]) => (
          <label key={k} className={`radio-item${themeKey === k ? ' active' : ''}`} style={{ cursor: 'pointer' }}>
            <input type="radio" name="reader-theme" value={k} checked={themeKey === k}
              onChange={() => { onPrefChange('themeKey', k); applyTheme(k) }}
              style={{ accentColor: 'var(--accent)' }} />
            <div style={{ display: 'flex', gap: 4 }}>
              <div className="swatch" style={{ background: t.bg }} />
              <div className="swatch" style={{ background: t.surface }} />
              <div className="swatch" style={{ background: t.accent || '#888' }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{t.name}</span>
          </label>
        ))}
      </div>

      <div className="section-label">DISPLAY</div>
      <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span>Font Size</span><span style={{ color: 'var(--textDim)' }}>{fontSize}px</span>
        </div>
        <input type="range" min="14" max="28" step="1" value={fontSize}
          onChange={e => onPrefChange('fontSize', +e.target.value)}
          onMouseUp={onRebuild} onTouchEnd={onRebuild} />
      </label>
      <label style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span>Line Spacing</span><span style={{ color: 'var(--textDim)' }}>{lineSpacing}</span>
        </div>
        <input type="range" min="1.4" max="2.4" step="0.1" value={lineSpacing}
          onChange={e => onPrefChange('lineSpacing', +e.target.value)}
          onMouseUp={onRebuild} onTouchEnd={onRebuild} />
      </label>
      <label style={{ display: 'block', fontSize: 12 }}>
        <div style={{ marginBottom: 5 }}>Font</div>
        <select value={fontFamily} onChange={e => { onPrefChange('fontFamily', e.target.value); onRebuild() }}>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Palatino Linotype', serif">Palatino</option>
          <option value="system-ui, sans-serif">System UI</option>
        </select>
      </label>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borderSubtle)' }}>
        <div className="section-label">NAVIGATION &amp; LAYOUT</div>
        {[
          { label: 'Tap margins to turn', key: 'tapToTurn',   val: tapToTurn },
          { label: 'Justify text',        key: 'justifyText', val: justifyText !== false, rebuild: true },
          { label: 'Two-page spread',     key: 'twoPage',     val: twoPage,               rebuild: true },
        ].map(({ label, key, val, rebuild }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
            <Toggle on={!!val} onClick={() => { onPrefChange(key, !val); if (rebuild) setTimeout(onRebuild, 20) }} />
          </label>
        ))}
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borderSubtle)' }}>
        <div className="section-label">ACCESSIBILITY</div>
        {[
          { label: 'Highlight words on hover', key: 'highlightWords', val: highlightWords },
          { label: 'Underline current line',   key: 'underlineLine',  val: underlineLine },
        ].map(({ label, key, val }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
            <Toggle on={!!val} onClick={() => onPrefChange(key, !val)} />
          </label>
        ))}
      </div>
    </div>
  )
}

// ── ChapterDropdown ───────────────────────────────────────────────────────────

function ChapterDropdown({ chapters, currentChapter, breaksCache, onJump, onClose }) {
  const [search, setSearch] = useState('')
  const realChapters = chapters.filter(c => c.title !== '_cover_')

  // Build global page start map (same logic as original buildChapterDropdown)
  let globalPageStart = 0
  const chapterStartPages = chapters.map((_, i) => {
    const pg = globalPageStart
    const cached = breaksCache[i]
    if (cached) globalPageStart += cached.length
    return cached ? pg : null
  })

  const q = search.trim().toLowerCase()
  const pageNumMatch = q.match(/^p(?:age)?\s*(\d+)$|^(\d+)$/)
  const isPureNumber = pageNumMatch && /^\d+$/.test(q)
  const queryNum = isPureNumber ? parseInt(q, 10) : null

  const bookTitle = useAppStore.getState().activeBook?.title || ''

  return (
    <div className="dropdown" style={{ display: 'block' }} onClick={e => e.stopPropagation()}>
      <div className="dropdown-header">
        <div className="drop-title">{bookTitle}</div>
        <div className="drop-stats">{realChapters.length} chapter(s)</div>
        <input className="chapter-search-input" placeholder="Search chapters..."
          value={search} onChange={e => setSearch(e.target.value)} autoFocus />
      </div>
      <div>
        {chapters.map((ch, i) => {
          if (i === 0 && ch.title === '_cover_') return null
          if (q && !isPureNumber && !ch.title.toLowerCase().includes(q)) return null
          if (isPureNumber && queryNum !== null) {
            if (i !== queryNum && !ch.title.toLowerCase().includes(q)) return null
          }
          const pgStart = chapterStartPages[i]
          const pgLabel = pgStart != null ? `p. ${pgStart + 1}` : ''
          return (
            <div key={i} className={`chapter-item${i === currentChapter ? ' active' : ''}`}
              onClick={() => { onJump(i, 0); onClose() }}>
              <div className="ch-flex">
                <div className="ch-title">{ch.title}</div>
                {pgLabel && <div style={{ fontSize: 11, color: 'var(--textDim)', marginLeft: 8, flexShrink: 0 }}>{pgLabel}</div>}
              </div>
              <div className="ch-sub">Chapter {i}</div>
            </div>
          )
        })}
        {pageNumMatch && (() => {
          const pageNum = parseInt(pageNumMatch[1] || pageNumMatch[2], 10) - 1
          const lastIdx = chapters.length - 1
          const knownTotal = chapterStartPages[lastIdx] != null
            ? (chapterStartPages[lastIdx] || 0) + (breaksCache[lastIdx]?.length || 1)
            : null
          if (!knownTotal || pageNum < 0 || pageNum >= knownTotal) return null
          return (
            <div key="page-jump">
              <div style={{ height: 1, background: 'var(--borderSubtle)', margin: '4px 12px' }} />
              <div className="chapter-item" onClick={() => {
                let remaining = pageNum
                for (let i = 0; i < chapters.length; i++) {
                  const chPgs = breaksCache[i]?.length || 1
                  if (remaining < chPgs) { onJump(i, remaining); onClose(); return }
                  remaining -= chPgs
                }
              }}>
                <div className="ch-flex">
                  <div className="ch-title" style={{ color: 'var(--accent)' }}>Go to page {pageNum + 1}</div>
                </div>
                <div className="ch-sub">of {knownTotal} pages total</div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── ReaderView ────────────────────────────────────────────────────────────────

const BUILT_IN_THEMES = {
  dark: {
    name: 'Dark', bg: '#0d1117', surface: '#161b22', accent: '#388bfd',
    readerCard: '#161b22', readerText: '#cdd9e5',
  },
  light: {
    name: 'Light (Cream)', bg: '#f5f0e8', surface: '#fdfaf4', accent: '#7c6034',
    readerCard: '#fdfaf4', readerText: '#3a2e1e',
  },
}

export default function ReaderView() {
  const activeBook         = useAppStore(s => s.activeBook)
  const setView            = useAppStore(s => s.setView)
  const setPref            = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)

  // Read all prefs in one selector so settings panel always stays in sync
  const prefs = useAppStoreShallow(s => ({
    fontSize:       s.fontSize,
    lineSpacing:    s.lineSpacing,
    fontFamily:     s.fontFamily,
    justifyText:    s.justifyText,
    tapToTurn:      s.tapToTurn,
    twoPage:        s.twoPage,
    highlightWords: s.highlightWords,
    underlineLine:  s.underlineLine,
    themeKey:       s.themeKey,
    customThemes:   s.customThemes,
  }))

  const cardRef = useRef(null)

  const [chapters,     setChapters]     = useState([])
  const [curChapter,   setCurChapter]   = useState(0)
  const [curPage,      setCurPage]      = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [breaksCache,  setBreaksCache]  = useState({})
  const [pageInput,    setPageInput]    = useState(null)

  const chaptersRef   = useRef([])
  const curChapterRef = useRef(0)
  const curPageRef    = useRef(0)
  const prefsRef      = useRef(prefs)
  prefsRef.current    = prefs

  // Keep refs in sync — assigned every render, no useEffect needed
  chaptersRef.current   = chapters
  curChapterRef.current = curChapter
  curPageRef.current    = curPage

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBook) return
    let cancelled = false

    async function load() {
      console.log('[Reader] load() start, bookId=', activeBook.id)
      setLoading(true)
      invalidateCache()

      const rawChapters = await loadBookContent(activeBook.id)
      console.log('[Reader] rawChapters=', rawChapters ? `${rawChapters.length} chapters` : 'NULL')
      if (!rawChapters || cancelled) return

      const coverChapter = {
        title: '_cover_',
        blocks: [{ type: 'cover', text: '', src: activeBook.coverDataUrl || '' }],
      }
      const allChapters = [coverChapter, ...rawChapters]
      chaptersRef.current = allChapters

      const sc = activeBook.currentChapter || 0
      const sp = activeBook.currentPage    || 0
      const resumeChapter = (sc > 0 || sp > 0) ? sc + 1 : 0
      const resumePage    = resumeChapter === 0 ? 0 : sp

      setChapters(allChapters)
      setCurChapter(resumeChapter)
      setCurPage(resumePage)
      curChapterRef.current = resumeChapter
      curPageRef.current    = resumePage

      // Give DOM a tick to mount the card, then compute + render
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      console.log('[Reader] after rAF, cardRef=', cardRef.current, 'cancelled=', cancelled)
      if (cancelled || !cardRef.current) return

      const p = prefsRef.current
      console.log('[Reader] card dims:', cardRef.current.clientWidth, 'x', cardRef.current.offsetHeight)
      ensurePageStyle(p)
      cardRef.current.classList.toggle('two-page', p.twoPage)
      cardRef.current.classList.toggle('highlight-words', p.highlightWords)
      cardRef.current.classList.toggle('underline-line', p.underlineLine)

      precomputeAllChapters(allChapters, p, cardRef.current)
      const cache = {}
      for (let i = 0; i < allChapters.length; i++) cache[i] = getPageBreaks(i)

      console.log('[Reader] cache built, pages in ch0:', cache[0]?.length)
      if (cancelled) return
      setBreaksCache(cache)
      renderPage(cardRef.current, allChapters, resumeChapter, resumePage, p.twoPage, false)
      console.log('[Reader] renderPage done, card children:', cardRef.current.children.length)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBook?.id])

  // ── Word hover (underline-line feature) ─────────────────────────────────
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const handleMouseover = (e) => {
      const target = e.target
      if (target.tagName !== 'SPAN' || !target.classList.contains('col-word')) return
      const page = target.closest('.page-content')
      if (!page) return
      const targetTop = target.getBoundingClientRect().top
      page.querySelectorAll('.col-word.same-line').forEach(s => s.classList.remove('same-line'))
      page.querySelectorAll('.col-word').forEach(s => {
        if (Math.abs(s.getBoundingClientRect().top - targetTop) < 4) s.classList.add('same-line')
      })
    }
    const handleMouseleave = (e) => {
      // Only clear if leaving the card entirely, not just moving between words
      if (!e.relatedTarget || !card.contains(e.relatedTarget)) {
        card.querySelectorAll('.col-word.same-line').forEach(s => s.classList.remove('same-line'))
      }
    }
    card.addEventListener('mouseover', handleMouseover)
    card.addEventListener('mouseleave', handleMouseleave)
    return () => {
      card.removeEventListener('mouseover', handleMouseover)
      card.removeEventListener('mouseleave', handleMouseleave)
    }
  }, []) // attach once — card element never changes

  // ── Re-render when chapter/page changes (after load) ─────────────────────
  useEffect(() => {
    if (loading || !cardRef.current || chapters.length === 0) return
    renderPage(cardRef.current, chapters, curChapter, curPage, prefs.twoPage, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curChapter, curPage])

  // ── Keyboard nav ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (settingsOpen || dropdownOpen || e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPage()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, dropdownOpen, curChapter, curPage, chapters])

  // ── Close panels on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!settingsOpen && !dropdownOpen) return
    const handler = () => { setSettingsOpen(false); setDropdownOpen(false) }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [settingsOpen, dropdownOpen])

  // ── Nav helpers ───────────────────────────────────────────────────────────
  // Use store.getState() to avoid stale closure issues with Zustand async actions
  function saveProgress(chapter, page) {
    const book = useAppStore.getState().activeBook
    if (!book) return
    const savedChapter = Math.max(0, chapter - 1)
    const savedPage    = chapter === 0 ? 0 : page
    useAppStore.getState().updateBookProgress(book.id, savedChapter, savedPage)
    useAppStore.getState().persistLibrary()
  }

  function nextPage() {
    const chaps = chaptersRef.current
    const ch    = curChapterRef.current
    const pg    = curPageRef.current
    const p     = prefsRef.current
    const step  = p.twoPage ? 2 : 1
    const breaks = getPageBreaks(ch)
    const total  = breaks.length || 1

    if (pg + step <= total - 1) {
      const np = pg + step; setCurPage(np); saveProgress(ch, np)
    } else if (pg < total - 1) {
      const np = total - 1; setCurPage(np); saveProgress(ch, np)
    } else if (ch < chaps.length - 1) {
      const nc = ch + 1; setCurChapter(nc); setCurPage(0); saveProgress(nc, 0)
    }
  }

  function prevPage() {
    const ch    = curChapterRef.current
    const pg    = curPageRef.current
    const p     = prefsRef.current
    const step  = p.twoPage ? 2 : 1

    if (pg >= step) {
      const np = pg - step; setCurPage(np); saveProgress(ch, np)
    } else if (pg > 0) {
      setCurPage(0); saveProgress(ch, 0)
    } else if (ch > 0) {
      const nc = ch - 1
      const prevBreaks = getPageBreaks(nc)
      const lastPage   = p.twoPage
        ? Math.floor((prevBreaks.length - 1) / 2) * 2
        : prevBreaks.length - 1
      setCurChapter(nc); setCurPage(lastPage); saveProgress(nc, lastPage)
    }
  }

  function jumpToChapter(chIdx, pgIdx = 0) {
    setCurChapter(chIdx); setCurPage(pgIdx)
    if (cardRef.current && chaptersRef.current.length) {
      renderPage(cardRef.current, chaptersRef.current, chIdx, pgIdx, prefsRef.current.twoPage, false)
    }
    saveProgress(chIdx, pgIdx)
  }

  // ── Prefs ─────────────────────────────────────────────────────────────────
  function handlePrefChange(key, value) {
    setPref(key, value)
    persistPreferences()
  }

  function handleRebuild() {
    if (!cardRef.current || chaptersRef.current.length === 0) return
    const p = prefsRef.current
    ensurePageStyle(p)
    cardRef.current.classList.toggle('two-page', p.twoPage)
    cardRef.current.classList.toggle('highlight-words', p.highlightWords)
    cardRef.current.classList.toggle('underline-line', p.underlineLine)
    invalidateCache()
    precomputeAllChapters(chaptersRef.current, p, cardRef.current)
    const cache = {}
    for (let i = 0; i < chaptersRef.current.length; i++) cache[i] = getPageBreaks(i)
    setBreaksCache(cache)
    renderPage(cardRef.current, chaptersRef.current, curChapterRef.current, curPageRef.current, p.twoPage, false)
  }

  // ── Page jump ─────────────────────────────────────────────────────────────
  function handlePageJump(val) {
    const target = parseInt(val, 10)
    const total  = getTotalPages()
    setPageInput(null)
    if (isNaN(target) || target < 1 || target > total) return
    let remaining = target - 1
    for (let i = 0; i < chaptersRef.current.length; i++) {
      const chPgs = breaksCache[i]?.length || 1
      if (remaining < chPgs) { jumpToChapter(i, remaining); return }
      remaining -= chPgs
    }
    jumpToChapter(chaptersRef.current.length - 1, 0)
  }

  function exit() {
    resetEngine()
    setView('library')
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const chapterBreaks  = getPageBreaks(curChapter)
  const totalInChapter = chapterBreaks.length || 1
  const totalPages     = getTotalPages()
  const globalPage     = getGlobalPage(curChapter, curPage)
  const pct            = totalPages > 1 ? (globalPage / (totalPages - 1)) * 100 : 0
  const atStart        = curChapter === 0 && curPage === 0
  const atEnd          = curChapter >= chapters.length - 1 && curPage >= totalInChapter - 1
  const pagesLeft      = totalInChapter - curPage - 1
  const isCover        = chapters[curChapter]?.title === '_cover_'
  const chapterTitle   = isCover ? 'Cover' : (chapters[curChapter]?.title || '')
  const allThemes      = { ...BUILT_IN_THEMES, ...(prefs.customThemes || {}) }
  const [c1, c2]       = activeBook ? generateCoverColor(activeBook.title) : ['#1a1a2e', '#16213e']

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="view active" style={{ flexDirection: 'column' }}>

      {/* Header */}
      <header className="reader-header">
        <div className="reader-header-logo">
          <GnosNavButton />
          <button className="btn-icon text-logo" onClick={exit}>Gnos</button>
        </div>

        <div className="chapter-nav-wrapper">
          <button className="btn-chapter" onClick={e => { e.stopPropagation(); setDropdownOpen(o => !o); setSettingsOpen(false) }}>
            <div className="title-row">
              <span>{activeBook?.title || ''}</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="sub-row">{chapterTitle}</div>
          </button>
          {dropdownOpen && (
            <ChapterDropdown chapters={chapters} currentChapter={curChapter}
              breaksCache={breaksCache} onJump={jumpToChapter} onClose={() => setDropdownOpen(false)} />
          )}
        </div>

        <div className="reader-actions">
          <button className="btn-reader-icon" title="Reader settings"
            onClick={e => { e.stopPropagation(); setSettingsOpen(o => !o); setDropdownOpen(false) }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </header>

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel prefs={prefs} themes={allThemes}
          onPrefChange={handlePrefChange} onRebuild={handleRebuild} />
      )}

      {/* Tap zones */}
      {prefs.tapToTurn && !loading && (
        <>
          <div className="tap-zone left" onClick={prevPage}>
            <div className="tap-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
          <div className="tap-zone right" onClick={nextPage}>
            <div className="tap-icon">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </>
      )}

      {/* Main card area */}
      <main className="reader-main" style={{ position: 'relative' }}>
        <div ref={cardRef} className="reader-card" />

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 24,
            background: 'var(--readerCard)', zIndex: 10,
          }}>
            {activeBook?.coverDataUrl
              ? <img src={activeBook.coverDataUrl} alt=""
                  style={{ maxWidth: 220, maxHeight: 300, objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }} />
              : <div style={{ width: 160, height: 220, borderRadius: 8, background: `linear-gradient(135deg,${c1},${c2})`, boxShadow: '0 8px 40px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'flex-end', padding: 14, boxSizing: 'border-box' }}>
                  <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: 700, fontFamily: 'Georgia,serif', lineHeight: 1.3 }}>{activeBook?.title}</span>
                </div>
            }
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--textDim)', fontSize: 12 }}>
              <div className="spinner" /><span>Loading…</span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="reader-footer">
        <div className="footer-nav">
          <button className="btn outline" disabled={atStart} onClick={prevPage}>← Prev</button>

          <span className="page-indicator">
            {'Page '}
            {pageInput !== null
              ? <input type="number" min={1} max={totalPages} value={pageInput}
                  autoFocus
                  style={{ width: Math.max(36, String(totalPages).length * 10 + 16), background: 'transparent', border: 'none', borderBottom: '1px solid var(--textDim)', color: 'var(--text)', fontSize: 'inherit', fontFamily: 'inherit', textAlign: 'center', padding: '0 2px', outline: 'none' }}
                  onChange={e => setPageInput(e.target.value)}
                  onBlur={e => handlePageJump(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handlePageJump(e.target.value); if (e.key === 'Escape') setPageInput(null) }}
                  onClick={e => e.target.select()} />
              : <span style={{ cursor: 'pointer' }} onClick={() => setPageInput(globalPage + 1)}>
                  {globalPage + 1}
                </span>
            }
            {` of ${totalPages} · ${Math.round(pct)}%`}
            {!isCover && (pagesLeft <= 0
              ? ' · last page'
              : pagesLeft === (prefs.twoPage ? 2 : 1)
                ? ' · 1 pg left'
                : ` · ${pagesLeft} pgs left`
            )}
          </span>

          <button className="btn outline" disabled={atEnd} onClick={nextPage}>Next →</button>
        </div>
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      </footer>
    </div>
  )
}