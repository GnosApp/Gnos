// Host-only asset collection — PLAN_CONCURRENCY.md §7/§10, option (1):
// referenced local images are collected on share, and published to the room
// so a browser guest with no local archive sees the same note the host
// does. Reads real files off disk via @tauri-apps/plugin-fs — NEVER import
// this from anything the web guest bundle (collab-main.jsx) pulls in.
// engine.js and CollabEditor.jsx are shared with the guest bundle and stay
// completely free of this file; only src/components/NoteCollabPanel.jsx
// (host-only, itself lazy-loaded from NotebookView.jsx) imports it.
const IMG_RE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+=\d+x)?(?:\s+"[^"]*")?\)/g

// Yjs updates travel over a WebRTC data channel shared with every keystroke
// in the room — a handful of small images is fine, a multi-megabyte photo
// dump would visibly stall typing for everyone. 2MB is a starting point, not
// a measured limit; revisit if real usage says otherwise.
const MAX_ASSET_BYTES = 2 * 1024 * 1024

/** De-duplicated list of local-looking image refs in `markdown` (skips
 *  `http(s):`/`data:` — those need no upload, a guest's browser fetches
 *  remote images directly; see assetsPlugin.js). */
export function extractLocalImageRefs(markdown) {
  const seen = new Set()
  const refs = []
  IMG_RE.lastIndex = 0
  let m
  while ((m = IMG_RE.exec(markdown || ''))) {
    const src = m[2]
    if (/^(https?:|data:)/i.test(src)) continue
    if (seen.has(src)) continue
    seen.add(src)
    refs.push(src)
  }
  return refs
}

function resolveAbsPath(src, notebookDir) {
  const s = String(src || '').replace(/^\.\//, '')
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) return s
  if (!notebookDir) return null
  return `${notebookDir.replace(/\/+$/, '')}/${s}`
}

/** Reads every local image the note references. Returns which ones got
 *  embedded vs skipped (oversized) so the caller can publish an honest
 *  placeholder marker for the oversized ones — without that, a guest would
 *  just see "not available yet" forever with no way to tell "too big" from
 *  "still arriving" apart. Unreadable files (moved, deleted, permissions)
 *  are silently dropped — not worth surfacing as an error to the host over
 *  what's ultimately a guest-side rendering nicety. */
export async function collectNoteAssets(markdown, notebookDir) {
  const refs = extractLocalImageRefs(markdown)
  const embedded = {}
  const oversized = []
  if (!refs.length) return { embedded, oversized }
  let readFile
  try { ({ readFile } = await import('@tauri-apps/plugin-fs')) } catch { return { embedded, oversized } }
  for (const src of refs) {
    const abs = resolveAbsPath(src, notebookDir)
    if (!abs) continue
    try {
      const bytes = await readFile(abs)
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      if (arr.byteLength > MAX_ASSET_BYTES) { oversized.push(src); continue }
      embedded[src] = arr
    } catch { /* moved/deleted/unreadable — guest just won't see it */ }
  }
  return { embedded, oversized }
}

/** Publishes into `netDoc` (the network-bound doc every peer connects
 *  through) — NEVER `canonicalDoc` (see engine.js: that doc is deliberately
 *  unreachable from the network at all, and assets need to actually reach
 *  guests). Idempotent — skips anything already published, so re-scanning
 *  after the host adds one new image mid-session only sends that one. */
export function publishAssets(netDoc, embedded, oversized) {
  if (!netDoc) return
  const assetsMap = netDoc.getMap('assets')
  const metaMap = netDoc.getMap('assetsMeta')
  netDoc.transact(() => {
    for (const [src, bytes] of Object.entries(embedded)) {
      if (!assetsMap.has(src)) assetsMap.set(src, bytes)
    }
    for (const src of oversized) {
      if (!metaMap.has(src)) metaMap.set(src, { oversized: true })
    }
  }, 'asset-publish')
}
