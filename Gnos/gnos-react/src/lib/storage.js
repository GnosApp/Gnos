// Thin wrapper around the claude.ai window.storage API.
// Falls back to localStorage when window.storage is not available (local dev / Vite).

const hasCloudStorage = () => typeof window !== 'undefined' && typeof window.storage?.get === 'function'

const localBackend = {
  async get(key) {
    try {
      const val = localStorage.getItem(`gnos:${key}`)
      return val !== null ? { key, value: val } : null
    } catch { return null }
  },
  async set(key, value) {
    try {
      const str = typeof value === 'string' ? value : JSON.stringify(value)
      // Audio data URLs can exceed 5MB — skip localStorage silently, rely on cloud storage
      if (str.length > 4_000_000) {
        console.info(`storage: skipping localStorage for "${key}" (${(str.length/1e6).toFixed(1)}MB) — use cloud storage`)
        return true // return true so callers don't show spurious errors
      }
      localStorage.setItem(`gnos:${key}`, str)
      return true
    } catch (err) {
      console.warn(`localStorage.set(${key}) failed:`, err)
      return false
    }
  },
  async delete(key) {
    try { localStorage.removeItem(`gnos:${key}`); return true }
    catch { return false }
  },
  async list(prefix = '') {
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(`gnos:${prefix}`)) keys.push(k.slice(5))
      }
      return keys
    } catch { return [] }
  },
}

const storage = {
  async get(key) {
    try {
      if (hasCloudStorage()) return await window.storage.get(key) ?? null
      return localBackend.get(key)
    } catch { return null }
  },
  async set(key, value) {
    try {
      if (hasCloudStorage()) { await window.storage.set(key, value); return true }
      return localBackend.set(key, value)
    } catch (err) {
      console.error(`storage.set(${key}) failed:`, err)
      return false
    }
  },
  async delete(key) {
    try {
      if (hasCloudStorage()) { await window.storage.delete(key); return true }
      return localBackend.delete(key)
    } catch { return false }
  },
  async list(prefix = '') {
    try {
      if (hasCloudStorage()) return (await window.storage.list(prefix))?.keys ?? []
      return localBackend.list(prefix)
    } catch { return [] }
  },
}

export default storage

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

// ── Notebooks ─────────────────────────────────────────────────────────────────

export async function loadNotebooksMeta() {
  return getJSON('notebooks_meta', [])
}

export async function saveNotebooksMeta(notebooks) {
  return setJSON('notebooks_meta', notebooks)
}

export async function loadNotebookContent(id) {
  return getJSON(`notebook_${id}`, '')
}

export async function saveNotebookContent(id, content) {
  return setJSON(`notebook_${id}`, content)
}

// ── Books ─────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 20
const MAX_SINGLE_CHARS = 900_000

export async function saveBookContent(id, chapters) {
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

export async function loadBookContent(id) {
  // Try chunked format first
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
  // Fallback: legacy single-key format
  const legacy = await storage.get(`book_${id}`)
  if (legacy) {
    const raw = legacy.value ?? legacy
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return null }
  }
  return null
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function loadPreferences() {
  return getJSON('app_prefs', null)
}

export async function savePreferences(prefs) {
  return setJSON('app_prefs', prefs)
}

// ── Audio ─────────────────────────────────────────────────────────────────────

export async function loadAudioChapter(bookId, chapterIdx) {
  return storage.get(`audiochap_${bookId}_${chapterIdx}`)
}

export async function saveAudioChapter(bookId, chapterIdx, dataUrl) {
  return storage.set(`audiochap_${bookId}_${chapterIdx}`, dataUrl)
}

export async function deleteAudiobook(book) {
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
// ── Sketchbooks ───────────────────────────────────────────────────────────────

export async function loadSketchbooksMeta() {
  return getJSON('sketchbooks_meta', [])
}

export async function saveSketchbooksMeta(sketchbooks) {
  return setJSON('sketchbooks_meta', sketchbooks)
}

export async function loadSketchbookContent(id) {
  return getJSON(`sketchbook_${id}`, null)
}

export async function saveSketchbookContent(id, data) {
  return setJSON(`sketchbook_${id}`, data)
}

export async function deleteSketchbookContent(id) {
  return storage.delete(`sketchbook_${id}`)
}