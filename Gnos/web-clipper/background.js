/**
 * Gnos Clipper — service worker (background)
 * Handles scripting injection since MV3 restricts content_scripts
 * from running on extension action click without pre-declaration.
 */

chrome.action.onClicked.addListener(async (tab) => {
  // Action click opens popup — nothing needed here.
  // This file exists for future background tasks (e.g. right-click context menu).
})

// Optional: context menu for "Clip selection to Gnos"
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: 'gnos-clip-selection',
    title: 'Clip selection to Gnos',
    contexts: ['selection'],
  })
  chrome.contextMenus?.create({
    id: 'gnos-clip-page',
    title: 'Clip page to Gnos',
    contexts: ['page'],
  })
})

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  const mode = info.menuItemId === 'gnos-clip-selection' ? 'selection' : 'article'
  if (!tab?.id) return

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  } catch (_) { /* already injected */ }

  chrome.tabs.sendMessage(tab.id, { type: 'GNOS_CLIP', mode }, (res) => {
    if (!res) return
    const md = buildMarkdown(res.title, res.url, res.author, res.description, mode, res.md, [])
    // Copy via offscreen document workaround (MV3 service workers can't access clipboard)
    chrome.storage.session.set({ pendingClip: md })
    // Notify the user via badge
    chrome.action.setBadgeText({ text: '✓', tabId: tab.id })
    chrome.action.setBadgeBackgroundColor({ color: '#4caf82' })
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000)
  })
})

function buildMarkdown(title, url, author, description, mode, body, tags) {
  const date = new Date().toISOString().split('T')[0]
  const tagLine = tags.length ? '\ntags: [' + tags.join(', ') + ']' : ''
  const authorLine = author ? '\nauthor: ' + author : ''
  const descLine = description ? '\n> ' + description + '\n' : ''

  return [
    '---',
    'title: ' + title,
    'source: ' + url,
    'date: ' + date,
    'clipped_by: Gnos Clipper',
    authorLine.slice(1),
    tagLine.slice(1),
    '---',
    '',
    descLine,
    '# ' + title,
    '',
    body.trim(),
  ].filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n')
}
