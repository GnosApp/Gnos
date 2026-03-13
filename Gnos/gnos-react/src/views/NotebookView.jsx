/* NotebookView.jsx — Markdown editor powered by CodeMirror 6
 *
 * Fixes vs previous version
 * ──────────────────────────
 * • Live preview now VISUALLY RENDERS formatting (bold → bold font weight,
 *   italics → italic, headings → larger text, code → monospace bg, etc.)
 *   using Decoration.mark with CSS classes, matching Obsidian's behaviour.
 *   Markdown punctuation is still hidden off-cursor-line, but the text itself
 *   is styled in-place.
 * • Sync bug fixed: CM is always initialised from contentRef.current (the
 *   latest in-memory text) so switching live↔source never loses edits.
 * • Heading line style now sets the entire line font-size, not just the
 *   heading token, so the line height is correct in live mode.
 * • Task-list checkboxes rendered as styled replacements via WidgetType.
 * • Wikilinks rendered as styled spans in live mode.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadNotebookContent, saveNotebookContent } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'


// ─── CodeMirror lazy loader ───────────────────────────────────────────────────
let _cmPromise = null
function loadCM() {
  if (_cmPromise) return _cmPromise
  _cmPromise = Promise.all([
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
  return _cmPromise
}

// ─── Markdown utilities ───────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineHtml(text, notebooks = [], library = []) {
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const codeSpans = [], images = [], links = []
  const S = '\x02', E = '\x03'
  s = s.replace(/!\[([^\]]*)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)/g,
    (_, alt, url, title) => { images.push({ alt, url, title: title||'' }); return S+'IMG'+(images.length-1)+E })
  s = s.replace(/\[([^\]]+)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)/g,
    (_, txt, url, title) => { links.push({ txt, url, title: title||'' }); return S+'LNK'+(links.length-1)+E })
  s = s.replace(/``([^`]+)``/g, (_,c) => { codeSpans.push(c); return S+'CODE'+(codeSpans.length-1)+E })
  s = s.replace(/`([^`]+)`/g,   (_,c) => { codeSpans.push(c); return S+'CODE'+(codeSpans.length-1)+E })
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/___(.+?)___/g,        '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*(.+?)\*\*/g,      '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g,         '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+)\*/g,      '<em>$1</em>')
  s = s.replace(/_([^_\n]+)_/g,        '<em>$1</em>')
  s = s.replace(/~~(.+?)~~/g,           '<del>$1</del>')
  s = s.replace(/==(.+?)==/g,           '<mark class="nb-hl">$1</mark>')
  s = s.replace(/\^([^^\s]+)\^/g,      '<sup>$1</sup>')
  s = s.replace(/~([^~\s]+)~/g,        '<sub>$1</sub>')
  const emojiMap = {
    joy:'😂',smile:'😊',thumbsup:'👍',heart:'❤️',fire:'🔥',star:'⭐',check:'✅',
    x:'❌',warning:'⚠️',info:'ℹ️',rocket:'🚀',tada:'🎉',eyes:'👀',ok:'👌',
    wave:'👋',clap:'👏',muscle:'💪',thinking:'🤔',exploding_head:'🤯',zap:'⚡',
    bulb:'💡',book:'📚',pencil:'✏️',gear:'⚙️',link:'🔗',lock:'🔒',key:'🔑',
    search:'🔍',calendar:'📅',clock:'🕐',pin:'📌',flag:'🚩',sun:'☀️',moon:'🌙',
    snowflake:'❄️',coffee:'☕',
  }
  s = s.replace(/:([a-z_]+):/g, (m, name) => emojiMap[name] || m)
  s = s.replace(new RegExp(S+'CODE(\\d+)'+E,'g'), (_,i) => `<code class="nb-inline-code">${esc(codeSpans[+i])}</code>`)
  s = s.replace(new RegExp(S+'IMG(\\d+)'+E,'g'),  (_,i) => { const {alt,url,title}=images[+i]; return `<img src="${esc(url)}" alt="${esc(alt)}"${title?` title="${esc(title)}"`:''} class="nb-img" loading="lazy">` })
  s = s.replace(new RegExp(S+'LNK(\\d+)'+E,'g'),  (_,i) => { const {txt,url,title}=links[+i]; return `<a href="${esc(url)}" target="_blank" rel="noopener"${title?` title="${esc(title)}"`:''} >${txt}</a>` })
  s = s.replace(/\[\[([^\]]{1,120})\]\]/g, (_,title) => {
    const t = title.trim()
    const nb = notebooks.find(n => n.title?.toLowerCase()===t.toLowerCase())
    const bk = !nb && library.find(b => b.title?.toLowerCase()===t.toLowerCase())
    const type = nb ? 'notebook' : bk ? 'book' : 'unresolved'
    const id = nb ? nb.id : bk ? bk.id : ''
    return `<span class="wikilink wikilink-${type}" data-wl-type="${type}" data-wl-id="${esc(id)}" data-wl-title="${esc(t)}">${esc(t)}</span>`
  })
  return s
}

function detectBlockType(raw) {
  const f = raw.split('\n')[0]
  if (/^#{6}\s/.test(f)) return 'h6'
  if (/^#{5}\s/.test(f)) return 'h5'
  if (/^#{4}\s/.test(f)) return 'h4'
  if (/^#{3}\s/.test(f)) return 'h3'
  if (/^#{2}\s/.test(f)) return 'h2'
  if (/^#\s/.test(f))    return 'h1'
  if (/^```/.test(f) || /^~~~/.test(f)) return 'code'
  if (/^- \[[ xX]\]/.test(f) || /^\* \[[ xX]\]/.test(f)) return 'tasklist'
  if (/^[-*+]\s/.test(f)) return 'ul'
  if (/^\d+\.\s/.test(f)) return 'ol'
  if (/^>\s?/.test(f))    return 'blockquote'
  if (/^---+$|^\*\*\*+$|^___+$/.test(f.trim())) return 'hr'
  if (/^\|/.test(f))      return 'table'
  return 'p'
}

function blockToHtml(raw, notebooks = [], library = []) {
  const type = detectBlockType(raw)
  const il = t => inlineHtml(t, notebooks, library)
  if (type === 'hr') return '<hr>'
  if (type === 'code') {
    const fl   = raw.split('\n')[0]
    const lang = fl.replace(/^```|^~~~/,'').trim()
    const body = raw.replace(/^(```|~~~)[^\n]*\n?/,'').replace(/(```|~~~)\s*$/,'')
    return `<pre class="nb-code${lang?' lang-'+esc(lang):''}"><code>${esc(body)}</code></pre>`
  }
  if (type === 'blockquote') {
    const lines = raw.split('\n').map(l => l.replace(/^>\s?/,''))
    const joined = lines.join('\n').trim()
    const calloutM = joined.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|DANGER|QUESTION|QUOTE)\](.*)(\n[\s\S]*)?$/i)
    if (calloutM) {
      const kind = calloutM[1].toUpperCase()
      const title = calloutM[2].trim() || kind.charAt(0)+kind.slice(1).toLowerCase()
      const body = calloutM[3]?.trim() || ''
      const colors = {NOTE:'#388bfd',TIP:'#3fb950',IMPORTANT:'#a371f7',WARNING:'#d29922',CAUTION:'#f85149',INFO:'#388bfd',SUCCESS:'#3fb950',DANGER:'#f85149',QUESTION:'#a371f7',QUOTE:'#8b949e'}
      const c = colors[kind] || '#388bfd'
      return `<div class="nb-callout" style="border-left:3px solid ${c};background:${c}18;padding:10px 14px;border-radius:0 6px 6px 0;margin:0.6em 0"><div style="font-weight:700;color:${c};margin-bottom:${body?'6px':'0'};font-size:0.93em">${esc(title)}</div>${body?`<div>${il(body)}</div>`:''}</div>`
    }
    return `<blockquote>${il(lines.join('<br>'))}</blockquote>`
  }
  if (type === 'tasklist') {
    const items = raw.split('\n').filter(l => /^[-*+]\s\[[ xX]\]/.test(l))
    return `<ul class="nb-tasklist">${items.map(l => {
      const ck = /\[[xX]\]/.test(l)
      const tx = l.replace(/^[-*+]\s\[[ xX]\]\s*/,'')
      return `<li class="nb-task-item${ck?' checked':''}"><span class="nb-checkbox">${ck?'✓':''}</span>${il(tx)}</li>`
    }).join('')}</ul>`
  }
  if (type === 'ul') {
    const lines = raw.split('\n').filter(l => l.trim() && /^\s*[-*+]\s/.test(l))
    let html = '', depth = 0
    lines.forEach(l => {
      const lvl = Math.floor(l.search(/\S/)/2)
      const tx = l.replace(/^\s*[-*+]\s+/,'')
      if (lvl>depth){html+='<ul>'.repeat(lvl-depth);depth=lvl}
      if (lvl<depth){html+='</ul>'.repeat(depth-lvl);depth=lvl}
      html+=`<li>${il(tx)}</li>`
    })
    if (depth>0) html+='</ul>'.repeat(depth)
    return `<ul>${html}</ul>`
  }
  if (type === 'ol') {
    const lines = raw.split('\n').filter(l => /^\s*\d+[.)].?\s/.test(l))
    return `<ol>${lines.map(l=>`<li>${il(l.replace(/^\s*\d+[.)].?\s+/,''))}</li>`).join('')}</ol>`
  }
  if (type === 'table') {
    const lines = raw.split('\n').filter(l => l.trim())
    if (lines.length < 2) return `<p>${il(raw)}</p>`
    const pr = row => row.split('|').map(c=>c.trim()).filter((c,i,a)=>i>0&&i<a.length-1||a.length===1)
    const headers = pr(lines[0])
    const aligns  = lines[1]?pr(lines[1]).map(c=>/^:-+:$/.test(c)?'center':/^-+:$/.test(c)?'right':'left'):[]
    const rows    = lines.slice(2).filter(l=>!l.match(/^[|\-:\s]+$/))
    const thH = headers.map((h,i)=>`<th style="text-align:${aligns[i]||'left'}">${il(h)}</th>`).join('')
    const trH = rows.map(r=>{const cells=pr(r);return`<tr>${cells.map((c,i)=>`<td style="text-align:${aligns[i]||'left'}">${il(c)}</td>`).join('')}</tr>`}).join('')
    return `<table class="nb-table"><thead><tr>${thH}</tr></thead><tbody>${trH}</tbody></table>`
  }
  if (type.startsWith('h')) {
    const lvl = parseInt(type[1])
    const m = raw.match(/^#{1,6}\s+(.+?)(?:\s+\{#([^}]+)\})?$/)
    const text = m?m[1]:raw.replace(/^#{1,6}\s+/,'')
    const id = m?.[2]?` id="${esc(m[2])}"`:''
    return `<h${lvl}${id}>${il(text)}</h${lvl}>`
  }
  return `<p>${il(raw.replace(/\n/g,'<br>'))}</p>`
}

function renderMarkdown(text, notebooks = [], library = []) {
  if (!text?.trim()) return ''
  const lines = text.split('\n')
  const blocks = []
  let buf = [], inFence = false
  const flush = () => { const raw=buf.join('\n').trim(); if(raw) blocks.push(raw); buf=[] }
  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('~~~')) {
      if (!inFence) { flush(); inFence=true; buf.push(line) }
      else { buf.push(line); flush(); inFence=false }
      continue
    }
    if (inFence) { buf.push(line); continue }
    if (line.trim()==='') { flush(); continue }
    if (/^\s*\|/.test(line)) { buf.push(line); continue }
    flush(); buf.push(line)
  }
  flush()
  return blocks.map((raw,i) =>
    blockToHtml(raw, notebooks, library).replace(/^(<\w+)/, `$1 data-block-idx="${i}"`)
  ).join('\n')
}

// ─── Gnos CodeMirror theme factory ───────────────────────────────────────────
function makeGnosTheme(cm) {
  const { EditorView } = cm.view
  return EditorView.theme({
    '&': {
      background: 'var(--bg)',
      color: 'var(--text)',
      height: '100%',
      fontFamily: 'inherit',
      fontSize: '14px',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
      padding: '16px 0',
      maxWidth: '780px',
      margin: '0 auto',
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      background: 'rgba(56,139,253,0.22)',
    },
    '.cm-activeLine': { background: 'rgba(255,255,255,0.03)' },
    '.cm-live-hidden': { display: 'none' },
    '.cm-foldPlaceholder': {
      background: 'var(--surfaceAlt)',
      border: '1px solid var(--border)',
      color: 'var(--textDim)',
    },
    '.cm-tooltip': {
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      background: 'var(--accent)',
      color: '#fff',
    },
    '.cm-searchMatch': { background: 'rgba(210,153,34,0.35)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: 'rgba(56,139,253,0.45)' },
    '.cm-panels': { background: 'var(--surface)', borderTop: '1px solid var(--border)' },
    '.cm-panel': { padding: '6px 10px', background: 'var(--surface)' },
    '.cm-panel input': {
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      color: 'var(--text)',
      padding: '3px 8px',
      fontFamily: 'inherit',
      fontSize: '12px',
      outline: 'none',
    },
    '.cm-panel button': {
      background: 'var(--surfaceAlt)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      color: 'var(--text)',
      cursor: 'pointer',
      padding: '3px 8px',
      fontFamily: 'inherit',
      fontSize: '12px',
    },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
    // ── Live-mode visual styles ──────────────────────────────────────────────
    '.cm-lv-h1': { fontSize: '1.55em', fontWeight: '700', lineHeight: '1.3', color: 'var(--text)', display: 'block' },
    '.cm-lv-h2': { fontSize: '1.3em',  fontWeight: '700', lineHeight: '1.3', color: 'var(--text)', display: 'block' },
    '.cm-lv-h3': { fontSize: '1.15em', fontWeight: '600', lineHeight: '1.4', color: 'var(--text)', display: 'block' },
    '.cm-lv-h4': { fontSize: '1.05em', fontWeight: '600', color: 'var(--text)', display: 'block' },
    '.cm-lv-h5': { fontSize: '0.95em', fontWeight: '600', color: 'var(--text)', display: 'block' },
    '.cm-lv-h6': { fontSize: '0.9em',  fontWeight: '600', color: 'var(--textDim)', display: 'block' },
    '.cm-lv-bold': { fontWeight: '700' },
    '.cm-lv-italic': { fontStyle: 'italic' },
    '.cm-lv-bold-italic': { fontWeight: '700', fontStyle: 'italic' },
    '.cm-lv-strike': { textDecoration: 'line-through', opacity: '0.65' },
    '.cm-lv-code': { fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: '0.88em', background: 'rgba(56,139,253,0.1)', borderRadius: '3px', padding: '0 3px', color: 'var(--accent)' },
    '.cm-lv-blockquote': { borderLeft: '3px solid var(--accent)', marginLeft: '0', paddingLeft: '10px', color: 'var(--textDim)', display: 'block', background: 'rgba(56,139,253,0.04)', borderRadius: '0 4px 4px 0' },
    '.cm-lv-link': { color: 'var(--accent)', textDecoration: 'underline' },
    '.cm-lv-hr': { display: 'block', borderBottom: '1px solid var(--border)', margin: '8px 0' },
    '.cm-lv-highlight': { background: 'rgba(210,153,34,0.28)', borderRadius: '2px', padding: '0 2px' },
    '.cm-lv-wikilink': { color: 'var(--accent)', borderBottom: '1px solid var(--accent)', cursor: 'pointer' },
    '.cm-lv-checkbox-checked': { color: 'var(--accent)' },
    '.cm-lv-dim': { opacity: '0.35', fontSize: '0.85em' },
  }, { dark: true })
}

// Syntax highlight style for markdown
function makeHighlightStyle(cm) {
  const { tags } = cm.highlight
  const { HighlightStyle } = cm.language
  return HighlightStyle.define([
    { tag: tags.heading1, color: 'var(--text)', fontWeight: '700', fontSize: '1.4em' },
    { tag: tags.heading2, color: 'var(--text)', fontWeight: '700', fontSize: '1.25em' },
    { tag: tags.heading3, color: 'var(--text)', fontWeight: '600', fontSize: '1.1em' },
    { tag: tags.heading4, color: 'var(--text)', fontWeight: '600' },
    { tag: tags.strong,   color: 'var(--text)', fontWeight: '700' },
    { tag: tags.emphasis, color: 'var(--text)', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: 'var(--textDim)', textDecoration: 'line-through' },
    { tag: tags.link,     color: 'var(--accent)' },
    { tag: tags.url,      color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.monospace, color: 'var(--accent)', fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: '0.88em' },
    { tag: tags.processingInstruction, color: 'var(--textDim)', opacity: '0.6' },
    { tag: tags.meta, color: 'var(--textDim)', opacity: '0.55' },
    { tag: tags.atom, color: 'var(--textDim)' },
    { tag: tags.comment, color: 'var(--textDim)', fontStyle: 'italic' },
    { tag: tags.keyword, color: '#d2a8ff' },
    { tag: tags.string,  color: '#a5d6ff' },
    { tag: tags.number,  color: '#f0a868' },
    { tag: tags.operator,color: 'var(--textDim)' },
  ])
}

// ─── Wiki-link autocomplete source ───────────────────────────────────────────
function makeWikiCompletions(notebooks, library) {
  return (context) => {
    const before = context.matchBefore(/\[\[[^\]]*/)
    if (!before || (before.from === before.to && !context.explicit)) return null
    const query = before.text.slice(2).toLowerCase()
    const options = [
      ...notebooks.map(n => ({ label: n.title, type: 'keyword', detail: 'notebook', apply: `[[${n.title}]]` })),
      ...library.map(b => ({ label: b.title, type: 'variable', detail: 'book',     apply: `[[${b.title}]]` })),
    ].filter(o => o.label.toLowerCase().includes(query))
    return { from: before.from, options, validFor: /\[\[[^\]]*/ }
  }
}

// ─── Smart-Enter extension (list continuation) ────────────────────────────────
function makeSmartEnter(cm) {
  const { keymap } = cm.view
  const { insertNewlineAndIndentContinueMarkupList } = cm.commands
  return keymap.of([{
    key: 'Enter',
    run: insertNewlineAndIndentContinueMarkupList,
  }])
}

// ─── Inline formatting shortcuts ──────────────────────────────────────────────
function makeFormatKeymap(cm) {
  const { keymap } = cm.view
  const wrap = (marker) => ({ state, dispatch }) => {
    const { selection, doc } = state
    const changes = selection.ranges.map(r => {
      const sel = doc.sliceString(r.from, r.to)
      const text = sel ? `${marker}${sel}${marker}` : `${marker}${marker}`
      return { from: r.from, to: r.to, insert: text }
    })
    dispatch(state.update({ changes, scrollIntoView: true }))
    return true
  }
  const insertLink = ({ state, dispatch }) => {
    const sel = state.doc.sliceString(state.selection.main.from, state.selection.main.to)
    const text = sel ? `[${sel}](url)` : '[link text](url)'
    dispatch(state.update({
      changes: { from: state.selection.main.from, to: state.selection.main.to, insert: text },
      scrollIntoView: true,
    }))
    return true
  }
  return keymap.of([
    { key: 'Mod-b', run: wrap('**') },
    { key: 'Mod-i', run: wrap('*') },
    { key: 'Mod-e', run: wrap('`') },
    { key: 'Mod-k', run: insertLink },
    { key: 'Mod-Shift-h', run: wrap('==') },
  ])
}

// ─── Obsidian live preview — full node-level, cursor-aware implementation ─────
//
// CURSOR-AWARE HIDING — how it works character by character:
//
//   Each punctuation node (EmphasisMark, HeaderMark, etc.) has a [from,to] offset
//   in the document. Its parent formatting span (StrongEmphasis, ATXHeading1, etc.)
//   also has a [from,to] that encompasses the whole construct including markers.
//
//   Rule: cursor offset within parent[from, to]  → show punct node (dimmed)
//         cursor offset outside parent[from, to] → hide punct with Decoration.replace({})
//
//   Example — "**bold**" at offsets 0–8, cursor at offset 12 (elsewhere):
//     StrongEmphasis [0,8]
//       EmphasisMark [0,2]  ← cursor NOT in [0,8] → replace with nothing (hidden)
//       "bold"       [2,6]
//       EmphasisMark [6,8]  ← cursor NOT in [0,8] → replace with nothing (hidden)
//     Result: you see "bold" in bold, markers invisible
//
//   Cursor moves to offset 3 (inside "bold"):
//       EmphasisMark [0,2]  ← cursor IS in [0,8] → show dimmed
//       EmphasisMark [6,8]  ← cursor IS in [0,8] → show dimmed
//     Result: you see "**bold**" with ** dimmed
//
//   This is PER-NODE, not per-line. Two bold spans on the same line each
//   independently reveal only when the cursor enters their specific range.

// ── Replacement widgets ────────────────────────────────────────────────────────

class HRWidget {
  toDOM() {
    const d = document.createElement('div')
    d.className = 'cm-lv-hr-widget'
    return d
  }
  ignoreEvent() { return true }
  eq(o) { return o instanceof HRWidget }
  get estimatedHeight() { return 1 }
}

class CheckboxWidget {
  constructor(checked) { this.checked = checked }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lv-checkbox' + (this.checked ? ' cm-lv-checkbox-on' : '')
    s.textContent = this.checked ? '\u2713' : ''
    return s
  }
  ignoreEvent() { return false }
  eq(o) { return o instanceof CheckboxWidget && o.checked === this.checked }
}

class WikilinkWidget {
  constructor(title, resolved) { this.title = title; this.resolved = resolved }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lv-wikilink' + (this.resolved ? '' : ' cm-lv-wikilink-unresolved')
    s.textContent = this.title
    s.dataset.wlTitle = this.title
    return s
  }
  ignoreEvent() { return false }
  eq(o) {
    return o instanceof WikilinkWidget && o.title === this.title && o.resolved === this.resolved
  }
}

// ── Plugin factory ─────────────────────────────────────────────────────────────
function makeLivePreviewPlugin(cm, RangeSetBuilder, notebooks, library) {
  const { ViewPlugin, Decoration } = cm.view
  const { syntaxTree } = cm.language

  // Pure punctuation nodes — hidden when cursor is outside their parent span
  const PUNCT = new Set([
    'EmphasisMark', 'HeaderMark', 'CodeMark', 'StrikethroughMark',
    'LinkMark', 'ImageMark', 'QuoteMark', 'ListMark', 'TaskMarker',
    'TableDelimiter',
  ])

  // Content span nodes → CSS class (always styled, never hidden themselves)
  const SPAN = {
    StrongEmphasis: 'cm-lv-bold-italic',
    Emphasis:       'cm-lv-italic',
    Strong:         'cm-lv-bold',
    Strikethrough:  'cm-lv-strike',
    InlineCode:     'cm-lv-code',
    Highlight:      'cm-lv-highlight',
    Link:           'cm-lv-link',
    Image:          'cm-lv-link',
    URL:            'cm-lv-url',
  }

  // Block nodes whose LINE gets a decoration class
  const LINE_CLS = {
    ATXHeading1: 'cm-lv-h1', ATXHeading2: 'cm-lv-h2', ATXHeading3: 'cm-lv-h3',
    ATXHeading4: 'cm-lv-h4', ATXHeading5: 'cm-lv-h5', ATXHeading6: 'cm-lv-h6',
  }

  const CODE_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'IndentedCode'])

  function build(view) {
    const { state } = view
    const cursor    = state.selection.main.head
    const doc       = state.doc
    const cursorIn  = (f, t) => cursor >= f && cursor <= t

    const spans  = []   // { from, to, deco }  inline mark / replace
    const lineDs = []   // { pos, deco }        line decorations

    syntaxTree(state).iterate({
      enter(node) {
        const { from, to, name } = node

        // ── Fenced / indented code block: style every contained line ────────
        if (CODE_BLOCKS.has(name)) {
          const startLn = doc.lineAt(from).number
          const endLn   = doc.lineAt(to).number
          for (let ln = startLn; ln <= endLn; ln++) {
            lineDs.push({ pos: doc.line(ln).from, deco: Decoration.line({ class: 'cm-lv-codeblock' }) })
          }
          return false  // skip children — don't process CodeMarks inside code blocks
        }

        // ── Horizontal rule: swap whole line for HR widget ──────────────────
        if (name === 'HorizontalRule') {
          const line = doc.lineAt(from)
          if (!cursorIn(line.from, line.to)) {
            spans.push({ from: line.from, to: line.to,
              deco: Decoration.replace({ widget: new HRWidget() }) })
          }
          return false
        }

        // ── Task checkbox: swap [ ] / [x] for checkbox widget ──────────────
        if (name === 'TaskMarker') {
          const raw     = doc.sliceString(from, to)
          const checked = /\[[xX]\]/.test(raw)
          if (!cursorIn(from, to)) {
            spans.push({ from, to,
              deco: Decoration.replace({ widget: new CheckboxWidget(checked) }) })
          } else {
            spans.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-punct' }) })
          }
          return false
        }

        // ── Heading lines ───────────────────────────────────────────────────
        if (LINE_CLS[name]) {
          lineDs.push({ pos: doc.lineAt(from).from,
            deco: Decoration.line({ class: LINE_CLS[name] }) })
          // fall through — still need to process HeaderMark children
        }

        // ── Blockquote lines ────────────────────────────────────────────────
        if (name === 'Blockquote') {
          const startLn = doc.lineAt(from).number
          const endLn   = doc.lineAt(to).number
          for (let ln = startLn; ln <= endLn; ln++) {
            lineDs.push({ pos: doc.line(ln).from,
              deco: Decoration.line({ class: 'cm-lv-blockquote-line' }) })
          }
          // fall through to process QuoteMark children
        }

        // ── Content spans: always apply styling class ───────────────────────
        if (SPAN[name]) {
          spans.push({ from, to, deco: Decoration.mark({ class: SPAN[name] }) })
          // fall through — process punctuation children inside
        }

        // ── THE KEY MECHANISM: cursor-aware punctuation hiding ─────────────
        //
        //  node.node.parent is the Lezer SyntaxNode API to get the parent node.
        //  We check if cursor is within the PARENT's range, not just this node.
        //  This means clicking anywhere inside **bold** reveals both ** markers.
        if (PUNCT.has(name)) {
          const par   = node.node.parent
          const pFrom = par ? par.from : from
          const pTo   = par ? par.to   : to

          if (cursorIn(pFrom, pTo)) {
            // Cursor inside this construct → show syntax, visually dimmed
            spans.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-punct' }) })
          } else {
            // Cursor elsewhere → hide this punctuation completely
            // Decoration.replace({}) with no widget = zero-width, invisible
            spans.push({ from, to, deco: Decoration.replace({}) })
          }
        }
      }
    })

    // ── Wikilinks via regex (Lezer parses them as plain text) ───────────────
    const fullText = doc.toString()
    // eslint-disable-next-line no-useless-escape
    const wlRe = /\[\[([^\]\n]{1,120})\]\]/g
    let wm
    while ((wm = wlRe.exec(fullText)) !== null) {
      const wFrom = wm.index
      const wTo   = wm.index + wm[0].length
      const title = wm[1].trim()
      const resolved =
        notebooks.some(n => n.title?.toLowerCase() === title.toLowerCase()) ||
        library.some(b  => b.title?.toLowerCase()  === title.toLowerCase())

      if (cursorIn(wFrom, wTo)) {
        // Cursor inside → show raw [[...]] dimmed
        spans.push({ from: wFrom, to: wTo, deco: Decoration.mark({ class: 'cm-lv-dim' }) })
      } else {
        // Cursor outside → replace with styled widget
        spans.push({ from: wFrom, to: wTo,
          deco: Decoration.replace({ widget: new WikilinkWidget(title, resolved) }) })
      }
    }

    // ── Sort spans: from ASC, then to DESC so wider (parent) ranges come first
    // when they share the same `from`. CM6 requires document order AND that
    // a parent decoration precedes child decorations at the same start offset.
    spans.sort((a, b) => a.from !== b.from ? a.from - b.from : b.to - a.to)

    // ── Build inline RangeSet ───────────────────────────────────────────────
    const sb = new RangeSetBuilder()
    for (const { from, to, deco } of spans) {
      if (from >= to) continue
      try { sb.add(from, to, deco) } catch { /* overlapping ranges — skip gracefully */ }
    }

    // ── Build line RangeSet ─────────────────────────────────────────────────
    lineDs.sort((a, b) => a.pos - b.pos)
    const lb = new RangeSetBuilder()
    let prevPos = -1
    for (const { pos, deco } of lineDs) {
      if (pos === prevPos) continue  // only one line deco per line
      try { lb.add(pos, pos, deco); prevPos = pos } catch { /* skip */ }
    }

    return { spans: sb.finish(), lines: lb.finish() }
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        const r = build(view)
        this.decorations = r.spans
        this.lineDecos   = r.lines
      }
      update(upd) {
        if (upd.docChanged || upd.selectionSet || upd.viewportChanged) {
          const r = build(upd.view)
          this.decorations = r.spans
          this.lineDecos   = r.lines
        }
      }
    },
    {
      decorations: v => v.decorations,
      provide: plugin => [
        cm.view.EditorView.decorations.of(
          v => v.plugin(plugin)?.lineDecos ?? Decoration.none
        ),
      ],
    }
  )
}


const VIEW_MODE_CYCLE = ['live', 'source', 'preview']

const IconSource = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
    <path d="M3.5 13.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const IconPreview = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
  </svg>
)
const IconLive = () => (
  <svg width="17" height="17" viewBox="0 0 20 20" fill="none">
    <path d="M1 10C1 10 3.5 6 7 6s6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.75"/>
    <circle cx="7" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.1" opacity="0.75"/>
    <path d="M14 6.5l2 2-5.5 5.5H8.5v-2l5.5-5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
  </svg>
)
const MODE_META = {
  live:    { icon: <IconLive />,    label: 'Live',    title: 'Live preview — tap to switch, hold for menu' },
  source:  { icon: <IconSource />,  label: 'Source',  title: 'Source mode' },
  preview: { icon: <IconPreview />, label: 'Preview', title: 'Reading view' },
}
const VM_BTN_CSS = `
  .vm-btn-wrap { position: relative; flex-shrink: 0; }
  .vm-btn {
    width: 30px; height: 30px;
    background: none; border: 1px solid var(--border); border-radius: 6px;
    color: var(--textDim); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .vm-btn:hover { background: var(--surfaceAlt); color: var(--text); }
  .vm-btn-icon { display: flex; align-items: center; justify-content: center;
    transition: opacity 0.18s, transform 0.18s; }
  .vm-btn-icon.exiting  { opacity: 0; transform: scale(0.6) rotate(-15deg); position: absolute; }
  .vm-btn-icon.entering { opacity: 0; transform: scale(0.6) rotate(15deg); }
  .vm-btn-icon.visible  { opacity: 1; transform: scale(1) rotate(0deg); }
  .vm-dropdown {
    position: absolute; top: calc(100% + 6px); right: 0;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    min-width: 130px; z-index: 9300;
    animation: vm-drop-in 0.12s cubic-bezier(0.4,0,0.2,1);
  }
  @keyframes vm-drop-in { from { opacity:0; transform:translateY(-6px) scale(0.96); } to { opacity:1; transform:none; } }
  .vm-drop-item {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 14px; border: none; background: none;
    width: 100%; cursor: pointer; text-align: left;
    font-size: 13px; font-family: inherit; color: var(--text);
    transition: background 0.08s;
  }
  .vm-drop-item:hover { background: var(--hover, rgba(255,255,255,0.06)); }
  .vm-drop-item.active { color: var(--accent); }
  .vm-drop-label { flex: 1; font-weight: 500; }
  .vm-drop-check { font-size: 11px; opacity: 0.7; }
`

function ViewModeBtn({ viewMode, setViewMode }) {
  const [iconPhase, setIconPhase] = useState('visible')
  const [shownMode, setShownMode] = useState(viewMode)
  const [dropOpen,  setDropOpen]  = useState(false)
  const holdTimer    = useRef(null)
  const didLongPress = useRef(false)
  const wrapRef      = useRef(null)
  const prevModeRef  = useRef(viewMode)

  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = viewMode
    if (prev === viewMode) return
    const t0 = setTimeout(() => setIconPhase('exiting'),  0)
    const t1 = setTimeout(() => { setShownMode(viewMode); setIconPhase('entering') }, 150)
    const t2 = setTimeout(() => setIconPhase('visible'),  300)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
  }, [viewMode])

  useEffect(() => {
    if (!dropOpen) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  return (
    <>
      <style>{VM_BTN_CSS}</style>
      <div className="vm-btn-wrap" ref={wrapRef}>
        <button
          className="vm-btn"
          title={MODE_META[viewMode].title}
          onMouseDown={() => { didLongPress.current = false; holdTimer.current = setTimeout(() => { didLongPress.current = true; setDropOpen(d => !d) }, 300) }}
          onMouseUp={() => clearTimeout(holdTimer.current)}
          onMouseLeave={() => clearTimeout(holdTimer.current)}
          onClick={() => {
            if (didLongPress.current) return
            const next = VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(viewMode) + 1) % VIEW_MODE_CYCLE.length]
            setViewMode(next); setDropOpen(false)
          }}
        >
          <span className={`vm-btn-icon ${iconPhase}`}>{MODE_META[shownMode].icon}</span>
        </button>
        {dropOpen && (
          <div className="vm-dropdown">
            {VIEW_MODE_CYCLE.map(m => (
              <button key={m} className={`vm-drop-item${viewMode===m?' active':''}`}
                onMouseDown={e => { e.preventDefault(); setViewMode(m); setDropOpen(false) }}>
                {MODE_META[m].icon}
                <span className="vm-drop-label">{MODE_META[m].label}</span>
                {viewMode === m && <span className="vm-drop-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NotebookView component
// ─────────────────────────────────────────────────────────────────────────────

export default function NotebookView() {
  const notebook       = useAppStore(s => s.activeNotebook)
  const notebooks      = useAppStore(s => s.notebooks)
  const updateNotebook = useAppStore(s => s.updateNotebook)
  const setView        = useAppStore(s => s.setView)
  const library        = useAppStore(s => s.library)

  const [viewMode, setViewMode] = useState('live')
  const [content,  setContent]  = useState('')
  const [loaded,   setLoaded]   = useState(false)
  const [, setSaving]   = useState(false)
  const [findQ,    setFindQ]    = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findCurrentDisplay, setFindCurrentIdx] = useState(0)
  const [editModal, setEditModal] = useState(false)
  const [layout] = useState('scroll')
  const [notePage, setNotePage] = useState(0)

  const editorHost  = useRef(null)
  const cmView      = useRef(null)
  const cmModules   = useRef(null)
  const saveTimer   = useRef(null)
  const saveVisTimer = useRef(null)
  const contentRef  = useRef('')
  contentRef.current = content

  const previewHtml = useMemo(
    () => renderMarkdown(content, notebooks, library),
    [content, notebooks, library]
  )

  // ── Load content ────────────────────────────────────────────────────────────
  // loadedForNoteId: tracks which notebook id the current content belongs to.
  // Avoids synchronous setState in the effect body.
  const [loadedForNoteId, setLoadedForNoteId] = useState(null)

  useEffect(() => {
    if (!notebook?.id) return
    let cancelled = false

    loadNotebookContent(notebook.id).then(raw => {
      if (cancelled) return
      const text = typeof raw === 'string' ? raw : ''
      contentRef.current = text
      setContent(text)
      setNotePage(0)
      setLoaded(true)
      setLoadedForNoteId(notebook.id)
    })

    return () => { cancelled = true }
  }, [notebook?.id])

  // Derived: only treat as loaded if the content belongs to the current notebook
  const isNoteLoaded = loaded && loadedForNoteId === notebook?.id

  // ── Mount CodeMirror ────────────────────────────────────────────────────────
  // FIX: Always initialise CM from contentRef.current (latest in-memory text),
  // NOT from the `content` state snapshot captured at effect-creation time.
  // This ensures switching modes never loses edits that happened since the
  // last React render.
  useEffect(() => {
    if (!isNoteLoaded || !editorHost.current) return
    if (viewMode === 'preview') return

    let destroyed = false
    loadCM().then(cm => {
      if (destroyed || !editorHost.current) return
      cmModules.current = cm

      const {
        state: { EditorState, RangeSetBuilder },
        view: { EditorView, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine, keymap },
        commands: { defaultKeymap, indentWithTab, history, historyKeymap },
        language: { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap },
        langMd,
        lezerMd,
        autocomplete: { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap },
        search: { search: searchExt, searchKeymap },
      } = cm

      const gnosTheme    = makeGnosTheme(cm)
      const gnosHighlight = makeHighlightStyle(cm)
      const isLive = viewMode === 'live'

      const extensions = [
        gnosTheme,
        syntaxHighlighting(gnosHighlight),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ...(isLive ? [] : [highlightActiveLine()]),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        history(),
        langMd.markdown({
          // Enable GitHub-Flavored Markdown extensions: strikethrough, tables, task lists
          extensions: lezerMd?.GFM ? [lezerMd.GFM] : [
            lezerMd?.Strikethrough, lezerMd?.Table, lezerMd?.TaskList,
          ].filter(Boolean),
        }),
        autocompletion({ override: [makeWikiCompletions(notebooks, library)] }),
        searchExt({ top: false }),
        makeFormatKeymap(cm),
        makeSmartEnter(cm),
        // Live preview: visual rendering + syntax hiding
        ...(isLive ? [makeLivePreviewPlugin(cm, RangeSetBuilder, notebooks, library)] : []),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { flushSave(); return true } },
          { key: 'Mod-f', run: () => false },
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            setContent(text)
            scheduleSave(text)
          }
        }),
        EditorView.lineWrapping,
      ]

      if (cmView.current) { cmView.current.destroy(); cmView.current = null }

      const startState = EditorState.create({
        // ⚠️ KEY FIX: use contentRef.current — the latest text — not the
        // `content` state variable captured at effect creation time.
        doc: contentRef.current,
        extensions,
      })

      const view = new EditorView({ state: startState, parent: editorHost.current })
      cmView.current = view
      view.focus()
    })

    return () => {
      destroyed = true
      if (cmView.current) { cmView.current.destroy(); cmView.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNoteLoaded, viewMode, notebook?.id])

  // ── Save helpers ─────────────────────────────────────────────────────────────
  const animateSaveIcon = useCallback(() => {
    const icon = document.getElementById('nb2-save-icon')
    if (!icon) return
    icon.classList.remove('animating', 'visible')
    void icon.offsetWidth
    icon.classList.add('animating', 'visible')
    clearTimeout(saveVisTimer.current)
    saveVisTimer.current = setTimeout(() => {
      icon.classList.remove('animating')
      saveVisTimer.current = setTimeout(() => icon.classList.remove('visible'), 600)
    }, 1200)
  }, [])

  const doSave = useCallback(async (text) => {
    if (!notebook) return
    setSaving(true)
    await saveNotebookContent(notebook.id, text)
    const wc = (text.match(/\b\w+\b/g) || []).length
    updateNotebook(notebook.id, { updatedAt: new Date().toISOString(), wordCount: wc })
    useAppStore.getState().persistNotebooks?.()
    setSaving(false)
    animateSaveIcon()
  }, [notebook, updateNotebook, animateSaveIcon])

  const scheduleSave = useCallback((text) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(text), 800)
  }, [doSave])

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    doSave(contentRef.current)
  }, [doSave])

  function _exit() {
    clearTimeout(saveTimer.current)
    flushSave()
    setView('library')
  }

  // ── Find in preview ──────────────────────────────────────────────────────────
  const previewRef = useRef(null)
  const findMatches = useRef([])
  const findCurrent = useRef(0)

  function doFind(q) {
    const preview = previewRef.current
    if (!preview || !q) {
      if (preview) preview.querySelectorAll('mark.find-hl').forEach(m => {
        m.replaceWith(document.createTextNode(m.textContent))
      })
      findMatches.current = []
      return
    }
    preview.querySelectorAll('mark.find-hl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)))
    preview.normalize()
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT)
    const hits = []
    let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi')
      let m; let lastIdx = 0; const fragments = []
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) fragments.push(document.createTextNode(text.slice(lastIdx, m.index)))
        const mark = document.createElement('mark')
        mark.className = 'find-hl'
        mark.textContent = m[0]
        fragments.push(mark)
        hits.push(mark)
        lastIdx = m.index + m[0].length
      }
      if (fragments.length > 0) {
        if (lastIdx < text.length) fragments.push(document.createTextNode(text.slice(lastIdx)))
        node.replaceWith(...fragments)
      }
    }
    findMatches.current = hits
    findCurrent.current = 0
    setFindCount(hits.length)
    setFindCurrentIdx(0)
    if (hits.length > 0) hits[0].classList.add('find-hl-active')
  }

  function findNav(dir) {
    const hits = findMatches.current
    if (!hits.length) return
    hits[findCurrent.current].classList.remove('find-hl-active')
    findCurrent.current = (findCurrent.current + dir + hits.length) % hits.length
    setFindCurrentIdx(findCurrent.current)
    const active = hits[findCurrent.current]
    active.classList.add('find-hl-active')
    active.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function handlePreviewClick(e) {
    const wl = e.target.closest('.wikilink')
    if (!wl) return
    const type = wl.dataset.wlType
    const id = wl.dataset.wlId
    if (type === 'notebook') {
      const nb = notebooks.find(n => n.id === id)
      if (nb) { useAppStore.getState().setActiveNotebook(nb); setView('notebook') }
    } else if (type === 'book') {
      const bk = library.find(b => b.id === id)
      if (bk) {
        useAppStore.getState().setActiveBook(bk)
        setView(bk.format === 'audiofolder' || bk.format === 'audio' ? 'audio-player' : 'reader')
      }
    }
  }

  // ── Paginated layout ──────────────────────────────────────────────────────────
  const notePages = useMemo(() => {
    if (layout !== 'paginated') return [content]
    const paragraphs = content.split(/\n{2,}/)
    const pages = []
    let current = []
    for (const p of paragraphs) {
      current.push(p)
      if (current.join('\n\n').length > 2400) { pages.push(current.join('\n\n')); current = [] }
    }
    if (current.length > 0) pages.push(current.join('\n\n'))
    return pages.length > 0 ? pages : ['']
  }, [content, layout])

  // ── View mode switch helper ────────────────────────────────────────────────────
  // FIX: Read latest text from CM before switching modes
  function switchMode(mode) {
    if (cmView.current && mode !== viewMode) {
      const text = cmView.current.state.doc.toString()
      contentRef.current = text
      if (text !== content) setContent(text)
    }
    setViewMode(mode)
  }

  const wordCount = useMemo(() => (content.match(/\b\w+\b/g) || []).length, [content])

  if (!notebook) return (
    <div style={{ display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:14 }}>No notebook selected.</p>
      <button onClick={() => setView('library')} style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:13 }}>Back to Library</button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--bg)', color:'var(--text)' }}>
      <style>{`
        /* ── CodeMirror host ─────────────────── */
        .gnos-cm-host { flex:1; overflow:hidden; position:relative; }
        .gnos-cm-host .cm-editor { height:100%; }
        .gnos-cm-host .cm-scroller { padding: 0 24px; box-sizing:border-box; }

        /* ── Preview pane ────────────────────── */
        .nb-preview {
          flex:1; overflow:auto; padding:28px 32px;
          font-size:14px; line-height:1.75; color:var(--readerText, var(--text));
          max-width:780px; margin:0 auto; width:100%;
        }
        .nb-preview h1{font-size:1.7em;font-weight:700;margin:1.2em 0 0.5em;font-family:Georgia,serif}
        .nb-preview h2{font-size:1.4em;font-weight:700;margin:1.1em 0 0.4em;font-family:Georgia,serif}
        .nb-preview h3{font-size:1.15em;font-weight:600;margin:1em 0 0.35em}
        .nb-preview h4,h5,h6{font-size:1em;font-weight:600;margin:0.9em 0 0.3em}
        .nb-preview p{margin:0 0 0.75em}
        .nb-preview blockquote{border-left:3px solid var(--accent);margin:0.8em 0;padding:8px 14px;color:var(--textDim);border-radius:0 4px 4px 0;background:rgba(56,139,253,0.04)}
        .nb-preview pre.nb-code{background:var(--surfaceAlt);border:1px solid var(--border);border-radius:8px;padding:14px 16px;overflow-x:auto;margin:0.8em 0}
        .nb-preview code{font-family:SF Mono,Menlo,Consolas,monospace;font-size:0.87em}
        .nb-inline-code{background:rgba(56,139,253,0.1);border-radius:4px;padding:1px 5px;font-family:SF Mono,Menlo,Consolas,monospace;font-size:0.87em;color:var(--accent)}
        .nb-preview table.nb-table{border-collapse:collapse;width:100%;margin:0.8em 0;font-size:0.93em}
        .nb-preview table.nb-table th,.nb-preview table.nb-table td{border:1px solid var(--border);padding:6px 10px}
        .nb-preview table.nb-table th{background:var(--surfaceAlt);font-weight:600}
        .nb-preview ul,.nb-preview ol{margin:0 0 0.75em;padding-left:1.6em}
        .nb-preview li{margin-bottom:0.3em}
        .nb-preview ul.nb-tasklist{list-style:none;padding-left:0.4em}
        .nb-preview .nb-task-item{display:flex;gap:8px;align-items:baseline}
        .nb-preview .nb-checkbox{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1.5px solid var(--border);border-radius:3px;font-size:10px;flex-shrink:0}
        .nb-preview .nb-task-item.checked .nb-checkbox{background:var(--accent);border-color:var(--accent);color:#fff}
        .nb-preview .nb-task-item.checked > *:last-child{text-decoration:line-through;opacity:0.6}
        .nb-hl{background:rgba(210,153,34,0.28);border-radius:2px;padding:0 2px}
        .wikilink{border-bottom:1px solid var(--accent);cursor:pointer;color:var(--accent)}
        .wikilink-unresolved{color:var(--textDim);border-bottom-color:var(--textDim)}
        .nb-img{max-width:100%;border-radius:6px;margin:0.5em 0}
        .nb-preview a{color:var(--accent);text-decoration:underline}
        .nb-preview hr{border:none;border-top:1px solid var(--border);margin:1.2em 0}
        mark.find-hl{background:rgba(210,153,34,0.4);border-radius:2px;padding:0 1px}
        mark.find-hl-active{background:rgba(56,139,253,0.5);outline:2px solid var(--accent)}

        /* ── Progress ────────────────────────── */
        .nb-progress-track{height:2px;background:var(--border);flex-shrink:0}
        .nb-progress-fill{height:100%;background:var(--accent);transition:width 0.2s}

        /* ── Inline find controls ────────────── */
        .nb2-find-btn{background:none;border:none;color:var(--textDim);cursor:pointer;border-radius:5px;padding:3px 7px;font-size:11px;font-family:inherit;transition:background 0.1s,color 0.1s}
        .nb2-find-btn:hover{background:var(--surfaceAlt);color:var(--text)}
        .nb2-find-close{font-size:16px;opacity:0.6;background:none;border:none;cursor:pointer;color:var(--textDim);padding:0 4px;line-height:1}
        .nb2-find-close:hover{opacity:1}

        /* ── Live-mode content styles ────────── */

        /* Heading lines — full line gets font size via line decoration */
        .gnos-cm-live .cm-lv-h1 { font-size:1.7em;  font-weight:700; line-height:1.25; font-family:Georgia,serif; }
        .gnos-cm-live .cm-lv-h2 { font-size:1.4em;  font-weight:700; line-height:1.3;  font-family:Georgia,serif; }
        .gnos-cm-live .cm-lv-h3 { font-size:1.2em;  font-weight:600; line-height:1.35; }
        .gnos-cm-live .cm-lv-h4 { font-size:1.05em; font-weight:600; }
        .gnos-cm-live .cm-lv-h5 { font-size:0.95em; font-weight:600; }
        .gnos-cm-live .cm-lv-h6 { font-size:0.9em;  font-weight:600; opacity:0.65; }

        /* Inline spans */
        .gnos-cm-live .cm-lv-bold        { font-weight:700; }
        .gnos-cm-live .cm-lv-italic      { font-style:italic; }
        .gnos-cm-live .cm-lv-bold-italic { font-weight:700; font-style:italic; }
        .gnos-cm-live .cm-lv-strike      { text-decoration:line-through; opacity:0.6; }
        .gnos-cm-live .cm-lv-code {
          font-family: SF Mono,Menlo,Consolas,monospace; font-size:0.87em;
          background: rgba(56,139,253,0.12); border-radius:4px; padding:1px 4px;
          color: var(--accent);
        }
        .gnos-cm-live .cm-lv-link        { color:var(--accent); text-decoration:underline; cursor:pointer; }
        .gnos-cm-live .cm-lv-url         { color:var(--accent); opacity:0.7; font-size:0.88em; }
        .gnos-cm-live .cm-lv-highlight   { background:rgba(210,153,34,0.3); border-radius:2px; padding:0 2px; }

        /* Blockquote — line-level decoration */
        .gnos-cm-live .cm-lv-blockquote-line {
          border-left:3px solid var(--accent); padding-left:12px;
          color:var(--textDim); background:rgba(56,139,253,0.04);
          margin-left:-12px;
        }

        /* Code block lines */
        .gnos-cm-live .cm-lv-codeblock {
          background: var(--surfaceAlt); font-family:SF Mono,Menlo,Consolas,monospace;
          font-size:0.87em; padding:0 8px;
        }

        /* Horizontal rule widget */
        .cm-lv-hr-widget {
          display:block; height:1px; background:var(--border);
          margin:8px 0; width:100%; pointer-events:none;
        }

        /* Task checkbox widget */
        .cm-lv-checkbox {
          display:inline-flex; align-items:center; justify-content:center;
          width:13px; height:13px; border:1.5px solid var(--border);
          border-radius:3px; font-size:9px; vertical-align:middle;
          margin-right:5px; cursor:pointer; flex-shrink:0;
          color:transparent;
        }
        .cm-lv-checkbox-on {
          background:var(--accent); border-color:var(--accent); color:#fff;
        }

        /* Wikilink widgets */
        .cm-lv-wikilink {
          color:var(--accent); border-bottom:1px solid var(--accent);
          cursor:pointer; border-radius:2px; padding:0 1px;
        }
        .cm-lv-wikilink-unresolved {
          color:var(--textDim); border-bottom-color:var(--textDim); opacity:0.75;
        }

        /* Punctuation shown when cursor is inside a formatting span — dimmed */
        .gnos-cm-live .cm-lv-punct { opacity:0.35; }
        .gnos-cm-live .cm-lv-dim   { opacity:0.3; }

        /* Fallback hidden class (for any remaining uses) */
        .gnos-cm-live .cm-live-hidden { display:none; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────────────── */}
      <header className="nb-header">
        <GnosNavButton />
        <div style={{ width:1, height:16, background:'var(--border)', flexShrink:0 }} />

        <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', flexShrink:0, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {notebook.title}
        </div>

        <div className="nb-save-indicator">
          <svg id="nb2-save-icon" className="nb-save-icon" viewBox="0 0 18 18" fill="none">
            <circle className="nb-save-ring" cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <polyline className="nb-save-check" points="5.5,9 7.8,11.5 12.5,6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        <div className="nb-search-row">
          <div className="nb-search-bar-wrapper">
            <div
              className={`search-bar${findQ ? ' focused' : ''}`}
              style={{ background:'var(--surfaceAlt)' }}
              onClick={() => document.getElementById('nb-search-input')?.focus()}
            >
              <svg className="search-icon" width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                id="nb-search-input"
                style={{ background:'none', border:'none', color:'var(--text)', outline:'none', fontSize:13, flex:1, minWidth:0 }}
                placeholder="Find…"
                value={findQ}
                onChange={e => { setFindQ(e.target.value); doFind(e.target.value) }}
                onKeyDown={e => {
                  if (e.key==='Enter') { e.preventDefault(); findNav(e.shiftKey ? -1 : 1) }
                  if (e.key==='Escape') { setFindQ(''); doFind('') }
                }}
              />
              {findQ ? (
                <span style={{ fontSize:11, color:'var(--textDim)', whiteSpace:'nowrap', marginRight:4 }}>
                  {findCount > 0 ? `${findCurrentDisplay+1}/${findCount}` : 'Not found'}
                </span>
              ) : (
                <span style={{ fontSize:11, color:'var(--textDim)', whiteSpace:'nowrap', marginLeft:'auto', paddingLeft:8, flexShrink:0 }}>
                  {wordCount.toLocaleString()} words
                </span>
              )}
              {findQ && (
                <>
                  <button className="nb2-find-btn" style={{ padding:'2px 7px', fontSize:11 }} onClick={() => findNav(-1)} title="Previous">↑</button>
                  <button className="nb2-find-btn" style={{ padding:'2px 7px', fontSize:11 }} onClick={() => findNav(1)}  title="Next">↓</button>
                  <button className="nb2-find-close" onClick={() => { setFindQ(''); doFind('') }} title="Clear">×</button>
                </>
              )}
            </div>
          </div>
        </div>

        <ViewModeBtn viewMode={viewMode} setViewMode={switchMode} />

        <button
          onClick={() => setEditModal(true)}
          title="Syntax reference"
          style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--textDim)', cursor:'pointer', width:30, height:30, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.3 3.3l.7.7M12 12l.7.7M12 3.3l-.7.7M4 12l-.7.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
        </button>
      </header>

      {/* ── Main area ─────────────────────────────────────────────────────────── */}
      {!isNoteLoaded ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:'var(--textDim)', fontSize:13 }}>
          <div className="spinner" />Loading…
        </div>
      ) : viewMode === 'preview' ? (
        <div style={{ flex:1, overflow:'auto', background:'var(--readerBg, var(--bg))' }}>
          <div
            ref={previewRef}
            className="nb-preview"
            onClick={handlePreviewClick}
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      ) : (
        <div
          ref={editorHost}
          className={`gnos-cm-host${viewMode === 'live' ? ' gnos-cm-live' : ''}`}
          style={{ flex:1, overflow:'hidden' }}
        />
      )}

      {/* ── Footer pagination ──────────────────────────────────────────────────── */}
      {layout === 'paginated' && notePages.length > 1 && (
        <footer style={{ display:'flex', flexDirection:'column', background:'var(--surface)', borderTop:'1px solid var(--border)', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 14px' }}>
            <button disabled={notePage<=0} onClick={() => setNotePage(p=>Math.max(0,p-1))}
              style={{ background:'none', border:'1px solid var(--border)', color:notePage<=0?'var(--textDim)':'var(--text)', borderRadius:6, padding:'4px 12px', cursor:notePage<=0?'default':'pointer', fontSize:12, opacity:notePage<=0?0.4:1 }}>← Prev</button>
            <span style={{ fontSize:12, color:'var(--textDim)' }}>Page {notePage+1} of {notePages.length}</span>
            <button disabled={notePage>=notePages.length-1} onClick={() => setNotePage(p=>Math.min(notePages.length-1,p+1))}
              style={{ background:'none', border:'1px solid var(--border)', color:notePage>=notePages.length-1?'var(--textDim)':'var(--text)', borderRadius:6, padding:'4px 12px', cursor:notePage>=notePages.length-1?'default':'pointer', fontSize:12, opacity:notePage>=notePages.length-1?0.4:1 }}>Next →</button>
          </div>
          <div className="nb-progress-track">
            <div className="nb-progress-fill" style={{ width:`${notePages.length>1?(notePage/(notePages.length-1))*100:100}%` }} />
          </div>
        </footer>
      )}

      {editModal && <NotebookInfoPanel onClose={() => setEditModal(false)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Syntax reference panel (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function NotebookInfoPanel({ onClose }) {
  const SECTIONS = [
    { title:'Inline Formatting', rows:[
      {keys:'**bold**',desc:'Bold text'},{keys:'*italic*',desc:'Italic text'},
      {keys:'***bold italic***',desc:'Bold + italic'},{keys:'~~strike~~',desc:'Strikethrough'},
      {keys:'==highlight==',desc:'Highlight'},{keys:'`code`',desc:'Inline code'},
      {keys:'^superscript^',desc:'Superscript'},{keys:'~subscript~',desc:'Subscript'},
      {keys:'[text](url)',desc:'Hyperlink'},{keys:'![alt](url)',desc:'Image'},
    ]},
    { title:'Headings', rows:[
      {keys:'# H1',desc:'H1'},{keys:'## H2',desc:'H2'},{keys:'### H3',desc:'H3'},
      {keys:'#### H4',desc:'H4'},{keys:'##### H5',desc:'H5'},{keys:'###### H6',desc:'H6'},
    ]},
    { title:'Block Syntax', rows:[
      {keys:'> quote',desc:'Blockquote'},{keys:'> [!NOTE]',desc:'Callout'},
      {keys:'- item',desc:'Unordered list'},{keys:'1. item',desc:'Ordered list'},
      {keys:'   - nested',desc:'Nested list (3 spaces)'},{keys:'- [ ] task',desc:'Task'},
      {keys:'- [x] done',desc:'Checked task'},{keys:'```lang',desc:'Code block'},
      {keys:'---',desc:'Horizontal rule'},{keys:'| col |',desc:'Table'},
    ]},
    { title:'Wikilinks', rows:[
      {keys:'[[Title]]',desc:'Link to notebook or book'},{keys:'Type [[ …',desc:'Autocomplete dropdown'},
    ]},
    { title:'Keyboard Shortcuts', rows:[
      {keys:'Ctrl+B',desc:'Bold'},{keys:'Ctrl+I',desc:'Italic'},
      {keys:'Ctrl+K',desc:'Insert link'},{keys:'Ctrl+E',desc:'Inline code'},
      {keys:'Ctrl+Shift+H',desc:'Highlight'},{keys:'Ctrl+S',desc:'Save now'},
      {keys:'Ctrl+F',desc:'Find in note'},{keys:'Tab',desc:'Indent list'},
      {keys:'Enter',desc:'Smart list continuation'},
    ]},
  ]
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:440, maxWidth:'94vw', maxHeight:'82vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,0.55)' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 12px', borderBottom:'1px solid var(--borderSubtle)', flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:700, color:'var(--text)' }}>Syntax Reference</span>
          <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--textDim)', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
        </div>
        <div style={{ overflow:'auto', padding:'14px 20px 20px' }}>
          {SECTIONS.map(sec => (
            <div key={sec.title} style={{ marginBottom:18 }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--textDim)', opacity:0.6, marginBottom:8 }}>{sec.title}</div>
              {sec.rows.map(({keys,desc}) => (
                <div key={keys} style={{ display:'flex', alignItems:'baseline', gap:12, padding:'4px 0', borderBottom:'1px solid var(--borderSubtle)' }}>
                  <code style={{ fontFamily:'SF Mono,Menlo,Consolas,monospace', fontSize:11, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:5, padding:'2px 8px', color:'var(--accent)', flexShrink:0, minWidth:130, display:'inline-block' }}>{keys}</code>
                  <span style={{ fontSize:12, color:'var(--textDim)' }}>{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}