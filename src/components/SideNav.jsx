import { useEffect, useLayoutEffect, useRef, useState, useContext, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { PaneContext } from '@/lib/PaneContext'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor, makeId } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import { resetBaseDir, loadLibrary, loadNotebooksMeta, loadSketchbooksMeta, getJSON } from '@/lib/storage'
import { Toggle, Slider } from '@/components/Controls'
import { IconQuill } from '@/components/icons'

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
)

const ChevronIcon = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
    style={{ transition: 'transform 0.18s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}>
    <path d="M3.5 2L7 5l-3.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const SettingsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
    <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.3 3.3l.7.7M12 12l.7.7M12 3.3l-.7.7M4 12l-.7.7"
      stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </svg>
)

const NAV_ITEMS = [
  {
    id: 'library', label: 'Library',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    id: 'books', label: 'Books',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'audiobooks', label: 'Audiobooks',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'notebooks', label: 'Notebooks',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'collections', label: 'Collections',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.4"/>
        <rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        <rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.1"/>
      </svg>
    ),
  },
]

const VIEW_LABELS = {
  library: 'Library',
  reader: 'Reading',
  'audio-player': 'Listening',
  notebook: 'Notebook',
  pdf: 'PDF',
  sketchbook: 'Sketchbook',
  flashcard: 'Flashcards',
  graph: 'Graph',
  calendar: 'Calendar',
  kanban: 'Tasks',
  plugins: 'Plugins',
}

function getTabLabel(tab, { notebooks = [], flashcardDecks = [], sketchbooks = [], library = [] } = {}) {
  if (tab.activeBook && (tab.view === 'reader' || tab.view === 'pdf')) {
    const live = library.find(b => b.id === tab.activeBook.id)
    return live?.title || tab.activeBook.title || VIEW_LABELS[tab.view] || tab.view
  }
  if (tab.activeNotebook && tab.view === 'notebook') {
    const live = notebooks.find(n => n.id === tab.activeNotebook.id)
    return live?.title || tab.activeNotebook.title || 'Notebook'
  }
  if (tab.activeAudioBook && tab.view === 'audio-player') {
    const live = library.find(b => b.id === tab.activeAudioBook.id)
    return live?.title || tab.activeAudioBook.title || 'Listening'
  }
  if (tab.activeSketchbook && tab.view === 'sketchbook') {
    const live = sketchbooks.find(s => s.id === tab.activeSketchbook.id)
    return live?.title || tab.activeSketchbook.title || 'Sketchbook'
  }
  if (tab.activeFlashcardDeck && tab.view === 'flashcard') {
    const live = flashcardDecks.find(d => d.id === tab.activeFlashcardDeck.id)
    return live?.title || tab.activeFlashcardDeck.title || 'Flashcards'
  }
  return VIEW_LABELS[tab.view] || tab.view
}

// 10% narrower than original 264
const SIDEBAR_WIDTH = 238

// ─────────────────────────────────────────────────────────────────────────────
// MiniCover — slightly taller on mobile for easier touch navigation
// ─────────────────────────────────────────────────────────────────────────────
function MiniCover({ item }) {
  const isMobile = useIsMobile()
  const [c1, c2] = generateCoverColor(item.title)
  const isAudio = item.type === 'audio'
  return (
    <div style={{
      width: 20, height: isMobile ? 34 : 28, borderRadius: 4, flexShrink: 0,
      overflow: 'hidden', position: 'relative',
      background: item._isNotebook || item._isSketchbook
        ? (item.coverColor || '#1a1a2e')
        : `linear-gradient(135deg,${c1},${c2})`,
      boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
    }}>
      {item.coverDataUrl
        ? <img src={item.coverDataUrl} alt="" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
          }}>
            {isAudio ? '♪' : ''}
          </div>
      }
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NavDropdown — 10% shorter vertical padding on rows
// ─────────────────────────────────────────────────────────────────────────────
function NavDropdown({ items, onOpen, onMenu, onReorder, activeId }) {
  const [draggingId, setDraggingId] = useState(null)
  const [dropId,     setDropId]     = useState(null)
  const dragRef = useRef(null) // { idx, id, startX, startY, dragging }
  const onReorderRef = useRef(onReorder)
  useEffect(() => { onReorderRef.current = onReorder }, [onReorder])

  // Pointer-based drag for sidebar items (HTML5 drag API unreliable in Tauri/WebKit)
  useEffect(() => {
    function getNavRow(x, y) {
      const draggingEl = document.querySelector('[data-nav-dragging="true"]')
      if (draggingEl) draggingEl.style.pointerEvents = 'none'
      const el = document.elementFromPoint(x, y)
      if (draggingEl) draggingEl.style.pointerEvents = ''
      return el?.closest('[data-nav-item]')
    }
    function onMove(e) {
      const d = dragRef.current
      if (!d) return
      if (!d.dragging) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
          d.dragging = true
          setDraggingId(d.id)
        }
        return
      }
      const row = getNavRow(e.clientX, e.clientY)
      if (row && row.dataset.navItem !== d.id) setDropId(row.dataset.navItem)
      else setDropId(null)
    }
    function onUp(e) {
      const d = dragRef.current
      if (!d) { setDraggingId(null); setDropId(null); return }
      dragRef.current = null
      if (!d.dragging) { setDraggingId(null); setDropId(null); return }
      const row = getNavRow(e.clientX, e.clientY)
      if (row && row.dataset.navItem !== d.id && onReorderRef.current) {
        const toIdx = parseInt(row.dataset.navIdx, 10)
        if (!isNaN(toIdx)) onReorderRef.current(d.idx, toIdx, d.id, row.dataset.navItem)
      }
      setDraggingId(null)
      setDropId(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!items.length) return (
    <div style={{ padding: '5px 16px 8px 38px', fontSize: 11, color: 'var(--textDim)', fontStyle: 'italic' }}>
      Nothing here yet
    </div>
  )

  const fmtLabel = (item) => {
    if (item._isSketchbook) return 'SKETCH'
    if (item._isNotebook)   return 'NOTE'
    if (item.type === 'audio') return 'AUDIO'
    const f = item.format?.toUpperCase()
    return f === 'EPUB3' ? 'EPUB' : (f || 'TXT')
  }

  return (
    <div style={{ paddingBottom: 2 }}>
      {items.map((item, i) => (
        <div key={item.id}
          data-nav-item={item.id} data-nav-idx={i}
          data-nav-dragging={draggingId === item.id ? 'true' : undefined}
          onMouseDown={onReorder ? e => {
            if (e.button !== 0) return
            e.preventDefault()
            dragRef.current = { idx: i, id: item.id, startX: e.clientX, startY: e.clientY, dragging: false }
          } : undefined}
          style={{
            display:'flex', alignItems:'center', position:'relative',
            opacity: draggingId === item.id ? 0.4 : 1,
            background: dropId === item.id ? 'var(--accent)18' : activeId === item.id ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
            borderLeft: dropId === item.id ? '2px solid var(--accent)' : activeId === item.id ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: onReorder ? 'grab' : undefined,
          }}
          onMouseEnter={e => { if (dropId !== item.id && activeId !== item.id) e.currentTarget.style.background='var(--hover)' }}
          onMouseLeave={e => { if (dropId !== item.id) e.currentTarget.style.background= activeId === item.id ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'none' }}
        >
          <button
            onClick={() => onOpen(item)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, flex:1,
              padding: '2px 6px 2px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              textAlign: 'left', minWidth:0,
            }}
          >
            <MiniCover item={item} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.3,
              }}>{item.title}</div>
              {item._isNotebook && item.dueDate ? (() => {
                try {
                  const d = new Date(item.dueDate)
                  const now = new Date()
                  const diffMs = d - now
                  const overdue = diffMs < 0
                  const today = !overdue && diffMs < 86400000
                  const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' })
                  const h = d.getHours(), m = d.getMinutes()
                  const timeStr = (h || m) ? ` @${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` : ''
                  const col = overdue ? '#ff8080' : today ? '#ffc060' : '#a0b8ff'
                  return (
                    <div style={{ fontSize:10, color: col, marginTop:1, fontWeight:600,
                      whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {dateStr}{timeStr}
                    </div>
                  )
                } catch { return null }
              })() : item.author ? (
                <div style={{
                  fontSize: 10, color: 'var(--textDim)', marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{item.author}</div>
              ) : null}
              {/* Progress bar for books/audiobooks */}
              {(() => {
                const pct = item.type === 'audio'
                  ? (item.listenProgress ? Math.round(item.listenProgress * 100) : 0)
                  : (item.totalChapters > 1 ? Math.round(((item.currentChapter || 0) / (item.totalChapters - 1)) * 100) : 0)
                return pct > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <div style={{ flex: 1, height: 2, borderRadius: 1, background: 'var(--borderSubtle)', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 1, background: 'var(--accent)' }} />
                    </div>
                    <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--textDim)', flexShrink: 0 }}>{pct}%</span>
                  </div>
                ) : null
              })()}
            </div>
            <div style={{
              fontSize: 9, fontWeight: 700, color: 'var(--textDim)',
              letterSpacing: '0.05em', flexShrink: 0,
              background: 'var(--surfaceAlt)', borderRadius: 3,
              padding: '2px 4px', border: '1px solid var(--borderSubtle)',
            }}>
              {fmtLabel(item)}
            </div>
          </button>
          {/* Dots menu button */}
          <button
            onClick={e => { e.stopPropagation(); onMenu && onMenu(e, item) }}
            title="More options"
            style={{
              width:24, height:24, borderRadius:5, flexShrink:0, marginRight:6,
              border:'none', background:'none', color:'var(--textDim)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center',
              opacity:0, transition:'opacity 0.1s, background 0.1s',
            }}
            onMouseEnter={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.opacity='1'}}
            onMouseLeave={e=>{e.currentTarget.style.background='none';e.currentTarget.style.opacity='0'}}
            ref={el => { if (el) { const p = el.closest('div[style]'); if (p) { p.addEventListener('mouseenter', ()=>el.style.opacity='1'); p.addEventListener('mouseleave', ()=>el.style.opacity='0') } } }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/>
            </svg>
          </button>
        </div>
      ))}
      {/* Hover preview removed per user request */}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SidebarAddPopup — same style as library add popup
// ─────────────────────────────────────────────────────────────────────────────
function SidebarAddPopup({ onClose, onAddBook, onAddAudio, addNotebook, setActiveNotebook, setView, closeSideNav }) {
  const choices = [
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
      label: 'Import Book',
      sub: 'EPUB · TXT · PDF',
      action: () => { onAddBook(); onClose() },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      label: 'Import Audiobook',
      sub: 'MP3 · M4B · FLAC',
      action: () => { onAddAudio(); onClose() },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
      label: 'New Notebook',
      sub: 'Markdown · live preview',
      action: () => {
        const s = useAppStore.getState()
        const nb = { id: makeId('nb'), title: 'Untitled Note', wordCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        addNotebook(nb); s.persistNotebooks()
        if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, nb.id); s.persistCollections() }
        setActiveNotebook(nb); setView('notebook')
        onClose(); closeSideNav()
      },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 3H3a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 3 15h10a1.5 1.5 0 0 0 1.5-1.5V7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M14.5 1.5a1.5 1.5 0 0 1 0 2.12L9 9l-3 .5.5-3 5.88-5.88a1.5 1.5 0 0 1 2.12 0z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      label: 'New Sketchbook',
      sub: 'Excalidraw canvas',
      action: () => {
        const s = useAppStore.getState()
        const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
        const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[Math.floor((s.sketchbooks?.length || 0) % COLORS.length)] }
        s.addSketchbook?.(sb); s.persistSketchbooks?.()
        if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, sb.id); s.persistCollections() }
        s.setActiveSketchbook?.(sb)
        setView('sketchbook'); onClose(); closeSideNav()
      },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="5" y="6" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
      label: 'New Flashcard Deck',
      sub: 'Spaced repetition',
      action: () => {
        const s = useAppStore.getState()
        const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
        const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[Math.floor((s.flashcardDecks?.length || 0) % COLORS.length)], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        s.addDeck?.(deck); s.persistFlashcardDecks?.()
        if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, deck.id); s.persistCollections() }
        s.setActiveFlashcardDeck?.(deck)
        setView('flashcard'); onClose(); closeSideNav()
      },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.1"/></svg>,
      label: 'New Collection',
      sub: 'Group items',
      action: () => {
        const s = useAppStore.getState()
        const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
        const col = { id: makeId('col'), name: 'New Collection', items: [], color: COLLECTION_COLORS[(s.collections?.length || 0) % COLLECTION_COLORS.length], createdAt: new Date().toISOString() }
        s.addCollection(col); s.persistCollections()
        s.setActiveLibTab('collections')
        setView('library')
        onClose(); closeSideNav()
      },
    },
  ]

  return (
    <div
      style={{
        position: 'absolute', bottom: 40, right: 0,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '6px 0', minWidth: 220,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)', zIndex: 20,
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--textDim)', padding: '6px 14px 4px', opacity: 0.6 }}>Add to Library</div>
      {choices.map(({ icon, label, sub, action }) => (
        <button key={label} onClick={action} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '8px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text)', fontSize: 12, fontWeight: 500,
          transition: 'background 0.1s', textAlign: 'left',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <span style={{ color: 'var(--textDim)', display: 'flex', flexShrink: 0 }}>{icon}</span>
          <div>
            <div>{label}</div>
            {sub && <div style={{ fontSize: 10, color: 'var(--textDim)', marginTop: 1 }}>{sub}</div>}
          </div>
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CollectionSwitcher — Zen-Browser-style workspace switcher at the bottom of the sidebar
// ─────────────────────────────────────────────────────────────────────────────
function CollectionSwitcher({ collections, activeCollectionId, onSwitch }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef()

  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e) { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false) }
    setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const workspaces = [
    { id: null, name: 'Home', color: null },
    ...collections.filter(c => !c.parentId),
  ]
  const currentIdx = activeCollectionId
    ? workspaces.findIndex(w => w.id === activeCollectionId)
    : 0
  const safeIdx = Math.max(0, currentIdx)
  const current = workspaces[safeIdx] || workspaces[0]

  function go(delta) {
    const nextIdx = ((safeIdx + delta) + workspaces.length) % workspaces.length
    onSwitch(workspaces[nextIdx].id)
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {/* Collection picker popup */}
      {pickerOpen && (
        <div ref={pickerRef} style={{
          position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 4,
          background: 'var(--bg)', border: '1px solid var(--borderSubtle)',
          borderRadius: 10, padding: '6px 0', zIndex: 50,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--textDim)', padding: '4px 12px 6px', opacity: 0.6 }}>Collections</div>
          {workspaces.map(ws => {
            const active = ws.id === activeCollectionId || (!ws.id && !activeCollectionId)
            return (
              <button key={ws.id ?? '__home__'} onClick={() => { onSwitch(ws.id); setPickerOpen(false) }} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 12px', background: active ? 'var(--accent)14' : 'none',
                border: 'none', cursor: 'pointer', color: active ? 'var(--accent)' : 'var(--text)',
                fontSize: 12, fontWeight: active ? 700 : 500, fontFamily: 'inherit', textAlign: 'left',
                transition: 'background 0.1s',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}
              >
                {ws.emoji
                  ? <span style={{ fontSize: 13, flexShrink: 0 }}>{ws.emoji}</span>
                  : ws.color
                    ? <span style={{ width: 10, height: 10, borderRadius: 3, background: ws.color, flexShrink: 0 }} />
                    : <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M2 8L8 2l6 6v6H10V11H6v3H2V8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                      </svg>
                }
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
                {active && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>}
              </button>
            )
          })}
        </div>
      )}

      {/* Switcher row */}
      <div style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 4px', gap: 2 }}>
        {/* Prev arrow */}
        <button onClick={() => go(-1)} disabled={workspaces.length <= 1} style={{
          width: 26, height: 26, borderRadius: 6, border: 'none', background: 'none',
          color: 'var(--textDim)', cursor: workspaces.length > 1 ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          opacity: workspaces.length <= 1 ? 0.3 : 1, transition: 'background 0.1s, opacity 0.1s',
        }}
          onMouseEnter={e => { if (workspaces.length > 1) e.currentTarget.style.background = 'var(--hover)' }}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M5.5 1.5L2.5 4.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Center: icon + name */}
        <button onClick={() => setPickerOpen(o => !o)} style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
          background: pickerOpen ? 'var(--hover)' : 'none', border: 'none', cursor: 'pointer',
          borderRadius: 6, padding: '4px 6px', fontFamily: 'inherit', transition: 'background 0.1s',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
          onMouseLeave={e => { if (!pickerOpen) e.currentTarget.style.background = 'none' }}
        >
          {current.emoji
            ? <span style={{ fontSize: 14, flexShrink: 0 }}>{current.emoji}</span>
            : current.color
              ? <span style={{ width: 10, height: 10, borderRadius: 3, background: current.color, flexShrink: 0 }} />
              : <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--textDim)' }}>
                  <path d="M2 8L8 2l6 6v6H10V11H6v3H2V8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
          }
          <span style={{
            fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: current.color || 'var(--text)',
          }}>{current.name}</span>
          {workspaces.length > 1 && (
            <span style={{ fontSize: 9, color: 'var(--textDim)', flexShrink: 0 }}>{safeIdx + 1}/{workspaces.length}</span>
          )}
        </button>

        {/* Next arrow */}
        <button onClick={() => go(1)} disabled={workspaces.length <= 1} style={{
          width: 26, height: 26, borderRadius: 6, border: 'none', background: 'none',
          color: 'var(--textDim)', cursor: workspaces.length > 1 ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          opacity: workspaces.length <= 1 ? 0.3 : 1, transition: 'background 0.1s, opacity 0.1s',
        }}
          onMouseEnter={e => { if (workspaces.length > 1) e.currentTarget.style.background = 'var(--hover)' }}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M3.5 1.5L6.5 4.5l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings helper components — defined at module scope (not inside render)
// ─────────────────────────────────────────────────────────────────────────────
function SettingsRow({ label, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--borderSubtle)', gap: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--textDim)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function SettingsSectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--textDim)', opacity: 0.55, marginTop: 16, marginBottom: 2 }}>
      {children}
    </div>
  )
}

// ── Piper TTS settings helpers ────────────────────────────────────────────────
function PiperVoiceSelect({ pref }) {
  const [voices, setVoices] = useState([])
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('piper_list_voices').then(setVoices).catch(() => setVoices([]))
    })
  }, [])
  if (!voices.length) return <span style={{ fontSize: 11, color: 'var(--textDim)' }}>No models found</span>
  return (
    <select className="gnos-select" value={useAppStore.getState().ttsVoice || voices[0]}
      onChange={e => pref('ttsVoice', e.target.value)}>
      {voices.map(v => <option key={v} value={v}>{v}</option>)}
    </select>
  )
}
function PiperStatusRow() {
  const [installed, setInstalled] = useState(null)
  const [showGuide, setShowGuide] = useState(false)
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('piper_check').then(setInstalled).catch(() => setInstalled(false))
    })
  }, [])

  const openDownload = () => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('plugin:shell|open', { path: 'https://github.com/rhasspy/piper/releases' }).catch(() => {
        window.open('https://github.com/rhasspy/piper/releases', '_blank')
      })
    })
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ padding: '8px 12px', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--textDim)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>
          {installed === null ? 'Checking Piper…' : installed
            ? '✓ Piper is installed'
            : 'Piper not found'}
        </span>
        {!installed && installed !== null && (
          <button onClick={openDownload} style={{ padding: '3px 10px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Download Piper
          </button>
        )}
        <button onClick={() => setShowGuide(!showGuide)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', fontSize: 10, color: 'var(--textDim)', cursor: 'pointer' }}>
          {showGuide ? 'Hide' : 'Setup Guide'}
        </button>
      </div>
      {showGuide && (
        <div style={{ marginTop: 6, padding: '10px 12px', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--textDim)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>Installation Steps:</div>
          <ol style={{ margin: '0 0 0 16px', padding: 0 }}>
            <li>Download the Piper release for your OS from GitHub</li>
            <li>Extract the archive and find the <code>piper</code> binary</li>
            <li>Place it in your app data folder: <code>piper/piper</code></li>
            <li>Download voice models (.onnx + .onnx.json) from the Piper voices page</li>
            <li>Place voice files in: <code>piper/models/</code></li>
            <li>Restart Gnos and select your voice above</li>
          </ol>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// UniversalSettingsModal — tabbed settings for all views
// ─────────────────────────────────────────────────────────────────────────────
export function UniversalSettingsModal({ onClose }) {
  const isMobile = useIsMobile()
  const [tab, setTab] = useState('appearance')
  const [zenMode, setZenModeLocal] = useState(false)

  // Sync zenMode with a custom event so App.jsx can respond
  function toggleZenMode() {
    const next = !zenMode
    setZenModeLocal(next)
    window.dispatchEvent(new CustomEvent('gnos:zen-mode', { detail: { enabled: next } }))
  }

  const setPref            = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)
  const openOnCreate       = useAppStore(s => s.openOnCreate)
  const fontSize           = useAppStore(s => s.fontSize)
  const lineSpacing        = useAppStore(s => s.lineSpacing)
  const fontFamily         = useAppStore(s => s.fontFamily)
  const justifyText        = useAppStore(s => s.justifyText)
  const tapToTurn          = useAppStore(s => s.tapToTurn)
  const twoPage            = useAppStore(s => s.twoPage)
  const highlightWords     = useAppStore(s => s.highlightWords)
  const underlineLine      = useAppStore(s => s.underlineLine)
  const themeKey           = useAppStore(s => s.themeKey)
  const customThemes       = useAppStore(s => s.customThemes)
  const library            = useAppStore(s => s.library)
  const persistLibrary     = useAppStore(s => s.persistLibrary)
  const addBook            = useAppStore(s => s.addBook)
  const archivePath        = useAppStore(s => s.archivePath)
  const quickNoteDir       = useAppStore(s => s.quickNoteDir)
  const quickNoteFanEnabled = useAppStore(s => s.quickNoteFanEnabled)
  const setArchivePath     = useAppStore(s => s.setArchivePath)
  const setLibraryStore    = useAppStore(s => s.setLibrary)
  const setNotebooksStore  = useAppStore(s => s.setNotebooks)
  const setSketchbooksStore= useAppStore(s => s.setSketchbooks)
  const setFlashcardDecksStore = useAppStore(s => s.setFlashcardDecks)
  const setCollectionsStore= useAppStore(s => s.setCollections)
  const [switchingArchive, setSwitchingArchive] = useState(false)

  async function handleSwitchArchive() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { exists, mkdir, readDir, readTextFile } = await import('@tauri-apps/plugin-fs')
      const { join } = await import('@tauri-apps/api/path')
      const sel = await open({ directory: true, multiple: false, title: 'Select Archive Folder' })
      if (!sel) return
      setSwitchingArchive(true)
      setArchivePath(sel)
      resetBaseDir()
      // Ensure expected subdirs exist
      for (const sub of ['books', 'notebooks', 'sketches', 'audio']) {
        const subPath = await join(sel, sub)
        if (!(await exists(subPath))) await mkdir(subPath, { recursive: true })
      }
      // Scan + load all data from new archive
      let lib = await loadLibrary()
      const indexedIds = new Set(lib.map(b => b.id))
      const booksDir = await join(sel, 'books')
      if (await exists(booksDir)) {
        const entries = await readDir(booksDir)
        for (const entry of entries) {
          if (!entry.name) continue
          try {
            const metaPath = await join(booksDir, entry.name, 'meta.json')
            if (await exists(metaPath)) {
              const meta = JSON.parse(await readTextFile(metaPath))
              if (meta.id && !indexedIds.has(meta.id)) { lib = [...lib, meta]; indexedIds.add(meta.id) }
            }
          } catch { /* skip */ }
        }
      }
      const notebooks    = await loadNotebooksMeta()
      const sketchbooks  = await loadSketchbooksMeta()
      const flashcardDecks = await getJSON('flashcard_decks', [])
      const collections  = await getJSON('collections_meta', [])
      setLibraryStore(lib)
      setNotebooksStore(notebooks)
      setSketchbooksStore(sketchbooks)
      setFlashcardDecksStore(flashcardDecks)
      setCollectionsStore(collections)
      await persistPreferences()
    } catch (e) {
      console.error('Switch archive failed:', e)
    } finally {
      setSwitchingArchive(false)
    }
  }

  const importInputRef = useRef()
  const themeInputRef  = useRef()
  const fileInputRef   = useRef()

  function pref(key, val) { setPref(key, val); persistPreferences() }

  const TABS = [
    { id: 'appearance', label: 'Appearance' },
    { id: 'library',    label: 'Archive' },
    { id: 'reader',     label: 'Reader' },
    { id: 'notebook',   label: 'Notebook' },
    { id: 'audio',      label: 'Audio' },
    { id: 'calendar',   label: 'Calendar' },
    { id: 'plugins',    label: 'Plugins' },
  ]

  const BUILT_IN_THEMES_LOCAL = {
    sepia:  { name: 'Coffee', bg: '#faf8f5', surface: '#ffffff', accent: '#8b5e3c' },
    dark:   { name: 'Dark',   bg: '#0d1117', surface: '#161b22', accent: '#388bfd' },
    light:  { name: 'Light',  bg: '#f6f8fa', surface: '#ffffff', accent: '#0969da' },
    cherry: { name: 'Cherry', bg: '#0e0608', surface: '#170b0d', accent: '#e05c7a' },
    sunset: { name: 'Sunset', bg: '#0f0a04', surface: '#1a1008', accent: '#e8922a' },
    moss:   { name: 'Moss',   bg: '#eef3e8', surface: '#f5f9f0', accent: '#3d6e32' },
  }
  const allThemes = { ...BUILT_IN_THEMES_LOCAL, ...customThemes }


  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={isMobile ? undefined : onClose}>
      <div style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: isMobile ? 0 : 14,
        width: isMobile ? '100vw' : 620,
        maxWidth: isMobile ? '100%' : '95vw',
        height: isMobile ? '100vh' : 460,
        maxHeight: isMobile ? '100%' : '90vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 12px', borderBottom: '1px solid var(--borderSubtle)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Settings</span>
          <button onClick={onClose} title="Close" style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}} onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}><svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
        </div>

        {/* Tab strip */}
        <div style={{ display:'flex', gap:0, padding:'0 12px', borderBottom:'1px solid var(--borderSubtle)', flexShrink:0, overflow:'hidden' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:'7px 10px', background:'none', border:'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--textDim)',
              fontSize:11, fontWeight:600, cursor:'pointer', transition:'color 0.12s',
              marginBottom:-1, whiteSpace:'nowrap', flexShrink:0,
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 20px 20px' }}>

          {tab === 'appearance' && (
            <>
              <SettingsSectionLabel>Theme</SettingsSectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, marginBottom: 4 }}>
                {Object.entries(allThemes).map(([k, t]) => (
                  <label key={k} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderRadius: 8, cursor: 'pointer',
                    border: themeKey === k ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: themeKey === k ? 'rgba(56,139,253,0.06)' : 'transparent',
                  }}>
                    <input type="radio" name="theme" value={k} checked={themeKey === k}
                      onChange={() => { pref('themeKey', k); useAppStore.getState().setTheme?.(k) }}
                      style={{ display: 'none' }} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['bg', 'surface', 'accent'].map(p => (
                        <div key={p} style={{ width: 14, height: 14, borderRadius: 3, background: t[p] || '#888', border: '1px solid rgba(255,255,255,0.1)' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{t.name}</span>
                    {k.startsWith('custom_') && <span style={{ fontSize: 10, color: 'var(--textDim)' }}>Custom</span>}
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 12, paddingTop: 4, borderTop: '1px solid var(--borderSubtle)' }}>
                <button style={{ fontSize: 12, color: 'var(--textDim)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}
                  onClick={() => themeInputRef.current?.click()}>
                  Import custom theme (.json)
                </button>
                <input ref={themeInputRef} type="file" accept=".json" style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files[0]; if (!file) return
                    try {
                      const p = JSON.parse(await file.text())
                      if (p.name && p.bg && p.text) {
                        const k = `custom_${Date.now()}`
                        const next = { ...customThemes, [k]: p }
                        setPref('customThemes', next)
                        useAppStore.getState().setTheme?.(k)
                        await persistPreferences()
                      }
                    } catch { alert('Invalid theme file') }
                    e.target.value = ''
                  }} />
              </div>

              <SettingsSectionLabel>Focus</SettingsSectionLabel>
              <SettingsRow label="Zen Mode" desc="Hide the title bar and view headers. Move mouse to top edge to reveal. Toggle with Cmd+Shift+F">
                <Toggle on={zenMode} onChange={toggleZenMode} />
              </SettingsRow>

              <SettingsSectionLabel>Typography</SettingsSectionLabel>
              <SettingsRow label="Font Size" desc={`${fontSize}px`}>
                <Slider min={14} max={28} step={1} value={fontSize}
                  onChange={v => pref('fontSize', v)} style={{ width: 110 }} />
              </SettingsRow>
              <SettingsRow label="Line Spacing" desc={String(lineSpacing)}>
                <Slider min={1.4} max={2.4} step={0.1} value={lineSpacing}
                  onChange={v => pref('lineSpacing', v)} style={{ width: 110 }} />
              </SettingsRow>
              <SettingsRow label="Font">
                <select className="gnos-select" value={fontFamily} onChange={e => pref('fontFamily', e.target.value)}>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Palatino Linotype', serif">Palatino</option>
                  <option value="'Times New Roman', serif">Times New Roman</option>
                  <option value="'Baskerville', serif">Baskerville</option>
                  <option value="'Garamond', serif">Garamond</option>
                  <option value="'Charter', serif">Charter</option>
                  <option value="'Bookman Old Style', serif">Bookman</option>
                  <option value="system-ui, sans-serif">System UI</option>
                  <option value="'Helvetica Neue', Helvetica, sans-serif">Helvetica</option>
                  <option value="'Avenir Next', 'Avenir', sans-serif">Avenir</option>
                  <option value="'SF Pro Text', system-ui, sans-serif">SF Pro</option>
                  <option value="'Segoe UI', sans-serif">Segoe UI</option>
                  <option value="'Literata', Georgia, serif">Literata</option>
                  <option value="'Merriweather', Georgia, serif">Merriweather</option>
                  <option value="'Lora', Georgia, serif">Lora</option>
                  <option value="'Inter', system-ui, sans-serif">Inter</option>
                  <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                  <option value="'SF Mono', Menlo, monospace">SF Mono</option>
                </select>
              </SettingsRow>
            </>
          )}

          {tab === 'library' && (
            <>
              <SettingsSectionLabel>Creation</SettingsSectionLabel>
              <SettingsRow label="Open on create" desc="Automatically open new notebooks, sketchbooks, and decks when created">
                <Toggle on={openOnCreate !== false} onChange={() => pref('openOnCreate', openOnCreate === false)} />
              </SettingsRow>
              <SettingsSectionLabel>Discover Books</SettingsSectionLabel>
              <a href="https://www.gutenberg.org" target="_blank" rel="noopener" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 8, marginBottom: 6, textDecoration: 'none', color: 'var(--text)',
                transition: 'border-color 0.15s',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink:0 }}>
                  <rect x="3" y="2" width="5" height="16" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                  <rect x="10" y="2" width="5" height="16" rx="1" stroke="currentColor" strokeWidth="1.4"/>
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Project Gutenberg</div>
                  <div style={{ fontSize: 11, color: 'var(--textDim)' }}>Free public domain ebooks — 70,000+ titles</div>
                </div>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
              <a href="https://librivox.org" target="_blank" rel="noopener" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 8, marginBottom: 6, textDecoration: 'none', color: 'var(--text)',
                transition: 'border-color 0.15s',
              }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink:0 }}>
                  <path d="M4 8h3l3.5-4.5v13L7 12H4V8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                  <path d="M13 6.5c1 .9 1.6 2.1 1.6 3.5s-.6 2.6-1.6 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>LibriVox</div>
                  <div style={{ fontSize: 11, color: 'var(--textDim)' }}>Free public domain audiobooks — 20,000+ titles</div>
                </div>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>

              <SettingsSectionLabel>Archive Location</SettingsSectionLabel>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '9px 12px', marginBottom: 8,
              }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--textDim)' }}>
                  <path d="M1 4a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 11, color: 'var(--textDim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {archivePath || 'No archive selected'}
                </span>
              </div>
              <button
                onClick={handleSwitchArchive}
                disabled={switchingArchive}
                style={{
                  width: '100%', padding: '8px 0', marginBottom: 12,
                  background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                  borderRadius: 7, color: 'var(--text)', fontSize: 12,
                  fontWeight: 500, cursor: switchingArchive ? 'wait' : 'pointer',
                  fontFamily: 'inherit', opacity: switchingArchive ? 0.6 : 1,
                }}>
                {switchingArchive ? 'Switching…' : '⇄ Switch Archive'}
              </button>

              <SettingsSectionLabel>Quick Note</SettingsSectionLabel>
              <div style={{ fontSize: 12, color: 'var(--textDim)', marginBottom: 10, lineHeight: 1.6 }}>
                Press <strong>⌥N</strong> anywhere to summon the quick note popup.
                Notes save into your archive as notebooks, or into a folder you pick.
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '9px 12px', marginBottom: 8,
              }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: 'var(--textDim)' }}>
                  <path d="M1 4a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 11, color: 'var(--textDim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {quickNoteDir || 'Archive (default)'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  onClick={async () => {
                    try {
                      const { open } = await import('@tauri-apps/plugin-dialog')
                      const sel = await open({ directory: true, multiple: false, title: 'Quick Note Folder' })
                      if (sel) pref('quickNoteDir', sel)
                    } catch (e) { console.error('Quick note folder pick failed:', e) }
                  }}
                  style={{ flex: 1, padding: '8px 0', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>
                  Choose Folder…
                </button>
                <button
                  onClick={() => pref('quickNoteDir', '')}
                  style={{ flex: 1, padding: '8px 0', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }}>
                  Use Archive
                </button>
              </div>
              <SettingsRow label="Show fanned card peek" desc="Show the stacked cards peeking behind the active quick note">
                <Toggle on={quickNoteFanEnabled !== false} onChange={() => pref('quickNoteFanEnabled', quickNoteFanEnabled === false)} />
              </SettingsRow>

              <SettingsSectionLabel>Archive Data</SettingsSectionLabel>
              <div style={{ fontSize: 12, color: 'var(--textDim)', marginBottom: 10, lineHeight: 1.6 }}>
                Export your archive as <strong>gnos-library.json</strong> to back it up.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button style={{ flex: 1, padding: '8px 0', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({ _readme: 'Gnos Archive', books: library }, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    Object.assign(document.createElement('a'), { href: url, download: 'gnos-library.json' }).click()
                    URL.revokeObjectURL(url)
                  }}>↓ Export</button>
                <button style={{ flex: 1, padding: '8px 0', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 7, color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}
                  onClick={() => importInputRef.current?.click()}>↑ Import</button>
              </div>
              <input ref={fileInputRef} type="file" accept=".epub,.txt,.md,.pdf" multiple style={{ display: 'none' }}
                onChange={async e => {
                  const { importBooks } = await import('@/lib/bookImport')
                  const { added } = await importBooks(e.target.files)
                  for (const book of added) addBook(book)
                  if (added.length) await persistLibrary()
                  e.target.value = ''
                }} />
              <input ref={importInputRef} type="file" accept=".json" style={{ display: 'none' }}
                onChange={async e => {
                  const file = e.target.files[0]; if (!file) return
                  try {
                    const d = JSON.parse(await file.text())
                    if (Array.isArray(d.books)) {
                      const ids = new Set(library.map(b => b.id))
                      d.books.filter(b => !ids.has(b.id)).forEach(b => addBook(b))
                      await persistLibrary()
                    }
                  } catch { alert('Invalid archive file') }
                  e.target.value = ''
                }} />
            </>
          )}

          {tab === 'reader' && (
            <>
              <SettingsSectionLabel>Layout</SettingsSectionLabel>
              <SettingsRow label="Justify text">
                <Toggle on={justifyText !== false} onChange={() => pref('justifyText', justifyText === false)} />
              </SettingsRow>
              <SettingsRow label="Two-page spread">
                <Toggle on={!!twoPage} onChange={() => pref('twoPage', !twoPage)} />
              </SettingsRow>
              <SettingsSectionLabel>Navigation</SettingsSectionLabel>
              <SettingsRow label="Tap margins to turn pages" desc="Click the left/right edges of the screen to navigate">
                <Toggle on={!!tapToTurn} onChange={() => pref('tapToTurn', !tapToTurn)} />
              </SettingsRow>
              <SettingsSectionLabel>Accessibility</SettingsSectionLabel>
              <SettingsRow label="Highlight words on hover" desc="Highlights the word under your cursor">
                <Toggle on={!!highlightWords} onChange={() => pref('highlightWords', !highlightWords)} />
              </SettingsRow>
              <SettingsRow label="Underline current line" desc="Underlines all words on the hovered line">
                <Toggle on={!!underlineLine} onChange={() => pref('underlineLine', !underlineLine)} />
              </SettingsRow>
              <SettingsSectionLabel>Text-to-Speech (Piper)</SettingsSectionLabel>
              <SettingsRow label="TTS enabled" desc="Read selected text or full chapters aloud using local Piper TTS">
                <Toggle on={!!useAppStore.getState().ttsEnabled} onChange={() => pref('ttsEnabled', !useAppStore.getState().ttsEnabled)} />
              </SettingsRow>
              <SettingsRow label="Voice model" desc="Piper voice to use (place .onnx files in app data/piper/models/)">
                <PiperVoiceSelect pref={pref} />
              </SettingsRow>
              <SettingsRow label="Speech speed">
                <select className="gnos-select" value={useAppStore.getState().ttsSpeed || 1}
                  onChange={e => pref('ttsSpeed', +e.target.value)}>
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                    <option key={s} value={s}>{s}×</option>
                  ))}
                </select>
              </SettingsRow>
              <PiperStatusRow />
            </>
          )}

          {tab === 'notebook' && (
            <>
              <SettingsSectionLabel>Editor</SettingsSectionLabel>
              <SettingsRow label="Default view mode" desc="Which editing mode opens when you open a note">
                <select className="gnos-select" value={useAppStore.getState().defaultViewMode || 'live'}
                  onChange={e => pref('defaultViewMode', e.target.value)}>
                  <option value="live">Live</option>
                  <option value="source">Source</option>
                  <option value="preview">Preview</option>
                </select>
              </SettingsRow>
              <SettingsSectionLabel>Behaviour</SettingsSectionLabel>
              <SettingsRow label="Autosave" desc="Notes save automatically as you type">
                <Toggle on={useAppStore.getState().autosave !== false} onChange={() => pref('autosave', useAppStore.getState().autosave === false)} />
              </SettingsRow>
              <SettingsRow label="Smart list continuation" desc="Press Enter in a list to continue it automatically">
                <Toggle on={useAppStore.getState().smartListContinuation !== false} onChange={() => pref('smartListContinuation', useAppStore.getState().smartListContinuation === false)} />
              </SettingsRow>
              <SettingsRow label="Syntax autocomplete" desc="Auto-close ** [ ` marker pairs as you type">
                <Toggle on={useAppStore.getState().syntaxAutocomplete !== false} onChange={() => pref('syntaxAutocomplete', useAppStore.getState().syntaxAutocomplete === false)} />
              </SettingsRow>
            </>
          )}

          {tab === 'audio' && (
            <>
              <SettingsSectionLabel>Playback</SettingsSectionLabel>
              <SettingsRow label="Remember position" desc="Resume from where you left off">
                <Toggle on={useAppStore.getState().rememberPosition !== false} onChange={() => pref('rememberPosition', useAppStore.getState().rememberPosition === false)} />
              </SettingsRow>
              <SettingsRow label="Default playback speed">
                <select className="gnos-select" value={useAppStore.getState().defaultPlaybackSpeed || 1}
                  onChange={e => pref('defaultPlaybackSpeed', +e.target.value)}>
                  {[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                    <option key={s} value={s}>{s}×</option>
                  ))}
                </select>
              </SettingsRow>
            </>
          )}

          {tab === 'calendar' && (
            <>
              <SettingsSectionLabel>Day View Hours</SettingsSectionLabel>
              <SettingsRow label="Day starts at" desc="Earliest hour shown in day/week view">
                <select className="gnos-select" value={useAppStore.getState().calendarStartHour ?? 7}
                  onChange={e => pref('calendarStartHour', +e.target.value)}>
                  {Array.from({length: 24}, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i-12} PM`}</option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsRow label="Day ends at" desc="Latest hour shown in day/week view">
                <select className="gnos-select" value={useAppStore.getState().calendarEndHour ?? 21}
                  onChange={e => pref('calendarEndHour', +e.target.value)}>
                  {Array.from({length: 24}, (_, i) => (
                    <option key={i} value={i}>{i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i-12} PM`}</option>
                  ))}
                </select>
              </SettingsRow>
              <SettingsSectionLabel>Week</SettingsSectionLabel>
              <SettingsRow label="Week starts on">
                <select className="gnos-select" value={useAppStore.getState().calendarWeekStart ?? 0}
                  onChange={e => pref('calendarWeekStart', +e.target.value)}>
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={6}>Saturday</option>
                </select>
              </SettingsRow>
            </>
          )}

          {tab === 'plugins' && <PluginsSettingsPanel />}

        </div>

      </div>
    </div>
  )
}

function PluginsSettingsPanel() {
  const installedPlugins = useAppStore(s => s.installedPlugins)
  const enabledPluginIds = useAppStore(s => s.enabledPluginIds)
  const setPluginEnabled  = useAppStore(s => s.setPluginEnabled)

  return (
    <div>
      <SettingsSectionLabel>Installed Plugins</SettingsSectionLabel>
      {installedPlugins.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--textDim)', padding: '12px 0' }}>No plugins installed yet.</div>
      )}
      {installedPlugins.map(p => (
        <SettingsRow key={p.id} label={p.name} desc={p.bundled ? 'Built-in' : (p.description || p.id)}>
          <div
            title={p.bundled ? 'Built-in plugins are always active' : undefined}
            style={{
              width: 34, height: 20, borderRadius: 10, position: 'relative',
              cursor: p.bundled ? 'default' : 'pointer',
              background: enabledPluginIds.includes(p.id) ? 'var(--accent)' : 'var(--surfaceAlt)',
              border: '1px solid var(--border)', transition: 'background 0.15s',
              opacity: p.bundled ? 0.45 : 1, flexShrink: 0,
            }}
            onClick={() => { if (!p.bundled) setPluginEnabled(p.id, !enabledPluginIds.includes(p.id)) }}
          >
            <div style={{
              position: 'absolute', top: 2,
              left: enabledPluginIds.includes(p.id) ? 16 : 2,
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s',
              boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            }} />
          </div>
        </SettingsRow>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GnosNavButton — sits inline in the header, but is also rendered fixed so
// that when the sidebar opens it stays in place visually.
// The chevron flips direction when the sidebar is open, staying INSIDE the
// button — no translation outside the button boundaries.
// ─────────────────────────────────────────────────────────────────────────────
function SideNavCtxMenu({ x, y, items, onClose }) {
  const ref = useRef()
  const [openSub, setOpenSub] = useState(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  useLayoutEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const { offsetWidth: w, offsetHeight: h } = el
    const clampedLeft = Math.max(8, Math.min(x, window.innerWidth - w - 8))
    const clampedTop  = Math.max(60, Math.min(y, window.innerHeight - h - 8))
    el.style.left = clampedLeft + 'px'
    el.style.top  = clampedTop  + 'px'
  }, [x, y])
  const safeX = Math.max(8, Math.min(x, window.innerWidth - 180))
  const subLeft = safeX + 310 > window.innerWidth ? 'auto' : '100%'
  const subRight = safeX + 310 > window.innerWidth ? '100%' : 'auto'
  return (
    <div ref={ref} style={{
      position:'fixed', left:safeX, top:y, zIndex:99999,
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:10, padding:4, minWidth:168,
      boxShadow:'0 10px 28px rgba(0,0,0,0.5)',
    }}>
      {items.map((item,i) => (
        <div key={i} style={{ position:'relative' }}
          onMouseEnter={()=>item.submenu && setOpenSub(i)}
          onMouseLeave={()=>item.submenu && setOpenSub(null)}
        >
          <button style={{
            width:'100%', display:'flex', alignItems:'center', gap:8,
            padding:'7px 10px', background:'none', border:'none', cursor:'pointer',
            color: item.danger ? '#ef5350' : 'var(--text)', fontSize:12, fontWeight:500,
            textAlign:'left', borderRadius:6, transition:'background 0.1s',
          }}
            onMouseEnter={e=>e.currentTarget.style.background='var(--hover)'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}
            onClick={()=>{ if (!item.submenu) { item.action(); onClose() } }}
          >
            {item.icon && <svg width="13" height="13" viewBox="0 0 16 16" fill="none" dangerouslySetInnerHTML={{__html:item.icon}}/>}
            {item.label}
            {item.submenu && <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{marginLeft:'auto',opacity:0.5}}><path d="M2 1l4 3-4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          {item.submenu && openSub === i && (
            <div style={{
              position:'absolute', left:subLeft, right:subRight, top:-4, zIndex:100000,
              background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:10, padding:4, minWidth:130,
              boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {item.submenu.map((sub,j)=>(
                <button key={j} style={{
                  width:'100%', display:'flex', alignItems:'center', gap:8,
                  padding:'6px 10px', background:'none', border:'none', cursor:'pointer',
                  color:'var(--text)', fontSize:12, fontWeight:500,
                  textAlign:'left', borderRadius:6, transition:'background 0.1s',
                }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--hover)'}
                  onMouseLeave={e=>e.currentTarget.style.background='none'}
                  onClick={()=>{ sub.action(); onClose() }}
                >
                  {sub.label?.startsWith('#') && (
                    <span style={{ width:14, height:14, borderRadius:3, background:sub.label, flexShrink:0, border:'1px solid rgba(255,255,255,0.15)' }} />
                  )}
                  {sub.label?.startsWith('#') ? '' : sub.label}
                </button>
              ))}
              {item.submenu.length === 0 && (
                <div style={{padding:'6px 10px',fontSize:11,color:'var(--textDim)',fontStyle:'italic'}}>No collections</div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function GnosNavButton() {
  const paneTabId         = useContext(PaneContext)
  const setTabSideNavOpen = useAppStore(s => s.setTabSideNavOpen)
  const tabs              = useAppStore(s => s.tabs)
  const globalSideNavOpen = useAppStore(s => s.sideNavOpen)
  const openSideNav       = useAppStore(s => s.openSideNav)
  const closeSideNavGlobal = useAppStore(s => s.closeSideNav)
  const view             = useAppStore(s => s.view)
  const setView          = useAppStore(s => s.setView)
  const setActiveLibTab  = useAppStore(s => s.setActiveLibTab)
  const navigate         = useAppStore(s => s.navigate)

  const paneTab = paneTabId ? tabs.find(t => t.id === paneTabId) : null
  const sideNavOpen = paneTab ? (paneTab.sideNavOpen ?? globalSideNavOpen) : globalSideNavOpen
  void view; void navigate; void setView; void setActiveLibTab

  // Traditional browser-style sidebar toggle — plain open/close, nothing else
  function handleToggle() {
    if (paneTabId) setTabSideNavOpen(paneTabId, !sideNavOpen)
    else if (sideNavOpen) closeSideNavGlobal()
    else openSideNav()
  }

  return (
    <button
      className={`gnos-nav-btn${sideNavOpen ? ' gnos-nav-btn--open' : ''}`}
      onClick={handleToggle}
      title={sideNavOpen ? 'Close sidebar (⌘\\)' : 'Open sidebar (⌘\\)'}
    >
      <svg width="17" height="15" viewBox="0 0 20 18" fill="none">
        <rect x="1" y="1" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6"/>
        <line x1="7" y1="1" x2="7" y2="17" stroke="currentColor" strokeWidth="1.6"/>
        {sideNavOpen && <rect x="2.2" y="2.4" width="3.6" height="13.2" rx="1.2" fill="currentColor" opacity="0.55"/>}
      </svg>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SideNavSearch — mini search bar above Library section
// ─────────────────────────────────────────────────────────────────────────────
function SideNavSearch({ library, notebooks, sketchbooks, onOpen }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const inputRef = useRef(null)

  const fmtLabel = (item) => {
    if (item._isSketchbook) return 'SKETCH'
    if (item._isNotebook)   return 'NOTE'
    if (item.type === 'audio') return 'AUDIO'
    const f = item.format?.toUpperCase()
    return f === 'EPUB3' ? 'EPUB' : (f || 'TXT')
  }

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    if (!q.trim()) { setResults([]); return }
    const lower = q.toLowerCase()
    const all = [
      ...(library || []),
      ...(notebooks || []).map(n => ({ ...n, _isNotebook: true })),
      ...(sketchbooks || []).map(s => ({ ...s, _isSketchbook: true })),
    ]
    setResults(
      all.filter(item =>
        item.title?.toLowerCase().includes(lower) ||
        item.author?.toLowerCase().includes(lower)
      ).slice(0, 8)
    )
  }

  function handleSelect(item) {
    onOpen(item)
    setQuery('')
    setResults([])
  }

  return (
    <div className="sidenav-search-wrap">
      <div className="sidenav-search-bar">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          className="sidenav-search-input"
          placeholder="Search library…"
          value={query}
          onChange={handleChange}
          onKeyDown={e => {
            if (e.key === 'Escape') { setQuery(''); setResults([]) }
            if (e.key === 'Enter' && results.length > 0) handleSelect(results[0])
          }}
        />
        {query && (
          <button
            style={{ background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer', padding: '0 2px', fontSize: 14, lineHeight: 1 }}
            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
          >×</button>
        )}
      </div>
      {results.length > 0 && (
        <div className="sidenav-search-results">
          {results.map(item => (
            <button key={item.id} className="sidenav-search-result" onClick={() => handleSelect(item)}>
              <MiniCover item={item} />
              <span className="sidenav-search-result-title">{item.title}</span>
              <span className="sidenav-search-result-badge">{fmtLabel(item)}</span>
            </button>
          ))}
        </div>
      )}
      {query && results.length === 0 && (
        <div className="sidenav-search-results">
          <div className="sidenav-search-empty">No results for "{query}"</div>
        </div>
      )}
    </div>
  )
}


// ── Inline edit modal for sidebar items ──────────────────────────────────────
function SideEditModal({ item, isNb, isSb, isAudio, colors, onClose, onSave }) {
  const [title, setTitle] = useState(item.title || '')
  const [author, setAuthor] = useState(item.author || '')
  const [color, setColor] = useState(item.coverColor || colors[0])
  const [coverDataUrl, setCoverDataUrl] = useState(item.coverDataUrl || null)
  const coverInputRef = useRef(null)
  const heading = isNb ? 'Edit Notebook' : isSb ? 'Edit Sketchbook' : isAudio ? 'Edit Audiobook' : 'Edit Book'

  function handleCoverFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => setCoverDataUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  return createPortal(
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:11000,display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:24,width:320,boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:14,fontWeight:700,marginBottom:16,color:'var(--text)' }}>{heading}</div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Title</div>
          <input value={title} onChange={e => setTitle(e.target.value)}
            style={{ width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box' }} />
        </div>
        {(isAudio || (!isNb && !isSb)) && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Author</div>
            <input value={author} onChange={e => setAuthor(e.target.value)}
              style={{ width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box' }} />
          </div>
        )}
        {/* Cover image upload */}
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Cover Image</div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            {coverDataUrl && (
              <img src={coverDataUrl} alt="Cover" style={{ width:36,height:50,objectFit:'cover',borderRadius:4,border:'1px solid var(--border)',flexShrink:0 }} />
            )}
            <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
              <button
                onClick={() => coverInputRef.current?.click()}
                style={{ background:'var(--surfaceAlt)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'5px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit' }}
              >{coverDataUrl ? 'Change Image' : 'Upload Image'}</button>
              {coverDataUrl && (
                <button
                  onClick={() => setCoverDataUrl(null)}
                  style={{ background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'5px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit' }}
                >Remove Image</button>
              )}
            </div>
          </div>
          <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleCoverFile} />
        </div>
        {(isNb || isSb) && (
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Cover Color</div>
            <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
              {colors.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width:28,height:28,borderRadius:6,background:c,
                  border: c === color ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor:'pointer',outline: c === color ? '2px solid var(--accent)' : 'none',outlineOffset:1
                }} />
              ))}
            </div>
          </div>
        )}
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer' }}>Cancel</button>
          <button onClick={() => {
            const changes = { title: title.trim() || item.title, coverColor: color, coverDataUrl: coverDataUrl ?? null }
            if (isAudio || (!isNb && !isSb)) changes.author = author.trim()
            onSave(changes)
          }}
            style={{ background:'var(--accent)',border:'none',color:'#fff',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontWeight:600 }}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const COLLECTION_COLORS_ALL = [
  '#388bfd','#e05c7a','#4a7c3f','#e8922a','#8250df','#f0883e','#56d4dd',
  '#d4a017','#c0392b','#27ae60','#2980b9','#8e44ad','#16a085','#e74c3c',
]

function CollectionEditModal({ col, onClose, onSave }) {
  const [name, setName] = useState(col.name || '')
  const [emoji, setEmoji] = useState(col.emoji || '')
  const [color, setColor] = useState(col.color || '')
  const nameRef = useRef()
  useEffect(() => { nameRef.current?.focus() }, [])
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return createPortal(
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:20000,display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={onClose}>
      <div style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:24,width:300,boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:14,fontWeight:700,marginBottom:18,color:'var(--text)' }}>Edit Collection</div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--textDim)',marginBottom:5 }}>Name</div>
          <input ref={nameRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { if (name.trim()) onSave({ name: name.trim(), emoji, color }); onClose() } }}
            style={{ width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box',fontFamily:'inherit' }} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--textDim)',marginBottom:5 }}>Emoji</div>
          <input value={emoji} onChange={e => {
            const chars = [...e.target.value]
            setEmoji(chars.length > 1 ? chars[chars.length - 1] : e.target.value)
          }}
            placeholder="e.g. 📚"
            style={{ width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:18,outline:'none',boxSizing:'border-box',fontFamily:'inherit' }} />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--textDim)',marginBottom:8 }}>Color</div>
          <div style={{ display:'flex',gap:7,flexWrap:'wrap' }}>
            <button onClick={() => setColor('')} title="No color" style={{
              width:24,height:24,borderRadius:5,background:'var(--surfaceAlt)',
              border: !color ? '2px solid var(--accent)' : '1px solid var(--border)',
              cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,
            }}>✕</button>
            {COLLECTION_COLORS_ALL.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{
                width:24,height:24,borderRadius:5,background:c,
                border: c === color ? '2px solid var(--accent)' : '2px solid transparent',
                cursor:'pointer',outline: c === color ? '2px solid var(--accent)' : 'none',outlineOffset:1,
              }} />
            ))}
          </div>
        </div>
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontFamily:'inherit' }}>Cancel</button>
          <button onClick={() => { if (name.trim()) onSave({ name: name.trim(), emoji, color }); onClose() }}
            style={{ background:'var(--accent)',border:'none',color:'#fff',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontWeight:600,fontFamily:'inherit' }}>Save</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function SideNav({ isSplitPane = false }) {
  const isMobile            = useIsMobile()
  const paneTabId           = useContext(PaneContext)
  const setTabSideNavOpen   = useAppStore(s => s.setTabSideNavOpen)
  const globalSideNavOpen   = useAppStore(s => s.sideNavOpen)
  const globalCloseSideNav  = useAppStore(s => s.closeSideNav)
  const tabs                = useAppStore(s => s.tabs)
  const activeTabId         = useAppStore(s => s.activeTabId)
  // In split-pane mode, read this pane's own sidebar state
  const paneTab = isSplitPane && paneTabId ? tabs.find(t => t.id === paneTabId) : null
  const sidebarPinned = useAppStore(s => s.sidebarPinned)
  const sideNavOpen = (sidebarPinned && !isSplitPane) || (paneTab ? (paneTab.sideNavOpen ?? false) : globalSideNavOpen)
  const closeSideNav = useCallback(() => {
    if (useAppStore.getState().sidebarPinned && !isSplitPane) return // pinned = always present
    if (isSplitPane && paneTabId) setTabSideNavOpen(paneTabId, false)
    else globalCloseSideNav()
  }, [isSplitPane, paneTabId, setTabSideNavOpen, globalCloseSideNav])
  const switchTab           = useAppStore(s => s.switchTab)
  const closeTab            = useAppStore(s => s.closeTab)
  const view                = useAppStore(s => s.view)
  const setView             = useAppStore(s => s.setView)
  const setActiveLibTab     = useAppStore(s => s.setActiveLibTab)
  const activeLibTab        = useAppStore(s => s.activeLibTab)
  const library             = useAppStore(s => s.library)
  const notebooks           = useAppStore(s => s.notebooks)
  const flashcardDecks      = useAppStore(s => s.flashcardDecks)
  const sketchbooks         = useAppStore(s => s.sketchbooks)
  const collections           = useAppStore(s => s.collections)
  const activeCollectionId    = useAppStore(s => s.activeCollectionId)
  const setActiveCollectionId = useAppStore(s => s.setActiveCollectionId)
  const setActiveNotebook   = useAppStore(s => s.setActiveNotebook)
  const addNotebook         = useAppStore(s => s.addNotebook)
  const openNewTab          = useAppStore(s => s.openNewTab)
  const updateTab           = useAppStore(s => s.updateTab)
  const navigate            = useAppStore(s => s.navigate)
  const activeNotebook      = useAppStore(s => s.activeNotebook)
  const activeBook          = useAppStore(s => s.activeBook)
  const activeSketchbook    = useAppStore(s => s.activeSketchbook)
  const activeFlashcardDeck = useAppStore(s => s.activeFlashcardDeck)
  const activeAudioBook     = useAppStore(s => s.activeAudioBook)

  // Compute the ID of the item currently open in this pane (for sidebar highlighting)
  const curView = paneTab?.view ?? view
  const activeItemId = (() => {
    if (curView === 'notebook')     return paneTab?.activeNotebook?.id     ?? activeNotebook?.id
    if (curView === 'sketchbook')   return paneTab?.activeSketchbook?.id   ?? activeSketchbook?.id
    if (curView === 'reader' || curView === 'pdf') return paneTab?.activeBook?.id ?? activeBook?.id
    if (curView === 'audio-player') return paneTab?.activeAudioBook?.id    ?? activeAudioBook?.id
    if (curView === 'flashcards' || curView === 'flashcard') return paneTab?.activeFlashcardDeck?.id ?? activeFlashcardDeck?.id
    return null
  })()

  const VIEW_TO_TAB = { reader:'books', pdf:'books', 'audio-player':'audiobooks', notebook:'notebooks', sketchbook:'notebooks' }

  // User-controlled expand/collapse state. Auto-expansion of the active section
  // is derived at render time (see isOpen below) so no effect is needed.
  const [expanded, setExpanded] = useState({})
  const [_addOpen,     setAddOpen]      = useState(false)
  // Derive: popup can only be open when the sidebar itself is open
  const addOpen = _addOpen && sideNavOpen
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sideNavMenu,  setSideNavMenu]  = useState(null) // { x, y, items }
  const [editSideColId, setEditSideColId] = useState(null)
  const [editSideColName, setEditSideColName] = useState('')
  const [editColModal, setEditColModal] = useState(null) // { id, name, color, emoji }
  const [editSideItem, setEditSideItem] = useState(null) // item being edited inline

  const fileInputRef  = useRef(null)
  const audioInputRef = useRef(null)

  // Escape key closes sidebar
  useEffect(() => {
    if (!sideNavOpen) return
    const h = (e) => { if (e.key === 'Escape') closeSideNav() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sideNavOpen, closeSideNav])

  // Click-outside closes the add popup
  useEffect(() => {
    if (!addOpen) return
    const h = () => setAddOpen(false)
    const id = setTimeout(() => document.addEventListener('click', h), 0)
    return () => { clearTimeout(id); document.removeEventListener('click', h) }
  }, [addOpen])

  function handleNavItem(id) {
    if (paneTabId) {
      updateTab(paneTabId, { view: 'library', activeLibTab: id })
      setView('library'); setActiveLibTab(id)
    } else {
      navigate({ view: 'library', activeLibTab: id })
    }
    closeSideNav()
    if (id !== 'notebooks') {
      const setLibSubFilter = useAppStore.getState().setLibSubFilter
      if (setLibSubFilter) setLibSubFilter('all')
    }
  }
  function toggleExpanded(id, e) { e.stopPropagation(); setExpanded(p => ({ ...p, [id]: !p[id] })) }
  // Zen-style: switching tabs keeps the sidebar open
  function handleTabSwitch(tabId) { switchTab(tabId) }
  function handleTabClose(e, tabId) { e.stopPropagation(); closeTab(tabId) }

  function getItemsForTab(id) {
    let books  = library.filter(b => b.type !== 'audio')
    let audios = library.filter(b => b.type === 'audio')
    let nbs    = (notebooks  || []).map(n => ({ ...n, _isNotebook:   true }))
    let sbs    = (sketchbooks|| []).map(s => ({ ...s, _isSketchbook: true }))
    // When a collection workspace is active, sections only list that collection's items
    const activeCol = activeCollectionId ? (collections || []).find(c => c.id === activeCollectionId) : null
    if (activeCol) {
      const ids = new Set(activeCol.items || [])
      if (activeCol.filter) {
        const { field, value } = activeCol.filter
        const v = (value || '').toLowerCase()
        library.forEach(b => {
          if (field === 'format' && v === 'audio' && b.type === 'audio') ids.add(b.id)
          else if (field === 'format' && (b.format || '').toLowerCase() === v) ids.add(b.id)
          else if (field === 'author' && (b.author || '').toLowerCase().includes(v)) ids.add(b.id)
          else if (field === 'type' && (b.type === v || (v === 'book' && b.type !== 'audio'))) ids.add(b.id)
        })
        if (field === 'type' && v === 'notebook')   (notebooks   || []).forEach(n => ids.add(n.id))
        if (field === 'type' && v === 'sketchbook') (sketchbooks || []).forEach(s => ids.add(s.id))
      }
      books  = books.filter(b => ids.has(b.id))
      audios = audios.filter(b => ids.has(b.id))
      nbs    = nbs.filter(n => ids.has(n.id))
      sbs    = sbs.filter(s => ids.has(s.id))
    }
    switch (id) {
      case 'library':     return [...books, ...audios, ...nbs, ...sbs]
      case 'books':       return books
      case 'audiobooks':  return audios
      case 'notebooks':   return [...nbs, ...sbs]
      case 'collections': return collections || []
      default:            return []
    }
  }

  /** Resolve a collection's item IDs into actual item objects */
  function resolveCollectionItems(col) {
    if (!col?.items?.length) return []
    const allItems = new Map()
    for (const b of library) allItems.set(b.id, b.type === 'audio' ? b : b)
    for (const n of (notebooks || [])) allItems.set(n.id, { ...n, _isNotebook: true })
    for (const s of (sketchbooks || [])) allItems.set(s.id, { ...s, _isSketchbook: true })
    return col.items.map(id => allItems.get(id)).filter(Boolean)
  }

  // openItem — opens in the current tab (default single-click behaviour)
  function openItem(item) { openItemInCurrentTab(item) }

  // openItemInNewTab — explicitly opens a new tab (used by context menu)
  function openItemInNewTab(item) {
    const store = useAppStore.getState()
    if (item._isNotebook) {
      store.setActiveNotebook(item)
      openNewTab({ view: 'notebook', activeNotebook: item })
    } else if (item._isSketchbook) {
      store.setActiveSketchbook(item)
      openNewTab({ view: 'sketchbook', activeSketchbook: item })
    } else if (item.type === 'audio') {
      store.setActiveAudioBook(item)
      openNewTab({ view: 'audio-player', activeAudioBook: item })
    } else {
      store.setActiveBook(item)
      openNewTab({ view: item.format === 'pdf' ? 'pdf' : 'reader', activeBook: item })
    }
    closeSideNav()
  }

  // openItemInCurrentTab — replaces the active tab's view
  function openItemInCurrentTab(item) {
    let newView, patch
    const store = useAppStore.getState()
    if (item._isNotebook)           { store.setActiveNotebook(item);   newView = 'notebook';     patch = { view: newView, activeNotebook: item } }
    else if (item._isSketchbook)    { store.setActiveSketchbook(item); newView = 'sketchbook';   patch = { view: newView, activeSketchbook: item } }
    else if (item.type === 'audio') { store.setActiveAudioBook(item);  newView = 'audio-player'; patch = { view: newView, activeAudioBook: item } }
    else { store.setActiveBook(item); newView = item.format === 'pdf' ? 'pdf' : 'reader'; patch = { view: newView, activeBook: item } }
    if (paneTabId) {
      // In split-pane mode update the specific pane tab; no history entry
      updateTab(paneTabId, patch)
      setView(newView)
    } else {
      // Normal mode — push to history so back button works
      navigate(patch)
    }
    closeSideNav()
  }

  // File import — fire custom events so LibraryView can handle them
  function handleBookFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    window.dispatchEvent(new CustomEvent('gnos:import-books', { detail: { files } }))
    e.target.value = ''; closeSideNav()
  }
  function handleAudioFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    window.dispatchEvent(new CustomEvent('gnos:import-audio', { detail: { files } }))
    e.target.value = ''; closeSideNav()
  }

  // Top tab strip is permanently hidden — tabs always dock in the sidebar (Zen-style)
  const showTabs = true

  return (
    <>
      <style>{`
        /* ── GnosNavButton — inline in header, stays in normal flow ─────────── */
        .gnos-nav-btn {
          display: flex; align-items: center; justify-content: center;
          background: none; border: none; cursor: pointer;
          width: 32px; height: 30px; padding: 0; border-radius: 7px;
          color: var(--textDim);
          transition: background 0.12s, color 0.12s; flex-shrink: 0;
          line-height: 1;
        }
        .gnos-nav-btn:hover { background: var(--hover); color: var(--text); }
        .gnos-nav-btn--open { color: var(--text); }

        /* ── Sidebar search bar ──────────────────────────────────────────────── */
        .sidenav-search-wrap {
          padding: 8px 10px 4px;
          flex-shrink: 0;
        }
        .sidenav-search-bar {
          display: flex; align-items: center; gap: 6px;
          background: var(--surfaceAlt); border: 1px solid var(--border);
          border-radius: 7px; padding: 5px 9px;
          transition: border-color 0.12s;
          cursor: text;
        }
        .sidenav-search-bar:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(56,139,253,0.12);
        }
        .sidenav-search-input {
          flex: 1; min-width: 0;
          background: none; border: none; outline: none;
          font-size: 12px; color: var(--text); font-family: inherit;
        }
        .sidenav-search-input::placeholder { color: var(--textDim); opacity: 0.6; }
        .sidenav-search-results {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 8px; margin: 4px 0 2px;
          overflow: hidden;
          box-shadow: 0 6px 20px rgba(0,0,0,0.25);
        }
        .sidenav-search-result {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 10px;
          background: none; border: none; cursor: pointer; width: 100%;
          text-align: left; transition: background 0.1s;
        }
        .sidenav-search-result:hover { background: var(--hover); }
        .sidenav-search-result-title {
          font-size: 12px; font-weight: 600; color: var(--text);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
        }
        .sidenav-search-result-badge {
          font-size: 9px; font-weight: 700; color: var(--textDim);
          background: var(--surfaceAlt); border: 1px solid var(--borderSubtle);
          border-radius: 3px; padding: 1px 4px; flex-shrink: 0;
        }
        .sidenav-search-empty {
          font-size: 11px; color: var(--textDim); font-style: italic;
          padding: 8px 10px;
        }

        /* ── Overlay backdrop ─────────────────────────────────────────────── */
        .sidenav-backdrop {
          position: fixed; inset: 0; z-index: 7999;
          pointer-events: none;
          background: transparent;
          transition: background 0.22s;
        }
        .sidenav-backdrop.open {
          pointer-events: none;
          background: transparent;
        }
        .sidenav-backdrop.open.split-pane {
          pointer-events: auto;
        }

        /* ── Split-pane overrides — position relative to pane container ───── */
        .sidenav-backdrop.split-pane { position: absolute; }
        .sidenav-panel.split-pane { position: absolute; top: 8px; left: 8px; bottom: 8px; }

        /* ── Panel — floating overlay ─────────────────────────────────────── */
        .sidenav-panel {
          position: fixed; top: 42px; left: 8px; bottom: 8px;
          width: ${SIDEBAR_WIDTH}px;
          z-index: 8001;
          background: var(--surface);
          border: none;
          border-radius: 12px;
          display: flex; flex-direction: column;
          overflow: hidden;
          transform: translateX(calc(-100% - 16px));
          transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      top 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }
        /* Pinned (always present) — native flush panel, no float, no shadow */
        .sidenav-panel.pinned {
          top: 34px; left: 0; bottom: 0;
          border-radius: 0;
          border-right: 1px solid var(--borderSubtle);
          transform: translateX(0) !important;
          box-shadow: none !important;
        }
        .sidenav-push-wrapper.pinned.pushed { margin-left: ${SIDEBAR_WIDTH}px !important; }
        .sidenav-panel.open {
          transform: translateX(0);
          box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12);
        }

        /* ── Header — matches gnos-header style across all views ─────────── */
        .sidenav-header {
          display: flex; align-items: center; justify-content: space-between;
          height: 52px; padding: 0 12px 0 16px; flex-shrink: 0;
          border-bottom: none;
          box-shadow: none;
        }
        .sidenav-logo {
          color: var(--text); display: flex; align-items: center; justify-content: center;
        }
        .sidenav-logo-btn {
          background: none; border: none; padding: 4px 6px; cursor: pointer;
          border-radius: 7px;
          transition: background 0.12s;
        }
        .sidenav-logo-btn:hover { background: var(--hover); }
        .sidenav-logo-btn:active { opacity: 0.75; }

        /* Close button — shows a < that "flips in" as the sidebar opens */
        .sidenav-close-btn {
          width: 26px; height: 26px; border-radius: 6px;
          border: none; background: none; color: var(--textDim);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.1s, color 0.1s;
        }
        .sidenav-close-btn:hover { background: var(--hover); color: var(--text); }

        /* The chevron starts rotated (looks like >) while closed and
           transitions to its natural < orientation when open */
        .sidenav-close-chevron {
          display: block;
          transition: transform 0.26s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sidenav-panel:not(.open) .sidenav-close-chevron { transform: rotate(180deg); }
        .sidenav-panel.open      .sidenav-close-chevron { transform: rotate(0deg); }

        /* ── Scroll area ───────────────────────────────────────────────────── */
        .sidenav-scroll {
          flex: 1; overflow-y: auto;
          padding-bottom: 8px;
        }

        /* ── Docked tabs — fixed above footer, not in scroll flow ────────── */
        .sidenav-tabs-docked {
          flex-shrink: 0;
          border-top: none;
          overflow-y: auto;
          max-height: 240px;
          padding: 4px 8px 6px;
        }

        /* ── Section headers ──────────────────────────────────────────────── */
        .sidenav-section { padding: 9px 0 3px; }
        .sidenav-section-label {
          padding: 0 16px 4px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--textDim); opacity: 0.55;
        }

        /* ── Tab items — Zen-style rounded rows ──────────────────────────── */
        .sidenav-tab-item {
          display: flex; align-items: center; gap: 9px;
          padding: 6px 8px 6px 10px; margin-bottom: 1px;
          border: none; background: none; width: 100%; border-radius: 7px;
          color: var(--text); cursor: pointer; text-align: left;
          transition: background 0.1s;
        }
        .sidenav-tab-item:hover { background: var(--hover); }
        .sidenav-tab-item.active { background: var(--surfaceAlt); }
        .sidenav-tab-indicator {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--textDim); flex-shrink: 0; opacity: 0.4;
        }
        .sidenav-tab-item.active .sidenav-tab-indicator { background: var(--accent); opacity: 1; }
        .sidenav-tab-name {
          flex: 1; font-size: 12.5px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sidenav-tab-item.active .sidenav-tab-name { font-weight: 600; }
        .sidenav-tab-close {
          width: 18px; height: 18px; border-radius: 5px;
          border: none; background: none; cursor: pointer; color: var(--textDim);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.1s, background 0.1s; flex-shrink: 0;
        }
        .sidenav-tab-item:hover .sidenav-tab-close { opacity: 0.7; }
        .sidenav-tab-close:hover { background: var(--hover); opacity: 1 !important; color: var(--text); }
        .sidenav-tab-new {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px 6px 12px; margin-top: 2px; width: 100%; border-radius: 7px;
          border: none; background: none; cursor: pointer; text-align: left;
          color: var(--textDim); font-size: 12px; font-weight: 500; font-family: inherit;
          transition: background 0.1s, color 0.1s;
        }
        .sidenav-tab-new:hover { background: var(--hover); color: var(--text); }

        /* ── Nav items — 10% shorter v-padding ───────────────────────────── */
        .sidenav-nav-item {
          display: flex; align-items: center; gap: 9px;
          padding: 6px 9px 6px 16px;
          border: none; background: none; width: 100%;
          color: var(--textDim); cursor: pointer; text-align: left;
          font-size: 12px; font-weight: 500;
          transition: background 0.1s, color 0.1s;
        }
        .sidenav-nav-item:hover { background: var(--hover); color: var(--text); }
        .sidenav-nav-item.active { color: var(--accent); background: rgba(56,139,253,0.08); }
        .sidenav-nav-icon { display: flex; align-items: center; flex-shrink: 0; opacity: 0.8; }
        .sidenav-nav-item.active .sidenav-nav-icon { opacity: 1; }
        .sidenav-nav-expand {
          padding: 3px; border-radius: 4px; display: flex; align-items: center;
          color: var(--textDim); opacity: 0; transition: opacity 0.1s, background 0.1s;
          background: none; border: none; cursor: pointer; flex-shrink: 0;
        }
        .sidenav-nav-item:hover .sidenav-nav-expand { opacity: 0.65; }
        .sidenav-nav-expand:hover { background: var(--hover); opacity: 1 !important; }

        .sidenav-divider { height: 1px; background: var(--borderSubtle); margin: 5px 12px; }

        /* ── Footer row ──────────────────────────────────────────────────── */
        .sidenav-footer {
          flex-shrink: 0; height: 48px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px;
          border-top: none;
        }
        .sidenav-footer-btn {
          width: 30px; height: 30px; border-radius: 7px;
          border: 1px solid var(--border); background: var(--surfaceAlt);
          color: var(--textDim); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s; flex-shrink: 0;
        }
        .sidenav-footer-btn:hover {
          background: var(--accent); color: #fff;
          border-color: var(--accent); transform: scale(1.05);
        }

        /* Push wrapper — snaps immediately; only sidebar panel animates */
        .sidenav-push-wrapper { min-height: 100vh; }
        .sidenav-push-wrapper.pushed { margin-left: ${SIDEBAR_WIDTH + 12}px; }

        /* Header + footer bleed behind sidebar — bg extends full width,
           padding-left keeps content from going under the sidebar panel */
        .sidenav-push-wrapper.pushed .app-header,
        .sidenav-push-wrapper.pushed .reader-header,
        .sidenav-push-wrapper.pushed .gnos-header,
        .sidenav-push-wrapper.pushed .nb-header,
        .sidenav-push-wrapper.pushed .fc-header {
          margin-left: -${SIDEBAR_WIDTH + 12}px;
          width: calc(100% + ${SIDEBAR_WIDTH + 12}px);
          padding-left: ${SIDEBAR_WIDTH + 12}px !important;
        }
        .sidenav-push-wrapper.pushed .library-footer {
          margin-left: -${SIDEBAR_WIDTH + 12}px;
          width: calc(100% + ${SIDEBAR_WIDTH + 12}px);
          padding-left: ${SIDEBAR_WIDTH + 12 + 32}px;
        }

        /* The sidebar close button is shown inside the panel */
        .sidenav-close-btn { display: flex; }
      `}</style>

      {/* Hidden file inputs */}
      <input ref={fileInputRef}  type="file" accept=".epub,.txt" multiple style={{ display: 'none' }} onChange={handleBookFiles} />
      <input ref={audioInputRef} type="file" accept="audio/*"   multiple style={{ display: 'none' }} onChange={handleAudioFiles} />

      {/* Backdrop — click to close (not in pinned mode) */}
      {!sidebarPinned && (
        <div className={`sidenav-backdrop${sideNavOpen ? ' open' : ''}${isSplitPane ? ' split-pane' : ''}`} onClick={closeSideNav} />
      )}

      {/* Gutter fill — covers the strip left of the panel when pushed */}
      {sideNavOpen && !isSplitPane && !sidebarPinned && (
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: SIDEBAR_WIDTH + 12,
          background: 'var(--surface)',
          zIndex: 7998,
          pointerEvents: 'none',
        }} />
      )}


      {/* Panel */}
      <div className={`sidenav-panel${sideNavOpen ? ' open' : ''}${isSplitPane ? ' split-pane' : ''}${sidebarPinned && !isSplitPane ? ' pinned' : ''}`} role="navigation" aria-label="Main navigation">

        {/* Header */}
        <div className="sidenav-header">
          <button
            className="sidenav-logo sidenav-logo-btn"
            onClick={() => { if (paneTabId) { updateTab(paneTabId, { view: 'library', activeLibTab: 'library' }); setView('library'); setActiveLibTab('library') } else { navigate({ view: 'library', activeLibTab: 'library' }) } closeSideNav() }}
            title="Back to Library"
          >
            {/* App mark — same quill as the notebook Live-mode button */}
            <IconQuill size={21} />
          </button>
          <button className="sidenav-close-btn" onClick={closeSideNav} title="Close navigation">
            {/* < chevron — starts rotated 180° (= >) and flips to < when open */}
            <svg className="sidenav-close-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable list */}
        <div className="sidenav-scroll">

          {/* Library search */}
          <SideNavSearch
            library={library}
            notebooks={notebooks}
            sketchbooks={sketchbooks}
            onOpen={item => { openItem(item) }}
          />

          {/* Library Navigation */}
          <div className="sidenav-section">
            <div className="sidenav-section-label">Library</div>
            {NAV_ITEMS.map(item => {
              const isActive = view === 'library' && activeLibTab === item.id
              const autoOpen = sideNavOpen && VIEW_TO_TAB[view] === item.id
              const isOpen   = expanded[item.id] !== undefined ? !!expanded[item.id] : autoOpen
              const items    = getItemsForTab(item.id)
              return (
                <div key={item.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`sidenav-nav-item${isActive ? ' active' : ''}`}
                    onClick={() => handleNavItem(item.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavItem(item.id) } }}
                  >
                    <span className="sidenav-nav-icon">{item.icon}</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>
                    {items.length > 0 && (
                      <button
                        className="sidenav-nav-expand"
                        onClick={e => toggleExpanded(item.id, e)}
                        title={isOpen ? 'Collapse' : 'Expand'}
                      >
                        <ChevronIcon open={isOpen} />
                      </button>
                    )}
                  </div>
                  {isOpen && item.id === 'collections' ? (() => {
                    const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
                    const ICON_EDIT = '<path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_COLOR = '<circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2" fill="currentColor"/>'
                    const ICON_TRASH = '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_MOVE = '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M5 4.5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'

                    const renderCollection = (col, depth = 0) => {
                      const colOpen = !!expanded[`col_${col.id}`]
                      const colItems = resolveCollectionItems(col)
                      const childCollections = (collections || []).filter(c => c.parentId === col.id)
                      const totalCount = (col.items?.length || 0) + childCollections.length
                      const indent = 24 + depth * 14

                      return (
                        <div key={col.id}>
                          <div
                            data-collection-id={col.id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              padding: `3px 6px 3px ${indent}px`, cursor: 'pointer',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background='var(--hover)'}
                            onMouseLeave={e => e.currentTarget.style.background='none'}
                            onClick={() => setExpanded(p => ({ ...p, [`col_${col.id}`]: !p[`col_${col.id}`] }))}
                            onContextMenu={e => {
                              e.preventDefault()
                              e.stopPropagation()
                              const otherCols = (collections || []).filter(c => c.id !== col.id && c.id !== col.parentId)
                              const moveItems = otherCols.length ? [{
                                label: 'Move Into…', icon: ICON_MOVE,
                                submenu: [
                                  ...otherCols.map(c => ({
                                    label: c.name,
                                    action: () => { useAppStore.getState().moveCollection(col.id, c.id); useAppStore.getState().persistCollections() },
                                  })),
                                  ...(col.parentId ? [{
                                    label: '— Move to Root —',
                                    action: () => { useAppStore.getState().moveCollection(col.id, null); useAppStore.getState().persistCollections() },
                                  }] : []),
                                ],
                              }] : []
                              setSideNavMenu({ x: e.clientX, y: e.clientY, items: [
                                { label: 'Edit Collection…', icon: ICON_EDIT, action: () => {
                                  setSideNavMenu(null)
                                  setEditColModal({ id: col.id, name: col.name, color: col.color || '', emoji: col.emoji || '' })
                                }},
                                ...moveItems,
                                { label: 'Delete', icon: ICON_TRASH, danger: true, action: () => { useAppStore.getState().removeCollection(col.id); useAppStore.getState().persistCollections() } },
                              ]})
                            }}
                          >
                            {col.emoji
                              ? <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}>{col.emoji}</span>
                              : col.color
                                ? <span style={{ width: 13, height: 13, borderRadius: 4, background: col.color, flexShrink: 0 }} />
                                : <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                                    <rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                                    <path d="M2 6h12" stroke="currentColor" strokeWidth="1" opacity="0.5"/>
                                    <path d="M2 9h12" stroke="currentColor" strokeWidth="1" opacity="0.3"/>
                                  </svg>
                            }
                            {editSideColId === col.id ? (
                              <input
                                autoFocus
                                value={editSideColName}
                                onChange={e => setEditSideColName(e.target.value)}
                                onBlur={() => {
                                  if (editSideColName.trim()) { useAppStore.getState().updateCollection(col.id, { name: editSideColName.trim() }); useAppStore.getState().persistCollections() }
                                  setEditSideColId(null)
                                }}
                                onKeyDown={e => {
                                  e.stopPropagation()
                                  if (e.key === 'Enter') e.target.blur()
                                  if (e.key === 'Escape') setEditSideColId(null)
                                }}
                                onClick={e => e.stopPropagation()}
                                style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)', background: 'none', border: '1px solid var(--accent)', borderRadius: 3, padding: '0 4px', outline: 'none', fontFamily: 'inherit', minWidth: 0 }}
                              />
                            ) : (
                              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {col.name}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: 'var(--textDim)', flexShrink: 0, marginRight: 2 }}>
                              {totalCount > 0 ? totalCount : ''}
                            </span>
                            <ChevronIcon open={colOpen} />
                          </div>
                          {colOpen && (
                            <div style={{ paddingLeft: 0 }}>
                              {/* Render child collections first */}
                              {childCollections.map(child => renderCollection(child, depth + 1))}
                              {/* Then render items */}
                              {colItems.length > 0 && (
                                <div style={{ paddingLeft: depth > 0 ? 14 : 12 }}>
                                  <NavDropdown items={colItems} onOpen={openItem} activeId={activeItemId} onMenu={(e, ci) => {
                                    e.stopPropagation()
                                    const ICON_EDIT_CI = '<path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                                    const ICON_NEWTAB = '<path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 1h4v4M14 1l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                                    const ICON_REMOVE = '<path d="M4 8h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>'
                                    setSideNavMenu({ x: e.clientX, y: e.clientY, items: [
                                      { label: 'Edit', icon: ICON_EDIT_CI, action: () => { setEditSideItem(ci); setSideNavMenu(null) } },
                                      { label: 'Open in New Tab', icon: ICON_NEWTAB, action: () => openItemInNewTab(ci) },
                                      { label: 'Remove from Collection', icon: ICON_REMOVE, danger: true, action: () => {
                                        useAppStore.getState().removeFromCollection(col.id, ci.id)
                                        useAppStore.getState().persistCollections()
                                      }},
                                    ]})
                                  }} />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    }

                    // Only render root-level collections (no parentId)
                    const rootCollections = (collections || []).filter(c => !c.parentId)

                    return (
                      <div style={{ paddingBottom: 2 }}>
                        {(!collections || !collections.length) && (
                          <div style={{ padding: '5px 16px 8px 38px', fontSize: 11, color: 'var(--textDim)', fontStyle: 'italic' }}>
                            No collections yet
                          </div>
                        )}
                        {rootCollections.map(col => renderCollection(col, 0))}
                      </div>
                    )
                  })() : isOpen && (
                    <NavDropdown items={items} onOpen={openItem} activeId={activeItemId}
                      onReorder={(item.id === 'notebooks' || item.id === 'books' || item.id === 'audiobooks' || item.id === 'library') ? (from, to, fromId, toId) => {
                        const store = useAppStore.getState()
                        if (item.id === 'notebooks') {
                          const sbs = store.sketchbooks || []
                          const nbs = store.notebooks || []
                          const fromIsSb = sbs.some(s => s.id === fromId)
                          const toIsSb   = sbs.some(s => s.id === toId)
                          if (fromIsSb && toIsSb) {
                            const fi = sbs.findIndex(s => s.id === fromId)
                            const ti = sbs.findIndex(s => s.id === toId)
                            if (fi !== -1 && ti !== -1) { store.reorderSketchbooks?.(fi, ti); store.persistSketchbooks?.() }
                          } else if (!fromIsSb && !toIsSb) {
                            const fi = nbs.findIndex(n => n.id === fromId)
                            const ti = nbs.findIndex(n => n.id === toId)
                            if (fi !== -1 && ti !== -1) { store.reorderNotebooks?.(fi, ti); store.persistNotebooks?.() }
                          }
                        } else {
                          const lib = store.library || []
                          const fi = lib.findIndex(b => b.id === fromId)
                          const ti = lib.findIndex(b => b.id === toId)
                          if (fi !== -1 && ti !== -1) { store.reorderLibrary?.(fi, ti); store.persistLibrary?.() }
                        }
                      } : undefined}
                    onMenu={(e, item) => {
                    e.stopPropagation()
                    const isAudio = item.type === 'audio'
                    const isNb = item._isNotebook
                    const isSb = item._isSketchbook
                    const ICON_EDIT_ITEM = '<path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_BOOK = '<path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_NEWTAB = '<path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 1h4v4M14 1l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_TRASH = '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_SEARCH = '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 9.5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
                    const ICON_COL = '<rect x="2" y="7" width="12" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="4.5" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="9.5" width="7" height="3" rx="0.6" stroke="currentColor" stroke-width="1.1"/>'
                    const colSub = [{
                      label:'Add to Collection', icon:ICON_COL,
                      submenu: [
                        { label: '+ New Collection', action: () => {
                            const s = useAppStore.getState()
                            const newCol = { id: makeId('col'), name: 'New Collection', items: [item.id], color: '' }
                            s.addCollection(newCol); s.addToCollection(newCol.id, item.id); s.persistCollections()
                            s.setActiveLibTab('collections'); s.setView('library')
                            if (activeTabId) s.updateTab(activeTabId, { view: 'library', activeLibTab: 'collections' })
                            setSideNavMenu(null)
                          }
                        },
                        ...collections.map(c => ({
                          label: c.name, action: () => { useAppStore.getState().addToCollection(c.id, item.id); useAppStore.getState().persistCollections() }
                        }))
                      ],
                    }]
                    const editAction = () => {
                      setEditSideItem(item)
                      setSideNavMenu(null)
                    }
                    const items2 = isNb
                      ? [ { label:'Edit', icon:ICON_EDIT_ITEM, action: editAction },
                          { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          ...colSub,
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>{ useAppStore.getState().removeNotebook?.(item.id); useAppStore.getState().persistNotebooks?.() } } ]
                      : isSb
                      ? [ { label:'Edit', icon:ICON_EDIT_ITEM, action: editAction },
                          { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          ...colSub,
                          { label:'Delete', icon:ICON_TRASH, danger:true, action: async ()=>{ const { deleteSketchbookContent } = await import('@/lib/storage'); await deleteSketchbookContent(item.id); useAppStore.getState().removeSketchbook?.(item.id); useAppStore.getState().persistSketchbooks?.() } } ]
                      : isAudio
                      ? [ { label:'Edit', icon:ICON_EDIT_ITEM, action: editAction },
                          { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          ...colSub,
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>useAppStore.getState().removeBook?.(item.id) } ]
                      : [ { label:'Edit', icon:ICON_EDIT_ITEM, action: editAction },
                          { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          { label:'Search title', icon:ICON_SEARCH, action:()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(item.title)}`,'_blank') },
                          { label:'Search author', icon:ICON_SEARCH, action:()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(item.author||item.title+' author')}`,'_blank') },
                          ...colSub,
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>useAppStore.getState().removeBook?.(item.id) } ]
                    setSideNavMenu({ x: e.clientX, y: e.clientY, items: items2 })
                  }} />)}
                </div>
              )
            })}
          </div>

        </div>

        {/* Open Tabs — docked above footer, outside scroll (Zen-style list) */}
        {showTabs && (
          <div className="sidenav-tabs-docked">
            <div className="sidenav-section-label" style={{paddingLeft:16,paddingTop:4}}>Tabs</div>
            {tabs.map(tab => (
              <button key={tab.id}
                className={`sidenav-tab-item${tab.id === activeTabId ? ' active' : ''}`}
                onClick={() => handleTabSwitch(tab.id)}
              >
                <div className="sidenav-tab-indicator" />
                <span className="sidenav-tab-name">{getTabLabel(tab, { notebooks, flashcardDecks, sketchbooks, library })}</span>
                {tabs.length > 1 && (
                  <div className="sidenav-tab-close" role="button" tabIndex={-1} onClick={e => handleTabClose(e, tab.id)} title="Close tab">
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                )}
              </button>
            ))}
            <button className="sidenav-tab-new" onClick={() => openNewTab({ view: 'library', activeLibTab: 'library' })}>
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              New tab
            </button>
          </div>
        )}

        {/* Workspace (Collection) Switcher */}
        <CollectionSwitcher
          collections={collections}
          activeCollectionId={activeCollectionId}
          onSwitch={(id) => {
            setActiveCollectionId(id)
            navigate({ view: 'library', activeLibTab: 'library' })
          }}
        />

        {/* Footer — ⚙ settings (left) and + add (right) */}
        <div className="sidenav-footer">
          <button
            className="sidenav-footer-btn"
            title="Settings"
            onClick={e => {
              e.stopPropagation()
              if (isMobile) { setSettingsOpen(true); return }
              import('@tauri-apps/api/core')
                .then(({ invoke }) => invoke('open_settings_window'))
                .catch(() => setSettingsOpen(true))
            }}
          >
            <SettingsIcon />
          </button>

          <div style={{ position: 'relative' }}>
            {addOpen && (
              <SidebarAddPopup
                onClose={() => setAddOpen(false)}
                onAddBook={() => fileInputRef.current?.click()}
                onAddAudio={() => audioInputRef.current?.click()}
                addNotebook={addNotebook}
                setActiveNotebook={setActiveNotebook}
                setView={setView}
                closeSideNav={closeSideNav}
              />
            )}
            <button
              className="sidenav-footer-btn"
              title="Add book or notebook"
              onClick={e => { e.stopPropagation(); setAddOpen(o => !o) }}
            >
              <PlusIcon />
            </button>
          </div>
        </div>

      </div>

      {/* Universal Settings Modal */}
      {settingsOpen && <UniversalSettingsModal onClose={() => setSettingsOpen(false)} />}
      {/* SideNav item context menu */}
      {sideNavMenu && (
        <SideNavCtxMenu
          x={sideNavMenu.x} y={sideNavMenu.y}
          items={sideNavMenu.items}
          onClose={() => setSideNavMenu(null)}
        />
      )}

      {/* Collection edit modal */}
      {editColModal && (
        <CollectionEditModal
          col={editColModal}
          onClose={() => setEditColModal(null)}
          onSave={(changes) => {
            useAppStore.getState().updateCollection(editColModal.id, changes)
            useAppStore.getState().persistCollections()
            setEditColModal(null)
          }}
        />
      )}

      {/* Inline edit modal for sidebar items */}
      {editSideItem && (() => {
        const item = editSideItem
        const isNb = item._isNotebook
        const isSb = item._isSketchbook
        const isAudio = item.type === 'audio'
        const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#0f4c75']
        return <SideEditModal item={item} isNb={isNb} isSb={isSb} isAudio={isAudio} colors={COLORS}
          onClose={() => setEditSideItem(null)}
          onSave={async (changes) => {
            const s = useAppStore.getState()
            if (isNb) { s.updateNotebook(item.id, changes); await s.persistNotebooks() }
            else if (isSb) { s.updateSketchbook(item.id, changes); await s.persistSketchbooks() }
            else { s.updateBook(item.id, changes); await s.persistLibrary() }
            setEditSideItem(null)
          }} />
      })()}
    </>
  )
}