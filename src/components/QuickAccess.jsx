/* eslint-disable react-refresh/only-export-components */
import { useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { PaneContext } from '@/lib/PaneContext'
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
  // Re-resolve when the titlebar layout changes — moving the quick-access strip
  // between zones remounts #gnos-quick-access and detaches the old host node.
  const titlebarLayout = useAppStore(s => s.titlebarLayout)
  const [host, setHost] = useState(() => document.getElementById('gnos-quick-access'))
  useEffect(() => {
    if (host && host.isConnected) return
    // Title bar mounts in the same commit — resolve the portal target just after
    const raf = requestAnimationFrame(() => setHost(document.getElementById('gnos-quick-access')))
    return () => cancelAnimationFrame(raf)
  }, [host, titlebarLayout])
  if (!host || !host.isConnected || !isActive) return null
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
