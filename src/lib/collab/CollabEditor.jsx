// CM6 bindings for the collab engine (engine.js) — extracted from
// src/dev/YjsRelayHarness.jsx, then extended in place (PLAN_CONCURRENCY.md
// §18.6 "Phase D") to bind Gnos's REAL widget/decoration pipeline
// (makeLivePlugin and everything it depends on, all shared from
// src/lib/notebookEditor.jsx — the same module NotebookView.jsx's own host
// editor uses, no second hand-maintained copy) instead of the plain
// `markdown()`-only setup this file shipped with through Phase C. What a
// guest sees in Live mode is now the same widget zoo the host sees: fold
// arrows, checkboxes, tags, due dates, math, tables, columns, task boards,
// habits, timers, file/web/video link cards — everything makeLivePlugin
// builds. Preview mode (§18.7 "Phase E") swaps `src/collab/renderMarkdown.js`
// (this file's own former deliberately-scoped-down stand-in, now deleted —
// see GuestApp.jsx) for the real `inlineToHtml`/`renderMarkdown` too; Source
// mode (`makeSourcePlugin`, also Phase E) is real now as well, once
// GuestApp.jsx's mode toggle grew a 3rd state to trigger it.
//
// What's still NOT ported, on purpose, not by oversight:
// - Wikilink/embed AUTOCOMPLETE (`makeWikiDropdownPlugin`, the `[[` typing
//   dropdown) — a nice-to-have, not in §18.6's own list, and would need vault
//   data a guest doesn't have anyway (§18.5 already covers the RENDERED
//   unresolved state — `hasVault: false` below — this is only the separate
//   as-you-type suggestion popup).
// - The `/color /font /spacing /size /align /columns` inline-command floating
//   picker (`makeInlineCmdPlugin` + its React dropdown UI) — a real, separate,
//   contained follow-up; typing one of those commands doesn't confirm into a
//   styled span for a guest today, it just sits as plain text. Deliberately
//   scoped out of this pass given everything else already landing here.
//
// `/linkf` (browse-and-link-a-file) is real functionality here, not a
// no-op or a degrade: a guest picks a local file (`<input type=file>`,
// client-side, no server involved) and it's published into the room's asset
// map (guestAssets.js, same `assets`/`assetsMeta` Yjs maps hostAssets.js
// already publishes images into) — a deliberate, asked-for choice (see
// PLAN_CONCURRENCY.md §18.6's own decision log) over the simpler "degrade to
// a no-op" alternative. `/linkw`/`/linkv` still insert working syntax too
// (a `window.prompt()` for the URL — deliberately minimal, no new modal UI
// built for this pass) since neither needs any upload: WebLinkWidget/
// VideoLinkWidget already render a remote URL fine with no vault or Tauri at
// all (confirmed in §18.4/§18.6's own audit of those two widgets).
import { useEffect, useRef, useMemo } from 'react'
import * as Y from 'yjs'
import { yCollab, yRemoteSelections, yRemoteSelectionsTheme } from 'y-codemirror.next'
import { remoteCursorsExt } from './remoteCursors'
import * as CMState from '@codemirror/state'
import * as CMView from '@codemirror/view'
import * as CMLanguage from '@codemirror/language'
import * as CMAutocomplete from '@codemirror/autocomplete'
import * as LezerHighlight from '@lezer/highlight'
import * as LezerMarkdown from '@lezer/markdown'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, dropCursor } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import * as buffer from 'lib0/buffer'
import { RESEED_ORIGIN } from './engine'
import { collabAssetsFacet, collabImagePlugin } from './assetsPlugin'
import { publishGuestAsset } from './guestAssets'
import {
  makeSafeExt, makeTheme, makeHighlight, makeFormatKeys, makeTableCommand, makeLinkCommands,
  makeSmartEnter, makePairInputHandler, makeGhostHintPlugin, makeMathCalcPlugin,
  makeLivePlugin, makeCheckboxHandler, makeStatusHandler, makeHeadingFoldHandler, makeWikiHandler,
  makeMathClickHandler, makeTodoHandler, makeTaskHandler, makeLinkHandler, makeSourcePlugin,
} from '@/lib/notebookEditor'

// Same shape `loadCM()`/QuickNoteView's own mount shim build (a Promise.all
// of dynamic imports, lazy) — built from plain static imports here instead,
// since this whole file already unconditionally needs CM6 to do anything at
// all (editing IS the guest's purpose; there's no "never opens a notebook"
// case to lazy-load past, unlike NotebookView.jsx's own notebook-per-tab
// mount). Every function imported above from notebookEditor.jsx that takes
// `cm` as its first argument was written against exactly this shape.
const cm = {
  state: CMState,
  view: CMView,
  language: CMLanguage,
  autocomplete: CMAutocomplete,
  highlight: LezerHighlight,
}
const gfmExts = LezerMarkdown.GFM
  ? [LezerMarkdown.GFM]
  : [LezerMarkdown.Strikethrough, LezerMarkdown.Table, LezerMarkdown.TaskList].filter(Boolean)

/** `yCollab()` minus its bundled remote-cursor pair — sync + undo-manager
 *  extensions are kept exactly as `yCollab()` builds them (y-codemirror.next
 *  doesn't export those pieces individually, so hand-assembling them would
 *  mean reaching past the package's public API into its internal files);
 *  `yRemoteSelections`/`yRemoteSelectionsTheme` are filtered out by
 *  reference (both are plain exported extension VALUES, safe to compare
 *  against) and replaced by `remoteCursorsExt()` — this file's own icon
 *  + hover-reveal-pill rendering. `src/dev/YjsRelayHarness.jsx` still calls
 *  plain `yCollab()` and keeps the stock look on purpose (proof-rig, not
 *  worth re-theming). */
function yCollabSync(ytext, awareness, opts) {
  return [
    ...yCollab(ytext, awareness, opts).filter(ext => ext !== yRemoteSelections && ext !== yRemoteSelectionsTheme),
    ...(awareness ? remoteCursorsExt(ytext, awareness) : []),
  ]
}

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
// Root cause of "difficulty seeing your own cursor": this editor never
// called `drawSelection()` (@codemirror/view) at all — confirmed live, not
// just read from source: without it, there's no `.cm-cursor` DOM element
// whatsoever, CM6 falls back entirely to the plain native contenteditable
// caret, whose color is browser-default (effectively `currentColor`/black
// depending on engine, NOT this page's accent) and whose width isn't
// controllable at all. NotebookView.jsx's real editor already calls
// `drawSelection()` (its own CM6 mount effect: `drawSelection(),
// dropCursor()`) — added here to match, so `.cm-cursor`'s own theme rules
// below actually have an element to apply to. `caretColor` on `.cm-content`
// is kept too, as the fallback for the split-second before `drawSelection`'s
// own layer mounts. Both use `var(--accent)` so the cursor tracks the
// light/dark toggle automatically, no separate light/dark color to
// maintain.
function notebookTheme() {
  return EditorView.theme({
    '&': { height: '100%', fontSize: '15px' },
    '.cm-scroller': { fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'auto', padding: '28px 0 40vh' },
    '.cm-content': {
      maxWidth: '780px', margin: '0 auto', padding: '0 clamp(16px, 6vw, 48px)', boxSizing: 'border-box', lineHeight: '1.8',
      caretColor: 'var(--accent)',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    // Text-selection highlight has the exact same `&light`/`&dark`-only
    // problem as the caret — CM6's base theme never paints
    // `.cm-selectionBackground` at all outside those scopes, so selecting
    // text was invisible here too, not just the cursor.
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent) !important',
    },
    '.cm-line': { padding: 0 },
    // Same root cause as the cursor fix above, different feature: the new
    // search panel (`@codemirror/search`)'s own base theme scopes
    // `.cm-panels`/`.cm-textfield`/`.cm-button` colors under `&light`/
    // `&dark` too, which this editor never applies — left alone, the panel
    // would render with unset/inherited colors (invisible text on this
    // page's dark background, same failure shape as the caret). Themed
    // explicitly with the same CSS vars as everything else here instead.
    '.cm-panels': { background: 'var(--surface)', color: 'var(--text)' },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-textfield': { background: 'var(--surfaceAlt)', color: 'var(--text)', border: '1px solid var(--border)' },
    '.cm-button': { background: 'var(--surfaceAlt)', color: 'var(--text)', border: '1px solid var(--border)', backgroundImage: 'none' },
    '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
    '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 65%, transparent)' },
  })
}

// ─── /linkf, /linkw, /linkv — guest-side pick handling ────────────────────────
// Creates a detached `<input type=file>`, never appended to the DOM — a
// standard, well-supported pattern (Chrome/Firefox/Safari all allow
// `.click()` on an unattached file input) that avoids needing a persistent
// ref/JSX element just for one-shot picks.
function pickBrowserFile() {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    let settled = false
    const settle = v => { if (!settled) { settled = true; resolve(v) } }
    input.onchange = () => settle(input.files?.[0] || null)
    // Most browsers don't fire 'change' on cancel; 'cancel' is supported by
    // Chromium/Firefox. Safari has neither reliably — a guest who opens the
    // picker and cancels there just sees nothing happen, same as a no-op,
    // rather than hanging; acceptable, not worth a timeout heuristic.
    input.oncancel = () => settle(null)
    input.click()
  })
}

/** `assetDoc` — the Y.Doc a `/linkf` upload should publish into (always the
 *  NETWORK doc: `ytext.doc` for a viewer's `Editor`, `peer.doc` for
 *  `RelayedEditor` — never `draftDoc`, which has no asset maps of its own,
 *  same rule Editor/RelayedEditor's `assets` prop already follows below). */
function makeOnPick(getView, assetDoc) {
  return async (pick) => {
    const view = getView()
    if (!view) return
    if (pick.type === 'file') {
      const file = await pickBrowserFile()
      if (!file) return
      const res = await publishGuestAsset(assetDoc, file)
      if (!res.ok) {
        console.warn(`[collab] file upload not published (${res.reason}):`, file.name)
        return
      }
      view.dispatch({ changes: { from: pick.lineFrom, to: pick.lineTo, insert: `/linkf:${res.key}|${res.name}` } })
    } else if (pick.type === 'web' || pick.type === 'video') {
      const url = window.prompt(pick.type === 'video' ? 'Video URL' : 'Webpage URL')
      const trimmed = url?.trim()
      if (!trimmed) return
      const prefix = pick.type === 'video' ? 'linkv' : 'linkw'
      view.dispatch({ changes: { from: pick.lineFrom, to: pick.lineTo, insert: `/${prefix}:${trimmed}` } })
    }
  }
}

/** The shared widget-zoo extension set — everything §18.6 "Phase D" asks for
 *  except the pieces named in this file's own header as deliberately not
 *  ported. One function so `Editor` and `RelayedEditor` can't drift from
 *  each other; both call this with their own `assets`/`onPick`/`assetDoc`.
 *
 *  `mode` — `'live'` (default) or `'source'`, mirroring `NotebookView.jsx`'s
 *  own `viewMode === 'live'`/`'source'` branches exactly (§18.7 "Phase E"):
 *  Live gets the widget zoo, code-folding, and the interaction handlers;
 *  Source gets `makeSourcePlugin` instead — mutually exclusive there too.
 *  Preview isn't a CM6 mode at all here (GuestApp.jsx swaps to a completely
 *  separate HTML-rendered div for it, same as `NotebookView.jsx`'s own
 *  Preview is really just Live's decorations in a read-only shell — except
 *  the guest's Preview needs no CM6 instance mounted at all to make that
 *  true, simpler by construction). */
function buildLiveExtensions({ onPickRef, assets, mode = 'live' }) {
  const failedExts = []
  const safeExt = makeSafeExt(failedExts)
  return [
    ...safeExt('theme', () => makeTheme(cm)),
    CMLanguage.syntaxHighlighting(makeHighlight(cm)),
    CMLanguage.syntaxHighlighting(CMLanguage.defaultHighlightStyle, { fallback: true }),
    CMLanguage.indentOnInput(),
    CMLanguage.bracketMatching(),
    markdown({ extensions: gfmExts }),
    ...safeExt('format-keys', () => makeFormatKeys(cm)),
    ...safeExt('table-command', () => makeTableCommand(cm)),
    ...safeExt('link-commands', () => makeLinkCommands(cm, onPickRef)),
    ...safeExt('smart-enter', () => makeSmartEnter(cm)),
    ...safeExt('pair-input', () => makePairInputHandler(cm)),
    ...safeExt('ghost-hint', () => makeGhostHintPlugin(cm)),
    // Math.js inline calculator — owns the editor's single autocompletion();
    // the guest gets no slash-menu source (that's the `/color` family's own
    // dropdown, not ported this pass — see header).
    ...safeExt('math-calc', () => makeMathCalcPlugin(cm, [])),
    ...(mode === 'live' ? [
      // Live decorations — the widget zoo itself. `notebooks`/`library`/
      // `sketchbooks`/`flashcardDecks` all `[]`, `notebookDir` null,
      // `hasVault: false` (§18.5 — wikilinks render the honest "not
      // available" state, not a false "click to create"), `questionStoreApi`
      // null (no flashcard decks to add to; matches the noop default
      // QuestionWidget already falls back to).
      ...safeExt('live-decorations', () => makeLivePlugin(cm, CMState.RangeSetBuilder, [], [], [], [], null, false, assets, false, null)),
      ...safeExt('code-folding', () => cm.language.codeFolding({ placeholderDOM: () => document.createElement('span') })),
      ...safeExt('interaction-handlers', () => [
        makeCheckboxHandler(cm),
        makeStatusHandler(cm),
        makeHeadingFoldHandler(cm),
        // No wikiNavRef — a guest has no other views to jump to;
        // makeWikiHandler already no-ops safely with none (confirmed
        // §18.5), not re-derived here.
        makeWikiHandler(cm, null),
        makeMathClickHandler(cm),
        makeTodoHandler(cm),
        makeTaskHandler(cm),
        // `assets` threaded so a `guest-asset:` file badge downloads
        // instead of silently no-op'ing (no `_invoke` to open it with,
        // ever, here).
        makeLinkHandler(cm, assets),
      ]),
    ] : safeExt('source-mode', () => makeSourcePlugin(cm))),
  ]
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
export function Editor({ ytext, awareness, readOnly, assets, mode = 'live', onView }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  useEffect(() => {
    if (!awareness) return // awareness arrives one tick after mount — see usePeer
    const undoManager = new Y.UndoManager(ytext)
    const onPickRef = { current: makeOnPick(() => viewRef.current, ytext.doc) }
    const view = new EditorView({
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          ...buildLiveExtensions({ onPickRef, assets, mode }),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          ...yCollabSync(ytext, awareness, { undoManager }),
          // `assets` (see assetsPlugin.js) is optional — omitted entirely
          // for e.g. the harness's own throwaway proof room, which never
          // has an asset map to look anything up in.
          ...(assets ? [collabAssetsFacet.of(assets), collabImagePlugin()] : []),
          // Missing entirely until now — NotebookView.jsx's own extensions
          // array has always had this. Without it CM6 defaults to NO line
          // wrapping at all: a heading or a long word just extends past the
          // viewport, silently, with no visible scrollbar — the exact "text
          // cut off at the edge" symptom this had on narrow/mobile widths
          // (worse there, but not actually mobile-specific: any line longer
          // than the editor's width did this, on any viewport).
          EditorView.lineWrapping,
          notebookTheme(),
        ],
      }),
      parent: hostRef.current,
    })
    viewRef.current = view
    onView?.(view)
    return () => { view.destroy(); viewRef.current = null; undoManager.destroy(); onView?.(null) }
    // readOnly OR mode changing (a role flip, or Live⇄Source, mid-session)
    // are the cases that deliberately remount — rare enough that losing
    // local cursor position is an acceptable trade for not hand-rolling a
    // reconfigure (same call `NotebookView.jsx` doesn't have to make, since
    // its own mount effect already remounts on `viewMode` change too).
  }, [ytext, awareness, readOnly, assets, mode]) // eslint-disable-line react-hooks/exhaustive-deps -- onView is a stable setter, including it would remount on every parent render
  return <div ref={hostRef} className={`nb-cm ${mode === 'source' ? 'nb-source' : 'nb-live'}`} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
}

/** Editor guests only. CM6 binds to a local-only `draftDoc` — never bound
 *  to `WebrtcProvider`, so nothing typed here can auto-broadcast into the
 *  mesh (that's the whole point; see engine.js's `useCanonicalDoc` for what
 *  this does and doesn't close). `draftDoc` is kept mirrored to the
 *  canonical doc on every remote change, and every local edit is proposed
 *  to the host over awareness for `useHostRelay` to accept or drop.
 *  `draftDoc` itself is created by the caller (GuestApp.jsx's
 *  `GuestSession`), not here — so it survives this component unmounting
 *  (e.g. toggling to Preview mode, or the session ending) and its text is
 *  always readable as "everything this guest has typed, sent or not." See
 *  GuestApp.jsx's session-end snapshot for why that matters.
 *
 *  Cursor/selection IS shared now — bound to `peer.awareness` (the real
 *  network identity, same one `access`/the Users popover already use)
 *  rather than a private, never-networked `Awareness` instance. Relative
 *  positions are computed against `draftText`, but resolve correctly on any
 *  peer reading `netDoc`/`canonicalDoc`'s text: both share the root type
 *  name `'codemirror'`, and the synced portion of `draftText` carries the
 *  exact same Yjs item ids (imported via `Y.applyUpdate`, never re-typed —
 *  see the mirror effect below), so a relative position anchored there
 *  resolves on any of them. Only a position inside NOT-YET-relayed local
 *  text (typed in the last ~150ms, still in `draftDoc`'s own unsent items)
 *  can transiently fail to resolve elsewhere — self-heals the moment that
 *  delta is accepted, same shape as the seed/mirror timing notes elsewhere
 *  in this file. This also means an editor guest now sees everyone ELSE's
 *  remote cursors too (`remoteCursorsExt()`, this file's own icon+hover
 *  rendering — see remoteCursors.js — for free) —
 *  previously absent entirely, not just an accepted trade. */
export function RelayedEditor({ peer, draftDoc, assets, mode = 'live', onView }) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const draftText = useMemo(() => draftDoc.getText('codemirror'), [draftDoc])

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
    if (!peer.awareness) return // same one-tick-late arrival as Editor above
    const undoManager = new Y.UndoManager(draftText)
    // Assets always publish to the NETWORK doc (peer.doc), never draftDoc —
    // an editor guest's local scratch doc has no maps of its own to look
    // anything up in or publish into. Same rule the `assets` prop below
    // already follows for READING; this is the WRITE side of the same rule.
    const onPickRef = { current: makeOnPick(() => viewRef.current, peer.doc) }
    const view = new EditorView({
      state: EditorState.create({
        doc: draftText.toString(),
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          search({ top: true }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          ...buildLiveExtensions({ onPickRef, assets, mode }),
          // Real network awareness, not a private one — see this
          // function's own header comment for why that's what makes
          // cursor sharing work here at all.
          ...yCollabSync(draftText, peer.awareness, { undoManager }),
          ...(assets ? [collabAssetsFacet.of(assets), collabImagePlugin()] : []),
          // Missing entirely until now — NotebookView.jsx's own extensions
          // array has always had this. Without it CM6 defaults to NO line
          // wrapping at all: a heading or a long word just extends past the
          // viewport, silently, with no visible scrollbar — the exact "text
          // cut off at the edge" symptom this had on narrow/mobile widths
          // (worse there, but not actually mobile-specific: any line longer
          // than the editor's width did this, on any viewport).
          EditorView.lineWrapping,
          notebookTheme(),
        ],
      }),
      parent: hostRef.current,
    })
    viewRef.current = view
    onView?.(view)
    return () => { view.destroy(); viewRef.current = null; undoManager.destroy(); onView?.(null) }
    // `mode` in the deps — Live⇄Source remounts, same trade as Editor's own
    // (see its header comment); rare enough not to warrant a Compartment.
  }, [draftDoc, draftText, peer.doc, peer.awareness, assets, mode]) // eslint-disable-line react-hooks/exhaustive-deps -- onView is a stable setter

  return <div ref={hostRef} className={`nb-cm ${mode === 'source' ? 'nb-source' : 'nb-live'}`} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
}
