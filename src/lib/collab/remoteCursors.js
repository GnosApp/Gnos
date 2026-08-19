// Custom remote-cursor rendering — replaces y-codemirror.next's own
// `yRemoteSelections`/`yRemoteSelectionsTheme` (still available, still used
// by src/dev/YjsRelayHarness.jsx via the plain `yCollab()` wrapper) with a
// version matching what the user asked for after seeing a first pass: a
// plain caret line in each remote peer's own color (not a mouse-pointer
// glyph — that was this file's first draft, replaced per feedback), and a
// name+icon pill that sits ABOVE the caret, pointing down at it, only
// visible on hover. Stock y-codemirror.next has no icon at all, and its
// name label is always-on and colorless relative to the peer.
//
// Not built by extending the stock widget: `YRemoteCaretWidget` and its
// plugin are internal to y-codemirror.next, not designed for subclassing,
// and have no icon slot at all — cheaper and more predictable to own the
// whole (small) thing than to fight the library's CSS from outside.
// Structure below is a deliberate, close mirror of y-codemirror.next's own
// `y-remote-selections.js` (same facet-based plugin shape, same
// local-cursor-write + remote-decoration-render split) — proven, just with
// a different `toDOM()` and no icon-less limitation.
//
// Used INSTEAD of `yCollab()`'s bundled remote-selection pair — callers
// assemble `ySync`/`yUndoManager` by hand (see y-codemirror.next's own
// `index.js` for what `yCollab()` normally bundles) and add
// `remoteCursorsExt(ytext, awareness)` in place of `yRemoteSelectionsTheme`/
// `yRemoteSelections`.
import * as Y from 'yjs'
import { Facet, Annotation } from '@codemirror/state'
import { ViewPlugin, Decoration, WidgetType, EditorView } from '@codemirror/view'
import { AVATAR_ICONS } from './ids'

// Icon stroke-width bumped to 2.5 (up from lucide's own default 2) —
// "bold the icon a bit to match line weight of name text," which sits next
// to it at font-weight 700.
function iconSvg(id) {
  const entry = AVATAR_ICONS.find(i => i.id === id) || AVATAR_ICONS[0]
  const body = entry.node.map(([tag, props]) => {
    const attrs = Object.entries(props).map(([k, v]) => `${k}="${v}"`).join(' ')
    return `<${tag} ${attrs}></${tag}>`
  }).join('')
  return `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

class RemoteCaretWidget extends WidgetType {
  constructor(color, name, icon) {
    super()
    this.color = color
    this.name = name
    this.icon = icon || 'user' // lucide 'user' glyph — the agreed default when a peer never picked one
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'gnos-rc'
    wrap.style.setProperty('--rc-color', this.color)
    // Plain colored caret line, not a pointer-arrow glyph — matches the
    // local cursor's own `.cm-cursor` look (CollabEditor.jsx's
    // `notebookTheme()`), just per-peer-colored instead of always
    // `var(--accent)`, so "whose cursor is this" reads at a glance from
    // color alone even before hovering the tag.
    const caret = document.createElement('span')
    caret.className = 'gnos-rc-caret'
    const tag = document.createElement('span')
    tag.className = 'gnos-rc-tag'
    tag.innerHTML = iconSvg(this.icon)
    const nameEl = document.createElement('span')
    nameEl.className = 'gnos-rc-name'
    nameEl.textContent = this.name // textContent, not innerHTML — name is guest-typed free text
    tag.appendChild(nameEl)
    wrap.append(caret, tag)
    return wrap
  }

  eq(other) { return other.color === this.color && other.name === this.name && other.icon === this.icon }
  updateDOM() { return false } // identity changed → eq() already false → CM6 fully remounts via toDOM()
  get estimatedHeight() { return -1 }
  ignoreEvent() { return true }
}

export function remoteCursorsTheme() {
  return EditorView.baseTheme({
    // `width: 0` is load-bearing: a normal CM6 cursor (`drawSelection()`'s
    // own `.cm-cursor`) is drawn on a separate absolutely-positioned overlay
    // layer, not inserted into the text flow, so it never shifts anything.
    // This widget IS inserted into the text flow (a CM6 `Decoration.widget`
    // at the cursor's document position) — the first pass gave it real
    // width (`.gnos-rc-caret`'s `display: inline-block; width: 2px`), which
    // physically displaced every character after it by 2px, visibly pushing
    // text apart around a remote cursor instead of just marking a position
    // between two characters like a real cursor does. Fixed the same way
    // CM6's own layer does it: the widget's own box is zero-width, and
    // everything visible inside it (`.gnos-rc-caret`, `.gnos-rc-tag`) is
    // `position: absolute`, so it overlays the text instead of occupying
    // space in it.
    '.gnos-rc': { position: 'relative', display: 'inline-block', width: '0' },
    // Plain vertical bar, same shape/weight as the LOCAL cursor's own
    // `.cm-cursor` (CollabEditor.jsx's `notebookTheme()`), colored per-peer
    // via `--rc-color` instead of always `var(--accent)` — "make the
    // cursor caret for each user reflect their color."
    // `top: 0` here (matching `.gnos-rc`'s own reference box) is where the
    // no-displacement fix introduced a NEW bug: `.gnos-rc` is `width: 0`
    // with no content, so with `vertical-align: baseline` (the default) its
    // own zero-height box sits exactly ON the text baseline — `top: 0` then
    // grew the caret DOWNWARD from there, putting the whole bar below the
    // text instead of spanning it (this is what "the caret is not in line
    // with the text" was — confirmed, not a vague impression). Fixed by
    // anchoring from `bottom` instead, so the caret grows UPWARD from the
    // baseline like the glyphs beside it, with a small negative offset for
    // descender clearance (real letters like 'g'/'y' dip slightly below
    // baseline; a cursor that stops exactly AT the baseline reads as
    // floating above them). `em` is safe to keep here (unlike on
    // `.gnos-rc-tag` below, which sets its own smaller `font-size`) because
    // `.gnos-rc-caret` never sets `font-size` itself, so `em` here still
    // resolves against the actual 15px editor text size it needs to match.
    '.gnos-rc-caret': {
      position: 'absolute', left: '0', bottom: '-.2em', width: '2px', height: '1.3em',
      background: 'var(--rc-color)', borderRadius: '1px',
      boxShadow: '0 0 0 .5px rgba(0,0,0,.25)',
    },
    // Sits ABOVE the caret (flipped from the first pass, which trailed it)
    // pointing down at it — sharp corner bottom-left instead of top-left,
    // and positioned via `bottom` instead of `top`. `left: 1px` lines the
    // tag's own left edge up with the CARET'S CENTER (the caret is 2px
    // wide, so its center sits 1px from `.gnos-rc`'s left edge — matches
    // `.gnos-rc-caret`'s width above, update both together if that ever
    // changes) — was `-4px`, a leftover offset from the first pass's arrow
    // glyph width, no longer meaningful once the arrow was dropped.
    //
    // `bottom` is a PLAIN PX VALUE, not `em` or a `%` of the caret — on
    // purpose, and worth the explicit comment because it's an easy trap to
    // fall back into: `.gnos-rc-tag` sets its own smaller `font-size: 10px`
    // below, so `em` written HERE would resolve against THAT (10px), not
    // the caret's 15px-editor-text-relative sizing — a mismatched unit
    // system between the two siblings. And `%` doesn't work either: it
    // resolves against `.gnos-rc`'s own box, which is zero-height by
    // design (see `.gnos-rc` above), so `calc(100% + Npx)` was always just
    // `Npx` regardless of the caret's real size — silently correct-looking
    // while the caret was small, silently wrong once the caret fix above
    // changed its actual span. `18.5px` = the caret's real top edge
    // (`1.3em - .2em` = `1.1em` × the editor's real 15px font = 16.5px)
    // plus a 2px gap. If the caret's own em values above ever change,
    // this needs updating by hand alongside them — not automatically
    // consistent, which is the real cost of sidestepping `em`/`%` here.
    '.gnos-rc-tag': {
      position: 'absolute', left: '1px', bottom: '18.5px', zIndex: '200',
      display: 'flex', alignItems: 'center', gap: '3px',
      // Sized down from the first pass ("too big… should feel
      // proportionate to the text line height") — this editor's own text
      // runs 15px/1.8, so a pill noticeably taller than a line of text
      // read as oversized sitting right above it.
      padding: '2px 6px 2px 5px', borderRadius: '6px 6px 6px 3px',
      background: 'var(--rc-color)', color: '#fff',
      fontSize: '10px', fontWeight: '700', fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)',
      opacity: '0', transform: 'translateY(3px) scale(.92)', transformOrigin: 'left bottom',
      pointerEvents: 'none', transition: 'opacity .12s ease, transform .12s ease',
    },
    // Hovering the caret line reveals the tag above it; `:hover` on
    // `.gnos-rc` itself (not just `.gnos-rc-caret`) means once the tag is
    // showing, moving onto IT doesn't instantly hide itself.
    '.gnos-rc:hover .gnos-rc-tag': { opacity: '1', transform: 'none' },
  })
}

/** `{ytext, awareness}` — same pair `ySyncFacet` carries for the sync half;
 *  kept separate rather than reusing `ySyncFacet` so this file has no
 *  dependency on y-codemirror.next's internals, only its public exports. */
export const remoteCursorsFacet = Facet.define({ combine: inputs => inputs[inputs.length - 1] })

const localCursorAnnotation = Annotation.define()

class RemoteCursorsPluginValue {
  constructor(view) {
    const { awareness } = view.state.facet(remoteCursorsFacet)
    this._listener = ({ added, updated, removed }) => {
      const changed = added.concat(updated).concat(removed)
      if (changed.some(id => id !== awareness.doc.clientID)) {
        view.dispatch({ annotations: [localCursorAnnotation.of([])] })
      }
    }
    this._awareness = awareness
    this._awareness.on('change', this._listener)
    this.decorations = Decoration.none
  }

  destroy() { this._awareness.off('change', this._listener) }

  update(update) {
    const { ytext, awareness } = update.view.state.facet(remoteCursorsFacet)
    const ydoc = ytext.doc
    const decorations = []

    // Write OUR local selection to awareness, same shape y-remote-selections
    // itself writes (`cursor: {anchor, head}` as Yjs relative-position JSON)
    // so any peer — including ones still using the stock plugin (the dev
    // harness) — can resolve it. Gated on focus, same as stock; unlike
    // stock, never explicitly clears on blur (a dead, unreachable branch in
    // the original — `hasFocus` is false exactly when `sel` is null, so its
    // own clear-on-blur condition could never fire) — deliberately not
    // replicating that as "clear on blur" either: a peer who clicked away
    // to a toolbar button but is still present shouldn't visually vanish,
    // matching how Figma/Docs keep showing an idle peer's last position.
    const local = awareness.getLocalState()
    if (local != null) {
      const hasFocus = update.view.hasFocus && update.view.dom.ownerDocument.hasFocus()
      const sel = hasFocus ? update.state.selection.main : null
      if (sel != null) {
        const anchor = Y.createRelativePositionFromTypeIndex(ytext, sel.anchor)
        const head = Y.createRelativePositionFromTypeIndex(ytext, sel.head)
        const curAnchor = local.cursor == null ? null : Y.createRelativePositionFromJSON(local.cursor.anchor)
        const curHead = local.cursor == null ? null : Y.createRelativePositionFromJSON(local.cursor.head)
        if (local.cursor == null || !Y.compareRelativePositions(curAnchor, anchor) || !Y.compareRelativePositions(curHead, head)) {
          awareness.setLocalStateField('cursor', { anchor, head })
        }
      }
    }

    // Render every OTHER peer's cursor/selection.
    awareness.getStates().forEach((state, clientId) => {
      if (clientId === awareness.doc.clientID) return
      const cursor = state.cursor
      if (cursor == null || cursor.anchor == null || cursor.head == null) return
      const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, ydoc)
      const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, ydoc)
      if (anchor == null || head == null || anchor.type !== ytext || head.type !== ytext) return
      const { color = '#388bfd', name = 'Anonymous', icon } = state.user || {}
      const start = Math.min(anchor.index, head.index)
      const end = Math.max(anchor.index, head.index)
      if (end > start) {
        decorations.push({
          from: start, to: end,
          value: Decoration.mark({
            attributes: { style: `background-color: color-mix(in srgb, ${color} 30%, transparent)` },
            class: 'gnos-rc-selection',
          }),
        })
      }
      decorations.push({
        from: head.index, to: head.index,
        value: Decoration.widget({
          side: head.index - anchor.index > 0 ? -1 : 1,
          block: false,
          widget: new RemoteCaretWidget(color, name, icon),
        }),
      })
    })
    this.decorations = Decoration.set(decorations, true)
  }
}

/** `ytext`/`awareness` — same pair passed to `ySync` elsewhere. Returns
 *  extensions to add alongside `ySync` (NOT alongside `yCollab()`, which
 *  already bundles the stock remote-selection pair this replaces). */
export function remoteCursorsExt(ytext, awareness) {
  return [
    remoteCursorsFacet.of({ ytext, awareness }),
    remoteCursorsTheme(),
    ViewPlugin.fromClass(RemoteCursorsPluginValue, { decorations: v => v.decorations }),
  ]
}
