// Minimal CM6 bindings for the collab engine (engine.js) — extracted from
// src/dev/YjsRelayHarness.jsx. Deliberately plain (no Gnos widgets/decorations
// — no mermaid, no wikilink resolution, markdown syntax highlighting only)
// with ONE exception: images, via the optional `assets` prop → assetsPlugin.js
// (PLAN_CONCURRENCY.md §7's "asset problem"). This is what the standalone web
// guest client (§7) uses wholesale, and what the harness still uses.
// NotebookView.jsx's own host editor is NOT this component — it binds
// `canonicalText` into Gnos's real, full-featured CM6 setup instead (all the
// widgets/decorations from makeLivePlugin), so hosts keep the full editing
// experience; only guests (who never had that experience to begin with) get
// this slim pair.
import { useEffect, useRef, useState, useMemo } from 'react'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { yCollab } from 'y-codemirror.next'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import * as buffer from 'lib0/buffer'
import { RESEED_ORIGIN } from './engine'
import { collabAssetsFacet, collabImagePlugin } from './assetsPlugin'

/** Same shape as a real notebook's own editor container
 * (src/views/NotebookView.jsx's `.nb-cm`/`.nb-content` CSS: no line-number
 * gutter, a centered prose column, generous line-height) — values copied
 * from its `--nb-max`/`--nb-px`/`--nb-py`/`--nb-lh` tokens. Font-family is
 * NOT copied (`'Stack Sans Text', 'Switzer', 'Satoshi'`) — those files are
 * the self-hosted webfont set this page deliberately never loads (see
 * guest.css); falling through to the system stack keeps the same rhythm
 * without the weight. `lineNumbers()` is dropped entirely — the real
 * notebook editor never had one either, it's a proof-rig affordance this
 * component doesn't need to keep. */
function notebookTheme() {
  return EditorView.theme({
    '&': { height: '100%', fontSize: '15px' },
    '.cm-scroller': { fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'auto', padding: '28px 0 40vh' },
    '.cm-content': { maxWidth: '780px', margin: '0 auto', padding: '0 48px', boxSizing: 'border-box', lineHeight: '1.8' },
    '.cm-line': { padding: 0 },
  })
}

/** Takes `ytext`/`awareness` directly rather than a `peer` object — this is
 *  what lets the same component serve two different docs: the network-bound
 *  `netDoc` (viewer guests, read-only) and the host's private `canonicalDoc`
 *  (see `useCanonicalDoc` in engine.js). Sharing `awareness` across two
 *  different Y.Docs is safe even though it's the "wrong" doc for whichever
 *  side receives it — yCollab's cursor field is a relative-position blob
 *  resolved against a specific doc; a recipient bound to a different doc
 *  just can't resolve it and skips rendering that cursor, no crash, no
 *  corruption. */
export function Editor({ ytext, awareness, readOnly, assets }) {
  const hostRef = useRef(null)
  useEffect(() => {
    if (!awareness) return // awareness arrives one tick after mount — see usePeer
    const undoManager = new Y.UndoManager(ytext)
    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          yCollab(ytext, awareness, { undoManager }),
          // `assets` (see assetsPlugin.js) is optional — omitted entirely
          // for e.g. the harness's own throwaway proof room, which never
          // has an asset map to look anything up in.
          ...(assets ? [collabAssetsFacet.of(assets), collabImagePlugin()] : []),
          notebookTheme(),
        ],
      }),
      parent: hostRef.current,
    })
    return () => { view.destroy(); undoManager.destroy() }
    // readOnly changing (a role flip mid-session) is the one case that
    // deliberately remounts — rare enough that losing local cursor position
    // is an acceptable trade for not hand-rolling a reconfigure.
  }, [ytext, awareness, readOnly, assets])
  return <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
}

/** Editor guests only. CM6 binds to a local-only `draftDoc` — never bound
 *  to `WebrtcProvider`, so nothing typed here can auto-broadcast into the
 *  mesh (that's the whole point; see engine.js's `useCanonicalDoc` for what
 *  this does and doesn't close). `draftDoc` is kept mirrored to the
 *  canonical doc on every remote change, and every local edit is proposed
 *  to the host over awareness for `useHostRelay` to accept or drop. No
 *  shared awareness/cursors here — draftDoc's positions don't correspond to
 *  the canonical doc's, so cross-peer cursor rendering would be
 *  meaningless; an editor guest sees their own typing and the merged
 *  result once the host applies it, just not live remote cursors while
 *  they're mid-edit. Acceptable trade, not a fix that was owed here — full
 *  presence would want a proper reconciliation, not this. */
export function RelayedEditor({ peer, assets }) {
  const hostRef = useRef(null)
  const [draftDoc] = useState(() => new Y.Doc())
  const draftText = useMemo(() => draftDoc.getText('codemirror'), [draftDoc])
  const [localAwareness] = useState(() => new awarenessProtocol.Awareness(draftDoc))

  // Mirror canonical → draft on every remote change, by IMPORTING the
  // canonical doc's real CRDT state (`Y.applyUpdate`), not by re-typing its
  // text as brand-new local ops. This bit exactly once, the hard way: a
  // delete-all-then-insert reseed gives the imported text new item IDs
  // under draftDoc's own client — so a later keystroke's delta, encoded as
  // "insert after item X", names an item host's canonical doc never
  // received (only the post-seed delta gets sent — see the propose effect
  // below). `Y.applyUpdate` doesn't error on a missing dependency, it just
  // buffers the op into `pendingStructs` and never integrates it — no
  // exception, no console warning, text silently never arrives. Importing
  // the real state instead means later local inserts anchor to items the
  // host already has, so every delta this guest proposes is
  // dependency-complete.
  useEffect(() => {
    const importFromCanonical = () => { Y.applyUpdate(draftDoc, Y.encodeStateAsUpdate(peer.doc), RESEED_ORIGIN) }
    importFromCanonical()
    peer.ytext.observe(importFromCanonical)
    return () => peer.ytext.unobserve(importFromCanonical)
  }, [peer.doc, peer.ytext, draftDoc])

  // Propose local edits to the host, debounced so a burst of keystrokes
  // becomes one small update instead of one awareness write per key.
  useEffect(() => {
    let lastSentSV = Y.encodeStateVector(draftDoc)
    let seq = 0
    let timer = null
    const flush = () => {
      const update = Y.encodeStateAsUpdate(draftDoc, lastSentSV)
      if (update.length <= 2) return // nothing new since the last proposal
      lastSentSV = Y.encodeStateVector(draftDoc)
      seq += 1
      peer.awareness.setLocalStateField('proposedOp', { bytes: buffer.toBase64(update), seq })
    }
    const onUpdate = (_update, origin) => {
      if (origin === RESEED_ORIGIN) return // host's content, not a local edit — don't propose our own mirror back
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 150)
    }
    draftDoc.on('update', onUpdate)
    return () => { draftDoc.off('update', onUpdate); if (timer) clearTimeout(timer) }
  }, [draftDoc, peer.awareness])

  useEffect(() => {
    const undoManager = new Y.UndoManager(draftText)
    const view = new EditorView({
      state: EditorState.create({
        doc: draftText.toString(),
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          yCollab(draftText, localAwareness, { undoManager }),
          // Assets always live on the NETWORK doc (peer.doc), never
          // draftDoc — an editor guest's local scratch doc has no maps of
          // its own to look anything up in. Same optional-omit rule as
          // Editor above.
          ...(assets ? [collabAssetsFacet.of(assets), collabImagePlugin()] : []),
          notebookTheme(),
        ],
      }),
      parent: hostRef.current,
    })
    return () => { view.destroy(); undoManager.destroy() }
  }, [draftDoc, draftText, localAwareness, assets])

  return <div ref={hostRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
}
