import { readTextFile, writeTextFile, writeFile, remove, readDir, exists, mkdir } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

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
  if (key.startsWith('book_') || key.startsWith('library'))            return 'books'
  if (key.startsWith('notebook_') || key.startsWith('notebooks_'))     return 'notebooks'
  if (key.startsWith('sketchbook_') || key.startsWith('sketchbooks_')) return 'sketches'
  if (key.startsWith('audiochap_') || key.startsWith('audiodata_') || key.startsWith('audiochaps_')) return 'audio'
  return ''
}

async function keyToPath(key) {
  const base = await getBaseDir()
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  const subfolder = getSubfolder(key)

  if (subfolder) {
    const subPath = await join(base, subfolder)
    const subExists = await exists(subPath)
    if (!subExists) await mkdir(subPath, { recursive: true })
    return await join(subPath, `${safe}.json`)
  }

  return await join(base, `${safe}.json`)
}

// ── Core storage API ──────────────────────────────────────────────────────────

const storage = {
  async get(key) {
    try {
      const filePath = await keyToPath(key)
      const fileExists = await exists(filePath)
      if (!fileExists) return null
      const value = await readTextFile(filePath)
      return { key, value }
    } catch { return null }
  },

  async set(key, value) {
    try {
      const filePath = await keyToPath(key)
      const str = typeof value === 'string' ? value : JSON.stringify(value)
      await writeTextFile(filePath, str)
      return true
    } catch (err) {
      console.error(`storage.set(${key}) failed:`, err)
      return false
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

      const subfolders = ['books', 'notebooks', 'sketches', 'audio']
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

// ── Trash system ──────────────────────────────────────────────────────────────

async function getTrashDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'trash')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

export async function moveToTrash(type, id, title) {
  try {
    const trashDir = await getTrashDir()
    const timestamp = new Date().toISOString()
    const safeName = (title || id).replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 80)
    const trashEntry = await join(trashDir, `${type}_${safeName}_${Date.now()}`)
    await mkdir(trashEntry, { recursive: true })
    // Write a manifest so we know what this trash item is
    await writeTextFile(await join(trashEntry, '_trash_meta.json'), JSON.stringify({
      type, id, title, deletedAt: timestamp,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, null, 2))
    return trashEntry
  } catch (err) {
    console.warn('[Gnos] moveToTrash failed:', err)
    return null
  }
}

export async function cleanupTrash() {
  try {
    const trashDir = await getTrashDir()
    const entries = await readDir(trashDir)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(trashDir, entry.name, '_trash_meta.json')
      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.expiresAt && new Date(meta.expiresAt).getTime() < now) {
            // Expired — permanently delete
            const entryPath = await join(trashDir, entry.name)
            const files = await readDir(entryPath)
            for (const f of files) {
              if (f.name) await remove(await join(entryPath, f.name))
            }
            try { await remove(entryPath) } catch { /* not empty */ }
          }
        } catch { /* skip corrupt */ }
      }
    }
  } catch (err) { console.debug('[Gnos] cleanupTrash error:', err) }
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

// ── Library ───────────────────────────────────────────────────────────────────

export async function loadLibrary() {
  return getJSON('library', [])
}

export async function saveLibrary(library) {
  return setJSON('library', library)
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
  const dir = await join(notebooksDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

export async function loadNotebooksMeta() {
  // First try to reconstruct from on-disk named folders
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    const metas = []
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath))
          metas.push(meta)
        } catch { /* skip corrupt meta */ }
      }
    }
    if (metas.length > 0) {
      return metas.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    }
  } catch { /* fall through to flat file */ }
  return getJSON('notebooks_meta', [])
}

export async function saveNotebooksMeta(notebooks) {
  // Persist meta.json inside each notebook's folder
  for (const nb of notebooks) {
    try {
      const dir = await getNotebookDir(nb)
      await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(nb, null, 2))
    } catch (err) {
      console.warn('[Gnos] saveNotebooksMeta folder write failed for', nb.id, err)
    }
  }
  // Also keep the flat index for quick cold-start
  return setJSON('notebooks_meta', notebooks)
}

export async function loadNotebookContent(id) {
  // Try named folder first
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

export async function saveNotebookContent(notebookOrId, content) {
  const id = typeof notebookOrId === 'string' ? notebookOrId : notebookOrId?.id
  const notebook = typeof notebookOrId === 'object' ? notebookOrId : null
  const mdContent = typeof content === 'string' ? content : (content?.content ?? '')
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    // Try to find existing folder by id
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(notebooksDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const mdPath = await join(notebooksDir, entry.name, `${entry.name}.md`)
          await writeTextFile(mdPath, mdContent)
          return true
        }
      }
    }
    // No folder yet — create one using notebook object or id as name
    const folderName = sanitizeFolderName(notebook?.title || id)
    const dir = await join(notebooksDir, folderName)
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
    const metaToWrite = notebook ?? { id, title: folderName }
    await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(metaToWrite, null, 2))
    const mdPath = await join(dir, `${folderName}.md`)
    await writeTextFile(mdPath, mdContent)
    return true
  } catch (err) { console.debug('[Gnos] saveNotebookContent named folder failed', err) }
  return setJSON(`notebook_${id}`, content)
}

/** Save an image (Uint8Array) into the notebook's images/ subfolder.
 *  Returns the relative markdown path: `./images/filename` */
export async function saveNotebookImage(notebookId, filename, data) {
  try {
    const notebooksDir = await getNotebooksDir()
    const entries = await readDir(notebooksDir)
    for (const entry of entries) {
      if (!entry.name) continue
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

// Migration: create named folders for notebooks that only exist as flat JSON files
export async function migrateNotebooksToFolders(notebooks) {
  if (!notebooks?.length) return
  for (const nb of notebooks) {
    try {
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

function bookFolderName(book) {
  const author = book.author?.trim() || ''
  const title  = book.title?.trim()  || book.id
  const name   = author ? `${author} - ${title}` : title
  return sanitizeFolderName(name)
}

async function getBooksDir() {
  const base = await getBaseDir()
  const booksDir = await join(base, 'books')
  if (!(await exists(booksDir))) await mkdir(booksDir, { recursive: true })
  return booksDir
}

async function getBookDir(book) {
  const booksDir = await getBooksDir()
  const folderName = bookFolderName(book)
  const bookDir = await join(booksDir, folderName)
  if (!(await exists(bookDir))) await mkdir(bookDir, { recursive: true })
  return bookDir
}

// Save book content into named folder.
// `book` must be the full book object so we can name the folder.
export async function saveBookContent(book, chapters) {
  // Legacy signature: saveBookContent(id, chapters)
  if (typeof book === 'string') {
    return _saveLegacyBookContent(book, chapters)
  }

  const bookDir = await getBookDir(book)

  // Write content
  await writeTextFile(await join(bookDir, 'content.json'), JSON.stringify(chapters))

  // Write meta (strip large binary fields)
  // eslint-disable-next-line no-unused-vars
  const { coverDataUrl, pdfDataUrl, rawDataUrl, ...meta } = book
  await writeTextFile(await join(bookDir, 'meta.json'), JSON.stringify(meta, null, 2))
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

// Load book content. Tries named folder first, then legacy flat files.
export async function loadBookContent(bookOrId) {
  const id = typeof bookOrId === 'string' ? bookOrId : bookOrId?.id

  // 1. Named folder — look up by id in meta.json
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
          if (await exists(contentPath)) {
            return JSON.parse(await readTextFile(contentPath))
          }
        }
      }
    }
  } catch (err) { console.debug('[Gnos] named folder lookup failed, trying legacy', err) }

  // 2. Legacy flat-file format
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

// Delete book content — removes named folder and any legacy flat files.
export async function deleteBookContent(book) {
  const id = typeof book === 'string' ? book : book?.id

  // Remove named folder
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

// ── Migration: flat files → named folders ─────────────────────────────────────
//
// Call this once on app startup (after library loads).
// Reads legacy flat JSON files and rewrites them into Author - Title/ folders.

export async function migrateBooksToNamedFolders(library) {
  if (!library || library.length === 0) return

  for (const book of library) {
    // Skip audiobooks — they don't use book content storage
    if (book.format === 'mp3' || book.format === 'm4b' || book.format === 'audiofolder') continue

    // Check if already migrated
    let alreadyMigrated = false
    try {
      const booksDir = await getBooksDir()
      const entries = await readDir(booksDir)
      for (const entry of entries) {
        if (!entry.name) continue
        const metaPath = await join(booksDir, entry.name, 'meta.json')
        if (await exists(metaPath)) {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.id === book.id) { alreadyMigrated = true; break }
        }
      }
    } catch (err) { console.debug('[Gnos] migration check error', err) }

    if (alreadyMigrated) continue

    // Load chapters from legacy flat files
    const chapters = await loadBookContent(book.id)
    if (!chapters) continue

    // Write into named folder
    try {
      await saveBookContent(book, chapters)

      // Clean up legacy files
      await storage.delete(`book_${book.id}_data`)
      await storage.delete(`book_${book.id}_chunks`)
      for (let ci = 0; ci < 200; ci++) {
        const key = `book_${book.id}_chunk_${ci}`
        const filePath = await keyToPath(key)
        if (!(await exists(filePath))) break
        await remove(filePath)
      }

      console.log(`[Gnos] Migrated: ${bookFolderName(book)}`)
    } catch (err) {
      console.warn(`[Gnos] Migration failed for ${book.id}:`, err)
    }
  }
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
//     meta.json        — book metadata (title, author, format, chapters list, …)
//     chapter_<n>.bin  — raw audio bytes for multi-chapter audiobooks (future)
//
// Audio binary data is currently stored as base64 data-URL strings under the
// flat keys audiodata_<id> / audiochap_<id>_<n> because writing binary files
// requires Tauri's writeBinaryFile API which is gated on separate permissions.
// The meta.json folder is written on every save so the library is browsable
// on-disk even though the audio payload itself stays in the keyed store.

async function getAudioDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'audio')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function getAudioBookDir(book) {
  const audioDir = await getAudioDir()
  const folderName = sanitizeFolderName(bookFolderName(book))
  const dir = await join(audioDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

// Write a meta.json for an audiobook so the audio folder is human-readable.
export async function saveAudiobookMeta(book) {
  try {
    const dir = await getAudioBookDir(book)
    // Strip binary payload — only persist descriptive metadata
    // eslint-disable-next-line no-unused-vars
    const { coverDataUrl, ...meta } = book
    await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
  } catch (err) {
    console.warn('[Gnos] saveAudiobookMeta failed for', book?.id, err)
  }
}

export async function deleteAudiobookMeta(book) {
  try {
    const audioDir = await getAudioDir()
    const entries = await readDir(audioDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(audioDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === book.id) {
          const entryPath = await join(audioDir, entry.name)
          const folderEntries = await readDir(entryPath)
          for (const f of folderEntries) {
            if (f.name) await remove(await join(entryPath, f.name))
          }
          try { await remove(entryPath) } catch { /* not empty */ }
          break
        }
      }
    }
  } catch (err) { console.debug('[Gnos] deleteAudiobookMeta error', err) }
}

export async function loadAudioChapter(bookId, chapterIdx) {
  return storage.get(`audiochap_${bookId}_${chapterIdx}`)
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

export async function loadSingleAudioData(bookId) {
  return storage.get(`audiodata_${bookId}`)
}

// Migration: write meta.json folders for any audiobooks that don't have one yet.
export async function migrateAudiobooksToFolders(library) {
  if (!library?.length) return
  const audiobooks = library.filter(b => b.type === 'audio')
  for (const book of audiobooks) {
    try {
      const audioDir = await getAudioDir()
      // Check if already migrated
      const entries = await readDir(audioDir)
      let found = false
      for (const entry of entries) {
        if (!entry.name) continue
        const metaPath = await join(audioDir, entry.name, 'meta.json')
        if (await exists(metaPath)) {
          const meta = JSON.parse(await readTextFile(metaPath))
          if (meta.id === book.id) { found = true; break }
        }
      }
      if (!found) await saveAudiobookMeta(book)
    } catch (err) {
      console.warn('[Gnos] migrateAudiobooksToFolders failed for', book.id, err)
    }
  }
}

// ── Sketchbooks (named-folder format) ────────────────────────────────────────
//
// Folder layout:
//   archive/sketches/<Title>/
//     sketch.json    — Excalidraw scene data
//     meta.json      — { id, title, elementCount, createdAt, updatedAt, coverColor }
//
// Legacy flat-file: archive/sketches/sketchbook_<id>.json

async function getSketchesDir() {
  const base = await getBaseDir()
  const dir = await join(base, 'sketches')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function getSketchDir(sketchbook) {
  const sketchesDir = await getSketchesDir()
  const folderName = sanitizeFolderName(sketchbook.title || sketchbook.id)
  const dir = await join(sketchesDir, folderName)
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

export async function loadSketchbooksMeta() {
  try {
    const sketchesDir = await getSketchesDir()
    const entries = await readDir(sketchesDir)
    const metas = []
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(sketchesDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        try {
          const meta = JSON.parse(await readTextFile(metaPath))
          metas.push(meta)
        } catch { /* skip corrupt */ }
      }
    }
    if (metas.length > 0) {
      return metas.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    }
  } catch { /* fall through */ }
  return getJSON('sketchbooks_meta', [])
}

export async function saveSketchbooksMeta(sketchbooks) {
  for (const sb of sketchbooks) {
    try {
      const dir = await getSketchDir(sb)
      await writeTextFile(await join(dir, 'meta.json'), JSON.stringify(sb, null, 2))
    } catch (err) {
      console.warn('[Gnos] saveSketchbooksMeta folder write failed for', sb.id, err)
    }
  }
  return setJSON('sketchbooks_meta', sketchbooks)
}

export async function loadSketchbookContent(id) {
  try {
    const sketchesDir = await getSketchesDir()
    const entries = await readDir(sketchesDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(sketchesDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const sketchPath = await join(sketchesDir, entry.name, 'sketch.json')
          if (await exists(sketchPath)) {
            return JSON.parse(await readTextFile(sketchPath))
          }
          return null
        }
      }
    }
  } catch (err) { console.debug('[Gnos] loadSketchbookContent named folder failed', err) }
  return getJSON(`sketchbook_${id}`, null)
}

export async function saveSketchbookContent(id, data) {
  try {
    const sketchesDir = await getSketchesDir()
    const entries = await readDir(sketchesDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(sketchesDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const sketchPath = await join(sketchesDir, entry.name, 'sketch.json')
          // No pretty-printing — sketch files can be large (embedded images)
          await writeTextFile(sketchPath, JSON.stringify(data))
          return true
        }
      }
    }
  } catch (err) { console.debug('[Gnos] saveSketchbookContent named folder failed', err) }
  return setJSON(`sketchbook_${id}`, data)
}

export async function deleteSketchbookContent(id) {
  try {
    const sketchesDir = await getSketchesDir()
    const entries = await readDir(sketchesDir)
    for (const entry of entries) {
      if (!entry.name) continue
      const metaPath = await join(sketchesDir, entry.name, 'meta.json')
      if (await exists(metaPath)) {
        const meta = JSON.parse(await readTextFile(metaPath))
        if (meta.id === id) {
          const entryPath = await join(sketchesDir, entry.name)
          const folderEntries = await readDir(entryPath)
          for (const f of folderEntries) {
            if (f.name) await remove(await join(entryPath, f.name))
          }
          try { await remove(entryPath) } catch { /* not empty */ }
          break
        }
      }
    }
  } catch (err) { console.debug('[Gnos] deleteSketchbookContent error', err) }
  return storage.delete(`sketchbook_${id}`)
}

// Migration: create named folders for sketchbooks that only exist as flat JSON files
export async function migrateSketchbooksToFolders(sketchbooks) {
  if (!sketchbooks?.length) return
  for (const sb of sketchbooks) {
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