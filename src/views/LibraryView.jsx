import { useState, useRef, useEffect, useLayoutEffect, useCallback, useContext, memo } from 'react'
import { createPortal } from 'react-dom'
import { PaneContext } from '@/lib/PaneContext'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor, makeId } from '@/lib/utils'
import { importBooks, importAudioFile, importAudioFolder } from '@/lib/bookImport'
import { loadReadingLog, loadNotebookContent, resetBaseDir, saveCalendarEvents, loadKanbanBoards, saveKanbanBoards } from '@/lib/storage'
import Toast from '@/components/ui/Toast'
import { UniversalSettingsModal } from '@/components/SideNav'
import { ContextMenu } from '@/components/ContextMenu'
import { AddPopup } from '@/components/AddPopup'
import { buildAddToCollectionSubmenu } from '@/lib/collectionSubmenu'
import { CollectionFace } from '@/lib/collectionIcons'
import { useIsMobile } from '@/lib/useIsMobile'
import ProfileContent from '@/components/ProfileContent'
import { FullCalendar } from '@/components/Calendar'
import { Archive, ArrowDownWideNarrow, ArrowRight, ArrowUpDown, ArrowUpWideNarrow, AudioLines, Book, Calendar, ChevronRight, Clock, Ellipsis, Flag, Folder, Layers, Link as LinkIcon, ListFilter, MessageSquare, Music, NotebookText, Pencil, Plus, Search, SquarePen, StickyNote, Trash2, Volume2, Waypoints, X, Zap } from 'lucide-react'
import QuickAccess from '@/components/QuickAccess'
export { FullCalendar } // back-compat for existing imports

const SearchIcon = () => (
  <Search className="search-icon" size={13} strokeWidth={1.5} />
)
const DotsIcon = () => (
  <Ellipsis size={16} strokeWidth={2} />
)
const MusicIcon = () => (
  <AudioLines size={28} strokeWidth={1.8} />
)
const PlusIcon = () => (
  <Plus size={14} strokeWidth={2} />
)
const TABS = [
  { id: 'library',    label: 'Library' },
  { id: 'books',      label: 'Books' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'notebooks',  label: 'Notebooks' },
  { id: 'collections', label: 'Collections' },
]

// Covers render immediately: asset:// URLs + loading="lazy" + decoding="async"
// already keep offscreen decode off the critical path. The old idle gate
// withheld the first screenful and then mounted every cover in one flip = a
// decode storm.

// Grid window size + scroll offset, surviving the unmount that Home causes.
// Keyed by pane so a split layout's two libraries don't fight. Module scope on
// purpose: this is view state to restore, not app state worth persisting.
const _gridState = new Map()

// Cover <img> that only fades in when it actually had to load. Clicking Home
// swaps tab.view, which unmounts LibraryView entirely (see App's ViewPanel), so
// every cover remounts as a fresh element and the entrance animation replayed
// on covers the webview already had cached — reading as "the library is
// reloading". A cached image is already `complete` on the first commit, so skip
// the animation for those and let it paint immediately.
function CoverImg({ src, alt }) {
  const [fade, setFade] = useState(false)
  const measure = useCallback(node => {
    if (node) setFade(!(node.complete && node.naturalWidth > 0))
  }, [])
  return (
    <img
      ref={measure}
      src={src}
      alt={alt}
      draggable="false"
      loading="lazy"
      decoding="async"
      className={fade ? 'cover-img-fade' : undefined}
    />
  )
}

// memo: card grids re-render on every library write (e.g. reading progress);
// props are stable objects so memo skips untouched cards.
const BookCard = memo(function BookCard({ book, onOpen, onMenu }) {
  const [c1, c2] = generateCoverColor(book.title)
  const pct = book.totalChapters > 1
    ? Math.round(((book.currentChapter || 0) / (book.totalChapters - 1)) * 100) : 0
  const fmt = (book.format === 'epub' || book.format === 'epub3') ? 'EPUB' : (book.format?.toUpperCase() || 'TXT')
  return (
    <div className="book-card-container" onContextMenu={e => { e.preventDefault(); onMenu(e, book) }}>
      <div className="book-cover" style={{ '--c1': c1, '--c2': c2, background: `linear-gradient(135deg, ${c1}, ${c2})` }} onClick={() => onOpen(book)}>
        {book.sourceMissing && (
          <div title="Source .epub file not found" style={{
            position: 'absolute', top: 6, left: 6, zIndex: 3,
            display: 'flex', alignItems: 'center', gap: 4,
            background: 'rgba(248,81,73,0.92)', color: '#fff',
            fontSize: 8, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
            borderRadius: 4, padding: '2px 6px 3px',
          }}>Missing</div>
        )}
        {book.coverDataUrl ? (
          <>
            <CoverImg src={book.coverDataUrl} alt={book.title} />
            <div className="cover-badge">{fmt}</div>
          </>
        ) : (
          <>
            {/* Left spine — darker shade of the gradient start color */}
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
              background:'rgba(0,0,0,0.22)', zIndex:1 }} />
            {/* Title + author — top section, matches NotebookCard layout */}
            <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2, display:'flex', flexDirection:'column' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#fff', lineHeight:1.25, letterSpacing:'0.025em', wordBreak:'break-word', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>{book.title}</div>
              {book.author && <div style={{ fontSize:10, color:'rgba(255,255,255,0.65)', marginTop:6, fontWeight:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{book.author}</div>}
            </div>
            {/* Bottom — format badge + ruled line accent */}
            <div style={{ position:'relative', padding:'0 12px 14px 16px', display:'flex', flexDirection:'column', gap:7, zIndex:2 }}>
              <div style={{ height:1, background:'rgba(255,255,255,0.28)', borderRadius:1 }} />
              <div style={{
                fontSize:8, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase',
                color:'rgba(255,255,255,0.75)', alignSelf:'flex-start',
                background:'rgba(0,0,0,0.18)', borderRadius:4, padding:'2px 6px 3px',
                border:'1px solid rgba(255,255,255,0.18)',
              }}>{fmt}</div>
            </div>
          </>
        )}
      </div>
      {pct > 0 && <div className="meta-prog-row" style={{ marginTop: 4, padding: '0 2px' }}><div className="meta-prog-track"><div className="meta-prog-fill" style={{ width: `${pct}%` }} /></div><span className="meta-prog-pct">{pct}%</span></div>}
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{book.title}</div>
          {book.author && <div className="meta-author">{book.author}</div>}
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, book) }}><DotsIcon /></button>
      </div>
    </div>
  )
})

// memo: card grids re-render on every library write (e.g. reading progress);
// props are stable objects so memo skips untouched cards.
const AudiobookCard = memo(function AudiobookCard({ book, onOpen, onMenu }) {
  const [c1, c2] = book.coverColor
    ? [book.coverColor, book.coverColor]
    : generateCoverColor(book.title)
  const pct = book.listenProgress ? Math.round(book.listenProgress * 100) : 0
  return (
    <div className="book-card-container" onContextMenu={e => { e.preventDefault(); onMenu(e, book) }}>
      <div className="book-cover" style={{ '--c1': c1, '--c2': c2, background: `linear-gradient(135deg, ${c1}, ${c2})` }} onClick={() => onOpen(book)}>
        {book.coverDataUrl
          ? <CoverImg src={book.coverDataUrl} alt={book.title} />
          : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 12px' }}>
              <div style={{ opacity: 0.55 }}><MusicIcon /></div>
              <div style={{ fontSize:13, fontWeight:800, color:'#fff', lineHeight:1.25, letterSpacing:'0.025em', textAlign:'center', wordBreak:'break-word', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>{book.title}</div>
              {book.author && <div className="cover-author">{book.author}</div>}
            </div>
          )}
        <div className="cover-badge">AUDIO</div>
      </div>
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{book.title}</div>
          {book.author && <div className="meta-author">{book.author}</div>}
          {pct > 0 && <div className="meta-prog-row">
            <div className="meta-prog-track"><div className="meta-prog-fill" style={{ width: `${pct}%` }} /></div>
            <span className="meta-prog-pct">{pct}%</span>
          </div>}
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, book) }}><DotsIcon /></button>
      </div>
    </div>
  )
})

// ContextMenu/CtxSubmenu removed (Pass 1 of PLAN_POPUP_REVAMP.md) — this
// view now uses the shared `ContextMenu` component (src/components/
// ContextMenu.jsx), same one SideNav.jsx uses.
// AddPopup/LibContextMenu removed (Pass 2) — this view now uses the shared
// `AddPopup` component (src/components/AddPopup.jsx). LibContextMenu turned
// out to be a mislabeled duplicate of AddPopup (found during Pass 1), not a
// real context menu.

function StreakFooter({ streakDays = 0, weekActivity = [false,false,false,false,false,false,false], todayMinutes = 0 }) {
  // weekActivity[6] = today (rightmost), weekActivity[0] = 6 days ago
  const todayPct = Math.min(todayMinutes / 30, 1)
  return (
    <div className="library-footer">
      <div className="streak-section">
        <span className="streak-label">STREAK</span>
        <div className="streak-dots">
          {weekActivity.map((active, i) => {
            const isToday = i === 6
            const dotStyle = isToday
              ? {
                  background: active
                    ? 'var(--accent)'
                    : todayPct > 0
                      ? `conic-gradient(var(--accent) 0deg ${Math.round(todayPct * 360)}deg, var(--surfaceAlt) ${Math.round(todayPct * 360)}deg)`
                      : 'var(--surfaceAlt)',
                  boxShadow: '0 0 6px 1px color-mix(in srgb, var(--accent) 45%, transparent)',
                  transition: 'background 0.3s',
                }
              : undefined
            return (
              <div
                key={i}
                className={`streak-dot${active ? ' filled' : ''}`}
                style={dotStyle}
              />
            )
          })}
        </div>
        <span className="streak-count">{streakDays}d</span>
      </div>
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// EditItemModal — the ONE edit dialog for every library item type (book, audio,
// notebook, sketchbook, collection). Field list is driven by `fields` so each
// type shows only what applies, but layout/typography/keyboard behaviour stay
// identical everywhere: autofocused name, Enter saves, Esc cancels.
// ─────────────────────────────────────────────────────────────────────────────
const NB_COLORS  = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32','#c0392b','#00838f']
const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
function EditItemModal({ heading, item, fields, colors = NB_COLORS, onSave, onClose }) {
  const has = f => fields.includes(f)
  const [title, setTitle]             = useState(item.title ?? item.name ?? '')
  const [author, setAuthor]           = useState(item.author || '')
  const [description, setDescription] = useState(item.description || '')
  const [rating, setRating]           = useState(item.rating || 0)
  const [tagsInput, setTagsInput]     = useState((item.tags || []).join(', '))
  const [color, setColor]             = useState(item.coverColor || item.color || '')
  const [coverDataUrl, setCoverDataUrl] = useState(item.coverDataUrl || null)
  const coverInputRef = useRef(null)

  function handleCoverFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCoverDataUrl(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function save() {
    const out = { title: title.trim() || item.title || item.name }
    if (has('author'))      out.author = author.trim()
    if (has('description')) out.description = description.trim()
    if (has('rating'))      out.rating = rating
    if (has('tags'))        out.tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
    if (has('color'))       out.coverColor = color
    if (has('image'))       out.coverDataUrl = coverDataUrl ?? null
    onSave(out)
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); save() }
  }

  const labelStyle = { fontSize: 11, color: 'var(--textDim)', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }
  const inputStyle = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose} onKeyDown={onKeyDown}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: 340, maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text)', letterSpacing: '-0.01em' }}>{heading}</div>

        <div style={{ marginBottom: 13 }}>
          <div style={labelStyle}>Name</div>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)}
            onFocus={e => e.target.select()} style={inputStyle} />
        </div>

        {has('author') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Author</div>
            <input value={author} onChange={e => setAuthor(e.target.value)} style={inputStyle} />
          </div>
        )}

        {has('rating') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Rating</div>
            <StarRating value={rating} onChange={setRating} />
          </div>
        )}

        {has('tags') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Genre Tags</div>
            <input value={tagsInput} onChange={e => setTagsInput(e.target.value)}
              placeholder="fiction, sci-fi, classic" style={inputStyle} />
          </div>
        )}

        {has('description') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Description</div>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="Brief description or notes…"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>
        )}

        {has('color') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Color</div>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {colors.map(c => (
                <button key={c} onClick={() => setColor(c)} title={c} style={{
                  width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer',
                  border: '1px solid rgba(255,255,255,0.12)',
                  outline: c === color ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
                }} />
              ))}
            </div>
          </div>
        )}

        {has('image') && (
          <div style={{ marginBottom: 13 }}>
            <div style={labelStyle}>Cover Image</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {coverDataUrl && (
                <img src={coverDataUrl} alt="Cover" style={{ width: 34, height: 48, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--border)', flexShrink: 0 }} />
              )}
              <button onClick={() => coverInputRef.current?.click()}
                style={{ background: 'var(--surfaceAlt)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                {coverDataUrl ? 'Change' : 'Upload Image'}
              </button>
              {coverDataUrl && (
                <button onClick={() => setCoverDataUrl(null)}
                  style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--textDim)', borderRadius: 7, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Remove
                </button>
              )}
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverFile} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 19 }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--textDim)', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={save} style={{ background: 'var(--accent)', border: 'none', color: 'var(--bg)', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Save</button>
        </div>
      </div>
    </div>
  )
}

// MissingSourceModal — an epub's kept .epub file (A86) is gone. Opening the
// book prompts instead of navigating into a broken reader; removal goes
// through the normal moveToTrash path (OS Trash, recoverable — same as every
// other delete in the app, not a true irreversible delete).
function MissingSourceModal({ book, onRemove, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22, width: 360, boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: 'var(--text)', letterSpacing: '-0.01em' }}>File not found</div>
        <div style={{ fontSize: 13, color: 'var(--textDim)', lineHeight: 1.5, marginBottom: 19 }}>
          Can't find <strong style={{ color: 'var(--text)' }}>{book.title}</strong>'s <code>.epub</code> file — it may have been moved or deleted outside Gnos. Remove this book from your library? (Goes to the OS Trash, same as Delete — not permanent.)
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--textDim)', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Keep</button>
          <button onClick={onRemove} style={{ background: '#f85149', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>Remove</button>
        </div>
      </div>
    </div>
  )
}

export function SearchDropdown({ query, library, notebooks, sketchbooks, flashcardDecks, onOpenBook, onOpenAudio, onOpenNotebook, onOpenSketchbook, onOpenDeck, onClose, onDevCommand, onOpenGraph, onOpenCalendar, onOpenKanban, onReset }) {
  const q = query.trim().toLowerCase()
  if (!q) return null

  // ── /calendar command ──────────────────────────────────────────────────────
  if (q === '/calendar') {
    return (
      <div className="search-dropdown">
        <button className="search-drop-item" onClick={() => { onOpenCalendar?.(); onClose() }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#1a4a3e,#2ecc71)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Calendar size={20} strokeWidth={1.5} color="white" style={{ opacity: 0.9 }} />
          </div>
          <div className="search-drop-info">
            <div className="search-drop-title">Calendar</div>
            <div className="search-drop-sub">Open full calendar view</div>
          </div>
        </button>
      </div>
    )
  }

  // ── /nebuli command ────────────────────────────────────────────────────────────
  if (q === '/nebuli' || q.startsWith('/nebuli ')) {
    return (
      <div className="search-dropdown">
        <button className="search-drop-item" onClick={() => { onOpenGraph?.(); onClose() }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#1a3a6e,#4a90e2)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Waypoints size={20} strokeWidth={1.5} color="white" />
          </div>
          <div className="search-drop-info">
            <div className="search-drop-title">Nebuli</div>
            <div className="search-drop-sub">Knowledge graph · connections · orbits</div>
          </div>
        </button>
      </div>
    )
  }

  // ── /reset ────────────────────────────────────────────────────────────────
  if (q === '/reset') {
    return (
      <div className="search-dropdown">
        <button className="search-drop-item" onClick={() => { onReset?.(); onClose() }} style={{ gap: 10 }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#c0392b,#e74c3c)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>↺</div>
          <div className="search-drop-info">
            <div className="search-drop-title">Reset Gnos</div>
            <div className="search-drop-sub">Return to onboarding — re-connect or create a new Archive</div>
          </div>
        </button>
      </div>
    )
  }

  // ── Dev commands ─────────────────────────────────────────────────────────────
  if (q === '/dev test onboarding') {
    return (
      <div className="search-dropdown">
        <button className="search-drop-item" onClick={() => { onDevCommand('onboarding'); onClose() }}
          style={{ gap: 10 }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#8b5e3c,#e8922a)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🧪</div>
          <div className="search-drop-info">
            <div className="search-drop-title">Test Onboarding</div>
            <div className="search-drop-sub">Preview onboarding flow — read-only, no file system changes</div>
          </div>
        </button>
      </div>
    )
  }
  // ── /perf — reader profiling without devtools ─────────────────────────────
  // The inspector blanks the app window (WKWebView repaint bug), so these drive
  // the profiler from the search bar and show results as an in-app overlay.
  if (q.startsWith('/perf')) {
    const perf = (cmd) => { window.dispatchEvent(new CustomEvent('gnos:perf-cmd', { detail: { cmd } })); onClose() }
    const row = (cmd, title, sub, emoji, bg) => (
      <button key={cmd} className="search-drop-item" onClick={() => perf(cmd)}>
        <div className="search-drop-cover" style={{ background: bg, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{emoji}</div>
        <div className="search-drop-info">
          <div className="search-drop-title">{title}</div>
          <div className="search-drop-sub">{sub}</div>
        </div>
      </button>
    )
    return (
      <div className="search-dropdown">
        <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.6 }}>Reader Profiling</div>
        {row('on', '/perf on', 'Start measuring page flips + chapter loads', '▶', 'linear-gradient(135deg,#1a4a3e,#2ecc71)')}
        {row('report', '/perf report', 'Show results on screen + save to archive', '📊', 'linear-gradient(135deg,#1a3a6e,#4a90e2)')}
        {row('off', '/perf off', 'Stop measuring, hide the overlay', '■', 'linear-gradient(135deg,#4a4a4a,#888)')}
      </div>
    )
  }
  // Show hint when user starts typing /dev
  if (q.startsWith('/dev')) {
    return (
      <div className="search-dropdown">
        <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.6 }}>Dev Commands</div>
        <button className="search-drop-item" onClick={() => { onDevCommand('onboarding'); onClose() }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#8b5e3c,#e8922a)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🧪</div>
          <div className="search-drop-info">
            <div className="search-drop-title">/dev test onboarding</div>
            <div className="search-drop-sub">Preview onboarding flow</div>
          </div>
        </button>
      </div>
    )
  }
  // ── :: search: tags, due dates ────────────────────────────────────────────
  if (q.startsWith('::')) {
    const term = q.slice(2).trim().toLowerCase()
    if (!term) return null
    const now = new Date()
    const todayStr = now.toDateString()
    const nbItem = (n, sub) => (
      <button key={n.id} className="search-drop-item" onClick={() => { onOpenNotebook(n); onClose() }}>
        <div className="search-drop-cover" style={{ background: n.coverColor || '#2d1b69', boxShadow: '0 1px 6px rgba(0,0,0,0.4)' }}>
          {n.coverDataUrl && <img src={n.coverDataUrl} alt="" style={{ width:'100%',height:'100%',objectFit:'cover',borderRadius:4 }} />}
        </div>
        <div className="search-drop-info">
          <div className="search-drop-title">{n.title}</div>
          <div className="search-drop-sub">{sub}</div>
        </div>
      </button>
    )
    if (term === 'today') {
      const results = (notebooks || []).filter(n => n.dueDate && new Date(n.dueDate).toDateString() === todayStr)
      return (
        <div className="search-dropdown">
          <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.6 }}>Due today</div>
          {results.length === 0
            ? <div style={{ padding: '8px 14px 12px', color: 'var(--textDim)', fontSize: 13 }}>Nothing due today</div>
            : results.slice(0, 8).map(n => nbItem(n, <span style={{ color:'#b87000' }}>{formatDueBadgeLib(n.dueDate)?.text}</span>))
          }
        </div>
      )
    }
    if (term === 'overdue') {
      const results = (notebooks || []).filter(n => n.dueDate && new Date(n.dueDate) < now)
      return (
        <div className="search-dropdown">
          <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.6 }}>Overdue</div>
          {results.length === 0
            ? <div style={{ padding: '8px 14px 12px', color: 'var(--textDim)', fontSize: 13 }}>No overdue notes</div>
            : results.slice(0, 8).map(n => nbItem(n, <span style={{ color:'#c02020' }}>{formatDueBadgeLib(n.dueDate)?.text}</span>))
          }
        </div>
      )
    }
    // Tag search
    const tagResults = (notebooks || []).filter(n => n.tags?.some(t => t.toLowerCase().includes(term)))
    return (
      <div className="search-dropdown">
        <div style={{ padding: '8px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.6 }}>
          Notes tagged {term}
        </div>
        {tagResults.length === 0
          ? <div style={{ padding: '8px 14px 12px', color: 'var(--textDim)', fontSize: 13 }}>No notes with tag {term}</div>
          : tagResults.slice(0, 8).map(n =>
              nbItem(n, (
                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                  {n.tags?.filter(t => t.toLowerCase().includes(term)).map(t => (
                    <span key={t} style={{ fontSize:10, padding:'0 4px', borderRadius:3, background:'var(--surfaceAlt)', border:'1px solid var(--border)' }}>{t}</span>
                  ))}
                </div>
              ))
            )
        }
      </div>
    )
  }

  const bookResults = library.filter(b => b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q))
  const nbResults   = notebooks.filter(n => n.title?.toLowerCase().includes(q) || n.tags?.some(t => t.toLowerCase().includes(q)))
  const sbResults   = (sketchbooks || []).filter(s => s.title?.toLowerCase().includes(q) || s.ocrText?.toLowerCase().includes(q))
  // Decks match on title or on any card's front/back text
  const fdResults   = (flashcardDecks || []).filter(d =>
    d.title?.toLowerCase().includes(q) ||
    (d.cards || []).some(c => c.front?.toLowerCase().includes(q) || c.back?.toLowerCase().includes(q))
  )
  const all = [
    ...bookResults,
    ...nbResults.map(n => ({ ...n, _isNb: true })),
    ...sbResults.map(s => ({ ...s, _isSb: true })),
    ...fdResults.map(d => ({ ...d, _isFd: true })),
  ]
  if (!all.length) return (
    <div className="search-dropdown">
      <div style={{ padding: '12px 14px', color: 'var(--textDim)', fontSize: 13 }}>No results for "{query}"</div>
    </div>
  )
  return (
    <div className="search-dropdown">
      {all.slice(0, 8).map(item => {
        const [c1, c2] = generateCoverColor(item.title)
        const isAudio = item.type === 'audio'
        const isNb    = item._isNb
        const isSb    = item._isSb
        const isFd    = item._isFd
        // Deck matched via a card rather than its title — show which card
        const cardHit = isFd && !item.title?.toLowerCase().includes(q)
          ? (item.cards || []).find(c => c.front?.toLowerCase().includes(q) || c.back?.toLowerCase().includes(q))
          : null
        // For sketchbooks that matched via OCR text, show a snippet
        const ocrSnippet = isSb && item.ocrText && item.ocrText.toLowerCase().includes(q)
          ? (() => {
              const idx = item.ocrText.toLowerCase().indexOf(q)
              const start = Math.max(0, idx - 20)
              const end   = Math.min(item.ocrText.length, idx + q.length + 30)
              return (start > 0 ? '…' : '') + item.ocrText.slice(start, end).trim() + (end < item.ocrText.length ? '…' : '')
            })()
          : null
        return (
          <button key={item.id} className="search-drop-item" onClick={() => {
            if (isFd) onOpenDeck?.(item)
            else if (isSb) onOpenSketchbook?.(item)
            else if (isNb) onOpenNotebook(item)
            else if (isAudio) onOpenAudio(item)
            else onOpenBook(item)
            onClose()
          }}>
            {/* Cover — solid color for notebooks/sketchbooks, gradient for books/audio, matching sidenav MiniCover */}
            <div className="search-drop-cover" style={{
              background: (isNb || isSb || isFd)
                ? (item.coverColor || (isNb ? '#2d1b69' : isFd ? '#7a3b8f' : '#0d5eaf'))
                : `linear-gradient(135deg,${c1},${c2})`,
              boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
            }}>
              {item.coverDataUrl
                ? <img src={item.coverDataUrl} alt="" style={{ width:'100%',height:'100%',objectFit:'cover',borderRadius:4 }} />
                : <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.45)', fontWeight: 700 }}>
                    {isAudio ? '♪' : ''}
                  </span>
              }
            </div>
            <div className="search-drop-info">
              <div className="search-drop-title">{item.title}</div>
              {item.author && <div className="search-drop-sub">{item.author}</div>}
              {isNb && <div className="search-drop-sub">{item.wordCount || 0} words</div>}
              {isFd && <div className="search-drop-sub">{(item.cards || []).length} cards</div>}
              {cardHit && (
                <div className="search-drop-sub" style={{ fontStyle:'italic', opacity:0.75 }}>
                  {(cardHit.front || '').slice(0, 60)}{(cardHit.front || '').length > 60 ? '…' : ''}
                </div>
              )}
              {ocrSnippet && <div className="search-drop-sub" style={{ fontStyle:'italic', opacity:0.75 }}>{ocrSnippet}</div>}
            </div>
            <div className="search-drop-badge">
              {isAudio ? (
                <Volume2 size={12} strokeWidth={1.4} />
              ) : isNb ? (
                <NotebookText size={12} strokeWidth={1.4} />
              ) : isSb ? (
                <Pencil size={12} strokeWidth={1.3} />
              ) : isFd ? (
                <Layers size={12} strokeWidth={1.3} />
              ) : (
                <Book size={12} strokeWidth={1.3} />
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// NotebookCard — bold title + date top, ruled lines near bottom
// ─────────────────────────────────────────────────────────────────────────────
function formatDueBadgeLib(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = d - now
    const diffD = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24))
    const diffH = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60))
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    // Show time component if not midnight
    const h = d.getHours(), m = d.getMinutes()
    const timeStr = (h !== 0 || m !== 0) ? ` @${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` : ''
    const label = `${dateStr}${timeStr}`
    if (diffMs < 0) return { text: label, state: 'overdue' }
    if (diffD === 0) return { text: label, state: 'today' }
    if (diffD < 7) return { text: label, state: 'soon' }
    return { text: label, state: 'normal' }
  } catch { return null }
}

// memo: card grids re-render on every library write (e.g. reading progress);
// props are stable objects so memo skips untouched cards.
const NotebookCard = memo(function NotebookCard({ nb, onOpen, onMenu }) {
  const color = nb.coverColor || '#2d1b69'
  const dateStr = nb.updatedAt || nb.createdAt
    ? new Date(nb.updatedAt || nb.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : ''
  const dueBadge = formatDueBadgeLib(nb.dueDate)
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(nb)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, nb) }}>
      {/* Cover — same fixed size as book covers */}
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
        {nb.coverDataUrl ? (
          <>
            <div style={{ position:'absolute', inset:0, borderRadius:'inherit', overflow:'hidden' }}>
              <img src={nb.coverDataUrl} alt="" draggable="false" loading="lazy" decoding="async" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            </div>
            <div style={{ position:'absolute', inset:0, borderRadius:'inherit', border:'1px solid var(--border)', pointerEvents:'none', zIndex:2 }} />
          </>
        ) : (
          <>
            {/* Left spine shadow */}
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
              background:'rgba(0,0,0,0.18)', zIndex:1 }} />

            {/* Title + date — top section */}
            <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2 }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#fff', lineHeight:1.25, letterSpacing:'0.025em', wordBreak:'break-word', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>{nb.title}</div>
              {dateStr && <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', marginTop:7, fontWeight:400 }}>{dateStr}</div>}
            </div>

            {/* Bottom area — due date badge replaces ruled lines when present */}
            <div style={{ position:'relative', padding:'0 12px 16px 16px', display:'flex', flexDirection:'column', gap:8, zIndex:2 }}>
              {dueBadge ? (
                <div style={{
                  fontSize:9, fontWeight:700, letterSpacing:'.04em',
                  padding:'2px 7px 3px', borderRadius:5, display:'inline-flex', alignSelf:'flex-start',
                  background: dueBadge.state === 'overdue' ? 'rgba(220,40,40,0.22)' : dueBadge.state === 'today' ? 'rgba(230,120,0,0.22)' : 'rgba(70,100,255,0.20)',
                  color: dueBadge.state === 'overdue' ? '#ffd0d0' : dueBadge.state === 'today' ? '#ffe8b0' : '#dce8ff',
                  border: `1px solid ${dueBadge.state === 'overdue' ? 'rgba(220,40,40,0.45)' : dueBadge.state === 'today' ? 'rgba(230,120,0,0.45)' : 'rgba(70,100,255,0.40)'}`,
                }}>{dueBadge.text}</div>
              ) : (
                [...Array(2)].map((_,i) => (
                  <div key={i} style={{ height:1, background:'rgba(255,255,255,0.32)', borderRadius:1 }} />
                ))
              )}
            </div>
          </>
        )}
      </div>
      {/* Meta */}
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{nb.title}</div>
          {dueBadge
            ? <div className="meta-author" style={{ color: dueBadge.state === 'overdue' ? '#ff6060' : dueBadge.state === 'today' ? '#f5a623' : '#7090ff', fontWeight: 600 }}>{dueBadge.text}</div>
            : dateStr && <div className="meta-author">{dateStr}</div>}
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, nb) }}><DotsIcon /></button>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookCard — whiteboard/sketch cover design
// ─────────────────────────────────────────────────────────────────────────────
// memo: card grids re-render on every library write (e.g. reading progress);
// props are stable objects so memo skips untouched cards.
const SketchbookCard = memo(function SketchbookCard({ sb, onOpen, onMenu }) {
  const color = sb.gnos_canvasBg || sb.coverColor || '#0d5eaf'
  const dateStr = sb.updatedAt || sb.createdAt
    ? new Date(sb.updatedAt || sb.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : ''
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(sb)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, sb) }}>
      {/* Cover — same fixed size as book covers */}
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>

        {sb.coverDataUrl ? (
          <>
            {/* Thumbnail preview — padded so it doesn't touch the card walls */}
            <div style={{ position:'absolute', inset:0, borderRadius:'inherit', background: sb.coverBgColor || '#ffffff', padding:'8px 10px', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <img
                src={sb.coverDataUrl}
                alt=""
                draggable="false"
                loading="lazy"
                decoding="async"
                style={{ width:'100%', height:'100%', objectFit:'contain', objectPosition:'center', borderRadius:3 }}
              />
            </div>
            {/* Border overlay to match app aesthetic */}
            <div style={{ position:'absolute', inset:0, borderRadius:'inherit', border:'1px solid var(--border)', pointerEvents:'none', zIndex:2 }} />
          </>
        ) : (
          <>
            {/* Solid colored spine */}
            <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
              background: color, filter:'brightness(0.7)', zIndex:1 }} />

            {/* Title + date */}
            <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2 }}>
              <div style={{ fontSize:13, fontWeight:800, color:'#fff', lineHeight:1.25, letterSpacing:'0.025em', wordBreak:'break-word', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>{sb.title}</div>
              {dateStr && <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', marginTop:7, fontWeight:400 }}>{dateStr}</div>}
            </div>

            {/* Dot-grid pattern overlay */}
            <div style={{
              position:'absolute', top:0, right:0, bottom:0, left:8, zIndex:1, pointerEvents:'none',
              backgroundImage:'radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1px)',
              backgroundSize:'8px 8px',
            }} />
            {/* SKETCH badge + pencil icon */}
            <div style={{ position:'relative', padding:'0 12px 16px 16px', display:'flex', alignItems:'center', gap:6, zIndex:2 }}>
              <Pencil size={11} strokeWidth={1.5} color="rgba(255,255,255,0.85)" style={{ opacity: 0.7, flexShrink: 0 }} />
              <span style={{ fontSize:8, fontWeight:800, letterSpacing:'.1em', color:'rgba(255,255,255,0.7)', textTransform:'uppercase' }}>Sketch</span>
            </div>
          </>
        )}
      </div>
      {/* Meta */}
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{sb.title}</div>
          {dateStr && <div className="meta-author">{dateStr}</div>}
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, sb) }}><DotsIcon /></button>
      </div>
    </div>
  )
})
// ─────────────────────────────────────────────────────────────────────────────
// FlashcardDeckCard — Anki-style deck card with card count + due count
// ─────────────────────────────────────────────────────────────────────────────
// memo: card grids re-render on every library write (e.g. reading progress);
// props are stable objects so memo skips untouched cards.
const FlashcardDeckCard = memo(function FlashcardDeckCard({ deck, onOpen, onMenu }) {
  const color = deck.color || '#6b3fa0'
  const cards = deck.cards || []
  const now = Date.now()
  const dueSoon = cards.filter(c => c.nextReview && c.nextReview <= now + 86400000 * 1).length || 0
  const nextDue = cards.reduce((min, c) => {
    if (!c.nextReview) return 0
    const days = Math.max(0, Math.ceil((c.nextReview - now) / 86400000))
    return Math.min(min, days)
  }, Infinity)
  const dueText = dueSoon > 0 ? `${dueSoon} due` : nextDue < Infinity ? `${nextDue}d` : ''
  const dueUrgent = dueSoon > 0
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(deck)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, deck) }}>
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
        {/* Left spine shadow */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
          background:'rgba(0,0,0,0.18)', zIndex:1 }} />
        {/* Flashcard icon + title */}
        <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2 }}>
          <Layers size={20} strokeWidth={1.5} color="rgba(255,255,255,0.8)" style={{ marginBottom: 6, opacity: 0.7 }} />
          <div style={{ fontSize:13, fontWeight:800, color:'#fff', lineHeight:1.25, wordBreak:'break-word', overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>{deck.title}</div>
        </div>
        {/* Card count + due badge */}
        <div style={{ position:'relative', padding:'0 16px 14px', zIndex:2, display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)' }}>{cards.length} cards</span>
          {dueText && (
            <span style={{ fontSize:10, fontWeight:700,
              background: dueUrgent ? 'var(--accent, rgba(255,152,0,0.85))' : 'rgba(255,255,255,0.18)',
              color:'#fff', borderRadius:8, padding:'1px 7px' }}>{dueText}</span>
          )}
        </div>
      </div>
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{deck.title}</div>
          <div className="meta-author" style={{ display:'flex', alignItems:'center', gap:6 }}>
            {cards.length} cards
            {dueText && (
              <span style={{ fontSize:10, fontWeight:600,
                color: dueUrgent ? 'var(--accent, #ff9800)' : 'var(--textDim)' }}>{dueText}</span>
            )}
          </div>
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, deck) }}><DotsIcon /></button>
      </div>
    </div>
  )
})

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0)
  return (
    <div style={{ display:'flex', gap:4 }}>
      {[1,2,3,4,5].map(s => (
        <button key={s} onClick={() => onChange(s === value ? 0 : s)}
          onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
          style={{ background:'none', border:'none', cursor:'pointer', padding:0,
            fontSize:20, color:(hover || value) >= s ? '#f0c040' : 'var(--border)',
            transition:'color 0.1s' }}>★</button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfileModal
// ─────────────────────────────────────────────────────────────────────────────
/** Parse /todo blocks from a notebook's content text. Returns array of { listName, items } */
function extractTodosFromText(text) {
  if (!text) return []
  const lines = text.split('\n')
  const lists = []
  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^\/todo(?::(.*))?$/)
    if (m) {
      const listName = (m[1] || "Todo's").trim()
      const items = []
      let j = i + 1
      while (j < lines.length && /^\s*[-*+]\s\[[ xX]\]/.test(lines[j])) {
        const checked = /\[[xX]\]/.test(lines[j])
        const raw = lines[j].replace(/^\s*[-*+]\s\[[ xX]\]\s*/, '')
        const parts = raw.split(':').map(s => s.trim())
        items.push({ text: parts[0] || raw, checked, dateStr: parts[1] || '', timeStr: parts[2] || '' })
        j++
      }
      if (items.length) lists.push({ listName, items })
      i = j
    } else {
      i++
    }
  }
  return lists
}

/** Parse /habits blocks from a notebook's content text. Returns array of habit data objects. */
function extractHabitsFromText(text) {
  if (!text) return []
  const blocks = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\/habits(?::(.*))?$/)
    if (m && m[1]) {
      try {
        const data = JSON.parse(m[1])
        if (data.habits && data.habits.length > 0) blocks.push(data)
      } catch { /* skip corrupt block */ }
    }
  }
  return blocks
}

/** Parse /calendar blocks from a notebook's content text. Returns array of { title, events } */
function extractTaskDueDatesFromText(text) {
  if (!text) return {}
  const events = {}
  const re = /^\s*[-*+]\s\[[ xX]\]\s+(.*?)\{date:(\d{4}-\d{2}-\d{2})\}/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const label = m[1].replace(/\{label:\d+\}/g, '').trim() || 'Task'
    const dateKey = m[2]
    if (!events[dateKey]) events[dateKey] = []
    events[dateKey].push(label)
  }
  return events
}

function extractCalendarsFromText(text) {
  if (!text) return []
  const cals = []
  const re = /^\/calendar:(.+)$/gm
  let m
  while ((m = re.exec(text)) !== null) {
    try {
      const data = JSON.parse(m[1])
      if (data.events && Object.keys(data.events).length) {
        cals.push({ title: data.title || 'Calendar', events: data.events })
      }
    } catch { /* skip malformed */ }
  }
  return cals
}

/** Merge all calendar events from multiple notebooks into one events map */
function mergeCalendarEvents(notebooks_cals) {
  const merged = {}
  for (const cal of notebooks_cals) {
    for (const [k, v] of Object.entries(cal.events)) {
      const arr = Array.isArray(v) ? v : [v]
      if (!merged[k]) merged[k] = []
      merged[k].push(...arr)
    }
  }
  return merged
}

// ── Kanban helpers ────────────────────────────────────────────────────────────
const CARD_COLORS  = ['#EF4444','#F97316','#F59E0B','#84CC16','#10B981','#06B6D4','#3B82F6','#8B5CF6','#EC4899','#6B7280']
const makeCardId = () => `card_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const makeColId  = () => `col_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const makeCmtId  = () => `cmt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`

// Real ticket-style code derived from the card's own id (its creation
// timestamp) — not a fabricated field, just a display format for data we
// already have. Matches the reference boards' "PROJ-123" convention.
function kanbanCardCode(id) {
  const m = /^card_(\d+)_/.exec(id || '')
  return `TASK-${m ? m[1].slice(-4) : '0000'}`
}

// Priority is a real, user-set field (picked in KanbanCardModal) — not
// decoration standing in for data we don't have, unlike an assignee avatar
// or attachment count, which this app has no backing feature for and so
// doesn't fake.
const PRIORITY_LEVELS = [
  { id: 'none',   label: 'No priority', color: null },
  { id: 'low',    label: 'Low',         color: '#6b7280' },
  { id: 'medium', label: 'Medium',      color: '#eab308' },
  { id: 'high',   label: 'High',        color: '#f97316' },
  { id: 'urgent', label: 'Urgent',      color: '#f85149' },
]
const priorityMeta = id => PRIORITY_LEVELS.find(p => p.id === id) || PRIORITY_LEVELS[0]

// Relative day label matching the reference boards ("Today", "Yesterday",
// "in 3 days", falling back to a plain date once it's far enough out).
function kanbanDueLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d - today) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays === -1) return 'Yesterday'
  if (diffDays < 0) return `${-diffDays}d overdue`
  if (diffDays <= 6) return `in ${diffDays}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}


// ── KanbanCardModal ───────────────────────────────────────────────────────────
// Reference: three edit-modal screenshots the user supplied (a macOS-style
// "Create an Event" dialog, a light "Schedule new interview" form, a dark
// "Share project" panel) — the common language across all three that ours
// was missing: a fixed heading + muted subtitle (separate from the
// editable fields, not doubling as the title input itself), uppercase
// section labels above each field/group, real divider lines between
// sections, bordered fields with an accent focus ring, a segmented pill
// toggle for a small fixed set of choices (their Event/Reminder,
// 30/60/90 min — ours is priority), and a footer with Cancel + a solid
// primary action right-aligned, destructive action kept separate on the
// left. Rebuilt around that shape.
function KanbanCardModal({ card, onSave, onDelete, onClose }) {
  const [title,       setTitle]       = useState(card?.title       || '')
  const [dueDate,     setDueDate]     = useState(card?.dueDate     || '')
  const [priority,    setPriority]    = useState(card?.priority    || 'none')
  const [description, setDescription] = useState(card?.description || '')
  const [comments,    setComments]    = useState(card?.comments    || [])
  const [newCmt,      setNewCmt]      = useState('')
  const isNew = !card?.id
  const canSave = title.trim().length > 0

  const addCmt = () => {
    if (!newCmt.trim()) return
    setComments(c => [...c,{id:makeCmtId(),text:newCmt.trim(),createdAt:new Date().toISOString()}])
    setNewCmt('')
  }
  const save = () => canSave && onSave({title:title.trim(),dueDate,priority,description,comments})

  // Type scale collapsed to 3 obvious steps (was 7 near-duplicate sizes —
  // 18/12.5/12/11/10/9/13 — bunched within a few px of each other with no
  // real rhythm): 17 heading, 13 body/fields/buttons, 11 labels/meta.
  // Differentiate the subtitle from body text by color+weight, not a
  // fourth in-between size. Spacing likewise moved onto a 4-unit grid
  // (4/8/12/16/20/24) instead of one-off 7/9/13/14/18/22px values.
  // Color hierarchy: var(--text) (white) is reserved for section labels,
  // selected/active control text, and the two footer actions — everything
  // else (subtitle, placeholders, unselected pill text, meta) stays
  // var(--textDim). Previously the labels were dim and the split between
  // white/dim elsewhere had no rule, which read as arbitrary.
  const label   = {fontSize:11,fontWeight:600,color:'var(--text)',textTransform:'uppercase',letterSpacing:'0.05em',display:'block',marginBottom:8}
  const field   = {width:'100%',background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:13,lineHeight:'20px',padding:'8px 12px',fontFamily:'inherit',outline:'none',boxSizing:'border-box',transition:'border-color 0.12s, box-shadow 0.12s'}
  // Muted border + soft ring on focus, not a full-saturation accent line —
  // that read as a harsh neon rectangle on these dark surfaces. Matches the
  // shared --focusBorder/--focusRing tokens every other text input in the
  // app now uses (global.css).
  const onFocusRing = e=>{e.currentTarget.style.borderColor='var(--focusBorder)';e.currentTarget.style.boxShadow='var(--focusRing)'}
  const onBlurRing  = e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='none'}
  const divider = <div style={{height:1,background:'var(--borderSubtle)',flexShrink:0}}/>

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:4000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(6px)'}} onClick={onClose}>
      <div style={{background:'var(--surface)',borderRadius:16,width:440,maxWidth:'calc(100vw - 32px)',maxHeight:'calc(100vh - 48px)',display:'flex',flexDirection:'column',boxShadow:'0 40px 100px rgba(0,0,0,0.5)',border:'1px solid var(--border)'}} onClick={e=>e.stopPropagation()}>
        {/* Header — fixed heading + subtitle, not the editable title */}
        <div style={{padding:'20px 20px 16px',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,flexShrink:0}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:'var(--text)',letterSpacing:'-0.01em',lineHeight:'22px',marginBottom:4}}>{isNew?'New Task':'Edit Task'}</div>
            <div style={{fontSize:13,fontWeight:400,lineHeight:'18px',color:'var(--textDim)'}}>{isNew?'Add a task to this column.':'Update the details for this task.'}</div>
          </div>
          <button onClick={onClose} title="Close" style={{width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'none',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}
            onMouseEnter={e=>e.currentTarget.style.background='var(--surfaceAlt)'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>
            <X size={13} strokeWidth={1.6} />
          </button>
        </div>
        {divider}

        {/* Body */}
        <div style={{padding:'20px 20px',display:'flex',flexDirection:'column',gap:20,overflow:'auto'}}>
          <div>
            <label style={label}>Title</label>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Fix modal mobile breakpoint" autoFocus
              onFocus={onFocusRing} onBlur={onBlurRing} style={field}/>
          </div>

          <div>
            <label style={label}>Priority</label>
            <div style={{display:'flex',gap:4,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:8,padding:4}}>
              {PRIORITY_LEVELS.map(p => (
                <button key={p.id} onClick={()=>setPriority(p.id)} title={p.label} style={{
                  flex:1,display:'flex',alignItems:'center',justifyContent:'center',gap:4,padding:'6px 8px',borderRadius:6,
                  border:'none',background: priority===p.id?'var(--surface)':'none',
                  boxShadow: priority===p.id?'0 1px 2px rgba(0,0,0,0.2)':'none',
                  color: priority===p.id?'var(--text)':'var(--textDim)',
                  fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',transition:'background 0.12s,color 0.12s',
                }}>
                  {p.color && <Flag size={11} strokeWidth={2.4} style={{color:p.color,flexShrink:0}} />}
                  {p.id==='none'?'None':p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={label}>Due Date</label>
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}
              onFocus={onFocusRing} onBlur={onBlurRing} style={field}/>
          </div>

          <div>
            <label style={label}>Description</label>
            <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Add more detail…" rows={3}
              onFocus={onFocusRing} onBlur={onBlurRing} style={{...field,resize:'none',lineHeight:'20px'}}/>
          </div>

          {/* Comments only once the task is a real, saved entity — showing a
              thread + Send button on a task that doesn't exist yet (no ref
              for anyone to be commenting on) was the mismatch here; none of
              the 3 reference dialogs put a comment thread in their create
              flow either, only their edit/detail views. */}
          {!isNew && (<>
            {divider}
            <div>
              <label style={label}>Comments{comments.length>0?` (${comments.length})`:''}</label>
              {comments.length>0&&(
                <div style={{marginBottom:8,display:'flex',flexDirection:'column',gap:8}}>
                  {comments.map(c=>(
                    <div key={c.id} style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                      <div style={{width:20,height:20,borderRadius:'50%',background:'var(--accent)',color:'var(--bg)',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>{c.text[0]?.toUpperCase()||'?'}</div>
                      <div style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--borderSubtle)',borderRadius:8,padding:'8px 12px',position:'relative'}}>
                        <div style={{fontSize:13,color:'var(--text)',lineHeight:'18px',paddingRight:16}}>{c.text}</div>
                        <div style={{fontSize:11,color:'var(--textDim)',marginTop:4}}>{new Date(c.createdAt).toLocaleDateString()}</div>
                        <button onClick={()=>setComments(cs=>cs.filter(x=>x.id!==c.id))} title="Remove comment" style={{position:'absolute',top:8,right:8,background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',padding:2,lineHeight:1,display:'flex'}}><X size={11} strokeWidth={1.8} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:8}}>
                <input value={newCmt} onChange={e=>setNewCmt(e.target.value)} placeholder="Write a comment…"
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addCmt()}}}
                  onFocus={onFocusRing} onBlur={onBlurRing} style={{...field,flex:1}}/>
                <button onClick={addCmt} disabled={!newCmt.trim()}
                  style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--accent)',color:'var(--bg)',cursor:'pointer',fontSize:13,fontWeight:700,opacity:newCmt.trim()?1:0.45,fontFamily:'inherit',flexShrink:0}}>
                  Send
                </button>
              </div>
            </div>
          </>)}
        </div>

        {divider}
        {/* Footer — destructive kept separate on the left, fixed width;
            Cancel + primary action split the remaining space 50/50. */}
        <div style={{padding:'16px 20px',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {!isNew&&(
            <button onClick={onDelete} title="Delete task"
              style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px',borderRadius:8,border:'1px solid rgba(248,81,73,0.3)',background:'rgba(248,81,73,0.06)',color:'#f85149',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit',transition:'background 0.12s',flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(248,81,73,0.14)'}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(248,81,73,0.06)'}>
              <Trash2 size={13} strokeWidth={1.8} />Delete
            </button>
          )}
          <div style={{flex:1,display:'flex',gap:8}}>
            <button onClick={onClose}
              style={{flex:1,padding:'10px 16px',borderRadius:8,border:'1px solid var(--border)',background:'none',color:'var(--text)',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit',transition:'background 0.1s'}}
              onMouseEnter={e=>e.currentTarget.style.background='var(--surfaceAlt)'}
              onMouseLeave={e=>e.currentTarget.style.background='none'}>
              Cancel
            </button>
            <button onClick={save} disabled={!canSave}
              style={{flex:1,padding:'10px 16px',borderRadius:8,border:'none',background:canSave?'var(--accent)':'var(--surfaceAlt)',color:canSave?'var(--bg)':'var(--textDim)',cursor:canSave?'pointer':'default',fontSize:13,fontWeight:700,fontFamily:'inherit',opacity:canSave?1:0.6}}>
              {isNew?'Create Task':'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── KanbanBoard ───────────────────────────────────────────────────────────────
const DEFAULT_KANBAN = {
  id:'board_default', title:'My Board',
  columns:[
    {id:'col_backlog',    title:'Backlog',      cards:[], color:'#6B7280'},
    {id:'col_todo',       title:'To Do',        cards:[], color:'#3B82F6'},
    {id:'col_inprogress', title:'In Progress',  cards:[], color:'#F59E0B'},
    {id:'col_done',       title:'Done',         cards:[], color:'#10B981'},
  ]
}

export function KanbanBoard() {
  const [board,        setBoard]        = useState(null)
  const [editingCard,  setEditingCard]  = useState(null)
  const [editColId,    setEditColId2]   = useState(null)
  const [editColName2, setEditColName2] = useState('')
  const [newColName,   setNewColName]   = useState('')
  const [addingCol,    setAddingCol]    = useState(false)
  const [colMenu,      setColMenu]      = useState(null) // {x,y,colId} — column "…" menu
  const [inlineColor,  setInlineColor]  = useState(null) // {cardId, colId}
  const dragRef = useRef(null)
  const dropRef = useRef(null)
  const [dragging,    setDragging]    = useState(null) // cardId
  const [ghostPos,    setGhostPos]    = useState(null)
  const [dropTarget,  setDropTarget]  = useState(null) // {colId, idx}

  useEffect(() => { loadKanbanBoards().then(d => setBoard(d || DEFAULT_KANBAN)) }, [])

  // Close inline color picker on outside click
  useEffect(() => {
    if (!inlineColor) return
    const handler = e => {
      if (!e.target.closest('[data-inline-cp]')) setInlineColor(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [inlineColor])

  const ICON_KB_EDIT  = '<path d="M10.8 2.8a1.98 1.98 0 0 1 2.8 2.8l-7.8 7.8-3.6.8.8-3.6 7.8-7.8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.4 4.2l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
  const ICON_KB_TRASH = '<path d="M2.5 4.5h11M6.4 4.2v-1A1.2 1.2 0 0 1 7.6 2h.8a1.2 1.2 0 0 1 1.2 1.2v1M3.8 4.8l.6 8a1.5 1.5 0 0 0 1.5 1.4h4.2a1.5 1.5 0 0 0 1.5-1.4l.6-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 7.3v4M9.4 7.3v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'

  const persist = async b => { setBoard(b); await saveKanbanBoards(b) }

  const addCard = (colId, data) => {
    const card = {id:makeCardId(),createdAt:new Date().toISOString(),...data}
    persist({...board,columns:board.columns.map(c=>c.id===colId?{...c,cards:[...c.cards,card]}:c)})
    setEditingCard(null)
  }
  const updateCard = (colId, cardId, data) => {
    persist({...board,columns:board.columns.map(c=>c.id===colId?{...c,cards:c.cards.map(cd=>cd.id===cardId?{...cd,...data}:cd)}:c)})
    setEditingCard(null)
  }
  const deleteCard = (colId, cardId) => {
    persist({...board,columns:board.columns.map(c=>c.id===colId?{...c,cards:c.cards.filter(cd=>cd.id!==cardId)}:c)})
    setEditingCard(null)
  }
  const updateCardColor = (colId, cardId, color) => {
    persist({...board,columns:board.columns.map(c=>c.id===colId?{...c,cards:c.cards.map(cd=>cd.id===cardId?{...cd,color}:cd)}:c)})
    setInlineColor(null)
  }

  useEffect(() => {
    if (!board) return
    const getDropTarget = (clientX, clientY) => {
      const cols = [...document.querySelectorAll('[data-kb-col]')]
      for (const colEl of cols) {
        const cr = colEl.getBoundingClientRect()
        if (clientX < cr.left || clientX > cr.right || clientY < cr.top || clientY > cr.bottom) continue
        const colId = colEl.dataset.kbCol
        const cardEls = [...colEl.querySelectorAll('[data-kb-card]')]
        let idx = cardEls.length // default: append at end
        for (let i = 0; i < cardEls.length; i++) {
          const r = cardEls[i].getBoundingClientRect()
          if (clientY < r.top + r.height / 2) { idx = i; break }
        }
        return { colId, idx }
      }
      return null
    }
    const onMove = e => {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging) {
        if (Math.hypot(e.clientX-d.sx,e.clientY-d.sy) > 5) { d.dragging=true; setDragging(d.id); setGhostPos({x:e.clientX,y:e.clientY}) }
        return
      }
      setGhostPos({x:e.clientX,y:e.clientY})
      const tgt = getDropTarget(e.clientX, e.clientY)
      dropRef.current = tgt; setDropTarget(tgt)
    }
    const onUp = () => {
      const d = dragRef.current, tgt = dropRef.current
      dragRef.current = null; dropRef.current = null
      setDragging(null); setGhostPos(null); setDropTarget(null)
      if (!d?.dragging || !tgt) return
      const { colId: toCol, idx: insertIdx } = tgt
      const fromCol = board.columns.find(c=>c.id===d.fromCol)
      if (!fromCol) return
      const card = fromCol.cards.find(c=>c.id===d.id)
      if (!card) return
      // Build new columns
      const newCols = board.columns.map(c => {
        if (c.id === d.fromCol && c.id !== toCol) return {...c, cards: c.cards.filter(x=>x.id!==d.id)}
        if (c.id === toCol && c.id !== d.fromCol) {
          const arr = [...c.cards]
          arr.splice(insertIdx, 0, card)
          return {...c, cards: arr}
        }
        if (c.id === d.fromCol && c.id === toCol) {
          const arr = c.cards.filter(x=>x.id!==d.id)
          const adjustedIdx = Math.min(insertIdx, arr.length)
          arr.splice(adjustedIdx, 0, card)
          return {...c, cards: arr}
        }
        return c
      })
      persist({...board, columns: newCols})
    }
    document.addEventListener('mousemove',onMove)
    document.addEventListener('mouseup',onUp)
    return () => { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp) }
  },[board])

  if (!board) return <div style={{padding:20,color:'var(--textDim)',fontSize:13}}>Loading…</div>

  const ghostCard = (() => { for (const c of board.columns) { const card = c.cards.find(x=>x.id===dragging); if (card) return {...card, colColor: c.color||CARD_COLORS[0]} } return null })()
  const today = new Date()
  const isOverdue = (dateStr) => {
    if (!dateStr) return false
    const d = new Date(dateStr + 'T00:00:00')
    return d < new Date(today.getFullYear(), today.getMonth(), today.getDate())
  }
  const isToday = (dateStr) => {
    if (!dateStr) return false
    const d = new Date(dateStr + 'T00:00:00')
    return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate()
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <span style={{fontSize:15,fontWeight:700,color:'var(--text)',letterSpacing:'-0.01em'}}>{board.title}</span>
        <button onClick={()=>setAddingCol(s=>!s)}
          style={{display:'flex',alignItems:'center',gap:5,padding:'5px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:12,fontWeight:600,cursor:'pointer',transition:'background 0.1s,color 0.1s',fontFamily:'inherit'}}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--surface)';e.currentTarget.style.color='var(--text)'}}
          onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)'}}>
          <Plus size={13} strokeWidth={2} />Column
        </button>
      </div>
      {addingCol&&(
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          <input value={newColName} onChange={e=>setNewColName(e.target.value)} placeholder="Column name…" autoFocus
            onKeyDown={e=>{if(e.key==='Enter'&&newColName.trim()){persist({...board,columns:[...board.columns,{id:makeColId(),title:newColName.trim(),cards:[]}]});setNewColName('');setAddingCol(false)}else if(e.key==='Escape')setAddingCol(false)}}
            style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text)',fontSize:13,padding:'7px 11px',fontFamily:'inherit',outline:'none'}}/>
          <button onClick={()=>{if(newColName.trim()){persist({...board,columns:[...board.columns,{id:makeColId(),title:newColName.trim(),cards:[]}]});setNewColName('');setAddingCol(false)}}}
            style={{padding:'7px 16px',borderRadius:8,border:'none',background:'var(--accent)',color:'var(--bg)',fontSize:13,fontWeight:700,cursor:'pointer'}}>Add</button>
        </div>
      )}
      <div style={{display:'flex',gap:12,overflowX:'auto',paddingBottom:8,alignItems:'flex-start'}}>
        {board.columns.map(col=>{
          const isDropTarget = dropTarget?.colId===col.id
          return (
            <div key={col.id} data-kb-col={col.id}
              style={{minWidth:260,maxWidth:300,flex:'0 0 280px',
                background:isDropTarget?'color-mix(in srgb,var(--accent) 6%,var(--surface))':'var(--surface)',
                border:isDropTarget?'1.5px solid color-mix(in srgb,var(--accent) 50%,var(--border))':'1.5px solid var(--borderSubtle)',
                borderRadius:14,padding:'12px 10px 10px',
                display:'flex',flexDirection:'column',gap:0,transition:'background 0.12s,border-color 0.12s'}}>
              {/* Column header — status ring (colored, hollow, matches the
                  reference boards' circular status token) + title + a dark
                  count pill + a "…" menu (rename/delete) instead of a bare
                  delete button, closer to the reference's overflow menu. */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <div data-inline-cp style={{position:'relative',flexShrink:0,marginRight:7}}>
                  <div onClick={e=>{e.stopPropagation();setInlineColor(inlineColor?.colId===col.id&&!inlineColor?.cardId?null:{colId:col.id})}}
                    style={{width:13,height:13,borderRadius:'50%',background:'none',border:`2px solid ${col.color||CARD_COLORS[0]}`,cursor:'pointer',flexShrink:0,boxSizing:'border-box',
                      boxShadow:(inlineColor?.colId===col.id&&!inlineColor?.cardId)?`0 0 0 2px var(--surface),0 0 0 3.5px ${col.color||CARD_COLORS[0]}`:'none',
                      transition:'box-shadow 0.15s'}} title="Set column color"/>
                  {inlineColor?.colId===col.id&&!inlineColor?.cardId&&(
                    <div data-inline-cp style={{position:'absolute',top:20,left:-4,zIndex:200,
                      background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,
                      padding:'8px',boxShadow:'0 8px 24px rgba(0,0,0,0.22)',
                      display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:5}}>
                      {CARD_COLORS.map(c=>(
                        <div key={c} onClick={e=>{e.stopPropagation();persist({...board,columns:board.columns.map(cl=>cl.id===col.id?{...cl,color:c}:cl)});setInlineColor(null)}}
                          style={{width:16,height:16,borderRadius:'50%',background:c,cursor:'pointer',
                            boxShadow:(col.color||CARD_COLORS[0])===c?`0 0 0 2px var(--surface),0 0 0 3.5px ${c}`:'none',
                            transform:(col.color||CARD_COLORS[0])===c?'scale(1.2)':'scale(1)',
                            transition:'transform 0.1s,box-shadow 0.1s'}}/>
                      ))}
                    </div>
                  )}
                </div>
                {editColId===col.id
                  ?<input value={editColName2} autoFocus onChange={e=>setEditColName2(e.target.value)}
                    onBlur={()=>{persist({...board,columns:board.columns.map(c=>c.id===col.id?{...c,title:editColName2||col.title}:c)});setEditColId2(null)}}
                    onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){persist({...board,columns:board.columns.map(c=>c.id===col.id?{...c,title:editColName2||col.title}:c)});setEditColId2(null)}}}
                    style={{flex:1,background:'none',border:'none',borderBottom:'1px solid var(--accent)',color:'var(--text)',fontSize:13,fontWeight:600,padding:'2px 0',fontFamily:'inherit',outline:'none'}}/>
                  :<span onClick={()=>{setEditColId2(col.id);setEditColName2(col.title)}}
                    style={{fontSize:13,fontWeight:600,color:'var(--text)',cursor:'pointer',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                    title="Click to rename">{col.title}</span>
                }
                <div style={{display:'flex',alignItems:'center',gap:4}}>
                  <span style={{fontSize:11,color:'var(--textDim)',background:'var(--bg)',borderRadius:20,padding:'1px 7px',fontWeight:700,minWidth:18,textAlign:'center'}}>{col.cards.length}</span>
                  <button onClick={e=>{e.stopPropagation();setColMenu({x:e.clientX,y:e.clientY,colId:col.id})}} title="Column options"
                    style={{background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',padding:3,borderRadius:5,display:'flex',opacity:0.5,transition:'opacity 0.1s,background 0.1s'}}
                    onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.background='var(--bg)'}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity='0.5';e.currentTarget.style.background='none'}}><Ellipsis size={13} strokeWidth={1.8} /></button>
                </div>
              </div>
              {/* Cards with drop indicators */}
              <div style={{display:'flex',flexDirection:'column',gap:0}}>
                {col.cards.map((card, cardIdx)=>{
                  const showIndicator = isDropTarget && dropTarget.idx===cardIdx && !!dragging
                  return (
                    <div key={card.id} data-kb-card data-kb-card-idx={cardIdx} style={{position:'relative'}}>
                      {/* Drop indicator before */}
                      {showIndicator && dragging && (
                        <div style={{height:3,borderRadius:2,background:'var(--accent)',margin:'2px 0',boxShadow:'0 0 6px color-mix(in srgb,var(--accent) 60%,transparent)',transition:'opacity 0.1s'}}/>
                      )}
                      <div
                        onMouseDown={e=>{if(e.button!==0||e.target.closest('[data-inline-cp]')||e.target.closest('button'))return;e.preventDefault();dragRef.current={id:card.id,fromCol:col.id,sx:e.clientX,sy:e.clientY,dragging:false}}}
                        style={{background:'var(--surfaceAlt)',border:'1px solid var(--borderSubtle)',
                          borderRadius:12,padding:'12px 13px',cursor:dragging?'grabbing':'grab',
                          opacity:dragging===card.id?0.3:1,marginBottom:8,
                          boxShadow:'0 1px 2px rgba(0,0,0,0.12)',transition:'opacity 0.15s,box-shadow 0.12s,transform 0.12s',
                          userSelect:'none'}}
                        onMouseEnter={e=>{if(dragging!==card.id){e.currentTarget.style.boxShadow='0 4px 14px rgba(0,0,0,0.22)';e.currentTarget.style.transform='translateY(-1px)'}}}
                        onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 1px 2px rgba(0,0,0,0.12)';e.currentTarget.style.transform='translateY(0)'}}>
                        {/* Id row — status ring + ticket code, priority flag
                            (real fields only: derived from the card's own id
                            and the user-set priority — no fabricated
                            assignee/attachment data standing in for the
                            reference boards' avatar/paperclip). */}
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                          <span style={{width:7,height:7,borderRadius:'50%',border:`1.5px solid ${col.color||CARD_COLORS[0]}`,flexShrink:0,boxSizing:'border-box'}}/>
                          <span style={{fontSize:11,fontWeight:600,color:'var(--textDim)',letterSpacing:'0.02em',flexShrink:0}}>{kanbanCardCode(card.id)}</span>
                          <span style={{flex:1}}/>
                          {priorityMeta(card.priority).color && (
                            <Flag size={12} strokeWidth={2.2} style={{color:priorityMeta(card.priority).color,flexShrink:0}} title={priorityMeta(card.priority).label} />
                          )}
                          <button onClick={e=>{e.stopPropagation();setEditingCard({card,colId:col.id,isNew:false})}}
                            title="Edit task"
                            style={{background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',padding:2,borderRadius:5,display:'flex',flexShrink:0,opacity:0.5,transition:'opacity 0.1s,background 0.1s'}}
                            onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.background='var(--surface)'}}
                            onMouseLeave={e=>{e.currentTarget.style.opacity='0.5';e.currentTarget.style.background='none'}}><Ellipsis size={13} strokeWidth={2} /></button>
                        </div>
                        {/* Title */}
                        <div style={{fontSize:14,fontWeight:600,color:'var(--text)',lineHeight:1.4,
                          marginBottom:card.dueDate||card.comments?.length?8:0}}>
                          {card.title}
                        </div>
                        {/* Meta row — comments left, relative due-date right */}
                        {(card.dueDate||card.comments?.length>0)&&(
                          <div style={{display:'flex',alignItems:'center',gap:8}}>
                            {card.comments?.length>0&&(
                              <span style={{fontSize:11,color:'var(--textDim)',display:'inline-flex',alignItems:'center',gap:3}}>
                                <MessageSquare size={11} strokeWidth={2} />
                                {card.comments.length}
                              </span>
                            )}
                            <span style={{flex:1}}/>
                            {card.dueDate&&(
                              <span style={{fontSize:11,fontWeight:500,display:'inline-flex',alignItems:'center',gap:3,
                                color:isOverdue(card.dueDate)?'#f85149':isToday(card.dueDate)?'#f97316':'var(--textDim)'}}>
                                <Clock size={11} strokeWidth={2} />
                                {kanbanDueLabel(card.dueDate)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* Drop indicator at end */}
                {isDropTarget && dropTarget.idx===col.cards.length && dragging && (
                  <div style={{height:3,borderRadius:2,background:'var(--accent)',margin:'2px 0 6px',boxShadow:'0 0 6px color-mix(in srgb,var(--accent) 60%,transparent)'}}/>
                )}
              </div>
              {/* Add task — plain text link, not a dashed box, matching the
                  reference boards' minimal "+ Add task" row. */}
              <button onClick={()=>setEditingCard({card:null,colId:col.id,isNew:true})}
                style={{display:'flex',alignItems:'center',justifyContent:'flex-start',gap:6,background:'none',border:'none',borderRadius:7,color:'var(--textDim)',cursor:'pointer',padding:'7px 4px',fontSize:12,fontWeight:600,textAlign:'left',transition:'background 0.1s,color 0.1s',marginTop:2,fontFamily:'inherit'}}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--accent)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.color='var(--textDim)'}}>
                <Plus size={13} strokeWidth={2} />Add task
              </button>
            </div>
          )
        })}
      </div>
      {/* Drag ghost */}
      {dragging&&ghostPos&&ghostCard&&(
        <div style={{position:'fixed',left:ghostPos.x+12,top:ghostPos.y-10,zIndex:9999,pointerEvents:'none',
          background:'var(--surfaceAlt)',border:'1px solid var(--border)',
          borderRadius:10,padding:'10px 12px',minWidth:180,maxWidth:240,
          boxShadow:'0 12px 32px rgba(0,0,0,0.35)',
          opacity:0.95,transform:'rotate(1.5deg)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:7,height:7,borderRadius:'50%',border:`1.5px solid ${ghostCard.colColor}`,flexShrink:0,boxSizing:'border-box'}}/>
            <span style={{fontSize:12.5,fontWeight:600,color:'var(--text)',lineHeight:1.3}}>{ghostCard.title}</span>
          </div>
        </div>
      )}
      {editingCard&&(
        <KanbanCardModal card={editingCard.card}
          onSave={data=>editingCard.isNew?addCard(editingCard.colId,data):updateCard(editingCard.colId,editingCard.card.id,data)}
          onDelete={()=>deleteCard(editingCard.colId,editingCard.card?.id)}
          onClose={()=>setEditingCard(null)}/>
      )}
      {colMenu && (
        <ContextMenu x={colMenu.x} y={colMenu.y} onClose={()=>setColMenu(null)} items={[
          { label: 'Rename', icon: ICON_KB_EDIT, action: () => {
            const col = board.columns.find(c => c.id === colMenu.colId)
            if (col) { setEditColId2(col.id); setEditColName2(col.title) }
          }},
          { label: 'Delete', icon: ICON_KB_TRASH, danger: true, action: () => {
            persist({ ...board, columns: board.columns.filter(c => c.id !== colMenu.colId) })
          }},
        ]} />
      )}
    </div>
  )
}

// ── ProfileModal ──────────────────────────────────────────────────────────────
function ProfileModal({ onClose }) {
  const isMobile = useIsMobile()
  const paneTabId          = useContext(PaneContext)
  const library            = useAppStore(s => s.library)
  const notebooks          = useAppStore(s => s.notebooks)
  const username           = useAppStore(s => s.username)
  const navigate           = useAppStore(s => s.navigate)
  const storeCalendarEvents = useAppStore(s => s.calendarEvents)

  const [profileTab,   setProfileTab]   = useState('stats')
  const [todoLists,    setTodoLists]    = useState([])
  const [todosLoaded,  setTodosLoaded]  = useState(false)
  const [calendarEvents, setCalendarEvents] = useState({})
  const [habitBlocks,  setHabitBlocks]  = useState([])
  const [habitsLoaded, setHabitsLoaded] = useState(false)

  useEffect(() => {
    if (profileTab !== 'habits' || habitsLoaded) return
    setHabitsLoaded(true)
    ;(async () => {
      const allBlocks = []
      for (const nb of notebooks) {
        try {
          const raw = await loadNotebookContent(nb.id)
          if (!raw) continue
          const text = typeof raw === 'string' ? raw.replace(/^# .+\n/, '') : ''
          const blocks = extractHabitsFromText(text)
          blocks.forEach((b, idx) => allBlocks.push({ notebookId: nb.id, notebookTitle: nb.title, blockIdx: idx, ...b }))
        } catch { /* skip */ }
      }
      setHabitBlocks(allBlocks)
    })()
  }, [profileTab, habitsLoaded, notebooks])

  async function toggleProfileHabit(blockIdx_in_array, habitIndex) {
    const block = habitBlocks[blockIdx_in_array]
    if (!block) return
    const dateKey = today
    // Optimistic UI update
    setHabitBlocks(prev => prev.map((b, i) => {
      if (i !== blockIdx_in_array) return b
      const log = { ...(b.log || {}) }
      const arr = [...(log[dateKey] || [])]
      while (arr.length <= habitIndex) arr.push(0)
      arr[habitIndex] = arr[habitIndex] ? 0 : 1
      log[dateKey] = arr
      return { ...b, log }
    }))
    // Persist to notebook file
    try {
      const { loadNotebookContent, saveNotebookContent } = await import('@/lib/storage')
      const content = await loadNotebookContent(block.notebookId)
      if (!content) return
      const lines = content.split('\n')
      let blockCount = 0
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^\/habits(?::(.*))?$/)
        if (m && m[1]) {
          try {
            const data = JSON.parse(m[1])
            if (blockCount === block.blockIdx) {
              if (!data.log) data.log = {}
              if (!data.log[dateKey]) data.log[dateKey] = []
              while (data.log[dateKey].length <= habitIndex) data.log[dateKey].push(0)
              data.log[dateKey][habitIndex] = data.log[dateKey][habitIndex] ? 0 : 1
              lines[i] = `/habits:${JSON.stringify(data)}`
              await saveNotebookContent(block.notebookId, lines.join('\n'))
              break
            }
            blockCount++
          } catch { /* skip */ }
        }
      }
    } catch (e) { console.warn('[Gnos] toggleProfileHabit failed:', e) }
  }

  useEffect(() => {
    if ((profileTab !== 'calendar') || todosLoaded) return
    setTodosLoaded(true)
    ;(async () => {
      const all = [], allCals = []
      for (const nb of notebooks) {
        try {
          const raw = await loadNotebookContent(nb.id)
          if (!raw) continue
          const text = typeof raw === 'string' ? raw.replace(/^# .+\n/, '') : ''
          const lists = extractTodosFromText(text)
          lists.forEach(l => all.push({ notebookTitle: nb.title, ...l }))
          const cals = extractCalendarsFromText(text)
          allCals.push(...cals)
          const taskEvts = extractTaskDueDatesFromText(text)
          if (Object.keys(taskEvts).length) allCals.push({ title: 'Tasks', events: taskEvts })
        } catch { /* skip */ }
      }
      setTodoLists(all)
      setCalendarEvents(mergeCalendarEvents(allCals))
    })()
  }, [profileTab, todosLoaded, notebooks])

  const today = new Date().toISOString().slice(0, 10)

  const title = username ? `${username} — Profile` : 'Reading Profile'
  const TABS = [['stats','Stats'],['review','Review'],['calendar','Calendar'],['habits','Habits']]

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={isMobile ? undefined : onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',
        borderRadius: isMobile ? 0 : 14,
        width: isMobile ? '100vw' : 700,
        maxWidth: isMobile ? '100%' : 'calc(100vw - 32px)',
        height: isMobile ? '100vh' : undefined,
        maxHeight: isMobile ? '100%' : 'calc(100vh - 48px)',
        display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',transition:'width 0.25s ease'}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        {isMobile ? null : (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 12px',borderBottom:'1px solid var(--borderSubtle)',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,fontWeight:700,color:'var(--text)',letterSpacing:'-0.01em'}}>{title}</span>
              <div style={{display:'flex',gap:2,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:8,padding:3,boxShadow:'inset 0 1px 2px rgba(0,0,0,0.15)'}}>
                {TABS.map(([t,l])=>(
                  <button key={t} onClick={()=>setProfileTab(t)} style={{
                    height:22,padding:'0 10px',fontSize:11,fontWeight:600,borderRadius:5,border:'none',cursor:'pointer',fontFamily:'inherit',
                    background:profileTab===t?'var(--accent)':'none',color:profileTab===t?'var(--bg)':'var(--textDim)',transition:'all 0.15s',
                  }}>{l}</button>
                ))}
              </div>
            </div>
            <button onClick={onClose} style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}>
              <X size={9} strokeWidth={1.5} />
            </button>
          </div>
        )}

        <div style={{overflowY:'auto',padding: isMobile ? '16px 20px 120px' : '16px 20px 24px',flex:1}}>
          {/* ── Review tab (shared) ── */}
          {profileTab==='review'&&(<ProfileContent tab="review" library={library} notebooks={notebooks}/>)}

          {/* ── Calendar tab ── */}
          {profileTab==='calendar'&&(
            <div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
                <button onClick={()=>{onClose();navigate({view:'calendar'})}} style={{padding:'5px 12px',borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'background 0.15s,color 0.15s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='var(--bg)';e.currentTarget.style.borderColor='var(--accent)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}>
                  <Calendar size={12} strokeWidth={1.2} />
                  Open Calendar
                </button>
              </div>
              <FullCalendar notebookEvents={calendarEvents}/>
            </div>
          )}

          {/* ── Habits tab ── */}
          {profileTab==='habits'&&(
            <div>
              {!habitsLoaded&&<div style={{color:'var(--textDim)',fontSize:13,padding:'8px 0'}}>Loading habits…</div>}
              {habitsLoaded&&habitBlocks.length===0&&(
                <div style={{color:'var(--textDim)',fontSize:13,padding:'16px 0',textAlign:'center',lineHeight:1.6}}>
                  No habits yet.<br/>
                  <span style={{fontSize:12,opacity:0.7}}>Use <code style={{background:'var(--surfaceAlt)',padding:'1px 5px',borderRadius:4}}>/habits</code> in any notebook to create a habit tracker.</span>
                </div>
              )}
              {habitsLoaded&&habitBlocks.map((block, bi) => {
                const todayKey = today
                const totalHabits = block.habits.length
                const todayLog = block.log?.[todayKey] || []
                const todayDone = Array.from({length:totalHabits}).filter((_,i)=>todayLog[i]).length
                // Build last 7 days for the date header
                const last7 = Array.from({length:7}).map((_,d)=>{
                  const dt = new Date(); dt.setDate(dt.getDate()-(6-d))
                  return { k: dt.toISOString().slice(0,10), label: `${dt.getMonth()+1}/${dt.getDate()}`, isToday: d===6 }
                })
                return (
                  <div key={bi} style={{marginBottom:16,padding:'12px 14px',borderRadius:10,background:'var(--surface)',border:'1px solid var(--borderSubtle)'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{block.title || 'Habits'}</div>
                        <div style={{fontSize:10,color:'var(--textDim)',marginTop:2}}>{block.notebookTitle}</div>
                      </div>
                      <button
                        title="Open notebook"
                        onClick={() => {
                          const nb = useAppStore.getState().notebooks.find(n => n.id === block.notebookId)
                          if (!nb) return
                          if (paneTabId) {
                            useAppStore.getState().setActiveNotebook(nb)
                            useAppStore.getState().updateTab(paneTabId, { view: 'notebook', activeNotebook: nb })
                            useAppStore.getState().setView('notebook')
                          } else {
                            navigate({ view: 'notebook', activeNotebook: nb })
                          }
                          onClose()
                        }}
                        style={{width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginRight:8,transition:'border-color 0.1s,color 0.1s'}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)'}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--textDim)'}}
                      >
                        <ArrowRight size={11} strokeWidth={1.5} />
                      </button>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontSize:20,fontWeight:800,color:'var(--accent)',lineHeight:1}}>{todayDone}/{totalHabits}</div>
                        <div style={{fontSize:10,color:'var(--textDim)',marginTop:1}}>today</div>
                      </div>
                    </div>
                    {/* Date header row */}
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4,paddingLeft:0}}>
                      <div style={{flex:1,minWidth:0}}/>
                      <div style={{display:'flex',gap:2,flexShrink:0}}>
                        {last7.map(({k,label,isToday})=>(
                          <div key={k} style={{width:28,textAlign:'center',fontSize:9,fontWeight:isToday?700:400,color:isToday?'var(--accent)':'var(--textDim)',lineHeight:1}}>{label}</div>
                        ))}
                      </div>
                      <div style={{width:32}}/>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:5}}>
                      {block.habits.map((hName, hi) => {
                        const done = !!(block.log?.[todayKey]?.[hi])
                        let streak7 = 0
                        for (let d = 0; d < 7; d++) {
                          const dt = new Date(); dt.setDate(dt.getDate() - d)
                          const k = dt.toISOString().slice(0, 10)
                          if (block.log?.[k]?.[hi]) streak7++
                        }
                        return (
                          <div key={hi} onClick={()=>toggleProfileHabit(bi,hi)} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 10px',borderRadius:7,cursor:'pointer',background:done?'color-mix(in srgb, var(--accent) 8%, var(--surface))':'var(--surfaceAlt)',border:`1px solid ${done?'color-mix(in srgb, var(--accent) 25%, var(--border))':'var(--borderSubtle)'}`,transition:'background 0.12s,border-color 0.12s'}}>
                            <div style={{width:16,height:16,borderRadius:4,flexShrink:0,border:`1.5px solid ${done?'var(--accent)':'var(--border)'}`,background:done?'var(--accent)':'none',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'var(--bg)',transition:'background 0.12s,border-color 0.12s'}}>{done?'✓':''}</div>
                            <div style={{flex:1,minWidth:0,fontSize:12.5,color:'var(--text)',fontWeight:done?600:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={hName}>{hName}</div>
                            <div style={{display:'flex',gap:2,flexShrink:0}}>
                              {last7.map(({k,isToday})=>{
                                const on = !!(block.log?.[k]?.[hi])
                                return <div key={k} style={{width:28,height:14,borderRadius:3,background:on?'var(--accent)':'var(--surfaceAlt)',border:`1px solid ${isToday?'var(--accent)':'var(--borderSubtle)'}`,opacity:on?1:0.5,boxShadow:isToday&&!on?'inset 0 0 0 1px var(--accent)':undefined}} title={k}/>
                              })}
                            </div>
                            <span style={{fontSize:10,color:streak7>=5?'var(--accent)':'var(--textDim)',fontWeight:600,flexShrink:0,width:32,textAlign:'right'}}>{streak7}/7</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Stats tab (shared) ── */}
          {profileTab==='stats'&&(<ProfileContent tab="stats" library={library} notebooks={notebooks}/>)}
        </div>

        {/* Mobile tab bar — fixed above bottom nav */}
        {isMobile && (
          <div style={{
            position:'fixed', bottom:65, left:'50%', transform:'translateX(-50%)',
            width:'80vw', zIndex:9002,
            display:'flex', gap:2,
            background:'var(--surfaceAlt)', border:'1px solid var(--border)',
            borderRadius:12, padding:3,
            boxShadow:'0 4px 16px rgba(0,0,0,0.2)',
          }}>
            {TABS.map(([t,l])=>(
              <button key={t} onClick={()=>setProfileTab(t)} style={{
                flex:1, height:30, fontSize:11, fontWeight:600,
                borderRadius:9, border:'none', cursor:'pointer', fontFamily:'inherit',
                background:profileTab===t?'var(--accent)':'none',
                color:profileTab===t?'#fff':'var(--textDim)',
                transition:'all 0.15s',
              }}>{l}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DevOnboardingPreview — full onboarding UI in a modal, all side-effects
// replaced with no-ops so no files are created and no prefs are written.
// Triggered by typing `/dev test onboarding` in the library search bar.
// ─────────────────────────────────────────────────────────────────────────────
// DevOnboardingPreview — renders the real OnboardingView inside a full-screen
// modal with all Tauri side-effects neutralised. No files are created and no
// preferences are written. Triggered by `/dev test onboarding` in the search bar.
function DevOnboardingPreview({ onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 20000, display: 'flex', flexDirection: 'column' }}>
      {/* DEV banner */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1,
        background: 'rgba(248,81,73,0.92)', color: '#fff',
        fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
        textTransform: 'uppercase', textAlign: 'center', padding: '5px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        <span>🧪 Dev Preview — read-only, no files created, no prefs saved</span>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
          borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: 11,
          fontWeight: 700, fontFamily: 'inherit',
        }}>✕ Exit</button>
      </div>
      {/* Real OnboardingView shifted down by banner height, side-effects patched */}
      <div style={{ flex: 1, marginTop: 27 }}>
        <OnboardingViewDev onClose={onClose} />
      </div>
    </div>
  )
}

// Dynamically imports OnboardingView and renders it with devMode=true.
// The devMode prop inside OnboardingView skips all Tauri filesystem calls
// and store writes, so nothing is created or persisted.
function OnboardingViewDev({ onClose }) {
  const [OBView, setOBView] = useState(null)
  useEffect(() => {
    import('@/views/OnboardingView').then(m => setOBView(() => m.default))
  }, [])

  if (!OBView) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--textDim)', fontSize: 13 }}>
      Loading…
    </div>
  )

  return <OBView onComplete={onClose} devMode={true} />
}

// ─────────────────────────────────────────────────────────────────────────────
// Header filter buttons — type filter (cycle) + sort (dropdown). Portal into
// the titlebar quick-access strip via <QuickAccess>, same slot NotebookView's
// ViewModeBtn uses (click-cycles the primary state, long-press opens a full
// picker dropdown).
// ─────────────────────────────────────────────────────────────────────────────
const TYPE_FILTER_CYCLE = ['all', 'book', 'audio', 'notebook', 'sketchbook', 'flashcard', 'quicknotes']
const TYPE_FILTER_META = {
  all:        { icon: <ListFilter  size={15} strokeWidth={1.5} />, label: 'All Types',  title: 'Showing all types' },
  book:       { icon: <Book        size={14} strokeWidth={1.6} />, label: 'Books',      title: 'Filter: Books' },
  audio:      { icon: <Volume2     size={14} strokeWidth={1.6} />, label: 'Audiobooks', title: 'Filter: Audiobooks' },
  notebook:   { icon: <NotebookText size={14} strokeWidth={1.6} />, label: 'Notebooks',  title: 'Filter: Notebooks' },
  sketchbook: { icon: <SquarePen   size={14} strokeWidth={1.6} />, label: 'Sketchbooks', title: 'Filter: Sketchbooks' },
  flashcard:  { icon: <Layers      size={14} strokeWidth={1.6} />, label: 'Flashcards', title: 'Filter: Flashcards' },
  quicknotes: { icon: <StickyNote  size={14} strokeWidth={1.6} />, label: 'Quicknotes', title: 'Filter: Quicknotes' },
}

/** Click cycles to the next type; long-press (300ms hold) opens a dropdown to
 *  jump straight to any type. Same interaction shape as NotebookView's
 *  live/source/preview switcher. */
function TypeFilterBtn({ typeFilter, setTypeFilter }) {
  const [dropOpen, setDropOpen] = useState(false)
  const holdTimer = useRef(null)
  const didLong   = useRef(false)
  const wrapRef   = useRef(null)

  useEffect(() => {
    if (!dropOpen) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  return (
    <div style={{ position: 'relative', flexShrink: 0 }} ref={wrapRef}>
      <button className={`gnos-settings-btn${typeFilter !== 'all' ? ' active' : ''}`}
        title={TYPE_FILTER_META[typeFilter].title}
        onMouseDown={() => { didLong.current = false; holdTimer.current = setTimeout(() => { didLong.current = true; setDropOpen(d => !d) }, 300) }}
        onMouseUp={() => clearTimeout(holdTimer.current)}
        onMouseLeave={() => clearTimeout(holdTimer.current)}
        onClick={() => {
          if (didLong.current) return
          const i = TYPE_FILTER_CYCLE.indexOf(typeFilter)
          setTypeFilter(TYPE_FILTER_CYCLE[(i + 1) % TYPE_FILTER_CYCLE.length])
          setDropOpen(false)
        }}
      >
        {TYPE_FILTER_META[typeFilter].icon}
      </button>
      {dropOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.45)', minWidth: 150, zIndex: 9300 }}>
          {TYPE_FILTER_CYCLE.map(t => (
            <button key={t} onMouseDown={e => { e.preventDefault(); setTypeFilter(t); setDropOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontFamily: 'inherit', color: typeFilter === t ? 'var(--accent)' : 'var(--text)' }}>
              {TYPE_FILTER_META[t].icon}
              <span style={{ flex: 1, fontWeight: 500 }}>{TYPE_FILTER_META[t].label}</span>
              {typeFilter === t && <span style={{ fontSize: 11, opacity: .7 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Timestamp helpers — item shapes disagree on field names across types
// (books/audio use `addedAt` from import, notebooks/sketchbooks/decks use
// `createdAt`/`updatedAt`) so this normalizes to one comparable number.
// No byte size is tracked anywhere yet (no file stat pass), so "Size" isn't
// offered here — Name/Modified/Created only, all reliably available.
function _itemCreatedAt(item) {
  const t = Date.parse(item?.createdAt || item?.addedAt || 0)
  return Number.isFinite(t) ? t : 0
}
function _itemModifiedAt(item) {
  const t = Date.parse(item?.updatedAt || 0)
  return (Number.isFinite(t) && t > 0) ? t : _itemCreatedAt(item)
}

const SORT_META = {
  manual:   { label: 'Manual order' },
  name:     { label: 'Name' },
  modified: { label: 'Date Modified' },
  created:  { label: 'Date Created' },
}

/** Click opens a dropdown: pick a field, or re-click the active field to flip
 *  direction. 'Manual order' turns sorting off and falls back to drag order. */
function SortFilterBtn({ sortBy, setSortBy, sortDir, setSortDir }) {
  const [dropOpen, setDropOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!dropOpen) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  const active = sortBy !== 'manual'
  return (
    <div style={{ position: 'relative', flexShrink: 0 }} ref={wrapRef}>
      <button className={`gnos-settings-btn${active ? ' active' : ''}`}
        title={active ? `Sorted by ${SORT_META[sortBy].label} (${sortDir === 'desc' ? 'descending' : 'ascending'})` : 'Sort'}
        onClick={() => setDropOpen(d => !d)}
      >
        {active
          ? (sortDir === 'desc' ? <ArrowDownWideNarrow size={15} strokeWidth={1.6} /> : <ArrowUpWideNarrow size={15} strokeWidth={1.6} />)
          : <ArrowUpDown size={14} strokeWidth={1.6} />}
      </button>
      {dropOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.45)', minWidth: 170, zIndex: 9300 }}>
          {Object.keys(SORT_META).map(key => (
            <button key={key} onMouseDown={e => {
                e.preventDefault()
                if (key === 'manual') { setSortBy('manual'); setDropOpen(false); return }
                if (sortBy === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
                else { setSortBy(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
                setDropOpen(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', border: 'none', background: 'none', width: '100%', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontFamily: 'inherit', color: sortBy === key ? 'var(--accent)' : 'var(--text)' }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{SORT_META[key].label}</span>
              {sortBy === key && (key === 'manual'
                ? <span style={{ fontSize: 11, opacity: .7 }}>✓</span>
                : (sortDir === 'desc' ? <ArrowDownWideNarrow size={13} strokeWidth={1.8} /> : <ArrowUpWideNarrow size={13} strokeWidth={1.8} />))}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LibraryView() {
  const isMobile  = useIsMobile()
  const library   = useAppStore(s => s.library)
  const notebooks = useAppStore(s => s.notebooks)
  const sketchbooks = useAppStore(s => s.sketchbooks)
  const setView         = useAppStore(s => s.setView)
  const openNewTab      = useAppStore(s => s.openNewTab)
  const setActiveBook      = useAppStore(s => s.setActiveBook)
  const setActiveNotebook  = useAppStore(s => s.setActiveNotebook)
  const setActiveAudioBook = useAppStore(s => s.setActiveAudioBook)
  const setActiveSketchbook = useAppStore(s => s.setActiveSketchbook)
  const removeBook      = useAppStore(s => s.removeBook)
  const removeNotebook  = useAppStore(s => s.removeNotebook)
  const removeSketchbook = useAppStore(s => s.removeSketchbook)
  const addBook         = useAppStore(s => s.addBook)
  const reorderLibrary        = useAppStore(s => s.reorderLibrary)
  const reorderNotebooks      = useAppStore(s => s.reorderNotebooks)
  const reorderSketchbooks    = useAppStore(s => s.reorderSketchbooks)
  const reorderFlashcardDecks = useAppStore(s => s.reorderFlashcardDecks)
  const persistLibrary  = useAppStore(s => s.persistLibrary)
  const updateBook      = useAppStore(s => s.updateBook)
  const addNotebook      = useAppStore(s => s.addNotebook)
  const updateNotebook   = useAppStore(s => s.updateNotebook)
  const persistNotebooks = useAppStore(s => s.persistNotebooks)
  const addSketchbook    = useAppStore(s => s.addSketchbook)
  const persistSketchbooks = useAppStore(s => s.persistSketchbooks)
  const collections          = useAppStore(s => s.collections)
  const addCollection        = useAppStore(s => s.addCollection)
  const removeCollection     = useAppStore(s => s.removeCollection)
  const updateCollection     = useAppStore(s => s.updateCollection)
  const addToCollection      = useAppStore(s => s.addToCollection)
  const persistCollections   = useAppStore(s => s.persistCollections)
  const activeCollectionId   = useAppStore(s => s.activeCollectionId)
  const flashcardDecks        = useAppStore(s => s.flashcardDecks)
  const addDeck               = useAppStore(s => s.addDeck)
  const removeDeck            = useAppStore(s => s.removeDeck)
  const setActiveFlashcardDeck = useAppStore(s => s.setActiveFlashcardDeck)
  const persistFlashcardDecks  = useAppStore(s => s.persistFlashcardDecks)
  const activeTab        = useAppStore(s => s.activeLibTab)
  const setActiveLibTab  = useAppStore(s => s.setActiveLibTab)
  const navigate              = useAppStore(s => s.navigate)
  const setOnboardingComplete = useAppStore(s => s.setOnboardingComplete)
  const setArchivePath        = useAppStore(s => s.setArchivePath)
  const persistPreferences    = useAppStore(s => s.persistPreferences)
  const unifiedLibraryOrder   = useAppStore(s => s.unifiedLibraryOrder)
  const setUnifiedLibraryOrder = useAppStore(s => s.setUnifiedLibraryOrder)
  const openOnCreate          = useAppStore(s => s.openOnCreate)

  // Streak data (hoisted from StreakFooter so mobile header can use it)
  const [streakDays,    setStreakDays]    = useState(0)
  const [weekActivity,  setWeekActivity] = useState([false,false,false,false,false,false,false])

  const [search,     setSearch]     = useState('')
  const [addOpen,    setAddOpen]    = useState(false)
  const [newlyCreatedId, setNewlyCreatedId] = useState(null)
  const [devOnboardingOpen, setDevOnboardingOpen] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dropId,     setDropId]     = useState(null)
  const [ghostPos,   setGhostPos]   = useState(null) // { x, y } for drag ghost
  const dragRef = useRef(null) // { idx, type, id, title, nbKind?, startX, startY, dragging }
  const dropRef = useRef(null) // { item: id | null, col: collectionId | null } — updated in onMove
  const [menu,       setMenu]       = useState(null)
  const [libMenu,    setLibMenu]    = useState(null)
  const [editBook,   setEditBook]   = useState(null)
  const [editBookMeta, setEditBookMeta] = useState(null)
  const [editNb,     setEditNb]     = useState(null)
  const [editSb,     setEditSb]     = useState(null)
  const [editCol,    setEditCol]    = useState(null)
  // Epub whose kept .epub source file went missing (A86) — opening it prompts
  // to remove the book instead of navigating into a broken reader.
  const [missingBookPrompt, setMissingBookPrompt] = useState(null)
  const [toast,      setToast]      = useState(null) // { message, error }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [activeCollection, setActiveCollection] = useState(null)
  const [editColId, setEditColId] = useState(null)
  const [editColName, setEditColName] = useState('')
  const [editColDesc, setEditColDesc] = useState(null) // null = not editing
  const [editColGoal, setEditColGoal] = useState(null) // null = not editing
  const [smartFilterOpen, setSmartFilterOpen] = useState(null) // collectionId
  const [smartFilterField, setSmartFilterField] = useState('format')
  const [smartFilterValue, setSmartFilterValue] = useState('')

  const [typeFilter, setTypeFilter] = useState('all') // all | book | audio | notebook | sketchbook | flashcard
  const [sortBy, setSortBy] = useState('manual') // manual | name | modified | created
  const [sortDir, setSortDir] = useState('asc')
  // Windowed grid: render the first WINDOW_STEP cards immediately, grow on idle.
  // Bounds DOM nodes + compositor layers at open so a big library doesn't mount
  // hundreds of absolutely-positioned cover imgs in one commit (mount spike +
  // WebKit tile-dropout while scrolling).
  const WINDOW_STEP = 60
  // Home unmounts this whole view (App's ViewPanel swaps on tab.view), so the
  // window size and scroll position are restored from a module cache — without
  // it, coming back from a book dumps you at the top of a 60-card grid.
  // Own useContext call — LibraryView's `paneTabId` is declared further down.
  const _viewKey = useContext(PaneContext) || 'main'
  const [visibleCount, setVisibleCount] = useState(() => _gridState.get(_viewKey)?.visibleCount || WINDOW_STEP)
  const _totalItems = library.length + notebooks.length + sketchbooks.length + flashcardDecks.length
  // Reset the window when the view changes (filter/collection/tab).
  const _firstRun = useRef(true)
  useEffect(() => {
    // ...but not on mount, or the restore above is immediately clobbered.
    if (_firstRun.current) { _firstRun.current = false; return }
    setVisibleCount(WINDOW_STEP)
  }, [typeFilter, activeCollectionId, activeTab])
  // Grow on scroll only. An idle/timer-driven grow fires even when nobody is
  // looking (the launch main thread is saturated, so requestIdleCallback's
  // timeout always wins) and re-renders the whole grid every step — that churn
  // is what made covers feel slow for the first ~10s. Scroll-driven means an
  // idle library renders exactly one window.
  const contentRef = useRef(null)
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    let queued = false
    function check() {
      queued = false
      const el = root.querySelector('.lib-tab-panel.active') || root
      if (el.scrollHeight <= el.clientHeight + 4) return // nothing to scroll yet
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 800) {
        setVisibleCount(c => (c >= _totalItems ? c : c + WINDOW_STEP))
      }
    }
    function onScroll() {
      if (queued) return
      queued = true
      requestAnimationFrame(check)
    }
    // scroll doesn't bubble — capture so any inner tab panel is covered
    root.addEventListener('scroll', onScroll, true)
    return () => root.removeEventListener('scroll', onScroll, true)
  }, [_totalItems])

  // Cleanup below runs after the last render, so read the count through a ref.
  const visibleCountRef = useRef(visibleCount)
  visibleCountRef.current = visibleCount
  // Restore scroll after the restored window has painted, and record it on the
  // way out so the next mount can do the same.
  useLayoutEffect(() => {
    const root = contentRef.current
    if (!root) return
    const el = root.querySelector('.lib-tab-panel.active') || root
    const saved = _gridState.get(_viewKey)
    if (saved?.scrollTop) el.scrollTop = saved.scrollTop
    return () => {
      _gridState.set(_viewKey, {
        visibleCount: visibleCountRef.current,
        scrollTop: el.scrollTop,
      })
    }
    // Mount/unmount only — restoring mid-session would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Commands from the native View menu and the titlebar controls
  useEffect(() => {
    function onCmd(e) {
      const { cmd, value } = e.detail || {}
      if (cmd === 'type-filter') {
        setTypeFilter(value || 'all')
        if (useAppStore.getState().activeLibTab === 'collections') setActiveLibTab('library')
      }
      if (cmd === 'import-books') fileInputRef.current?.click()
      if (cmd === 'import-audio') audioInputRef.current?.click()
      if (cmd === 'open-add') setAddOpen(true)
      if (cmd === 'open-profile') setProfileOpen(true)
    }
    window.addEventListener('gnos:lib-cmd', onCmd)
    // Titlebar "+" created an item but "Open on create" is off — highlight it in the grid
    function onItemCreated(e) {
      const id = e.detail?.id
      if (!id) return
      setNewlyCreatedId(id)
      setTimeout(() => setNewlyCreatedId(null), 2200)
    }
    window.addEventListener('gnos:item-created', onItemCreated)
    return () => {
      window.removeEventListener('gnos:lib-cmd', onCmd)
      window.removeEventListener('gnos:item-created', onItemCreated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [selectedIds, setSelectedIds] = useState(new Set()) // multi-select
  const [lastSelectedId, setLastSelectedId] = useState(null) // shift-range anchor
  const [bulkColPicker, setBulkColPicker] = useState(false)
  const nbSubFilter = useAppStore(s => s.libSubFilter)
  const setNbSubFilter = useAppStore(s => s.setLibSubFilter)
  const [bookFormatFilter, setBookFormatFilter] = useState('all')

  const fileInputRef   = useRef()
  const audioInputRef  = useRef()

  const books      = library.filter(b => b.type !== 'audio')
  const audiobooks = library.filter(b => b.type === 'audio')

  const [todayMinutes, setTodayMinutes] = useState(0)

  // Load streak data (used by both desktop StreakFooter and mobile header)
  useEffect(() => {
    (async () => {
      const log = await loadReadingLog().catch(() => ({})) || {}
      const today = new Date()
      const todayKey = today.toISOString().slice(0, 10)
      // Last 7 days rolling window — index 0 = 6 days ago, index 6 = today
      const last7 = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        last7.push(!!log[d.toISOString().slice(0, 10)])
      }
      let streak = 0
      for (let i = 0; i < 365; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        if (log[d.toISOString().slice(0, 10)]) streak++
        else if (i > 0) break
      }
      const maxFcStreak = flashcardDecks.reduce((max, d) => Math.max(max, d.streak || 0), 0)
      setStreakDays(Math.max(streak, maxFcStreak))
      setWeekActivity(last7)
      setTodayMinutes(Math.round(log[todayKey] || 0))
    })()
  }, [flashcardDecks])

  // Mobile: handle events from bottom nav bar
  useEffect(() => {
    if (!isMobile) return
    const onAdd = () => setAddOpen(true)
    const onProfile = () => setProfileOpen(true)
    const onProfileClose = () => setProfileOpen(false)
    const onSearchQuery = (e) => setSearch(e.detail || '')
    window.addEventListener('gnos:mobile-add', onAdd)
    window.addEventListener('gnos:mobile-profile', onProfile)
    window.addEventListener('gnos:mobile-profile-close', onProfileClose)
    window.addEventListener('gnos:mobile-search-query', onSearchQuery)
    return () => {
      window.removeEventListener('gnos:mobile-add', onAdd)
      window.removeEventListener('gnos:mobile-profile', onProfile)
      window.removeEventListener('gnos:mobile-profile-close', onProfileClose)
      window.removeEventListener('gnos:mobile-search-query', onSearchQuery)
    }
  }, [isMobile])

  // Broadcast profile open/close state so the bottom nav can swap profile ↔ back button
  useEffect(() => {
    if (!isMobile) return
    window.dispatchEvent(new CustomEvent('gnos:mobile-profile-state', { detail: { open: profileOpen } }))
  }, [profileOpen, isMobile])

  // Pointer-based drag (HTML5 drag API doesn't fire reliably in Tauri/WebKit)
  useEffect(() => {
    function getTargets(x, y) {
      // Use bounding rect detection — reliable in Tauri/WebKit unlike elementFromPoint
      let item = null, col = null
      for (const el of document.querySelectorAll('[data-drag-item]')) {
        const r = el.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { item = el; break }
      }
      for (const el of document.querySelectorAll('[data-collection-id]')) {
        const r = el.getBoundingClientRect()
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { col = el; break }
      }
      return { item, col }
    }
    function onMove(e) {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) {
          d.dragging = true
          setDraggingId(d.id)
          setGhostPos({ x: e.clientX, y: e.clientY })
        }
        return
      }
      setGhostPos({ x: e.clientX, y: e.clientY })
      const { item, col } = getTargets(e.clientX, e.clientY)
      if (col && !(d.type === 'collection' && col.dataset.collectionId === d.id)) {
        dropRef.current = { item: null, col: col.dataset.collectionId }
        setDropId(col.dataset.collectionId)
      } else if (item && item.dataset.dragItem !== d.id) {
        dropRef.current = { item: item.dataset.dragItem, itemType: item.dataset.dragType, col: null }
        setDropId(item.dataset.dragItem)
      } else {
        dropRef.current = null
        setDropId(null)
      }
    }
    function onUp(e) {
      const d = dragRef.current
      const drop = dropRef.current
      dropRef.current = null
      if (!d) { setDraggingId(null); setDropId(null); setGhostPos(null); return }
      dragRef.current = null
      setDraggingId(null); setDropId(null); setGhostPos(null)
      if (!d.dragging || !drop) return
      const store = useAppStore.getState()
      if (d.type === 'collection') {
        // Dragging a collection onto another collection nests it (cycle-guarded in store)
        if (drop.col && drop.col !== d.id) {
          store.moveCollection?.(d.id, drop.col)
          store.persistCollections?.()
        }
      } else if (drop.col && d.id) {
        if (d.fromCol && d.fromCol !== drop.col) {
          // Dragged out of a collection onto another — move, don't copy
          store.removeFromCollection?.(d.fromCol, d.id)
        }
        if (d.fromCol !== drop.col) {
          store.addToCollection?.(drop.col, d.id)
        }
        store.persistCollections?.()
      } else if (drop.item && drop.item !== d.id) {
        const toId = drop.item

        if (d.fromCol) {
          // Reorder within the collection detail view
          store.reorderCollectionItems?.(d.fromCol, d.id, toId)
          store.persistCollections?.()
          return
        }
        const isMainLib = store.activeLibTab === 'library'

        if (isMainLib) {
          // Unified cross-type reorder for the main library tab
          const allIds = [
            ...store.library.map(b => b.id),
            ...store.notebooks.map(n => n.id),
            ...store.sketchbooks.map(s => s.id),
            ...store.flashcardDecks.map(f => f.id),
          ]
          const currentOrder = store.unifiedLibraryOrder?.length > 0
            ? [...store.unifiedLibraryOrder, ...allIds.filter(id => !store.unifiedLibraryOrder.includes(id))]
            : allIds
          const fromIdx = currentOrder.indexOf(d.id)
          const toIdx   = currentOrder.indexOf(toId)
          if (fromIdx !== -1 && toIdx !== -1) {
            const newOrder = [...currentOrder]
            const [moved] = newOrder.splice(fromIdx, 1)
            newOrder.splice(toIdx, 0, moved)
            store.setUnifiedLibraryOrder(newOrder)
            store.persistPreferences?.()
          }
        } else if (drop.itemType === d.type) {
          // Same-type reorder in type-specific tabs (existing behaviour)
          if (d.type === 'book' || d.type === 'audio') {
            const fi = store.library.findIndex(x => x.id === d.id)
            const ti = store.library.findIndex(x => x.id === toId)
            if (fi !== -1 && ti !== -1) { store.reorderLibrary(fi, ti); store.persistLibrary?.() }
          } else if (d.type === 'nb') {
            const tiNotebook   = store.notebooks.findIndex(n => n.id === toId)
            const tiSketchbook = store.sketchbooks.findIndex(s => s.id === toId)
            const tiFlashcard  = store.flashcardDecks.findIndex(fd => fd.id === toId)
            if (d.nbKind === 'notebook' && tiNotebook !== -1) {
              const fi = store.notebooks.findIndex(n => n.id === d.id)
              if (fi !== -1) { store.reorderNotebooks(fi, tiNotebook); store.persistNotebooks?.() }
            } else if (d.nbKind === 'sketchbook' && tiSketchbook !== -1) {
              const fi = store.sketchbooks.findIndex(s => s.id === d.id)
              if (fi !== -1) { store.reorderSketchbooks(fi, tiSketchbook); store.persistSketchbooks?.() }
            } else if (d.nbKind === 'flashcard' && tiFlashcard !== -1) {
              const fi = store.flashcardDecks.findIndex(fd => fd.id === d.id)
              if (fi !== -1) { store.reorderFlashcardDecks(fi, tiFlashcard); store.persistFlashcardDecks?.() }
            }
          }
        }
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [])

  useEffect(() => {
    const handler = async (e) => {
      const { file } = e.detail
      setToast({ message: 'Importing…' })
      const { added, errors } = await importBooks([file])
      for (const book of added) addBook(book)
      if (added.length) await persistLibrary()
      if (errors.length) setToast({ message: errors[0], error: true })
      else if (added.length) setToast({ message: `Added ${added.length} book${added.length > 1 ? 's' : ''}!` })
      setTimeout(() => setToast(null), 2500)
    }
    const editHandler = (e) => {
      const { item } = e.detail
      if (!item) return
      if (item._isNotebook) setEditNb(item)
      else if (item._isSketchbook) setEditSb(item)
      else setEditBook(item)
    }
    window.addEventListener('open-file', handler)
    window.addEventListener('gnos:edit-item', editHandler)
    const keyHandler = (e) => {
      if (e.key === 'Escape') { setSelectedIds(new Set()); setLastSelectedId(null); setBulkColPicker(false) }
    }
    // SideNav can't show LibraryView's own modal state — it dispatches this
    // instead when a book with a missing .epub source (A86) gets opened from
    // the sidebar, same prompt as opening it from the grid.
    const missingBookHandler = (e) => { if (e.detail) setMissingBookPrompt(e.detail) }
    window.addEventListener('open-file', handler)
    window.addEventListener('gnos:edit-item', editHandler)
    window.addEventListener('keydown', keyHandler)
    window.addEventListener('gnos:missing-book-prompt', missingBookHandler)
    return () => {
      window.removeEventListener('open-file', handler)
      window.removeEventListener('gnos:edit-item', editHandler)
      window.removeEventListener('keydown', keyHandler)
      window.removeEventListener('gnos:missing-book-prompt', missingBookHandler)
    }
  }, [addBook, persistLibrary])

  async function handleBookFiles(e) {
    const files = e.target.files
    if (!files?.length) return
    setToast({ message: 'Importing…' })
    const { added, errors } = await importBooks(files)
    for (const book of added) addBook(book)
    if (added.length) await persistLibrary()
    if (errors.length) setToast({ message: errors[0], error: true })
    else if (added.length) setToast({ message: `Added ${added.length} book${added.length > 1 ? 's' : ''}!` })
    else setToast({ message: 'No supported files found (.epub, .pdf)', error: true })
    setTimeout(() => setToast(null), errors.length ? 6000 : 3000)
    e.target.value = ''
  }

  async function handleAudioImport(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    // If multiple files selected, treat as multi-chapter folder audiobook
    if (files.length > 1) {
      setToast({ message: 'Importing audiobook folder…' })
      try {
        const book = await importAudioFolder(e.target.files)
        addBook(book)
        await persistLibrary()
        setToast({ message: `Imported "${book.title}" — ${book.totalChapters} chapters!` })
      } catch (err) {
        setToast({ message: err.message, error: true })
      }
    } else {
      setToast({ message: 'Importing audiobook…' })
      try {
        const book = await importAudioFile(files[0])
        addBook(book)
        await persistLibrary()
        setToast({ message: `Added "${book.title}"!` })
      } catch (err) {
        setToast({ message: err.message, error: true })
      }
    }
    setTimeout(() => setToast(null), 2500)
    e.target.value = ''
  }

  // In split mode PaneContext holds the tabId for this pane.
  // We update that tab's snapshot directly instead of the global view.
  const paneTabId = useContext(PaneContext)

  function openBook(book) {
    if (book.sourceMissing) { setMissingBookPrompt(book); return }
    const newView = book.format === 'pdf' ? 'pdf' : 'reader'
    if (paneTabId) {
      setActiveBook(book)
      useAppStore.getState().updateTab(paneTabId, { view: newView, activeBook: book })
      setView(newView)
    } else {
      navigate({ view: newView, activeBook: book })
    }
  }
  function openAudio(book) {
    if (paneTabId) {
      setActiveAudioBook(book)
      useAppStore.getState().updateTab(paneTabId, { view: 'audio-player', activeAudioBook: book })
      setView('audio-player')
    } else {
      navigate({ view: 'audio-player', activeAudioBook: book })
    }
  }
  function openNotebook(nb) {
    if (paneTabId) {
      setActiveNotebook(nb)
      useAppStore.getState().updateTab(paneTabId, { view: 'notebook', activeNotebook: nb })
      setView('notebook')
    } else {
      navigate({ view: 'notebook', activeNotebook: nb })
    }
  }
  function openSketchbook(sb) {
    if (paneTabId) {
      setActiveSketchbook(sb)
      useAppStore.getState().updateTab(paneTabId, { view: 'sketchbook', activeSketchbook: sb })
      setView('sketchbook')
    } else {
      navigate({ view: 'sketchbook', activeSketchbook: sb })
    }
  }
  function openFlashcardDeck(deck) {
    if (paneTabId) {
      setActiveFlashcardDeck(deck)
      useAppStore.getState().updateTab(paneTabId, { view: 'flashcard', activeFlashcardDeck: deck })
      setView('flashcard')
    } else {
      navigate({ view: 'flashcard', activeFlashcardDeck: deck })
    }
  }

  function openBookInNewTab(book) {
    if (book.sourceMissing) { setMissingBookPrompt(book); return }
    useAppStore.getState().setActiveBook(book)
    openNewTab({ view: book.format === 'pdf' ? 'pdf' : 'reader', activeBook: book })
  }
  function openAudioInNewTab(book) {
    useAppStore.getState().setActiveAudioBook(book)
    openNewTab({ view: 'audio-player', activeAudioBook: book })
  }
  function openNotebookInNewTab(nb) {
    useAppStore.getState().setActiveNotebook(nb)
    openNewTab({ view: 'notebook', activeNotebook: nb })
  }
  function openSketchbookInNewTab(sb) {
    useAppStore.getState().setActiveSketchbook(sb)
    openNewTab({ view: 'sketchbook', activeSketchbook: sb })
  }
  function openFlashcardDeckInNewTab(deck) {
    useAppStore.getState().setActiveFlashcardDeck(deck)
    openNewTab({ view: 'flashcard', activeFlashcardDeck: deck })
  }

  // ── Context-menu icon set — one visual language (16×16, 1.5 stroke, round
  //    caps/joins) matching the titlebar/settings glyphs. Keep any new menu
  //    icon in this family; no mixed stroke weights or square caps. ──────────
  const ICON_BOOK   = '<path d="M13 14.5H5a2 2 0 0 1-2-2V3.5A2 2 0 0 1 5 1.5h8v10H5a1.5 1.5 0 0 0 0 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'
  const ICON_AUDIO  = '<path d="M2.3 6.3h2.1L8 3.1v9.8L4.4 9.7H2.3a.6.6 0 0 1-.6-.6V6.9a.6.6 0 0 1 .6-.6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.7 3.9a6 6 0 0 1 0 8.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_NB     = '<rect x="2.5" y="1.8" width="11" height="12.5" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.2h5M5.5 8h5M5.5 10.8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_SB     = '<path d="M7.2 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V8.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 2.2a1.56 1.56 0 0 1 2.2 2.2L8.4 10.2l-2.7.7.7-2.7L12 2.2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
  const ICON_CARDS  = '<rect x="1.8" y="3" width="10" height="8.5" rx="1.8" stroke="currentColor" stroke-width="1.5"/><path d="M5 14h7.4a1.8 1.8 0 0 0 1.8-1.8V6.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  const ICON_EDIT   = '<path d="M10.8 2.8a1.98 1.98 0 0 1 2.8 2.8l-7.8 7.8-3.6.8.8-3.6 7.8-7.8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.4 4.2l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'
  const ICON_COLLECT= '<path d="M1.8 5A1.2 1.2 0 0 1 3 3.8h3.2l1.6 1.7H13A1.2 1.2 0 0 1 14.2 6.7v5.5a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 8.1v3M6.5 9.6h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_MOVE   = '<path d="M1.8 5A1.2 1.2 0 0 1 3 3.8h3.2l1.6 1.7H13A1.2 1.2 0 0 1 14.2 6.7v5.5a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 9.7h4M8.4 8l1.7 1.7-1.7 1.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
  const ICON_TRASH  = '<path d="M2.5 4.5h11M6.4 4.2v-1A1.2 1.2 0 0 1 7.6 2h.8a1.2 1.2 0 0 1 1.2 1.2v1M3.8 4.8l.6 8a1.5 1.5 0 0 0 1.5 1.4h4.2a1.5 1.5 0 0 0 1.5-1.4l.6-8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.6 7.3v4M9.4 7.3v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'

  const ICON_SEARCH = '<circle cx="6.8" cy="6.8" r="4.3" stroke="currentColor" stroke-width="1.5"/><path d="M10.2 10.2l3.3 3.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
  const ICON_NEWTAB = '<path d="M13.5 8.8v3.7a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h3.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M10.4 2h3.6v3.6M13.7 2.3L8.9 7.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'

  // Build the "Add to Collection" submenu — shared with SideNav.jsx via
  // buildAddToCollectionSubmenu (filters out quicknotes, sorts
  // alphabetically, checkmarks collections the item already belongs to).
  function makeCollectionSubmenu(itemId) {
    return buildAddToCollectionSubmenu({
      collections, itemId,
      onCreateNew: id => {
        const newCol = { id: makeId('col'), name: 'New Collection', items: [id], color: '' }
        addCollection(newCol)
        addToCollection(newCol.id, id)
        persistCollections()
        // Switch to collections tab so user sees it
        setActiveLibTab('collections')
        setView('library')
      },
      onAdd: (colId, id) => { addToCollection(colId, id); persistCollections() },
    })
  }

  function showBookMenu(e, book) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_BOOK,   action: () => openBook(book) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB, action: () => openBookInNewTab(book) },
      { label: 'Edit…',           icon: ICON_EDIT,   action: () => setEditBookMeta(book) },
      {
        label: 'Add to Collection', icon: ICON_COLLECT,
        submenu: makeCollectionSubmenu(book.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('book', book.id, book.title, book)
        removeBook(book.id)
        persistLibrary()
      }},
    ]})
  }
  function showAudioMenu(e, book) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Play',            icon: ICON_AUDIO,  action: () => openAudio(book) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openAudioInNewTab(book) },
      { label: 'Edit…',           icon: ICON_EDIT,   action: () => setEditBook(book) },
      {
        label: 'Add to Collection', icon: ICON_COLLECT,
        submenu: makeCollectionSubmenu(book.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('audio', book.id, book.title, book)
        removeBook(book.id)
        persistLibrary()
      }},
    ]})
  }
  function showNbMenu(e, nb) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_NB,     action: () => openNotebook(nb) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openNotebookInNewTab(nb) },
      { label: 'Edit…',           icon: ICON_EDIT,   action: () => setEditNb(nb) },
      {
        label: 'Add to Collection', icon: ICON_COLLECT,
        submenu: makeCollectionSubmenu(nb.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('notebook', nb.id, nb.title)
        removeNotebook(nb.id)
        useAppStore.getState().persistNotebooks?.()
      }},
    ]})
  }
  function showSbMenu(e, sb) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_SB,     action: () => openSketchbook(sb) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openSketchbookInNewTab(sb) },
      { label: 'Edit…',           icon: ICON_EDIT,   action: () => setEditSb(sb) },
      {
        label: 'Add to Collection', icon: ICON_COLLECT,
        submenu: makeCollectionSubmenu(sb.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('sketchbook', sb.id, sb.title)
        removeSketchbook(sb.id)
        useAppStore.getState().persistSketchbooks?.()
      }},
    ]})
  }

  function showDeckMenu(e, deck) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_CARDS, action: () => openFlashcardDeck(deck) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openFlashcardDeckInNewTab(deck) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => {
        removeDeck(deck.id)
        persistFlashcardDecks()
      }},
    ]})
  }

  function renderAll(tfOverride, colIdOverride) {
    const tf    = tfOverride    ?? typeFilter
    const colId = colIdOverride ?? activeCollectionId

    // Build collection-filtered id set
    let colIds = null
    if (colId) {
      const col = collections.find(c => c.id === colId)
      if (col) {
        const smartIds = col.filter ? (() => {
          const { field, value } = col.filter
          const v = (value || '').toLowerCase()
          const ids = []
          library.forEach(b => {
            if (field === 'format' && v === 'audio' && b.type === 'audio') ids.push(b.id)
            else if (field === 'format' && (b.format || '').toLowerCase() === v) ids.push(b.id)
            else if (field === 'author' && (b.author || '').toLowerCase().includes(v)) ids.push(b.id)
            else if (field === 'type' && (b.type === v || (v === 'book' && b.type !== 'audio'))) ids.push(b.id)
          })
          if (field === 'type' && v === 'notebook') notebooks.forEach(n => ids.push(n.id))
          if (field === 'type' && v === 'sketchbook') sketchbooks.forEach(s => ids.push(s.id))
          if (field === 'type' && v === 'flashcard') flashcardDecks.forEach(d => ids.push(d.id))
          return ids
        })() : []
        colIds = new Set([...col.items, ...smartIds])
      }
    }

    const lib = colIds ? library.filter(b => colIds.has(b.id)) : library
    const nbs = colIds ? notebooks.filter(n => colIds.has(n.id)) : notebooks
    const sbs = colIds ? sketchbooks.filter(s => colIds.has(s.id)) : sketchbooks
    const fds = colIds ? flashcardDecks.filter(d => colIds.has(d.id)) : flashcardDecks

    // Apply type filter. "quicknotes" isn't a real content type (they're
    // just notebooks in the auto-managed `quicknotes` collection) — filters
    // notebooks down to that collection's members instead of showing every
    // notebook, and hides books/audio/sketchbooks/flashcards entirely.
    const showBooks   = tf === 'all' || tf === 'book'
    const showAudio   = tf === 'all' || tf === 'audio'
    const showNb      = tf === 'all' || tf === 'notebook'
    const showSb      = tf === 'all' || tf === 'sketchbook'
    const showFd      = tf === 'all' || tf === 'flashcard'
    const filtLib     = lib.filter(b => b.type === 'audio' ? showAudio : showBooks)
    const filtNbs     = tf === 'quicknotes'
      ? (() => {
          const qnIds = new Set((collections || []).find(c => c.name === 'quicknotes')?.items || [])
          return nbs.filter(n => qnIds.has(n.id))
        })()
      : (showNb ? nbs : [])
    const filtSbs     = showSb ? sbs : []
    const filtFds     = showFd ? fds : []

    if (!filtLib.length && !filtNbs.length && !filtSbs.length && !filtFds.length) return (
      <div className="lib-empty-state" style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
        <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
          <Plus size={28} strokeWidth={2.5} />
        </button>
        <p className="lib-empty-hint">Right-click anywhere to add books,<br/>audiobooks, notebooks, or sketchbooks</p>
        <p className="lib-empty-formats">.epub · .pdf · .mp3 · .m4b</p>
      </div>
    )
    const dragStyle = (id) => ({
      opacity: draggingId === id ? 0.35 : 1,
      outline: dropId === id ? '2px solid var(--accent)' : newlyCreatedId === id ? '2px solid var(--accent)' : 'none',
      boxShadow: dropId === id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : newlyCreatedId === id ? '0 0 0 6px color-mix(in srgb, var(--accent) 22%, transparent)' : 'none',
      outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none',
      transform: dropId === id ? 'scale(0.95)' : 'scale(1)',
      transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s',
    })

    // Build a flat list of all items, then sort by unifiedLibraryOrder if set
    const allEntries = [
      ...filtLib.map(b => ({ item: b, _type: b.type === 'audio' ? 'audio' : 'book' })),
      ...filtNbs.map(n => ({ item: n, _type: 'nb', _kind: 'notebook' })),
      ...filtSbs.map(s => ({ item: s, _type: 'nb', _kind: 'sketchbook' })),
      ...filtFds.map(d => ({ item: d, _type: 'nb', _kind: 'flashcard' })),
    ]
    let ordered
    if (sortBy !== 'manual') {
      // Explicit sort overrides manual drag order while active.
      const dir = sortDir === 'desc' ? -1 : 1
      const keyFor = sortBy === 'name'
        ? (e) => (e.item.title || '').toLowerCase()
        : sortBy === 'created'
        ? (e) => _itemCreatedAt(e.item)
        : (e) => _itemModifiedAt(e.item)
      ordered = [...allEntries].sort((a, b) => {
        const ka = keyFor(a), kb = keyFor(b)
        return ka < kb ? -dir : ka > kb ? dir : 0
      })
    } else if (unifiedLibraryOrder.length) {
      const orderMap = new Map(unifiedLibraryOrder.map((id, i) => [id, i]))
      const inOrder    = allEntries.filter(e => orderMap.has(e.item.id)).sort((a, b) => orderMap.get(a.item.id) - orderMap.get(b.item.id))
      const notInOrder = allEntries.filter(e => !orderMap.has(e.item.id))
      ordered = [...inOrder, ...notInOrder]
    } else {
      ordered = allEntries
    }

    const orderedIds = ordered.map(e => e.item.id)
    // Window: only render up to visibleCount; the grow effect appends the rest
    // at idle. Full list still drives drag/selection ranges (orderedIds above).
    const windowed = ordered.slice(0, visibleCount)

    return windowed.map(({ item, _type, _kind }) => {
      const dragType = _type
      const nbKind   = _kind
      const isSelected = selectedIds.has(item.id)
      const hasSelection = selectedIds.size > 0

      function handleCardPointerDown(e) {
        if (e.button !== 0) return
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey && lastSelectedId && orderedIds.includes(lastSelectedId)) {
            const a = orderedIds.indexOf(lastSelectedId)
            const b = orderedIds.indexOf(item.id)
            const [lo, hi] = a < b ? [a, b] : [b, a]
            const range = new Set(orderedIds.slice(lo, hi + 1))
            setSelectedIds(prev => { const next = new Set(prev); range.forEach(id => next.add(id)); return next })
          } else {
            setSelectedIds(prev => {
              const next = new Set(prev)
              if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
              return next
            })
            setLastSelectedId(item.id)
          }
        } else if (hasSelection && e.target.closest('.book-cover')) {
          // selection active + clicked cover → toggle
          e.preventDefault()
          e.stopPropagation()
          setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
            return next
          })
          setLastSelectedId(item.id)
        } else if (!hasSelection && e.target.closest('.book-cover, .notebook-cover, .audiobook-album-card')) {
          dragRef.current = { idx: 0, type: dragType, id: item.id, title: item.title, nbKind, startX: e.clientX, startY: e.clientY, dragging: false }
        }
      }

      return (
        <div key={item.id}
          data-drag-item={item.id} data-drag-type={dragType}
          onPointerDown={handleCardPointerDown}
          className={isSelected ? 'lib-card-selected' : undefined}
          style={dragStyle(item.id)}>
          {_type === 'audio'       && <AudiobookCard book={item} onOpen={hasSelection ? () => {} : openAudio} onMenu={showAudioMenu} />}
          {_type === 'book'        && <BookCard book={item} onOpen={hasSelection ? () => {} : openBook} onMenu={showBookMenu} />}
          {_kind === 'notebook'    && <NotebookCard nb={item} onOpen={hasSelection ? () => {} : openNotebook} onMenu={showNbMenu} />}
          {_kind === 'sketchbook'  && <SketchbookCard sb={item} onOpen={hasSelection ? () => {} : openSketchbook} onMenu={showSbMenu} />}
          {_kind === 'flashcard'   && <FlashcardDeckCard deck={item} onOpen={hasSelection ? () => {} : openFlashcardDeck} onMenu={showDeckMenu} />}
        </div>
      )
    })
  }

  function renderTab() {
    // Flashcards — decks only, so the sidebar tab is a real destination rather
    // than another view of the unified grid.
    if (activeTab === 'flashcards') {
      return (
        <div className="lib-tab-inner">
          {flashcardDecks.length ? (
            <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : {gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))'}}>
              {flashcardDecks.map((deck, i) => (
                <div key={deck.id}
                  data-drag-item={deck.id} data-drag-type="nb"
                  onPointerDown={e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); dragRef.current = { idx: i, type: 'nb', id: deck.id, title: deck.title, nbKind: 'flashcard', startX: e.clientX, startY: e.clientY, dragging: false } }}
                  style={{ opacity: draggingId === deck.id ? 0.35 : 1, outline: dropId === deck.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === deck.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === deck.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                  <FlashcardDeckCard deck={deck} onOpen={openFlashcardDeck} onMenu={showDeckMenu} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,paddingTop:60,paddingBottom:40}}>
              <button className="lib-empty-plus" onClick={() => {
                const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[Math.floor(flashcardDecks.length % COLORS.length)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                addDeck(deck)
                useAppStore.getState().persistFlashcardDecks?.()
                openFlashcardDeck(deck)
              }}>
                <Plus size={28} strokeWidth={2.5} />
              </button>
              <p className="lib-empty-hint">No flashcard decks yet.<br/>Click + to create one.</p>
              <p className="lib-empty-formats">Spaced repetition · Anki import · study from notes</p>
            </div>
          )}
        </div>
      )
    }
    if (activeTab === 'library' || activeTab === 'books' || activeTab === 'audiobooks' || activeTab === 'notebooks') {
      return (
        <div className="lib-tab-inner">
          <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : {gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))'}}>{renderAll()}</div>
        </div>
      )
    }
    if (activeTab === 'books') {
      const BOOK_FORMAT_FILTERS = [
        { id: 'all',  label: 'All' },
        { id: 'epub', label: 'EPUB' },
        { id: 'pdf',  label: 'PDF' },
        { id: 'txt',  label: 'TXT' },
        { id: 'md',   label: 'Markdown' },
      ]
      const visibleBooks = bookFormatFilter === 'all'
        ? books
        : books.filter(b => {
            const fmt = (b.format || '').toLowerCase()
            if (bookFormatFilter === 'epub') return fmt === 'epub' || fmt === 'epub3'
            return fmt === bookFormatFilter
          })
      return (
        <div className="lib-tab-inner">
          {/* Format filter pills */}
          <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
            {BOOK_FORMAT_FILTERS.map(f => (
              <button key={f.id} onClick={() => setBookFormatFilter(f.id)}
                style={{
                  padding:'4px 12px', borderRadius:14, border:'1px solid',
                  borderColor: bookFormatFilter === f.id ? 'var(--accent)' : 'var(--border)',
                  background: bookFormatFilter === f.id ? 'var(--accent)' : 'none',
                  color: bookFormatFilter === f.id ? '#fff' : 'var(--textDim)',
                  fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                  transition:'all 0.12s',
                }}>{f.label}</button>
            ))}
          </div>
          <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : {gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))'}}>
            {visibleBooks.length ? visibleBooks.map((b, i) => (
              <div key={b.id}
                data-drag-item={b.id} data-drag-type="book"
                onPointerDown={e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); dragRef.current = { idx: i, type: 'book', id: b.id, title: b.title, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === b.id ? 0.35 : 1, outline: dropId === b.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === b.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === b.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                <BookCard book={b} onOpen={openBook} onMenu={showBookMenu} />
              </div>
            )) : null}
          </div>
          {!visibleBooks.length && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,paddingTop:60,paddingBottom:40}}>
              {bookFormatFilter === 'all' ? (
                <>
                  <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
                    <Plus size={28} strokeWidth={2.5} />
                  </button>
                  <p className="lib-empty-hint">Click to add books, or right-click anywhere</p>
                  <p className="lib-empty-formats">.epub · .pdf</p>
                </>
              ) : (
                <>
                  <p className="lib-empty-hint">No {BOOK_FORMAT_FILTERS.find(f=>f.id===bookFormatFilter)?.label} books yet.</p>
                  <button onClick={() => setBookFormatFilter('all')} style={{
                    padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}>Show All</button>
                </>
              )}
            </div>
          )}
        </div>
      )
    }
    if (activeTab === 'audiobooks') {
      return (
        <div className="lib-tab-inner">
          <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : {gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))'}}>
            {audiobooks.length ? audiobooks.map((b, i) => (
              <div key={b.id}
                data-drag-item={b.id} data-drag-type="audio"
                onPointerDown={e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); dragRef.current = { idx: i, type: 'audio', id: b.id, title: b.title, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === b.id ? 0.35 : 1, outline: dropId === b.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === b.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === b.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                <AudiobookCard book={b} onOpen={openAudio} onMenu={showAudioMenu} />
              </div>
            )) : null}
          </div>
          {!audiobooks.length && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              <button className="lib-empty-plus" onClick={() => audioInputRef.current?.click()}>
                <Plus size={28} strokeWidth={2.5} />
              </button>
              <p className="lib-empty-hint">Right-click anywhere to add an audiobook,<br/>or click + above</p>
              <p className="lib-empty-formats">.mp3 · .m4b · .m4a · .wav · .flac</p>
            </div>
          )}
        </div>
      )
    }
    if (activeTab === 'notebooks') {
      const NB_SUB_FILTERS = [
        { id: 'all', label: 'All' },
        { id: 'notebooks', label: 'Notebooks' },
        { id: 'sketchbooks', label: 'Sketchbooks' },
        { id: 'flashcards', label: 'Flashcards' },
      ]
      let combined = []
      if (nbSubFilter === 'all' || nbSubFilter === 'notebooks')
        combined.push(...notebooks.map(nb => ({ ...nb, _kind: 'notebook' })))
      if (nbSubFilter === 'all' || nbSubFilter === 'sketchbooks')
        combined.push(...sketchbooks.map(sb => ({ ...sb, _kind: 'sketchbook' })))
      if (nbSubFilter === 'all' || nbSubFilter === 'flashcards')
        combined.push(...flashcardDecks.map(d => ({ ...d, _kind: 'flashcard' })))
      return (
        <div className="lib-tab-inner">
          {/* Sub-filter pills */}
          <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
            {NB_SUB_FILTERS.map(f => (
              <button key={f.id} onClick={() => setNbSubFilter(f.id)}
                style={{
                  padding:'4px 12px', borderRadius:14, border:'1px solid',
                  borderColor: nbSubFilter === f.id ? 'var(--accent)' : 'var(--border)',
                  background: nbSubFilter === f.id ? 'var(--accent)' : 'none',
                  color: nbSubFilter === f.id ? '#fff' : 'var(--textDim)',
                  fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                  transition:'all 0.12s',
                }}>{f.label}</button>
            ))}
          </div>
          <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : {gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))'}}>
            {combined.length ? combined.map((item, i) => (
              <div key={item.id}
                data-drag-item={item.id} data-drag-type="nb"
                onPointerDown={e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); dragRef.current = { idx: i, type: 'nb', id: item.id, title: item.title, nbKind: item._kind, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === item.id ? 0.35 : 1, outline: dropId === item.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === item.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === item.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                {item._kind === 'sketchbook'
                  ? <SketchbookCard sb={item} onOpen={openSketchbook} onMenu={showSbMenu} />
                  : item._kind === 'flashcard'
                  ? <FlashcardDeckCard deck={item} onOpen={openFlashcardDeck} onMenu={showDeckMenu} />
                  : <NotebookCard nb={item} onOpen={openNotebook} onMenu={showNbMenu} />}
              </div>
            )) : null}
          </div>
          {!combined.length && (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,paddingTop:60,paddingBottom:40}}>
              <button className="lib-empty-plus" onClick={() => setAddOpen(true)}>
                <Plus size={28} strokeWidth={2.5} />
              </button>
              <p className="lib-empty-hint">
                {nbSubFilter !== 'all'
                  ? `No ${nbSubFilter} yet.`
                  : 'Click + to create a notebook, sketchbook, or flashcard deck'}
              </p>
              {nbSubFilter !== 'all' && (
                <button onClick={() => setNbSubFilter('all')} style={{
                  padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>Show All</button>
              )}
              <p className="lib-empty-formats">Markdown · wikilinks · Excalidraw canvas · Flashcards</p>
            </div>
          )}
        </div>
      )
    }
    if (activeTab === 'collections') {
      // Collection detail view — show items inside a collection
      if (activeCollection) {
        const col = collections.find(c => c.id === activeCollection)
        if (!col) { setActiveCollection(null); return null }
        const detailSmartIds = col.filter ? (() => {
          const { field, value } = col.filter
          const v = (value || '').toLowerCase()
          const ids = []
          library.forEach(b => {
            if (field === 'format' && v === 'audio' && b.type === 'audio') ids.push(b.id)
            else if (field === 'format' && (b.format || '').toLowerCase() === v) ids.push(b.id)
            else if (field === 'author' && (b.author || '').toLowerCase().includes(v)) ids.push(b.id)
            else if (field === 'type' && (b.type === v || (v === 'book' && b.type !== 'audio'))) ids.push(b.id)
          })
          if (field === 'type' && v === 'notebook') notebooks.forEach(n => ids.push(n.id))
          if (field === 'type' && v === 'sketchbook') sketchbooks.forEach(s => ids.push(s.id))
          if (field === 'type' && v === 'flashcard') flashcardDecks.forEach(d => ids.push(d.id))
          return ids
        })() : []
        const allDetailIds = [...new Set([...col.items, ...detailSmartIds])]
        // Sort by col.items order so manual drag-reordering persists; smart-filter items follow
        const detailOrderIdx = new Map(allDetailIds.map((id, i) => [id, i]))
        const colItems = [
          ...library.filter(i => allDetailIds.includes(i.id)),
          ...notebooks.filter(n => allDetailIds.includes(n.id)).map(n => ({ ...n, _isNotebook: true })),
          ...sketchbooks.filter(s => allDetailIds.includes(s.id)).map(s => ({ ...s, _isSketchbook: true })),
          ...flashcardDecks.filter(d => allDetailIds.includes(d.id)).map(d => ({ ...d, _isDeck: true })),
        ].sort((a, b) => detailOrderIdx.get(a.id) - detailOrderIdx.get(b.id))
        return (
          <div className="lib-tab-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <button onClick={() => { setActiveCollection(col.parentId || null) }} style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'none', color: 'var(--textDim)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>&larr; Back</button>
              {col.color && <span style={{ width: 14, height: 14, borderRadius: 4, background: col.color, flexShrink: 0 }} />}
              {col.emoji && <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1 }}>{col.emoji}</span>}
              {editColId === col.id ? (
                <input
                  autoFocus
                  value={editColName}
                  onChange={e => setEditColName(e.target.value)}
                  onBlur={() => { if (editColName.trim()) { updateCollection(col.id, { name: editColName.trim() }); persistCollections() } setEditColId(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditColId(null) }}
                  style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', background: 'none', border: '1px solid var(--accent)', borderRadius: 5, padding: '2px 6px', outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
                />
              ) : (
                <span title="Click to rename" onClick={() => { setEditColId(col.id); setEditColName(col.name) }} style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', cursor: 'text' }}>{col.name}</span>
              )}
              <span style={{ fontSize: 11, color: 'var(--textDim)' }}>{colItems.length} item{colItems.length !== 1 ? 's' : ''}</span>
              {col.filter && (
                <span
                  title={`Smart filter: ${col.filter.field} = "${col.filter.value}" — click to edit`}
                  onClick={() => { setSmartFilterOpen(col.id); setSmartFilterField(col.filter.field); setSmartFilterValue(col.filter.value) }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 44%, transparent)', borderRadius: 4, padding: '2px 6px', flexShrink: 0, cursor: 'pointer' }}
                ><Zap size={9} strokeWidth={2.5} />Smart</span>
              )}
              <span style={{ flex: 1 }} />
              {/* All collection settings live behind one menu */}
              <button onClick={e => {
                e.stopPropagation()
                setMenu({ x: e.clientX, y: e.clientY, items: [
                  { label: 'Edit…', icon: ICON_EDIT, action: () => setEditCol(col) },
                  { label: col.description ? 'Edit Description' : 'Add Description', action: () => setEditColDesc(col.description || '') },
                  { label: col.goal ? 'Edit Reading Goal' : 'Set Reading Goal', action: () => setEditColGoal(col.goal || '') },
                  { label: col.filter ? 'Edit Smart Filter' : 'Add Smart Filter', action: () => { setSmartFilterOpen(col.id); setSmartFilterField(col.filter?.field || 'format'); setSmartFilterValue(col.filter?.value || '') } },
                  ...(col.goal ? [{ label: 'Remove Reading Goal', action: () => { updateCollection(col.id, { goal: undefined }); persistCollections() } }] : []),
                  ...(col.filter ? [{ label: 'Remove Smart Filter', action: () => { updateCollection(col.id, { filter: undefined }); persistCollections() } }] : []),
                  { label: 'Delete Collection', danger: true, action: () => { removeCollection(col.id); persistCollections(); setActiveCollection(col.parentId || null) } },
                ]})
              }} style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--border)', background: 'none', color: 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ellipsis size={14} strokeWidth={2} />
              </button>
            </div>

            {/* Description — only visible when set; add via ⋯ menu */}
            {editColDesc !== null ? (
              <textarea
                autoFocus
                value={editColDesc}
                onChange={e => setEditColDesc(e.target.value)}
                onBlur={() => { updateCollection(col.id, { description: editColDesc.trim() || undefined }); persistCollections(); setEditColDesc(null) }}
                onKeyDown={e => { if (e.key === 'Escape') setEditColDesc(null) }}
                placeholder="Add a description…"
                style={{ width: '100%', fontSize: 12, color: 'var(--text)', background: 'var(--surfaceAlt)', border: '1px solid var(--accent)', borderRadius: 6, padding: '6px 8px', outline: 'none', fontFamily: 'inherit', resize: 'vertical', minHeight: 52, boxSizing: 'border-box', marginBottom: 8 }}
              />
            ) : col.description ? (
              <div
                onClick={() => setEditColDesc(col.description || '')}
                title="Click to edit"
                style={{ fontSize: 12, color: 'var(--textDim)', cursor: 'text', padding: '2px 0', marginBottom: 8, lineHeight: 1.5 }}
              >
                {col.description}
              </div>
            ) : null}

            {/* Reading goal — only visible when set; add via ⋯ menu */}
            {(editColGoal !== null || col.goal) && (() => {
              const started = colItems.filter(item =>
                item.type === 'audio' ? (item.listenProgress || 0) > 0
                : !item._isNotebook && !item._isSketchbook && !item._isDeck ? (item.currentChapter || 0) > 0 || (item.currentPage || 0) > 0
                : false
              ).length
              const pct = colItems.length > 0 ? Math.round((started / colItems.length) * 100) : 0
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  {editColGoal !== null ? (
                    <input
                      autoFocus
                      value={editColGoal}
                      onChange={e => setEditColGoal(e.target.value)}
                      onBlur={() => { updateCollection(col.id, { goal: editColGoal.trim() || undefined }); persistCollections(); setEditColGoal(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditColGoal(null) }}
                      placeholder="e.g. Finish these by June"
                      style={{ fontSize: 11, color: 'var(--text)', background: 'none', border: 'none', borderBottom: '1px dashed var(--accent)', outline: 'none', fontFamily: 'inherit', flex: 1, padding: '2px 0' }}
                    />
                  ) : (
                    <span onClick={() => setEditColGoal(col.goal || '')} title="Click to edit" style={{ fontSize: 11, color: 'var(--textDim)', cursor: 'text', flex: 1 }}>{col.goal}</span>
                  )}
                  {colItems.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <div style={{ width: 70, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: '100%', transformOrigin: 'left', transform: `scaleX(${pct / 100})`, background: col.color || 'var(--accent)', borderRadius: 2, transition: 'transform 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--textDim)', minWidth: 26 }}>{pct}%</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Smart filter editor — opened from ⋯ menu or the Smart chip */}
            {smartFilterOpen === col.id && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, padding: '8px 10px', background: 'var(--surfaceAlt)', borderRadius: 8, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--textDim)', flexShrink: 0 }}>Auto-include items where</span>
                <select value={smartFilterField} onChange={e => setSmartFilterField(e.target.value)} style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '2px 6px', fontFamily: 'inherit', cursor: 'pointer' }}>
                  <option value="format">Format (epub/pdf/txt/audio)</option>
                  <option value="author">Author contains</option>
                  <option value="type">Type (book/notebook/audio/sketchbook/flashcard)</option>
                </select>
                <input
                  value={smartFilterValue}
                  onChange={e => setSmartFilterValue(e.target.value)}
                  placeholder={smartFilterField === 'format' ? 'epub' : smartFilterField === 'author' ? 'author name' : 'book'}
                  style={{ fontSize: 11, flex: 1, minWidth: 80, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '3px 7px', fontFamily: 'inherit', outline: 'none' }}
                />
                <button onClick={() => { updateCollection(col.id, { filter: smartFilterValue.trim() ? { field: smartFilterField, value: smartFilterValue.trim() } : undefined }); persistCollections(); setSmartFilterOpen(null) }} style={{ fontSize: 11, fontWeight: 600, background: 'var(--accent)', color: 'var(--bg)', border: 'none', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Apply</button>
                <button onClick={() => setSmartFilterOpen(null)} style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--textDim)', padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Cancel</button>
              </div>
            )}

            {/* Sub-collections */}
            {(() => {
              const subCols = collections.filter(c => c.parentId === col.id)
              if (!subCols.length) return null
              return (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--textDim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Sub-collections</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {subCols.map(sc => (
                      <button key={sc.id} data-collection-id={sc.id} onClick={() => setActiveCollection(sc.id)} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 7, border: dropId === sc.id ? '1px dashed var(--accent)' : `1px solid ${sc.color || 'var(--border)'}`, background: dropId === sc.id ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'none', color: sc.color || 'var(--text)', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {sc.color && <span style={{ width: 7, height: 7, borderRadius: 2, background: sc.color, display: 'inline-block', flexShrink: 0 }} />}
                        {sc.name}
                        <span style={{ color: 'var(--textDim)', fontWeight: 400 }}>({sc.items.length})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })()}

            <div className="library-grid" style={isMobile ? {gridTemplateColumns:'repeat(3,1fr)',gap:'10px'} : { gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
              {colItems.map(item => {
                const dragType = item._isNotebook || item._isSketchbook || item._isDeck ? 'nb' : item.type === 'audio' ? 'audio' : 'book'
                const nbKind = item._isNotebook ? 'notebook' : item._isSketchbook ? 'sketchbook' : item._isDeck ? 'flashcard' : undefined
                return (
                  <div key={item.id}
                    data-drag-item={item.id} data-drag-type={dragType}
                    onPointerDown={e => {
                      if (e.button !== 0) return
                      if (!e.target.closest('.book-cover, .notebook-cover, .audiobook-album-card')) return
                      dragRef.current = { idx: 0, type: dragType, id: item.id, title: item.title, nbKind, fromCol: col.id, startX: e.clientX, startY: e.clientY, dragging: false }
                    }}
                    style={{
                      opacity: draggingId === item.id ? 0.35 : 1,
                      outline: dropId === item.id ? '2px solid var(--accent)' : 'none',
                      boxShadow: dropId === item.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : 'none',
                      outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none',
                      transform: dropId === item.id ? 'scale(0.95)' : 'scale(1)',
                      transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s',
                    }}>
                    {item._isDeck ? <FlashcardDeckCard deck={item} onOpen={openFlashcardDeck} onMenu={showDeckMenu} />
                    : item._isSketchbook ? <SketchbookCard sb={item} onOpen={openSketchbook} onMenu={showSbMenu} />
                    : item._isNotebook ? <NotebookCard nb={item} onOpen={openNotebook} onMenu={showNbMenu} />
                    : item.type === 'audio' ? <AudiobookCard book={item} onOpen={openAudio} onMenu={showAudioMenu} />
                    : <BookCard book={item} onOpen={openBook} onMenu={showBookMenu} />}
                  </div>
                )
              })}
            </div>
            {!colItems.length && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--textDim)', fontSize: 13 }}>
                This collection is empty. Add items using the context menu on any library item.
              </div>
            )}
          </div>
        )
      }
      // Collections grid
      return (
        <div className="lib-tab-inner">
          {collections.length > 0 && (
            <div className="library-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
              {collections.filter(col => !col.parentId).map(col => {
                const smartIds = col.filter ? (() => {
                  const { field, value } = col.filter
                  const v = (value || '').toLowerCase()
                  const ids = []
                  library.forEach(b => {
                    if (field === 'format' && v === 'audio' && b.type === 'audio') ids.push(b.id)
                    else if (field === 'format' && (b.format || '').toLowerCase() === v) ids.push(b.id)
                    else if (field === 'author' && (b.author || '').toLowerCase().includes(v)) ids.push(b.id)
                    else if (field === 'type' && (b.type === v || (v === 'book' && b.type !== 'audio'))) ids.push(b.id)
                  })
                  if (field === 'type' && v === 'notebook') notebooks.forEach(n => ids.push(n.id))
                  if (field === 'type' && v === 'sketchbook') sketchbooks.forEach(s => ids.push(s.id))
                  if (field === 'type' && v === 'flashcard') flashcardDecks.forEach(d => ids.push(d.id))
                  return ids
                })() : []
                const allColIds = [...new Set([...col.items, ...smartIds])]
                const colItems = [...library, ...notebooks.map(n => ({ ...n, _isNotebook: true })), ...sketchbooks.map(s => ({ ...s, _isSketchbook: true })), ...flashcardDecks.map(d => ({ ...d, _isDeck: true }))].filter(i => allColIds.includes(i.id))
                const subCount = collections.filter(c => c.parentId === col.id).length
                const openColMenu = (e) => setMenu({ x: e.clientX, y: e.clientY, items: [
                  // Name + color live in one Edit dialog — no separate Rename /
                  // Change Color entries (was two items + a hex submenu).
                  { label: 'Edit…', icon: ICON_EDIT, action: () => setEditCol(col) },
                  { label: 'Move into', icon: ICON_MOVE,
                    submenu: [
                      { label: '— None (top level)', action: () => { updateCollection(col.id, { parentId: null }); persistCollections() } },
                      { divider: true },
                      ...collections
                        .filter(c => c.id !== col.id && !c.parentId && c.name !== 'quicknotes')
                        .slice().sort((a, b) => a.name.localeCompare(b.name))
                        .map(c => ({
                          label: c.name,
                          iconNode: <CollectionFace col={c} size={13} />,
                          action: () => { updateCollection(col.id, { parentId: c.id }); persistCollections() },
                        })),
                    ],
                  },
                  { label: 'Delete Collection', icon: ICON_TRASH, danger: true, action: () => { removeCollection(col.id); persistCollections() } },
                ]})
                return (
                  <div key={col.id}
                    data-collection-id={col.id}
                    onPointerDown={e => {
                      if (e.button !== 0) return
                      if (e.target.closest('input, button')) return
                      dragRef.current = { idx: 0, type: 'collection', id: col.id, title: col.name, startX: e.clientX, startY: e.clientY, dragging: false }
                    }}
                    onClick={() => setActiveCollection(col.id)}
                    onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openColMenu(e) }}
                    onMouseEnter={e => { const b = e.currentTarget.querySelector('[data-col-menu]'); if (b) b.style.opacity = '1' }}
                    onMouseLeave={e => { const b = e.currentTarget.querySelector('[data-col-menu]'); if (b) b.style.opacity = '0' }}
                    style={{ cursor: 'pointer', userSelect: 'none', opacity: draggingId === col.id ? 0.35 : 1, transition: 'opacity 0.12s' }}
                  >
                    {/* Cover — 4-up mosaic, landscape filing-cabinet proportion */}
                    <div style={{
                      position: 'relative', aspectRatio: '4 / 3', width: '100%', borderRadius: 10, overflow: 'hidden',
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 1,
                      background: 'var(--surfaceAlt)', boxSizing: 'border-box',
                      outline: dropId === col.id ? '2px dashed var(--accent)' : '1px solid var(--border)',
                      outlineOffset: -1,
                      boxShadow: dropId === col.id ? '0 0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)' : '0 2px 10px rgba(0,0,0,0.14)',
                      transform: dropId === col.id ? 'scale(0.96)' : 'scale(1)',
                      transition: 'transform 0.12s, box-shadow 0.12s',
                    }}>
                      {colItems.length > 0 ? [0,1,2,3].map(i => {
                        // inner corners only — outer corners flush to container edge (clipped by overflow:hidden)
                        // order: top-left top-right bottom-right bottom-left
                        const cr = ['0 0 4px 0','0 0 0 4px','0 4px 0 0','4px 0 0 0'][i]
                        const item = colItems[i]
                        if (!item) return <div key={i} style={{ background: 'var(--surfaceAlt)', borderRadius: cr }} />
                        const [, c2] = generateCoverColor(item.title)
                        return item.coverDataUrl
                          ? <img key={i} src={item.coverDataUrl} alt="" draggable="false" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: cr }} />
                          : <div key={i} style={{ position: 'relative', background: c2, borderRadius: cr, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '4px 5px' }}>
                              <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.88)', lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{item.title}</div>
                            </div>
                      }) : (
                        <div style={{ gridColumn: '1 / -1', gridRow: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {col.emoji
                            ? <span style={{ fontSize: 30, opacity: 0.7 }}>{col.emoji}</span>
                            : <Folder size={32} strokeWidth={1.2} color="var(--textDim)" style={{ opacity: 0.35 }} />}
                        </div>
                      )}
                      {/* ⋯ menu — fades in on hover */}
                      <button data-col-menu onClick={e => { e.stopPropagation(); openColMenu(e) }} style={{
                        position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 7,
                        border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--textDim)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: 0, transition: 'opacity 0.12s',
                      }}>
                        <Ellipsis size={13} strokeWidth={2} />
                      </button>
                    </div>
                    {/* Caption — matches book card typography */}
                    <div style={{ marginTop: 7, padding: '0 2px' }}>
                      {editColId === col.id ? (
                        <input
                          autoFocus
                          value={editColName}
                          onChange={e => setEditColName(e.target.value)}
                          onBlur={() => {
                            if (editColName.trim()) { updateCollection(col.id, { name: editColName.trim() }); persistCollections() }
                            setEditColId(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.target.blur() }
                            if (e.key === 'Escape') { setEditColId(null) }
                          }}
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', width: '100%', boxSizing: 'border-box', background: 'none', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 4px', outline: 'none', fontFamily: 'inherit' }}
                        />
                      ) : (
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                          {col.emoji && <span style={{ fontSize: 12, flexShrink: 0 }}>{col.emoji}</span>}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 2, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
                        {colItems.length} item{colItems.length !== 1 ? 's' : ''}
                        {subCount ? ` · ${subCount} sub` : ''}
                        {col.filter ? ' · Smart' : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* New collection tile */}
              <div
                onClick={() => {
                  const newCol = { id: makeId('col'), name: 'New Collection', items: [], createdAt: new Date().toISOString() }
                  addCollection(newCol)
                  persistCollections()
                  setEditColId(newCol.id)
                  setEditColName('New Collection')
                }}
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onMouseEnter={e => { const c = e.currentTarget.firstElementChild; c.style.borderColor = 'var(--accent)'; c.style.color = 'var(--accent)' }}
                onMouseLeave={e => { const c = e.currentTarget.firstElementChild; c.style.borderColor = 'var(--border)'; c.style.color = 'var(--textDim)' }}
              >
                <div style={{
                  aspectRatio: '4 / 3', width: '100%', borderRadius: 10, boxSizing: 'border-box',
                  border: '1.5px dashed var(--border)', color: 'var(--textDim)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 0.12s, color 0.12s',
                }}>
                  <Plus size={22} strokeWidth={2} />
                </div>
                <div style={{ marginTop: 7, padding: '0 2px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
                  New Collection
                </div>
              </div>
            </div>
          )}
          {!collections.length && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              <button className="lib-empty-plus" onClick={() => {
                const col = { id: makeId('col'), name: 'New Collection', items: [], createdAt: new Date().toISOString() }
                addCollection(col)
                persistCollections()
              }}>
                <Plus size={28} strokeWidth={2.5} />
              </button>
              <p className="lib-empty-hint">Create a collection to organize your library</p>
              <p className="lib-empty-formats">Group books, notes, and more</p>
            </div>
          )}
        </div>
      )
    }
  }

  function handleViewClick(e) {
    if (selectedIds.size > 0 && !e.target.closest('.book-cover') && !e.target.closest('.lib-bulk-bar')) {
      setSelectedIds(new Set())
      setLastSelectedId(null)
      setBulkColPicker(false)
    }
  }

  return (
    <div className="view active" style={{ flexDirection: 'column' }} onClick={handleViewClick}>
      <style>{`
        .search-dropdown {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; overflow: hidden;
          box-shadow: 0 12px 32px rgba(0,0,0,0.45); z-index: 9000;
          max-height: 360px; overflow-y: auto;
        }
        /* .search-drop-* rules moved to global.css so the titlebar SearchDropdown
           (mounted outside LibraryView) sizes covers correctly. */
      `}</style>
      {/* Hidden inputs */}
      <input ref={fileInputRef}  type="file" accept=".epub,.epub3,.pdf,application/epub+zip" className="hidden-input" multiple onChange={handleBookFiles} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden-input" multiple onChange={handleAudioImport} />

      {/* Bulk selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="lib-bulk-bar" style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9000, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '10px 16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'bulk-bar-in 0.18s cubic-bezier(0.2, 0.8, 0.3, 1)',
        }}>
          {/* Exponential ease-out, not the old bounce/overshoot curve —
              matches gnos-pop-in's entrance elsewhere in the app. */}
          <style>{`@keyframes bulk-bar-in { from { opacity:0; transform: translateX(-50%) translateY(12px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }`}</style>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', minWidth: 60 }}>
            {selectedIds.size} selected
          </span>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          {/* Add to collection */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setBulkColPicker(v => !v)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 12px', color: 'var(--text)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Archive size={13} strokeWidth={1.3} />
              Add to Collection
            </button>
            {bulkColPicker && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 10, padding: 4, minWidth: 180,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100,
              }}>
                {(collections || [])
                  .filter(c => c.name !== 'quicknotes')
                  .slice().sort((a, b) => a.name.localeCompare(b.name))
                  .map(col => (
                  <button key={col.id} onClick={() => {
                    selectedIds.forEach(id => addToCollection(col.id, id))
                    persistCollections()
                    setBulkColPicker(false)
                    setSelectedIds(new Set())
                    setLastSelectedId(null)
                    setToast({ message: `Added ${selectedIds.size} item${selectedIds.size > 1 ? 's' : ''} to ${col.name}` })
                    setTimeout(() => setToast(null), 2500)
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 10px', background: 'none', border: 'none',
                    color: 'var(--text)', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', borderRadius: 7, textAlign: 'left', fontFamily: 'inherit',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--hover)'}
                    onMouseLeave={e => e.currentTarget.style.background='none'}
                  >
                    <CollectionFace col={col} size={13} />
                    {col.name}
                  </button>
                ))}
                {collections?.filter(c => c.name !== 'quicknotes').length > 0 && <div style={{ height: 1, background: 'var(--borderSubtle)', margin: '4px 8px' }} />}
                <button onClick={() => {
                  const count = selectedIds.size
                  const ids = [...selectedIds]
                  const newCol = { id: makeId('col'), name: 'New Collection', items: ids, color: '', createdAt: new Date().toISOString() }
                  addCollection(newCol)
                  persistCollections()
                  setBulkColPicker(false)
                  setSelectedIds(new Set())
                  setLastSelectedId(null)
                  setToast({ message: `Created collection with ${count} item${count > 1 ? 's' : ''}` })
                  setTimeout(() => setToast(null), 2500)
                }} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 10px', background: 'none', border: 'none',
                  color: 'var(--accent)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', borderRadius: 7, textAlign: 'left', fontFamily: 'inherit',
                }}
                  onMouseEnter={e => e.currentTarget.style.background='var(--hover)'}
                  onMouseLeave={e => e.currentTarget.style.background='none'}
                >
                  <Plus size={12} strokeWidth={1.6} />
                  New Collection
                </button>
              </div>
            )}
          </div>
          {/* Delete */}
          <button onClick={async () => {
            const ids = [...selectedIds]
            for (const id of ids) {
              if (library.find(b => b.id === id)) removeBook(id)
              else if (notebooks.find(n => n.id === id)) removeNotebook(id)
              else if (sketchbooks.find(s => s.id === id)) removeSketchbook(id)
            }
            await persistLibrary()
            await persistNotebooks()
            setSelectedIds(new Set())
            setLastSelectedId(null)
            setToast({ message: `Deleted ${ids.length} item${ids.length > 1 ? 's' : ''}` })
            setTimeout(() => setToast(null), 2500)
          }} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)',
            borderRadius: 8, padding: '6px 12px', color: '#f85149',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Trash2 size={12} strokeWidth={1.3} />
            Delete
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <button onClick={() => { setSelectedIds(new Set()); setLastSelectedId(null); setBulkColPicker(false) }} style={{
            background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer',
            fontSize: 12, padding: '4px 6px', borderRadius: 6,
          }}
            onMouseEnter={e => e.currentTarget.style.color='var(--text)'}
            onMouseLeave={e => e.currentTarget.style.color='var(--textDim)'}
          >Esc</button>
        </div>
      )}

      {/* Per-view header buttons — portal into the titlebar quick-access strip. */}
      <QuickAccess>
        <TypeFilterBtn typeFilter={typeFilter} setTypeFilter={setTypeFilter} />
        <SortFilterBtn sortBy={sortBy} setSortBy={setSortBy} sortDir={sortDir} setSortDir={setSortDir} />
      </QuickAccess>

      {/* Header — search/add/profile/settings live in the title bar and native menu bar now. */}
      <header className="app-header">

        {/* ── Active filter badge ──
             Type filters + Manage Collections now live in the native View
             menu. The collection-name chip that used to live here was cut —
             redundant once the sidebar already shows which collection is
             active (workspace flat-view header row + the footer
             CollectionSwitcher, which also carries the "Home" exit). */}
        {!isMobile && typeFilter !== 'all' && (
          <div style={{ height: 34, borderBottom: '1px solid var(--borderSubtle)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', height: '100%', boxSizing: 'border-box' }}>
              {typeFilter !== 'all' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--textDim)', whiteSpace: 'nowrap' }}>
                    Filter: {{ book: 'Books', audio: 'Audio', notebook: 'Notes', sketchbook: 'Sketches', flashcard: 'Cards', quicknotes: 'Quicknotes' }[typeFilter] || typeFilter}
                  </span>
                  <button onClick={() => setTypeFilter('all')} style={{ width: 14, height: 14, borderRadius: 3, border: 'none', background: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 10, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                </div>
              )}
            </div>
          </div>
        )}

      </header>

      {/* Content */}
      <main className="library-main" onContextMenu={e => {
          if (e.target.closest('.book-card-container, .notebook-card, .audiobook-card')) return
          e.preventDefault()
          setLibMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) })
        }}>

        <div id="library-content" ref={contentRef}>
          <div className="lib-tab-panel active">{renderTab()}</div>
        </div>
      </main>

      {!isMobile && <StreakFooter streakDays={streakDays} weekActivity={weekActivity} todayMinutes={todayMinutes} />}

      {/* Mobile Gnos+streak button — top center, replaces separate gnos title */}
      {isMobile && (
        <div className="mobile-streak-float" onClick={() => setProfileOpen(true)} role="button" tabIndex={0}>
          <span className="mobile-gnos-brand">{profileOpen ? 'Profile' : 'Gnos'}</span>
          {!profileOpen && (
            <div className="mobile-streak-row">
              <div className="mobile-streak-dots">
                {weekActivity.map((active, i) => (
                  <div key={i} className={`mobile-streak-dot${active ? ' filled' : ''}`} />
                ))}
              </div>
              <span className="mobile-streak-text">{streakDays} day{streakDays !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {editNb && (
        <EditItemModal heading="Edit Notebook" item={editNb} fields={['color','image']}
          onClose={() => setEditNb(null)}
          onSave={(changes) => {
            updateNotebook(editNb.id, changes)
            setEditNb(null)
            persistNotebooks().catch(e => console.warn('[Library] persist failed:', e))
          }} />
      )}
      {editSb && (
        <EditItemModal heading="Edit Sketchbook" item={editSb} fields={['image']}
          onClose={() => setEditSb(null)}
          onSave={(changes) => {
            useAppStore.getState().updateSketchbook(editSb.id, changes)
            setEditSb(null)
            persistSketchbooks().catch(e => console.warn('[Library] persist failed:', e))
          }} />
      )}
      {editBook && (
        <EditItemModal heading="Edit Audiobook" item={editBook} fields={['author','color','image']}
          onClose={() => setEditBook(null)}
          onSave={(changes) => {
            updateBook(editBook.id, changes)
            setEditBook(null)
            persistLibrary().catch(e => console.warn('[Library] persist failed:', e))
          }} />
      )}
      {editBookMeta && (
        <EditItemModal heading="Edit Book" item={editBookMeta} fields={['author','rating','tags','description']}
          onClose={() => setEditBookMeta(null)}
          onSave={(changes) => {
            updateBook(editBookMeta.id, changes)
            setEditBookMeta(null)
            persistLibrary().catch(e => console.warn('[Library] persist failed:', e))
          }} />
      )}
      {editCol && (
        <EditItemModal heading="Edit Collection" item={editCol} fields={['color']} colors={COLLECTION_COLORS}
          onClose={() => setEditCol(null)}
          onSave={(changes) => {
            updateCollection(editCol.id, { name: changes.title, color: changes.coverColor || '' })
            persistCollections()
            setEditCol(null)
          }} />
      )}
      {missingBookPrompt && (
        <MissingSourceModal book={missingBookPrompt}
          onClose={() => setMissingBookPrompt(null)}
          onRemove={async () => {
            const book = missingBookPrompt
            setMissingBookPrompt(null)
            const { moveToTrash } = await import('@/lib/storage')
            await moveToTrash('book', book.id, book.title, book)
            removeBook(book.id)
            persistLibrary()
          }} />
      )}
      {libMenu && (
        <AddPopup variant="fixed" x={libMenu.x} y={libMenu.y} onClose={() => setLibMenu(null)}
          onAddBook={() => fileInputRef.current?.click()}
          onAddAudio={() => audioInputRef.current?.click()}
          onNewNotebook={() => {
            const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
            addNotebook(nb); persistNotebooks()
            if (activeCollectionId) { addToCollection(activeCollectionId, nb.id); persistCollections() }
            setActiveNotebook(nb); setView('notebook')
          }}
          onNewSketchbook={() => {
            const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
            const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor(sketchbooks.length % COLORS.length)] }
            addSketchbook(sb); persistSketchbooks()
            if (activeCollectionId) { addToCollection(activeCollectionId, sb.id); persistCollections() }
            setActiveSketchbook(sb); setView('sketchbook')
          }}
          onNewFlashcardDeck={() => {
            const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
            const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[Math.floor(flashcardDecks.length % COLORS.length)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            addDeck(deck); persistFlashcardDecks()
            if (activeCollectionId) { addToCollection(activeCollectionId, deck.id); persistCollections() }
            setActiveFlashcardDeck(deck); setView('flashcard')
          }}
          onNewCollection={() => {
            const col = { id: makeId('col'), name: 'New Collection', items: [], color: COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length], createdAt: new Date().toISOString() }
            addCollection(col)
            persistCollections()
            setActiveLibTab('collections')
            if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'library', activeLibTab: 'collections' })
          }}
        />
      )}
      {/* Add popup — triggered by the empty-library "+", the "open-add"
          command, and the gnos:mobile-add event from the mobile bottom nav.
          Mobile gets a bottom sheet; desktop gets a centered popup (this
          desktop path used to be dead — `addOpen` flipped true with nothing
          rendering for it, since the only consumer here was gated on
          `isMobile` — found while unifying AddPopup for Pass 2). */}
      {addOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setAddOpen(false)}
        >
          <div
            style={isMobile ? { position: 'absolute', bottom: 72, left: 12, right: 12 } : {}}
            onClick={e => e.stopPropagation()}
          >
            <AddPopup
              variant={isMobile ? 'sheet' : 'center'}
              onClose={() => setAddOpen(false)}
              onAddBook={() => fileInputRef.current?.click()}
              onAddAudio={() => audioInputRef.current?.click()}
              onNewNotebook={() => {
                const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
                addNotebook(nb); persistNotebooks()
                if (activeCollectionId) { addToCollection(activeCollectionId, nb.id); persistCollections() }
                setAddOpen(false)
                if (openOnCreate) {
                  setActiveNotebook(nb)
                  if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'notebook', activeNotebook: nb })
                  setView('notebook')
                }
              }}
              onNewSketchbook={() => {
                const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
                const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor(sketchbooks.length % COLORS.length)] }
                addSketchbook(sb); persistSketchbooks()
                if (activeCollectionId) { addToCollection(activeCollectionId, sb.id); persistCollections() }
                setAddOpen(false)
                if (openOnCreate) {
                  setActiveSketchbook(sb)
                  if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'sketchbook', activeSketchbook: sb })
                  setView('sketchbook')
                }
              }}
              onNewFlashcardDeck={() => {
                const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
                const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[Math.floor(flashcardDecks.length % COLORS.length)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                addDeck(deck); persistFlashcardDecks()
                if (activeCollectionId) { addToCollection(activeCollectionId, deck.id); persistCollections() }
                setAddOpen(false)
                if (openOnCreate) {
                  setActiveFlashcardDeck(deck)
                  if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'flashcard', activeFlashcardDeck: deck })
                  setView('flashcard')
                }
              }}
              onNewCollection={() => {
                const col = { id: makeId('col'), name: 'New Collection', items: [], color: COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length], createdAt: new Date().toISOString() }
                addCollection(col); persistCollections(); setActiveLibTab('collections')
                if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'library', activeLibTab: 'collections' })
                setAddOpen(false)
              }}
            />
          </div>
        </div>
      )}

      {/* Mobile search results — floats above the bottom nav bar */}
      {isMobile && search && (
        <div className="mobile-search-results">
          <SearchDropdown
            query={search}
            library={library}
            notebooks={notebooks}
            sketchbooks={sketchbooks}
            flashcardDecks={flashcardDecks}
            onOpenDeck={deck => { openFlashcardDeck(deck); setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
            onOpenBook={book => { openBook(book); setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
            onOpenAudio={book => { openAudio(book); setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
            onOpenNotebook={nb => { openNotebook(nb); setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
            onOpenSketchbook={sb => { openSketchbook(sb); setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
            onDevCommand={cmd => { if (cmd === 'onboarding') setDevOnboardingOpen(true) }}
            onOpenGraph={() => { openNewTab({ view: 'graph' }); setSearch('') }}
            onOpenCalendar={() => { navigate({ view: 'calendar' }); setSearch('') }}
            onOpenKanban={() => { navigate({ view: 'kanban' }); setSearch('') }}
            onReset={async () => { setArchivePath(''); setOnboardingComplete(false); await persistPreferences(); resetBaseDir() }}
            onClose={() => { setSearch(''); window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' })) }}
          />
        </div>
      )}

      <Toast message={toast?.message} error={toast?.error} />
      {settingsOpen && <UniversalSettingsModal onClose={() => setSettingsOpen(false)} />}
      {profileOpen  && <ProfileModal  onClose={() => setProfileOpen(false)} />}
      {devOnboardingOpen && <DevOnboardingPreview onClose={() => setDevOnboardingOpen(false)} />}

      {/* Drag ghost — floats at cursor while reordering */}
      {draggingId && ghostPos && createPortal(
        <div style={{
          position: 'fixed',
          left: ghostPos.x + 14,
          top: ghostPos.y - 18,
          background: 'var(--surface)',
          border: '1.5px solid var(--accent)',
          borderRadius: 8,
          padding: '5px 11px',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text)',
          pointerEvents: 'none',
          zIndex: 99999,
          maxWidth: 160,
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: 0.93,
          transform: 'rotate(1.5deg) scale(1.04)',
          transition: 'none',
        }}>
          {dragRef.current?.title || 'Item'}
        </div>,
        document.body
      )}
    </div>
  )
}