import { useEffect, useLayoutEffect, useRef } from 'react'
import { Archive, Book, Layers, Link as LinkIcon, Music, NotebookText, SquarePen } from 'lucide-react'
import useAppStore from '@/store/useAppStore'

// ─────────────────────────────────────────────────────────────────────────────
// AddPopup — the ONE "create new" popup for the whole app. Pass 2 of the
// popup/dropdown revamp (PLAN_POPUP_REVAMP.md): unifies what used to be
// three implementations — SidebarAddPopup (SideNav.jsx), AddPopup +
// LibContextMenu (LibraryView.jsx, the latter a mislabeled duplicate of the
// former found during Pass 1) — each with its own slightly-different choice
// list (SidebarAddPopup was missing "Open File…" entirely; icon choice for
// Audiobook disagreed — Volume2 vs Music; header text disagreed — "Add to
// Library" vs "Add"; icons were muted-gray in one, accent-tinted in the
// other two) and its own CSS (`.add-choice-*`, now harmonized with
// ContextMenu's `.context-menu` chrome so both popup families share one
// visual language, per Pass 1's stated rationale).
//
// Same callback-props shape everywhere — each caller supplies its own
// creation logic (SideNav.jsx's closes the sidebar afterward, LibraryView's
// doesn't) exactly like ContextMenu's `items` are caller-supplied.
//
// `variant`:
//   - 'up'     — absolute, opens upward-right (sidebar footer + button,
//                which sits at the bottom of the screen)
//   - 'down'   — absolute, opens downward-right (a header/toolbar + button)
//   - 'fixed'  — position:fixed at {x,y}, viewport-clamped (right-click)
//   - 'sheet'  — position:relative (mobile bottom-sheet embedding)
//   - 'center' — position:fixed, centered in the viewport (used when there's
//                no natural trigger element to anchor to — e.g. the
//                empty-library "+" or a menu-bar/keyboard "Add" command)
// ─────────────────────────────────────────────────────────────────────────────
export function AddPopup({
  onClose, onAddBook, onAddAudio, onNewNotebook, onNewSketchbook, onNewFlashcardDeck, onNewCollection, onOpenFile,
  variant = 'down', x, y,
}) {
  const ref = useRef()

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  useLayoutEffect(() => {
    if (variant !== 'fixed' || !ref.current) return
    const el = ref.current
    const { offsetWidth: w, offsetHeight: h } = el
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px'
    el.style.top  = Math.max(60, Math.min(y, window.innerHeight - h - 8)) + 'px'
  }, [variant, x, y])

  const choices = [
    { icon: <Book size={16} strokeWidth={1.5} />, label: 'Book', sub: 'EPUB · TXT · PDF', action: onAddBook },
    { icon: <Music size={16} strokeWidth={1.5} />, label: 'Audiobook', sub: 'MP3 · M4B · FLAC', action: onAddAudio },
    { icon: <NotebookText size={16} strokeWidth={1.5} />, label: 'Notebook', sub: 'Markdown · live preview', action: onNewNotebook },
    { icon: <SquarePen size={16} strokeWidth={1.5} />, label: 'Sketchbook', sub: 'Excalidraw canvas', action: onNewSketchbook },
    { icon: <Layers size={16} strokeWidth={1.5} />, label: 'Flashcards', sub: 'Spaced repetition', action: onNewFlashcardDeck },
    { icon: <Archive size={16} strokeWidth={1.5} />, label: 'Collection', sub: 'Group items', action: onNewCollection },
  ]

  const posStyle = {
    up:     { position: 'absolute', bottom: 40, right: 0 },
    down:   { position: 'absolute', top: 'calc(100% + 6px)', right: 0 },
    fixed:  { position: 'fixed', left: x, top: y },
    sheet:  { position: 'relative' },
    center: { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' },
  }[variant]

  return (
    <div ref={ref} className="context-menu" style={{ ...posStyle, minWidth: 200, padding: '4px 4px 3px' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="add-choice-header">Add</div>
      {choices.map(({ icon, label, sub, action }) => (
        <button key={label} className="add-choice-btn" onClick={() => { action?.(); onClose() }}>
          {icon}
          <div>
            <div className="add-choice-label">{label}</div>
            {sub && <div className="add-choice-sub">{sub}</div>}
          </div>
        </button>
      ))}
      <div className="ctx-divider" />
      <button className="add-choice-btn" onClick={() => { (onOpenFile || (() => useAppStore.getState().openExternalFile()))(); onClose() }}>
        <LinkIcon size={16} strokeWidth={1.5} />
        <div className="add-choice-label">Open File…</div>
      </button>
    </div>
  )
}
