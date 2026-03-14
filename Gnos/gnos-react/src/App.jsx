import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, useRef } from 'react'
import useAppStore from '@/store/useAppStore'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { readFile } from '@tauri-apps/plugin-fs'
import OnboardingView from '@/views/OnboardingView'

import { PaneContext } from '@/lib/PaneContext'
import LibraryView     from '@/views/LibraryView'
import ReaderView      from '@/views/ReaderView'
import AudioPlayerView from '@/views/AudioPlayerView'
import NotebookView    from '@/views/NotebookView'
import PdfView         from '@/views/PdfView'
import SketchbookView  from '@/views/SketchbookView'
import SideNav         from '@/components/SideNav'

const VIEW_LABELS = {
  library: 'Library', reader: 'Reading', 'audio-player': 'Listening',
  notebook: 'Notebook', pdf: 'PDF', sketchbook: 'Sketchbook',
}

export const TITLEBAR_H = 34

// ── ViewPanel ─────────────────────────────────────────────────────────────────
function ViewPanel({ view }) {
  if (view === 'library')      return <LibraryView />
  if (view === 'reader')       return <ReaderView />
  if (view === 'audio-player') return <AudioPlayerView />
  if (view === 'notebook')     return <NotebookView />
  if (view === 'pdf')          return <PdfView />
  if (view === 'sketchbook')   return <SketchbookView />
  return null
}

// ── TabPane ───────────────────────────────────────────────────────────────────
// Lazily mounts on first activation and stays mounted for the tab's lifetime.
// Visibility is controlled by display:flex/none so the view doesn't remount on
// every tab switch, but the component does unmount when the tab is closed.
function TabPane({ tabId, isActive, isSplit, onFocus }) {
  const tab = useAppStore(s => s.tabs.find(t => t.id === tabId))
  const [everActive, setEverActive] = useState(isActive)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isActive && !everActive) setEverActive(true)
  }, [isActive]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tab || !everActive) return null

  return (
    <PaneContext.Provider value={tabId}>
      <div style={{
        ...(isSplit
          ? { flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }
          : { position: 'absolute', inset: 0 }
        ),
        overflow: 'hidden',
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
      }}>
        <ViewPanel view={tab.view} />
        {isSplit && !isActive && (
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 300, cursor: 'pointer', background: 'transparent' }}
            onClick={onFocus}
            title="Click to focus this pane"
          />
        )}
      </div>
    </PaneContext.Provider>
  )
}

// ── Tab Layout Modal ──────────────────────────────────────────────────────────
function TabLayoutModal({ onClose, splitDir, splitPanes, setSplitDir, setSplitPanes, switchTab }) {
  const tabs        = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const closeTab    = useAppStore(s => s.closeTab)
  const openNewTab  = useAppStore(s => s.openNewTab)

  const isSplit = splitDir !== null
    && splitPanes.length === 2
    && splitPanes.every(id => tabs.some(t => t.id === id))

  function startSplit(dir) {
    // Capture the current active tab ID NOW before any store mutations
    const currentActiveId = useAppStore.getState().activeTabId
    let allTabs = useAppStore.getState().tabs
    let otherId = allTabs.find(t => t.id !== currentActiveId)?.id
    if (!otherId) {
      // No second tab exists — create one, then read the updated tabs
      openNewTab({ view: 'library', activeLibTab: 'library' })
      // openNewTab switches the active tab — get the new tab's id
      allTabs = useAppStore.getState().tabs
      otherId = useAppStore.getState().activeTabId
    }
    if (!otherId || otherId === currentActiveId) return
    setSplitDir(dir)
    setSplitPanes([currentActiveId, otherId])
    onClose()
  }

  function endSplit() {
    setSplitDir(null)
    setSplitPanes([])
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, width: 380, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.55)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 12px', borderBottom: '1px solid var(--borderSubtle)' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Tab Layout</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
        </div>

        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Open tabs */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', marginBottom: 8 }}>Open Tabs</div>
            {tabs.map(tab => (
              <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: tab.id === activeTabId ? 'rgba(56,139,253,0.1)' : 'transparent', marginBottom: 2 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: tab.id === activeTabId ? 'var(--accent)' : 'var(--border)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: tab.id === activeTabId ? 'var(--accent)' : 'var(--text)', fontWeight: tab.id === activeTabId ? 600 : 400 }}>
                  {VIEW_LABELS[tab.view] || tab.view}
                  {tab.id === activeTabId && <span style={{ fontSize: 10, color: 'var(--textDim)', marginLeft: 6 }}>active</span>}
                </span>
                {tab.id !== activeTabId && (
                  <button
                    onClick={() => { switchTab(tab.id); onClose() }}
                    style={{ fontSize: 11, background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--textDim)', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}
                  >Switch</button>
                )}
                {tabs.length > 1 && (
                  <button
                    onClick={() => closeTab(tab.id)}
                    style={{ fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--textDim)', cursor: 'pointer', padding: '2px 8px', fontFamily: 'inherit' }}
                  >Close</button>
                )}
              </div>
            ))}
            <button
              onClick={() => { openNewTab({ view: 'library', activeLibTab: 'library' }); onClose() }}
              style={{ marginTop: 6, width: '100%', padding: '8px 0', background: 'none', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--textDim)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'border-color 0.1s, color 0.1s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--textDim)' }}
            >+ New Tab</button>
          </div>

          {/* Split layout */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--textDim)', marginBottom: 8 }}>Split View</div>
            {isSplit ? (
              <button
                onClick={endSplit}
                style={{ width: '100%', padding: '9px 0', background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 8, color: '#f85149', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500 }}
              >Remove Split</button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { dir: 'horizontal', label: 'Side by Side', icon: (
                    <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
                      <rect x="1" y="1" width="13" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="18" y="1" width="13" height="20" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  )},
                  { dir: 'vertical', label: 'Top / Bottom', icon: (
                    <svg width="32" height="22" viewBox="0 0 32 22" fill="none">
                      <rect x="1" y="1" width="30" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <rect x="1" y="12" width="30" height="9" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                  )},
                ].map(({ dir, label, icon }) => (
                  <button key={dir} onClick={() => startSplit(dir)}
                    style={{ flex: 1, padding: '10px 0 8px', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, transition: 'border-color 0.1s, background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'rgba(56,139,253,0.06)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surfaceAlt)' }}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Tab CSS ───────────────────────────────────────────────────────────────────
const TAB_CSS = `
  .gnos-titlebar {
    position: fixed; top: 0; left: 0; right: 0;
    height: ${TITLEBAR_H}px; z-index: 9999;
    -webkit-app-region: drag;
    display: flex; align-items: flex-end;
    padding-left: 88px; padding-right: 12px; gap: 2px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    box-sizing: border-box; overflow: visible;
  }
  .gnos-titlebar-settings {
    -webkit-app-region: no-drag;
    display: flex; align-items: center;
    height: 100%; padding-bottom: 3px;
    margin-left: auto; flex-shrink: 0;
  }
  .gnos-settings-btn {
    width: 26px; height: 22px; border-radius: 5px;
    background: none; border: 1px solid transparent;
    color: var(--textDim); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
    -webkit-app-region: no-drag;
  }
  .gnos-settings-btn:hover {
    background: var(--surfaceAlt); border-color: var(--border); color: var(--text);
  }
  .gnos-tab {
    display: flex; align-items: flex-end;
    height: 100%; flex-shrink: 0;
    user-select: none; -webkit-app-region: no-drag;
  }
  .gnos-tab-body {
    display: flex; align-items: center; gap: 8px;
    height: calc(100% + 1px); bottom: -1px; position: relative;
    padding: 0 12px 1px 18px;
    border-radius: 10px 10px 0 0;
    border: 1px solid transparent; border-bottom: none;
    cursor: pointer;
    transition: background 0.14s, border-color 0.14s;
    min-width: 130px; max-width: 220px;
  }
  .gnos-tab.active .gnos-tab-body {
    background: var(--bg); border-color: var(--border);
    border-bottom-color: var(--bg);
  }
  .gnos-tab:not(.active) .gnos-tab-body { background: transparent; border-color: transparent; }
  .gnos-tab:not(.active):hover .gnos-tab-body {
    background: rgba(255,255,255,0.05); border-color: var(--borderSubtle);
    border-bottom-color: transparent;
  }
  .gnos-tab-label {
    font-size: 12px; font-family: var(--font-ui, system-ui);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    letter-spacing: -0.01em; line-height: 1; flex: 1;
    transition: color 0.12s, opacity 0.12s;
  }
  .gnos-tab.active .gnos-tab-label { color: var(--text); font-weight: 600; opacity: 1; }
  .gnos-tab:not(.active) .gnos-tab-label { color: var(--textDim); font-weight: 400; opacity: 0.5; }
  .gnos-tab:not(.active):hover .gnos-tab-label { opacity: 0.8; }
  .gnos-tab-x {
    width: 16px; height: 16px; border-radius: 4px;
    border: 1px solid transparent; background: none;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; flex-shrink: 0; padding: 0; color: var(--textDim);
    opacity: 0; transition: opacity 0.12s, background 0.1s, color 0.1s, border-color 0.1s;
  }
  .gnos-tab.has-close:hover .gnos-tab-x  { opacity: 0.45; }
  .gnos-tab.active.has-close .gnos-tab-x { opacity: 0.35; }
  .gnos-tab-x:hover {
    opacity: 1 !important; background: rgba(248,81,73,0.12) !important;
    color: #f85149 !important; border-color: rgba(248,81,73,0.35) !important;
  }
  .gnos-split-divider {
    flex-shrink: 0; background: var(--border);
    transition: background 0.12s; z-index: 10;
  }
  .gnos-split-divider:hover { background: var(--accent); }
  .gnos-split-divider.h { width: 1px; cursor: col-resize; align-self: stretch; }
  .gnos-split-divider.v { height: 1px; cursor: row-resize; align-self: stretch; }
`

export default function App() {
  const init        = useAppStore(s => s.init)
  const tabs        = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const switchTab   = useAppStore(s => s.switchTab)
  const closeTab    = useAppStore(s => s.closeTab)
  const sideNavOpen = useAppStore(s => s.sideNavOpen)
  const onboardingComplete    = useAppStore(s => s.onboardingComplete)
  const setOnboardingComplete = useAppStore(s => s.setOnboardingComplete)

  const [splitDir,        setSplitDir]        = useState(null)
  const [splitPanes,      setSplitPanes]      = useState([])
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false)

  const contentRef = useRef(null)

  const isSplit = splitDir !== null
    && splitPanes.length === 2
    && splitPanes.every(id => tabs.some(t => t.id === id))

  const hasMultipleTabs = tabs.length > 1

  useEffect(() => {
    init()
    const unlisten = listen('menu', (event) => {
      const id = event.payload
      const store = useAppStore.getState()
      if (id === 'tab_library')     { store.setView('library'); store.setActiveLibTab('library') }
      if (id === 'tab_books')       { store.setView('library'); store.setActiveLibTab('books') }
      if (id === 'tab_audiobooks')  { store.setView('library'); store.setActiveLibTab('audiobooks') }
      if (id === 'tab_notebooks')   { store.setView('library'); store.setActiveLibTab('notebooks') }
      if (id === 'tab_collections') { store.setView('library'); store.setActiveLibTab('collections') }
      if (id === 'import')          { store.setView('library'); store.setActiveLibTab('library') }
      if (id === 'new_notebook')    { store.setView('library'); store.setActiveLibTab('notebooks') }
      if (id === 'new_sketchbook')  { store.setView('library'); store.setActiveLibTab('collections') }
    })
    const unlistenFiles = onOpenUrl(async (urls) => {
      const store = useAppStore.getState()
      for (const url of urls) {
        const path = decodeURIComponent(url.replace('file://', ''))
        const filename = path.split('/').pop()
        const ext = filename.split('.').pop().toLowerCase()
        try {
          const contents = await readFile(path)
          const file = new File([contents], filename)
          if (['epub', 'txt', 'md', 'pdf'].includes(ext)) {
            store.setView('library'); store.setActiveLibTab('library')
            window.dispatchEvent(new CustomEvent('open-file', { detail: { file } }))
          } else if (['mp3', 'm4b'].includes(ext)) {
            store.setView('library'); store.setActiveLibTab('audiobooks')
            window.dispatchEvent(new CustomEvent('open-file', { detail: { file } }))
          }
        } catch (err) { console.error('Failed to read file:', path, err) }
      }
    })
    return () => { unlisten.then(fn => fn()); unlistenFiles.then(fn => fn()) }
  }, [init])

  if (!onboardingComplete) {
    return <OnboardingView onComplete={() => setOnboardingComplete(true)} />
  }

  return (
    <div id="app">
      <style>{TAB_CSS}</style>

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div className="gnos-titlebar">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId
          const label = VIEW_LABELS[tab.view] || tab.view
          return (
            <div
              key={tab.id}
              className={`gnos-tab${isActive ? ' active' : ''}${hasMultipleTabs ? ' has-close' : ''}`}
            >
              <div className="gnos-tab-body" onClick={() => switchTab(tab.id)}>
                <span className="gnos-tab-label">{label}</span>
                {hasMultipleTabs && (
                  <button
                    className="gnos-tab-x"
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                    title="Close tab"
                  >
                    <svg width="8" height="8" viewBox="0 0 9 9" fill="none">
                      <path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Draggable empty space — fills gap between tabs and settings button */}
        <div style={{ flex: 1, height: '100%', WebkitAppRegion: 'drag' }} />

        {/* Layout settings button — right side on macOS, handled via CSS on Windows */}
        <div className="gnos-titlebar-settings">
          <button
            className="gnos-settings-btn"
            title="Tab layout"
            onClick={() => setTabSettingsOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="6" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="9" y="2" width="6" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            </svg>
          </button>
        </div>
      </div>

      <SideNav />

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div
        ref={contentRef}
        className={`sidenav-push-wrapper${sideNavOpen ? ' pushed' : ''}`}
        style={{
          paddingTop: TITLEBAR_H, height: '100vh',
          boxSizing: 'border-box', display: 'flex',
          flexDirection: isSplit && splitDir === 'vertical' ? 'column' : 'row',
          overflow: 'hidden', position: 'relative',
        }}
      >
        {isSplit ? (
          <>
            <TabPane
              tabId={splitPanes[0]}
              isActive={splitPanes[0] === activeTabId}
              isSplit={true}
              onFocus={() => switchTab(splitPanes[0])}
            />
            <div className={`gnos-split-divider ${splitDir === 'vertical' ? 'v' : 'h'}`} />
            <TabPane
              tabId={splitPanes[1]}
              isActive={splitPanes[1] === activeTabId}
              isSplit={true}
              onFocus={() => switchTab(splitPanes[1])}
            />
          </>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {tabs.map(tab => (
              <TabPane
                key={tab.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                isSplit={false}
              />
            ))}
          </div>
        )}
      </div>

      {/* Tab layout modal */}
      {tabSettingsOpen && (
        <TabLayoutModal
          onClose={() => setTabSettingsOpen(false)}
          splitDir={splitDir}
          splitPanes={splitPanes}
          setSplitDir={setSplitDir}
          setSplitPanes={setSplitPanes}
          switchTab={switchTab}
        />
      )}
    </div>
  )
}