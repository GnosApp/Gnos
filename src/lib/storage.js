import { readTextFile, writeTextFile, writeFile, readFile, remove, readDir, exists, mkdir, rename, stat } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { parseEpub } from '@/lib/epubParser'
import { mergeSilently } from '@/lib/merge3'
import { snapshot as _historySnapshot, prune as _historyPrune } from '@/lib/history'

// History must never be able to break a save — swallow everything.
const historySnapshot = (id, text, kind) =>
  _historySnapshot(id, text, kind).catch(() => null)
const historyPrune = (id) => { _historyPrune(id).catch(() => {}) }

// ── Base directory ────────────────────────────────────────────────────────────

let _baseDir = null

export function resetBaseDir() {
  _baseDir = null
}

function getArchivePath() {
  try {
    const store = window.__appStore
    if (store) return store.getState().archivePath || ''
  // eslint-disable-next-line no-empty
  } catch { }
  return ''
}

async function getBaseDir() {
  const archivePath = getArchivePath()

  if (archivePath) {
    if (_baseDir === archivePath) return _baseDir
    _baseDir = archivePath
  } else {
    if (_baseDir) return _baseDir
    const base = await appDataDir()
    _baseDir = await join(base, 'gnos')
  }

  const dirExists = await exists(_baseDir)
  if (!dirExists) await mkdir(_baseDir, { recursive: true })
  return _baseDir
}

// ── Key → subfolder routing ───────────────────────────────────────────────────

function getSubfolder(key) {
  // Pure order-cache/cold-start-fallback bookkeeping, not real per-item data
  // (unlike library.json, which the user asked to keep in books/ since it
  // does carry real per-book fields) — same treatment nb_index/sketches_index
  // already got in A87.
  if (key === 'notebooks_meta' || key === 'sketchbooks_meta') return '_internal'
  if (key.startsWith('book_') || key.startsWith('library'))            return 'books'
  if (key.startsWith('notebook_') || key.startsWith('notebooks_'))     return 'notebooks'
  if (key.startsWith('sketchbook_') || key.startsWith('sketchbooks_')) return 'sketches'
  if (key.startsWith('audiochap_') || key.startsWith('audiodata_') || key.startsWith('audiochaps_')) return 'audio'
  // Everything else is internal bookkeeping (prefs, indexes, migration
  // flags, caches, annotations, reading progress…) — never real user
  // content, so it doesn't belong loose at the archive root next to
  // audio/books/notebooks/sketches. One catch-all instead of naming each
  // key individually means new keys are compartmentalized automatically.
  // See A87 / migrateRootFilesToInternal() for the one-time relocation of
  // whatever already exists at root from before this routing existed.
  return '_internal'
}

/** Best-effort: mark a path hidden from Finder/Explorer without renaming it
 *  (a dot-prefix rename is off the table — the fs capability scope rejects
 *  dot-prefixed paths, the exact bug that broke the notebook index twice
 *  before, A52). Never throws — errors here must not block a real write. */
async function _hideFromFinder(path) {
  try { await invoke('hide_path', { path }) } catch { /* non-fatal, e.g. non-Tauri preview */ }
}

async function keyToPath(key) {
  const base = await getBaseDir()
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  const subfolder = getSubfolder(key)

  if (subfolder) {
    const subPath = await join(base, subfolder)
    const subExists = await exists(subPath)
    if (!subExists) {
      await mkdir(subPath, { recursive: true })
      // Only the internal bookkeeping folder gets hidden — real content
      // folders (books/audio/notebooks/sketches/covers) stay normally visible.
      if (subfolder === '_internal') _hideFromFinder(subPath)
    }
    return await join(subPath, `${safe}.json`)
  }

  return await join(base, `${safe}.json`)
}

// ── Core storage API ──────────────────────────────────────────────────────────

const storage = {
  async get(key) {
    const _t0 = window.__perfTask ? performance.now() : 0
    try {
      const filePath = await keyToPath(key)
      const fileExists = await exists(filePath)
      if (!fileExists) return null
      const value = await readTextFile(filePath)
      return { key, value }
    } catch { return null }
    finally {
      if (_t0) window.__perfTask(`read:${key.replace(/[0-9a-f_]{8,}/gi, '*')}`, performance.now() - _t0)
    }
  },

  async set(key, value) {
    // perf: JSON.stringify of a large payload (library.json, page indexes) is
    // SYNCHRONOUS main-thread work — a suspect for the reading-time stalls.
    const _t0 = window.__perfTask ? performance.now() : 0
    try {
      const filePath = await keyToPath(key)
      const str = typeof value === 'string' ? value : JSON.stringify(value)
      await writeTextFile(filePath, str)
      return true
    } catch (err) {
      console.error(`storage.set(${key}) failed:`, err)
      return false
    } finally {
      if (_t0) window.__perfTask(`write:${key.replace(/[0-9a-f_]{8,}/gi, '*')}`, performance.now() - _t0)
    }
  },

  async delete(key) {
    try {
      const filePath = await keyToPath(key)
      const fileExists = await exists(filePath)
      if (fileExists) await remove(filePath)
      return true
    } catch { return false }
  },

  async list(prefix = '') {
    try {
      const base = await getBaseDir()
      const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '_')

      const allEntries = []
      const rootEntries = await readDir(base)
      allEntries.push(...rootEntries
        .filter(e => e.name?.endsWith('.json') && !e.children)
        .map(e => e.name.replace(/\.json$/, ''))
      )

      const subfolders = ['books', 'notebooks', 'sketches', 'audio', '_internal']
      for (const sub of subfolders) {
        const subPath = await join(base, sub)
        const subExists = await exists(subPath)
        if (subExists) {
          const subEntries = await readDir(subPath)
          allEntries.push(...subEntries
            .filter(e => e.name?.endsWith('.json'))
            .map(e => e.name.replace(/\.json$/, ''))
          )
        }
      }

      return safePrefix
        ? allEntries.filter(k => k.startsWith(safePrefix))
        : allEntries
    } catch { return [] }
  },
}

export default storage

/**
 * One-time relocation of internal bookkeeping files that predate the
 * `_internal/` catch-all in `getSubfolder` above (A87) — prefs, indexes,
 * migration-done flags, caches, annotations, reading progress, etc. were all
 * sitting loose at the archive root, next to (and indistinguishable from)
 * the real content folders. Moves each into `_internal/`; every future write
 * for the same keys already lands there via `keyToPath`, this just catches
 * up whatever already existed on disk. Also drops the one confirmed-dead
 * file, `audio_flat_migrated.json` — superseded by the `_v2` guard in A75,
 * nothing reads the old key any more.
 * Runs once, guarded by `root_files_migrated`.
 */
export async function migrateRootFilesToInternal() {
  try {
    if (await _migrationDone('root_files_migrated')) return { migrated: 0, skipped: true }
    const base = await getBaseDir()
    const entries = await readDir(base).catch(() => [])
    let migrated = 0
    for (const e of entries) {
      if (!e.name || e.children || e.name.startsWith('.') || !e.name.toLowerCase().endsWith('.json')) continue
      const key = e.name.replace(/\.json$/i, '')
      if (key === 'audio_flat_migrated') {
        const p = await join(base, e.name)
        try { await invoke('move_to_trash', { paths: [p] }) }
        catch { await remove(p).catch(() => {}) }
        continue
      }
      if (getSubfolder(key) !== '_internal') continue // real-content key, stays where it is
      try {
        const internalDir = await join(base, '_internal')
        if (!(await exists(internalDir))) await mkdir(internalDir, { recursive: true })
        const from = await join(base, e.name)
        const to = await join(internalDir, e.name)
        if (await exists(to)) continue // already there — don't clobber, leave the root copy for inspection
        await rename(from, to)
        migrated++
      } catch (err) { console.warn('[Gnos] root → _internal migrate failed for', e.name, err) }
    }
    await _markMigrationDone('root_files_migrated')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateRootFilesToInternal failed', err); return { migrated: 0 } }
}

/**
 * `notebooks_meta.json`/`sketchbooks_meta.json` live inside their TYPE
 * folder (notebooks/, sketches/), not the archive root, so A87's root-only
 * scan never touched them — they're pure order-cache/cold-start-fallback
 * bookkeeping mixed in among the user's real files. Relocates the two
 * existing ones into `_internal/`; every future read/write already goes
 * there via `getSubfolder`'s new exact-key case, this just catches up.
 */
export async function migrateTypeMetaCachesToInternal() {
  try {
    if (await _migrationDone('type_meta_migrated')) return { migrated: 0, skipped: true }
    const base = await getBaseDir()
    let migrated = 0
    for (const [typeDir, fileName] of [['notebooks', 'notebooks_meta.json'], ['sketches', 'sketchbooks_meta.json']]) {
      try {
        const src = await join(base, typeDir, fileName)
        if (!(await exists(src))) continue
        const internalDir = await join(base, '_internal')
        if (!(await exists(internalDir))) await mkdir(internalDir, { recursive: true })
        const dest = await join(internalDir, fileName)
        if (await exists(dest)) { await remove(src).catch(() => {}); continue } // a fresh copy already landed there — drop the stale root one
        await rename(src, dest)
        migrated++
      } catch (err) { console.warn('[Gnos] type-meta cache migrate failed for', fileName, err) }
    }
    await _markMigrationDone('type_meta_migrated')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateTypeMetaCachesToInternal failed', err); return { migrated: 0 } }
}

// ── Trash system ──────────────────────────────────────────────────────────────

// Legacy in-archive trash location. New deletes go to the OS Trash (see
// moveToTrash), so this dir is no longer created — we only read it to clean up
// or filter out entries left by the old scheme. Returns the path without
// creating it; callers must guard on exists().
async function getTrashDir() {
  const base = await getBaseDir()
  return await join(base, 'trash')
}

/** Scan a parent directory for a subfolder whose meta.json has the given id. */
async function _findFolderById(parentDir, id) {
  try {
    const entries = await readDir(parentDir)
    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue
      const metaPath = await join(parentDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.id === id) return await join(parentDir, entry.name)
        } catch { /* skip corrupt */ }
      }
    }
  } catch { /* parent dir may not exist */ }
  return null
}

/**
 * Move an item's on-disk content folder into the trash directory and write a manifest.
 * For audiobooks, keyed-store audio payload (which can be 100s of MB) is deleted
 * immediately — it is too large to keep in trash.
 * @param {'book'|'audio'|'notebook'|'sketchbook'} type
 * @param {string} id
 * @param {string} title
 * @param {object} [bookObj]  Full book object — needed for audio payload cleanup.
 */
export async function moveToTrash(type, id, title, bookObj = null) {
  try {
    // Flat notebook — trash the single .md file and drop its index entry.
    if (type === 'notebook') {
      try {
        const idx = await loadNotebooksIndex()
        if (idx[id]?.file) {
          const entry = idx[id]
          // folderNote (A91) — trash the whole folder (images/ and all), not
          // just the .md inside it.
          const targetPath = entry.folderNote
            ? await join(await getBaseDir(), _splitIndexPath(entry.file).dir)
            : await _resolveIndexPath(entry.file)
          if (await exists(targetPath)) {
            try { await invoke('move_to_trash', { paths: [targetPath] }) }
            catch { try { await remove(targetPath, entry.folderNote ? { recursive: true } : undefined) } catch { /* non-fatal */ } }
          }
          await _removeNbIndex(id)
          return targetPath
        }
      } catch { /* fall through to folder handling */ }
    }
    // Flat sketchbook — trash the single .excalidraw file and drop its index entry.
    if (type === 'sketchbook') {
      try {
        const idx = await loadSketchesIndex()
        if (idx[id]?.file) {
          const flatPath = await _resolveSkPath(idx[id].file)
          if (await exists(flatPath)) {
            try { await invoke('move_to_trash', { paths: [flatPath] }) }
            catch { try { await remove(flatPath) } catch { /* non-fatal */ } }
          }
          await _removeSkIndex(id)
          return flatPath
        }
      } catch { /* fall through to folder handling */ }
    }
    // Audio — flat, resolved deterministically from the book object (the
    // folder/file name is a pure function of title/author, and title isn't
    // user-editable for audio, so this is stable — no meta.json to scan for
    // any more; library.json is already the sole meta source of truth).
    if (type === 'audio') {
      try {
        await removeSharedCover(id)
        if (bookObj) {
          if (bookObj.format === 'audiofolder') {
            const dir = await getAudioBookDir(bookObj)
            if (await exists(dir)) {
              try { await invoke('move_to_trash', { paths: [dir] }) }
              catch (err) { console.warn('[Gnos] move_to_trash failed for audio folder, removing directly', err); await remove(dir, { recursive: true }).catch(() => {}) }
            }
          } else {
            const flatPath = await getAudioFlatPath(bookObj)
            const target = (await exists(flatPath))
              ? flatPath
              // Not yet migrated this session — fall back to its legacy folder.
              : await join(await getAudioDir(), sanitizeFolderName(bookFolderName(bookObj)))
            if (await exists(target)) {
              try { await invoke('move_to_trash', { paths: [target] }) }
              catch (err) { console.warn('[Gnos] move_to_trash failed for audio file, removing directly', err); await remove(target, { recursive: true }).catch(() => {}) }
            }
          }
        }
        // Keyed-store audio payload is too large to keep; delete it immediately.
        if (bookObj?.format === 'audiofolder' && bookObj?.audioChapters) {
          for (let i = 0; i < bookObj.audioChapters.length; i++) {
            await storage.delete(`audiochap_${id}_${i}`)
          }
          await storage.delete(`audiochaps_${id}`)
        } else {
          await storage.delete(`audiodata_${id}`)
        }
      } catch (err) { console.warn('[Gnos] audio moveToTrash failed', err) }
      return true
    }

    // Book — flat, resolved deterministically from the book object (same
    // reasoning as audio: title isn't user-editable, so name-derivation is
    // stable and no meta.json scan is needed). Falls back to the legacy
    // named folder / oldest chunked keyed-store shape if not yet migrated.
    if (type === 'book') {
      try {
        await removeSharedCover(id)
        const booksDir = await getBooksDir()
        if (bookObj) {
          // Check every possible flat shape — pdf, kept epub (A86), or the
          // older content.json-only epub — whichever exists gets trashed.
          // Collection-aware (A96): resolves inside bookObj.collection's
          // folder if it has one, books/ otherwise.
          const flatDir = await getBookBaseDir(bookObj)
          const exts = bookObj.format === 'pdf' ? ['pdf'] : ['epub', 'content.json']
          const toTrash = []
          for (const ext of exts) {
            const p = await join(flatDir, _bookFlatName(bookObj, ext))
            if (await exists(p)) toTrash.push(p)
          }
          if (toTrash.length) {
            try { await invoke('move_to_trash', { paths: toTrash }) }
            catch (err) {
              console.warn('[Gnos] move_to_trash failed for book file(s), removing directly', err)
              for (const p of toTrash) await remove(p).catch(() => {})
            }
          }
          if (bookObj.format === 'epub') await _removeEpubCache(id)
        }
        // Legacy named folder (not yet migrated) — id-scanned, since bookObj
        // may be unavailable at some call sites.
        const legacyFolder = await _findFolderById(booksDir, id)
        if (legacyFolder && (await exists(legacyFolder))) {
          try {
            const trashed = await invoke('move_to_trash', { paths: [legacyFolder] })
            if (!Array.isArray(trashed) || trashed.length === 0) await _stripMeta(legacyFolder)
          } catch (err) { console.warn('[Gnos] move_to_trash failed for legacy book folder, stripping meta', err); await _stripMeta(legacyFolder) }
        }
        // Oldest legacy — chunked keyed store.
        await storage.delete(`book_${id}_data`)
        await storage.delete(`book_${id}_chunks`)
        for (let ci = 0; ci < 200; ci++) {
          const key = `book_${id}_chunk_${ci}`
          const filePath = await keyToPath(key)
          if (!(await exists(filePath))) break
          await remove(filePath)
        }
      } catch (err) { console.warn('[Gnos] book moveToTrash failed', err) }
      return true
    }

    // Locate the item's content folder on disk.
    let contentFolder = null
    try {
      if (type === 'notebook')   contentFolder = await _findFolderById(await getNotebooksDir(), id)
      else if (type === 'sketchbook') contentFolder = await _findFolderById(await getSketchesDir(), id)
    } catch { /* folder lookup failed — non-fatal */ }

    // Move the whole folder to the OS Trash — recoverable in Finder, and truly
    // gone from the archive (no in-app trash/ dir left cluttering the folder,
    // no orphaned .md for syncNotebooksFromDisk to resurrect).
    if (contentFolder && (await exists(contentFolder))) {
      try {
        const trashed = await invoke('move_to_trash', { paths: [contentFolder] })
        if (!Array.isArray(trashed) || trashed.length === 0) {
          // Command ran but nothing was trashed — fall back to removing meta.json
          // so the item can't reappear on the next scan.
          await _stripMeta(contentFolder)
        }
      } catch (trashErr) {
        console.warn('[Gnos] move_to_trash failed, stripping meta so it stays deleted', trashErr)
        await _stripMeta(contentFolder)
      }
    }

    return contentFolder || true
  } catch (err) {
    console.warn('[Gnos] moveToTrash failed:', err)
    return null
  }
}

/** Remove a folder's meta.json so loadNotebooksMeta / loadLibrary won't resurrect
 *  it — the fallback when the OS-trash move itself fails. */
async function _stripMeta(folder) {
  try {
    const metaPath = await join(folder, 'meta.json')
    if (await exists(metaPath)) await remove(metaPath)
  } catch { /* non-fatal */ }
}

// One-shot migration of the old in-archive trash to the OS Trash. Runs on
// startup: moves every leftover `<archive>/trash/*` entry to the OS Trash, then
// removes the now-empty `trash/` folder so the archive is clean. No-op once the
// dir is gone.
export async function cleanupTrash() {
  try {
    const trashDir = await getTrashDir()
    if (!(await exists(trashDir))) return
    const entries = await readDir(trashDir)
    const leftover = (entries || []).filter(e => e.name)
    if (leftover.length) {
      const paths = await Promise.all(leftover.map(e => join(trashDir, e.name)))
      try { await invoke('move_to_trash', { paths }) }
      catch (err) {
        console.debug('[Gnos] legacy trash → OS trash failed, removing directly', err)
        for (const p of paths) { try { await remove(p, { recursive: true }) } catch { /* skip */ } }
      }
    }
    // Remove the empty legacy trash dir so it stops cluttering the archive.
    try { await remove(trashDir, { recursive: true }) } catch { /* non-fatal */ }
  } catch (err) { console.debug('[Gnos] cleanupTrash error:', err) }
}

/**
 * Step 1 of the notebooks-folder de-clutter. Removes provable junk from the
 * notebooks/ directory — nothing the app shows is touched:
 *   • legacy `notebook_*.json` flat notes (superseded by the folder format;
 *     dupes-of-folders + abandoned orphans the user chose to drop)
 *   • empty stray folders (no meta.json, no .md — e.g. `books`/`trash`/`sketches`
 *     created by an old base-dir bug, and blank test notes)
 * Everything goes to the OS Trash (recoverable). A folder is only removed when it
 * has NO meta.json AND NO .md, so real notebooks are never at risk.
 * Runs once (guarded by the `nb_legacy_cleaned` flag).
 */
export async function cleanupLegacyNotebookFiles() {
  try {
    if (await _migrationDone('nb_legacy_cleaned')) return { removed: 0, skipped: true }
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    const junk = []
    for (const e of entries) {
      if (!e.name) continue
      // Legacy flat JSON notes
      if (/^notebook_.*\.json$/i.test(e.name)) { junk.push(await join(notebooksDir, e.name)); continue }
      if (e.name.startsWith('.')) continue // leave dotfiles (.index.json, .DS_Store)
      // Empty stray folders: readDir succeeds only for directories
      const p = await join(notebooksDir, e.name)
      const sub = await readDir(p).catch(() => null)
      if (!Array.isArray(sub)) continue // it's a file, not a dir
      const hasRealContent = sub.some(f => f.name && (f.name === 'meta.json' || f.name.endsWith('.md')))
      if (!hasRealContent) junk.push(p) // only dotfiles / truly empty → junk
    }
    if (junk.length) {
      try { await invoke('move_to_trash', { paths: junk }) }
      catch (err) {
        console.warn('[Gnos] legacy notebook junk → OS trash failed, removing directly', err)
        for (const p of junk) { try { await remove(p, { recursive: true }) } catch { /* skip */ } }
      }
    }
    await _markMigrationDone('nb_legacy_cleaned')
    return { removed: junk.length }
  } catch (err) { console.warn('[Gnos] cleanupLegacyNotebookFiles failed', err); return { removed: 0 } }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

export async function getJSON(key, fallback = null) {
  const result = await storage.get(key)
  if (!result) return fallback
  const raw = result.value ?? result
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch { return fallback }
}

export async function setJSON(key, value) {
  return storage.set(key, JSON.stringify(value))
}

// ── Migration guard flags (consolidated — A94) ────────────────────────────────
// Every one-time migration in this file used to guard itself with its own
// dedicated boolean file (`nb_flat_migrated_v2.json`, `sk_flat_migrated.json`,
// `root_files_migrated.json`, …) — eight tiny files in `_internal/` that are
// each just `true`. Collapsed into one `migrations.json` map. Back-compat is
// automatic: `_migrationDone` falls back to the OLD separate file the first
// time a given key is checked, folds it into the combined file, and removes
// the now-redundant old file — no dedicated one-off migration needed, every
// existing install self-heals the first time each guard is consulted (i.e.
// on the very next launch, same as it already ran once before).
const MIGRATION_FLAGS_KEY = 'migrations'

async function _migrationDone(key) {
  try {
    const flags = await getJSON(MIGRATION_FLAGS_KEY, {})
    if (flags && flags[key]) return true
    // Legacy: this flag may still be its own separate pre-A94 file.
    const legacy = await getJSON(key, false)
    if (legacy) {
      await _markMigrationDone(key)
      try {
        const p = await keyToPath(key)
        if (await exists(p)) await remove(p)
      } catch { /* non-fatal — orphaned but harmless */ }
      return true
    }
    return false
  } catch { return false }
}

async function _markMigrationDone(key) {
  try {
    const flags = await getJSON(MIGRATION_FLAGS_KEY, {})
    await setJSON(MIGRATION_FLAGS_KEY, { ...(flags || {}), [key]: true })
  } catch (err) { console.warn('[Gnos] _markMigrationDone failed for', key, err) }
}

// ── Binary helpers ────────────────────────────────────────────────────────────

// The raw PDF for a book, stored beside meta.json/content.json in its folder.
export const PDF_SOURCE_NAME = 'source.pdf'

// base64 data: URL → Uint8Array. Returns null for anything that isn't one.
export function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const binaryStr = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  return bytes
}

// ── Cover thumbnails ──────────────────────────────────────────────────────────
//
// Cover files on disk are full-size art (often 1600x2400). The grid paints them
// at 110x155, but the webview still decodes and holds the FULL bitmap for every
// mounted cover. A few hundred of those blows past WebKit's bitmap budget, it
// evicts backing store, and scrolling back up repaints blank until each cover
// re-decodes — the "blank on the third scroll up" symptom.
//
// Fix: keep a `cover_thumb.jpg` next to each `cover.*`. Reads prefer it, so
// steady-state decode is ~15KB/220px instead of megabytes. Generation is lazy
// and self-healing: the first launch after a cover appears still uses the full
// file, queues a downscale, and every launch after that is cheap. Nothing to
// migrate; deleting the thumbs just regenerates them.
const THUMB_NAME = 'cover_thumb.jpg'
const THUMB_W = 220, THUMB_H = 310
let _thumbQueue = []
let _thumbRunning = false

async function writeThumb(srcUrl, destPath) {
  const img = new Image()
  img.decoding = 'async'
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = () => rej(new Error('cover decode failed'))
    img.src = srcUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_W; canvas.height = THUMB_H
  const ctx = canvas.getContext('2d')
  // cover-fit crop, matching the grid's object-fit: cover
  const scale = Math.max(THUMB_W / img.naturalWidth, THUMB_H / img.naturalHeight)
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale
  ctx.drawImage(img, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h)
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82))
  if (!blob) throw new Error('thumb encode failed')
  await writeFile(destPath, new Uint8Array(await blob.arrayBuffer()))
  img.src = ''
}

// Serial on purpose: parallel decodes of full-size art are the exact spike this
// is meant to remove. Runs off the critical path (see App's post-init idle call).
export async function generatePendingThumbs() {
  if (_thumbRunning) return
  _thumbRunning = true
  try {
    while (_thumbQueue.length) {
      const job = _thumbQueue.shift()
      try { await writeThumb(job.srcUrl, job.destPath) } catch { /* skip this cover */ }
      // yield between covers so the UI stays responsive
      await new Promise(r => setTimeout(r, 30))
    }
  } finally { _thumbRunning = false }
}

// ── Library ───────────────────────────────────────────────────────────────────

export async function loadLibrary() {
  const library = await getJSON('library', [])
  if (!library?.length) return library ?? []
  // Attach cover images from book folders for any entry that doesn't already have one
  try {
    const booksDir = await getBooksDir()
    const [entries, progress, epubCache] = await Promise.all([readDir(booksDir), loadReadingProgress(), loadEpubCache()])
    // Build id → folder name map from meta.json files (reads run in parallel)
    const folderById = {}
    await Promise.all(
      entries
        .filter(e => e.name && !e.name.startsWith('.'))
        .map(async entry => {
          try {
            const metaPath = await join(booksDir, entry.name, 'meta.json')
            if (!(await exists(metaPath))) return
            const meta = JSON.parse(await readTextFile(metaPath))
            if (meta.id) folderById[meta.id] = entry.name
          } catch { /* skip corrupt */ }
        })
    )
    async function loadCoverFromFolder(baseDir, folder) {
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        const coverPath = await join(baseDir, folder, `cover.${ext}`)
        if (!(await exists(coverPath))) continue
        // Return an asset:// URL, NOT base64. The webview streams + decodes
        // the file natively and CACHES it across scroll — vs a giant base64
        // string that lived in the store JSON and was re-decoded on every
        // paint. Runtime-only; saveLibrary strips non-data URLs so JSON stays
        // small and covers re-derive from the folder each launch.
        try {
          const thumbPath = await join(baseDir, folder, THUMB_NAME)
          // Prefer the thumb, but only if it's at least as new as the cover —
          // otherwise the user replaced the art and the thumb is stale.
          if (await exists(thumbPath)) {
            let fresh = true
            try {
              const [c, t] = await Promise.all([stat(coverPath), stat(thumbPath)])
              if (c.mtime && t.mtime && new Date(t.mtime) < new Date(c.mtime)) fresh = false
            } catch { /* stat unavailable — trust the thumb */ }
            if (fresh) return convertFileSrc(thumbPath)
          }
          const srcUrl = convertFileSrc(coverPath)
          // loadLibrary runs more than once per session (fast pass + reconcile)
          if (!_thumbQueue.some(j => j.destPath === thumbPath)) {
            _thumbQueue.push({ srcUrl, destPath: thumbPath })
          }
          return srcUrl
        } catch { break }
      }
      return null
    }

    // Attach the on-disk PDF as an asset:// URL — flat file first (current
    // format), the legacy named folder second, and rescue books whose bytes
    // still live as base64 in library.json straight to the flat path (rather
    // than recreating a folder). The rescue writes the file once, then the
    // field is dropped by saveLibrary and never round-trips through JSON again.
    async function attachPdf(book, folder) {
      if (book.format !== 'pdf') return null
      const flatPath = await join(await getBookBaseDir(book), _bookFlatName(book, 'pdf'))
      if (!(await exists(flatPath))) {
        if (folder) {
          const legacyPath = await join(booksDir, folder, PDF_SOURCE_NAME)
          if (await exists(legacyPath)) {
            try { return convertFileSrc(legacyPath) } catch { /* fall through */ }
          }
        }
        const legacy = book.pdfDataUrl || book.rawDataUrl
        if (legacy?.startsWith('data:')) {
          try {
            const bytes = dataUrlToBytes(legacy)
            if (bytes) {
              await writeFile(flatPath, bytes)
              console.info('[Gnos] migrated PDF out of library.json:', book.title)
            }
          } catch { /* non-fatal */ }
        }
      }
      if (await exists(flatPath)) {
        try { return convertFileSrc(flatPath) } catch { return null }
      }
      return null
    }

    return await Promise.all(library.map(async (book) => {
      const bookFolder = folderById[book.id]
      let next = book

      // Reading position lives in reading_progress.json now (see below) —
      // merge it back on so every existing reader of book.currentChapter/
      // currentPage keeps working unchanged.
      const pos = progress[book.id]
      if (pos) next = { ...next, currentChapter: pos.currentChapter ?? next.currentChapter, currentPage: pos.currentPage ?? next.currentPage }

      // Epub with a cache entry expects a kept `.epub` source file (A86) — if
      // it's gone, flag it rather than silently reading from the cache or
      // (worse) silently dropping the library entry. A book with NO cache
      // entry predates this feature and was never expected to have a kept
      // file, so it's never flagged. Runtime-only, never persisted (stripped
      // in saveLibrary) — re-derived fresh on every load.
      if (book.format === 'epub' && epubCache[book.id]) {
        const epubPath = await join(await getBookBaseDir(book), _bookFlatName(book, 'epub'))
        if (!(await exists(epubPath))) next = { ...next, sourceMissing: true }
      }

      const pdfUrl = await attachPdf(book, bookFolder)
      // Drop the base64 regardless — it's either on disk now or unrecoverable,
      // and either way it must not keep bloating the store.
      if (pdfUrl || next.pdfDataUrl || next.rawDataUrl) {
        next = { ...next, pdfUrl: pdfUrl || null, pdfDataUrl: null, rawDataUrl: null }
      }

      if (!next.coverDataUrl) {
        // Covers live in the shared covers/ dir now (flat — no per-item
        // folder), for both books and audio; the per-folder cover.<ext> is
        // only a fallback for anything not yet migrated.
        const shared = await loadSharedCover(book.id)
        if (shared) return { ...next, coverDataUrl: shared }
        if (bookFolder) {
          const cover = await loadCoverFromFolder(booksDir, bookFolder)
          if (cover) return { ...next, coverDataUrl: cover }
        }
      }
      return next
    }))
  } catch { return library }
}

export async function saveLibrary(library) {
  // Persist only base64 (data:) covers as the reliable fallback. asset:// URLs
  // (from loadCoverFromFolder) are runtime-only + path-dependent — never store
  // them; the folder scan re-derives them each launch. This keeps library.json
  // small (covers were the bulk) and avoids stale asset paths if the archive
  // moves. Books whose cover exists only as a folder file simply carry no
  // coverDataUrl in JSON and get re-scanned on load.
  // pdfDataUrl/rawDataUrl are NEVER persisted. They used to be — a data: URL
  // slipped past the cover check above, so library.json carried ~1.37x the
  // bytes of every imported PDF and paid for it on every launch parse. The
  // real file lives at <bookDir>/source.pdf; pdfUrl is a runtime asset:// URL
  // re-derived by loadLibrary, so it's path-dependent and dropped too.
  //
  // Same disease, much worse case: a pre-binary-storage `audioChapters[]`
  // shape carried a base64 `dataUrl` per chapter. One 59-chapter audiobook
  // whose entry never got cleaned turned library.json into a 750MB file that
  // silently re-parsed on every launch and re-wrote on every reading-progress
  // autosave (37 rewrites in one 10-minute read, per a user perf report) —
  // the actual dominant cost, well past anything in the render/scan path.
  // Defensive strip here so a stray legacy dataUrl can never bloat the file
  // again; the real audio bytes live on disk (writeAudioFile) regardless.
  // sourceMissing (epub A86) is runtime-derived too — re-checked on every
  // loadLibrary, never persisted.
  // eslint-disable-next-line no-unused-vars
  const slim = library.map(({ pdfDataUrl, rawDataUrl, pdfUrl, sourceMissing, ...b }) => {
    let next = (b.coverDataUrl && !b.coverDataUrl.startsWith('data:'))
      ? { ...b, coverDataUrl: null }
      : b
    if (Array.isArray(next.audioChapters) && next.audioChapters.some(c => c?.dataUrl)) {
      next = { ...next, audioChapters: next.audioChapters.map(({ dataUrl, ...c }) => c) } // eslint-disable-line no-unused-vars
    }
    return next
  })
  return setJSON('library', slim)
}

// ── Reading progress (root-keyed, split out of library.json) ─────────────────
//
// currentChapter/currentPage used to live ONLY on the book object inside
// library.json, so ReaderView's position-autosave (every ~settle-after-pause,
// i.e. constantly while reading) had to rewrite the ENTIRE library array —
// every book's full metadata — to persist a two-number change to ONE book.
// Harmless while the array was small; catastrophic once one entry bloated to
// 750MB (A83) — 37 whole-file rewrites in a single 10-minute read. Progress
// now lives in its own small root-keyed file, `reading_progress.json`
// ({ [bookId]: {currentChapter, currentPage, updatedAt} }), same pattern as
// `nb_index`/`sketches_index`. `loadLibrary` merges it back onto each book so
// every existing reader (LibraryView resume cards, ProfileContent, etc.)
// keeps reading `book.currentChapter`/`currentPage` unchanged.
const READING_PROGRESS_KEY = 'reading_progress'

export async function loadReadingProgress() {
  try {
    const m = await getJSON(READING_PROGRESS_KEY, {})
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
  } catch { return {} }
}

/** Update ONE book's progress — the hot path. Never touches library.json. */
export async function patchReadingProgress(id, { currentChapter, currentPage }) {
  try {
    const all = await loadReadingProgress()
    all[id] = { currentChapter, currentPage, updatedAt: Date.now() }
    const ok = await setJSON(READING_PROGRESS_KEY, all)
    return ok !== false
  } catch (err) { console.warn('[Gnos] patchReadingProgress failed', err); return false }
}

// ── Notebooks (named-folder format) ──────────────────────────────────────────
//
// Folder layout:
//   archive/notebooks/<Title>/
//     <Title>.md      — raw markdown content
//     meta.json       — { id, title, wordCount, createdAt, updatedAt, coverColor }
//
// Legacy flat-file format (migrated on first load):
//   archive/notebooks/notebook_<id>.json  — JSON string of markdown content

async function getNotebooksDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'notebooks')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function getNotebookDir(notebook) {
  const notebooksDir = await getNotebooksDir()
  const folderName = sanitizeFolderName(notebook.title || notebook.id)
  if (!folderName || folderName.startsWith('.')) throw new Error(`Invalid notebook folder name: ${folderName}`)
  const dir = await join(notebooksDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** Returns the absolute folder path for a notebook (for resolving relative asset paths). */
export async function getNotebookFolderPath(notebook) {
  try {
    const notebooksDir = await getNotebooksDir()
    // Flat note — its "folder" (asset base) is the notebooks dir itself.
    const idx = await loadNotebooksIndex()
    if (idx[notebook.id]?.file) {
      // Asset base = the folder the note actually lives in (may be a collection).
      const abs = await _resolveIndexPath(idx[notebook.id].file)
      return abs.slice(0, abs.lastIndexOf('/'))
    }
    const entries = await readDir(notebooksDir)
    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.id === notebook.id) return await join(notebooksDir, entry.name)
        } catch { /* skip */ }
      }
    }
    const folderName = sanitizeFolderName(notebook.title || notebook.id)
    return await join(notebooksDir, folderName)
  } catch { return null }
}

/** Derive display metadata from raw markdown (title = leading `# `, word count). */
function _deriveMetaFromMd(md, fallbackTitle) {
  const text = typeof md === 'string' ? md : ''
  const h1 = text.match(/^#\s+(.+)\s*$/m)
  const body = h1 ? text.slice(text.indexOf(h1[0]) + h1[0].length) : text
  return {
    title: (h1?.[1] || fallbackTitle || 'Untitled').trim(),
    wordCount: (body.match(/\b[\w'’-]+\b/g) || []).length,
  }
}

/**
 * Cheap, stable content hash (FNV-1a, 32-bit hex).
 *
 * Change detection must NOT rely on mtime alone: iCloud rewrites mtimes when it
 * syncs a file whose bytes are identical, which produced false "this changed
 * underneath us" conclusions — the trigger for the fork storm. Comparing
 * content is the only honest test of "did this actually change".
 */
export function contentHash(text) {
  const s = String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Write a text file so a reader can never observe a half-written note: write a
 * sibling temp file, then rename over the target. rename() is atomic within a
 * filesystem, which also stops iCloud from uploading a partial file.
 * Falls back to a direct write if the rename path fails for any reason.
 */
export async function writeTextAtomic(path, text) {
  const tmp = `${path}.tmp`
  try {
    await writeTextFile(tmp, text)
    if (await exists(path)) await remove(path)
    await rename(tmp, path)
    return true
  } catch (err) {
    console.debug('[Gnos] atomic write fell back to direct write:', err)
    try { if (await exists(tmp)) await remove(tmp) } catch { /* ignore */ }
    await writeTextFile(path, text)
    return true
  }
}

function _mtimeMs(st) {
  const m = st?.mtime
  if (!m) return 0
  const t = m instanceof Date ? m.getTime() : (typeof m === 'number' ? m : Date.parse(m))
  return Number.isFinite(t) ? t : 0
}

/**
 * A `folderNote` index entry (A91 — a note with an `images/` dir, so it
 * couldn't flatten to a single .md, but its metadata IS index-backed like
 * every other note, no per-folder meta.json anymore) needs its whole FOLDER
 * renamed when the title changes, not just the .md inside it — otherwise the
 * folder name drifts out of sync with the title it holds. Returns the
 * updated archive-relative `file` path (unchanged if no rename was needed,
 * the target already existed, or the rename failed).
 */
async function _renameFolderNoteIfNeeded(entry, desiredTitle) {
  const fileName = entry.file
  const { dir: curDir, name: curName } = _splitIndexPath(fileName)
  const slash = curDir.lastIndexOf('/')
  const parentDir = slash === -1 ? '' : curDir.slice(0, slash)
  const oldFolderName = slash === -1 ? curDir : curDir.slice(slash + 1)
  const desiredFolderName = sanitizeFolderName(desiredTitle || oldFolderName) || oldFolderName
  if (!desiredFolderName || desiredFolderName.toLowerCase() === oldFolderName.toLowerCase()) return fileName
  try {
    const base = await getBaseDir()
    const oldDirAbs = parentDir ? await join(base, parentDir, oldFolderName) : await join(base, oldFolderName)
    const newDirAbs = parentDir ? await join(base, parentDir, desiredFolderName) : await join(base, desiredFolderName)
    if (!(await exists(oldDirAbs)) || (await exists(newDirAbs))) return fileName
    await rename(oldDirAbs, newDirAbs)
    const newMdName = `${desiredFolderName}.md`
    if (curName.toLowerCase() !== newMdName.toLowerCase()) {
      const oldMdAbs = await join(newDirAbs, curName)
      const newMdAbs = await join(newDirAbs, newMdName)
      if (await exists(oldMdAbs)) await rename(oldMdAbs, newMdAbs)
    }
    return parentDir ? `${parentDir}/${desiredFolderName}/${newMdName}` : `${desiredFolderName}/${newMdName}`
  } catch (err) { console.warn('[Gnos] folder-note rename failed', err); return fileName }
}

// ══════════════════════════════════════════════════════════════════════════
// FLAT NOTEBOOKS — a note is a single `notebooks/<Title>.md` file (pure
// markdown, no per-note folder, no meta.json sidecar). All app metadata lives
// in one hidden `notebooks/.index.json`, keyed by note id. A note only becomes
// a folder when it needs attachments (images). Folder-format notes still load
// (backward compatible); the migration converts plain notes to flat.
// ══════════════════════════════════════════════════════════════════════════
// The central index is stored via the app's keyed storage (archive-root
// `nb_index.json`), NOT a dotfile inside notebooks/. A leading-dot file there
// is rejected by the fs capability scope glob (`/**` / `$HOME/**`), which is why
// an earlier dotfile approach silently failed to persist. Root-keyed files
// (like flashcard_decks.json) are the proven-writable pattern. notebooks/ stays
// pure markdown.
const NB_INDEX_KEY = 'nb_index'

// ── Collections as real folders ──────────────────────────────────────────────
// A collection IS a folder at the archive root, named after the collection, and
// an item physically lives inside it (one collection per item). The library
// ignores folder structure entirely and lists every readable file in the
// archive, so where a note sits is purely the user's filing.
//
// Index paths are therefore stored RELATIVE TO THE ARCHIVE ROOT
// ("notebooks/Note.md", "My Research/Note.md"). Legacy entries hold a bare
// filename and are resolved against notebooks/ for backward compatibility.
const NB_HOME = 'notebooks'
// Folders that are app plumbing, not user collections.
const RESERVED_DIRS = new Set(['notebooks', 'books', 'audio', 'sketches', 'plugins', 'trash', 'covers', '_internal'])

/** Split a stored index path into { dir, name }. dir '' = archive root. */
function _splitIndexPath(file) {
  const p = String(file || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i === -1 ? { dir: NB_HOME, name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

/** Absolute path for an index `file` value (handles legacy bare filenames). */
async function _resolveIndexPath(file) {
  const { dir, name } = _splitIndexPath(file)
  const base = await getBaseDir()
  return dir ? await join(base, dir, name) : await join(base, name)
}

/** Absolute path of a collection's folder. */
export async function getCollectionDir(name) {
  const safe = sanitizeFolderName(name || '')
  if (!safe || RESERVED_DIRS.has(safe.toLowerCase())) return null
  return await join(await getBaseDir(), safe)
}

/** Create (or rename) a collection's folder on disk. Returns the folder name. */
export async function ensureCollectionFolder(name, oldName = null) {
  try {
    const dir = await getCollectionDir(name)
    if (!dir) return null
    if (oldName && sanitizeFolderName(oldName) !== sanitizeFolderName(name)) {
      const old = await getCollectionDir(oldName)
      if (old && (await exists(old)) && !(await exists(dir))) {
        await rename(old, dir)
        await _repointIndexDir(sanitizeFolderName(oldName), sanitizeFolderName(name))
        return sanitizeFolderName(name)
      }
    }
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    return sanitizeFolderName(name)
  } catch (err) { console.warn('[Gnos] ensureCollectionFolder failed', err); return null }
}

/** After a folder rename, update every index entry that pointed into it. */
async function _repointIndexDir(oldDir, newDir) {
  const idx = await loadNotebooksIndex()
  let changed = false
  for (const [id, e] of Object.entries(idx)) {
    if (!e?.file) continue
    const { dir, name } = _splitIndexPath(e.file)
    if (dir === oldDir) { idx[id] = { ...e, file: `${newDir}/${name}` }; changed = true }
  }
  if (changed) await saveNotebooksIndex(idx)
}

/**
 * Move a notebook into a collection folder (or back to notebooks/ when
 * `collectionName` is null). Physically relocates the file — one collection per
 * item, matching how folders actually work.
 */
export async function moveNotebookToCollection(id, collectionName) {
  try {
    const idx = await loadNotebooksIndex()
    const entry = idx[id]
    if (!entry?.file || entry.folderNote) return false   // no file, or a whole-folder note — not movable yet
    const from = await _resolveIndexPath(entry.file)
    if (!(await exists(from))) return false
    const { name } = _splitIndexPath(entry.file)
    const targetDir = collectionName ? sanitizeFolderName(collectionName) : NB_HOME
    if (collectionName && RESERVED_DIRS.has(targetDir.toLowerCase())) return false
    const base = await getBaseDir()
    const destDir = await join(base, targetDir)
    if (!(await exists(destDir))) await mkdir(destDir, { recursive: true })
    let finalName = name
    let to = await join(destDir, finalName)
    // Never clobber an existing file at the destination.
    let n = 2
    while (await exists(to)) {
      if (to === from) return true           // already there
      finalName = name.replace(/(\.md)$/i, ` ${n++}$1`)
      to = await join(destDir, finalName)
    }
    await rename(from, to)
    idx[id] = { ...entry, file: `${targetDir}/${finalName}` }
    await saveNotebooksIndex(idx)
    return true
  } catch (err) { console.warn('[Gnos] moveNotebookToCollection failed', err); return false }
}

/** Every user-created collection folder currently on disk. */
export async function listCollectionFolders() {
  try {
    const base = await getBaseDir()
    const entries = await readDir(base)
    const out = []
    for (const e of entries) {
      if (!e.name || e.name.startsWith('.')) continue
      if (RESERVED_DIRS.has(e.name.toLowerCase())) continue
      const sub = await readDir(await join(base, e.name)).catch(() => null)
      if (Array.isArray(sub)) out.push(e.name)   // readDir only succeeds on dirs
    }
    return out
  } catch { return [] }
}

/** Load the central notebooks index → map of { [id]: entry }. entry carries the
 *  meta (id,title,cover*,createdAt,updatedAt,wordCount,dueDate,tags,…) plus
 *  `file` = the flat filename relative to notebooks/. */
export async function loadNotebooksIndex() {
  try {
    const m = await getJSON(NB_INDEX_KEY, {})
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
  } catch { return {} }
}

async function saveNotebooksIndex(notes) {
  try {
    const ok = await setJSON(NB_INDEX_KEY, notes)
    return ok !== false
  } catch (err) { console.warn('[Gnos] saveNotebooksIndex failed', err); return false }
}

/** Merge a patch into one index entry (creating it if absent). */
async function _patchNbIndex(id, patch) {
  const notes = await loadNotebooksIndex()
  notes[id] = { ...(notes[id] || {}), ...patch, id }
  return saveNotebooksIndex(notes)
}

/** Remove an index entry. */
async function _removeNbIndex(id) {
  const notes = await loadNotebooksIndex()
  if (notes[id]) { delete notes[id]; await saveNotebooksIndex(notes) }
}

/** Choose a unique `<Title>.md` filename for a flat note, avoiding collisions
 *  with existing files, folders, and other index entries. */
function _flatFileName(title, id, takenLower) {
  const base = sanitizeFolderName(title || id) || id
  let name = `${base}.md`
  let n = 2
  while (takenLower.has(name.toLowerCase())) { name = `${base} ${n++}.md`; }
  takenLower.add(name.toLowerCase())
  return name
}

/** Absolute .md path for a note — flat file if it's in the index, else the
 *  folder's `<name>.md`. Returns null if it can't be resolved. */
export async function getNotebookMdPath(notebookOrId) {
  const id = typeof notebookOrId === 'string' ? notebookOrId : notebookOrId?.id
  if (!id) return null
  // External reference — the absolute path IS the md path.
  if (id.startsWith('ext_')) {
    return (typeof notebookOrId === 'object' && notebookOrId?.path) || await _externalPath(id)
  }
  try {
    const notebooksDir = await getNotebooksDir()
    const idx = await loadNotebooksIndex()
    if (idx[id]?.file) return await _resolveIndexPath(idx[id].file)
    const folder = await _findFolderById(notebooksDir, id)
    if (folder) return await resolveNotebookMdPath(folder)
  } catch { /* fall through */ }
  return null
}

/**
 * Flatten step 2 — convert plain folder-notes to flat `notebooks/<Title>.md`
 * + a central `.index.json`. Notes that carry attachments (an `images/` dir or
 * a `coverImage` file) KEEP their folder. The old folder is sent to the OS
 * Trash (recoverable) after the flat file is written — never hard-deleted.
 * Runs once (guarded by `nb_flat_migrated_v2`).
 */
export async function migrateNotebooksToFlat() {
  try {
    if (await _migrationDone('nb_flat_migrated_v2')) return { migrated: 0, skipped: true }
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    const notes = await loadNotebooksIndex()
    // Names already taken at the top level (flat files + folders we keep).
    const takenLower = new Set()
    for (const e of entries) { if (e.name) takenLower.add(e.name.toLowerCase()) }
    for (const k of Object.keys(notes)) { if (notes[k]?.file) takenLower.add(notes[k].file.toLowerCase()) }

    const trashFolders = []
    let migrated = 0
    for (const e of entries) {
      if (!e.name || e.name.startsWith('.')) continue
      const folder = await join(notebooksDir, e.name)
      const sub = await readDir(folder).catch(() => null)
      if (!Array.isArray(sub)) continue // not a directory
      const metaEntry = sub.find(f => f.name === 'meta.json')
      if (!metaEntry) continue // not a note folder (junk handled by step 1)
      let meta
      try { meta = JSON.parse(await readTextFile(await join(folder, 'meta.json'))) } catch { continue }
      if (!meta?.id) continue
      if (notes[meta.id]) continue // already flattened in a prior (interrupted) run — skip
      // Keep as a folder if it has attachments.
      const hasImages = sub.some(f => f.name === 'images')
      const hasCoverFile = typeof meta.coverImage === 'string' && meta.coverImage && !meta.coverImage.startsWith('data:')
      if (hasImages || hasCoverFile) continue
      // Read the note body.
      const mdEntry = sub.find(f => f.name === `${e.name}.md`) || sub.find(f => f.name?.endsWith('.md'))
      const mdPath = mdEntry ? await join(folder, mdEntry.name) : null
      const body = mdPath ? await readTextFile(mdPath).catch(() => '') : ''
      // Write the flat file.
      const fileName = _flatFileName(meta.title || e.name, meta.id, takenLower)
      const flatPath = await join(notebooksDir, fileName)
      await writeTextFile(flatPath, body)
      let syncedAt = 0
      try { syncedAt = _mtimeMs(await stat(flatPath)) } catch { /* non-fatal */ }
      notes[meta.id] = { ...meta, file: fileName, contentSyncedAt: syncedAt }
      trashFolders.push(folder)
      migrated++
    }
    if (migrated) {
      // ATOMICITY: only trash the source folders once the index that replaces
      // them is safely persisted. If the index write fails, keep the folders
      // (and don't set the done-flag) so nothing is lost and it retries.
      const indexOk = await saveNotebooksIndex(notes)
      if (!indexOk) {
        console.warn('[Gnos] flatten: index did not persist — keeping folders, will retry next launch')
        return { migrated: 0, error: 'index-write-failed' }
      }
      // Reversible: old folders go to the OS Trash, not rm.
      if (trashFolders.length) {
        try { await invoke('move_to_trash', { paths: trashFolders }) }
        catch (err) {
          console.warn('[Gnos] flatten: old folders → OS trash failed, leaving them in place', err)
          // Leaving the folders is safe — load dedupes by id, preferring the index.
        }
      }
    }
    await _markMigrationDone('nb_flat_migrated_v2')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateNotebooksToFlat failed', err); return { migrated: 0 } }
}

/**
 * A91 — fold folder-notes' metadata into `nb_index` too, same central-index
 * treatment every other type already got (audio/books/sketchbooks all
 * dropped their per-item `meta.json` this same week). The folder itself and
 * its `images/` stay exactly as they are — visually unchanged, still a real
 * self-contained folder — only `meta.json` goes away, replaced by an index
 * entry carrying `folderNote: true` so renames/delete/collections code knows
 * to treat the whole folder as the unit, not just the .md inside it.
 * Runs once, guarded by `nb_foldernotes_indexed`.
 */
export async function migrateNotebookFoldersToIndex() {
  try {
    if (await _migrationDone('nb_foldernotes_indexed')) return { migrated: 0, skipped: true }
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir).catch(() => [])
    const idx = await loadNotebooksIndex()
    let migrated = 0
    for (const e of entries) {
      if (!e.name || e.name.startsWith('.')) continue
      const folder = await join(notebooksDir, e.name)
      const sub = await readDir(folder).catch(() => null)
      if (!Array.isArray(sub)) continue // not a directory
      const metaEntry = sub.find(f => f.name === 'meta.json')
      if (!metaEntry) continue // already index-only, or not a note folder
      let meta
      try { meta = JSON.parse(await readTextFile(await join(folder, 'meta.json'))) } catch { continue }
      if (!meta?.id || idx[meta.id]) continue // corrupt, or already indexed somehow
      const mdEntry = sub.find(f => f.name === `${e.name}.md`) || sub.find(f => f.name?.endsWith('.md'))
      if (!mdEntry) continue // no content file — leave for manual review, don't guess
      let syncedAt = meta.contentSyncedAt || 0
      try { syncedAt = _mtimeMs(await stat(await join(folder, mdEntry.name))) } catch { /* keep prior */ }
      idx[meta.id] = { ...meta, file: `${NB_HOME}/${e.name}/${mdEntry.name}`, contentSyncedAt: syncedAt, folderNote: true }
      try { await remove(await join(folder, 'meta.json')) }
      catch (err) { console.warn('[Gnos] could not remove old meta.json for', e.name, err); delete idx[meta.id]; continue }
      migrated++
    }
    if (migrated) await saveNotebooksIndex(idx)
    await _markMigrationDone('nb_foldernotes_indexed')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateNotebookFoldersToIndex failed', err); return { migrated: 0 } }
}

/**
 * Reconcile notebook folders with what's actually on disk so that markdown
 * edited OUTSIDE the app (synced from another device, edited in Obsidian/vim,
 * dropped in by hand) is picked up.
 *
 * Two jobs per folder:
 *  1. ADOPT — a folder holding a .md but no meta.json is invisible to the app.
 *     Write a meta.json for it so it shows in the library.
 *  2. REFRESH — if the .md's mtime is newer than the last time we synced it
 *     (`contentSyncedAt`), re-derive title/wordCount/updatedAt from the file
 *     and rewrite meta.json. Without this the card keeps showing stale
 *     title/date even though the content changed.
 *
 * Safe to call repeatedly (startup, window focus); it only writes when a file
 * is genuinely newer than the recorded sync stamp.
 */
export async function syncNotebooksFromDisk() {
  const changed = []
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    // A91 — a folderNote is index-backed with NO meta.json BY DESIGN. Without
    // this check, every one of them looks exactly like an "externally
    // created" folder and gets a brand-new random id minted for it here on
    // the very next call — silently duplicating the note (same bug class as
    // A88/A90, just via this function instead).
    const idx = await loadNotebooksIndex()
    const indexedPaths = new Set(Object.values(idx).map(e => e?.file?.toLowerCase()).filter(Boolean))
    await Promise.all(entries
      .filter(e => e.name && !e.name.startsWith('.'))
      .map(async entry => {
        try {
          const folder = await join(notebooksDir, entry.name)
          const folderEntries = await readDir(folder).catch(() => [])
          if (!Array.isArray(folderEntries)) return
          // Prefer <folder>.md, else the first .md in the folder
          const preferred = folderEntries.find(f => f.name === `${entry.name}.md`)
          const anyMd     = folderEntries.find(f => f.name?.endsWith('.md'))
          const mdEntry   = preferred || anyMd
          if (!mdEntry) return
          if (indexedPaths.has(`${NB_HOME}/${entry.name}/${mdEntry.name}`.toLowerCase())) return // already index-backed (folderNote)
          const mdPath  = await join(folder, mdEntry.name)
          const st      = await stat(mdPath).catch(() => null)
          const mtime   = _mtimeMs(st)
          const metaPath = await join(folder, 'meta.json')
          const hasMeta  = await exists(metaPath)

          if (!hasMeta) {
            // ── ADOPT an externally-created notebook ──
            const md = await readTextFile(mdPath).catch(() => '')
            const d  = _deriveMetaFromMd(md, entry.name)
            const now = new Date(mtime || Date.now()).toISOString()
            const meta = {
              id: `nb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              title: d.title, wordCount: d.wordCount,
              createdAt: now, updatedAt: now,
              contentSyncedAt: mtime,
              adoptedFromDisk: true,
            }
            await writeTextFile(metaPath, JSON.stringify(meta, null, 2))
            changed.push(meta.id)
            return
          }

          // ── REFRESH if the markdown is newer than our last sync ──
          const meta = JSON.parse(await readTextFile(metaPath))
          if (!mtime || mtime <= (meta.contentSyncedAt || 0)) return
          const md = await readTextFile(mdPath).catch(() => null)
          if (md == null) return
          const d = _deriveMetaFromMd(md, meta.title || entry.name)
          const next = {
            ...meta,
            title: d.title || meta.title,
            wordCount: d.wordCount,
            updatedAt: new Date(mtime).toISOString(),
            contentSyncedAt: mtime,
          }
          await writeTextFile(metaPath, JSON.stringify(next, null, 2))
          changed.push(meta.id)
        } catch { /* skip this folder */ }
      }))
  } catch { /* notebooks dir missing — nothing to sync */ }
  return changed
}

export async function loadNotebooksMeta() {
  // Pick up markdown edited/added outside the app before reading meta.
  await syncNotebooksFromDisk()
  // First try to reconstruct from on-disk named folders
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    // Read every folder's meta.json in parallel — serial awaits here dominated
    // cold-start time on large archives
    const metas = (await Promise.all(
      entries
        .filter(e => e.name && !e.name.startsWith('.'))
        .map(async entry => {
          try {
            const metaPath = await join(notebooksDir, entry.name, 'meta.json')
            if (!(await exists(metaPath))) return null
            return JSON.parse(await readTextFile(metaPath))
          } catch { return null /* skip corrupt meta */ }
        })
    )).filter(Boolean)

    // ── Flat notes from the central index ──────────────────────────────────
    // Each is a single notebooks/<file>.md. Refresh title/wordCount/updatedAt
    // from the file when it changed outside the app (external/synced edit).
    try {
      const idx = await loadNotebooksIndex()
      let idxDirty = false
      const flatMetas = await Promise.all(Object.values(idx).map(async entry => {
        if (!entry?.id || !entry.file) return null
        try {
          const p = await _resolveIndexPath(entry.file)
          const st = await stat(p).catch(() => null)
          if (!st) return entry // file missing — keep stored meta, don't drop the note
          const mtime = _mtimeMs(st)
          if (mtime > (entry.contentSyncedAt || 0) + 1000) {
            const md = await readTextFile(p).catch(() => null)
            if (md != null) {
              const d = _deriveMetaFromMd(md, entry.title)
              const refreshed = { ...entry, title: d.title || entry.title, wordCount: d.wordCount, updatedAt: new Date(mtime).toISOString(), contentSyncedAt: mtime }
              idx[entry.id] = refreshed; idxDirty = true
              return refreshed
            }
          }
          return entry
        } catch { return entry }
      }))
      if (idxDirty) await saveNotebooksIndex(idx)
      for (const fm of flatMetas) if (fm) metas.push(fm)

      // ── Self-heal: adopt orphan flat .md files not referenced by any index
      // entry or folder. Guarantees a flat note is NEVER invisible even if the
      // index is lost/corrupt (as happened when the dotfile index failed to
      // persist). A fresh id is minted — content is preserved and the note
      // reappears; the entry is written back so it stays stable thereafter.
      try {
        // Index paths are archive-relative, so compare on the same footing and
        // scan BOTH notebooks/ and every collection folder — the library shows
        // all readable files in the archive, wherever the user filed them.
        const indexedFiles = new Set(
          Object.values(idx).map(e => e?.file && _splitIndexPath(e.file))
            .filter(Boolean).map(x => `${x.dir}/${x.name}`.toLowerCase()))
        const orphans = []
        for (const e of entries) {
          if (!e.name || e.name.startsWith('.') || !e.name.toLowerCase().endsWith('.md')) continue
          if (indexedFiles.has(`${NB_HOME}/${e.name}`.toLowerCase())) continue
          orphans.push({ name: e.name, dir: NB_HOME })
        }
        for (const colDir of await listCollectionFolders()) {
          const sub = await readDir(await join(await getBaseDir(), colDir)).catch(() => [])
          for (const f of (Array.isArray(sub) ? sub : [])) {
            if (!f.name || f.name.startsWith('.') || !f.name.toLowerCase().endsWith('.md')) continue
            if (indexedFiles.has(`${colDir}/${f.name}`.toLowerCase())) continue
            orphans.push({ name: f.name, dir: colDir })
          }
        }
        // ── iCloud conflict copies ────────────────────────────────────
        // iCloud resolves its OWN sync races by writing "Note 2.md" beside the
        // original. Adopting those as brand-new notes silently duplicates the
        // library, so merge them back into the note they came from and send the
        // copy to the OS Trash instead.
        for (let i = orphans.length - 1; i >= 0; i--) {
          const o = orphans[i]
          const m = /^(.*?) (\d+)\.md$/i.exec(o.name)
          if (!m) continue
          const originalRel = `${o.dir}/${m[1]}.md`
          if (!indexedFiles.has(originalRel.toLowerCase())) continue   // no original → treat as a real note
          try {
            const copyPath = await _resolveIndexPath(`${o.dir}/${o.name}`)
            const origPath = await _resolveIndexPath(originalRel)
            const copyText = await readTextFile(copyPath).catch(() => null)
            const origText = await readTextFile(origPath).catch(() => null)
            if (copyText == null || origText == null) continue
            const ownerId = Object.keys(idx).find(k => {
              const f = idx[k]?.file && _splitIndexPath(idx[k].file)
              return f && `${f.dir}/${f.name}`.toLowerCase() === originalRel.toLowerCase()
            })
            if (copyText !== origText) {
              if (ownerId) await historySnapshot(ownerId, copyText, 'remote')
              // No shared base available — union the two sides rather than pick one.
              const merged = mergeSilently(origText, origText, copyText)
              await writeTextAtomic(origPath, merged.text)
              if (ownerId) {
                idx[ownerId] = { ...idx[ownerId], contentHash: contentHash(merged.text) }
                idxDirty = true
              }
            }
            try { await invoke('move_to_trash', { paths: [copyPath] }) }
            catch { await remove(copyPath).catch(() => {}) }
            orphans.splice(i, 1)   // handled — do not adopt as a new note
            console.info('[Gnos] merged iCloud conflict copy back into', originalRel)
          } catch (err) { console.debug('[Gnos] conflict-copy merge failed:', err) }
        }

        if (orphans.length) {
          let adopted = false
          await Promise.all(orphans.map(async e => {
            try {
              const rel = `${e.dir}/${e.name}`
              const p = await _resolveIndexPath(rel)
              const st = await stat(p).catch(() => null)
              if (!st) return // it's a directory, not a flat file
              const md = await readTextFile(p).catch(() => null)
              if (md == null) return
              const mtime = _mtimeMs(st)
              const d = _deriveMetaFromMd(md, e.name.replace(/\.md$/i, ''))
              const entry = {
                id: `nb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title: d.title, wordCount: d.wordCount,
                createdAt: new Date(mtime).toISOString(), updatedAt: new Date(mtime).toISOString(),
                contentSyncedAt: mtime, file: rel, adoptedFromDisk: true,
              }
              idx[entry.id] = entry; metas.push(entry); adopted = true
            } catch { /* skip */ }
          }))
          if (adopted) await saveNotebooksIndex(idx)
        }
      } catch { /* non-fatal */ }
    } catch { /* index missing/corrupt — ignore, folders still load */ }

    // Filter out notebooks whose IDs appear in the trash manifests.
    // This handles the case where moveToTrash's folder rename failed (e.g. cross-device)
    // but the manifest was still written, leaving a stale meta.json in notebooksDir.
    try {
      const trashDir = await getTrashDir()
      const trashEntries = (await exists(trashDir)) ? await readDir(trashDir) : []
      const trashedIdList = await Promise.all(
        trashEntries
          .filter(te => te.name)
          .map(async te => {
            try {
              const tmPath = await join(trashDir, te.name, '_trash_meta.json')
              if (!(await exists(tmPath))) return null
              const tm = JSON.parse(await readTextFile(tmPath))
              return tm.type === 'notebook' && tm.id ? tm.id : null
            } catch { return null /* skip corrupt manifest */ }
          })
      )
      const trashedIds = new Set(trashedIdList.filter(Boolean))
      if (trashedIds.size > 0) {
        // For any notebook still on disk whose id is in the trash, remove the
        // meta.json so it won't resurface on the next launch either.
        for (const m of metas) {
          if (!trashedIds.has(m.id)) continue
          try {
            const staleFolder = await _findFolderById(notebooksDir, m.id)
            if (staleFolder) {
              const staleMeta = await join(staleFolder, 'meta.json')
              if (await exists(staleMeta)) await remove(staleMeta)
            }
          } catch { /* non-fatal */ }
        }
        metas.splice(0, metas.length, ...metas.filter(m => !trashedIds.has(m.id)))
      }
    } catch { /* trash dir may not exist yet — ignore */ }

    if (metas.length > 0) {
      // Deduplicate by ID — keep the entry with the most recent updatedAt (rename can create duplicates)
      const seen = new Map()
      for (const m of metas) {
        if (!m.id) continue
        const existing = seen.get(m.id)
        if (!existing || new Date(m.updatedAt) > new Date(existing.updatedAt)) {
          seen.set(m.id, m)
        }
      }
      const uniqueMetas = [...seen.values()]

      // Use the saved JSON order as the authoritative sort so manual reordering persists.
      // Items not in the saved order (newly created) go at the end sorted by updatedAt.
      const savedOrder = await getJSON('notebooks_meta', [])
      if (savedOrder.length > 0) {
        const idxMap = new Map(savedOrder.map((n, i) => [n.id, i]))
        return uniqueMetas.sort((a, b) => {
          const ai = idxMap.has(a.id) ? idxMap.get(a.id) : Infinity
          const bi = idxMap.has(b.id) ? idxMap.get(b.id) : Infinity
          if (ai !== bi) return ai - bi
          return new Date(b.updatedAt) - new Date(a.updatedAt)
        })
      }
      return uniqueMetas.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    }
  } catch { /* fall through to flat file */ }
  return getJSON('notebooks_meta', [])
}

export async function saveNotebooksMeta(notebooks) {
  const notebooksDir = await getNotebooksDir()
  const existingEntries = await readDir(notebooksDir).catch(() => [])
  const idx = await loadNotebooksIndex()
  let idxChanged = false
  const takenLower = new Set(existingEntries.map(e => e.name?.toLowerCase()).filter(Boolean))

  // Persist meta.json inside each notebook's folder, renaming folder if title changed
  for (const nb of notebooks) {
    try {
      // ── FLAT note (or folderNote — A91) — meta lives in the central index ──
      if (idx[nb.id]) {
        const entry = idx[nb.id]
        let fileName = entry.file
        if (entry.folderNote) {
          // Whole-folder note (images/ alongside it) — rename the FOLDER
          // itself so it stays in sync with the title, not just the .md.
          fileName = await _renameFolderNoteIfNeeded(entry, nb.title)
        } else {
          // `file` is archive-relative — rename only the basename, keeping the
          // note inside whatever collection folder it currently lives in.
          const { dir: curDir, name: curName } = _splitIndexPath(fileName)
          const desiredBase = sanitizeFolderName(nb.title || nb.id) || nb.id
          const curBase = curName.replace(/\.md$/i, '')
          if (fileName && desiredBase && desiredBase.toLowerCase() !== curBase.toLowerCase()) {
            const taken = new Set(takenLower); taken.delete(curName.toLowerCase())
            let nn = `${desiredBase}.md`, k = 2
            while (taken.has(nn.toLowerCase())) nn = `${desiredBase} ${k++}.md`
            try {
              const oldP = await _resolveIndexPath(fileName)
              const newP = await _resolveIndexPath(`${curDir}/${nn}`)
              if ((await exists(oldP)) && !(await exists(newP))) {
                await rename(oldP, newP)
                takenLower.delete(curName.toLowerCase()); takenLower.add(nn.toLowerCase())
                fileName = `${curDir}/${nn}`
              }
            } catch { /* keep old name on rename failure */ }
          }
        }
        idx[nb.id] = { ...entry, ...nb, file: fileName }
        idxChanged = true
        continue
      }
      const expectedName = sanitizeFolderName(nb.title || nb.id)
      // Find the existing folder for this notebook by id
      let existingFolderName = null
      for (const entry of existingEntries) {
        if (!entry.name || entry.name === '.DS_Store') continue
        const metaPath = await join(notebooksDir, entry.name, 'meta.json')
        if (await exists(metaPath)) {
          try {
            const meta = JSON.parse(await readTextFile(metaPath))
            if (meta.id === nb.id) { existingFolderName = entry.name; break }
          } catch { /* skip */ }
        }
      }
      // CRITICAL: merge over the meta.json already on disk instead of replacing
      // it. `nb` is the in-memory store object and does NOT carry the on-disk
      // bookkeeping fields — above all `contentSyncedAt`. Overwriting wiped that
      // stamp on every save, so the very next save saw "the .md is newer than we
      // last synced" and ran the conflict-fork, spawning an endless chain of
      // "<title> (offline edit …)" copies, each with a fresh id.
      const writeMeta = async (dir) => {
        const metaPath = await join(dir, 'meta.json')
        let prior = {}
        try { if (await exists(metaPath)) prior = JSON.parse(await readTextFile(metaPath)) } catch { /* corrupt — start clean */ }
        const merged = { ...prior, ...nb }
        // Never let an undefined store field clobber a real on-disk value.
        for (const k of ['contentSyncedAt', 'forkedFrom', 'forkedFromTitle', 'adoptedFromDisk']) {
          if (nb[k] === undefined && prior[k] !== undefined) merged[k] = prior[k]
        }
        await writeTextFile(metaPath, JSON.stringify(merged, null, 2))
      }
      if (existingFolderName && existingFolderName !== expectedName) {
        // Rename folder and the .md file inside it
        const oldDir = await join(notebooksDir, existingFolderName)
        const newDir = await join(notebooksDir, expectedName)
        if (!(await exists(newDir))) {
          await rename(oldDir, newDir)
          // Rename the .md file if it has the old folder name
          const oldMd = await join(newDir, `${existingFolderName}.md`)
          const newMd = await join(newDir, `${expectedName}.md`)
          if (await exists(oldMd)) await rename(oldMd, newMd)
        }
        await writeMeta(newDir)
      } else if (existingFolderName) {
        await writeMeta(await join(notebooksDir, existingFolderName))
      } else {
        // Brand new note, no folder anywhere for it yet — create it FLAT.
        // This used to unconditionally create a FOLDER (getNotebookDir), so
        // whichever save fired first for a new note — this meta-only save,
        // or saveNotebookContent's own (already-flat) "new note" path —
        // silently decided the note's format forever. A90: found this had
        // left real notebooks stuck as orphan folders never in `nb_index`.
        const fileName = _flatFileName(nb.title || nb.id, nb.id, takenLower)
        const flatPath = await join(notebooksDir, fileName)
        if (!(await exists(flatPath))) await writeTextFile(flatPath, '')
        let syncedAt = 0
        try { syncedAt = _mtimeMs(await stat(flatPath)) } catch { /* non-fatal */ }
        idx[nb.id] = { ...nb, file: fileName, contentSyncedAt: syncedAt }
        idxChanged = true
      }
    } catch (err) {
      console.warn('[Gnos] saveNotebooksMeta folder write failed for', nb.id, err)
    }
  }
  if (idxChanged) await saveNotebooksIndex(idx)
  // Also keep the flat index for quick cold-start
  return setJSON('notebooks_meta', notebooks)
}

/**
 * Resolve the markdown file inside a known notebook folder.
 * Prefers `<folder>/<folder>.md`, else the first `.md` in the folder.
 * Returns an absolute path or null.
 */
export async function resolveNotebookMdPath(folderPath) {
  if (!folderPath) return null
  try {
    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop()
    const preferred = await join(folderPath, `${folderName}.md`)
    if (await exists(preferred)) return preferred
    const entries = await readDir(folderPath).catch(() => [])
    const md = (Array.isArray(entries) ? entries : []).find(e => e.name?.endsWith('.md'))
    return md ? await join(folderPath, md.name) : null
  } catch { return null }
}

/** mtime (ms) of any file, 0 when missing/unreadable. Cheap — used for polling. */
export async function getFileMtimeMs(path) {
  if (!path) return 0
  try { return _mtimeMs(await stat(path)) } catch { return 0 }
}

/** Read a notebook's markdown straight off disk along with its mtime. */
export async function readNotebookMdAt(path) {
  if (!path) return null
  try {
    const text = await readTextFile(path)
    return { text, mtimeMs: await getFileMtimeMs(path) }
  } catch { return null }
}

/** Stamp `contentSyncedAt` on a notebook's meta.json without touching the .md.
 *  Used after the editor adopts an external edit, so the next disk scan doesn't
 *  see the file as newer than what the app already holds. */
export async function stampNotebookSynced(folderPath, mtimeMs) {
  if (!folderPath || !mtimeMs) return false
  try {
    const metaPath = await join(folderPath, 'meta.json')
    if (!(await exists(metaPath))) return false
    const meta = JSON.parse(await readTextFile(metaPath))
    await writeTextFile(metaPath, JSON.stringify({ ...meta, contentSyncedAt: mtimeMs }, null, 2))
    return true
  } catch { return false }
}

// ══════════════════════════════════════════════════════════════════════════
// EXTERNAL FILE REFERENCES — edit a .md that lives OUTSIDE the archive (a
// download, an Obsidian vault, anywhere). The file is never copied in; reads
// and saves hit the original absolute path. Refs are tracked in the root
// `external_refs.json` so pinned ones survive restarts. Ref ids are `ext_…`.
// ══════════════════════════════════════════════════════════════════════════
export async function loadExternalRefs() {
  const a = await getJSON('external_refs', [])
  return Array.isArray(a) ? a : []
}
export async function saveExternalRefs(list) {
  return setJSON('external_refs', Array.isArray(list) ? list : [])
}
/** Absolute path for an external ref id, or null. */
async function _externalPath(id) {
  try { return (await loadExternalRefs()).find(r => r.id === id)?.path || null } catch { return null }
}
/** Read an external file's text + mtime straight off disk. */
export async function readExternalFile(path) {
  try { return { text: await readTextFile(path), mtimeMs: await getFileMtimeMs(path) } } catch { return null }
}

export async function loadNotebookContent(id) {
  // External reference — read the original file by absolute path.
  if (typeof id === 'string' && id.startsWith('ext_')) {
    const p = await _externalPath(id)
    if (p) { try { return await readTextFile(p) } catch { return '' } }
    return ''
  }
  // Flat note (central index) — read the single .md directly.
  try {
    const notebooksDir = await getNotebooksDir()
    const idx = await loadNotebooksIndex()
    if (idx[id]?.file) {
      const p = await _resolveIndexPath(idx[id].file)
      if (await exists(p)) return await readTextFile(p)
    }
  } catch { /* fall through to folder */ }
  // Try named folder next
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const mdPath = await join(notebooksDir, entry.name, `${entry.name}.md`)
          if (await exists(mdPath)) {
            return await readTextFile(mdPath)
          }
          // Fallback: any .md file in the folder
          const folderEntries = await readDir(await join(notebooksDir, entry.name))
          const mdFile = folderEntries.find(e => e.name?.endsWith('.md'))
          if (mdFile) {
            return await readTextFile(await join(notebooksDir, entry.name, mdFile.name))
          }
          return ''
        }
      }
    }
  } catch (err) { console.debug('[Gnos] loadNotebookContent named folder failed', err) }
  // Legacy: JSON-wrapped string
  const raw = await getJSON(`notebook_${id}`, '')
  return typeof raw === 'string' ? raw : (raw?.content ?? '')
}

/** Preserve an external/offline edit that would otherwise be overwritten:
 *  write the disk version into a brand-new notebook folder ("<title> (offline
 *  edit <date>)") with its own id, so nothing is lost. Fires
 *  `gnos:notebook-conflict` so the UI can toast + refresh the list. */
// eslint-disable-next-line no-unused-vars -- retained but DISABLED by user request (was duplicating notes); see A71
async function _forkExternalConflict(notebooksDir, meta, diskText, diskMtime) {
  try {
    const stamp = new Date(diskMtime || Date.now())
      .toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const baseTitle = (meta.title || 'Untitled')
    let folderName = sanitizeFolderName(`${baseTitle} (offline edit ${stamp})`)
    let dir = await join(notebooksDir, folderName)
    // Guarantee uniqueness if a fork with the same name already exists.
    let n = 2
    while (await exists(dir)) { folderName = sanitizeFolderName(`${baseTitle} (offline edit ${stamp}) ${n++}`); dir = await join(notebooksDir, folderName) }
    await mkdir(dir, { recursive: true })
    const d = _deriveMetaFromMd(diskText, folderName)
    const now = new Date().toISOString()
    const forkMeta = {
      id: `nb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: d.title, wordCount: d.wordCount,
      createdAt: now, updatedAt: new Date(diskMtime || Date.now()).toISOString(),
      contentSyncedAt: 0, // will be stamped when the fork's own file is written below
      forkedFrom: meta.id, forkedFromTitle: baseTitle,
    }
    const mdPath = await join(dir, `${folderName}.md`)
    await writeTextFile(mdPath, diskText)
    try { forkMeta.contentSyncedAt = _mtimeMs(await stat(mdPath)) } catch { /* non-fatal */ }
    await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(forkMeta, null, 2))
    try {
      window.dispatchEvent(new CustomEvent('gnos:notebook-conflict', {
        detail: { originalTitle: baseTitle, forkTitle: forkMeta.title, forkId: forkMeta.id },
      }))
    } catch { /* non-window env */ }
    return forkMeta.id
  } catch (err) { console.warn('[Gnos] conflict fork failed', err); return null }
}

/**
 * @param {object|string} notebookOrId
 * @param {string} content
 * @param {{baseText?: string}} [opts] `baseText` is the note as it stood when the
 *        editor last agreed with disk. Supplying it enables a true three-way
 *        merge when the file changed underneath; without it we can only compare
 *        two versions and must keep ours.
 * @returns {Promise<string|boolean>} the text actually written (may differ from
 *        `content` if a merge occurred), or false on failure.
 */
export async function saveNotebookContent(notebookOrId, content, opts = {}) {
  const id = typeof notebookOrId === 'string' ? notebookOrId : notebookOrId?.id
  const notebook = typeof notebookOrId === 'object' ? notebookOrId : null
  const mdContent = typeof content === 'string' ? content : (content?.content ?? '')
  const baseText = typeof opts.baseText === 'string' ? opts.baseText : null

  // ── External reference — write straight back to the original file path ──
  if (id && id.startsWith('ext_')) {
    try {
      const path = notebook?.path || await _externalPath(id)
      if (!path) return false
      await writeTextFile(path, mdContent)
      // Update the ref's title (from the # heading / first line) + sync stamp.
      const refs = await loadExternalRefs()
      const i = refs.findIndex(r => r.id === id)
      if (i >= 0) {
        const d = _deriveMetaFromMd(mdContent, refs[i].title)
        let syncedAt = 0
        try { syncedAt = _mtimeMs(await stat(path)) } catch { /* non-fatal */ }
        refs[i] = { ...refs[i], title: d.title || refs[i].title, contentSyncedAt: syncedAt }
        await saveExternalRefs(refs)
      }
      return true
    } catch (err) { console.warn('[Gnos] external save failed', err); return false }
  }

  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)

    // ── FLAT note (central index) — write the single .md, update the index ──
    const idx = await loadNotebooksIndex()
    if (idx[id]) {
      const entry = idx[id]
      let fileName = entry.file
      if (entry.folderNote) {
        // Whole-folder note (images/ alongside it) — rename the FOLDER, not
        // just the .md, so it stays in sync with the title.
        if (notebook?.title) fileName = await _renameFolderNoteIfNeeded(entry, notebook.title)
      } else {
        // Rename the flat file if the title changed.
        const desiredBase = sanitizeFolderName(notebook?.title || entry.title || id) || id
        // `file` is archive-relative — rename the basename in place so the note
        // stays inside its collection folder.
        const { dir: curDir, name: curName } = _splitIndexPath(fileName)
        const curBase = curName.replace(/\.md$/i, '')
        if (fileName && desiredBase && desiredBase.toLowerCase() !== curBase.toLowerCase()) {
          const taken = new Set(entries.map(e => e.name?.toLowerCase()).filter(Boolean))
          taken.delete(curName.toLowerCase())
          let nn = `${desiredBase}.md`, k = 2
          while (taken.has(nn.toLowerCase())) nn = `${desiredBase} ${k++}.md`
          try {
            const oldP = await _resolveIndexPath(fileName)
            const newP = await _resolveIndexPath(`${curDir}/${nn}`)
            if ((await exists(oldP)) && !(await exists(newP))) { await rename(oldP, newP); fileName = `${curDir}/${nn}` }
          } catch { /* keep old name */ }
        }
      }
      let mdPath = await _resolveIndexPath(fileName)
      // ── Silent three-way merge ──────────────────────────────────────────
      // If the file changed underneath us, do NOT clobber it and do NOT fork it
      // into a duplicate. Merge at line level: disjoint edits (different
      // paragraphs) combine silently, which is the overwhelming majority. A true
      // overlap keeps ours and the losing side is preserved in history, so
      // silence never means loss. See PLAN_CONCURRENCY.md.
      let toWrite = mdContent
      try {
        if (await exists(mdPath)) {
          const diskText = await readTextFile(mdPath).catch(() => null)
          const changed = diskText != null
            && (entry.contentHash ? contentHash(diskText) !== entry.contentHash
                                  : diskText !== (baseText ?? diskText))
          if (diskText != null && changed && diskText !== mdContent) {
            await historySnapshot(id, diskText, 'remote')
            const base = baseText != null ? baseText : diskText
            const r = mergeSilently(base, mdContent, diskText)
            if (r.needsSnapshot) await historySnapshot(id, mdContent, 'local')
            toWrite = r.text
          }
        }
      } catch (err) { console.debug('[Gnos] merge skipped, writing ours:', err) }

      await writeTextAtomic(mdPath, toWrite)
      let syncedAt = 0
      try { syncedAt = _mtimeMs(await stat(mdPath)) } catch { /* non-fatal */ }
      const patch = { file: fileName, contentSyncedAt: syncedAt, contentHash: contentHash(toWrite) }
      if (notebook?.title) patch.title = notebook.title
      await _patchNbIndex(id, patch)
      historyPrune(id)
      return toWrite
    }

    // Try to find existing folder by id (attachment/legacy folder notes)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const mdPath = await join(notebooksDir, entry.name, `${entry.name}.md`)
          let folderWrite = mdContent      // replaced by the merged text if disk changed
          // ── Conflict-safe save ──────────────────────────────────────────
          // If the .md changed on disk since we last synced (external/offline
          // edit while this note was open) AND that disk text differs from what
          // we're about to write, NEVER overwrite blindly — merge the two at
          // line level (see the flat path above). Forking into a duplicate note
          // is gone; history preserves whatever a conflict discards.
          try {
            if (await exists(mdPath)) {
              const st = await stat(mdPath)
              const diskMtime = _mtimeMs(st)
              const synced = meta.contentSyncedAt || 0
              // Only fork against a KNOWN baseline. With no stamp we cannot tell
              // an external edit from our own last write, and guessing "external"
              // spawned a runaway chain of "(offline edit …)" copies when a stamp
              // went missing. No stamp → treat as ours, save, and re-stamp below.
              const changed = meta.contentHash
                ? contentHash(await readTextFile(mdPath).catch(() => '')) !== meta.contentHash
                : (synced && diskMtime > synced + 1000)
              if (changed) {
                const diskText = await readTextFile(mdPath).catch(() => null)
                if (diskText != null && diskText !== mdContent) {
                  // Same silent merge as the flat path — never clobber, never fork.
                  await historySnapshot(id, diskText, 'remote')
                  const base = baseText != null ? baseText : diskText
                  const r = mergeSilently(base, mdContent, diskText)
                  if (r.needsSnapshot) await historySnapshot(id, mdContent, 'local')
                  folderWrite = r.text
                }
              }
            }
          } catch { /* detection failed — fall through to a normal save */ }

          await writeTextAtomic(mdPath, folderWrite)
          // Stamp our own write so syncNotebooksFromDisk doesn't mistake it for
          // an external edit on the next scan.
          try {
            const st = await stat(mdPath)
            await writeTextFile(metaPath, JSON.stringify({
              ...meta, contentSyncedAt: _mtimeMs(st), contentHash: contentHash(folderWrite),
            }, null, 2))
          } catch { /* non-fatal — worst case one redundant refresh */ }
          historyPrune(id)
          return folderWrite
        }
      }
    }
    // New note — create it FLAT: notebooks/<Title>.md + an index entry.
    const takenLower = new Set(entries.map(e => e.name?.toLowerCase()).filter(Boolean))
    const fileName = _flatFileName(notebook?.title || id, id, takenLower)
    const mdPath = await join(notebooksDir, fileName)
    await writeTextFile(mdPath, mdContent)
    let syncedAt = 0
    try { syncedAt = _mtimeMs(await stat(mdPath)) } catch { /* non-fatal */ }
    const base = notebook ?? { id, title: (notebook?.title || id) }
    await _patchNbIndex(id, { ...base, id, file: fileName, contentSyncedAt: syncedAt })
    return true
  } catch (err) { console.debug('[Gnos] saveNotebookContent flat/folder write failed', err) }
  return setJSON(`notebook_${id}`, content)
}

/** Save an image (Uint8Array) into the notebook's images/ subfolder.
 *  Returns the relative markdown path: `./images/filename` */
export async function saveNotebookImage(notebookId, filename, data) {
  try {
    const notebooksDir = await getNotebooksDir()
    // Flat note gaining its first attachment → PROMOTE it to a folder so the
    // image travels with it, then drop the flat index entry.
    const idx = await loadNotebooksIndex()
    if (idx[notebookId]?.file) {
      const entry = idx[notebookId]
      const flatPath = await _resolveIndexPath(entry.file)
      const body = await readTextFile(flatPath).catch(() => '')
      const folderBase = sanitizeFolderName(entry.title || notebookId) || notebookId
      // Unique folder name
      const existing = new Set((await readDir(notebooksDir).catch(() => [])).map(e => e.name?.toLowerCase()).filter(Boolean))
      existing.delete(entry.file.toLowerCase())
      let fName = folderBase, n = 2
      while (existing.has(fName.toLowerCase())) fName = `${folderBase} ${n++}`
      const dir = await join(notebooksDir, fName)
      await mkdir(dir, { recursive: true })
      const mdPath = await join(dir, `${fName}.md`)
      await writeTextFile(mdPath, body)
      let syncedAt = 0
      try { syncedAt = _mtimeMs(await stat(mdPath)) } catch { /* non-fatal */ }
      const { file, ...metaRest } = entry
      await writeTextFile(await join(dir, 'meta.json'), JSON.stringify({ ...metaRest, contentSyncedAt: syncedAt }, null, 2))
      const imagesDir = await join(dir, 'images')
      await mkdir(imagesDir, { recursive: true })
      await writeFile(await join(imagesDir, filename), data)
      // Remove the old flat file + index entry (folder is now authoritative).
      try { await remove(flatPath) } catch { /* non-fatal */ }
      await _removeNbIndex(notebookId)
      return `./images/${filename}`
    }
    const entries = await readDir(notebooksDir)
    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith('.')) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === notebookId) {
          const imagesDir = await join(notebooksDir, entry.name, 'images')
          if (!(await exists(imagesDir))) await mkdir(imagesDir, { recursive: true })
          const imgPath = await join(imagesDir, filename)
          await writeFile(imgPath, data)
          return `./images/${filename}`
        }
      }
    }
  } catch (err) { console.warn('[Gnos] saveNotebookImage failed:', err) }
  return null
}

export async function deleteNotebookContent(id) {
  try {
    const notebooksDir = await getNotebooksDir()
    // Flat note — delete the single .md + index entry.
    const idx = await loadNotebooksIndex()
    if (idx[id]?.file) {
      try { await remove(await _resolveIndexPath(idx[id].file)) } catch { /* already gone */ }
      await _removeNbIndex(id)
      return true
    }
    const entries = await readDir(notebooksDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const entryPath = await join(notebooksDir, entry.name)
          const folderEntries = await readDir(entryPath)
          for (const f of folderEntries) {
            if (f.name) await remove(await join(entryPath, f.name))
          }
          try { await remove(entryPath) } catch { /* not empty */ }
          break
        }
      }
    }
  } catch (err) { console.debug('[Gnos] deleteNotebookContent error', err) }
  return storage.delete(`notebook_${id}`)
}

// Legacy migration: create named folders for notebooks that only exist as flat
// JSON (`notebook_<id>.json`). OBSOLETE since the flat-file model (A51) — those
// legacy JSONs are removed by cleanupLegacyNotebookFiles, and flat notes must
// NOT be folded back into folders (that un-flattens them every launch). So we
// skip anything already represented in the flat index or as an on-disk flat
// `<Title>.md`, and only fold a note that genuinely has neither.
export async function migrateNotebooksToFolders(notebooks) {
  if (!notebooks?.length) return
  const idx = await loadNotebooksIndex()
  const notebooksDir = await getNotebooksDir()
  for (const nb of notebooks) {
    try {
      if (idx[nb.id]) continue // already a flat note — never re-fold it
      // Also skip if a flat <Title>.md already holds this note on disk.
      const flatGuess = await join(notebooksDir, `${sanitizeFolderName(nb.title || nb.id)}.md`)
      if (await exists(flatGuess)) continue
      // Only fold notes that still have legacy flat-JSON content and no folder yet.
      const hasFolder = await _findFolderById(notebooksDir, nb.id)
      const legacy = await getJSON(`notebook_${nb.id}`, null)
      if (hasFolder || legacy == null) continue
      const dir = await getNotebookDir(nb)
      const folderName = sanitizeFolderName(nb.title || nb.id)
      const mdPath = await join(dir, `${folderName}.md`)
      // Write meta.json
      await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(nb, null, 2))
      // Only write .md if it doesn't already exist
      if (!(await exists(mdPath))) {
        const raw = await getJSON(`notebook_${nb.id}`, '')
        const mdContent = typeof raw === 'string' ? raw : (raw?.content ?? '')
        await writeTextFile(mdPath, mdContent)
      }
    } catch (err) {
      console.warn('[Gnos] migrateNotebooksToFolders failed for', nb.id, err)
    }
  }
}

// ── Books (named-folder format) ───────────────────────────────────────────────
//
// New format:
//   archive/books/Alexandre Dumas - The Count of Monte Cristo/
//     meta.json       — book metadata (title, author, format, progress, …)
//     content.json    — array of chapters
//
// Legacy flat-file format (read for migration, then cleaned up):
//   archive/books/book_<id>_data.json
//   archive/books/book_<id>_chunk_<n>.json
//   archive/books/book_<id>_chunks.json

function sanitizeFolderName(name) {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

// ══════════════════════════════════════════════════════════════════════════
// FLAT BOOKS — a book is ONE flat file in `books/`, no per-item folder:
//   • `format: 'pdf'`             → `<Author - Title>.pdf` (the real source —
//     PdfView renders it live with pdf.js; there is no separate "content" to
//     store, so unlike epub/txt/md no content.json is ever written for these)
//   • everything else (epub/txt/md) → `<Author - Title>.content.json`, which
//     is NOT a cache — it's the only surviving copy of the book's text. The
//     original .epub/.txt/.md file is discarded at import time; only the
//     parsed `chapters` structure survives. (Earlier design notes called this
//     "derived" and proposed moving it to appDataDir — WRONG for anything but
//     pdf; fixed before implementing.)
// Cover lives in the shared `covers/<id>.<ext>` dir (see the audio section).
// No id→name index needed — same reasoning as audio: the file name is a pure
// fn of title+author, and title isn't user-editable for books either
// (`EditItemModal`'s book fields are author/rating/tags/description).
// ══════════════════════════════════════════════════════════════════════════

function bookFolderName(book) {
  const author = book.author?.trim() || ''
  const title  = book.title?.trim()  || book.id
  const name   = author ? `${author} - ${title}` : title
  return sanitizeFolderName(name)
}

/** Flat filename for a book — `.pdf` for pdf-format, `.content.json` otherwise. */
function _bookFlatName(book, ext) {
  return `${sanitizeFolderName(bookFolderName(book))}.${ext}`
}

async function getBooksDir() {
  const base = await getBaseDir()
  const booksDir = await join(base, 'books')
  if (!(await exists(booksDir))) await mkdir(booksDir, { recursive: true })
  return booksDir
}

/**
 * A96 — a book with no `collection` field lives in books/, same as always.
 * One with a `collection` (a plain string field on the library.json object —
 * books/audio have no index, unlike notebooks/sketchbooks, so this is the
 * only place their collection membership can live) lives in that collection
 * folder flat instead — no per-type subfolder inside it, matching the
 * confirmed collections design.
 */
async function getBookBaseDir(book) {
  if (book?.collection) {
    const dir = await getCollectionDir(book.collection)
    if (dir) {
      if (!(await exists(dir))) await mkdir(dir, { recursive: true })
      return dir
    }
  }
  return await getBooksDir()
}

/**
 * A96 — move a book into a collection folder (or back to books/ when
 * `collectionName` is null). `book` must be the CURRENT full book object
 * (its existing `.collection` value decides where the file is now). Unlike
 * notebooks/sketchbooks there's no index entry to update — the caller is
 * responsible for setting `book.collection` on the in-memory object and
 * persisting the library afterward; this only moves the file(s) on disk.
 * Returns false without touching anything if the source file can't be found.
 */
export async function moveBookToCollection(book, collectionName) {
  try {
    // format:'pdf' → .pdf, format:'epub' → .epub (A86), everything else
    // (epub/txt/md imported before A86) → the old content.json-only shape.
    const ext = book.format === 'pdf' || book.format === 'epub' ? book.format : 'content.json'
    const fromDir = await getBookBaseDir(book)
    const fileName = _bookFlatName(book, ext)
    const from = await join(fromDir, fileName)
    if (!(await exists(from))) return false
    const toDir = collectionName ? await getCollectionDir(collectionName) : await getBooksDir()
    if (collectionName && !toDir) return false
    if (!(await exists(toDir))) await mkdir(toDir, { recursive: true })
    const dot = fileName.length - ext.length - 1 // insert " 2" right before the extension
    let finalName = fileName, to = await join(toDir, finalName), n = 2
    while (await exists(to)) {
      if (to === from) return true
      finalName = `${fileName.slice(0, dot)} ${n++}${fileName.slice(dot)}`
      to = await join(toDir, finalName)
    }
    await rename(from, to)
    return true
  } catch (err) { console.warn('[Gnos] moveBookToCollection failed', err); return false }
}

// ── Epub content cache (root-keyed, disposable — see A86) ────────────────────
// The real `.epub` file is kept flat in books/ (portable, deletable by the
// user on purpose — see moveToTrash('book',…) and loadLibrary's sourceMissing
// flag below). `content.json` per book is GONE for anything imported under
// this flow; the parsed chapters live only in this cache and are regenerated
// by re-parsing the .epub on a cache miss/stale-mtime. Unlike PDF's
// placeholder chapters, epub chapters are real work to reparse (unzip + HTML
// walk), so caching is a real perf win, not just tidiness.
const EPUB_CACHE_KEY = 'epub_content_cache'

// Local (per-machine, see getLocalJSON below) — not synced with the archive.
// Purely regenerable from the kept .epub file, and would otherwise burn
// iCloud sync on data that's cheap to just re-derive on whichever device
// needs it.
export async function loadEpubCache() {
  try {
    const m = await getLocalJSON(EPUB_CACHE_KEY, {})
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
  } catch { return {} }
}
async function _saveEpubCache(map) {
  try { const ok = await setLocalJSON(EPUB_CACHE_KEY, map); return ok !== false }
  catch (err) { console.warn('[Gnos] saveEpubCache failed', err); return false }
}
async function _patchEpubCache(id, patch) {
  const all = await loadEpubCache()
  all[id] = { ...(all[id] || {}), ...patch }
  return _saveEpubCache(all)
}
async function _removeEpubCache(id) {
  const all = await loadEpubCache()
  if (all[id]) { delete all[id]; await _saveEpubCache(all) }
}

// Save book content flat. `book` must be the full book object (needed to
// name the file — see the file-header comment above). `epubBytes` — pass the
// raw file bytes for a fresh epub import to keep the real source file; omit
// for the old content.json-only shape (kept for back-compat, unused by any
// current caller).
export async function saveBookContent(book, chapters, epubBytes) {
  // Legacy signature: saveBookContent(id, chapters)
  if (typeof book === 'string') {
    return _saveLegacyBookContent(book, chapters)
  }

  const booksDir = await getBookBaseDir(book)

  if (book.format === 'pdf') {
    // Write the source PDF as a real flat file. Without this the bytes
    // existed ONLY as base64 on the book object — saveLibrary strips it, so
    // it must land on disk here or it's unrecoverable. `chapters` for a pdf
    // is just a one-paragraph placeholder (PdfView renders the real file
    // live) — nothing worth persisting there.
    const pdfSrc = book.pdfDataUrl || book.rawDataUrl
    if (pdfSrc) {
      try {
        const bytes = dataUrlToBytes(pdfSrc)
        if (bytes) await writeFile(await join(booksDir, _bookFlatName(book, 'pdf')), bytes)
      } catch { /* non-fatal — viewer falls back to the in-memory copy this session */ }
    }
  } else if (book.format === 'epub' && epubBytes) {
    const epubPath = await join(booksDir, _bookFlatName(book, 'epub'))
    await writeFile(epubPath, epubBytes)
    let sourceMtime = 0
    try { sourceMtime = _mtimeMs(await stat(epubPath)) } catch { /* non-fatal */ }
    await _patchEpubCache(book.id, { chapters, sourceMtime })
  } else {
    // No kept bytes — old content.json-only shape. Still the only copy for
    // anything imported before this feature; keep it working unchanged.
    await writeTextFile(await join(booksDir, _bookFlatName(book, 'content.json')), JSON.stringify(chapters))
  }

  if (book.coverDataUrl) await writeSharedCover(book.id, book.coverDataUrl)
}

const CHUNK_SIZE = 20
const MAX_SINGLE_CHARS = 900_000

async function _saveLegacyBookContent(id, chapters) {
  const json = JSON.stringify(chapters)
  if (json.length < MAX_SINGLE_CHARS) {
    await storage.set(`book_${id}_data`, json)
    await storage.set(`book_${id}_chunks`, '0')
    return
  }
  const chunks = []
  for (let i = 0; i < chapters.length; i += CHUNK_SIZE) chunks.push(chapters.slice(i, i + CHUNK_SIZE))
  await Promise.all(chunks.map((c, ci) => storage.set(`book_${id}_chunk_${ci}`, JSON.stringify(c))))
  await storage.set(`book_${id}_chunks`, String(chunks.length))
}

// ── Seed book content (no file I/O needed for testing) ───────────────────────
const SEED_BOOK_CONTENT = {
  seed_book_1: [
    {
      title: 'Book One — Dune',
      blocks: [
        { type: 'heading', text: 'I' },
        { type: 'paragraph', text: 'In the week before their departure to Arrakis, when all the final preparations were being made, Paul Atreides stood at the edge of the landing field and watched the giant cargo lifters settling like tired birds onto their pads. The air smelled of burned fuel and distant rain, a combination that would not exist on Arrakis, where rain was a memory belonging to other worlds.' },
        { type: 'paragraph', text: 'His mother had not slept. He could tell by the way she held her shoulders — that careful, deliberate stillness that Bene Gesserit training produced when its practitioner was working very hard to appear calm. Lady Jessica stood a few paces to his left, watching the same slow parade of machines and men, but seeing something else entirely.' },
        { type: 'paragraph', text: '"You should eat something," she said without looking at him.' },
        { type: 'paragraph', text: '"I know." He did not move.' },
        { type: 'paragraph', text: 'The Duke had been up since before dawn. Paul had heard him in the corridor at some hour when the castle was at its quietest, his footsteps unhurried and even, a man who had learned long ago that worry was simply planning without a destination.' },
        { type: 'paragraph', text: 'Gurney Halleck appeared at Paul\'s right elbow. He smelled of metal polish and had the look of a man who had already eaten twice and was considering a third time.' },
        { type: 'paragraph', text: '"Finished your weapons review?" Paul asked.' },
        { type: 'paragraph', text: '"Done before first light. The men are ready." Gurney watched a loader drag a sealed crate across the tarmac. "Whether the men are ready and whether we are ready are, of course, different questions."' },
        { type: 'paragraph', text: 'Paul looked at him.' },
        { type: 'paragraph', text: '"I mean only that readiness of body and readiness of mind don\'t always keep the same schedule," Gurney said, his voice carrying the faint cadence of a man who had once set that observation to music. "Your father understands this. It\'s why he\'s walking the perimeter now instead of standing here watching crates."' },
        { type: 'paragraph', text: 'Jessica turned her head slightly. Just enough.' },
        { type: 'paragraph', text: '"I\'ll go find him," Paul said.' },
      ],
    },
    {
      title: 'II',
      blocks: [
        { type: 'heading', text: 'II' },
        { type: 'paragraph', text: 'The Duke was standing at the far edge of the field where the perimeter lights ended and the dark began. He was not walking. He was simply standing, hands clasped behind his back, looking out at nothing that could be seen.' },
        { type: 'paragraph', text: 'Paul came up beside him and waited. This was something he had learned early: that his father\'s silences were not absences. They were a form of speech, and interrupting them was like interrupting a sentence.' },
        { type: 'paragraph', text: 'After a while the Duke said: "Do you know what I think about, standing here?"' },
        { type: 'paragraph', text: '"No," Paul said honestly.' },
        { type: 'paragraph', text: '"The things I haven\'t thought of yet. The variables I haven\'t named. Every plan has a gap in it — a place where you simply have to trust the people around you and move forward." He turned to look at Paul. In the half-dark his face was hard to read, which was rare. "Arrakis will have many such gaps."' },
        { type: 'paragraph', text: '"The Harkonnens left traps."' },
        { type: 'paragraph', text: '"Traps we know about. And traps we don\'t. The ones we don\'t know about are the interesting ones." He paused. "Interesting is not the word I mean. I mean dangerous. But the interesting ones are always the dangerous ones, in my experience."' },
        { type: 'paragraph', text: 'Paul thought about the dreams he had been having — fragmented things, full of sand and heat and a face he could not quite see. He had not told his mother about the most recent ones. He was not sure why.' },
        { type: 'paragraph', text: '"I\'m not afraid," Paul said.' },
        { type: 'paragraph', text: 'His father was quiet for a moment. "I know. That\'s the part that worries me a little." He put his hand briefly on Paul\'s shoulder — the rare, solid weight of it. "Fear is useful. It asks questions. Courage that has no fear behind it is just noise."' },
        { type: 'paragraph', text: 'The loading lights swept across the field in their slow rotation. Somewhere on the far side of the tarmac, Gurney had started humming something — one of the old ballads, something about water and waiting.' },
        { type: 'paragraph', text: '"Tomorrow, then," Paul said.' },
        { type: 'paragraph', text: '"Tomorrow," his father agreed. And they stood together in the dark until the lights came around again.' },
      ],
    },
  ],
}

// Load book content. `bookOrId` should be the full book object when possible
// (needed to resolve the flat filename — an id alone can only fall back to
// scanning legacy locations). PDFs have no content — PdfView renders the
// source file directly.
export async function loadBookContent(bookOrId) {
  const book = (bookOrId && typeof bookOrId === 'object') ? bookOrId : null
  const id = book?.id ?? bookOrId

  // Return hardcoded content for seed books (no file I/O needed)
  if (id && SEED_BOOK_CONTENT[id]) return SEED_BOOK_CONTENT[id]
  if (book?.format === 'pdf') return null

  // 0. Epub with a kept source file (current format) — cache hit is the fast
  // path; a miss or a newer .epub (user swapped the file) re-parses live.
  // A MISSING .epub is deliberate, not a fallback-to-cache case — per A86,
  // the .epub is the source of truth now, so its absence means the book is
  // gone even if stale cached text still exists (loadLibrary flags this book
  // `sourceMissing` for the UI). Only a book with NO cache entry at all
  // (never imported under this flow) falls through to the legacy paths below.
  if (book?.format === 'epub') {
    try {
      const booksDir = await getBookBaseDir(book)
      const epubPath = await join(booksDir, _bookFlatName(book, 'epub'))
      const cache = await loadEpubCache()
      const cached = cache[id]
      if (await exists(epubPath)) {
        const st = await stat(epubPath).catch(() => null)
        const mtime = _mtimeMs(st)
        if (cached?.chapters && cached.sourceMtime && mtime <= cached.sourceMtime + 1000) {
          return cached.chapters
        }
        const bytes = await readFile(epubPath)
        const pseudoFile = { name: epubPath.split(/[/\\]/).pop(), arrayBuffer: async () => bytes.buffer }
        const parsed = await parseEpub(pseudoFile)
        await _patchEpubCache(id, { chapters: parsed.chapters, sourceMtime: mtime })
        return parsed.chapters
      }
      if (cached) return null // source gone — don't silently resurrect from cache
    } catch (err) { console.warn('[Gnos] loadBookContent epub flow failed', err) }
  }

  // 1. Flat file (old content.json-only format) — only resolvable with the full object.
  try {
    if (book) {
      const flatPath = await join(await getBookBaseDir(book), _bookFlatName(book, 'content.json'))
      if (await exists(flatPath)) return JSON.parse(await readTextFile(flatPath))
    }
  } catch (err) { console.warn('[Gnos] loadBookContent flat read failed', err) }

  // 2. Legacy named folder — look up by id in meta.json
  try {
    const booksDir = await getBooksDir()
    const entries = await readDir(booksDir)
    for (const entry of entries) {
      if (!entry.name) continue
      try {
        const entryPath = await join(booksDir, entry.name)
        const metaPath = await join(entryPath, 'meta.json')
        if (await exists(metaPath)) {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.id === id) {
            const contentPath = await join(entryPath, 'content.json')
            if (await exists(contentPath)) {
              return JSON.parse(await readTextFile(contentPath))
            }
            // meta matched but no content.json — fall through to legacy
            break
          }
        }
      } catch (entryErr) { console.debug('[Gnos] skipping folder entry', entry.name, entryErr) }
    }
  } catch (err) { console.warn('[Gnos] named folder scan failed, trying legacy', err) }

  // 3. Oldest legacy — chunked keyed store
  const meta = await storage.get(`book_${id}_chunks`)
  const n = parseInt(meta?.value ?? '-1')
  if (n === 0) {
    const raw = await storage.get(`book_${id}_data`)
    return raw ? JSON.parse(raw.value) : null
  }
  if (n > 0) {
    const results = await Promise.all(
      Array.from({ length: n }, (_, ci) => storage.get(`book_${id}_chunk_${ci}`))
    )
    const chapters = []
    for (const r of results) if (r) chapters.push(...JSON.parse(r.value))
    return chapters
  }
  // Oldest legacy: single key
  const legacy = await storage.get(`book_${id}`)
  if (legacy) {
    const raw = legacy.value ?? legacy
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  }
  return null
}

// Delete book content — removes the flat file(s), any legacy named folder,
// and any legacy chunked keyed-store files. `book` should be the full object
// when available (needed for the flat path); id-only still cleans up the
// legacy shapes.
export async function deleteBookContent(book) {
  const id = typeof book === 'string' ? book : book?.id
  const bookObj = typeof book === 'object' ? book : null

  if (bookObj) {
    try {
      const booksDir = await getBooksDir()
      for (const ext of ['pdf', 'content.json']) {
        const p = await join(booksDir, _bookFlatName(bookObj, ext))
        if (await exists(p)) await remove(p)
      }
    } catch (err) { console.debug('[Gnos] deleteBookContent flat remove failed', err) }
  }

  // Remove legacy named folder
  try {
    const booksDir = await getBooksDir()
    const entries = await readDir(booksDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const entryPath = await join(booksDir, entry.name)
      const metaPath = await join(entryPath, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const contentPath = await join(entryPath, 'content.json')
          if (await exists(contentPath)) await remove(contentPath)
          await remove(metaPath)
          try { await remove(entryPath) } catch (err) { console.debug('[Gnos] folder not empty yet', err) }
          break
        }
      }
    }
  } catch (err) { console.debug('[Gnos] deleteBookContent named folder error', err) }

  // Remove legacy flat files
  await storage.delete(`book_${id}_data`)
  await storage.delete(`book_${id}_chunks`)
  for (let ci = 0; ci < 200; ci++) {
    const key = `book_${id}_chunk_${ci}`
    const filePath = await keyToPath(key)
    if (!(await exists(filePath))) break
    await remove(filePath)
  }
}

/**
 * Flatten books: moves each book to its single flat file — `<Name>.pdf` for
 * pdf-format (source rescued from a legacy folder or, failing that, base64
 * still in library.json), `<Name>.content.json` for everything else (rescued
 * from a legacy folder OR the oldest chunked-keyed-store shape — same lesson
 * as A75's audio fix: check for the oldest shape unconditionally, don't
 * assume "no folder" means "nothing to migrate"). Cover moves to the shared
 * `covers/<id>.<ext>`. Old folder only goes to the OS Trash once the flat
 * target is confirmed on disk — never trade a folder for nothing.
 * Runs once, guarded by `books_flat_migrated`.
 */
export async function migrateBooksToFlat(library) {
  if (!library?.length) return { migrated: 0 }
  try {
    if (await _migrationDone('books_flat_migrated')) return { migrated: 0, skipped: true }
    const booksDir = await getBooksDir()
    let migrated = 0
    for (const book of library) {
      // Audiobooks don't use book content storage.
      if (book.type === 'audio' || book.format === 'mp3' || book.format === 'm4b' || book.format === 'audiofolder') continue
      try {
        let changed = false
        const folderName = sanitizeFolderName(bookFolderName(book))
        const folder = await join(booksDir, folderName)
        const hasFolder = await exists(folder)

        if (hasFolder) {
          for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
            const src = await join(folder, `cover.${ext}`)
            if (await exists(src)) {
              const dest = await join(await getCoversDir(), `${book.id}.${ext}`)
              if (!(await exists(dest))) await rename(src, dest)
              break
            }
          }
        }

        if (book.format === 'pdf') {
          const flatPdf = await join(booksDir, `${folderName}.pdf`)
          if (!(await exists(flatPdf))) {
            if (hasFolder) {
              const src = await join(folder, PDF_SOURCE_NAME)
              if (await exists(src)) { await rename(src, flatPdf); changed = true }
            }
            if (!(await exists(flatPdf))) {
              const legacy = book.pdfDataUrl || book.rawDataUrl
              if (legacy?.startsWith('data:')) {
                const bytes = dataUrlToBytes(legacy)
                if (bytes) { await writeFile(flatPdf, bytes); changed = true }
              }
            }
          }
          // Only trash the old folder once we've confirmed the PDF survived
          // the move — never destroy the only copy on a failed rescue.
          if (hasFolder && (await exists(flatPdf))) {
            try { await invoke('move_to_trash', { paths: [folder] }) }
            catch (err) { console.warn('[Gnos] book flatten: folder → OS trash failed, leaving it in place', err) }
          }
        } else {
          const flatJson = await join(booksDir, `${folderName}.content.json`)
          if (!(await exists(flatJson))) {
            let chapters = null
            if (hasFolder) {
              const src = await join(folder, 'content.json')
              if (await exists(src)) {
                try { chapters = JSON.parse(await readTextFile(src)) } catch { /* corrupt — try legacy below */ }
              }
            }
            if (!chapters) {
              // Oldest legacy — chunked keyed store, independent of any folder.
              const chunkMeta = await storage.get(`book_${book.id}_chunks`)
              const n = parseInt(chunkMeta?.value ?? '-1')
              if (n === 0) {
                const raw = await storage.get(`book_${book.id}_data`)
                if (raw) { try { chapters = JSON.parse(raw.value) } catch { /* corrupt */ } }
              } else if (n > 0) {
                const results = await Promise.all(Array.from({ length: n }, (_, ci) => storage.get(`book_${book.id}_chunk_${ci}`)))
                const acc = []
                for (const r of results) if (r) { try { acc.push(...JSON.parse(r.value)) } catch { /* skip bad chunk */ } }
                if (acc.length) chapters = acc
              } else {
                const legacy = await storage.get(`book_${book.id}`)
                if (legacy) {
                  const raw = legacy.value ?? legacy
                  try { chapters = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { /* corrupt */ }
                }
              }
            }
            if (chapters) { await writeTextFile(flatJson, JSON.stringify(chapters)); changed = true }
          }
          // Clean up the oldest-legacy keys regardless — converted above, or
          // already-flat (in which case these are stale leftovers).
          await storage.delete(`book_${book.id}_data`)
          await storage.delete(`book_${book.id}_chunks`)
          for (let ci = 0; ci < 200; ci++) {
            const key = `book_${book.id}_chunk_${ci}`
            const filePath = await keyToPath(key)
            if (!(await exists(filePath))) break
            await remove(filePath)
            changed = true
          }
          if (hasFolder && (await exists(flatJson))) {
            try { await invoke('move_to_trash', { paths: [folder] }) }
            catch (err) { console.warn('[Gnos] book flatten: folder → OS trash failed, leaving it in place', err) }
          }
        }
        if (changed) migrated++
      } catch (err) { console.warn('[Gnos] migrateBooksToFlat failed for', book.id, err) }
    }
    await _markMigrationDone('books_flat_migrated')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateBooksToFlat failed', err); return { migrated: 0 } }
}

// ── Archive pointer ────────────────────────────────────────────────────────────
// We write the archive path to appDataDir/gnos/archive_path.json on every
// preference save. On cold start, init() reads this file first so it knows
// where to find the full preferences before archivePath is in the store.

async function getDefaultDir() {
  const base = await appDataDir()
  const dir  = await join(base, 'gnos')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

export async function saveArchivePointer(archivePath) {
  try {
    const dir  = await getDefaultDir()
    const file = await join(dir, 'archive_path.json')
    await writeTextFile(file, JSON.stringify({ archivePath }))
  } catch (err) {
    console.warn('[Gnos] saveArchivePointer failed:', err)
  }
}

export async function loadArchivePointer() {
  try {
    const base = await appDataDir()
    const file = await join(base, 'gnos', 'archive_path.json')
    if (!(await exists(file))) return ''
    const raw = JSON.parse(await readTextFile(file))
    return raw.archivePath || ''
  } catch {
    return ''
  }
}

// ── Local (per-machine) cache — deliberately NOT in the archive ──────────────
// The archive (`_internal/` since A87) is meant to sync across devices via
// iCloud — that's the whole point of pointing it there. A few keys are pure
// regenerable performance caches with no business making that trip: reader
// page-index (`reader_pageindex_book_*`, rebuilds from the book itself),
// `reader_perf_report` (a debug snapshot), and the epub content cache
// (`epub_content_cache`, A86 — re-derivable from the kept `.epub` file).
// Syncing these would burn iCloud bandwidth/storage on data that's cheaper to
// just rebuild locally, and — for the page-index specifically — arguably
// shouldn't sync at all, since pagination can be machine/font-render
// dependent. Lives next to the existing archive-pointer file in appDataDir.
async function getLocalCacheDir() {
  const base = await appDataDir()
  const dir = await join(base, 'gnos', 'cache')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

export async function getLocalJSON(key, fallback = null) {
  try {
    const dir = await getLocalCacheDir()
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    const p = await join(dir, `${safe}.json`)
    if (!(await exists(p))) return fallback
    return JSON.parse(await readTextFile(p))
  } catch { return fallback }
}

export async function setLocalJSON(key, value) {
  try {
    const dir = await getLocalCacheDir()
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
    await writeTextFile(await join(dir, `${safe}.json`), JSON.stringify(value))
    return true
  } catch (err) { console.warn('[Gnos] setLocalJSON failed', err); return false }
}

/**
 * One-time migration of the three cache key families out of the archive
 * (root, pre-A87, or `_internal/`, post-A87 — checks both) into the local
 * cache dir above. Copies the value across before removing the archive copy,
 * so nothing is lost, just relocated. Guarded locally (per-machine, which is
 * correct here — a second device with its own leftover archive-side cache
 * files gets to migrate them too, independently).
 */
export async function migrateCachesToLocal() {
  try {
    if (await getLocalJSON('caches_migrated_to_local', false)) return { migrated: 0, skipped: true }
    const base = await getBaseDir()
    let migrated = 0
    for (const dir of [base, await join(base, '_internal')]) {
      let entries
      try { entries = await readDir(dir) } catch { continue }
      for (const e of entries) {
        if (!e.name || e.children || !e.name.toLowerCase().endsWith('.json')) continue
        const key = e.name.replace(/\.json$/i, '')
        if (key !== 'reader_perf_report' && key !== 'epub_content_cache' && !key.startsWith('reader_pageindex_')) continue
        try {
          const p = await join(dir, e.name)
          const value = JSON.parse(await readTextFile(p))
          await setLocalJSON(key, value)
          await remove(p)
          migrated++
        } catch (err) { console.warn('[Gnos] migrateCachesToLocal failed for', e.name, err) }
      }
    }
    await setLocalJSON('caches_migrated_to_local', true)
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateCachesToLocal failed', err); return { migrated: 0 } }
}

// ── Quick notes ───────────────────────────────────────────────────────────────
// Notes captured via the quick note popup. Two save targets:
//  • default — a regular notebook folder in the archive, so the note shows up
//    in the main app's notebook list on next load
//  • custom  — plain .md files in a user-chosen folder (prefs.quickNoteDir)

/** Find an existing notebook folder by meta.json id. Returns folder name or null. */
async function findNotebookFolderById(notebooksDir, id) {
  const entries = await readDir(notebooksDir).catch(() => [])
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.')) continue
    const metaPath = await join(notebooksDir, entry.name, 'meta.json')
    if (await exists(metaPath)) {
      try {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) return entry.name
      } catch { /* skip corrupt meta */ }
    }
  }
  return null
}

/** Delete one specific notebook folder by folder name (not by id). Used to prune
 *  redundant duplicate quick-note folders that share an id with a surviving folder,
 *  where the id-based deleteNotebookContent would hit the wrong (or a random) one. */
async function removeNotebookFolder(notebooksDir, folderName) {
  try {
    const dir = await join(notebooksDir, folderName)
    const folderEntries = await readDir(dir).catch(() => [])
    for (const f of folderEntries) {
      if (f.name) await remove(await join(dir, f.name)).catch(() => {})
    }
    await remove(dir).catch(() => {})
  } catch { /* non-fatal */ }
}

/** Load quick-note notebooks for the QuickNoteView stack, self-healing on the way.
 *
 *  Real-world corruption mode: iCloud sync latency once made findNotebookFolderById
 *  miss an existing folder, so the *same* quick note (same id) got re-saved into
 *  several title-named folders — some of which now have empty .md files. Reading such
 *  a folder first (loadNotebookContent returns the first id match) surfaced blank
 *  cards on every launch.
 *
 *  Here we group folders by id, keep the one with the most actual on-disk content,
 *  delete the redundant duplicates (and any id whose every copy is empty), record the
 *  survivor in the id→folder map, and return one entry per id with content preloaded.
 *  Returns [{ id, createdAt, title, content, folder }], newest first. */
export async function loadQuickNoteNotebooks() {
  const notebooksDir = await getNotebooksDir()
  const entries = await readDir(notebooksDir).catch(() => [])
  // Gather every quickNote folder with its real body text.
  const folders = []
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.')) continue
    try {
      const dir = await join(notebooksDir, entry.name)
      const metaPath = await join(dir, 'meta.json')
      if (!(await exists(metaPath))) continue
      const meta = JSON.parse(await readTextFile(metaPath))
      if (!meta.quickNote || !meta.id) continue
      let content = ''
      const namedMd = await join(dir, `${entry.name}.md`)
      if (await exists(namedMd)) content = await readTextFile(namedMd)
      else {
        const fe = await readDir(dir).catch(() => [])
        const md = fe.find(e => e.name?.endsWith('.md'))
        if (md) content = await readTextFile(await join(dir, md.name))
      }
      folders.push({ id: meta.id, folder: entry.name, content, meta })
    } catch { /* skip corrupt folder */ }
  }
  // Group by id.
  const byId = new Map()
  for (const f of folders) {
    if (!byId.has(f.id)) byId.set(f.id, [])
    byId.get(f.id).push(f)
  }
  const map = await getJSON('quicknote_folder_map', {})
  const out = []
  for (const [id, group] of byId) {
    // Richest folder wins; ties keep the most recently updated.
    group.sort((a, b) =>
      b.content.trim().length - a.content.trim().length ||
      new Date(b.meta.updatedAt || 0) - new Date(a.meta.updatedAt || 0))
    const winner = group[0]
    const losers = group.slice(1)
    if (!winner.content.trim()) {
      // Every copy of this note is empty — a true orphan. Remove them all.
      for (const f of group) await removeNotebookFolder(notebooksDir, f.folder)
      delete map[id]
      continue
    }
    for (const f of losers) await removeNotebookFolder(notebooksDir, f.folder)
    map[id] = winner.folder
    out.push({ id, createdAt: winner.meta.createdAt, title: winner.meta.title, content: winner.content, folder: winner.folder })
  }
  await setJSON('quicknote_folder_map', map)
  out.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return out
}

/** Save a quick note as a real notebook folder in the archive.
 *  note: { id, title, content, createdAt } — returns the written meta. */
export async function saveQuickNoteAsNotebook(note) {
  const notebooksDir = await getNotebooksDir()
  // Prefer the persisted id→folder map. iCloud can hide a folder's meta.json so
  // findNotebookFolderById misses it and spawns a duplicate; the map lets us reuse
  // the real folder even before its meta has materialized locally.
  const folderMap = await getJSON('quicknote_folder_map', {})
  let folderName = null
  if (folderMap[note.id] && await exists(await join(notebooksDir, folderMap[note.id]))) {
    folderName = folderMap[note.id]
  }
  if (!folderName) folderName = await findNotebookFolderById(notebooksDir, note.id)
  if (!folderName) {
    const base = sanitizeFolderName(note.title || `Quick Note ${new Date().toISOString().slice(0, 10)}`) || 'Quick Note'
    let candidate = base, i = 2
    while (await exists(await join(notebooksDir, candidate))) candidate = `${base} ${i++}`
    folderName = candidate
    await mkdir(await join(notebooksDir, folderName), { recursive: true })
  }
  const dir = await join(notebooksDir, folderName)
  const words = (note.content.match(/\S+/g) || []).length
  const meta = {
    id: note.id,
    title: note.title || folderName,
    wordCount: words,
    quickNote: true,
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  await writeTextFile(await join(dir, `${folderName}.md`), note.content)
  folderMap[note.id] = folderName
  await setJSON('quicknote_folder_map', folderMap)
  await addToQuickNotesCollection(note.id)
  return meta
}

/** Delete a quick note entirely — folder on disk + its quicknotes-collection entry. */
export async function deleteQuickNote(noteId) {
  try {
    await deleteNotebookContent(noteId)
    const folderMap = await getJSON('quicknote_folder_map', {})
    if (folderMap[noteId]) { delete folderMap[noteId]; await setJSON('quicknote_folder_map', folderMap) }
    const collections = await getJSON('collections_meta', [])
    const col = collections.find(c => c.name === 'quicknotes')
    if (col?.items?.includes(noteId)) {
      col.items = col.items.filter(i => i !== noteId)
      await setJSON('collections_meta', collections)
    }
  } catch (err) {
    console.warn('[Gnos] deleteQuickNote failed:', err)
  }
}

/** Ensure a "quicknotes" collection exists and contains this note id. */
async function addToQuickNotesCollection(noteId) {
  try {
    const collections = await getJSON('collections_meta', [])
    let col = collections.find(c => c.name === 'quicknotes')
    if (!col) {
      col = { id: `col_${Date.now().toString(36)}`, name: 'quicknotes', items: [], color: '#8250df', createdAt: new Date().toISOString() }
      collections.push(col)
    }
    if (!col.items.includes(noteId)) col.items.push(noteId)
    await setJSON('collections_meta', collections)
  } catch (err) {
    console.warn('[Gnos] addToQuickNotesCollection failed:', err)
  }
}

/** Save a quick note as a plain .md file in a custom folder.
 *  Returns the file path; pass note.filePath on re-saves to keep it stable. */
export async function saveQuickNoteToDir(note, dirPath) {
  if (!(await exists(dirPath))) await mkdir(dirPath, { recursive: true })
  let filePath = note.filePath
  if (!filePath) {
    const base = sanitizeFolderName(note.title || `Quick Note ${new Date().toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '.')}`) || 'Quick Note'
    let candidate = `${base}.md`, i = 2
    while (await exists(await join(dirPath, candidate))) candidate = `${base} ${i++}.md`
    filePath = await join(dirPath, candidate)
  }
  await writeTextFile(filePath, note.content)
  return filePath
}

/** Load every `.md` quick note from a custom folder, newest first. Mirrors
 *  saveQuickNoteToDir so custom-folder notes survive a restart (archive-mode
 *  notes reload via loadNotebooksMeta; this is the custom-folder equivalent). */
export async function loadQuickNotesFromDir(dirPath) {
  if (!dirPath || !(await exists(dirPath))) return []
  const entries = await readDir(dirPath).catch(() => [])
  const notes = await Promise.all(
    entries
      .filter(e => e.name && !e.name.startsWith('.') && e.name.toLowerCase().endsWith('.md'))
      .map(async e => {
        try {
          const filePath = await join(dirPath, e.name)
          const content = await readTextFile(filePath)
          let updatedAt = 0
          try { updatedAt = (await stat(filePath)).mtime?.getTime?.() || 0 } catch { /* no mtime */ }
          return { id: `qnfile:${filePath}`, filePath, title: e.name.replace(/\.md$/i, ''), content, updatedAt }
        } catch { return null }
      })
  )
  return notes.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function loadPreferences() {
  return getJSON('app_prefs', null)
}

export async function savePreferences(prefs) {
  return setJSON('app_prefs', prefs)
}

// ── Reading log ───────────────────────────────────────────────────────────────
// Stores a map of { "YYYY-MM-DD": minutesRead } for streak/stats calculation.

export async function loadReadingLog() {
  return getJSON('reading_log', {})
}

export async function addReadingMinutes(minutes) {
  if (!minutes || minutes <= 0) return
  const today = new Date().toISOString().slice(0, 10)
  const log = await loadReadingLog()
  log[today] = (log[today] || 0) + minutes
  return setJSON('reading_log', log)
}

// ── Audio (named-folder format) ───────────────────────────────────────────────
//
// Folder layout:
//   archive/audio/<Artist - Title>/
//     meta.json            — book metadata (title, author, format, chapters list, …)
//     audio.<ext>          — raw audio bytes for single-file audiobooks
//     chapter_<n>.<ext>    — raw audio bytes for multi-chapter audiobooks
//
// Audio binary data is stored as raw files using Tauri's writeFile/readFile APIs.
// Legacy base64 data-URL strings under audiodata_<id> / audiochap_<id>_<n> are
// still read as a backwards-compatibility fallback.
//
// FLAT: a single-track audiobook (`format: 'audio'`) is one flat file,
// `audio/<Author - Title>.<ext>` — no per-item folder. A multi-chapter
// audiobook (`format: 'audiofolder'`) still needs a folder for its chunk
// files, but the folder holds ONLY the chunks now — no `meta.json`
// (library.json is already the sole meta source of truth) and no cover
// (covers live in the shared `covers/` dir, below). The folder/file name is a
// pure function of title/author (`bookFolderName`), and title isn't
// user-editable for audio, so — unlike notebooks/sketchbooks — no id→name
// index is needed at all; callers already hand us the full book object.

async function getAudioDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'audio')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** A96 — same reasoning as getBookBaseDir: no index for audio, so a plain
 *  `book.collection` field on the library.json object is the only place its
 *  collection membership can live. */
async function getAudioBaseDir(book) {
  if (book?.collection) {
    const dir = await getCollectionDir(book.collection)
    if (dir) {
      if (!(await exists(dir))) await mkdir(dir, { recursive: true })
      return dir
    }
  }
  return await getAudioDir()
}

/** Folder for a multi-chapter (`audiofolder`) audiobook's chunk files. */
async function getAudioBookDir(book) {
  const audioDir = await getAudioBaseDir(book)
  const folderName = sanitizeFolderName(bookFolderName(book))
  const dir = await join(audioDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** Flat file path for a single-track audiobook. */
async function getAudioFlatPath(book) {
  const audioDir = await getAudioBaseDir(book)
  const folderName = sanitizeFolderName(bookFolderName(book))
  const ext = book.audioExt || 'mp3'
  return await join(audioDir, `${folderName}.${ext}`)
}

/**
 * A96 — move an audiobook into a collection folder (or back to audio/ when
 * `collectionName` is null). `book` must be the CURRENT full book object —
 * same no-index reasoning as moveBookToCollection. Multi-chapter audio moves
 * its whole chunk folder as one unit (the "type subfolder inside a
 * collection" the design explicitly avoids everywhere else — unavoidable
 * here, chunked audio needs A folder regardless of where it lives).
 */
export async function moveAudioToCollection(book, collectionName) {
  try {
    const toDir = collectionName ? await getCollectionDir(collectionName) : await getAudioDir()
    if (collectionName && !toDir) return false
    if (!(await exists(toDir))) await mkdir(toDir, { recursive: true })
    const folderName = sanitizeFolderName(bookFolderName(book))

    if (book.format === 'audiofolder') {
      const from = await getAudioBookDir(book) // creates it if missing — fine, exists() below catches an empty move
      if (!(await exists(from))) return false
      let finalName = folderName, to = await join(toDir, finalName), n = 2
      while (await exists(to)) {
        if (to === from) return true
        finalName = `${folderName} ${n++}`
        to = await join(toDir, finalName)
      }
      await rename(from, to)
      return true
    }

    const from = await getAudioFlatPath(book)
    if (!(await exists(from))) return false
    const ext = book.audioExt || 'mp3'
    let finalName = `${folderName}.${ext}`, to = await join(toDir, finalName), n = 2
    while (await exists(to)) {
      if (to === from) return true
      finalName = `${folderName} ${n++}.${ext}`
      to = await join(toDir, finalName)
    }
    await rename(from, to)
    return true
  } catch (err) { console.warn('[Gnos] moveAudioToCollection failed', err); return false }
}

// ── Shared cover art (books/audio; sketchbooks/notebooks don't have one) ──────
// One flat `covers/<id>.<ext>` per item instead of a `cover.<ext>` sidecar
// inside a per-item folder — lets audio (and eventually books) go fully flat
// without giving up cover art. `RESERVED_DIRS` already blocks a collection
// from claiming the name.

async function getCoversDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'covers')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function _findSharedCover(id) {
  const dir = await getCoversDir()
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const p = await join(dir, `${id}.${ext}`)
    if (await exists(p)) return p
  }
  return null
}

async function writeSharedCover(id, coverDataUrl) {
  const match = coverDataUrl?.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return false
  try {
    const ext = match[1].includes('png') ? 'png' : match[1].includes('webp') ? 'webp' : 'jpg'
    const binaryStr = atob(match[2])
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    await writeFile(await join(await getCoversDir(), `${id}.${ext}`), bytes)
    return true
  } catch { return false }
}

async function removeSharedCover(id) {
  try {
    const p = await _findSharedCover(id)
    if (p) await remove(p)
    const thumbPath = await join(await getCoversDir(), `${id}.thumb.jpg`)
    if (await exists(thumbPath)) await remove(thumbPath)
  } catch { /* non-fatal */ }
}

/** Cover reader counterpart to `loadCoverFromFolder` (loadLibrary, below) but
 *  for the shared `covers/` dir — same thumb-cache strategy, keyed by id. */
async function loadSharedCover(id) {
  try {
    const coverPath = await _findSharedCover(id)
    if (!coverPath) return null
    const thumbPath = await join(await getCoversDir(), `${id}.thumb.jpg`)
    if (await exists(thumbPath)) {
      let fresh = true
      try {
        const [c, t] = await Promise.all([stat(coverPath), stat(thumbPath)])
        if (c.mtime && t.mtime && new Date(t.mtime) < new Date(c.mtime)) fresh = false
      } catch { /* stat unavailable — trust the thumb */ }
      if (fresh) return convertFileSrc(thumbPath)
    }
    const srcUrl = convertFileSrc(coverPath)
    if (!_thumbQueue.some(j => j.destPath === thumbPath)) _thumbQueue.push({ srcUrl, destPath: thumbPath })
    return srcUrl
  } catch { return null }
}

// Write the cover into the shared covers/ dir. Meta itself is NOT written
// anywhere else — library.json (loadLibrary/saveLibrary) is already the sole
// source of truth for title/author/etc. For a multi-chapter book, also
// ensure its chunk folder exists.
export async function saveAudiobookMeta(book) {
  try {
    if (book?.coverDataUrl) await writeSharedCover(book.id, book.coverDataUrl)
    if (book?.format === 'audiofolder') await getAudioBookDir(book)
  } catch (err) {
    console.warn('[Gnos] saveAudiobookMeta failed for', book?.id, err)
  }
}

export async function deleteAudiobookMeta(book) {
  try {
    await removeSharedCover(book.id)
    if (book.format === 'audiofolder') {
      const dir = await getAudioBookDir(book)
      if (await exists(dir)) {
        try { await invoke('move_to_trash', { paths: [dir] }) }
        catch { await remove(dir, { recursive: true }).catch(() => {}) }
      }
    } else {
      const p = await getAudioFlatPath(book)
      if (await exists(p)) {
        try { await invoke('move_to_trash', { paths: [p] }) }
        catch { await remove(p).catch(() => {}) }
      }
    }
  } catch (err) { console.debug('[Gnos] deleteAudiobookMeta error', err) }
}

function _extToMime(ext) {
  const map = { mp3: 'audio/mpeg', m4b: 'audio/mp4', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg; codecs=opus' }
  return map[ext?.toLowerCase()] || 'audio/mpeg'
}

export async function writeAudioFile(book, fileName, uint8Array) {
  if (book.format === 'audiofolder') {
    const dir = await getAudioBookDir(book)
    await writeFile(await join(dir, fileName), uint8Array)
    return
  }
  // Single track — flat file, no subfolder. `fileName` is `audio.<ext>`.
  const ext = fileName.split('.').pop()
  await writeFile(await join(await getAudioDir(), `${sanitizeFolderName(bookFolderName(book))}.${ext}`), uint8Array)
}

export async function readAudioFile(book, fileName) {
  try {
    if (book.format === 'audiofolder') {
      const dir = await getAudioBookDir(book)
      const filePath = await join(dir, fileName)
      if (!(await exists(filePath))) return null
      return await readFile(filePath)
    }
    const ext = fileName.split('.').pop()
    const flatPath = await join(await getAudioDir(), `${sanitizeFolderName(bookFolderName(book))}.${ext}`)
    if (await exists(flatPath)) return await readFile(flatPath)
    // Not yet migrated this session — fall back to the legacy per-book folder.
    const legacyPath = await join(await getAudioBookDir(book), fileName)
    if (await exists(legacyPath)) return await readFile(legacyPath)
    return null
  } catch { return null }
}

export async function loadAudioChapter(bookOrId, chapterIdx) {
  // New binary path: pass the full book object with audioChapters[n].ext set
  if (bookOrId && typeof bookOrId === 'object') {
    const book = bookOrId
    const ext = book.audioChapters?.[chapterIdx]?.ext
    if (ext) {
      const bytes = await readAudioFile(book, `chapter_${chapterIdx}.${ext}`)
      if (bytes) return new Blob([bytes], { type: _extToMime(ext) })
    }
    // Fall back to legacy keyed-store format
    return storage.get(`audiochap_${book.id}_${chapterIdx}`)
  }
  // Legacy: bookOrId is a string ID
  return storage.get(`audiochap_${bookOrId}_${chapterIdx}`)
}

export async function saveAudioChapter(bookId, chapterIdx, dataUrl) {
  return storage.set(`audiochap_${bookId}_${chapterIdx}`, dataUrl)
}

export async function deleteAudiobook(book) {
  // Remove the named meta folder
  await deleteAudiobookMeta(book)
  // Remove audio payload keys
  if (book.format === 'audiofolder' && book.audioChapters) {
    for (let i = 0; i < book.audioChapters.length; i++) {
      await storage.delete(`audiochap_${book.id}_${i}`)
    }
    await storage.delete(`audiochaps_${book.id}`)
  } else {
    await storage.delete(`audiodata_${book.id}`)
  }
}

export async function loadSingleAudioData(bookOrId) {
  if (bookOrId && typeof bookOrId === 'object') {
    const book = bookOrId
    const ext = book.audioExt
    if (ext) {
      const bytes = await readAudioFile(book, `audio.${ext}`)
      if (bytes) return new Blob([bytes], { type: _extToMime(ext) })
    }
    return storage.get(`audiodata_${book.id}`)
  }
  return storage.get(`audiodata_${bookOrId}`)
}

/**
 * Flatten audio: single-track books move to a flat `audio/<Name>.<ext>` file;
 * multi-chapter books keep a chunk folder but lose `meta.json` (library.json
 * already has the meta). Cover moves to the shared `covers/<id>.<ext>`.
 *
 * Handles TWO legacy shapes, not just one:
 *  1. Binary chunk folder (`audio/<Name>/{audio.ext | chapter_N.ext, meta.json,
 *     cover.ext}`) — the format `saveAudiobookMeta`/`writeAudioFile` wrote
 *     before this pass.
 *  2. OLDEST legacy — base64 data: URLs in the keyed store (`audiodata_<id>`,
 *     `audiochap_<id>_<n>`), which `keyToPath` resolves to individual
 *     `audio/audiochap_<id>_<n>.json` files SITTING FLAT IN `audio/` (never
 *     had a per-book folder at all). A first cut of this migration only
 *     looked for shape 1 and silently skipped every shape-2 book — exactly
 *     what left a user's `audio/` full of one-json-per-chapter files after
 *     "flattening". Fixed: shape 2 is decoded straight to a real binary file
 *     (folder for multi-chapter, flat file for single-track) and the keyed
 *     JSON is deleted, independent of whether a folder exists.
 *
 * Runs once, guarded by `audio_flat_migrated_v2` (bumped from `_v1` so this
 * fix re-runs even for anyone whose v1 pass already completed a no-op).
 */
export async function migrateAudiobooksToFlat(library) {
  if (!library?.length) return { migrated: 0 }
  try {
    if (await _migrationDone('audio_flat_migrated_v2')) return { migrated: 0, skipped: true }
    const audioDir = await getAudioDir()
    let migrated = 0
    for (const book of library) {
      if (book.type !== 'audio') continue
      try {
        let changed = false
        const folderName = sanitizeFolderName(bookFolderName(book))
        const folder = await join(audioDir, folderName)
        const hasFolder = await exists(folder)

        // Cover → shared covers/, if it lived in a folder.
        if (hasFolder) {
          for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
            const src = await join(folder, `cover.${ext}`)
            if (await exists(src)) {
              const dest = await join(await getCoversDir(), `${book.id}.${ext}`)
              if (!(await exists(dest))) await rename(src, dest)
              break
            }
          }
        }

        if (book.format === 'audiofolder') {
          // Shape 2 — decode any base64 chapter still sitting in the keyed
          // store into the real chunk folder, whether or not that folder
          // already existed.
          const chapters = book.audioChapters || []
          for (let i = 0; i < chapters.length; i++) {
            const ext = chapters[i]?.ext || 'mp3'
            const dest = await join(await getAudioBookDir(book), `chapter_${i}.${ext}`)
            if (await exists(dest)) continue // already binary — shape 1 or already migrated
            const rec = await storage.get(`audiochap_${book.id}_${i}`)
            if (!rec?.value) continue
            const bytes = dataUrlToBytes(rec.value)
            if (!bytes) continue
            await writeFile(dest, bytes)
            await storage.delete(`audiochap_${book.id}_${i}`)
            changed = true
          }
          if (changed) await storage.delete(`audiochaps_${book.id}`)
          // Shape 1 — folder already has real chunks; just drop the sidecars.
          if (hasFolder) {
            const metaPath = await join(folder, 'meta.json')
            if (await exists(metaPath)) { await remove(metaPath).catch(() => {}); changed = true }
            const thumbPath = await join(folder, THUMB_NAME)
            if (await exists(thumbPath)) await remove(thumbPath).catch(() => {})
          }
        } else {
          // Single-track — flatten from whichever legacy shape still holds it.
          const flatPath = await getAudioFlatPath(book)
          if (!(await exists(flatPath))) {
            if (hasFolder) {
              const ext = book.audioExt || 'mp3'
              const src = await join(folder, `audio.${ext}`)
              if (await exists(src)) { await rename(src, flatPath); changed = true }
            }
            if (!(await exists(flatPath))) {
              // Shape 2 — base64 in the keyed store, no folder ever existed.
              const rec = await storage.get(`audiodata_${book.id}`)
              if (rec?.value) {
                const bytes = dataUrlToBytes(rec.value)
                if (bytes) {
                  await writeFile(flatPath, bytes)
                  await storage.delete(`audiodata_${book.id}`)
                  changed = true
                }
              }
            }
          }
          if (hasFolder) {
            try { await invoke('move_to_trash', { paths: [folder] }) }
            catch (err) { console.warn('[Gnos] audio flatten: folder → OS trash failed, leaving it in place', err) }
          }
        }
        if (changed) migrated++
      } catch (err) { console.warn('[Gnos] migrateAudiobooksToFlat failed for', book.id, err) }
    }
    await _markMigrationDone('audio_flat_migrated_v2')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateAudiobooksToFlat failed', err); return { migrated: 0 } }
}

// ══════════════════════════════════════════════════════════════════════════
// FLAT SKETCHBOOKS — a sketchbook is a single `sketches/<Title>.excalidraw`
// file (Excalidraw's own scene JSON, unmodified — it already embeds pasted
// images as base64 in its own `files` map, so no assets dir is ever needed).
// All app metadata (title, elementCount, coverColor, timestamps) lives in one
// central `sketches_index` entry, keyed by id — same design as the flat
// notebooks index (see NB_INDEX_KEY above), including the same lesson: this
// is root-keyed storage (`sketches_index.json`), never a dotfile inside
// sketches/ (A52 — leading-dot paths are rejected by the fs capability scope).
//
// Legacy folder format (still read, migrated by migrateSketchbooksToFlat):
//   archive/sketches/<Title>_<shortId>/{meta.json, sketch.json}
// Oldest legacy flat-file: archive/sketches/sketchbook_<id>.json (keyed store)
// ══════════════════════════════════════════════════════════════════════════
const SK_INDEX_KEY = 'sketches_index'
const SK_HOME = 'sketches'

/** Split a stored sketchbook index path into { dir, name } — dir defaults to
 *  sketches/ for a bare legacy filename. Same shape as notebooks'
 *  _splitIndexPath, kept separate since the two have different home dirs. */
function _splitSkPath(file) {
  const p = String(file || '').replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i === -1 ? { dir: SK_HOME, name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

/** Absolute path for a sketchbook index `file` value (collection-aware — A96). */
async function _resolveSkPath(file) {
  const { dir, name } = _splitSkPath(file)
  const base = await getBaseDir()
  return dir ? await join(base, dir, name) : await join(base, name)
}

/** Absolute path of a stored `dir` value (SK_HOME or a collection name). */
async function _resolveSkDir(dir) {
  const base = await getBaseDir()
  return dir && dir !== SK_HOME ? await join(base, dir) : await join(base, SK_HOME)
}

async function getSketchesDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'sketches')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/** Legacy named-folder path for a sketchbook (pre-flatten format only). */
async function getSketchDir(sketchbook) {
  const sketchesDir = await getSketchesDir()
  // Include a short ID suffix to guarantee uniqueness when multiple sketchbooks share the same title
  const safeName = sanitizeFolderName(sketchbook.title || 'sketch')
  const shortId = (sketchbook.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(-12)
  const folderName = shortId ? `${safeName}_${shortId}` : safeName
  // Scan all existing sketch folders for one whose meta.id matches — handles renames
  const existing = await _findFolderById(sketchesDir, sketchbook.id)
  if (existing) return existing
  const dir = await join(sketchesDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function loadSketchesIndex() {
  try {
    const m = await getJSON(SK_INDEX_KEY, {})
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}
  } catch { return {} }
}

async function saveSketchesIndex(sketches) {
  try {
    const ok = await setJSON(SK_INDEX_KEY, sketches)
    return ok !== false
  } catch (err) { console.warn('[Gnos] saveSketchesIndex failed', err); return false }
}

async function _patchSkIndex(id, patch) {
  const sketches = await loadSketchesIndex()
  sketches[id] = { ...(sketches[id] || {}), ...patch, id }
  return saveSketchesIndex(sketches)
}

async function _removeSkIndex(id) {
  const sketches = await loadSketchesIndex()
  if (sketches[id]) { delete sketches[id]; await saveSketchesIndex(sketches) }
}

/**
 * A96 — move a sketchbook into a collection folder (or back to sketches/ when
 * `collectionName` is null). Mirrors moveNotebookToCollection exactly: one
 * collection per item, physically relocates the file, updates the index.
 */
export async function moveSketchbookToCollection(id, collectionName) {
  try {
    const idx = await loadSketchesIndex()
    const entry = idx[id]
    if (!entry?.file) return false
    const from = await _resolveSkPath(entry.file)
    if (!(await exists(from))) return false
    const { name } = _splitSkPath(entry.file)
    const targetDir = collectionName ? sanitizeFolderName(collectionName) : SK_HOME
    if (collectionName && RESERVED_DIRS.has(targetDir.toLowerCase())) return false
    const base = await getBaseDir()
    const destDir = await join(base, targetDir)
    if (!(await exists(destDir))) await mkdir(destDir, { recursive: true })
    let finalName = name
    let to = await join(destDir, finalName)
    let n = 2
    while (await exists(to)) {
      if (to === from) return true
      finalName = name.replace(/(\.excalidraw)$/i, ` ${n++}$1`)
      to = await join(destDir, finalName)
    }
    await rename(from, to)
    idx[id] = { ...entry, file: `${targetDir}/${finalName}` }
    await saveSketchesIndex(idx)
    return true
  } catch (err) { console.warn('[Gnos] moveSketchbookToCollection failed', err); return false }
}

/** One-time backfill (A96 follow-up): a book/audiobook/sketchbook added to a
 *  collection BEFORE its type had a mover (everything pre-A96) only ever got
 *  `collections_meta.json`'s items[] updated — the file itself was never
 *  physically moved. Notebooks are unaffected (A61 always moved them), but
 *  every mover here is idempotent (no-op if the file's already in place), so
 *  running it for notebooks too is harmless. Must run AFTER the per-type
 *  flatten migrations so paths resolve against their final on-disk shape. */
/** A96/A97 follow-up: a real, non-reserved folder at archive root IS a
 *  collection by definition — that's the whole point (an AI agent or another
 *  device can just create one and drop files in, per the user's original
 *  design). Reconciles `collections_meta.json` against what's actually on
 *  disk: (1) registers any folder with no matching entry yet, (2) for
 *  notebooks/sketchbooks — whose index already tracks each item's real path —
 *  fixes items[] to match physical location exactly (single membership: the
 *  folder a file is actually sitting in always wins, notebooks/sketchbooks
 *  moved or dropped in externally included).
 *  Books/audio are left alone here: unlike notebooks/sketchbooks they have no
 *  self-heal/orphan-adopt tied to physical location, so guessing membership
 *  from a filename match would be fragile — they keep using the explicit
 *  `book.collection` field set by the in-app move (A96) or the id-based
 *  backfill (A97).
 *  Must run AFTER notebooks/sketchbooks index self-heal (loadNotebooksMeta/
 *  loadSketchbooksMeta) so `file` paths reflect any just-adopted orphans. */
export async function syncFolderCollections() {
  try {
    const folders = await listCollectionFolders()
    const collections = await getJSON('collections_meta', [])
    const byNameLower = new Map(collections.map(c => [c.name.toLowerCase(), c]))
    let changed = false

    for (const folder of folders) {
      if (byNameLower.has(folder.toLowerCase())) continue
      const col = { id: `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: folder, items: [], createdAt: new Date().toISOString() }
      collections.push(col)
      byNameLower.set(folder.toLowerCase(), col)
      changed = true
    }
    if (!collections.length) { if (changed) await setJSON('collections_meta', collections); return }

    const [nbIdx, skIdx] = await Promise.all([loadNotebooksIndex(), loadSketchesIndex()])
    // id → actual collection folder name, or null if it lives in the default type folder.
    const actualCollectionById = new Map()
    for (const [id, entry] of Object.entries(nbIdx)) {
      if (!entry?.file || entry.folderNote) continue
      const { dir } = _splitIndexPath(entry.file)
      actualCollectionById.set(id, dir === NB_HOME ? null : dir)
    }
    for (const [id, entry] of Object.entries(skIdx)) {
      if (!entry?.file) continue
      const { dir } = _splitSkPath(entry.file)
      actualCollectionById.set(id, dir === SK_HOME ? null : dir)
    }

    for (const col of collections) {
      const items = new Set(col.items || [])
      for (const [id, actualDir] of actualCollectionById) {
        const belongs = actualDir && actualDir.toLowerCase() === col.name.toLowerCase()
        if (belongs && !items.has(id)) { items.add(id); changed = true }
        else if (!belongs && items.has(id)) { items.delete(id); changed = true }
      }
      col.items = [...items]
    }

    if (changed) await setJSON('collections_meta', collections)
  } catch (err) {
    console.warn('[Gnos] syncFolderCollections failed', err)
  }
}

export async function migrateCollectionMembershipToFolders() {
  if (await _migrationDone('collection_membership_backfilled_v1')) return
  try {
    const collections = await getJSON('collections_meta', [])
    if (!collections?.length) { await _markMigrationDone('collection_membership_backfilled_v1'); return }
    const [nbIdx, skIdx, library] = await Promise.all([loadNotebooksIndex(), loadSketchesIndex(), loadLibrary()])
    const libraryById = new Map((library || []).map(b => [b.id, b]))
    let libraryChanged = false
    for (const col of collections) {
      for (const itemId of col.items || []) {
        if (nbIdx[itemId]) { await moveNotebookToCollection(itemId, col.name); continue }
        if (skIdx[itemId]) { await moveSketchbookToCollection(itemId, col.name); continue }
        const book = libraryById.get(itemId)
        if (!book) continue
        const mover = book.type === 'audio' ? moveAudioToCollection : moveBookToCollection
        const ok = await mover(book, col.name)
        if (ok && book.collection !== col.name) { book.collection = col.name; libraryChanged = true }
      }
    }
    if (libraryChanged) await saveLibrary(library)
    await _markMigrationDone('collection_membership_backfilled_v1')
  } catch (err) {
    console.warn('[Gnos] migrateCollectionMembershipToFolders failed', err)
  }
}

/** Choose a unique `<Title>.excalidraw` filename, avoiding collisions with
 *  existing files, folders, and other index entries. */
function _flatSketchFileName(title, id, takenLower) {
  const base = sanitizeFolderName(title || id) || id
  let name = `${base}.excalidraw`
  let n = 2
  while (takenLower.has(name.toLowerCase())) { name = `${base} ${n++}.excalidraw` }
  takenLower.add(name.toLowerCase())
  return name
}

// Serializes the orphan-adopt self-heal below. Without this, two overlapping
// calls to loadSketchbooksMeta() (React double-invoke, rapid re-renders,
// whatever the trigger) each read the SAME on-disk index before either had
// written back, so each independently "adopted" the same orphan .excalidraw
// file under its own fresh random id — and because migrateSketchbooksToFolders
// then materialized every entry it was handed as a real folder, each launch
// left a fresh pair of duplicate meta.json-only folders behind (A88 — found
// live: 24 such folders, 3 phantom dupes per real sketchbook, zero real
// content in any of them). Chaining every call through one promise means the
// second call's re-read of the index happens AFTER the first call's write,
// so it correctly sees the file as no longer orphaned.
let _skOrphanChain = Promise.resolve()

/** Adopts any orphan .excalidraw file into the index and returns the
 *  resulting (possibly unchanged) index. Serialized — see comment above.
 *  Scans sketches/ AND every collection folder (A96) — comparison is done
 *  on NORMALIZED paths via _splitSkPath on both sides, because an existing
 *  sketchbook's stored `file` is a BARE filename (no `sketches/` prefix);
 *  comparing that naively against a collection-scan's prefixed candidate
 *  path would make every existing sketchbook look orphaned again — the exact
 *  bug A88 already fixed once, reintroduced via this exact code path. */
async function _adoptSketchOrphans(sketchesDir) {
  const run = async () => {
    const idx = await loadSketchesIndex() // fresh read — it's our turn now
    const indexedFiles = new Set(
      Object.values(idx).map(e => e?.file && _splitSkPath(e.file))
        .filter(Boolean).map(x => `${x.dir}/${x.name}`.toLowerCase()))
    const candidates = []
    const topEntries = await readDir(sketchesDir).catch(() => [])
    for (const e of topEntries) {
      if (!e.name || e.name.startsWith('.') || !e.name.toLowerCase().endsWith('.excalidraw')) continue
      if (indexedFiles.has(`${SK_HOME}/${e.name}`.toLowerCase())) continue
      candidates.push({ dir: SK_HOME, abs: sketchesDir, name: e.name })
    }
    for (const colDir of await listCollectionFolders()) {
      const colAbs = await join(await getBaseDir(), colDir)
      const colEntries = await readDir(colAbs).catch(() => [])
      for (const e of colEntries) {
        if (!e.name || e.name.startsWith('.') || !e.name.toLowerCase().endsWith('.excalidraw')) continue
        if (indexedFiles.has(`${colDir}/${e.name}`.toLowerCase())) continue
        candidates.push({ dir: colDir, abs: colAbs, name: e.name })
      }
    }
    if (!candidates.length) return idx
    let adopted = false
    for (const c of candidates) {
      try {
        const p = await join(c.abs, c.name)
        const st = await stat(p).catch(() => null)
        if (!st) continue
        const raw = await readTextFile(p).catch(() => null)
        if (raw == null) continue
        let elementCount = 0
        try { elementCount = JSON.parse(raw)?.elements?.length || 0 } catch { /* keep 0 */ }
        const mtime = _mtimeMs(st)
        const entry = {
          id: `sk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: c.name.replace(/\.excalidraw$/i, ''), elementCount,
          createdAt: new Date(mtime).toISOString(), updatedAt: new Date(mtime).toISOString(),
          file: `${c.dir}/${c.name}`, adoptedFromDisk: true,
        }
        idx[entry.id] = entry; adopted = true
      } catch { /* skip unreadable orphan */ }
    }
    if (adopted) await saveSketchesIndex(idx)
    return idx
  }
  const result = _skOrphanChain.then(run, run)
  _skOrphanChain = result.then(() => {}, () => {})
  return result
}

export async function loadSketchbooksMeta() {
  const sketchesDir = await getSketchesDir()
  // Self-heal FIRST (serialized) so the index used below is authoritative —
  // both the flat-index listing and the legacy-folder dedup check need to
  // agree on the same just-healed snapshot, not two independently-stale reads.
  const idx = await _adoptSketchOrphans(sketchesDir)
  const metas = []

  // ── Flat sketchbooks from the central index ──
  for (const entry of Object.values(idx)) {
    if (entry?.id && entry.file) metas.push(entry)
  }

  // ── Legacy folder-format sketchbooks (not yet migrated) ──
  try {
    const entries = await readDir(sketchesDir)
    const folderMetas = (await Promise.all(
      entries
        .filter(e => e.name && !e.name.startsWith('.'))
        .map(async entry => {
          try {
            const metaPath = await join(sketchesDir, entry.name, 'meta.json')
            if (!(await exists(metaPath))) return null
            const meta = JSON.parse(await readTextFile(metaPath))
            if (meta?.id && idx[meta.id]) return null // already flattened — prefer index copy
            return meta
          } catch { return null /* skip corrupt */ }
        })
    )).filter(Boolean)
    metas.push(...folderMetas)
  } catch { /* sketches dir issue — index-only is fine */ }

  if (metas.length > 0) {
    // Deduplicate by ID — keep the entry with the most recent updatedAt (rename can create duplicates)
    const seen = new Map()
    for (const m of metas) {
      if (!m.id) continue
      const existing = seen.get(m.id)
      if (!existing || new Date(m.updatedAt) > new Date(existing.updatedAt)) {
        seen.set(m.id, m)
      }
    }
    const uniqueMetas = [...seen.values()]

    // Use the saved JSON order as the authoritative sort so manual reordering persists.
    // Items not in the saved order (newly created) go at the end sorted by updatedAt.
    const savedOrder = await getJSON('sketchbooks_meta', [])
    if (savedOrder.length > 0) {
      const idxMap = new Map(savedOrder.map((s, i) => [s.id, i]))
      return uniqueMetas.sort((a, b) => {
        const ai = idxMap.has(a.id) ? idxMap.get(a.id) : Infinity
        const bi = idxMap.has(b.id) ? idxMap.get(b.id) : Infinity
        if (ai !== bi) return ai - bi
        return new Date(b.updatedAt) - new Date(a.updatedAt)
      })
    }
    return uniqueMetas.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  }
  return getJSON('sketchbooks_meta', [])
}

export async function saveSketchbooksMeta(sketchbooks) {
  const sketchesDir = await getSketchesDir()
  const existingEntries = await readDir(sketchesDir).catch(() => [])
  const idx = await loadSketchesIndex()
  let idxChanged = false
  const takenLower = new Set(existingEntries.map(e => e.name?.toLowerCase()).filter(Boolean))

  for (const sb of sketchbooks) {
    try {
      // ── FLAT sketchbook — meta lives in the central index; no folder ──
      if (idx[sb.id]) {
        const entry = idx[sb.id]
        let fileName = entry.file
        // `file` is archive-relative — rename only the basename, keeping the
        // sketchbook inside whatever collection folder it currently lives in.
        const { dir: curDir, name: curName } = _splitSkPath(fileName)
        const desiredBase = sanitizeFolderName(sb.title || sb.id) || sb.id
        const curBase = curName.replace(/\.excalidraw$/i, '')
        if (fileName && desiredBase && desiredBase.toLowerCase() !== curBase.toLowerCase()) {
          const taken = curDir === SK_HOME
            ? new Set(takenLower)
            : new Set((await readDir(await _resolveSkDir(curDir)).catch(() => [])).map(e => e.name?.toLowerCase()).filter(Boolean))
          taken.delete(curName.toLowerCase())
          let nn = `${desiredBase}.excalidraw`, k = 2
          while (taken.has(nn.toLowerCase())) nn = `${desiredBase} ${k++}.excalidraw`
          try {
            const oldP = await _resolveSkPath(fileName)
            const newP = await _resolveSkPath(`${curDir}/${nn}`)
            if ((await exists(oldP)) && !(await exists(newP))) {
              await rename(oldP, newP)
              if (curDir === SK_HOME) { takenLower.delete(curName.toLowerCase()); takenLower.add(nn.toLowerCase()) }
              fileName = `${curDir}/${nn}`
            }
          } catch { /* keep old name on rename failure */ }
        }
        idx[sb.id] = { ...entry, ...sb, file: fileName }
        idxChanged = true
        continue
      }
      // ── Legacy folder-format (not yet migrated) — write meta.json in place ──
      const existingFolder = await _findFolderById(sketchesDir, sb.id)
      if (existingFolder) {
        await writeTextFile(await join(existingFolder, 'meta.json'), JSON.stringify(sb, null, 2))
        continue
      }
      // ── Brand new sketchbook with no content saved yet — create it FLAT ──
      const fileName = _flatSketchFileName(sb.title || sb.id, sb.id, takenLower)
      idx[sb.id] = { ...sb, file: fileName }
      idxChanged = true
      const p = await join(sketchesDir, fileName)
      if (!(await exists(p))) await writeTextFile(p, JSON.stringify({ elements: [], appState: {}, files: {} }))
    } catch (err) {
      console.warn('[Gnos] saveSketchbooksMeta write failed for', sb.id, err)
    }
  }
  if (idxChanged) await saveSketchesIndex(idx)
  return setJSON('sketchbooks_meta', sketchbooks)
}

export async function loadSketchbookContent(id) {
  try {
    const idx = await loadSketchesIndex()
    if (idx[id]?.file) {
      const p = await _resolveSkPath(idx[id].file)
      if (await exists(p)) return JSON.parse(await readTextFile(p))
    }
  } catch { /* fall through to legacy folder */ }
  try {
    const sketchesDir = await getSketchesDir()
    const folder = await _findFolderById(sketchesDir, id)
    if (folder) {
      const sketchPath = await join(folder, 'sketch.json')
      if (await exists(sketchPath)) return JSON.parse(await readTextFile(sketchPath))
    }
  } catch (err) { console.debug('[Gnos] loadSketchbookContent named folder failed', err) }
  return getJSON(`sketchbook_${id}`, null)
}

// sketchbookOrId can be a full sketchbook object (preferred) or just an id string (legacy)
export async function saveSketchbookContent(sketchbookOrId, data) {
  const id = typeof sketchbookOrId === 'string' ? sketchbookOrId : sketchbookOrId?.id
  let sb = typeof sketchbookOrId === 'object' ? sketchbookOrId : null
  if (!sb) {
    try { sb = window.__appStore?.getState?.()?.sketchbooks?.find(s => s.id === id) || null } catch { /* no store */ }
  }

  try {
    const sketchesDir = await getSketchesDir()
    const idx = await loadSketchesIndex()

    // ── FLAT sketchbook — write straight to its file, update the index ──
    if (idx[id]) {
      const entry = idx[id]
      let fileName = entry.file
      if (sb?.title) {
        // `file` is archive-relative — rename only the basename, keeping the
        // sketchbook inside whatever collection folder it currently lives in.
        const { dir: curDir, name: curName } = _splitSkPath(fileName)
        const desiredBase = sanitizeFolderName(sb.title) || id
        const curBase = curName.replace(/\.excalidraw$/i, '')
        if (desiredBase.toLowerCase() !== curBase.toLowerCase()) {
          const existingEntries = await readDir(await _resolveSkDir(curDir)).catch(() => [])
          const taken = new Set(existingEntries.map(e => e.name?.toLowerCase()).filter(Boolean))
          taken.delete(curName.toLowerCase())
          let nn = `${desiredBase}.excalidraw`, k = 2
          while (taken.has(nn.toLowerCase())) nn = `${desiredBase} ${k++}.excalidraw`
          try {
            const oldP = await _resolveSkPath(fileName)
            const newP = await _resolveSkPath(`${curDir}/${nn}`)
            if ((await exists(oldP)) && !(await exists(newP))) { await rename(oldP, newP); fileName = `${curDir}/${nn}` }
          } catch { /* keep old name */ }
        }
      }
      const p = await _resolveSkPath(fileName)
      await writeTextFile(p, JSON.stringify(data))
      await _patchSkIndex(id, sb ? { ...sb, file: fileName } : { file: fileName })
      return true
    }

    // ── Legacy folder-format (not yet migrated) ──
    const existingFolder = await _findFolderById(sketchesDir, id)
    if (existingFolder) {
      if (sb) await writeTextFile(await join(existingFolder, 'meta.json'), JSON.stringify(sb, null, 2))
      await writeTextFile(await join(existingFolder, 'sketch.json'), JSON.stringify(data))
      return true
    }

    // ── New sketchbook — create it FLAT ──
    const entries = await readDir(sketchesDir).catch(() => [])
    const takenLower = new Set(entries.map(e => e.name?.toLowerCase()).filter(Boolean))
    const fileName = _flatSketchFileName(sb?.title || id, id, takenLower)
    const p = await join(sketchesDir, fileName)
    await writeTextFile(p, JSON.stringify(data))
    const base = sb ?? { id, title: id }
    await _patchSkIndex(id, { ...base, id, file: fileName })
    return true
  } catch (err) { console.error('[Gnos] saveSketchbookContent failed', err) }
  return setJSON(`sketchbook_${id}`, data)
}

export async function deleteSketchbookContent(id) {
  try {
    const idx = await loadSketchesIndex()
    if (idx[id]?.file) {
      const p = await _resolveSkPath(idx[id].file)
      if (await exists(p)) await remove(p)
      await _removeSkIndex(id)
      return storage.delete(`sketchbook_${id}`)
    }
  } catch (err) { console.debug('[Gnos] deleteSketchbookContent index error', err) }
  try {
    const sketchesDir = await getSketchesDir()
    const folder = await _findFolderById(sketchesDir, id)
    if (folder) {
      const folderEntries = await readDir(folder)
      for (const f of folderEntries) {
        if (f.name) await remove(await join(folder, f.name))
      }
      try { await remove(folder) } catch { /* not empty */ }
    }
  } catch (err) { console.debug('[Gnos] deleteSketchbookContent error', err) }
  return storage.delete(`sketchbook_${id}`)
}

/**
 * Flatten step 2 — convert legacy folder sketchbooks (`<Title>_<id>/{meta.json,
 * sketch.json}`) to flat `sketches/<Title>.excalidraw` + a central index entry.
 * Excalidraw scenes are always self-contained (pasted images live as base64 in
 * the scene's own `files` map), so — unlike notebooks — every sketchbook can
 * flatten; there's no "keep the folder because of attachments" case.
 * Old folders go to the OS Trash (recoverable), never removed outright.
 * Runs once (guarded by `sk_flat_migrated`).
 */
export async function migrateSketchbooksToFlat() {
  try {
    if (await _migrationDone('sk_flat_migrated')) return { migrated: 0, skipped: true }
    const sketchesDir = await getSketchesDir()
    const entries = await readDir(sketchesDir)
    const idx = await loadSketchesIndex()
    const takenLower = new Set()
    for (const e of entries) { if (e.name) takenLower.add(e.name.toLowerCase()) }
    for (const k of Object.keys(idx)) { if (idx[k]?.file) takenLower.add(idx[k].file.toLowerCase()) }

    const trashFolders = []
    let migrated = 0
    for (const e of entries) {
      if (!e.name || e.name.startsWith('.')) continue
      const folder = await join(sketchesDir, e.name)
      const sub = await readDir(folder).catch(() => null)
      if (!Array.isArray(sub)) continue // not a directory
      const metaEntry = sub.find(f => f.name === 'meta.json')
      if (!metaEntry) continue // not a sketchbook folder
      let meta
      try { meta = JSON.parse(await readTextFile(await join(folder, 'meta.json'))) } catch { continue }
      if (!meta?.id) continue
      if (idx[meta.id]) continue // already flattened in a prior (interrupted) run — skip
      const sketchEntry = sub.find(f => f.name === 'sketch.json')
      const data = sketchEntry ? await readTextFile(await join(folder, 'sketch.json')).catch(() => null) : null
      if (data == null) continue // no content to preserve — leave the folder for manual review
      const fileName = _flatSketchFileName(meta.title || e.name, meta.id, takenLower)
      const flatPath = await join(sketchesDir, fileName)
      await writeTextFile(flatPath, data)
      idx[meta.id] = { ...meta, file: fileName }
      trashFolders.push(folder)
      migrated++
    }
    if (migrated) {
      // ATOMICITY: only trash the source folders once the index that replaces
      // them is safely persisted (same lesson as the notebooks flatten, A52).
      const indexOk = await saveSketchesIndex(idx)
      if (!indexOk) {
        console.warn('[Gnos] sketchbook flatten: index did not persist — keeping folders, will retry next launch')
        return { migrated: 0, error: 'index-write-failed' }
      }
      if (trashFolders.length) {
        try { await invoke('move_to_trash', { paths: trashFolders }) }
        catch (err) {
          console.warn('[Gnos] sketchbook flatten: old folders → OS trash failed, leaving them in place', err)
          // Leaving the folders is safe — load prefers the index entry when both exist.
        }
      }
    }
    await _markMigrationDone('sk_flat_migrated')
    return { migrated }
  } catch (err) { console.warn('[Gnos] migrateSketchbooksToFlat failed', err); return { migrated: 0 } }
}

// ── Calendar events ───────────────────────────────────────────────────────────

export async function loadCalendarEvents() {
  return getJSON('calendar_events', [])
}

export async function saveCalendarEvents(events) {
  return setJSON('calendar_events', events)
}

// ── Kanban boards ─────────────────────────────────────────────────────────────

export async function loadKanbanBoards() {
  return getJSON('kanban_boards', null)
}

export async function saveKanbanBoards(boards) {
  return setJSON('kanban_boards', boards)
}

// Migration: create named folders for sketchbooks that only exist as flat JSON files
export async function migrateSketchbooksToFolders(sketchbooks) {
  if (!sketchbooks?.length) return
  // Only for the OLDEST keyed-store shape — never re-folder anything already
  // flat-indexed. Same bug class A53 already fixed for
  // `migrateNotebooksToFolders`; missing here let a race in the orphan-adopt
  // self-heal (see loadSketchbooksMeta) turn transient phantom entries into
  // real duplicate folders on disk every launch (A88).
  const idx = await loadSketchesIndex()
  for (const sb of sketchbooks) {
    if (idx[sb.id]) continue
    try {
      const dir = await getSketchDir(sb)
      await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(sb, null, 2))
      const sketchPath = await join(dir, 'sketch.json')
      if (!(await exists(sketchPath))) {
        const raw = await getJSON(`sketchbook_${sb.id}`, null)
        if (raw) await writeTextFile(sketchPath, JSON.stringify(raw, null, 2))
      }
    } catch (err) {
      console.warn('[Gnos] migrateSketchbooksToFolders failed for', sb.id, err)
    }
  }
}
// ── Plugin helpers ────────────────────────────────────────────────────────────

/** Returns the absolute path to the plugins directory. */
export async function getPluginsDir() {
  const base = await getBaseDir()
  return join(base, 'plugins')
}
