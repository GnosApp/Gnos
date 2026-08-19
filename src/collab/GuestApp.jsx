// Web guest client — PLAN_CONCURRENCY.md §7. Loaded from collab.html, always
// the GUEST side (the host is always the desktop app's NoteCollabPanel —
// there is no "start hosting" flow here, unlike src/dev/YjsRelayHarness.jsx
// which proves both sides in one page). Uses src/lib/collab/engine.js and
// CollabEditor.jsx verbatim — the same, already-verified mechanics
// NotebookView.jsx's host side uses, just without the host-only hooks
// (useCanonicalDoc/useHostRelay never run here — a guest never applies
// anyone's writes, it only ever proposes its own).
//
// Deliberately excluded, per §7's table (not partial — not started at all):
//   - Full Gnos rendering fidelity (makeLivePlugin's widgets/decorations,
//     mermaid, wikilink resolution, local image paths). This ships the
//     plain CM6 markdown editor from CollabEditor.jsx — real syntax
//     highlighting, no widgets. Wikilinks/images/mermaid in a shared note
//     render as literal markdown text to a guest today. Closing that gap
//     means extracting makeLivePlugin out of NotebookView.jsx into something
//     this page can import standalone — a real, separate piece of work.
//   - Asset upload (referenced local images collected into the room) — §7's
//     own "asset problem". This page's rendering half is done (assetsPlugin.js,
//     via the `assets` prop below); the host-side collection/publish half
//     lives in src/lib/collab/hostAssets.js, wired from NoteCollabPanel.jsx.
//   - The §14.5 "keep a copy" download prompt — done, see SessionEndScreen
//     below. Markdown-only when the note has no local images (no extra
//     weight); JSZip (already a project dependency, used elsewhere) is
//     lazy-imported only if there are assets to bundle alongside it.
import { useEffect, useMemo, useReducer, useState } from 'react'
import { usePeer, useAccessControl } from '@/lib/collab/engine'
import { Editor, RelayedEditor } from '@/lib/collab/CollabEditor'
import { PALETTE } from '@/lib/collab/ids'
import { renderGuestMarkdown } from './renderMarkdown'

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

function IconButton({ onClick, title, badge, children }) {
  return (
    <button onClick={onClick} title={title} style={{
      position: 'relative', width: 30, height: 30, borderRadius: '50%', flexShrink: 0, padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', cursor: 'pointer',
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
 *  bottom rather than a separate always-visible link in the toolbar. */
function UsersModal({ entries, myId, onClose, onLeave }) {
  const rows = Object.entries(entries).filter(([, e]) => e.status === 'approved')
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1099 }} />
      <div style={{
        position: 'fixed', top: 52, right: 14, zIndex: 1100, width: 220,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,.4)', overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 12px 6px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
          Connected
        </div>
        <div style={{ padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 220, overflowY: 'auto' }}>
          {rows.map(([id, e]) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2eaf7d', flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}{String(id) === String(myId) ? ' (you)' : ''}
              </span>
              <span style={{ fontSize: 10.5, color: 'var(--textDim)' }}>{e.role}</span>
            </div>
          ))}
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
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: 340 }}>
        <Logo />
        {children}
      </div>
    </div>
  )
}

function JoinScreen({ onJoin }) {
  const [name, setName] = useState('')
  return (
    <Centered>
      <form
        onSubmit={e => { e.preventDefault(); if (name.trim()) onJoin(name.trim()) }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <strong style={{ fontSize: 16 }}>Join this note</strong>
        <p style={{ opacity: 0.7, fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          The host will approve you before you can see it.
        </p>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          style={{ padding: '9px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 14 }}
        />
        <button type="submit" disabled={!name.trim()} style={{
          padding: '9px 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff',
          fontSize: 13.5, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'not-allowed', opacity: name.trim() ? 1 : 0.5,
        }}>
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

function GuestSession({ room, roomKey, name }) {
  const color = useMemo(() => PALETTE[1 + Math.floor(Math.random() * (PALETTE.length - 1))], [])
  const peer = usePeer(room, roomKey, false, name, color)
  const access = useAccessControl(peer.accessMap, peer.awareness?.clientID)

  const mine = access.mine
  // Stable identity across renders — `doc.getMap(name)` returns the same
  // Y.Map instance every call, but a fresh `{...}` object literal passed
  // inline as a prop would NOT be, and Editor/RelayedEditor's mount effects
  // depend on this object's identity: a new one every render would remount
  // the CM6 view on every render, not just when the peer/doc actually
  // changes.
  const assets = useMemo(() => ({ assetsMap: peer.doc.getMap('assets'), assetsMetaMap: peer.doc.getMap('assetsMeta') }), [peer.doc])
  // Guest-initiated leave (§14.5: "same prompt if the guest leaves first") —
  // separate from `mine.status === 'denied'` (host-initiated), same
  // end screen either way.
  const [leftManually, setLeftManually] = useState(false)
  const [mode, setMode] = useState('edit') // 'edit' | 'preview' — the quill/eye toolbar toggle
  const [usersOpen, setUsersOpen] = useState(false)
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
    const noteText = peer.ytext.toString()
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
  const relayed = mine.role === 'editor'
  const connectedCount = Object.values(access.entries).filter(e => e.status === 'approved').length

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', background: 'var(--bg)' }}>
      {/* Top-right toolbar — deliberately just these two, nothing else
          (no status text, no role label): matches a real notebook's own
          quiet titlebar economy rather than a proof-rig status bar. */}
      <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 20, display: 'flex', gap: 8 }}>
        <IconButton
          onClick={() => setMode(m => (m === 'edit' ? 'preview' : 'edit'))}
          title={mode === 'edit' ? 'Preview' : 'Back to editing'}
        >
          {mode === 'edit' ? <QuillIcon /> : <EyeIcon />}
        </IconButton>
        <IconButton onClick={() => setUsersOpen(o => !o)} title="Live participants" badge={connectedCount}>
          <UsersIcon />
        </IconButton>
      </div>
      {usersOpen && (
        <UsersModal
          entries={access.entries}
          myId={peer.awareness?.clientID}
          onClose={() => setUsersOpen(false)}
          onLeave={() => { setUsersOpen(false); setLeftManually(true) }}
        />
      )}

      {mode === 'preview' ? (
        <div className="gm-prose" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
          dangerouslySetInnerHTML={{ __html: renderGuestMarkdown(peer.ytext.toString(), assets) }} />
      ) : relayed ? (
        <RelayedEditor peer={peer} assets={assets} />
      ) : (
        <Editor ytext={peer.ytext} awareness={peer.awareness} readOnly={readOnly} assets={assets} />
      )}
    </div>
  )
}

export default function GuestApp() {
  const { room, key } = useRoomFromPath()
  const [name, setName] = useState(null)

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return <StatusScreen title="Needs a secure connection" body="Open this link with https://, not http://." />
  }

  if (!room || !key) {
    return <StatusScreen title="This link looks incomplete" body="Ask for the full link." />
  }

  if (!name) return <JoinScreen onJoin={setName} />

  return <GuestSession room={room} roomKey={key} name={name} />
}
