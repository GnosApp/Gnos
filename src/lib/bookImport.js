// ─────────────────────────────────────────────────────────────────────────────
// bookImport.js
// Import-time glue for books/audiobooks — parsing itself lives in
// epubParser.js (shared with storage.js, which regenerates a stale content
// cache from the kept .epub file; see A86).
// No DOM manipulation, no global state — returns data that the store consumes.
// ─────────────────────────────────────────────────────────────────────────────

import { openPdf } from '@/lib/pdfjs'
import { parseEpub } from '@/lib/epubParser'
import { saveBookContent, saveAudiobookMeta, writeAudioFile } from '@/lib/storage'
import { readFileAsDataURL } from '@/lib/utils'

// ── Book ID generator ─────────────────────────────────────────────────────────

function makeBookId(prefix = 'book') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ── importBooks — handles EPUB / PDF files ────────────────────────────────────
//
// .txt/.md are deliberately NOT handled here — those are notebook territory
// (open/edit them via `openExternalFile()`, useAppStore.js), not the e-reader.
// Keeping the reader to real ebook formats only means every book flattens to
// one real, portable file (`.pdf` or the parsed epub content) with nothing
// that overlaps what a notebook already does better (live editing, writing
// back to the original file).
//
// Returns { added: BookEntry[], errors: string[] }
// Caller is responsible for pushing to the store and persisting.

export async function importBooks(files) {
  const added  = []
  const errors = []

  for (const file of Array.from(files)) {
    if (file.name.startsWith('.')) continue
    const nameMatchesKnown = /\.(epub3?|pdf)$/i.test(file.name)
    const mimeIsEpub = /^application\/(epub\+zip|epub)$/i.test(file.type)
    const mimeIsKnown = /^application\/(pdf|zip|epub\+zip|epub)$/i.test(file.type)
    if (!nameMatchesKnown && !mimeIsEpub && !mimeIsKnown) continue

    try {
      const isEpub = /\.epub3?$/i.test(file.name) || mimeIsEpub
      let bookTitle, bookAuthor = '', chapters, format, coverDataUrl = null, pdfDataUrl = null, bookLanguage = '', epubBytes = null

      if (isEpub) {
        format = 'epub'
        const parsed = await parseEpub(file)
        bookTitle    = parsed.title
        bookAuthor   = parsed.author
        bookLanguage = parsed.language || ''
        chapters     = parsed.chapters
        coverDataUrl = parsed.coverDataUrl || null
        // Keep the real file — a File's arrayBuffer() re-reads the underlying
        // blob each call, so this is safe even though parseEpub already read
        // it once via JSZip. Portable, real, and (per A86) the epub itself is
        // now the source of truth: content.json becomes a disposable cache
        // re-derived from this file, not the only copy.
        epubBytes = new Uint8Array(await file.arrayBuffer())
      } else {
        format      = 'pdf'
        bookTitle   = file.name.replace(/\.pdf$/i, '').replace(/[_-]/g, ' ').trim()
        pdfDataUrl  = await readFileAsDataURL(file)
        // Minimal placeholder chapters — actual rendering done by PdfView
        chapters    = [{ title: bookTitle, blocks: [{ type: 'para', text: bookTitle }] }]
        // Generate cover thumbnail from first page
        try {
          const pdfDoc = await openPdf({ url: pdfDataUrl })
          const firstPage = await pdfDoc.getPage(1)
          const rawVp = firstPage.getViewport({ scale: 1 })
          const dpr = window.devicePixelRatio || 1
          const thumbScale = Math.min(280 / rawVp.width, 380 / rawVp.height) * dpr
          const thumbVp = firstPage.getViewport({ scale: thumbScale })
          const offscreen = document.createElement('canvas')
          offscreen.width  = thumbVp.width
          offscreen.height = thumbVp.height
          const octx = offscreen.getContext('2d')
          await firstPage.render({ canvas: offscreen, canvasContext: octx, viewport: thumbVp }).promise
          coverDataUrl = offscreen.toDataURL('image/jpeg', 0.9)
          pdfDoc.destroy()
        } catch { /* non-fatal — cover stays null */ }
      }

      const id = makeBookId('book')
      const bookEntry = {
        id, title: bookTitle, author: bookAuthor, format,
        language: bookLanguage || null,
        totalChapters: chapters.length,
        currentChapter: 0, currentPage: 0,
        addedAt: new Date().toISOString(),
        hasAudio: false,
        coverDataUrl: coverDataUrl || null,
        pdfDataUrl: pdfDataUrl || null,
      }
      await saveBookContent(bookEntry, chapters, epubBytes)
      added.push(bookEntry)
    } catch (err) {
      console.error('Book import error:', err)
      errors.push(`"${file.name}" — ${err.message || 'unknown error'}`)
    }
  }
  return { added, errors }
}

// ── importAudioFile — single standalone audio file ────────────────────────────

export async function importAudioFile(file) {
  if (!/\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i.test(file.name) && !file.type.startsWith('audio/')) {
    throw new Error('Not a supported audio format')
  }
  const ext   = file.name.split('.').pop().toLowerCase()
  const id    = makeBookId('audio')
  const title = file.name
    .replace(/\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i, '')
    .replace(/[_-]/g, ' ')
    .trim()

  const book = {
    id, title, author: '', type: 'audio', format: 'audio',
    audioExt: ext, hasAudio: true,
    totalChapters: 1, currentChapter: 0, currentPage: 0,
    addedAt: new Date().toISOString(),
    coverDataUrl: null,
  }

  // Write raw audio bytes directly to disk — no base64 overhead
  const bytes = new Uint8Array(await file.arrayBuffer())
  await writeAudioFile(book, `audio.${ext}`, bytes)
  await saveAudiobookMeta(book)
  return book
}

// ── importAudioFolder — folder of chapter files → one multi-chapter entry ─────

export async function importAudioFolder(files) {
  const audioFiles = Array.from(files)
    .filter(f => /\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  if (!audioFiles.length) throw new Error('No audio files found in folder')

  const folderName = audioFiles[0].webkitRelativePath
    ? audioFiles[0].webkitRelativePath.split('/')[0]
    : audioFiles[0].name.replace(/\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i, '')

  const id = makeBookId('audio')

  // Build book object first so writeAudioFile can resolve the folder path
  const book = {
    id,
    title: folderName, author: '', type: 'audio', format: 'audiofolder',
    audioChapters: [],
    hasAudio: true, totalChapters: audioFiles.length,
    currentChapter: 0, currentPage: 0,
    addedAt: new Date().toISOString(),
    coverDataUrl: null,
  }

  const chapters = []
  for (let i = 0; i < audioFiles.length; i++) {
    const file  = audioFiles[i]
    const ext   = file.name.split('.').pop().toLowerCase()
    const chapterTitle = file.name
      .replace(/\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i, '')
      .replace(/[_-]/g, ' ')
      .trim()
    // Write raw bytes directly — no base64 overhead
    const bytes = new Uint8Array(await file.arrayBuffer())
    await writeAudioFile(book, `chapter_${i}.${ext}`, bytes)
    chapters.push({ title: chapterTitle, index: i, ext })
  }

  book.audioChapters = chapters
  await saveAudiobookMeta(book)
  return book
}