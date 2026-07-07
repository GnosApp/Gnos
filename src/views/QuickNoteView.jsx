import { useCallback, useEffect, useRef, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadArchivePointer, loadPreferences, saveQuickNoteAsNotebook, saveQuickNoteToDir, loadQuickNoteNotebooks, loadNotebookContent, loadQuickNotesFromDir, deleteQuickNote } from '@/lib/storage'
import { applyTheme } from '@/lib/themes'
import { makeId } from '@/lib/utils'
import { makeMathCalcPlugin } from '@/lib/notebookEditor'

// ─────────────────────────────────────────────────────────────────────────────
// QuickNoteView — chromeless antinote-style scratch popup. Lives in its own
// frameless always-on-top Tauri window (label "quicknote"), summoned by ⌥N.
// Markdown renders inline (CodeMirror syntax styling). First line = title.
// Scroll past the top of the newest note → new note (when it has text);
// scroll past the bottom → flip back through older quick notes.
// Shortcuts: Esc hide · ⌘N new note · ⌘⇧C copy all · ⌘⇧V new from clipboard.
// `/timer 5 label` shows a vertical timer rail on the left edge.
// ─────────────────────────────────────────────────────────────────────────────

const AUTOSAVE_MS = 900
const SCROLL_THRESHOLD = 130   // accumulated wheel delta before flipping notes
const SCROLL_COOLDOWN = 450    // ms between flips

function titleFromText(text) {
  const first = (text.split('\n').find(l => l.trim()) || '').trim()
  return first.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/[*_`~]/g, '').slice(0, 80)
}

function parseTimerLine(text) {
  const m = text.match(/^\/timer\s+(\S+)(?:[ \t]+(.+))?$/m)
  if (!m) return null
  const t = m[1]
  let totalSec = 0
  const hms = t.match(/^(\d+):(\d{2}):(\d{2})$/)
  const ms = t.match(/^(\d+):(\d{2})$/)
  const mn = t.match(/^(\d+)$/)
  if (hms) totalSec = +hms[1] * 3600 + +hms[2] * 60 + +hms[3]
  else if (ms) totalSec = +ms[1] * 60 + +ms[2]
  else if (mn) totalSec = +mn[1] * 60
  if (totalSec <= 0) return null
  return { totalSec, label: m[2]?.trim() || '', raw: m[0] }
}

// True when the note has a `/math` calc zone (open, or a closed `/math`…`/math end` pair).
function docHasMathZone(text) {
  let open = false, any = false
  for (const raw of text.split('\n')) {
    const t = raw.trim()
    if (!open) { if (/^\/math$/i.test(t)) open = true }
    else if (/^(?:\/math\s+end|\/endmath)$/i.test(t)) { open = false; any = true }
  }
  return open || any
}

function fmtSec(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const tone = (freq, start, dur) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = freq; osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur)
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
    }
    tone(880, 0, 0.15); tone(880, 0.2, 0.15); tone(1100, 0.45, 0.3)
  } catch { /* no audio */ }
}

function freshNote() {
  return { id: makeId('nb'), createdAt: new Date().toISOString(), filePath: null, draft: true }
}

export default function QuickNoteView() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(true)
  const [quickNoteDir, setQuickNoteDir] = useState('')
  const [fanEnabled, setFanEnabled] = useState(true)
  const [position, setPosition] = useState(null) // { idx, total } flash indicator

  // Note stack — index 0 is the newest (usually the live draft)
  const stackRef = useRef([freshNote()])
  const idxRef = useRef(0)
  const contentsRef = useRef({})   // id → latest text (avoids disk reads when flipping)
  const textRef = useRef('')
  const dirRef = useRef('')
  const saveTimer = useRef(null)
  const posTimer = useRef(null)
  const wheelAcc = useRef(0)
  const lastFlip = useRef(0)

  // CodeMirror
  const hostRef = useRef(null)
  const cmViewRef = useRef(null)
  const applyingRef = useRef(false)

  textRef.current = text
  dirRef.current = quickNoteDir

  const currentNote = () => stackRef.current[idxRef.current]

  // ── Boot: storage, theme, prefs, note history ──────────────────────────────
  useEffect(() => {
    let disposed = false
    async function boot() {
      try {
        const archivePath = await loadArchivePointer()
        if (archivePath) useAppStore.setState({ archivePath })
        const prefs = await loadPreferences()
        if (disposed) return
        applyTheme(prefs?.themeKey || 'dark', prefs?.customThemes || {})
        setQuickNoteDir(prefs?.quickNoteDir || '')
        setFanEnabled(prefs?.quickNoteFanEnabled !== false)
        // Reload saved quick notes so scrolling reaches them after a restart.
        if (!prefs?.quickNoteDir) {
          // Archive mode: notes live as quickNote notebooks. loadQuickNoteNotebooks
          // dedupes id-collided folders (iCloud dup bug) and preloads real content,
          // so the stack never shows phantom blanks.
          const notes = await loadQuickNoteNotebooks()
          if (disposed) return
          const olds = notes.map(n => {
            contentsRef.current[n.id] = n.content   // preload so flipping needs no disk read
            return { id: n.id, createdAt: n.createdAt, filePath: null, draft: false }
          })
          stackRef.current = [stackRef.current[0], ...olds]
          setStackView({ idx: idxRef.current, len: stackRef.current.length })
        } else {
          // Custom-folder mode: notes are plain .md files in the chosen folder.
          const files = await loadQuickNotesFromDir(prefs.quickNoteDir)
          if (disposed) return
          const olds = files.map(f => {
            contentsRef.current[f.id] = f.content   // preload so flipping needs no re-read
            return { id: f.id, createdAt: f.createdAt || new Date(f.updatedAt || Date.now()).toISOString(), filePath: f.filePath, draft: false }
          })
          stackRef.current = [stackRef.current[0], ...olds]
          setStackView({ idx: idxRef.current, len: stackRef.current.length })
        }
      } catch (e) { console.warn('[QuickNote] boot failed:', e) }
    }
    boot()
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    return () => { disposed = true }
  }, [])

  // ── CodeMirror editor with inline markdown styling ─────────────────────────
  useEffect(() => {
    let destroyed = false
    async function mount() {
      const [state, view, language, md, lezer, autocomplete] = await Promise.all([
        import('@codemirror/state'),
        import('@codemirror/view'),
        import('@codemirror/language'),
        import('@codemirror/lang-markdown'),
        import('@lezer/highlight'),
        import('@codemirror/autocomplete'),
      ])
      if (destroyed || !hostRef.current) return
      // Shim matching what the shared notebook plugins destructure off `cm`.
      const cm = { state, view, language, autocomplete }
      const { tags } = lezer
      const hl = language.HighlightStyle.define([
        { tag: tags.heading1, fontSize: '1.45em', fontWeight: '700', lineHeight: 1.3 },
        { tag: tags.heading2, fontSize: '1.25em', fontWeight: '700', lineHeight: 1.3 },
        { tag: tags.heading3, fontSize: '1.12em', fontWeight: '600' },
        { tag: tags.heading4, fontWeight: '600' },
        { tag: tags.strong, fontWeight: '700' },
        { tag: tags.emphasis, fontStyle: 'italic' },
        { tag: tags.strikethrough, textDecoration: 'line-through', opacity: '0.7' },
        { tag: tags.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.88em' },
        { tag: tags.link, color: 'var(--accent, #388bfd)' },
        { tag: tags.url, color: 'var(--accent, #388bfd)', opacity: '0.75' },
        { tag: tags.quote, color: 'var(--textDim, #999)', fontStyle: 'italic' },
        { tag: tags.processingInstruction, color: 'var(--textDim, #888)', opacity: '0.55' },
        { tag: tags.contentSeparator, color: 'var(--textDim, #888)' },
        { tag: tags.list, color: 'var(--text, #eee)' },
      ])
      const theme = view.EditorView.theme({
        '&': { height: '100%', background: 'transparent', fontSize: '15px' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': {
          fontFamily: "'Satoshi', 'Author', -apple-system, system-ui, sans-serif",
          lineHeight: '1.65', overflow: 'auto',
        },
        '.cm-content': { padding: '0 16px 14px 16px', caretColor: 'var(--accent, #388bfd)' },
        '.cm-line': { padding: '0' },
        '.cm-cursor': { borderLeftColor: 'var(--accent, #388bfd)' },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          background: 'color-mix(in srgb, var(--accent, #388bfd) 28%, transparent) !important',
        },
      })
      const ed = new view.EditorView({
        state: state.EditorState.create({
          doc: textRef.current,
          extensions: [
            md.markdown(),
            language.syntaxHighlighting(hl),
            view.EditorView.lineWrapping,
            theme,
            // Inline math calculator + `/math` zones (shared with the notebook editor)
            ...makeMathCalcPlugin(cm),
            view.EditorView.updateListener.of(u => {
              if (u.docChanged && !applyingRef.current) {
                const t = u.state.doc.toString()
                setText(t)
                setSaved(false)
                clearTimeout(saveTimer.current)
                saveTimer.current = setTimeout(() => doSaveRef.current(), AUTOSAVE_MS)
              }
            }),
          ],
        }),
        parent: hostRef.current,
      })
      cmViewRef.current = ed
      ed.focus()
    }
    mount()
    return () => { destroyed = true; cmViewRef.current?.destroy(); cmViewRef.current = null }
     
  }, [])

  const setEditorText = useCallback((t) => {
    setText(t)
    const ed = cmViewRef.current
    if (ed) {
      applyingRef.current = true
      ed.dispatch({ changes: { from: 0, to: ed.state.doc.length, insert: t } })
      applyingRef.current = false
      ed.scrollDOM.scrollTop = 0
    }
  }, [])

  // ── Saving ─────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    const content = textRef.current
    const note = currentNote()
    const prev = contentsRef.current[note.id]   // content known before this save
    contentsRef.current[note.id] = content
    if (!content.trim()) {
      // Auto-delete ONLY when the user actively cleared a note that *had* content.
      // Guard against deleting a saved note whose content merely failed to load (or
      // an untouched reloaded note) — that was silently destroying notes on restart.
      if (!note.draft && !dirRef.current && prev && prev.trim()) {
        try {
          await deleteQuickNote(note.id)
          note.draft = true
          const { emit } = await import('@tauri-apps/api/event')
          emit('quicknote:saved', { id: note.id })
        } catch { /* non-fatal */ }
      }
      setSaved(true)
      return
    }
    const payload = { ...note, title: titleFromText(content), content }
    try {
      if (dirRef.current) {
        note.filePath = await saveQuickNoteToDir(payload, dirRef.current)
      } else {
        await saveQuickNoteAsNotebook(payload)
        note.draft = false
        try {
          const { emit } = await import('@tauri-apps/api/event')
          emit('quicknote:saved', { id: note.id })
        } catch { /* main window not around */ }
      }
      setSaved(true)
    } catch (e) { console.error('[QuickNote] save failed:', e) }
  }, [])
  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave

  const scheduleSave = useCallback(() => {
    setSaved(false)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(doSave, AUTOSAVE_MS)
  }, [doSave])

  // ── Note stack navigation ──────────────────────────────────────────────────
  const flashPosition = useCallback((idx, total) => {
    setPosition({ idx: idx + 1, total })
    clearTimeout(posTimer.current)
    posTimer.current = setTimeout(() => setPosition(null), 900)
  }, [])

  // Mirror of the ref-based stack state for rendering (fans + position pill)
  const [stackView, setStackView] = useState({ idx: 0, len: 1 })
  const syncStackView = useCallback(() => {
    setStackView({ idx: idxRef.current, len: stackRef.current.length })
  }, [])

  const goToIndex = useCallback(async (idx) => {
    const stack = stackRef.current
    if (idx < 0 || idx >= stack.length || idx === idxRef.current) return
    clearTimeout(saveTimer.current)
    await doSave()
    // Prune the note we're leaving if it ended up empty (drafts and deleted-empties)
    const leaving = stack[idxRef.current]
    if (leaving.draft && !(contentsRef.current[leaving.id] || '').trim() && stack.length > 1) {
      const leavingIdx = stack.indexOf(leaving)
      stack.splice(leavingIdx, 1)
      if (leavingIdx < idx) idx -= 1
    }
    idxRef.current = Math.max(0, Math.min(idx, stack.length - 1))
    const target = stack[idxRef.current]
    let content = contentsRef.current[target.id]
    if (content == null && !target.draft) {
      try { content = await loadNotebookContent(target.id) } catch { content = '' }
      contentsRef.current[target.id] = content || ''
    }
    setEditorText(content || '')
    setSaved(true)
    flashPosition(idxRef.current, stack.length)
    syncStackView()
  }, [doSave, setEditorText, flashPosition, syncStackView])

  const newNote = useCallback(async (initial = '') => {
    clearTimeout(saveTimer.current)
    await doSave()
    // Drop an untouched empty draft instead of stacking blanks
    const stack = stackRef.current
    const cur = stack[idxRef.current]
    if (cur.draft && !(contentsRef.current[cur.id] || '').trim()) {
      stack.splice(idxRef.current, 1)
    }
    const fresh = freshNote()
    stack.unshift(fresh)
    idxRef.current = 0
    setEditorText(initial)
    setSaved(!initial)
    if (initial) { textRef.current = initial; scheduleSave() }
    flashPosition(0, stack.length)
    syncStackView()
    cmViewRef.current?.focus()
  }, [doSave, scheduleSave, setEditorText, flashPosition, syncStackView])

  // Horizontal scroll flips through the stack — older notes sit to the LEFT,
  // newer to the RIGHT; swiping right past the newest starts a fresh note.
  useEffect(() => {
    function onWheel(e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return // vertical = text scroll
      const now = Date.now()
      if (now - lastFlip.current < SCROLL_COOLDOWN) { wheelAcc.current = 0; return }
      wheelAcc.current += e.deltaX

      if (wheelAcc.current <= -SCROLL_THRESHOLD) {
        // Swiping toward the left edge — older note
        wheelAcc.current = 0; lastFlip.current = now
        goToIndex(idxRef.current + 1)
      } else if (wheelAcc.current >= SCROLL_THRESHOLD) {
        // Swiping toward the right edge — newer note, or a brand-new one
        wheelAcc.current = 0; lastFlip.current = now
        if (idxRef.current > 0) goToIndex(idxRef.current - 1)
        else if (textRef.current.trim()) newNote()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [goToIndex, newNote])

  // Re-focus + re-read prefs each time the window is summoned
  useEffect(() => {
    let unlisten = null
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen('quicknote:focus', async () => {
        cmViewRef.current?.focus()
        try {
          const prefs = await loadPreferences()
          applyTheme(prefs?.themeKey || 'dark', prefs?.customThemes || {})
          setQuickNoteDir(prefs?.quickNoteDir || '')
          setFanEnabled(prefs?.quickNoteFanEnabled !== false)
        } catch { /* keep current */ }
      })
    ).then(un => { unlisten = un })
    return () => { if (unlisten) unlisten() }
  }, [])

  const hideWindow = useCallback(async () => {
    clearTimeout(saveTimer.current)
    await doSave()
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      await getCurrentWebviewWindow().hide()
    } catch { /* not in tauri */ }
  }, [doSave])

  const copyAll = useCallback(() => {
    navigator.clipboard?.writeText(textRef.current).catch(() => {})
  }, [])

  const pasteNew = useCallback(async () => {
    try {
      const clip = await navigator.clipboard.readText()
      if (clip) newNote(clip)
    } catch { /* clipboard unavailable */ }
  }, [newNote])

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') { e.preventDefault(); hideWindow() }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote() }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); copyAll() }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteNew() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hideWindow, newNote, copyAll, pasteNew])

  // ── Timer (/timer 5, /timer 1:30 label) — vertical rail on the left ───────
  const timerSpec = parseTimerLine(text)
  const [timer, setTimer] = useState(null)
  useEffect(() => {
    if (!timerSpec) { setTimer(null); return }
    setTimer(t => (t && t.raw === timerSpec.raw && !t.done)
      ? t
      : { raw: timerSpec.raw, totalSec: timerSpec.totalSec, remaining: timerSpec.totalSec, paused: false, done: false })
  }, [timerSpec?.raw]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!timer || timer.paused || timer.done) return
    const iv = setInterval(() => {
      setTimer(t => {
        if (!t || t.paused || t.done) return t
        const remaining = t.remaining - 1
        if (remaining <= 0) { beep(); return { ...t, remaining: 0, done: true } }
        return { ...t, remaining }
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [timer?.paused, timer?.done, timer?.raw]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = (text.match(/\S+/g) || []).length

  const hasOlder = stackView.idx < stackView.len - 1
  const hasNewer = stackView.idx > 0

  return (
    <div className="qn-root">
      <style>{QN_CSS}</style>

      {/* Fanned cards — one note card behind each side, pivoting from the bottom
          like a hand of cards so it splays out from behind the front card. Clicking
          it flips to that neighbor (older = left, newer = right). */}
      {fanEnabled && hasOlder && <div className="qn-fan qn-fan-left"
        title="Older note — click or swipe left"
        onClick={() => goToIndex(idxRef.current + 1)} />}
      {fanEnabled && hasNewer && <div className="qn-fan qn-fan-right"
        title="Newer note — click or swipe right"
        onClick={() => goToIndex(idxRef.current - 1)} />}

      {/* Front card — the active note, opaque, floating above the deck */}
      <div className="qn-card">
        {/* Invisible drag strip along the top edge */}
        <div className="qn-drag" data-tauri-drag-region />

        {/* ∑ indicator — top-right beside the save dot while a /math zone is active */}
        {docHasMathZone(text) && (
          <span className="qn-mathzone-badge" title="Math calc zone active">∑</span>
        )}

        {/* Save indicator — just the dot, top right */}
        <span className={`qn-save-dot${saved ? ' qn-saved' : ''}`} title={saved ? 'Saved' : 'Saving…'} />

        {/* Note position flash while flipping through the stack */}
        {position && <div className="qn-pos">{position.idx} / {position.total}</div>}

        <div className="qn-body">
          {timer && (
            <div
              className={`qn-rail${timer.done ? ' qn-rail-done' : ''}${timer.paused ? ' qn-rail-paused' : ''}`}
              onClick={() => setTimer(t => t.done
                ? { ...t, remaining: t.totalSec, done: false, paused: false }
                : { ...t, paused: !t.paused })}
              title={timer.done ? 'Restart' : timer.paused ? 'Resume' : 'Pause'}
            >
              <div className="qn-rail-track">
                <div className="qn-rail-fill" style={{ height: `${(timer.remaining / timer.totalSec) * 100}%` }} />
              </div>
              <span className="qn-rail-time">{timer.done ? 'done' : fmtSec(timer.remaining)}</span>
            </div>
          )}

          {/* Markdown editor */}
          <div ref={hostRef} className="qn-editor" />
        </div>

        <div className="qn-footer">
          <span>{words ? `${words} word${words === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

const QN_CSS = `
  html, body, #root { height: 100%; margin: 0; background: transparent !important; }
  /* Stage — transparent; holds the deck (back cards) + the front card */
  .qn-root {
    height: 100vh; box-sizing: border-box; position: relative;
    background: transparent; color: var(--text, #eee);
    font-family: 'Satoshi', 'Author', -apple-system, system-ui, sans-serif;
  }
  .qn-root *:focus, .qn-root *:focus-visible { outline: none !important; }
  .qn-drag { height: 16px; flex-shrink: 0; cursor: default; }
  /* Front card — the active note, opaque, floating above the deck. Inset from the
     window so the back cards can peek out around its top corners. */
  /* Front card is inset enough from the window edges that the fanned cards behind
     it can splay out without being clipped by the window (400×540). */
  .qn-card {
    position: absolute; inset: 26px 34px 12px 34px; z-index: 2;
    display: flex; flex-direction: column;
    background: var(--surface, #1c1c1e);
    border-radius: 14px; overflow: hidden;
    box-shadow: 0 16px 44px rgba(0,0,0,.5);
  }
  /* Fanned card — opaque and a touch lighter than the front card, inset a little
     more top+bottom so it stays within the front card's vertical bounds (never pokes
     over the top or under the bottom) and only peeks on the sides. Pivots from its
     bottom-centre so a small ±3° rotation swings it out like a card in a hand. */
  .qn-fan {
    position: absolute; inset: 40px 34px 26px 34px; z-index: 1;
    background: #2e2e34;
    background: color-mix(in srgb, var(--surface, #1c1c1e) 84%, #ffffff);
    border: 1px solid var(--borderSubtle, rgba(255,255,255,.12));
    border-radius: 12px;
    pointer-events: auto; cursor: pointer;
    transform-origin: 50% 100%;
    transition: transform .16s ease;
  }
  .qn-fan-left  { transform: rotate(-3deg); }
  .qn-fan-right { transform: rotate(3deg); }
  .qn-fan-left:hover  { transform: translateX(-4px) rotate(-3deg); }
  .qn-fan-right:hover { transform: translateX(4px)  rotate(3deg); }
  .qn-save-dot {
    position: absolute; top: 10px; right: 11px; z-index: 5;
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--textDim, #888); opacity: .45;
    transition: background .2s, opacity .2s;
  }
  .qn-save-dot.qn-saved { background: #4a9c6d; opacity: .9; }
  .qn-mathzone-badge {
    position: absolute; top: 6px; right: 26px; z-index: 5;
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 18px; height: 16px; padding: 0 5px; border-radius: 999px;
    border: 1px solid var(--borderSubtle, var(--border));
    background: var(--surfaceAlt, var(--surface));
    color: var(--accent, #388bfd); font-size: 12px; font-weight: 500;
    line-height: 1; user-select: none;
  }
  /* ── Inline math calc (shared with notebook) ── */
  .cm-ghost-hint { color: var(--textDim); opacity: .35; font-style: italic; pointer-events: none; user-select: none; }
  .cm-math-ghost { font-weight: 700; }
  .cm-nb-num { font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: .015em; }
  .cm-math-var { color: #e8a87c; font-weight: 500; }
  .cm-math-var-live { color: #f0a060; }
  .cm-math-colon { color: #e8a87c; opacity: .45; }
  .cm-math-ref { color: #79b8ff; font-weight: 500; }
  .qn-pos {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 5;
    padding: 2px 10px; border-radius: 999px;
    background: var(--surfaceAlt, rgba(255,255,255,.07));
    color: var(--textDim, #999); font-size: 10.5px; font-weight: 600;
    font-variant-numeric: tabular-nums; letter-spacing: .04em;
    animation: qn-pos-in .15s ease;
  }
  @keyframes qn-pos-in { from { opacity: 0; transform: translateX(-50%) translateY(-3px) } to { opacity: 1; transform: translateX(-50%) } }
  .qn-body { flex: 1; display: flex; min-height: 0; }
  .qn-editor { flex: 1; min-width: 0; }
  .qn-editor .cm-editor { height: 100%; }
  .qn-rail {
    width: 30px; flex-shrink: 0; cursor: pointer; user-select: none;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 2px 0 10px;
  }
  .qn-rail-track {
    flex: 1; width: 2px; border-radius: 1px;
    background: var(--border, rgba(255,255,255,.1));
    overflow: hidden; display: flex; flex-direction: column; justify-content: flex-end;
  }
  .qn-rail-fill {
    width: 100%; background: var(--accent, #388bfd); border-radius: 1px;
    transition: height 1s linear;
  }
  .qn-rail-paused .qn-rail-fill { opacity: .4; }
  .qn-rail-time {
    font-size: 10px; color: var(--textDim, #999); font-variant-numeric: tabular-nums;
    writing-mode: vertical-rl; letter-spacing: .05em;
  }
  .qn-rail-done .qn-rail-time { color: var(--accent, #388bfd); animation: qn-pulse 1.2s ease-in-out infinite; }
  @keyframes qn-pulse { 0%,100% { opacity: 1 } 50% { opacity: .5 } }
  .qn-body .qn-rail + .qn-editor .cm-content { padding-left: 4px; }
  .qn-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 14px 9px; font-size: 10.5px; color: var(--textDim, #888);
    flex-shrink: 0; user-select: none; opacity: .7; min-height: 14px;
  }
`
