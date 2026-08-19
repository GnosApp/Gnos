// Collab engine — extracted from src/dev/YjsRelayHarness.jsx (PLAN_CONCURRENCY.md
// §6 steps 7–9) once its mechanics were verified live, so both NotebookView.jsx
// (host, desktop) and the web guest client (PLAN_CONCURRENCY.md §7) share the
// exact same, already-tested logic instead of two divergent copies. This file
// has NO editor/CM6 code in it on purpose — see CollabEditor.jsx for that half.
// The harness (src/dev/YjsRelayHarness.jsx) now imports from here too; nothing
// about its own behavior changed, only where the code lives.
//
// Read src/dev/YjsRelayHarness.jsx's own header comment for the full history —
// the seeding-race bug (§6.1) recurring twice more via different routes (§6.4,
// §6.5), the y-webrtc origin-attribution limitation that's *why* proposals go
// over `awareness` instead of a doc update listener, and the residual gap this
// canonicalDoc/netDoc split closes vs. what it still leaves open (per-guest
// star-topology rooms, not built).
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { WebrtcProvider } from 'y-webrtc'
import * as buffer from 'lib0/buffer'

export const DEFAULT_SIGNALING = 'wss://y-webrtc-eu.fly.dev'

// Tag used on the one `draftDoc.transact(..., RESEED_ORIGIN)` call that
// mirrors canonical content into an editor guest's local draft — lets that
// draft's own 'update' listener tell "host just pushed a new accepted
// version" apart from "the guest just typed something", without needing to
// touch y-webrtc/yCollab internals at all. Exported because CollabEditor.jsx's
// `RelayedEditor` needs to tag its own reseed the same way.
export const RESEED_ORIGIN = 'gnos-reseed'

/** One participant's connection: a network-bound `doc`/`ytext` (the
 *  *broadcast* copy — see `useCanonicalDoc` for why this is never the doc
 *  anyone should treat as authoritative), the shared `access` Y.Map, and
 *  presence/status. `signaling` defaults to the public community server;
 *  pass an array of your own for anything that isn't a quick proof. */
export function usePeer(room, key, isHost, label, color, { signaling } = {}) {
  // doc/ytext are safe to keep stable across remounts — nothing in their
  // own lifecycle mutates shared state on cleanup.
  const [doc] = useState(() => new Y.Doc())
  const ytext = useMemo(() => doc.getText('codemirror'), [doc])
  const accessMap = useMemo(() => doc.getMap('access'), [doc])
  // awareness is NOT stable across remounts — see the comment in the
  // effect below for why sharing one across two provider instances is
  // actively unsafe with this library, not just redundant.
  const [awareness, setAwareness] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [peerCount, setPeerCount] = useState(0)
  const providerRef = useRef(null)

  useEffect(() => {
    // Scope a FRESH Awareness to this exact provider instance rather than
    // reusing one across remounts. Real bug this fixes: `WebrtcProvider`'s
    // room is created ASYNCHRONOUSLY (key derivation is a PBKDF2 promise),
    // so `Room.disconnect()` — which calls
    // `removeAwarenessStates(awareness, [clientID])` — can fire well after
    // a *later* mount already set local state, if it belongs to a shared
    // awareness object. React 18 dev StrictMode's mount→cleanup→mount
    // makes this concrete: mount1's provider finishes its async room
    // creation late, sees it was already told to disconnect, and wipes
    // whatever awareness object it was given — even after mount2 (the
    // provider that's actually still live) already set that same object's
    // local state. Scoping awareness 1:1 with its provider means mount1's
    // delayed cleanup only ever touches its own, already-discarded object.
    const aw = new awarenessProtocol.Awareness(doc)
    aw.setLocalStateField('user', { name: label, color, colorLight: color + '33' })

    const provider = new WebrtcProvider(room, doc, {
      password: key,
      awareness: aw,
      signaling: signaling || [DEFAULT_SIGNALING],
    })
    providerRef.current = provider
    if (typeof window !== 'undefined') window.__gnosCollabDebug = provider
    setAwareness(aw)

    // Host writes its own row straight to 'approved'; a guest starts
    // 'pending' and can only ever be flipped by the host (see
    // useAccessControl.approve/deny below — guests never write anyone's
    // status but their own initial pending row).
    const myKey = String(aw.clientID)
    if (!accessMap.get(myKey)) {
      accessMap.set(myKey, isHost
        ? { name: label, role: 'host', status: 'approved', ts: Date.now() }
        : { name: label, role: 'pending', status: 'pending', ts: Date.now() })
    }

    const onStatus = ({ connected }) => setStatus(connected ? 'connected' : 'connecting')
    const onPeers = () => setPeerCount(Math.max(0, aw.getStates().size - 1)) // exclude self
    provider.on('status', onStatus)
    aw.on('change', onPeers)
    onPeers()

    // No seeding here — `doc`/`ytext` (this hook's return value) is purely
    // the network-bound *broadcast* copy, never written to directly by
    // anyone. Initial content is seeded into the host's private
    // `canonicalDoc` by `useCanonicalDoc` and arrives here via its mirror —
    // see that hook's comment for why moving seeding off a network-shared
    // doc entirely also makes the seeding-race class of bug structurally
    // impossible here, not just handled.

    return () => { provider.destroy(); providerRef.current = null }
  }, [room, key, doc, ytext, accessMap, isHost, label, color, signaling])

  const disconnect = useCallback(() => { providerRef.current?.destroy(); providerRef.current = null }, [])

  return { doc, ytext, accessMap, awareness, status, peerCount, disconnect }
}

/** Shared `access` Y.Map: `{ [clientId]: { name, role, status, ts } }`.
 *  `role` is 'host' | 'editor' | 'viewer' | 'pending'. `status` is
 *  'pending' | 'approved' | 'denied'. Only the host is expected to move
 *  anyone else's row — enforced by convention here, not a real
 *  access-control boundary (anyone with devtools could write their own row
 *  directly). Real enforcement of *who gets approved at all* would need
 *  signed capability tokens; what's cryptographically real today is
 *  narrower and separate: `useCanonicalDoc`/`useHostRelay` ensure that
 *  even a self-approved or role-lying row's writes can't reach the
 *  document that's actually authoritative. */
export function useAccessControl(accessMap, myClientId) {
  const [entries, setEntries] = useState({})
  useEffect(() => {
    if (!accessMap) return
    const onChange = () => setEntries(Object.fromEntries(accessMap.entries()))
    accessMap.observe(onChange)
    onChange()
    return () => accessMap.unobserve(onChange)
  }, [accessMap])

  const approve = useCallback((id, role) => {
    const cur = accessMap.get(id)
    if (cur) accessMap.set(id, { ...cur, role, status: 'approved' })
  }, [accessMap])
  const deny = useCallback((id) => {
    const cur = accessMap.get(id)
    if (cur) accessMap.set(id, { ...cur, status: 'denied' })
  }, [accessMap])

  const mine = myClientId != null ? entries[String(myClientId)] : undefined
  return { entries, mine, approve, deny }
}

/** Host-only. `canonicalDoc` is the actual source of truth, and — this is
 *  the whole point — it is NEVER bound to `WebrtcProvider`. Nothing on the
 *  network can reach it directly, not even the host's own transport code;
 *  the only way content gets into it is the host's own local typing (bind
 *  your real editor to `canonicalText`, see CollabEditor.jsx or wire your
 *  own) or `useHostRelay`'s role-checked `Y.applyUpdate` for accepted guest
 *  proposals. `netDoc` (the network-bound doc everyone, including guests,
 *  connects to) is downstream of this: every change here mirrors OUT to it
 *  one-way, full-state, so guests keep seeing accepted content exactly as
 *  before with zero changes needed on their side.
 *
 *  This is what closes the residual gap an earlier pass of this design
 *  left open: previously "canonical" WAS the network-bound doc, so any
 *  peer's direct write to their own reference reached it. Now a rogue
 *  write to `netDoc` reaches only `netDoc` — it can pollute what OTHER
 *  GUESTS see (a real but strictly smaller concern — closing it needs
 *  per-guest star-topology rooms, not done), but it can never reach
 *  `canonicalDoc`, because nothing inbound is ever wired to touch it.
 *  Verified live (not just reasoned about) in PLAN_CONCURRENCY.md §6.5: a
 *  simulated hostile guest writing straight to `netDoc` via devtools landed
 *  on every peer's `netDoc` but never appeared in what the host's own
 *  editor renders.
 *
 *  `seedText` is inserted once, only if `canonicalDoc` is empty — pass the
 *  real note's current content when wiring this into NotebookView; pass a
 *  placeholder for a throwaway proof room. Seeding here (a doc private to
 *  one process) has no second writer to race against, so the "two docs
 *  seeded independently, only one wins silently" bug class this design has
 *  hit twice before (via two different routes) is structurally impossible
 *  here — no setTimeout-and-hope needed. */
export function useCanonicalDoc(isHost, netDoc, seedText = '') {
  const [canonicalDoc] = useState(() => new Y.Doc())
  const canonicalText = useMemo(() => canonicalDoc.getText('codemirror'), [canonicalDoc])

  useEffect(() => {
    if (!isHost || !netDoc) return
    if (canonicalText.length === 0 && seedText) {
      canonicalDoc.transact(() => { canonicalText.insert(0, seedText) }, 'seed')
    }

    const mirror = () => { Y.applyUpdate(netDoc, Y.encodeStateAsUpdate(canonicalDoc), 'host-mirror') }
    canonicalDoc.on('update', mirror)
    mirror() // push the seed out immediately, don't wait for a second edit
    return () => canonicalDoc.off('update', mirror)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seedText only
    // matters at first-ever seed; re-running this on every seedText render
    // would re-seed a doc guests have already started editing.
  }, [isHost, netDoc, canonicalDoc, canonicalText])

  return { canonicalDoc, canonicalText }
}

/** Host-only. The single place `Y.applyUpdate` is ever called on the
 *  canonical doc for content that didn't originate locally on the host's
 *  own machine — i.e. this function body *is* "host mediates every write"
 *  for this engine. Reads proposals off `awareness` rather than off a
 *  `doc.on('update', ...)` listener specifically because awareness states
 *  are a `Map<clientID, state>` — the sender is structurally part of the
 *  data. A Y.Doc update event's `origin` is not: y-webrtc hands every
 *  remote update the same `origin` (the shared `Room` instance) regardless
 *  of which peer sent it, so there is no way to ask "did *this specific*
 *  guest write this" from inside a `doc.on('update', ...)` handler at all
 *  — confirmed by reading `readSyncMessage(decoder, encoder, doc, room)`
 *  in y-webrtc's own source, `room` is the only thing passed as origin.
 *  That's *why* proposals are relayed over awareness instead of just
 *  binding guests to the canonical doc and filtering on the way in. */
export function useHostRelay(isHost, doc, awareness, accessMap) {
  const appliedSeq = useRef({})
  useEffect(() => {
    if (!isHost || !awareness || !doc) return
    const onChange = () => {
      awareness.getStates().forEach((state, clientId) => {
        const op = state?.proposedOp
        if (!op) return
        const key = String(clientId)
        if ((appliedSeq.current[key] || 0) >= op.seq) return
        appliedSeq.current[key] = op.seq // mark seen either way — don't re-evaluate a rejected seq every awareness tick
        const entry = accessMap.get(key)
        if (!entry || entry.role !== 'editor') return // pending/viewer/denied — dropped, never reaches the canonical doc
        try {
          Y.applyUpdate(doc, buffer.fromBase64(op.bytes), 'guest-relay')
        } catch { /* malformed proposal from a misbehaving client — drop, don't crash the host's session */ }
      })
    }
    awareness.on('change', onChange)
    onChange()
    return () => awareness.off('change', onChange)
  }, [isHost, doc, awareness, accessMap])
}
