import { listen } from '@tauri-apps/api/event'
import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react'
import useAppStore, { defaultTitlebarLayout } from '@/store/useAppStore'
import { useIsMobile } from '@/lib/useIsMobile'
import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { readFile } from '@tauri-apps/plugin-fs'
import OnboardingView from '@/views/OnboardingView'

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { PaneContext, PaneChromeContext } from '@/lib/PaneContext'
import pluginHost from '@/lib/PluginHost'
import { loadPlugins } from '@/lib/loadPlugins'
import LibraryView, { SearchDropdown } from '@/views/LibraryView'
import { AddPopup } from '@/components/AddPopup'
import { makeId, generateCoverColor } from '@/lib/utils'
import ReaderView      from '@/views/ReaderView'
import AudioPlayerView from '@/views/AudioPlayerView'
import PdfView         from '@/views/PdfView'
// Registers window.__readerPerf + the `gnos:perf-cmd` listener app-wide, so the
// `/perf` search commands work before ReaderView has ever mounted. Inert until on().
import '@/lib/readerPerf'
import SideNav                                    from '@/components/SideNav'
import { UniversalSettingsModal } from '@/components/SideNav'
import GraphView       from '@/views/GraphView'
import CalendarView    from '@/views/CalendarView'
import { ArrowLeft, ArrowLeftRight, BookOpen, Calendar, CalendarArrowDown, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeftRight, CircleCheck, CirclePlay, CodeXml, Columns2, Copy, FilePlus2, FileText, FlipHorizontal, House, Layers, Library, Link, List, Lock, Maximize2, NotebookText, PanelLeft, PanelLeftClose, Pencil, Plus, Rows2, Search, Settings, SquareKanban, SquareStack, Star, TextSearch, TriangleAlert, User, Volume2, Waypoints, X } from 'lucide-react'

const NotebookView      = lazy(() => import('@/views/NotebookView'))
const SketchbookView    = lazy(() => import('@/views/SketchbookView'))
const FlashcardView     = lazy(() => import('@/views/FlashcardView'))
const KanbanView        = lazy(() => import('@/views/KanbanView'))
const PluginManagerView = lazy(() => import('@/views/PluginManagerView'))
const YjsProofHarness    = lazy(() => import('@/dev/YjsProofHarness'))
const YjsRelayHarness    = lazy(() => import('@/dev/YjsRelayHarness'))

const VIEW_LABELS = {
  library: 'Library', reader: 'Reading', 'audio-player': 'Listening',
  notebook: 'Notebook', pdf: 'PDF', sketchbook: 'Sketchbook',
  flashcard: 'Flashcards', graph: 'Graph', calendar: 'Calendar', kanban: 'Tasks',
  plugins: 'Plugins',
}

/** Derive a tab label from tab state — show file/content name when available.
 *  Pass `notebooks` and `flashcardDecks` from the store so title changes reflect without remounting. */
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

export const TITLEBAR_H = 34
// Mirrors SIDEBAR_WIDTH in SideNav.jsx (kept local to avoid a cross-module
// import just for the header's animating lead-zone width).
const SIDEBAR_WIDTH = 238

// ── ViewPanel ─────────────────────────────────────────────────────────────────
function ViewPanel({ view }) {
  let content = null
  if (view === 'library')      content = <LibraryView />
  else if (view === 'reader')       content = <ReaderView />
  else if (view === 'audio-player') content = <AudioPlayerView />
  else if (view === 'notebook')     content = <NotebookView />
  else if (view === 'pdf')          content = <PdfView />
  else if (view === 'sketchbook')   content = <SketchbookView />
  else if (view === 'flashcard')    content = <FlashcardView />
  else if (view === 'graph')        content = <GraphView />
  else if (view === 'calendar')     content = <CalendarView />
  else if (view === 'kanban')        content = <KanbanView />
  else if (view === 'plugins')       content = <PluginManagerView />
  if (!content) return null
  return <Suspense fallback={null}>{content}</Suspense>
}

// ── TabPane ───────────────────────────────────────────────────────────────────
// Lazily mounts on first activation and stays mounted for the tab's lifetime.
// Visibility is controlled by display:flex/none so the view doesn't remount on
// every tab switch, but the component does unmount when the tab is closed.
function TabPane({ tabId, isActive, isLastActive, isSplit, grow = 1, onFocus, onUnsplit, onSwapPanes, onClosePane }) {
  const tab = useAppStore(s => s.tabs.find(t => t.id === tabId))
  // Store slices for the split-pane header label (title changes reflect live).
  const notebooks      = useAppStore(s => s.notebooks)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const library        = useAppStore(s => s.library)
  const shouldMount = isActive || isSplit || isLastActive
  const [everActive, setEverActive] = useState(shouldMount)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shouldMount && !everActive) setEverActive(true)
  }, [shouldMount]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tab || !everActive) return null

  const paneChrome = isSplit ? { qaHostId: `qa-${tabId}`, saveIconId: `nbsave-${tabId}` } : null
  const paneLabel = getTabLabel(tab, { notebooks, flashcardDecks, sketchbooks, library })

  return (
    <PaneContext.Provider value={tabId}>
     <PaneChromeContext.Provider value={paneChrome}>
      <div
        className={isSplit ? 'pane-card' : undefined}
        onMouseDown={() => { if (isSplit && !isActive && onFocus) onFocus() }}
        onFocusCapture={() => { if (isSplit && !isActive && onFocus) onFocus() }}
        style={{
          ...(isSplit
            ? { flex: `${grow} 1 0%`, minWidth: 0, minHeight: 0, position: 'relative' }
            : { position: 'absolute', inset: 0 }
          ),
          overflow: 'hidden',
          display: (isSplit || isActive) ? 'flex' : 'none',
          flexDirection: 'column',
        }}>
        {/* Split panes get NO sidebar — the sidebar belongs to the single-pane
            layout only. In split you navigate via each pane's own header + the
            tab manager. */}
        {!isSplit && <SideNav isSplitPane={false} />}
        {/* Per-pane header (split only) — carries this pane's own title + its
            per-view actions (quick-access + save), so the global header stays
            clean and just reflects the active tab. */}
        {isSplit && (
          <div className={`pane-header${isActive ? ' active' : ''}`}>
            <span className="pane-header-title">{paneLabel}</span>
            <div className="pane-header-actions">
              {/* Window-manager chrome: swap sides · promote to full · close split */}
              <button className="pane-wm-btn" title="Swap sides" onClick={e => { e.stopPropagation(); onSwapPanes?.() }}>
                <ArrowLeftRight size={11} strokeWidth={1.4} />
              </button>
              <button className="pane-wm-btn" title="Expand this pane (unsplit)" onClick={e => { e.stopPropagation(); onUnsplit?.() }}>
                <Maximize2 size={11} strokeWidth={1.4} />
              </button>
              <button className="pane-wm-btn pane-wm-close" title="Close this pane (keep the other)" onClick={e => { e.stopPropagation(); onClosePane?.() }}>
                <X size={9} strokeWidth={1.5} />
              </button>
              <div id={`qa-${tabId}`} className="gnos-tb-quick pane-qa" />
              <svg id={`nbsave-${tabId}`} className="nb-save-icon" viewBox="0 0 18 18" fill="none">
                <circle className="nb-save-ring" cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <polyline className="nb-save-check" points="5.5,9 7.8,11.5 12.5,6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        )}
        <ViewPanel view={tab.view} />
        {isSplit && isActive && (
          <div
            style={{ position: 'absolute', inset: 0, zIndex: 300, pointerEvents: 'none', border: '2px solid var(--accent)', opacity: 0.3 }}
          />
        )}
      </div>
     </PaneChromeContext.Provider>
    </PaneContext.Provider>
  )
}

// ── Tab Layout Modal ──────────────────────────────────────────────────────────
function TabLayoutModal({ onClose, splitDir, splitPanes, setSplitDir, setSplitPanes, switchTab }) {
  const tabs           = useAppStore(s => s.tabs)
  const activeTabId    = useAppStore(s => s.activeTabId)
  const closeTab       = useAppStore(s => s.closeTab)
  const openNewTab     = useAppStore(s => s.openNewTab)
  const notebooks      = useAppStore(s => s.notebooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const library        = useAppStore(s => s.library)

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
              <div key={tab.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: tab.id === activeTabId ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent', marginBottom: 2 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: tab.id === activeTabId ? 'var(--accent)' : 'var(--border)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: tab.id === activeTabId ? 'var(--accent)' : 'var(--text)', fontWeight: tab.id === activeTabId ? 600 : 400 }}>
                  {getTabLabel(tab, { notebooks, flashcardDecks, sketchbooks, library })}
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
                    <Columns2 size={26} strokeWidth={1.5} />
                  )},
                  { dir: 'vertical', label: 'Top / Bottom', icon: (
                    <Rows2 size={26} strokeWidth={1.5} />
                  )},
                ].map(({ dir, label, icon }) => (
                  <button key={dir} onClick={() => startSplit(dir)}
                    style={{ flex: 1, padding: '10px 0 8px', background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, transition: 'border-color 0.1s, background 0.1s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)' }}
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
  /* ── Content frame — the floating "card" that holds the titlebar + page
     content, offset from the sidebar plane / window edges. Safari/Comet-style
     two-plane layout: the sidebar owns the flush left column (see Sidenav.jsx
     .sidenav-top-strip), this frame owns everything else. No radius/overflow
     on THIS element on purpose — box-shadow still follows border-radius fine
     without overflow:hidden, and skipping it means dropdowns/popovers/fixed
     overlays anchored inside the header or page content are never clipped.
     The rounded-corner *look* comes from radius on the frame itself plus its
     two children (.gnos-titlebar top corners, page content bottom corners)
     rather than from clipping. */
  /* Root — flex column: full-width header on top, content card below.
     Dark (var(--bg)) chrome field; the only lighter, floating element is
     the content card. Margins/sidebar/header/footer all read as one dark
     plane, the card as a distinct lighter window-within-the-window. */
  #app {
    display: flex; flex-direction: column;
    height: 100vh; overflow: hidden;
    background: var(--bg);
  }
  /* Full-width top header bar — chrome plane, pulled OUT of the content
     card so it belongs to the dark margins, not the lighter page. */
  .gnos-titlebar {
    position: relative; flex-shrink: 0; z-index: 20;
    height: ${TITLEBAR_H}px; margin: 0 6px;
    display: flex; align-items: center;
    padding: 6px 4px 0 0;
    background: transparent;
    box-sizing: border-box; overflow: visible;
    transition: transform 0.24s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* Content card — the lighter floating page. */
  .gnos-content-frame {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column; position: relative;
    margin: 6px;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.10);
    background: var(--surface);
    overflow: hidden;
    transition: margin-left 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* Split — the frame becomes a transparent shell so each pane reads as its
     own rounded card floating in the dark chrome, separated by a real gap. */
  .gnos-content-frame.split {
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }
  .pane-card {
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.10);
  }
  /* Divider between panes → a transparent gap that's still the resize handle. */
  .gnos-content-frame.split .gnos-split-divider.h { width: 7px; }
  .gnos-content-frame.split .gnos-split-divider.v { height: 7px; }
  /* Drag layer behind the controls, scoped to the card's header now */
  .gnos-titlebar-drag { position: absolute; inset: 0; z-index: 0; }
  /* Three sections; empty gaps fall through to the drag layer */
  .gnos-tb-left, .gnos-tb-center, .gnos-tb-right {
    position: relative; z-index: 1; pointer-events: none;
    display: flex; align-items: center;
  }
  .gnos-tb-left > *, .gnos-tb-center > *, .gnos-tb-right > * { pointer-events: auto; }
  /* Lead zone — the padding-left keeps its contents strictly to the RIGHT of
     the macOS traffic lights (trafficLightPosition x:16 in tauri.conf.json →
     the light cluster ends at window x≈68; the titlebar itself starts at x=6
     because of its 6px margin), so toggle+Home never sit under them even when
     the sidebar is closed. The zone width animates 144px→sidebar-width; the
     right-aligned buttons ride out to the sidebar's right edge as it opens,
     and back to ~25px past the traffic lights when it closes. */
  .gnos-tb-left {
    box-sizing: border-box;
    width: 144px; min-width: 144px; flex-shrink: 0;
    padding-left: 80px;
    justify-content: flex-end; gap: 3px;
    transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .gnos-titlebar.pushed .gnos-tb-left { width: ${SIDEBAR_WIDTH}px; }
  /* CTX zone — quick-open shortcuts; normal flow, sits right of the lead zone
     so it never overflows into the traffic lights (the lead zone is fixed-width). */
  .gnos-tb-ctx {
    position: relative; z-index: 1; pointer-events: none;
    /* 3px margin so Calendar/Nebuli sit the same distance from Home as Home
       does from the sidebar toggle — the lead zone's own flex gap stops at its
       last child, and the save slot that used to fill it renders null outside
       the notebook view. */
    margin-left: 3px;
    display: flex; align-items: center; gap: 3px; flex-shrink: 0;
  }
  .gnos-tb-ctx > * { pointer-events: auto; }
  /* Search-bar leading glyph — magnifier by default; the save flash swaps in
     over it (same slot, no layout shift). */
  .gnos-tbs-glyph { position: relative; display: flex; align-items: center; justify-content: center; width: 15px; height: 15px; flex-shrink: 0; }
  .gnos-tbs-magnifier { opacity: .55; transition: opacity 0.15s; }
  .gnos-tbs-glyph:has(.nb-save-icon.vis) .gnos-tbs-magnifier { opacity: 0; }
  /* Absolute only inside the glyph slot — pane-header save icons (global.css) keep flow */
  .gnos-tbs-glyph .nb-save-icon { position: absolute; inset: 0; width: 15px; height: 15px; }
  .nb-save-icon { color: var(--accent); opacity: 0; transition: opacity 0.2s; }
  .nb-save-icon.vis { opacity: 1; }
  .nb-save-ring { stroke-dasharray: 47; stroke-dashoffset: 47; transition: stroke-dashoffset 0s; }
  .nb-save-icon.anim .nb-save-ring { stroke-dashoffset: 0; transition: stroke-dashoffset 0.3s ease; }
  .nb-save-check { stroke-dasharray: 12; stroke-dashoffset: 12; transition: stroke-dashoffset 0s; }
  .nb-save-icon.anim .nb-save-check { stroke-dashoffset: 0; transition: stroke-dashoffset 0.15s ease 0.25s; }
  .nb-save-icon.closing .nb-save-check { stroke-dashoffset: 12; transition: stroke-dashoffset 0.15s ease; }
  .nb-save-icon.closing .nb-save-ring { stroke-dashoffset: 47; transition: stroke-dashoffset 0.3s ease 0.1s; }
  .nb-save-icon.closing { opacity: 0; transition: opacity 0.35s 0.25s; }
  .gnos-tb-right { flex-shrink: 0; gap: 4px; padding-right: 4px; margin-left: auto; }
  /* Center — the arrows+search+add group, absolutely centered on the WINDOW
     (not the leftover space between zones), so it reads as dead-center. Width
     is capped so it can never reach the lead or right zones — at the min window
     width it still leaves ~250px clearance each side. */
  .gnos-tb-center {
    position: absolute; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; justify-content: center; gap: 6px;
    /* --tb-clear is measured from the real left/right zone widths (see the
       ResizeObserver in the titlebar) so the centered search can never slide
       under the side zones no matter how many contextual buttons mount. */
    width: min(560px, calc(100vw - 2 * var(--tb-clear, 260px)));
    min-width: 0;
  }
  .gnos-tb-center > * { min-width: 0; }
  /* Per-pane header (split view only) — a slim local bar at the top of each
     pane with that pane's title + its per-view actions. */
  .pane-header {
    flex-shrink: 0; display: flex; align-items: center; gap: 8px;
    height: 34px; padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .pane-header-title {
    flex: 1; min-width: 0;
    font-size: 12px; font-weight: 600; color: var(--textDim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    letter-spacing: -0.01em;
  }
  .pane-header.active .pane-header-title { color: var(--text); }
  .pane-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .pane-qa { display: flex; align-items: center; gap: 3px; }
  .gnos-titlebar-settings {
    display: flex; align-items: center;
    align-self: center;
    flex-shrink: 0;
  }
  .gnos-settings-btn {
    width: 27px; height: 27px; border-radius: 6px;
    background: none; border: 1px solid transparent;
    color: var(--textDim); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .gnos-settings-btn:hover {
    background: var(--surfaceAlt); border-color: var(--border); color: var(--text);
  }
  .gnos-settings-btn.active {
    background: var(--surfaceAlt); border-color: var(--border); color: var(--accent);
  }
  .gnos-tab {
    display: flex; align-items: flex-end;
    height: 100%; flex-shrink: 1; min-width: 0;
    user-select: none; -webkit-app-region: no-drag;
  }
  .gnos-tab-body {
    display: flex; align-items: center; gap: 8px;
    height: calc(100% - 4px); bottom: -1px; position: relative;
    padding: 0 10px 1px 12px;
    border-radius: 12px 12px 0 0;
    border: 1px solid transparent; border-bottom: none;
    cursor: pointer;
    transition: background 0.14s, border-color 0.14s;
    min-width: 64px; max-width: 220px; overflow: hidden;
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
  /* Divider — 7px grab area, 1px visible line (accent on hover/drag) */
  .gnos-split-divider {
    flex-shrink: 0; background: transparent;
    z-index: 10; position: relative; touch-action: none;
  }
  .gnos-split-divider::after {
    content: ''; position: absolute; background: var(--border);
    transition: background 0.12s;
  }
  .gnos-split-divider.h { width: 7px; cursor: col-resize; align-self: stretch; }
  .gnos-split-divider.h::after { left: 3px; top: 0; bottom: 0; width: 1px; }
  .gnos-split-divider.v { height: 7px; cursor: row-resize; align-self: stretch; }
  .gnos-split-divider.v::after { top: 3px; left: 0; right: 0; height: 1px; }
  .gnos-split-divider:hover::after, .gnos-split-divider:active::after { background: var(--accent); }
  /* Pane window-manager buttons — visible on pane-header hover */
  .pane-wm-btn {
    width: 20px; height: 20px; border-radius: 5px; border: none; background: none;
    color: var(--textDim); cursor: pointer; display: flex; align-items: center;
    justify-content: center; padding: 0; opacity: 0; transition: opacity .12s, background .1s, color .1s;
  }
  .pane-header:hover .pane-wm-btn { opacity: .7; }
  .pane-wm-btn:hover { background: var(--surfaceAlt); color: var(--text); opacity: 1; }
  .pane-wm-close:hover { background: rgba(248,81,73,.14); color: #f85149; }
  @media all and (display-mode: fullscreen) {
    .gnos-titlebar { padding-left: 12px; }
  }
  .gnos-titlebar.is-fullscreen { padding-left: 12px; }
  /* Fullscreen hides the traffic lights, so the lead zone no longer needs to
     clear them — pull the buttons back to the window edge. */
  .gnos-titlebar.is-fullscreen .gnos-tb-left { width: 64px; min-width: 64px; padding-left: 0; }
  .gnos-titlebar.is-fullscreen.pushed .gnos-tb-left { width: ${SIDEBAR_WIDTH}px; min-width: 0; }
  .gnos-new-tab-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 4px;
    border: 1px solid transparent; background: transparent;
    color: var(--textDim); cursor: pointer; flex-shrink: 0;
    align-self: center; margin-top: 5px;
    opacity: 0.35;
    transition: background 0.13s, color 0.13s, opacity 0.13s, border-color 0.13s;
  }
  .gnos-new-tab-btn:hover { background: var(--surfaceAlt); border-color: var(--border); color: var(--text); opacity: 1; }
  .gnos-tab-nav-btn {
    display: flex; align-items: center; justify-content: center;
    width: 27px; height: 27px; border-radius: 6px;
    border: 1px solid transparent; background: transparent;
    color: var(--textDim); cursor: pointer; flex-shrink: 0;
    align-self: center; padding: 0; margin: 0;
    opacity: 0.55;
    transition: background 0.12s, color 0.12s, opacity 0.12s, border-color 0.12s;
  }
  .gnos-tab-nav-btn:hover:not(:disabled) { background: var(--surfaceAlt); border-color: var(--border); color: var(--text); opacity: 1; }
  .gnos-tab-nav-btn:disabled { opacity: 0.15; cursor: default; }
  .gnos-tab.drag-over .gnos-tab-body { border-color: var(--accent) !important; background: color-mix(in srgb, var(--accent) 8%, transparent) !important; }

  /* ── Titlebar controls (sidebar-tabs mode) ── */
  .gnos-titlebar-search {
    position: relative; display: flex; align-items: center; gap: 8px;
    /* No overflow:hidden here — the chapter dropdown panel renders inside this
       container and would be clipped. The input itself truncates via min-width:0. */
    align-self: center; flex: 1 1 auto; width: auto; min-width: 64px; max-width: none;
    height: 27px; padding: 0 11px;
    background: var(--surfaceAlt); border: 1px solid var(--borderSubtle);
    border-radius: 8px; color: var(--textDim);
    -webkit-app-region: no-drag;
    transition: border-color .12s, background .12s;
  }
  .gnos-titlebar-search:focus-within { border-color: var(--focusBorder); box-shadow: var(--focusRing); color: var(--text); background: var(--surface); }
  .gnos-titlebar-search svg { width: 14px; height: 14px; }
  .gnos-titlebar-search input {
    flex: 1; min-width: 0; background: none; border: none; outline: none;
    color: var(--text); font-size: 12.5px; font-weight: 600; font-family: var(--font-ui);
    user-select: text; -webkit-user-select: text; text-align: center;
  }
  .gnos-titlebar-search.focused input { text-align: left; }
  /* Idle: placeholder is the current page title — render it like real text, centered */
  .gnos-titlebar-search:not(.focused) input::placeholder { color: var(--text); opacity: .92; font-weight: 600; }
  .gnos-titlebar-search.focused input::placeholder { color: var(--textDim); opacity: .7; font-weight: 500; }
  /* Per-view extras inside the search bar (counts, chapter dropdown) */
  .gnos-tbs-meta {
    flex-shrink: 0; font-size: 10.5px; font-weight: 600; color: var(--textDim);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .gnos-tbs-chevron {
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border: none; background: none; border-radius: 5px;
    color: var(--textDim); cursor: pointer; padding: 0;
    transition: background .1s, color .1s;
  }
  .gnos-tbs-chevron:hover { background: var(--hover); color: var(--text); }
  .gnos-tbs-drop {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--borderSubtle);
    border-radius: 10px; overflow: hidden auto; max-height: 340px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.04), 0 10px 24px rgba(0,0,0,0.28); z-index: 10001;
    padding: 4px;
  }
  .gnos-tbs-drop-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 10px; border: none; background: none; border-radius: 7px;
    color: var(--text); font-size: 12px; font-weight: 500; font-family: var(--font-ui);
    cursor: pointer; text-align: left;
  }
  .gnos-tbs-drop-item:hover { background: var(--hover); }
  .gnos-tbs-drop-item.active { color: var(--accent); font-weight: 600; }
  /* Quick access strip — per-view action buttons, portal target */
  .gnos-tb-quick { display: flex; align-items: center; gap: 3px; }
  .gnos-tb-quick:not(:empty) { margin-right: 5px; padding-right: 8px; border-right: 1px solid var(--borderSubtle); }
  .gnos-titlebar-search-x { cursor: pointer; font-size: 11px; opacity: .6; flex-shrink: 0; }
  .gnos-titlebar-search-x:hover { opacity: 1; }
  .gnos-titlebar-iconbtn {
    width: 27px; height: 27px; border-radius: 6px;
    background: var(--surfaceAlt); border: 1px solid var(--borderSubtle);
    color: var(--textDim); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .12s, color .12s, border-color .12s;
  }
  .gnos-titlebar-iconbtn:hover { background: var(--hover); color: var(--text); border-color: var(--border); }
  .gnos-titlebar-iconbtn svg { width: 13px; height: 13px; }

  /* ── Tab overview — browser-style tab manager grid ── */
  .gnos-tab-overview {
    /* Starts BELOW the app titlebar — the native header (sidebar toggle,
       search, quick actions) stays visible and interactive above the switcher */
    position: fixed; top: ${TITLEBAR_H}px; right: 0; bottom: 0; z-index: 8990;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(16px) saturate(1.1); -webkit-backdrop-filter: blur(16px) saturate(1.1);
    display: flex; flex-direction: column;
    animation: gnos-overview-in .16s cubic-bezier(0.2,0.8,0.3,1);
    transition: left .22s cubic-bezier(0.4,0,0.2,1);
  }
  @keyframes gnos-overview-in { from { opacity: 0 } to { opacity: 1 } }
  .gnos-tab-overview-head {
    display: flex; align-items: center; gap: 8px;
    padding: 20px 32px 10px;
  }
  .gnos-tab-overview-title {
    font-size: 11px; font-weight: 700; color: var(--textDim);
    letter-spacing: .07em; text-transform: uppercase;
  }
  .gnos-tab-overview-act {
    background: none; border: 1px solid var(--borderSubtle);
    border-radius: 8px; padding: 5px 13px; font-size: 12px; font-weight: 500;
    color: var(--text); cursor: pointer; font-family: var(--font-ui);
    transition: background .12s, border-color .12s;
  }
  .gnos-tab-overview-act:hover { background: var(--hover); border-color: var(--border); }
  .gnos-tab-overview-grid {
    flex: 1; overflow-y: auto; align-content: start;
    display: grid; grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
    gap: 16px; padding: 12px 32px 36px;
  }
  .gnos-tab-overview-card {
    border-radius: 11px; overflow: hidden; cursor: pointer;
    border: 1px solid var(--borderSubtle); background: var(--surface);
    transition: transform .14s ease, box-shadow .14s ease, border-color .14s;
  }
  .gnos-tab-overview-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.04), 0 10px 24px rgba(0,0,0,0.22);
    border-color: var(--border);
  }
  .gnos-tab-overview-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .gnos-tab-overview-card.focused { border-color: var(--border); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent); }
  .gnos-tab-overview-thumb {
    height: 128px; display: flex; align-items: center; justify-content: center;
    background: var(--surfaceAlt); opacity: .92;
  }
  /* Content covers — library-card language */
  .gnos-tab-overview-cover {
    height: 128px; overflow: hidden; display: flex; align-items: center; justify-content: center;
    background: var(--surfaceAlt);
  }
  .gnos-tab-overview-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .gnos-tab-overview-cover-gen {
    align-items: flex-start; padding: 12px 14px; box-sizing: border-box;
  }
  .gnos-tab-overview-cover-gen span {
    font-size: 13px; font-weight: 800; color: #fff; line-height: 1.3;
    letter-spacing: .02em; word-break: break-word; overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  }
  .gnos-tab-overview-meta {
    display: flex; align-items: center; gap: 6px;
    padding: 9px 12px; border-top: 1px solid var(--borderSubtle);
  }
  .gnos-tab-overview-label {
    flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .gnos-tab-overview-x {
    width: 18px; height: 18px; border-radius: 5px; border: none; background: none;
    color: var(--textDim); cursor: pointer; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; padding: 0; opacity: 0; transition: background .1s, color .1s, opacity .1s;
  }
  .gnos-tab-overview-card:hover .gnos-tab-overview-x { opacity: .6; }
  .gnos-tab-overview-x:hover { background: rgba(248,81,73,.14); color: #f85149; opacity: 1; }
  .gnos-tab-overview-new { border-style: dashed; background: transparent; }
  .gnos-tab-overview-new .gnos-tab-overview-thumb { background: transparent; color: var(--textDim); }
`

// ── View colors + icons for mobile tab previews ───────────────────────────────
const VIEW_PREVIEW = {
  library:      { color: '#388bfd', icon: <Library size={28} strokeWidth={1.6} /> },
  reader:       { color: '#c0976a', icon: <BookOpen size={28} strokeWidth={1.6} /> },
  'audio-player': { color: '#8250df', icon: <CirclePlay size={28} strokeWidth={1.6} /> },
  notebook:     { color: '#3fb950', icon: <NotebookText size={28} strokeWidth={1.6} /> },
  sketchbook:   { color: '#e05c7a', icon: <Pencil size={28} strokeWidth={1.6} /> },
  flashcard:    { color: '#e8922a', icon: <Layers size={28} strokeWidth={1.5} /> },
  graph:        { color: '#56d4dd', icon: <Waypoints size={28} strokeWidth={1.6} /> },
  pdf:          { color: '#f0883e', icon: <FileText size={28} strokeWidth={1.6} /> },
  calendar:     { color: '#1a6b3a', icon: <Calendar size={28} strokeWidth={1.6} /> },
  kanban:       { color: '#7a1f6e', icon: <SquareKanban size={28} strokeWidth={1.5} /> },
}

// Content-first tab-card preview — reuses the library-card cover system so the
// overview reads like the rest of the app (real covers, not generic icons).
function tabCardPreview(tab, { notebooks = [], sketchbooks = [], library = [] } = {}) {
  const generic = VIEW_PREVIEW[tab.view] || VIEW_PREVIEW.library
  const coverImg = (src, bg) => (
    <div className="gnos-tab-overview-cover" style={bg ? { background: bg } : undefined}>
      <img src={src} alt="" draggable="false" loading="lazy" decoding="async" />
    </div>
  )
  const titleBlock = (title, c1, c2) => (
    <div className="gnos-tab-overview-cover gnos-tab-overview-cover-gen"
      style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
      <span>{title}</span>
    </div>
  )
  if ((tab.view === 'reader' || tab.view === 'pdf') && tab.activeBook) {
    const b = library.find(x => x.id === tab.activeBook.id) || tab.activeBook
    if (b.coverDataUrl) return coverImg(b.coverDataUrl)
    const [c1, c2] = generateCoverColor(b.title || '')
    return titleBlock(b.title, c1, c2)
  }
  if (tab.view === 'audio-player' && tab.activeAudioBook) {
    const b = library.find(x => x.id === tab.activeAudioBook.id) || tab.activeAudioBook
    if (b.coverDataUrl) return coverImg(b.coverDataUrl)
    const [c1, c2] = generateCoverColor(b.title || '')
    return titleBlock(b.title, c1, c2)
  }
  if (tab.view === 'notebook' && tab.activeNotebook) {
    const nb = notebooks.find(x => x.id === tab.activeNotebook.id) || tab.activeNotebook
    if (nb.coverDataUrl) return coverImg(nb.coverDataUrl)
    const c = nb.coverColor || '#2d1b69'
    return titleBlock(nb.title, c, c)
  }
  if (tab.view === 'sketchbook' && tab.activeSketchbook) {
    const sb = sketchbooks.find(x => x.id === tab.activeSketchbook.id) || tab.activeSketchbook
    if (sb.coverDataUrl) return coverImg(sb.coverDataUrl, sb.coverBgColor || '#ffffff')
  }
  return <div className="gnos-tab-overview-thumb" style={{ color: generic.color }}>{generic.icon}</div>
}

const LIB_TABS = [
  { id: 'library',     label: 'Library' },
  { id: 'books',       label: 'Books' },
  { id: 'audiobooks',  label: 'Audiobooks' },
  { id: 'notebooks',   label: 'Notebooks' },
  { id: 'collections', label: 'Collections' },
]

// ── Mobile tab switcher ───────────────────────────────────────────────────────
function MobileTabSwitcher({ onClose, switchTab, tabs, activeTabId, closeTab, openNewTab, notebooks, flashcardDecks, sketchbooks, library }) {
  return (
    <div className="mobile-tab-switcher-view">
      <div style={{ padding: '0 16px', overflowY: 'auto', height: '100%' }}>
        <div className="mobile-tab-cards">
          {tabs.map(tab => {
            const preview = VIEW_PREVIEW[tab.view] || VIEW_PREVIEW.library
            const label = getTabLabel(tab, { notebooks, flashcardDecks, sketchbooks, library })
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={`mobile-tab-card${isActive ? ' active-tab' : ''}`}
                onClick={() => { switchTab(tab.id); onClose() }}
              >
                <div className="mobile-tab-card-preview" style={{ background: preview.color + '1a', color: preview.color }}>
                  {preview.icon}
                </div>
                <div className="mobile-tab-card-footer">
                  <span className="mobile-tab-card-label">{label}</span>
                  {tabs.length > 1 && (
                    <button
                      className="mobile-tab-card-close"
                      onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                      aria-label="Close tab"
                    >
                      <X size={8} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <button className="mobile-tabs-new-btn" onClick={() => { openNewTab({ view: 'library', activeLibTab: 'library' }); onClose() }}>
        <Plus size={14} strokeWidth={2.2} />
        New Tab
      </button>
    </div>
  )
}

// ── Mobile view title pill (floats between corner buttons) ───────────────────
function MobileViewTitle({ activeTab }) {
  const notebooks      = useAppStore(s => s.notebooks)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)

  if (!activeTab) return <div className="mobile-gnos-title">Gnos</div>

  const v = activeTab.view

  if (v === 'notebook' && activeTab.activeNotebook) {
    const nb  = notebooks.find(n => n.id === activeTab.activeNotebook.id) || activeTab.activeNotebook
    const wc  = nb.wordCount || 0
    return (
      <div className="mobile-view-title-pill">
        <div className="mobile-view-title-btn">
          <span className="mobile-view-title-name">{nb.title || 'Notebook'}</span>
          <span className="mobile-view-title-meta">{wc.toLocaleString()} words</span>
        </div>
      </div>
    )
  }

  if (v === 'sketchbook' && activeTab.activeSketchbook) {
    const sb    = sketchbooks.find(s => s.id === activeTab.activeSketchbook.id) || activeTab.activeSketchbook
    const count = sb.elementCount || 0
    return (
      <div className="mobile-view-title-pill">
        <div className="mobile-view-title-btn">
          <span className="mobile-view-title-name">{sb.title || 'Sketchbook'}</span>
          <span className="mobile-view-title-meta">{count} {count === 1 ? 'shape' : 'shapes'}</span>
        </div>
      </div>
    )
  }

  if (v === 'flashcard' && activeTab.activeFlashcardDeck) {
    const deck     = flashcardDecks.find(d => d.id === activeTab.activeFlashcardDeck.id) || activeTab.activeFlashcardDeck
    const cards    = deck.cards || []
    const now      = Date.now()
    const due      = cards.filter(c => !c.nextReview || c.nextReview <= now).length
    const streak   = deck.streak || 0
    return (
      <div className="mobile-view-title-pill">
        <div className="mobile-view-title-btn">
          <span className="mobile-view-title-name">{deck.title || 'Flashcards'}</span>
          <span className="mobile-view-title-meta">{cards.length} cards · {due} due{streak > 0 ? ` · 🔥${streak}d` : ''}</span>
        </div>
      </div>
    )
  }

  return <div className="mobile-gnos-title">Gnos</div>
}

// ── Mobile bottom bar ─────────────────────────────────────────────────────────
function MobileBottomBar({ activeView, onTabsOpen, tabsOpen }) {
  const setView         = useAppStore(s => s.setView)
  const setActiveLibTab = useAppStore(s => s.setActiveLibTab)
  const activeLibTab    = useAppStore(s => s.activeLibTab)

  const [searchActive, setSearchActive]             = useState(false)
  const [searchQuery, setSearchQuery]               = useState('')
  const [chaptersSearchActive, setChaptersSearchActive] = useState(false)
  const [chaptersSearchQuery, setChaptersSearchQuery]   = useState('')
  const [homePopup, setHomePopup]             = useState(false)
  const [profileViewOpen, setProfileViewOpen] = useState(false)
  const [readerTtsOn, setReaderTtsOn]         = useState(false)
  const [syntaxOpen, setSyntaxOpen]           = useState(false)
  const [nbViewMode, setNbViewMode]           = useState('live')
  const [nbSearchOpen, setNbSearchOpen]       = useState(false)
  const [nbSearchQuery, setNbSearchQuery]     = useState('')
  const nbSearchRef    = useRef(null)
  const holdTimerRef   = useRef(null)
  const didHoldRef     = useRef(false)
  const syntaxScrollRef = useRef(null)
  const nbLiveHold     = useRef(null)
  const nbLiveDidHold  = useRef(false)
  const homeBtnRef     = useRef(null)
  const searchInputRef = useRef(null)

  // Mirror profile modal open/close state from LibraryView
  useEffect(() => {
    const h = e => setProfileViewOpen(e.detail.open)
    window.addEventListener('gnos:mobile-profile-state', h)
    return () => window.removeEventListener('gnos:mobile-profile-state', h)
  }, [])

  // Mirror reader TTS state
  useEffect(() => {
    const h = e => setReaderTtsOn(e.detail.ttsActive)
    window.addEventListener('gnos:reader-state', h)
    return () => window.removeEventListener('gnos:reader-state', h)
  }, [])

  // Mirror notebook view mode
  useEffect(() => {
    const h = e => setNbViewMode(e.detail.mode)
    window.addEventListener('gnos:nb-viewmode', h)
    return () => window.removeEventListener('gnos:nb-viewmode', h)
  }, [])

  // Open notebook search bar
  useEffect(() => {
    const h = () => { setNbSearchOpen(true); setTimeout(() => nbSearchRef.current?.focus(), 50) }
    window.addEventListener('gnos:mobile-nb-search-open', h)
    return () => window.removeEventListener('gnos:mobile-nb-search-open', h)
  }, [])

  function goTo(tabId) {
    setView('library')
    setActiveLibTab(tabId)
    setHomePopup(false)
  }

  function onHomeDown() {
    didHoldRef.current = false
    holdTimerRef.current = setTimeout(() => {
      didHoldRef.current = true
      setHomePopup(true)
    }, 400)
  }
  function onHomeUp() {
    clearTimeout(holdTimerRef.current)
    if (!didHoldRef.current) goTo('library')
  }
  function onHomeLeave() { clearTimeout(holdTimerRef.current) }

  function openSearch() {
    setSearchActive(true)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }
  function closeSearch() {
    setSearchActive(false)
    setSearchQuery('')
    window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: '' }))
  }
  function onSearchChange(e) {
    setSearchQuery(e.target.value)
    window.dispatchEvent(new CustomEvent('gnos:mobile-search-query', { detail: e.target.value }))
  }

  function triggerAdd() { window.dispatchEvent(new CustomEvent('gnos:mobile-add')) }
  function triggerProfile() { window.dispatchEvent(new CustomEvent('gnos:mobile-profile')) }
  function triggerProfileClose() { window.dispatchEvent(new CustomEvent('gnos:mobile-profile-close')) }

  const readerCmd = (cmd) => window.dispatchEvent(new CustomEvent('gnos:reader-cmd', { detail: { cmd } }))

  const nbCmd = (cmd) => window.dispatchEvent(new CustomEvent('gnos:mobile-nb-cmd', { detail: { cmd } }))
  const sbCmd = (cmd) => window.dispatchEvent(new CustomEvent('gnos:mobile-sb-cmd', { detail: { cmd } }))
  const fcCmd = (cmd) => window.dispatchEvent(new CustomEvent('gnos:mobile-fc-cmd', { detail: { cmd } }))

  const chapterSearchInputRef = useRef(null)
  function openChaptersSearch() {
    setChaptersSearchActive(true)
    setChaptersSearchQuery('')
    setTimeout(() => chapterSearchInputRef.current?.focus(), 50)
  }
  function closeChaptersSearch() {
    setChaptersSearchActive(false)
    setChaptersSearchQuery('')
    window.dispatchEvent(new CustomEvent('gnos:reader-chapter-search', { detail: '' }))
    readerCmd('chapters-close')
  }
  function onChapterSearchChange(e) {
    const q = e.target.value
    setChaptersSearchQuery(q)
    window.dispatchEvent(new CustomEvent('gnos:reader-chapter-search', { detail: q }))
  }

  return (
    <>
      {/* Syntax insert bar — thin horizontal strip above notebook bottom nav */}
      {syntaxOpen && activeView === 'notebook' && (
        <div style={{ position: 'fixed', bottom: 'calc(max(12px, env(safe-area-inset-bottom, 0px) + 6px) + 45px + 6px)',
          left: '50%', transform: 'translateX(-50%)', width: 'min(92vw, 420px)', height: 42,
          background: 'var(--surfaceTranslucent)', border: '1px solid var(--border)', borderRadius: 14,
          boxShadow: '0 4px 20px rgba(0,0,0,0.22), 0 1px 0 rgba(255,255,255,0.04) inset', zIndex: 9000,
          backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          display: 'flex', alignItems: 'center', gap: 0 }}>
          <button onClick={() => syntaxScrollRef.current?.scrollBy({ left: -80, behavior: 'smooth' })}
            style={{ flexShrink: 0, width: 28, height: 42, border: 'none', background: 'transparent',
              color: 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', borderRadius: '14px 0 0 14px' }}>
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <div ref={syntaxScrollRef} style={{ flex: 1, display: 'flex', alignItems: 'center',
            overflowX: 'auto', gap: 2, scrollbarWidth: 'none' }}>
            {[
              { icon: <span style={{ fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 13 }}>B</span>, before: '**', after: '**', placeholder: 'bold' },
              { icon: <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 13 }}>I</span>, before: '*', after: '*', placeholder: 'italic' },
              { icon: <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{`</>`}</span>, before: '`', after: '`', placeholder: 'code' },
              { icon: <span style={{ fontWeight: 700, fontSize: 12 }}>#</span>, before: '# ', after: '', placeholder: 'heading' },
              { icon: <span style={{ fontWeight: 700, fontSize: 11 }}>##</span>, before: '## ', after: '', placeholder: 'heading' },
              { icon: <span style={{ fontSize: 13 }}>•</span>, before: '- ', after: '', placeholder: 'item' },
              { icon: <span style={{ fontSize: 11 }}>1.</span>, before: '1. ', after: '', placeholder: 'item' },
              { icon: <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>"</span>, before: '> ', after: '', placeholder: 'quote' },
              { icon: <Link size={13} strokeWidth={1.6} />, before: '[', after: '](url)', placeholder: 'text' },
              { icon: <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 12 }}>∑</span>, before: '$', after: '$', placeholder: 'expr' },
              { icon: <span style={{ fontSize: 12, background: 'var(--accent)', color: '#fff', borderRadius: 2, padding: '0 2px', lineHeight: 1.3 }}>H</span>, before: '==', after: '==', placeholder: 'highlight' },
              { icon: <span style={{ textDecoration: 'line-through', fontSize: 11 }}>S</span>, before: '~~', after: '~~', placeholder: 'text' },
            ].map((s, i) => (
              <button key={i}
                onClick={() => window.dispatchEvent(new CustomEvent('gnos:mobile-nb-cmd', { detail: { cmd: 'insert', ...s, icon: undefined } }))}
                style={{ flexShrink: 0, width: 36, height: 32, border: 'none', borderRadius: 8,
                  background: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.icon}
              </button>
            ))}
          </div>
          <button onClick={() => syntaxScrollRef.current?.scrollBy({ left: 80, behavior: 'smooth' })}
            style={{ flexShrink: 0, width: 28, height: 42, border: 'none', background: 'transparent',
              color: 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', borderRadius: '0 14px 14px 0' }}>
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className={`mobile-bottom-bar${activeView !== 'reader' && searchActive ? ' search-expanded' : ''}${activeView === 'reader' && chaptersSearchActive ? ' search-expanded' : ''}`}>
        {activeView === 'reader' && chaptersSearchActive ? (
          <>
            <Search size={16} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--textDim)' }} />
            <input
              ref={chapterSearchInputRef}
              className="mobile-nav-search-input"
              placeholder="Search chapters or page #…"
              value={chaptersSearchQuery}
              onChange={onChapterSearchChange}
              autoFocus
            />
            <button className="mobile-nav-search-return" onClick={closeChaptersSearch} title="Close">
              <ArrowLeft size={14} strokeWidth={1.8} />
            </button>
          </>
        ) : activeView === 'reader' ? (
          <>
            {/* ← Prev Page — rounded button */}
            <button className="mobile-nav-btn" onClick={() => readerCmd('prev')} title="Previous page">
              <div className="mobile-nav-btn-arrow">
                <ChevronLeft size={18} strokeWidth={2.2} />
              </div>
            </button>

            {/* Library / back to library */}
            <button className="mobile-nav-btn" onClick={() => { setView('library'); setActiveLibTab('library') }} title="Library">
              <Library size={20} strokeWidth={2} />
            </button>

            {/* → Next Page — rounded button */}
            <button className="mobile-nav-btn" onClick={() => readerCmd('next')} title="Next page">
              <div className="mobile-nav-btn-arrow">
                <ChevronRight size={18} strokeWidth={2.2} />
              </div>
            </button>

            {/* Chapters / Search — expands to search bar */}
            <button className="mobile-nav-btn" onClick={openChaptersSearch} title="Chapters">
              <TextSearch size={20} strokeWidth={2} />
            </button>

            {/* TTS toggle */}
            <button
              className={`mobile-nav-btn${readerTtsOn ? ' active' : ''}`}
              onClick={() => readerCmd('tts-toggle')}
              title="Read aloud"
            >
              <Volume2 size={18} strokeWidth={2} />
            </button>

            {/* Tabs */}
            <button className={`mobile-nav-btn${tabsOpen ? " active" : ""}`} onClick={onTabsOpen}>
              <SquareStack size={20} strokeWidth={2} />
            </button>
          </>

        ) : activeView === 'notebook' && nbSearchOpen ? (
          <>
            <Search size={16} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--textDim)' }} />
            <input
              ref={nbSearchRef}
              className="mobile-nav-search-input"
              placeholder="Find in notebook…"
              value={nbSearchQuery}
              onChange={e => { setNbSearchQuery(e.target.value); window.dispatchEvent(new CustomEvent('gnos:mobile-nb-search-query', { detail: e.target.value })) }}
              autoFocus
            />
            <button className="mobile-nav-search-return" onClick={() => { setNbSearchOpen(false); setNbSearchQuery(''); window.dispatchEvent(new CustomEvent('gnos:mobile-nb-search-query', { detail: '' })) }} title="Close">
              <ArrowLeft size={14} strokeWidth={1.8} />
            </button>
          </>

        ) : activeView === 'notebook' ? (
          <>
            {/* Syntax insert bar toggle */}
            <button className={`mobile-nav-btn${syntaxOpen ? ' active' : ''}`} onClick={() => setSyntaxOpen(o => !o)} title="Insert syntax">
              <CodeXml size={18} strokeWidth={2} />
            </button>

            {/* Library */}
            <button className="mobile-nav-btn" onClick={() => { setView('library'); setActiveLibTab('library') }} title="Library">
              <Library size={20} strokeWidth={2} />
            </button>

            {/* Live mode toggle — active when in source mode; hold for view mode menu */}
            <button className={`mobile-nav-btn${nbViewMode === 'source' ? ' active' : ''}`}
              onPointerDown={() => { nbLiveDidHold.current=false; nbLiveHold.current=setTimeout(()=>{ nbLiveDidHold.current=true; nbCmd('live-menu') },400) }}
              onPointerUp={() => { clearTimeout(nbLiveHold.current); if(!nbLiveDidHold.current) nbCmd('live-toggle') }}
              onPointerLeave={() => clearTimeout(nbLiveHold.current)}
              title="Toggle live mode">
              <div className="mobile-add-btn-inner">
                {/* Brand quill — hand-drawn, not a lucide glyph (see icons.jsx) */}
                <svg width="13" height="13" viewBox="0 0 32 32" fill="none">
                  <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/>
                  <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
                  <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"/>
                  <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55"/>
                </svg>
              </div>
            </button>

            {/* Search */}
            <button className="mobile-nav-btn" onClick={() => nbCmd('search')} title="Find in notebook">
              <Search size={20} strokeWidth={2} />
            </button>

            {/* Tabs */}
            <button className={`mobile-nav-btn${tabsOpen ? " active" : ""}`} onClick={onTabsOpen}>
              <SquareStack size={20} strokeWidth={2} />
            </button>
          </>

        ) : activeView === 'sketchbook' ? (
          <>
            {/* Import PDF */}
            <button className="mobile-nav-btn" onClick={() => sbCmd('import')} title="Import PDF">
              <FilePlus2 size={18} strokeWidth={1.4} />
            </button>

            {/* Library */}
            <button className="mobile-nav-btn" onClick={() => { setView('library'); setActiveLibTab('library') }} title="Library">
              <Library size={20} strokeWidth={2} />
            </button>

            {/* Lock background */}
            <button className="mobile-nav-btn" onClick={() => sbCmd('lock-toggle')} title="Lock/unlock background">
              <div className="mobile-add-btn-inner">
                <Lock size={13} strokeWidth={1.4} />
              </div>
            </button>

            {/* Sketchbook settings */}
            <button className="mobile-nav-btn" onClick={() => sbCmd('settings')} title="Sketchbook settings">
              <Settings size={18} strokeWidth={1.4} />
            </button>

            {/* Tabs */}
            <button className={`mobile-nav-btn${tabsOpen ? " active" : ""}`} onClick={onTabsOpen}>
              <SquareStack size={20} strokeWidth={2} />
            </button>
          </>

        ) : activeView === 'flashcard' ? (
          <>
            {/* Study side toggle */}
            <button className="mobile-nav-btn" onClick={() => fcCmd('studyside')} title="Flip study direction">
              <FlipHorizontal size={18} strokeWidth={1.4} />
            </button>

            {/* Library */}
            <button className="mobile-nav-btn" onClick={() => { setView('library'); setActiveLibTab('library') }} title="Library">
              <Library size={20} strokeWidth={2} />
            </button>

            {/* Study mode */}
            <button className="mobile-nav-btn" onClick={() => fcCmd('study')} title="Study">
              <div className="mobile-add-btn-inner">
                <Layers size={13} strokeWidth={1.3} />
              </div>
            </button>

            {/* List mode */}
            <button className="mobile-nav-btn" onClick={() => fcCmd('list')} title="List view">
              <List size={18} strokeWidth={2} />
            </button>

            {/* Tabs */}
            <button className={`mobile-nav-btn${tabsOpen ? " active" : ""}`} onClick={onTabsOpen}>
              <SquareStack size={20} strokeWidth={2} />
            </button>
          </>

        ) : searchActive ? (
          <>
            <Search size={16} strokeWidth={1.8} style={{ flexShrink: 0, color: 'var(--textDim)' }} />
            <input
              ref={searchInputRef}
              className="mobile-nav-search-input"
              placeholder="Search library…"
              value={searchQuery}
              onChange={onSearchChange}
              autoFocus
            />
            <button className="mobile-nav-search-return" onClick={closeSearch} title="Close search">
              <ArrowLeft size={14} strokeWidth={1.8} />
            </button>
          </>
        ) : (
          <>
            {/* Profile — becomes back arrow when profile is open */}
            <button className="mobile-nav-btn" onClick={profileViewOpen ? triggerProfileClose : triggerProfile}>
              {profileViewOpen ? (
                <ChevronLeft size={20} strokeWidth={2.2} />
              ) : (
                <User size={20} strokeWidth={2} />
              )}
            </button>

            {/* Library — long-press for tab picker */}
            <button
              ref={homeBtnRef}
              className={`mobile-nav-btn${activeView === 'library' ? ' active' : ''}`}
              onPointerDown={onHomeDown}
              onPointerUp={onHomeUp}
              onPointerLeave={onHomeLeave}
              onPointerCancel={onHomeLeave}
            >
              <Library size={20} strokeWidth={2} />
            </button>

            {/* Add — styled like the desktop header plus button */}
            <button className="mobile-nav-btn" onClick={triggerAdd}>
              <div className="mobile-add-btn-inner">
                <Plus size={13} strokeWidth={2} />
              </div>
            </button>

            {/* Search */}
            <button className="mobile-nav-btn" onClick={openSearch}>
              <Search size={20} strokeWidth={2} />
            </button>

            {/* Tabs */}
            <button className={`mobile-nav-btn${tabsOpen ? " active" : ""}`} onClick={onTabsOpen}>
              <SquareStack size={20} strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* Library tab row — slides up above nav on long-press */}
      {homePopup && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9099 }} onClick={() => setHomePopup(false)} />
          <div className="mobile-lib-row">
            {LIB_TABS.map(t => (
              <button
                key={t.id}
                className={`mobile-lib-row-item${activeLibTab === t.id && activeView === 'library' ? ' active' : ''}`}
                onClick={() => goTo(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── Theme palettes for loading screen ─────────────────────────────────────────
const LOADING_THEMES = {
  sepia:  { bg: '#faf8f5', accent: '#8b5e3c', text: '#3b2f20', dim: '#7a6652', border: '#d4c4b0' },
  light:  { bg: '#f6f8fa', accent: '#0969da', text: '#1f2328', dim: '#636c76', border: '#d0d7de' },
  moss:   { bg: '#eef3e8', accent: '#3d6e32', text: '#1e2c14', dim: '#4e6840', border: '#a8c090' },
  dark:   { bg: '#0d1117', accent: '#388bfd', text: '#e6edf3', dim: '#8b949e', border: '#30363d' },
  cherry: { bg: '#0e0608', accent: '#e05c7a', text: '#f2dde1', dim: '#9e6d76', border: '#3d1a20' },
  sunset: { bg: '#0f0a04', accent: '#e8922a', text: '#f5e6c8', dim: '#a07840', border: '#4a3010' },
}

// ── Loading Screen ────────────────────────────────────────────────────────────
function GnosLoadingScreen({ onDone, initDone = false }) {
  const themeKey = useAppStore(s => s.themeKey) || 'sepia'
  const p = LOADING_THEMES[themeKey] || LOADING_THEMES.sepia
  const isLight = themeKey === 'sepia' || themeKey === 'light' || themeKey === 'moss'
  const ruleOpacity = isLight ? 0.05 : 0.03

  const [fade, setFade]         = useState(false)
  const [update, setUpdate]     = useState(null)
  const [phase, setPhase]       = useState('checking') // checking | idle | downloading | error
  const [downloaded, setDownloaded] = useState(0)
  const [total, setTotal]       = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const dismissedRef = useRef(false)

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    setFade(true)
    setTimeout(onDone, 400)
  }, [onDone])

  // Lift the splash once disk hydration (initDone) is done, but never before a
  // short brand-flash and never longer than a hard cap (so a stuck read still
  // opens). Gating on initDone means the library grid is already mounted when
  // the splash fades — no synchronous mount storm mid-interaction.
  const MIN_SHOW = 260, MAX_SHOW = 2600
  const mountedAtRef = useRef(performance.now())
  useEffect(() => {
    if (phase !== 'checking') return   // update prompt is showing — don't auto-dismiss
    const elapsed = performance.now() - mountedAtRef.current
    if (initDone) {
      const wait = Math.max(0, MIN_SHOW - elapsed)
      const t = setTimeout(() => { if (phase === 'checking') dismiss() }, wait)
      return () => clearTimeout(t)
    }
    // init not done yet — hard cap so we never hang on a slow disk
    const capT = setTimeout(() => { if (phase === 'checking') dismiss() }, Math.max(0, MAX_SHOW - elapsed))
    return () => clearTimeout(capT)
  }, [initDone, phase, dismiss])

  useEffect(() => {
    let cancelled = false
    check().then(u => {
      if (cancelled) return
      if (u?.available) {
        if (!dismissedRef.current) {
          setUpdate(u)
          setPhase('idle')   // 'idle' halts the auto-dismiss effect above
        } else {
          // Splash already gone — surface non-blockingly
          window.dispatchEvent(new CustomEvent('gnos:update-available', { detail: { version: u.version } }))
        }
      }
    }).catch(() => { /* offline or check failed — app already opened */ })

    return () => { cancelled = true }
  }, []) // eslint-disable-line

  async function startUpdate() {
    setPhase('downloading')
    setDownloaded(0)
    setTotal(null)
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') setTotal(event.data.contentLength ?? null)
        else if (event.event === 'Progress') setDownloaded(d => d + (event.data.chunkLength ?? 0))
      })
      await relaunch()
    } catch (e) {
      setPhase('error')
      setErrorMsg(String(e))
    }
  }

  const percent = total && downloaded ? Math.min(100, Math.round((downloaded / total) * 100)) : null
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: p.bg,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16,
      opacity: fade ? 0 : 1,
      transition: 'opacity 0.4s ease',
      pointerEvents: fade ? 'none' : 'auto',
    }}>
      {/* Ruled paper lines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `repeating-linear-gradient(transparent, transparent 27px, ${p.accent} 28px)`,
        backgroundSize: '100% 28px', opacity: ruleOpacity,
      }} />

      {/* Corner brackets */}
      <svg style={{ position: 'absolute', top: 18, right: 22, opacity: 0.16, pointerEvents: 'none', transform: 'scaleX(-1)' }}
        width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M4 44 L4 4 L44 4" stroke={p.accent} strokeWidth="1.2" fill="none" />
        <path d="M4 4 L13 4 M4 4 L4 13" stroke={p.accent} strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <svg style={{ position: 'absolute', bottom: 18, left: 22, opacity: 0.16, pointerEvents: 'none', transform: 'scaleY(-1)' }}
        width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M4 44 L4 4 L44 4" stroke={p.accent} strokeWidth="1.2" fill="none" />
        <path d="M4 4 L13 4 M4 4 L4 13" stroke={p.accent} strokeWidth="2" strokeLinecap="round"/>
      </svg>

      {/* Quill icon — brand mark, hand-drawn (see icons.jsx) */}
      <svg width="44" height="44" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.45, position: 'relative', zIndex: 1 }}>
        <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke={p.dim} strokeWidth="1.1" strokeLinecap="round" />
        <path d="M26 3C24 8 18 15 10 18" stroke={p.dim} strokeWidth="0.7" strokeLinecap="round" opacity="0.6" />
        <path d="M26 3C25 6 22 10 16 14" stroke={p.dim} strokeWidth="0.5" strokeLinecap="round" opacity="0.35" />
        <path d="M6.5 28L9 23" stroke={p.dim} strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <div style={{
        fontFamily: 'Georgia, serif', fontSize: 36, fontWeight: 700,
        color: p.text, letterSpacing: '-1px', position: 'relative', zIndex: 1,
      }}>Gnos</div>
      {/* Animated indeterminate loading bar (startup) */}
      <div style={{
        width: 140, height: 3, borderRadius: 3,
        background: `${p.dim}33`, overflow: 'hidden',
        position: 'relative', zIndex: 1, marginTop: 2,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%', width: '40%',
          borderRadius: 3, background: p.accent,
          animation: 'gnos-splash-bar 1.15s ease-in-out infinite',
        }} />
      </div>
      <style>{`
        @keyframes gnos-splash-bar {
          0%   { transform: translateX(-110%); }
          100% { transform: translateX(360%); }
        }
      `}</style>

      {/* Update card — shown when update is available */}
      {update && (
        <div style={{
          position: 'relative', zIndex: 2, marginTop: 8,
          background: p.bg, border: `1px solid ${p.accent}60`,
          boxShadow: `0 4px 24px rgba(0,0,0,0.18)`,
          borderRadius: 12, padding: '14px 18px', width: 280,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: p.text }}>Update available</div>
          <div style={{ fontSize: 12, color: p.dim }}>
            v{update.currentVersion} → <strong style={{ color: p.accent }}>v{update.version}</strong>
          </div>
          {update.body && (
            <div style={{ fontSize: 11, color: p.dim, lineHeight: 1.5, maxHeight: 60, overflowY: 'auto' }}>
              {update.body}
            </div>
          )}
          {phase === 'downloading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ height: 3, borderRadius: 3, background: `${p.accent}30`, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: p.accent,
                  width: percent != null ? `${percent}%` : '40%',
                  transition: percent != null ? 'width 0.2s ease' : undefined,
                  animation: percent == null ? 'gnos-update-indeterminate 1.2s ease-in-out infinite' : undefined,
                }} />
              </div>
              <span style={{ fontSize: 11, color: p.dim, textAlign: 'right' }}>
                {percent != null ? `${percent}%` : 'Downloading…'}
              </span>
            </div>
          )}
          {phase === 'error' && (
            <div style={{ fontSize: 11, color: '#f85149' }}>{errorMsg}</div>
          )}
          {phase === 'idle' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={dismiss} style={{
                flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                background: 'none', border: `1px solid ${p.accent}50`, color: p.dim,
              }}>Later</button>
              <button onClick={startUpdate} style={{
                flex: 1, padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                background: p.accent, border: 'none', color: '#fff', fontWeight: 600,
              }}>Update & Restart</button>
            </div>
          )}
          {phase === 'error' && (
            <button onClick={dismiss} style={{
              padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              background: 'none', border: `1px solid ${p.accent}50`, color: p.dim,
            }}>Dismiss</button>
          )}
          <style>{`
            @keyframes gnos-update-indeterminate {
              0%   { transform: translateX(-100%); width: 40%; }
              100% { transform: translateX(350%);  width: 40%; }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}


// ── Tab overview — browser-style tab manager: all tabs in a grid ─────────────
function TabOverview({ onClose, onOpenLayout, leftOffset = 0 }) {
  const tabs           = useAppStore(s => s.tabs)
  const activeTabId    = useAppStore(s => s.activeTabId)
  const switchTab      = useAppStore(s => s.switchTab)
  const closeTab       = useAppStore(s => s.closeTab)
  const openNewTab     = useAppStore(s => s.openNewTab)
  const notebooks      = useAppStore(s => s.notebooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const library        = useAppStore(s => s.library)

  // Type-to-filter + keyboard navigation (arrows/Enter/⌘W), no header chrome.
  const [query, setQuery]       = useState('')
  const [focusIdx, setFocusIdx] = useState(() => Math.max(0, tabs.findIndex(t => t.id === activeTabId)))
  const gridRef = useRef(null)

  const q = query.trim().toLowerCase()
  const visible = q
    ? tabs.filter(t => getTabLabel(t, { notebooks, flashcardDecks, sketchbooks, library }).toLowerCase().includes(q))
    : tabs

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (query) setQuery('')
        else onClose()
        return
      }
      if (e.key === 'Enter') {
        const t = visible[Math.min(focusIdx, visible.length - 1)]
        if (t) { switchTab(t.id); onClose() }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        const t = visible[Math.min(focusIdx, visible.length - 1)]
        if (t && tabs.length > 1) { e.preventDefault(); closeTab(t.id) }
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const cols = Math.max(1, Math.floor((gridRef.current?.clientWidth || 800) / 200))
        const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1
          : e.key === 'ArrowUp' ? -cols : cols
        setFocusIdx(i => Math.max(0, Math.min(visible.length - 1, i + delta)))
        return
      }
      if (e.key === 'Backspace') { setQuery(s => s.slice(0, -1)); return }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setQuery(s => s + e.key)
        setFocusIdx(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query, visible, focusIdx, tabs.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gnos-tab-overview" style={{ left: leftOffset }} onClick={onClose}>
      {/* Header bar (restored by request) — count/filter state left, actions right */}
      <div className="gnos-tab-overview-head" onClick={e => e.stopPropagation()}>
        <span className="gnos-tab-overview-title">
          {(() => {
            const activeTab = tabs.find(t => t.id === activeTabId)
            const current = activeTab ? getTabLabel(activeTab, { notebooks, flashcardDecks, sketchbooks, library }) : ''
            return query
              ? `“${query}” · ${visible.length} match${visible.length === 1 ? '' : 'es'}`
              : `${current} — ${tabs.length} tab${tabs.length === 1 ? '' : 's'} · type to filter`
          })()}
        </span>
        <div style={{ flex: 1 }} />
        {onOpenLayout && (
          <button className="gnos-tab-overview-act" onClick={() => { onClose(); onOpenLayout() }}>Split layout…</button>
        )}
        <button className="gnos-tab-overview-act" onClick={onClose}>Done</button>
      </div>
      <div ref={gridRef} className="gnos-tab-overview-grid" onClick={e => e.stopPropagation()}>
        {visible.map((tab, i) => {
          const label = getTabLabel(tab, { notebooks, flashcardDecks, sketchbooks, library })
          const isActive = tab.id === activeTabId
          const focused  = i === Math.min(focusIdx, visible.length - 1)
          return (
            <div
              key={tab.id}
              className={`gnos-tab-overview-card${isActive ? ' active' : ''}${focused ? ' focused' : ''}`}
              onClick={() => { switchTab(tab.id); onClose() }}
              onAuxClick={e => { if (e.button === 1 && tabs.length > 1) { e.preventDefault(); closeTab(tab.id) } }}
              onMouseEnter={() => setFocusIdx(i)}
            >
              {tabCardPreview(tab, { notebooks, sketchbooks, library })}
              <div className="gnos-tab-overview-meta">
                <span className="gnos-tab-overview-label">{label}</span>
                {tabs.length > 1 && (
                  <button
                    className="gnos-tab-overview-x"
                    title="Close tab"
                    onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                  >
                    <X size={9} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!q && (
          <div
            className="gnos-tab-overview-card gnos-tab-overview-new"
            onClick={() => { openNewTab({ view: 'library', activeLibTab: 'library' }); onClose() }}
          >
            <div className="gnos-tab-overview-thumb">
              <Plus size={24} strokeWidth={1.8} />
            </div>
            <div className="gnos-tab-overview-meta"><span className="gnos-tab-overview-label">New tab</span></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Titlebar search — global omnibar. Shows the current page title (Safari-style)
//    when idle; click to search the whole library. ──────────────────────────────
function TitlebarSearch() {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const library     = useAppStore(s => s.library)
  const notebooks   = useAppStore(s => s.notebooks)
  const sketchbooks = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const tabs        = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const navigate    = useAppStore(s => s.navigate)
  const openNewTab  = useAppStore(s => s.openNewTab)
  const titlebarMeta = useAppStore(s => s.titlebarMeta)

  const activeTab = tabs.find(t => t.id === activeTabId)
  const pageTitle = activeTab ? getTabLabel(activeTab, { notebooks, flashcardDecks, sketchbooks, library }) : ''

  // Close the chapter dropdown when switching tabs (render-time state adjustment)
  const [lastTabId, setLastTabId] = useState(activeTabId)
  if (lastTabId !== activeTabId) { setLastTabId(activeTabId); setDropOpen(false) }

  const close = () => { setQuery(''); setFocused(false) }
  return (
    <div className={`gnos-titlebar-search${focused ? ' focused' : ''}`}>
      {/* Leading glyph slot — magnifier normally; save flash swaps in over it.
          #nb-save-icon must stay in the DOM: notebook/sketchbook saves target it by id. */}
      <span className="gnos-tbs-glyph">
        <Search className="gnos-tbs-magnifier" size={13} strokeWidth={1.8} />
        <svg id="nb-save-icon" className="nb-save-icon" viewBox="0 0 18 18" fill="none">
          <circle className="nb-save-ring" cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <polyline className="nb-save-check" points="5.5,9 7.8,11.5 12.5,6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
      <input
        type="text"
        placeholder={focused ? 'Search library…' : (pageTitle || 'Search library…')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
      />
      {/* Per-view extras: count text and/or dropdown (e.g. reader chapters) */}
      {!focused && !query && titlebarMeta?.text && (
        <span className="gnos-tbs-meta">{titlebarMeta.text}</span>
      )}
      {!focused && !query && titlebarMeta?.dropdown && (
        <button className="gnos-tbs-chevron" title="Jump to…" onMouseDown={e => e.preventDefault()} onClick={() => setDropOpen(o => !o)}>
          <ChevronDown size={10} strokeWidth={1.8} style={{ transform: dropOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      )}
      {dropOpen && titlebarMeta?.dropdown && (
        <div className="gnos-tbs-drop" onMouseLeave={() => setDropOpen(false)}>
          {titlebarMeta.dropdown.items.map(it => (
            <button
              key={it.id}
              className={`gnos-tbs-drop-item${String(it.id) === String(titlebarMeta.dropdown.activeId) ? ' active' : ''}`}
              onClick={() => { titlebarMeta.dropdown.onSelect?.(it.id); setDropOpen(false) }}
            >{it.label}</button>
          ))}
        </div>
      )}
      {query && <span className="gnos-titlebar-search-x" onClick={close}>✕</span>}
      {focused && query && (
        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0 }}>
          <SearchDropdown
            query={query}
            library={library}
            notebooks={notebooks}
            sketchbooks={sketchbooks}
            flashcardDecks={flashcardDecks}
            onOpenBook={b => { navigate({ view: b.format === 'pdf' ? 'pdf' : 'reader', activeBook: b }); close() }}
            onOpenAudio={b => { navigate({ view: 'audio-player', activeAudioBook: b }); close() }}
            onOpenNotebook={nb => { navigate({ view: 'notebook', activeNotebook: nb }); close() }}
            onOpenSketchbook={sb => { navigate({ view: 'sketchbook', activeSketchbook: sb }); close() }}
            onOpenDeck={d => { navigate({ view: 'flashcard', activeFlashcardDeck: d }); close() }}
            onOpenGraph={() => { openNewTab({ view: 'graph' }); close() }}
            onOpenCalendar={() => { navigate({ view: 'calendar' }); close() }}
            onOpenKanban={() => { navigate({ view: 'kanban' }); close() }}
            onClose={close}
          />
        </div>
      )}
    </div>
  )
}

// ── Titlebar add button — the library "+" living in the top row ──────────────
function TitlebarAdd() {
  const [open, setOpen] = useState(false)
  const navigate = useAppStore(s => s.navigate)

  // Imports need the library view mounted — switch there, then hand off
  const viaLibrary = (cmd) => {
    const s = useAppStore.getState()
    if (s.view !== 'library') s.navigate({ view: 'library', activeLibTab: 'library' })
    setTimeout(() => window.dispatchEvent(new CustomEvent('gnos:lib-cmd', { detail: { cmd } })), 120)
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'center' }} onMouseLeave={() => setOpen(false)}>
      <button className="gnos-titlebar-iconbtn" title="Add" onClick={() => setOpen(o => !o)}>
        <Plus size={11} strokeWidth={2} />
      </button>
      {open && (
          <AddPopup
            variant="down"
            onClose={() => setOpen(false)}
            onAddBook={() => viaLibrary('import-books')}
            onAddAudio={() => viaLibrary('import-audio')}
            onNewNotebook={() => {
              const s = useAppStore.getState()
              const nb = { id: makeId('nb'), title: 'Untitled', wordCount: 0, createdAt: new Date().toISOString() }
              s.addNotebook(nb); s.persistNotebooks()
              if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, nb.id); s.persistCollections() }
              if (s.openOnCreate) navigate({ view: 'notebook', activeNotebook: nb })
              else window.dispatchEvent(new CustomEvent('gnos:item-created', { detail: { id: nb.id } }))
            }}
            onNewSketchbook={() => {
              const s = useAppStore.getState()
              const COLORS = ['#2d1b69','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#6b3fa0','#2e7d32']
              const sb = { id: makeId('sb'), title: 'Untitled Sketch', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), coverColor: COLORS[(s.sketchbooks?.length || 0) % COLORS.length] }
              s.addSketchbook(sb); s.persistSketchbooks()
              if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, sb.id); s.persistCollections() }
              if (s.openOnCreate) navigate({ view: 'sketchbook', activeSketchbook: sb })
              else window.dispatchEvent(new CustomEvent('gnos:item-created', { detail: { id: sb.id } }))
            }}
            onNewFlashcardDeck={() => {
              const s = useAppStore.getState()
              const COLORS = ['#6b3fa0','#0d5eaf','#1a6b3a','#7a1f6e','#b91c1c','#1565c0','#2e7d32','#c0392b']
              const deck = { id: makeId('deck'), title: 'Untitled Deck', cards: [], color: COLORS[(s.flashcardDecks?.length || 0) % COLORS.length], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              s.addDeck(deck); s.persistFlashcardDecks()
              if (s.activeCollectionId) { s.addToCollection(s.activeCollectionId, deck.id); s.persistCollections() }
              if (s.openOnCreate) navigate({ view: 'flashcard', activeFlashcardDeck: deck })
              else window.dispatchEvent(new CustomEvent('gnos:item-created', { detail: { id: deck.id } }))
            }}
            onNewCollection={() => {
              const s = useAppStore.getState()
              const COLLECTION_COLORS = ['#388bfd', '#e05c7a', '#4a7c3f', '#e8922a', '#8250df', '#f0883e', '#56d4dd']
              const col = { id: makeId('col'), name: 'New Collection', items: [], color: COLLECTION_COLORS[(s.collections?.length || 0) % COLLECTION_COLORS.length], createdAt: new Date().toISOString() }
              s.addCollection(col); s.persistCollections()
              navigate({ view: 'library', activeLibTab: 'collections' })
            }}
          />
      )}
    </div>
  )
}

// ── Customize Toolbar — drag-and-drop layout editor for the title bar ────────
// Items live in an ordered layout ({ left, center, right, tray } in the store).
// Pointer-based DnD (HTML5 DnD is unreliable in this webview).

const TITLEBAR_CHIP_DEFS = {
  save:        { label: 'Save indicator' },
  arrows:      { label: 'Back / Forward' },
  search:      { label: 'Search', fixed: true },
  add:         { label: 'Add' },
  quickAccess: { label: 'Page actions' },
  tabManager:  { label: 'Tab manager' },
}

function chipIcon(id) {
  switch (id) {
    case 'save':        return <CircleCheck size={14} strokeWidth={1.6} />
    case 'arrows':      return <ChevronsLeftRight size={14} strokeWidth={1.6} />
    case 'search':      return <Search size={14} strokeWidth={1.6} />
    case 'add':         return <Plus size={14} strokeWidth={1.6} />
    case 'quickAccess': return <Star size={14} strokeWidth={1.6} />
    case 'tabManager':  return <Copy size={14} strokeWidth={1.6} />
    default:            return null
  }
}

// Movable chips (everything except fixed ones like Search) — the palette source.
const MOVABLE_CHIPS = Object.keys(TITLEBAR_CHIP_DEFS).filter(id => !TITLEBAR_CHIP_DEFS[id]?.fixed)

// Live toolbar customizer. The REAL title bar stays visible and crisp (raised above
// a blurred scrim); its zones are live drop targets. A floating palette (bottom-center)
// holds every movable chip — drag one onto a zone to place/reorder it, or onto the
// palette's Hidden tray to remove it. Layout persists immediately (same store model).
function CustomizeToolbarOverlay({ onClose }) {
  const layout = useAppStore(s => s.titlebarLayout) || defaultTitlebarLayout()
  const setTitlebarLayout = useAppStore(s => s.setTitlebarLayout)
  const persistPreferences = useAppStore(s => s.persistPreferences)

  const [drag, setDrag]     = useState(null)   // { id, x, y, offX, offY, w }
  const [target, setTarget] = useState(null)   // { zone, index }
  const trayRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function commitLayout(next) {
    setTitlebarLayout(next)
    persistPreferences()
  }

  function moveItem(id, zone, index) {
    const next = {
      left: [...layout.left], center: [...layout.center],
      right: [...layout.right], tray: [...layout.tray],
    }
    for (const z of ['left', 'center', 'right', 'tray']) {
      const i = next[z].indexOf(id)
      if (i >= 0) {
        next[z].splice(i, 1)
        if (z === zone && i < index) index--
      }
    }
    next[zone].splice(Math.max(0, Math.min(index, next[zone].length)), 0, id)
    commitLayout(next)
  }

  // Drop target from pointer position. Real zones are found in the live DOM
  // (`.gnos-tb-*`); insertion index comes from the `[data-tb-id]` slot midpoints
  // rendered into the real title bar while customizing. The palette tray is the
  // one React-owned target (via ref).
  function hitTest(x, y, dragId) {
    // Anywhere on the palette removes (Firefox: drag out of the toolbar to
    // remove); the labeled tray strip is just the visual affordance.
    const palette = document.querySelector('.ct2-palette')
    if (palette) {
      const r = palette.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { zone: 'tray', index: 0 }
    }
    for (const zone of ['left', 'center', 'right']) {
      const el = document.querySelector(`.gnos-tb-${zone}`)
      if (!el) continue
      const r = el.getBoundingClientRect()
      // Generous vertical band = the whole title bar height; horizontal = zone rect.
      if (x < r.left - 12 || x > r.right + 12 || y > r.bottom + 8 || y < r.top - 8) continue
      let index = 0
      for (const slot of el.querySelectorAll('[data-tb-id]')) {
        if (slot.dataset.tbId === dragId) continue
        const cr = slot.getBoundingClientRect()
        if (x > cr.left + cr.width / 2) index++
      }
      return { zone, index }
    }
    return null
  }

  function startDrag(e, id, rectEl) {
    if (e.button !== 0) return
    const rect = rectEl.getBoundingClientRect()
    setDrag({ id, x: e.clientX, y: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, w: rect.width })
    setTarget(null)
  }
  function onChipPointerDown(e, id) { startDrag(e, id, e.currentTarget) }

  // Window-level move/up while a drag is live — works for palette chips AND
  // real toolbar items (which live outside this component's tree).
  useEffect(() => {
    if (!drag) return
    const onMove = (e) => {
      setDrag(d => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
      setTarget(hitTest(e.clientX, e.clientY, drag.id))
    }
    const onUp = (e) => {
      const drop = hitTest(e.clientX, e.clientY, drag.id)
      if (drop && !(drag.id === 'search' && drop.zone !== 'center')) moveItem(drag.id, drop.zone, drop.index)
      setDrag(null)
      setTarget(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') { setDrag(null); setTarget(null) } }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id])

  // Firefox parity: the REAL toolbar buttons are grabbable while customizing.
  // Slots ([data-tb-id]) render in the title bar outside this component, so
  // delegate their pointerdown from the window.
  useEffect(() => {
    const onDown = (e) => {
      const slot = e.target.closest?.('.gnos-tb-slot[data-tb-id]')
      if (!slot || e.button !== 0) return
      e.preventDefault()
      startDrag(e, slot.dataset.tbId, slot)
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    return () => window.removeEventListener('pointerdown', onDown, { capture: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live drop preview: accent caret at the insertion point + a gap opening in
  // the toolbar, and the dragged item's own slot dimmed. Imperative DOM classes
  // (the slots are rendered by the App, not by this component).
  useEffect(() => {
    document.querySelectorAll('.gnos-tb-slot.tb-gap').forEach(el => el.classList.remove('tb-gap'))
    document.querySelectorAll('.gnos-tb-slot.tb-dragging').forEach(el => el.classList.remove('tb-dragging'))
    document.querySelectorAll('.gnos-tb-caret').forEach(el => el.remove())
    if (!drag) return
    const own = document.querySelector(`.gnos-tb-slot[data-tb-id="${drag.id}"]`)
    own?.classList.add('tb-dragging')
    if (!target || target.zone === 'tray') return
    const zoneEl = document.querySelector(`.gnos-tb-${target.zone}`)
    if (!zoneEl) return
    const slots = [...zoneEl.querySelectorAll('.gnos-tb-slot[data-tb-id]')].filter(s => s.dataset.tbId !== drag.id)
    const caret = document.createElement('div')
    caret.className = 'gnos-tb-caret'
    const ref = slots[target.index]
    if (ref) { ref.classList.add('tb-gap'); ref.parentNode.insertBefore(caret, ref) }
    else if (slots.length) slots[slots.length - 1].after(caret)
    else zoneEl.appendChild(caret)
    return () => caret.remove()
  }, [drag, target])

  function paletteChip(id) {
    const def = TITLEBAR_CHIP_DEFS[id]
    if (!def) return null
    const placed = !layout.tray.includes(id)
    const dragging = drag?.id === id
    return (
      <div
        key={id}
        data-chip-id={id}
        className={`ct2-chip${placed ? ' ct2-chip-placed' : ''}${dragging ? ' ct2-chip-dragging' : ''}`}
        title={placed ? `${def.label} — drag to move, or drop below to hide` : `${def.label} — drag onto the toolbar`}
        onPointerDown={e => onChipPointerDown(e, id)}
      >
        {chipIcon(id)}
        <span>{def.label}</span>
        {placed && <span className="ct2-chip-dot" title="Currently in the toolbar" />}
      </div>
    )
  }

  const trayHot = target?.zone === 'tray' && drag
  return (
    <>
      <style>{CUSTOMIZE_CSS}</style>
      {/* Blurred scrim — dims the app but sits below the raised title bar */}
      <div className="ct2-scrim" onPointerDown={onClose} />

      {/* Floating palette */}
      <div className="ct2-palette" onPointerDown={e => e.stopPropagation()}>
        <div className="ct2-head">
          <span className="ct2-title">Customize Toolbar</span>
          <div style={{ flex: 1 }} />
          <button className="ct-btn" onClick={() => commitLayout(defaultTitlebarLayout())}>Restore Defaults</button>
          <button className="ct-btn ct-btn-primary" onClick={onClose}>Done</button>
        </div>
        <div className="ct2-hint">
          Drag a chip onto the title bar to place or reorder it. Search stays centered.
        </div>
        <div className="ct2-chips">
          {MOVABLE_CHIPS.map(paletteChip)}
        </div>
        <div ref={trayRef} className={`ct2-tray${trayHot ? ' ct2-tray-hot' : ''}`}>
          <span className="ct2-tray-label">Drop here to hide</span>
        </div>
      </div>

      {drag && (
        <div className="ct-ghost" style={{ left: drag.x - drag.offX, top: drag.y - drag.offY }}>
          {chipIcon(drag.id)}
          <span>{TITLEBAR_CHIP_DEFS[drag.id]?.label}</span>
        </div>
      )}
    </>
  )
}

const CUSTOMIZE_CSS = `
  /* Blurred scrim below the raised title bar (z 9999 → bumped to 10001 while customizing) */
  .ct2-scrim {
    position: fixed; inset: 0; z-index: 9990;
    background: rgba(0,0,0,0.34);
    backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  }
  .gnos-titlebar.customizing {
    z-index: 10001;
    box-shadow: 0 0 0 1px var(--accent), 0 10px 40px rgba(0,0,0,0.45);
  }
  /* Slot wrappers rendered into the real toolbar while customizing — directly
     grabbable (Firefox parity) */
  .gnos-titlebar.customizing .gnos-tb-slot {
    display: inline-flex; align-items: center;
    cursor: grab; border-radius: 7px;
    transition: margin-left .12s ease, opacity .12s, box-shadow .12s;
  }
  .gnos-titlebar.customizing .gnos-tb-slot:hover { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent); }
  .gnos-titlebar.customizing .gnos-tb-slot:active { cursor: grabbing; }
  .gnos-titlebar.customizing .gnos-tb-slot > * { pointer-events: none; }
  .gnos-tb-slot.tb-dragging { opacity: .25; }
  .gnos-tb-slot.tb-gap { margin-left: 16px; }
  .gnos-tb-caret {
    width: 2px; height: 20px; border-radius: 1px; flex-shrink: 0;
    background: var(--accent); margin: 0 1px;
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .gnos-titlebar.customizing .gnos-tb-left,
  .gnos-titlebar.customizing .gnos-tb-center,
  .gnos-titlebar.customizing .gnos-tb-right {
    outline: 1.5px dashed var(--borderSubtle); outline-offset: 3px; border-radius: 8px;
    min-width: 22px; min-height: 26px;
  }

  .ct2-palette {
    position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
    z-index: 10002; width: min(560px, calc(100vw - 48px));
    background: var(--surface); border: 1px solid var(--borderSubtle);
    border-radius: 14px; padding: 14px 16px 16px;
    box-shadow: 0 18px 60px rgba(0,0,0,0.45);
  }
  .ct2-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .ct2-title { font-size: 14px; font-weight: 700; color: var(--text); }
  .ct2-hint { font-size: 11.5px; color: var(--textDim); line-height: 1.5; margin-bottom: 12px; }
  .ct-btn {
    background: none; border: 1px solid var(--borderSubtle); border-radius: 7px;
    padding: 4px 12px; font-size: 11.5px; font-weight: 500; color: var(--textDim);
    cursor: pointer; font-family: inherit;
  }
  .ct-btn:hover { color: var(--text); border-color: var(--border); }
  .ct-btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .ct-btn-primary:hover { color: #fff; filter: brightness(1.08); }
  .ct2-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .ct2-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px 11px; font-size: 11.5px; font-weight: 500;
    color: var(--text); cursor: grab; user-select: none;
    -webkit-user-select: none; touch-action: none; position: relative;
  }
  .ct2-chip svg { color: var(--textDim); flex-shrink: 0; }
  .ct2-chip:active { cursor: grabbing; }
  .ct2-chip-placed { border-color: var(--accent); }
  .ct2-chip-dragging { opacity: .3; }
  .ct2-chip-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--accent);
    margin-left: 1px;
  }
  .ct2-tray {
    border: 1.5px dashed var(--borderSubtle); border-radius: 10px;
    background: var(--surfaceAlt); min-height: 42px;
    display: flex; align-items: center; justify-content: center;
    transition: border-color .1s, background .1s;
  }
  .ct2-tray-hot { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); }
  .ct2-tray-label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .04em;
    color: var(--textDim); opacity: .75; pointer-events: none;
  }
  .ct-ghost {
    position: fixed; z-index: 10010; pointer-events: none;
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface); border: 1px solid var(--accent);
    border-radius: 8px; padding: 6px 11px; font-size: 11.5px; font-weight: 500;
    color: var(--text); box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }
  .ct-ghost svg { color: var(--textDim); }
`

export default function App() {
  // Dev-only Stage-2 proof rig (PLAN_CONCURRENCY.md §6 step 6). Must be the
  // first line — before any hooks — so the two render paths never disagree
  // on hook count. Not linked from any UI; remove once step 6 is retired.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('yjsProof') === '1') {
    return <Suspense fallback={null}><YjsProofHarness /></Suspense>
  }
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('yjsRelay') === '1') {
    return <Suspense fallback={null}><YjsRelayHarness /></Suspense>
  }
  const isMobile    = useIsMobile()
  const init        = useAppStore(s => s.init)
  const tabs        = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const switchTab   = useAppStore(s => s.switchTab)
  const closeTab    = useAppStore(s => s.closeTab)
  const openNewTab  = useAppStore(s => s.openNewTab)
  const sideNavOpen = useAppStore(s => s.sideNavOpen)
  const onboardingCompleteStore = useAppStore(s => s.onboardingComplete)
  const setOnboardingComplete   = useAppStore(s => s.setOnboardingComplete)
  // localStorage is synchronous — resolves before async init() finishes, preventing flash of onboarding
  const onboardingComplete = onboardingCompleteStore || localStorage.getItem('gnos_onboarding_done') === '1'

  const notebooks       = useAppStore(s => s.notebooks)
  const flashcardDecks  = useAppStore(s => s.flashcardDecks)
  const sketchbooks     = useAppStore(s => s.sketchbooks)
  const library         = useAppStore(s => s.library)
  const tabHistories  = useAppStore(s => s.tabHistories)
  const goBack        = useAppStore(s => s.goBack)
  const goForward     = useAppStore(s => s.goForward)
  const sidebarPinned = useAppStore(s => s.sidebarPinned)

  const [splitDir,        setSplitDir]        = useState(null)
  const [splitRatio,      setSplitRatio]      = useState(0.5)
  const [splitPanes,      setSplitPanes]      = useState([])
  const [tabSettingsOpen,  setTabSettingsOpen]  = useState(false)
  const [tabOverviewOpen,  setTabOverviewOpen]  = useState(false)
  const [customizeOpen,    setCustomizeOpen]    = useState(false)
  const titlebarLayout = useAppStore(s => s.titlebarLayout)
  const [mobileTabsOpen,   setMobileTabsOpen]   = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [showLoading, setShowLoading] = useState(true)
  const handleLoadingDone = useCallback(() => setShowLoading(false), [])
  // Splash lifts only once init() (disk hydration) is done — so the whole
  // library grid is already mounted, never mid-interaction after the splash.
  const [initDone, setInitDone] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [prevActiveTabId, setPrevActiveTabId] = useState(null)
  const [zenMode, setZenMode] = useState(false)
  const [zenPeekLeft, setZenPeekLeft] = useState(false)
  const [zenPeekTop, setZenPeekTop] = useState(false)
  const zenPeekTimerRef = useRef({})
  const contentRef = useRef(null)
  const leftDragRef = useRef(null)
  const tauriWinRef = useRef(null)
  useEffect(() => { document.body.classList.toggle('tabs-open', mobileTabsOpen) }, [mobileTabsOpen])
  useEffect(() => {
    import('@tauri-apps/api/window')
      .then(m => { tauriWinRef.current = m.getCurrentWindow() })
      .catch(() => {})
  }, [])

  // macOS window keyboard shortcuts
  useEffect(() => {
    const onKeyDown = async (e) => {
      const win = tauriWinRef.current
      // Cmd+\ — Toggle sidebar
      if (e.metaKey && e.key === '\\') {
        e.preventDefault()
        useAppStore.getState().toggleSideNav()
        return
      }
      // Cmd+Shift+F — Toggle zen mode
      if (e.metaKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        setZenMode(z => !z)
        return
      }
      // Cmd+T — New tab
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 't') {
        e.preventDefault()
        useAppStore.getState().openNewTab({ view: 'library', activeLibTab: 'library' })
        return
      }
      // Cmd+W — Close current tab
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key === 'w') {
        e.preventDefault()
        const s = useAppStore.getState()
        if (s.tabs.length > 1) s.closeTab(s.activeTabId)
        return
      }
      // Cmd+Shift+] — Next tab
      if (e.metaKey && e.shiftKey && !e.ctrlKey && e.key === ']') {
        e.preventDefault()
        const s = useAppStore.getState()
        const idx = s.tabs.findIndex(t => t.id === s.activeTabId)
        const next = s.tabs[(idx + 1) % s.tabs.length]
        if (next) s.switchTab(next.id)
        return
      }
      // Cmd+Shift+[ — Previous tab
      if (e.metaKey && e.shiftKey && !e.ctrlKey && e.key === '[') {
        e.preventDefault()
        const s = useAppStore.getState()
        const idx = s.tabs.findIndex(t => t.id === s.activeTabId)
        const prev = s.tabs[(idx - 1 + s.tabs.length) % s.tabs.length]
        if (prev) s.switchTab(prev.id)
        return
      }
      // Cmd+1…9 — Switch to tab N
      if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const s = useAppStore.getState()
        const tab = s.tabs[parseInt(e.key) - 1]
        if (tab) s.switchTab(tab.id)
        return
      }
      if (!win) return
      // Cmd+Ctrl+F — Toggle fullscreen
      if (e.metaKey && e.ctrlKey && e.key === 'f') {
        e.preventDefault()
        const isFs = await win.isFullscreen().catch(() => false)
        win.setFullscreen(!isFs)
      }
      // Cmd+M — Minimize
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && e.key === 'm') {
        e.preventDefault()
        win.minimize()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  // Listen for zen mode toggle from settings modal
  useEffect(() => {
    const h = (e) => setZenMode(e.detail.enabled)
    window.addEventListener('gnos:zen-mode', h)
    return () => window.removeEventListener('gnos:zen-mode', h)
  }, [])

  // Notebook conflict: an external/offline edit was preserved as its own note
  // instead of being overwritten. Toast + refresh the list so the fork shows.
  const [conflictNote, setConflictNote] = useState(null)
  useEffect(() => {
    const h = (e) => {
      setConflictNote(e.detail || {})
      useAppStore.getState().rescanNotebooks?.()
      setTimeout(() => setConflictNote(null), 8000)
    }
    window.addEventListener('gnos:notebook-conflict', h)
    return () => window.removeEventListener('gnos:notebook-conflict', h)
  }, [])

  // Sync zen mode CSS class on body (hides view headers via global CSS)
  useEffect(() => {
    document.body.classList.toggle('zen-active', zenMode)
    return () => document.body.classList.remove('zen-active')
  }, [zenMode])

  // Zen peek — reveal the sidenav (left edge) and the titlebar (top edge) on hover
  useEffect(() => {
    if (!zenMode) { setZenPeekLeft(false); setZenPeekTop(false); return }
    const EDGE = 12
    const HIDE_DELAY = 600
    const onMove = (e) => {
      if (e.clientX <= EDGE) {
        clearTimeout(zenPeekTimerRef.current.left)
        setZenPeekLeft(true)
      } else if (e.clientX > 260) {
        clearTimeout(zenPeekTimerRef.current.left)
        zenPeekTimerRef.current.left = setTimeout(() => setZenPeekLeft(false), HIDE_DELAY)
      }
      // Titlebar: slides down into view when the mouse nears the top edge,
      // slides back up once the mouse drops below the titlebar zone.
      if (e.clientY <= EDGE) {
        clearTimeout(zenPeekTimerRef.current.top)
        setZenPeekTop(true)
      } else if (e.clientY > 72) {
        clearTimeout(zenPeekTimerRef.current.top)
        zenPeekTimerRef.current.top = setTimeout(() => setZenPeekTop(false), HIDE_DELAY)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      clearTimeout(zenPeekTimerRef.current.left)
      clearTimeout(zenPeekTimerRef.current.top)
    }
  }, [zenMode])

  // Attach native mousedown once the titlebar is rendered (after loading screen).
  // leftDragRef is the full-width drag layer behind the controls; empty gaps drag the window.
  useEffect(() => {
    if (showLoading) return
    const h = (e) => { if (e.button === 0) tauriWinRef.current?.startDragging() }
    const l = leftDragRef.current
    l?.addEventListener('mousedown', h)
    return () => { l?.removeEventListener('mousedown', h) }
  }, [showLoading])

  // Track previous active tab so we keep it mounted
  const prevActiveRef = useRef(null)
  useEffect(() => {
    if (prevActiveRef.current && prevActiveRef.current !== activeTabId) {
      setPrevActiveTabId(prevActiveRef.current)
    }
    prevActiveRef.current = activeTabId
  }, [activeTabId])

  const isSplit = splitDir !== null
    && splitPanes.length === 2
    && splitPanes.every(id => tabs.some(t => t.id === id))

  useEffect(() => {
    // Detect fullscreen to move tabs left
    const onResize = () => setIsFullscreen(window.innerHeight === screen.height && window.innerWidth === screen.width)
    window.addEventListener('resize', onResize)
    onResize()

    // Re-scan notebook folders when the window regains focus, so markdown
    // synced/edited on another device appears without restarting the app.
    // Throttled — refocus fires often and the scan touches the archive dir.
    let lastRescan = 0
    const onFocus = () => {
      const now = Date.now()
      if (now - lastRescan < 5000) return
      lastRescan = now
      useAppStore.getState().rescanNotebooks?.()
    }
    window.addEventListener('focus', onFocus)

    init().then(() => {
      setInitDone(true)   // splash can now lift onto a hydrated grid
      // Initialize plugin host after store is hydrated
      pluginHost.init(() => useAppStore.getState())
      // Plugins load off the critical path — they were competing with the
      // first sidebar open / scroll right after the splash.
      const loadPluginsIdle = () => loadPlugins().catch(err => console.warn('[App] Plugin init failed:', err))
      if (typeof requestIdleCallback === 'function') requestIdleCallback(loadPluginsIdle, { timeout: 6000 })
      else setTimeout(loadPluginsIdle, 2500)
      // Pre-build the profile window hidden, once the main app is idle, so the
      // first time the user opens Profile it's an instant native show() instead
      // of a cold webview + React boot. Deferred so it never competes with launch.
      const prewarm = () => import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('prewarm_profile_window'))
        .catch(() => { /* not in tauri, or already warm */ })
      if (typeof requestIdleCallback === 'function') requestIdleCallback(prewarm, { timeout: 4000 })
      else setTimeout(prewarm, 2000)
      // Downscale any cover that has no thumb yet (serial, low priority). One
      // slow pass on the launch after a book is added; every later launch reads
      // the small thumb instead of the full-size art.
      const thumbs = () => import('@/lib/storage')
        .then(m => m.generatePendingThumbs())
        .catch(() => { /* non-fatal — covers still render full-size */ })
      if (typeof requestIdleCallback === 'function') requestIdleCallback(thumbs, { timeout: 8000 })
      else setTimeout(thumbs, 4000)
    })
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
      if (id === 'profile_settings') {
        import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_settings_window')).catch(err => console.warn('[App] settings window failed:', err))
      }
      if (id === 'open_profile') {
        import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_profile_window')).catch(err => console.warn('[App] profile window failed:', err))
      }
      if (id === 'manage_collections') { store.setView('library'); store.setActiveLibTab('collections') }
      if (id === 'customize_toolbar')  setCustomizeOpen(true)
      if (id.startsWith('filter_')) {
        store.setView('library'); store.setActiveLibTab('library')
        window.dispatchEvent(new CustomEvent('gnos:lib-cmd', { detail: { cmd: 'type-filter', value: id.slice(7) } }))
      }
      if (id === 'page_settings') {
        // Open the settings panel for whatever view is active
        const v = store.view
        if (v === 'reader' || v === 'pdf') window.dispatchEvent(new CustomEvent('gnos:reader-cmd', { detail: { cmd: 'settings' } }))
        else if (v === 'notebook')  window.dispatchEvent(new CustomEvent('gnos:mobile-nb-cmd', { detail: { cmd: 'settings' } }))
        else if (v === 'sketchbook') window.dispatchEvent(new CustomEvent('gnos:mobile-sb-cmd', { detail: { cmd: 'settings' } }))
        else if (v === 'audio-player') window.dispatchEvent(new CustomEvent('gnos:audio-cmd', { detail: { cmd: 'settings' } }))
        else import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_settings_window')).catch(() => {})
      }
    })
    // Settings window persisted new prefs — re-apply them (or reload the archive)
    const unlistenPrefs = listen('gnos:prefs-updated', async () => {
      try {
        const { loadPreferences, resetBaseDir } = await import('@/lib/storage')
        const prefs = await loadPreferences()
        if (!prefs) return
        const prevArchive = useAppStore.getState().archivePath
        if (prefs.archivePath && prefs.archivePath !== prevArchive) {
          resetBaseDir()
          await useAppStore.getState().init()
        } else {
          useAppStore.setState(prefs)
          const { applyTheme } = await import('@/lib/themes')
          applyTheme(prefs.themeKey || 'dark', prefs.customThemes || {})
        }
      } catch (err) { console.warn('[App] prefs sync failed:', err) }
    })
    // Quick note popup saved a note — refresh the notebook list from disk
    const unlistenQuickNote = listen('quicknote:saved', async () => {
      try {
        const { loadNotebooksMeta, getJSON } = await import('@/lib/storage')
        const [metas, collections] = await Promise.all([
          loadNotebooksMeta(),
          getJSON('collections_meta', []),
        ])
        if (metas?.length) useAppStore.getState().setNotebooks(metas)
        // The quicknote window writes collections_meta directly (adds to "quicknotes"),
        // so re-sync the in-memory copy here or a later persistCollections() would clobber it.
        if (collections) useAppStore.getState().setCollections(collections)
      } catch (err) { console.warn('[App] quick note refresh failed:', err) }
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
    return () => { unlisten.then(fn => fn()); unlistenPrefs.then(fn => fn()); unlistenQuickNote.then(fn => fn()); unlistenFiles.then(fn => fn()); window.removeEventListener('resize', onResize); window.removeEventListener('focus', onFocus) }
  }, [init])

  if (showLoading) {
    return <GnosLoadingScreen onDone={handleLoadingDone} initDone={initDone} />
  }

  if (!onboardingComplete) {
    return <OnboardingView onComplete={() => setOnboardingComplete(true)} />
  }

  const activeTab = tabs.find(t => t.id === activeTabId)

  return (
    <div id="app">
      <style>{TAB_CSS}</style>

      {/* ── Full-width top header bar (desktop only — hidden on mobile via CSS).
             Lives in the dark chrome plane, ABOVE the content card (no longer
             nested inside it). `pushed` animates the lead zone out to the
             sidebar edge. Right-click anywhere on it to customize. ── */}
      <div
        className={`gnos-titlebar${isFullscreen ? ' is-fullscreen' : ''}${customizeOpen ? ' customizing' : ''}${(!isSplit && (sideNavOpen || sidebarPinned)) ? ' pushed' : ''}${zenMode && zenPeekTop ? ' zen-peek-top' : ''}`}
        onContextMenu={e => { e.preventDefault(); setCustomizeOpen(true) }}
        ref={el => {
          // Measure the side zones and publish the larger one as --tb-clear so
          // the absolutely-centered search bar can never slide under them.
          if (!el || el._tbObs) return
          const update = () => {
            const w = (sel) => el.querySelector(sel)?.getBoundingClientRect().width ?? 0
            const clear = Math.max(w('.gnos-tb-left') + w('.gnos-tb-ctx'), w('.gnos-tb-right')) + 16
            el.style.setProperty('--tb-clear', `${Math.max(200, Math.round(clear))}px`)
          }
          const obs = new ResizeObserver(update)
          ;['.gnos-tb-left', '.gnos-tb-ctx', '.gnos-tb-right'].forEach(s => {
            const zone = el.querySelector(s)
            if (zone) obs.observe(zone)
          })
          update()
          el._tbObs = obs
        }}
      >
        {/* Drag layer sits behind the controls; empty gaps drag the window */}
        <div ref={leftDragRef} className="gnos-titlebar-drag" />

        {(() => {
          // Registry of titlebar items, rendered in the order the layout dictates.
          // 'save' and 'quickAccess' must stay in the DOM even when trayed —
          // notebook/sketchbook save logic targets #nb-save-icon by id, and
          // QuickAccess portals into #gnos-quick-access.
          const renderItem = (id, hidden = false) => {
            switch (id) {
              // 'home' moved to the sidebar's own top strip (Sidenav.jsx).
              // 'save' moved into the search bar's leading glyph slot (TitlebarSearch)
              // so it never opens a gap in the lead zone. Slot renders nothing.
              case 'save': return null
              case 'arrows': {
                const hist = tabHistories[activeTabId] || { back: [], forward: [] }
                const canBack = hist.back.length > 0
                const canFwd  = hist.forward.length > 0
                return (
                  <div key="arrows" style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                    <button className="gnos-tab-nav-btn" title="Go back" disabled={!canBack}
                      onMouseDown={e => e.stopPropagation()} onClick={() => goBack()}>
                      <ChevronLeft size={15} strokeWidth={2} />
                    </button>
                    <button className="gnos-tab-nav-btn" title="Go forward" disabled={!canFwd}
                      onMouseDown={e => e.stopPropagation()} onClick={() => goForward()}>
                      <ChevronRight size={15} strokeWidth={2} />
                    </button>
                  </div>
                )
              }
              case 'search': return <TitlebarSearch key="search" />
              case 'add':    return <TitlebarAdd key="add" />
              case 'quickAccess': return (
                <div key="quickAccess" id="gnos-quick-access" className="gnos-tb-quick"
                  style={hidden ? { display: 'none' } : undefined} />
              )
              case 'tabManager': return (
                <button key="tabManager"
                  className={`gnos-settings-btn${tabOverviewOpen ? ' active' : ''}`}
                  title="Show all tabs"
                  onClick={() => setTabOverviewOpen(o => !o)}
                >
                  <Copy size={16} strokeWidth={1.5} />
                </button>
              )
              default: return null
            }
          }
          const layout = titlebarLayout || defaultTitlebarLayout()
          // While customizing, wrap each layout item in a measurable slot so the
          // overlay's hitTest can compute insertion indices against the real toolbar.
          const slot = (id) => customizeOpen
            ? <span key={id} className="gnos-tb-slot" data-tb-id={id}>{renderItem(id)}</span>
            : renderItem(id)
          return (
            <>
              {/* LEFT — traffic-light clearance, then sidebar toggle + Home.
                  These ride the animating lead zone out to the sidebar's right
                  edge when it opens; always visible so they feel attached to
                  the sidebar's trailing edge. */}
              <div className="gnos-tb-left">
                {/* Toggle + Home always sit in the header. In split there's no
                    sidebar to reveal in the panes, so the toggle is a no-op
                    there, but it stays put so the header reads the same. */}
                <button
                  className="gnos-settings-btn"
                  title="Toggle sidebar (⌘\)"
                  onClick={() => { if (!isSplit) useAppStore.getState().toggleSideNav() }}
                >
                  {(!isSplit && (sideNavOpen || sidebarPinned)) ? <PanelLeftClose size={17} strokeWidth={1.8} /> : <PanelLeft size={17} strokeWidth={1.8} />}
                </button>
                <button
                  className="gnos-settings-btn"
                  title="Home"
                  onClick={() => { useAppStore.getState().setActiveCollectionId(null); useAppStore.getState().navigate({ view: 'library', activeLibTab: 'library' }) }}
                >
                  <House size={17} strokeWidth={1.8} />
                </button>
                {layout.left.map(slot)}
              </div>

              {/* CTX — quick-open shortcuts in normal flex flow just right of the
                  lead zone (the lead zone is fixed-width; extra buttons there
                  overflow into the traffic lights). Each hides while its view
                  is already active. */}
              <div className="gnos-tb-ctx">
                {tabs.find(t => t.id === activeTabId)?.view !== 'calendar' && (
                  <button className="gnos-settings-btn" title="Open Calendar"
                    onClick={() => useAppStore.getState().navigate({ view: 'calendar' })}>
                    <Calendar size={16} strokeWidth={1.5} />
                  </button>
                )}
                {tabs.find(t => t.id === activeTabId)?.view !== 'graph' && (
                  <button className="gnos-settings-btn" title="Open Nebuli graph"
                    onClick={() => useAppStore.getState().openNewTab({ view: 'graph' })}>
                    <Waypoints size={16} strokeWidth={1.5} />
                  </button>
                )}
              </div>

              {/* CENTER — search, centered between lead and right zones */}
              <div className="gnos-tb-center">
                {layout.center.map(slot)}
              </div>

              {/* RIGHT */}
              <div className="gnos-tb-right">
                {/* Contextual: Import .ics — calendar view only. Fires an event
                    the mounted FullCalendar listens for. */}
                {tabs.find(t => t.id === activeTabId)?.view === 'calendar' && (
                  <button className="gnos-settings-btn" title="Import calendar (.ics)"
                    onClick={() => window.dispatchEvent(new CustomEvent('gnos:import-ics'))}>
                    <CalendarArrowDown size={16} strokeWidth={1.5} />
                  </button>
                )}
                {layout.right.map(slot)}
                {/* Trayed items that must stay mounted (hidden) */}
                {layout.tray.includes('save') && renderItem('save', true)}
                {layout.tray.includes('quickAccess') && renderItem('quickAccess', true)}
              </div>
            </>
          )
        })()}
      </div>

      {/* ── Content card — lighter floating page. Pushed right by the sidebar
             width when open; zen zeroes its margin/radius/shadow (global.css). ── */}
      <div
        className={`gnos-content-frame${(!isSplit && (sideNavOpen || sidebarPinned)) ? ' pushed pinned' : ''}${isSplit ? ' split' : ''}${zenMode && zenPeekLeft ? ' zen-force-nav' : ''}`}
      >
      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div
        ref={contentRef}
        className="sidenav-push-wrapper"
        style={{
          flex: 1, minHeight: 0,
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
              grow={splitRatio}
              onFocus={() => switchTab(splitPanes[0])}
              onUnsplit={() => { setSplitDir(null); setSplitPanes([]); switchTab(splitPanes[0]) }}
              onSwapPanes={() => setSplitPanes(p => [p[1], p[0]])}
              onClosePane={() => { setSplitDir(null); setSplitPanes([]); switchTab(splitPanes[1]) }}
            />
            <div
              className={`gnos-split-divider ${splitDir === 'vertical' ? 'v' : 'h'}`}
              title="Drag to resize · double-click to reset"
              onDoubleClick={() => setSplitRatio(0.5)}
              onPointerDown={e => {
                if (e.button !== 0) return
                e.preventDefault()
                const wrap = contentRef.current
                const vertical = splitDir === 'vertical'
                const onMove = (ev) => {
                  const r = wrap.getBoundingClientRect()
                  const frac = vertical ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width
                  setSplitRatio(Math.min(0.8, Math.max(0.2, frac)))
                }
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove)
                  window.removeEventListener('pointerup', onUp)
                }
                window.addEventListener('pointermove', onMove)
                window.addEventListener('pointerup', onUp)
              }}
            />
            <TabPane
              tabId={splitPanes[1]}
              isActive={splitPanes[1] === activeTabId}
              isSplit={true}
              grow={1 - splitRatio}
              onFocus={() => switchTab(splitPanes[1])}
              onUnsplit={() => { setSplitDir(null); setSplitPanes([]); switchTab(splitPanes[1]) }}
              onSwapPanes={() => setSplitPanes(p => [p[1], p[0]])}
              onClosePane={() => { setSplitDir(null); setSplitPanes([]); switchTab(splitPanes[0]) }}
            />
          </>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {tabs.map(tab => (
              <TabPane
                key={tab.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                isLastActive={tab.id === prevActiveTabId}
                isSplit={false}
              />
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Customize Toolbar — right-click on the title bar or View menu. Kept
          outside .gnos-content-frame (it's a full-window overlay, not part of
          the card). */}
      {customizeOpen && <CustomizeToolbarOverlay onClose={() => setCustomizeOpen(false)} />}

      {/* External-edit conflict notice — the offline version was kept as a new note, not overwritten */}
      {conflictNote && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 99998,
          maxWidth: 420, display: 'flex', alignItems: 'flex-start', gap: 10,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '12px 14px', boxShadow: '0 12px 40px rgba(0,0,0,0.45)', fontSize: 13, color: 'var(--text)',
        }}>
          <TriangleAlert size={16} strokeWidth={1.4} color="#d29922" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, lineHeight: 1.45 }}>
            <strong>External edit kept separately.</strong> “{conflictNote.originalTitle}” changed on disk while open — the offline version was saved as “{conflictNote.forkTitle}” so nothing was lost.
          </div>
          <button onClick={() => setConflictNote(null)} style={{ border: 'none', background: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
        </div>
      )}

      {/* Tab overview — browser-style grid of all tabs. Offset so it never covers the sidebar. */}
      {tabOverviewOpen && (
        <TabOverview
          onClose={() => setTabOverviewOpen(false)}
          onOpenLayout={() => setTabSettingsOpen(true)}
          leftOffset={sidebarPinned ? 238 : (sideNavOpen ? 254 : 0)}
        />
      )}

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

      {/* ── Mobile chrome ─────────────────────────────────────────────────── */}
      {isMobile && (
        <>
          {/* Floating top-left sidebar toggle */}
          <button
            className="mobile-float-btn mobile-float-btn--left"
            onClick={() => useAppStore.getState().toggleSideNav()}
            title="Open sidebar"
          >
            <PanelLeft size={19} strokeWidth={1.8} />
          </button>

          {/* Centered title pill — view-specific content */}
          {mobileTabsOpen
            ? <div className="mobile-gnos-title">Tabs</div>
            : activeTab?.view !== 'reader' && activeTab?.view !== 'library' && (
                <MobileViewTitle activeTab={activeTab} />
              )
          }

          {/* Floating top-right settings button — view-aware */}
          <button
            className="mobile-float-btn mobile-float-btn--right"
            onClick={() => {
              const v = activeTab?.view
              if (v === 'reader') {
                window.dispatchEvent(new CustomEvent('gnos:reader-cmd', { detail: { cmd: 'settings' } }))
              } else if (v === 'notebook') {
                window.dispatchEvent(new CustomEvent('gnos:mobile-nb-cmd', { detail: { cmd: 'settings' } }))
              } else if (v === 'sketchbook') {
                window.dispatchEvent(new CustomEvent('gnos:mobile-sb-cmd', { detail: { cmd: 'settings' } }))
              } else {
                setMobileSettingsOpen(true)
              }
            }}
            title="Settings"
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>

          {mobileSettingsOpen && (
            <UniversalSettingsModal onClose={() => setMobileSettingsOpen(false)} />
          )}

          <MobileBottomBar
            activeView={activeTab?.view}
            tabsOpen={mobileTabsOpen}
            onTabsOpen={() => setMobileTabsOpen(v => !v)}
          />
          {mobileTabsOpen && (
            <MobileTabSwitcher
              onClose={() => setMobileTabsOpen(false)}
              switchTab={switchTab}
              tabs={tabs}
              activeTabId={activeTabId}
              closeTab={closeTab}
              openNewTab={openNewTab}
              notebooks={notebooks}
              flashcardDecks={flashcardDecks}
              sketchbooks={sketchbooks}
              library={library}
            />
          )}
        </>
      )}

    </div>
  )
}