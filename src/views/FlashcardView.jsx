/* FlashcardView.jsx — Anki/Quizlet-style spaced repetition flashcard view
 *
 * Two modes: Study and List
 * - Study: quiz one card at a time, in one of three studyModes (per-deck,
 *   persisted): 'flip' (flip + manual Again/Hard/Good/Easy), 'choice'
 *   (multiple choice, auto-graded), 'type' (typed answer, auto-graded).
 * - List: every card as an editable term/definition row, add/delete/edit
 *   inline — also the only place cards are added/removed now (the old
 *   single-card "Edit" viewport was removed as redundant with this).
 */

import { useState, useEffect, useMemo, useRef, useCallback, useContext } from 'react'
import useAppStore from '@/store/useAppStore'
import QuickAccess from '@/components/QuickAccess'
import { PaneContext } from '@/lib/PaneContext'
import { useIsMobile } from '@/lib/useIsMobile'
import { saveNotebookImage } from '@/lib/storage'
import JSZip from 'jszip'
import initSqlJs from 'sql.js/dist/sql-asm.js'
import { Check, Keyboard, Layers, ListChecks, Pause, Play, Plus, Share, SquareArrowLeft, SquareArrowRight, X } from 'lucide-react'

// ─── SM-2 Algorithm ──────────────────────────────────────────────────────────
function sm2(card, quality) {
  const q = [0, 0, 2, 3, 5][quality] ?? 3
  let { interval = 1, ease = 2.5, repetitions = 0 } = card
  if (q < 3) {
    repetitions = 0; interval = 1
  } else {
    repetitions++
    if (repetitions === 1) interval = 1
    else if (repetitions === 2) interval = 6
    else interval = Math.round(interval * ease)
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)))
  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000
  return { ...card, interval, ease, repetitions, nextReview }
}

// ─── Tiny id helper ──────────────────────────────────────────────────────────
function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── CSS ─────────────────────────────────────────────────────────────────────
const FLASHCARD_CSS = `
  .fc-container {
    display: flex; flex-direction: column; height: 100%;
    background: var(--bg); color: var(--text); overflow: hidden;
  }
  .fc-footer {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 18px; border-top: 1px solid var(--borderSubtle);
    background: var(--surface);
    border-radius: 12px 12px 0 0;
    flex-shrink: 0;
  }
  .fc-mode-btn {
    padding: 5px 14px; border-radius: 6px; border: 1px solid var(--border);
    background: none; color: var(--textDim); cursor: pointer;
    font-size: 12px; font-weight: 600; font-family: inherit;
    transition: all 0.12s;
  }
  .fc-mode-btn.active {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }
  .fc-mode-btn:hover:not(.active) {
    background: var(--surfaceAlt); color: var(--text);
  }
  .fc-stats {
    font-size: 11px; color: var(--textDim); display: flex; gap: 12px;
  }
  .fc-stats span { font-weight: 600; }

  /* Study mode */
  .fc-study {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 32px; gap: 24px; overflow-y: auto;
  }
  .fc-card-wrapper {
    perspective: 1000px; width: 100%; max-width: 500px;
    aspect-ratio: 5/3; cursor: pointer;
  }
  .fc-card-inner {
    position: relative; width: 100%; height: 100%;
    transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    transform-style: preserve-3d;
  }
  .fc-card-inner.flipped { transform: rotateY(180deg); }
  .fc-card-face {
    position: absolute; inset: 0;
    backface-visibility: hidden; -webkit-backface-visibility: hidden;
    display: flex; align-items: center; justify-content: center;
    padding: 24px; border-radius: 16px;
    font-size: 18px; font-weight: 500; text-align: center;
    line-height: 1.5; word-break: break-word;
    font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    border: 1px solid var(--border);
  }
  .fc-card-front {
    background: var(--surface);
    color: var(--text);
  }
  .fc-card-back {
    background: var(--surfaceAlt);
    color: var(--text);
    transform: rotateY(180deg);
  }
  .fc-card-label {
    position: absolute; top: 10px; left: 14px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--textDim); opacity: 0.6;
    display: flex; align-items: center; gap: 5px;
  }
  .fc-card-color-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; opacity: 1; }
  .fc-card-html {
    max-width: 100%; overflow-wrap: break-word; text-align: center;
    line-height: 1.5;
  }
  .fc-card-html img {
    max-width: 100%; max-height: 120px; object-fit: contain;
    border-radius: 6px; display: block; margin: 8px auto 0;
  }
  .fc-rating-bar {
    display: flex; gap: 10px;
  }
  .fc-rate-btn {
    padding: 8px 20px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer;
    font-size: 13px; font-weight: 600; font-family: inherit;
    transition: all 0.12s; min-width: 70px;
  }
  .fc-rate-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
  .fc-rate-btn.again { border-color: #f85149; color: #f85149; }
  .fc-rate-btn.again:hover { background: rgba(248,81,73,0.1); }
  .fc-rate-btn.hard { border-color: #ff9800; color: #ff9800; }
  .fc-rate-btn.hard:hover { background: rgba(255,152,0,0.1); }
  .fc-rate-btn.good { border-color: #4caf50; color: #4caf50; }
  .fc-rate-btn.good:hover { background: rgba(76,175,80,0.1); }
  .fc-rate-btn.easy { border-color: #2196f3; color: #2196f3; }
  .fc-rate-btn.easy:hover { background: rgba(33,150,243,0.1); }
  .fc-hint-text {
    font-size: 12px; color: var(--textDim); opacity: 0.7;
  }
  /* Reserved height for the flip card's hint-text/rating-bar row, so
     flipping doesn't change .fc-study's total content height and shift
     the centered card up/down — see the JSX comment at its usage. */
  .fc-flip-action-row {
    min-height: 42px; display: flex; align-items: center; justify-content: center;
  }
  .fc-done-msg {
    text-align: center; color: var(--textDim);
  }
  .fc-done-msg h3 { font-size: 20px; margin: 0 0 8px; color: var(--text); }
  .fc-done-msg p { font-size: 13px; }

  /* Study mode — per-deck mode toggle (flip / choice / type) */
  .fc-study-mode-toggle {
    display: flex; gap: 2px; background: var(--surfaceAlt);
    border-radius: 7px; padding: 2px;
  }
  .fc-study-mode-btn {
    padding: 5px 9px; border-radius: 5px; border: none; background: none;
    color: var(--textDim); cursor: pointer; font-family: inherit;
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; font-weight: 600; transition: all 0.12s;
  }
  .fc-study-mode-btn.active { background: var(--surface); color: var(--text); }
  .fc-study-mode-btn:hover:not(.active) { color: var(--text); }

  /* Study mode — static (non-flip) question card for choice/type modes */
  .fc-static-card { position: relative; width: 100%; max-width: 500px; aspect-ratio: 5/3; }

  /* Study mode — multiple choice */
  .fc-choice-list { display: flex; flex-direction: column; gap: 10px; width: 100%; max-width: 500px; }
  .fc-choice-btn {
    display: flex; align-items: center; gap: 10px; padding: 12px 16px;
    border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
    color: var(--text); font-size: 14px; font-family: inherit; cursor: pointer;
    text-align: left; transition: border-color 0.12s, background 0.12s;
  }
  .fc-choice-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--surfaceAlt); }
  .fc-choice-btn:disabled { cursor: default; }
  .fc-choice-btn.correct { border-color: #4caf50; background: rgba(76,175,80,0.12); color: #4caf50; }
  .fc-choice-btn.incorrect { border-color: #f85149; background: rgba(248,81,73,0.12); color: #f85149; }
  .fc-choice-num {
    width: 20px; height: 20px; border-radius: 50%; background: var(--surfaceAlt);
    color: var(--textDim); font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .fc-choice-btn.correct .fc-choice-num, .fc-choice-btn.incorrect .fc-choice-num { background: transparent; }

  /* Study mode — typed answer */
  .fc-type-input-row { display: flex; gap: 8px; width: 100%; max-width: 500px; }
  .fc-type-input {
    flex: 1; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 14px;
    font-family: inherit; outline: none;
  }
  .fc-type-input:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
  .fc-type-input:disabled { opacity: 0.6; }
  .fc-type-submit {
    padding: 10px 18px; border-radius: 10px; border: none; background: var(--accent);
    color: #fff; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer;
  }
  .fc-type-submit:disabled { opacity: 0.4; cursor: default; }
  .fc-type-feedback {
    width: 100%; max-width: 500px; padding: 12px 16px; border-radius: 10px;
    font-size: 13px; display: flex; flex-direction: column; gap: 4px;
  }
  .fc-type-feedback.correct { background: rgba(76,175,80,0.12); color: #4caf50; }
  .fc-type-feedback.incorrect { background: rgba(248,81,73,0.12); color: #f85149; }
  .fc-type-feedback .fc-type-answer { color: var(--text); font-weight: 600; }
  .fc-continue-btn {
    padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border);
    background: none; color: var(--textDim); font-size: 12px; font-family: inherit;
    cursor: pointer;
  }
  .fc-continue-btn:hover { color: var(--text); border-color: var(--accent); }

  .fc-add-btn {
    width: 100%; padding: 10px; border: 1px dashed var(--border);
    border-radius: 10px; background: none; color: var(--textDim);
    cursor: pointer; font-size: 13px; font-family: inherit;
    transition: all 0.12s; margin-top: 4px;
  }
  .fc-add-btn:hover { border-color: var(--accent); color: var(--accent); }

  .fc-tool-btn {
    padding: 3px 8px; border-radius: 5px; border: 1px solid var(--borderSubtle);
    background: none; color: var(--textDim); cursor: pointer; font-size: 10px;
    font-family: inherit; transition: all 0.1s; display: flex; align-items: center; gap: 4px;
  }
  .fc-tool-btn:hover { background: var(--surfaceAlt); color: var(--text); border-color: var(--border); }
  .fc-color-dot {
    width: 14px; height: 14px; border-radius: 50%; cursor: pointer;
    border: 2px solid transparent; transition: border-color 0.1s;
  }
  .fc-color-dot:hover, .fc-color-dot.active { border-color: var(--text); }
  .fc-audio-row {
    display: flex; align-items: center; gap: 8px; margin-top: 4px;
  }
  .fc-audio-play {
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.12s; flex-shrink: 0;
  }
  .fc-audio-play:hover { background: var(--surfaceAlt); border-color: var(--accent); }
  .fc-audio-label { font-size: 10px; color: var(--textDim); }
  .fc-audio-remove {
    background: none; border: none; color: var(--textDim); cursor: pointer;
    display: inline-flex; align-items: center;
    opacity: 0.5; padding: 2px 4px;
  }
  .fc-audio-remove:hover { opacity: 1; color: #f85149; }

  /* List mode — Quizlet create-set inspired: numbered row, term/definition
     side by side, caption labels below each field (not above). Visual
     rhythm only — no colors/layout copied, just the same typographic
     hierarchy (bigger field text, small tracked captions underneath). */
  .fc-list {
    flex: 1; overflow-y: auto; padding: 20px 22px;
  }
  .fc-list-row {
    padding: 16px; border-radius: 12px;
    border: 1px solid var(--borderSubtle);
    margin-bottom: 10px; background: var(--surface);
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .fc-list-row:hover { border-color: var(--border); box-shadow: 0 2px 10px rgba(0,0,0,0.18); }
  .fc-list-row-hdr {
    display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
  }
  .fc-list-num {
    font-size: 13px; font-weight: 700; color: var(--textDim); min-width: 18px;
  }
  .fc-list-badge {
    font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 5px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .fc-list-badge.new { background: rgba(33,150,243,0.15); color: #2196f3; }
  .fc-list-badge.due { background: rgba(255,152,0,0.18); color: #ff9800; }
  .fc-list-badge.learned { background: rgba(76,175,80,0.15); color: #4caf50; }
  .fc-list-due-date {
    font-size: 10px; color: var(--textDim);
  }
  .fc-list-color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .fc-list-del {
    background: none; border: none; color: var(--textDim); cursor: pointer;
    padding: 5px 6px; border-radius: 5px; opacity: 0; transition: opacity 0.12s;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  }
  .fc-list-row:hover .fc-list-del { opacity: 0.4; }
  .fc-list-del:hover { opacity: 1 !important; color: #f85149; }
  .fc-list-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 20px;
  }
  @media (max-width: 620px) {
    .fc-list-grid { grid-template-columns: 1fr; }
  }
  .fc-list-col { min-width: 0; display: flex; flex-direction: column; }
  .fc-list-field {
    width: 100%; padding: 8px 0; border: none; border-bottom: 1px solid var(--borderSubtle);
    background: transparent;
    color: var(--text); font-size: 16px; font-family: inherit;
    outline: none; resize: none; line-height: 1.5;
    overflow: hidden; box-sizing: border-box;
    transition: border-color 0.1s;
  }
  .fc-list-field:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
  .fc-list-field::placeholder { color: var(--textDim); opacity: 0.5; }
  .fc-list-field-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--textDim); padding-top: 5px;
  }
  .fc-list-col-tools { display: flex; align-items: center; gap: 4px; margin-top: 8px; flex-wrap: wrap; }
  .fc-list-img { max-height: 64px; border-radius: 7px; object-fit: contain; margin-top: 8px; }
  .fc-list-section {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--textDim);
    padding: 16px 4px 8px; display: flex; align-items: center; gap: 8px;
  }
  .fc-list-section::after { content: ''; flex: 1; height: 1px; background: var(--borderSubtle); }
`

const CARD_COLORS = ['transparent', '#ef5350', '#ff9800', '#4caf50', '#2196f3', '#9c27b0', '#00bcd4', '#795548']

function ImageUploadBtn({ label, onUpload, style }) {
  return (
    <button className="fc-tool-btn" onClick={() => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'
      input.onchange = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => onUpload(r.result); r.readAsDataURL(f) }
      input.click()
    }} style={{ fontSize: 10, ...style }}>+ {label || 'Image'}</button>
  )
}

function AudioUploadBtn({ label, onUpload, style }) {
  return (
    <button className="fc-tool-btn" onClick={() => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac'
      input.onchange = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => onUpload(r.result); r.readAsDataURL(f) }
      input.click()
    }} style={{ fontSize: 10, ...style }}>+ {label || 'Audio'}</button>
  )
}

function AudioPlayBtn({ src }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const play = (e) => {
    e.stopPropagation()
    if (!audioRef.current) {
      audioRef.current = new Audio(src)
      audioRef.current.onended = () => setPlaying(false)
    }
    if (playing) { audioRef.current.pause(); audioRef.current.currentTime = 0; setPlaying(false) }
    else { audioRef.current.play(); setPlaying(true) }
  }
  useEffect(() => () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null } }, [])
  return (
    <button className="fc-audio-play" onClick={play} title="Play audio">
      {playing ? <Pause size={14} strokeWidth={2.5} /> : <Play size={14} strokeWidth={2.5} fill="currentColor" />}
    </button>
  )
}

/** Static (non-flip) question face — shared by choice/type study modes,
 * same visual language as the flip card's front/back faces. */
function QuestionFace({ data, colorDot }) {
  return (
    <div className="fc-card-face fc-card-front" style={{ flexDirection: 'column', gap: 8 }}>
      <div className="fc-card-label">{colorDot}{data.label}</div>
      {data.html
        ? <div className="fc-card-html" dangerouslySetInnerHTML={{ __html: data.html }} />
        : data.text || <span style={{ color: 'var(--textDim)', fontStyle: 'italic' }}>Empty card</span>}
      {!data.html && data.img && <img src={data.img} alt="" style={{ maxWidth: '70%', maxHeight: 100, borderRadius: 8, objectFit: 'contain' }} />}
      {data.sketch && <img src={data.sketch} alt="" style={{ maxWidth: '80%', maxHeight: 80, borderRadius: 6 }} />}
      {data.audio && <AudioPlayBtn src={data.audio} />}
    </div>
  )
}

/** Strip HTML tags and decode entities, extract [sound:xxx] references */
function stripHtml(html) {
  if (!html) return { text: '', sounds: [] }
  const sounds = []
  let cleaned = html.replace(/\[sound:([^\]]+)\]/g, (_, name) => { sounds.push(name); return '' })
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  const el = document.createElement('div'); el.innerHTML = cleaned
  return { text: el.textContent?.trim() || '', sounds }
}

/** Fisher-Yates shuffle, returns a new array */
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Plain-text answer for one side of a card — used by choice/type study
 * modes, which need real text to compare/display, not HTML. Falls back to
 * stripping frontHtml/backHtml (Anki imports often only populate the HTML
 * field) when the plain field is empty. */
function sideText(card, isFront) {
  if (isFront) return card.front || stripHtml(card.frontHtml || '').text
  return card.back || stripHtml(card.backHtml || '').text
}

/** Loose equality for typed-answer grading: case/whitespace/punctuation
 * insensitive, not a full fuzzy/Levenshtein match — "close enough" in the
 * Quizlet sense would need more; this covers the common case (extra
 * spaces, a trailing period, different casing) without overbuilding. */
function normalizeAnswer(s) {
  return (s || '').trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
}

/** Inline media data URLs into HTML and strip [sound:] refs */
function processCardHtml(html, mediaData) {
  if (!html) return ''
  let out = html.replace(/\[sound:[^\]]+\]/g, '')
  out = out.replace(/<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/g, (match, pre, src, post) => {
    const bare = src.replace(/^.*[/\\]/, '')
    const m = mediaData[src] || mediaData[bare]
    return m?.isImage ? `<img${pre}src="${m.url}"${post}>` : match
  })
  return out
}

/** Parse .apkg file (ZIP containing SQLite) and return { cards, media } */
async function parseApkg(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer)

  // Find the SQLite database file
  let dbFile = zip.file('collection.anki21') || zip.file('collection.anki2')
  if (!dbFile) {
    // Try to find any .anki2/.anki21 file
    const files = Object.keys(zip.files)
    const dbName = files.find(f => f.endsWith('.anki2') || f.endsWith('.anki21'))
    if (dbName) dbFile = zip.file(dbName)
  }
  if (!dbFile) throw new Error('No Anki database found in .apkg file')

  const dbData = await dbFile.async('uint8array')
  const SQL = await initSqlJs()
  const db = new SQL.Database(dbData)

  // Parse media mapping (JSON file mapping numeric keys to filenames)
  let mediaMap = {}
  const mediaFile = zip.file('media')
  if (mediaFile) {
    try {
      const mediaJson = await mediaFile.async('text')
      mediaMap = JSON.parse(mediaJson)
    } catch { /* no media mapping */ }
  }

  // Extract media files as data URLs
  const mediaData = {}
  for (const [key, filename] of Object.entries(mediaMap)) {
    const mf = zip.file(key)
    if (mf) {
      const data = await mf.async('uint8array')
      const ext = filename.split('.').pop()?.toLowerCase() || ''
      const isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'].includes(ext)
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
      const mime = isAudio ? `audio/${ext === 'mp3' ? 'mpeg' : ext}` : isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : `application/octet-stream`
      const b64 = btoa(Array.from(data, b => String.fromCharCode(b)).join(''))
      mediaData[filename] = { url: `data:${mime};base64,${b64}`, isAudio, isImage }
    }
  }

  // Query notes table
  let cards = []
  try {
    const results = db.exec('SELECT flds FROM notes')
    if (results.length > 0) {
      for (const row of results[0].values) {
        const fields = (row[0] || '').split('\x1f') // Anki uses unit separator
        const frontHtml = fields[0] || ''
        const backHtml = fields[1] || ''
        const front = stripHtml(frontHtml)
        const back = stripHtml(backHtml)

        const card = {
          id: makeId('fc'),
          front: front.text,
          back: back.text,
          frontHtml: processCardHtml(frontHtml, mediaData),
          backHtml:  processCardHtml(backHtml,  mediaData),
          nextReview: 0, interval: 1, ease: 2.5, repetitions: 0,
        }

        // Attach media from [sound:xxx] references
        for (const s of front.sounds) {
          const m = mediaData[s]
          if (m?.isImage && !card.imageUrl) card.imageUrl = m.url
          if (m?.isAudio && !card.audioUrl) card.audioUrl = m.url
        }
        for (const s of back.sounds) {
          const m = mediaData[s]
          if (m?.isImage && !card.backImageUrl) card.backImageUrl = m.url
          if (m?.isAudio && !card.backAudioUrl) card.backAudioUrl = m.url
        }

        // Helper: look up a media entry by src value, stripping any path prefix
        const lookupMedia = (src) => {
          if (mediaData[src]) return mediaData[src]
          // Strip path prefix (e.g. "collection.media/img.jpg" → "img.jpg")
          const bare = src.replace(/^.*[/\\]/, '')
          return mediaData[bare] ?? null
        }

        // Check for inline images in HTML — front and back separately
        const frontImgMatch = frontHtml.match(/<img[^>]+src=["']([^"']+)["']/g)
        if (frontImgMatch) {
          for (const tag of frontImgMatch) {
            const srcM = tag.match(/src=["']([^"']+)["']/)
            const m = srcM ? lookupMedia(srcM[1]) : null
            if (m?.isImage && !card.imageUrl) card.imageUrl = m.url
          }
        }
        const backImgMatch = backHtml.match(/<img[^>]+src=["']([^"']+)["']/g)
        if (backImgMatch) {
          for (const tag of backImgMatch) {
            const srcM = tag.match(/src=["']([^"']+)["']/)
            const m = srcM ? lookupMedia(srcM[1]) : null
            if (m?.isImage && !card.backImageUrl) card.backImageUrl = m.url
          }
        }
        // Fallback: if no front image but back has one, or vice versa — keep both separated
        // If there's only one image total in the card, put it on the front
        if (!card.imageUrl && card.backImageUrl) {
          card.imageUrl = card.backImageUrl
        }

        cards.push(card)
      }
    }
  } finally {
    db.close()
  }

  return cards
}

export default function FlashcardView() {
  const paneTabId = useContext(PaneContext)
  const deck = useAppStore(s => s.activeFlashcardDeck)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const updateDeck = useAppStore(s => s.updateDeck)
  const persistFlashcardDecks = useAppStore(s => s.persistFlashcardDecks)
  const setView = useAppStore(s => s.setView); void setView
  const activeTabId = useAppStore(s => s.activeTabId)
  const isActivePane = !paneTabId || paneTabId === activeTabId

  const [mode, setMode] = useState(() => {
    const c = (flashcardDecks.find(d => d.id === deck?.id) || deck)?.cards
    return (!c || c.length === 0) ? 'list' : 'study'
  }) // 'study' | 'list'
  const [flipped, setFlipped] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [title, setTitle] = useState(deck?.title || 'Untitled Deck')
  const [studySide, setStudySide] = useState('front') // 'front' | 'back' — which side shows first
  const [editingDeckTitle, setEditingDeckTitle] = useState(false)
  const titleTimeout = useRef(null)

  // Choice/type study-mode answer state — reset whenever the card being
  // studied changes (gradeAndAdvance) or the question side is flipped.
  const [selectedOption, setSelectedOption] = useState(null)
  const [answerText, setAnswerText] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [wasCorrect, setWasCorrect] = useState(false)
  const advanceTimeoutRef = useRef(null)

  const isMobile = useIsMobile()

  const resetAnswerState = useCallback(() => {
    setSelectedOption(null); setAnswerText(''); setRevealed(false); setWasCorrect(false)
    if (advanceTimeoutRef.current) { clearTimeout(advanceTimeoutRef.current); advanceTimeoutRef.current = null }
  }, [])

  // Get the live deck from store (in case cards have been updated) — needs
  // to come before the mobile event bridge below, which reads `studyMode`
  // in its dependency array (a `const` used there is in the temporal dead
  // zone until its own declaration runs, even though the *listener callback*
  // itself only fires later — the deps array is evaluated immediately, as
  // a plain argument to useEffect(), not deferred like the callback body).
  const liveDeck = flashcardDecks.find(d => d.id === deck?.id) || deck
  const cards = liveDeck?.cards || []
  const studyMode = liveDeck?.studyMode || 'flip' // 'flip' | 'choice' | 'type'

  // Mobile event bridge — the bottom nav bar has no room for a 3-way
  // studyMode toggle, so 'study-cycle' both enters Study mode (first tap)
  // and cycles Cards→Choice→Type on subsequent taps while already there;
  // `mode`/`studyMode` are read fresh via the dependency array below,
  // not captured stale, since they're not refs.
  useEffect(() => {
    if (!isMobile) return
    const h = e => {
      const { cmd } = e.detail || {}
      if (cmd === 'studyside') { setStudySide(s => s === 'front' ? 'back' : 'front'); setFlipped(false); resetAnswerState() }
      if (cmd === 'study-cycle') {
        if (mode !== 'study') { setMode('study'); setFlipped(false); setCurrentIdx(0); resetAnswerState() }
        else {
          const order = ['flip', 'choice', 'type']
          setStudyMode(order[(order.indexOf(studyMode) + 1) % order.length])
        }
      }
      if (cmd === 'list') setMode('list')
    }
    window.addEventListener('gnos:mobile-fc-cmd', h)
    return () => window.removeEventListener('gnos:mobile-fc-cmd', h)
  // setStudyMode is a plain function recreated every render (not memoized);
  // adding it here would just re-subscribe the listener every render for
  // no behavioral difference, same judgment call as the keyboard handler
  // effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, resetAnswerState, mode, studyMode])

  // Due cards for study
  const now = Date.now()
  const dueCards = cards.filter(c => !c.nextReview || c.nextReview <= now)

  // Study card
  const studyCard = dueCards[currentIdx] || null

  // Which side is the question vs. the answer, and the answer's plain text
  // (choice/type modes need real text to compare/display, not just HTML).
  const qFront = studySide === 'front'
  const correctAnswerText = studyCard ? sideText(studyCard, !qFront) : ''

  // Multiple-choice options: correct answer + up to 3 distractors pulled
  // from other cards' answer-side text in this deck, shuffled once per
  // card (not on every render/store update, so the options don't reshuffle
  // out from under a mid-answer click — see the eslint-disable below).
  const choiceOptions = useMemo(() => {
    if (!studyCard || studyMode !== 'choice') return []
    const pool = cards
      .filter(c => c.id !== studyCard.id)
      .map(c => sideText(c, !qFront))
      .filter(t => t && t.trim() && t.trim() !== correctAnswerText.trim())
    const uniqueDistractors = [...new Set(pool.map(t => t.trim()))]
    const distractors = shuffle(uniqueDistractors).slice(0, 3)
    return shuffle([correctAnswerText, ...distractors])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyCard?.id, studyMode, qFront])

  useEffect(() => {
    setTitle(liveDeck?.title || 'Untitled Deck')
  }, [liveDeck?.title])

  function setStudyMode(next) {
    if (!liveDeck) return
    updateDeck(liveDeck.id, { studyMode: next, updatedAt: new Date().toISOString() })
    persistFlashcardDecks()
    resetAnswerState()
  }

  /** Footer mode-toggle click: sets studyMode, and also switches into Study
   * mode if not already there (the toggle replaced the standalone Study
   * button, so it has to do both jobs now). */
  function enterStudyMode(next) {
    setStudyMode(next)
    if (mode !== 'study') { setMode('study'); setFlipped(false); setCurrentIdx(0) }
  }

  // Keyboard: space/click to flip (flip mode), 1-4 to rate (flip mode) or
  // pick an option (choice mode), any key to continue once an answer's
  // been revealed (choice/type modes).
  useEffect(() => {
    if (mode !== 'study' || !isActivePane) return
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (studyMode === 'flip') {
        if (e.code === 'Space') { e.preventDefault(); setFlipped(f => !f) }
        if (flipped && studyCard) {
          if (e.key === '1') rateCard(1)
          if (e.key === '2') rateCard(2)
          if (e.key === '3') rateCard(3)
          if (e.key === '4') rateCard(4)
        }
      } else if (studyMode === 'choice') {
        if (revealed) { continueNow(); return }
        const idx = parseInt(e.key, 10) - 1
        if (idx >= 0 && idx < choiceOptions.length) submitChoice(choiceOptions[idx])
      } else if (studyMode === 'type') {
        if (revealed && e.key !== 'Enter') continueNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, flipped, studyCard, currentIdx, isActivePane, studyMode, revealed, choiceOptions])

  /** SM-2 update + streak tracking + advance to the next due card. Shared
   * by flip mode's manual rate buttons and choice/type's auto-grade path. */
  function gradeAndAdvance(quality) {
    if (!studyCard || !liveDeck) return
    const updated = sm2(studyCard, quality)
    const newCards = cards.map(c => c.id === updated.id ? updated : c)

    // Streak tracking
    const today = new Date().toISOString().slice(0, 10)
    const lastDate = liveDeck.lastStudyDate
    let streak = liveDeck.streak || 0
    if (lastDate === today) {
      // already studied today, no change
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      streak = lastDate === yesterday ? streak + 1 : 1
    }

    updateDeck(liveDeck.id, { cards: newCards, updatedAt: new Date().toISOString(), streak, lastStudyDate: today })
    persistFlashcardDecks()
    // `cards`/`dueCards`/`studyCard` are derived from the store, so the
    // displayed card already swaps to the next one the instant updateDeck
    // lands — reset synchronously here too, or the next card would render
    // for one tick with the previous card's revealed/selected-option state
    // still showing (a real bug this caught live: a fresh choice-mode card
    // briefly flashed as already-answered-wrong).
    resetAnswerState()
    setTimeout(() => {
      const newDue = newCards.filter(c => !c.nextReview || c.nextReview <= now)
      if (currentIdx >= newDue.length) setCurrentIdx(0)
    }, 520) // slightly longer than the flip card's 0.5s CSS transition
  }

  function rateCard(quality) {
    // Flip to the question side first (hide answer), then advance.
    setFlipped(false)
    gradeAndAdvance(quality)
  }

  function submitChoice(optionText) {
    if (revealed || !studyCard) return
    const correct = optionText.trim() === correctAnswerText.trim()
    setSelectedOption(optionText); setWasCorrect(correct); setRevealed(true)
    advanceTimeoutRef.current = setTimeout(() => gradeAndAdvance(correct ? 3 : 1), 900)
  }

  function submitTyped() {
    if (revealed || !studyCard || !answerText.trim()) return
    const correct = normalizeAnswer(answerText) === normalizeAnswer(correctAnswerText)
    setWasCorrect(correct); setRevealed(true)
    advanceTimeoutRef.current = setTimeout(() => gradeAndAdvance(correct ? 3 : 1), correct ? 700 : 1600)
  }

  /** Skip the rest of the post-answer delay and advance immediately —
   * mirrors Quizlet's "press any key to continue". */
  function continueNow() {
    if (!revealed) return
    if (advanceTimeoutRef.current) { clearTimeout(advanceTimeoutRef.current); advanceTimeoutRef.current = null }
    gradeAndAdvance(wasCorrect ? 3 : 1)
  }

  function handleTitleChange(val) {
    setTitle(val)
    clearTimeout(titleTimeout.current)
    titleTimeout.current = setTimeout(() => {
      if (liveDeck) {
        updateDeck(liveDeck.id, { title: val, updatedAt: new Date().toISOString() })
        persistFlashcardDecks()
      }
    }, 500)
  }

  // Import — supports CSV/TSV, .apkg (Anki), .colpkg
  async function handleImport() {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({ filters: [
      { name: 'Anki Decks', extensions: ['apkg', 'colpkg'] },
      { name: 'CSV/TSV', extensions: ['csv', 'tsv', 'txt'] },
    ]})
    if (!path) return

    const ext = path.split('.').pop()?.toLowerCase()

    if (ext === 'apkg' || ext === 'colpkg') {
      try {
        // Read binary file
        const { readFile } = await import('@tauri-apps/plugin-fs')
        const data = await readFile(path)
        const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
        const newCards = await parseApkg(buf.buffer)
        if (newCards.length) {
          updateDeck(liveDeck.id, { cards: [...cards, ...newCards], updatedAt: new Date().toISOString() })
          persistFlashcardDecks()
        }
      } catch (err) {
        console.error('[Gnos] Anki import error:', err)
        alert(`Failed to import Anki deck: ${err.message}`)
      }
      return
    }

    // CSV/TSV fallback
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const text = await readTextFile(path)

    // Detect separator: tab > semicolon > comma
    const sep = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ','

    // Parse respecting quoted fields
    const parseCSVLine = (line) => {
      const fields = []; let cur = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQ = !inQ; continue }
        if (ch === sep && !inQ) { fields.push(cur.trim()); cur = ''; continue }
        cur += ch
      }
      fields.push(cur.trim())
      return fields
    }
    const rawLines = text.trim().split('\n')
    const rows = rawLines.map(parseCSVLine)

    // Detect header row and column mapping
    const firstRow = rows[0] || []
    const headerKeywords = { front: /front|question|term|word|q\b/i, back: /back|answer|definition|meaning|a\b/i }
    let frontCol = 0, backCol = 1, dataStart = 0

    const headerCandidates = firstRow.map((h, i) => ({ h: h.toLowerCase().trim(), i }))
    const frontMatch = headerCandidates.find(({ h }) => headerKeywords.front.test(h))
    const backMatch  = headerCandidates.find(({ h }) => headerKeywords.back.test(h))

    if (frontMatch || backMatch) {
      dataStart = 1
      frontCol = frontMatch?.i ?? 0
      backCol  = backMatch?.i  ?? (frontCol === 0 ? 1 : 0)
    }

    // If every data row has only one column, try splitting on " - " (dash separator)
    const dataRows = rows.slice(dataStart).filter(r => r[0]?.trim())
    const allSingleCol = dataRows.length > 0 && dataRows.every(r => r.length === 1)

    const newCards = dataRows.filter(r => r[frontCol]?.trim()).map(r => {
      if (allSingleCol) {
        // "Term - Definition" single-column format
        const dashIdx = r[0].indexOf(' - ')
        if (dashIdx !== -1) {
          return { id: makeId('fc'), front: r[0].slice(0, dashIdx).trim(), back: r[0].slice(dashIdx + 3).trim(), nextReview: 0, interval: 1, ease: 2.5, repetitions: 0 }
        }
      }
      return { id: makeId('fc'), front: r[frontCol]?.trim() || '', back: r[backCol]?.trim() || '', nextReview: 0, interval: 1, ease: 2.5, repetitions: 0 }
    })
    if (newCards.length) {
      updateDeck(liveDeck.id, { cards: [...cards, ...newCards], updatedAt: new Date().toISOString() })
      persistFlashcardDecks()
    }
  }

  // Edit mode helpers
  function addCard() {
    if (!liveDeck) return
    const card = { id: makeId('fc'), front: '', back: '', nextReview: 0, interval: 1, ease: 2.5, repetitions: 0 }
    updateDeck(liveDeck.id, { cards: [...cards, card], updatedAt: new Date().toISOString() })
    persistFlashcardDecks()
  }

  function deleteCard(cardId) {
    if (!liveDeck) return
    updateDeck(liveDeck.id, { cards: cards.filter(c => c.id !== cardId), updatedAt: new Date().toISOString() })
    persistFlashcardDecks()
  }

  function updateCard(cardId, patch) {
    if (!liveDeck) return
    const newCards = cards.map(c => c.id === cardId ? { ...c, ...patch } : c)
    updateDeck(liveDeck.id, { cards: newCards, updatedAt: new Date().toISOString() })
    // Debounce persist for typing
    clearTimeout(titleTimeout.current)
    titleTimeout.current = setTimeout(() => persistFlashcardDecks(), 500)
  }

  if (!deck) {
    return (
      <div className="fc-container">
        <style>{FLASHCARD_CSS}</style>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--textDim)', fontSize: 14 }}>No deck selected</span>
        </div>
      </div>
    )
  }

  // Streak dot indicator (approximated from streak count + lastStudyDate)
  const fcStreakDots = (() => {
    const streak = liveDeck?.streak || 0
    if (!streak) return null
    const lastDate = liveDeck?.lastStudyDate ? new Date(liveDeck.lastStudyDate) : new Date()
    const today = new Date()
    const startOfWeek = new Date(today)
    startOfWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const weekActivity = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(startOfWeek)
      day.setDate(startOfWeek.getDate() + i)
      const diffDays = Math.round((+lastDate - +day) / 86400000)
      return diffDays >= 0 && diffDays < streak
    })
    const days = ['M','T','W','T','F','S','S']
    return (
      <div style={{ display:'flex', alignItems:'center', gap:5 }}>
        <span style={{ fontSize:10, fontWeight:700, color:'var(--textDim)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Streak</span>
        <div style={{ display:'flex', gap:3 }}>
          {days.map((d, i) => (
            <div key={i} title={d} style={{
              width:7, height:7, borderRadius:'50%',
              background: weekActivity[i] ? 'var(--accent)' : 'var(--border)',
            }} />
          ))}
        </div>
        <span style={{ fontSize:11, fontWeight:600, color:'var(--textDim)' }}>{streak}d</span>
      </div>
    )
  })()

  return (
    <div className="fc-container">
      <style>{FLASHCARD_CSS}</style>

      {/* Mobile floating add card button (edit mode only) */}
      {isMobile && mode === 'list' && (
        <button onClick={addCard} className="mobile-add-card-btn">
          <Plus size={12} strokeWidth={2.2} />
          Add Card
        </button>
      )}

      {/* Mobile floating deck info pill (replaces header on mobile) */}
      {isMobile && (
        <div className="mobile-view-title-pill">
          <div className="mobile-view-title-btn" onClick={() => setEditingDeckTitle(true)}>
            {editingDeckTitle ? (
              <input
                autoFocus
                value={liveDeck?.title || ''}
                onChange={e => handleTitleChange(e.target.value)}
                onBlur={() => { updateDeck(liveDeck.id, { title, updatedAt: new Date().toISOString() }); persistFlashcardDecks(); setEditingDeckTitle(false) }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                style={{ background: 'none', border: 'none', outline: 'none', fontWeight: 600, fontSize: 13,
                  color: 'var(--text)', fontFamily: 'inherit', minWidth: 60, maxWidth: 180 }}
              />
            ) : (
              <span className="mobile-view-title-name">{liveDeck?.title || 'Flashcards'}</span>
            )}
            <span className="mobile-view-title-meta">
              {cards.length} cards · <span style={{ color: dueCards.length > 0 ? '#ff9800' : 'inherit' }}>{dueCards.length} due</span>{(liveDeck?.streak || 0) > 0 ? ` · 🔥${liveDeck.streak}d` : ''}
            </span>
          </div>
        </div>
      )}

      {/* Header replaced: share lives in the title bar's quick-access strip;
          stats + flip + Study/Edit live in the footer at the bottom. */}
      <QuickAccess>
        <button
          className="gnos-settings-btn"
          title="Share deck"
          onClick={() => {
            const rows = ['Front\tBack', ...cards.map(c => `${(c.front||'').replace(/\t/g,' ')}\t${(c.back||'').replace(/\t/g,' ')}`)]
            const text = rows.join('\n')
            const filename = (liveDeck?.title || 'flashcards') + '.tsv'
            if (navigator.share) {
              const file = new File([text], filename, { type: 'text/tab-separated-values' })
              navigator.share({ files: [file], title: liveDeck?.title || 'Flashcards' }).catch(e => {
                if (e.name === 'AbortError') return
                const blob = new Blob([text], { type: 'text/tab-separated-values' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
              })
            } else {
              const blob = new Blob([text], { type: 'text/tab-separated-values' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }
          }}
        >
          <Share size={14} strokeWidth={1.7} />
        </button>
      </QuickAccess>

      {/* Study Mode */}
      {mode === 'study' && (
        <div className="fc-study">
          {studyCard ? (
            <>
              {/* studySide='front': front face shown first; studySide='back': back face shown first.
                  "question" = the side shown first; "answer" = the side revealed/graded against. */}
              {(() => {
                const qData = qFront
                  ? { text: studyCard.front, html: studyCard.frontHtml, img: studyCard.imageUrl, sketch: studyCard.sketchUrl, audio: studyCard.audioUrl,    label: 'Front' }
                  : { text: studyCard.back,  html: studyCard.backHtml,  img: studyCard.backImageUrl,                           audio: studyCard.backAudioUrl, label: 'Back'  }
                const aData = qFront
                  ? { text: studyCard.back,  html: studyCard.backHtml,  img: studyCard.backImageUrl,                           audio: studyCard.backAudioUrl, label: 'Back'  }
                  : { text: studyCard.front, html: studyCard.frontHtml, img: studyCard.imageUrl, sketch: studyCard.sketchUrl, audio: studyCard.audioUrl,    label: 'Front' }
                const cardColorDot = studyCard.color && studyCard.color !== 'transparent'
                  ? <span className="fc-card-color-dot" style={{ background: studyCard.color }} title="Card color" />
                  : null

                if (studyMode === 'choice') {
                  return (
                    <>
                      <div className="fc-static-card"><QuestionFace data={qData} colorDot={cardColorDot} /></div>
                      <div className="fc-choice-list">
                        {choiceOptions.map((opt, i) => {
                          const isCorrect = opt.trim() === correctAnswerText.trim()
                          const isPicked = selectedOption === opt
                          const cls = revealed ? (isCorrect ? 'correct' : isPicked ? 'incorrect' : '') : ''
                          return (
                            <button key={opt + i} className={`fc-choice-btn ${cls}`} disabled={revealed} onClick={() => submitChoice(opt)}>
                              <span className="fc-choice-num">
                                {revealed && isCorrect ? <Check size={12} strokeWidth={2.5} /> : revealed && isPicked ? <X size={12} strokeWidth={2.5} /> : i + 1}
                              </span>
                              {opt}
                            </button>
                          )
                        })}
                      </div>
                      {revealed
                        ? <button className="fc-continue-btn" onClick={continueNow}>Continue</button>
                        : <div className="fc-hint-text">Click an answer, or press its number</div>}
                    </>
                  )
                }

                if (studyMode === 'type') {
                  return (
                    <>
                      <div className="fc-static-card"><QuestionFace data={qData} colorDot={cardColorDot} /></div>
                      <div className="fc-type-input-row">
                        <input
                          className="fc-type-input" autoFocus disabled={revealed}
                          value={answerText} placeholder="Type your answer…"
                          onChange={e => setAnswerText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); revealed ? continueNow() : submitTyped() } }}
                        />
                        <button className="fc-type-submit" disabled={revealed || !answerText.trim()} onClick={submitTyped}>Answer</button>
                      </div>
                      {revealed && (
                        <div className={`fc-type-feedback ${wasCorrect ? 'correct' : 'incorrect'}`}>
                          <span>{wasCorrect ? 'Correct!' : 'Not quite'}</span>
                          {!wasCorrect && <span>Answer: <span className="fc-type-answer">{correctAnswerText || '(empty)'}</span></span>}
                        </div>
                      )}
                      {revealed
                        ? <button className="fc-continue-btn" onClick={continueNow}>Continue</button>
                        : <div className="fc-hint-text">Type the answer and press Enter</div>}
                    </>
                  )
                }

                // flip (default)
                return (
                  <>
                    <div className="fc-card-wrapper" onClick={() => setFlipped(f => !f)}>
                      <div className={`fc-card-inner${flipped ? ' flipped' : ''}`}>
                        {/* Question face (always visible when not flipped) */}
                        <div className="fc-card-face fc-card-front" style={{ flexDirection: 'column', gap: 8 }}>
                          <div className="fc-card-label">{cardColorDot}{qData.label}</div>
                          {qData.html
                            ? <div className="fc-card-html" dangerouslySetInnerHTML={{ __html: qData.html }} />
                            : qData.text || <span style={{ color: 'var(--textDim)', fontStyle: 'italic' }}>Empty card</span>}
                          {!qData.html && qData.img && <img src={qData.img} alt="" style={{ maxWidth: '70%', maxHeight: 100, borderRadius: 8, objectFit: 'contain' }} />}
                          {qData.sketch && <img src={qData.sketch} alt="" style={{ maxWidth: '80%', maxHeight: 80, borderRadius: 6 }} />}
                          {qData.audio && <AudioPlayBtn src={qData.audio} />}
                        </div>
                        {/* Answer face — hidden until flipped to prevent sneak-peek */}
                        <div className="fc-card-face fc-card-back" style={{ flexDirection: 'column', gap: 8, visibility: flipped ? 'visible' : 'hidden' }}>
                          <div className="fc-card-label">{cardColorDot}{aData.label}</div>
                          {aData.html
                            ? <div className="fc-card-html" dangerouslySetInnerHTML={{ __html: aData.html }} />
                            : aData.text || <span style={{ color: 'var(--textDim)', fontStyle: 'italic' }}>No answer</span>}
                          {!aData.html && aData.img && <img src={aData.img} alt="" style={{ maxWidth: '70%', maxHeight: 100, borderRadius: 8, objectFit: 'contain' }} />}
                          {aData.audio && <AudioPlayBtn src={aData.audio} />}
                        </div>
                      </div>
                    </div>
                    {/* Fixed-height slot for both variants — the rating bar
                        (buttons) and the hint text (one line) are different
                        heights, and .fc-study centers its column, so without
                        a reserved height flipping the card visibly shifted
                        it up/down as the container's total content height
                        changed. */}
                    <div className="fc-flip-action-row">
                      {flipped ? (
                        <div className="fc-rating-bar">
                          <button className="fc-rate-btn again" onClick={() => rateCard(1)}>Again <span style={{ fontSize: 10, opacity: 0.6 }}>(1)</span></button>
                          <button className="fc-rate-btn hard" onClick={() => rateCard(2)}>Hard <span style={{ fontSize: 10, opacity: 0.6 }}>(2)</span></button>
                          <button className="fc-rate-btn good" onClick={() => rateCard(3)}>Good <span style={{ fontSize: 10, opacity: 0.6 }}>(3)</span></button>
                          <button className="fc-rate-btn easy" onClick={() => rateCard(4)}>Easy <span style={{ fontSize: 10, opacity: 0.6 }}>(4)</span></button>
                        </div>
                      ) : (
                        <div className="fc-hint-text">Click card or press Space to flip</div>
                      )}
                    </div>
                  </>
                )
              })()}
              <div style={{ fontSize: 11, color: 'var(--textDim)', textAlign: 'center' }}>
                Card {currentIdx + 1} of {dueCards.length} due
                {studyMode === 'flip' && studyCard?.interval > 1 && (
                  <div style={{ marginTop: 4, fontSize: 10, opacity: 0.7 }}>
                    Next review in ~{studyCard.interval} day{studyCard.interval !== 1 ? 's' : ''} if rated Good
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="fc-done-msg">
              <h3>All caught up!</h3>
              <p>No cards are due for review right now.</p>
              <p style={{ marginTop: 8 }}>{cards.length} total cards in this deck</p>
              <button
                className="fc-mode-btn"
                style={{ marginTop: 16 }}
                onClick={() => setMode('list')}
              >Add more cards</button>
            </div>
          )}
        </div>
      )}

      {/* List Mode */}
      {mode === 'list' && (() => {
        const now2 = Date.now()
        const newCards = cards.filter(c => !c.nextReview || c.nextReview === 0)
        const dueNow = cards.filter(c => c.nextReview > 0 && c.nextReview <= now2)
        const learned = cards.filter(c => c.nextReview > now2)
        const sections = [
          { label: 'Due Now', items: dueNow, badgeClass: 'due' },
          { label: 'New', items: newCards, badgeClass: 'new' },
          { label: 'Learned', items: learned, badgeClass: 'learned' },
        ].filter(s => s.items.length > 0)

        const formatDue = (ts) => {
          if (!ts || ts === 0) return 'New'
          const diff = ts - now2
          if (diff <= 0) return 'Due now'
          const days = Math.ceil(diff / 86400000)
          if (days === 1) return 'Tomorrow'
          if (days < 30) return `${days}d`
          return `${Math.round(days / 30)}mo`
        }

        return (
          <div className="fc-list">
            {cards.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--textDim)', paddingTop: 40, fontSize: 14, display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
                No cards yet.
                <button className="fc-add-btn" style={{ maxWidth:240 }} onClick={addCard}>+ Add Card</button>
                <button className="fc-add-btn" style={{ maxWidth:240 }} onClick={handleImport}>↑ Import CSV / Anki deck</button>
              </div>
            )}
            {sections.map(({ label, items, badgeClass }) => (
              <div key={label}>
                <div className="fc-list-section">{label} ({items.length})</div>
                {items.map((card, i) => (
                  <div key={card.id} className="fc-list-row">
                    <div className="fc-list-row-hdr">
                      <span className="fc-list-num">{i + 1}</span>
                      {card.color && card.color !== 'transparent' && <span className="fc-list-color-dot" style={{ background: card.color }} title="Card color" />}
                      <span className={`fc-list-badge ${badgeClass}`}>{label === 'Due Now' ? 'Due' : label}</span>
                      {card.nextReview > 0 && <span className="fc-list-due-date">{formatDue(card.nextReview)}</span>}
                      {card.interval > 1 && <span className="fc-list-due-date" style={{ opacity: 0.5 }}>~{card.interval}d</span>}
                      <span style={{ flex: 1 }} />
                      {CARD_COLORS.map(c => (
                        <span key={c} className={`fc-color-dot${card.color === c ? ' active' : ''}`}
                          style={{ background: c === 'transparent' ? 'var(--surfaceAlt)' : c, width: 11, height: 11 }}
                          onClick={() => updateCard(card.id, { color: c })} />
                      ))}
                      <button className="fc-list-del" title="Delete card"
                        onClick={() => { deleteCard(card.id) }}><X size={13} strokeWidth={2} /></button>
                    </div>
                    <div className="fc-list-grid">
                      <div className="fc-list-col">
                        <textarea
                          className="fc-list-field"
                          rows={1}
                          value={card.front}
                          placeholder="Front…"
                          onChange={e => updateCard(card.id, { front: e.target.value })}
                          ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                        />
                        <div className="fc-list-field-label">Front</div>
                        {card.imageUrl && (
                          <div style={{ position:'relative', display:'inline-block' }}>
                            <img className="fc-list-img" src={card.imageUrl} alt="" />
                            <button onClick={() => updateCard(card.id, { imageUrl: '' })}
                              style={{ position:'absolute', top:10, right:2, width:16, height:16, borderRadius:8, background:'rgba(0,0,0,0.55)', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={9} strokeWidth={2.5} /></button>
                          </div>
                        )}
                        {card.audioUrl && (
                          <div className="fc-audio-row">
                            <AudioPlayBtn src={card.audioUrl} />
                            <span className="fc-audio-label">Front audio</span>
                            <button className="fc-audio-remove" onClick={() => updateCard(card.id, { audioUrl: '' })}><X size={11} strokeWidth={2.2} /></button>
                          </div>
                        )}
                        <div className="fc-list-col-tools">
                          <ImageUploadBtn label="Image" onUpload={url => updateCard(card.id, { imageUrl: url })} />
                          <AudioUploadBtn label="Audio" onUpload={url => updateCard(card.id, { audioUrl: url })} />
                        </div>
                      </div>
                      <div className="fc-list-col">
                        <textarea
                          className="fc-list-field"
                          rows={1}
                          value={card.back}
                          placeholder="Back…"
                          onChange={e => updateCard(card.id, { back: e.target.value })}
                          ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' } }}
                          onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px' }}
                        />
                        <div className="fc-list-field-label">Back</div>
                        {card.backImageUrl && (
                          <div style={{ position:'relative', display:'inline-block' }}>
                            <img className="fc-list-img" src={card.backImageUrl} alt="" />
                            <button onClick={() => updateCard(card.id, { backImageUrl: '' })}
                              style={{ position:'absolute', top:10, right:2, width:16, height:16, borderRadius:8, background:'rgba(0,0,0,0.55)', border:'none', color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}><X size={9} strokeWidth={2.5} /></button>
                          </div>
                        )}
                        {card.backAudioUrl && (
                          <div className="fc-audio-row">
                            <AudioPlayBtn src={card.backAudioUrl} />
                            <span className="fc-audio-label">Back audio</span>
                            <button className="fc-audio-remove" onClick={() => updateCard(card.id, { backAudioUrl: '' })}><X size={11} strokeWidth={2.2} /></button>
                          </div>
                        )}
                        <div className="fc-list-col-tools">
                          <ImageUploadBtn label="Image" onUpload={url => updateCard(card.id, { backImageUrl: url })} />
                          <AudioUploadBtn label="Audio" onUpload={url => updateCard(card.id, { backAudioUrl: url })} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {cards.length > 0 && !isMobile && (
              <button className="fc-add-btn" style={{ marginTop: 8 }} onClick={addCard}>+ Add Card</button>
            )}
          </div>
        )
      })()}

      {/* ── Footer — stats, flip direction, mode switch ── */}
      {!isMobile && (
        <div className="fc-footer">
          <div className="fc-stats">
            <span>{cards.length} cards</span>
            <span style={{ color: dueCards.length > 0 ? '#ff9800' : 'var(--textDim)' }}>
              {dueCards.length} due
            </span>
            {fcStreakDots}
          </div>
          <div style={{ flex: 1 }} />
          {mode === 'study' && (
            <button
              className="fc-mode-btn"
              title={studySide === 'front' ? 'Studying Front→Back (click to flip to Back→Front)' : 'Studying Back→Front (click to flip to Front→Back)'}
              onClick={() => { setStudySide(s => s === 'front' ? 'back' : 'front'); setFlipped(false); resetAnswerState() }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {studySide === 'front'
                ? <SquareArrowRight size={13} strokeWidth={1.5} />
                : <SquareArrowLeft size={13} strokeWidth={1.5} />}
              {studySide === 'front' ? 'Front first' : 'Back first'}
            </button>
          )}
          {/* The mode toggle doubles as the "enter Study mode" control — no
              separate Study button. Picking any of the three both switches
              studyMode and switches to Study mode if not already there. */}
          <div className="fc-study-mode-toggle">
            <button className={`fc-study-mode-btn${mode === 'study' && studyMode === 'flip' ? ' active' : ''}`} title="Flip cards" onClick={() => enterStudyMode('flip')}>
              <Layers size={12} strokeWidth={1.5} /> Cards
            </button>
            <button className={`fc-study-mode-btn${mode === 'study' && studyMode === 'choice' ? ' active' : ''}`} title="Multiple choice" onClick={() => enterStudyMode('choice')}>
              <ListChecks size={12} strokeWidth={1.5} /> Choice
            </button>
            <button className={`fc-study-mode-btn${mode === 'study' && studyMode === 'type' ? ' active' : ''}`} title="Type the answer" onClick={() => enterStudyMode('type')}>
              <Keyboard size={12} strokeWidth={1.5} /> Type
            </button>
          </div>
          <button className={`fc-mode-btn${mode === 'list' ? ' active' : ''}`} onClick={() => setMode('list')}>Edit</button>
        </div>
      )}
    </div>
  )
}
