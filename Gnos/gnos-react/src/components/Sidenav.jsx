import { useEffect, useRef, useState, useContext } from 'react'
import { PaneContext } from '@/lib/PaneContext'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor } from '@/lib/utils'

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
        <rect x="1" y="5" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5 5V4a3 3 0 0 1 6 0v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
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
}

// 10% narrower than original 264
const SIDEBAR_WIDTH = 238

// ─────────────────────────────────────────────────────────────────────────────
// MiniCover — 10% shorter vertically (40px instead of 44px)
// ─────────────────────────────────────────────────────────────────────────────
function MiniCover({ item }) {
  const [c1, c2] = generateCoverColor(item.title)
  const isAudio = item.type === 'audio'
  return (
    <div style={{
      width: 29, height: 40, borderRadius: 4, flexShrink: 0,
      overflow: 'hidden', position: 'relative',
      background: item._isNotebook || item._isSketchbook
        ? (item.coverColor || '#1a1a2e')
        : `linear-gradient(135deg,${c1},${c2})`,
      boxShadow: '0 1px 5px rgba(0,0,0,0.4)',
    }}>
      {item.coverDataUrl
        ? <img src={item.coverDataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
function NavDropdown({ items, onOpen, onMenu }) {
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
      {items.map(item => (
        <div key={item.id} style={{ display:'flex', alignItems:'center', position:'relative' }}
          onMouseEnter={e => e.currentTarget.style.background='var(--hover)'}
          onMouseLeave={e => e.currentTarget.style.background='none'}
        >
          <button
            onClick={() => onOpen(item)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, flex:1,
              padding: '4px 6px 4px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              textAlign: 'left', minWidth:0,
            }}
          >
            <MiniCover item={item} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: 'var(--text)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                lineHeight: 1.3,
              }}>{item.title}</div>
              {item.author && (
                <div style={{
                  fontSize: 10, color: 'var(--textDim)', marginTop: 1,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{item.author}</div>
              )}
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
      label: 'Add Book (EPUB / TXT)',
      action: () => { onAddBook(); onClose() },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
      label: 'Add Audiobook (MP3…)',
      action: () => { onAddAudio(); onClose() },
    },
    {
      icon: <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>,
      label: 'New Notebook',
      action: () => {
        const nb = { id: `nb-${Date.now()}`, title: 'Untitled Note', wordCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
        addNotebook(nb); setActiveNotebook(nb); setView('notebook')
        onClose(); closeSideNav()
      },
    },
  ]

  return (
    <div
      style={{
        position: 'absolute', bottom: 40, right: 0,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '6px 0', minWidth: 200,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)', zIndex: 20,
      }}
      onClick={e => e.stopPropagation()}
    >
      {choices.map(({ icon, label, action }) => (
        <button key={label} onClick={action} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '9px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text)', fontSize: 12, fontWeight: 500,
          transition: 'background 0.1s', textAlign: 'left',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <span style={{ color: 'var(--textDim)', display: 'flex' }}>{icon}</span>
          {label}
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings helper components — defined at module scope (not inside render)
// ─────────────────────────────────────────────────────────────────────────────
function SettingsToggle({ on, onClick }) {
  return (
    <div onClick={onClick} style={{
      width: 36, height: 20, borderRadius: 10, cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--accent)' : 'var(--border)',
      position: 'relative', transition: 'background 0.2s',
    }}>
      <div style={{
        position: 'absolute', top: 3, left: on ? 19 : 3,
        width: 14, height: 14, borderRadius: 7,
        background: '#fff', transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </div>
  )
}

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

// ─────────────────────────────────────────────────────────────────────────────
// UniversalSettingsModal — tabbed settings for all views
// ─────────────────────────────────────────────────────────────────────────────
export function UniversalSettingsModal({ onClose }) {
  const [tab, setTab] = useState('appearance')

  const setPref            = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)
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
    { id: 'about',      label: 'About' },
  ]

  const BUILT_IN_THEMES_LOCAL = {
    sepia:  { name: 'Sepia',  bg: '#f4efe6', surface: '#faf6ef', accent: '#8b5e3c' },
    dark:   { name: 'Dark',   bg: '#0d1117', surface: '#161b22', accent: '#388bfd' },
    light:  { name: 'Light',  bg: '#f6f8fa', surface: '#ffffff', accent: '#0969da' },
    cherry: { name: 'Cherry', bg: '#0e0608', surface: '#170b0d', accent: '#e05c7a' },
    sunset: { name: 'Sunset', bg: '#0f0a04', surface: '#1a1008', accent: '#e8922a' },
    moss:   { name: 'Moss',   bg: '#f2f5ee', surface: '#f8faf5', accent: '#4a7c3f' },
  }
  const allThemes = { ...BUILT_IN_THEMES_LOCAL, ...customThemes }

  const selectStyle = { background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '4px 8px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 20000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, width: 560, maxWidth: '95vw', height: 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
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

              <SettingsSectionLabel>Typography</SettingsSectionLabel>
              <SettingsRow label="Font Size" desc={`${fontSize}px`}>
                <input type="range" min="14" max="28" step="1" value={fontSize}
                  onChange={e => pref('fontSize', +e.target.value)} style={{ width: 110 }} />
              </SettingsRow>
              <SettingsRow label="Line Spacing" desc={String(lineSpacing)}>
                <input type="range" min="1.4" max="2.4" step="0.1" value={lineSpacing}
                  onChange={e => pref('lineSpacing', +e.target.value)} style={{ width: 110 }} />
              </SettingsRow>
              <SettingsRow label="Font">
                <select value={fontFamily} onChange={e => pref('fontFamily', e.target.value)} style={selectStyle}>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Palatino Linotype', serif">Palatino</option>
                  <option value="system-ui, sans-serif">System UI</option>
                </select>
              </SettingsRow>
            </>
          )}

          {tab === 'library' && (
            <>
              <SettingsSectionLabel>Discover Books</SettingsSectionLabel>
              <a href="https://www.gutenberg.org" target="_blank" rel="noopener" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 8, marginBottom: 6, textDecoration: 'none', color: 'var(--text)',
                transition: 'border-color 0.15s',
              }}>
                <span style={{ fontSize: 18 }}>📚</span>
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
                <span style={{ fontSize: 18 }}>🎧</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>LibriVox</div>
                  <div style={{ fontSize: 11, color: 'var(--textDim)' }}>Free public domain audiobooks — 20,000+ titles</div>
                </div>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>

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
                <SettingsToggle on={justifyText !== false} onClick={() => pref('justifyText', justifyText === false)} />
              </SettingsRow>
              <SettingsRow label="Two-page spread">
                <SettingsToggle on={!!twoPage} onClick={() => pref('twoPage', !twoPage)} />
              </SettingsRow>
              <SettingsSectionLabel>Navigation</SettingsSectionLabel>
              <SettingsRow label="Tap margins to turn pages" desc="Click the left/right edges of the screen to navigate">
                <SettingsToggle on={!!tapToTurn} onClick={() => pref('tapToTurn', !tapToTurn)} />
              </SettingsRow>
              <SettingsSectionLabel>Accessibility</SettingsSectionLabel>
              <SettingsRow label="Highlight words on hover" desc="Highlights the word under your cursor">
                <SettingsToggle on={!!highlightWords} onClick={() => pref('highlightWords', !highlightWords)} />
              </SettingsRow>
              <SettingsRow label="Underline current line" desc="Underlines all words on the hovered line">
                <SettingsToggle on={!!underlineLine} onClick={() => pref('underlineLine', !underlineLine)} />
              </SettingsRow>
            </>
          )}

          {tab === 'notebook' && (
            <>
              <SettingsSectionLabel>Editor</SettingsSectionLabel>
              <SettingsRow label="Default view mode" desc="Which editing mode opens when you open a note">
                <select style={selectStyle} defaultValue="live">
                  <option value="live">Live</option>
                  <option value="source">Source</option>
                  <option value="preview">Preview</option>
                </select>
              </SettingsRow>
              <SettingsSectionLabel>Behaviour</SettingsSectionLabel>
              <SettingsRow label="Autosave" desc="Notes save automatically as you type">
                <SettingsToggle on={true} onClick={() => {}} />
              </SettingsRow>
              <SettingsRow label="Smart list continuation" desc="Press Enter in a list to continue it automatically">
                <SettingsToggle on={true} onClick={() => {}} />
              </SettingsRow>
              <SettingsRow label="Syntax autocomplete" desc="Auto-close ** [ ` marker pairs as you type">
                <SettingsToggle on={true} onClick={() => {}} />
              </SettingsRow>
            </>
          )}

          {tab === 'audio' && (
            <>
              <SettingsSectionLabel>Playback</SettingsSectionLabel>
              <SettingsRow label="Remember position" desc="Resume from where you left off">
                <SettingsToggle on={true} onClick={() => {}} />
              </SettingsRow>
              <SettingsRow label="Default playback speed">
                <select style={selectStyle} defaultValue="1">
                  {[0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                    <option key={s} value={s}>{s}×</option>
                  ))}
                </select>
              </SettingsRow>
            </>
          )}

          {tab === 'about' && (
            <div style={{ padding: '20px 0' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>Gnos</div>
              <div style={{ fontSize: 13, color: 'var(--textDim)', lineHeight: 1.65, maxWidth: 400 }}>
                A personal reading and writing environment. Supports ebooks (EPUB, TXT),
                audiobooks (MP3, M4B), PDF, and Markdown notebooks with live preview,
                wikilink navigation, and callout blocks.
              </div>
              <div style={{ marginTop: 20, fontSize: 11, color: 'var(--textDim)', opacity: 0.55 }}>
                Built with React + Vite
              </div>
            </div>
          )}

        </div>
      </div>
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
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])
  const safeX = Math.min(x, window.innerWidth - 180)
  const safeY = Math.min(y, window.innerHeight - 160)
  return (
    <div ref={ref} style={{
      position:'fixed', left:safeX, top:safeY, zIndex:99999,
      background:'var(--surface)', border:'1px solid var(--border)',
      borderRadius:10, padding:4, minWidth:168,
      boxShadow:'0 10px 28px rgba(0,0,0,0.5)',
    }}>
      {items.map((item,i) => (
        <button key={i} style={{
          width:'100%', display:'flex', alignItems:'center', gap:8,
          padding:'7px 10px', background:'none', border:'none', cursor:'pointer',
          color: item.danger ? '#ef5350' : 'var(--text)', fontSize:12, fontWeight:500,
          textAlign:'left', borderRadius:6, transition:'background 0.1s',
        }}
          onMouseEnter={e=>e.currentTarget.style.background='var(--hover)'}
          onMouseLeave={e=>e.currentTarget.style.background='none'}
          onClick={()=>{ item.action(); onClose() }}
        >
          {item.icon && <svg width="13" height="13" viewBox="0 0 16 16" fill="none" dangerouslySetInnerHTML={{__html:item.icon}}/>}
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function GnosNavButton() {
  const openSideNav      = useAppStore(s => s.openSideNav)
  const closeSideNav     = useAppStore(s => s.closeSideNav)
  const sideNavOpen      = useAppStore(s => s.sideNavOpen)
  const view             = useAppStore(s => s.view)
  const setView          = useAppStore(s => s.setView)
  const setActiveLibTab  = useAppStore(s => s.setActiveLibTab)
  const paneTabId        = useContext(PaneContext)

  function handleLogoClick() {
    if (sideNavOpen) {
      const tabMap = { reader:'books', pdf:'books', 'audio-player':'audiobooks', notebook:'notebooks', sketchbook:'notebooks' }
      if (paneTabId) {
        useAppStore.getState().updateTab(paneTabId, { view: 'library', activeLibTab: tabMap[view] || 'library' })
        useAppStore.getState().switchTab(paneTabId)
      } else {
        setActiveLibTab(tabMap[view] || 'library')
        setView('library')
      }
      closeSideNav()
    } else {
      openSideNav()
    }
  }

  return (
    <button
      className={`gnos-nav-btn${sideNavOpen ? ' gnos-nav-btn--open' : ''}`}
      onClick={handleLogoClick}
      title={sideNavOpen ? 'Go to Library' : 'Open navigation'}
    >
      <span className="gnos-nav-logo">Gnos</span>
      <svg className="gnos-nav-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
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


export default function SideNav() {
  const sideNavOpen         = useAppStore(s => s.sideNavOpen)
  const closeSideNav        = useAppStore(s => s.closeSideNav)
  const tabs                = useAppStore(s => s.tabs)
  const activeTabId         = useAppStore(s => s.activeTabId)
  const switchTab           = useAppStore(s => s.switchTab)
  const closeTab            = useAppStore(s => s.closeTab)
  const view                = useAppStore(s => s.view)
  const setView             = useAppStore(s => s.setView)
  const setActiveLibTab     = useAppStore(s => s.setActiveLibTab)
  const activeLibTab        = useAppStore(s => s.activeLibTab)
  const library             = useAppStore(s => s.library)
  const notebooks           = useAppStore(s => s.notebooks)
  const sketchbooks         = useAppStore(s => s.sketchbooks)
  const setActiveNotebook   = useAppStore(s => s.setActiveNotebook)
  const addNotebook         = useAppStore(s => s.addNotebook)
  const openNewTab          = useAppStore(s => s.openNewTab)
  const updateTab           = useAppStore(s => s.updateTab)

  const VIEW_TO_TAB = { reader:'books', pdf:'books', 'audio-player':'audiobooks', notebook:'notebooks', sketchbook:'notebooks' }

  // User-controlled expand/collapse state. Auto-expansion of the active section
  // is derived at render time (see isOpen below) so no effect is needed.
  const [expanded, setExpanded] = useState({})
  const [_addOpen,     setAddOpen]      = useState(false)
  // Derive: popup can only be open when the sidebar itself is open
  const addOpen = _addOpen && sideNavOpen
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sideNavMenu,  setSideNavMenu]  = useState(null) // { x, y, items }

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
    updateTab(activeTabId, { view: 'library', activeLibTab: id })
    setView('library'); setActiveLibTab(id); closeSideNav()
  }
  function toggleExpanded(id, e) { e.stopPropagation(); setExpanded(p => ({ ...p, [id]: !p[id] })) }
  function handleTabSwitch(tabId) { switchTab(tabId); closeSideNav() }
  function handleTabClose(e, tabId) { e.stopPropagation(); closeTab(tabId) }

  function getItemsForTab(id) {
    const books  = library.filter(b => b.type !== 'audio')
    const audios = library.filter(b => b.type === 'audio')
    const nbs    = (notebooks  || []).map(n => ({ ...n, _isNotebook:   true }))
    const sbs    = (sketchbooks|| []).map(s => ({ ...s, _isSketchbook: true }))
    switch (id) {
      case 'library':     return [...books, ...audios, ...nbs, ...sbs]
      case 'books':       return books
      case 'audiobooks':  return audios
      case 'notebooks':   return [...nbs, ...sbs]
      case 'collections': return []
      default:            return []
    }
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
    let newView
    const store = useAppStore.getState()
    if (item._isNotebook)           { store.setActiveNotebook(item);   newView = 'notebook' }
    else if (item._isSketchbook)    { store.setActiveSketchbook(item); newView = 'sketchbook' }
    else if (item.type === 'audio') { store.setActiveAudioBook(item);  newView = 'audio-player' }
    else { store.setActiveBook(item); newView = item.format === 'pdf' ? 'pdf' : 'reader' }
    updateTab(activeTabId, { view: newView })
    setView(newView); closeSideNav()
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

  const showTabs = tabs.length > 1

  return (
    <>
      <style>{`
        /* ── GnosNavButton — inline in header, stays in normal flow ─────────── */
        .gnos-nav-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: none; cursor: pointer;
          padding: 4px 8px; border-radius: 6px;
          transition: background 0.12s; flex-shrink: 0;
          line-height: 1;
          height: 32px;
        }
        .gnos-nav-btn:hover { background: var(--hover); }
        .gnos-nav-logo {
          font-family: Georgia, serif; font-size: 15px; font-weight: 700;
          color: var(--text); letter-spacing: -0.3px;
          transition: opacity 0.18s, transform 0.18s cubic-bezier(0.4,0,0.2,1);
        }
        .gnos-nav-btn--open .gnos-nav-logo {
          opacity: 0;
          transform: translateX(-4px);
        }
        .gnos-nav-chevron {
          color: var(--textDim); opacity: 0.65; display: block;
          transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.15s;
        }
        .gnos-nav-btn:hover .gnos-nav-chevron { opacity: 1; }
        /* When open: just flip the chevron (scaleX(-1)) so > becomes <.
           No translateX — keep it inside the button bounds. */
        .gnos-nav-btn--open .gnos-nav-chevron {
          transform: scaleX(-1);
          opacity: 1;
          color: var(--text);
        }
        /* When sidebar is open, fully collapse the inline header button so it
           takes no space — the sidebar panel itself has its own close control */
        .sidenav-push-wrapper .gnos-nav-btn--open {
          opacity: 0;
          pointer-events: none;
          width: 0;
          min-width: 0;
          padding: 0;
          margin: 0;
          overflow: hidden;
          transition: width 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.15s, padding 0.22s, margin 0.22s;
        }

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
          pointer-events: auto;
          background: rgba(0,0,0,0.22);
        }

        /* ── Panel — overlay, does not push content ───────────────────────── */
        .sidenav-panel {
          position: fixed; top: 34px; left: 0; bottom: 0;
          width: ${SIDEBAR_WIDTH}px;
          z-index: 8001;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex; flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }
        .sidenav-panel.open {
          transform: translateX(0);
          box-shadow: 6px 0 32px rgba(0,0,0,0.28);
        }

        /* ── Header — matches gnos-header style across all views ─────────── */
        .sidenav-header {
          display: flex; align-items: center; justify-content: space-between;
          height: 52px; padding: 0 12px 0 16px; flex-shrink: 0;
          background: var(--headerBg);
          border-bottom: 1px solid var(--borderSubtle);
          box-shadow: 0 1px 0 var(--borderSubtle);
        }
        .sidenav-logo {
          font-family: Georgia, serif; font-size: 17px; font-weight: 700;
          color: var(--text); letter-spacing: -0.4px;
        }
        .sidenav-logo-btn {
          background: none; border: none; padding: 4px 6px; cursor: pointer;
          border-radius: 6px;
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

        /* ── Scroll area — leaves room for footer ─────────────────────────── */
        .sidenav-scroll {
          flex: 1; overflow-y: auto;
          padding-bottom: 56px; /* reserved for footer */
        }

        /* ── Section headers ──────────────────────────────────────────────── */
        .sidenav-section { padding: 9px 0 3px; }
        .sidenav-section-label {
          padding: 0 16px 4px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--textDim); opacity: 0.55;
        }

        /* ── Tab items — 10% shorter v-padding ───────────────────────────── */
        .sidenav-tab-item {
          display: flex; align-items: center; gap: 9px;
          padding: 6px 9px 6px 16px;
          border: none; background: none; width: 100%;
          color: var(--text); cursor: pointer; text-align: left;
          transition: background 0.1s;
        }
        .sidenav-tab-item:hover { background: var(--hover); }
        .sidenav-tab-item.active { background: rgba(56,139,253,0.09); color: var(--accent); }
        .sidenav-tab-indicator {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--textDim); flex-shrink: 0; opacity: 0.5;
        }
        .sidenav-tab-item.active .sidenav-tab-indicator { background: var(--accent); opacity: 1; }
        .sidenav-tab-name {
          flex: 1; font-size: 12px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sidenav-tab-close {
          width: 18px; height: 18px; border-radius: 4px;
          border: none; background: none; cursor: pointer; color: var(--textDim);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.1s, background 0.1s; flex-shrink: 0;
        }
        .sidenav-tab-item:hover .sidenav-tab-close { opacity: 0.7; }
        .sidenav-tab-close:hover { background: var(--hover); opacity: 1 !important; color: var(--text); }

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
          position: absolute; bottom: 0; left: 0; right: 0; height: 48px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px;
          border-top: 1px solid var(--borderSubtle);
          background: var(--surface);
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

        /* Push wrapper — content shifts right when sidebar opens */
        .sidenav-push-wrapper {
          transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          min-height: 100vh;
        }
        .sidenav-push-wrapper.pushed { /* overlay mode — no margin push */ }

        /* The sidebar close button is shown inside the panel */
        .sidenav-close-btn { display: flex; }
      `}</style>

      {/* Hidden file inputs */}
      <input ref={fileInputRef}  type="file" accept=".epub,.txt" multiple style={{ display: 'none' }} onChange={handleBookFiles} />
      <input ref={audioInputRef} type="file" accept="audio/*"   multiple style={{ display: 'none' }} onChange={handleAudioFiles} />

      {/* Backdrop — click to close */}
      <div className={`sidenav-backdrop${sideNavOpen ? ' open' : ''}`} onClick={closeSideNav} />

      {/* Panel */}
      <div className={`sidenav-panel${sideNavOpen ? ' open' : ''}`} role="navigation" aria-label="Main navigation">

        {/* Header */}
        <div className="sidenav-header">
          <button
            className="sidenav-logo sidenav-logo-btn"
            onClick={() => { updateTab(activeTabId, { view: 'library', activeLibTab: 'library' }); setView('library'); setActiveLibTab('library'); closeSideNav() }}
            title="Back to Library"
          >Gnos</button>
          <button className="sidenav-close-btn" onClick={closeSideNav} title="Close navigation">
            {/* < chevron — starts rotated 180° (= >) and flips to < when open */}
            <svg className="sidenav-close-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable list */}
        <div className="sidenav-scroll">

          {/* Open Tabs */}
          {showTabs && (
            <div className="sidenav-section">
              <div className="sidenav-section-label">Open Tabs</div>
              {tabs.map(tab => (
                <button key={tab.id}
                  className={`sidenav-tab-item${tab.id === activeTabId ? ' active' : ''}`}
                  onClick={() => handleTabSwitch(tab.id)}
                >
                  <div className="sidenav-tab-indicator" />
                  <span className="sidenav-tab-name">{VIEW_LABELS[tab.view] || tab.view}</span>
                  <button className="sidenav-tab-close" onClick={e => handleTabClose(e, tab.id)} title="Close tab">
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </button>
              ))}
              <div className="sidenav-divider" />
            </div>
          )}

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
              const isOpen   = !!expanded[item.id] || (sideNavOpen && VIEW_TO_TAB[view] === item.id)
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
                  {isOpen && <NavDropdown items={items} onOpen={openItem} onMenu={(e, item) => {
                    e.stopPropagation()
                    const isAudio = item.type === 'audio'
                    const isNb = item._isNotebook
                    const isSb = item._isSketchbook
                    const ICON_BOOK = '<path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_NEWTAB = '<path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10 1h4v4M14 1l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_TRASH = '<polyline points="3,6 5,6 13,6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9.143A1.5 1.5 0 0 1 11.64 16.5H4.36A1.5 1.5 0 0 1 2.867 15.143L2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'
                    const ICON_SEARCH = '<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M9.5 9.5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>'
                    const items2 = isNb
                      ? [ { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>{ useAppStore.getState().removeNotebook?.(item.id); useAppStore.getState().persistNotebooks?.() } } ]
                      : isSb
                      ? [ { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>{ useAppStore.getState().removeSketchbook?.(item.id); useAppStore.getState().persistSketchbooks?.() } } ]
                      : isAudio
                      ? [ { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>useAppStore.getState().removeBook?.(item.id) } ]
                      : [ { label:'Open in New Tab', icon:ICON_NEWTAB, action:()=>openItemInNewTab(item) },
                          { label:'Open Here', icon:ICON_BOOK, action:()=>openItemInCurrentTab(item) },
                          { label:'Search title', icon:ICON_SEARCH, action:()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(item.title)}`,'_blank') },
                          { label:'Search author', icon:ICON_SEARCH, action:()=>window.open(`https://www.google.com/search?q=${encodeURIComponent(item.author||item.title+' author')}`,'_blank') },
                          { label:'Delete', icon:ICON_TRASH, danger:true, action:()=>useAppStore.getState().removeBook?.(item.id) } ]
                    setSideNavMenu({ x: e.clientX, y: e.clientY, items: items2 })
                  }} />}
                </div>
              )
            })}
          </div>

        </div>

        {/* Footer — ⚙ settings (left) and + add (right) */}
        <div className="sidenav-footer">
          <button
            className="sidenav-footer-btn"
            title="Settings"
            onClick={e => { e.stopPropagation(); setSettingsOpen(true) }}
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
    </>
  )
}