/* eslint-disable react-refresh/only-export-components */
import { useContext, useEffect, useReducer, useRef } from 'react'
import { createPortal } from 'react-dom'
import { PaneContext, PaneChromeContext } from '@/lib/PaneContext'
import useAppStore from '@/store/useAppStore'

// ─────────────────────────────────────────────────────────────────────────────
// QuickAccess — portals per-view action buttons into the title bar's
// quick-access strip (#gnos-quick-access, left of the tab manager).
// Only the active tab's actions render; inactive (but mounted) tabs bail out.
//
// Usage inside a view:
//   <QuickAccess>
//     <button className="gnos-settings-btn" title="…" onClick={…}>{icon}</button>
//   </QuickAccess>
//
// TitlebarMeta — declarative hook for the search-bar extras (counts, chapter
// dropdown). Pass null/undefined fields to omit.
//   useTitlebarMeta(isActive ? { text: '1,204 words' } : null, [deps])
// ─────────────────────────────────────────────────────────────────────────────

export function useIsActivePane() {
  const paneTabId = useContext(PaneContext)
  const activeTabId = useAppStore(s => s.activeTabId)
  return !paneTabId || paneTabId === activeTabId
}

export default function QuickAccess({ children }) {
  const isActive = useIsActivePane()
  // Split mode: portal into THIS pane's own local header instead of the global
  // strip, and render regardless of active-pane state (both panes show their
  // own actions). Single mode: global strip, active pane only (as before).
  const chrome = useContext(PaneChromeContext)
  const targetId = chrome?.qaHostId || 'gnos-quick-access'
  // Re-resolve when the titlebar layout changes — moving the quick-access strip
  // between zones remounts #gnos-quick-access and detaches the old host node.
  const titlebarLayout = useAppStore(s => s.titlebarLayout)
  const [, force] = useReducer(x => x + 1, 0)
  // Resolve the host node at render time (portals may target any live node).
  // Reading the DOM in render is safe here — it's a read-only lookup of an
  // element React itself renders elsewhere in the same tree.
  const host = typeof document !== 'undefined' ? document.getElementById(targetId) : null
  // If the host isn't in the DOM yet (it can mount a commit later — e.g. the
  // per-pane header appears the same frame the split turns on), retry on the
  // next few frames until it resolves. Capped so a permanently-missing target
  // (e.g. a trayed strip) doesn't spin forever.
  const retries = useRef(0)
  useEffect(() => { retries.current = 0 }, [targetId, titlebarLayout])
  useEffect(() => {
    if (host || retries.current > 20) return
    retries.current += 1
    const raf = requestAnimationFrame(force)
    return () => cancelAnimationFrame(raf)
  }, [host, targetId, titlebarLayout])
  if (!host || !host.isConnected) return null
  if (!chrome && !isActive) return null
  return createPortal(children, host)
}

/** Publish search-bar extras while the calling view is the active pane.
 *  Clears them automatically on unmount / deactivation. */
export function useTitlebarMeta(meta) {
  const isActive = useIsActivePane()
  const setTitlebarMeta = useAppStore(s => s.setTitlebarMeta)
  useEffect(() => {
    if (!isActive) return
    setTitlebarMeta(meta || null)
    return () => setTitlebarMeta(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, JSON.stringify(meta?.text), meta?.dropdown?.activeId, meta?.dropdown?.items?.length])
}
