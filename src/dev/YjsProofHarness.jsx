/* YjsProofHarness — PLAN_CONCURRENCY.md §6 step 6 proof rig.
 *
 * STANDALONE, NOT WIRED INTO PRODUCTION. No notebook, no storage.js, no
 * makeLivePlugin. Two independent CM6 panes, each bound to its OWN Y.Doc +
 * Awareness (not a shared object reference — that would prove nothing about
 * the actual sync protocol). The two docs are connected by a same-tab
 * "loopback relay": a plain function call that forwards Yjs update bytes and
 * awareness update bytes both ways. That loopback is deliberately the exact
 * shape a real transport (step 7 — y-webrtc / y-websocket) will fill later:
 * swap the function body for a socket send/receive and nothing else here
 * changes. Proves: (1) yCollab binds cleanly to CM6, (2) encodeStateAsUpdate /
 * applyUpdate round-trips correctly, (3) concurrent edits converge with no
 * conflict UI, (4) awareness carries presence (name/color/cursor) across.
 *
 * Mount: App.jsx checks `?yjsProof=1` before any hooks run and renders this
 * instead of the real app. Remove that guard + this file to fully retire the
 * rig once step 6 is done and step 7 (real relay) begins.
 */
import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { yCollab } from 'y-codemirror.next'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'

const SEED = `# Yjs proof rig

Type here. Then type in the other pane. Both converge — no merge dialog,
no "theirs wins", no history entry. That's the whole point of a CRDT vs
Stage 1's silent-merge-with-safety-net: there is nothing to reconcile
because both sides already agree by construction.

Try:
- Typing in both panes at once, same word.
- Selecting text in one pane — the other pane's peer cursor label should show.
`

function makePeer(label, color) {
  const doc = new Y.Doc()
  const ytext = doc.getText('codemirror')
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalStateField('user', { name: label, color, colorLight: color + '33' })
  return { doc, ytext, awareness }
}

/** Wires two peers together with a direct function-call "relay" — the same
 *  shape a real transport occupies, just without a network in between.
 *
 *  Only forwards LIVE updates from here on — it does not exchange prior
 *  state, which is deliberate: it surfaced a real bug while building this
 *  rig. Seeding both peers independently with the same string *before*
 *  wiring gave them two unrelated op histories that only coincidentally
 *  rendered the same text; A's later edits then referenced CRDT neighbors
 *  (its own SEED-insertion ops) that B had never received, so they sat in
 *  B's `pendingStructs` forever — no error, just a permanent silent stall.
 *  Fix: wire first, seed exactly once, from one side only, after listeners
 *  exist (see `YjsProofHarness`). A real provider (step 7) instead needs an
 *  explicit state-vector exchange on connect (`encodeStateVector` /
 *  `encodeStateAsUpdate` diff) so a peer joining an *already-running*
 *  session catches up on history that predates its own connection — this
 *  loopback sidesteps that only because both peers exist before either has
 *  any content. Worth remembering for the real relay: forwarding deltas
 *  alone is not sync; a joiner needs the backlog too. */
function loopback(a, b) {
  const onDocA = (update, origin) => { if (origin !== 'loopback') Y.applyUpdate(b.doc, update, 'loopback') }
  const onDocB = (update, origin) => { if (origin !== 'loopback') Y.applyUpdate(a.doc, update, 'loopback') }
  a.doc.on('update', onDocA)
  b.doc.on('update', onDocB)

  const onAwA = ({ added, updated, removed }) => {
    const changed = added.concat(updated, removed)
    const update = awarenessProtocol.encodeAwarenessUpdate(a.awareness, changed)
    awarenessProtocol.applyAwarenessUpdate(b.awareness, update, 'loopback')
  }
  const onAwB = ({ added, updated, removed }) => {
    const changed = added.concat(updated, removed)
    const update = awarenessProtocol.encodeAwarenessUpdate(b.awareness, changed)
    awarenessProtocol.applyAwarenessUpdate(a.awareness, update, 'loopback')
  }
  a.awareness.on('change', onAwA)
  b.awareness.on('change', onAwB)

  return () => {
    a.doc.off('update', onDocA); b.doc.off('update', onDocB)
    a.awareness.off('change', onAwA); b.awareness.off('change', onAwB)
  }
}

function Pane({ peer, label }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)

  useEffect(() => {
    const undoManager = new Y.UndoManager(peer.ytext)
    const state = EditorState.create({
      doc: peer.ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown(),
        yCollab(peer.ytext, peer.awareness, { undoManager }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, monospace', overflow: 'auto' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => { view.destroy(); undoManager.destroy() }
  }, [peer])

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: '1px solid #3336', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600, background: '#8882', borderBottom: '1px solid #3336' }}>{label}</div>
      <div ref={hostRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  )
}

export default function YjsProofHarness() {
  const [peers] = useState(() => {
    const a = makePeer('Pane A', '#3b82f6')
    const b = makePeer('Pane B', '#ec4899')
    return { a, b }
  })
  const [converged, setConverged] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const unwire = loopback(peers.a, peers.b)
    // Seed exactly once, from one side, AFTER wiring — see the comment on
    // `loopback` for why seeding both sides independently is the bug.
    // Guarded against StrictMode's dev-only mount→cleanup→mount so it can't
    // double-insert.
    if (peers.a.ytext.length === 0) peers.a.ytext.insert(0, SEED)
    return unwire
  }, [peers])

  useEffect(() => {
    const check = () => {
      setConverged(peers.a.ytext.toString() === peers.b.ytext.toString())
      setTick(t => t + 1)
    }
    const iv = setInterval(check, 400)
    return () => clearInterval(iv)
  }, [peers])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 16, boxSizing: 'border-box', gap: 10, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <strong>Yjs ↔ CM6 proof rig</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>PLAN_CONCURRENCY.md §6 step 6 — local loopback, no network, not wired to production</span>
        <span style={{
          marginLeft: 'auto', fontSize: 12, padding: '2px 10px', borderRadius: 999,
          background: converged ? '#16a34a22' : '#dc262622',
          color: converged ? '#16a34a' : '#dc2626',
          border: `1px solid ${converged ? '#16a34a55' : '#dc262655'}`,
        }}>
          {converged ? '✓ converged' : '⋯ diverged (transient)'} · check #{tick}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <Pane peer={peers.a} label="Pane A" />
        <Pane peer={peers.b} label="Pane B" />
      </div>
    </div>
  )
}
