import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Check } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// ContextMenu — the ONE right-click / dots-menu component for the whole app.
// Pass 1 of the popup/dropdown revamp (PLAN_POPUP_REVAMP.md): unifies what
// used to be three near-identical implementations (SideNavCtxMenu in
// SideNav.jsx, ContextMenu + CtxSubmenu in LibraryView.jsx) into one shared
// component so every menu in the app looks and behaves the same, and the
// next passes (add-popups, settings, edit modals, dropdowns) have a real
// baseline to borrow from.
//
// Item shape: { label, icon?: rawSvgPathString, iconNode?: ReactNode,
//   action?, danger?, disabled?, submenu?: [{ label, action, checked?,
//   iconNode? }] } — or { divider: true } in place of a row, in either the
// top-level list or a submenu. `icon` is a raw `<path>`-only SVG fragment
// (the app-wide convention for menu icons — see project_lucide_icons
// memory) rendered at a fixed 14px/1 stroke so every menu reads as one icon
// system regardless of which view built the items. `iconNode` is the
// escape hatch for a caller that already has a real element to show
// instead (e.g. collection rows via CollectionFace, which can be an emoji,
// a lucide icon, or a color dot depending on the collection) — takes
// priority over `icon` when both are given. A submenu entry whose label
// starts with "#" renders as a color swatch instead of text; one with
// `checked: true` gets a trailing check mark (e.g. "already in this
// collection").
//
// Keyboard: Up/Down moves the highlighted row (wraps, skips disabled),
// Enter activates it (or opens its submenu), Right opens a submenu, Left/
// Escape closes the nearest open layer.
// ─────────────────────────────────────────────────────────────────────────────
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef()
  const [openSub, setOpenSub] = useState(null) // index of the item whose submenu is open
  const [activeIdx, setActiveIdx] = useState(-1)

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  useLayoutEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const { offsetWidth: w, offsetHeight: h } = el
    el.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px'
    el.style.top  = Math.max(60, Math.min(y, window.innerHeight - h - 8)) + 'px'
  }, [x, y])

  function enabledIndices() {
    return items.reduce((acc, it, i) => { if (!it.disabled && !it.divider) acc.push(i); return acc }, [])
  }
  function move(delta) {
    const en = enabledIndices()
    if (!en.length) return
    const pos = en.indexOf(activeIdx)
    const next = pos === -1 ? (delta > 0 ? en[0] : en[en.length - 1]) : en[(pos + delta + en.length) % en.length]
    setActiveIdx(next)
    setOpenSub(null)
  }
  function activate(i) {
    const item = items[i]
    if (!item || item.disabled) return
    if (item.submenu) setOpenSub(i)
    else { item.action?.(); onClose() }
  }
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (activeIdx !== -1 && items[activeIdx]?.submenu) setOpenSub(activeIdx) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpenSub(null) }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIdx !== -1) activate(activeIdx) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div ref={ref} className="context-menu" role="menu" tabIndex={-1} onKeyDown={onKeyDown}
      style={{ position: 'fixed', left: x, top: y }}
    >
      {items.map((item, i) => item.divider ? (
        <div key={i} className="ctx-divider" />
      ) : (
        <div key={i} style={{ position: 'relative' }}
          onMouseEnter={() => { setActiveIdx(i); if (item.submenu) setOpenSub(i) }}
          onMouseLeave={() => { if (item.submenu) setOpenSub(null) }}
        >
          <button
            role="menuitem"
            className={`ctx-item${item.danger ? ' danger' : ''}${activeIdx === i ? ' ctx-item-active' : ''}`}
            disabled={item.disabled}
            onClick={() => activate(i)}
          >
            {item.iconNode ? (
              <span className="ctx-item-icon">{item.iconNode}</span>
            ) : item.icon && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="ctx-item-icon"
                dangerouslySetInnerHTML={{ __html: item.icon }} />
            )}
            <span className="ctx-item-label">{item.label}</span>
            {item.submenu && <ChevronRight size={11} strokeWidth={1.5} className="ctx-item-chevron" />}
          </button>
          {item.submenu && openSub === i && (
            <CtxSubmenu submenu={item.submenu} onClose={onClose} />
          )}
        </div>
      ))}
    </div>
  )
}

function CtxSubmenu({ submenu, onClose }) {
  const ref = useRef()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.left = '100%'; el.style.right = 'auto'
    el.style.top = '-4px'; el.style.maxHeight = ''; el.style.overflowY = ''
    const margin = 8
    let r = el.getBoundingClientRect()
    // Flip to the parent's left edge if it would overflow the right side.
    if (r.right > window.innerWidth - margin) {
      el.style.left = 'auto'; el.style.right = '100%'
      r = el.getBoundingClientRect()
    }
    // Taller than the viewport: pin near the top and let it scroll. Otherwise
    // just nudge it up by however much it overflows the bottom.
    if (r.height > window.innerHeight - 2 * margin) {
      el.style.maxHeight = (window.innerHeight - 2 * margin) + 'px'
      el.style.overflowY = 'auto'
      el.style.top = (margin - r.top - 4) + 'px'
    } else if (r.bottom > window.innerHeight - margin) {
      el.style.top = (-4 - (r.bottom - (window.innerHeight - margin))) + 'px'
    }
  }, [])
  return (
    <div ref={ref} className="context-menu ctx-submenu" role="menu" style={{ position: 'absolute', left: '100%', top: -4 }}>
      {submenu.map((sub, j) => {
        if (sub.divider) return <div key={j} className="ctx-divider" />
        const isSwatch = sub.label?.startsWith('#')
        return (
          <button key={j} role="menuitem" className="ctx-item"
            onClick={() => { sub.action(); onClose() }}>
            {sub.iconNode ? (
              <span className="ctx-item-icon">{sub.iconNode}</span>
            ) : isSwatch && <span className="ctx-item-swatch" style={{ background: sub.label }} />}
            <span className="ctx-item-label">{isSwatch ? '' : sub.label}</span>
            {sub.checked && <Check size={12} strokeWidth={2} className="ctx-item-chevron" />}
          </button>
        )
      })}
      {submenu.length === 0 && (
        <div className="ctx-item-empty">No collections</div>
      )}
    </div>
  )
}
