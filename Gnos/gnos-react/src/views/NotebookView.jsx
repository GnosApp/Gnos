/* NotebookView.jsx — CodeMirror 6 — v4
 *
 * Changes from v3:
 * ─────────────────
 * • Live view styled identically to preview (same typography, prose spacing,
 *   block padding) — only difference is the cursor / caret.
 * • Both opening AND closing syntax markers are hidden together when the cursor
 *   leaves the span. The cursor-zone now tracks the widest inline ancestor so
 *   **both** EmphasisMarks reveal at once.
 * • KaTeX replaced with MathQuill for inline-editable math. Clicking a rendered
 *   formula opens an in-place MathQuill editor; pressing Escape/Enter commits.
 * • Images render correctly in live view and no longer blank the screen in
 *   preview (line-level block replacement constrained to just the image node).
 * • Math $$…$$ and $…$ render in both live and preview via MathQuill rendering.
 * • Predictive formatting: once one side of a pair is typed (e.g. **) the
 *   partially-wrapped text immediately receives its CSS style via a dedicated
 *   "half-open" pass in the live plugin.
 * • [[ wikilink dropdown now uses a card-style floating panel that mirrors the
 *   library search bar; it is driven by a custom EditorView plugin (not the
 *   generic autocompletion tooltip) so it looks consistent.
 * • Paired-syntax auto-wrap: typing **, *, `, ~~, ==, $ around selected text
 *   (or at end of a word) wraps rather than showing a dropdown.
 * • Generic pair-syntax dropdown removed from autocompletion; only wikilinks
 *   use the autocomplete tooltip.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadNotebookContent, saveNotebookContent, saveNotebookImage } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'
import { listen } from '@tauri-apps/api/event'
import { readFile } from '@tauri-apps/plugin-fs'

// ─── Tiny id helper ───────────────────────────────────────────────────────────
function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── CodeMirror lazy bundle ───────────────────────────────────────────────────
let _cmP = null
function loadCM() {
  if (_cmP) return _cmP
  _cmP = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/lang-markdown'),
    import('@codemirror/autocomplete'),
    import('@codemirror/search'),
    import('@lezer/highlight'),
    import('@lezer/markdown'),
  ]).then(([state, view, commands, language, langMd, autocomplete, search, highlight, lezerMd]) => ({
    state, view, commands, language, langMd, autocomplete, search, highlight, lezerMd,
  }))
  return _cmP
}

// ─── KaTeX lazy loader (static rendering) ────────────────────────────────────
let _ktP = null
function getKaTeX() {
  if (_ktP) return _ktP
  _ktP = (async () => {
    try {
      // Load KaTeX from npm package (bundled, no CDN needed)
      const katex = await import('katex')
      // Inject KaTeX CSS if not already present
      if (!document.getElementById('katex-css')) {
        const css = await import('katex/dist/katex.min.css?inline').catch(() => null)
        if (css?.default) {
          const style = document.createElement('style')
          style.id = 'katex-css'
          style.textContent = css.default
          document.head.appendChild(style)
        }
      }
      return katex.default || katex
    } catch (e) {
      console.warn('[KaTeX] failed to load:', e)
      return null
    }
  })()
  return _ktP
}

// Render LaTeX into a DOM element using KaTeX (synchronous once loaded)
function renderMathStatic(el, latex, displayMode) {
  getKaTeX().then(katex => {
    if (!katex) { el.textContent = latex; return }
    try {
      katex.render(latex, el, { displayMode, throwOnError: false, strict: false })
    } catch { el.textContent = latex }
  })
}

// ─── MathQuill lazy loader (edit popup only) ─────────────────────────────────
let _mqP = null
function getMQ() {
  if (_mqP) return _mqP
  _mqP = (async () => {
    try {
      if (window.MathQuill) return window.MathQuill.getInterface(2)
      if (!window.jQuery) {
        await new Promise((res, rej) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js'
          s.onload = res; s.onerror = rej
          document.head.appendChild(s)
        })
      }
      if (!document.getElementById('mathquill-css')) {
        const link = document.createElement('link')
        link.id = 'mathquill-css'; link.rel = 'stylesheet'
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/mathquill/0.10.1/mathquill.min.css'
        document.head.appendChild(link)
      }
      await new Promise((res, rej) => {
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/mathquill/0.10.1/mathquill.min.js'
        s.onload = res; s.onerror = rej
        document.head.appendChild(s)
      })
      return window.MathQuill?.getInterface(2) ?? null
    } catch (e) {
      console.warn('[MathQuill] failed to load:', e)
      return null
    }
  })()
  return _mqP
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ─── Inline markdown → HTML ───────────────────────────────────────────────────
function inlineToHtml(text, notebooks = [], library = [], sketchbooks = [], flashcardDecks = []) {
  const buckets = []
  const ph = html => { const k = `\x02${buckets.length}\x03`; buckets.push(html); return k }

  let s = esc(text)

  // Images  ![alt](src)
  s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) =>
    ph(`<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} class="nb-img" loading="lazy">`))

  // Links  [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, txt, url, title) =>
    ph(`<a href="${esc(url)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${txt}</a>`))

  // Inline code  ``…`` then `…`
  s = s.replace(/``([^`]+)``/g, (_, c) => ph(`<code class="nb-ic">${esc(c)}</code>`))
  s = s.replace(/`([^`\n]+)`/g, (_, c) => ph(`<code class="nb-ic">${esc(c)}</code>`))

  // Math  $$…$$ inline  $…$
  s = s.replace(/\$\$(.+?)\$\$/g, (_, m) => ph(`<span class="nb-math nb-math-mq" data-latex="${esc(m)}" data-display="1"></span>`))
  s = s.replace(/\$([^$\n]+)\$/g, (_, m) => ph(`<span class="nb-math nb-math-mq" data-latex="${esc(m)}"></span>`))

  // Bold-italic ***…*** or ___…___
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="nb-bold"><em class="nb-italic">$1</em></strong>')
  s = s.replace(/___(.+?)___/g,       '<strong class="nb-bold"><em class="nb-italic">$1</em></strong>')
  // Bold **…** or __…__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="nb-bold">$1</strong>')
  s = s.replace(/__([^_\n]+)__/g,  '<strong class="nb-bold">$1</strong>')
  // Italic *…* or _…_
  s = s.replace(/\*([^*\n]+)\*/g, '<em class="nb-italic">$1</em>')
  s = s.replace(/_([^_\n]+)_/g,   '<em class="nb-italic">$1</em>')
  // Strikethrough ~~…~~
  s = s.replace(/~~(.+?)~~/g, '<del class="nb-strike">$1</del>')
  // Highlight ==…==
  s = s.replace(/==(.+?)==/g, '<mark class="nb-hl">$1</mark>')
  // Superscript ^…^
  s = s.replace(/\^([^\s^]+)\^/g, '<sup class="nb-sup">$1</sup>')
  // Subscript ~…~
  s = s.replace(/~([^\s~]+)~/g, '<sub class="nb-sub">$1</sub>')
  // Footnote refs [^id]
  s = s.replace(/\[\^([^\]\n]+)\]/g, (_, id) =>
    ph(`<sup class="nb-fn-ref"><a href="#fn-${esc(id)}">[${esc(id)}]</a></sup>`))
  // Wikilinks [[Title]] with optional (sketch) or (flash) suffix
  s = s.replace(/\[\[([^\]\n]{1,120})\]\](?:\((sketch|flash)\))?/g, (_, raw, suffix) => {
    const title = raw.trim()
    const nb = notebooks.find(n => n.title?.toLowerCase() === title.toLowerCase())
    const bk = !nb && library.find(b => b.title?.toLowerCase() === title.toLowerCase())
    const sb = !nb && !bk && sketchbooks.find(s => s.title?.toLowerCase() === title.toLowerCase())
    const fd = !nb && !bk && !sb && flashcardDecks.find(d => d.title?.toLowerCase() === title.toLowerCase())
    // Suffix overrides type for new items
    const forceType = suffix === 'sketch' ? 'new-sketch' : suffix === 'flash' ? 'new-flash' : null
    const cls  = nb ? 'wikilink wikilink-nb' : bk ? 'wikilink wikilink-bk' : sb ? 'wikilink wikilink-sb' : fd ? 'wikilink wikilink-fd' : 'wikilink wikilink-new'
    const type = nb ? 'notebook' : bk ? 'book' : sb ? 'sketchbook' : fd ? 'flashcard' : (forceType || 'new')
    const id   = nb ? nb.id : bk ? bk.id : sb ? sb.id : fd ? fd.id : ''
    return ph(`<span class="${cls}" data-wl-type="${type}" data-wl-id="${esc(id)}" data-wl-title="${esc(title)}">${esc(title)}</span>`)
  })

  // Restore placeholders without using control-char regex
  s = s.split('\x02').reduce((acc, part, idx) => {
    if (idx === 0) return part
    const end = part.indexOf('\x03')
    const bucketIdx = parseInt(part.slice(0, end), 10)
    return acc + (buckets[bucketIdx] ?? '') + part.slice(end + 1)
  }, '')
  return s
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function renderList(rawLines, il) {
  let html = ''
  const stack = []
  const openTag = (tag, start) => {
    html += (tag === 'ol' && start > 1) ? `<ol start="${start}">` : `<${tag}>`
  }
  const closeTag = () => { const top = stack.pop(); html += `</${top.tag}>` }

  rawLines.forEach(line => {
    const olM = line.match(/^(\s*)(\d+)[.)]\s+(.*)/)
    const ulM = !olM && line.match(/^(\s*)([-*+])\s+(.*)/)
    const m = olM || ulM
    if (!m) return
    const indent = m[1].length
    const tag    = olM ? 'ol' : 'ul'
    const num    = olM ? parseInt(m[2], 10) : 1
    const item   = m[3]

    if (!stack.length) {
      openTag(tag, num); stack.push({ tag, indent })
    } else if (indent > stack[stack.length - 1].indent) {
      openTag(tag, num); stack.push({ tag, indent })
    } else {
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) closeTag()
      if (stack[stack.length - 1].tag !== tag) {
        closeTag(); openTag(tag, num); stack.push({ tag, indent })
      }
    }
    html += `<li>${il(item)}</li>`
  })
  while (stack.length) closeTag()
  return html
}

function blockToHtml(raw, notebooks, library, footnotesBuf, sketchbooks = [], flashcardDecks = []) {
  const il = t => inlineToHtml(t, notebooks, library, sketchbooks, flashcardDecks)
  const lines = raw.split('\n')
  const first = lines[0]

  const hm = first.match(/^(#{1,6})\s+(.+?)(?:\s+\{#([^}]+)\})?$/)
  if (hm) {
    const lv = hm[1].length
    const id = hm[3] ? ` id="${esc(hm[3])}"` : ''
    return `<h${lv}${id}>${il(hm[2])}</h${lv}>`
  }

  if (/^(---+|\*\*\*+|___+)$/.test(first.trim())) return '<hr>'

  if (/^(`{3,}|~{3,})/.test(first)) {
    const lang = first.replace(/^`{3,}|^~{3,}/, '').trim()
    const body = raw.replace(/^[^\n]*\n/, '').replace(/\n[`~]{3,}\s*$/, '')
    return `<pre class="nb-pre${lang ? ' lang-'+esc(lang) : ''}"><code>${esc(body)}</code></pre>`
  }

  if (/^>\s?/.test(first)) {
    const inner = lines.map(l => l.replace(/^>\s?/, '')).join('\n').trim()
    const callM = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|DANGER)\](.*)/i)
    if (callM) {
      const kind  = callM[1].toUpperCase()
      const title = callM[2].trim() || kind.charAt(0)+kind.slice(1).toLowerCase()
      const palettes = {NOTE:'#388bfd',TIP:'#3fb950',IMPORTANT:'#a371f7',WARNING:'#d29922',CAUTION:'#f85149',INFO:'#388bfd',SUCCESS:'#3fb950',DANGER:'#f85149'}
      const c = palettes[kind] || '#388bfd'
      return `<div class="nb-callout" style="border-left:3px solid ${c};background:${c}18;padding:10px 14px;border-radius:0 6px 6px 0;margin:.6em 0"><div style="font-weight:700;color:${c};margin-bottom:4px;font-size:.93em">${esc(title)}</div><div>${il(inner.replace(/^\[[^\]]+\][^\n]*\n?/, '').trim())}</div></div>`
    }
    return `<blockquote>${il(inner.replace(/\n/g, '<br>'))}</blockquote>`
  }

  if (/^\|/.test(first) && lines.length >= 2) {
    const parseRow = row => row.split('|').slice(1, -1).map(c => c.trim())
    const headers = parseRow(lines[0])
    const sep     = lines[1] ? parseRow(lines[1]) : []
    const aligns  = sep.map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left')
    const rows    = lines.slice(2).filter(l => /\|/.test(l) && !/^[\s|:-]+$/.test(l))
    const thHtml  = headers.map((h, i) => `<th style="text-align:${aligns[i]||'left'}">${il(h)}</th>`).join('')
    const tbHtml  = rows.map(r => {
      const cells = parseRow(r)
      return `<tr>${cells.map((c, i) => `<td style="text-align:${aligns[i]||'left'}">${il(c)}</td>`).join('')}</tr>`
    }).join('')
    return `<table class="nb-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table>`
  }

  if (/^\s*[-*+]\s\[[ xX]\]/.test(first)) {
    let idx = 0
    const items = lines.filter(l => /^\s*[-*+]\s\[[ xX]\]/.test(l)).map(l => {
      const checked = /\[[xX]\]/.test(l)
      const text    = l.replace(/^\s*[-*+]\s\[[ xX]\]\s*/, '')
      return `<li class="nb-task${checked?' checked':''}" data-ti="${idx++}"><span class="nb-cb" data-ti="${idx-1}">${checked?'✓':''}</span><span>${il(text)}</span></li>`
    })
    return `<ul class="nb-tl">${items.join('')}</ul>`
  }

  if (/^\s*[-*+]\s/.test(first)) return renderList(lines, il)
  if (/^\s*\d+[.)]\s/.test(first)) return renderList(lines, il)

  const fnM = first.match(/^\[\^([^\]]+)\]:\s*(.*)/)
  if (fnM) {
    footnotesBuf?.push({ id: fnM[1], text: fnM[2] })
    return `<div class="nb-fn-def" id="fn-${esc(fnM[1])}"><sup>${esc(fnM[1])}</sup> ${il(fnM[2])} <a href="#fnref-${esc(fnM[1])}" class="nb-fn-back">↩</a></div>`
  }

  // Math block $$…$$
  if (/^\$\$/.test(first)) {
    const body = raw.replace(/^\$\$\n?/, '').replace(/\n?\$\$$/, '')
    return `<div class="nb-math nb-math-block nb-math-mq" data-latex="${esc(body)}" data-display="1"></div>`
  }

  return `<p>${il(raw.replace(/\n/g, '<br>'))}</p>`
}

function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let buf = [], inFence = false, fenceMarker = ''

  const flush = () => {
    const raw = buf.join('\n').trim()
    if (raw) blocks.push(raw)
    buf = []
  }

  for (const line of lines) {
    if (!inFence && /^(`{3,}|~{3,})/.test(line)) {
      flush(); inFence = true; fenceMarker = line.match(/^(`{3,}|~{3,})/)[1]
      buf.push(line); continue
    }
    if (inFence) {
      buf.push(line)
      if (line.startsWith(fenceMarker) && line.trim().length === fenceMarker.length) {
        flush(); inFence = false; fenceMarker = ''
      }
      continue
    }
    if (line.trim() === '$$') { buf.push(line); continue }
    if (line.trim() === '') { flush(); continue }

    const isTable   = /^\s*\|/.test(line)
    const wasTable  = buf.length > 0 && /^\s*\|/.test(buf[0])
    if (isTable && wasTable) { buf.push(line); continue }
    if (isTable && !wasTable) { flush(); buf.push(line); continue }

    const isUl   = /^\s*[-*+]\s/.test(line) && !/^\s*[-*+]\s\[[ xX]\]/.test(line)
    const isOl   = /^\s*\d+[.)]\s/.test(line)
    const isTask = /^\s*[-*+]\s\[[ xX]\]/.test(line)
    const isList = isUl || isOl || isTask
    const wasList = buf.length > 0 && (
      /^\s*[-*+]\s/.test(buf[0]) || /^\s*\d+[.)]\s/.test(buf[0])
    )
    if (isList && wasList) { buf.push(line); continue }
    if (isList) { flush() }

    flush(); buf.push(line)
  }
  flush()
  return blocks
}

function renderMarkdown(text, notebooks = [], library = [], sketchbooks = [], flashcardDecks = []) {
  if (!text?.trim()) return ''
  const footnotes = []
  const blocks = parseBlocks(text)
  const html = blocks.map((raw, i) =>
    blockToHtml(raw, notebooks, library, footnotes, sketchbooks, flashcardDecks)
      .replace(/^(<\w+)/, `$1 data-bi="${i}"`)
  ).join('\n')
  if (!footnotes.length) return html
  const fnHtml = `<section class="nb-fns"><hr>${footnotes.map(f =>
    `<div id="fn-${esc(f.id)}" class="nb-fn-def"><sup>${esc(f.id)}</sup> ${inlineToHtml(f.text, notebooks, library, sketchbooks, flashcardDecks)} <a href="#fnref-${esc(f.id)}" class="nb-fn-back">↩</a></div>`
  ).join('')}</section>`
  return html + fnHtml
}

// Hydrate math nodes in a container after innerHTML is set — uses KaTeX
function hydrateMathNodes(container) {
  const nodes = Array.from(container.querySelectorAll('.nb-math-mq'))
  if (!nodes.length) return
  getKaTeX().then(katex => {
    nodes.forEach(el => {
      const latex = el.dataset.latex || ''
      const display = el.dataset.display === '1'
      if (!katex) { el.textContent = latex; return }
      try {
        katex.render(latex, el, { displayMode: display, throwOnError: false, strict: false })
      } catch { el.textContent = latex }
    })
  })
}

// ─── CodeMirror theme ─────────────────────────────────────────────────────────
function makeTheme(cm) {
  const { EditorView } = cm.view
  return EditorView.theme({
    // In live mode we style lines via CSS classes, not the base editor font.
    // Keep base styles minimal so .nb-live CSS classes dominate.
    '&': {
      background: 'transparent',
      color: 'var(--text)',
      height: '100%',
      fontFamily: 'Georgia, serif',
      fontSize: '15px',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: '16px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      background: 'var(--nb-sel, rgba(56,139,253,0.28)) !important',
    },
    '.cm-activeLine': { background: 'transparent' },
    '.cm-searchMatch': { background: 'rgba(210,153,34,0.35)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: 'rgba(56,139,253,0.45)' },
    '.cm-panels': { display: 'none' },
    '.cm-panel': { display: 'none' },
    '.cm-panel button': { background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', cursor: 'pointer', padding: '3px 8px', fontFamily: 'inherit', fontSize: '12px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  }, { dark: true })
}

function makeHighlight(cm) {
  const { tags } = cm.highlight
  const { HighlightStyle } = cm.language
  return HighlightStyle.define([
    { tag: tags.heading1, color: 'var(--text)', fontWeight: '700', fontSize: '1.6em', fontFamily: 'Georgia, serif' },
    { tag: tags.heading2, color: 'var(--text)', fontWeight: '700', fontSize: '1.35em', fontFamily: 'Georgia, serif' },
    { tag: tags.heading3, color: 'var(--text)', fontWeight: '600', fontSize: '1.15em' },
    { tag: tags.heading4, color: 'var(--text)', fontWeight: '600' },
    { tag: tags.strong,   color: 'var(--nb-bold, var(--text))', fontWeight: '700' },
    { tag: tags.emphasis, color: 'var(--nb-italic, #a5d6ff)', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: 'var(--textDim)', textDecoration: 'line-through' },
    { tag: tags.link,   color: 'var(--accent)' },
    { tag: tags.url,    color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.monospace, color: 'var(--accent)', fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: '0.88em' },
    { tag: tags.meta,   color: 'var(--textDim)', opacity: '0.4' },
    { tag: tags.atom,   color: 'var(--textDim)' },
    { tag: tags.comment, color: 'var(--textDim)', fontStyle: 'italic' },
    { tag: tags.processingInstruction, color: 'var(--textDim)', opacity: '0.6' },
    { tag: tags.keyword, color: '#d2a8ff' },
    { tag: tags.string,  color: '#a5d6ff' },
    { tag: tags.number,  color: '#f0a868' },
    { tag: tags.operator, color: 'var(--textDim)' },
  ])
}

// ─── Wiki-link dropdown (custom React-driven, no CM6 autocompletion) ─────────
// A ViewPlugin detects [[…  before the cursor and pushes state to React via
// a callback. React renders the floating dropdown. The plugin also provides
// a keymap (Tab confirm, ArrowUp/Down navigate, Escape dismiss).
function makeWikiDropdownPlugin(cm, _notebooks, _library, _sketchbooks, _flashcardDecks, onStateChange) {
  const { Prec } = cm.state
  const { ViewPlugin, EditorView, keymap: keymapFacet } = cm.view

  // Shared mutable state the keymap closures can read
  const shared = { active: false, options: [], selectedIdx: 0, from: 0, to: 0 }

  function buildOptions(query) {
    const q = query.toLowerCase()
    // Always read fresh data from the store to avoid stale closures
    const store = typeof useAppStore !== 'undefined' ? useAppStore.getState() : {}
    const notebooks = store.notebooks || _notebooks || []
    const library = store.library || _library || []
    const sketchbooks = store.sketchbooks || _sketchbooks || []
    const flashcardDecks = store.flashcardDecks || _flashcardDecks || []
    const make = (items, detail) =>
      items.filter(i => i.title?.toLowerCase().includes(q))
        .slice(0, 6)
        .map(i => ({ label: i.title, detail, insert: `[[${i.title}]]` }))
    const opts = [
      ...make(notebooks, 'Notebook'),
      ...make(library.filter(b => b.format !== 'audiofolder' && b.format !== 'audio'), 'Book'),
      ...make(library.filter(b => b.format === 'audiofolder' || b.format === 'audio'), 'Audio'),
      ...make(sketchbooks, 'Sketchbook'),
      ...make(flashcardDecks, 'Flashcards'),
    ].slice(0, 8)
    // "Create new" options
    const trimmed = query.trim()
    if (trimmed.length > 0 && !opts.some(o => o.label.toLowerCase() === trimmed.toLowerCase())) {
      opts.push({ label: trimmed, detail: '+ New notebook', insert: `[[${trimmed}]]` })
      opts.push({ label: trimmed, detail: '+ New sketchbook', insert: `[[${trimmed}]](sketch)` })
      opts.push({ label: trimmed, detail: '+ New flashcards', insert: `[[${trimmed}]](flash)` })
    }
    return opts
  }

  function detectWiki(state) {
    const cur = state.selection.main.head
    const line = state.doc.lineAt(cur)
    const col = cur - line.from
    const textBefore = line.text.slice(0, col)
    // Find last [[ that isn't closed
    const idx = textBefore.lastIndexOf('[[')
    if (idx === -1) return null
    const afterBrackets = textBefore.slice(idx + 2)
    // If there's a ]] inside, the wikilink is already closed
    if (afterBrackets.includes(']]')) return null
    // If there's a newline, not valid
    if (afterBrackets.includes('\n')) return null
    return { from: line.from + idx, query: afterBrackets }
  }

  function pushState(view) {
    const result = detectWiki(view.state)
    if (!result) {
      if (shared.active) {
        shared.active = false
        shared.options = []
        onStateChange(null)
      }
      return
    }
    const opts = buildOptions(result.query)
    shared.active = opts.length > 0
    shared.options = opts
    shared.from = result.from
    shared.to = view.state.selection.main.head
    if (shared.selectedIdx >= opts.length) shared.selectedIdx = 0
    if (!shared.active) { onStateChange(null); return }
    // Get cursor coordinates for positioning
    const coords = view.coordsAtPos(view.state.selection.main.head)
    onStateChange({
      options: opts,
      selectedIdx: shared.selectedIdx,
      coords: coords ? { left: coords.left, top: coords.bottom + 4 } : null,
    })
  }

  function confirmSelection(view) {
    if (!shared.active || !shared.options.length) return false
    const opt = shared.options[shared.selectedIdx]
    if (!opt) return false
    view.dispatch({ changes: { from: shared.from, to: shared.to, insert: opt.insert } })
    shared.active = false
    shared.options = []
    onStateChange(null)
    return true
  }

  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this._raf = null; this._schedule(view) }
    update(upd) { if (upd.docChanged || upd.startState.selection.main.head !== upd.state.selection.main.head) this._schedule(upd.view) }
    _schedule(view) {
      if (this._raf) cancelAnimationFrame(this._raf)
      this._raf = requestAnimationFrame(() => { this._raf = null; pushState(view) })
    }
    destroy() { if (this._raf) cancelAnimationFrame(this._raf); onStateChange(null) }
  })

  const wikiKeymap = Prec.high(keymapFacet.of([
    {
      key: 'Tab',
      run: view => shared.active ? confirmSelection(view) : false,
    },
    {
      key: 'Escape',
      run: _view => {
        if (!shared.active) return false
        shared.active = false; shared.options = []
        onStateChange(null)
        return true
      },
    },
    {
      key: 'ArrowDown',
      run: view => {
        if (!shared.active) return false
        shared.selectedIdx = (shared.selectedIdx + 1) % shared.options.length
        pushState(view)
        return true
      },
    },
    {
      key: 'ArrowUp',
      run: view => {
        if (!shared.active) return false
        shared.selectedIdx = (shared.selectedIdx - 1 + shared.options.length) % shared.options.length
        pushState(view)
        return true
      },
    },
  ]))

  return [plugin, wikiKeymap]
}

// ─── Paired-syntax auto-wrap (transaction filter — no dropdown) ───────────────
// When the user types an opening token, we check if there's a selection or
// a word to the left and wrap it. If nothing is selected, we insert both tokens
// and place the cursor in the middle. This is the Obsidian-style approach.
function makePairInputHandler(cm) {
  // Obsidian-style: only auto-wrap when there's a selection.
  // No selection → just type the character normally (no auto-closing).
  // Exception: backtick and $ get lightweight auto-close (easy to dismiss).
  const WRAP_PAIRS = { '*':'*', '_':'_', '~':'~', '=':'=', '`':'`', '$':'$' }
  return cm.view.EditorView.inputHandler.of((view, _from, _to, text) => {
    if (!WRAP_PAIRS[text]) return false
    const sel = view.state.selection.main

    // ── Selection → wrap it (like Obsidian) ─────────────────────────────
    if (!sel.empty) {
      const selected = view.state.doc.sliceString(sel.from, sel.to)
      // Determine the wrapper based on what's already around the selection
      let open = text, close = WRAP_PAIRS[text]
      // If wrapping with * or _, check if we should use ** or *** based on context
      // Simple: just wrap with whatever the user typed
      view.dispatch({
        changes: [
          { from: sel.from, to: sel.from, insert: open },
          { from: sel.to, to: sel.to, insert: close },
        ],
        selection: cm.state.EditorSelection.range(sel.from + open.length, sel.to + open.length),
      })
      return true
    }

    // ── No selection → skip-over if next char matches (prevents doubled closers) ──
    const after1 = view.state.doc.sliceString(sel.from, sel.from + 1)
    if (after1 === text) {
      // Check if we're inside a pair (simple heuristic: char before us is not whitespace
      // and char after is the same as what we're typing)
      const before1 = sel.from >= 1 ? view.state.doc.sliceString(sel.from - 1, sel.from) : ''
      if (before1 && before1 !== ' ' && before1 !== '\n') {
        // Skip over the existing character
        view.dispatch({ selection: { anchor: sel.from + 1 } })
        return true
      }
    }

    // ── No selection → no auto-close, let character type naturally ──────
    return false
  })
}

function makeSmartEnter(cm) {
  return cm.view.keymap.of([{ key: 'Enter', run: cm.commands.insertNewlineAndIndentContinueMarkupList }])
}

// ─── Inline format shortcuts ──────────────────────────────────────────────────
function makeFormatKeys(cm) {
  const wrap = m => ({ state, dispatch }) => {
    const changes = state.selection.ranges.map(r => {
      const sel = state.doc.sliceString(r.from, r.to)
      return { from: r.from, to: r.to, insert: sel ? `${m}${sel}${m}` : `${m}${m}` }
    })
    dispatch(state.update({ changes, scrollIntoView: true }))
    return true
  }
  const link = ({ state, dispatch }) => {
    const sel = state.doc.sliceString(state.selection.main.from, state.selection.main.to)
    dispatch(state.update({ changes: { from: state.selection.main.from, to: state.selection.main.to, insert: sel ? `[${sel}](url)` : '[link text](url)' }, scrollIntoView: true }))
    return true
  }
  return cm.view.keymap.of([
    { key: 'Mod-b', run: wrap('**') },
    { key: 'Mod-i', run: wrap('*') },
    { key: 'Mod-e', run: wrap('`') },
    { key: 'Mod-k', run: link },
    { key: 'Mod-Shift-h', run: wrap('==') },
  ])
}


// ─── Ghost hint plugin ────────────────────────────────────────────────────────
// Shows placeholder ghost text after typing an opening syntax token.
// Tab accepts. Ghost dismisses automatically when cursor moves away or a space
// is typed. The opening syntax markers are NEVER removed — space after syntax
// means the user intended them as literal text.
function makeGhostHintPlugin(cm) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view

  const HINTS = {
    '***': '***',
    '**':  '**',
    '*':   '*',
    '___': '___',
    '__':  '__',
    '_':   '_',
    '~~':  '~~',
    '==':  '==',
    '`':   '`',
    '$$':  '$$',
    '$':   '$',
  }

  class GhostWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-ghost-hint'
      span.textContent = this.text
      span.setAttribute('aria-hidden', 'true')
      return span
    }
    eq(o) { return o instanceof GhostWidget && o.text === this.text }
    ignoreEvent() { return true }
  }

  const ghostPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; this._compute(view) }
    update(upd) { if (upd.docChanged || upd.startState.selection.main.head !== upd.state.selection.main.head) this._compute(upd.view) }
    _compute(view) {
      const { state } = view
      const cur = state.selection.main
      if (!cur.empty) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }
      const line = state.doc.lineAt(cur.head)
      const col = cur.head - line.from
      const textBefore = line.text.slice(0, col)
      const after = line.text.slice(col)

      let matched = null
      for (const token of ['***', '___', '$$', '**', '__', '~~', '==', '*', '_', '`', '$']) {
        if (textBefore.endsWith(token)) {
          const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const count = (textBefore.match(new RegExp(escaped, 'g')) || []).length
          if (count % 2 === 1 && !after.includes(token)) {
            matched = token; break
          }
        }
      }

      // If we had a ghost and user typed a letter (not space), persist it
      if (!matched && this._activeToken && this._hint) {
        const lastChar = col > 0 ? line.text[col - 1] : ''
        // Space or moving away → dismiss ghost, keep syntax as-is
        if (lastChar === ' ' || lastChar === '') {
          this.deco = Decoration.none; this._hint = null; this._activeToken = null; return
        }
        const close = HINTS[this._activeToken]
        const escaped = this._activeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const count = (textBefore.match(new RegExp(escaped, 'g')) || []).length
        if (count % 2 === 1 && !after.includes(close)) {
          const builder = new cm.state.RangeSetBuilder()
          try {
            builder.add(cur.head, cur.head, Decoration.widget({ widget: new GhostWidget(close), side: 1 }))
          } catch { /* ignore */ }
          this.deco = builder.finish()
          this._hint = { pos: cur.head, insert: close }
          return
        }
      }

      if (!matched || !HINTS[matched]) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }
      const close = HINTS[matched]

      if (after.startsWith(close)) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }

      const builder = new cm.state.RangeSetBuilder()
      try {
        builder.add(cur.head, cur.head, Decoration.widget({ widget: new GhostWidget(close), side: 1 }))
      } catch { /* ignore */ }
      this.deco = builder.finish()
      this._hint = { pos: cur.head, insert: close }
      this._activeToken = matched
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.decorations })

  // Only Tab to accept — no Enter handler, no space handler
  // Ghost dismisses automatically when cursor moves away (handled by _compute)
  const ghostKeymap = cm.state.Prec.high(cm.view.keymap.of([
    {
      key: 'Tab',
      run: view => {
        const plugin = view.plugin(ghostPlugin)
        if (!plugin?._hint) return false
        const { pos, insert } = plugin._hint
        if (view.state.selection.main.head !== pos) return false
        view.dispatch({
          changes: { from: pos, to: pos, insert },
          selection: { anchor: pos },
        })
        return true
      },
    },
  ]))

  return [ghostPlugin, ghostKeymap]
}


// ─── Math.js + Algebrite inline calculator (ghost hint for `expr=`) ─────────
// Lazy-loads mathjs and algebrite. Shows result as ghost text after `=`.
let _mathP = null
function getMathjs() {
  if (_mathP) return _mathP
  _mathP = import('mathjs').then(m => m).catch(() => null)
  return _mathP
}
let _algP = null
function getAlgebrite() {
  if (_algP) return _algP
  _algP = import('algebrite').then(m => m.default || m).catch(() => null)
  return _algP
}

function makeMathCalcPlugin(cm) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view

  class MathGhostWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-ghost-hint cm-math-ghost'
      span.textContent = this.text
      span.setAttribute('aria-hidden', 'true')
      return span
    }
    eq(o) { return o instanceof MathGhostWidget && o.text === this.text }
    ignoreEvent() { return true }
  }

  let mathLib = null
  let algLib = null
  getMathjs().then(m => {
    if (m) {
      try {
        m.import({
          FV: function(rate, nper, pmt, pv) {
            pv = pv || 0
            return pv * Math.pow(1 + rate, nper) + pmt * (Math.pow(1 + rate, nper) - 1) / rate
          },
          PV: function(rate, nper, pmt, fv) {
            fv = fv || 0
            return (pmt * (1 - Math.pow(1 + rate, -nper)) / rate) + fv * Math.pow(1 + rate, -nper)
          },
          PMT: function(rate, nper, pv, fv) {
            fv = fv || 0
            return (pv * rate * Math.pow(1 + rate, nper) + fv * rate) / (Math.pow(1 + rate, nper) - 1)
          },
          NPV: function(rate, ...cashflows) {
            return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t + 1), 0)
          },
        }, { override: false })
      } catch { /* ignore */ }
    }
    mathLib = m
  })
  getAlgebrite().then(a => { algLib = a })

  // Patterns that should go directly to Algebrite (symbolic CAS)
  const CAS_RE = /\b(integral|integrate|roots|solve|factor|expand|taylor|defint|laplace)\b/i

  function evalExpr(expr) {
    // Route CAS-like expressions to Algebrite first
    if (algLib && CAS_RE.test(expr)) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil') return r
      } catch { /* fall through to mathjs */ }
    }
    // Try math.js
    if (mathLib) {
      try {
        const result = mathLib.evaluate(expr)
        if (result === undefined || result === null || typeof result === 'function') return null
        return String(typeof result === 'object' && result.toString ? result.toString() : result)
      } catch { /* fall through to algebrite fallback */ }
    }
    // Algebrite fallback for anything math.js couldn't handle
    if (algLib) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil') return r
      } catch { /* give up */ }
    }
    return null
  }

  const mathPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none; this._hint = null; this._compute(view) }
    update(upd) { if (upd.docChanged || upd.selectionSet) this._compute(upd.view) }
    _compute(view) {
      if (!mathLib && !algLib) { this.deco = Decoration.none; this._hint = null; return }
      const { state } = view
      const cur = state.selection.main
      if (!cur.empty) { this.deco = Decoration.none; this._hint = null; return }
      const line = state.doc.lineAt(cur.head)
      const col = cur.head - line.from
      const textBefore = line.text.slice(0, col)

      const match = textBefore.match(/^(.*?)([^=\n]+)=\s*$/)
      if (!match) { this.deco = Decoration.none; this._hint = null; return }
      let expr = match[2].trim()
      // Strip list prefixes
      expr = expr.replace(/^(?:[-*+]|\d+\.)\s+/, '')
      // Strip markdown formatting
      expr = expr.replace(/[*_~`]+/g, '')
      // Isolate math from surrounding prose:
      // Remove everything before the last occurrence of a math-starting character
      // Math expressions start with digits, parens, minus, or known functions
      const mathStart = expr.match(/((?:(?:sin|cos|tan|log|ln|sqrt|abs|ceil|floor|round|exp|pow|FV|PV|PMT|NPV|integral|solve|factor|expand)\s*\(|[-+]?\s*[\d(]).*$)/i)
      if (mathStart) expr = mathStart[1].trim()
      else {
        // Try to find any part that looks like math (has operators and numbers)
        const mathPart = expr.match(/([\d(][\d\s+\-*/^().,%]*[\d)])\s*$/)
        if (mathPart) expr = mathPart[1].trim()
      }
      // If result is empty or still has long prose, skip
      if (!expr || /^[a-zA-Z]{4,}$/.test(expr)) { this.deco = Decoration.none; this._hint = null; return }

      const result = evalExpr(expr)
      if (!result) { this.deco = Decoration.none; this._hint = null; return }

      const resultStr = ' ' + result
      const builder = new cm.state.RangeSetBuilder()
      try {
        builder.add(cur.head, cur.head, Decoration.widget({ widget: new MathGhostWidget(resultStr), side: 1 }))
      } catch { /* ignore */ }
      this.deco = builder.finish()
      this._hint = { pos: cur.head, insert: resultStr }
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.decorations })

  const mathKeymap = cm.view.keymap.of([{
    key: 'Tab',
    run: view => {
      const plugin = view.plugin(mathPlugin)
      if (!plugin?._hint) return false
      const { pos, insert } = plugin._hint
      if (view.state.selection.main.head !== pos) return false
      view.dispatch({
        changes: { from: pos, to: pos, insert },
        selection: { anchor: pos + insert.length },
      })
      return true
    },
  }])

  return [mathPlugin, mathKeymap]
}

// ─── /table slash command ────────────────────────────────────────────────────
// Typing `/table` or `/table NxM` then Enter inserts a markdown table template.
function makeTableCommand(cm) {
  const { Prec } = cm.state
  return Prec.high(cm.view.keymap.of([{
    key: 'Enter',
    run: (view) => {
      const { state } = view
      const line = state.doc.lineAt(state.selection.main.head)
      const match = line.text.match(/^\s*\/table(?:\s+(\d+)x(\d+))?\s*$/)
      if (!match) return false
      const cols = Math.min(parseInt(match[1]) || 3, 10)
      const rows = Math.min(parseInt(match[2]) || 2, 20)
      const header = '| ' + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(' | ') + ' |'
      const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'
      const row = '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |'
      const table = [header, sep, ...Array(rows).fill(row)].join('\n')
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: table },
        selection: { anchor: line.from + 2 },
      })
      return true
    },
  }]))
}

// ─── Widgets ─────────────────────────────────────────────────────────────────
class HRWidget {
  toDOM() {
    const d = document.createElement('div')
    d.className = 'cm-hr'
    return d
  }
  eq(o) { return o instanceof HRWidget }
  compare(o) { return o instanceof HRWidget }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return 2 }
  coordsAt() { return null }
}

class CheckboxWidget {
  constructor(checked, pos) { this.checked = checked; this.pos = pos }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-cb' + (this.checked ? ' cm-cb-on' : '')
    s.textContent = this.checked ? '✓' : ''
    s.dataset.pos = String(this.pos)
    return s
  }
  eq(o) { return o instanceof CheckboxWidget && o.checked === this.checked && o.pos === this.pos }
  compare(o) { return o instanceof CheckboxWidget && o.checked === this.checked && o.pos === this.pos }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

class ImgWidget {
  constructor(src, alt) { this.src = src; this.alt = alt }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-img-wrap'
    const img = document.createElement('img')
    img.src = this.src; img.alt = this.alt; img.loading = 'lazy'
    img.className = 'cm-img'
    img.onerror = () => {
      img.style.display = 'none'
      const ph = document.createElement('span')
      ph.className = 'cm-img-err'
      ph.textContent = this.alt || this.src || 'image'
      wrap.appendChild(ph)
    }
    wrap.appendChild(img)
    return wrap
  }
  eq(o) { return o instanceof ImgWidget && o.src === this.src }
  compare(o) { return o instanceof ImgWidget && o.src === this.src }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return 160 }
  coordsAt() { return null }
}

// List marker widget — shows styled bullet or number when cursor is off the line
class ListMarkerWidget {
  constructor(text, isOrdered) { this.text = text; this.isOrdered = isOrdered }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.isOrdered ? 'cm-list-marker cm-list-marker-ord' : 'cm-list-marker'
    span.textContent = this.isOrdered ? this.text : '•'
    return span
  }
  eq(w) { return w instanceof ListMarkerWidget && w.text === this.text && w.isOrdered === this.isOrdered }
  compare(w) { return w instanceof ListMarkerWidget && w.text === this.text && w.isOrdered === this.isOrdered }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// MathQuill-backed widget — renders math, clicking opens an inline MathQuill editor
class MathWidget {
  constructor(tex, display, from, to) {
    this.tex = tex
    this.display = display
    this.from = from   // doc position — used to commit edits back
    this.to = to
  }
  toDOM() {
    const wrap = document.createElement(this.display ? 'div' : 'span')
    wrap.className = this.display ? 'cm-math-block cm-math-mq' : 'cm-math-inline cm-math-mq'
    wrap.dataset.latex = this.tex
    wrap.dataset.display = this.display ? '1' : '0'
    wrap.title = 'Click to edit'
    // Render static math immediately
    const staticSpan = document.createElement('span')
    wrap.appendChild(staticSpan)
    renderMathStatic(staticSpan, this.tex, this.display)
    return wrap
  }
  eq(o) { return o instanceof MathWidget && o.tex === this.tex && o.display === this.display }
  compare(o) { return o instanceof MathWidget && o.tex === this.tex && o.display === this.display }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return this.display ? 44 : 22 }
  coordsAt() { return null }
}

class WikiWidget {
  constructor(title, cls, type, id) { this.title = title; this.cls = cls; this.type = type; this.id = id }
  toDOM() {
    const s = document.createElement('span')
    s.className = this.cls
    s.textContent = this.title
    s.dataset.wlType = this.type; s.dataset.wlId = this.id; s.dataset.wlTitle = this.title
    s.title = this.type.startsWith('new') ? `Create: ${this.title}` : `Open ${this.type}`
    return s
  }
  eq(o) { return o instanceof WikiWidget && o.title === this.title && o.cls === this.cls }
  compare(o) { return o instanceof WikiWidget && o.title === this.title && o.cls === this.cls }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

class LinkWidget {
  constructor(text, href) { this.text = text; this.href = href }
  toDOM() {
    const a = document.createElement('a')
    a.className = 'cm-link-widget'
    a.textContent = this.text || this.href
    a.href = this.href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = this.href
    a.addEventListener('click', e => { e.preventDefault(); window.open(this.href, '_blank') })
    return a
  }
  eq(o) { return o instanceof LinkWidget && o.text === this.text && o.href === this.href }
  compare(o) { return o instanceof LinkWidget && o.text === this.text && o.href === this.href }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

// Table widget — renders markdown table as HTML table in live view
class TableWidget {
  constructor(html) { this.html = html }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    wrap.innerHTML = this.html
    return wrap
  }
  eq(o) { return o instanceof TableWidget && o.html === this.html }
  compare(o) { return o instanceof TableWidget && o.html === this.html }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return 80 }
  coordsAt() { return null }
}

// ─── Live preview plugin ──────────────────────────────────────────────────────
function makeLivePlugin(cm, RangeSetBuilder, notebooks, library, sketchbooks = [], flashcardDecks = []) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view
  const { syntaxTree } = cm.language

  // Patch widget classes to extend WidgetType so CM6 properly handles them
  for (const Cls of [HRWidget, CheckboxWidget, ImgWidget, ListMarkerWidget, MathWidget, WikiWidget, LinkWidget, TableWidget]) {
    if (!(Cls.prototype instanceof WidgetType)) {
      Object.setPrototypeOf(Cls.prototype, WidgetType.prototype)
    }
  }

  const PUNCT_NODES = new Set([
    'EmphasisMark', 'HeaderMark', 'CodeMark', 'StrikethroughMark',
    'LinkMark', 'ImageMark', 'QuoteMark', 'TaskMarker',
    'TableDelimiter',
  ])

  const SPAN_MAP = {
    StrongEmphasis: null, // handled specially
    Emphasis:       'cm-lv-i',
    Strikethrough:  'cm-lv-s',
    InlineCode:     'cm-lv-c',
    Highlight:      'cm-lv-hl',
    Link:           'cm-lv-lnk',
    Image:          'cm-lv-lnk',
  }

  const LINE_MAP = {
    ATXHeading1: 'cm-lv-h1', ATXHeading2: 'cm-lv-h2', ATXHeading3: 'cm-lv-h3',
    ATXHeading4: 'cm-lv-h4', ATXHeading5: 'cm-lv-h5', ATXHeading6: 'cm-lv-h6',
  }
  const CODE_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'IndentedCode'])

  // The set of nodes whose marks we want to hide/show as a unit
  const INLINE_ANCESTORS = new Set(['Emphasis','StrongEmphasis','Strikethrough','InlineCode','Link','Image','Highlight'])

  function build(view) {
    const { state } = view
    const cur = state.selection.main.head
    const doc = state.doc
    const inCur = (f, t) => cur >= f && cur <= t

    const inlines  = []
    const lineDecs = []

    try {
      syntaxTree(state).iterate({
        enter(node) {
          const { from, to, name } = node
          if (from >= to) return

          // ── Code block ──────────────────────────────────────────────────
          if (CODE_BLOCKS.has(name)) {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-cb' }) } catch { /**/ }
            }
            return false
          }

          // ── Horizontal rule ─────────────────────────────────────────────
          if (name === 'HorizontalRule') {
            const ln = doc.lineAt(from)
            if (!inCur(ln.from, ln.to)) {
              inlines.push({ from: ln.from, to: ln.to, deco: Decoration.replace({ widget: new HRWidget() }) })
            }
            return false
          }

          // ── Table — render as HTML table when cursor is outside ────────
          if (name === 'Table') {
            const tableText = doc.sliceString(from, to)
            if (!inCur(from, to)) {
              const lines = tableText.split('\n').filter(l => l.trim())
              if (lines.length >= 2) {
                const parseRow = row => {
                  const trimmed = row.trim()
                  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed
                  const end = inner.endsWith('|') ? inner.slice(0, -1) : inner
                  return end.split('|').map(c => c.trim())
                }
                const headers = parseRow(lines[0])
                const sep = lines[1] ? parseRow(lines[1]) : []
                const aligns = sep.map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left')
                const rows = lines.slice(2).filter(l => /\|/.test(l) && !/^[\s|:-]+$/.test(l))
                const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                const thHtml = headers.map((h, i) => `<th style="text-align:${aligns[i]||'left'}">${esc(h)}</th>`).join('')
                const tbHtml = rows.map(r => {
                  const cells = parseRow(r)
                  return `<tr>${cells.map((c, i) => `<td style="text-align:${aligns[i]||'left'}">${esc(c)}</td>`).join('')}</tr>`
                }).join('')
                const html = `<table class="nb-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table>`
                inlines.push({ from, to, deco: Decoration.replace({ widget: new TableWidget(html), block: true }) })
              }
            }
            return false
          }

          // ── Task checkbox ────────────────────────────────────────────────
          if (name === 'TaskMarker') {
            const raw = doc.sliceString(from, to)
            const ck  = /\[[xX]\]/.test(raw)
            if (!inCur(from, to)) {
              inlines.push({ from, to, deco: Decoration.replace({ widget: new CheckboxWidget(ck, from) }) })
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── Image — replace entire image node (not the line) ────────────
          if (name === 'Image') {
            const raw = doc.sliceString(from, to)
            const m   = raw.match(/!\[([^\]]*)\]\(([^\s)]+)/)
            if (m) {
              if (!inCur(from, to)) {
                // Replace only the image syntax, not the whole line
                inlines.push({ from, to, deco: Decoration.replace({ widget: new ImgWidget(m[2], m[1]), block: false }) })
                return false
              }
            }
          }

          // ── Math: inline $…$ and block $$…$$ ───────────────────────────
          if (name === 'InlineMath' || name === 'BlockMath' || name === 'MathSpan') {
            const raw = doc.sliceString(from, to)
            const isBlock = name === 'BlockMath'
            const tex = raw.replace(/^\$+\n?/, '').replace(/\n?\$+$/, '')
            if (!inCur(from, to)) {
              inlines.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(tex, isBlock, from, to) }) })
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── List marker ─────────────────────────────────────────────────
          if (name === 'ListMark') {
            const ln = doc.lineAt(from)
            if (!inCur(ln.from, ln.to)) {
              let isOrdered = false
              let p = node.node.parent
              while (p) {
                if (p.name === 'OrderedList') { isOrdered = true; break }
                if (p.name === 'BulletList') break
                p = p.parent
              }
              const markerText = isOrdered ? doc.sliceString(from, to) : '•'
              inlines.push({ from, to, deco: Decoration.replace({ widget: new ListMarkerWidget(markerText, isOrdered) }) })
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── Heading line decoration ──────────────────────────────────────
          if (LINE_MAP[name]) {
            try { lineDecs.push({ pos: doc.lineAt(from).from, cls: LINE_MAP[name] }) } catch { /**/ }
          }

          // ── Blockquote line decoration ───────────────────────────────────
          if (name === 'Blockquote') {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-bq' }) } catch { /**/ }
            }
          }

          // ── List item: depth + ordered/unordered ─────────────────────────
          if (name === 'ListItem') {
            try {
              const linePos = doc.lineAt(from).from
              let p = node.node.parent
              let depth = 0
              let isOrdered = false
              while (p) {
                if (p.name === 'BulletList' || p.name === 'OrderedList') {
                  if (depth === 0) isOrdered = p.name === 'OrderedList'
                  depth++
                }
                p = p.parent
              }
              const depthCls = `cm-lv-depth-${Math.min(depth, 4)}`
              const cls = isOrdered
                ? `cm-lv-li cm-lv-oli ${depthCls}`
                : `cm-lv-li ${depthCls}`
              lineDecs.push({ pos: linePos, cls })
            } catch { /**/ }
          }

          // ── Inline content span ──────────────────────────────────────────
          // Obsidian approach: marks inside a span are NEVER replaced — they
          // are styled with font-size:0 via cm-lv-p (cursor off) or shown
          // dimly (cursor on). This avoids the RangeSetBuilder overlap-skip
          // issue that causes the opening ** to remain visible.
          if (name === 'StrongEmphasis') {
            const cursorInSpan = inCur(from, to)
            // Check if this contains an Emphasis child (making it bold-italic)
            let hasEmphasis = false
            let child = node.node.firstChild
            while (child) {
              if (child.name === 'Emphasis') { hasEmphasis = true; break }
              child = child.nextSibling
            }
            // Check if there's actual non-whitespace text content between markers
            const rawContent = doc.sliceString(from, to)
            const markerLen = hasEmphasis ? 3 : 2
            const innerText = rawContent.slice(markerLen, rawContent.length - markerLen)
            const hasRealContent = innerText.trim().length > 0

            if (hasRealContent) {
              const cls = hasEmphasis ? 'cm-lv-bi' : 'cm-lv-b'
              inlines.push({ from, to, deco: Decoration.mark({ class: cls }) })

              // Hide ALL EmphasisMark nodes (covers **, ***, etc.)
              child = node.node.firstChild
              while (child) {
                if (child.name === 'EmphasisMark') {
                  inlines.push({
                    from: child.from, to: child.to,
                    deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                  })
                }
                if (child.name === 'Emphasis') {
                  let grandchild = child.firstChild
                  while (grandchild) {
                    if (grandchild.name === 'EmphasisMark') {
                      inlines.push({
                        from: grandchild.from, to: grandchild.to,
                        deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                      })
                    }
                    grandchild = grandchild.nextSibling
                  }
                }
                child = child.nextSibling
              }
            }
            // If no real content, don't hide syntax — show as-is
            return false
          } else if (SPAN_MAP[name] !== undefined) {
            if (SPAN_MAP[name]) {
              const cursorInSpan = inCur(from, to)
              // Check if Emphasis wraps StrongEmphasis (bold-italic: ***text***)
              let emphCls = SPAN_MAP[name]
              if (name === 'Emphasis') {
                let ch = node.node.firstChild
                while (ch) {
                  if (ch.name === 'StrongEmphasis') { emphCls = 'cm-lv-bi'; break }
                  ch = ch.nextSibling
                }
              }
              // Check if there's actual non-whitespace text wrapped
              const rawContent = doc.sliceString(from, to)
              const markLen = name === 'InlineCode' ? 1 : name === 'Strikethrough' || name === 'Highlight' ? 2 : 1
              const innerText = rawContent.slice(markLen, rawContent.length - markLen)
              const hasRealContent = innerText.trim().length > 0 || name === 'Link' || name === 'Image'

              if (!hasRealContent) {
                // No real content — don't format or hide, show syntax as-is
                return false
              }

              inlines.push({ from, to, deco: Decoration.mark({ class: emphCls }) })
              // Hide marks as zero-width (Obsidian style) rather than replace
              let child = node.node.firstChild
              while (child) {
                if (PUNCT_NODES.has(child.name)) {
                  inlines.push({
                    from: child.from, to: child.to,
                    deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                  })
                }
                // Also hide marks inside nested StrongEmphasis (for ***text***)
                if (child.name === 'StrongEmphasis') {
                  let gc = child.firstChild
                  while (gc) {
                    if (gc.name === 'EmphasisMark') {
                      inlines.push({
                        from: gc.from, to: gc.to,
                        deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                      })
                    }
                    gc = gc.nextSibling
                  }
                }
                child = child.nextSibling
              }
              // For Link: replace whole syntax with a widget when cursor is off
              if (name === 'Link' && !cursorInSpan) {
                const raw = doc.sliceString(from, to)
                const lm = raw.match(/^\[([^\]]*)\]\(([^\s)]*)\)$/)
                if (lm) {
                  inlines.push({ from, to, deco: Decoration.replace({ widget: new LinkWidget(lm[1], lm[2]) }) })
                }
              }
              return false
            }
          }

          // ── Heading mark (# ## ### …) hiding ────────────────────────────
          if (name === 'HeaderMark') {
            const ln = doc.lineAt(from)
            const cls = inCur(ln.from, ln.to) ? 'cm-lv-p' : 'cm-lv-hidden'
            inlines.push({ from, to, deco: Decoration.mark({ class: cls }) })
            return false
          }

          // ── Cursor-aware punctuation hiding (inline spans only) ──────────
          // Marks belonging to StrongEmphasis, Emphasis, Link, etc. are already
          // handled in their parent's branch above with return false — this
          // fallback only catches orphaned or unrecognised marks.
          if (PUNCT_NODES.has(name) && name !== 'ListMark' && name !== 'TaskMarker'
              && name !== 'EmphasisMark' && name !== 'HeaderMark'
              && name !== 'LinkMark' && name !== 'ImageMark'
              && name !== 'CodeMark' && name !== 'StrikethroughMark') {
            const parent = node.node.parent
            if (!parent || !INLINE_ANCESTORS.has(parent.name)) return

            let ancestor = parent
            while (ancestor.parent && INLINE_ANCESTORS.has(ancestor.parent.name)) {
              ancestor = ancestor.parent
            }
            const af = ancestor.from
            const at = ancestor.to
            if (inCur(af, at)) {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            } else {
              inlines.push({ from, to, deco: Decoration.replace({}) })
            }
          }
        },
      })
    } catch (e) {
      console.warn('[LivePreview] tree walk error (suppressed):', e?.message)
    }

    // ── Math via regex fallback ───────────────────────────────────────────
    try {
      const full = doc.toString()
      const reBlock = /\$\$([\s\S]*?)\$\$/gm
      let mb
      while ((mb = reBlock.exec(full)) !== null) {
        const bf = mb.index, bt = mb.index + mb[0].length
        const already = inlines.some(d => d.from <= bf && d.to >= bt && d.deco.spec?.widget instanceof MathWidget)
        if (!already) {
          if (!inCur(bf, bt)) {
            inlines.push({ from: bf, to: bt, deco: Decoration.replace({ widget: new MathWidget(mb[1].trim(), true, bf, bt) }) })
          }
        }
      }
      const reInline = /\$([^$\n]+)\$/g
      let mi
      while ((mi = reInline.exec(full)) !== null) {
        const mf = mi.index, mt = mi.index + mi[0].length
        const already = inlines.some(d => d.from <= mf && d.to >= mt && d.deco.spec?.widget instanceof MathWidget)
        if (!already) {
          if (!inCur(mf, mt)) {
            inlines.push({ from: mf, to: mt, deco: Decoration.replace({ widget: new MathWidget(mi[1], false, mf, mt) }) })
          }
        }
      }
    } catch { /**/ }

    // ── Wikilinks via regex (with optional (sketch)/(flash) suffix) ─────
    try {
      const full = doc.toString()
      const re = /\[\[([^\]\n]{1,120})\]\](?:\((sketch|flash)\))?/g
      let m
      while ((m = re.exec(full)) !== null) {
        const wf = m.index, wt = m.index + m[0].length
        const title = m[1].trim()
        const suffix = m[2] // 'sketch', 'flash', or undefined
        const nb = notebooks.find(n => n.title?.toLowerCase() === title.toLowerCase())
        const bk = !nb && library.find(b => b.title?.toLowerCase() === title.toLowerCase())
        const sb = !nb && !bk && sketchbooks.find(s => s.title?.toLowerCase() === title.toLowerCase())
        const fd = !nb && !bk && !sb && flashcardDecks.find(d => d.title?.toLowerCase() === title.toLowerCase())
        if (inCur(wf, wt)) {
          inlines.push({ from: wf, to: wt, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          const forceType = suffix === 'sketch' ? 'new-sketch' : suffix === 'flash' ? 'new-flash' : null
          const type = nb ? 'notebook' : bk ? 'book' : sb ? 'sketchbook' : fd ? 'flashcard' : (forceType || 'new')
          const id   = nb ? nb.id : bk ? bk.id : sb ? sb.id : fd ? fd.id : ''
          const cls  = nb ? 'cm-wl cm-wl-nb' : bk ? 'cm-wl cm-wl-bk' : sb ? 'cm-wl cm-wl-sb' : fd ? 'cm-wl cm-wl-fd' : 'cm-wl cm-wl-new'
          inlines.push({ from: wf, to: wt, deco: Decoration.replace({ widget: new WikiWidget(title, cls, type, id) }) })
        }
      }
    } catch { /**/ }

    // ── Predictive formatting from opening syntax ─────────────────────────
    // When the cursor is on a line with unclosed formatting tokens,
    // apply the formatting class from the opening token to the cursor position
    try {
      const curLine = doc.lineAt(cur)
      const lineText = curLine.text
      const colPos = cur - curLine.from
      const textBeforeCursor = lineText.slice(0, colPos)

      const OPEN_TOKENS = [
        { token: '***', cls: 'cm-lv-bi' },
        { token: '___', cls: 'cm-lv-bi' },
        { token: '**',  cls: 'cm-lv-b' },
        { token: '__',  cls: 'cm-lv-b' },
        { token: '*',   cls: 'cm-lv-i' },
        { token: '_',   cls: 'cm-lv-i' },
        { token: '~~',  cls: 'cm-lv-s' },
        { token: '==',  cls: 'cm-lv-hl' },
      ]

      for (const { token, cls } of OPEN_TOKENS) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const count = (textBeforeCursor.match(new RegExp(escaped, 'g')) || []).length
        if (count % 2 === 1) {
          // Found unclosed opening token — apply formatting from token to cursor
          const lastIdx = textBeforeCursor.lastIndexOf(token)
          if (lastIdx >= 0) {
            // If the character immediately after the opening token is a space,
            // don't treat it as formatting (user rejected formatting)
            const charAfterToken = lineText[lastIdx + token.length]
            if (charAfterToken === ' ' || charAfterToken === undefined) break

            const fmtFrom = curLine.from + lastIdx + token.length
            const fmtTo = cur
            if (fmtFrom < fmtTo) {
              // Check if this range isn't already decorated
              const alreadyDeco = inlines.some(d => d.from <= fmtFrom && d.to >= fmtTo && d.deco.spec?.class === cls)
              if (!alreadyDeco) {
                inlines.push({ from: fmtFrom, to: fmtTo, deco: Decoration.mark({ class: cls }) })
                // Also dim the opening token
                const tokenFrom = curLine.from + lastIdx
                const tokenTo = tokenFrom + token.length
                inlines.push({ from: tokenFrom, to: tokenTo, deco: Decoration.mark({ class: 'cm-lv-p' }) })
              }
            }
          }
          break // only match the first (longest) unclosed token
        }
      }
    } catch { /**/ }

    // ── Sort and build ────────────────────────────────────────────────────
    inlines.sort((a, b) => a.from !== b.from ? a.from - b.from : b.to - a.to)

    const sb = new RangeSetBuilder()
    let lastReplTo = -1
    for (const { from, to, deco } of inlines) {
      if (from < 0 || to > doc.length || from >= to) continue
      const isReplace = !!deco.spec?.widget
      if (isReplace && from < lastReplTo) continue
      try {
        sb.add(from, to, deco)
        if (isReplace) lastReplTo = to
      } catch { /**/ }
    }

    lineDecs.sort((a, b) => a.pos - b.pos)
    const lb = new RangeSetBuilder()
    const seen = new Set()
    for (const { pos, cls } of lineDecs) {
      const k = `${pos}:${cls}`
      if (seen.has(k)) continue; seen.add(k)
      try { lb.add(pos, pos, Decoration.line({ class: cls })) } catch { /**/ }
    }

    return { spans: sb.finish(), lines: lb.finish() }
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        try { const r = build(view); this.decorations = r.spans; this.lineDecos = r.lines }
        catch { this.decorations = Decoration.none; this.lineDecos = Decoration.none }
      }
      update(upd) {
        if (upd.docChanged || upd.selectionSet || upd.viewportChanged) {
          try { const r = build(upd.view); this.decorations = r.spans; this.lineDecos = r.lines }
          catch { /**/ }
        }
      }
    },
    {
      decorations: v => v.decorations,
      provide: plugin => [
        cm.view.EditorView.decorations.of(v => {
          try { return v.plugin(plugin)?.lineDecos ?? Decoration.none }
          catch { return Decoration.none }
        }),
      ],
    }
  )
}

// ─── Checkbox click handler (live mode) ──────────────────────────────────────
function makeCheckboxHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target
      if (!el.classList.contains('cm-cb')) return false
      const pos = parseInt(el.dataset.pos || '0', 10)
      if (!pos && el.dataset.pos !== '0') return false
      try {
        const line = view.state.doc.lineAt(pos)
        const txt  = line.text
        const newTxt = /\[[xX]\]/.test(txt)
          ? txt.replace(/\[[xX]\]/, '[ ]')
          : txt.replace(/\[ \]/, '[x]')
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newTxt } })
        e.preventDefault()
        return true
      } catch { return false }
    },
  })
}

// ─── Wikilink click handler (live mode) ──────────────────────────────────────
function makeWikiHandler(cm, onNavRef) {
  return cm.view.EditorView.domEventHandlers({
    click(e) {
      const el = e.target.closest('.cm-wl')
      if (!el) return false
      const fn = typeof onNavRef === 'function' ? onNavRef : onNavRef?.current
      if (fn) fn(el.dataset.wlTitle, el.dataset.wlType, el.dataset.wlId)
      e.preventDefault(); return true
    },
    mousedown(e) {
      // Also handle mousedown for replace-decoration widgets where click may not fire
      const el = e.target.closest('.cm-wl')
      if (!el) return false
      e.preventDefault()
      const fn = typeof onNavRef === 'function' ? onNavRef : onNavRef?.current
      if (fn) fn(el.dataset.wlTitle, el.dataset.wlType, el.dataset.wlId)
      return true
    },
  })
}

// ─── Math click → inline MathQuill editing ───────────────────────────────────
function makeMathClickHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    click(e, view) {
      const el = e.target.closest('.cm-math-mq')
      if (!el) return false

      const latex   = el.dataset.latex ?? ''
      const display = el.dataset.display === '1'

      // Build overlay anchored to the widget position
      const rect = el.getBoundingClientRect()

      const overlay = document.createElement('div')
      overlay.className = 'nb-math-editor-overlay'
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 6}px;
        left: ${rect.left - 8}px;
        min-width: ${Math.max(rect.width + 16, 160)}px;
        background: var(--surface, #161b22);
        border: 1.5px solid var(--accent, #388bfd);
        border-radius: 8px;
        padding: 6px 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
      `

      const mqSpan = document.createElement('span')
      mqSpan.style.cssText = 'display:inline-block; min-width:60px; flex:1;'
      overlay.appendChild(mqSpan)

      const doneBtn = document.createElement('button')
      doneBtn.textContent = '✓'
      doneBtn.style.cssText = `
        background: var(--accent, #388bfd); color: #fff;
        border: none; border-radius: 5px; padding: 2px 8px;
        cursor: pointer; font-size: 12px; flex-shrink: 0;
      `
      overlay.appendChild(doneBtn)

      document.body.appendChild(overlay)

      getMQ().then(MQ => {
        if (!MQ) { overlay.remove(); return }

        let mqField = null
        try {
          mqField = MQ.MathField(mqSpan, {
            spaceBehavesLikeTab: true,
            handlers: { enter: commit },
          })
          mqField.latex(latex)
          mqField.focus()
        } catch {
          overlay.remove()
          return
        }

        function commit() {
          if (!mqField) return
          const newLatex = mqField.latex()
          overlay.remove()
          // Find the original syntax in the document and replace it
          const docStr = view.state.doc.toString()
          const wrap = display ? `$$${latex}$$` : `$${latex}$`
          const idx = docStr.indexOf(wrap)
          if (idx >= 0) {
            const newWrap = display ? `$$${newLatex}$$` : `$${newLatex}$`
            view.dispatch({ changes: { from: idx, to: idx + wrap.length, insert: newWrap } })
          }
          view.focus()
        }

        doneBtn.onclick = commit

        const handleKey = (ev) => {
          if (ev.key === 'Escape') { overlay.remove(); view.focus(); document.removeEventListener('keydown', handleKey) }
        }
        document.addEventListener('keydown', handleKey)

        const handleOutside = (ev) => {
          if (!overlay.contains(ev.target)) {
            commit()
            document.removeEventListener('mousedown', handleOutside)
            document.removeEventListener('keydown', handleKey)
          }
        }
        setTimeout(() => document.addEventListener('mousedown', handleOutside), 80)
      })

      return true
    }
  })
}

// ─── View mode button ─────────────────────────────────────────────────────────
const VIEW_MODE_CYCLE = ['live', 'source', 'preview']
const IconSrc = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
    <path d="M3.5 13.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const IconPrev = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
)
const IconLive = () => (
  <svg width="15" height="15" viewBox="0 0 32 32" fill="none">
    <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    <path d="M26 3C25 6 22 10 16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
    <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55" />
  </svg>
)
const MODE_META = {
  live:    { icon: <IconLive />, label: 'Live',    title: 'Live preview' },
  source:  { icon: <IconSrc />,  label: 'Source',  title: 'Source mode' },
  preview: { icon: <IconPrev />, label: 'Preview', title: 'Reading view' },
}

function ViewModeBtn({ viewMode, setViewMode }) {
  const [phase,    setPhase]    = useState('visible')
  const [shown,    setShown]    = useState(viewMode)
  const [dropOpen, setDropOpen] = useState(false)
  const holdTimer = useRef(null)
  const didLong   = useRef(false)
  const wrapRef   = useRef(null)
  const prevRef   = useRef(viewMode)

  useEffect(() => {
    const prev = prevRef.current; prevRef.current = viewMode
    if (prev === viewMode) return
    const t0 = setTimeout(() => setPhase('exiting'),  0)
    const t1 = setTimeout(() => { setShown(viewMode); setPhase('entering') }, 150)
    const t2 = setTimeout(() => setPhase('visible'),  300)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
  }, [viewMode])

  useEffect(() => {
    if (!dropOpen) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  return (
    <div style={{ position:'relative', flexShrink:0 }} ref={wrapRef}>
      <button style={{ width:30, height:30, background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--textDim)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'background .12s,color .12s' }}
        title={MODE_META[viewMode].title}
        onMouseDown={() => { didLong.current=false; holdTimer.current=setTimeout(()=>{ didLong.current=true; setDropOpen(d=>!d) },300) }}
        onMouseUp={() => clearTimeout(holdTimer.current)}
        onMouseLeave={() => clearTimeout(holdTimer.current)}
        onClick={() => { if(didLong.current)return; setViewMode(VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(viewMode)+1)%3]); setDropOpen(false) }}
      >
        <span style={{ display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .18s,transform .18s', ...(phase==='exiting'?{opacity:0,transform:'scale(.6) rotate(-15deg)',position:'absolute'}:phase==='entering'?{opacity:0,transform:'scale(.6) rotate(15deg)'}:{opacity:1,transform:'none'}) }}>
          {MODE_META[shown].icon}
        </span>
      </button>
      {dropOpen && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.45)', minWidth:130, zIndex:9300, animation:'vm-drop .12s cubic-bezier(.4,0,.2,1)' }}>
          {VIEW_MODE_CYCLE.map(m => (
            <button key={m} onMouseDown={e => { e.preventDefault(); setViewMode(m); setDropOpen(false) }}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', border:'none', background:'none', width:'100%', cursor:'pointer', textAlign:'left', fontSize:13, fontFamily:'inherit', color: viewMode===m?'var(--accent)':'var(--text)', transition:'background .08s' }}>
              {MODE_META[m].icon}
              <span style={{ flex:1, fontWeight:500 }}>{MODE_META[m].label}</span>
              {viewMode===m && <span style={{ fontSize:11, opacity:.7 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NotebookView
// ─────────────────────────────────────────────────────────────────────────────
export default function NotebookView() {
  const themeKey        = useAppStore(s => s.themeKey ?? 'dark')
  const notebook       = useAppStore(s => s.activeNotebook)
  const notebooks      = useAppStore(s => s.notebooks)
  const updateNotebook = useAppStore(s => s.updateNotebook)
  const setView        = useAppStore(s => s.setView)
  const updateTab      = useAppStore(s => s.updateTab)
  const activeTabId    = useAppStore(s => s.activeTabId)
  const library        = useAppStore(s => s.library)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const addNotebook    = useAppStore(s => s.addNotebook)

  const notebookId    = notebook?.id
  const notebookTitle = notebook?.title || ''

  const [viewMode,  setVM]       = useState('live')
  const [content,   setContent]  = useState('')
  const [noteTitle, setTitle]    = useState('')
  const [loaded,    setLoaded]   = useState(false)
  const [, setSaving]            = useState(false)
  const [findQ,     setFindQ]    = useState('')
  const [findCount, setFindCount]= useState(0)
  const [findCurD,  setFindCurD] = useState(0)
  const [editModal, setEditModal]= useState(false)

  const editorRef  = useRef(null)
  const cmRef      = useRef(null)
  const cmMods     = useRef(null)
  const saveTimer  = useRef(null)
  const saveVisT   = useRef(null)
  const contentRef = useRef('')
  const titleRef   = useRef('')
  const findRef    = useRef(null)
  const previewRef = useRef(null)
  const hitsRef    = useRef([])
  const hitIdxRef  = useRef(0)
  const loadedFor  = useRef(null)
  const wikiNavRef = useRef(null)
  const [wikiDrop, setWikiDrop] = useState(null) // { options, selectedIdx, coords }

  contentRef.current = content
  titleRef.current   = noteTitle

  const isLoaded = loaded && loadedFor.current === notebookId

  const previewHtml = useMemo(
    () => renderMarkdown(content, notebooks, library, sketchbooks, flashcardDecks),
    [content, notebooks, library, sketchbooks, flashcardDecks]
  )

  // Hydrate MathQuill after preview renders
  useEffect(() => {
    if (viewMode !== 'preview' || !previewRef.current) return
    hydrateMathNodes(previewRef.current)
  }, [viewMode, previewHtml])

  // Pre-load KaTeX and MathQuill so they're ready when live mode starts
  useEffect(() => { getKaTeX(); getMQ() }, [])

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!notebookId) return
    let gone = false
    setLoaded(false)
    loadNotebookContent(notebookId).then(raw => {
      if (gone) return
      let text  = typeof raw === 'string' ? raw : ''
      let title = notebookTitle
      const hm  = text.match(/^# (.+)\n/)
      if (hm) { title = hm[1]; text = text.slice(hm[0].length) }
      titleRef.current = title; setTitle(title)
      contentRef.current = text; setContent(text)
      setLoaded(true)
      loadedFor.current = notebookId
    })
    return () => { gone = true }
  }, [notebookId, notebookTitle])

  // ── Wikilink navigation ───────────────────────────────────────────────────
  const handleWikiNav = useCallback((title, type, id) => {
    // Always read fresh state from the store to avoid stale closures
    const s = useAppStore.getState()
    const tabId = s.activeTabId
    const nbs = s.notebooks || []
    const lib = s.library || []
    const sbs = s.sketchbooks || []
    const fds = s.flashcardDecks || []
    if (type === 'notebook') {
      const nb = nbs.find(n => n.id === id)
      if (nb) { s.setActiveNotebook(nb); s.updateTab(tabId, { view: 'notebook' }); s.setView('notebook') }
      else createAndOpenItem(title, 'notebook')
    } else if (type === 'book') {
      const bk = lib.find(b => b.id === id)
      if (bk) {
        const v = bk.format === 'audiofolder' || bk.format === 'audio' ? 'audio-player' : (bk.format === 'pdf' ? 'pdf' : 'reader')
        s.setActiveBook(bk); s.updateTab(tabId, { view: v }); s.setView(v)
      }
    } else if (type === 'sketchbook') {
      const sb = sbs.find(n => n.id === id)
      if (sb) { s.setActiveSketchbook(sb); s.updateTab(tabId, { view: 'sketchbook' }); s.setView('sketchbook') }
    } else if (type === 'flashcard') {
      const deck = fds.find(d => d.id === id)
      if (deck) { s.setActiveFlashcardDeck(deck); s.updateTab(tabId, { view: 'flashcard' }); s.setView('flashcard') }
    } else if (type === 'new-sketch') {
      createAndOpenItem(title, 'sketchbook')
    } else if (type === 'new-flash') {
      createAndOpenItem(title, 'flashcard')
    } else {
      createAndOpenItem(title, 'notebook')
    }
  }, [setView]) // eslint-disable-line react-hooks/exhaustive-deps
  wikiNavRef.current = handleWikiNav

  function createAndOpenItem(title, kind) {
    const s = useAppStore.getState()
    const tabId = s.activeTabId
    const now = new Date().toISOString()
    if (kind === 'sketchbook') {
      const newSb = { id: makeId('sb'), title, createdAt: now, updatedAt: now, _isSketchbook: true }
      s.addSketchbook?.(newSb)
      s.persistSketchbooks?.()
      s.setActiveSketchbook(newSb)
      s.updateTab(tabId, { view: 'sketchbook' })
      s.setView('sketchbook')
    } else if (kind === 'flashcard') {
      const newFd = { id: makeId('fd'), title, createdAt: now, updatedAt: now, cards: [] }
      s.addDeck?.(newFd)
      s.persistFlashcardDecks?.()
      s.setActiveFlashcardDeck(newFd)
      s.updateTab(tabId, { view: 'flashcard' })
      s.setView('flashcard')
    } else {
      const newNb = { id: makeId('nb'), title, createdAt: now, updatedAt: now, wordCount: 0 }
      s.addNotebook?.(newNb) || addNotebook(newNb)
      s.persistNotebooks?.()
      s.setActiveNotebook(newNb)
      s.updateTab(tabId, { view: 'notebook' })
      s.setView('notebook')
    }
  }

  // ── Mount CodeMirror ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !editorRef.current || viewMode === 'preview') return
    let dead = false

    loadCM().then(cm => {
      if (dead || !editorRef.current) return
      cmMods.current = cm
      const {
        state: { EditorState, RangeSetBuilder },
        view: { EditorView, drawSelection, dropCursor, keymap, placeholder },
        commands: { defaultKeymap, indentWithTab, history, historyKeymap },
        language: { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap },
        langMd, lezerMd,
        search: { search: searchExt, searchKeymap },
      } = cm

      const isLive = viewMode === 'live'
      const gfmExts = lezerMd?.GFM ? [lezerMd.GFM] : [lezerMd?.Strikethrough, lezerMd?.Table, lezerMd?.TaskList].filter(Boolean)

      const extensions = [
        makeTheme(cm),
        syntaxHighlighting(makeHighlight(cm)),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        drawSelection(), dropCursor(),
        indentOnInput(), bracketMatching(), history(),
        langMd.markdown({ extensions: gfmExts }),
        // Wikilink dropdown (custom React-driven — bypasses CM6 autocompletion)
        ...makeWikiDropdownPlugin(cm, notebooks, library, sketchbooks, flashcardDecks, setWikiDrop),
        searchExt({ top: false }),
        makeFormatKeys(cm),
        // /table slash command — inserts markdown table template (must be before smartEnter)
        makeTableCommand(cm),
        makeSmartEnter(cm),
        // Pair auto-wrap via input handler
        makePairInputHandler(cm),
        // Ghost hint — Tab to accept, any other key dismisses
        ...makeGhostHintPlugin(cm),
        // Math.js inline calculator — shows result after `expr=`
        ...makeMathCalcPlugin(cm),
        ...(isLive ? [
          makeLivePlugin(cm, RangeSetBuilder, notebooks, library, sketchbooks, flashcardDecks),
          makeCheckboxHandler(cm),
          makeWikiHandler(cm, wikiNavRef),
          makeMathClickHandler(cm),
        ] : []),
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { flushSave(); return true } },
          { key: 'Mod-f', run: () => { findRef.current?.focus(); findRef.current?.select(); return true } },
        ]),
        EditorView.updateListener.of(upd => {
          if (dead || !upd.docChanged) return
          const t = upd.state.doc.toString()
          contentRef.current = t; setContent(t); scheduleSave(t)
        }),
        EditorView.lineWrapping,
        placeholder('Create something…'),
        // Image drag-and-drop + paste handler
        EditorView.domEventHandlers({
          drop(e, view) {
            const files = e.dataTransfer?.files
            if (!files?.length) return false
            const imgFile = Array.from(files).find(f => f.type.startsWith('image/'))
            if (!imgFile || !notebook?.id) return false
            e.preventDefault()
            const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
            ;(async () => {
              const buf = new Uint8Array(await imgFile.arrayBuffer())
              const fname = `${Date.now()}_${imgFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
              const relPath = await saveNotebookImage(notebook.id, fname, buf)
              if (relPath) {
                const md = `![${imgFile.name}](${relPath})`
                view.dispatch({ changes: { from: dropPos, insert: md } })
              }
            })()
            return true
          },
          paste(e, view) {
            const items = e.clipboardData?.items
            if (!items) return false
            // If clipboard has text, let the default paste handle it
            const hasText = Array.from(items).some(i => i.type === 'text/plain')
            if (hasText) return false
            const imgItem = Array.from(items).find(i => i.type.startsWith('image/'))
            if (!imgItem || !notebook?.id) return false
            const blob = imgItem.getAsFile()
            if (!blob) return false
            e.preventDefault()
            // Handle async image save without blocking — already prevented default
            ;(async () => {
              const buf = new Uint8Array(await blob.arrayBuffer())
              const fname = `${Date.now()}_paste.${blob.type.split('/')[1] || 'png'}`
              const relPath = await saveNotebookImage(notebook.id, fname, buf)
              if (relPath) {
                const pos = view.state.selection.main.head
                const md = `![pasted image](${relPath})`
                view.dispatch({ changes: { from: pos, insert: md } })
              }
            })()
            return true  // synchronously return true — we've already called preventDefault
          },
        }),
      ]

      if (cmRef.current) { cmRef.current.destroy(); cmRef.current = null }
      const state = EditorState.create({ doc: contentRef.current, extensions })
      const view  = new EditorView({ state, parent: editorRef.current })
      cmRef.current = view
      view.focus()
    })

    return () => {
      dead = true
      if (cmRef.current) { cmRef.current.destroy(); cmRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, viewMode, notebook?.id])

  // ── Save ──────────────────────────────────────────────────────────────────
  const animateSave = useCallback(() => {
    const el = document.getElementById('nb-save-icon')
    if (!el) return
    el.classList.remove('anim', 'vis', 'closing'); void el.offsetWidth
    el.classList.add('anim', 'vis')
    clearTimeout(saveVisT.current)
    saveVisT.current = setTimeout(() => {
      el.classList.remove('anim')
      el.classList.add('closing')
      saveVisT.current = setTimeout(() => el.classList.remove('vis', 'closing'), 450)
    }, 600)
  }, [])

  const doSave = useCallback(async (text, title) => {
    if (!notebook) return
    setSaving(true)
    await saveNotebookContent(notebook, title ? `# ${title}\n${text}` : text)
    const wc = (text.match(/\b\w+\b/g) || []).length
    updateNotebook(notebook.id, { updatedAt: new Date().toISOString(), wordCount: wc, title: title || notebook.title })
    useAppStore.getState().persistNotebooks?.()
    setSaving(false); animateSave()
  }, [notebook, updateNotebook, animateSave])

  const scheduleSave = useCallback(text => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(text, titleRef.current), 800)
  }, [doSave])

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    doSave(contentRef.current, titleRef.current)
  }, [doSave])

  // ── Ctrl+F ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault(); findRef.current?.focus(); findRef.current?.select()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Tauri native file drop (Finder drag-and-drop) ───────────────────────────
  useEffect(() => {
    if (!notebook?.id) return
    const unlisteners = []

    const handleDrop = async (event) => {
      const payload = event.payload
      // Tauri 2 drag-drop payload: { paths: string[], position: {x,y} }
      const paths = payload?.paths || (Array.isArray(payload) ? payload : null)
      if (!paths?.length || !cmRef.current) return
      const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
      for (const p of paths) {
        if (!IMG_EXT.test(p)) continue
        try {
          let buf
          try {
            // Use Rust command to read file bytes — bypasses FS scope restrictions
            const { invoke } = await import('@tauri-apps/api/core')
            const bytes = await invoke('copy_file_bytes', { source: p })
            buf = new Uint8Array(bytes)
          } catch {
            try {
              const data = await readFile(p)
              buf = data instanceof Uint8Array ? data : new Uint8Array(data)
            } catch {
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const url = convertFileSrc(p)
              const resp = await fetch(url)
              buf = new Uint8Array(await resp.arrayBuffer())
            }
          }
          const name = p.split('/').pop().split('\\').pop()
          const fname = `${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
          const relPath = await saveNotebookImage(notebook.id, fname, buf)
          if (relPath) {
            const pos = cmRef.current.state.selection.main.head
            const md = `![${name}](${relPath})\n`
            cmRef.current.dispatch({ changes: { from: pos, insert: md } })
          }
        } catch (err) { console.warn('[Gnos] File drop error:', p, err) }
      }
    }

    // Tauri 2 drag-drop events
    listen('tauri://drag-drop', handleDrop).then(u => unlisteners.push(u))
    listen('tauri://file-drop', handleDrop).then(u => unlisteners.push(u)).catch(() => {})

    return () => { unlisteners.forEach(u => u?.()) }
  }, [notebook?.id])

  // ── Find in preview / live ──────────────────────────────────────────────────
  function doFind(q) {
    // Live mode — use CodeMirror's built-in search highlighting
    if (viewMode === 'live' && cmRef.current && cmMods.current) {
      const searchMod = cmMods.current.search
      const view = cmRef.current
      if (!q) {
        view.dispatch({ effects: searchMod.setSearchQuery.of(new searchMod.SearchQuery({ search: '' })) })
        setFindCount(0); setFindCurD(0)
        hitsRef.current = []; return
      }
      const query = new searchMod.SearchQuery({ search: q, caseSensitive: false })
      view.dispatch({ effects: searchMod.setSearchQuery.of(query) })
      // Count matches by iterating the query cursor
      const cursor = query.getCursor(view.state.doc)
      let count = 0
      while (!cursor.next().done) count++
      hitsRef.current = Array(count) // placeholder array for length
      hitIdxRef.current = 0
      setFindCount(count)
      setFindCurD(0)
      if (count > 0) searchMod.findNext(view)
      return
    }

    // Preview mode — DOM text search
    const el = previewRef.current
    if (!el || !q) {
      el?.querySelectorAll('mark.nb-fhl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)))
      hitsRef.current = []; return
    }
    el.querySelectorAll('mark.nb-fhl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)))
    el.normalize()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const hits = []; let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi')
      let m, last = 0; const frags = []
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frags.push(document.createTextNode(text.slice(last, m.index)))
        const mark = document.createElement('mark'); mark.className = 'nb-fhl'; mark.textContent = m[0]
        frags.push(mark); hits.push(mark); last = m.index + m[0].length
      }
      if (frags.length) {
        if (last < text.length) frags.push(document.createTextNode(text.slice(last)))
        node.parentNode?.replaceChild(frags.reduce((f, n2) => { const df = document.createDocumentFragment(); df.appendChild(f instanceof DocumentFragment ? f : (() => { const ff = document.createDocumentFragment(); ff.appendChild(f); return ff })()) ; df.appendChild(n2); return df }, document.createDocumentFragment()), node)
      }
    }
    hitsRef.current = hits; hitIdxRef.current = 0
    setFindCount(hits.length); setFindCurD(0)
    if (hits[0]) { hits[0].classList.add('nb-fhl-a'); hits[0].scrollIntoView({ block:'center', behavior:'smooth' }) }
  }

  function findNav(dir) {
    // Live mode — use CodeMirror findNext / findPrevious
    if (viewMode === 'live' && cmRef.current && cmMods.current) {
      const searchMod = cmMods.current.search
      const view = cmRef.current
      if (dir > 0) searchMod.findNext(view)
      else searchMod.findPrevious(view)
      hitIdxRef.current = (hitIdxRef.current + dir + findCount) % Math.max(findCount, 1)
      setFindCurD(hitIdxRef.current)
      return
    }
    // Preview mode
    const hits = hitsRef.current
    if (!hits.length) return
    hits[hitIdxRef.current]?.classList.remove('nb-fhl-a')
    hitIdxRef.current = (hitIdxRef.current + dir + hits.length) % hits.length
    setFindCurD(hitIdxRef.current)
    hits[hitIdxRef.current]?.classList.add('nb-fhl-a')
    hits[hitIdxRef.current]?.scrollIntoView({ block:'center', behavior:'smooth' })
  }

  const wordCount = useMemo(() => (content.match(/\b\w+\b/g) || []).length, [content])

  const switchMode = useCallback((m) => {
    if (m === viewMode) return
    if (cmRef.current) {
      const t = cmRef.current.state.doc.toString()
      contentRef.current = t; setContent(t)
    }
    setVM(m)
  }, [viewMode])

  const handlePreviewClick = useCallback(e => {
    const wl = e.target.closest('[data-wl-type]')
    if (wl) handleWikiNav(wl.dataset.wlTitle, wl.dataset.wlType, wl.dataset.wlId)
    const cb = e.target.closest('.nb-cb')
    if (cb && previewRef.current) {
      const ti = parseInt(cb.dataset.ti, 10)
      const lines = contentRef.current.split('\n')
      let taskIdx = 0
      const newLines = lines.map(l => {
        if (!/^\s*[-*+]\s\[[ xX]\]/.test(l)) return l
        if (taskIdx++ !== ti) return l
        return /\[[xX]\]/.test(l) ? l.replace(/\[[xX]\]/, '[ ]') : l.replace(/\[ \]/, '[x]')
      })
      const newContent = newLines.join('\n')
      contentRef.current = newContent; setContent(newContent)
      scheduleSave(newContent)
    }
  }, [handleWikiNav, scheduleSave])

  // ─── CSS ──────────────────────────────────────────────────────────────────
  const CSS = `
    /* ── KaTeX theming ─────────────────────────────────── */
    .katex { color: var(--text) !important; font-size: 1.05em; }
    .katex-display { margin: 0.4em 0 !important; }
    .katex-display > .katex { color: var(--text) !important; }

    /* ── MathQuill / KaTeX ─────────────────────────────── */
    .mq-math-mode { color: var(--text) !important; }
    .mq-root-block, .mq-math-mode * { font-family: 'KaTeX_Main', 'Times New Roman', serif !important; }
    @keyframes vm-drop { from{opacity:0;transform:translateY(-6px) scale(.96)} to{opacity:1;transform:none} }

    /* ── Light-mode selection fix ──────────────────────── */
    .nb-root ::selection { background: var(--nb-sel, rgba(56,139,253,0.28)); }
    [data-theme="light"] .nb-root, .light .nb-root { --nb-sel: rgba(9,105,218,0.22); }

    /* ══════════════════════════════════════════════════════
       SHARED PROSE VARIABLES
       Both live and preview inherit these so typography
       is controlled from one place.
    ══════════════════════════════════════════════════════ */
    .nb-root {
      --nb-fs:   15px;
      --nb-lh:   1.8;
      --nb-ff:   Georgia, serif;
      --nb-max:  780px;
      --nb-px:   48px;
      --nb-py:   28px;
      --nb-color: var(--readerText, var(--text));
      --nb-h1: 1.7em; --nb-h2: 1.4em; --nb-h3: 1.15em;
      --nb-h4: 1.05em; --nb-h5: 0.95em; --nb-h6: 0.88em;
      --nb-para-gap: 0.72em;
      /* ── Syntax color palette — defaults, overridden per-theme below ── */
      --nb-bold-color:     var(--text);
      --nb-italic-color:   var(--accent);
      --nb-strike-color:   var(--textDim);
      --nb-h1-color:       var(--text);
      --nb-h2-color:       var(--text);
      --nb-h3-color:       var(--text);
      --nb-h4-color:       var(--text);
      --nb-h5-color:       var(--text);
      --nb-h6-color:       var(--text);
      --nb-quote-color:    var(--textDim);
      --nb-quote-bg:       transparent;
      --nb-quote-border:   var(--accent);
      --nb-link-color:     var(--accent);
      --nb-wikilink-color: var(--accent);
      --nb-hl-bg:          rgba(210,153,34,.28);
      --nb-code-color:     var(--accent);
      --nb-code-bg:        rgba(56,139,253,.12);
    }

    /* ── CM host ───────────────────────────────────────── */
    .nb-cm { flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; }
    .nb-cm .cm-editor { height:100%; flex:1; }
    .nb-cm .cm-scroller { padding: var(--nb-py) 0 60px; box-sizing:border-box; overflow-x: hidden; overflow-y: auto; }
    .nb-cm .cm-content {
      max-width: var(--nb-max); margin: 0 auto;
      padding: 0 var(--nb-px);
      box-sizing: border-box; width: 100%;
      font-family: var(--nb-ff);
      font-size: var(--nb-fs);
      line-height: var(--nb-lh);
      color: var(--nb-color);
    }
    .nb-cm .cm-line { padding: 0; min-height: calc(var(--nb-fs) * var(--nb-lh)); }
    /* Blank lines between paragraphs get the right rhythm */
    .nb-cm .cm-line:empty { min-height: 0.5em; }
    .nb-cm .cm-placeholder { color:var(--textDim); opacity:.45; }

    /* ── Hidden syntax markers (Obsidian style — font-size:0 not replace) ── */
    .nb-live .cm-lv-hidden {
      font-size: 0 !important;
      line-height: 0 !important;
      display: inline-block;
      width: 0;
      overflow: hidden;
    }

    /* ══════════════════════════════════════════════════════
       LIVE VIEW — line-level class decorations
       These must match the .nb-prev selectors exactly.
    ══════════════════════════════════════════════════════ */

    /* Headings — weight, size, rhythm identical to preview */
    .nb-live .cm-lv-h1 {
      font-size: var(--nb-h1); font-weight: 700; line-height: 1.25;
      font-family: var(--nb-ff); color: var(--nb-h1-color);
      margin-top: 0; padding-top: 0.4em; padding-bottom: 0.1em;
    }
    .nb-live .cm-lv-h2 {
      font-size: var(--nb-h2); font-weight: 700; line-height: 1.3;
      font-family: var(--nb-ff); color: var(--nb-h2-color);
      padding-top: 0.35em; padding-bottom: 0.1em;
    }
    .nb-live .cm-lv-h3 {
      font-size: var(--nb-h3); font-weight: 600; line-height: 1.4; color: var(--nb-h3-color);
      padding-top: 0.3em;
    }
    .nb-live .cm-lv-h4 { font-size: var(--nb-h4); font-weight: 600; color: var(--nb-h4-color); }
    .nb-live .cm-lv-h5 { font-size: var(--nb-h5); font-weight: 600; color: var(--nb-h5-color); }
    .nb-live .cm-lv-h6 { font-size: var(--nb-h6); font-weight: 600; opacity:.65; color: var(--nb-h6-color); }

    /* Inline formats — exact match to preview */
    .nb-live .cm-lv-b  { font-weight:700; color: var(--nb-bold-color); }
    .nb-live .cm-lv-i  { font-style:italic; color: var(--nb-italic-color); }
    .nb-live .cm-lv-bi { font-weight:700; font-style:italic; color: var(--nb-bi-color); }
    .nb-live .cm-lv-s  { text-decoration:line-through; opacity:.75; color: var(--nb-strike-color); }
    .nb-live .cm-lv-c  {
      font-family: SF Mono,Menlo,Consolas,monospace; font-size:.87em;
      background: var(--nb-code-bg); border-radius:4px; padding:1px 4px; color: var(--nb-code-color);
    }
    .nb-live .cm-lv-lnk { color: var(--nb-link-color); text-decoration:underline; text-underline-offset:2px; }
    .nb-live .cm-lv-hl  { background: var(--nb-hl-bg); border-radius:2px; padding:0 2px; }

    /* Blockquote — left border + italic + dim, matching preview */
    .nb-live .cm-lv-bq {
      border-left: 3px solid var(--nb-quote-border);
      padding-left: 14px;
      color: var(--nb-quote-color);
      background: var(--nb-quote-bg);
      margin-left: 0;
      font-style: italic;
    }

    /* Code block lines — monospace, slightly dimmed bg */
    .nb-live .cm-lv-cb {
      background: var(--surfaceAlt);
      font-family: SF Mono,Menlo,Consolas,monospace;
      font-size: .87em;
      padding: 0 8px;
      border-radius: 3px;
      color: var(--text);
    }

    /* ── Visible syntax markers when cursor is on them ── */
    .nb-live .cm-lv-p  { opacity: 0.32; color: var(--textDim); font-size: .88em; }

    /* Heading # shown dim when cursor on that line */
    .nb-live .cm-lv-h1 .cm-lv-p,
    .nb-live .cm-lv-h2 .cm-lv-p,
    .nb-live .cm-lv-h3 .cm-lv-p,
    .nb-live .cm-lv-h4 .cm-lv-p,
    .nb-live .cm-lv-h5 .cm-lv-p,
    .nb-live .cm-lv-h6 .cm-lv-p {
      color: var(--accent); opacity: 0.45; font-size: 0.68em;
      vertical-align: middle; font-weight: 400;
    }
    /* Bold markers shown */
    .nb-live .cm-lv-b  .cm-lv-p,
    .nb-live .cm-lv-bi .cm-lv-p { color: var(--nb-bold-color); font-weight:700; opacity: 0.38; font-size: 1em; }
    /* Italic markers shown */
    .nb-live .cm-lv-i  .cm-lv-p { color: var(--nb-italic-color); font-style:italic; opacity: 0.42; font-size: 1em; }
    /* Code markers shown */
    .nb-live .cm-lv-c  .cm-lv-p { color: var(--accent); opacity: 0.45; font-size: 1em; }
    /* Strikethrough shown */
    .nb-live .cm-lv-s  .cm-lv-p { color: var(--textDim); opacity: 0.42; font-size: 1em; }
    /* Highlight shown */
    .nb-live .cm-lv-hl .cm-lv-p { color: #d29922; opacity: 0.48; font-size: 1em; }
    /* Link markers shown */
    .nb-live .cm-lv-lnk .cm-lv-p { color: var(--accent); opacity: 0.42; font-size: 1em; }

    /* ── Widgets ─────────────────────────────────────── */
    /* HR widget */
    .cm-hr  { display:block; height:1px; background:var(--border); margin:8px 0; width:100%; pointer-events:none; }

    /* Image widget */
    .cm-img-wrap { display:block; margin:6px 0; line-height:0; }
    .cm-img { max-width:100%; max-height:340px; border-radius:6px; object-fit:contain; display:block; box-shadow:0 2px 12px rgba(0,0,0,.2); }
    .cm-img-err { display:inline-block; padding:4px 8px; background:var(--surfaceAlt); border:1px dashed var(--border); border-radius:4px; font-size:12px; color:var(--textDim); }

    /* Checkbox widget */
    .cm-cb  { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border:1.5px solid var(--border); border-radius:3px; font-size:9px; vertical-align:middle; margin-right:5px; cursor:pointer; flex-shrink:0; color:transparent; transition:background .1s; }
    .cm-cb-on { background:var(--accent); border-color:var(--accent); color:#fff; }

    /* Wikilink widget */
    .cm-wl { color:var(--nb-wikilink-color,var(--accent)); border-bottom:1px solid var(--nb-wikilink-color,var(--accent)); cursor:pointer; border-radius:2px; padding:0 1px; }
    .cm-wl:hover { opacity:.8; }
    .cm-wl-new { color:var(--textDim); border-bottom-color:var(--textDim); opacity:.75; }

    /* Link widget — rendered as a proper anchor when cursor is off it */
    .cm-link-widget {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
      border-radius: 2px;
      padding: 0 1px;
    }
    .cm-link-widget:hover { opacity: .75; }

    /* Math widgets */
    .cm-math-mq { cursor: pointer; padding: 0 2px; }
    .cm-math-inline {
      display:inline-block; vertical-align:middle;
      color:var(--text); cursor:pointer;
      padding: 0 2px;
    }
    .cm-math-inline:hover { background: rgba(56,139,253,.1); border-radius:3px; }
    .cm-math-block {
      display:block; text-align:center; margin:0.5em 0;
      overflow-x:auto; color:var(--text); padding:4px 0;
      cursor:pointer;
    }
    .cm-math-block:hover { background: rgba(56,139,253,.06); border-radius:4px; }

    /* ── Table widget in live view ── */
    .cm-table-wrap { margin: 0.5em 0; overflow-x: auto; }
    .cm-table-wrap table.nb-table { border-collapse:collapse; width:100%; font-size:.93em; }
    .cm-table-wrap table.nb-table th,.cm-table-wrap table.nb-table td { border:1px solid var(--border); padding:6px 10px; }
    .cm-table-wrap table.nb-table th { background:var(--surfaceAlt); font-weight:600; }

    /* ── Wiki dropdown rendered by React (positioned fixed) ── */

    /* ── Live list items ── */
    .nb-live .cm-lv-li { position: relative; }
    .cm-list-marker {
      display: inline; color: var(--textDim); margin-right: 0.2em;
    }
    .cm-list-marker-ord { font-weight: 600; color: var(--text); opacity: 0.6; }

    /* ══════════════════════════════════════════════════════
       PREVIEW — identical typography to live
    ══════════════════════════════════════════════════════ */
    .nb-prev {
      flex: 1; overflow: auto;
      padding: var(--nb-py) var(--nb-px);
      font-size: var(--nb-fs);
      line-height: var(--nb-lh);
      font-family: var(--nb-ff);
      color: var(--nb-color);
      max-width: var(--nb-max); margin: 0 auto; width: 100%;
      box-sizing: border-box;
    }
    /* Headings — match live exactly */
    .nb-prev h1 { font-size:var(--nb-h1); font-weight:700; margin:1.15em 0 .45em; font-family:var(--nb-ff); color:var(--nb-h1-color); line-height:1.25; }
    .nb-prev h2 { font-size:var(--nb-h2); font-weight:700; margin:1.1em 0 .4em;  font-family:var(--nb-ff); color:var(--nb-h2-color); line-height:1.3; }
    .nb-prev h3 { font-size:var(--nb-h3); font-weight:600; margin:1em 0 .35em;   color:var(--nb-h3-color); line-height:1.4; }
    .nb-prev h4 { font-size:var(--nb-h4); font-weight:600; margin:.9em 0 .3em;   color:var(--nb-h4-color); }
    .nb-prev h5 { font-size:var(--nb-h5); font-weight:600; margin:.85em 0 .25em; color:var(--nb-h5-color); }
    .nb-prev h6 { font-size:var(--nb-h6); font-weight:600; margin:.8em 0 .25em;  color:var(--nb-h6-color); opacity:.65; }
    .nb-prev p  { margin: 0 0 var(--nb-para-gap); }
    .nb-prev blockquote {
      border-left: 3px solid var(--nb-quote-border); margin: .8em 0; padding: 8px 14px;
      color: var(--nb-quote-color); border-radius: 0 4px 4px 0;
      background: var(--nb-quote-bg); font-style: italic;
    }
    .nb-prev pre.nb-pre { background:var(--surfaceAlt); border:1px solid var(--border); border-radius:8px; padding:14px 16px; overflow-x:auto; margin:.8em 0; }
    .nb-prev code { font-family:SF Mono,Menlo,Consolas,monospace; font-size:.87em; }
    .nb-ic { background:var(--nb-code-bg); border-radius:4px; padding:1px 5px; font-family:SF Mono,Menlo,Consolas,monospace; font-size:.87em; color:var(--nb-code-color); }
    .nb-prev table.nb-table { border-collapse:collapse; width:100%; margin:.8em 0; font-size:.93em; }
    .nb-prev table.nb-table th,.nb-prev table.nb-table td { border:1px solid var(--border); padding:6px 10px; }
    .nb-prev table.nb-table th { background:var(--surfaceAlt); font-weight:600; }
    .nb-prev ul,.nb-prev ol { margin:0 0 .75em; padding-left:1.8em; }
    .nb-prev li { margin-bottom:.25em; }
    .nb-prev ul ul,.nb-prev ol ol,.nb-prev ul ol,.nb-prev ol ul { margin:.2em 0; padding-left:1.4em; }
    .nb-prev ul.nb-tl { list-style:none; padding-left:.4em; }
    .nb-prev li.nb-task { display:flex; gap:8px; align-items:baseline; cursor:pointer; }
    .nb-prev li.nb-task:hover { opacity:.85; }
    .nb-prev .nb-cb { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border:1.5px solid var(--border); border-radius:3px; font-size:10px; flex-shrink:0; cursor:pointer; user-select:none; transition:background .1s,border-color .1s; }
    .nb-prev li.checked .nb-cb { background:var(--accent); border-color:var(--accent); color:#fff; }
    .nb-prev li.checked>span:last-child { text-decoration:line-through; opacity:.55; }
    .nb-hl { background:var(--nb-hl-bg); border-radius:2px; padding:0 2px; }
    /* Inline text formats — match live */
    .nb-bold   { font-weight:700; color:var(--nb-bold-color); }
    .nb-italic { font-style:italic; color:var(--nb-italic-color); }
    .nb-strike { text-decoration:line-through; color:var(--nb-strike-color); opacity:.75; }
    .nb-sup    { font-size:.75em; vertical-align:super; color:var(--nb-link-color); }
    .nb-sub    { font-size:.75em; vertical-align:sub;   color:var(--nb-link-color); }
    .wikilink     { border-bottom:1px solid var(--nb-wikilink-color); cursor:pointer; color:var(--nb-wikilink-color); }
    .wikilink:hover { opacity:.8; }
    .wikilink-new { color:var(--textDim); border-bottom-color:var(--textDim); }
    /* Images in preview */
    .nb-img {
      max-width:100%; max-height:500px; border-radius:6px;
      margin:.75em 0; display:block; object-fit:contain;
      box-shadow:0 2px 12px rgba(0,0,0,.2);
    }
    .nb-img[src=""],
    .nb-img:not([src]) { display: none; }
    .nb-prev a { color:var(--nb-link-color); text-decoration:underline; }
    .nb-prev hr { border:none; border-top:1px solid var(--border); margin:1.2em 0; }
    /* MathQuill static display in preview */
    .nb-math { display:inline-block; }
    .nb-math-block { display:block; text-align:center; margin:1em 0; overflow-x:auto; }
    .nb-math-mq .mq-root-block { color: var(--text) !important; }
    .nb-fn-ref sup { font-size:.75em; }
    .nb-fn-ref a { color:var(--accent); text-decoration:none; }
    .nb-fn-def { font-size:12px; color:var(--textDim); padding:4px 0; border-top:1px solid var(--borderSubtle); margin-top:8px; }
    .nb-fn-back { color:var(--accent); text-decoration:none; margin-left:4px; }
    .nb-fns { margin-top:2em; }
    mark.nb-fhl { background:rgba(210,153,34,.4); border-radius:2px; padding:0 1px; }
    /* ── Ghost hint ─────────────────────────────────────── */
    .cm-ghost-hint {
      color: var(--textDim);
      opacity: 0.35;
      font-style: italic;
      pointer-events: none;
      user-select: none;
    }
    mark.nb-fhl-a { background:rgba(56,139,253,.5); outline:2px solid var(--accent); }

    /* ── Progress bar / misc ───────────────────────────── */
    .nb2-fb { background:none; border:none; color:var(--textDim); cursor:pointer; border-radius:5px; padding:3px 7px; font-size:11px; font-family:inherit; transition:background .1s,color .1s; }
    .nb2-fb:hover { background:var(--surfaceAlt); color:var(--text); }
    .nb2-fc { font-size:16px; opacity:.6; background:none; border:none; cursor:pointer; color:var(--textDim); padding:0 4px; line-height:1; }
    .nb2-fc:hover { opacity:1; }

    /* ── Save indicator animation ──────────────────────── */
    .nb-save-indicator { display:flex; align-items:center; opacity:1; transition:opacity .3s; }
    .nb-save-icon { width:18px; height:18px; color:var(--accent); }
    .nb-save-icon.vis { opacity:1; }
    .nb-save-ring { stroke-dasharray:47; stroke-dashoffset:47; transition:stroke-dashoffset 0s; }
    .nb-save-icon.anim .nb-save-ring { stroke-dashoffset:0; transition:stroke-dashoffset 0.3s ease; }
    .nb-save-check { stroke-dasharray:12; stroke-dashoffset:12; transition:stroke-dashoffset 0s; }
    .nb-save-icon.anim .nb-save-check { stroke-dashoffset:0; transition:stroke-dashoffset 0.15s ease 0.25s; }
    .nb-save-icon.closing .nb-save-check { stroke-dashoffset:12; transition:stroke-dashoffset 0.15s ease; }
    .nb-save-icon.closing .nb-save-ring { stroke-dashoffset:47; transition:stroke-dashoffset 0.3s ease 0.1s; }
  `


  // ── Per-theme syntax colors — derived from known theme palettes ───────────
  // Derived directly from themes.js exact palette values
  const THEME_SYNTAX = {
    dark: {
      italic:'#79b8ff', bold:'#f0883e', bi:'#d2a8ff', h1:'#e6edf3', h2:'#79b8ff', h3:'#56d4dd',
      h4:'#b392f0', h5:'#f97583', h6:'#8b949e',
      quote:'#8b949e', quoteBg:'rgba(56,139,253,.07)', quoteBorder:'#388bfd',
      link:'#58a6ff', wiki:'#58a6ff', hl:'rgba(255,212,59,.35)',
      code:'#e2c08d', codeBg:'rgba(255,218,120,.10)',
      strike:'#f85149',
    },
    sepia: {
      italic:'#b06830', bold:'#c44d2a', bi:'#a05020', h1:'#3b2f20', h2:'#9b5430', h3:'#b87340',
      h4:'#8a6040', h5:'#7a5030', h6:'#7a6652',
      quote:'#7a6652', quoteBg:'rgba(139,94,60,.09)', quoteBorder:'#8b5e3c',
      link:'#8b5e3c', wiki:'#a0714e', hl:'rgba(210,170,60,.45)',
      code:'#9b5e3c', codeBg:'rgba(139,94,60,.15)',
      strike:'#c0392b',
    },
    light: {
      italic:'#0550ae', bold:'#9a3412', bi:'#6639a6', h1:'#1f2328', h2:'#0550ae', h3:'#0969da',
      h4:'#8250df', h5:'#cf222e', h6:'#636c76',
      quote:'#636c76', quoteBg:'rgba(9,105,218,.05)', quoteBorder:'#0969da',
      link:'#0550ae', wiki:'#0860c7', hl:'rgba(255,212,0,.55)',
      code:'#0550ae', codeBg:'rgba(9,105,218,.12)',
      strike:'#cf222e',
    },
    moss: {
      italic:'#2d8a2d', bold:'#b5651d', bi:'#5a8a1d', h1:'#2a3320', h2:'#2d8a2d', h3:'#4a9a3f',
      h4:'#6a8c3f', h5:'#3d6934', h6:'#5a7048',
      quote:'#5a7048', quoteBg:'rgba(74,124,63,.08)', quoteBorder:'#4a7c3f',
      link:'#2d8a2d', wiki:'#3d6934', hl:'rgba(180,220,80,.45)',
      code:'#2d8a2d', codeBg:'rgba(74,124,63,.15)',
      strike:'#d44040',
    },
    cherry: {
      italic:'#ff7eb3', bold:'#f5a623', bi:'#ff5c8a', h1:'#f2dde1', h2:'#ff5c8a', h3:'#ff7eb3',
      h4:'#d88ca0', h5:'#f07090', h6:'#9e6d76',
      quote:'#9e6d76', quoteBg:'rgba(224,92,122,.09)', quoteBorder:'#e05c7a',
      link:'#ff5c8a', wiki:'#f07090', hl:'rgba(255,100,140,.30)',
      code:'#ff7eb3', codeBg:'rgba(255,126,179,.15)',
      strike:'#f85149',
    },
    sunset: {
      italic:'#ffb347', bold:'#e84855', bi:'#ff8c42', h1:'#f5e6c8', h2:'#ffa020', h3:'#ffb347',
      h4:'#e8b060', h5:'#f0a840', h6:'#a07840',
      quote:'#a07840', quoteBg:'rgba(232,146,42,.09)', quoteBorder:'#e8922a',
      link:'#ffa020', wiki:'#f0a840', hl:'rgba(255,170,40,.35)',
      code:'#ffb347', codeBg:'rgba(255,179,71,.15)',
      strike:'#e84855',
    },
  }
  const tc = THEME_SYNTAX[themeKey] || THEME_SYNTAX.dark
  const THEME_CSS = `
    .nb-root {
      --nb-bold-color:     ${tc.bold || 'var(--text)'};
      --nb-bi-color:       ${tc.bi || tc.bold || 'var(--text)'};
      --nb-italic-color:   ${tc.italic};
      --nb-strike-color:   ${tc.strike || 'var(--textDim)'};
      --nb-h1-color:       ${tc.h1};
      --nb-h2-color:       ${tc.h2};
      --nb-h3-color:       ${tc.h3};
      --nb-h4-color:       ${tc.h4 || tc.h3};
      --nb-h5-color:       ${tc.h5 || tc.h3};
      --nb-h6-color:       ${tc.h6 || 'var(--textDim)'};
      --nb-quote-color:    ${tc.quote};
      --nb-quote-bg:       ${tc.quoteBg};
      --nb-quote-border:   ${tc.quoteBorder};
      --nb-link-color:     ${tc.link};
      --nb-wikilink-color: ${tc.wiki};
      --nb-hl-bg:          ${tc.hl};
      --nb-code-color:     ${tc.code};
      --nb-code-bg:        ${tc.codeBg};
    }
  `

  return (
    <div className="nb-root" style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--readerBg, var(--bg))', color:'var(--text)', position:'relative' }}>
      <style>{CSS}</style>
      <style>{THEME_CSS}</style>

      {/* ── Header — flex: [nav] [save + search (centered)] [mode + settings] ── */}
      <header className="nb-header gnos-header">
        {/* Far left: nav button */}
        <div style={{ display:'flex', alignItems:'center', flex:'0 0 auto', minWidth:0 }}>
          <GnosNavButton />
        </div>

        {/* Center: save indicator + search bar (centered) */}
        <div style={{ display:'flex', alignItems:'center', flex:'1 1 0', minWidth:0, gap:8, margin:'0 8px', justifyContent:'center' }}>
          <div className="nb-save-indicator" style={{ flexShrink:0 }}>
            <svg id="nb-save-icon" className="nb-save-icon" viewBox="0 0 18 18" fill="none">
              <circle className="nb-save-ring" cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              <polyline className="nb-save-check" points="5.5,9 7.8,11.5 12.5,6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ flex:'0 1 520px', minWidth:0 }}>
            <div className={`search-bar${findQ?' focused':''}`} style={{ background:'var(--surfaceAlt)' }}
              onClick={() => findRef.current?.focus()}>
              <svg className="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input ref={findRef} id="nb-search-input"
                style={{ background:'none', border:'none', color:'var(--text)', outline:'none', fontSize:13, flex:1, minWidth:0 }}
                placeholder={noteTitle || notebook?.title || 'Find…'} value={findQ}
                onChange={e => { setFindQ(e.target.value); doFind(e.target.value) }}
                onKeyDown={e => {
                  if (e.key==='Enter') { e.preventDefault(); findNav(e.shiftKey?-1:1) }
                  if (e.key==='Escape') { setFindQ(''); doFind('') }
                }}
              />
              {findQ ? (
                <span style={{ fontSize:11, color:'var(--textDim)', whiteSpace:'nowrap', marginRight:4 }}>
                  {findCount>0?`${findCurD+1}/${findCount}`:'Not found'}
                </span>
              ) : (
                <span style={{ fontSize:11, color:'var(--textDim)', whiteSpace:'nowrap', paddingLeft:8, flexShrink:0 }}>
                  {wordCount.toLocaleString()} words
                </span>
              )}
              {findQ && (
                <>
                  <button className="nb2-fb" onClick={() => findNav(-1)} title="Previous">↑</button>
                  <button className="nb2-fb" onClick={() => findNav(1)}  title="Next">↓</button>
                  <button className="nb2-fc" onClick={() => { setFindQ(''); doFind('') }} title="Clear">×</button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Far right: view mode + settings */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flex:'0 0 auto' }}>
          <ViewModeBtn viewMode={viewMode} setViewMode={switchMode} />
          <button onClick={() => setEditModal(true)} title="Syntax reference"
            style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--textDim)', cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.3 3.3l.7.7M12 12l.7.7M12 3.3l-.7.7M4 12l-.7.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      {!isLoaded ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:'var(--textDim)', fontSize:13 }}>
          <div className="spinner" />Loading…
        </div>
      ) : viewMode === 'preview' ? (
        <div style={{ flex:1, overflow:'auto', background:'var(--readerBg,var(--bg))' }}>
          {noteTitle && (
            <div style={{ maxWidth:780, margin:'0 auto', padding:'28px 48px 0', fontFamily:'Georgia,serif', fontSize:'1.7em', fontWeight:700, color:'var(--text)', lineHeight:1.2 }}>
              {noteTitle}
            </div>
          )}
          <div ref={previewRef} className="nb-prev" onClick={handlePreviewClick}
            dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      ) : (
        <div style={{ flex:1, overflow:'auto', display:'flex', flexDirection:'column', position:'relative', background:'var(--readerBg,var(--bg))' }}>
          {/* Title input — same padding as CM content area */}
          <div style={{ maxWidth:780, margin:'0 auto', width:'100%', padding:'24px 48px 0', boxSizing:'border-box' }}>
            <input value={noteTitle}
              onChange={e => { const t=e.target.value; setTitle(t); titleRef.current=t; scheduleSave(contentRef.current) }}
              placeholder="Title…"
              style={{ width:'100%', background:'none', border:'none', outline:'none', fontFamily:'Georgia,serif', fontSize:'1.7em', fontWeight:700, color:'var(--text)', lineHeight:1.2, padding:0, caretColor:'var(--accent)' }}
              onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();cmRef.current?.focus()} }}
            />
          </div>
          {/* Divider */}
          <div style={{ maxWidth:780, margin:'4px auto 0', width:'100%', padding:'0 48px', boxSizing:'border-box', pointerEvents:'none' }}>
            <div style={{ height:1, background:'var(--borderSubtle)', opacity:.5 }} />
          </div>
          {/* CodeMirror */}
          <div ref={editorRef} className={`nb-cm${viewMode==='live'?' nb-live':''}`} style={{ flex:1, overflow:'hidden', minHeight:0 }} />
          {/* Wiki-link dropdown */}
          {wikiDrop && wikiDrop.coords && (
            <div className="nb-wiki-dropdown" style={{
              position: 'fixed',
              left: Math.min(wikiDrop.coords.left, window.innerWidth - 370),
              top: Math.min(wikiDrop.coords.top, window.innerHeight - 340),
              zIndex: 9999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              padding: 6,
              minWidth: 260,
              maxWidth: 360,
              maxHeight: 320,
              overflow: 'auto',
            }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {wikiDrop.options.map((opt, i) => (
                  <li key={`${opt.detail}-${opt.label}-${i}`}
                    onMouseDown={e => {
                      e.preventDefault()
                      // Confirm this option
                      const view = cmRef.current
                      if (view) {
                        const state = view.state
                        const cur = state.selection.main.head
                        const line = state.doc.lineAt(cur)
                        const col = cur - line.from
                        const textBefore = line.text.slice(0, col)
                        const idx = textBefore.lastIndexOf('[[')
                        if (idx !== -1) {
                          view.dispatch({ changes: { from: line.from + idx, to: cur, insert: opt.insert } })
                        }
                      }
                      setWikiDrop(null)
                    }}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 8,
                      margin: '1px 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      transition: 'background 0.08s',
                      background: i === wikiDrop.selectedIdx ? 'rgba(56,139,253,0.18)' : 'transparent',
                      color: i === wikiDrop.selectedIdx ? 'var(--accent)' : 'var(--text)',
                    }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                    <span style={{ fontSize: 12, opacity: 0.65, flexShrink: 0, paddingLeft: 8 }}>{opt.detail}</span>
                  </li>
                ))}
              </ul>
              <div style={{
                padding: '5px 12px 6px',
                fontSize: 10.5,
                color: 'var(--textDim)',
                opacity: 0.65,
                borderTop: '1px solid var(--borderSubtle)',
                marginTop: 4,
                textAlign: 'center',
                letterSpacing: '0.01em',
              }}>Tab to confirm · Esc to dismiss</div>
            </div>
          )}
        </div>
      )}

      {editModal && <SyntaxPanel onClose={() => setEditModal(false)} />}
    </div>
  )
}

// ─── Syntax reference panel ───────────────────────────────────────────────────
function SyntaxPanel({ onClose }) {
  const SECS = [
    { title:'Inline Formatting', rows:[
      {k:'**bold**',d:'Bold'},{k:'*italic*',d:'Italic'},
      {k:'***bold italic***',d:'Bold + italic'},{k:'~~strike~~',d:'Strikethrough'},
      {k:'==highlight==',d:'Highlight'},{k:'`code`',d:'Inline code'},
      {k:'^sup^',d:'Superscript'},{k:'~sub~',d:'Subscript'},
      {k:'[text](url)',d:'Hyperlink'},{k:'![alt](url)',d:'Image'},
    ]},
    { title:'Headings', rows:[
      {k:'# H1',d:'Heading 1'},{k:'## H2',d:'Heading 2'},{k:'### H3',d:'Heading 3'},
      {k:'#### H4',d:'H4'},{k:'##### H5',d:'H5'},{k:'###### H6',d:'H6'},
    ]},
    { title:'Blocks', rows:[
      {k:'> text',d:'Blockquote'},{k:'> [!NOTE]',d:'Callout'},
      {k:'- item',d:'Unordered list'},{k:'1. item',d:'Ordered list'},
      {k:'  - nested',d:'Nested list (2 spaces)'},{k:'- [ ] task',d:'Task item'},
      {k:'- [x] done',d:'Checked task (clickable)'},{k:'```lang',d:'Code block'},
      {k:'---',d:'Horizontal rule'},{k:'| a | b |',d:'Table'},
      {k:'[^1]: note',d:'Footnote definition'},
      {k:'$math$',d:'Inline math (MathQuill — click to edit)'},
      {k:'$$\nmath\n$$',d:'Math block (MathQuill — click to edit)'},
    ]},
    { title:'Wikilinks', rows:[
      {k:'[[Title]]',d:'Link to note or book'},
      {k:'Type [[',d:'Dropdown — up to 4 suggestions'},
      {k:'Click link',d:'Opens; creates missing notes'},
    ]},
    { title:'Auto-wrap Pairs', rows:[
      {k:'Select text → type **',d:'Wraps selection with **…**'},
      {k:'Select text → type *',d:'Wraps selection with *…*'},
      {k:'Select text → type `',d:'Wraps selection with `…`'},
      {k:'Select text → type ~~',d:'Wraps selection with ~~…~~'},
      {k:'Select text → type ==',d:'Wraps selection with ==…=='},
      {k:'Select text → type $',d:'Wraps selection with $…$'},
    ]},
    { title:'Shortcuts', rows:[
      {k:'Ctrl+B',d:'Bold'},{k:'Ctrl+I',d:'Italic'},{k:'Ctrl+K',d:'Link'},
      {k:'Ctrl+E',d:'Code'},{k:'Ctrl+Shift+H',d:'Highlight'},
      {k:'Ctrl+S',d:'Save'},{k:'Ctrl+F',d:'Find'},
      {k:'Tab',d:'Indent list'},{k:'Enter',d:'Smart list continue'},
    ]},
  ]
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:620, maxWidth:'94vw', maxHeight:'70vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.55)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 12px', borderBottom:'1px solid var(--borderSubtle)', flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>Syntax Reference</span>
          <button onClick={onClose} title="Close" style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}} onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}><svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 1l7 7M8 1l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></button>
        </div>
        <div style={{ overflow:'auto', padding:'14px 20px 20px' }}>
          {SECS.map(sec => (
            <div key={sec.title} style={{ marginBottom:18 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--textDim)', opacity:.6, marginBottom:8 }}>{sec.title}</div>
              {sec.rows.map(({k,d}) => (
                <div key={k} style={{ display:'flex', alignItems:'baseline', gap:12, padding:'4px 0', borderBottom:'1px solid var(--borderSubtle)' }}>
                  <code style={{ fontFamily:'SF Mono,Menlo,Consolas,monospace', fontSize:11, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:5, padding:'2px 8px', color:'var(--accent)', flexShrink:0, minWidth:130, display:'inline-block' }}>{k}</code>
                  <span style={{ fontSize:12, color:'var(--textDim)' }}>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}