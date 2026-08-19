import { useEffect, useLayoutEffect, useRef, useState, useCallback, useContext, useMemo } from 'react'
import useAppStore, { useAppStoreShallow } from '@/store/useAppStore'
import { PaneContext } from '@/lib/PaneContext'
import { useIsActiveTab } from '@/lib/useIsActiveTab'
import { useIsMobile } from '@/lib/useIsMobile'
import { loadBookContent, addReadingMinutes, loadNotebookContent, saveNotebookContent, getJSON, setJSON, getLocalJSON, setLocalJSON } from '@/lib/storage'
import QuickAccess, { useTitlebarMeta } from '@/components/QuickAccess'
import { generateCoverColor } from '@/lib/utils'
import {
  ensurePageStyle, setupColumns, renderChapterContent, revealContent,
  measurePageCount, showPage, trimContainerWidth, invalidateCache,
  setWordWrapEnabled, getActivePage,
  scanAllChapters, cancelScan,
  cacheCurrentChapter, clearChapterCache,
  getVisibleChildIndex, pageOfChild, prunePrewarm,
  getCachedChapter, renderChapterIntoBuffer, swapBufferToStrip,
  getTotalPages, getLayoutMetrics,
} from '@/lib/Paginationengine'
import { markFlip, markChapterStart, markChapterEnd, markRender, perfOn } from '@/lib/readerPerf'

// ── SettingsPanel ─────────────────────────────────────────────────────────────

import { Toggle, Slider, Select } from '@/components/Controls'
import { ALargeSmall, AlignJustify, Bookmark, BookText, ChevronDown, ChevronLeft, ChevronRight, Copy, Globe, Highlighter, Languages, Pause, Play, Share2, SkipBack, SkipForward, StretchVertical, Trash2, Volume2, X } from 'lucide-react'

function SettingsPanel({ prefs, onPrefChange, onRebuild, onClose, piperVoices = [] }) {
  const { fontSize, lineSpacing, fontFamily, justifyText, tapToTurn, twoPage, highlightWords, underlineLine, pageTransition, fontWeight, ttsRate } = prefs
  const isMobile = useIsMobile()
  return (
    <div className="settings-panel" style={{ display: 'block' }} onClick={e => e.stopPropagation()}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,paddingBottom:12,borderBottom:'1px solid var(--borderSubtle)'}}>
        <span style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>Reader Settings</span>
        <button className="settings-panel-close" onClick={onClose} title="Close" style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}} onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}><X size={9} strokeWidth={1.5} /></button>
      </div>
      <div className="section-label">DISPLAY</div>
      <div className="reader-slider-row">
        <span className="reader-slider-icon-sm" style={{ fontFamily: 'Georgia, serif', fontWeight: 700 }}>A</span>
        <Slider min={14} max={28} step={1} value={fontSize}
          onChange={v => onPrefChange('fontSize', v)}
          onCommit={onRebuild}
          style={{ flex: 1 }} />
        <span className="reader-slider-icon-lg" style={{ fontFamily: 'Georgia, serif', fontWeight: 700 }}>A</span>
      </div>
      <div className="reader-slider-row">
        <AlignJustify size={16} strokeWidth={1.4} style={{ flexShrink: 0 }} />
        <Slider min={1.4} max={2.4} step={0.1} value={lineSpacing}
          onChange={v => onPrefChange('lineSpacing', v)}
          onCommit={onRebuild}
          style={{ flex: 1 }} />
        <StretchVertical size={16} strokeWidth={1.4} style={{ flexShrink: 0 }} />
      </div>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        <div style={{ marginBottom: 5 }}>Font</div>
        <Select value={fontFamily} onChange={v => { onPrefChange('fontFamily', v); onRebuild() }}>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Palatino Linotype', serif">Palatino</option>
          <option value="Baskerville, Georgia, serif">Baskerville</option>
          <option value="'Times New Roman', serif">Times New Roman</option>
          <option value="'New York', Georgia, serif">New York</option>
          <option value="Charter, Georgia, serif">Charter</option>
          <option value="'American Typewriter', serif">American Typewriter</option>
          <option value="'Helvetica Neue', Arial, sans-serif">Helvetica Neue</option>
          <option value="system-ui, sans-serif">System UI</option>
          <option value="'Courier New', monospace">Courier New</option>
        </Select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>Bold text</div>
        <Toggle on={fontWeight === 700} onChange={() => { onPrefChange('fontWeight', fontWeight === 700 ? 400 : 700); setTimeout(onRebuild, 20) }} />
      </label>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borderSubtle)' }}>
        <div className="section-label">NAVIGATION &amp; LAYOUT</div>
        {[
          { label: 'Tap margins to turn', key: 'tapToTurn',   val: tapToTurn },
          { label: 'Justify text',        key: 'justifyText', val: justifyText !== false, rebuild: true },
          ...(!isMobile ? [{ label: 'Two-page spread', key: 'twoPage', val: twoPage, rebuild: true }] : []),
        ].map(({ label, key, val, rebuild }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
            <Toggle on={!!val} onChange={() => { onPrefChange(key, !val); if (rebuild) setTimeout(onRebuild, 20) }} />
          </label>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>Page transition</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {['slide', 'fade'].map(opt => (
              <button key={opt}
                onClick={() => onPrefChange('pageTransition', opt)}
                style={{
                  padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${pageTransition === opt ? 'var(--accent)' : 'var(--border)'}`,
                  background: pageTransition === opt ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surfaceAlt)',
                  color: pageTransition === opt ? 'var(--accent)' : 'var(--textDim)',
                  transition: 'all 0.1s',
                  textTransform: 'capitalize',
                }}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borderSubtle)' }}>
        <div className="section-label">ACCESSIBILITY</div>
        {[
          { label: 'Highlight words on hover', key: 'highlightWords', val: highlightWords },
          { label: 'Underline current line',   key: 'underlineLine',  val: underlineLine },
        ].map(({ label, key, val }) => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 500 }}>{label}</div>
            <Toggle on={!!val} onChange={() => { onPrefChange(key, !val); setTimeout(onRebuild, 20) }} />
          </label>
        ))}
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--borderSubtle)' }}>
        <div className="section-label">TEXT-TO-SPEECH</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>Speed</span>
          <span style={{ fontSize: 12, color: 'var(--textDim)', minWidth: 32, textAlign: 'right' }}>{(ttsRate ?? 1.0).toFixed(1)}×</span>
        </div>
        <Slider min={0.5} max={2.0} step={0.1} value={ttsRate ?? 1.0}
          onChange={v => onPrefChange('ttsRate', v)}
          style={{ width: '100%', marginBottom: 12 }} />
        {piperVoices.length > 0 && (
          <label style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
            <div style={{ marginBottom: 5 }}>Piper voice</div>
            <Select value={prefs.piperVoice || ''} onChange={v => onPrefChange('piperVoice', v)}>
              <option value="">Web Speech (default)</option>
              {piperVoices.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          </label>
        )}
      </div>
    </div>
  )
}

// ── ReviewPanel ───────────────────────────────────────────────────────────────

const HL_COLORS = {
  yellow: { bg: 'rgba(255,210,0,0.65)', text: '#1a1200' },
  green:  { bg: 'rgba(72,199,116,0.55)', text: '#0a2e14' },
  pink:   { bg: 'rgba(255,105,180,0.5)', text: '#3a0020' },
  blue:   { bg: 'rgba(79,195,247,0.5)', text: '#001e30' },
  purple: { bg: 'rgba(179,136,255,0.5)', text: '#1a0035' },
}
const HL_COLOR_KEYS = Object.keys(HL_COLORS)

function ReviewPanel({ highlights, bookmarks, chapters, onJump, onLocate, onClose, onDeleteHighlight, onDeleteBookmark, onSaveNote, onSendToNotebook, onExportMarkdown, onToggleBookmark, isBookmarked }) {
  const [tab, setTab] = useState('highlights')
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [sending, setSending] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  // In-book full-text search — chapters are already in memory as text blocks.
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (q.length < 2) return []
    const out = []
    for (let ci = 0; ci < chapters.length; ci++) {
      const blocks = chapters[ci]?.blocks || []
      for (let bi = 0; bi < blocks.length; bi++) {
        const text = blocks[bi]?.text || ''
        const at = text.toLowerCase().indexOf(q)
        if (at === -1) continue
        const start = Math.max(0, at - 40)
        out.push({
          chIdx: ci, blockIdx: bi,
          before: (start > 0 ? '…' : '') + text.slice(start, at),
          match: text.slice(at, at + q.length),
          after: text.slice(at + q.length, at + q.length + 60) + (at + q.length + 60 < text.length ? '…' : ''),
        })
        if (out.length >= 100) return out
      }
    }
    return out
  }, [searchQ, chapters])

  // Group highlights by chapter index
  const grouped = {}
  for (const hl of highlights) {
    if (!grouped[hl.chapterIdx]) grouped[hl.chapterIdx] = []
    grouped[hl.chapterIdx].push(hl)
  }
  const sortedChapterIdxs = Object.keys(grouped).map(Number).sort((a, b) => a - b)

  const tabStyle = (active) => ({
    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    border: 'none', background: 'none', borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--textDim)', transition: 'all 0.1s', fontFamily: 'inherit',
  })

  return (
    <div className="settings-panel" style={{ display: 'block', width: 300 }} onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--borderSubtle)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Bookmarks & Notes</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {onToggleBookmark && (
            <button onClick={onToggleBookmark} title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              style={{ height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surfaceAlt)', color: isBookmarked ? 'var(--accent)' : 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', fontSize: 10.5, fontWeight: 600, fontFamily: 'inherit' }}>
              {isBookmarked
                ? <Bookmark size={10} strokeWidth={1.6} fill="currentColor" />
                : <Bookmark size={10} strokeWidth={1.6} />}
              {isBookmarked ? 'Bookmarked' : 'Bookmark page'}
            </button>
          )}
          <button onClick={onClose} title="Close" style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surfaceAlt)', color: 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,81,73,0.12)'; e.currentTarget.style.color = '#f85149' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surfaceAlt)'; e.currentTarget.style.color = 'var(--textDim)' }}>
            <X size={9} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', marginBottom: 12, borderBottom: '1px solid var(--borderSubtle)' }}>
        <button style={tabStyle(tab === 'highlights')} onClick={() => setTab('highlights')}>Highlights</button>
        <button style={tabStyle(tab === 'bookmarks')} onClick={() => setTab('bookmarks')}>Bookmarks</button>
        <button style={tabStyle(tab === 'search')} onClick={() => setTab('search')}>Search</button>
      </div>

      {tab === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)' }}>
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} autoFocus
            placeholder="Search in book…"
            style={{ background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text)', fontSize: 12, padding: '7px 10px', fontFamily: 'inherit',
              outline: 'none', marginBottom: 10, flexShrink: 0 }} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {searchQ.trim().length >= 2 && searchResults.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--textDim)', textAlign: 'center', padding: '20px 0' }}>No matches</div>
            )}
            {searchQ.trim().length >= 2 && searchResults.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--textDim)', marginBottom: 8 }}>
                {searchResults.length >= 100 ? '100+ matches' : `${searchResults.length} match${searchResults.length !== 1 ? 'es' : ''}`}
              </div>
            )}
            {searchResults.map((r, i) => (
              <div key={i}
                onClick={() => { onLocate?.(r.chIdx, r.blockIdx); onClose() }}
                style={{ padding: '7px 9px', borderRadius: 8, cursor: 'pointer', marginBottom: 4,
                  background: 'var(--surfaceAlt)', border: '1px solid transparent',
                  transition: 'border-color 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--textDim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                  {chapters[r.chIdx]?.title || `Chapter ${r.chIdx}`}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.45 }}>
                  {r.before}<mark style={{ background: 'color-mix(in srgb, var(--accent) 30%, transparent)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>{r.match}</mark>{r.after}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'highlights' && (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 180px)' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {highlights.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--textDim)', textAlign: 'center', padding: '20px 0' }}>No highlights yet</div>
          )}
          {sortedChapterIdxs.map(chIdx => (
            <div key={chIdx} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--textDim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                {chapters[chIdx]?.title || `Chapter ${chIdx}`}
              </div>
              {grouped[chIdx].map(hl => (
                <div key={hl.id} style={{ marginBottom: 8, borderRadius: 6, border: '1px solid var(--borderSubtle)', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '7px 8px', cursor: 'pointer', background: 'var(--surfaceAlt)' }}
                    onClick={() => { onJump(hl.chapterIdx, 0); onClose() }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, marginTop: 2,
                      background: HL_COLORS[hl.color || 'yellow']?.bg || HL_COLORS.yellow.bg }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
                        {(hl.text || '').slice(0, 80)}{(hl.text || '').length > 80 ? '…' : ''}
                      </span>
                      {hl.page != null && (
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--textDim)', marginTop: 2 }}>p. {hl.page + 1}</span>
                      )}
                    </div>
                    <button onClick={e => { e.stopPropagation(); onDeleteHighlight(hl.id) }}
                      style={{ background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                      title="Delete">
                      <Trash2 size={12} strokeWidth={1.4} />
                    </button>
                  </div>
                  {hl.note && editingNoteId !== hl.id && (
                    <div style={{ fontSize: 11, color: 'var(--textDim)', padding: '4px 8px 6px', fontStyle: 'italic', lineHeight: 1.4 }}
                      onClick={() => { setEditingNoteId(hl.id); setNoteText(hl.note || '') }}>
                      {hl.note}
                    </div>
                  )}
                  {editingNoteId === hl.id ? (
                    <input autoFocus value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      onBlur={() => { onSaveNote(hl.id, noteText); setEditingNoteId(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') { onSaveNote(hl.id, noteText); setEditingNoteId(null) } if (e.key === 'Escape') setEditingNoteId(null) }}
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: 'none', borderTop: '1px solid var(--borderSubtle)', color: 'var(--text)', fontSize: 11, padding: '5px 8px', fontFamily: 'inherit', outline: 'none' }}
                      placeholder="Add a note…" />
                  ) : !hl.note ? (
                    <button onClick={() => { setEditingNoteId(hl.id); setNoteText('') }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--borderSubtle)', color: 'var(--textDim)', cursor: 'pointer', fontSize: 10, padding: '4px 8px', fontFamily: 'inherit' }}>
                      + note
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Send to Notebook / Export footer */}
        {highlights.length > 0 && (
          <div style={{ borderTop: '1px solid var(--borderSubtle)', padding: '10px 8px', display: 'flex', gap: 6 }}>
            <button
              disabled={sending}
              onClick={async () => {
                setSending(true)
                await onSendToNotebook()
                setSending(false)
              }}
              style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, opacity: sending ? 0.6 : 1 }}>
              {sending ? 'Saving…' : 'Send to Notebook'}
            </button>
            <button
              onClick={onExportMarkdown}
              title="Export highlights as a Markdown file"
              style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surfaceAlt)', color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
              Export .md
            </button>
          </div>
        )}
        </div>
      )}

      {tab === 'bookmarks' && (
        <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {bookmarks.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--textDim)', textAlign: 'center', padding: '20px 0' }}>No bookmarks yet</div>
          )}
          {bookmarks.map(bm => (
            <div key={bm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderRadius: 6, cursor: 'pointer', marginBottom: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              onClick={() => { onJump(bm.chapterIdx, bm.page); onClose() }}>
              <Bookmark size={12} strokeWidth={1.4} color="var(--accent)" fill="var(--accent)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bm.label}</div>
                <div style={{ fontSize: 10, color: 'var(--textDim)' }}>{chapters[bm.chapterIdx]?.title || `Chapter ${bm.chapterIdx}`} · p.{bm.page + 1}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); onDeleteBookmark(bm.id) }}
                style={{ background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                title="Delete">
                <Trash2 size={12} strokeWidth={1.4} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── ChapterDropdown ───────────────────────────────────────────────────────────

function ChapterDropdown({ chapters, currentChapter, chapterPageCounts, onJump, onClose, externalSearch }) {
  const [search, setSearch] = useState(externalSearch || '')
  const realChapters = chapters.filter(c => c.title !== '_cover_')

  useEffect(() => {
    if (externalSearch !== undefined) setSearch(externalSearch)
  }, [externalSearch])

  const q = search.trim().toLowerCase()
  const pageNumMatch = q.match(/^p(?:age)?\s*(\d+)$|^(\d+)$/)
  const isPureNumber = pageNumMatch && /^\d+$/.test(q)
  const queryNum = isPureNumber ? parseInt(q, 10) : null

  const bookTitle = useAppStore.getState().activeBook?.title || ''

  return (
    <div className="dropdown" style={{ display: 'block' }} onClick={e => e.stopPropagation()}>
      <div className="dropdown-header">
        <div className="drop-title">{bookTitle}</div>
        {externalSearch !== undefined ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <div className="drop-stats" style={{ margin: 0 }}>Chapter {currentChapter} of {realChapters.length}</div>
              <div className="drop-stats" style={{ margin: 0 }}>{realChapters.length} chapter{realChapters.length !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ height: 3, background: 'var(--borderSubtle)', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
              <div style={{ width: `${Math.min(100, (currentChapter / Math.max(1, realChapters.length)) * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
            </div>
          </>
        ) : (
          <>
            <div className="drop-stats">{realChapters.length} chapter(s)</div>
            <input className="chapter-search-input" placeholder="Search chapters..."
              value={search} onChange={e => setSearch(e.target.value)} autoFocus />
          </>
        )}
      </div>
      <div>
        {chapters.map((ch, i) => {
          if (i === 0 && ch.title === '_cover_') return null
          if (q && !isPureNumber && !ch.title.toLowerCase().includes(q)) return null
          if (isPureNumber && queryNum !== null) {
            if (i !== queryNum && !ch.title.toLowerCase().includes(q)) return null
          }
          {/* No global page labels: only ±3 neighbor chapters are ever measured
              (full-book layout froze the UI), so global offsets would be wrong. */}
          return (
            <div key={i} className={`chapter-item${i === currentChapter ? ' active' : ''}`}
              onClick={() => { onJump(i, 0); onClose() }}>
              <div className="ch-flex">
                <div className="ch-title">{ch.title}</div>
              </div>
              <div className="ch-sub">Chapter {i}</div>
            </div>
          )
        })}
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
  const paneTabId          = useContext(PaneContext)
  const isActive           = useIsActiveTab()
  const isMobile           = useIsMobile()
  const activeBook         = useAppStore(useCallback(
    s => {
      const tab = paneTabId ? s.tabs.find(t => t.id === paneTabId) : null
      return tab?.activeBook ?? s.activeBook
    },
    [paneTabId]
  ))
  const setPref            = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)
  const sideNavOpen        = useAppStore(s => s.sideNavOpen)
  const notebooks          = useAppStore(s => s.notebooks)
  const addNotebook        = useAppStore(s => s.addNotebook)
  const persistNotebooks   = useAppStore(s => s.persistNotebooks)
  const tapToTurnLive      = useAppStore(s => s.tapToTurn)

  // Read all prefs in one selector so settings panel always stays in sync
  const prefs = useAppStoreShallow(s => ({
    fontSize:        s.fontSize,
    lineSpacing:     s.lineSpacing,
    fontFamily:      s.fontFamily,
    justifyText:     s.justifyText,
    tapToTurn:       s.tapToTurn,
    twoPage:         s.twoPage,
    highlightWords:  s.highlightWords,
    underlineLine:   s.underlineLine,
    themeKey:        s.themeKey,
    customThemes:    s.customThemes,
    pageTransition:  s.pageTransition ?? 'slide',
    fontWeight:      s.fontWeight ?? 400,
    ttsRate:         s.ttsRate ?? 1.0,
    piperVoice:      s.piperVoice ?? '',
  }))

  // perf: time this render pass (no-op unless __readerPerf.on()). Paired with the
  // useLayoutEffect below, which fires after React has committed to the DOM.
  const _renderT0 = perfOn() ? performance.now() : 0
  useLayoutEffect(() => { if (_renderT0) markRender(performance.now() - _renderT0) })

  const cardRef      = useRef(null)
  const containerRef = useRef(null)
  const resizeDebounceRef = useRef(null)
  const lastHeightRef     = useRef(0)

  const [chapters,     setChapters]     = useState([])
  const [curChapter,   setCurChapter]   = useState(0)
  const [curPage,      setCurPage]      = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [reviewOpen,   setReviewOpen]   = useState(false)
  const [pageCount,    setPageCount]    = useState(1)  // pages in current chapter
  const [pagenumHover, setPagenumHover] = useState(false) // furniture: number vs "N of total"

  const chapterPageCountsRef = useRef({}) // { [chapterIdx]: pageCount }
  const [scanTick, setScanTick] = useState(0) // incremented when background scan updates a count

  // Persistent pagination index (Apple-Books-style): once every chapter is
  // measured for the current layout, exact global "page X of N" is shown and the
  // counts are cached to disk keyed by layout, so reopening at the same font/size
  // is instant and never re-measures. Layout change → rebuild at deep idle.
  const [indexComplete, setIndexComplete] = useState(false)
  const indexCompleteRef  = useRef(false)
  const [indexBuilding, setIndexBuilding] = useState(false)
  const layoutKeyRef      = useRef('')
  const indexBuildTimerRef = useRef(null)
  useEffect(() => { indexCompleteRef.current = indexComplete }, [indexComplete])

  // Rapid-nav scrubber: during bursts of taps only the footer counter updates.
  // 180ms after the last tap a single showPage() renders the settled page.
  const lastNavTimeRef   = useRef(0)
  const rapidNavTimerRef = useRef(null)
  const persistTimerRef  = useRef(null)

  const chaptersRef   = useRef([])
  const curChapterRef = useRef(0)
  const curPageRef    = useRef(0)
  const prefsRef      = useRef(prefs)
  prefsRef.current    = prefs

  // Keep refs in sync — assigned every render, no useEffect needed
  chaptersRef.current   = chapters
  curChapterRef.current = curChapter
  curPageRef.current    = curPage

  // Fresh-function ref for mobile event listeners — assigned after all state is declared below
  const mobileRef = useRef({})

  // ── Mobile: wire up reader commands from bottom nav ──────────────────────────
  useEffect(() => {
    const h = e => {
      const r = mobileRef.current
      const { cmd } = e.detail
      if (cmd === 'prev') r.prevPage()
      if (cmd === 'next') r.nextPage()
      if (cmd === 'tts-toggle') r.ttsActive ? r.ttsStop() : r.ttsStart(null)
      if (cmd === 'tts-prev') r.ttsNav?.(-1)
      if (cmd === 'tts-pause') r.ttsTogglePause?.()
      if (cmd === 'tts-next') r.ttsNav?.(1)
      if (cmd === 'settings') r.setSettingsOpen(o => !o)
      if (cmd === 'chapters') r.setDropdownOpen(o => !o)
      if (cmd === 'chapters-close') { r.setDropdownOpen(false); r.setChapterSearchExternal('') }
    }
    window.addEventListener('gnos:reader-cmd', h)
    return () => window.removeEventListener('gnos:reader-cmd', h)
  }, [])

  // ── Mobile: sync chapter search from bottom nav ───────────────────────────────
  const [chapterSearchExternal, setChapterSearchExternal] = useState('')
  useEffect(() => {
    const h = e => {
      const q = e.detail || ''
      setChapterSearchExternal(q)
      if (q) setDropdownOpen(true)
    }
    window.addEventListener('gnos:reader-chapter-search', h)
    return () => window.removeEventListener('gnos:reader-chapter-search', h)
  }, [])

  // ── Focus mode (double-tap to hide all chrome) ────────────────────────────
  const [focusMode, setFocusMode] = useState(false)
  const lastTapRef    = useRef(0)
  const swipeTouchRef = useRef(null)

  useEffect(() => {
    document.body.classList.toggle('reader-focus-mode', focusMode)
    return () => document.body.classList.remove('reader-focus-mode')
  }, [focusMode])

  useEffect(() => {
    if (!cardRef.current) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        handleRebuildRef.current?.()
      })
    })
  }, [focusMode])

  // Swipe + double-tap (mobile only) — attached after containerRef is set
  useEffect(() => {
    if (!isMobile) return
    const el = containerRef.current
    if (!el) return

    function onTouchStart(e) {
      const t = e.touches[0]
      swipeTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    }

    function onTouchEnd(e) {
      const start = swipeTouchRef.current
      if (!start) return
      swipeTouchRef.current = null
      const t  = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      const dt = Date.now() - start.time

      if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && dt < 300) {
        const now = Date.now()
        if (now - lastTapRef.current < 400) {
          lastTapRef.current = 0
          setFocusMode(m => !m)
        } else {
          lastTapRef.current = now
        }
        return
      }

      if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 44 && dt < 450) {
        if (dx < 0) mobileRef.current.nextPage?.()
        else mobileRef.current.prevPage?.()
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reading timer — tracks minutes spent reading for streak/stats ───────────
  useEffect(() => {
    if (!activeBook || !isActive) return
    const TICK_MS  = 60_000   // save every 60 s
    const IDLE_MS  = 120_000  // stop counting after 2 min of inactivity
    let lastActive = Date.now()
    let accumulated = 0

    const onActivity = () => { lastActive = Date.now() }
    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('keydown',   onActivity, { passive: true })

    const interval = setInterval(() => {
      if (Date.now() - lastActive < IDLE_MS) {
        accumulated += TICK_MS / 60_000   // accumulate fractional minutes
        if (accumulated >= 1) {
          addReadingMinutes(Math.floor(accumulated)).catch(() => {})
          accumulated -= Math.floor(accumulated)
        }
      }
    }, TICK_MS)

    return () => {
      clearInterval(interval)
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown',   onActivity)
      // Flush any partial minute on unmount
      if (accumulated >= 0.1) addReadingMinutes(Math.max(1, Math.round(accumulated))).catch(() => {})
    }
  }, [activeBook, isActive])

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBook) return
    let cancelled = false

    async function load() {
      setLoading(true)
      invalidateCache()
      // Set early — the page-index store key needs it before the neighbor/index
      // scan kicks off (this load effect runs before the bookIdRef effect).
      bookIdRef.current = activeBook.id
      setIndexComplete(false)

      const rawChapters = await loadBookContent(activeBook)
      if (cancelled) return
      if (!rawChapters) { setLoading(false); return }

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
      if (cancelled || !cardRef.current) return

      const p = prefsRef.current
      setWordWrapEnabled(p.highlightWords || p.underlineLine)
      ensurePageStyle(p)
      cardRef.current.classList.toggle('two-page', p.twoPage)
      cardRef.current.classList.toggle('highlight-words', p.highlightWords)
      cardRef.current.classList.toggle('underline-line', p.underlineLine)

      invalidateCache()
      setupColumns(cardRef.current, { ...p, lang: activeBook?.language || 'en' })
      chapterPageCountsRef.current = {}
      renderChapterContent(allChapters[resumeChapter].blocks, resumePage)

      await new Promise(r => requestAnimationFrame(r))
      if (cancelled || !cardRef.current) return

      const count = measurePageCount()
      chapterPageCountsRef.current[resumeChapter] = count
      prevChapterRef.current = resumeChapter  // prevent re-render effect from re-rendering
      setPageCount(count)
      trimContainerWidth(count)
      cacheCurrentChapter(resumeChapter, count)
      showPage(resumePage, false)
      revealContent()
      setLoading(false)
      startBackgroundScan(resumeChapter)
    }

    load()
    return () => { cancelled = true; cancelScan(); clearTimeout(rapidNavTimerRef.current); clearTimeout(persistTimerRef.current); clearTimeout(indexBuildTimerRef.current) }
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
      card.querySelectorAll('.col-word.same-line').forEach(s => s.classList.remove('same-line'))
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
  const prevChapterRef   = useRef(-1)
  const chapterRenderRef = useRef(null) // debounce timer for cross-chapter renders

  useEffect(() => {
    if (loading || !cardRef.current || chapters.length === 0) return
    if (prevChapterRef.current === curChapter) return // page-only change: handled directly in nextPage/prevPage
    prevChapterRef.current = curChapter
    const chapterAtRender = curChapter

    // Both paths render into the hidden buffer and atomically swap it in —
    // the old page stays on screen until the new chapter is fully laid out.
    // No overlay, no blank flash.

    // Cache hit (visited or prewarmed): buffer gets the prebuilt HTML.
    const cached = getCachedChapter(chapterAtRender)
    if (cached) {
      const _t = markChapterStart()
      renderChapterIntoBuffer(null, cached.html)
      requestAnimationFrame(() => {
        if (prevChapterRef.current !== chapterAtRender) return
        const count = swapBufferToStrip(curPageRef.current) ?? cached.count
        markChapterEnd(_t, { chapter: chapterAtRender, cached: true, count })
        chapterPageCountsRef.current[chapterAtRender] = count
        setPageCount(count)
        resolvePendingLocate(chapterAtRender)
        applyHighlightsToCard(cardRef.current, bookIdRef.current, chapterAtRender)
      })
      return
    }

    // Cache miss — full build, still buffered.
    // Debounce so rapid chapter-boundary crossings skip intermediate renders
    // and only commit the chapter the user actually lands on.
    clearTimeout(chapterRenderRef.current)
    chapterRenderRef.current = setTimeout(() => {
      if (prevChapterRef.current !== chapterAtRender) return
      const _t = markChapterStart()
      renderChapterIntoBuffer(chapters[chapterAtRender].blocks)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (prevChapterRef.current !== chapterAtRender) return
        const count = swapBufferToStrip(curPageRef.current)
        if (count == null) return
        markChapterEnd(_t, { chapter: chapterAtRender, cached: false, count })
        chapterPageCountsRef.current[chapterAtRender] = count
        setPageCount(count)
        cacheCurrentChapter(chapterAtRender, count)
        resolvePendingLocate(chapterAtRender)
        applyHighlightsToCard(cardRef.current, bookIdRef.current, chapterAtRender)
        startBackgroundScan(chapterAtRender)
      }))
    }, 20)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curChapter])

  // ── Keyboard nav ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const handler = (e) => {
      if (settingsOpen || dropdownOpen || e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextPage()
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   prevPage()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, settingsOpen, dropdownOpen])

  // ── Close panels on outside click ────────────────────────────────────────
  useEffect(() => {
    if (!settingsOpen && !dropdownOpen && !reviewOpen) return
    const handler = () => { setSettingsOpen(false); setDropdownOpen(false); setReviewOpen(false) }
    // Defer to avoid the same tap that opened the panel immediately closing it
    const t = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(t); document.removeEventListener('click', handler) }
  }, [settingsOpen, dropdownOpen, reviewOpen])

  // ── Nav helpers ───────────────────────────────────────────────────────────
  // Use store.getState() to avoid stale closure issues with Zustand async actions
  // Store writes are debounced: updateBookProgress rewrites the library array,
  // which re-renders every subscriber (incl. the kept-alive LibraryView grid) —
  // doing that per page flip was the main source of flip lag. Local refs/state
  // stay current; the store catches up 400ms after the user pauses.
  //
  // The disk write itself goes to persistBookProgress (its own small
  // reading_progress.json), NOT persistLibrary — this used to rewrite the
  // ENTIRE library array on every settle-after-pause while reading, which was
  // fine until one book's metadata bloated to hundreds of MB (A83) and every
  // position tick paid to rewrite all of it, for every book, repeatedly.
  const progressWriteRef = useRef(null)
  function saveProgress(chapter, page) {
    clearTimeout(progressWriteRef.current)
    progressWriteRef.current = setTimeout(() => {
      const book = useAppStore.getState().activeBook
      if (!book) return
      const savedChapter = Math.max(0, chapter - 1)
      const savedPage    = chapter === 0 ? 0 : page
      useAppStore.getState().updateBookProgress(book.id, savedChapter, savedPage)
      // Debounce the disk write — updateBookProgress keeps in-memory state
      // current, the small progress file only needs to flush once the user pauses.
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        useAppStore.getState().persistBookProgress(book.id, savedChapter, savedPage)
      }, 500)
    }, 400)
  }

  // Flush any pending (debounced) progress write on unmount so closing the tab
  // right after a flip can't lose the last position.
  useEffect(() => () => {
    if (progressWriteRef.current == null) return
    clearTimeout(progressWriteRef.current)
    const id = bookIdRef.current
    if (!id) return
    const ch = curChapterRef.current, pg = curPageRef.current
    const savedChapter = Math.max(0, ch - 1), savedPage = ch === 0 ? 0 : pg
    useAppStore.getState().updateBookProgress(id, savedChapter, savedPage)
    useAppStore.getState().persistBookProgress(id, savedChapter, savedPage)
  }, [])

  // Schedules the settle render: 180ms after the last rapid tap, show the page
  // the user landed on with no animation and save progress.
  // During a rapid burst the strip is already translated per-tap (showPage is
  // cheap — a compositor transform); we only DEFER the React number update to
  // avoid re-rendering the whole view every keypress. Settle just commits the
  // final page number + progress.
  function scheduleSettle() {
    clearTimeout(rapidNavTimerRef.current)
    rapidNavTimerRef.current = setTimeout(() => {
      const ch = curChapterRef.current
      const pg = curPageRef.current
      setCurPage(pg)
      saveProgress(ch, pg)
    }, 120)
  }

  // One flip step. Always translates the strip (cheap); animates only when not
  // rapid. Number update is immediate when slow, deferred to settle when rapid.
  function flipTo(np, ch, trans, rapid) {
    curPageRef.current = np
    markFlip(np)                         // perf: input → painted frame (no-op unless __readerPerf.on())
    showPage(np, rapid ? false : trans)  // showPage also self-detects rapid → instant
    if (rapid) {
      scheduleSettle()
    } else {
      requestAnimationFrame(() => { setCurPage(np); saveProgress(ch, np) })
    }
  }

  function nextPage() {
    const chaps = chaptersRef.current
    const ch    = curChapterRef.current
    const pg    = curPageRef.current
    const p     = prefsRef.current
    const step  = p.twoPage ? 2 : 1
    const total = chapterPageCountsRef.current[ch] || 1
    const trans = p.pageTransition || 'slide'

    const now   = Date.now()
    const rapid = now - lastNavTimeRef.current < 120
    lastNavTimeRef.current = now

    if (pg + step <= total - 1) {
      flipTo(pg + step, ch, trans, rapid)
    } else if (pg < total - 1) {
      flipTo(total - 1, ch, trans, rapid)
    } else if (ch < chaps.length - 1) {
      // Chapter boundary: commit the settle first (so the current chapter's last
      // page is saved), then do a full chapter transition. Not per-tap-guarded by
      // rapid — the double-buffer swap keeps the old page visible until ready.
      clearTimeout(rapidNavTimerRef.current)
      const nc = ch + 1
      curChapterRef.current = nc; curPageRef.current = 0
      setCurChapter(nc); setCurPage(0); saveProgress(nc, 0)
    }
  }

  function prevPage() {
    const ch    = curChapterRef.current
    const pg    = curPageRef.current
    const p     = prefsRef.current
    const step  = p.twoPage ? 2 : 1
    const trans = p.pageTransition || 'slide'

    const now   = Date.now()
    const rapid = now - lastNavTimeRef.current < 120
    lastNavTimeRef.current = now

    if (pg >= step) {
      flipTo(pg - step, ch, trans, rapid)
    } else if (pg > 0) {
      flipTo(0, ch, trans, rapid)
    } else if (ch > 0) {
      clearTimeout(rapidNavTimerRef.current)
      const nc = ch - 1
      const prevCount = chapterPageCountsRef.current[nc]
      const lastPage  = prevCount != null
        ? (p.twoPage ? Math.floor((prevCount - 1) / 2) * 2 : prevCount - 1)
        : 0
      curChapterRef.current = nc; curPageRef.current = lastPage
      setCurChapter(nc); setCurPage(lastPage); saveProgress(nc, lastPage)
    }
  }

  // ── Persistent pagination index ───────────────────────────────────────────
  const pageIndexStoreKey = () => `reader_pageindex_${bookIdRef.current}`
  function computeLayoutKey() {
    const p = prefsRef.current
    const m = getLayoutMetrics()
    return [p.fontSize, p.lineSpacing, p.fontFamily, p.justifyText !== false ? 1 : 0,
      p.fontWeight || 400, m.twoPage ? 2 : 1, `${m.colW}x${m.colH}`].join('|')
  }

  // Try to restore a complete index for the current layout; else schedule a
  // deep-idle build. Called once the current chapter has been measured.
  async function ensurePageIndex(currentChapterIdx) {
    const bookId = bookIdRef.current
    if (!bookId) return
    const key = computeLayoutKey()
    layoutKeyRef.current = key
    const nCh = chaptersRef.current.length
    const store = (await getLocalJSON(pageIndexStoreKey(), {})) || {}
    const stored = store[key]
    if (Array.isArray(stored) && stored.length === nCh && layoutKeyRef.current === key) {
      for (let i = 0; i < nCh; i++) {
        if (i !== currentChapterIdx) chapterPageCountsRef.current[i] = stored[i]
      }
      setIndexComplete(true)
      setScanTick(t => t + 1)
      // Still warm neighbor HTML for instant chapter switches.
      startNeighborPrewarm(currentChapterIdx)
      return
    }
    setIndexComplete(false)
    // Deep idle before building — never compete with the opening read.
    clearTimeout(indexBuildTimerRef.current)
    indexBuildTimerRef.current = setTimeout(() => runIndexBuild(key, currentChapterIdx), 4000)
  }

  // Full-book measure that also prewarms neighbors. Idempotent + resumable:
  // hasCount skips chapters already measured, so _scanAbort restarts (from
  // chapter navigation) are cheap. Persists + flips indexComplete when done.
  function runIndexBuild(key, currentChapterIdx) {
    const chapters = chaptersRef.current
    const nCh = chapters.length
    if (!nCh) return
    prunePrewarm(currentChapterIdx)
    setIndexBuilding(true)
    scanAllChapters(chapters, (chIdx, count) => {
      chapterPageCountsRef.current[chIdx] = count
      setScanTick(t => t + 1)
      // All chapters known for THIS layout? persist + mark complete.
      if (layoutKeyRef.current !== key) return
      const counts = new Array(nCh)
      for (let i = 0; i < nCh; i++) {
        const c = chapterPageCountsRef.current[i]
        if (c == null) return   // not finished yet
        counts[i] = c
      }
      setIndexBuilding(false)
      setIndexComplete(true)
      getLocalJSON(pageIndexStoreKey(), {}).then(s => {
        const store = s || {}
        store[key] = counts
        setLocalJSON(pageIndexStoreKey(), store).catch(() => {})
      })
    }, { around: currentChapterIdx, hasCount: (i) => chapterPageCountsRef.current[i] != null })
  }

  // Warm only ±neighbor HTML (no counts needed) for instant chapter switches.
  function startNeighborPrewarm(currentChapterIdx) {
    const chapters = chaptersRef.current
    if (!chapters.length) return
    prunePrewarm(currentChapterIdx)
    scanAllChapters(chapters, () => {},
      { around: currentChapterIdx, neighborsOnly: true, hasCount: () => false })
  }

  // ── Background book scan entry ────────────────────────────────────────────
  // Complete index → just warm neighbors. Incomplete → build/continue the index
  // (which also warms neighbors first via scan order).
  function startBackgroundScan(currentChapterIdx) {
    if (indexCompleteRef.current) startNeighborPrewarm(currentChapterIdx)
    else ensurePageIndex(currentChapterIdx)
  }

  function jumpToChapter(chIdx, pgIdx = 0) {
    const sameChapter = chIdx === curChapterRef.current
    curChapterRef.current = chIdx
    curPageRef.current    = pgIdx
    if (sameChapter) showPage(pgIdx, false)
    setCurChapter(chIdx); setCurPage(pgIdx)
    saveProgress(chIdx, pgIdx)
  }

  // ── Locate a specific block (in-book search results) ─────────────────────
  // Same chapter: resolve block → page immediately. Cross-chapter: stash the
  // block index; the chapter-render effect resolves it once the strip exists.
  const pendingLocateRef = useRef(null)
  function locateBlock(chIdx, blockIdx) {
    const snap = (pg) => prefsRef.current.twoPage ? pg - (pg % 2) : pg
    if (chIdx === curChapterRef.current) {
      const pg = snap(pageOfChild(blockIdx))
      jumpToChapter(chIdx, pg)
    } else {
      pendingLocateRef.current = { chIdx, blockIdx }
      jumpToChapter(chIdx, 0)
    }
  }
  // Resolve a stashed locate after the target chapter's strip is in the DOM.
  function resolvePendingLocate(chIdx) {
    const p = pendingLocateRef.current
    if (!p || p.chIdx !== chIdx) return
    pendingLocateRef.current = null
    let pg = pageOfChild(p.blockIdx)
    if (prefsRef.current.twoPage) pg -= pg % 2
    curPageRef.current = pg
    setCurPage(pg)
    showPage(pg, false)
    saveProgress(chIdx, pg)
  }

  // ── Prefs ─────────────────────────────────────────────────────────────────
  const persistDebounceRef = useRef(null)
  function handlePrefChange(key, value) {
    setPref(key, value)
    // Debounce persistence so rapid toggle clicks don't block the UI
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current)
    persistDebounceRef.current = setTimeout(() => persistPreferences(), 400)
  }

  // Keep a stable ref so the zoom keydown effect can call the current rebuild
  const handleRebuildRef = useRef(null)

  // ── Cmd/Ctrl + +/- zoom ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const handler = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== '+' && e.key !== '=' && e.key !== '-') return
      e.preventDefault()
      const current = prefsRef.current.fontSize
      const next = e.key === '-' ? Math.max(14, current - 1) : Math.min(28, current + 1)
      if (next === current) return
      setPref('fontSize', next)
      clearTimeout(persistDebounceRef.current)
      persistDebounceRef.current = setTimeout(() => persistPreferences(), 400)
      // Trigger a re-render then rebuild pagination with new size (coalesced —
      // holding ⌘+ repeats fast and should relayout once, not per keypress)
      clearTimeout(rebuildDebounceRef.current)
      rebuildDebounceRef.current = setTimeout(() => handleRebuildRef.current?.(), 250)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [isActive]) // isActive + refs only — stable

  function handleRebuild() {
    if (!cardRef.current || chaptersRef.current.length === 0) return
    const p     = prefsRef.current
    const cardEl = cardRef.current
    const ch    = curChapterRef.current
    const pg    = curPageRef.current

    // Anchor the reading position to the first visible block — page indices
    // don't survive layout changes (font size, resize, two-page toggle).
    const anchorChild = getVisibleChildIndex(pg)

    setWordWrapEnabled(p.highlightWords || p.underlineLine)
    ensurePageStyle(p)
    cardEl.classList.toggle('two-page', p.twoPage)
    cardEl.classList.toggle('highlight-words', p.highlightWords)
    cardEl.classList.toggle('underline-line', p.underlineLine)

    invalidateCache()       // also clears _chapterCache via PaginationEngine
    clearChapterCache()     // ensure stale layout params don't survive
    setupColumns(cardEl, { ...p, lang: activeBook?.language || 'en' })
    chapterPageCountsRef.current = {}
    // Layout changed → the stored page index for the old layout no longer
    // applies; ensurePageIndex (via startBackgroundScan) restores or rebuilds
    // for the new layout key.
    setIndexComplete(false)
    clearTimeout(indexBuildTimerRef.current)
    prevChapterRef.current = ch  // prevent re-render effect from double-rendering

    renderChapterContent(chaptersRef.current[ch].blocks, pg)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const count = measurePageCount()
      chapterPageCountsRef.current[ch] = count
      setPageCount(count)
      // Resolve the anchored block back to a page in the NEW layout.
      let restoredPg = Math.min(pageOfChild(anchorChild), Math.max(0, count - 1))
      if (p.twoPage) restoredPg -= restoredPg % 2   // land on a spread boundary
      trimContainerWidth(count)
      cacheCurrentChapter(ch, count)
      showPage(restoredPg, false)
      revealContent()
      if (restoredPg !== pg) { setCurPage(restoredPg); saveProgress(ch, restoredPg) }
      requestAnimationFrame(() => applyHighlightsToCard(cardEl, bookIdRef.current, ch))
      // Scan all other chapters with the new layout settings so totalPages stays accurate.
      startBackgroundScan(ch)
    }))
  }
  handleRebuildRef.current = handleRebuild

  // Coalesced rebuild — settings toggles fire this; rapid changes collapse to one relayout.
  const rebuildDebounceRef = useRef(null)
  function requestRebuild() {
    clearTimeout(rebuildDebounceRef.current)
    rebuildDebounceRef.current = setTimeout(() => handleRebuildRef.current?.(), 250)
  }

  // ── Auto-rebuild when container height changes (e.g. window resize) ───────
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect?.height ?? 0
      if (Math.abs(h - lastHeightRef.current) < 2) return // ignore sub-pixel jitter
      lastHeightRef.current = h
      clearTimeout(resizeDebounceRef.current)
      resizeDebounceRef.current = setTimeout(() => {
        handleRebuildRef.current?.()
      }, 150)
    })
    ro.observe(el)
    return () => { ro.disconnect(); clearTimeout(resizeDebounceRef.current) }
  }, []) // refs only — stable

  // ── TTS (Text-To-Speech) state ─────────────────────────────────────────────
  const [ttsActive,   setTtsActive]   = useState(false)
  const [ttsSentence, setTtsSentence] = useState('')
  const [ttsPaused,   setTtsPaused]   = useState(false)
  const [ttsProgress, setTtsProgress] = useState(0)
  const ttsUtterRef   = useRef(null)
  const ttsSentencesRef = useRef([])
  const ttsSentIdxRef   = useRef(0)
  const ttsActiveWordRef = useRef(null) // currently highlighted .col-word el
  const piperAudioRef   = useRef(null)  // current piper Audio element

  // Keep mobileRef fresh with latest functions/state (after all state is declared)
  mobileRef.current = { prevPage, nextPage, ttsActive, ttsStart, ttsStop, ttsTogglePause, ttsNav, setSettingsOpen, setDropdownOpen, setChapterSearchExternal, setFocusMode }

  // Broadcast TTS state to mobile nav
  useEffect(() => {
    if (!isMobile) return
    window.dispatchEvent(new CustomEvent('gnos:reader-state', { detail: { ttsActive, ttsPaused } }))
  }, [ttsActive, ttsPaused, isMobile])

  // ── Highlight / bookmark state ─────────────────────────────────────────────
  const highlightsRef = useRef({}) // { [bookId]: [{ id, chapterIdx, text, color, note }] }
  const bookmarksRef  = useRef({}) // { [bookId]: [{ id, chapterIdx, page, label, createdAt }] }
  const bookIdRef = useRef(null)
  const wordMenuRef = useRef(null)
  const defPopupRef = useRef(null)

  // Bump-only counters: force re-render so the bookmark icon + panels reflect ref changes
  const [highlightVersion, setHighlightVersion] = useState(0)
  const [bookmarkVersion,  setBookmarkVersion]  = useState(0)
  void highlightVersion; void bookmarkVersion
  const [wordMenuColorPick, setWordMenuColorPick] = useState(false)
  const [pendingHL, setPendingHL] = useState(null) // { id, chapterIdx, text, color, note }
  const [toast, setToast] = useState(null)
  const [piperVoices, setPiperVoices] = useState([])

  // Load highlights + bookmarks — archive storage is the source of truth,
  // localStorage is the fallback (web dev mode) and one-time migration source.
  useEffect(() => {
    if (!activeBook?.id) return
    bookIdRef.current = activeBook.id
    let cancelled = false

    const fromLocal = (key) => {
      try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
    }

    ;(async () => {
      const [hls, bms] = await Promise.all([
        getJSON('annotations_highlights', null),
        getJSON('annotations_bookmarks', null),
      ])
      if (cancelled) return

      if (hls !== null) {
        highlightsRef.current = hls
      } else {
        // Archive empty — migrate any existing localStorage data into it
        highlightsRef.current = fromLocal('gnos_highlights')
        if (Object.keys(highlightsRef.current).length) setJSON('annotations_highlights', highlightsRef.current)
      }
      if (bms !== null) {
        bookmarksRef.current = bms
      } else {
        bookmarksRef.current = fromLocal('gnos_bookmarks')
        if (Object.keys(bookmarksRef.current).length) setJSON('annotations_bookmarks', bookmarksRef.current)
      }
      setBookmarkVersion(v => v + 1)
      setHighlightVersion(v => v + 1)
    })()

    return () => { cancelled = true }
  }, [activeBook?.id])

  // Load piper voices once on mount — also install bundled binary/voices first
  useEffect(() => {
    if (typeof window.__TAURI_INTERNALS__ === 'undefined') return
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('piper_install_bundled').catch(() => {})
        .finally(() => {
          invoke('piper_list_voices').then(v => setPiperVoices(v || [])).catch(() => {})
        })
    })
  }, [])

  function saveHighlights() {
    try { localStorage.setItem('gnos_highlights', JSON.stringify(highlightsRef.current)) } catch { /* */ }
    setJSON('annotations_highlights', highlightsRef.current).catch(() => {})
  }

  function saveBookmarks() {
    try { localStorage.setItem('gnos_bookmarks', JSON.stringify(bookmarksRef.current)) } catch { /* */ }
    setJSON('annotations_bookmarks', bookmarksRef.current).catch(() => {})
  }

  function isCurrentPageBookmarked() {
    const bookId = bookIdRef.current
    if (!bookId) return null
    return (bookmarksRef.current[bookId] || []).find(
      b => b.chapterIdx === curChapterRef.current && b.page === curPageRef.current
    ) || null
  }

  function toggleBookmark() {
    const bookId = bookIdRef.current
    if (!bookId) return
    const existing = isCurrentPageBookmarked()
    if (existing) {
      bookmarksRef.current[bookId] = (bookmarksRef.current[bookId] || []).filter(b => b.id !== existing.id)
    } else {
      const chIdx = curChapterRef.current
      const pg = curPageRef.current
      const chTitle = chaptersRef.current[chIdx]?.title === '_cover_' ? 'Cover' : (chaptersRef.current[chIdx]?.title || `Chapter ${chIdx}`)
      const label = `${chTitle} p.${pg + 1}`
      if (!bookmarksRef.current[bookId]) bookmarksRef.current[bookId] = []
      bookmarksRef.current[bookId].push({ id: `bm_${Date.now()}`, chapterIdx: chIdx, page: pg, label, createdAt: Date.now() })
    }
    saveBookmarks()
    setBookmarkVersion(v => v + 1)
  }

  function applyHighlightsToCard(cardEl, bookId, chapterIdx) {
    if (!cardEl || !bookId) return
    const hls = (highlightsRef.current[bookId] || []).filter(h => h.chapterIdx === chapterIdx)
    if (!hls.length) return
    const wordSpans = Array.from(cardEl.querySelectorAll('.col-word'))
    for (const hl of hls) {
      const words = hl.text.trim().split(/\s+/)
      const cleanWords = words.map(w => w.toLowerCase().replace(/[^a-z0-9'\u2019]/g, ''))
      for (let i = 0; i <= wordSpans.length - words.length; i++) {
        const slice = wordSpans.slice(i, i + words.length)
        const sliceClean = slice.map(s => (s.dataset.word || s.textContent).toLowerCase().replace(/[^a-z0-9'\u2019]/g, ''))
        if (sliceClean.join(' ') === cleanWords.join(' ')) {
          const color = hl.color || 'yellow'
          slice.forEach(s => {
            s.classList.add('reader-hl', `hl-${color}`)
            s.dataset.hlId = hl.id
            s.dataset.hlColor = color
          })
          break
        }
      }
    }
  }

  function saveHighlightNote(hlId, note) {
    const bookId = bookIdRef.current
    if (!bookId) return
    const hls = highlightsRef.current[bookId] || []
    const idx = hls.findIndex(h => h.id === hlId)
    if (idx < 0) return
    hls[idx] = { ...hls[idx], note }
    highlightsRef.current[bookId] = hls
    saveHighlights()
    setHighlightVersion(v => v + 1)
  }

  // Build the markdown body for a book's highlights, grouped by chapter.
  function buildHighlightsMarkdown(book, hls, titleLine) {
    const grouped = {}
    for (const hl of hls) {
      if (!grouped[hl.chapterIdx]) grouped[hl.chapterIdx] = []
      grouped[hl.chapterIdx].push(hl)
    }
    const authorLine = book.author ? `*by ${book.author}*\n\n` : ''
    let md = `# ${titleLine}\n\n${authorLine}---\n`
    const sortedIdxs = Object.keys(grouped).map(Number).sort((a, b) => a - b)
    for (const chIdx of sortedIdxs) {
      const chTitle = chapters[chIdx]?.title || `Chapter ${chIdx + 1}`
      md += `\n## ${chTitle}\n\n`
      for (const hl of grouped[chIdx]) {
        const pageRef = hl.page != null ? ` *(p. ${hl.page + 1})*` : ''
        md += `***${hl.text}***${pageRef}\n`
        if (hl.note?.trim()) md += `\n> ${hl.note.trim()}\n`
        md += '\n'
      }
    }
    return md
  }

  async function exportHighlightsMarkdown() {
    const book   = activeBook
    const bookId = bookIdRef.current
    if (!book || !bookId) return
    const hls = highlightsRef.current[bookId] || []
    if (hls.length === 0) return

    const md = buildHighlightsMarkdown(book, hls, `${book.title} — Highlights`)
    const fileName = `${book.title.replace(/[/\\:*?"<>|]/g, '_')} — Highlights.md`

    try {
      if (typeof window.__TAURI_INTERNALS__ !== 'undefined') {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const path = await save({ defaultPath: fileName, filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (!path) return
        const { writeTextFile } = await import('@tauri-apps/plugin-fs')
        await writeTextFile(path, md)
      } else {
        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = fileName; a.click()
        URL.revokeObjectURL(url)
      }
      setToast('Highlights exported')
      setTimeout(() => setToast(null), 2500)
    } catch (err) {
      console.error('[Gnos] exportHighlightsMarkdown failed', err)
      setToast('Export failed')
      setTimeout(() => setToast(null), 2000)
    }
  }

  async function sendHighlightsToNotebook() {
    const book   = activeBook
    const bookId = bookIdRef.current
    if (!book || !bookId) return

    const hls = highlightsRef.current[bookId] || []
    if (hls.length === 0) return

    // Find or create a dedicated notebook for this book
    const nbId    = `book_hl_${bookId}`
    const nbTitle = `${book.title} — Highlights`
    let notebook  = notebooks.find(n => n.id === nbId)
    if (!notebook) {
      notebook = { id: nbId, title: nbTitle, wordCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      addNotebook(notebook)
      await persistNotebooks()
    }

    // Markers so re-send replaces instead of appending
    const markerStart = `<!-- gnos-highlights:${bookId}:start -->`
    const markerEnd   = `<!-- gnos-highlights:${bookId}:end -->`
    const section = `${markerStart}\n${buildHighlightsMarkdown(book, hls, `[[${book.title}]] — Highlights`)}\n${markerEnd}`

    try {
      const existing = await loadNotebookContent(nbId) || ''
      let updated
      if (existing.includes(markerStart)) {
        const startIdx = existing.indexOf(markerStart)
        const endIdx   = existing.indexOf(markerEnd)
        const after    = endIdx >= 0 ? existing.slice(endIdx + markerEnd.length) : ''
        updated = existing.slice(0, startIdx) + section + after
      } else {
        updated = (existing ? existing.trimEnd() + '\n\n' : '') + section
      }
      await saveNotebookContent(notebook, updated)
      setToast(`Saved to "${nbTitle}"`)
      setTimeout(() => setToast(null), 2500)
    } catch (err) {
      console.error('[Gnos] sendHighlightsToNotebook failed', err)
      setToast('Failed to save')
      setTimeout(() => setToast(null), 2000)
    }
  }

  function changeHighlightColor(hlId, color) {
    const bookId = bookIdRef.current
    if (!bookId) return
    const hls = highlightsRef.current[bookId] || []
    const idx = hls.findIndex(h => h.id === hlId)
    if (idx < 0) return
    hls[idx] = { ...hls[idx], color }
    highlightsRef.current[bookId] = hls
    saveHighlights()
    // Re-apply visuals on card
    const card = cardRef.current
    if (card) {
      card.querySelectorAll(`[data-hl-id="${hlId}"]`).forEach(el => {
        HL_COLOR_KEYS.forEach(c => el.classList.remove(`hl-${c}`))
        el.classList.add(`hl-${color}`)
        el.dataset.hlColor = color
      })
    }
    setHighlightVersion(v => v + 1)
  }

  // ── Word context menu state ────────────────────────────────────────────────
  const [wordMenu,       setWordMenu]       = useState(null) // { word, sentence, x, y }
  const [defPopup,       setDefPopup]       = useState(null) // { word, mode:'define'|'translate', x, y, content, loading }
  const [translateLang,  setTranslateLang]  = useState('es') // target language for translation

  // Clamp word-menu to viewport after it renders
  useLayoutEffect(() => {
    if (!wordMenu || !wordMenuRef.current) return
    const el = wordMenuRef.current
    const w = el.offsetWidth, h = el.offsetHeight
    const centerX = Math.max(w / 2 + 8, Math.min(wordMenu.x, window.innerWidth - w / 2 - 8))
    el.style.left = centerX + 'px'
    el.style.top  = Math.max(60, Math.min(wordMenu.y - 64, window.innerHeight - h - 8)) + 'px'
  }, [wordMenu])

  // Clamp def-popup to viewport after it renders
  useLayoutEffect(() => {
    if (!defPopup || !defPopupRef.current) return
    const el = defPopupRef.current
    const w = el.offsetWidth, h = el.offsetHeight
    const centerX = Math.max(w / 2 + 8, Math.min(defPopup.x, window.innerWidth - w / 2 - 8))
    el.style.left = centerX + 'px'
    el.style.top  = Math.max(60, Math.min(defPopup.y + 8, window.innerHeight - h - 8)) + 'px'
  }, [defPopup])

  // Available LibreTranslate target languages
  const LIBRE_LANGS = [
    { code:'es', name:'Spanish' }, { code:'fr', name:'French' }, { code:'de', name:'German' },
    { code:'it', name:'Italian' }, { code:'pt', name:'Portuguese' }, { code:'nl', name:'Dutch' },
    { code:'pl', name:'Polish' }, { code:'ru', name:'Russian' }, { code:'ja', name:'Japanese' },
    { code:'zh', name:'Chinese' }, { code:'ar', name:'Arabic' }, { code:'ko', name:'Korean' },
    { code:'sv', name:'Swedish' }, { code:'tr', name:'Turkish' }, { code:'uk', name:'Ukrainian' },
    { code:'hi', name:'Hindi' },
  ]

  function extractSentences(text) {
    return text.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)?.map(s => s.trim()).filter(Boolean) || []
  }

  const ttsSentenceSpansRef = useRef([])

  function ttsClearWordHighlight() {
    if (ttsActiveWordRef.current) {
      ttsActiveWordRef.current.classList.remove('tts-word-active')
      ttsActiveWordRef.current = null
    }
  }

  async function ttsSpeakSentenceWithPiper(sentence, onEnd) {
    try {
      const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
      const wavPath = await invoke('piper_speak', {
        text: sentence,
        voice: prefsRef.current.piperVoice,
        speed: prefsRef.current.ttsRate ?? 1.0,
      })
      const audio = new Audio(convertFileSrc(wavPath))
      piperAudioRef.current = audio
      audio.onended = () => { piperAudioRef.current = null; onEnd() }
      audio.onerror = () => { piperAudioRef.current = null; onEnd() }
      await audio.play()
    } catch (err) {
      console.error('[Piper]', err)
      onEnd()
    }
  }

  function ttsClearSentenceHighlight() {
    ttsSentenceSpansRef.current.forEach(s => s.classList.remove('tts-sentence-active'))
    ttsSentenceSpansRef.current = []
  }

  function ttsSpeakSentence(sentence, onEnd) {
    const usePiper = !!(prefsRef.current.piperVoice)
    if (usePiper) { ttsSpeakSentenceWithPiper(sentence, onEnd); return }
    window.speechSynthesis.cancel()
    ttsClearWordHighlight()
    // Build ordered list of word spans for this sentence to match by position
    const card = cardRef.current
    const ttsPageEl = getActivePage() || card
    const allSpans = ttsPageEl ? Array.from(ttsPageEl.querySelectorAll('.col-word')) : []
    const sentWords = sentence.trim().replace(/[\u201c\u201d\u2018\u2019]/g, '').split(/\s+/).filter(Boolean)
    let sentenceSpans = []
    let spanIdx = 0
    outer: for (let start = 0; start < allSpans.length; start++) {
      for (let len = sentWords.length; len >= Math.max(1, sentWords.length - 2); len--) {
        const candidate = allSpans.slice(start, start + len)
        const candidateText = candidate.map(s => s.textContent.replace(/[\u201c\u201d\u2018\u2019]/g, '').trim()).join(' ')
        const sentText = sentWords.slice(0, len).join(' ')
        if (candidateText.toLowerCase() === sentText.toLowerCase()) {
          sentenceSpans = candidate
          break outer
        }
      }
    }
    ttsClearSentenceHighlight()
    if (isMobile && sentenceSpans.length > 0) {
      sentenceSpans.forEach(s => s.classList.add('tts-sentence-active'))
      ttsSentenceSpansRef.current = sentenceSpans
    }

    const utt = new SpeechSynthesisUtterance(sentence)
    utt.rate = prefsRef.current.ttsRate ?? 1.0
    utt.onend = () => { ttsClearWordHighlight(); ttsClearSentenceHighlight(); spanIdx = 0; onEnd() }
    utt.onboundary = (e) => {
      if (e.name !== 'word') return
      const charIdx = e.charIndex
      let end = charIdx
      while (end < sentence.length && /\S/.test(sentence[end])) end++
      const rawWord = sentence.slice(charIdx, end)
      const clean = rawWord.replace(/[^a-zA-Z'\u2019\u2018]/g, '').toLowerCase().replace(/[\u2019\u2018]/g, "'")
      if (!clean) return

      ttsClearWordHighlight()

      let found = null

      // Primary: advance through this sentence's pre-matched spans by index
      if (sentenceSpans.length > 0) {
        while (spanIdx < sentenceSpans.length) {
          const t = (sentenceSpans[spanIdx].dataset.word || sentenceSpans[spanIdx].textContent)
            .toLowerCase().replace(/[^a-zA-Z']/g, '').replace(/[\u2019\u2018]/g, "'")
          if (t === clean || t.startsWith(clean) || clean.startsWith(t)) {
            found = sentenceSpans[spanIdx]
            spanIdx++
            break
          }
          spanIdx++
        }
      }

      // Fallback: scan forward from last highlighted position across active page spans
      if (!found) {
        const fbPageEl = getActivePage() || cardRef.current
        if (fbPageEl) {
          const spans = Array.from(fbPageEl.querySelectorAll('.col-word'))
          const startFrom = ttsActiveWordRef._lastIdx ?? 0
          for (let i = startFrom; i < spans.length; i++) {
            const t = (spans[i].dataset.word || spans[i].textContent)
              .toLowerCase().replace(/[^a-zA-Z']/g, '').replace(/[\u2019\u2018]/g, "'")
            if (t === clean || t.startsWith(clean) || clean.startsWith(t)) {
              found = spans[i]
              ttsActiveWordRef._lastIdx = i + 1
              break
            }
          }
        }
      }

      if (found) {
        found.classList.add('tts-word-active')
        ttsActiveWordRef.current = found
      }
    }
    ttsActiveWordRef._lastIdx = 0
    ttsUtterRef.current = utt
    window.speechSynthesis.speak(utt)
    setTtsSentence(sentence)
  }

  function ttsStart(startText) {
    const card = cardRef.current
    if (!card) return
    const activePage = getActivePage() || card
    const allText = Array.from(activePage.querySelectorAll('p, h2, h3'))
      .map(el => el.textContent.trim()).filter(Boolean).join(' ')
    const sentences = extractSentences(allText)
    if (!sentences.length) return

    // The strip holds the whole chapter, so without an anchor TTS would start at
    // the chapter top. Anchor to the first words visible on the current page.
    if (!startText) {
      const cardRect = card.getBoundingClientRect()
      const spans = activePage.querySelectorAll('.col-word')
      const firstVisible = []
      for (const s of spans) {
        const r = s.getBoundingClientRect()
        if (r.right > cardRect.left + 1 && r.left < cardRect.right) {
          firstVisible.push(s.textContent.trim())
          if (firstVisible.length >= 6) break
        } else if (firstVisible.length) break
      }
      if (firstVisible.length) startText = firstVisible.join(' ')
    }

    // Find closest sentence to the anchor text. Try the full anchor first, then
    // progressively shorter word prefixes (the anchor may straddle a sentence break).
    let startIdx = 0
    if (startText) {
      const words = startText.toLowerCase().split(/\s+/).filter(Boolean)
      for (let n = words.length; n >= 1 && startIdx <= 0; n--) {
        const probe = words.slice(0, n).join(' ')
        const found = sentences.findIndex(s => s.toLowerCase().includes(probe))
        if (found >= 0) { startIdx = found; break }
      }
      if (startIdx < 0) startIdx = 0
    }

    ttsSentencesRef.current = sentences
    ttsSentIdxRef.current   = startIdx
    setTtsActive(true)
    setTtsPaused(false)

    const speakNext = () => {
      const idx = ttsSentIdxRef.current
      if (idx >= ttsSentencesRef.current.length) { ttsStop(); return }
      setTtsProgress(idx / Math.max(1, ttsSentencesRef.current.length))
      ttsSpeakSentence(ttsSentencesRef.current[idx], () => {
        ttsSentIdxRef.current++
        speakNext()
      })
    }
    speakNext()
  }

  function ttsStop() {
    window.speechSynthesis.cancel()
    if (piperAudioRef.current) { piperAudioRef.current.pause(); piperAudioRef.current = null }
    ttsClearWordHighlight()
    ttsClearSentenceHighlight()
    setTtsActive(false)
    setTtsSentence('')
    setTtsPaused(false)
    setTtsProgress(0)
    ttsSentencesRef.current = []
    ttsSentIdxRef.current   = 0
  }

  function ttsTogglePause() {
    if (piperAudioRef.current) {
      if (ttsPaused) { piperAudioRef.current.play(); setTtsPaused(false) }
      else { piperAudioRef.current.pause(); setTtsPaused(true) }
      return
    }
    if (ttsPaused) {
      window.speechSynthesis.resume()
      setTtsPaused(false)
    } else {
      window.speechSynthesis.pause()
      setTtsPaused(true)
    }
  }

  function ttsNav(dir) {
    // dir=1 → next sentence, dir=-1 → previous sentence
    const delta = dir > 0 ? 1 : -1
    ttsSentIdxRef.current = Math.max(0, Math.min(
      ttsSentencesRef.current.length - 1,
      ttsSentIdxRef.current + delta
    ))
    window.speechSynthesis.cancel()
    ttsClearWordHighlight()
    ttsClearSentenceHighlight()
    const speakNext = () => {
      const idx = ttsSentIdxRef.current
      if (idx >= ttsSentencesRef.current.length) { ttsStop(); return }
      setTtsProgress(idx / Math.max(1, ttsSentencesRef.current.length))
      ttsSpeakSentence(ttsSentencesRef.current[idx], () => {
        ttsSentIdxRef.current++
        speakNext()
      })
    }
    speakNext()
  }

  // Stop TTS when leaving view
  useEffect(() => { return () => window.speechSynthesis?.cancel() }, [])

  // ── Card click handler for word context menu + TTS start ─────────────────
  function handleCardClick(e) {
    // Right-click opens word menu (via onContextMenu)
    // Left-click on a word when TTS is active → jump to that sentence
    if (ttsActive) {
      const word = e.target.closest('.col-word')
      if (word) {
        const wordText = word.dataset.word || word.textContent
        ttsStop()
        setTimeout(() => ttsStart(wordText), 50)
      }
    }
  }

  function handleCardContextMenu(e) {
    const wordEl = e.target.closest('.col-word')
    if (!wordEl) return
    e.preventDefault()
    const word = wordEl.dataset.word || wordEl.textContent

    // Extract sentence context
    const page = wordEl.closest('.page-content')
    const pageText = page ? page.textContent : ''
    const sentences = extractSentences(pageText)
    const sentence = sentences.find(s => s.toLowerCase().includes(word.toLowerCase())) || ''

    setWordMenu({ word, sentence, x: e.clientX, y: e.clientY,
      hlText: word, hlId: wordEl.dataset.hlId || null, hlChapterIdx: curChapterRef.current })
  }

  // ── Highlight: detect text selection on card mouseup ─────────────────────
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const handleMouseUp = () => {
      // Tiny delay so the selection is fully committed before we read it
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return
        const text = sel.toString().trim()
        if (!card.contains(sel.anchorNode)) return
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top
        // Don't clear the selection — let the user see what they selected
        setWordMenu({ word: text, sentence: text, x, y,
          hlText: text, hlChapterIdx: curChapterRef.current })
      }, 10)
    }
    card.addEventListener('mouseup', handleMouseUp)
    return () => card.removeEventListener('mouseup', handleMouseUp)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Click on highlighted word → show word menu with remove option
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const handleHlClick = (e) => {
      const span = e.target.closest('.reader-hl')
      if (!span?.dataset.hlId) return
      e.stopPropagation()
      const word = span.dataset.word || span.textContent || ''
      const page = span.closest('.page-content')
      const pageText = page ? page.textContent : ''
      const sentences = extractSentences(pageText)
      const sentence = sentences.find(s => s.toLowerCase().includes(word.toLowerCase())) || ''
      setWordMenu({ word, sentence, x: e.clientX, y: e.clientY,
        hlId: span.dataset.hlId, hlChapterIdx: curChapterRef.current })
    }
    card.addEventListener('click', handleHlClick)
    return () => card.removeEventListener('click', handleHlClick)
  }, [])

  // Close word menu on outside click
  useEffect(() => {
    if (!wordMenu) return
    const h = () => { setWordMenu(null); setWordMenuColorPick(false); setPendingHL(null) }
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [wordMenu])

  // Close def popup on outside click
  useEffect(() => {
    if (!defPopup) return
    const h = () => setDefPopup(null)
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [defPopup])

  // ── Derived state ─────────────────────────────────────────────────────────
  const totalInChapter = pageCount
  // scanTick is read here so background-scan updates (neighbor counts feeding
  // the chapter dropdown) trigger a re-render.
  void scanTick

  // In two-page mode each "page entry" is one CSS column; navigation steps by 2
  // so the reader sees spreads.  Convert raw column counts to spread counts for
  // all display values so the footer reads naturally.
  const navStep        = prefs.twoPage ? 2 : 1
  const displayInChap  = prefs.twoPage ? Math.ceil(totalInChapter / 2) : totalInChapter

  const pagesLeft      = displayInChap - Math.floor(curPage / navStep) - 1
  const curPageInChap  = Math.floor(curPage / navStep) + 1

  // Global page numbers only once the persistent index is complete for this
  // layout — no estimates, no per-flip recompute (counts come from refs/disk).
  let globalRawPage = curPage
  for (let _i = 0; _i < curChapter; _i++) globalRawPage += chapterPageCountsRef.current[_i] || 0
  const totalRawPages  = indexComplete ? getTotalPages(chapterPageCountsRef.current, chapters.length) : 0
  const globalPageNum  = prefs.twoPage ? Math.floor(globalRawPage / 2) + 1 : globalRawPage + 1
  const globalPageTot  = prefs.twoPage ? Math.ceil(totalRawPages / 2) : totalRawPages

  // Progress: global when the index is ready, else chapter-local (both exact).
  const pct = indexComplete && globalPageTot > 1
    ? ((globalPageNum - 1) / (globalPageTot - 1)) * 100
    : (displayInChap > 1 ? ((curPageInChap - 1) / (displayInChap - 1)) * 100 : 0)
  const isCover        = chapters[curChapter]?.title === '_cover_'
  const chapterTitle   = isCover ? 'Cover' : (chapters[curChapter]?.title || '')
  const [c1, c2]       = activeBook ? generateCoverColor(activeBook.title) : ['#1a1a2e', '#16213e']

  // Chapter dropdown lives inside the title-bar search bar
  useTitlebarMeta(chapters.length > 0 ? {
    text: chapterTitle ? chapterTitle.slice(0, 28) : null,
    dropdown: {
      items: chapters.map((ch, i) => ({ id: i, label: ch.title === '_cover_' ? 'Cover' : (ch.title || `Chapter ${i + 1}`) })),
      activeId: curChapter,
      onSelect: (i) => jumpToChapter(Number(i), 0),
    },
  } : null)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="view active" style={{ flexDirection: 'column' }}>
      <style>{`
        /* ── Word hover features ──────────────────────────────────────────── */
        .highlight-words .col-word:hover {
          background: color-mix(in srgb, var(--accent) 22%, transparent);
          border-radius: 2px;
          cursor: pointer;
        }
        .underline-line .col-word.same-line {
          text-decoration: underline;
          text-decoration-color: color-mix(in srgb, var(--accent) 50%, transparent);
          text-underline-offset: 2px;
        }

        /* ── Font size slider icons ───────────────────────────────────────── */
        .reader-slider-row {
          display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
        }
        .reader-slider-icon-sm { font-size: 11px; opacity: 0.55; flex-shrink: 0; }
        .reader-slider-icon-lg { font-size: 16px; opacity: 0.8; flex-shrink: 0; }
        .reader-slider-icon-sm-line { font-size: 10px; opacity: 0.55; flex-shrink: 0; line-height: 1; }
        .reader-slider-icon-lg-line { font-size: 10px; opacity: 0.8; flex-shrink: 0; line-height: 1; white-space: pre; }

        /* ── Word context menu — horizontal pill ─────────────────────────── */
        .word-menu {
          position: fixed; z-index: 9999;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 4px 6px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.45);
          display: flex; align-items: center; gap: 2px;
          animation: word-menu-in 0.12s ease;
          transform: translateX(-50%);
        }
        @keyframes word-menu-in {
          from { opacity: 0; transform: translateX(-50%) scale(0.92) translateY(-4px); }
          to   { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        }
        .word-menu-item {
          display: flex; flex-direction: row; align-items: center; gap: 6px;
          padding: 7px 10px; border: none; background: none;
          cursor: pointer; border-radius: 8px;
          font-size: 10px; font-weight: 600; color: var(--textDim); font-family: inherit;
          transition: background 0.08s, color 0.08s;
          letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap;
        }
        .word-menu-item:hover { background: var(--hover); color: var(--text); }
        .word-menu-item svg { flex-shrink: 0; }
        .word-menu-sep { width: 1px; height: 28px; background: var(--borderSubtle); margin: 0 2px; flex-shrink: 0; }

        /* ── Definition / Translate popup ────────────────────────────────── */
        .def-popup {
          position: fixed; z-index: 10000;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 12px; padding: 14px 16px;
          box-shadow: 0 12px 48px rgba(0,0,0,0.5);
          max-width: 380px; min-width: 260px;
          animation: word-menu-in 0.12s ease;
          transform: translateX(-50%);
        }
        .def-popup-word {
          font-size: 16px; font-weight: 700; color: var(--text);
          margin-bottom: 4px; font-family: Georgia, serif;
        }
        .def-popup-content {
          font-size: 13px; color: var(--textDim); line-height: 1.6;
          max-height: 180px; overflow-y: auto;
        }
        .def-popup-close {
          position: absolute; top: 8px; right: 10px;
          background: none; border: none; color: var(--textDim);
          cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 4px;
          border-radius: 4px; transition: color 0.1s;
        }
        .def-popup-close:hover { color: var(--text); }
        .def-popup-loading {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; color: var(--textDim);
        }

        /* ── TTS Player bar — Gnos style ──────────────────────────────────── */
        .tts-bar {
          position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px; padding: 10px 12px 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.45);
          display: flex; flex-direction: column; gap: 8px;
          width: 440px; max-width: calc(100vw - 24px);
          z-index: 8500;
          animation: tts-bar-in 0.18s cubic-bezier(0.4,0,0.2,1);
        }
        @keyframes tts-bar-in {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .tts-top-row {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .tts-controls-row {
          display: flex; align-items: center; justify-content: center; gap: 6px; flex: 1;
        }
        .tts-progress-bar {
          height: 3px; border-radius: 2px;
          background: var(--surfaceAlt); overflow: hidden;
        }
        .tts-progress-fill {
          height: 100%; background: var(--accent);
          transition: width 0.3s ease; border-radius: 2px;
        }
        .tts-sentence {
          font-size: 11px; color: var(--textDim); line-height: 1.5;
          font-style: italic; text-align: center;
          white-space: normal; word-break: break-word;
        }
        /* Gnos bordered button style */
        .tts-ctrl {
          height: 30px; min-width: 30px; padding: 0 6px;
          border: 1px solid var(--border); border-radius: 7px;
          background: var(--surface); color: var(--text);
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          transition: background 0.1s, border-color 0.1s;
          font-size: 11px; font-weight: 600;
        }
        .tts-ctrl:hover { background: var(--surfaceAlt); border-color: var(--accent); }
        .tts-ctrl.primary {
          border-color: var(--accent); color: var(--accent);
          width: 36px; height: 36px; border-radius: 9px;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent);
        }
        .tts-ctrl.primary:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
        /* X close button */
        .tts-close-btn {
          width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
          border: 1px solid var(--border); background: var(--surface);
          color: var(--textDim); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.1s, color 0.1s, border-color 0.1s;
        }
        .tts-close-btn:hover {
          background: rgba(248,81,73,0.12);
          color: #f85149; border-color: rgba(248,81,73,0.4);
        }

        /* ── Reader font weight ──────────────────────────────────────────── */
        .page-content { font-weight: var(--reader-font-weight, 400); }

        /* ── Reader text highlights ──────────────────────────────────────── */
        .col-word.reader-hl {
          border-radius: 1px;
          cursor: pointer;
        }
        .col-word.reader-hl.hl-yellow {
          background: rgba(255,210,0,0.65); color: #1a1200;
          box-shadow: 5px 0 0 rgba(255,210,0,0.65), -1px 0 0 rgba(255,210,0,0.65);
        }
        .col-word.reader-hl.hl-yellow:hover {
          background: rgba(255,210,0,0.85);
          box-shadow: 5px 0 0 rgba(255,210,0,0.85), -1px 0 0 rgba(255,210,0,0.85);
        }
        .col-word.reader-hl.hl-green {
          background: rgba(72,199,116,0.55); color: #0a2e14;
          box-shadow: 5px 0 0 rgba(72,199,116,0.55), -1px 0 0 rgba(72,199,116,0.55);
        }
        .col-word.reader-hl.hl-green:hover { background: rgba(72,199,116,0.75); box-shadow: 5px 0 0 rgba(72,199,116,0.75),-1px 0 0 rgba(72,199,116,0.75); }
        .col-word.reader-hl.hl-pink {
          background: rgba(255,105,180,0.5); color: #3a0020;
          box-shadow: 5px 0 0 rgba(255,105,180,0.5), -1px 0 0 rgba(255,105,180,0.5);
        }
        .col-word.reader-hl.hl-pink:hover { background: rgba(255,105,180,0.7); box-shadow: 5px 0 0 rgba(255,105,180,0.7),-1px 0 0 rgba(255,105,180,0.7); }
        .col-word.reader-hl.hl-blue {
          background: rgba(79,195,247,0.5); color: #001e30;
          box-shadow: 5px 0 0 rgba(79,195,247,0.5), -1px 0 0 rgba(79,195,247,0.5);
        }
        .col-word.reader-hl.hl-blue:hover { background: rgba(79,195,247,0.7); box-shadow: 5px 0 0 rgba(79,195,247,0.7),-1px 0 0 rgba(79,195,247,0.7); }
        .col-word.reader-hl.hl-purple {
          background: rgba(179,136,255,0.5); color: #1a0035;
          box-shadow: 5px 0 0 rgba(179,136,255,0.5), -1px 0 0 rgba(179,136,255,0.5);
        }
        .col-word.reader-hl.hl-purple:hover { background: rgba(179,136,255,0.7); box-shadow: 5px 0 0 rgba(179,136,255,0.7),-1px 0 0 rgba(179,136,255,0.7); }

        /* ── Highlight color swatch row ───────────────────────────────────── */
        .hl-swatch-row { display: flex; align-items: center; gap: 6px; padding: 6px 10px; }
        .hl-swatch { width: 18px; height: 18px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; transition: transform 0.1s, border-color 0.1s; flex-shrink: 0; }
        .hl-swatch:hover { transform: scale(1.2); }
        .hl-swatch.selected { border-color: var(--text); transform: scale(1.15); }


        /* ── Toast ────────────────────────────────────────────────────────── */
        .reader-toast {
          position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
          background: var(--surface); border: 1px solid var(--border);
          color: var(--text); font-size: 12px; font-weight: 600;
          padding: 7px 16px; border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          z-index: 9999; pointer-events: none;
          animation: word-menu-in 0.12s ease;
        }

        /* ── TTS word highlight ───────────────────────────────────────────── */
        .col-word.tts-word-active {
          background: color-mix(in srgb, var(--accent) 28%, transparent);
          border-radius: 2px;
          outline: none;
        }

        /* ── TTS sentence underline ──────────────────────────────────────── */
        .col-word.tts-sentence-active {
          text-decoration: underline;
          text-decoration-color: color-mix(in srgb, var(--accent) 55%, transparent);
          text-underline-offset: 2px;
          text-decoration-thickness: 1.5px;
        }
      `}</style>

      {/* Mobile chapter nav — fixed top center, always-visible floating button */}
      {isMobile && (
        <div className="reader-chapter-nav" style={{ position: 'fixed', top: 12, left: 54, right: 54, zIndex: 9001, display: 'flex', flexDirection: 'column', alignItems: 'center', transition: 'opacity 0.25s, transform 0.25s' }}>
          <button
            style={{
              width: '100%', maxWidth: 260,
              height: 36,
              border: '1px solid var(--border)', borderRadius: 10,
              background: 'var(--surface)', padding: '0 9px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
              cursor: 'pointer', outline: 'none',
            }}
            onClick={e => { e.stopPropagation(); setDropdownOpen(o => !o); setSettingsOpen(false) }}
          >
            {/* Row 1: Book title + chevron */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeBook?.title || ''}
              </span>
              <ChevronDown size={7} strokeWidth={1.6} style={{ flexShrink: 0, opacity: 0.45 }} />
            </div>
            {/* Row 2: Chapter · page X/Y · N left */}
            <div style={{ width: '100%', minWidth: 0, fontSize: 9, color: 'var(--textDim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {[
                chapterTitle,
                `page ${curPageInChap}/${displayInChap}`,
                pagesLeft <= 0 ? 'last page' : `${pagesLeft} left`,
              ].filter(Boolean).join(' · ')}
            </div>
            {/* Row 3: Progress bar */}
            <div style={{ width: '100%', height: 2, background: 'var(--border)', borderRadius: 1, overflow: 'hidden', marginTop: 1 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 1 }} />
            </div>
          </button>
          {dropdownOpen && (
            <ChapterDropdown chapters={chapters} currentChapter={curChapter}
              chapterPageCounts={chapterPageCountsRef.current} onJump={jumpToChapter}
              onClose={() => { setDropdownOpen(false); setChapterSearchExternal('') }}
              externalSearch={chapterSearchExternal} />
          )}
        </div>
      )}

      {/* Header replaced by the title bar: chapter dropdown lives in the search
          bar, actions in the quick-access strip. */}
      <QuickAccess>
        {/* Bookmarks & Notes — combined panel (bookmark toggle lives inside) */}
        <button className={`gnos-settings-btn${reviewOpen ? ' active' : ''}`} title="Bookmarks & notes"
          onClick={e => { e.stopPropagation(); setReviewOpen(o => !o); setSettingsOpen(false); setDropdownOpen(false) }}>
          <Bookmark size={14} strokeWidth={1.7} fill={isCurrentPageBookmarked() ? 'currentColor' : 'none'} />
        </button>
        {/* TTS playback */}
        <button className={`gnos-settings-btn${ttsActive ? ' active' : ''}`} title="Read aloud (TTS)"
          onClick={() => ttsActive ? ttsStop() : ttsStart(null)}>
          <Volume2 size={14} strokeWidth={1.7} />
        </button>
        {/* Reader settings (viewer + audio combined in one panel) — "Aa" text-size icon */}
        <button className={`gnos-settings-btn${settingsOpen ? ' active' : ''}`} title="Reader settings"
          onClick={e => { e.stopPropagation(); setSettingsOpen(o => !o); setDropdownOpen(false); setReviewOpen(false) }}>
          <ALargeSmall size={17} strokeWidth={1.6} />
        </button>
      </QuickAccess>

      {/* Settings panel */}
      {settingsOpen && (
        <SettingsPanel prefs={prefs} piperVoices={piperVoices}
          onPrefChange={handlePrefChange} onRebuild={requestRebuild} onClose={() => setSettingsOpen(false)} />
      )}

      {/* Review panel */}
      {reviewOpen && (() => {
        const bookId = bookIdRef.current
        const hls = bookId ? (highlightsRef.current[bookId] || []) : []
        const bms = bookId ? (bookmarksRef.current[bookId] || []) : []
        return (
          <ReviewPanel
            highlights={hls} bookmarks={bms} chapters={chapters}
            onSendToNotebook={sendHighlightsToNotebook}
            onExportMarkdown={exportHighlightsMarkdown}
            onToggleBookmark={toggleBookmark}
            isBookmarked={isCurrentPageBookmarked()}
            onJump={jumpToChapter} onLocate={locateBlock} onClose={() => setReviewOpen(false)}
            onDeleteHighlight={hlId => {
              const bId = bookIdRef.current
              if (!bId) return
              highlightsRef.current[bId] = (highlightsRef.current[bId] || []).filter(h => h.id !== hlId)
              saveHighlights()
              cardRef.current?.querySelectorAll(`[data-hl-id="${hlId}"]`).forEach(el => {
                el.classList.remove('reader-hl', ...HL_COLOR_KEYS.map(c => `hl-${c}`))
                delete el.dataset.hlId; delete el.dataset.hlColor
              })
              setHighlightVersion(v => v + 1)
            }}
            onDeleteBookmark={bmId => {
              const bId = bookIdRef.current
              if (!bId) return
              bookmarksRef.current[bId] = (bookmarksRef.current[bId] || []).filter(b => b.id !== bmId)
              saveBookmarks()
              setBookmarkVersion(v => v + 1)
            }}
            onSaveNote={saveHighlightNote}
          />
        )
      })()}

      {/* Tap zones — left zone shifts right when sidebar is open */}
      {tapToTurnLive && !loading && (
        <>
          <div className="tap-zone left" onClick={prevPage}
            style={sideNavOpen ? { left: 238 } : undefined}>
            <div className="tap-icon">
              <ChevronLeft size={14} strokeWidth={1.8} />
            </div>
          </div>
          <div className="tap-zone right" onClick={nextPage}>
            <div className="tap-icon">
              <ChevronRight size={14} strokeWidth={1.8} />
            </div>
          </div>
        </>
      )}

      {/* Main card area */}
      <main ref={containerRef} className="reader-main" style={{ position: 'relative' }}>
        <div ref={cardRef} className="reader-card"
          style={{ '--reader-font-weight': prefs.fontWeight ?? 400 }}
          onClick={handleCardClick}
          onDoubleClick={isMobile ? e => { if (!e.target.closest('button')) setFocusMode(m => !m) } : undefined}
          onContextMenu={handleCardContextMenu}
        />
        {/* Left margin hover chevron — always available (footer nav buttons are gone) */}
        {!loading && (
          <div
            onClick={prevPage}
            className="reader-margin-zone reader-margin-zone--left"
            style={{ position:'absolute', top:0, bottom:0, left:0, width:'12%', zIndex:10,
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
          >
            <ChevronLeft className="reader-margin-arrow" size={28} strokeWidth={2.5} />
          </div>
        )}
        {/* Right margin hover chevron — always available */}
        {!loading && (
          <div
            onClick={nextPage}
            className="reader-margin-zone reader-margin-zone--right"
            style={{ position:'absolute', top:0, bottom:0, right:0, width:'12%', zIndex:10,
              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}
          >
            <ChevronRight className="reader-margin-arrow" size={28} strokeWidth={2.5} />
          </div>
        )}

        {/* Page furniture — just the page number; hover reveals "N of total".
            Number is the absolute page once the persistent index is complete,
            else the chapter-local page (both exact). */}
        {!loading && !isCover && (
          <>
            <span className="reader-pagenum" style={{ left: '50%', cursor: 'default' }}
              onMouseEnter={() => setPagenumHover(true)}
              onMouseLeave={() => setPagenumHover(false)}>
              {indexComplete && globalPageTot > 0
                ? (pagenumHover ? `${globalPageNum} of ${globalPageTot}` : `${globalPageNum}`)
                : (pagenumHover ? `${curPageInChap} of ${displayInChap} in chapter` : `${curPageInChap}`)}
            </span>
            <span className="reader-pagesleft">
              {indexBuilding && !indexComplete
                ? 'calculating pages…'
                : pagesLeft <= 0 ? 'last page in chapter'
                : pagesLeft === 1 ? '1 page left'
                : `${pagesLeft} pages left`}
            </span>
          </>
        )}

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


      {/* Page furniture — Books-style quiet numbers on the paper, no footer bar.
          Nav = margin zones, keys, trackpad; jump = click the page number. */}

      {/* Focus mode floating footer — thin overlay with nav + info + progress */}
      {focusMode && (
        <div style={{
          position: 'fixed',
          bottom: 'max(28px, calc(env(safe-area-inset-bottom, 0px) + 16px))',
          left: '50%', transform: 'translateX(-50%)',
          zIndex: 9003,
          width: isMobile ? '88vw' : 'min(560px, 80vw)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.32)',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <div style={{ flex: 1, minWidth: 0, padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeBook?.title || ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--textDim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[chapterTitle, `page ${curPageInChap}/${displayInChap}`, pagesLeft <= 0 ? 'last page' : `${pagesLeft} left`].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>
          <div style={{ height: 2, background: 'var(--border)' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      {/* ── Mobile TTS controls bar — floats above bottom nav, direct state access ── */}
      {isMobile && ttsActive && (
        <div className="mobile-tts-bar">
          <button className="mobile-tts-bar-btn" onClick={() => ttsNav(-1)} title="Previous sentence">
            <SkipBack size={14} strokeWidth={2} fill="currentColor" />
          </button>
          <button className="mobile-tts-bar-btn primary" onClick={ttsTogglePause} title={ttsPaused ? 'Resume' : 'Pause'}>
            {ttsPaused
              ? <Play size={15} strokeWidth={1} fill="currentColor" />
              : <Pause size={15} strokeWidth={1} fill="currentColor" />
            }
          </button>
          <button className="mobile-tts-bar-btn" onClick={() => ttsNav(1)} title="Next sentence">
            <SkipForward size={14} strokeWidth={2} fill="currentColor" />
          </button>
        </div>
      )}

      {/* ── Word context menu — horizontal pill ── */}
      {wordMenu && (
        <div ref={wordMenuRef} className="word-menu" style={{ top: wordMenu.y - 64, left: wordMenu.x }} onClick={e => e.stopPropagation()}>
          {/* Pending highlight note input — shown after color is picked for a new highlight */}
          {pendingHL && (() => {
            const commitHL = (note) => {
              const bookId = bookIdRef.current
              const hl = { ...pendingHL, note: note.trim() }
              if (!highlightsRef.current[bookId]) highlightsRef.current[bookId] = []
              highlightsRef.current[bookId].push(hl)
              saveHighlights()
              setHighlightVersion(v => v + 1)
              requestAnimationFrame(() => applyHighlightsToCard(cardRef.current, bookId, hl.chapterIdx))
              setPendingHL(null)
              setWordMenu(null)
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px', gap: 6, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: HL_COLORS[pendingHL.color]?.bg, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'var(--textDim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {pendingHL.text.length > 40 ? pendingHL.text.slice(0, 40) + '…' : pendingHL.text}
                  </span>
                </div>
                <textarea
                  autoFocus
                  placeholder="Add a note… (optional)"
                  rows={2}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 11, padding: '4px 6px', fontFamily: 'inherit', outline: 'none', resize: 'none' }}
                  onChange={e => setPendingHL(p => ({ ...p, note: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitHL(pendingHL.note || '') } if (e.key === 'Escape') { setPendingHL(null); setWordMenu(null) } }}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="word-menu-item" style={{ padding: '2px 10px', fontSize: 11 }} onClick={() => { setPendingHL(null); setWordMenu(null) }}>Cancel</button>
                  <button className="word-menu-item" style={{ padding: '2px 10px', fontSize: 11, color: 'var(--accent)' }} onClick={() => commitHL(pendingHL.note || '')}>Save</button>
                </div>
              </div>
            )
          })()}
          {/* Color picker row — shown for existing highlights always, and for new highlights after clicking Highlight */}
          {!pendingHL && (wordMenuColorPick || wordMenu.hlId) && (
            <>
              <div className="hl-swatch-row">
                {HL_COLOR_KEYS.map(color => {
                  const currentColor = wordMenu.hlId
                    ? (highlightsRef.current[bookIdRef.current]?.find(h => h.id === wordMenu.hlId)?.color || 'yellow')
                    : 'yellow'
                  return (
                    <button key={color} className={`hl-swatch${(!wordMenu.hlId && wordMenuColorPick ? 'yellow' : currentColor) === color ? ' selected' : ''}`}
                      style={{ background: HL_COLORS[color]?.bg }}
                      title={color}
                      onClick={() => {
                        const bookId = bookIdRef.current
                        if (wordMenu.hlId) {
                          changeHighlightColor(wordMenu.hlId, color)
                          setWordMenuColorPick(false)
                          setWordMenu(null)
                        } else {
                          if (!bookId || !wordMenu.hlText) { setWordMenu(null); return }
                          const hl = { id: `hl_${Date.now()}`, chapterIdx: wordMenu.hlChapterIdx ?? curChapterRef.current, page: curPageRef.current, text: wordMenu.hlText, color, note: '' }
                          setPendingHL(hl)
                          setWordMenuColorPick(false)
                        }
                      }} />
                  )
                })}
              </div>
              {wordMenu.hlId && (
                <>
                  <div className="word-menu-sep" />
                  <button className="word-menu-item" onClick={() => {
                    const bookId = bookIdRef.current
                    const hl = (highlightsRef.current[bookId] || []).find(h => h.id === wordMenu.hlId)
                    const text = hl ? `${hl.text} — ${activeBook?.title || ''}, ${chapters[hl.chapterIdx]?.title || ''}` : ''
                    if (navigator.share) {
                      navigator.share({ text }).catch(() => {})
                    } else {
                      navigator.clipboard.writeText(text).then(() => { setToast('Copied!'); setTimeout(() => setToast(null), 1500) }).catch(() => {})
                    }
                    setWordMenu(null)
                  }}>
                    <Share2 size={13} strokeWidth={1.3} />
                    Share
                  </button>
                  <div className="word-menu-sep" />
                  <button className="word-menu-item" style={{ color: '#f85149' }} onClick={() => {
                    const bookId = bookIdRef.current
                    if (bookId && wordMenu.hlId) {
                      highlightsRef.current[bookId] = (highlightsRef.current[bookId] || []).filter(h => h.id !== wordMenu.hlId)
                      saveHighlights()
                      setHighlightVersion(v => v + 1)
                      cardRef.current?.querySelectorAll(`[data-hl-id="${wordMenu.hlId}"]`).forEach(el => {
                        el.classList.remove('reader-hl', ...HL_COLOR_KEYS.map(c => `hl-${c}`))
                        delete el.dataset.hlId; delete el.dataset.hlColor
                      })
                    }
                    setWordMenu(null)
                  }}>
                    <X size={13} strokeWidth={1.5} />
                    Remove
                  </button>
                </>
              )}
              {!wordMenu.hlId && (
                <>
                  <div className="word-menu-sep" />
                  <button className="word-menu-item" onClick={() => { setWordMenuColorPick(false); setWordMenu(null) }}>Cancel</button>
                </>
              )}
            </>
          )}

          {/* Main items — hidden when color picker or note input is active */}
          {!pendingHL && !wordMenuColorPick && !wordMenu.hlId && (
            <>
          <button className="word-menu-item" onClick={() => {
            const word = wordMenu.word
            const x = wordMenu.x, y = wordMenu.y
            setWordMenu(null)
            setDefPopup({ word, mode: 'define', x, y: y + 12, content: null, loading: true })
            // Fetch definition from Free Dictionary API
            fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
              .then(r => r.json())
              .then(data => {
                const entry = Array.isArray(data) ? data[0] : null
                if (!entry) { setDefPopup(p => p && ({ ...p, loading: false, content: 'No definition found.' })); return }
                const meanings = entry.meanings?.slice(0, 2).map(m =>
                  `<b>${m.partOfSpeech}</b>: ${m.definitions?.slice(0,2).map(d => d.definition).join('; ')}`
                ).join('<br>') || 'No definition found.'
                const phonetic = entry.phonetic || ''
                setDefPopup(p => p && ({ ...p, loading: false, content: meanings, phonetic }))
              })
              .catch(() => setDefPopup(p => p && ({ ...p, loading: false, content: 'Could not load definition.' })))
          }}>
            <BookText size={14} strokeWidth={1.3} />
            Define
          </button>
          <div className="word-menu-sep" />

          <button className="word-menu-item" onClick={() => {
            const word = wordMenu.word
            const ctx = wordMenu.sentence || word
            const x = wordMenu.x, y = wordMenu.y
            const tl = translateLang
            setWordMenu(null)
            setDefPopup({ word: ctx.length > 60 ? word : ctx, mode: 'translate', x, y: y + 12, content: null, loading: true, targetLang: tl })

            const textToTranslate = (ctx.length > 500 ? ctx.slice(0, 500) : ctx).trim()

            // Primary: MyMemory (free, no API key)
            // Fallback: Google Translate unofficial endpoint
            async function doTranslate() {
              // Try MyMemory first
              try {
                const mmUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|${tl}`
                const r = await fetch(mmUrl)
                const data = await r.json()
                if (data.responseStatus === 200 && data.responseData?.translatedText &&
                    !data.responseData.translatedText.toLowerCase().includes('mymemory warning')) {
                  const translated = data.responseData.translatedText
                  setDefPopup(p => p && ({ ...p, loading: false, content: translated }))
                  return
                }
              } catch { /* fall through */ }

              // Fallback: Lingva Translate (open-source Google Translate front-end)
              try {
                const lingvaUrl = `https://lingva.ml/api/v1/en/${tl}/${encodeURIComponent(textToTranslate)}`
                const r = await fetch(lingvaUrl)
                const data = await r.json()
                if (data?.translation) {
                  setDefPopup(p => p && ({ ...p, loading: false, content: data.translation }))
                  return
                }
              } catch { /* fall through */ }

              // Last resort: unofficial Google Translate
              try {
                const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(textToTranslate)}`
                const r = await fetch(gtUrl)
                const data = await r.json()
                const translated = data?.[0]?.map(s => s?.[0]).filter(Boolean).join('') || ''
                if (translated) {
                  setDefPopup(p => p && ({ ...p, loading: false, content: translated }))
                  return
                }
              } catch { /* fall through */ }

              setDefPopup(p => p && ({ ...p, loading: false, content: '⚠️ Translation service unavailable. Please check your internet connection.' }))
            }
            doTranslate()
          }}>
            {/* Language translation icon from svgrepo.com/svg/324210/language-translation */}
            <Languages size={14} strokeWidth={1.6} />
            Translate
          </button>
          <div className="word-menu-sep" />
          <button className="word-menu-item" onClick={() => {
            ttsStart(wordMenu.sentence || wordMenu.word)
            setWordMenu(null)
          }}>
            <Play size={14} strokeWidth={1} fill="currentColor" />
            Play
          </button>
          <div className="word-menu-sep" />
          {/* Copy quote */}
          <button className="word-menu-item" onClick={() => {
            const sentence = wordMenu.sentence || wordMenu.word
            const book = activeBook
            const ch = chapters[curChapterRef.current]
            const text = `${sentence} — ${book?.title || ''}, ${ch?.title || ''}`
            navigator.clipboard.writeText(text).then(() => {
              setToast('Copied!')
              setTimeout(() => setToast(null), 1500)
            }).catch(() => {})
            setWordMenu(null)
          }}>
            <Copy size={13} strokeWidth={1.3} />
            Copy quote
          </button>
          <div className="word-menu-sep" />
          {/* Highlight button → triggers color picker */}
          <button className="word-menu-item" onClick={() => setWordMenuColorPick(true)}>
            <Highlighter size={13} strokeWidth={1.3} />
            Highlight
          </button>
            </>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && <div className="reader-toast">{toast}</div>}

      {/* ── Definition / Translate popup ── */}
      {defPopup && (
        <div ref={defPopupRef} className="def-popup" style={{ top: defPopup.y + 8, left: defPopup.x }} onClick={e => e.stopPropagation()}>
          <button className="def-popup-close" onClick={() => setDefPopup(null)}>×</button>

          {/* Header row — word + mode badge */}
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4, flexWrap:'wrap' }}>
            <div className="def-popup-word" style={{ marginBottom:0 }}>
              {defPopup.word}
              {defPopup.phonetic && <span style={{ fontSize:12, fontWeight:400, fontStyle:'italic', color:'var(--textDim)', marginLeft:8 }}>{defPopup.phonetic}</span>}
            </div>
            {defPopup.mode === 'translate' && (
              <span style={{ fontSize:10, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:4, padding:'1px 6px', color:'var(--textDim)', flexShrink:0, fontFamily:'inherit' }}>
                → {LIBRE_LANGS.find(l=>l.code===defPopup.targetLang)?.name || defPopup.targetLang}
              </span>
            )}
          </div>

          {/* Language selector — only in translate mode, at top of popup */}
          {defPopup.mode === 'translate' && (
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, padding:'6px 8px', background:'var(--surfaceAlt)', borderRadius:6, border:'1px solid var(--border)' }}>
              <Globe size={13} strokeWidth={1.3} style={{ color: 'var(--textDim)', flexShrink: 0 }} />
              <span style={{ fontSize:11, color:'var(--textDim)', flexShrink:0 }}>Translate to</span>
              <select
                value={translateLang}
                onChange={e => {
                  const newLang = e.target.value
                  setTranslateLang(newLang)
                  const word = defPopup.word
                  setDefPopup(p => p && ({ ...p, loading: true, content: null, targetLang: newLang }))
                  const _txt = word.slice(0, 500).trim();
                  (async () => {
                    try {
                      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(_txt)}&langpair=en|${newLang}`)
                      const d = await r.json()
                      if (d.responseStatus === 200 && d.responseData?.translatedText && !d.responseData.translatedText.toLowerCase().includes('mymemory warning')) {
                        setDefPopup(p => p && ({ ...p, loading: false, content: d.responseData.translatedText, targetLang: newLang })); return
                      }
                    } catch { /* fall through */ }
                    try {
                      const r = await fetch(`https://lingva.ml/api/v1/en/${newLang}/${encodeURIComponent(_txt)}`)
                      const d = await r.json()
                      if (d?.translation) { setDefPopup(p => p && ({ ...p, loading: false, content: d.translation, targetLang: newLang })); return }
                    } catch { /* fall through */ }
                    try {
                      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${newLang}&dt=t&q=${encodeURIComponent(_txt)}`)
                      const d = await r.json()
                      const translated = d?.[0]?.map(s => s?.[0]).filter(Boolean).join('') || ''
                      if (translated) { setDefPopup(p => p && ({ ...p, loading: false, content: translated, targetLang: newLang })); return }
                    } catch { /* fall through */ }
                    setDefPopup(p => p && ({ ...p, loading: false, content: '⚠️ Translation service unavailable.' }))
                  })()
                }}
                onClick={e => e.stopPropagation()}
                className="gnos-select"
                style={{ fontSize:11, padding:'2px 24px 2px 6px', flex:1 }}
              >
                {LIBRE_LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>
          )}

          <div className="def-popup-content">
            {defPopup.loading
              ? <div className="def-popup-loading"><div className="spinner" />Loading…</div>
              : <>
                  <span dangerouslySetInnerHTML={{ __html: defPopup.content || '' }} />

                  {/* Translation metadata */}
                  {defPopup.mode === 'translate' && defPopup.confidence != null && (
                    <div style={{ marginTop:8, paddingTop:6, borderTop:'1px solid var(--borderSubtle)', display:'flex', gap:10, flexWrap:'wrap' }}>
                      <span style={{ fontSize:10, color:'var(--textDim)', display:'flex', alignItems:'center', gap:5 }}>
                        Match quality:
                        <span style={{
                          display:'inline-block', width:48, height:5, background:'var(--border)',
                          borderRadius:3, overflow:'hidden', verticalAlign:'middle', marginLeft:3,
                        }}>
                          <span style={{ display:'block', height:'100%', width:`${defPopup.confidence}%`,
                            background: defPopup.confidence > 70 ? 'var(--accent)' : defPopup.confidence > 40 ? '#d29922' : '#f85149',
                            borderRadius:3, transition:'width 0.3s',
                          }} />
                        </span>
                        <b style={{ color:'var(--text)' }}>{defPopup.confidence}%</b>
                      </span>
                    </div>
                  )}

                  {/* Target-language definition (if fetched) */}
                  {defPopup.mode === 'translate' && defPopup.targetDefinition && (
                    <div style={{ marginTop:8, paddingTop:6, borderTop:'1px solid var(--borderSubtle)' }}>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--textDim)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:4 }}>
                        Definition in {LIBRE_LANGS.find(l=>l.code===defPopup.targetLang)?.name || defPopup.targetLang}
                      </div>
                      <div style={{ fontSize:12, color:'var(--textDim)', lineHeight:1.5 }}>
                        {defPopup.targetDefinition}
                      </div>
                    </div>
                  )}
                </>
            }
          </div>

          {/* Powered-by note */}
          {defPopup.mode === 'translate' && !defPopup.loading && (
            <div style={{ marginTop:8, paddingTop:6, borderTop:'1px solid var(--borderSubtle)', fontSize:10, color:'var(--textDim)', opacity:0.6, textAlign:'right' }}>
              Free translation
            </div>
          )}
        </div>
      )}

      {/* ── TTS Player bar — desktop only; mobile uses mobile-tts-bar in App.jsx ── */}
      {!isMobile && ttsActive && (
        <div className="tts-bar">
          <div className="tts-top-row">
            <div className="tts-controls-row">
              <button className="tts-ctrl" onClick={() => ttsNav(-1)} title="Previous sentence">
                <SkipBack size={12} strokeWidth={1} fill="currentColor" />
              </button>
              <button className="tts-ctrl primary" onClick={ttsTogglePause} title={ttsPaused ? 'Resume' : 'Pause'}>
                {ttsPaused
                  ? <Play size={13} strokeWidth={1} fill="currentColor" />
                  : <Pause size={13} strokeWidth={1} fill="currentColor" />
                }
              </button>
              <button className="tts-ctrl" onClick={() => ttsNav(1)} title="Next sentence">
                <SkipForward size={12} strokeWidth={1} fill="currentColor" />
              </button>
            </div>
            {/* × close — pinned to far right */}
            <button className="tts-close-btn" onClick={ttsStop} title="Stop reading" style={{marginLeft:'auto'}}>
              <X size={10} strokeWidth={1.6} />
            </button>
          </div>
          <div className="tts-progress-bar">
            <div className="tts-progress-fill" style={{ width: `${Math.round(ttsProgress * 100)}%` }} />
          </div>
          {ttsSentence && (
            <div className="tts-sentence">&ldquo;{ttsSentence}&rdquo;</div>
          )}
        </div>
      )}
    </div>
  )
}