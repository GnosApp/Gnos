// Guest-side asset publishing — PLAN_CONCURRENCY.md §18.6 "Phase D". The
// browser-guest half of what src/lib/collab/hostAssets.js does for the host:
// hostAssets.js reads bytes off a real local disk (Tauri-only, never
// importable from the guest bundle); this file reads bytes from a `File`
// object the guest's own browser handed us (an `<input type=file>` pick, or
// an image paste/drop) — no filesystem access of any kind, browser-only,
// safe for collab-main.jsx to import.
//
// Publishes into the SAME `netDoc.getMap('assets')` / `getMap('assetsMeta')`
// Yjs maps hostAssets.js already uses — one asset pipeline, not two, so
// ImgWidget/assetsPlugin.js/FileLinkWidget all read from one place regardless
// of which side (host or guest) an asset came from.

// Same cap as hostAssets.js's own `MAX_ASSET_BYTES`, same reasoning (a room's
// updates travel over a WebRTC data channel shared with every keystroke) —
// not re-imported (hostAssets.js is Tauri-only, structurally off-limits to
// this bundle) but deliberately kept at the identical value so "too large"
// means the same thing on either side of a share.
export const MAX_GUEST_ASSET_BYTES = 2 * 1024 * 1024

function sanitizeExt(filename) {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(filename || '')
  return m ? m[1].toLowerCase() : ''
}

/** Synthetic key for a guest-uploaded asset — never collides with a host's
 *  real relative/absolute image path (those never start with `guest-asset:`)
 *  or with another upload (random id). The extension is kept so FileLinkWidget's
 *  icon-by-extension lookup and a browser's own download-filename guess both
 *  still work off the key alone if the display name is ever lost. */
function makeAssetKey(file) {
  const ext = sanitizeExt(file.name)
  const id = Math.random().toString(36).slice(2, 10)
  return `guest-asset:${Date.now()}-${id}${ext ? `.${ext}` : ''}`
}

/** Reads `file`, and — if it fits under the cap — publishes it into `netDoc`'s
 *  asset maps under a fresh synthetic key. Returns `{ ok: true, key, name }`
 *  on success, or `{ ok: false, reason: 'oversized' | 'unreadable' }` on
 *  failure — callers decide the UX (skip the insert, show a message); unlike
 *  hostAssets.js's oversized IMAGES (which still publish a placeholder marker
 *  so a guest can tell "too big" from "not arrived yet"), an upload that's
 *  rejected here was never inserted into the document at all, so there is no
 *  "still arriving" state to distinguish it from. */
export async function publishGuestAsset(netDoc, file) {
  if (!netDoc || !file) return { ok: false, reason: 'unreadable' }
  let bytes
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (bytes.byteLength > MAX_GUEST_ASSET_BYTES) return { ok: false, reason: 'oversized' }
  const key = makeAssetKey(file)
  netDoc.transact(() => {
    netDoc.getMap('assets').set(key, bytes)
  }, 'guest-asset-publish')
  return { ok: true, key, name: file.name || key }
}
