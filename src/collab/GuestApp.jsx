// Web guest client — PLAN_CONCURRENCY.md §7. Loaded from collab.html, always
// the GUEST side (the host is always the desktop app's NoteCollabPanel —
// there is no "start hosting" flow here, unlike src/dev/YjsRelayHarness.jsx
// which proves both sides in one page). Uses src/lib/collab/engine.js and
// CollabEditor.jsx verbatim — the same, already-verified mechanics
// NotebookView.jsx's host side uses, just without the host-only hooks
// (useCanonicalDoc/useHostRelay never run here — a guest never applies
// anyone's writes, it only ever proposes its own).
//
// UPDATE (2026-08-19, §18 Phase A–E): §7's original scope note below is
// superseded — this now renders Gnos's REAL widget zoo (makeLivePlugin and
// everything it depends on, shared verbatim from src/lib/notebookEditor.jsx,
// same module NotebookView.jsx's own host editor uses) in Live and Source
// modes, and the REAL inlineToHtml/renderMarkdown (same renderer the host's
// own PDF export uses) in Preview — not the plain CM6 markdown editor / the
// compact renderMarkdown.js stand-in this file shipped with through Phase C.
// `hasVault: false` throughout (no `notebooks`/`library`/`sketchbooks`/
// `flashcardDecks` — a guest has no vault), so wikilinks render an honest
// "not available in a shared note" state rather than resolving or falsely
// offering to create one (§18.5). What's still genuinely not ported, on
// purpose — see CollabEditor.jsx's own header for the current, accurate
// list (the `/color` family's floating picker, wikilink autocomplete, full
// per-theme CSS parity).
//
// §7's original scope note, kept for history — no longer describes current
// behavior for the items it names:
//   - Asset upload (referenced local images collected into the room) — §7's
//     own "asset problem". This page's rendering half is done (assetsPlugin.js,
//     via the `assets` prop below); the host-side collection/publish half
//     lives in src/lib/collab/hostAssets.js, wired from NoteCollabPanel.jsx.
//     (A SEPARATE guest-side upload path, for `/linkf`, was added in Phase D
//     — see guestAssets.js.)
//   - The §14.5 "keep a copy" download prompt — done, see SessionEndScreen
//     below. Markdown-only when the note has no local images (no extra
//     weight); JSZip (already a project dependency, used elsewhere) is
//     lazy-imported only if there are assets to bundle alongside it.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import * as Y from 'yjs'
import { usePeer, useAccessControl } from '@/lib/collab/engine'
import { Editor, RelayedEditor } from '@/lib/collab/CollabEditor'
import { openSearchPanel } from '@codemirror/search'
import { PALETTE, AVATAR_ICONS } from '@/lib/collab/ids'
import { renderMarkdown, hydrateMathNodes, hydrateDiagrams } from '@/lib/notebookEditor'

// Light/dark toggle (issue: guest page was dark-only, no switcher at all).
// Values match src/lib/themes.js's own BUILT_IN_THEMES.light/.dark — same
// numbers the desktop app uses for these two themes — so a guest's page
// doesn't invent a third, unrelated palette. Persisted per-browser
// (localStorage), not per-room: a guest's theme preference isn't part of
// the shared document and has no reason to be.
const THEME_KEY = 'gnos-collab-theme'
function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* localStorage unavailable (private mode, etc.) — fall through */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// Squared-off icon buttons, matching gnos-settings-btn's own shape
// (src/App.jsx: 27x27, 6px radius) rather than the fully round ones this
// page shipped with — the ask was specifically "squared off ... to match
// gnos branding."
const SQUARE_RADIUS = 7

/** `https://getgnos.com/join/<roomId>#key=<key>` — room id in the path
 *  (opaque, fine to be visible, matches what the signaling server sees
 *  anyway), key in the fragment (secret, never sent to any server; a
 *  fragment never leaves the browser on navigation). Mirrors exactly what
 *  NoteCollabPanel.jsx generates on the host side.
 *
 *  Also accepts `?room=<roomId>` as an equally-valid form — not a test
 *  shortcut, a real fallback: `/join/<id>` only resolves to this page at
 *  all if whatever's hosting collab.html has a rewrite rule serving it for
 *  that path (a Cloudflare Pages `_redirects` line, task #6 — not written
 *  yet). A query param needs no server-side routing config to work, so it's
 *  worth supporting regardless of whether that rewrite is set up right on
 *  a given deployment. */
function useRoomFromPath() {
  return useMemo(() => {
    const path = window.location.pathname
    const pathMatch = path.match(/\/join\/([^/]+)/)
    const params = new URLSearchParams(window.location.search)
    const room = (pathMatch ? decodeURIComponent(pathMatch[1]) : null) || params.get('room')
    const keyMatch = window.location.hash.match(/key=([^&]+)/)
    const key = keyMatch ? decodeURIComponent(keyMatch[1]) : null
    return { room, key }
  }, [])
}

// The Gnos brand mark — same hand-drawn quill as IconQuill in
// src/components/icons.jsx, inlined rather than imported. Importing that
// file pulls in lucide-react's LucideProvider for the sake of one static
// SVG this page never needs elsewhere; copying ~5 lines is cheaper than the
// dependency, and it's called out here so it doesn't quietly drift from the
// original if that one changes.
function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 22, color: 'var(--accent)' }}>
      <svg width="17" height="17" viewBox="0 0 32 32" fill="none">
        <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <path d="M26 3C25 6 22 10 16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
        <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
        <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55" />
      </svg>
      <span style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: 'var(--text)' }}>Gnos</span>
    </div>
  )
}

// Same quill glyph as Logo() above, sized for a toolbar button — the
// connected view's mode toggle default state (matches NotebookView.jsx's
// own ViewModeBtn, where IconQuill IS the "Live" mode icon; see
// icons.jsx's own comment on IconQuill). Duplicated rather than factored
// into one shared component with Logo() — different sizes/margins, not
// worth a prop for two call sites in one file.
function QuillIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <path d="M26 3C25 6 22 10 16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

// lucide-react's "pencil" glyph, inlined, same reasoning as the icons
// around it. Matches NotebookView.jsx's IconSrc (Pencil, "Source mode") —
// the 3-mode toggle's middle state (PLAN_CONCURRENCY.md §18.7 "Phase E").
function PencilIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

// lucide-react's "eye" glyph, inlined — same reasoning as Logo()'s quill:
// one static icon doesn't justify importing lucide-react's whole provider
// setup into this bundle. Matches NotebookView.jsx's IconPrev (Eye,
// "Reading view") — the mode toggle's other state.
function EyeIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

// lucide-react's "users" glyph, inlined, same reasoning — matches the
// Users icon NotebookView.jsx's own ambient "Live" indicator uses (see
// NotebookView.jsx's bottom-right share indicator), so the guest and host
// sides show the same mark for the same concept.
function UsersIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

// lucide-react's "search" glyph, inlined — same reasoning as the icons
// above. The new find/search toolbar button.
function SearchIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

// lucide-react's "sun" / "moon" glyphs, inlined — the new light/dark toggle.
function SunIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}
function MoonIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

/** Renders one AVATAR_ICONS entry (src/lib/collab/ids.js — `[tag, props][]`,
 *  the same raw shape lucide-react's own generated icon files use) as real
 *  SVG children. Kept generic rather than one hand-written component per
 *  icon (unlike Logo/QuillIcon/EyeIcon/UsersIcon above, which are each used
 *  exactly once at a fixed size) because the join screen renders the whole
 *  AVATAR_ICONS set in a picker grid, plus whichever one a guest picked
 *  shows again in the Users popover — a data-driven renderer is the
 *  natural fit once there's more than a couple of call sites. */
function Icon({ id, size = 14 }) {
  const entry = AVATAR_ICONS.find(i => i.id === id) || AVATAR_ICONS[0]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {entry.node.map(([tag, props], i) => {
        const Tag = tag
        return <Tag key={i} {...props} />
      })}
    </svg>
  )
}

function IconButton({ onClick, title, badge, active, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      position: 'relative', width: 32, height: 32, borderRadius: SQUARE_RADIUS, flexShrink: 0, padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto',
      background: active ? 'var(--surfaceAlt)' : 'var(--surface)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      color: active ? 'var(--accent)' : 'var(--text)', cursor: 'pointer',
    }}>
      {children}
      {badge > 0 && (
        <span style={{
          position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7,
          background: 'var(--accent)', color: '#fff', fontSize: 9.5, fontWeight: 700, lineHeight: '14px', textAlign: 'center',
        }}>
          {badge}
        </span>
      )}
    </button>
  )
}

/** The expanded "live users" popover — who's actually connected right now
 *  (`status === 'approved'`, i.e. excludes anyone still pending or denied),
 *  and, per the request this was built for, "Leave the room" at the
 *  bottom rather than a separate always-visible link in the toolbar.
 *  `userStates` is clientId → `awareness`'s own `user` field
 *  (`{color, icon}` — see usePeer), keyed the same way as `entries` so a
 *  row can show the same color/icon this guest picked on the join screen;
 *  `access.entries` alone (a Y.Map, not awareness) never carried that. */
function UsersModal({ entries, userStates, myId, onClose, onLeave }) {
  const rows = Object.entries(entries).filter(([, e]) => e.status === 'approved')
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1099 }} />
      <div style={{
        position: 'fixed', top: 52, right: 14, zIndex: 1100, width: 220, maxWidth: 'calc(100vw - 28px)',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,.4)', overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
          Connected
        </div>
        <div style={{ padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 220, overflowY: 'auto' }}>
          {rows.map(([id, e]) => {
            const u = userStates?.[id]
            const color = u?.color || 'var(--accent)'
            return (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
              <span style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0, color,
                background: `color-mix(in srgb, ${color} 16%, transparent)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon id={u?.icon || 'user'} size={12} />
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}{String(id) === String(myId) ? ' (you)' : ''}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--textDim)' }}>{e.role}</span>
            </div>
            )
          })}
        </div>
        <button onClick={onLeave} style={{
          width: '100%', padding: '10px 12px', border: 'none', borderTop: '1px solid var(--border)',
          background: 'none', color: '#f85149', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
        }}>
          Leave the room
        </button>
      </div>
    </>
  )
}

function Centered({ children }) {
  return (
    <div className="gm-vh" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', overflowY: 'auto' }}>
      <div style={{ maxWidth: 360, width: '100%' }}>
        <Logo />
        {children}
      </div>
    </div>
  )
}

/** Name + a real identity pick, not just a name — issue asked for "give
 *  option for color picker and icon" on entry, previously a color was
 *  auto-assigned at random (GuestSession's old `useMemo`) and there was no
 *  icon at all. `'user'` (a plain person glyph) is the default icon per the
 *  user's own answer to this session's clarifying question; icons are
 *  lucide glyphs, not emoji, for the same reason (see AVATAR_ICONS's own
 *  comment: they render in the guest's chosen color via `currentColor`,
 *  which an emoji can't do). */
function JoinScreen({ onJoin }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[1]) // [0] is reserved for the host in NoteCollabPanel.jsx — start a guest off on a different one
  const [icon, setIcon] = useState('user')
  // The 20th color slot, matching the icon picker's own count (2026-08-19) —
  // not a 20th preset (PALETTE stops at 19), a genuine custom hex-code
  // picker. `customColor` is `null` until the guest actually picks one, so
  // the swatch can show a neutral "pick anything" gradient wheel at rest
  // and the guest's own real pick once they've made it, rather than
  // defaulting to some arbitrary 20th preset hue.
  const [customColor, setCustomColor] = useState(null)
  const customColorInputRef = useRef(null)
  const isCustomActive = customColor !== null && color === customColor
  const canJoin = name.trim().length > 0
  return (
    <Centered>
      <form
        onSubmit={e => { e.preventDefault(); if (canJoin) onJoin(name.trim(), color, icon) }}
        className="gm-join"
      >
        <div className="gm-join-head">
          <strong className="gm-join-title">Join this note</strong>
          <p className="gm-join-sub">The host will approve you before you can see it.</p>
        </div>

        <div className="gm-join-field">
          <label className="gm-join-label" htmlFor="gm-join-name">Name</label>
          <input
            id="gm-join-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="gm-join-input"
            autoComplete="off"
          />
        </div>

        <div className="gm-join-field">
          <span className="gm-join-label">Color</span>
          <div className="gm-join-grid gm-join-grid-color">
            {PALETTE.map(c => (
              <button
                key={c} type="button" onClick={() => setColor(c)} title={c} aria-label={c} aria-pressed={c === color}
                className="gm-join-swatch"
                style={{ background: c, boxShadow: c === color ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : 'none' }}
              />
            ))}
            {/* The 20th slot — a real hex-code picker, not a 20th preset.
                Same outer chrome as an icon button (border/background/hover,
                `gm-join-icon-btn`) so it visually matches the icon picker
                exactly, per the ask; the wheel inside is its own "icon" —
                a conic-gradient circle until a color's been picked, then a
                plain circle of that real color, same as every other swatch
                showing its own color as a solid fill. */}
            <button
              type="button"
              onClick={() => customColorInputRef.current?.click()}
              title="Custom color" aria-label="Custom color" aria-pressed={isCustomActive}
              className={`gm-join-icon-btn gm-join-color-custom${isCustomActive ? ' active' : ''}`}
              style={isCustomActive ? { background: `color-mix(in srgb, ${customColor} 14%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${customColor}` } : undefined}
            >
              <span className="gm-join-color-wheel" style={isCustomActive ? { background: customColor } : undefined} />
              <input
                ref={customColorInputRef}
                type="color"
                value={customColor || '#888888'}
                onChange={e => { setCustomColor(e.target.value); setColor(e.target.value) }}
                className="gm-join-color-input"
                aria-hidden="true"
                tabIndex={-1}
              />
            </button>
          </div>
        </div>

        <div className="gm-join-field">
          <span className="gm-join-label">Icon</span>
          <div className="gm-join-grid gm-join-grid-icon">
            {AVATAR_ICONS.map(({ id }) => (
              <button
                key={id} type="button" onClick={() => setIcon(id)} title={id} aria-label={id} aria-pressed={id === icon}
                className={`gm-join-icon-btn${id === icon ? ' active' : ''}`}
                style={id === icon ? { color, background: `color-mix(in srgb, ${color} 14%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
              >
                <Icon id={id} size={16} />
              </button>
            ))}
          </div>
        </div>

        <button type="submit" disabled={!canJoin} className="gm-join-submit">
          Ask to join
        </button>
      </form>
    </Centered>
  )
}

function StatusScreen({ title, body }) {
  return (
    <Centered>
      <strong style={{ fontSize: 16 }}>{title}</strong>
      {body && <p style={{ opacity: 0.7, fontSize: 12.5, lineHeight: 1.5 }}>{body}</p>}
    </Centered>
  )
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** PLAN_CONCURRENCY.md §14.5: "guest keeps a copy" on session end, whether
 *  that's the host ending it or the guest leaving first — same prompt
 *  either way, never a silent drop. Purely client-side: the guest's browser
 *  already holds everything being offered, nothing new is uploaded or
 *  stored anywhere. `noteText`/`assets` are a snapshot taken at the moment
 *  the session ended (see GuestSession) — the Y.Doc itself is still sitting
 *  in memory even after `peer.disconnect()`, just no longer live-updating. */
function SessionEndScreen({ noteText, assets, reason }) {
  const [state, setState] = useState('prompt') // 'prompt' | 'saving' | 'done' | 'declined'
  const titleMatch = noteText.match(/^#\s+(.+)$/m)
  const noteTitle = titleMatch ? titleMatch[1].trim() : 'shared note'
  const safeName = noteTitle.replace(/[/\\?%*:|"<>]/g, '-') || 'shared-note'
  const assetEntries = Object.entries(assets || {})

  const download = async () => {
    setState('saving')
    try {
      if (assetEntries.length) {
        const { default: JSZip } = await import('jszip')
        const zip = new JSZip()
        zip.file(`${safeName}.md`, noteText)
        const imgFolder = zip.folder('images')
        for (const [path, bytes] of assetEntries) imgFolder.file(path.split('/').pop() || path, bytes)
        triggerDownload(await zip.generateAsync({ type: 'blob' }), `${safeName}.zip`)
      } else {
        triggerDownload(new Blob([noteText], { type: 'text/markdown' }), `${safeName}.md`)
      }
      setState('done')
    } catch {
      setState('prompt') // download failed — let them try again rather than stranding on "saving…"
    }
  }

  if (state === 'done') return <StatusScreen title="Saved" body={`Downloaded ${assetEntries.length ? `${safeName}.zip` : `${safeName}.md`}. You can close this tab.`} />
  if (state === 'declined') return <StatusScreen title="Session ended" body="You can close this tab." />

  return (
    <Centered>
      <strong style={{ fontSize: 16 }}>{reason}</strong>
      <p style={{ opacity: 0.75, fontSize: 13.5, lineHeight: 1.5, margin: '6px 0 16px' }}>
        Keep a copy of "{noteTitle}"?
        {assetEntries.length > 0 && ` Includes ${assetEntries.length} image${assetEntries.length === 1 ? '' : 's'}.`}
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button onClick={download} disabled={state === 'saving'} style={{
          padding: '9px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff',
          fontSize: 13.5, fontWeight: 600, cursor: state === 'saving' ? 'wait' : 'pointer',
        }}>
          {state === 'saving' ? 'Saving…' : assetEntries.length ? 'Download .zip' : 'Download .md'}
        </button>
        <button onClick={() => setState('declined')} style={{
          padding: '9px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)',
          fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
        }}>
          No thanks
        </button>
      </div>
    </Centered>
  )
}

/** clientId (string) → that peer's `awareness` `user` field
 *  (`{name, color, colorLight, icon?}`) — awareness, NOT `access` (a
 *  Y.Map), is where color/icon actually live (see usePeer). Used by
 *  UsersModal to show the same color/icon a participant picked, not just
 *  their name/role. */
function useAwarenessUserStates(awareness) {
  const [states, setStates] = useState({})
  useEffect(() => {
    if (!awareness) return
    const onChange = () => {
      const out = {}
      awareness.getStates().forEach((s, clientId) => { if (s?.user) out[String(clientId)] = s.user })
      setStates(out)
    }
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [awareness])
  return states
}

function GuestSession({ room, roomKey, name, color, icon }) {
  const peer = usePeer(room, roomKey, false, name, color, { icon })
  const access = useAccessControl(peer.accessMap, peer.awareness?.clientID)
  const userStates = useAwarenessUserStates(peer.awareness)

  const mine = access.mine
  const relayed = mine?.role === 'editor'
  // Stable identity across renders — `doc.getMap(name)` returns the same
  // Y.Map instance every call, but a fresh `{...}` object literal passed
  // inline as a prop would NOT be, and Editor/RelayedEditor's mount effects
  // depend on this object's identity: a new one every render would remount
  // the CM6 view on every render, not just when the peer/doc actually
  // changes.
  const assets = useMemo(() => ({ assetsMap: peer.doc.getMap('assets'), assetsMetaMap: peer.doc.getMap('assetsMeta') }), [peer.doc])
  // RelayedEditor's local scratch doc, created here (not inside
  // RelayedEditor itself) specifically so it survives that component
  // unmounting — Preview mode unmounts it, and so does ending the session.
  // Its text is "everything this guest has typed, sent to the host or
  // not" — see the session-end snapshot below for why that's the fix for
  // "edits are trashed on session end."
  const [draftDoc] = useState(() => new Y.Doc())
  // Guest-initiated leave (§14.5: "same prompt if the guest leaves first") —
  // separate from `mine.status === 'denied'` (host-initiated), same
  // end screen either way.
  const [leftManually, setLeftManually] = useState(false)
  // 'live' | 'source' | 'preview' — matches notebookEditor.jsx's own MODE_META
  // naming exactly (PLAN_CONCURRENCY.md §18.7 "Phase E"); click-cycles
  // Live → Source → Preview → Live, the simpler alternative to ViewModeBtn's
  // full long-press dropdown (asked, decided 2026-08-19 — the click-cycle).
  const [mode, setMode] = useState('live')
  const [usersOpen, setUsersOpen] = useState(false)
  const [theme, setTheme] = useState(getInitialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* private-mode localStorage — theme just won't persist */ }
  }, [theme])
  // The live CM6 EditorView, handed up by Editor/RelayedEditor's `onView`
  // — needed so the new search button can call `openSearchPanel(view)`.
  // Not a ref: the view instance itself changes (role flips remount
  // Editor, mode switches unmount/remount RelayedEditor), and the toolbar
  // needs to re-render to know whether there's a view to search at all.
  const [view, setView] = useState(null)
  // Preview mode reads `peer.ytext.toString()` directly rather than a
  // memo keyed on the ytext OBJECT (stable, doesn't change when its
  // CONTENT does) — this tick forces a recompute on every remote/local
  // change, but only while Preview is actually the visible mode, so
  // editing-mode sessions pay nothing for it.
  const [, retick] = useReducer(x => x + 1, 0)
  useEffect(() => {
    if (mode !== 'preview') return
    const onChange = () => retick()
    peer.ytext.observe(onChange)
    return () => peer.ytext.unobserve(onChange)
  }, [mode, peer.ytext])
  // Math (`$…$`) and mermaid diagrams render as EMPTY placeholder spans
  // straight out of `renderMarkdown` (`data-latex`/mermaid-source attributes,
  // no innerHTML) — `hydrateMathNodes`/`hydrateDiagrams` are a separate,
  // post-mount pass that fills them in (KaTeX/mermaid are both lazy-loaded,
  // real DOM elements to attach to). `NotebookView.jsx`'s own Preview mode
  // calls both the same way, same deps shape (§18.7 "Phase E"); skipping
  // this wasn't a hypothetical gap — math rendered as literally nothing
  // until this was added, caught live during verification.
  const previewRef = useRef(null)
  const previewHtml = mode === 'preview' ? renderMarkdown(peer.ytext.toString(), [], [], [], [], null, assets, false) : null
  useEffect(() => {
    if (mode !== 'preview' || !previewRef.current) return
    hydrateMathNodes(previewRef.current)
    hydrateDiagrams(previewRef.current)
  }, [mode, previewHtml])

  if (!mine || mine.status === 'pending') {
    return <StatusScreen title="Waiting for approval…" body="Leave this tab open." />
  }
  if (mine.status === 'denied' || leftManually) {
    // 'denied' covers both an explicit deny AND the host ending the session
    // (NoteCollabPanel's rotateKey ends the session outright rather than
    // trying to notify each guest individually) — same screen for both,
    // same as a guest leaving on their own. Snapshot BEFORE disconnecting
    // so the download offer reflects the last content this guest actually
    // saw, not whatever state the doc happens to settle into afterward
    // (disconnecting kills the network connection, not the in-memory
    // Y.Doc, so reading it here is still safe/correct either way — this
    // ordering is about intent, not a correctness requirement).
    //
    // BUG FIXED HERE ("edits are trashed on session end"): for an editor
    // guest, this used to read `peer.ytext` — the NETWORK doc, which only
    // contains whatever the host has already accepted via useHostRelay.
    // `RelayedEditor` proposes on a 150ms debounce and the host applies it
    // asynchronously over the wire, so anything typed in roughly the last
    // 150ms–1s before the session ended existed ONLY in `draftDoc` and was
    // silently absent from both the host's copy AND this "keep a copy"
    // safety net — the one place §14.5 promised nothing would be lost.
    // `draftDoc` always has it (every keystroke lands there first, locally,
    // synchronously), so an editor guest's snapshot now reads from there.
    // A viewer guest never has unsent local edits (nothing they type is
    // ever applied), so `peer.ytext` is still correct for them.
    const noteText = relayed ? draftDoc.getText('codemirror').toString() : peer.ytext.toString()
    const assetBytes = Object.fromEntries(peer.doc.getMap('assets').entries())
    peer.disconnect()
    return (
      <SessionEndScreen
        noteText={noteText}
        assets={assetBytes}
        reason={leftManually ? 'You left the session' : "The host ended this session"}
      />
    )
  }

  const readOnly = mine.role === 'viewer'
  const connectedCount = Object.values(access.entries).filter(e => e.status === 'approved').length

  return (
    <div className="gm-vh nb-root" style={{ display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--bg)' }}>
      {/* `nb-root` — scopes the ported widget CSS (guest.css's own copy of
          NotebookView.jsx's `CSS` block, PLAN_CONCURRENCY.md §18.6 "Phase D"),
          which every `.cm-*` widget class selector is written against. */}
      {/* Top-right toolbar — search, preview toggle, theme, participants.
          Wraps on narrow (mobile) widths instead of overflowing off-screen
          (`flexWrap` + a `maxWidth` that yields to the viewport). */}
      {/* `pointerEvents: 'none'` on the wrapper + `'auto'` back on each
          button — this row spans the FULL width (`left:14, right:14`, not
          just as wide as its buttons) so it can right-align and still wrap
          on narrow screens. Without the override, that full-width box
          would swallow every click/hover on the editor's first line
          underneath it, even in the empty space left of the buttons —
          caught live while testing the new remote-cursor hover (§19):
          hovering the note's own first line silently never reached the
          editor at all. */}
      <div style={{ position: 'absolute', top: 14, right: 14, left: 14, zIndex: 20, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', pointerEvents: 'none' }}>
        {mode !== 'preview' && (
          <IconButton onClick={() => view && openSearchPanel(view)} title="Find (⌘F)">
            <SearchIcon />
          </IconButton>
        )}
        <IconButton
          onClick={() => setMode(m => (m === 'live' ? 'source' : m === 'source' ? 'preview' : 'live'))}
          title={mode === 'live' ? 'Source' : mode === 'source' ? 'Preview' : 'Live'}
        >
          {mode === 'live' ? <QuillIcon /> : mode === 'source' ? <PencilIcon /> : <EyeIcon />}
        </IconButton>
        <IconButton onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))} title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}>
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </IconButton>
        <IconButton onClick={() => setUsersOpen(o => !o)} title="Live participants" badge={connectedCount} active={usersOpen}>
          <UsersIcon />
        </IconButton>
      </div>
      {usersOpen && (
        <UsersModal
          entries={access.entries}
          userStates={userStates}
          myId={peer.awareness?.clientID}
          onClose={() => setUsersOpen(false)}
          onLeave={() => { setUsersOpen(false); setLeftManually(true) }}
        />
      )}

      {mode === 'preview' ? (
        // Real renderer now (PLAN_CONCURRENCY.md §18.7 "Phase E") — same
        // `inlineToHtml`/`renderMarkdown` NotebookView.jsx's own PDF export
        // uses, not the compact stand-in `renderMarkdown.js` was always
        // meant to be replaced by (see that file's own header). `notebooks`/
        // `library`/`sketchbooks`/`flashcardDecks` all `[]`, `notebookDir`
        // null, `assets` for the room's asset-map image fallback (§18.4),
        // `hasVault: false` so wikilinks render the same honest "not
        // available" state Live mode already does (§18.5) instead of a
        // false "click to create."
        <div ref={previewRef} className="gm-prose" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
          dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : relayed ? (
        <RelayedEditor peer={peer} draftDoc={draftDoc} assets={assets} mode={mode} onView={setView} />
      ) : (
        <Editor ytext={peer.ytext} awareness={peer.awareness} readOnly={readOnly} assets={assets} mode={mode} onView={setView} />
      )}
    </div>
  )
}

export default function GuestApp() {
  const { room, key } = useRoomFromPath()
  const [identity, setIdentity] = useState(null) // { name, color, icon }

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return <StatusScreen title="Needs a secure connection" body="Open this link with https://, not http://." />
  }

  if (!room || !key) {
    return <StatusScreen title="This link looks incomplete" body="Ask for the full link." />
  }

  if (!identity) return <JoinScreen onJoin={(name, color, icon) => setIdentity({ name, color, icon })} />

  return <GuestSession room={room} roomKey={key} name={identity.name} color={identity.color} icon={identity.icon} />
}
