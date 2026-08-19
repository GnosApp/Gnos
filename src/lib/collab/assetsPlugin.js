// Minimal image renderer for the plain collab editor (CollabEditor.jsx) —
// PLAN_CONCURRENCY.md §7's "asset problem", browser-guest half. NOT Gnos's
// real `ImgWidget`/`makeLivePlugin` (those resolve against a local
// filesystem the guest doesn't have, and extracting them standalone is its
// own, larger piece of work — see CollabEditor.jsx's own header). This is a
// separate, deliberately simple decoration: it recognizes `![alt](src)`,
// renders remote `http(s)`/`data:` images directly (free — the guest's
// browser just fetches them), and for local-looking paths, looks up bytes
// in a shared Yjs `assets` Y.Map (published by the host — see
// src/lib/collab/hostAssets.js) rather than any filesystem.
import { RangeSetBuilder, Facet } from '@codemirror/state'
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view'

const IMG_RE = /!\[([^\]]*)\]\(([^\s)]+)\)/g

/** Carries the Yjs `assets`/`assetsMeta` maps into the plugin without prop-
 *  drilling through CM6 internals. `null` (the default combine result when
 *  no one provides it) means "don't even try" — every call site that wires
 *  this in checks for that and skips the extension entirely rather than
 *  rendering broken-image placeholders for a doc that was never going to
 *  have assets (e.g. the harness's own throwaway proof room). */
export const collabAssetsFacet = Facet.define({ combine: vals => (vals.length ? vals[vals.length - 1] : null) })

class RemoteImageWidget extends WidgetType {
  constructor(src, alt) { super(); this.src = src; this.alt = alt }
  eq(other) { return other.src === this.src && other.alt === this.alt }
  toDOM() {
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    img.style.cssText = 'max-width:100%;display:block;margin:6px 0;border-radius:6px'
    return img
  }
  ignoreEvent() { return true }
}

class LocalImageWidget extends WidgetType {
  // `status`: 'ready' | 'oversized' | 'missing'. `missing` covers both "the
  // host hasn't published it yet" (assets can lag behind text — a large
  // image takes longer to cross the data channel than the few bytes of its
  // own markdown reference) and "the host never had it" — no way to tell
  // those apart from here, so the label stays neutral rather than claiming
  // certainty it doesn't have.
  constructor(bytes, alt, status) { super(); this.bytes = bytes; this.alt = alt; this.status = status }
  eq(other) { return other.status === this.status && other.bytes === this.bytes && other.alt === this.alt }
  toDOM() {
    if (this.status === 'ready') {
      const img = document.createElement('img')
      const url = URL.createObjectURL(new Blob([this.bytes]))
      img.src = url
      img.alt = this.alt
      // Revoke once decoded — the browser has its own copy by then, and this
      // widget's DOM node is reused (via `eq()`) rather than recreated on
      // every keystroke, so there's no later re-read of `img.src` that would
      // need the blob URL to still be valid.
      img.onload = () => URL.revokeObjectURL(url)
      img.style.cssText = 'max-width:100%;display:block;margin:6px 0;border-radius:6px'
      return img
    }
    const div = document.createElement('div')
    div.textContent = this.status === 'oversized'
      ? `🖼 ${this.alt || 'image'} — too large to preview`
      : `🖼 ${this.alt || 'image'} — not available yet`
    div.style.cssText = 'padding:7px 11px;border:1px dashed var(--border,#30363d);border-radius:6px;color:var(--textDim,#6e7681);font-size:12px;margin:6px 0;font-family:-apple-system,BlinkMacSystemFont,sans-serif'
    return div
  }
  ignoreEvent() { return true }
}

function buildDecorations(view, assets) {
  const builder = new RangeSetBuilder()
  if (!assets) return builder.finish()
  const text = view.state.doc.toString()
  IMG_RE.lastIndex = 0
  let m
  const matches = []
  while ((m = IMG_RE.exec(text))) {
    matches.push({ from: m.index, to: m.index + m[0].length, alt: m[1], src: m[2] })
  }
  for (const { from, to, alt, src } of matches) {
    let widget
    if (/^(https?:|data:)/i.test(src)) {
      widget = new RemoteImageWidget(src, alt)
    } else {
      const bytes = assets.assetsMap?.get(src)
      if (bytes) widget = new LocalImageWidget(bytes, alt, 'ready')
      else if (assets.assetsMetaMap?.get(src)?.oversized) widget = new LocalImageWidget(null, alt, 'oversized')
      else widget = new LocalImageWidget(null, alt, 'missing')
    }
    builder.add(from, to, Decoration.replace({ widget, block: false }))
  }
  return builder.finish()
}

/** Pass `{ assetsMap, assetsMetaMap }` (both Y.Maps, or omit entirely) via
 *  `collabAssetsFacet.of(...)`. Rebuilds on doc changes (normal CM6 update
 *  cycle) AND on the assets maps' own changes (an out-of-band Yjs event CM6
 *  doesn't know about on its own — an empty `view.dispatch({})` is the
 *  standard way to make CM6 re-run its update cycle for a purely external
 *  state change). */
export function collabImagePlugin() {
  return ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view
      this.assets = view.state.facet(collabAssetsFacet)
      this.decorations = buildDecorations(view, this.assets)
      this.onExternalChange = () => { if (this.view) this.decorations = buildDecorations(this.view, this.assets); this.view?.dispatch({}) }
      this.assets?.assetsMap?.observe(this.onExternalChange)
      this.assets?.assetsMetaMap?.observe(this.onExternalChange)
    }
    update(update) {
      if (update.docChanged) this.decorations = buildDecorations(update.view, this.assets)
    }
    destroy() {
      this.assets?.assetsMap?.unobserve(this.onExternalChange)
      this.assets?.assetsMetaMap?.unobserve(this.onExternalChange)
    }
  }, { decorations: v => v.decorations })
}
