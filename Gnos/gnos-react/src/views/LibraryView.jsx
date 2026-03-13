import { useState, useRef, useEffect } from 'react'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor, makeId } from '@/lib/utils'
import { importBooks, importAudioFile, importAudioFolder } from '@/lib/bookImport'
import Toast from '@/components/ui/Toast'
import { GnosNavButton } from '@/components/SideNav'

const SearchIcon = () => (
  <svg className="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none">
    <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
    <line x1="9.8" y1="9.8" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)
const DotsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
  </svg>
)
const MusicIcon = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
    <path d="M9 18c0 1.66-1.34 3-3 3H4c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1zM22 15c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M9 19V8l13-3v10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)
const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const ProfileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M2.5 13c0-2.485 2.462-4.5 5.5-4.5s5.5 2.015 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

const TABS = [
  { id: 'library',    label: 'Library' },
  { id: 'books',      label: 'Books' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'notebooks',  label: 'Notebooks' },
  { id: 'collections', label: 'Collections' },
]

function BookCard({ book, onOpen, onMenu }) {
  const [c1, c2] = generateCoverColor(book.title)
  const pct = book.totalChapters > 1
    ? Math.round(((book.currentChapter || 0) / (book.totalChapters - 1)) * 100) : 0
  const fmt = (book.format === 'epub' || book.format === 'epub3') ? 'EPUB' : (book.format?.toUpperCase() || 'TXT')
  return (
    <div className="book-card-container">
      <div className="book-cover" style={{ '--c1': c1, '--c2': c2 }} onClick={() => onOpen(book)}>
        {book.coverDataUrl ? <img src={book.coverDataUrl} alt={book.title} /> : <>
          <div className="cover-spine" /><div className="cover-crease" /><div className="cover-edge" />
          <div className="cover-title">{book.title}</div>
          {book.author && <div className="cover-author">{book.author}</div>}
        </>}
        <div className="cover-badge">{fmt}</div>
        {pct > 0 && <div className="cover-prog-bg"><div className="cover-prog-fill" style={{ width: `${pct}%` }} /></div>}
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
        <button className="btn-dots" onClick={e => onMenu(e, book)}><DotsIcon /></button>
      </div>
    </div>
  )
}

function AudiobookCard({ book, onOpen, onMenu }) {
  const [c1, c2] = book.coverColor
    ? [book.coverColor, book.coverColor]
    : generateCoverColor(book.title)
  const pct = book.listenProgress ? Math.round(book.listenProgress * 100) : 0
  return (
    <div className="book-card-container">
      <div className="audio-album-cover" style={{ '--c1': c1, '--c2': c2 }} onClick={() => onOpen(book)}>
        {book.coverDataUrl
          ? <img src={book.coverDataUrl} alt={book.title} />
          : <>
            <div className="audio-album-icon"><MusicIcon /></div>
            <div className="audio-album-text-overlay">
              <div className="audio-album-overlay-title">{book.title}</div>
              {book.author && <div className="audio-album-overlay-artist">{book.author}</div>}
            </div>
          </>}
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
        <button className="btn-dots" onClick={e => onMenu(e, book)}><DotsIcon /></button>
      </div>
    </div>
  )
}

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const safeX = Math.min(x, window.innerWidth - 180)
  const safeY = Math.min(y, window.innerHeight - 120)
  return (
    <div ref={ref} className="card-ctx-menu" style={{
      position: 'fixed', left: safeX, top: safeY, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 4, minWidth: 160,
      boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
    }}>
      {items.map((item, i) => (
        <button key={i} className="lib-ctx-item"
          style={{ width: '100%', ...(item.danger ? { color: '#ef5350' } : {}) }}
          onClick={() => { item.action(); onClose() }}>
          {item.icon && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
            dangerouslySetInnerHTML={{ __html: item.icon }} />}
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AddPopup({ onClose, onAddBook, onAddAudio, onNewNotebook, onNewSketchbook, onNewCollection }) {
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className="add-choice-popup" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0 }}>
      <div className="add-choice-header">Add to Library</div>
      <button className="add-choice-btn" onClick={() => { onAddBook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="9" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="9" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <div className="add-choice-text">
          <span>Import Book</span>
          <small>.epub · .txt · .md · .pdf</small>
        </div>
      </button>
      <button className="add-choice-btn" onClick={() => { onAddAudio(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 18c0 1.66-1.34 3-3 3H4c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1zM22 15c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M9 19V8l13-3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="add-choice-text">
          <span>Import Audiobook</span>
          <small>.mp3 · .m4b · .m4a · .wav · .flac</small>
        </div>
      </button>

      <button className="add-choice-btn" onClick={() => { onNewNotebook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6"/>
          <line x1="7" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="12" x2="17" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="16" x2="12" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <div className="add-choice-text">
          <span>New Notebook</span>
          <small>Markdown · wikilinks · live preview</small>
        </div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewSketchbook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="add-choice-text">
          <span>New Sketchbook</span>
          <small>Excalidraw canvas · draw &amp; diagram</small>
        </div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewCollection(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="7" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M7 7V5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v2" stroke="currentColor" strokeWidth="1.6"/>
          <line x1="12" y1="12" x2="12" y2="16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="10" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
        <div className="add-choice-text">
          <span>New Collection</span>
          <small>Group books, audio &amp; notebooks</small>
        </div>
      </button>
    </div>
  )
}

function StreakFooter() {
  const days = ['M','T','W','T','F','S','S']
  const today = new Date().getDay()
  return (
    <div className="library-footer">
      <div className="streak-section">
        <span className="streak-label">STREAK</span>
        <div className="streak-dots">
          {days.map((d, i) => (
            <div key={i} className={`streak-dot${i < today ? ' filled' : i === today ? ' today-empty' : ''}`} title={d} />
          ))}
        </div>
        <span className="streak-count">0 days</span>
      </div>
    </div>
  )
}


function LibContextMenu({ x, y, onClose, onAddBook, onAddAudio }) {
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className="lib-context-menu" style={{ left: x, top: y }}>
      <button className="lib-ctx-item" onClick={() => { onAddBook(); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Import Book
      </button>
      <button className="lib-ctx-item" onClick={() => { onAddAudio(); onClose() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        Import Audiobook
      </button>
      <button className="lib-ctx-item" onClick={() => { onClose() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
        New Notebook
      </button>
      <button className="lib-ctx-item" onClick={() => { onClose() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M4 4V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.4"/><line x1="8" y1="8" x2="8" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><line x1="6.5" y1="9.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
        New Collection
      </button>
    </div>
  )
}


function EditAudiobookModal({ book, onSave, onClose }) {
  const [title,  setTitle]  = useState(book.title  || '')
  const [author, setAuthor] = useState(book.author || '')
  const COLORS = ['#1a1a2e','#2d1b69','#1b4332','#7f1d1d','#1e3a5f','#3d2b1f','#4a1942','#0f4c75']
  const [color,  setColor]  = useState(book.coverColor || COLORS[0])

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14,
        padding:24, width:320, boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:14, fontWeight:700, marginBottom:16, color:'var(--text)' }}>Edit Audiobook</div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Title</div>
          <input value={title} onChange={e => setTitle(e.target.value)}
            style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)',
              borderRadius:7, padding:'7px 10px', fontSize:13, outline:'none', boxSizing:'border-box' }} />
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Author</div>
          <input value={author} onChange={e => setAuthor(e.target.value)}
            style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)',
              borderRadius:7, padding:'7px 10px', fontSize:13, outline:'none', boxSizing:'border-box' }} />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.06em' }}>Cover Color</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width:28, height:28, borderRadius:6, background:c, border: c === color ? '2px solid var(--accent)' : '2px solid transparent',
                cursor:'pointer', outline: c === color ? '2px solid var(--accent)' : 'none', outlineOffset:1,
              }} />
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'none', border:'1px solid var(--border)', color:'var(--textMuted)',
            borderRadius:7, padding:'7px 16px', fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={() => onSave({ title: title.trim() || book.title, author: author.trim(), coverColor: color })}
            style={{ background:'var(--accent)', border:'none', color:'#fff',
              borderRadius:7, padding:'7px 16px', fontSize:13, cursor:'pointer', fontWeight:600 }}>Save</button>
        </div>
      </div>
    </div>
  )
}

function SearchDropdown({ query, library, notebooks, onOpenBook, onOpenAudio, onOpenNotebook, onClose }) {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const bookResults = library.filter(b => b.title?.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q))
  const nbResults   = notebooks.filter(n => n.title?.toLowerCase().includes(q))
  const all = [...bookResults, ...nbResults.map(n => ({ ...n, _isNb: true }))]
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
        return (
          <button key={item.id} className="search-drop-item" onClick={() => {
            if (isNb) onOpenNotebook(item)
            else if (isAudio) onOpenAudio(item)
            else onOpenBook(item)
            onClose()
          }}>
            <div className="search-drop-cover" style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
              {item.coverDataUrl
                ? <img src={item.coverDataUrl} alt="" style={{ width:'100%',height:'100%',objectFit:'cover',borderRadius:4 }} />
                : <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
                    {isAudio ? 'AUDIO' : isNb ? 'NOTE' : 'BOOK'}
                  </span>
              }
            </div>
            <div className="search-drop-info">
              <div className="search-drop-title">{item.title}</div>
              {item.author && <div className="search-drop-sub">{item.author}</div>}
              {isNb && <div className="search-drop-sub">{item.wordCount || 0} words</div>}
            </div>
            <div className="search-drop-badge">{isAudio ? '♪' : isNb ? '📝' : '📖'}</div>
          </button>
        )
      })}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// NotebookCard — bold title + date top, ruled lines near bottom
// ─────────────────────────────────────────────────────────────────────────────
function NotebookCard({ nb, onOpen, onMenu }) {
  const color = nb.coverColor || '#c0392b'
  const dateStr = nb.updatedAt || nb.createdAt
    ? new Date(nb.updatedAt || nb.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : ''
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(nb)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, nb) }}>
      {/* Cover — same fixed size as book covers */}
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
        {/* Left spine shadow */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
          background:'rgba(0,0,0,0.18)', zIndex:1 }} />

        {/* Title + date — top section */}
        <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#fff',
            lineHeight:1.25, wordBreak:'break-word',
            overflow:'hidden', display:'-webkit-box',
            WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>
            {nb.title}
          </div>
          {dateStr && (
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', marginTop:7, fontWeight:400 }}>
              {dateStr}
            </div>
          )}
        </div>

        {/* Ruled lines — bottom area */}
        <div style={{ position:'relative', padding:'0 12px 16px 16px', display:'flex', flexDirection:'column', gap:8, zIndex:2 }}>
          {[...Array(2)].map((_,i) => (
            <div key={i} style={{ height:1, background:'rgba(255,255,255,0.32)', borderRadius:1 }} />
          ))}
        </div>
      </div>
      {/* Meta */}
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{nb.title}</div>
          {dateStr && <div className="meta-author">{dateStr}</div>}
        </div>
        <button className="btn-dots" onClick={e => { e.stopPropagation(); onMenu(e, nb) }}><DotsIcon /></button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookCard — whiteboard/sketch cover design
// ─────────────────────────────────────────────────────────────────────────────
function SketchbookCard({ sb, onOpen, onMenu }) {
  const color = sb.coverColor || '#1a1a2e'
  const dateStr = sb.updatedAt || sb.createdAt
    ? new Date(sb.updatedAt || sb.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : ''
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(sb)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, sb) }}>
      {/* Cover — same fixed size as book covers */}
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
        {/* Left spine shadow */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
          background:'rgba(0,0,0,0.18)', zIndex:1 }} />

        {/* Title + date — top section */}
        <div style={{ position:'relative', padding:'14px 12px 0 16px', flex:1, zIndex:2 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#fff',
            lineHeight:1.25, wordBreak:'break-word',
            overflow:'hidden', display:'-webkit-box',
            WebkitLineClamp:4, WebkitBoxOrient:'vertical' }}>
            {sb.title}
          </div>
          {dateStr && (
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', marginTop:7, fontWeight:400 }}>
              {dateStr}
            </div>
          )}
        </div>

        {/* Ruled lines — bottom area */}
        <div style={{ position:'relative', padding:'0 12px 16px 16px', display:'flex', flexDirection:'column', gap:8, zIndex:2 }}>
          {[...Array(2)].map((_,i) => (
            <div key={i} style={{ height:1, background:'rgba(255,255,255,0.32)', borderRadius:1 }} />
          ))}
        </div>
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
}
function EditNotebookModal({ nb, onSave, onClose }) {
  const [title, setTitle] = useState(nb.title || '')
  const COLORS = ['#1a1a2e','#0f3460','#1b4332','#4a1942','#7f1d1d','#1e3a5f','#2d2d2d','#1c2b1c','#2a1a0e','#0d2137']
  const [color, setColor] = useState(nb.coverColor || COLORS[0])
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:24,width:320,boxShadow:'0 16px 48px rgba(0,0,0,0.5)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:'var(--text)'}}>Edit Notebook</div>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)}
            style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}} />
        </div>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Cover Color</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {COLORS.map(c=>(
              <button key={c} onClick={()=>setColor(c)} style={{
                width:28,height:28,borderRadius:6,background:c,
                border:c===color?'2px solid var(--accent)':'2px solid transparent',
                cursor:'pointer',outline:c===color?'2px solid var(--accent)':'none',outlineOffset:1
              }}/>
            ))}
          </div>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>onSave({title:title.trim()||nb.title,coverColor:color})}
            style={{background:'var(--accent)',border:'none',color:'#fff',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontWeight:600}}>Save</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingsModal
// ─────────────────────────────────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const [tab, setTab] = useState('theme')

  const themeKey      = useAppStore(s => s.themeKey)
  const customThemes  = useAppStore(s => s.customThemes)
  const highlightWords = useAppStore(s => s.highlightWords)
  const underlineLine  = useAppStore(s => s.underlineLine)
  const ollamaUrl      = useAppStore(s => s.ollamaUrl)
  const ollamaModel    = useAppStore(s => s.ollamaModel)
  const setTheme       = useAppStore(s => s.setTheme)
  const setPref        = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)
  const library        = useAppStore(s => s.library)
  const persistLibrary = useAppStore(s => s.persistLibrary)
  const addBook        = useAppStore(s => s.addBook)

  const fileInputRef   = useRef()
  const themeInputRef  = useRef()
  const importInputRef = useRef()

  const [aiTestResult, setAiTestResult] = useState('')
  const [ollamaUrlVal,   setOllamaUrlVal]   = useState(ollamaUrl)
  const [ollamaModelVal, setOllamaModelVal] = useState(ollamaModel)

  const BUILT_IN_THEMES_LOCAL = {
    dark: { name: 'Dark', bg: '#0d1117', surface: '#161b22', accent: '#388bfd' },
    light: { name: 'Light (Cream)', bg: '#f5f0e8', surface: '#fdfaf4', accent: '#7c6034' },
  }
  const allThemes = { ...BUILT_IN_THEMES_LOCAL, ...customThemes }

  const TABS = [
    { id: 'theme', label: 'Appearance' },
    { id: 'library', label: 'Library' },
    { id: 'accessibility', label: 'Accessibility' },
    { id: 'ai', label: 'AI' },
  ]

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modalStyle = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 14, width: 480, maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  }

  function renderThemeTab() {
    return (
      <div>
        <div className="section-label">THEME</div>
        <div className="radio-list">
          {Object.keys(allThemes).map(k => (
            <label key={k} className={`radio-item${themeKey === k ? ' active' : ''}`}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                borderRadius:8, cursor:'pointer', border: themeKey === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                marginBottom:6, background: themeKey === k ? 'rgba(56,139,253,0.06)' : 'transparent' }}>
              <input type="radio" name="theme" value={k} checked={themeKey === k}
                onChange={() => setTheme(k)} style={{ display:'none' }} />
              <div style={{ display:'flex', gap:4 }}>
                {['bg','surface','accent'].map(p => (
                  <div key={p} className="swatch" style={{
                    width:14, height:14, borderRadius:3,
                    background: allThemes[k][p] || '#888',
                    border: '1px solid rgba(255,255,255,0.1)'
                  }} />
                ))}
              </div>
              <span style={{ fontSize:13, fontWeight:500, color:'var(--text)', flex:1 }}>{allThemes[k].name}</span>
              {k.startsWith('custom_') && <span style={{ fontSize:10, color:'var(--textDim)' }}>Custom</span>}
            </label>
          ))}
        </div>
        <div className="theme-import-box" style={{ marginTop:16 }}>
          <div style={{ fontSize:12, color:'var(--textMuted)', marginBottom:8 }}>
            Import custom theme <strong>.json</strong>
          </div>
          <button className="btn secondary" onClick={() => themeInputRef.current?.click()}>
            Import theme (.json)
          </button>
          <input ref={themeInputRef} type="file" accept=".json" style={{ display:'none' }}
            onChange={async e => {
              const file = e.target.files[0]; if (!file) return
              try {
                const p = JSON.parse(await file.text())
                if (p.name && p.bg && p.text) {
                  const k = `custom_${Date.now()}`
                  const next = { ...customThemes, [k]: p }
                  setPref('customThemes', next)
                  setTheme(k)
                  await persistPreferences()
                }
              } catch { alert('Invalid theme file') }
              e.target.value = ''
            }} />
        </div>
      </div>
    )
  }

  function renderLibraryTab() {
    return (
      <div>
        <div className="section-label">DISCOVER BOOKS</div>
        <a href="https://www.gutenberg.org" target="_blank" rel="noopener" className="gutenberg-btn">
          <span className="gutenberg-btn-icon">📚</span>
          <div className="gutenberg-btn-text">
            <div className="title">Project Gutenberg</div>
            <div className="sub">Free public domain ebooks — 70,000+ titles</div>
          </div>
          <svg className="gutenberg-btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        <a href="https://librivox.org" target="_blank" rel="noopener" className="gutenberg-btn" style={{ marginTop:8 }}>
          <span className="gutenberg-btn-icon">🎧</span>
          <div className="gutenberg-btn-text">
            <div className="title">LibriVox</div>
            <div className="sub">Free public domain audiobooks — 20,000+ titles</div>
          </div>
          <svg className="gutenberg-btn-arrow" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>

        <div className="section-label" style={{ marginTop:18 }}>LIBRARY DATA</div>
        <p style={{ fontSize:13, color:'var(--textMuted)', marginBottom:14, lineHeight:1.6 }}>
          Export your library as <strong>gnos-library.json</strong> to back it up.
        </p>
        <div style={{ display:'flex', gap:10, marginBottom:18 }}>
          <button className="btn secondary" style={{ flex:1, justifyContent:'center' }} onClick={() => {
            const blob = new Blob([JSON.stringify({ _readme: 'Gnos Library', books: library }, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            Object.assign(document.createElement('a'), { href: url, download: 'gnos-library.json' }).click()
            URL.revokeObjectURL(url)
          }}>↓ Export</button>
          <button className="btn primary" style={{ flex:1, justifyContent:'center' }}
            onClick={() => importInputRef.current?.click()}>↑ Import</button>
        </div>
        <div className="section-label">ADD BOOKS</div>
        <div style={{ display:'flex', gap:10, marginTop:8 }}>
          <button className="btn primary" style={{ flex:1, justifyContent:'center' }}
            onClick={() => fileInputRef.current?.click()}>+ Add Books</button>
        </div>
        <input ref={fileInputRef} type="file" accept=".epub,.txt,.md,.pdf" multiple style={{ display:'none' }}
          onChange={async e => {
            const { importBooks } = await import('@/lib/bookImport')
            const { added } = await importBooks(e.target.files)
            for (const book of added) addBook(book)
            if (added.length) await persistLibrary()
            e.target.value = ''
          }} />
        <input ref={importInputRef} type="file" accept=".json" style={{ display:'none' }}
          onChange={async e => {
            const file = e.target.files[0]; if (!file) return
            try {
              const d = JSON.parse(await file.text())
              if (Array.isArray(d.books)) {
                const ids = new Set(library.map(b => b.id))
                d.books.filter(b => !ids.has(b.id)).forEach(b => addBook(b))
                await persistLibrary()
              }
            } catch { alert('Invalid library file') }
            e.target.value = ''
          }} />
      </div>
    )
  }

  function renderAccessibilityTab() {
    const Row = ({ label, sub, active, onToggle }) => (
      <div className="accessibility-row" style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'12px 0', borderBottom:'1px solid var(--borderSubtle)' }}>
        <div>
          <div className="accessibility-label" style={{ fontSize:13, fontWeight:600, color:'var(--text)', marginBottom:3 }}>{label}</div>
          <div className="accessibility-sub" style={{ fontSize:12, color:'var(--textDim)' }}>{sub}</div>
        </div>
        <div onClick={onToggle} style={{
          width:36, height:20, borderRadius:10, cursor:'pointer', flexShrink:0, marginLeft:16,
          background: active ? 'var(--accent)' : 'var(--surfaceAlt)',
          border: '1px solid var(--border)', position:'relative', transition:'background 0.2s'
        }}>
          <div style={{
            position:'absolute', top:2, left: active ? 16 : 2,
            width:14, height:14, borderRadius:7, background:'var(--text)',
            transition:'left 0.2s',
          }} />
        </div>
      </div>
    )
    return (
      <div>
        <p style={{ fontSize:12, color:'var(--textMuted)', marginBottom:16, lineHeight:1.6 }}>
          These settings apply in the reader and help improve reading comfort.
        </p>
        <Row label="Highlight words on hover" sub="Highlights individual words when you hover over them."
          active={highlightWords} onToggle={async () => { setPref('highlightWords', !highlightWords); await persistPreferences() }} />
        <Row label="Underline current line" sub="Underlines the line you're hovering over to help focus."
          active={underlineLine} onToggle={async () => { setPref('underlineLine', !underlineLine); await persistPreferences() }} />
      </div>
    )
  }

  function renderAITab() {
    return (
      <div>
        <div className="section-label">AI ASSISTANT</div>
        <p style={{ fontSize:12, color:'var(--textMuted)', marginBottom:16, lineHeight:1.6 }}>
          Connect a local Ollama instance for AI-powered text summarization.
        </p>
        <label style={{ display:'block', marginBottom:14, fontSize:12 }}>
          <div style={{ marginBottom:5, fontWeight:600, color:'var(--text)' }}>Ollama Server URL</div>
          <input type="text" placeholder="http://localhost:11434" value={ollamaUrlVal}
            onChange={e => setOllamaUrlVal(e.target.value)}
            style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)',
              borderRadius:6, padding:'8px 10px', fontSize:12, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }} />
        </label>
        <label style={{ display:'block', marginBottom:14, fontSize:12 }}>
          <div style={{ marginBottom:5, fontWeight:600, color:'var(--text)' }}>Model Name</div>
          <input type="text" placeholder="llama3, mistral, phi3…" value={ollamaModelVal}
            onChange={e => setOllamaModelVal(e.target.value)}
            style={{ width:'100%', background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)',
              borderRadius:6, padding:'8px 10px', fontSize:12, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }} />
        </label>
        <div style={{ display:'flex', gap:10, marginTop:6 }}>
          <button className="btn primary" style={{ flex:1, justifyContent:'center' }} onClick={async () => {
            setPref('ollamaUrl', ollamaUrlVal.trim().replace(/\/$/, ''))
            setPref('ollamaModel', ollamaModelVal.trim())
            await persistPreferences()
            setAiTestResult('')
          }}>Save Settings</button>
          <button className="btn secondary" style={{ flex:1, justifyContent:'center' }} onClick={async () => {
            setAiTestResult('Testing connection…')
            const url = (ollamaUrlVal.trim() || 'http://localhost:11434').replace(/\/$/, '')
            const model = ollamaModelVal.trim() || 'llama3'
            try {
              const r = await fetch(`${url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: 'Say: OK', stream: false }),
              })
              setAiTestResult(r.ok ? '✓ Connected successfully!' : `✗ Server returned ${r.status}`)
            } catch (err) {
              setAiTestResult(`✗ Could not connect: ${err.message}`)
            }
          }}>Test Connection</button>
        </div>
        {aiTestResult && (
          <div style={{ marginTop:12, fontSize:12, color: aiTestResult.startsWith('✓') ? '#3fb950' : aiTestResult.startsWith('✗') ? '#f85149' : 'var(--textDim)' }}>
            {aiTestResult}
          </div>
        )}
        <div style={{ marginTop:20, paddingTop:16, borderTop:'1px solid var(--borderSubtle)' }}>
          <div className="section-label">CURRENT AI SOURCE</div>
          <div style={{ fontSize:12, color:'var(--textMuted)', padding:'10px 12px',
            background:'var(--surfaceAlt)', borderRadius:7, border:'1px solid var(--border)' }}>
            {ollamaUrl
              ? <><span style={{ color:'#3fb950' }}>●</span> Ollama at <strong style={{ color:'var(--accent)' }}>{ollamaUrl}</strong>{ollamaModel ? ` using ${ollamaModel}` : ' (no model set)'}</>
              : <><span style={{ color:'#f85149' }}>○</span> <strong style={{ color:'var(--textMuted)' }}>No local LLM configured.</strong></>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 20px 0', flexShrink:0 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:'var(--text)' }}>Settings</h2>
          <button className="btn-close" onClick={onClose} style={{ background:'none', border:'none',
            fontSize:18, cursor:'pointer', color:'var(--textMuted)', lineHeight:1, padding:'2px 6px' }}>×</button>
        </div>
        <div className="modal-tabs" style={{ display:'flex', gap:2, padding:'12px 20px 0', flexShrink:0,
          borderBottom:'1px solid var(--borderSubtle)' }}>
          {TABS.map(t => (
            <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              style={{ padding:'7px 14px', fontSize:12, fontWeight:600, background:'none', border:'none',
                cursor:'pointer', borderRadius:'7px 7px 0 0', marginBottom:-1,
                color: tab === t.id ? 'var(--accent)' : 'var(--textMuted)',
                borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="modal-body" style={{ overflowY:'auto', padding:'18px 20px 20px', flex:1 }}>
          {tab === 'theme'         && renderThemeTab()}
          {tab === 'library'       && renderLibraryTab()}
          {tab === 'accessibility' && renderAccessibilityTab()}
          {tab === 'ai'            && renderAITab()}
        </div>
      </div>
    </div>
  )
}

function ProfileStatCard({ value, label }) {
  return (
    <div className="profile-stat-card" style={{ background:'var(--surfaceAlt)', borderRadius:10, padding:'12px 14px',
      textAlign:'center', border:'1px solid var(--borderSubtle)' }}>
      <div className="profile-stat-value" style={{ fontSize:22, fontWeight:700, color:'var(--text)', lineHeight:1 }}>{value}</div>
      <div className="profile-stat-label" style={{ fontSize:11, color:'var(--textDim)', marginTop:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>{label}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ProfileModal
// ─────────────────────────────────────────────────────────────────────────────
function ProfileModal({ onClose }) {
  const library = useAppStore(s => s.library)

  // Reading log: stored in window.storage under 'reading_log'
  const [log, setLog] = useState({})

  useEffect(() => {
    window.storage?.get('reading_log').then(r => r && setLog(JSON.parse(r.value))).catch(() => {})
  }, [])

  const todayKey = () => new Date().toISOString().slice(0, 10)

  const totalMinutes = Object.values(log).reduce((a, b) => a + b, 0)
  const dayCount = Object.keys(log).length
  const avgDaily = dayCount > 0 ? totalMinutes / dayCount : 0
  const todayMins = Math.round(log[todayKey()] || 0)
  const booksFinished = library.filter(b => (b.currentChapter || 0) >= Math.max((b.totalChapters || 1) - 1, 1)).length

  // Streak
  let streak = 0
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    if ((log[k] || 0) >= 1) streak++; else break
  }

  // Heatmap: last 84 days (12 weeks)
  const heatmapDays = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const k = d.toISOString().slice(0, 10)
    const mins = log[k] || 0
    const level = mins === 0 ? 0 : mins < 10 ? 1 : mins < 30 ? 2 : mins < 60 ? 3 : 4
    heatmapDays.push({ k, mins, level })
  }

  // Top books by chapters read
  const topBooks = library.map(b => ({ ...b, chaptersRead: b.currentChapter || 0 }))
    .sort((a, b) => b.chaptersRead - a.chaptersRead).slice(0, 5)

  const heatColors = ['var(--surfaceAlt)', 'rgba(56,139,253,0.25)', 'rgba(56,139,253,0.5)', 'rgba(56,139,253,0.75)', 'var(--accent)']

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:2000,
      display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14,
        width:480, maxWidth:'calc(100vw - 32px)', maxHeight:'calc(100vh - 64px)', display:'flex',
        flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.6)' }} onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'16px 20px 0', flexShrink:0 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:'var(--text)' }}>Reading Profile</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:18,
            cursor:'pointer', color:'var(--textMuted)', lineHeight:1, padding:'2px 6px' }}>×</button>
        </div>

        <div style={{ overflowY:'auto', padding:'16px 20px 24px', flex:1 }}>

          {/* Stats grid */}
          <div className="profile-stats-grid" style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:20 }}>
            <ProfileStatCard value={streak}                                   label="Day Streak" />
            <ProfileStatCard value={Math.round(avgDaily)}                     label="Avg Min / Day" />
            <ProfileStatCard value={todayMins}                                label="Min Today" />
            <ProfileStatCard value={booksFinished}                            label="Finished" />
            <ProfileStatCard value={Math.round(totalMinutes)}                 label="Total Min" />
            <ProfileStatCard value={Math.round(totalMinutes / 60 * 10) / 10} label="Hours Read" />
          </div>

          {/* Heatmap */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--textMuted)', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:8 }}>Reading Activity — Last 12 Weeks</div>
          <div className="heatmap-grid" style={{ display:'grid', gridTemplateColumns:'repeat(12, 1fr)', gap:3, marginBottom:6 }}>
            {heatmapDays.map((d, i) => (
              <div key={i} title={`${d.k}: ${Math.round(d.mins)} min`}
                style={{ height:10, borderRadius:2,
                  background: heatColors[d.level],
                  border: d.level === 0 ? '1px solid var(--borderSubtle)' : 'none' }} />
            ))}
          </div>
          <div className="heatmap-legend" style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'var(--textDim)', marginBottom:20 }}>
            <span>Less</span>
            {heatColors.map((c, i) => (
              <div key={i} style={{ width:10, height:10, borderRadius:2, background:c,
                border: i === 0 ? '1px solid var(--borderSubtle)' : 'none' }} />
            ))}
            <span>More</span>
          </div>

          {/* Top books */}
          <div style={{ fontSize:12, fontWeight:700, color:'var(--textMuted)', textTransform:'uppercase',
            letterSpacing:'0.07em', marginBottom:12 }}>Most Read Books</div>
          {topBooks.length === 0
            ? <div style={{ color:'var(--textDim)', fontSize:13 }}>No reading data yet.</div>
            : topBooks.map((b, i) => {
                const [c1, c2] = generateCoverColor(b.title)
                const progressPct = b.totalChapters > 1
                  ? Math.round((b.chaptersRead / (b.totalChapters - 1)) * 100) : 0
                return (
                  <div key={b.id} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                    <span style={{ fontSize:11, color:'var(--textDim)', width:14, textAlign:'right', flexShrink:0 }}>{i+1}</span>
                    <div style={{ width:28, height:38, borderRadius:4, overflow:'hidden', flexShrink:0,
                      background:`linear-gradient(135deg,${c1},${c2})` }}>
                      {b.coverDataUrl && <img src={b.coverDataUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap',
                        overflow:'hidden', textOverflow:'ellipsis' }}>{b.title}</div>
                      <div style={{ fontSize:11, color:'var(--textDim)', marginTop:1 }}>
                        Ch {b.chaptersRead} / {b.totalChapters}
                      </div>
                    </div>
                    <div style={{ width:60, flexShrink:0 }}>
                      <div style={{ height:4, background:'var(--surfaceAlt)', borderRadius:2, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${progressPct}%`, background:'var(--accent)', borderRadius:2 }} />
                      </div>
                      <div style={{ fontSize:9, color:'var(--textDim)', textAlign:'right', marginTop:2 }}>{progressPct}%</div>
                    </div>
                  </div>
                )
              })}
        </div>
      </div>
    </div>
  )
}

export default function LibraryView() {
  const library   = useAppStore(s => s.library)
  const notebooks = useAppStore(s => s.notebooks)
  const sketchbooks = useAppStore(s => s.sketchbooks)
  const setView   = useAppStore(s => s.setView)
  const setActiveBook      = useAppStore(s => s.setActiveBook)
  const setActiveNotebook  = useAppStore(s => s.setActiveNotebook)
  const setActiveAudioBook = useAppStore(s => s.setActiveAudioBook)
  const setActiveSketchbook = useAppStore(s => s.setActiveSketchbook)
  const removeBook      = useAppStore(s => s.removeBook)
  const removeNotebook  = useAppStore(s => s.removeNotebook)
  const removeSketchbook = useAppStore(s => s.removeSketchbook)
  const addBook         = useAppStore(s => s.addBook)
  const persistLibrary  = useAppStore(s => s.persistLibrary)
  const updateBook      = useAppStore(s => s.updateBook)
  const addNotebook      = useAppStore(s => s.addNotebook)
  const updateNotebook   = useAppStore(s => s.updateNotebook)
  const persistNotebooks = useAppStore(s => s.persistNotebooks)
  const addSketchbook    = useAppStore(s => s.addSketchbook)
  const persistSketchbooks = useAppStore(s => s.persistSketchbooks)
  const activeTab = useAppStore(s => s.activeLibTab)

  const [search,     setSearch]     = useState('')
  const [addOpen,    setAddOpen]    = useState(false)
  const [menu,       setMenu]       = useState(null)
  const [libMenu,    setLibMenu]    = useState(null)
  const [editBook,   setEditBook]   = useState(null)
  const [editNb,     setEditNb]     = useState(null)
  const [editSb,     setEditSb]     = useState(null)
  const [toast,      setToast]      = useState(null) // { message, error }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)

  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef()

  const fileInputRef   = useRef()
  const audioInputRef  = useRef()

  const books      = library.filter(b => b.type !== 'audio')
  const audiobooks = library.filter(b => b.type === 'audio')


  async function handleBookFiles(e) {
    const files = e.target.files
    if (!files?.length) return
    setToast({ message: 'Importing…' })
    const { added, errors } = await importBooks(files)
    for (const book of added) addBook(book)
    if (added.length) await persistLibrary()
    if (errors.length) setToast({ message: errors[0], error: true })
    else if (added.length) setToast({ message: `Added ${added.length} book${added.length > 1 ? 's' : ''}!` })
    setTimeout(() => setToast(null), 2500)
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

  function openBook(book) {
    setActiveBook(book)
    setView(book.format === 'pdf' ? 'pdf' : 'reader')
  }
  function openAudio(book)      { setActiveAudioBook(book); setView('audio-player') }
  function openNotebook(nb)     { setActiveNotebook(nb);    setView('notebook') }
  function openSketchbook(sb)   { setActiveSketchbook(sb);  setView('sketchbook') }

  const ICON_BOOK   = '<path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
  const ICON_AUDIO  = '<path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_NB     = '<rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  const ICON_TRASH  = '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'

  function showBookMenu(e, book) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',   icon: ICON_BOOK,  action: () => openBook(book) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => removeBook(book.id) },
    ]})
  }
  function showAudioMenu(e, book) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Play',   icon: ICON_AUDIO, action: () => openAudio(book) },
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditBook(book) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => removeBook(book.id) },
    ]})
  }
  function showNbMenu(e, nb) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',   icon: ICON_NB,    action: () => openNotebook(nb) },
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditNb(nb) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => removeNotebook(nb.id) },
    ]})
  }
  const ICON_SKETCH = '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
  function showSbMenu(e, sb) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',   icon: ICON_SKETCH, action: () => openSketchbook(sb) },
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditSb(sb) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { deleteSketchbookContent } = await import('@/lib/storage')
        await deleteSketchbookContent(sb.id)
        removeSketchbook(sb.id)
        useAppStore.getState().persistSketchbooks?.()
      }},
    ]})
  }

  function renderAll() {
    const lib = library
    const nbs = notebooks
    const sbs = sketchbooks
    if (!lib.length && !nbs.length && !sbs.length) return (
      <div className="lib-empty-state">
        <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
        </button>
        <p className="lib-empty-hint">Right-click anywhere to add books,<br/>audiobooks, notebooks, or sketchbooks</p>
        <p className="lib-empty-formats">.epub · .txt · .md · .pdf · .mp3 · .m4b</p>
      </div>
    )
    return [
      ...lib.map(b => b.type === 'audio'
        ? <AudiobookCard key={b.id} book={b} onOpen={openAudio} onMenu={showAudioMenu} />
        : <BookCard key={b.id} book={b} onOpen={openBook} onMenu={showBookMenu} />
      ),
      ...nbs.map(nb => (
        <NotebookCard key={nb.id} nb={nb} onOpen={openNotebook} onMenu={showNbMenu} />
      )),
      ...sbs.map(sb => (
        <SketchbookCard key={sb.id} sb={sb} onOpen={openSketchbook} onMenu={showSbMenu} />
      )),
    ]
  }

  function renderTab() {
    if (activeTab === 'library') {
      return <div className="library-grid">{renderAll()}</div>
    }
    if (activeTab === 'books') {
      return <div className="library-grid">
        {books.length ? books.map(b => <BookCard key={b.id} book={b} onOpen={openBook} onMenu={showBookMenu} />)
          : <div className="lib-empty-state">
            <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </button>
            <p className="lib-empty-hint">Click to add books, or right-click anywhere</p>
            <p className="lib-empty-formats">.epub · .txt · .md · .pdf</p>
          </div>}
      </div>
    }
    if (activeTab === 'audiobooks') {
      return <div className="library-grid">
        {audiobooks.length ? audiobooks.map(b => <AudiobookCard key={b.id} book={b} onOpen={openAudio} onMenu={showAudioMenu} />)
          : <div className="lib-empty-state">
            <button className="lib-empty-plus" onClick={() => audioInputRef.current?.click()}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </button>
            <p className="lib-empty-hint">Right-click anywhere to add an audiobook,<br/>or click + above</p>
            <p className="lib-empty-formats">.mp3 · .m4b · .m4a · .wav · .flac</p>
          </div>}
      </div>
    }
    if (activeTab === 'notebooks') {
      const combined = [
        ...notebooks.map(nb => ({ ...nb, _kind: 'notebook' })),
        ...sketchbooks.map(sb => ({ ...sb, _kind: 'sketchbook' })),
      ]
      return <div className="library-grid">
        {combined.length ? combined.map(item =>
          item._kind === 'sketchbook'
            ? <SketchbookCard key={item.id} sb={item} onOpen={openSketchbook} onMenu={showSbMenu} />
            : <NotebookCard   key={item.id} nb={item} onOpen={openNotebook}   onMenu={showNbMenu} />
        ) : <div className="lib-empty-state">
            <button className="lib-empty-plus" onClick={() => setAddOpen(true)}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </button>
            <p className="lib-empty-hint">Click + to create a notebook or sketchbook</p>
            <p className="lib-empty-formats">Markdown · wikilinks · Excalidraw canvas</p>
          </div>}
      </div>
    }
  }

  return (
    <div className="view active" style={{ flexDirection: 'column' }}>
      <style>{`
        .search-dropdown {
          position: absolute; top: calc(100% + 6px); left: 0; right: 0;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 10px; overflow: hidden;
          box-shadow: 0 12px 32px rgba(0,0,0,0.45); z-index: 9000;
          max-height: 360px; overflow-y: auto;
        }
        .search-drop-item {
          display: flex; align-items: center; gap: 10px;
          width: 100%; padding: 9px 12px; border: none; background: none;
          color: var(--text); cursor: pointer; text-align: left;
          transition: background 0.12s;
        }
        .search-drop-item:hover { background: var(--hover); }
        .search-drop-cover {
          width: 36px; height: 50px; border-radius: 4px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .search-drop-info { flex: 1; min-width: 0; }
        .search-drop-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-drop-sub { font-size: 11px; color: var(--textDim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .search-drop-badge { font-size: 14px; flex-shrink: 0; opacity: 0.6; }
      `}</style>
      {/* Hidden inputs */}
      <input ref={fileInputRef}  type="file" accept=".epub,.txt,.md,.pdf" className="hidden-input" multiple onChange={handleBookFiles} />
      <input ref={audioInputRef} type="file" accept="audio/*" className="hidden-input" multiple onChange={handleAudioImport} />

      {/* Header */}
      <header className="app-header">
        <div className="app-header-top">

          {/* Gnos logo area */}
          <div className="lib-logo-area">
            <GnosNavButton />
          </div>

          {/* Search + Add */}
          <div className="lib-search-row">
            <div className="search-bar-wrapper" ref={searchRef} style={{ position: 'relative' }}>
              <div className="search-bar">
                <SearchIcon />
                <input type="text" placeholder="Search library…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 150)} />
                {search && <span className="search-shortcut" style={{ cursor:'pointer' }} onClick={() => setSearch('')}>✕</span>}
              </div>
              {searchFocused && search && (
                <SearchDropdown
                  query={search}
                  library={library}
                  notebooks={notebooks}
                  onOpenBook={openBook}
                  onOpenAudio={openAudio}
                  onOpenNotebook={openNotebook}
                  onClose={() => { setSearch(''); setSearchFocused(false) }}
                />
              )}
            </div>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button className="btn-add-square" onClick={() => setAddOpen(o => !o)} title="Add"><PlusIcon /></button>
              {addOpen && (
                <AddPopup
                  onClose={() => setAddOpen(false)}
                  onAddBook={() => fileInputRef.current?.click()}
                  onAddAudio={() => audioInputRef.current?.click()}
                  onNewNotebook={() => {
                    const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
                    addNotebook(nb)
                    persistNotebooks()
                    setActiveNotebook(nb)
                    setView('notebook')
                    setAddOpen(false)
                  }}
                  onNewSketchbook={() => {
                    const COLORS = ['#1a1a2e','#0f3460','#1b4332','#4a1942','#7f1d1d','#1e3a5f','#2d2d2d','#3d2b1f']
                    const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor(sketchbooks.length % COLORS.length)] }
                    addSketchbook(sb)
                    persistSketchbooks()
                    setActiveSketchbook(sb)
                    setView('sketchbook')
                    setAddOpen(false)
                  }}
                  onNewCollection={() => setAddOpen(false)}
                />
              )}
            </div>
          </div>

          {/* Settings + Profile */}
          <div className="header-right-actions">
            <button className="btn-icon-round" title="Profile" onClick={() => setProfileOpen(true)}><ProfileIcon /></button>
            <button className="btn-icon-round" title="Settings" onClick={() => setSettingsOpen(true)}><SettingsIcon /></button>
          </div>

        </div>
      </header>

      {/* Content */}
      <main className="library-main" onContextMenu={e => {
          if (e.target.closest('.book-card-container, .notebook-card, .audiobook-card')) return
          e.preventDefault()
          setLibMenu({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) })
        }}>
        <div id="library-content">
          <div className="lib-tab-panel active">{renderTab()}</div>
        </div>
      </main>

      <StreakFooter />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {editNb && (
        <EditNotebookModal nb={editNb} onClose={() => setEditNb(null)}
          onSave={async (changes) => {
            updateNotebook(editNb.id, changes)
            await persistNotebooks()
            setEditNb(null)
          }} />
      )}
      {editSb && (
        <EditNotebookModal nb={editSb} onClose={() => setEditSb(null)}
          onSave={async (changes) => {
            useAppStore.getState().updateSketchbook(editSb.id, changes)
            await persistSketchbooks()
            setEditSb(null)
          }} />
      )}
      {editBook && (
        <EditAudiobookModal book={editBook} onClose={() => setEditBook(null)}
          onSave={async (changes) => {
            updateBook(editBook.id, changes)
            await persistLibrary()
            setEditBook(null)
          }} />
      )}
      {libMenu && (
        <LibContextMenu x={libMenu.x} y={libMenu.y} onClose={() => setLibMenu(null)}
          onAddBook={() => fileInputRef.current?.click()}
          onAddAudio={() => audioInputRef.current?.click()}
        />
      )}
      <Toast message={toast?.message} error={toast?.error} />
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {profileOpen  && <ProfileModal  onClose={() => setProfileOpen(false)} />}
    </div>
  )
}