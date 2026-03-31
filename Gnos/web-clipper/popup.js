/**
 * Gnos Clipper — popup script
 */

;(async () => {
  'use strict'

  let mode = 'article'
  let clipData = null  // { title, url, author, description, md }

  const previewEl   = document.getElementById('preview')
  const titleEl     = document.getElementById('clip-title')
  const tagsEl      = document.getElementById('clip-tags')
  const copyBtn     = document.getElementById('btn-copy')
  const refreshBtn  = document.getElementById('btn-refresh')
  const metaUrlEl   = document.getElementById('meta-url')
  const statusEl    = document.getElementById('status')
  const modeBtns    = document.querySelectorAll('.mode-btn')

  // ── Current tab info ────────────────────────────────────────────────────

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.url) {
    metaUrlEl.textContent = tab.url.replace(/^https?:\/\//, '')
    metaUrlEl.title = tab.url
  }

  // ── Mode buttons ────────────────────────────────────────────────────────

  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      mode = btn.dataset.mode
      clip()
    })
  })

  // ── Clip function ───────────────────────────────────────────────────────

  async function clip() {
    previewEl.textContent = 'Generating preview…'
    previewEl.classList.add('preview-loading')
    statusEl.textContent = ''

    if (mode === 'link') {
      clipData = { title: tab.title || '', url: tab.url || '', author: '', description: '', md: '' }
      titleEl.value = clipData.title
      previewEl.textContent = buildMarkdown()
      previewEl.classList.remove('preview-loading')
      return
    }

    if (!tab?.id) { previewEl.textContent = 'Cannot access this tab.'; return }

    // Inject content script (safe to call multiple times — chrome ignores duplicates)
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    } catch (_) { /* already injected or restricted page */ }

    chrome.tabs.sendMessage(tab.id, { type: 'GNOS_CLIP', mode }, (res) => {
      if (chrome.runtime.lastError || !res) {
        previewEl.textContent = 'Could not access page content.\n(Restricted pages like browser settings cannot be clipped.)'
        previewEl.classList.remove('preview-loading')
        return
      }

      clipData = res

      // Pre-fill title from page if empty
      if (!titleEl.value && res.title) titleEl.value = res.title

      // If selection mode returned nothing, fall back
      if (mode === 'selection' && !res.md?.trim()) {
        previewEl.textContent = '(No selection found — select text on the page then try again.)'
        previewEl.classList.remove('preview-loading')
        return
      }

      previewEl.textContent = buildMarkdown()
      previewEl.classList.remove('preview-loading')
    })
  }

  // ── Markdown builder ────────────────────────────────────────────────────

  function buildMarkdown() {
    if (!clipData) return ''
    const title   = titleEl.value.trim() || clipData.title || 'Untitled'
    const url     = clipData.url || tab?.url || ''
    const author  = clipData.author || ''
    const desc    = clipData.description || ''
    const body    = clipData.md || ''
    const tags    = tagsEl.value.split(',').map(t => t.trim()).filter(Boolean)
    const date    = new Date().toISOString().split('T')[0]

    const frontmatter = [
      '---',
      'title: ' + title,
      'source: ' + url,
      'date: ' + date,
      'clipped_by: Gnos Clipper',
      author  ? 'author: ' + author  : null,
      tags.length ? 'tags: [' + tags.join(', ') + ']' : null,
      '---',
    ].filter(l => l !== null).join('\n')

    const parts = [frontmatter, '']
    if (desc) parts.push('> ' + desc, '')
    if (mode !== 'link') {
      parts.push('# ' + title, '')
      if (body.trim()) parts.push(body.trim())
    } else {
      parts.push('[' + title + '](' + url + ')')
    }

    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  // ── Copy to clipboard ───────────────────────────────────────────────────

  copyBtn.addEventListener('click', async () => {
    const md = buildMarkdown()
    if (!md) { showStatus('Nothing to copy.', false); return }

    try {
      await navigator.clipboard.writeText(md)
      copyBtn.textContent = 'Copied!'
      copyBtn.classList.add('success')
      showStatus('Pasted into your clipboard — open Gnos and paste.', true)
    } catch (_) {
      // Fallback for older browsers / restricted contexts
      const ta = document.createElement('textarea')
      ta.value = md
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      copyBtn.textContent = 'Copied!'
      copyBtn.classList.add('success')
      showStatus('Copied! Open Gnos and paste into a notebook.', true)
    }

    setTimeout(() => {
      copyBtn.textContent = 'Copy Markdown'
      copyBtn.classList.remove('success', 'error')
    }, 2200)
  })

  // ── Refresh ─────────────────────────────────────────────────────────────

  refreshBtn.addEventListener('click', () => clip())

  // ── Title / tags update preview ──────────────────────────────────────────

  titleEl.addEventListener('input', () => {
    if (clipData) previewEl.textContent = buildMarkdown()
  })
  tagsEl.addEventListener('input', () => {
    if (clipData) previewEl.textContent = buildMarkdown()
  })

  // ── Helpers ──────────────────────────────────────────────────────────────

  function showStatus(msg, ok) {
    statusEl.textContent = msg
    statusEl.style.color = ok ? '#4caf82' : '#f85149'
  }

  // ── Initial clip ─────────────────────────────────────────────────────────

  clip()
})()
