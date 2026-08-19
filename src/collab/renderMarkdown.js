// Compact markdown → HTML for the guest client's Preview mode. Deliberately
// NOT NotebookView.jsx's `inlineToHtml`/`renderMarkdown` — those resolve
// wikilinks against `notebooks`/`library`/`sketchbooks`/`flashcardDecks`
// context a guest doesn't have, and images against a real filesystem path a
// guest doesn't have either. This is a self-contained subset: headings,
// bold/italic/strikethrough, inline+fenced code, links, blockquotes, lists,
// rules, and images — remote ones direct, local ones via the same
// `assets`/`assetsMeta` Y.Maps assetsPlugin.js already reads (see
// CollabEditor.jsx's own header for the fuller list of what this trades
// away: mermaid, wikilinks, footnotes, tables — a real, separate,
// larger piece of work to close, same as the editor's own known gaps).
//
// Safety: every raw text run is HTML-escaped BEFORE any markup substitution
// runs, and every substitution inserts only tags this function itself
// wrote — same escape-first ordering NotebookView.jsx's own renderer uses,
// not a new pattern invented here.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function resolveImage(src, alt, assets) {
  if (/^(https?:|data:)/i.test(src)) {
    return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" class="gm-img">`
  }
  const bytes = assets?.assetsMap?.get(src)
  if (bytes) {
    const url = URL.createObjectURL(new Blob([bytes]))
    return `<img src="${url}" alt="${esc(alt)}" class="gm-img">`
  }
  const oversized = assets?.assetsMetaMap?.get(src)?.oversized
  return `<span class="gm-imgph">🖼 ${esc(alt || 'image')} — ${oversized ? 'too large to preview' : 'not available yet'}</span>`
}

/** Inline-level markup within one already-escaped line of text. */
function inline(line, assets) {
  let s = line
  s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, src) => resolveImage(src, alt, assets))
  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (_, text, url) => `<a href="${esc(url)}" target="_blank" rel="noopener">${text}</a>`)
  s = s.replace(/``([^`]+)``/g, (_, c) => `<code>${c}</code>`)
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
  s = s.replace(/~~([^~]+)~~/g, (_, c) => `<del>${c}</del>`)
  s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g, (_, a, b) => `<em>${a || b}</em>`)
  return s
}

/** `assets` is the same `{ assetsMap, assetsMetaMap }` shape CollabEditor's
 *  `assets` prop takes — pass through unchanged. Returns an HTML string,
 *  safe to use with `dangerouslySetInnerHTML` because of the escape-first
 *  ordering described above. */
export function renderGuestMarkdown(text, assets) {
  const lines = esc(text ?? '').split('\n')
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  let listBuf = null // { tag: 'ul'|'ol', items: [] }
  let quoteBuf = null

  const flushList = () => { if (listBuf) { out.push(`<${listBuf.tag}>${listBuf.items.map(it => `<li>${inline(it, assets)}</li>`).join('')}</${listBuf.tag}>`); listBuf = null } }
  const flushQuote = () => { if (quoteBuf) { out.push(`<blockquote>${quoteBuf.map(l => inline(l, assets)).join('<br>')}</blockquote>`); quoteBuf = null } }

  while (i < lines.length) {
    const raw = lines[i]

    if (/^```/.test(raw)) {
      if (!inCode) { flushList(); flushQuote(); inCode = true; codeBuf = [] }
      else { out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`); inCode = false }
      i++; continue
    }
    if (inCode) { codeBuf.push(raw); i++; continue }

    const heading = raw.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushList(); flushQuote()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2], assets)}</h${level}>`)
      i++; continue
    }

    if (/^(---|\*\*\*|___)\s*$/.test(raw)) { flushList(); flushQuote(); out.push('<hr>'); i++; continue }

    const quoteLine = raw.match(/^&gt;\s?(.*)$/)
    if (quoteLine) { flushList(); quoteBuf = quoteBuf || []; quoteBuf.push(quoteLine[1]); i++; continue }
    flushQuote()

    const ulItem = raw.match(/^\s*[-*]\s+(.*)$/)
    const olItem = raw.match(/^\s*\d+\.\s+(.*)$/)
    if (ulItem || olItem) {
      const tag = ulItem ? 'ul' : 'ol'
      if (!listBuf || listBuf.tag !== tag) { flushList(); listBuf = { tag, items: [] } }
      listBuf.items.push((ulItem || olItem)[1])
      i++; continue
    }
    flushList()

    if (raw.trim() === '') { i++; continue }
    out.push(`<p>${inline(raw, assets)}</p>`)
    i++
  }
  flushList(); flushQuote()
  if (inCode) out.push(`<pre><code>${codeBuf.join('\n')}</code></pre>`) // unterminated fence — still show what there is

  return out.join('\n')
}
