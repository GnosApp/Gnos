/**
 * Gnos Clipper — content script
 * Injected into the active tab to extract page content.
 */

(function () {
  'use strict'

  // ── Turndown-lite: minimal HTML → Markdown converter ──────────────────────
  // Handles the most common content elements without a heavy dependency.

  function htmlToMarkdown(element) {
    return nodeToMd(element).replace(/\n{3,}/g, '\n\n').trim()
  }

  function nodeToMd(node) {
    if (!node) return ''
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/\s+/g, ' ')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const tag = node.tagName.toLowerCase()
    const inner = () => [...node.childNodes].map(nodeToMd).join('')

    // Skip hidden elements
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return ''

    // Block elements
    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1])
      return '\n\n' + '#'.repeat(level) + ' ' + inner().trim() + '\n\n'
    }
    if (tag === 'p')  return '\n\n' + inner().trim() + '\n\n'
    if (tag === 'br') return '  \n'
    if (tag === 'hr') return '\n\n---\n\n'

    if (tag === 'blockquote') {
      return '\n\n' + inner().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n'
    }

    if (tag === 'pre') {
      const code = node.querySelector('code')
      const lang = (code?.className || '').replace(/.*language-/, '').split(/\s/)[0] || ''
      const text = (code || node).textContent
      return '\n\n```' + lang + '\n' + text.trimEnd() + '\n```\n\n'
    }
    if (tag === 'code') return '`' + node.textContent + '`'

    if (tag === 'strong' || tag === 'b') return '**' + inner() + '**'
    if (tag === 'em' || tag === 'i')     return '*' + inner() + '*'
    if (tag === 's' || tag === 'del')    return '~~' + inner() + '~~'

    if (tag === 'a') {
      const href = node.getAttribute('href') || ''
      const text = inner().trim() || href
      if (!href) return text
      const abs = href.startsWith('http') ? href : new URL(href, location.href).href
      return '[' + text + '](' + abs + ')'
    }

    if (tag === 'img') {
      const src = node.getAttribute('src') || ''
      const alt = node.getAttribute('alt') || ''
      if (!src) return ''
      const abs = src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, location.href).href
      return '![' + alt + '](' + abs + ')'
    }

    if (tag === 'ul') {
      return '\n\n' + [...node.children].map(li => '- ' + nodeToMd(li).trim()).join('\n') + '\n\n'
    }
    if (tag === 'ol') {
      return '\n\n' + [...node.children].map((li, i) => (i+1) + '. ' + nodeToMd(li).trim()).join('\n') + '\n\n'
    }
    if (tag === 'li') return inner()

    if (tag === 'table') return tableToMd(node)

    // Div/section/article wrappers — recurse
    if (['div','section','article','main','aside','nav','header','footer','figure','figcaption','details','summary'].includes(tag)) {
      return inner()
    }

    // Anything else — just get text
    return inner()
  }

  function tableToMd(table) {
    const rows = [...table.querySelectorAll('tr')]
    if (!rows.length) return ''
    const cells = rows.map(r => [...r.querySelectorAll('th,td')].map(c => c.textContent.trim().replace(/\|/g, '\\|')))
    if (!cells[0]?.length) return ''
    const header = '| ' + cells[0].join(' | ') + ' |'
    const sep    = '| ' + cells[0].map(() => '---').join(' | ') + ' |'
    const body   = cells.slice(1).map(r => '| ' + r.join(' | ') + ' |').join('\n')
    return '\n\n' + [header, sep, body].filter(Boolean).join('\n') + '\n\n'
  }

  // ── Article extractor (Readability-lite) ──────────────────────────────────
  // Scores blocks by text density to find the main content area.

  function extractArticleElement() {
    const candidates = [...document.querySelectorAll('article, [role="main"], main, .post, .article, .content, .entry-content, .post-content, #content, #main')]
    if (candidates.length) {
      // Pick the one with most text
      return candidates.reduce((a, b) => (a.textContent.length > b.textContent.length ? a : b))
    }
    // Score divs by text density
    let best = document.body, bestScore = 0
    document.querySelectorAll('div, section').forEach(el => {
      const text = el.textContent.trim().length
      const links = el.querySelectorAll('a').length + 1
      const score = text / links
      if (score > bestScore && text > 200) { best = el; bestScore = score }
    })
    return best
  }

  // ── Message listener ──────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'GNOS_CLIP') return

    const { mode, selection } = msg
    let md = ''

    try {
      if (mode === 'link') {
        md = ''  // handled in popup
      } else if (mode === 'selection') {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
          const frag = sel.getRangeAt(0).cloneContents()
          const div = document.createElement('div')
          div.appendChild(frag)
          md = htmlToMarkdown(div)
        } else {
          md = '' // will fall back in popup
        }
      } else if (mode === 'article') {
        const el = extractArticleElement()
        md = htmlToMarkdown(el)
      } else { // full
        md = htmlToMarkdown(document.body)
      }
    } catch (err) {
      md = ''
      console.error('[Gnos Clipper] extraction error', err)
    }

    sendResponse({
      md,
      title: document.title,
      url: location.href,
      description: document.querySelector('meta[name="description"]')?.content || '',
      author: document.querySelector('meta[name="author"]')?.content ||
              document.querySelector('[rel="author"]')?.textContent?.trim() || '',
    })
  })
})()
