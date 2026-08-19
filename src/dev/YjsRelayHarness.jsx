/* YjsRelayHarness — PLAN_CONCURRENCY.md §6 steps 7 + 8 + 9 proof rig.
 *
 * STANDALONE, NOT WIRED INTO PRODUCTION — same rule as YjsProofHarness
 * (step 6). The actual collab mechanics this rig proved (transport,
 * approval, roles, host-mediated canonical-doc split) now live in
 * src/lib/collab/ — engine.js (Yjs/y-webrtc hooks) and CollabEditor.jsx
 * (the plain CM6 pair). This file is now UI wiring + a URL-based room/key
 * scheme + the join/approval screens on top of that shared engine, kept
 * here because it's still a useful two-tab proof and nothing about its
 * behavior needed to change when the engine moved out. See src/lib/collab/
 * for the full history: the transport (§6.2), the seeding-race bug
 * recurring via two different routes (§6.1, §6.4/§6.5), the y-webrtc
 * origin-attribution limitation that's why proposals go over `awareness`
 * (engine.js's `useHostRelay`), and the canonicalDoc/netDoc split that
 * closes the "guest writes straight to the shared doc" gap (§6.5) while
 * leaving per-guest star-topology rooms as a real, separate, still-open
 * item (guests can still confuse each other's view, never the source of
 * truth).
 *
 * Who is "host"? Whoever's browser minted the room (no room/key yet in the
 * URL) is host, recorded in sessionStorage keyed by room id so a host's own
 * reload still renders the host panel. Opening a link that already has
 * room+key makes you a guest. This is a proof-rig shortcut, not a security
 * boundary — sessionStorage is trivially spoofable by anyone with devtools.
 * Real host authority in production would need the host's own signed
 * identity, not "whoever's tab remembers minting it."
 *
 * Still open (unchanged from before the engine extraction):
 *   - No fallback WS relay when P2P/STUN fails (§8) — our own deployment,
 *     an ops decision, not code written yet.
 *   - No production-grade default signaling server (the public free one
 *     has been observed going down mid-session).
 *   - No "host ends session, room dies" lifecycle (§13) — rotating the key
 *     kicks everyone off the *authoritative* room, but peers who already
 *     have the CRDT state can still talk to each other P2P until they
 *     individually navigate away.
 *   - No guest "keep a copy" download prompt on disconnect/deny (§14.5).
 *   - Guests can still confuse *each other's* view via the network-bound
 *     doc (never the source of truth, see src/lib/collab/engine.js) —
 *     closing that fully needs per-guest star-topology rooms.
 *
 * Mount: App.jsx checks `?yjsRelay=1` before any hooks run.
 */
import { useCallback, useMemo, useState } from 'react'
import { randomKey, randomRoomId, PALETTE } from '@/lib/collab/ids'
import { usePeer, useAccessControl, useCanonicalDoc, useHostRelay } from '@/lib/collab/engine'
import { Editor, RelayedEditor } from '@/lib/collab/CollabEditor'

const SEED = `# Yjs relay rig (real transport, host approval + roles)

The host approves each joiner and assigns a role before they see this text.
Open the "copy link" URL in a second tab/browser/device to try the guest
side — you'll land in a waiting room until the host (the other tab) clicks
Approve.
`

/** Read room + key from the current URL, or mint fresh ones and push them
 *  into history so the address bar shows a shareable link. Room id in the
 *  query string (opaque, fine to be visible); key in the fragment (secret,
 *  never sent to any server). Also decides host-vs-guest (see file header)
 *  and, when minting, records that decision in sessionStorage so a host's
 *  own reload doesn't demote them to a pending guest of their own room.
 *  This URL-carries-the-link scheme is specific to this standalone rig —
 *  NotebookView.jsx's host wiring generates room/key directly (a Share
 *  button, not a URL to load) and doesn't need this hook at all. */
function useRoomFromUrl() {
  const [info] = useState(() => {
    const url = new URL(window.location.href)
    let room = url.searchParams.get('room')
    let key = (url.hash.match(/key=([^&]+)/) || [])[1]
    let isHost
    if (!room || !key) {
      room = room || randomRoomId('gnos-proof')
      key = key || randomKey()
      url.searchParams.set('room', room)
      url.hash = `key=${key}`
      window.history.replaceState(null, '', url.toString())
      isHost = true
      try { sessionStorage.setItem(`gnos-proof-host-${room}`, '1') } catch { /* private browsing etc — fine, worst case demotes to guest */ }
    } else {
      try { isHost = sessionStorage.getItem(`gnos-proof-host-${room}`) === '1' } catch { isHost = false }
    }
    return { room, key, shareUrl: url.toString(), isHost }
  })
  return info
}

/** Host-only: mint a fresh room+key and navigate there. A full page
 *  navigation (not in-place state reset) so every hook/provider/doc tears
 *  down and rebuilds clean — simplest correct way to "kick everyone",
 *  since the old room's key is simply never used by the host again. */
function rotateKey() {
  const room = randomRoomId('gnos-proof')
  const key = randomKey()
  try { sessionStorage.setItem(`gnos-proof-host-${room}`, '1') } catch { /* see useRoomFromUrl */ }
  const url = new URL(window.location.href)
  url.searchParams.set('room', room)
  url.hash = `key=${key}`
  window.location.href = url.toString()
}

function JoinScreen({ isHost, name, setName, onJoin }) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <form
        onSubmit={e => { e.preventDefault(); if (name.trim()) onJoin() }}
        style={{ maxWidth: 360, width: '100%', display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}
      >
        <strong>{isHost ? 'Start hosting this room' : 'Join this room'}</strong>
        <p style={{ opacity: 0.75, fontSize: 13, margin: 0 }}>
          {isHost
            ? 'You created this link. Pick a display name — you\'ll approve anyone else who opens it.'
            : 'The host will need to approve you before you see the document.'}
        </p>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Display name"
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #8884', fontSize: 14 }}
        />
        <button type="submit" disabled={!name.trim()} style={{ padding: '8px 12px', borderRadius: 6, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>
          {isHost ? 'Start hosting' : 'Ask to join'}
        </button>
      </form>
    </div>
  )
}

function StatusScreen({ title, body }) {
  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
      <div style={{ maxWidth: 380 }}>
        <strong>{title}</strong>
        <p style={{ opacity: 0.75, fontSize: 14 }}>{body}</p>
      </div>
    </div>
  )
}

function HostPanel({ entries, myId, approve, deny }) {
  const rows = Object.entries(entries).filter(([id]) => id !== String(myId))
  const pending = rows.filter(([, e]) => e.status === 'pending')
  const others = rows.filter(([, e]) => e.status !== 'pending')

  if (rows.length === 0) return <div style={{ fontSize: 12, opacity: 0.6 }}>No one else has opened the link yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
      {pending.map(([id, e]) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#eab30822', border: '1px solid #eab30855', borderRadius: 6, padding: '4px 8px' }}>
          <span style={{ flex: 1 }}><strong>{e.name}</strong> wants to join</span>
          <button onClick={() => approve(id, 'editor')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>Approve · Editor</button>
          <button onClick={() => approve(id, 'viewer')} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>Approve · Viewer</button>
          <button onClick={() => deny(id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>Deny</button>
        </div>
      ))}
      {others.map(([id, e]) => (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px' }}>
          <span style={{ flex: 1 }}>
            {e.name} — <span style={{ opacity: 0.7 }}>{e.status === 'denied' ? 'denied' : e.role}</span>
          </span>
          {e.status === 'approved' && (
            <>
              <select
                value={e.role}
                onChange={ev => approve(id, ev.target.value)}
                style={{ fontSize: 11 }}
              >
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
              <button onClick={() => deny(id)} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer' }}>Kick</button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function Session({ room, roomKey, shareUrl, isHost, name }) {
  const color = useMemo(() => (isHost ? '#3b82f6' : PALETTE[1 + Math.floor(Math.random() * (PALETTE.length - 1))]), [isHost])
  const peer = usePeer(room, roomKey, isHost, name, color)
  const access = useAccessControl(peer.accessMap, peer.awareness?.clientID)
  const { canonicalDoc, canonicalText } = useCanonicalDoc(isHost, peer.doc, SEED)
  useHostRelay(isHost, canonicalDoc, peer.awareness, peer.accessMap)
  const [copied, setCopied] = useState(false)

  const copyLink = useCallback(() => {
    navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }, [shareUrl])

  // Guest gating — must come after all hooks above run unconditionally.
  if (!isHost) {
    if (!access.mine || access.mine.status === 'pending') {
      return <StatusScreen title="Waiting for host approval…" body={`${name}, the host needs to approve you before you can see this document. Leave this tab open.`} />
    }
    if (access.mine.status === 'denied') {
      // Explicitly drop the connection rather than let it idle — a denied
      // guest has no reason to keep a WebRTC channel open.
      peer.disconnect()
      return <StatusScreen title="Access denied" body="The host didn't approve this session. Ask them for a fresh link." />
    }
  }

  const readOnly = !isHost && access.mine?.role === 'viewer'
  const relayed = !isHost && access.mine?.role === 'editor'

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 16, boxSizing: 'border-box', gap: 10, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong>Yjs relay rig (approval + roles + key rotation)</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>PLAN_CONCURRENCY.md §6 steps 8–9 — engine in src/lib/collab/, not wired to production</span>
        <span style={{
          fontSize: 12, padding: '2px 10px', borderRadius: 999,
          background: peer.status === 'connected' ? '#16a34a22' : '#eab30822',
          color: peer.status === 'connected' ? '#16a34a' : '#a16207',
          border: `1px solid ${peer.status === 'connected' ? '#16a34a55' : '#eab30855'}`,
        }}>
          {peer.status === 'connected' ? `✓ connected · ${peer.peerCount} other peer(s)` : '⋯ connecting to signaling server'}
        </span>
        {readOnly && (
          <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, background: '#6366f122', color: '#6366f1', border: '1px solid #6366f155' }}>
            view only
          </span>
        )}
        {relayed && (
          <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 999, background: '#6366f122', color: '#6366f1', border: '1px solid #6366f155' }}>
            edits relayed via host
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={copyLink} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>
            {copied ? 'copied!' : 'copy shareable link'}
          </button>
          {isHost && (
            <button
              onClick={() => { if (confirm('Rotate the room key? Every current link — including copies you already sent — stops working, and everyone connected is disconnected from the authoritative room.')) rotateKey() }}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', color: '#e11d48', borderColor: '#e11d4855' }}
            >
              rotate key
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, wordBreak: 'break-all' }}>
        room: {room} (opaque, sent to signaling server) · key lives only in the URL fragment, never transmitted
      </div>
      {isHost && (
        <div style={{ border: '1px solid #8884', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Access — you approve every joiner</div>
          <HostPanel entries={access.entries} myId={peer.awareness?.clientID} approve={access.approve} deny={access.deny} />
        </div>
      )}
      {relayed
        ? <RelayedEditor peer={peer} />
        : <Editor ytext={isHost ? canonicalText : peer.ytext} awareness={peer.awareness} readOnly={readOnly} />}
    </div>
  )
}

export default function YjsRelayHarness() {
  const roomInfo = useRoomFromUrl()
  const [name, setName] = useState('')
  const [joined, setJoined] = useState(false)

  // `WebrtcProvider`'s `password` option derives its key via `crypto.subtle`
  // (PBKDF2), which browsers refuse outside a secure context. A raw LAN IP
  // over plain http isn't one (only `localhost`/`127.0.0.1` get the
  // same-machine exemption) — that throws synchronously inside the effect
  // with no error boundary, and React unmounts to a blank page. Surfacing
  // this explicitly beats a silent crash.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <div style={{ maxWidth: 420 }}>
          <strong>Needs a secure context (HTTPS)</strong>
          <p style={{ opacity: 0.8, fontSize: 14 }}>
            This page derives its encryption key with <code>crypto.subtle</code>, which
            browsers disable on plain <code>http://</code> over a LAN IP. Load this over
            <code> https://</code> (a self-signed dev cert is fine — accept the browser's
            warning) or from <code>localhost</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!joined) {
    return <JoinScreen isHost={roomInfo.isHost} name={name} setName={setName} onJoin={() => setJoined(true)} />
  }

  return <Session room={roomInfo.room} roomKey={roomInfo.key} shareUrl={roomInfo.shareUrl} isHost={roomInfo.isHost} name={name} />
}
