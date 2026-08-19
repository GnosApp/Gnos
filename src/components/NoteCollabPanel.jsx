// Live Share panel — production wiring of PLAN_CONCURRENCY.md §6 steps 7–9
// into a real note. Reuses src/lib/collab/engine.js verbatim (already proven
// in src/dev/YjsRelayHarness.jsx: transport, approval, roles, key rotation,
// the host-mediated canonicalDoc/netDoc split that keeps a rogue guest write
// from ever reaching the document that's actually saved to disk).
//
// Lazy-loaded (React.lazy from NotebookView.jsx) and only ever mounted while
// `sharing` is true — this is deliberate, not incidental: yjs/y-webrtc pull
// in real weight (simple-peer for WebRTC), and NotebookView.jsx is already a
// heavy, eagerly-loaded chunk. Keeping every collab import behind this one
// lazy boundary means a user who never shares never pays for any of it,
// matching how this same file lazy-loads CodeMirror itself (`loadCM()`).
//
// This component is BOTH the panel UI and the live session — closing the
// panel (`visible=false`) must not kill the connection, so the parent keeps
// this mounted for the whole share, just toggling what's visually shown.
// `onReady(bits)` hands the parent (NotebookView) `{ canonicalText,
// awareness, yCollab }` once available, so NotebookView's own CM6 instance —
// the host's REAL, full-featured editor, not a separate one — can bind to
// it via a Compartment. That binding is what makes this "wired into
// notebooks" rather than a second, disconnected mini-editor: the host just
// keeps using Gnos normally, and guest edits arrive as ordinary CM6
// transactions, which the existing autosave/updateListener pipeline already
// handles — nothing new needed on the save side.
import { useEffect, useMemo, useState } from 'react'
import { X, Copy, Check, RotateCcw, Users } from 'lucide-react'
import { randomKey, randomRoomId, PALETTE } from '@/lib/collab/ids'
import { usePeer, useAccessControl, useCanonicalDoc, useHostRelay } from '@/lib/collab/engine'
import { collectNoteAssets, publishAssets } from '@/lib/collab/hostAssets'

const TITLEBAR_H = 34 // see NotebookView.jsx's own NB_TITLEBAR_H comment — duplicated on purpose, importing back would be circular

/** One participant row — approve-with-role for a pending guest, role switch
 *  + kick for an approved one. Styled to match NotebookHistoryPanel's own
 *  row language (var(--surface)/var(--hover)/var(--textDim)), not the
 *  harness's inline-hex placeholder colors. */
function GuestRow({ id, entry, approve, deny }) {
  const pending = entry.status === 'pending'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8,
      background: pending ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
      border: pending ? '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' : '1px solid transparent',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: entry.status === 'denied' ? 'var(--textDim)' : 'var(--accent)', flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 550, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {entry.name}
      </span>
      {pending ? (
        <>
          <button onClick={() => approve(id, 'editor')} style={btnStyle('var(--accent)', '#fff')}>Editor</button>
          <button onClick={() => approve(id, 'viewer')} style={btnStyle('var(--surfaceAlt)', 'var(--text)')}>Viewer</button>
          <button onClick={() => deny(id)} style={btnStyle('transparent', '#f85149')}>Deny</button>
        </>
      ) : entry.status === 'approved' ? (
        <>
          <select value={entry.role} onChange={e => approve(id, e.target.value)}
            style={{ fontSize: 11, background: 'var(--surfaceAlt)', color: 'var(--text)', border: '1px solid var(--borderSubtle)', borderRadius: 5, padding: '2px 4px' }}>
            <option value="editor">editor</option>
            <option value="viewer">viewer</option>
          </select>
          <button onClick={() => deny(id)} style={btnStyle('transparent', '#f85149')}>Kick</button>
        </>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--textDim)' }}>denied</span>
      )}
    </div>
  )
}

function btnStyle(bg, color) {
  return { padding: '4px 9px', borderRadius: 6, border: 'none', background: bg, color, fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0 }
}

export default function NoteCollabPanel({ notebookId, noteTitle, notebookDir, seedText, visible, onClose, onReady, onGuestCount }) {
  // Room/key minted once per share session (not per note — a fresh session
  // starting later gets a fresh room), never round-tripped through a URL
  // here (unlike the harness): the link is generated for copying, not for
  // this window's own navigation.
  const [{ room, key }] = useState(() => ({ room: randomRoomId('gnos-note'), key: randomKey() }))
  const [name] = useState(() => {
    try { return localStorage.getItem('gnos-collab-name') || 'Host' } catch { return 'Host' }
  })
  // join.getgnos.com is the real, live deploy (PLAN_CONCURRENCY.md §6.11) —
  // its own Cloudflare Workers project, independent of gnos-landing.
  const shareUrl = useMemo(() => `https://join.getgnos.com/join/${room}#key=${key}`, [room, key])

  const peer = usePeer(room, key, true, name, PALETTE[0])
  const access = useAccessControl(peer.accessMap, peer.awareness?.clientID)
  const { canonicalDoc, canonicalText } = useCanonicalDoc(true, peer.doc, seedText)
  useHostRelay(true, canonicalDoc, peer.awareness, peer.accessMap)

  // Asset collection (§7's "asset problem", §10 resolution: option 1 —
  // collect + publish, not inline/degrade). Scans on share start AND on
  // every later change to the canonical text (debounced), so an image the
  // host adds mid-session gets picked up too — not just whatever was there
  // at the moment "Start Live Share" was clicked. `collectNoteAssets`
  // itself no-ops instantly if the note has no local image refs at all, so
  // this costs nothing for the common case of a note with no images.
  useEffect(() => {
    if (!canonicalText || !peer.doc) return
    let cancelled = false
    const scan = () => {
      collectNoteAssets(canonicalText.toString(), notebookDir).then(({ embedded, oversized }) => {
        if (!cancelled) publishAssets(peer.doc, embedded, oversized)
      })
    }
    scan()
    let timer = null
    const onChange = () => { clearTimeout(timer); timer = setTimeout(scan, 1500) }
    canonicalText.observe(onChange)
    return () => { cancelled = true; canonicalText.unobserve(onChange); clearTimeout(timer) }
  }, [canonicalText, peer.doc, notebookDir])

  const [copied, setCopied] = useState(false)
  const copyLink = () => {
    navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  // Hand the live doc/awareness up to NotebookView once ready, along with
  // yCollab itself — loaded here (this component's own lazy chunk) so
  // NotebookView's eager bundle never imports y-codemirror.next directly.
  useEffect(() => {
    if (!canonicalText || !peer.awareness) return
    let gone = false
    import('y-codemirror.next').then(({ yCollab }) => {
      if (!gone) onReady?.({ canonicalText, awareness: peer.awareness, yCollab })
    })
    return () => { gone = true }
  }, [canonicalText, peer.awareness, onReady])

  const guestCount = useMemo(
    () => Object.values(access.entries).filter(e => e.status === 'approved' && e.role !== 'host').length,
    [access.entries]
  )
  useEffect(() => { onGuestCount?.(guestCount) }, [guestCount, onGuestCount])

  const rotateKey = () => {
    if (!confirm('Rotate the room key? The current link — including any copies already sent — stops working, and everyone connected is disconnected.')) return
    // Simplest correct "kick everyone": end this session outright. The
    // caller (NotebookView) re-mounts a fresh NoteCollabPanel with a new
    // room/key on the next "Start Live Share" click — no in-place identity
    // to preserve, unlike the harness's URL-driven room (there's no address
    // bar link here to keep pointing at the old room anyway).
    onClose?.(true)
  }

  if (!visible) return null

  return (
    <>
      <div onClick={() => onClose?.()} style={{ position: 'fixed', inset: 0, zIndex: 1099 }} />
      <aside style={{
        position: 'fixed', right: 8, top: TITLEBAR_H + 6, bottom: 8, width: 340, maxWidth: '92vw', zIndex: 1100,
        background: 'var(--surface)', border: '1px solid var(--borderSubtle)',
        borderRadius: 12, boxShadow: '-8px 0 32px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'nbh-in .18s cubic-bezier(.16,1,.3,1)',
      }}>
        <div style={{ padding: '11px 12px 4px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
            Live Share
          </span>
          <button onClick={() => onClose?.()} title="Close panel (session keeps running)" style={{
            width: 20, height: 20, padding: 0, border: 'none', background: 'none',
            color: 'var(--textDim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ padding: '4px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--textDim)', lineHeight: 1.5 }}>
            Sharing <strong style={{ color: 'var(--text)' }}>{noteTitle || 'this note'}</strong>. Anyone with the link can
            ask to join — approve each person and pick their role below.
          </div>

          <button onClick={copyLink} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--borderSubtle)', background: 'var(--surfaceAlt)', color: 'var(--text)',
            fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left',
          }}>
            {copied ? <Check size={13} strokeWidth={2} color="#2eaf7d" /> : <Copy size={13} strokeWidth={1.8} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: .85 }}>{shareUrl}</span>
            <span style={{ flexShrink: 0, fontWeight: 600 }}>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--textDim)' }}>
            <Users size={12} strokeWidth={1.8} />
            <span>{peer.status === 'connected' ? `${peer.peerCount} connected` : 'connecting…'}</span>
            <span style={{ flex: 1 }} />
            <button onClick={rotateKey} title="Rotate key — ends this session" style={{
              display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#f85149',
              fontSize: 11, cursor: 'pointer', padding: '2px 4px',
            }}>
              <RotateCcw size={11} strokeWidth={2} /> End session
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
            {Object.entries(access.entries)
              .filter(([id]) => id !== String(peer.awareness?.clientID))
              .map(([id, entry]) => <GuestRow key={id} id={id} entry={entry} approve={access.approve} deny={access.deny} />)}
            {Object.keys(access.entries).length <= 1 && (
              <div style={{ fontSize: 11.5, color: 'var(--textDim)', padding: '10px 2px', textAlign: 'center' }}>
                No one has opened the link yet.
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
