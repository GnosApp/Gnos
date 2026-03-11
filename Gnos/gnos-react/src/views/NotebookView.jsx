/* NotebookView.jsx — Obsidian-style Markdown editor
 *
 * Architecture
 * ────────────
 * • Single uncontrolled <textarea> as the primary editing surface.
 *   The browser owns cursor, selection, undo stack — zero React interference.
 * • Rendered <div> for the preview pane, updated from React state.
 * • Three view modes (toggled from toolbar):
 *     'source'  — textarea only           (Obsidian Source Mode)
 *     'live'    — textarea + preview split (Obsidian Live Preview)
 *     'preview' — preview only             (Obsidian Reading View)
 * • Smart keyboard: Enter continues lists/blockquotes, Tab indents, Ctrl+B/I/K/E etc.
 * • [[ wikilink autocomplete dropdown
 * • Find in page (Ctrl+F) — highlights in the rendered preview
 * • Auto-sizing textarea, debounced auto-save, animated save indicator
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadNotebookContent, saveNotebookContent } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'

// ─────────────────────────────────────────────────────────────────────────────
// Markdown utilities
// ─────────────────────────────────────────────────────────────────────────────

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
    (_, alt, url, title) => { images.push({ alt, url, title: title || '' }); return S + 'IMG' + (images.length - 1) + E })
  s = s.replace(/\[([^\]]+)\]\(([^)\s"]+)(?:\s+"([^"]*)")?\)/g,
    (_, txt, url, title) => { links.push({ txt, url, title: title || '' }); return S + 'LNK' + (links.length - 1) + E })
  s = s.replace(/``([^`]+)``/g, (_, c) => { codeSpans.push(c); return S + 'CODE' + (codeSpans.length - 1) + E })
  s = s.replace(/`([^`]+)`/g,   (_, c) => { codeSpans.push(c); return S + 'CODE' + (codeSpans.length - 1) + E })

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

  s = s.replace(new RegExp(S + 'CODE(\\d+)' + E, 'g'),
    (_, i) => `<code class="nb-inline-code">${esc(codeSpans[+i])}</code>`)
  s = s.replace(new RegExp(S + 'IMG(\\d+)' + E, 'g'),
    (_, i) => { const { alt, url, title } = images[+i]; return `<img src="${esc(url)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} class="nb-img" loading="lazy" onerror="this.style.display='none'">` })
  s = s.replace(new RegExp(S + 'LNK(\\d+)' + E, 'g'),
    (_, i) => { const { txt, url, title } = links[+i]; return `<a href="${esc(url)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${txt}</a>` })

  // Wikilinks [[Title]]
  s = s.replace(/\[\[([^\]]{1,120})\]\]/g, (_, title) => {
    const t  = title.trim()
    const nb = notebooks.find(n => n.title?.toLowerCase() === t.toLowerCase())
    const bk = !nb && library.find(b => b.title?.toLowerCase() === t.toLowerCase())
    const type = nb ? 'notebook' : bk ? 'book' : 'unresolved'
    const id   = nb ? nb.id : bk ? bk.id : ''
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
  if (/^\[\^/.test(f))    return 'footnote'
  if (raw.includes('\n: ')) return 'deflist'
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
    return `<pre class="nb-code${lang ? ' lang-' + esc(lang) : ''}"><code>${esc(body)}</code></pre>`
  }
  if (type === 'blockquote') {
    const lines = raw.split('\n').map(l => l.replace(/^>\s?/,''))
    return `<blockquote>${il(lines.join('<br>'))}</blockquote>`
  }
  if (type === 'tasklist') {
    const items = raw.split('\n').filter(l => /^[-*+]\s\[[ xX]\]/.test(l))
    return `<ul class="nb-tasklist">${items.map(l => {
      const ck = /\[[xX]\]/.test(l)
      const tx = l.replace(/^[-*+]\s\[[ xX]\]\s*/,'')
      return `<li class="nb-task-item${ck ? ' checked' : ''}"><span class="nb-checkbox" data-task-text="${esc(tx.trim())}">${ck ? '✓' : ''}</span>${il(tx)}</li>`
    }).join('')}</ul>`
  }
  if (type === 'ul') {
    const lines = raw.split('\n').filter(l => l.trim() && /^\s*[-*+]\s/.test(l))
    let html = '', depth = 0
    lines.forEach(l => {
      const ind = l.search(/\S/)
      const lvl = Math.floor(ind / 2)
      const tx  = l.replace(/^\s*[-*+]\s+/,'')
      if (lvl > depth) { html += '<ul>'.repeat(lvl - depth); depth = lvl }
      if (lvl < depth) { html += '</ul>'.repeat(depth - lvl); depth = lvl }
      html += `<li>${il(tx)}</li>`
    })
    if (depth > 0) html += '</ul>'.repeat(depth)
    return `<ul>${html}</ul>`
  }
  if (type === 'ol') {
    const lines = raw.split('\n').filter(l => /^\s*\d+[.)].?\s/.test(l))
    return `<ol>${lines.map(l => `<li>${il(l.replace(/^\s*\d+[.)].?\s+/,''))}</li>`).join('')}</ol>`
  }
  if (type === 'table') {
    const lines = raw.split('\n').filter(l => l.trim())
    if (lines.length < 2) return `<p>${il(raw)}</p>`
    const pr = row => row.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1 || a.length === 1)
    const headers = pr(lines[0])
    const aligns  = lines[1] ? pr(lines[1]).map(c => /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : 'left') : []
    const rows    = lines.slice(2).filter(l => !l.match(/^[|\-:\s]+$/))
    const thH = headers.map((h, i) => `<th style="text-align:${aligns[i] || 'left'}">${il(h)}</th>`).join('')
    const trH = rows.map(r => {
      const cells = pr(r)
      return `<tr>${cells.map((c, i) => `<td style="text-align:${aligns[i] || 'left'}">${il(c)}</td>`).join('')}</tr>`
    }).join('')
    return `<table class="nb-table"><thead><tr>${thH}</tr></thead><tbody>${trH}</tbody></table>`
  }
  if (type === 'footnote') {
    const m = raw.match(/^\[\^([^\]]+)\]:\s*(.*)/)
    if (m) return `<div class="nb-footnote"><sup class="nb-fn-ref" id="fn-${esc(m[1])}">[${esc(m[1])}]</sup> ${il(m[2])}</div>`
    return `<p>${il(raw)}</p>`
  }
  if (type === 'deflist') {
    const lines = raw.split('\n'); let html = '<dl>'
    lines.forEach(l => {
      if (l.startsWith(': ')) html += `<dd>${il(l.slice(2))}</dd>`
      else if (l.trim())     html += `<dt>${il(l.trim())}</dt>`
    })
    return html + '</dl>'
  }
  if (type.startsWith('h')) {
    const lvl  = parseInt(type[1])
    const m    = raw.match(/^#{1,6}\s+(.+?)(?:\s+\{#([^}]+)\})?$/)
    const text = m ? m[1] : raw.replace(/^#{1,6}\s+/,'')
    const id   = m?.[2] ? ` id="${esc(m[2])}"` : ''
    return `<h${lvl}${id}>${il(text)}</h${lvl}>`
  }
  let para = raw.replace(/\n/g,'<br>')
  para = para.replace(/\[\^([^\]]+)\]/g, `<sup class="nb-fn-ref"><a href="#fn-$1">[$1]</a></sup>`)
  return `<p>${il(para)}</p>`
}

function renderMarkdown(text, notebooks = [], library = []) {
  if (!text?.trim()) return ''
  const lines = text.split('\n')
  const blocks = []
  let buf = [], inFence = false

  const flush = () => {
    const raw = buf.join('\n').trim()
    if (raw) blocks.push(raw)
    buf = []
  }

  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('~~~')) {
      if (!inFence) { flush(); inFence = true; buf.push(line) }
      else { buf.push(line); flush(); inFence = false }
      continue
    }
    if (inFence) { buf.push(line); continue }
    if (line.trim() === '') { flush(); continue }
    if (/^\s*\|/.test(line)) { buf.push(line); continue }
    flush()
    buf.push(line)
  }
  flush()

  return blocks.map(raw => blockToHtml(raw, notebooks, library)).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline styles (all scoped, avoids polluting global.css)
// ─────────────────────────────────────────────────────────────────────────────
const STYLES = `
  /* ── Toolbar ─────────────────────────────────────────────────────────────── */
  .nb2-toolbar {
    display: flex; align-items: center; gap: 1px;
    padding: 0 10px; height: 38px; flex-shrink: 0;
    background: var(--surface); border-bottom: 1px solid var(--borderSubtle);
    overflow-x: auto; overflow-y: hidden;
  }
  .nb2-toolbar::-webkit-scrollbar { height: 0; }

  .nb2-btn {
    height: 26px; min-width: 26px; padding: 0 7px;
    border: none; background: none; cursor: pointer; border-radius: 5px;
    font-size: 12px; font-family: inherit; color: var(--textDim);
    display: flex; align-items: center; justify-content: center; gap: 3px;
    transition: background 0.1s, color 0.1s; white-space: nowrap; flex-shrink: 0;
  }
  .nb2-btn:hover { background: var(--surfaceAlt); color: var(--text); }
  .nb2-btn.active { background: var(--accent); color: #fff; }
  .nb2-btn.bold-btn  { font-weight: 800; font-size: 14px; }
  .nb2-btn.italic-btn { font-style: italic; }
  .nb2-btn.strike-btn { text-decoration: line-through; }
  .nb2-btn.mono-btn  { font-family: 'SF Mono', Menlo, monospace; }
  .nb2-btn.hl-btn    { background: rgba(255,220,0,0.18); }

  .nb2-sep { width: 1px; height: 16px; background: var(--borderSubtle); margin: 0 3px; flex-shrink: 0; }
  .nb2-spacer { flex: 1 1 0; min-width: 4px; }

  /* View mode group */
  .nb2-view-group {
    display: flex; gap: 2px; padding: 2px 3px;
    background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 7px;
  }
  .nb2-view-btn {
    height: 22px; padding: 0 9px; border: none; cursor: pointer; border-radius: 5px;
    font-size: 11px; font-weight: 600; font-family: inherit;
    transition: background 0.12s, color 0.12s; flex-shrink: 0;
  }
  .nb2-view-btn.active { background: var(--accent); color: #fff; }
  .nb2-view-btn:not(.active) { background: none; color: var(--textDim); }
  .nb2-view-btn:not(.active):hover { background: var(--hover, rgba(255,255,255,0.06)); color: var(--text); }

  /* ── Editor pane ─────────────────────────────────────────────────────────── */
  .nb2-pane {
    flex: 1 1 0; min-width: 0; overflow-y: auto;
    display: flex; flex-direction: column; align-items: center;
    background: var(--readerBg, var(--bg));
    scroll-behavior: smooth;
  }
  .nb2-page {
    width: 100%; max-width: 740px;
    padding: 56px 72px 140px;
    box-sizing: border-box;
    min-height: 100%;
    background: var(--readerCard, var(--surface));
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    box-shadow: -4px 0 24px rgba(0,0,0,0.12), 4px 0 24px rgba(0,0,0,0.12);
  }
  @media (max-width: 860px) {
    .nb2-page { padding: 40px 28px 120px; }
  }

  /* ── Title input ─────────────────────────────────────────────────────────── */
  .nb2-title {
    display: block; width: 100%;
    background: transparent; border: none; outline: none;
    font-family: Georgia, serif;
    font-size: 34px; font-weight: 800;
    color: var(--readerText, var(--text));
    caret-color: var(--accent);
    margin-bottom: 8px;
    letter-spacing: -0.4px; line-height: 1.25;
  }
  .nb2-title::placeholder { color: var(--textDim); opacity: 0.35; }

  /* ── Source textarea ─────────────────────────────────────────────────────── */
  .nb2-textarea {
    width: 100%; border: none; outline: none;
    background: transparent;
    color: var(--readerText, var(--text));
    font-family: var(--font-ui, system-ui, sans-serif);
    font-size: 15px; line-height: 1.8;
    caret-color: var(--accent);
    resize: none; overflow: hidden;
    min-height: 400px;
    padding: 0; display: block;
    letter-spacing: 0.01em;
    tab-size: 2;
  }
  .nb2-textarea::placeholder { color: var(--textDim); opacity: 0.38; font-style: italic; }
  .nb2-textarea::selection { background: rgba(56,139,253,0.28); }

  /* ── Preview rendered content ────────────────────────────────────────────── */
  .nb2-preview {
    min-height: 400px;
    font-size: 15px; line-height: 1.8;
    color: var(--readerText, var(--text));
  }
  .nb2-preview p  { margin: 0 0 0.85em; }
  .nb2-preview p:last-child { margin-bottom: 0; }
  .nb2-preview h1 { font-size: 1.9em; font-weight: 800; margin: 1.3em 0 0.5em; letter-spacing: -0.02em; line-height: 1.2; font-family: Georgia, serif; }
  .nb2-preview h2 { font-size: 1.45em; font-weight: 700; margin: 1.2em 0 0.45em; letter-spacing: -0.01em; line-height: 1.25; font-family: Georgia, serif; }
  .nb2-preview h3 { font-size: 1.15em; font-weight: 600; margin: 1.1em 0 0.4em; }
  .nb2-preview h4 { font-size: 1.02em; font-weight: 600; margin: 1em 0 0.35em; }
  .nb2-preview h5, .nb2-preview h6 { font-size: 0.92em; font-weight: 600; margin: 0.9em 0 0.3em; opacity: 0.8; }
  .nb2-preview strong { font-weight: 700; }
  .nb2-preview em { font-style: italic; }
  .nb2-preview del { text-decoration: line-through; opacity: 0.55; }
  .nb2-preview a { color: var(--accent); text-decoration: none; }
  .nb2-preview a:hover { text-decoration: underline; }
  .nb2-preview hr { border: none; border-top: 1px solid var(--border); margin: 1.6em 0; }
  .nb2-preview blockquote {
    border-left: 3px solid var(--accent);
    margin: 0.6em 0; padding: 4px 16px;
    color: var(--textDim); background: rgba(56,139,253,0.04);
    border-radius: 0 6px 6px 0;
  }
  .nb2-preview ul, .nb2-preview ol { padding-left: 1.6em; margin: 0.4em 0 0.8em; }
  .nb2-preview ul ul, .nb2-preview ul ol,
  .nb2-preview ol ul, .nb2-preview ol ol { margin: 0.2em 0; }
  .nb2-preview li { margin: 0.18em 0; }
  .nb2-preview pre {
    background: var(--surfaceAlt); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px; overflow-x: auto; margin: 0.8em 0;
  }
  .nb2-preview code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.88em; }
  .nb2-preview pre code { font-size: 13px; color: var(--text); }
  .nb2-preview .nb-inline-code {
    background: rgba(56,139,253,0.1); color: var(--accent);
    padding: 1px 5px; border-radius: 3px;
    font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 0.88em;
  }
  .nb2-preview .nb-hl { background: rgba(255,220,0,0.35); border-radius: 2px; padding: 0 1px; }
  .nb2-preview .nb-img { max-width: 100%; border-radius: 6px; margin: 6px 0; display: block; }
  .nb2-preview sup { font-size: 0.75em; vertical-align: super; }
  .nb2-preview sub { font-size: 0.75em; vertical-align: sub; }
  .nb2-preview .nb-table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 14px; }
  .nb2-preview .nb-table th, .nb2-preview .nb-table td { border: 1px solid var(--border); padding: 6px 12px; }
  .nb2-preview .nb-table thead tr { background: var(--surfaceAlt); font-weight: 600; }
  .nb2-preview .nb-table tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  .nb2-preview .nb-tasklist { list-style: none; padding-left: 0; }
  .nb2-preview .nb-task-item { display: flex; align-items: flex-start; gap: 8px; padding: 2px 0; }
  .nb2-preview .nb-checkbox {
    width: 16px; height: 16px; border: 1.5px solid var(--border); border-radius: 3px;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #fff; background: var(--surfaceAlt);
    cursor: pointer; margin-top: 4px; transition: background 0.1s, border-color 0.1s;
  }
  .nb2-preview .nb-checkbox:hover { border-color: var(--accent); }
  .nb2-preview .nb-task-item.checked .nb-checkbox { background: var(--accent); border-color: var(--accent); }
  .nb2-preview .nb-task-item.checked > :not(.nb-checkbox) { text-decoration: line-through; opacity: 0.5; }
  .nb2-preview .nb-footnote { font-size: 12px; color: var(--textDim); border-top: 1px solid var(--borderSubtle); padding-top: 4px; margin-top: 8px; }
  .nb2-preview dl { padding-left: 0; }
  .nb2-preview dt { font-weight: 700; margin-top: 8px; }
  .nb2-preview dd { margin-left: 20px; color: var(--textDim); }

  /* Wikilinks in preview */
  .nb2-preview .wikilink {
    color: var(--accent); border-bottom: 1px solid rgba(56,139,253,0.4);
    cursor: pointer; padding: 0 1px; border-radius: 2px;
    transition: background 0.1s;
  }
  .nb2-preview .wikilink:hover { background: rgba(56,139,253,0.1); }
  .nb2-preview .wikilink-unresolved { color: var(--textDim); border-bottom-style: dashed; opacity: 0.7; }

  /* Empty state */
  .nb2-empty { color: var(--textDim); opacity: 0.38; font-style: italic; pointer-events: none; }

  /* Find highlights */
  .nb2-preview mark.nb-find-hl { background: rgba(255,200,0,0.3); color: inherit; border-radius: 2px; padding: 0 1px; }
  .nb2-preview mark.nb-find-hl.current { background: rgba(255,130,0,0.55); }

  /* ── Find bar ────────────────────────────────────────────────────────────── */
  .nb2-find-bar {
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px; height: 42px; flex-shrink: 0;
    background: var(--surface); border-top: 1px solid var(--border);
    animation: nb2-slide-up 0.12s ease;
  }
  @keyframes nb2-slide-up { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .nb2-find-input {
    width: 240px; max-width: 100%;
    background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); font-size: 13px; padding: 5px 10px; outline: none; font-family: inherit;
    transition: border-color 0.12s;
  }
  .nb2-find-input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(56,139,253,0.15); }
  .nb2-find-status { font-size: 11px; color: var(--textDim); min-width: 54px; }
  .nb2-find-btn {
    background: none; border: 1px solid var(--border); color: var(--textDim);
    border-radius: 5px; padding: 3px 9px; font-size: 12px; cursor: pointer; font-family: inherit;
  }
  .nb2-find-btn:hover { background: var(--surfaceAlt); color: var(--text); }
  .nb2-find-close { font-size: 16px; opacity: 0.6; background: none; border: none; cursor: pointer; color: var(--textDim); padding: 0 4px; }
  .nb2-find-close:hover { opacity: 1; }

  /* ── Wiki autocomplete ───────────────────────────────────────────────────── */
  .nb2-wiki-drop {
    position: fixed; z-index: 9200;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    min-width: 230px; max-width: 340px;
    animation: nb2-drop-in 0.1s ease;
  }
  @keyframes nb2-drop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  .nb2-wiki-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px;
    border: none; background: none; width: 100%; cursor: pointer; text-align: left;
    font-size: 13px; color: var(--text); transition: background 0.08s; font-family: inherit;
  }
  .nb2-wiki-item:hover, .nb2-wiki-item.kb-active { background: var(--hover, rgba(255,255,255,0.06)); }
  .nb2-wiki-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .nb2-wiki-type { font-size: 10px; color: var(--textDim); flex-shrink: 0; margin-left: 4px; }

  /* ── Word count / status bar ─────────────────────────────────────────────── */
  .nb2-status { font-size: 11px; color: var(--textDim); white-space: nowrap; user-select: none; }

  /* ── Divider ─────────────────────────────────────────────────────────────── */
  .nb2-pane-divider { width: 1px; flex-shrink: 0; background: var(--border); }
`

// ─────────────────────────────────────────────────────────────────────────────
// NotebookView
// ─────────────────────────────────────────────────────────────────────────────
export default function NotebookView() {
  const notebook          = useAppStore(s => s.activeNotebook)
  const notebooks         = useAppStore(s => s.notebooks)
  const library           = useAppStore(s => s.library)
  const setView           = useAppStore(s => s.setView)
  const setActiveNotebook = useAppStore(s => s.setActiveNotebook)

  // UI state
  const [viewMode,    setViewMode]    = useState('live')   // 'source' | 'live' | 'preview'
  const [previewHtml, setPreviewHtml] = useState('')
  const [wordCount,   setWordCount]   = useState(0)
  const [wikiDrop,    setWikiDrop]    = useState(null)     // {items, x, y, trigOffset}
  const [wikiKbIdx,   setWikiKbIdx]   = useState(0)
  const [findOpen,    setFindOpen]    = useState(false)
  const [findQuery,   setFindQuery]   = useState('')
  const [findCount,   setFindCount]   = useState(0)
  const [findCurrent, setFindCurrent] = useState(0)
  const [editModal,   setEditModal]   = useState(false)

  // Refs
  const textareaRef   = useRef(null)
  const previewRef    = useRef(null)
  const titleRef      = useRef(null)
  const saveTimerRef  = useRef(null)
  const previewTimer  = useRef(null)
  const findMarksRef  = useRef([])
  const findIdxRef    = useRef(-1)
  const notebooksRef  = useRef(notebooks)
  const libraryRef    = useRef(library)
  const notebookRef   = useRef(notebook)

  useEffect(() => { notebooksRef.current = notebooks }, [notebooks])
  useEffect(() => { libraryRef.current   = library   }, [library])
  useEffect(() => { notebookRef.current  = notebook  }, [notebook])

  // ── Auto-resize textarea (declared early — used in load effect below) ──────
  const autoResize = useCallback(() => {
    const ta = textareaRef.current; if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [])

  // ── Load notebook content ──────────────────────────────────────────────────
  useEffect(() => {
    if (!notebook) return
    loadNotebookContent(notebook.id).then(raw => {
      const text = typeof raw === 'string' ? raw : ''
      if (textareaRef.current) textareaRef.current.value = text
      if (titleRef.current)    titleRef.current.value    = notebook.title || ''
      setWordCount(text.split(/\s+/).filter(Boolean).length)
      setPreviewHtml(renderMarkdown(text, notebooks, library))
      requestAnimationFrame(() => autoResize())
    })
    // Close find when switching notebooks
    setFindOpen(false)
    setWikiDrop(null)
  }, [notebook?.id]) // eslint-disable-line

  // ── Debounced preview update ───────────────────────────────────────────────
  const updatePreview = useCallback((text) => {
    clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      setPreviewHtml(renderMarkdown(text, notebooksRef.current, libraryRef.current))
    }, 80)
  }, [])

  // ── Save ───────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    const nb = notebookRef.current; if (!nb) return
    const text  = textareaRef.current?.value ?? ''
    const title = titleRef.current?.value?.trim() || 'Untitled'
    await saveNotebookContent(nb.id, text)
    const store = useAppStore.getState()
    store.updateNotebook(nb.id, {
      title,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      updatedAt: new Date().toISOString(),
    })
    await store.persistNotebooks?.()
    // Animate save icon
    const icon = document.getElementById('nb2-save-icon')
    if (icon) {
      icon.classList.add('visible')
      requestAnimationFrame(() => {
        icon.classList.add('animating')
        setTimeout(() => {
          icon.classList.remove('animating')
          setTimeout(() => icon.classList.remove('visible'), 400)
        }, 600)
      })
    }
  }, [])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, 800)
    const icon = document.getElementById('nb2-save-icon')
    if (icon) { icon.classList.remove('animating'); icon.classList.add('visible') }
  }, [doSave])

  // ── Exit ───────────────────────────────────────────────────────────────────
  const exitNotebook = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); await doSave() }
    setView('library')
  }, [doSave, setView])

  // ── Formatting helpers (direct textarea manipulation, no cursor-jump) ──────
  const applyWrap = useCallback((before, after, placeholder = '') => {
    const ta = textareaRef.current; if (!ta) return
    const ss = ta.selectionStart, se = ta.selectionEnd
    const val = ta.value
    const selected  = ss < se ? val.slice(ss, se) : placeholder
    const insertion = before + selected + after
    ta.setRangeText(insertion, ss, se, 'end')
    // Position cursor inside if no selection + placeholder
    if (ss === se && placeholder) {
      ta.setSelectionRange(ss + before.length, ss + before.length + placeholder.length)
    } else {
      ta.setSelectionRange(ss + before.length, ss + before.length + selected.length)
    }
    ta.focus()
    const newVal = ta.value
    setWordCount(newVal.split(/\s+/).filter(Boolean).length)
    updatePreview(newVal)
    scheduleSave()
    autoResize()
  }, [updatePreview, scheduleSave, autoResize])

  const toggleLinePrefix = useCallback((prefix) => {
    const ta = textareaRef.current; if (!ta) return
    const ss  = ta.selectionStart
    const val = ta.value
    const lineStart = val.lastIndexOf('\n', ss - 1) + 1
    const lineEnd   = val.indexOf('\n', ss)
    const end       = lineEnd === -1 ? val.length : lineEnd
    const line      = val.slice(lineStart, end)
    let newVal, newSs
    if (line.startsWith(prefix)) {
      newVal = val.slice(0, lineStart) + line.slice(prefix.length) + val.slice(end)
      newSs  = Math.max(lineStart, ss - prefix.length)
    } else {
      newVal = val.slice(0, lineStart) + prefix + line + val.slice(end)
      newSs  = ss + prefix.length
    }
    ta.value = newVal
    ta.setSelectionRange(newSs, newSs)
    ta.focus()
    setWordCount(newVal.split(/\s+/).filter(Boolean).length)
    updatePreview(newVal)
    scheduleSave()
    autoResize()
  }, [updatePreview, scheduleSave, autoResize])

  const insertBlock = useCallback((text) => {
    const ta = textareaRef.current; if (!ta) return
    const ss  = ta.selectionStart, se = ta.selectionEnd
    const val = ta.value
    // Ensure there's a newline before and after
    const before = (ss > 0 && val[ss - 1] !== '\n') ? '\n' : ''
    const after  = (se < val.length && val[se] !== '\n') ? '\n' : ''
    ta.setRangeText(before + text + after, ss, se, 'end')
    ta.focus()
    const newVal = ta.value
    updatePreview(newVal); scheduleSave(); autoResize()
  }, [updatePreview, scheduleSave, autoResize])

  // ── Wiki [[ autocomplete ───────────────────────────────────────────────────
  const checkWikiTrigger = useCallback(() => {
    const ta = textareaRef.current; if (!ta) return
    const val = ta.value
    const pos = ta.selectionStart
    const lineStart = val.lastIndexOf('\n', pos - 1) + 1
    const textBefore = val.slice(lineStart, pos)
    const trigIdx = textBefore.lastIndexOf('[[')
    if (trigIdx < 0) { setWikiDrop(null); return }
    const query = textBefore.slice(trigIdx + 2).toLowerCase()
    if (query.includes(']]') || query.length > 60) { setWikiDrop(null); return }

    const allItems = [
      ...(libraryRef.current || []).map(b => ({
        label: b.title, id: b.id,
        type: b.type === 'audio' ? 'Audio' : (b.fileType === 'pdf' ? 'PDF' : 'Book'),
        itemType: 'book', icon: b.type === 'audio' ? '🎵' : '📖',
      })),
      ...(notebooksRef.current || [])
        .filter(n => n.id !== notebookRef.current?.id)
        .map(n => ({ label: n.title, id: n.id, type: 'Note', itemType: 'notebook', icon: '📝' })),
    ].filter(r => !query || r.label.toLowerCase().includes(query)).slice(0, 8)

    if (!allItems.length) { setWikiDrop(null); return }

    // Estimate caret position from line count
    const linesAbove = val.slice(0, pos).split('\n').length
    const taRect     = ta.getBoundingClientRect()
    const lineHeight = 27
    const rawY       = taRect.top + (linesAbove) * lineHeight - ta.scrollTop + lineHeight
    const y = Math.min(rawY, window.innerHeight - 280)
    const x = Math.min(taRect.left + 20, window.innerWidth - 350)

    setWikiKbIdx(0)
    setWikiDrop({ items: allItems, x, y, trigOffset: lineStart + trigIdx })
  }, [])

  const applyWikiLink = useCallback((item) => {
    const ta = textareaRef.current; if (!ta || !wikiDrop) return
    const val = ta.value
    const pos = ta.selectionStart
    const insertion = `[[${item.label}]]`
    const newVal = val.slice(0, wikiDrop.trigOffset) + insertion + val.slice(pos)
    ta.value = newVal
    const newPos = wikiDrop.trigOffset + insertion.length
    ta.setSelectionRange(newPos, newPos)
    ta.focus()
    setWikiDrop(null)
    setWordCount(newVal.split(/\s+/).filter(Boolean).length)
    updatePreview(newVal)
    scheduleSave()
    autoResize()
  }, [wikiDrop, updatePreview, scheduleSave, autoResize])

  // ── Smart keyboard handler ─────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    const ta = textareaRef.current; if (!ta) return
    const ctrl = e.ctrlKey || e.metaKey
    const val  = ta.value
    const ss   = ta.selectionStart
    const se   = ta.selectionEnd

    // ── Wiki dropdown navigation ─────────────────────────────────────────
    if (wikiDrop) {
      if (e.key === 'Escape') { e.preventDefault(); setWikiDrop(null); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setWikiKbIdx(i => Math.min(i + 1, wikiDrop.items.length - 1)); return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setWikiKbIdx(i => Math.max(i - 1, 0)); return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyWikiLink(wikiDrop.items[wikiKbIdx]); return
      }
    }

    // ── Ctrl / Meta shortcuts ────────────────────────────────────────────
    if (ctrl) {
      switch (e.key) {
        case 'b': e.preventDefault(); applyWrap('**', '**', 'bold text'); return
        case 'i': e.preventDefault(); applyWrap('*', '*', 'italic text'); return
        case 'k': e.preventDefault(); applyWrap('[', '](url)', ss < se ? '' : 'link text'); return
        case 'e': e.preventDefault(); applyWrap('`', '`', 'code'); return
        case 'f': e.preventDefault(); setFindOpen(o => !o); return
        case 's': e.preventDefault(); doSave(); return
        default: break
      }
      if (e.shiftKey) {
        if (e.key === 'S') { e.preventDefault(); applyWrap('~~', '~~', 'strikethrough'); return }
        if (e.key === 'H' || e.key === 'h') { e.preventDefault(); applyWrap('==', '==', 'highlight'); return }
      }
      return
    }

    // ── Tab — indent / outdent list items, else insert 2 spaces ─────────
    if (e.key === 'Tab') {
      e.preventDefault()
      const lineStart = val.lastIndexOf('\n', ss - 1) + 1
      const lineEnd   = val.indexOf('\n', ss)
      const end       = lineEnd === -1 ? val.length : lineEnd
      const line      = val.slice(lineStart, end)
      if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line) || /^\s*[-*+]\s\[[ xX]\]/.test(line)) {
        if (!e.shiftKey) {
          ta.setRangeText('  ', lineStart, lineStart, 'end')
          ta.setSelectionRange(ss + 2, ss + 2)
        } else {
          if (val.slice(lineStart, lineStart + 2) === '  ') {
            ta.setRangeText('', lineStart, lineStart + 2, 'end')
            ta.setSelectionRange(Math.max(lineStart, ss - 2), Math.max(lineStart, ss - 2))
          }
        }
      } else {
        ta.setRangeText('  ', ss, se, 'end')
      }
      ta.focus()
      const nv = ta.value
      updatePreview(nv); scheduleSave(); autoResize()
      return
    }

    // ── Enter — smart list/blockquote continuation ────────────────────────
    if (e.key === 'Enter' && !e.shiftKey) {
      const lineStart = val.lastIndexOf('\n', ss - 1) + 1
      const lineEnd   = val.indexOf('\n', ss)
      const end       = lineEnd === -1 ? val.length : lineEnd
      const line      = val.slice(lineStart, end)

      // Task list
      const taskM = line.match(/^(\s*[-*+]\s\[[ xX]\]\s)/)
      if (taskM) {
        const rest = line.slice(taskM[1].length)
        if (!rest.trim()) {
          e.preventDefault()
          ta.setRangeText('\n', lineStart, ss, 'end')
          const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
          return
        }
        e.preventDefault()
        const prefix = taskM[1].replace(/\[[xX]\]/, '[ ]')
        ta.setRangeText('\n' + prefix, ss, se, 'end')
        const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
        return
      }

      // Unordered list
      const ulM = line.match(/^(\s*[-*+]\s)/)
      if (ulM) {
        const rest = line.slice(ulM[1].length)
        if (!rest.trim()) {
          e.preventDefault()
          ta.setRangeText('\n', lineStart, ss, 'end')
          const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
          return
        }
        e.preventDefault()
        ta.setRangeText('\n' + ulM[1], ss, se, 'end')
        const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
        return
      }

      // Ordered list
      const olM = line.match(/^(\s*)(\d+)(\.|\))\s/)
      if (olM) {
        const rest = line.slice(olM[0].length)
        if (!rest.trim()) {
          e.preventDefault()
          ta.setRangeText('\n', lineStart, ss, 'end')
          const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
          return
        }
        e.preventDefault()
        const nextNum = parseInt(olM[2]) + 1
        const prefix  = olM[1] + nextNum + olM[3] + ' '
        ta.setRangeText('\n' + prefix, ss, se, 'end')
        const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
        return
      }

      // Blockquote
      const bqM = line.match(/^(>\s?)/)
      if (bqM) {
        const rest = line.slice(bqM[1].length)
        if (!rest.trim()) {
          e.preventDefault()
          ta.setRangeText('\n', lineStart, ss, 'end')
          const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
          return
        }
        e.preventDefault()
        ta.setRangeText('\n' + bqM[1], ss, se, 'end')
        const nv = ta.value; updatePreview(nv); scheduleSave(); autoResize()
        return
      }
    }
  }, [wikiDrop, wikiKbIdx, applyWrap, applyWikiLink, updatePreview, scheduleSave, doSave, autoResize])

  // ── Input handler ──────────────────────────────────────────────────────────
  const handleInput = useCallback((e) => {
    const text = e.target.value
    setWordCount(text.split(/\s+/).filter(Boolean).length)
    updatePreview(text)
    scheduleSave()
    autoResize()
    checkWikiTrigger()
  }, [updatePreview, scheduleSave, autoResize, checkWikiTrigger])

  // ── Preview click — wikilinks + task checkboxes ────────────────────────────
  const handlePreviewClick = useCallback((e) => {
    const wl = e.target.closest('.wikilink')
    if (wl) {
      e.preventDefault()
      const type = wl.dataset.wlType
      const id   = wl.dataset.wlId
      if (type === 'notebook') {
        const nb = notebooksRef.current.find(n => n.id === id)
        if (nb) setActiveNotebook(nb)
      }
      return
    }
    const cb = e.target.closest('.nb-checkbox')
    if (cb) {
      const taskText = cb.dataset.taskText || ''
      const li = cb.closest('.nb-task-item')
      const isChecked = li?.classList.contains('checked')
      const ta = textareaRef.current; if (!ta) return
      const val = ta.value
      // Toggle matching task line in source
      const lines = val.split('\n')
      const idx = lines.findIndex(l =>
        (isChecked ? /\[[xX]\]/.test(l) : /\[ \]/.test(l)) &&
        l.includes(taskText)
      )
      if (idx !== -1) {
        lines[idx] = isChecked
          ? lines[idx].replace(/\[[xX]\]/i, '[ ]')
          : lines[idx].replace(/\[ \]/, '[x]')
        const newVal = lines.join('\n')
        ta.value = newVal
        updatePreview(newVal)
        scheduleSave()
      }
    }
  }, [setActiveNotebook, updatePreview, scheduleSave])

  // ── Find in page ───────────────────────────────────────────────────────────
  const clearFindHighlights = useCallback(() => {
    const preview = previewRef.current; if (!preview) return
    preview.querySelectorAll('.nb-find-hl').forEach(el => {
      el.replaceWith(document.createTextNode(el.textContent))
    })
    findMarksRef.current = []
    findIdxRef.current = -1
    setFindCount(0)
    setFindCurrent(0)
  }, [])

  const runFind = useCallback((query) => {
    clearFindHighlights()
    const preview = previewRef.current; if (!preview || !query.trim()) return

    // Ensure preview is visible
    if (viewMode === 'source') setViewMode('live')

    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT)
    const ranges = []
    const q = query.toLowerCase()
    let node
    while ((node = walker.nextNode())) {
      const text = node.textContent
      let idx = 0
      while ((idx = text.toLowerCase().indexOf(q, idx)) !== -1) {
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + q.length)
        ranges.push(range)
        idx += q.length
      }
    }

    // Wrap in reverse order to preserve range validity
    for (let i = ranges.length - 1; i >= 0; i--) {
      try {
        const mark = document.createElement('mark')
        mark.className = 'nb-find-hl'
        ranges[i].surroundContents(mark)
      } catch { /* skip complex nodes */ }
    }

    findMarksRef.current = [...preview.querySelectorAll('.nb-find-hl')]
    setFindCount(findMarksRef.current.length)

    if (findMarksRef.current.length > 0) {
      findIdxRef.current = 0
      setFindCurrent(1)
      findMarksRef.current[0].classList.add('current')
      findMarksRef.current[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [clearFindHighlights, viewMode])

  const navigateFind = useCallback((dir) => {
    const marks = findMarksRef.current; if (!marks.length) return
    marks[findIdxRef.current]?.classList.remove('current')
    findIdxRef.current = (findIdxRef.current + dir + marks.length) % marks.length
    setFindCurrent(findIdxRef.current + 1)
    marks[findIdxRef.current].classList.add('current')
    marks[findIdxRef.current].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!findOpen) { clearFindHighlights(); setFindQuery('') }
  }, [findOpen, clearFindHighlights])

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key === 'f') { e.preventDefault(); setFindOpen(o => !o) }
      if (e.key === 'Escape') { setFindOpen(false); setWikiDrop(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!notebook) return null

  const showSource  = viewMode === 'source' || viewMode === 'live'
  const showPreview = viewMode === 'preview' || viewMode === 'live'

  // ── Toolbar configuration ──────────────────────────────────────────────────
  const TB = [
    { label: 'H1', title: 'Heading 1',            action: () => toggleLinePrefix('# '),      style: { fontSize: 11, fontWeight: 700 } },
    { label: 'H2', title: 'Heading 2',            action: () => toggleLinePrefix('## '),     style: { fontSize: 11, fontWeight: 700 } },
    { label: 'H3', title: 'Heading 3',            action: () => toggleLinePrefix('### '),    style: { fontSize: 11, fontWeight: 700 } },
    { sep: true },
    { label: 'B',  title: 'Bold (Ctrl+B)',         action: () => applyWrap('**','**','bold text'),      className: 'bold-btn' },
    { label: 'I',  title: 'Italic (Ctrl+I)',        action: () => applyWrap('*','*','italic text'),     className: 'italic-btn' },
    { label: 'S',  title: 'Strikethrough',          action: () => applyWrap('~~','~~','strike'),         className: 'strike-btn' },
    { label: 'H',  title: 'Highlight (Ctrl+Shift+H)', action: () => applyWrap('==','==','highlight'),  className: 'hl-btn' },
    { label: '`',  title: 'Inline code (Ctrl+E)',   action: () => applyWrap('`','`','code'),             className: 'mono-btn' },
    { sep: true },
    { label: '❝',  title: 'Blockquote',             action: () => toggleLinePrefix('> ') },
    { label: '•',  title: 'Bullet list',             action: () => toggleLinePrefix('- ') },
    { label: '1.', title: 'Numbered list',           action: () => toggleLinePrefix('1. '),   style: { fontSize: 11 } },
    { label: '☐',  title: 'Task list',               action: () => toggleLinePrefix('- [ ] ') },
    { sep: true },
    { label: '🔗', title: 'Link (Ctrl+K)',           action: () => applyWrap('[','](url)','link text') },
    {
      label: '</>',
      title: 'Code block',
      style: { fontFamily: 'monospace', fontSize: 11 },
      action: () => insertBlock('```\n\n```'),
    },
    {
      label: '─',
      title: 'Horizontal rule',
      action: () => insertBlock('---'),
    },
    { sep: true },
    {
      label: '[[',
      title: 'Insert wikilink',
      style: { fontFamily: 'monospace', fontSize: 11 },
      action: () => {
        const ta = textareaRef.current; if (!ta) return
        const ss = ta.selectionStart
        ta.setRangeText('[[', ss, ss, 'end')
        ta.focus()
        const nv = ta.value
        updatePreview(nv); scheduleSave(); autoResize()
        checkWikiTrigger()
      },
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', color: 'var(--text)', overflow: 'hidden' }}>
      <style>{STYLES}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="nb-header">
        <GnosNavButton />
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />

        {/* Breadcrumb / title */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {notebook.title || 'Untitled'}
          </span>
        </div>

        {/* Word count */}
        <span className="nb2-status">{wordCount.toLocaleString()} words</span>

        {/* Animated save icon */}
        <div className="nb-save-indicator">
          <svg id="nb2-save-icon" className="nb-save-icon" viewBox="0 0 18 18" fill="none">
            <circle className="nb-save-ring" cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            <polyline className="nb-save-check" points="5.5,9 7.8,11.5 12.5,6.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* Edit notebook */}
        <button
          onClick={() => setEditModal(true)}
          title="Notebook settings"
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--textDim)', cursor: 'pointer', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Back */}
        <button
          onClick={exitNotebook}
          title="Back to Library"
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--textDim)', cursor: 'pointer', padding: '0 10px', height: 30, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          ← Library
        </button>
      </header>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="nb2-toolbar">
        {TB.map((item, i) => item.sep
          ? <div key={i} className="nb2-sep" />
          : (
            <button
              key={i}
              className={`nb2-btn${item.className ? ' ' + item.className : ''}`}
              title={item.title}
              style={item.style}
              onMouseDown={e => { e.preventDefault(); item.action() }}
            >
              {item.label}
            </button>
          )
        )}

        <div className="nb2-spacer" />

        {/* Find button */}
        <button
          className={`nb2-btn${findOpen ? ' active' : ''}`}
          title="Find (Ctrl+F)"
          onMouseDown={e => { e.preventDefault(); setFindOpen(o => !o) }}
          style={{ fontSize: 13, marginRight: 4 }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* View mode toggle */}
        <div className="nb2-view-group">
          {[
            { id: 'source',  label: 'Source' },
            { id: 'live',    label: 'Live' },
            { id: 'preview', label: 'Preview' },
          ].map(m => (
            <button
              key={m.id}
              className={`nb2-view-btn${viewMode === m.id ? ' active' : ''}`}
              onClick={() => setViewMode(m.id)}
              title={m.id === 'source' ? 'Source Mode' : m.id === 'live' ? 'Live Preview (split)' : 'Reading View'}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Source pane */}
        {showSource && (
          <div
            className="nb2-pane"
            style={{ borderRight: viewMode === 'live' ? '1px solid var(--border)' : 'none' }}
          >
            <div className="nb2-page">
              <input
                ref={titleRef}
                className="nb2-title"
                placeholder="Untitled"
                spellCheck={false}
                defaultValue={notebook.title || ''}
                onChange={() => scheduleSave()}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    textareaRef.current?.focus()
                  }
                }}
              />
              <textarea
                ref={textareaRef}
                className="nb2-textarea"
                placeholder={'Start writing…\n\nTip: # Heading  **bold**  *italic*  [[wikilink]]\nUse the toolbar or Ctrl+B/I/K/E for formatting.'}
                spellCheck
                defaultValue=""
                onInput={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={() => requestAnimationFrame(() => {
                  const ta = textareaRef.current; if (!ta) return
                  const text = ta.value
                  setWordCount(text.split(/\s+/).filter(Boolean).length)
                  updatePreview(text); scheduleSave(); autoResize()
                })}
              />
            </div>
          </div>
        )}

        {/* Preview pane */}
        {showPreview && (
          <div className="nb2-pane">
            <div className="nb2-page">
              {viewMode === 'preview' && (
                <div style={{ fontFamily: 'Georgia, serif', fontSize: 34, fontWeight: 800, color: 'var(--readerText, var(--text))', marginBottom: 24, letterSpacing: '-0.4px', lineHeight: 1.25 }}>
                  {titleRef.current?.value || notebook.title || 'Untitled'}
                </div>
              )}
              <div
                ref={previewRef}
                className="nb2-preview"
                onClick={handlePreviewClick}
                dangerouslySetInnerHTML={{
                  __html: previewHtml || `<p class="nb2-empty">Nothing to preview yet — start writing in the source pane.</p>`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Find bar ───────────────────────────────────────────────────────── */}
      {findOpen && (
        <div className="nb2-find-bar">
          <input
            className="nb2-find-input"
            placeholder="Find in note…"
            autoFocus
            value={findQuery}
            onChange={e => { setFindQuery(e.target.value); runFind(e.target.value) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); navigateFind(e.shiftKey ? -1 : 1) }
              if (e.key === 'Escape') setFindOpen(false)
            }}
          />
          <span className="nb2-find-status">
            {findCount > 0
              ? `${findCurrent} / ${findCount}`
              : findQuery
                ? 'Not found'
                : ''}
          </span>
          <button className="nb2-find-btn" onClick={() => navigateFind(-1)} title="Previous (Shift+Enter)">↑</button>
          <button className="nb2-find-btn" onClick={() => navigateFind(1)}  title="Next (Enter)">↓</button>
          <button className="nb2-find-close" onClick={() => setFindOpen(false)} title="Close (Esc)">×</button>
        </div>
      )}

      {/* ── Wiki autocomplete dropdown ──────────────────────────────────────── */}
      {wikiDrop && (
        <div className="nb2-wiki-drop" style={{ top: wikiDrop.y, left: wikiDrop.x }}>
          {wikiDrop.items.map((item, i) => (
            <button
              key={item.id}
              className={`nb2-wiki-item${i === wikiKbIdx ? ' kb-active' : ''}`}
              onMouseDown={e => { e.preventDefault(); applyWikiLink(item) }}
              onMouseEnter={() => setWikiKbIdx(i)}
            >
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span className="nb2-wiki-label">{item.label}</span>
              <span className="nb2-wiki-type">{item.type}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Notebook settings modal ─────────────────────────────────────────── */}
      {editModal && (
        <NotebookEditModal
          notebook={notebook}
          onClose={() => setEditModal(false)}
          onSave={({ title, coverColor }) => {
            if (titleRef.current) titleRef.current.value = title
            useAppStore.getState().updateNotebook(notebook.id, { title, coverColor })
            useAppStore.getState().persistNotebooks?.()
            setEditModal(false)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NotebookEditModal (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
function NotebookEditModal({ notebook, onSave, onClose }) {
  const [title, setTitle] = useState(notebook.title || '')
  const COLORS = ['#1a1a2e','#0f3460','#1b4332','#4a1942','#7f1d1d','#1e3a5f','#2d2d2d','#1c2b1c','#2a1a0e','#0d2137']
  const [color, setColor] = useState(notebook.coverColor || COLORS[0])
  return (
    <div
      style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center' }}
      onClick={onClose}
    >
      <div
        style={{ background:'var(--surface)',border:'1px solid var(--border)',borderRadius:14,padding:24,width:320,boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize:14,fontWeight:700,marginBottom:16,color:'var(--text)' }}>Edit Notebook</div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:4,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Title</div>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSave({ title: title.trim() || notebook.title, coverColor: color }) }}
            autoFocus
            style={{ width:'100%',background:'var(--bg)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:7,padding:'7px 10px',fontSize:13,outline:'none',boxSizing:'border-box' }}
          />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11,color:'var(--textDim)',marginBottom:8,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em' }}>Cover Colour</div>
          <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{ width:28,height:28,borderRadius:6,background:c,border:c===color?'2px solid var(--accent)':'2px solid transparent',cursor:'pointer',outline:c===color?'2px solid var(--accent)':'none',outlineOffset:1 }}
              />
            ))}
          </div>
        </div>
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button onClick={onClose} style={{ background:'none',border:'1px solid var(--border)',color:'var(--textDim)',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer' }}>Cancel</button>
          <button onClick={() => onSave({ title: title.trim() || notebook.title, coverColor: color })} style={{ background:'var(--accent)',border:'none',color:'#fff',borderRadius:7,padding:'7px 16px',fontSize:13,cursor:'pointer',fontWeight:600 }}>Save</button>
        </div>
      </div>
    </div>
  )
}