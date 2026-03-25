import { useState, useRef, useEffect, useContext, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { PaneContext } from '@/lib/PaneContext'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor, makeId } from '@/lib/utils'
import { importBooks, importAudioFile, importAudioFolder } from '@/lib/bookImport'
import { loadReadingLog, loadNotebookContent, resetBaseDir, saveCalendarEvents, loadKanbanBoards, saveKanbanBoards } from '@/lib/storage'
import Toast from '@/components/ui/Toast'
import { GnosNavButton, UniversalSettingsModal } from '@/components/SideNav'

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
        {book.coverDataUrl ? <img src={book.coverDataUrl} alt={book.title} draggable="false" /> : <>
          <div className="cover-spine" /><div className="cover-crease" /><div className="cover-edge" />
          <div className="cover-title">{book.title}</div>
          {book.author && <div className="cover-author">{book.author}</div>}
        </>}
        <div className="cover-badge">{fmt}</div>
      </div>
      {pct > 0 && <div className="meta-prog-row" style={{ marginTop: 4, padding: '0 2px' }}><div className="meta-prog-track"><div className="meta-prog-fill" style={{ width: `${pct}%` }} /></div><span className="meta-prog-pct">{pct}%</span></div>}
      <div className="book-meta">
        <div className="meta-text">
          <div className="meta-title">{book.title}</div>
          {book.author && <div className="meta-author">{book.author}</div>}
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
          ? <img src={book.coverDataUrl} alt={book.title} draggable="false" />
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
  const [openSub, setOpenSub] = useState(null) // index of hovered submenu item
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
        <div key={i} style={{ position: 'relative' }}
          onMouseEnter={() => item.submenu && setOpenSub(i)}
          onMouseLeave={() => item.submenu && setOpenSub(null)}
        >
          <button className="lib-ctx-item"
            style={{ width: '100%', ...(item.danger ? { color: '#ef5350' } : {}) }}
            onClick={() => { if (!item.submenu) { item.action(); onClose() } }}>
            {item.icon && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
              dangerouslySetInnerHTML={{ __html: item.icon }} />}
            {item.label}
            {item.submenu && <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: 'auto', opacity: 0.5 }}>
              <path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>}
          </button>
          {item.submenu && openSub === i && (
            <div style={{
              position: 'absolute', left: '100%', top: -4, zIndex: 10000,
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 4, minWidth: 140,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {item.submenu.map((sub, j) => (
                <button key={j} className="lib-ctx-item" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => { sub.action(); onClose() }}>
                  {sub.label?.startsWith('#') && (
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: sub.label, flexShrink: 0, border: '1px solid rgba(255,255,255,0.15)' }} />
                  )}
                  {sub.label?.startsWith('#') ? '' : sub.label}
                </button>
              ))}
              {item.submenu.length === 0 && (
                <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--textDim)', fontStyle: 'italic' }}>No collections</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function AddPopup({ onClose, onOpenNebuli, onAddBook, onAddAudio, onNewNotebook, onNewSketchbook, onNewCollection, onNewFlashcardDeck }) {
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className="add-choice-popup" style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0 }}>
      <div className="add-choice-header">Add to Library</div>
      <button className="add-choice-btn" onClick={() => { onOpenNebuli?.(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.9"/>
          <circle cx="4"  cy="6"  r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="20" cy="6"  r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="4"  cy="18" r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="20" cy="18" r="2" fill="currentColor" opacity="0.55"/>
          <line x1="12" y1="9"  x2="4"  y2="6"  stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="9"  x2="20" y2="6"  stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="15" x2="4"  y2="18" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="15" x2="20" y2="18" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
        </svg>
        <div className="add-choice-text">
          <span>Open Nebuli</span>
          <small>Knowledge graph · connections · orbits</small>
        </div>
      </button>
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
      <button className="add-choice-btn" onClick={() => { onNewFlashcardDeck(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="6" y="8" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
        <div className="add-choice-text">
          <span>New Flashcard Deck</span>
          <small>Create empty · spaced repetition</small>
        </div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewCollection(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="11" width="18" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M2 11h20V8a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <rect x="8" y="14" width="8" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
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
  const [streakDays, setStreakDays] = useState(0)
  const [weekActivity, setWeekActivity] = useState([false, false, false, false, false, false, false])
  const flashcardDecks = useAppStore(s => s.flashcardDecks)

  useEffect(() => {
    (async () => {
      const log = await loadReadingLog().catch(() => ({})) || {}
      const today = new Date()
      const week = []
      const startOfWeek = new Date(today)
      startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7))
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek)
        d.setDate(startOfWeek.getDate() + i)
        const key = d.toISOString().slice(0, 10)
        week.push(!!log[key])
      }
      let streak = 0
      for (let i = 0; i < 365; i++) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        if (log[key]) streak++
        else if (i > 0) break
      }
      const maxFcStreak = flashcardDecks.reduce((max, d) => Math.max(max, d.streak || 0), 0)
      setStreakDays(Math.max(streak, maxFcStreak))
      setWeekActivity(week)
    })()
  }, [flashcardDecks])

  const days = ['M','T','W','T','F','S','S']
  return (
    <div className="library-footer">
      <div className="streak-section">
        <span className="streak-label">STREAK</span>
        <div className="streak-dots">
          {days.map((d, i) => (
            <div key={i} className={`streak-dot${weekActivity[i] ? ' filled' : ''}`} title={d} />
          ))}
        </div>
        <span className="streak-count">{streakDays} day{streakDays !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}


function LibContextMenu({ x, y, onClose, onOpenNebuli, onAddBook, onAddAudio, onNewNotebook, onNewSketchbook, onNewFlashcardDeck, onNewCollection }) {
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  return (
    <div ref={ref} className="add-choice-popup" style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 260), top: Math.min(y, window.innerHeight - 380) }}>
      <div className="add-choice-header">Add to Library</div>
      <button className="add-choice-btn" onClick={() => { onOpenNebuli?.(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.9"/>
          <circle cx="4"  cy="6"  r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="20" cy="6"  r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="4"  cy="18" r="2" fill="currentColor" opacity="0.55"/>
          <circle cx="20" cy="18" r="2" fill="currentColor" opacity="0.55"/>
          <line x1="12" y1="9"  x2="4"  y2="6"  stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="9"  x2="20" y2="6"  stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="15" x2="4"  y2="18" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
          <line x1="12" y1="15" x2="20" y2="18" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
        </svg>
        <div className="add-choice-text"><span>Open Nebuli</span><small>Knowledge graph · connections · orbits</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onAddBook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          <line x1="9" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="9" y1="11" x2="14" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <div className="add-choice-text"><span>Import Book</span><small>.epub · .txt · .md · .pdf</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onAddAudio(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M9 18c0 1.66-1.34 3-3 3H4c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1zM22 15c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M9 19V8l13-3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="add-choice-text"><span>Import Audiobook</span><small>.mp3 · .m4b · .m4a · .wav · .flac</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewNotebook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.6"/>
          <line x1="7" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="12" x2="17" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          <line x1="7" y1="16" x2="12" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
        <div className="add-choice-text"><span>New Notebook</span><small>Markdown · wikilinks · live preview</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewSketchbook(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="add-choice-text"><span>New Sketchbook</span><small>Excalidraw canvas · draw &amp; diagram</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewFlashcardDeck(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="6" y="8" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
        <div className="add-choice-text"><span>New Flashcard Deck</span><small>Create empty · spaced repetition</small></div>
      </button>
      <button className="add-choice-btn" onClick={() => { onNewCollection(); onClose() }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="11" width="18" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M2 11h20V8a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <rect x="8" y="14" width="8" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        <div className="add-choice-text"><span>New Collection</span><small>Group books, audio &amp; notebooks</small></div>
      </button>
    </div>
  )
}


function EditAudiobookModal({ book, onSave, onClose }) {
  const [title,  setTitle]  = useState(book.title  || '')
  const [author, setAuthor] = useState(book.author || '')
  const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#0f4c75']
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

// ── Graph Modal ────────────────────────────────────────────────────────────────

function SearchDropdown({ query, library, notebooks, onOpenBook, onOpenAudio, onOpenNotebook, onClose, onDevCommand, onOpenGraph, onOpenCalendar, onReset }) {
  const q = query.trim().toLowerCase()
  if (!q) return null

  // ── /calendar command ──────────────────────────────────────────────────────
  if (q === '/calendar') {
    return (
      <div className="search-dropdown">
        <button className="search-drop-item" onClick={() => { onOpenCalendar?.(); onClose() }}>
          <div className="search-drop-cover" style={{ background: 'linear-gradient(135deg,#1a4a3e,#2ecc71)', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="3" width="16" height="15" rx="2" stroke="white" strokeWidth="1.5" opacity="0.9"/><line x1="6" y1="1" x2="6" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><line x1="14" y1="1" x2="14" y2="5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><line x1="2" y1="8" x2="18" y2="8" stroke="white" strokeWidth="1.5" opacity="0.7"/><rect x="6" y="11" width="3" height="3" rx="0.5" fill="white" opacity="0.7"/></svg>
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
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3" fill="white" opacity="0.9"/><circle cx="3" cy="5" r="2" fill="white" opacity="0.6"/><circle cx="17" cy="5" r="2" fill="white" opacity="0.6"/><circle cx="3" cy="15" r="2" fill="white" opacity="0.6"/><circle cx="17" cy="15" r="2" fill="white" opacity="0.6"/><line x1="10" y1="7" x2="3" y2="5" stroke="white" strokeWidth="1" opacity="0.5"/><line x1="10" y1="7" x2="17" y2="5" stroke="white" strokeWidth="1" opacity="0.5"/><line x1="10" y1="13" x2="3" y2="15" stroke="white" strokeWidth="1" opacity="0.5"/><line x1="10" y1="13" x2="17" y2="15" stroke="white" strokeWidth="1" opacity="0.5"/></svg>
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
        <div className="search-drop-cover" style={{ background: n.coverColor || '#2d1b69' }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>NOTE</span>
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

function NotebookCard({ nb, onOpen, onMenu }) {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookCard — whiteboard/sketch cover design
// ─────────────────────────────────────────────────────────────────────────────
function SketchbookCard({ sb, onOpen, onMenu }) {
  const color = sb.coverColor || '#0d5eaf'
  const dateStr = sb.updatedAt || sb.createdAt
    ? new Date(sb.updatedAt || sb.createdAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : ''
  return (
    <div className="book-card-container" style={{ cursor:'pointer' }}
      onClick={() => onOpen(sb)}
      onContextMenu={e => { e.preventDefault(); onMenu(e, sb) }}>
      {/* Cover — same fixed size as book covers */}
      <div className="book-cover" style={{ background: color, padding: 0, justifyContent: 'flex-start', alignItems: 'stretch' }}>
        {/* Solid colored spine — like BookCard's .cover-spine */}
        <div style={{ position:'absolute', left:0, top:0, bottom:0, width:8,
          background: color, filter:'brightness(0.7)', zIndex:1 }} />

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

        {/* Dot-grid pattern overlay — starts after spine so dots don't bleed onto it */}
        <div style={{
          position:'absolute', top:0, right:0, bottom:0, left:8, zIndex:1, pointerEvents:'none',
          backgroundImage:'radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize:'8px 8px',
        }} />
        {/* SKETCH badge + pencil icon */}
        <div style={{ position:'relative', padding:'0 12px 16px 16px', display:'flex', alignItems:'center', gap:6, zIndex:2 }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ opacity:0.7, flexShrink:0 }}>
            <path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize:8, fontWeight:800, letterSpacing:'.1em', color:'rgba(255,255,255,0.7)', textTransform:'uppercase' }}>Sketch</span>
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
// ─────────────────────────────────────────────────────────────────────────────
// FlashcardDeckCard — Anki-style deck card with card count + due count
// ─────────────────────────────────────────────────────────────────────────────
function FlashcardDeckCard({ deck, onOpen, onMenu }) {
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginBottom: 6, opacity: 0.7 }}>
            <rect x="2" y="4" width="16" height="12" rx="2" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5"/>
            <rect x="6" y="8" width="16" height="12" rx="2" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5"/>
          </svg>
          <div style={{ fontSize:13, fontWeight:800, color:'#fff',
            lineHeight:1.25, wordBreak:'break-word',
            overflow:'hidden', display:'-webkit-box',
            WebkitLineClamp:3, WebkitBoxOrient:'vertical' }}>
            {deck.title}
          </div>
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
}

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

function EditBookMetaModal({ book, onSave, onClose }) {
  const [title,       setTitle]       = useState(book.title || '')
  const [author,      setAuthor]      = useState(book.author || '')
  const [description, setDescription] = useState(book.description || '')
  const [rating,      setRating]      = useState(book.rating || 0)
  const [tagsInput,   setTagsInput]   = useState((book.tags || []).join(', '))
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center'}}
      onClick={onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:24,width:360,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 16px 48px rgba(0,0,0,0.5)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:'var(--text)'}}>Edit Book</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Title</div>
          <input value={title} onChange={e=>setTitle(e.target.value)}
            style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}} />
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Author</div>
          <input value={author} onChange={e=>setAuthor(e.target.value)}
            style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}} />
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Rating</div>
          <StarRating value={rating} onChange={setRating} />
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Genre Tags</div>
          <input value={tagsInput} onChange={e=>setTagsInput(e.target.value)}
            placeholder="e.g. fiction, sci-fi, classic"
            style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box'}} />
          <div style={{fontSize:10,color:'var(--textDim)',marginTop:3}}>Comma-separated</div>
        </div>
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>Description</div>
          <textarea value={description} onChange={e=>setDescription(e.target.value)}
            rows={4} placeholder="Brief description or notes..."
            style={{width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box',resize:'vertical',fontFamily:'inherit'}} />
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose} style={{background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={() => onSave({
            title: title.trim() || book.title,
            author: author.trim(),
            description: description.trim(),
            rating,
            tags: tagsInput.split(',').map(t=>t.trim()).filter(Boolean),
          })} style={{background:'var(--accent)',border:'none',color:'#fff',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontWeight:600}}>Save</button>
        </div>
      </div>
    </div>
  )
}

function EditNotebookModal({ nb, onSave, onClose }) {
  const [title, setTitle] = useState(nb.title || '')
  const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32','#c0392b','#00838f']
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

function ProfileStatCard({ value, label }) {
  return (
    <div style={{ textAlign:'center', padding:'10px 6px' }}>
      <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>{value}</div>
      <div style={{ fontSize:10, color:'var(--textDim)', marginTop:5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600, opacity:0.7 }}>{label}</div>
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

/** Parse /calendar blocks from a notebook's content text. Returns array of { title, events } */
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

// ── Shared helpers ────────────────────────────────────────────────────────────
const EVENT_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316','#84CC16','#6B7280','#14B8A6','#A855F7']
const CARD_COLORS  = ['#EF4444','#F97316','#F59E0B','#84CC16','#10B981','#06B6D4','#3B82F6','#8B5CF6','#EC4899','#6B7280']
const fmt2 = n => String(n).padStart(2,'0')
const dkey = (y,m,d) => `${y}-${fmt2(m+1)}-${fmt2(d)}`
const makeEvtId  = () => `evt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const makeCardId = () => `card_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const makeColId  = () => `col_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
const makeCmtId  = () => `cmt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`

function eventsForDateKey(dateKey, events) {
  return events.filter(e => {
    if (e.date === dateKey) return true
    if (!e.recurrence || e.recurrence === 'none') return false
    const base   = new Date(e.date + 'T00:00:00')
    const target = new Date(dateKey + 'T00:00:00')
    if (target <= base) return false
    if (e.recurrenceEndDate && target > new Date(e.recurrenceEndDate + 'T00:00:00')) return false
    const diffDays = Math.round((target - base) / 86400000)
    if (e.recurrence === 'daily')   return true
    if (e.recurrence === 'weekly')  return diffDays % 7 === 0
    if (e.recurrence === 'monthly') return target.getDate() === base.getDate()
    if (e.recurrence === 'yearly')  return target.getDate() === base.getDate() && target.getMonth() === base.getMonth()
    return false
  })
}

// ── Shared small UI helpers ───────────────────────────────────────────────────
function CloseBtn({ onClick }) {
  return (
    <button onClick={onClick} style={{ width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0 }}>
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
    </button>
  )
}

// ── EventModal ────────────────────────────────────────────────────────────────
function EventModal({ event, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    title:            event?.title            || '',
    date:             event?.date             || new Date().toISOString().slice(0,10),
    startTime:        event?.startTime        || '',
    endTime:          event?.endTime          || '',
    allDay:           event?.allDay           ?? true,
    location:         event?.location         || '',
    color:            event?.color            || EVENT_COLORS[0],
    recurrence:       event?.recurrence       || 'none',
    recurrenceEndDate:event?.recurrenceEndDate|| '',
    description:      event?.description      || '',
  })
  const set = (k,v) => setForm(f => ({...f,[k]:v}))
  const isNew = !event?.id

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.72)',zIndex:4000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,width:420,maxWidth:'calc(100vw-32px)',maxHeight:'calc(100vh-48px)',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.6)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'16px 18px 12px',borderBottom:'1px solid var(--borderSubtle)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{isNew?'New Event':'Edit Event'}</span>
          <CloseBtn onClick={onClose}/>
        </div>
        <div style={{padding:'14px 18px 18px',display:'flex',flexDirection:'column',gap:11}}>
          {/* Color dot + title */}
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:12,height:12,borderRadius:3,background:form.color,flexShrink:0}}/>
            <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Event title" autoFocus
              style={{flex:1,background:'none',border:'none',borderBottom:'1px solid var(--border)',color:'var(--text)',fontSize:15,fontWeight:600,padding:'4px 2px',fontFamily:'inherit',outline:'none'}}/>
          </div>
          {/* All-day + date */}
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,color:'var(--textDim)',cursor:'pointer',userSelect:'none',flexShrink:0}}>
              <input type="checkbox" checked={form.allDay} onChange={e=>set('allDay',e.target.checked)} style={{accentColor:'var(--accent)'}}/>
              All day
            </label>
            <input type="date" value={form.date} onChange={e=>set('date',e.target.value)}
              style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}/>
          </div>
          {/* Times */}
          {!form.allDay && (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input type="time" value={form.startTime} onChange={e=>set('startTime',e.target.value)}
                style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}/>
              <span style={{fontSize:11,color:'var(--textDim)'}}>to</span>
              <input type="time" value={form.endTime} onChange={e=>set('endTime',e.target.value)}
                style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}/>
            </div>
          )}
          {/* Location */}
          <input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="📍 Add location"
            style={{background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'6px 10px',fontFamily:'inherit',outline:'none'}}/>
          {/* Color picker */}
          <div>
            <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:6}}>Color</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              {EVENT_COLORS.map(c=>(
                <button key={c} onClick={()=>set('color',c)} style={{width:20,height:20,borderRadius:4,background:c,cursor:'pointer',padding:0,border:form.color===c?'2px solid var(--text)':'2px solid transparent',boxShadow:form.color===c?'inset 0 0 0 2px rgba(255,255,255,0.4)':'none'}}/>
              ))}
            </div>
          </div>
          {/* Recurrence */}
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12,color:'var(--textDim)',flexShrink:0}}>Repeat</span>
            <select value={form.recurrence} onChange={e=>set('recurrence',e.target.value)}
              style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}>
              {[['none','Does not repeat'],['daily','Every day'],['weekly','Every week'],['monthly','Every month'],['yearly','Every year']].map(([v,l])=>(
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {form.recurrence!=='none' && (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{fontSize:12,color:'var(--textDim)',flexShrink:0}}>Until</span>
              <input type="date" value={form.recurrenceEndDate} onChange={e=>set('recurrenceEndDate',e.target.value)}
                style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}/>
            </div>
          )}
          {/* Description */}
          <textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Notes…" rows={3}
            style={{background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'8px 10px',fontFamily:'inherit',resize:'vertical',outline:'none'}}/>
          {/* Actions */}
          <div style={{display:'flex',gap:8,marginTop:2}}>
            {!isNew && <button onClick={onDelete} style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid rgba(239,68,68,0.4)',background:'rgba(239,68,68,0.08)',color:'#ef4444',cursor:'pointer',fontSize:12,fontWeight:600}}>Delete</button>}
            <button onClick={()=>onSave(form)} disabled={!form.title.trim()}
              style={{flex:2,padding:'8px',borderRadius:7,border:'none',background:'var(--accent)',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:700,opacity:form.title.trim()?1:0.5}}>
              {isNew?'Create Event':'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── FullCalendar ──────────────────────────────────────────────────────────────
export function FullCalendar({ notebookEvents = {} }) {
  const today    = new Date()
  const todayKey = today.toISOString().slice(0,10)
  const events              = useAppStore(s => s.calendarEvents)
  const setCalendarEventsStore = useAppStore(s => s.setCalendarEventsStore)
  const [viewMode,     setViewMode]     = useState('month')
  const [viewDate,     setViewDate]     = useState(new Date())
  const [selectedDay,  setSelectedDay]  = useState(null)
  const [editingEvent, setEditingEvent] = useState(null) // {event, isNew}

  const persist = async (evts) => { setCalendarEventsStore(evts); await saveCalendarEvents(evts) }

  const allEventsForDate = (dateKey) => {
    const appEvts = eventsForDateKey(dateKey, events)
    const nbEvts  = (notebookEvents[dateKey] || []).map((t,i) => ({
      id:`nb_${dateKey}_${i}`, title: typeof t==='string'?t:String(t),
      date:dateKey, color:'#6B7280', source:'notebook', allDay:true,
    }))
    return [...appEvts, ...nbEvts]
  }

  const handleSave = async (form) => {
    const now = new Date().toISOString()
    if (!editingEvent?.event?.id) {
      await persist([...events, {...form, id:makeEvtId(), createdAt:now, source:'app'}])
    } else {
      await persist(events.map(e => e.id===editingEvent.event.id ? {...e,...form} : e))
    }
    setEditingEvent(null)
  }
  const handleDelete = async () => {
    if (editingEvent?.event?.id) await persist(events.filter(e=>e.id!==editingEvent.event.id))
    setEditingEvent(null)
  }

  const prev = () => { const d=new Date(viewDate); if(viewMode==='month')d.setMonth(d.getMonth()-1); else if(viewMode==='week')d.setDate(d.getDate()-7); else d.setDate(d.getDate()-1); setViewDate(d) }
  const next = () => { const d=new Date(viewDate); if(viewMode==='month')d.setMonth(d.getMonth()+1); else if(viewMode==='week')d.setDate(d.getDate()+7); else d.setDate(d.getDate()+1); setViewDate(d) }

  const headerLabel = viewMode==='month'
    ? viewDate.toLocaleDateString('en-US',{month:'long',year:'numeric'})
    : viewMode==='week'
    ? (()=>{ const sun=new Date(viewDate); sun.setDate(sun.getDate()-sun.getDay()); const sat=new Date(sun); sat.setDate(sat.getDate()+6); return `${sun.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sat.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` })()
    : viewDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})

  // ── Month grid ──
  const MonthGrid = () => {
    const y=viewDate.getFullYear(), mo=viewDate.getMonth()
    const first=new Date(y,mo,1).getDay(), dim=new Date(y,mo+1,0).getDate()
    const cells=Math.ceil((first+dim)/7)*7
    return (
      <div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,marginBottom:2}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
            <div key={d} style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textAlign:'center',padding:'3px 0 5px',textTransform:'uppercase',letterSpacing:'0.05em'}}>{d}</div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1}}>
          {Array.from({length:cells},(_,i)=>{
            const dn=i-first+1; const inMonth=dn>=1&&dn<=dim
            const cell=new Date(y,mo,dn)
            const dk2=dkey(cell.getFullYear(),cell.getMonth(),cell.getDate())
            const evts=inMonth?allEventsForDate(dk2):[]
            const isToday=dk2===todayKey, isSel=selectedDay===dk2
            return (
              <div key={i} onClick={()=>inMonth&&setSelectedDay(s=>s===dk2?null:dk2)}
                style={{minHeight:68,padding:'4px 4px 3px',borderRadius:7,cursor:inMonth?'pointer':'default',
                  background:isSel?'color-mix(in srgb,var(--accent) 14%,transparent)':isToday?'color-mix(in srgb,var(--accent) 7%,transparent)':'none',
                  border:isToday?'1px solid color-mix(in srgb,var(--accent) 40%,transparent)':isSel?'1px solid var(--accent)':'1px solid transparent',
                  transition:'background 0.1s'}}>
                <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:2,
                  background:isToday?'var(--accent)':'none',
                  fontSize:11,fontWeight:isToday?700:400,
                  color:isToday?'#fff':inMonth?'var(--text)':'var(--textDim)',opacity:inMonth?1:0.3}}>
                  {inMonth?dn:''}
                </div>
                {evts.slice(0,3).map(ev=>(
                  <div key={ev.id} onClick={e=>{e.stopPropagation();ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}}
                    style={{fontSize:10,lineHeight:1.3,padding:'1px 4px',borderRadius:3,marginBottom:1,
                      background:ev.color||'var(--accent)',color:'#fff',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                      cursor:ev.source!=='notebook'?'pointer':'default',fontWeight:500}}>
                    {!ev.allDay&&ev.startTime&&<span style={{opacity:0.85}}>{ev.startTime} </span>}{ev.title}
                  </div>
                ))}
                {evts.length>3&&<div style={{fontSize:9,color:'var(--textDim)',padding:'0 2px'}}>+{evts.length-3} more</div>}
              </div>
            )
          })}
        </div>
        {selectedDay && (
          <div style={{marginTop:10,background:'var(--surfaceAlt)',borderRadius:10,border:'1px solid var(--borderSubtle)',padding:'12px 14px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>
                {new Date(selectedDay+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}
              </div>
              <button onClick={()=>setEditingEvent({event:{date:selectedDay},isNew:true})}
                style={{padding:'3px 10px',borderRadius:6,border:'none',background:'var(--accent)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>
                + Event
              </button>
            </div>
            {allEventsForDate(selectedDay).length===0
              ? <div style={{fontSize:12,color:'var(--textDim)'}}>No events</div>
              : allEventsForDate(selectedDay).map(ev=>(
                <div key={ev.id} onClick={()=>ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}
                  style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 0',borderTop:'1px solid var(--borderSubtle)',cursor:ev.source!=='notebook'?'pointer':'default'}}>
                  <div style={{width:3,height:34,borderRadius:2,background:ev.color||'var(--accent)',flexShrink:0,marginTop:2}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>{ev.title}</div>
                    <div style={{fontSize:11,color:'var(--textDim)'}}>
                      {ev.allDay?'All day':`${ev.startTime||''}${ev.endTime?' – '+ev.endTime:''}`}
                      {ev.location&&` · 📍 ${ev.location}`}
                      {ev.recurrence&&ev.recurrence!=='none'&&` · ↻ ${ev.recurrence}`}
                      {ev.source==='notebook'&&' · notebook'}
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    )
  }

  // ── Time grid (week / day) ──
  const HOURS = Array.from({length:24},(_,i)=>i)

  const TimeGrid = ({ days }) => {
    const gridRef  = useRef()
    const dragRef2 = useRef(null)
    const [localDrag, setLocalDrag] = useState(null)

    const getHour = (clientY) => {
      const el = gridRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const relY  = Math.max(0, clientY - rect.top + el.scrollTop - 24) // 24 = header
      return Math.max(0, Math.min(23, Math.floor(relY / 52)))
    }

    const onPointerDown = (e, dateKey) => {
      if (e.button !== 0) return
      e.preventDefault()
      const h = getHour(e.clientY)
      dragRef2.current = { dateKey, startH: h, endH: h }
      setLocalDrag({ ...dragRef2.current })
      const onMove = (ev) => {
        if (!dragRef2.current) return
        const h2 = getHour(ev.clientY)
        dragRef2.current = { ...dragRef2.current, endH: h2 }
        setLocalDrag({ ...dragRef2.current })
      }
      const onUp = () => {
        if (dragRef2.current) {
          const { dateKey:dk3, startH, endH } = dragRef2.current
          const s=Math.min(startH,endH), en=Math.max(startH,endH)
          setEditingEvent({ event:{ date:dk3, allDay:false, startTime:`${fmt2(s)}:00`, endTime:`${fmt2(en+1)}:00` }, isNew:true })
        }
        dragRef2.current = null; setLocalDrag(null)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }

    return (
      <div ref={gridRef} style={{overflowY:'auto',maxHeight:440,position:'relative',userSelect:'none'}}>
        <div style={{display:'grid',gridTemplateColumns:`44px repeat(${days.length},1fr)`}}>
          {/* Time label column */}
          <div>
            <div style={{height:28}}/>
            {HOURS.map(h=>(
              <div key={h} style={{height:52,display:'flex',alignItems:'flex-start',justifyContent:'flex-end',paddingRight:6,paddingTop:4}}>
                <span style={{fontSize:10,color:'var(--textDim)',fontVariantNumeric:'tabular-nums'}}>
                  {h===0?'12a':h<12?`${h}a`:h===12?'12p':`${h-12}p`}
                </span>
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map(({ dateKey, label, isToday }) => {
            const timedEvts = allEventsForDate(dateKey).filter(e => !e.allDay && e.startTime)
            const allDayEvts = allEventsForDate(dateKey).filter(e => e.allDay || !e.startTime)
            const isDrag = localDrag?.dateKey === dateKey
            const dS = isDrag ? Math.min(localDrag.startH, localDrag.endH) : 0
            const dE = isDrag ? Math.max(localDrag.startH, localDrag.endH)+1 : 0
            return (
              <div key={dateKey} style={{borderLeft:'1px solid var(--borderSubtle)',position:'relative'}}>
                {/* Day header */}
                <div style={{height:28,display:'flex',alignItems:'center',justifyContent:'center',gap:5,fontSize:11,fontWeight:700,
                  color:isToday?'var(--accent)':'var(--textDim)',borderBottom:'1px solid var(--borderSubtle)',
                  position:'sticky',top:0,background:'var(--surface)',zIndex:5}}>
                  {label}
                  <button onClick={()=>setEditingEvent({event:{date:dateKey},isNew:true})}
                    style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:14,padding:'0 2px',lineHeight:1}}>+</button>
                </div>
                {/* All-day strip */}
                {allDayEvts.length>0&&(
                  <div style={{padding:'2px 3px',borderBottom:'1px solid var(--borderSubtle)',minHeight:18}}>
                    {allDayEvts.slice(0,2).map(ev=>(
                      <div key={ev.id} onClick={()=>ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}
                        style={{fontSize:10,padding:'1px 4px',borderRadius:3,marginBottom:1,background:ev.color||'var(--accent)',color:'#fff',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}}>
                        {ev.title}
                      </div>
                    ))}
                    {allDayEvts.length>2&&<div style={{fontSize:9,color:'var(--textDim)'}}>+{allDayEvts.length-2}</div>}
                  </div>
                )}
                {/* Hour slots */}
                <div style={{position:'relative'}} onPointerDown={e=>onPointerDown(e,dateKey)}>
                  {HOURS.map(h=>(
                    <div key={h} style={{height:52,borderBottom:'1px solid color-mix(in srgb,var(--border) 40%,transparent)',background:h%2===0?'none':'rgba(0,0,0,0.01)'}}/>
                  ))}
                  {/* Drag ghost */}
                  {isDrag&&(
                    <div style={{position:'absolute',top:dS*52,height:(dE-dS)*52,left:2,right:2,borderRadius:5,
                      background:'color-mix(in srgb,var(--accent) 22%,transparent)',border:'1px solid var(--accent)',pointerEvents:'none',zIndex:3}}>
                      <div style={{fontSize:10,color:'var(--accent)',padding:'3px 5px',fontWeight:600}}>{fmt2(dS)}:00 – {fmt2(dE)}:00</div>
                    </div>
                  )}
                  {/* Timed events */}
                  {timedEvts.map(ev=>{
                    const [sh,sm]=(ev.startTime||'0:00').split(':').map(Number)
                    const [eh,em]=(ev.endTime||ev.startTime||'1:00').split(':').map(Number)
                    const topPx=sh*52+(sm/60)*52
                    const htPx=Math.max(22,(eh+em/60-sh-sm/60)*52)
                    return (
                      <div key={ev.id} onClick={()=>ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}
                        style={{position:'absolute',top:topPx,left:2,right:2,height:htPx,
                          background:`color-mix(in srgb,${ev.color||'var(--accent)'} 85%,transparent)`,
                          borderRadius:5,padding:'3px 5px',cursor:'pointer',overflow:'hidden',zIndex:2,
                          border:`1px solid ${ev.color||'var(--accent)'}`}}>
                        <div style={{fontSize:10,fontWeight:600,color:'#fff',lineHeight:1.2}}>{ev.title}</div>
                        {ev.location&&<div style={{fontSize:9,color:'rgba(255,255,255,0.8)'}}>📍{ev.location}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const getWeekDays = () => {
    const sun=new Date(viewDate); sun.setDate(sun.getDate()-sun.getDay())
    return Array.from({length:7},(_,i)=>{ const d=new Date(sun); d.setDate(d.getDate()+i); return { dateKey:dkey(d.getFullYear(),d.getMonth(),d.getDate()), label:d.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}), isToday:d.toDateString()===today.toDateString() } })
  }

  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:8}}>
      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:6}}>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <button onClick={prev} style={{width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--text)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>‹</button>
          <button onClick={next} style={{width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--text)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>›</button>
          <button onClick={()=>setViewDate(new Date())} style={{padding:'3px 9px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer'}}>Today</button>
          <span style={{fontSize:13,fontWeight:700,color:'var(--text)',marginLeft:4}}>{headerLabel}</span>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>setEditingEvent({event:{date:todayKey},isNew:true})}
            style={{padding:'4px 11px',borderRadius:7,border:'none',background:'var(--accent)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer'}}>
            + Event
          </button>
          <div style={{display:'flex',gap:2,background:'var(--surfaceAlt)',borderRadius:7,padding:2}}>
            {[['month','Month'],['week','Week'],['day','Day']].map(([m,l])=>(
              <button key={m} onClick={()=>setViewMode(m)} style={{padding:'3px 8px',borderRadius:5,border:'none',cursor:'pointer',fontSize:10,fontWeight:700,
                background:viewMode===m?'var(--surface)':'none',color:viewMode===m?'var(--text)':'var(--textDim)',
                boxShadow:viewMode===m?'0 1px 3px rgba(0,0,0,0.12)':'none'}}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      {viewMode==='month'&&<MonthGrid/>}
      {viewMode==='week'&&<TimeGrid days={getWeekDays()}/>}
      {viewMode==='day'&&<TimeGrid days={[{dateKey:dkey(viewDate.getFullYear(),viewDate.getMonth(),viewDate.getDate()),label:viewDate.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),isToday:viewDate.toDateString()===today.toDateString()}]}/>}
      {editingEvent&&<EventModal event={editingEvent.event} onSave={handleSave} onDelete={handleDelete} onClose={()=>setEditingEvent(null)}/>}
    </div>
  )
}

// ── KanbanCardModal ───────────────────────────────────────────────────────────
function KanbanCardModal({ card, onSave, onDelete, onClose }) {
  const [title,       setTitle]       = useState(card?.title       || '')
  const [color,       setColor]       = useState(card?.color       || CARD_COLORS[0])
  const [dueDate,     setDueDate]     = useState(card?.dueDate     || '')
  const [description, setDescription] = useState(card?.description || '')
  const [comments,    setComments]    = useState(card?.comments    || [])
  const [newCmt,      setNewCmt]      = useState('')
  const isNew = !card?.id

  const addCmt = () => {
    if (!newCmt.trim()) return
    setComments(c => [...c,{id:makeCmtId(),text:newCmt.trim(),createdAt:new Date().toISOString()}])
    setNewCmt('')
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.72)',zIndex:4000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,width:480,maxWidth:'calc(100vw-32px)',maxHeight:'calc(100vh-48px)',overflow:'auto',boxShadow:'0 24px 64px rgba(0,0,0,0.6)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'16px 18px 12px',borderBottom:'1px solid var(--borderSubtle)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:12,height:12,borderRadius:3,background:color,flexShrink:0}}/>
            <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{isNew?'New Task':'Edit Task'}</span>
          </div>
          <CloseBtn onClick={onClose}/>
        </div>
        <div style={{padding:'14px 18px 18px',display:'flex',flexDirection:'column',gap:12}}>
          {/* Color swatches + title */}
          <div style={{display:'flex',alignItems:'flex-start',gap:10}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:3,width:52,flexShrink:0,paddingTop:6}}>
              {CARD_COLORS.map(c=>(
                <button key={c} onClick={()=>setColor(c)} style={{width:14,height:14,borderRadius:3,background:c,cursor:'pointer',padding:0,
                  border:color===c?'2px solid var(--text)':'1px solid transparent'}}/>
              ))}
            </div>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Task title" autoFocus
              style={{flex:1,background:'none',border:'none',borderBottom:'1px solid var(--border)',color:'var(--text)',fontSize:15,fontWeight:600,padding:'4px 2px',fontFamily:'inherit',outline:'none'}}/>
          </div>
          {/* Due date */}
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:11,color:'var(--textDim)',width:64,flexShrink:0}}>Due date</span>
            <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}
              style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}/>
          </div>
          {/* Description */}
          <textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Add a description…" rows={3}
            style={{background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'8px 10px',fontFamily:'inherit',resize:'vertical',outline:'none'}}/>
          {/* Comments */}
          <div>
            <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8}}>Comments ({comments.length})</div>
            {comments.map(c=>(
              <div key={c.id} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-start'}}>
                <div style={{width:22,height:22,borderRadius:'50%',background:'var(--accent)',color:'#fff',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{c.text[0].toUpperCase()}</div>
                <div style={{flex:1,background:'var(--surfaceAlt)',borderRadius:6,padding:'6px 10px',position:'relative'}}>
                  <div style={{fontSize:12,color:'var(--text)',lineHeight:1.4}}>{c.text}</div>
                  <div style={{fontSize:10,color:'var(--textDim)',marginTop:2}}>{new Date(c.createdAt).toLocaleDateString()}</div>
                  <button onClick={()=>setComments(cs=>cs.filter(x=>x.id!==c.id))} style={{position:'absolute',top:3,right:6,background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',fontSize:14,padding:0}}>×</button>
                </div>
              </div>
            ))}
            <div style={{display:'flex',gap:6}}>
              <input value={newCmt} onChange={e=>setNewCmt(e.target.value)} placeholder="Add a comment…"
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addCmt()}}}
                style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text)',fontSize:12,padding:'6px 10px',fontFamily:'inherit',outline:'none'}}/>
              <button onClick={addCmt} disabled={!newCmt.trim()} style={{padding:'6px 12px',borderRadius:6,border:'none',background:'var(--accent)',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:600,opacity:newCmt.trim()?1:0.5}}>Send</button>
            </div>
          </div>
          {/* Actions */}
          <div style={{display:'flex',gap:8,marginTop:2}}>
            {!isNew&&<button onClick={onDelete} style={{flex:1,padding:'8px',borderRadius:7,border:'1px solid rgba(239,68,68,0.4)',background:'rgba(239,68,68,0.08)',color:'#ef4444',cursor:'pointer',fontSize:12,fontWeight:600}}>Delete</button>}
            <button onClick={()=>onSave({title:title.trim()||'Untitled',color,dueDate,description,comments})} disabled={!title.trim()}
              style={{flex:2,padding:'8px',borderRadius:7,border:'none',background:'var(--accent)',color:'#fff',cursor:'pointer',fontSize:12,fontWeight:700,opacity:title.trim()?1:0.5}}>
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
    {id:'col_backlog',    title:'Backlog',      cards:[]},
    {id:'col_todo',       title:'To Do',        cards:[]},
    {id:'col_inprogress', title:'In Progress',  cards:[]},
    {id:'col_done',       title:'Done',         cards:[]},
  ]
}

function KanbanBoard() {
  const [board,        setBoard]        = useState(null)
  const [editingCard,  setEditingCard]  = useState(null) // {card, colId, isNew}
  const [editColId,    setEditColId2]   = useState(null)
  const [editColName2, setEditColName2] = useState('')
  const [newColName,   setNewColName]   = useState('')
  const [addingCol,    setAddingCol]    = useState(false)
  const dragRef = useRef(null)
  const dropRef = useRef(null)
  const [dragging, setDragging] = useState(null) // cardId
  const [ghostPos, setGhostPos] = useState(null)
  const [dropCol,  setDropCol]  = useState(null)

  useEffect(() => { loadKanbanBoards().then(d => setBoard(d || DEFAULT_KANBAN)) }, [])

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

  useEffect(() => {
    if (!board) return
    const onMove = e => {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging) {
        if (Math.hypot(e.clientX-d.sx,e.clientY-d.sy) > 5) { d.dragging=true; setDragging(d.id); setGhostPos({x:e.clientX,y:e.clientY}) }
        return
      }
      setGhostPos({x:e.clientX,y:e.clientY})
      const cols = [...document.querySelectorAll('[data-kb-col]')]
      let tgt = null
      for (const col of cols) { const r=col.getBoundingClientRect(); if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom){tgt=col.dataset.kbCol;break} }
      dropRef.current = tgt; setDropCol(tgt)
    }
    const onUp = () => {
      const d=dragRef.current, t=dropRef.current
      dragRef.current=null; dropRef.current=null
      setDragging(null); setGhostPos(null); setDropCol(null)
      if (!d?.dragging || !t || t===d.fromCol) return
      const card = board.columns.find(c=>c.id===d.fromCol)?.cards.find(c=>c.id===d.id)
      if (!card) return
      persist({...board,columns:board.columns.map(c=>{
        if(c.id===d.fromCol) return {...c,cards:c.cards.filter(x=>x.id!==d.id)}
        if(c.id===t) return {...c,cards:[...c.cards,card]}
        return c
      })})
    }
    document.addEventListener('mousemove',onMove)
    document.addEventListener('mouseup',onUp)
    return () => { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp) }
  },[board])

  if (!board) return <div style={{padding:20,color:'var(--textDim)',fontSize:13}}>Loading…</div>

  const ghostCard = board.columns.flatMap(c=>c.cards).find(c=>c.id===dragging)

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <span style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>{board.title}</span>
        <button onClick={()=>setAddingCol(s=>!s)} style={{padding:'4px 12px',borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer'}}>+ Column</button>
      </div>
      {addingCol&&(
        <div style={{display:'flex',gap:6,marginBottom:12}}>
          <input value={newColName} onChange={e=>setNewColName(e.target.value)} placeholder="Column name" autoFocus
            onKeyDown={e=>{if(e.key==='Enter'&&newColName.trim()){persist({...board,columns:[...board.columns,{id:makeColId(),title:newColName.trim(),cards:[]}]});setNewColName('');setAddingCol(false)}else if(e.key==='Escape')setAddingCol(false)}}
            style={{flex:1,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:7,color:'var(--text)',fontSize:12,padding:'6px 10px',fontFamily:'inherit',outline:'none'}}/>
          <button onClick={()=>{if(newColName.trim()){persist({...board,columns:[...board.columns,{id:makeColId(),title:newColName.trim(),cards:[]}]});setNewColName('');setAddingCol(false)}}} style={{padding:'6px 14px',borderRadius:7,border:'none',background:'var(--accent)',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer'}}>Add</button>
        </div>
      )}
      <div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:6,alignItems:'flex-start'}}>
        {board.columns.map(col=>{
          const isTarget = dropCol===col.id
          return (
            <div key={col.id} data-kb-col={col.id}
              style={{minWidth:190,maxWidth:220,flex:'0 0 200px',background:isTarget?'color-mix(in srgb,var(--accent) 10%,var(--surfaceAlt))':'var(--surfaceAlt)',
                border:isTarget?'1px solid var(--accent)':'1px solid var(--border)',borderRadius:10,padding:'10px 8px 8px',
                display:'flex',flexDirection:'column',gap:6,transition:'background 0.1s,border-color 0.1s'}}>
              {/* Column header */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:2}}>
                {editColId===col.id
                  ?<input value={editColName2} autoFocus onChange={e=>setEditColName2(e.target.value)}
                    onBlur={()=>{persist({...board,columns:board.columns.map(c=>c.id===col.id?{...c,title:editColName2||col.title}:c)});setEditColId2(null)}}
                    onKeyDown={e=>{if(e.key==='Enter'||e.key==='Escape'){persist({...board,columns:board.columns.map(c=>c.id===col.id?{...c,title:editColName2||col.title}:c)});setEditColId2(null)}}}
                    style={{flex:1,background:'none',border:'none',borderBottom:'1px solid var(--accent)',color:'var(--text)',fontSize:11,fontWeight:700,padding:'2px 0',fontFamily:'inherit',outline:'none'}}/>
                  :<span onClick={()=>{setEditColId2(col.id);setEditColName2(col.title)}} style={{fontSize:11,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.06em',cursor:'pointer',flex:1}} title="Click to rename">{col.title}</span>
                }
                <div style={{display:'flex',alignItems:'center',gap:3}}>
                  <span style={{fontSize:10,color:'var(--textDim)',background:'var(--surface)',borderRadius:10,padding:'1px 6px',fontWeight:700}}>{col.cards.length}</span>
                  <button onClick={()=>persist({...board,columns:board.columns.filter(c=>c.id!==col.id)})} title="Delete column"
                    style={{background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',fontSize:13,padding:'0 2px',opacity:0.5,lineHeight:1}}>×</button>
                </div>
              </div>
              {/* Cards */}
              {col.cards.map(card=>(
                <div key={card.id}
                  onMouseDown={e=>{if(e.button!==0)return;e.preventDefault();dragRef.current={id:card.id,fromCol:col.id,sx:e.clientX,sy:e.clientY,dragging:false}}}
                  style={{background:'var(--surface)',border:'1px solid var(--borderSubtle)',borderLeft:`3px solid ${card.color||CARD_COLORS[0]}`,
                    borderRadius:7,padding:'8px 10px',cursor:'grab',opacity:dragging===card.id?0.35:1,
                    boxShadow:'0 1px 4px rgba(0,0,0,0.07)',transition:'opacity 0.15s,box-shadow 0.1s',
                    userSelect:'none'}}
                  onMouseEnter={e=>{if(dragging!==card.id)e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.14)'}}
                  onMouseLeave={e=>{e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.07)'}}>
                  <div style={{display:'flex',alignItems:'flex-start',gap:7}}>
                    <div style={{width:10,height:10,borderRadius:2,background:card.color||CARD_COLORS[0],flexShrink:0,marginTop:3}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--text)',lineHeight:1.35,marginBottom:4}}>{card.title}</div>
                      <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                        {card.dueDate&&<span style={{fontSize:10,color:'var(--textDim)',background:'var(--surfaceAlt)',borderRadius:4,padding:'1px 5px',border:'1px solid var(--borderSubtle)'}}>📅 {card.dueDate}</span>}
                        {card.comments?.length>0&&<span style={{fontSize:10,color:'var(--textDim)'}}>💬 {card.comments.length}</span>}
                        {card.description&&<span style={{fontSize:10,color:'var(--textDim)',opacity:0.6}}>···</span>}
                      </div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();setEditingCard({card,colId:col.id,isNew:false})}}
                      style={{background:'none',border:'none',color:'var(--textDim)',cursor:'pointer',fontSize:16,padding:'0 2px',flexShrink:0,lineHeight:1,opacity:0.6}}>⋯</button>
                  </div>
                </div>
              ))}
              {/* Add task */}
              <button onClick={()=>setEditingCard({card:null,colId:col.id,isNew:true})}
                style={{background:'none',border:'1px dashed var(--borderSubtle)',borderRadius:7,color:'var(--textDim)',cursor:'pointer',padding:'7px',fontSize:11,fontWeight:600,textAlign:'center',transition:'background 0.1s,border-color 0.1s,color 0.1s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--surface)';e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.borderColor='var(--borderSubtle)';e.currentTarget.style.color='var(--textDim)'}}>
                + Add task
              </button>
            </div>
          )
        })}
      </div>
      {/* Drag ghost */}
      {dragging&&ghostPos&&ghostCard&&(
        <div style={{position:'fixed',left:ghostPos.x+14,top:ghostPos.y+8,zIndex:9999,pointerEvents:'none',
          background:'var(--surface)',border:`1px solid var(--border)`,borderLeft:`3px solid ${ghostCard.color||CARD_COLORS[0]}`,
          borderRadius:7,padding:'8px 10px',minWidth:160,boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
          fontSize:12,fontWeight:600,color:'var(--text)',opacity:0.95,transform:'rotate(2deg)'}}>
          {ghostCard.title}
        </div>
      )}
      {editingCard&&(
        <KanbanCardModal card={editingCard.card}
          onSave={data=>editingCard.isNew?addCard(editingCard.colId,data):updateCard(editingCard.colId,editingCard.card.id,data)}
          onDelete={()=>deleteCard(editingCard.colId,editingCard.card?.id)}
          onClose={()=>setEditingCard(null)}/>
      )}
    </div>
  )
}

// ── ProfileModal ──────────────────────────────────────────────────────────────
function ProfileModal({ onClose }) {
  const library   = useAppStore(s => s.library)
  const notebooks = useAppStore(s => s.notebooks)
  const username  = useAppStore(s => s.username)
  const navigate  = useAppStore(s => s.navigate)

  const [log,          setLog]          = useState({})
  const [profileTab,   setProfileTab]   = useState('stats')
  const [reviewPeriod, setReviewPeriod] = useState('week')
  const [todoLists,    setTodoLists]    = useState([])
  const [todosLoaded,  setTodosLoaded]  = useState(false)
  const [calendarEvents, setCalendarEvents] = useState({})

  useEffect(() => { loadReadingLog().then(setLog).catch(() => setLog({})) }, [])

  useEffect(() => {
    if ((profileTab !== 'todos' && profileTab !== 'calendar') || todosLoaded) return
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
        } catch { /* skip */ }
      }
      setTodoLists(all)
      setCalendarEvents(mergeCalendarEvents(allCals))
    })()
  }, [profileTab, todosLoaded, notebooks])

  const today = new Date().toISOString().slice(0, 10)

  const { totalMinutes, avgDaily, todayMins, streak, booksFinished, heatmapDays } = useMemo(() => {
    const total = Object.values(log).reduce((a, b) => a + b, 0)
    const days  = Object.keys(log).length
    const tMins = Math.round(log[today] || 0)
    let s = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = d.toISOString().slice(0, 10)
      if ((log[k] || 0) >= 1) s++; else break
    }
    const finished = library.filter(b => (b.currentChapter || 0) >= Math.max((b.totalChapters || 1) - 1, 1)).length
    const heat = []
    for (let i = 83; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = d.toISOString().slice(0, 10)
      const m = log[k] || 0
      const level = m === 0 ? 0 : m < 10 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4
      heat.push({ k, m, level })
    }
    return { totalMinutes: total, avgDaily: days > 0 ? total / days : 0, todayMins: tMins, streak: s, booksFinished: finished, heatmapDays: heat }
  }, [log, library, today])

  const topBooks = useMemo(() =>
    library.map(b => ({ ...b, chaptersRead: b.currentChapter || 0 })).sort((a,b)=>b.chaptersRead-a.chaptersRead).slice(0,5),
    [library]
  )

  const reviewStats = useMemo(() => {
    const days = reviewPeriod==='week'?7:reviewPeriod==='month'?30:365
    const dateKeys = []
    for (let i=days-1;i>=0;i--) { const d=new Date();d.setDate(d.getDate()-i);dateKeys.push(d.toISOString().slice(0,10)) }
    const minutes = dateKeys.reduce((s,k)=>s+(log[k]||0),0)
    const daysActive = dateKeys.filter(k=>(log[k]||0)>=1).length
    const notesCreated = notebooks.filter(n=>{ const d=n.createdAt?.slice(0,10); return d&&d>=dateKeys[0]&&d<=dateKeys[dateKeys.length-1] }).length
    let streak2=0; for(let i=dateKeys.length-1;i>=0;i--){if((log[dateKeys[i]]||0)>=1)streak2++;else break}
    const booksFinishedInPeriod = library.filter(b=>{ const f=(b.currentChapter||0)>=Math.max((b.totalChapters||1)-1,1); return f&&b.updatedAt&&b.updatedAt.slice(0,10)>=dateKeys[0] }).length
    const bars = dateKeys.map(k=>({k,m:Math.round(log[k]||0)}))
    const maxM = Math.max(...bars.map(b=>b.m),1)
    return { minutes:Math.round(minutes),daysActive,notesCreated,streak:streak2,booksFinishedInPeriod,bars,maxM }
  }, [log,notebooks,library,reviewPeriod])

  const title = username ? `${username} — Profile` : 'Reading Profile'
  const heatAlpha = ['0','0.22','0.45','0.7','1']
  const TABS = [['stats','Stats'],['review','Review'],['calendar','Calendar'],['todos',"Todo's"]]

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={onClose}>
      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,
        width: 700, maxWidth:'calc(100vw - 32px)', maxHeight:'calc(100vh - 48px)',
        display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',transition:'width 0.25s ease'}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 20px 12px',borderBottom:'1px solid var(--borderSubtle)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:13,fontWeight:700,color:'var(--text)',letterSpacing:'-0.01em'}}>{title}</span>
            <div style={{display:'flex',gap:2,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:8,padding:3,boxShadow:'inset 0 1px 2px rgba(0,0,0,0.15)'}}>
              {TABS.map(([t,l])=>(
                <button key={t} onClick={()=>setProfileTab(t)} style={{
                  height:22,padding:'0 10px',fontSize:11,fontWeight:600,borderRadius:5,border:'none',cursor:'pointer',fontFamily:'inherit',
                  background:profileTab===t?'var(--accent)':'none',color:profileTab===t?'#fff':'var(--textDim)',transition:'all 0.15s',
                }}>{l}</button>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}}
            onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div style={{overflowY:'auto',padding:'16px 20px 24px',flex:1}}>
          {/* ── Review tab ── */}
          {profileTab==='review'&&(
            <div>
              <div style={{display:'inline-flex',alignItems:'center',marginBottom:20,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:9,padding:3,boxShadow:'inset 0 1px 2px rgba(0,0,0,0.15)'}}>
                {[['week','Week'],['month','Month'],['year','Year']].map(([p,l])=>(
                  <button key={p} onClick={()=>setReviewPeriod(p)} style={{height:24,padding:'0 12px',fontSize:11,fontWeight:600,borderRadius:6,border:'none',cursor:'pointer',fontFamily:'inherit',background:reviewPeriod===p?'var(--accent)':'none',color:reviewPeriod===p?'#fff':'var(--textDim)',transition:'all 0.15s'}}>{l}</button>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:0,marginBottom:8,borderBottom:'1px solid var(--borderSubtle)',paddingBottom:8}}>
                <ProfileStatCard value={reviewStats.minutes} label="Min Studied"/>
                <ProfileStatCard value={reviewStats.daysActive} label="Days Active"/>
                <ProfileStatCard value={reviewStats.streak} label="Streak"/>
                <ProfileStatCard value={reviewStats.notesCreated} label="Notes Created"/>
                <ProfileStatCard value={reviewStats.booksFinishedInPeriod} label="Books Finished"/>
                <ProfileStatCard value={`${Math.round(reviewStats.minutes/60*10)/10}h`} label="Hours"/>
              </div>
              <div style={{fontSize:11,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>
                Daily Activity — {reviewPeriod==='week'?'Last 7 Days':reviewPeriod==='month'?'Last 30 Days':'Last 365 Days'}
              </div>
              <div style={{position:'relative',display:'flex',alignItems:'flex-end',gap:reviewPeriod==='year'?1:3,height:120,marginBottom:16}}>
                {reviewStats.bars.map((bar,i)=>(
                  <div key={i} title={`${bar.k}: ${bar.m} min`} style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
                    <div style={{height:bar.m===0?2:Math.max(4,Math.round((bar.m/reviewStats.maxM)*116)),borderRadius:2,background:bar.m===0?'var(--surfaceAlt)':'var(--accent)',opacity:bar.m===0?0.4:1,transition:'height 0.2s'}}/>
                  </div>
                ))}
                {(()=>{
                  const vals=reviewStats.bars.map(b=>b.m); const n=vals.length; if(n<2)return null
                  const sX=vals.reduce((s,_,i)=>s+i,0),sY=vals.reduce((s,v)=>s+v,0),sXY=vals.reduce((s,v,i)=>s+i*v,0),sX2=vals.reduce((s,_,i)=>s+i*i,0)
                  const den=n*sX2-sX*sX,slope=den?(n*sXY-sX*sY)/den:0,intercept=(sY-slope*sX)/n
                  const pts=vals.map((_,i)=>`${(i/(n-1))*100},${120-(Math.min(Math.max(slope*i+intercept,0),reviewStats.maxM)/reviewStats.maxM)*116}`).join(' ')
                  return (<svg viewBox="0 0 100 120" preserveAspectRatio="none" style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',overflow:'visible'}}><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.55" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></svg>)
                })()}
              </div>
              {reviewPeriod!=='year'&&(<div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--textDim)',opacity:0.6,marginBottom:4}}><span>{reviewStats.bars[0]?.k.slice(5)}</span><span>{reviewStats.bars[reviewStats.bars.length-1]?.k.slice(5)}</span></div>)}
            </div>
          )}

          {/* ── Calendar tab ── */}
          {profileTab==='calendar'&&(
            <div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:10}}>
                <button onClick={()=>{onClose();navigate({view:'calendar'})}} style={{padding:'5px 12px',borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'background 0.15s,color 0.15s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='#fff';e.currentTarget.style.borderColor='var(--accent)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><line x1="4" y1="0.5" x2="4" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="8" y1="0.5" x2="8" y2="2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="1" y1="4.5" x2="11" y2="4.5" stroke="currentColor" strokeWidth="1.2"/></svg>
                  Open Calendar
                </button>
              </div>
              <FullCalendar notebookEvents={calendarEvents}/>
            </div>
          )}

          {/* ── Todo's tab ── */}
          {profileTab==='todos'&&(
            <div>
              {!todosLoaded&&<div style={{color:'var(--textDim)',fontSize:13}}>Loading todos…</div>}
              {todosLoaded&&todoLists.length===0&&(
                <div style={{color:'var(--textDim)',fontSize:13}}>No todos found. Use <code style={{background:'var(--surfaceAlt)',padding:'1px 5px',borderRadius:4}}>/todo</code> in any notebook to create a to-do list.</div>
              )}
              {todoLists.map((list,li)=>(
                <div key={li} style={{background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:10,marginBottom:12,overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,.08)'}}>
                  <div style={{padding:'10px 14px 8px',borderBottom:'1px solid var(--borderSubtle)'}}>
                    <div style={{fontWeight:700,fontSize:13,color:'var(--text)'}}>{list.listName}</div>
                    <div style={{fontSize:10,color:'var(--textDim)',marginTop:2}}>{list.notebookTitle} · {list.items.filter(i=>!i.checked).length} remaining</div>
                  </div>
                  <div style={{padding:'6px 0 8px'}}>
                    {list.items.map((item,ii)=>(
                      <div key={ii} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'5px 14px',opacity:item.checked?.55:1}}>
                        <div style={{width:13,height:13,borderRadius:3,flexShrink:0,marginTop:2,border:'1.5px solid var(--border)',background:item.checked?'var(--accent)':'none',borderColor:item.checked?'var(--accent)':'var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'#fff'}}>{item.checked?'✓':''}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12.5,color:'var(--text)',lineHeight:1.35,textDecoration:item.checked?'line-through':'none'}}>{item.text}</div>
                          {(item.dateStr||item.timeStr)&&(
                            <div style={{display:'flex',gap:6,marginTop:3}}>
                              {item.dateStr&&<span style={{fontSize:10,color:'var(--textDim)',background:'var(--surface)',borderRadius:4,padding:'1px 5px',border:'1px solid var(--borderSubtle)'}}>📅 {item.dateStr}</span>}
                              {item.timeStr&&<span style={{fontSize:10,color:'var(--textDim)',background:'var(--surface)',borderRadius:4,padding:'1px 5px',border:'1px solid var(--borderSubtle)'}}>🕐 {item.timeStr}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Stats tab ── */}
          {profileTab==='stats'&&(<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:0,marginBottom:8,borderBottom:'1px solid var(--borderSubtle)',paddingBottom:8}}>
              <ProfileStatCard value={streak}                                   label="Day Streak"/>
              <ProfileStatCard value={Math.round(avgDaily)}                     label="Avg Min/Day"/>
              <ProfileStatCard value={todayMins}                                label="Today (min)"/>
              <ProfileStatCard value={booksFinished}                            label="Finished"/>
              <ProfileStatCard value={Math.round(totalMinutes)}                 label="Total Min"/>
              <ProfileStatCard value={`${Math.round(totalMinutes/60*10)/10}h`} label="Total Hours"/>
            </div>
            <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.09em',marginBottom:8,marginTop:4,opacity:0.6}}>Activity — Last 12 Weeks</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gridTemplateRows:'repeat(7,1fr)',gridAutoFlow:'column',gap:3,marginBottom:10}}>
              {heatmapDays.map((d,i)=>(
                <div key={i} title={`${d.k}: ${Math.round(d.m)} min`} style={{height:10,borderRadius:2,background:d.level===0?'var(--surfaceAlt)':`color-mix(in srgb, var(--accent) ${Math.round(parseFloat(heatAlpha[d.level])*100)}%, transparent)`,border:d.level===0?'1px solid var(--borderSubtle)':'none'}}/>
              ))}
            </div>
            {topBooks.length > 0 && (<>
              <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.09em',marginBottom:10,marginTop:4,opacity:0.6}}>Top Books by Progress</div>
              {topBooks.map((b,i)=>{
                const progressPct = b.totalChapters > 1 ? Math.round(((b.currentChapter||0)/(b.totalChapters-1))*100) : 0
                return (
                  <div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0',borderTop:i>0?'1px solid var(--borderSubtle)':'none'}}>
                    <div style={{width:24,height:24,borderRadius:4,background:b.coverDataUrl?'none':'var(--surfaceAlt)',flexShrink:0,overflow:'hidden'}}>
                      {b.coverDataUrl?<img src={b.coverDataUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--textDim)'}}>{i+1}</div>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</div>
                      <div style={{fontSize:10,color:'var(--textDim)'}}>{b.author||'Unknown'}</div>
                    </div>
                    <div style={{width:60,flexShrink:0}}>
                      <div style={{height:4,background:'var(--surfaceAlt)',borderRadius:2,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${progressPct}%`,background:'var(--accent)',borderRadius:2}}/>
                      </div>
                      <div style={{fontSize:9,color:'var(--textDim)',textAlign:'right',marginTop:2}}>{progressPct}%</div>
                    </div>
                  </div>
                )
              })}
            </>)}
          </>)}
        </div>
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

export default function LibraryView() {
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
  const collections      = useAppStore(s => s.collections)
  const addCollection    = useAppStore(s => s.addCollection)
  const removeCollection = useAppStore(s => s.removeCollection)
  const updateCollection = useAppStore(s => s.updateCollection)
  const addToCollection  = useAppStore(s => s.addToCollection)
  const persistCollections = useAppStore(s => s.persistCollections)
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

  const [search,     setSearch]     = useState('')
  const [addOpen,    setAddOpen]    = useState(false)
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
  const [toast,      setToast]      = useState(null) // { message, error }
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen,  setProfileOpen]  = useState(false)
  const [activeCollection, setActiveCollection] = useState(null)
  const [editColId, setEditColId] = useState(null)
  const [editColName, setEditColName] = useState('')

  const [searchFocused, setSearchFocused] = useState(false)
  const nbSubFilter = useAppStore(s => s.libSubFilter)
  const setNbSubFilter = useAppStore(s => s.setLibSubFilter)
  const searchRef = useRef()

  const fileInputRef   = useRef()
  const audioInputRef  = useRef()

  const books      = library.filter(b => b.type !== 'audio')
  const audiobooks = library.filter(b => b.type === 'audio')

  // Pointer-based drag (HTML5 drag API doesn't fire reliably in Tauri/WebKit)
  useEffect(() => {
    function getTargets(x, y) {
      // Temporarily disable pointer events on all drag items so elementFromPoint
      // finds the element UNDERNEATH the cursor (the drop target)
      const all = [...document.querySelectorAll('[data-drag-item]')]
      all.forEach(el => { el.style.pointerEvents = 'none' })
      const el = document.elementFromPoint(x, y)
      all.forEach(el => { el.style.pointerEvents = '' })
      return {
        item: el?.closest('[data-drag-item]'),
        col:  el?.closest('[data-collection-id]'),
      }
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
      if (col) {
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
      if (drop.col && d.id) {
        store.addToCollection?.(drop.col, d.id)
        store.persistCollections?.()
      } else if (drop.item && drop.item !== d.id && drop.itemType === d.type) {
        const toId = drop.item
        if (d.type === 'book' || d.type === 'audio') {
          const fi = store.library.findIndex(x => x.id === d.id)
          const ti = store.library.findIndex(x => x.id === toId)
          if (fi !== -1 && ti !== -1) { store.reorderLibrary(fi, ti); store.persistLibrary?.() }
        } else if (d.type === 'nb') {
          // Look up which array the target actually belongs to (avoids cross-category mismatch)
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
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
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
    return () => { window.removeEventListener('open-file', handler); window.removeEventListener('gnos:edit-item', editHandler) }
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

  // In split mode PaneContext holds the tabId for this pane.
  // We update that tab's snapshot directly instead of the global view.
  const paneTabId = useContext(PaneContext)

  function openBook(book) {
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

  const ICON_BOOK   = '<path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
  const ICON_AUDIO  = '<path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_NB     = '<rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" stroke-width="1.4"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'
  const ICON_TRASH  = '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'

  const ICON_SEARCH = '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 9.5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
  const ICON_NEWTAB = '<path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 1h4v4M14 1l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'

  // Build the "Add to Collection" submenu with a "+ New Collection" item at top
  function makeCollectionSubmenu(itemId) {
    return [
      {
        label: '+ New Collection',
        action: () => {
          const newCol = { id: makeId('col'), name: 'New Collection', items: [itemId], color: '' }
          addCollection(newCol)
          addToCollection(newCol.id, itemId)
          persistCollections()
          // Switch to collections tab so user sees it
          setActiveLibTab('collections')
          setView('library')
        },
      },
      ...collections.map(c => ({
        label: c.name, action: () => { addToCollection(c.id, itemId); persistCollections() }
      })),
    ]
  }

  function showBookMenu(e, book) {
    e.stopPropagation()
    const ICON_EDIT = '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_BOOK,   action: () => openBook(book) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB, action: () => openBookInNewTab(book) },
      { label: 'Edit Details',    icon: ICON_EDIT,   action: () => setEditBookMeta(book) },
      {
        label: 'Add to Collection', icon: '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" stroke-width="1.1"/>',
        submenu: makeCollectionSubmenu(book.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('book', book.id, book.title)
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
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditBook(book) },
      {
        label: 'Add to Collection', icon: '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" stroke-width="1.1"/>',
        submenu: makeCollectionSubmenu(book.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash } = await import('@/lib/storage')
        await moveToTrash('audio', book.id, book.title)
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
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditNb(nb) },
      {
        label: 'Add to Collection', icon: '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" stroke-width="1.1"/>',
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
  const ICON_SKETCH = '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
  function showSbMenu(e, sb) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: ICON_SKETCH, action: () => openSketchbook(sb) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openSketchbookInNewTab(sb) },
      { label: 'Edit',   icon: '<path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', action: () => setEditSb(sb) },
      {
        label: 'Add to Collection', icon: '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" stroke-width="1.1"/>',
        submenu: makeCollectionSubmenu(sb.id),
      },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: async () => {
        const { moveToTrash, deleteSketchbookContent } = await import('@/lib/storage')
        await moveToTrash('sketchbook', sb.id, sb.title)
        await deleteSketchbookContent(sb.id)
        removeSketchbook(sb.id)
        useAppStore.getState().persistSketchbooks?.()
      }},
    ]})
  }

  function showDeckMenu(e, deck) {
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open',            icon: '<rect x="2" y="4" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="6" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.3"/>', action: () => openFlashcardDeck(deck) },
      { label: 'Open in New Tab', icon: ICON_NEWTAB,  action: () => openFlashcardDeckInNewTab(deck) },
      { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => {
        removeDeck(deck.id)
        persistFlashcardDecks()
      }},
    ]})
  }

  function renderAll() {
    const lib = library
    const nbs = notebooks
    const sbs = sketchbooks
    const fds = flashcardDecks
    if (!lib.length && !nbs.length && !sbs.length && !fds.length) return (
      <div className="lib-empty-state" style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
        <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
        </button>
        <p className="lib-empty-hint">Right-click anywhere to add books,<br/>audiobooks, notebooks, or sketchbooks</p>
        <p className="lib-empty-formats">.epub · .txt · .md · .pdf · .mp3 · .m4b</p>
      </div>
    )
    const dragStyle = (id) => ({
      opacity: draggingId === id ? 0.35 : 1,
      outline: dropId === id ? '2px solid var(--accent)' : 'none',
      boxShadow: dropId === id ? '0 0 0 5px rgba(56,139,253,0.18)' : 'none',
      outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none',
      transform: dropId === id ? 'scale(0.95)' : 'scale(1)',
      transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s',
    })
    return [
      ...lib.map(b => (
        <div key={b.id}
          data-drag-item={b.id} data-drag-type={b.type === 'audio' ? 'audio' : 'book'}
          onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: 0, type: b.type === 'audio' ? 'audio' : 'book', id: b.id, title: b.title, startX: e.clientX, startY: e.clientY, dragging: false } }}
          style={dragStyle(b.id)}>
          {b.type === 'audio'
            ? <AudiobookCard book={b} onOpen={openAudio} onMenu={showAudioMenu} />
            : <BookCard book={b} onOpen={openBook} onMenu={showBookMenu} />}
        </div>
      )),
      ...nbs.map(nb => (
        <div key={nb.id}
          data-drag-item={nb.id} data-drag-type="nb"
          onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: 0, type: 'nb', id: nb.id, title: nb.title, nbKind: 'notebook', startX: e.clientX, startY: e.clientY, dragging: false } }}
          style={dragStyle(nb.id)}>
          <NotebookCard nb={nb} onOpen={openNotebook} onMenu={showNbMenu} />
        </div>
      )),
      ...sbs.map(sb => (
        <div key={sb.id}
          data-drag-item={sb.id} data-drag-type="nb"
          onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: 0, type: 'nb', id: sb.id, title: sb.title, nbKind: 'sketchbook', startX: e.clientX, startY: e.clientY, dragging: false } }}
          style={dragStyle(sb.id)}>
          <SketchbookCard sb={sb} onOpen={openSketchbook} onMenu={showSbMenu} />
        </div>
      )),
      ...fds.map(deck => (
        <div key={deck.id}
          data-drag-item={deck.id} data-drag-type="nb"
          onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: 0, type: 'nb', id: deck.id, title: deck.title, nbKind: 'flashcard', startX: e.clientX, startY: e.clientY, dragging: false } }}
          style={dragStyle(deck.id)}>
          <FlashcardDeckCard deck={deck} onOpen={openFlashcardDeck} onMenu={showDeckMenu} />
        </div>
      )),
    ]
  }

  function renderTab() {
    if (activeTab === 'library') {
      return (
        <div className="lib-tab-inner">
          <div className="library-grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))"}}>{renderAll()}</div>
        </div>
      )
    }
    if (activeTab === 'books') {
      return (
        <div className="lib-tab-inner">
          <div className="library-grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))"}}>
            {books.length ? books.map((b, i) => (
              <div key={b.id}
                data-drag-item={b.id} data-drag-type="book"
                onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: i, type: 'book', id: b.id, title: b.title, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === b.id ? 0.35 : 1, outline: dropId === b.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === b.id ? '0 0 0 5px rgba(56,139,253,0.18)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === b.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                <BookCard book={b} onOpen={openBook} onMenu={showBookMenu} />
              </div>
            )) : null}
          </div>
          {!books.length && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              <button className="lib-empty-plus" onClick={() => fileInputRef.current?.click()}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
              </button>
              <p className="lib-empty-hint">Click to add books, or right-click anywhere</p>
              <p className="lib-empty-formats">.epub · .txt · .md · .pdf</p>
            </div>
          )}
        </div>
      )
    }
    if (activeTab === 'audiobooks') {
      return (
        <div className="lib-tab-inner">
          <div className="library-grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))"}}>
            {audiobooks.length ? audiobooks.map((b, i) => (
              <div key={b.id}
                data-drag-item={b.id} data-drag-type="audio"
                onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: i, type: 'audio', id: b.id, title: b.title, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === b.id ? 0.35 : 1, outline: dropId === b.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === b.id ? '0 0 0 5px rgba(56,139,253,0.18)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === b.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
                <AudiobookCard book={b} onOpen={openAudio} onMenu={showAudioMenu} />
              </div>
            )) : null}
          </div>
          {!audiobooks.length && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              <button className="lib-empty-plus" onClick={() => audioInputRef.current?.click()}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
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
          <div className="library-grid" style={{gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))"}}>
            {combined.length ? combined.map((item, i) => (
              <div key={item.id}
                data-drag-item={item.id} data-drag-type="nb"
                onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); dragRef.current = { idx: i, type: 'nb', id: item.id, title: item.title, nbKind: item._kind, startX: e.clientX, startY: e.clientY, dragging: false } }}
                style={{ opacity: draggingId === item.id ? 0.35 : 1, outline: dropId === item.id ? '2px solid var(--accent)' : 'none', boxShadow: dropId === item.id ? '0 0 0 5px rgba(56,139,253,0.18)' : 'none', outlineOffset: 2, borderRadius: 10, cursor: 'grab', userSelect: 'none', transform: dropId === item.id ? 'scale(0.95)' : 'scale(1)', transition: 'transform 0.12s, box-shadow 0.12s, opacity 0.12s' }}>
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
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
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
        const colItems = [
          ...library.filter(i => col.items.includes(i.id)),
          ...notebooks.filter(n => col.items.includes(n.id)).map(n => ({ ...n, _isNotebook: true })),
          ...sketchbooks.filter(s => col.items.includes(s.id)).map(s => ({ ...s, _isSketchbook: true })),
          ...flashcardDecks.filter(d => col.items.includes(d.id)).map(d => ({ ...d, _isDeck: true })),
        ]
        return (
          <div className="lib-tab-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <button onClick={() => setActiveCollection(null)} style={{ padding: '4px 10px', fontSize: 11, border: '1px solid var(--border)', background: 'none', color: 'var(--textDim)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>&larr; Back</button>
              {col.color && <span style={{ width: 14, height: 14, borderRadius: 4, background: col.color }} />}
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{col.name}</span>
              <span style={{ fontSize: 11, color: 'var(--textDim)' }}>{colItems.length} items</span>
            </div>
            <div className="library-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))' }}>
              {colItems.map(item =>
                item._isDeck ? <FlashcardDeckCard key={item.id} deck={item} onOpen={openFlashcardDeck} onMenu={showDeckMenu} />
                : item._isSketchbook ? <SketchbookCard key={item.id} sb={item} onOpen={openSketchbook} onMenu={showSbMenu} />
                : item._isNotebook ? <NotebookCard key={item.id} nb={item} onOpen={openNotebook} onMenu={showNbMenu} />
                : item.type === 'audio' ? <AudiobookCard key={item.id} book={item} onOpen={openAudio} onMenu={showAudioMenu} />
                : <BookCard key={item.id} book={item} onOpen={openBook} onMenu={showBookMenu} />
              )}
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
            <div className="library-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 14 }}>
              {collections.map(col => {
                const colItems = [...library, ...notebooks.map(n => ({ ...n, _isNotebook: true })), ...sketchbooks.map(s => ({ ...s, _isSketchbook: true })), ...flashcardDecks.map(d => ({ ...d, _isDeck: true }))].filter(i => col.items.includes(i.id))
                const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
                return (
                  <div key={col.id}
                    data-collection-id={col.id}
                    style={{
                      background: dropId === col.id ? 'var(--accent)10' : 'var(--surfaceAlt)',
                      border: dropId === col.id ? '2px dashed var(--accent)' : '1px solid var(--border)', borderRadius: 10,
                      borderTop: dropId === col.id ? '2px dashed var(--accent)' : (col.color ? `3px solid ${col.color}` : '1px solid var(--border)'),
                      padding: 14, cursor: 'pointer', transition: 'border-color 0.12s, box-shadow 0.12s, background 0.12s',
                      display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120, position: 'relative',
                    }}
                    onClick={() => setActiveCollection(col.id)}
                    onMouseEnter={e => { if (!col.color && dropId !== col.id) e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)' }}
                    onMouseLeave={e => { if (!col.color && dropId !== col.id) e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.65 }}>
                          {/* Closed storage box with lid and label window */}
                          <rect x="3" y="11" width="18" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
                          <path d="M2 11h20V8a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                          <rect x="8" y="14" width="8" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.1"/>
                        </svg>
                      </span>
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
                          style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1, background: 'none', border: '1px solid var(--accent)', borderRadius: 4, padding: '1px 4px', outline: 'none', fontFamily: 'inherit' }}
                        />
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{col.name}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--textDim)' }}>
                      {colItems.length} item{colItems.length !== 1 ? 's' : ''}
                    </div>
                    {colItems.slice(0, 3).map(item => (
                      <div key={item.id} style={{ fontSize: 11, color: 'var(--textMuted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.title}
                      </div>
                    ))}
                    {/* Dots menu button — bottom right */}
                    <button onClick={e => {
                      e.stopPropagation()
                      setMenu({ x: e.clientX, y: e.clientY, items: [
                        { label: 'Edit Name', icon: '<path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>', action: () => {
                          setEditColId(col.id); setEditColName(col.name)
                        }},
                        { label: 'Change Color', icon: '<circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
                          submenu: COLLECTION_COLORS.map(c => ({
                            label: c,
                            action: () => { updateCollection(col.id, { color: c }); persistCollections() },
                          })),
                        },
                        { label: 'Delete Collection', icon: '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>', danger: true, action: () => { removeCollection(col.id); persistCollections() } },
                      ]})
                    }} style={{
                      position: 'absolute', bottom: 8, right: 8, width: 24, height: 24, borderRadius: 6,
                      border: 'none', background: 'none', color: 'var(--textDim)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4,
                      transition: 'opacity 0.12s, background 0.12s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--surface)' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.background = 'none' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {!collections.length && (
            <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10}}>
              <button className="lib-empty-plus" onClick={() => {
                const col = { id: makeId('col'), name: 'New Collection', items: [], createdAt: new Date().toISOString() }
                addCollection(col)
                persistCollections()
              }}>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><line x1="14" y1="4" x2="14" y2="24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="14" x2="24" y2="14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
              </button>
              <p className="lib-empty-hint">Create a collection to organize your library</p>
              <p className="lib-empty-formats">Group books, notes, and more</p>
            </div>
          )}
        </div>
      )
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
                  onDevCommand={cmd => { if (cmd === 'onboarding') setDevOnboardingOpen(true) }}
                  onOpenGraph={() => openNewTab({ view: 'graph' })}
                  onOpenCalendar={() => navigate({ view: 'calendar' })}
                  onReset={async () => {
                    setArchivePath('')
                    setOnboardingComplete(false)
                    await persistPreferences()
                    resetBaseDir()
                  }}
                  onClose={() => { setSearch(''); setSearchFocused(false) }}
                />
              )}
            </div>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button className="btn-add-square" onClick={() => setAddOpen(o => !o)} title="Add"><PlusIcon /></button>
              {addOpen && (
                <AddPopup
                  onClose={() => setAddOpen(false)}
                  onOpenNebuli={() => { openNewTab({ view: 'graph' }); setAddOpen(false) }}
                  onAddBook={() => fileInputRef.current?.click()}
                  onAddAudio={() => audioInputRef.current?.click()}
                  onNewNotebook={() => {
                    const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
                    addNotebook(nb)
                    persistNotebooks()
                    setActiveNotebook(nb)
                    if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'notebook', activeNotebook: nb })
                    setView('notebook')
                    setAddOpen(false)
                  }}
                  onNewSketchbook={() => {
                    const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
                    const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor(sketchbooks.length % COLORS.length)] }
                    addSketchbook(sb)
                    persistSketchbooks()
                    setActiveSketchbook(sb)
                    if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'sketchbook', activeSketchbook: sb })
                    setView('sketchbook')
                    setAddOpen(false)
                  }}
                  onNewFlashcardDeck={() => {
                    const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
                    const deck = {
                      id: makeId('deck'), title: 'Untitled Deck', cards: [],
                      color: COLORS[Math.floor(flashcardDecks.length % COLORS.length)],
                      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
                    }
                    addDeck(deck)
                    persistFlashcardDecks()
                    setActiveFlashcardDeck(deck)
                    if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'flashcard', activeFlashcardDeck: deck })
                    setView('flashcard')
                    setAddOpen(false)
                  }}
                  onNewCollection={() => {
                    const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
                    const col = {
                      id: makeId('col'),
                      name: 'New Collection',
                      items: [],
                      color: COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length],
                      createdAt: new Date().toISOString(),
                    }
                    addCollection(col)
                    persistCollections()
                    setActiveLibTab('collections')
                    if (paneTabId) useAppStore.getState().updateTab(paneTabId, { view: 'library', activeLibTab: 'collections' })
                    setAddOpen(false)
                  }}
                />
              )}
            </div>
          </div>

          {/* Settings + Profile */}
          <div className="header-right-actions">
            <button className="btn-icon-round" title="Profile" onClick={() => setProfileOpen(true)}><ProfileIcon /></button>
            <button className="sidenav-footer-btn" title="Settings" onClick={() => setSettingsOpen(true)}
              style={{ width: 30, height: 30, borderRadius: 8 }}>
              <SettingsIcon />
            </button>
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
      {editBookMeta && (
        <EditBookMetaModal book={editBookMeta} onClose={() => setEditBookMeta(null)}
          onSave={async (changes) => {
            updateBook(editBookMeta.id, changes)
            await persistLibrary()
            setEditBookMeta(null)
          }} />
      )}
      {libMenu && (
        <LibContextMenu x={libMenu.x} y={libMenu.y} onClose={() => setLibMenu(null)}
          onOpenNebuli={() => { openNewTab({ view: 'graph' }); setLibMenu(null) }}
          onAddBook={() => fileInputRef.current?.click()}
          onAddAudio={() => audioInputRef.current?.click()}
          onNewNotebook={() => {
            const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
            addNotebook(nb); persistNotebooks(); setActiveNotebook(nb); setView('notebook')
          }}
          onNewSketchbook={() => {
            const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
            const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor(sketchbooks.length % COLORS.length)] }
            addSketchbook(sb); persistSketchbooks(); setActiveSketchbook(sb); setView('sketchbook')
          }}
          onNewFlashcardDeck={() => {
            const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
            const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[Math.floor(flashcardDecks.length % COLORS.length)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            addDeck(deck); persistFlashcardDecks(); setActiveFlashcardDeck(deck); setView('flashcard')
          }}
          onNewCollection={() => {}}
        />
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