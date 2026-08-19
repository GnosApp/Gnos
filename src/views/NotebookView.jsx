/* NotebookView.jsx — CodeMirror 6 — v4
 *
 * Changes from v3:
 * ─────────────────
 * • Live view styled identically to preview (same typography, prose spacing,
 *   block padding) — only difference is the cursor / caret.
 * • Both opening AND closing syntax markers are hidden together when the cursor
 *   leaves the span. The cursor-zone now tracks the widest inline ancestor so
 *   **both** EmphasisMarks reveal at once.
 * • KaTeX replaced with MathQuill for inline-editable math. Clicking a rendered
 *   formula opens an in-place MathQuill editor; pressing Escape/Enter commits.
 * • Images render correctly in live view and no longer blank the screen in
 *   preview (line-level block replacement constrained to just the image node).
 * • Math $$…$$ and $…$ render in both live and preview via MathQuill rendering.
 * • Predictive formatting: once one side of a pair is typed (e.g. **) the
 *   partially-wrapped text immediately receives its CSS style via a dedicated
 *   "half-open" pass in the live plugin.
 * • [[ wikilink dropdown now uses a card-style floating panel that mirrors the
 *   library search bar; it is driven by a custom EditorView plugin (not the
 *   generic autocompletion tooltip) so it looks consistent.
 * • Paired-syntax auto-wrap: typing **, *, `, ~~, ==, $ around selected text
 *   (or at end of a word) wraps rather than showing a dropdown.
 * • Generic pair-syntax dropdown removed from autocompletion; only wikilinks
 *   use the autocomplete tooltip.
 */

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, useContext, lazy, Suspense } from 'react'
import useAppStore from '@/store/useAppStore'
import { PaneContext, PaneChromeContext } from '@/lib/PaneContext'
import { useIsActiveTab } from '@/lib/useIsActiveTab'
import { mergeSilently } from '@/lib/merge3'
import { snapshot as _histSnap, diffLines as _historyDiff, prune as _histPrune } from '@/lib/history'
const historySnapshot = (id, text, kind) => { _histSnap(id, text, kind).catch(() => {}) }
const historyPrune = (id) => { _histPrune(id).catch(() => {}) }
import { loadNotebookContent, saveNotebookContent, saveNotebookImage, getNotebookFolderPath, addReadingMinutes,
         resolveNotebookMdPath, getNotebookMdPath, getFileMtimeMs, readNotebookMdAt, stampNotebookSynced } from '@/lib/storage'
import QuickAccess, { useTitlebarMeta } from '@/components/QuickAccess'
import { useIsMobile } from '@/lib/useIsMobile'
import { Slider } from '@/components/Controls'
import { IconQuill, IconDefaults } from '@/components/icons'
import {
  makeMathCalcPlugin, makeId, getKaTeX, getMQ, _convertFileSrc, _invoke, _dialogOpen, makeSafeExt,
  renderMarkdown, hydrateMathNodes, hydrateDiagrams,
  makeTheme, makeHighlight, makeWikiDropdownPlugin, makePairInputHandler, makeSmartEnter,
  makeFormatKeys, makeGhostHintPlugin, makeTableCommand, makeSlashSource, parseDueDate,
  makeLinkCommands, makeInlineCmdPlugin, _inlineCmdSelectedIdx,
  INLINE_COLORS, INLINE_FONTS, INLINE_SPACINGS, INLINE_SIZES, INLINE_ALIGNS, INLINE_COLUMNS,
  _getOptionCount, makeInlineCmdCloseHandler, makeLivePlugin,
  makeCheckboxHandler, makeStatusHandler, makeHeadingFoldHandler, makeLinkHandler,
  makeWikiHandler, makeTodoHandler, makeTaskHandler, makeMathClickHandler,
  makeSourcePlugin, MODE_META, ViewModeBtn,
} from '@/lib/notebookEditor'
import { listen } from '@tauri-apps/api/event'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Eye, FileText, Image, Link2, NotebookText, Pencil, Search, Share, TriangleAlert, Users, X } from 'lucide-react'

// Lazy: only imports yjs/y-webrtc/y-codemirror.next (real weight) the moment
// a user actually starts a Live Share — see NoteCollabPanel.jsx's own header
// comment for why this boundary matters.
const NoteCollabPanel = lazy(() => import('@/components/NoteCollabPanel'))


// ─── CodeMirror lazy bundle ───────────────────────────────────────────────────
let _cmP = null
function loadCM() {
  if (_cmP) return _cmP
  _cmP = Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/commands'),
    import('@codemirror/language'),
    import('@codemirror/lang-markdown'),
    import('@codemirror/autocomplete'),
    import('@codemirror/search'),
    import('@lezer/highlight'),
    import('@lezer/markdown'),
  ]).then(([state, view, commands, language, langMd, autocomplete, search, highlight, lezerMd]) => ({
    state, view, commands, language, langMd, autocomplete, search, highlight, lezerMd,
  }))
  return _cmP
}

// ─── Live Share collab-compartment content ──────────────────────────────────
// `bits` is null (not sharing / not ready yet) or { canonicalText, awareness,
// yCollab } from NoteCollabPanel.jsx. No `undoManager` passed to yCollab —
// stated limitation, not an oversight: CM6's own `history()` extension stays
// the editor's undo source during a share, same as when not sharing, so a
// Ctrl-Z performed right after a remote edit lands is not guaranteed to be
// collaboration-aware (it could in principle undo the remote insert rather
// than the host's own last edit). Giving yCollab its own Y.UndoManager would
// fix that but means running two undo systems side by side during a share;
// not done here — pass a `Y.UndoManager` in when that's worth the added
// surface.
//
// Second stated limitation, checked against y-codemirror.next's own source
// (node_modules/y-codemirror.next/src/y-sync.js): its sync plugin does NOT
// reconcile the editor's current doc against `ytext` when it first attaches
// — it only observes both for CHANGES from that point on. `canonicalText`
// is seeded once from `contentRef.current` at the moment the share panel
// opens (NoteCollabPanel's `seedText` prop); if the host keeps typing during
// the brief async gap before this compartment actually reconfigures
// (WebrtcProvider/awareness setup), those few keystrokes exist in the
// host's own doc but never reached `canonicalText`, so a guest's very first
// view of the note can be missing them. Self-healing the moment the host
// edits again afterward (that edit DOES flow through, same as any other),
// and nothing is ever lost from the host's own saved file — only a guest's
// initial view can be transiently behind. Not a repeat of the seeding bugs
// documented in src/lib/collab/engine.js (those were permanent silent
// failures from missing CRDT dependencies); this is a narrow, self-healing
// window. Noted rather than engineered around, given how small it is.
//
// Guest edits arriving through this binding are ordinary CM6
// transactions, so the existing `updateListener` below (docChanged →
// contentRef → scheduleSave) already persists them — no separate save path
// needed for collaboration.
function buildCollabExt(bits) {
  if (!bits?.canonicalText || !bits?.awareness || !bits?.yCollab) return []
  return [bits.yCollab(bits.canonicalText, bits.awareness, {})]
}

// `QuestionWidget`'s injected store accessor (see its own header comment in
// notebookEditor.jsx for why this is injected rather than a hard import
// there) — always reads live, same as the `useAppStore.getState()` calls
// this replaced. A plain module-level object, not per-render state: nothing
// here captures anything that changes across renders.
const questionStoreApi = {
  getFlashcardDecks: () => useAppStore.getState().flashcardDecks || [],
  addCardToDeck: (deckId, card) => {
    const store = useAppStore.getState()
    const curDeck = store.flashcardDecks.find(d => d.id === deckId)
    if (curDeck) {
      store.updateDeck(deckId, { cards: [...(curDeck.cards || []), card], updatedAt: new Date().toISOString() })
      store.persistFlashcardDecks?.()
    }
  },
}

function NbShareMenu({ noteTitle, notebookTitle, contentRef, previewHtml, sharing, guestCount, onStartLiveShare, onOpenLiveShare }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const title = noteTitle || notebookTitle || 'notebook'
  const safeName = title.replace(/[/\\?%*:|"<>]/g, '-')

  async function shareMarkdown() {
    setOpen(false)
    const text = contentRef.current || ''
    const filename = safeName + '.md'
    if (navigator.share) {
      try {
        const file = new File([text], filename, { type: 'text/markdown' })
        await navigator.share({ files: [file], title })
        return
      } catch (e) { if (e.name === 'AbortError') return }
    }
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function exportPdf() {
    setOpen(false)
    const html = previewHtml || ''
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; font-size: 15px; }
      h1,h2,h3,h4,h5,h6 { margin: 1.5em 0 0.5em; font-weight: 700; }
      h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
      p { margin: 0.75em 0; }
      pre { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
      code { background: #f0f0f0; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
      blockquote { border-left: 3px solid #ccc; margin: 0; padding-left: 16px; color: #555; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
      th { background: #f5f5f5; font-weight: 600; }
      img { max-width: 100%; }
      hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
      @media print { body { margin: 0; max-width: none; } }
    </style></head><body>${html}</body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => { w.print() }, 400)
  }

  const SHARE_ICON = <Share size={14} strokeWidth={1.5} />

  return (
    <div style={{ position:'relative', flexShrink:0 }} ref={wrapRef}>
      <button
        className="gnos-settings-btn"
        title="Share / Export"
        onClick={() => setOpen(o => !o)}>
        {SHARE_ICON}
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.45)', minWidth:160, zIndex:9300 }}>
          {[
            sharing
              ? { label: `Live Share panel${guestCount ? ` (${guestCount} connected)` : ''}`, action: () => { setOpen(false); onOpenLiveShare?.() }, icon: <Users size={12} strokeWidth={1.6} /> }
              : { label: 'Start Live Share…', action: () => { setOpen(false); onStartLiveShare?.() }, icon: <Users size={12} strokeWidth={1.6} /> },
            { label: 'Share / Export Markdown', action: shareMarkdown, icon: <Share size={12} strokeWidth={1.5} /> },
            { label: 'Export as PDF', action: exportPdf, icon: <FileText size={12} strokeWidth={1.4} /> },
          ].map(({ label, action, icon }) => (
            <button key={label} onMouseDown={e => { e.preventDefault(); action() }}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', border:'none', background:'none', width:'100%', cursor:'pointer', textAlign:'left', fontSize:13, fontFamily:'inherit', color:'var(--text)', transition:'background .08s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              {icon}
              <span style={{ flex:1, fontWeight:500 }}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NotebookView
// ─────────────────────────────────────────────────────────────────────────────
export default function NotebookView() {
  const themeKey        = useAppStore(s => s.themeKey ?? 'dark')
  const paneTabId      = useContext(PaneContext)
  const paneChrome     = useContext(PaneChromeContext)
  const isActive       = useIsActiveTab()
  const notebook       = useAppStore(useCallback(
    s => {
      const tab = paneTabId ? s.tabs.find(t => t.id === paneTabId) : null
      return tab?.activeNotebook ?? s.activeNotebook
    },
    [paneTabId]
  ))
  const notebooks      = useAppStore(s => s.notebooks)
  const updateNotebook = useAppStore(s => s.updateNotebook)
  const nbFontSize     = useAppStore(s => s.nbFontSize ?? 15)
  const setPref        = useAppStore(s => s.setPref)
  const persistPreferences = useAppStore(s => s.persistPreferences)
  const setView        = useAppStore(s => s.setView)
  const updateTab      = useAppStore(s => s.updateTab)
  const activeTabId    = useAppStore(s => s.activeTabId)
  const library        = useAppStore(s => s.library)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)
  const addNotebook    = useAppStore(s => s.addNotebook)

  const notebookId    = notebook?.id
  const notebookTitle = notebook?.title || ''

  const [viewMode,  setVM]       = useState('live')
  const [content,   setContent]  = useState('')
  const [noteTitle, setTitle]    = useState('')
  const [loaded,    setLoaded]   = useState(false)
  // Non-fatal editor problems (load failure, widget extension crash → safe
  // mode). Rendered as a banner instead of the historical blank page.
  const [nbError,   setNbError]  = useState(null)
  const [coverImage,  setCoverImage]  = useState(null)
  const [coverPos,    setCoverPos]    = useState({ x: 50, y: 50 })
  const [coverScale,  setCoverScale]  = useState(1)   // zoom factor ≥ 1
  const coverDragRef = useRef(null)
  const [coverPicker, setCoverPicker] = useState(null)
  const pickerImgRef = useRef(null)
  const [linkPicker, setLinkPicker] = useState(null)   // { type:'file'|'web'|'video', lineFrom, lineTo }
  const [linkWebUrl, setLinkWebUrl]  = useState('')
  const linkPickRef  = useRef(null)
  const [, setSaving]            = useState(false)
  const [findQ,     setFindQ]    = useState('')
  const [findCount, setFindCount]= useState(0)
  const [findCurD,  setFindCurD] = useState(0)
  const [selectionWC, setSelectionWC] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [editModal, setEditModal]= useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Live Share (PLAN_CONCURRENCY.md §6 steps 7–9, wired into production).
  // `sharing` = a session is live (mounts <NoteCollabPanel>, which owns the
  // WebrtcProvider connection). `collabOpen` = the panel is visually shown —
  // deliberately separate so closing the panel doesn't end the session, same
  // relationship as `historyOpen` has to the note's actual history.
  const [sharing, setSharing] = useState(false)
  const [collabOpen, setCollabOpen] = useState(false)
  const [collabGuestCount, setCollabGuestCount] = useState(0)
  // Set by NoteCollabPanel once its canonicalDoc/awareness/yCollab are ready
  // (one tick after the panel mounts — WebrtcProvider awareness arrives
  // async). Consumed by the collab-compartment effect below to bind the
  // REAL editor, not a separate one.
  const [collabBits, setCollabBits] = useState(null) // { canonicalText, awareness, yCollab }
  const collabBitsRef = useRef(null) // mirror of collabBits — read by the CM6 mount effect, which intentionally does NOT depend on collabBits itself (that would force a full remount, losing cursor/scroll, every time a share connects)
  useEffect(() => { collabBitsRef.current = sharing ? collabBits : null }, [sharing, collabBits])
  const collabCompartmentRef = useRef(null) // created fresh each editor mount — see the CM6 mount effect
  // Reconfigure the live compartment in place when collabBits/sharing
  // changes AFTER the editor already mounted (the normal case: a share
  // connects ~1s after the panel opens). No remount — that's the whole
  // point of the compartment: the host never loses cursor/scroll/undo
  // position just from starting or stopping a share.
  useEffect(() => {
    const view = cmRef.current
    const compartment = collabCompartmentRef.current
    if (!view || !compartment) return
    view.dispatch({ effects: compartment.reconfigure(buildCollabExt(sharing ? collabBits : null)) })
  }, [sharing, collabBits])
  const [showMobileViewMenu, setShowMobileViewMenu] = useState(false)

  const editorRef     = useRef(null)
  const cmRef         = useRef(null)
  const coverInputRef = useRef(null)
  const cmMods     = useRef(null)
  const saveTimer        = useRef(null)
  const saveVisT         = useRef(null)
  const contentRef       = useRef('')
  const titleRef         = useRef('')
  const lastSavedTextRef = useRef(null)
  const contentStateTimer = useRef(null)
  const findRef    = useRef(null)
  const previewRef = useRef(null)
  const hitsRef    = useRef([])
  const hitIdxRef  = useRef(0)
  const loadedFor  = useRef(null)
  const wikiNavRef = useRef(null)
  const notebookDirRef = useRef(null)
  // ── External-edit sync ──
  // mdPathRef: absolute path of this notebook's .md on disk.
  // diskMtimeRef: mtime of the last content this editor is in sync with (set on
  // load and after every save). A file mtime newer than this means someone else
  // — another device syncing, Obsidian, vim — wrote the file.
  const mdPathRef    = useRef(null)
  const diskMtimeRef = useRef(0)
  // Body text as of the last time editor and disk agreed — anything else in the
  // editor means unsaved local edits, which must not be silently replaced.
  const syncedTextRef = useRef('')
  const lastAutoSnapRef = useRef(0)   // throttles periodic history snapshots
  const flushSaveRef = useRef(null) // set to flushSave; lets the disk watcher save without a forward ref
  const [extConflict, setExtConflict] = useState(null) // { text, title, mtimeMs } — legacy banner, unused since auto-fork
  // Timestamp set by DOM drop handler when it inserts an image; checked by the
  // Tauri drag-drop handler to skip processing if DOM already handled the drop.
  const domDropRef = useRef(0)
  const [wikiDrop, setWikiDrop] = useState(null) // { options, selectedIdx, coords }
  const [inlineCmd, setInlineCmd] = useState(null) // { type, hint, selectedIdx, coords, lineFrom, lineTo }
  const inlineCmdRef = useRef(null)
  const inlineCmdNavRef = useRef(null)  // called by CM6 keymap to push selectedIdx into React state
  const [cursorPos, setCursorPos] = useState(0)
  // Keep nav callback fresh every render so it always closes over the latest setInlineCmd
  inlineCmdNavRef.current = () => {
    setInlineCmd(prev => prev ? { ...prev, selectedIdx: _inlineCmdSelectedIdx.current } : prev)
  }

  contentRef.current = content
  titleRef.current   = noteTitle

  const isLoaded = loaded && loadedFor.current === notebookId

  // ── Cross-tab content sync — when another tab saves the same notebook, apply here ──
  const nbCacheEntry = useAppStore(s => notebookId ? s.notebookContentCache?.[notebookId] : undefined)
  useEffect(() => {
    if (!nbCacheEntry || !isLoaded) return
    const { text: cachedText } = nbCacheEntry
    // Skip if we set this cache entry (avoids overwriting chars typed after the save started)
    if (cachedText === lastSavedTextRef.current) return
    // Skip if editor already shows this content
    if (cachedText === contentRef.current) return
    contentRef.current = cachedText; setContent(cachedText)
    // Push the new text into the live CM6 editor if mounted
    if (cmRef.current) {
      const view = cmRef.current
      const current = view.state.doc.toString()
      if (current !== cachedText) {
        // Preserve cursor position so a cross-tab save doesn't jump the caret
        const head = Math.min(view.state.selection.main.head, cachedText.length)
        view.dispatch({
          changes: { from: 0, to: current.length, insert: cachedText },
          selection: { anchor: head },
          scrollIntoView: false,
        })
      }
    }
  }, [nbCacheEntry, isLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const previewHtml = useMemo(
    () => renderMarkdown(content, notebooks, library, sketchbooks, flashcardDecks, notebookDirRef.current),
    [content, notebooks, library, sketchbooks, flashcardDecks]
  )

  // Hydrate MathQuill after preview renders
  useEffect(() => {
    if (viewMode !== 'preview' || !previewRef.current) return
    hydrateMathNodes(previewRef.current)
    hydrateDiagrams(previewRef.current)   // mermaid — lazy, no-op without diagrams
  }, [viewMode, previewHtml])

  // Pre-load KaTeX and MathQuill so they're ready when live mode starts
  useEffect(() => { getKaTeX(); getMQ() }, [])

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!notebookId) return
    let gone = false
    setLoaded(false)
    setNbError(null)
    const nb = notebook
    Promise.all([
      loadNotebookContent(notebookId),
      nb ? getNotebookFolderPath(nb).catch(() => null) : Promise.resolve(null),
    ]).then(([raw, folderPath]) => {
      if (gone) return
      notebookDirRef.current = folderPath
      // Baseline for external-change detection — resolved async, doesn't block load
      mdPathRef.current = null
      diskMtimeRef.current = 0
      setExtConflict(null)
      getNotebookMdPath(nb || notebookId).then(async p => {
        if (gone) return
        mdPathRef.current = p
        diskMtimeRef.current = p ? await getFileMtimeMs(p) : 0
      }).catch(() => {})
      let text  = typeof raw === 'string' ? raw : ''
      let title = notebookTitle
      const hm  = text.match(/^# (.+)\n/)
      if (hm) { title = hm[1]; text = text.slice(hm[0].length) }
      titleRef.current = title; setTitle(title)
      contentRef.current = text; setContent(text)
      syncedTextRef.current = text
      // Baseline snapshot on open, so History always has a recovery point rather
      // than nothing until the first 3-minute tick. Deduped by history.js.
      lastAutoSnapRef.current = Date.now()
      historySnapshot(notebookId, raw, 'auto')
      historyPrune?.(notebookId)
      // Restore cover image if one was saved with this notebook
      const savedCover = nb?.coverImage || null
      if (savedCover && _convertFileSrc && folderPath) {
        try {
          const absPath = savedCover.startsWith('./') ? folderPath + '/' + savedCover.slice(2) : savedCover
          setCoverImage(_convertFileSrc(absPath))
        } catch { setCoverImage(null) }
      } else {
        setCoverImage(null)
      }
      setCoverPos(nb?.coverPos || { x: 50, y: 50 })
      setCoverScale(nb?.coverScale ?? 1)
      setLoaded(true)
      loadedFor.current = notebookId
    }).catch(err => {
      // A rejected load used to leave the view blank FOREVER (setLoaded never
      // fired). Fail into an empty editor + visible banner instead.
      if (gone) return
      console.error('[Notebook] content load failed:', err)
      titleRef.current = notebookTitle; setTitle(notebookTitle)
      contentRef.current = ''; setContent('')
      setCoverImage(null)
      setNbError(`Couldn't load this notebook's content (${err?.message || err}). Editing a blank copy — saving may fail.`)
      setLoaded(true)
      loadedFor.current = notebookId
    })
    return () => { gone = true }
  }, [notebookId, notebookTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── External edit sync ────────────────────────────────────────────────────
  // Adopt text written to this notebook's .md by something other than this
  // editor (another device syncing, Obsidian, vim). Cursor position is kept so
  // an incoming change doesn't yank the caret.
  const applyExternal = useCallback((text, title, mtimeMs) => {
    titleRef.current = title; setTitle(title)
    contentRef.current = text; setContent(text)
    syncedTextRef.current = text
    lastSavedTextRef.current = text
    diskMtimeRef.current = mtimeMs
    if (cmRef.current) {
      const view = cmRef.current
      const current = view.state.doc.toString()
      if (current !== text) {
        const head = Math.min(view.state.selection.main.head, text.length)
        view.dispatch({
          changes: { from: 0, to: current.length, insert: text },
          selection: { anchor: head },
          scrollIntoView: false,
        })
      }
    }
    // Refresh the card + let other tabs on this notebook pull the same text
    if (notebook) {
      const wc = (text.match(/\b\w+\b/g) || []).length
      const patch = { updatedAt: new Date(mtimeMs || Date.now()).toISOString(), wordCount: wc }
      if (title && title !== notebook.title) patch.title = title
      updateNotebook(notebook.id, patch)
      useAppStore.getState().persistNotebooks?.()
      useAppStore.getState().setNotebookContentCache?.(notebook.id, text)
    }
    // meta.json already matches disk now — stop the next scan re-deriving it
    stampNotebookSynced(notebookDirRef.current, mtimeMs).catch(() => {})
  }, [notebook, updateNotebook])

  const splitTitle = useCallback((raw) => {
    let text = typeof raw === 'string' ? raw : ''
    let title = titleRef.current
    const hm = text.match(/^# (.+)\n/)
    if (hm) { title = hm[1]; text = text.slice(hm[0].length) }
    return { text, title }
  }, [])

  useEffect(() => {
    if (!isLoaded || !notebookId) return
    let stopped = false
    let busy = false

    const check = async () => {
      if (stopped || busy) return
      if (typeof document !== 'undefined' && document.hidden) return
      const p = mdPathRef.current
      if (!p) return
      busy = true
      // perf: this polls the filesystem every 1.5s per open notebook — and the
      // archive lives in iCloud, where a stat can be slow. Suspect for the
      // reading-time stalls when a notebook tab is open alongside the reader.
      const _t0 = window.__perfTask ? performance.now() : 0
      try {
        const mt = await getFileMtimeMs(p)
        if (!mt || mt <= diskMtimeRef.current) return
        const disk = await readNotebookMdAt(p)
        if (!disk || stopped) return
        const { text, title } = splitTitle(disk.text)
        // Same bytes we already hold (our own write, or a touch) — just re-baseline
        if (text === contentRef.current && title === titleRef.current) {
          diskMtimeRef.current = disk.mtimeMs
          return
        }
        // Unsaved local edits + an external change = both are real. Merge them
        // in place, silently: disjoint paragraphs combine, a genuine overlap
        // keeps ours and the other side is kept in history. No prompt, no fork.
        if (contentRef.current !== syncedTextRef.current) {
          const r = mergeSilently(syncedTextRef.current, contentRef.current, text)
          if (r.needsSnapshot) historySnapshot(notebookId, contentRef.current, 'local')
          historySnapshot(notebookId, text, 'remote')
          applyExternal(r.text, title, disk.mtimeMs)
          flushSaveRef.current?.()          // persist the merged result
        } else {
          // No local edits — we simply adopt what arrived. This is the COMMON
          // external case (you aren't typing; Obsidian/another device saved),
          // and it previously recorded nothing, so most external edits never
          // showed up in History. Snapshot both sides of the swap.
          historySnapshot(notebookId, syncedTextRef.current, 'local')
          historySnapshot(notebookId, text, 'remote')
          applyExternal(text, title, disk.mtimeMs)
        }
      } catch { /* transient FS error — next tick retries */ }
      finally {
        busy = false
        if (_t0) window.__perfTask('notebookWatcherTick', performance.now() - _t0)
      }
    }

    const iv = setInterval(check, 1500)
    const onWake = () => check()
    window.addEventListener('focus', onWake)
    document.addEventListener('visibilitychange', onWake)
    check()
    return () => {
      stopped = true
      clearInterval(iv)
      window.removeEventListener('focus', onWake)
      document.removeEventListener('visibilitychange', onWake)
    }
  }, [isLoaded, notebookId, applyExternal, splitTitle])

  // ── Wikilink navigation ───────────────────────────────────────────────────
  const handleWikiNav = useCallback((title, type, id) => {
    // Always read fresh state from the store to avoid stale closures
    const s = useAppStore.getState()
    const tabId = paneTabId || s.activeTabId
    const nbs = s.notebooks || []
    const lib = s.library || []
    const sbs = s.sketchbooks || []
    const fds = s.flashcardDecks || []
    if (type === 'notebook') {
      const nb = nbs.find(n => n.id === id)
      if (nb) { s.openNewTab({ view: 'notebook', activeNotebook: nb }) }
      else createAndOpenItem(title, 'notebook')
    } else if (type === 'book') {
      const bk = lib.find(b => b.id === id)
      if (bk) {
        const v = bk.format === 'audiofolder' || bk.format === 'audio' ? 'audio-player' : (bk.format === 'pdf' ? 'pdf' : 'reader')
        s.setActiveBook(bk); s.updateTab(tabId, { view: v, activeBook: bk }); s.setView(v)
      }
    } else if (type === 'sketchbook') {
      const sb = sbs.find(n => n.id === id)
      if (sb) { s.setActiveSketchbook(sb); s.updateTab(tabId, { view: 'sketchbook', activeSketchbook: sb }); s.setView('sketchbook') }
    } else if (type === 'flashcard') {
      const deck = fds.find(d => d.id === id)
      if (deck) { s.setActiveFlashcardDeck(deck); s.updateTab(tabId, { view: 'flashcard', activeFlashcardDeck: deck }); s.setView('flashcard') }
    } else if (type === 'new-sketch') {
      createAndOpenItem(title, 'sketchbook')
    } else if (type === 'new-flash') {
      createAndOpenItem(title, 'flashcard')
    } else {
      createAndOpenItem(title, 'notebook')
    }
  }, [setView, paneTabId]) // eslint-disable-line react-hooks/exhaustive-deps
  wikiNavRef.current  = handleWikiNav
  linkPickRef.current = info => setLinkPicker(info)
  inlineCmdRef.current = inlineCmd  // kept in sync for the stable window keydown listener

  function createAndOpenItem(title, kind) {
    const s = useAppStore.getState()
    const tabId = paneTabId || s.activeTabId
    const now = new Date().toISOString()
    if (kind === 'sketchbook') {
      const newSb = { id: makeId('sb'), title, createdAt: now, updatedAt: now, _isSketchbook: true }
      s.addSketchbook?.(newSb)
      s.persistSketchbooks?.()
      s.setActiveSketchbook(newSb)
      s.updateTab(tabId, { view: 'sketchbook', activeSketchbook: newSb })
      s.setView('sketchbook')
    } else if (kind === 'flashcard') {
      const newFd = { id: makeId('fd'), title, createdAt: now, updatedAt: now, cards: [] }
      s.addDeck?.(newFd)
      s.persistFlashcardDecks?.()
      s.setActiveFlashcardDeck(newFd)
      s.updateTab(tabId, { view: 'flashcard', activeFlashcardDeck: newFd })
      s.setView('flashcard')
    } else {
      const newNb = { id: makeId('nb'), title, createdAt: now, updatedAt: now, wordCount: 0 }
      s.addNotebook?.(newNb) || addNotebook(newNb)
      s.persistNotebooks?.()
      s.setActiveNotebook(newNb)
      s.updateTab(tabId, { view: 'notebook', activeNotebook: newNb })
      s.setView('notebook')
    }
  }

  // ── Study timer — tracks minutes spent in notebook for streak/stats ────────
  useEffect(() => {
    if (!notebook || !isActive) return
    const TICK_MS = 60_000
    const IDLE_MS = 120_000
    let lastActive = Date.now()
    let accumulated = 0
    const onActivity = () => { lastActive = Date.now() }
    window.addEventListener('mousemove', onActivity, { passive: true })
    window.addEventListener('keydown',   onActivity, { passive: true })
    const interval = setInterval(() => {
      if (Date.now() - lastActive < IDLE_MS) {
        accumulated += TICK_MS / 60_000
        if (accumulated >= 1) {
          addReadingMinutes(Math.floor(accumulated)).catch(() => {})
          accumulated -= Math.floor(accumulated)
        }
      }
    }, TICK_MS)
    return () => {
      clearInterval(interval)
      window.removeEventListener('mousemove', onActivity)
      window.removeEventListener('keydown',   onActivity)
      if (accumulated >= 0.1) addReadingMinutes(Math.max(1, Math.round(accumulated))).catch(() => {})
    }
  }, [notebook, isActive])

  // ── Cmd/Ctrl + +/- font size zoom ─────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const handler = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== '+' && e.key !== '=' && e.key !== '-') return
      e.preventDefault()
      const current = useAppStore.getState().nbFontSize ?? 15
      const next = e.key === '-' ? Math.max(11, current - 1) : Math.min(24, current + 1)
      if (next === current) return
      setPref('nbFontSize', next)
      persistPreferences()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [isActive, setPref, persistPreferences])

  // ── Inline cmd dropdown arrow-key navigation ─────────────────────────────
  // Capture phase on window so we fire before CM6 — prevents cursor movement
  // in the editor while the /color /font /spacing /size dropdown is open.
  useEffect(() => {
    const onKey = (e) => {
      const cmd = inlineCmdRef.current
      if (!cmd) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      const count = _getOptionCount(cmd.type)
      if (count === 0) return
      const newIdx = (_inlineCmdSelectedIdx.current + delta + count) % count
      _inlineCmdSelectedIdx.current = newIdx  // sync — must happen before Enter fires
      setInlineCmd(prev => prev ? { ...prev, selectedIdx: newIdx } : prev)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  // ── Mount CodeMirror ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !editorRef.current) return
    let dead = false

    loadCM().then(cm => {
      if (dead || !editorRef.current) return
      cmMods.current = cm
      const {
        state: { EditorState, RangeSetBuilder, Prec, Compartment },
        view: { EditorView, drawSelection, dropCursor, keymap, placeholder },
        commands: { defaultKeymap, indentWithTab, history, historyKeymap },
        language: { indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldKeymap },
        langMd, lezerMd,
        search: { search: searchExt, searchKeymap },
      } = cm

      const isLive    = viewMode === 'live' || viewMode === 'preview'
      const isPreview = viewMode === 'preview'
      const gfmExts = lezerMd?.GFM ? [lezerMd.GFM] : [lezerMd?.Strikethrough, lezerMd?.Table, lezerMd?.TaskList].filter(Boolean)

      // Widget-extension guard — see makeSafeExt's own header comment
      // (notebookEditor.jsx) for the "one throwing widget blanked the whole
      // page" history this exists to prevent.
      const failedExts = []
      const safeExt = makeSafeExt(failedExts)

      const extensions = [
        // Core (not guarded — if these fail, safe mode below catches it)
        makeTheme(cm),
        syntaxHighlighting(makeHighlight(cm)),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        drawSelection(), dropCursor(),
        indentOnInput(), bracketMatching(), history(),
        langMd.markdown({ extensions: gfmExts }),
        // Wikilink dropdown (custom React-driven — bypasses CM6 autocompletion)
        ...safeExt('wiki-dropdown', () => makeWikiDropdownPlugin(cm, notebooks, library, sketchbooks, flashcardDecks, setWikiDrop, () => useAppStore.getState())),
        searchExt({ top: false }),
        ...safeExt('format-keys', () => makeFormatKeys(cm)),
        // /table, /linkf, /linkw, /linkv slash commands (must be before smartEnter)
        ...safeExt('table-command', () => makeTableCommand(cm)),
        ...safeExt('link-commands', () => makeLinkCommands(cm, linkPickRef)),
        // /color, /font, /spacing, /size inline command keymap
        ...safeExt('inline-cmd', () => makeInlineCmdPlugin(cm, inlineCmdNavRef)),
        // {//} auto-close for inline-cmd spans
        ...safeExt('inline-cmd-close', () => makeInlineCmdCloseHandler(cm)),
        ...safeExt('smart-enter', () => makeSmartEnter(cm)),
        // Pair auto-wrap via input handler
        ...safeExt('pair-input', () => makePairInputHandler(cm)),
        // Ghost hint — Tab to accept, any other key dismisses
        ...safeExt('ghost-hint', () => makeGhostHintPlugin(cm)),
        // Math.js inline calculator — shows result after `expr=`. Owns the
        // editor's SINGLE autocompletion(); the slash menu rides in as a source.
        ...safeExt('math-calc', () => makeMathCalcPlugin(cm, viewMode === 'live' ? [makeSlashSource()] : [])),
        // Live decorations (widgets, hiding syntax) — shared between live + preview
        ...(isLive ? safeExt('live-decorations', () => makeLivePlugin(cm, RangeSetBuilder, notebooks, library, sketchbooks, flashcardDecks, notebookDirRef.current, viewMode === 'preview', null, true, questionStoreApi)) : []),
        // Heading fold state field — live mode only (arrow widgets only render there).
        // Empty placeholderDOM: the collapsed section's height simply drops to zero;
        // no "···" marker needed since the fold arrow itself shows the collapsed state.
        ...(viewMode === 'live' ? safeExt('code-folding', () => cm.language.codeFolding({ placeholderDOM: () => document.createElement('span') })) : []),
        // Interaction handlers — live mode only (preview is read-only)
        ...(viewMode === 'live' ? safeExt('interaction-handlers', () => [
          makeCheckboxHandler(cm),
          makeStatusHandler(cm),
          makeHeadingFoldHandler(cm),
          makeWikiHandler(cm, wikiNavRef),
          makeMathClickHandler(cm),
          makeTodoHandler(cm),
          makeTaskHandler(cm),
          makeLinkHandler(cm),
        ]) : []),
        // Source mode: style-only formatting (bold/italic/etc.) without hiding syntax or expanding widgets
        ...(viewMode === 'source' ? safeExt('source-mode', () => makeSourcePlugin(cm)) : []),
        // Let macOS window management shortcuts pass through to the OS.
        // ctrl+arrow = switch spaces; fn+ctrl+arrow = window tiling (Ctrl-Home/End/PageUp/PageDown)
        Prec.highest(keymap.of([
          { key: 'Ctrl-ArrowLeft',  run: () => true, preventDefault: false },
          { key: 'Ctrl-ArrowRight', run: () => true, preventDefault: false },
          { key: 'Ctrl-ArrowUp',    run: () => true, preventDefault: false },
          { key: 'Ctrl-ArrowDown',  run: () => true, preventDefault: false },
          { key: 'Ctrl-Home',       run: () => true, preventDefault: false },
          { key: 'Ctrl-End',        run: () => true, preventDefault: false },
          { key: 'Ctrl-PageUp',     run: () => true, preventDefault: false },
          { key: 'Ctrl-PageDown',   run: () => true, preventDefault: false },
        ])),
        keymap.of([
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
          { key: 'Mod-s', run: () => { flushSave(); return true } },
          { key: 'Mod-f', run: () => { findRef.current?.focus(); findRef.current?.select(); return true } },
        ]),
        // Live Share binding slot — empty unless a share is already active
        // when this editor (re)mounts (viewMode/notebook change while
        // sharing). A fresh Compartment every mount, re-seeded from
        // `collabBitsRef` immediately below, so a remount mid-share doesn't
        // silently drop the binding. Toggling share on/off afterward
        // reconfigures this same compartment directly via `view.dispatch`
        // (see the effect below) — it does NOT remount the editor, so the
        // host never loses cursor/scroll/undo position just from starting
        // or stopping a share.
        (collabCompartmentRef.current = new Compartment()).of(buildCollabExt(collabBitsRef.current)),
        EditorView.updateListener.of(upd => {
          if (dead) return
          if (upd.docChanged) {
            const t = upd.state.doc.toString()
            contentRef.current = t
            scheduleSave(t)
            // Debounce React state update — only needed for wordCount display and previewHtml.
            // Save and cross-tab sync both use contentRef directly, so this doesn't affect them.
            clearTimeout(contentStateTimer.current)
            contentStateTimer.current = setTimeout(() => { if (!dead) setContent(t) }, 300)
          }
          if (upd.selectionSet || upd.docChanged) {
            const sel = upd.state.selection.main
            if (sel && !sel.empty) {
              const selectedText = upd.state.sliceDoc(sel.from, sel.to)
              const wc = (selectedText.match(/\b\w+\b/g) || []).length
              setSelectionWC(wc)
            } else {
              setSelectionWC(0)
            }
          }
          // Track cursor position so the inline-cmd useLayoutEffect can fire
          if (upd.selectionSet || upd.docChanged) {
            setCursorPos(upd.state.selection.main.head)
          }
        }),
        EditorView.lineWrapping,
        placeholder('Create something…'),
        // Image drag-and-drop + paste handler
        // Preview mode — disable keyboard input while keeping programmatic dispatch working
        ...(isPreview ? [EditorView.editable.of(false)] : []),
        EditorView.domEventHandlers({
          drop(e, view) {
            // Capture ALL data transfer payloads synchronously — dataTransfer clears after event
            const dt = e.dataTransfer
            const uriList  = dt?.getData('text/uri-list') || ''
            const htmlData = dt?.getData('text/html') || ''
            const plainData = dt?.getData('text/plain') || ''
            const safariUrl = dt?.getData('URL') || ''          // WKWebView / Safari single-URL type

            // Extract a URL from any available source (in priority order)
            const fromUri  = uriList.trim().split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && /^https?:\/\//i.test(s))[0] || null
            const fromSafari = /^https?:\/\//i.test(safariUrl) ? safariUrl : null
            const htmlSrcMatch = htmlData.match(/<img[^>]+src="(https?:\/\/[^"]+)"/i) || htmlData.match(/<img[^>]+src='(https?:\/\/[^']+)'/i)
            const fromHtml = htmlSrcMatch ? htmlSrcMatch[1] : null
            const fromPlain = /^https?:\/\//i.test(plainData.trim()) ? plainData.trim() : null
            const webUrl = fromUri || fromSafari || fromHtml || fromPlain || null

            const files = e.dataTransfer?.files
            const imgFile = files?.length ? Array.from(files).find(f => f.type.startsWith('image/')) : null

            // Nothing useful to handle
            if (!imgFile && !webUrl) return false
            e.preventDefault()

            const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head

            if (imgFile) {
              const name = imgFile.name || 'image'
              // Tauri exposes .path on File objects from Finder drag-drop —
              // let the Tauri drag-drop event handle those to avoid duplicate insertion
              const filePath = imgFile.path
              if (Date.now() - domDropRef.current < 2000) {
                return true // Tauri handler already inserted this drop
              }
              if (filePath || (_invoke && !webUrl)) {
                return true // Tauri handler will insert the markdown with the correct asset URL
              } else if (webUrl) {
                // Web image file with no local path — use the URL
                domDropRef.current = Date.now()
                view.dispatch({ changes: { from: dropPos, insert: `![${name}](${webUrl})` } })
              } else if (notebook?.id) {
                domDropRef.current = Date.now()
                ;(async () => {
                  // dropPos was captured before this await — doc may have changed
                  // length by now (remote edit, fast local typing), so clamp
                  // against the CURRENT doc rather than trusting it unconditionally.
                  const safePos = () => Math.min(dropPos, view.state.doc.length)
                  try {
                    const buf = new Uint8Array(await imgFile.arrayBuffer())
                    const fname = `${Date.now()}_${imgFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
                    const relPath = await saveNotebookImage(notebook.id, fname, buf)
                    view.dispatch({ changes: { from: safePos(), insert: `![${name}](${relPath || name})` } })
                  } catch {
                    view.dispatch({ changes: { from: safePos(), insert: `![${name}](${name})` } })
                  }
                })()
              } else {
                domDropRef.current = Date.now()
                view.dispatch({ changes: { from: dropPos, insert: `![${name}](${name})` } })
              }
            } else if (webUrl) {
              // Pure URL drop (no file object) — image dragged from browser
              const name = webUrl.split('/').pop().split('?')[0] || 'image'
              domDropRef.current = Date.now()
              view.dispatch({ changes: { from: dropPos, insert: `![${name}](${webUrl})` } })
            }
            return true
          },
          paste(e, view) {
            const items = e.clipboardData?.items
            if (!items) return false
            // If clipboard has text, let the default paste handle it
            const hasText = Array.from(items).some(i => i.type === 'text/plain')
            if (hasText) return false
            const imgItem = Array.from(items).find(i => i.type.startsWith('image/'))
            if (!imgItem || !notebook?.id) return false
            const blob = imgItem.getAsFile()
            if (!blob) return false
            e.preventDefault()
            // Handle async image save without blocking — already prevented default
            ;(async () => {
              const buf = new Uint8Array(await blob.arrayBuffer())
              const fname = `${Date.now()}_paste.${blob.type.split('/')[1] || 'png'}`
              const relPath = await saveNotebookImage(notebook.id, fname, buf)
              if (relPath) {
                const pos = view.state.selection.main.head
                const md = `![pasted image](${relPath})`
                view.dispatch({ changes: { from: pos, insert: md } })
              }
            })()
            return true  // synchronously return true — we've already called preventDefault
          },
        }),
      ]

      if (cmRef.current) { cmRef.current.destroy(); cmRef.current = null }

      // SAFE MODE: if the full extension set still fails to mount (a core
      // extension threw, or EditorState rejected the config), fall back to a
      // minimal-but-working editor instead of the historical blank page.
      let view
      try {
        const state = EditorState.create({ doc: contentRef.current, extensions })
        view = new EditorView({ state, parent: editorRef.current })
        if (failedExts.length) setNbError(`Some editor widgets failed to load and were disabled: ${failedExts.join(', ')}.`)
      } catch (err) {
        console.error('[Notebook] editor failed to start with full extensions — SAFE MODE:', err)
        setNbError(`Editor started in safe mode (widgets disabled): ${err?.message || err}`)
        const safeState = EditorState.create({
          doc: contentRef.current,
          extensions: [
            makeTheme(cm),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            drawSelection(), history(),
            langMd.markdown({ extensions: gfmExts }),
            keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
            EditorView.updateListener.of(upd => {
              if (dead || !upd.docChanged) return
              const t = upd.state.doc.toString()
              contentRef.current = t
              scheduleSave(t)
            }),
          ],
        })
        view = new EditorView({ state: safeState, parent: editorRef.current })
      }
      cmRef.current = view
      if (!isPreview) view.focus()
    })

    return () => {
      dead = true
      clearTimeout(contentStateTimer.current)
      if (cmRef.current) { cmRef.current.destroy(); cmRef.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, viewMode, notebook?.id])

  // ── Inline command dropdown detection ─────────────────────────────────────
  // useLayoutEffect fires after React's DOM mutations, before paint — exactly
  // when coordsAtPos is reliable. cursorPos changes on every keystroke/cursor move.
  const INLINE_CMD_RE = /^\s*\/(color|font|spacing|size|align|columns|bold|italic|bi|strike|highlight|code|sup|sub)(?::([^\s]*))?$/
  useLayoutEffect(() => {
    const view = cmRef.current
    if (!view) { setInlineCmd(null); return }
    const cur = view.state.selection.main.head
    const line = view.state.doc.lineAt(cur)
    const m = line.text.match(INLINE_CMD_RE)
    if (!m) {
      setInlineCmd(prev => prev ? null : prev)
      return
    }
    const coords = view.coordsAtPos(cur)
    const type = m[1]
    setInlineCmd(prev => ({
      type,
      hint: (m[2] || '').toLowerCase(),
      selectedIdx: prev?.type === type ? (prev.selectedIdx ?? 0) : 0,
      lineFrom: line.from,
      lineTo: line.to,
      coords: coords
        ? { left: coords.left, top: coords.bottom + 6 }
        : { left: 120, top: 160 },
    }))
  }, [cursorPos]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save ──────────────────────────────────────────────────────────────────
  const animateSave = useCallback(() => {
    // Split mode: target this pane's own save icon; else the global one.
    const el = document.getElementById(paneChrome?.saveIconId || 'nb-save-icon')
    if (!el) return
    el.classList.remove('anim', 'vis', 'closing'); void el.offsetWidth
    el.classList.add('anim', 'vis')
    clearTimeout(saveVisT.current)
    saveVisT.current = setTimeout(() => {
      el.classList.remove('anim')
      el.classList.add('closing')
      saveVisT.current = setTimeout(() => el.classList.remove('vis', 'closing'), 450)
    }, 600)
  }, [paneChrome])

  const doSave = useCallback(async (text, title) => {
    if (!notebook) return
    // ── External reference — write straight back to the file; no notebook meta,
    // no folder, no wikilink propagation. Update the ref's title in the store.
    if (notebook._external || (typeof notebook.id === 'string' && notebook.id.startsWith('ext_'))) {
      setSaving(true)
      await saveNotebookContent(notebook, title ? `# ${title}\n${text}` : text)
      syncedTextRef.current = text
      if (mdPathRef.current) diskMtimeRef.current = await getFileMtimeMs(mdPathRef.current)
      const st = useAppStore.getState()
      if (title && title !== notebook.title) st.updateExternalRef?.(notebook.id, { title })
      st.persistExternalRefs?.()
      lastSavedTextRef.current = text
      setSaving(false); animateSave()
      return
    }
    // Conflict guard — if the file changed on disk under us we do NOT overwrite
    // and we do NOT prompt: saveNotebookContent auto-forks the external/offline
    // version into its own note, then writes our edits here. Both are kept. We
    // only fast-path the "disk already equals what we're writing" case so an
    // identical save doesn't spuriously fork.
    const mdPath = mdPathRef.current
    if (mdPath) {
      const mt = await getFileMtimeMs(mdPath)
      if (mt && mt > diskMtimeRef.current) {
        const disk = await readNotebookMdAt(mdPath)
        if (disk) {
          const ext = splitTitle(disk.text)
          if (ext.text === text && ext.title === title) {
            diskMtimeRef.current = disk.mtimeMs   // identical — nothing to fork
          }
          // else: fall through — saveNotebookContent forks the external copy.
        }
      }
    }
    setSaving(true)
    // Periodic history snapshot. Conflict snapshots only fire when something
    // else edited the file, so without this the History panel stays empty during
    // ordinary work — which is exactly what it did. Throttled so an 800ms
    // autosave can't spam it; history.js additionally skips identical text.
    {
      const now = Date.now()
      const AUTO_EVERY_MS = 3 * 60 * 1000
      if (!lastAutoSnapRef.current || now - lastAutoSnapRef.current > AUTO_EVERY_MS) {
        lastAutoSnapRef.current = now
        historySnapshot(notebookId, title ? `# ${title}\n${text}` : text, 'auto')
      }
    }
    // Pass the last text we agreed with disk on as the merge BASE. If the file
    // changed underneath (Obsidian, another device via iCloud, a peer), storage
    // merges the two silently and hands back what it actually wrote.
    const full = title ? `# ${title}\n${text}` : text
    const written = await saveNotebookContent(notebook, full, {
      baseText: titleRef.current ? `# ${titleRef.current}\n${syncedTextRef.current}` : syncedTextRef.current,
    })
    // A merge means the file now holds more than we typed — adopt the result so
    // the editor, the base, and disk all agree. Silent, per the design.
    if (typeof written === 'string' && written !== full) {
      const merged = splitTitle(written)
      applyExternal(merged.text, merged.title, await getFileMtimeMs(mdPathRef.current))
    } else {
      syncedTextRef.current = text
    }
    if (mdPathRef.current) diskMtimeRef.current = await getFileMtimeMs(mdPathRef.current)
    else {
      // First save created the flat file/folder — resolve the path now so the watcher works
      getNotebookMdPath(notebook).then(async p => {
        mdPathRef.current = p
        diskMtimeRef.current = p ? await getFileMtimeMs(p) : 0
      }).catch(() => {})
    }
    const wc = (text.match(/\b\w+\b/g) || []).length
    // Extract earliest due date from content
    const duRe = /::(\d{4}-\d{2}-\d{2}(?:,\d{1,2}:\d{2})?|\d{2}-\d{2}-(?:\d{4}|\d{2})(?:,\d{1,2}:\d{2})?|\d{1,2}:\d{2}|\+\d+[dh])/g
    let dueDate = null, dm
    while ((dm = duRe.exec(text)) !== null) {
      const d = parseDueDate(dm[1])
      if (d && (!dueDate || d < dueDate)) dueDate = d
    }
    // Extract tags ::tagname (letter-start tokens that aren't due dates)
    const tagRe = /::([a-zA-Z][a-zA-Z0-9_-]*)/g
    const tagSet = new Set()
    let tm
    while ((tm = tagRe.exec(text)) !== null) tagSet.add(tm[1].toLowerCase())
    const tags = tagSet.size ? [...tagSet] : null
    const newTitle = title || notebook.title
    const patch = { updatedAt: new Date().toISOString(), wordCount: wc, dueDate: dueDate?.toISOString() || null, tags }
    if (newTitle !== notebook.title) {
      patch.title = newTitle
      // Propagate the rename to wikilinks in all other notebooks
      const oldTitle = notebook.title
      if (oldTitle) {
        const allNbs = useAppStore.getState().notebooks
        const escaped = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const wikilinkRe = new RegExp(`\\[\\[${escaped}\\]\\]`, 'gi')
        for (const nb of allNbs) {
          if (nb.id === notebook.id) continue
          try {
            const raw = await loadNotebookContent(nb.id)
            if (!raw || !wikilinkRe.test(raw)) continue
            wikilinkRe.lastIndex = 0
            const updated = raw.replace(wikilinkRe, `[[${newTitle}]]`)
            await saveNotebookContent(nb, updated)
          } catch { /* non-fatal — skip this notebook */ }
        }
      }
    }
    updateNotebook(notebook.id, patch)
    useAppStore.getState().persistNotebooks?.()
    // Signal other tabs showing the same notebook to pull in the new content
    lastSavedTextRef.current = text
    useAppStore.getState().setNotebookContentCache?.(notebook.id, text)
    setSaving(false); animateSave()
  }, [notebook, updateNotebook, animateSave, splitTitle])

  const scheduleSave = useCallback(text => {
    clearTimeout(saveTimer.current)
    // Show save icon immediately so the user gets instant feedback
    const el = document.getElementById(paneChrome?.saveIconId || 'nb-save-icon')
    if (el && !el.classList.contains('vis')) {
      el.classList.remove('anim', 'closing'); void el.offsetWidth
      el.classList.add('vis')
    }
    saveTimer.current = setTimeout(() => doSave(text, titleRef.current), 800)
  }, [doSave, paneChrome])

  const flushSave = useCallback(() => {
    clearTimeout(saveTimer.current)
    doSave(contentRef.current, titleRef.current)
  }, [doSave])
  flushSaveRef.current = flushSave

  // ── /linkf and /linkv — open Tauri dialog from React effect (NOT from CM handler) ──
  useEffect(() => {
    if (!linkPicker || linkPicker.type === 'web') return
    if (!_dialogOpen) { setLinkPicker(null); return }
    const isVideo = linkPicker.type === 'video'
    const opts = isVideo
      ? { multiple: false, filters: [{ name: 'Video', extensions: ['mp4','mov','avi','mkv','webm','flv','wmv','m4v'] }] }
      : { multiple: false }
    _dialogOpen(opts)
      .then(path => {
        if (path && cmRef.current) {
          const p = String(path)
          const name = p.split(/[/\\]/).pop() || p
          const prefix = isVideo ? 'linkv' : 'linkf'
          cmRef.current.dispatch({
            changes: { from: linkPicker.lineFrom, to: linkPicker.lineTo, insert: `/${prefix}:${p}|${name}` },
          })
        }
      })
      .catch(console.warn)
      .finally(() => setLinkPicker(null))
  }, [linkPicker]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cover picker ──────────────────────────────────────────────────────────
  const cancelPicker = useCallback(() => {
    setCoverPicker(p => {
      if (p?.objectUrl && !p.isEdit) URL.revokeObjectURL(p.objectUrl)
      return null
    })
  }, [])

  const openPickerForEdit = useCallback(() => {
    if (!coverImage) return
    setCoverPicker({
      objectUrl: coverImage,
      file: null,
      isEdit: true,
      pos: { ...coverPos },
      scale: coverScale,
    })
  }, [coverImage, coverPos, coverScale])

  const applyPicker = useCallback(async () => {
    const picker = coverPicker
    if (!picker) return
    const { file, objectUrl, isEdit, pos, scale } = picker
    const newScale = Math.max(1, scale ?? 1)
    try {
      if (!isEdit) {
        const buf = await file.arrayBuffer()
        const ext = file.name.split('.').pop() || 'jpg'
        const relPath = await saveNotebookImage(notebookId, `cover.${ext}`, new Uint8Array(buf))
        if (relPath && _convertFileSrc && notebookDirRef.current) {
          const absPath = relPath.startsWith('./') ? notebookDirRef.current + '/' + relPath.slice(2) : relPath
          setCoverImage(_convertFileSrc(absPath) + `?v=${Date.now()}`)
        }
        updateNotebook(notebookId, { coverImage: relPath, coverPos: pos, coverScale: newScale })
      } else {
        updateNotebook(notebookId, { coverPos: pos, coverScale: newScale })
      }
      setCoverPos(pos)
      setCoverScale(newScale)
      useAppStore.getState().persistNotebooks?.()
    } catch (err) {
      console.error('[NotebookView] cover apply failed:', err)
    }
    if (!isEdit) URL.revokeObjectURL(objectUrl)
    setCoverPicker(null)
  }, [coverPicker, notebookId, updateNotebook])

  // ── Ctrl+F ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const h = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
        setTimeout(() => { findRef.current?.focus(); findRef.current?.select() }, 30)
      }

    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isActive])

  // ── Tauri native file drop (Finder drag-and-drop) ───────────────────────────
  useEffect(() => {
    if (!notebook?.id) return
    let mounted = true
    const unlisteners = []
    let lastDropTime = 0

    const handleDrop = async (event) => {
      const now = Date.now()
      if (now - lastDropTime < 300) return
      if (now - domDropRef.current < 2000) return  // DOM handler already inserted this drop
      lastDropTime = now
      const payload = event.payload
      // Tauri 2 drag-drop payload: { paths: string[], position: {x,y} }
      const paths = payload?.paths || (Array.isArray(payload) ? payload : null)
      const dropPos2d = payload?.position ?? null
      if (!paths?.length || !cmRef.current) return
      const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
      for (const p of paths) {
        if (!IMG_EXT.test(p)) continue
        try {
          const name = p.split('/').pop().split('\\').pop()
          // Use drop coordinates if available (Finder drag-drop), else cursor position
          let pos = cmRef.current.state.selection.main.head
          if (dropPos2d) {
            const fromCoords = cmRef.current.posAtCoords({ x: dropPos2d.x, y: dropPos2d.y })
            if (fromCoords != null) pos = fromCoords
          }
          // Copy the file into the notebook's images folder for portable storage
          let mdPath = null
          if (notebook?.id) {
            try {
              const { readFile } = await import('@tauri-apps/plugin-fs')
              const bytes = await readFile(p)
              const fname = `${Date.now()}_${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
              mdPath = await saveNotebookImage(notebook.id, fname, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
            } catch (copyErr) { console.warn('[Gnos] image copy failed:', copyErr) }
          }
          const ref = mdPath || (_convertFileSrc ? _convertFileSrc(p) : p)
          const md = `![${name}](${ref})\n`
          domDropRef.current = Date.now()
          cmRef.current.dispatch({ changes: { from: pos, insert: md } })
        } catch (err) { console.warn('[Gnos] File drop error:', p, err) }
      }
    }

    // Tauri 2 drag-drop event (tauri://drag-drop is the correct v2 name)
    listen('tauri://drag-drop', handleDrop).then(u => { if (mounted) unlisteners.push(u); else u() }).catch(() => {})
    listen('tauri://drag', () => {}).then(u => { if (mounted) unlisteners.push(u); else u() }).catch(() => {})

    return () => { mounted = false; unlisteners.forEach(u => u?.()) }
  }, [notebook?.id])

  // ── Find in preview / live ──────────────────────────────────────────────────
  function doFind(q) {
    // Live / preview mode — use CodeMirror's built-in search highlighting
    if ((viewMode === 'live' || viewMode === 'preview') && cmRef.current && cmMods.current) {
      const searchMod = cmMods.current.search
      const view = cmRef.current
      if (!q) {
        view.dispatch({ effects: searchMod.setSearchQuery.of(new searchMod.SearchQuery({ search: '' })) })
        setFindCount(0); setFindCurD(0)
        hitsRef.current = []; return
      }
      const query = new searchMod.SearchQuery({ search: q, caseSensitive: false })
      view.dispatch({ effects: searchMod.setSearchQuery.of(query) })
      // Count matches by iterating the query cursor
      const cursor = query.getCursor(view.state.doc)
      let count = 0
      while (!cursor.next().done) count++
      hitsRef.current = Array(count) // placeholder array for length
      hitIdxRef.current = 0
      setFindCount(count)
      setFindCurD(0)
      if (count > 0) searchMod.findNext(view)
      return
    }

    // Preview mode — DOM text search
    const el = previewRef.current
    if (!el || !q) {
      el?.querySelectorAll('mark.nb-fhl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)))
      hitsRef.current = []; return
    }
    el.querySelectorAll('mark.nb-fhl').forEach(m => m.replaceWith(document.createTextNode(m.textContent)))
    el.normalize()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const hits = []; let node
    while ((node = walker.nextNode())) {
      const text = node.nodeValue
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi')
      let m, last = 0; const frags = []
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frags.push(document.createTextNode(text.slice(last, m.index)))
        const mark = document.createElement('mark'); mark.className = 'nb-fhl'; mark.textContent = m[0]
        frags.push(mark); hits.push(mark); last = m.index + m[0].length
      }
      if (frags.length) {
        if (last < text.length) frags.push(document.createTextNode(text.slice(last)))
        node.parentNode?.replaceChild(frags.reduce((f, n2) => { const df = document.createDocumentFragment(); df.appendChild(f instanceof DocumentFragment ? f : (() => { const ff = document.createDocumentFragment(); ff.appendChild(f); return ff })()) ; df.appendChild(n2); return df }, document.createDocumentFragment()), node)
      }
    }
    hitsRef.current = hits; hitIdxRef.current = 0
    setFindCount(hits.length); setFindCurD(0)
    if (hits[0]) { hits[0].classList.add('nb-fhl-a'); hits[0].scrollIntoView({ block:'center', behavior:'smooth' }) }
  }

  function findNav(dir) {
    // Live / preview mode — use CodeMirror findNext / findPrevious
    if ((viewMode === 'live' || viewMode === 'preview') && cmRef.current && cmMods.current) {
      const searchMod = cmMods.current.search
      const view = cmRef.current
      if (dir > 0) searchMod.findNext(view)
      else searchMod.findPrevious(view)
      hitIdxRef.current = (hitIdxRef.current + dir + findCount) % Math.max(findCount, 1)
      setFindCurD(hitIdxRef.current)
      return
    }
    // Preview mode
    const hits = hitsRef.current
    if (!hits.length) return
    hits[hitIdxRef.current]?.classList.remove('nb-fhl-a')
    hitIdxRef.current = (hitIdxRef.current + dir + hits.length) % hits.length
    setFindCurD(hitIdxRef.current)
    hits[hitIdxRef.current]?.classList.add('nb-fhl-a')
    hits[hitIdxRef.current]?.scrollIntoView({ block:'center', behavior:'smooth' })
  }

  const wordCount = useMemo(() => (content.match(/\b\w+\b/g) || []).length, [content])

  // Whether the doc currently has a `/math` calc zone (open or a closed pair).
  // Drives the ∑ indicator in the top-left of the editor area. Mirrors computeMathZones.
  const hasMathZone = useMemo(() => {
    let open = false, any = false
    for (const raw of content.split('\n')) {
      const t = raw.trim()
      if (!open) { if (/^\/math$/i.test(t)) open = true }
      else if (/^(?:\/math\s+end|\/endmath)$/i.test(t)) { open = false; any = true }
    }
    return open || any
  }, [content])

  // Word count lives in the title-bar search bar
  useTitlebarMeta({
    text: selectionWC > 0
      ? `${selectionWC} of ${wordCount.toLocaleString()} words`
      : `${wordCount.toLocaleString()} words`,
  })

  const isMobile = useIsMobile()

  const switchModeRef = useRef(null)

  // Mobile event bridge — listen for commands from bottom nav / settings float btn
  useEffect(() => {
    if (!isMobile) return
    const h = e => {
      const { cmd } = e.detail || {}
      if (cmd === 'live-toggle') switchModeRef.current?.()
      if (cmd === 'live-menu') setShowMobileViewMenu(true)
      if (cmd === 'search') window.dispatchEvent(new CustomEvent('gnos:mobile-nb-search-open'))
      if (cmd === 'settings') setEditModal(true)
      if (cmd === 'insert') {
        const cm = cmRef.current; if (!cm) return
        const { before = '', after = '', placeholder = '' } = e.detail || {}
        const sel = cm.state.selection.main
        const selected = cm.state.sliceDoc(sel.from, sel.to)
        const text = selected ? `${before}${selected}${after}` : `${before}${placeholder}${after}`
        cm.dispatch({ changes: { from: sel.from, to: sel.to, insert: text },
                      selection: { anchor: sel.from + (selected ? text.length : before.length),
                                   head: sel.from + (selected ? text.length : before.length + placeholder.length) } })
        cm.focus()
      }
    }
    window.addEventListener('gnos:mobile-nb-cmd', h)
    return () => window.removeEventListener('gnos:mobile-nb-cmd', h)
  }, [isMobile])

  const switchMode = useCallback((m) => {
    if (m === viewMode) return
    if (cmRef.current) {
      const t = cmRef.current.state.doc.toString()
      contentRef.current = t; setContent(t)
    }
    setVM(m)
  }, [viewMode])
  switchModeRef.current = () => switchMode(viewMode === 'source' ? 'live' : 'source')

  useEffect(() => {
    if (!isMobile) return
    window.dispatchEvent(new CustomEvent('gnos:nb-viewmode', { detail: { mode: viewMode } }))
  }, [viewMode, isMobile])

  useEffect(() => {
    if (!isMobile) return
    const h = e => doFind(e.detail || '')
    window.addEventListener('gnos:mobile-nb-search-query', h)
    return () => window.removeEventListener('gnos:mobile-nb-search-query', h)
  }, [isMobile])

  const handlePreviewClick = useCallback(e => {
    const wl = e.target.closest('[data-wl-type]')
    if (wl) handleWikiNav(wl.dataset.wlTitle, wl.dataset.wlType, wl.dataset.wlId)
    const cb = e.target.closest('.nb-cb')
    if (cb && previewRef.current) {
      const ti = parseInt(cb.dataset.ti, 10)
      const lines = contentRef.current.split('\n')
      let taskIdx = 0
      const newLines = lines.map(l => {
        if (!/^\s*[-*+]\s\[[ xX]\]/.test(l)) return l
        if (taskIdx++ !== ti) return l
        return /\[[xX]\]/.test(l) ? l.replace(/\[[xX]\]/, '[ ]') : l.replace(/\[ \]/, '[x]')
      })
      const newContent = newLines.join('\n')
      contentRef.current = newContent; setContent(newContent)
      scheduleSave(newContent)
    }
  }, [handleWikiNav, scheduleSave])

  // ─── CSS ──────────────────────────────────────────────────────────────────
  const CSS = `
    /* ── KaTeX theming ─────────────────────────────────── */
    .katex { color: var(--text) !important; font-size: 1.05em; }
    .katex-display { margin: 0.4em 0 !important; }
    .katex-display > .katex { color: var(--text) !important; }

    /* ── MathQuill / KaTeX ─────────────────────────────── */
    .mq-math-mode { color: var(--text) !important; }
    .mq-root-block, .mq-math-mode * { font-family: 'KaTeX_Main', 'Times New Roman', serif !important; }
    @keyframes vm-drop { from{opacity:0;transform:translateY(-6px) scale(.96)} to{opacity:1;transform:none} }

    /* ── Light-mode selection fix ──────────────────────── */
    .nb-root ::selection { background: var(--nb-sel, color-mix(in srgb, var(--accent) 28%, transparent)); }
    [data-theme="light"] .nb-root, .light .nb-root { --nb-sel: rgba(9,105,218,0.22); }

    /* ══════════════════════════════════════════════════════
       SHARED PROSE VARIABLES
       Both live and preview inherit these so typography
       is controlled from one place.
    ══════════════════════════════════════════════════════ */
    .nb-root {
      --nb-fs:   15px;
      --nb-lh:   1.8;
      --nb-ff:   'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif;
      --nb-max:  780px;
      --nb-px:   48px;
      --nb-py:   28px;
      --nb-color: var(--readerText, var(--text));
      --nb-h1: 1.7em; --nb-h2: 1.4em; --nb-h3: 1.15em;
      --nb-h4: 1.05em; --nb-h5: 0.95em; --nb-h6: 0.88em;
      --nb-para-gap: 0.72em;
      /* ── Syntax color palette — defaults, overridden per-theme below ── */
      --nb-bold-color:     var(--text);
      --nb-italic-color:   var(--accent);
      --nb-strike-color:   var(--textDim);
      --nb-h1-color:       var(--text);
      --nb-h2-color:       var(--text);
      --nb-h3-color:       var(--text);
      --nb-h4-color:       var(--text);
      --nb-h5-color:       var(--text);
      --nb-h6-color:       var(--text);
      --nb-quote-color:    var(--textDim);
      --nb-quote-bg:       transparent;
      --nb-quote-border:   var(--accent);
      --nb-link-color:     var(--accent);
      --nb-wikilink-color: var(--accent);
      --nb-hl-bg:          rgba(210,153,34,.28);
      --nb-code-color:     var(--accent);
      --nb-code-bg:        color-mix(in srgb, var(--accent) 12%, transparent);
    }

    /* ── CM host ───────────────────────────────────────── */
    .nb-cm { flex:1; overflow:hidden; position:relative; display:flex; flex-direction:column; }
    .nb-cm .cm-editor { height:100%; flex:1; }
    .nb-cm .cm-scroller { padding: var(--nb-py) 0 60px; box-sizing:border-box; overflow-x: hidden; overflow-y: auto; }
    .nb-cm .cm-content {
      max-width: var(--nb-max); margin: 0 auto;
      padding: 0 var(--nb-px);
      box-sizing: border-box; width: 100%;
      font-family: var(--nb-ff);
      font-size: var(--nb-fs);
      line-height: var(--nb-lh);
      color: var(--nb-color);
    }
    .nb-cm .cm-line { padding: 0; min-height: calc(var(--nb-fs) * var(--nb-lh)); }
    /* Blank lines between paragraphs get the right rhythm */
    .nb-cm .cm-line:empty { min-height: 0.5em; }
    .nb-cm .cm-placeholder { color:var(--textDim); opacity:.45; }
    /* Collapse widget buffer gaps without hiding from layout — display:none breaks block widget height */
    .cm-widgetBuffer { height: 0 !important; overflow: hidden; pointer-events: none; }
    /* Hide cursor on lines that contain only block widgets */
    .nb-cm .cm-line:has(.cm-timer-widget),
    .nb-cm .cm-line:has(.cm-pomo-widget),
    .nb-cm .cm-line:has(.cm-todo-block-w),
    .nb-cm .cm-line:has(.cm-task-board-w),
    .nb-cm .cm-line:has(.cm-calendar-widget),
    .nb-cm .cm-line:has(.cm-table-wrap),
    .nb-cm .cm-line:has(.cm-img-wrap) {
      caret-color: transparent;
    }

    /* ── Preview mode — hide cursor, disable interaction ── */
    .nb-preview .cm-content { caret-color: transparent; user-select: none; -webkit-user-select: none; pointer-events: none; cursor: default; }
    .nb-preview .cm-cursor, .nb-preview .cm-cursor-primary { display: none !important; }
    .nb-preview .cm-selectionBackground { display: none !important; }

    /* ── Source mode — same visual classes as live, no hiding ── */
    .nb-source .cm-lv-h1 { font-size: var(--nb-h1); font-weight: 600; line-height: 1.25; font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif; color: var(--nb-h1-color); padding-top: 0.4em; padding-bottom: 0.1em; letter-spacing: -0.3px; }
    .nb-source .cm-lv-h2 { font-size: var(--nb-h2); font-weight: 600; line-height: 1.3; font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif; color: var(--nb-h2-color); padding-top: 0.35em; padding-bottom: 0.1em; letter-spacing: -0.2px; }
    .nb-source .cm-lv-h3 { font-size: var(--nb-h3); font-weight: 600; line-height: 1.4; color: var(--nb-h3-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; padding-top: 0.3em; }
    .nb-source .cm-lv-h4 { font-size: var(--nb-h4); font-weight: 600; color: var(--nb-h4-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }
    .nb-source .cm-lv-h5 { font-size: var(--nb-h5); font-weight: 600; color: var(--nb-h5-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }
    .nb-source .cm-lv-h6 { font-size: var(--nb-h6); font-weight: 600; opacity:.65; color: var(--nb-h6-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }
    .nb-source .cm-lv-b   { font-weight:700; color: var(--nb-bold-color); }
    .nb-source .cm-lv-i   { font-style:italic; color: var(--nb-italic-color); }
    .nb-source .cm-lv-s   { text-decoration:line-through; opacity:.75; color: var(--nb-strike-color); }
    .nb-source .cm-lv-c   { font-family: SF Mono,Menlo,Consolas,monospace; font-size:.87em; background: var(--nb-code-bg); border-radius:4px; padding:1px 4px; color: var(--nb-code-color); }
    .nb-source .cm-lv-lnk { color: var(--nb-link-color); text-decoration:underline; text-underline-offset:2px; }
    .nb-source .cm-lv-hl  { background: var(--nb-hl-bg); border-radius:2px; padding:0 2px; }
    .nb-source .cm-lv-bq  { border-left: 3px solid var(--nb-quote-border); padding-left: 14px; color: var(--nb-quote-color); background: var(--nb-quote-bg); font-style: italic; }
    .nb-source .cm-lv-cb  { background: var(--surfaceAlt); font-family: SF Mono,Menlo,Consolas,monospace; font-size:.87em; padding: 0 8px; border-radius: 3px; color: var(--text); }

    /* ── Hidden syntax markers (Obsidian style — font-size:0 not replace) ── */
    .nb-live .cm-lv-hidden {
      font-size: 0 !important;
      line-height: 0 !important;
      display: inline-block;
      width: 0;
      overflow: hidden;
    }

    /* ── Inline styled spans ({color:X}, {font:X}, {spacing:X}) ── */
    .cm-inline-styled { /* styles applied via inline style attribute */ }

    /* ══════════════════════════════════════════════════════
       LIVE VIEW — line-level class decorations
       These must match the .nb-prev selectors exactly.
    ══════════════════════════════════════════════════════ */

    /* Heading fold arrow — parked in the left gutter, out of the text flow, so
       every heading's text lines up with the body text and the arrows form one
       consistent column regardless of heading level (was inline, shifting each
       heading right by the arrow's width). */
    .nb-live .cm-line.cm-lv-h1,
    .nb-live .cm-line.cm-lv-h2,
    .nb-live .cm-line.cm-lv-h3,
    .nb-live .cm-line.cm-lv-h4,
    .nb-live .cm-line.cm-lv-h5,
    .nb-live .cm-line.cm-lv-h6 { position: relative; }
    .cm-fold-arrow {
      position: absolute; left: -22px; top: 0; bottom: 0;
      display: inline-flex; align-items: center; justify-content: center;
      width: 16px; height: 100%;
      color: var(--textDim); cursor: pointer; border-radius: 3px;
      transition: transform .12s ease, color .12s, background .12s;
    }
    .cm-fold-arrow svg { transition: transform .12s ease; }
    .cm-fold-arrow.cm-fold-arrow-open svg { transform: rotate(90deg); }
    .cm-fold-arrow:hover { color: var(--text); background: var(--surfaceAlt); }
    /* Narrow the gutter reach on small screens so the arrow doesn't clip out */
    @media (max-width: 640px) { .cm-fold-arrow { left: -18px; } }

    /* Headings — weight, size, rhythm identical to preview */
    .nb-live .cm-lv-h1 {
      font-size: var(--nb-h1); font-weight: 600; line-height: 1.25;
      font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif; color: var(--nb-h1-color);
      margin-top: 0; padding-top: 0.4em; padding-bottom: 0.1em;
      letter-spacing: -0.3px;
    }
    .nb-live .cm-lv-h2 {
      font-size: var(--nb-h2); font-weight: 600; line-height: 1.3;
      font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif; color: var(--nb-h2-color);
      padding-top: 0.35em; padding-bottom: 0.1em;
      letter-spacing: -0.2px;
    }
    .nb-live .cm-lv-h3 {
      font-size: var(--nb-h3); font-weight: 600; line-height: 1.4; color: var(--nb-h3-color);
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
      padding-top: 0.3em;
    }
    .nb-live .cm-lv-h4 { font-size: var(--nb-h4); font-weight: 600; color: var(--nb-h4-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }
    .nb-live .cm-lv-h5 { font-size: var(--nb-h5); font-weight: 600; color: var(--nb-h5-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }
    .nb-live .cm-lv-h6 { font-size: var(--nb-h6); font-weight: 600; opacity:.65; color: var(--nb-h6-color); font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif; }

    /* Inline formats — exact match to preview */
    .nb-live .cm-lv-b  { font-weight:700; color: var(--nb-bold-color); }
    .nb-live .cm-lv-i  { font-style:italic; color: var(--nb-italic-color); }
    .nb-live .cm-lv-bi { font-weight:700; font-style:italic; color: var(--nb-bi-color); }
    .nb-live .cm-lv-s  { text-decoration:line-through; opacity:.75; color: var(--nb-strike-color); }
    .nb-live .cm-lv-c  {
      font-family: SF Mono,Menlo,Consolas,monospace; font-size:.87em;
      background: var(--nb-code-bg); border-radius:4px; padding:1px 4px; color: var(--nb-code-color);
    }
    .nb-live .cm-lv-lnk { color: var(--nb-link-color); text-decoration:underline; text-underline-offset:2px; }
    .nb-live .cm-lv-hl  { background: var(--nb-hl-bg); border-radius:2px; padding:0 2px; }

    /* Due-date badge */
    .cm-due-badge {
      display: inline-flex; align-items: center;
      font-size: 0.7em; font-weight: 700; letter-spacing: .04em;
      padding: 1px 7px 2px; border-radius: 6px; line-height: 1.7;
      background: rgba(80,100,255,0.18); color: var(--accent);
      border: 1.5px solid rgba(80,100,255,0.40); vertical-align: middle;
      cursor: default; user-select: none; font-family: inherit;
    }
    .cm-due-badge.cm-due-today {
      background: rgba(190,100,0,0.18); color: #b87000;
      border-color: rgba(190,100,0,0.42);
    }
    .cm-due-badge.cm-due-overdue {
      background: rgba(200,30,30,0.18); color: #c02020;
      border-color: rgba(200,30,30,0.42);
    }
    .cm-tag-badge {
      display: inline-flex; align-items: center;
      font-size: 0.7em; font-weight: 600; letter-spacing: .02em;
      padding: 1px 6px 2px; border-radius: 5px; line-height: 1.7;
      background: var(--surfaceAlt); color: var(--textDim);
      border: 1px solid var(--border); vertical-align: middle;
      cursor: default; user-select: none; font-family: inherit;
    }

    /* status:: badge — clickable, cycles Todo/Doing/Blocked/Review/Done */
    .cm-status-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.7em; font-weight: 700; letter-spacing: .02em;
      padding: 1px 7px 2px; border-radius: 6px; line-height: 1.7;
      border: 1.5px solid; vertical-align: middle;
      cursor: pointer; user-select: none; font-family: inherit;
      transition: opacity .1s;
    }
    .cm-status-badge:hover { opacity: .78; }
    .cm-status-badge svg { flex-shrink: 0; }
    .cm-status-label { white-space: nowrap; }
    .nb-status-badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: .8em; font-weight: 700; letter-spacing: .02em;
      padding: 2px 8px 3px; border-radius: 6px; border: 1.5px solid;
      margin: .2em 0;
    }
    .nb-status-badge svg { flex-shrink: 0; }

    .cm-time-badge {
      display: inline-flex; align-items: center;
      font-size: 0.7em; font-weight: 700; letter-spacing: .02em;
      padding: 1px 6px 2px; border-radius: 5px; line-height: 1.7;
      background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); vertical-align: middle;
      cursor: default; user-select: none; font-family: inherit;
    }

    /* Blockquote — left border + italic + dim, matching preview */
    .nb-live .cm-lv-bq {
      border-left: 3px solid var(--nb-quote-border);
      padding-left: 14px;
      color: var(--nb-quote-color);
      background: var(--nb-quote-bg);
      margin-left: 0;
      font-style: italic;
    }

    /* Code block lines — monospace, slightly dimmed bg */
    .nb-live .cm-lv-cb {
      background: var(--surfaceAlt);
      font-family: SF Mono,Menlo,Consolas,monospace;
      font-size: .87em;
      padding: 0 8px;
      border-radius: 3px;
      color: var(--text);
    }

    /* ── Visible syntax markers when cursor is on them ── */
    .nb-live .cm-lv-p  { opacity: 0.32; color: var(--textDim); font-size: .88em; }

    /* Heading # shown dim when cursor on that line */
    .nb-live .cm-lv-h1 .cm-lv-p,
    .nb-live .cm-lv-h2 .cm-lv-p,
    .nb-live .cm-lv-h3 .cm-lv-p,
    .nb-live .cm-lv-h4 .cm-lv-p,
    .nb-live .cm-lv-h5 .cm-lv-p,
    .nb-live .cm-lv-h6 .cm-lv-p {
      color: var(--accent); opacity: 0.45; font-size: 0.68em;
      vertical-align: middle; font-weight: 400;
    }
    /* Bold markers shown */
    .nb-live .cm-lv-b  .cm-lv-p,
    .nb-live .cm-lv-bi .cm-lv-p { color: var(--nb-bold-color); font-weight:700; opacity: 0.38; font-size: 1em; }
    /* Italic markers shown */
    .nb-live .cm-lv-i  .cm-lv-p { color: var(--nb-italic-color); font-style:italic; opacity: 0.42; font-size: 1em; }
    /* Code markers shown */
    .nb-live .cm-lv-c  .cm-lv-p { color: var(--accent); opacity: 0.45; font-size: 1em; }
    /* Strikethrough shown */
    .nb-live .cm-lv-s  .cm-lv-p { color: var(--textDim); opacity: 0.42; font-size: 1em; }
    /* Highlight shown */
    .nb-live .cm-lv-hl .cm-lv-p { color: #d29922; opacity: 0.48; font-size: 1em; }
    /* Link markers shown */
    .nb-live .cm-lv-lnk .cm-lv-p { color: var(--accent); opacity: 0.42; font-size: 1em; }

    /* ── Widgets ─────────────────────────────────────── */
    /* HR widget */
    .cm-hr  { display:block; height:1px; background:var(--border); margin:8px 0; width:100%; pointer-events:none; }

    /* Image widget */
    .cm-img-wrap { display:block; margin:6px 0; line-height:0; background:none; box-shadow:none; }
    .cm-img { max-width:100%; max-height:340px; border-radius:6px; object-fit:contain; display:block; background:none; }
    /* An SVG authored with only a viewBox (no width/height attributes) has no
       intrinsic size. Inside a width:fit-content wrapper that resolves
       circularly to 0x0 — the image loads fine but renders invisibly. Give such
       images a definite width to size against. */
    /* Only stretch when JS hasn't given the wrapper an explicit width — an
       inline width means the user sized the image, and the wrapper must hug it
       so the resize handle / align bar stay on the image's corners. */
    .cm-img-wrap:has(.cm-img[src*=".svg"]):not([style*="width"]) { width:100%; }
    .cm-img-wrap.cm-img-nosize:not([style*="width"]) { width:100%; }
    .cm-img-wrap.cm-img-nosize .cm-img { width:100%; height:auto; max-height:70vh; }
    /* Alignment controls — revealed on hover, like the resize handle */
    .cm-img-align-bar {
      position:absolute; top:6px; left:6px; display:flex; gap:2px;
      opacity:0; transition:opacity .12s; pointer-events:none;
    }
    .cm-img-wrap:hover .cm-img-align-bar { opacity:1; pointer-events:auto; }
    .cm-img-align-btn {
      width:22px; height:22px; line-height:1; padding:0; cursor:pointer;
      border:1px solid var(--border); border-radius:5px;
      background:color-mix(in srgb, var(--surface) 88%, transparent);
      color:var(--textDim); font-size:12px; font-family:inherit;
      -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px);
    }
    .cm-img-align-btn:hover { color:var(--text); background:var(--surfaceAlt); }
    .cm-img-align-btn.active { color:var(--bg); background:var(--accent); border-color:var(--accent); }
    /* A floated image must not overlap the controls' hit area */
    .cm-img-wrap { position:relative; }

    .cm-img-err { display:inline-block; padding:4px 8px; background:var(--surfaceAlt); border:1px dashed var(--border); border-radius:4px; font-size:12px; color:var(--textDim); }
    .cm-img-asset-ph { display:block; padding:10px 14px; margin:4px 0; background:var(--surfaceAlt); border:1px dashed var(--border); border-radius:6px; font-size:12px; color:var(--textDim); }

    /* Checkbox widget */
    .cm-cb  { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border:1.5px solid var(--border); border-radius:3px; font-size:9px; vertical-align:middle; margin-right:5px; cursor:pointer; flex-shrink:0; color:transparent; transition:background .1s; }
    .cm-cb-on { background:var(--accent); border-color:var(--accent); color:var(--bg); }

    /* Wikilink widget */
    .cm-wl { color:var(--nb-wikilink-color,var(--accent)); border-bottom:1px solid var(--nb-wikilink-color,var(--accent)); cursor:pointer; border-radius:2px; padding:0 1px; }
    .cm-wl:hover { opacity:.8; }
    .cm-wl-new { color:var(--textDim); border-bottom-color:var(--textDim); opacity:.75; }
    .cm-wl-unavailable { color:var(--textDim); border-bottom:1px dashed var(--textDim); opacity:.6; cursor:default; }

    /* Link widget — rendered as a proper anchor when cursor is off it */
    .cm-link-widget {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
      border-radius: 2px;
      padding: 0 1px;
    }
    .cm-link-widget:hover { opacity: .75; }

    /* Math widgets */
    .cm-math-mq { cursor: pointer; padding: 0 2px; }
    .cm-math-inline {
      display:inline-block; vertical-align:middle;
      color:var(--text); cursor:pointer;
      padding: 0 2px;
    }
    .cm-math-inline:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius:3px; }
    .cm-math-block {
      display:block; text-align:center; margin:0.5em 0;
      overflow-x:auto; color:var(--text); padding:4px 0;
      cursor:pointer;
    }
    .cm-math-block:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); border-radius:4px; }

    /* ── Table widget in live view ── */
    .cm-table-outer { padding: 5px 0 7px; }
    .cm-table-wrap {
      overflow-x: auto; border-radius: 6px;
      border: 1px solid var(--border);
    }
    .cm-table-wrap table.nb-table {
      border-collapse: collapse; width: auto; min-width: 100%; font-size: .92em;
    }
    .cm-table-wrap table.nb-table th,
    .cm-table-wrap table.nb-table td {
      border-right: 1px solid var(--borderSubtle);
      border-bottom: 1px solid var(--borderSubtle);
      padding: 5px 10px; text-align: left;
      white-space: pre-wrap; word-break: break-word; min-width: 80px;
    }
    .cm-table-wrap table.nb-table th:last-child,
    .cm-table-wrap table.nb-table td:last-child { border-right: none; }
    .cm-table-wrap table.nb-table tr:last-child td { border-bottom: none; }
    .cm-table-wrap table.nb-table th {
      background: var(--surfaceAlt); font-weight: 600; font-size: .85em;
      text-transform: uppercase; letter-spacing: .04em; color: var(--textDim);
      border-bottom: 1px solid var(--border);
    }
    .cm-table-wrap table.nb-table tbody tr:hover td {
      background: color-mix(in srgb, var(--surfaceAlt) 60%, transparent);
    }
    .cm-table-wrap td, .cm-table-wrap th { cursor: text; }
    .cm-table-wrap td:focus, .cm-table-wrap th:focus {
      outline: 2px solid var(--accent); outline-offset: -2px;
      background: color-mix(in srgb, var(--accent) 8%, transparent) !important;
      white-space: pre-wrap;
    }

    /* ── /todo block widget ── */
    .cm-todo-block-w {
      margin: 0.6em 0; border-radius: 10px; overflow: hidden;
      border: 1px solid var(--border); background: var(--surface);
    }
    .cm-todo-hdr-w {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px 6px;
    }
    .cm-todo-title {
      font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer;
      padding: 1px 3px; border-radius: 3px; transition: background .1s;
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }
    .cm-todo-title:hover { background: rgba(128,128,128,.08); }
    .cm-todo-title-inp {
      background: none; border: none; outline: none; font-size: 13px;
      font-weight: 600; color: var(--text); font-family: inherit; width: 100%;
    }
    .cm-todo-hdr-right { display: flex; align-items: center; gap: 6px; }
    .cm-todo-count {
      font-size: 10px; font-weight: 600; color: var(--textDim);
      opacity: .7;
    }
    .cm-todo-progress {
      height: 2px; background: var(--borderSubtle); overflow: hidden;
    }
    .cm-todo-progress-fill {
      height: 100%; background: var(--accent); border-radius: 0 1px 1px 0;
      transition: width .3s ease;
    }
    .cm-todo-progress-done { background: #3fb950; }
    .cm-todo-row {
      display: flex; align-items: center; gap: 8px; padding: 5px 12px;
      transition: background .08s; position: relative;
    }
    .cm-todo-row:hover { background: rgba(128,128,128,.04); }
    .cm-todo-cb {
      width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
      border: 1.5px solid var(--border); cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      transition: background .15s, border-color .15s;
    }
    .cm-todo-cb:hover { border-color: var(--accent); }
    .cm-todo-cb-on {
      background: var(--accent); border-color: var(--accent);
    }
    .cm-todo-text-wrap { flex: 1; min-width: 0; }
    .cm-todo-row-text {
      font-size: 13px; color: var(--text); line-height: 1.5; cursor: default;
    }
    .cm-todo-row-done .cm-todo-row-text { text-decoration: line-through; opacity: .35; color: var(--textDim); }
    .cm-todo-edit-inp {
      background: none; border: none; outline: none; font-size: 13px;
      color: var(--text); font-family: inherit; width: 100%;
    }
    .cm-todo-meta { display: flex; gap: 4px; align-items: center; margin-top: 2px; }
    .cm-todo-date, .cm-todo-time {
      font-size: 9.5px; color: var(--textDim); opacity: .7;
    }
    .cm-todo-actions {
      display: flex; gap: 2px; flex-shrink: 0; align-items: center;
      opacity: 0; transition: opacity .12s;
    }
    .cm-todo-row:hover .cm-todo-actions { opacity: 1; }
    .cm-todo-row:has(.cm-todo-date-btn-set) .cm-todo-actions { opacity: 1; }
    .cm-todo-date-btn {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      padding: 0 2px; border-radius: 3px; line-height: 1; display: flex; align-items: center;
      transition: color .1s; opacity: .5;
    }
    .cm-todo-date-btn:hover { color: var(--accent); opacity: 1; }
    .cm-todo-date-btn.cm-todo-date-btn-set { color: var(--accent); opacity: 0.8; }
    .cm-todo-del-btn {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      font-size: 15px; line-height: 1; padding: 0 2px; border-radius: 3px;
      transition: color .1s;
    }
    .cm-todo-del-btn:hover { color: #f85149; }
    .cm-todo-add-row {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 12px 7px;
    }
    .cm-todo-add-btn {
      width: 22px; height: 22px; border-radius: 5px; flex-shrink: 0;
      background: none; border: 1.5px solid var(--border); color: var(--textDim); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: border-color .12s, color .12s;
    }
    .cm-todo-add-btn:hover { border-color: var(--accent); color: var(--accent); }
    .cm-todo-add-input {
      flex: 1; background: none; border: none; outline: none;
      font-size: 12px; color: var(--text); padding: 2px 0;
      font-family: inherit;
    }
    .cm-todo-add-input::placeholder { color: var(--textDim); opacity: .4; }
    .cm-todo-empty {
      padding: 10px 12px; text-align: center; font-size: 11px;
      color: var(--textDim); opacity: .5;
    }

    /* ── /kanban board widget ── Redesigned to match the standalone Tasks
       board's language (see LibraryView.jsx KanbanCardModal A113-A118):
       hollow color ring instead of a solid-fill header bar, real (non-
       shouty) column titles instead of tiny uppercase caps, unicode × swapped
       for a proper stroke-icon, and font sizes/radii collapsed onto a
       small consistent set (11 meta, 13 body, 8px radius family) instead
       of the previous one-off values (9/10/11/12/13/14px, 4-10px radii). */
    .cm-task-board-w {
      margin: 0.6em 0;
    }
    .cm-task-titlebar {
      display: flex; align-items: center; padding: 10px 14px 6px;
    }
    .cm-task-title-w {
      font-size: 14px; font-weight: 700; color: var(--text);
      font-family: 'Stack Sans Text', 'Switzer', 'Satoshi', sans-serif; letter-spacing: -0.1px;
    }
    .cm-task-cols-w {
      display: flex; gap: 8px; padding: 0 8px 12px;
      align-items: flex-start; overflow: hidden;
    }
    .cm-task-col-w {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
      border-radius: 8px; transition: background .15s;
      overflow: hidden; border: 1px solid var(--borderSubtle);
      background: var(--surfaceAlt);
    }
    .cm-task-col-drop { outline: 2px dashed var(--accent); outline-offset: -2px; }
    .cm-task-col-hdr-w {
      display: flex; align-items: center; gap: 7px; justify-content: space-between;
      padding: 8px 10px; position: relative;
      font-size: 13px; font-weight: 600; color: var(--text);
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
      border-bottom: 1px solid var(--borderSubtle);
    }
    .cm-task-col-hdr-left { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .cm-task-col-ring {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      border: 1.5px solid var(--ring-color, var(--textDim)); box-sizing: border-box;
    }
    .cm-task-col-title { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cm-task-col-title:hover { opacity: .7; }
    .cm-task-col-title-inp {
      background: none; border: none; outline: none; font-size: 13px;
      font-weight: 600; color: var(--text); font-family: inherit; width: 100%;
    }
    .cm-task-col-hdr-right {
      display: flex; align-items: center; gap: 4px; flex-shrink: 0;
    }
    .cm-task-col-w-badge {
      font-size: 11px; background: color-mix(in srgb, var(--text) 10%, transparent);
      color: var(--textDim); border-radius: 8px; padding: 1px 6px; font-weight: 600;
    }
    .cm-task-col-del {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      display: flex; align-items: center; padding: 2px; border-radius: 4px; opacity: 0;
      transition: opacity .1s, color .1s;
    }
    .cm-task-col-hdr-w:hover .cm-task-col-del { opacity: .6; }
    .cm-task-col-del:hover { color: #f85149 !important; opacity: 1 !important; }
    .cm-task-cards-area { padding: 6px 6px 2px; }
    .cm-task-card-w {
      background: var(--surface); border-radius: 8px; margin-bottom: 6px;
      border: 1px solid var(--border);
      font-size: 13px; color: var(--text); transition: box-shadow .12s, opacity .15s;
      cursor: grab; user-select: none;
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
      box-shadow: 0 1px 3px rgba(0,0,0,.06);
    }
    .cm-task-card-w:hover { box-shadow: 0 2px 8px rgba(0,0,0,.12); }
    .cm-task-card-dragging { opacity: .35; cursor: grabbing; }
    .cm-task-card-body {
      display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    }
    .cm-task-card-text { flex: 1; min-width: 0; line-height: 1.4; font-size: 13px; cursor: pointer; }
    .cm-task-card-del-btn {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      display: flex; align-items: center; padding: 2px; border-radius: 4px; opacity: 0;
      transition: opacity .1s, color .1s; flex-shrink: 0;
    }
    .cm-task-card-w:hover .cm-task-card-del-btn { opacity: 0.5; }
    .cm-task-card-del-btn:hover { opacity: 1 !important; color: #f85149; }
    .cm-task-card-date-row {
      display: flex; align-items: center; gap: 4px;
      padding: 0 10px 8px;
    }
    .cm-task-card-date-badge {
      font-size: 11px; color: var(--accent); cursor: pointer;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      border-radius: 4px; padding: 1px 6px; font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    .cm-task-card-date-badge:hover { opacity: .8; }
    .cm-task-card-date-clear {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      display: flex; align-items: center; padding: 2px; opacity: 0;
      transition: opacity .1s;
    }
    .cm-task-card-w:hover .cm-task-card-date-clear { opacity: 0.5; }
    .cm-task-card-date-clear:hover { opacity: 1 !important; color: #f85149; }
    .cm-task-card-add-date {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      font-size: 11px; padding: 0; opacity: 0; transition: opacity .1s;
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    .cm-task-card-w:hover .cm-task-card-add-date { opacity: 0.45; }
    .cm-task-card-add-date:hover { opacity: 1 !important; color: var(--accent); }
    .cm-task-date-picker {
      position: fixed; z-index: 99999;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 10px; min-width: 210px;
      box-shadow: 0 8px 24px rgba(0,0,0,.2);
    }
    .cm-task-date-hdr { min-height: unset !important; padding: 4px 0 !important; }
    .cm-task-date-blank { background: var(--surface); height: 28px; }
    .cm-task-date-cell {
      text-align: center; height: 28px; line-height: 28px; font-size: 11px;
      color: var(--text); cursor: pointer; border-radius: 0;
      transition: background .1s; background: var(--surface);
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }
    .cm-task-date-cell:hover { background: var(--surfaceAlt); }
    .cm-task-date-today { color: var(--accent); font-weight: 700; }
    .cm-task-date-selected { background: color-mix(in srgb, var(--accent) 15%, transparent) !important; color: var(--accent); font-weight: 600; }
    .cm-task-add-row { padding: 4px 6px 8px; }
    .cm-task-add-input {
      width: 100%; background: transparent; border: 1px dashed var(--borderSubtle);
      border-radius: 8px; outline: none; font-size: 13px; color: var(--text);
      padding: 6px 8px; font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif; box-sizing: border-box;
      transition: border-color .15s, background .15s;
    }
    .cm-task-add-input:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); border-style: solid; background: var(--bg); }
    .cm-task-add-input::placeholder { color: var(--textDim); opacity: .4; }
    .cm-task-add-col {
      min-width: 36px; max-width: 36px; display: flex; align-items: flex-start;
      justify-content: center; padding-top: 8px; flex-shrink: 0;
      position: relative;
    }
    .cm-task-add-col-btn {
      background: transparent; border: 1px dashed var(--borderSubtle); border-radius: 8px;
      color: var(--textDim); font-size: 16px; cursor: pointer; padding: 6px 0;
      transition: color .1s, background .1s, border-color .1s; width: 100%;
    }
    .cm-task-add-col-btn:hover { color: var(--text); background: var(--surfaceAlt); border-color: var(--border); }
    .cm-task-add-col-input {
      width: 140px; background: var(--surface); border: 1px solid var(--focusBorder);
      border-radius: 8px; outline: none; font-size: 13px; color: var(--text);
      padding: 8px 10px; font-family: inherit; box-sizing: border-box;
      position: absolute; right: 0; top: 8px; z-index: 10;
    }

    /* ── /kanban card edit modal — mirrors KanbanCardModal's language:
       17/13/11 type scale, 4px-grid spacing, 8px radius family, white =
       labels/selected-pill/footer-buttons, dim = subtitle/placeholder/
       unselected-pill (LibraryView.jsx A113-A118). ── */
    .cm-task-modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 100000;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(6px);
    }
    .cm-task-modal-box {
      background: var(--surface); border-radius: 16px; width: 440px;
      max-width: calc(100vw - 32px); max-height: calc(100vh - 48px);
      display: flex; flex-direction: column;
      box-shadow: 0 40px 100px rgba(0,0,0,.5); border: 1px solid var(--border);
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    .cm-task-modal-hdr {
      padding: 20px 20px 16px; display: flex; align-items: flex-start;
      justify-content: space-between; gap: 16px; flex-shrink: 0;
    }
    .cm-task-modal-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.01em; line-height: 22px; margin-bottom: 4px; }
    .cm-task-modal-subtitle { font-size: 13px; font-weight: 400; line-height: 18px; color: var(--textDim); }
    .cm-task-modal-close {
      width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--border);
      background: none; color: var(--textDim); cursor: pointer;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: background .1s;
    }
    .cm-task-modal-close:hover { background: var(--surfaceAlt); }
    .cm-task-modal-divider { height: 1px; background: var(--borderSubtle); flex-shrink: 0; }
    .cm-task-modal-body { padding: 20px 20px; display: flex; flex-direction: column; gap: 20px; overflow: auto; }
    .cm-task-modal-label {
      font-size: 11px; font-weight: 600; color: var(--text); text-transform: uppercase;
      letter-spacing: .05em; display: block; margin-bottom: 8px;
    }
    .cm-task-modal-field {
      width: 100%; background: var(--surfaceAlt); border: 1px solid var(--border);
      border-radius: 8px; color: var(--text); font-size: 13px; line-height: 20px;
      padding: 8px 12px; font-family: inherit; outline: none; box-sizing: border-box;
      transition: border-color .12s;
    }
    .cm-task-modal-field:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
    .cm-task-modal-field::placeholder { color: var(--textDim); }
    .cm-task-modal-textarea { resize: none; line-height: 20px; }
    .cm-task-modal-priority { display: flex; gap: 4px; background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 8px; padding: 4px; }
    .cm-task-modal-pri-btn {
      flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
      padding: 6px 8px; border-radius: 6px; border: none; background: none;
      color: var(--textDim); font-size: 11px; font-weight: 600; cursor: pointer;
      font-family: inherit; transition: background .12s, color .12s;
    }
    .cm-task-modal-pri-btn.active { background: var(--surface); color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
    .cm-task-modal-comment-row { display: flex; gap: 8px; align-items: flex-start; }
    .cm-task-modal-comment-avatar {
      width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: var(--bg);
      font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; margin-top: 1px;
    }
    .cm-task-modal-comment-bubble { flex: 1; background: var(--surfaceAlt); border: 1px solid var(--borderSubtle); border-radius: 8px; padding: 8px 12px; position: relative; }
    .cm-task-modal-comment-text { font-size: 13px; color: var(--text); line-height: 18px; padding-right: 16px; }
    .cm-task-modal-comment-meta { font-size: 11px; color: var(--textDim); margin-top: 4px; }
    .cm-task-modal-comment-del { position: absolute; top: 8px; right: 8px; background: none; border: none; color: var(--textDim); cursor: pointer; padding: 2px; line-height: 1; display: flex; }
    .cm-task-modal-comment-del:hover { color: #f85149; }
    .cm-task-modal-footer { padding: 16px 20px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .cm-task-modal-delete {
      display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 8px;
      border: 1px solid rgba(248,81,73,.3); background: rgba(248,81,73,.06); color: #f85149;
      cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit;
      transition: background .12s; flex-shrink: 0;
    }
    .cm-task-modal-delete:hover { background: rgba(248,81,73,.14); }
    .cm-task-modal-actions { flex: 1; display: flex; gap: 8px; }
    .cm-task-modal-cancel {
      flex: 1; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--border);
      background: none; color: var(--text); cursor: pointer; font-size: 13px; font-weight: 600;
      font-family: inherit; transition: background .1s;
    }
    .cm-task-modal-cancel:hover { background: var(--surfaceAlt); }
    .cm-task-modal-save {
      flex: 1; padding: 10px 16px; border-radius: 8px; border: none; background: var(--accent);
      color: #fff; cursor: pointer; font-size: 13px; font-weight: 700; font-family: inherit;
    }
    .cm-task-modal-save:disabled { background: var(--surfaceAlt); color: var(--textDim); cursor: default; opacity: .6; }
    .cm-task-modal-send {
      padding: 8px 16px; border-radius: 8px; border: none; background: var(--accent); color: var(--bg);
      cursor: pointer; font-size: 13px; font-weight: 700; font-family: inherit; flex-shrink: 0;
    }
    .cm-task-modal-send:disabled { opacity: .45; }

    /* ── Date/time picker popup ── */
    .gnos-dtp {
      position: fixed; z-index: 99999;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.22), 0 2px 8px rgba(0,0,0,.12);
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif; font-size: 13px;
      color: var(--text); min-width: 240px; user-select: none;
    }
    .gnos-dtp-nav {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }
    .gnos-dtp-nav-btn {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      font-size: 18px; padding: 2px 8px; border-radius: 6px;
      transition: background .1s, color .1s; line-height: 1;
    }
    .gnos-dtp-nav-btn:hover { background: var(--surfaceAlt); color: var(--text); }
    .gnos-dtp-month-label { font-size: 13px; font-weight: 600; color: var(--text); }
    .gnos-dtp-grid {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px;
      margin-bottom: 10px;
    }
    .gnos-dtp-wday {
      text-align: center; font-size: 10px; font-weight: 600;
      color: var(--textDim); padding: 2px 0; letter-spacing: .04em;
    }
    .gnos-dtp-day {
      text-align: center; padding: 5px 2px; border-radius: 6px;
      cursor: pointer; font-size: 12px; color: var(--text);
      transition: background .1s, color .1s;
    }
    .gnos-dtp-day:not(.gnos-dtp-empty):hover { background: var(--surfaceAlt); }
    .gnos-dtp-empty { cursor: default; }
    .gnos-dtp-today { color: var(--accent); font-weight: 700; }
    .gnos-dtp-selected {
      background: var(--accent) !important; color: var(--bg) !important;
      font-weight: 600; border-radius: 6px;
    }
    .gnos-dtp-time-row {
      display: flex; align-items: center; gap: 8px;
      border-top: 1px solid var(--border); padding-top: 8px; margin-bottom: 8px;
    }
    .gnos-dtp-time-label { font-size: 12px; color: var(--textDim); min-width: 32px; }
    .gnos-dtp-time-inp {
      flex: 1; background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; color: var(--text); font-size: 12px;
      padding: 5px 8px; outline: none; font-family: inherit;
    }
    .gnos-dtp-time-inp:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
    .gnos-dtp-actions {
      display: flex; justify-content: space-between; gap: 6px;
      border-top: 1px solid var(--border); padding-top: 8px;
    }
    .gnos-dtp-clear {
      background: none; border: 1px solid var(--border); border-radius: 7px;
      color: var(--textDim); font-size: 12px; cursor: pointer; padding: 5px 14px;
      font-family: inherit; transition: background .1s, color .1s;
    }
    .gnos-dtp-clear:hover { background: var(--surfaceAlt); color: var(--text); }
    .gnos-dtp-done {
      background: var(--accent); border: none; border-radius: 7px;
      color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;
      padding: 5px 18px; font-family: inherit; transition: opacity .1s;
    }
    .gnos-dtp-done:hover { opacity: .85; }

    /* ── Timer widget — quiet pill, hairline progress, hover controls ── */
    .cm-timer-widget {
      margin: 0.5em 0; padding: 9px 12px; border-radius: 12px;
      border: 1px solid var(--borderSubtle, var(--border));
      background: var(--surfaceAlt, var(--surface));
      display: flex; flex-direction: column; gap: 7px; max-width: 260px;
    }
    .cm-timer-label {
      font-size: 11.5px; font-weight: 500; color: var(--textDim); flex: 1;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cm-timer-row { display: flex; align-items: baseline; gap: 8px; }
    .cm-timer-time {
      font-size: 19px; font-weight: 600; color: var(--text); line-height: 1;
      font-variant-numeric: tabular-nums; cursor: pointer; letter-spacing: .01em;
    }
    .cm-timer-time.cm-timer-done { color: var(--accent); animation: cm-timer-donepulse 1.2s ease-in-out infinite; }
    @keyframes cm-timer-donepulse { 0%, 100% { opacity: 1 } 50% { opacity: .55 } }
    .cm-timer-btn {
      background: none; border: none; border-radius: 6px; padding: 0;
      color: var(--textDim); cursor: pointer; width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center; align-self: center;
      font-size: 11px; opacity: 0; transition: opacity .15s, color .1s, background .1s;
    }
    .cm-timer-btn:first-of-type { margin-left: auto; }
    .cm-timer-widget:hover .cm-timer-btn { opacity: .7; }
    .cm-timer-btn:hover { opacity: 1; color: var(--text); background: var(--hover, var(--surface)); }
    .cm-timer-start { width: auto; padding: 0 14px; font-size: 12px; font-weight: 600; }
    .cm-timer-bar { height: 2px; border-radius: 1px; background: var(--border); overflow: hidden; }
    .cm-timer-fill { height: 100%; border-radius: 1px; background: var(--accent); transition: width 1s linear; }
    .cm-timer-setup { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .cm-timer-input {
      background: none; border: 1px solid var(--border); border-radius: 6px;
      color: var(--text); font-size: 13px; padding: 6px 10px; outline: none;
      font-family: inherit; width: 90px;
    }
    .cm-timer-label-inp { width: 140px; }
    .cm-timer-input:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
    .cm-timer-edit-input {
      background: none; border: none; outline: none;
      font-size: 19px; font-weight: 600; color: var(--text);
      font-variant-numeric: tabular-nums; width: 110px; font-family: inherit;
    }

    .cm-timer-time-editable { cursor: text; opacity: 0.45; font-size: 15px; }
    .cm-timer-time-editable:hover { opacity: 0.8; }

    /* ── /timer as a left-gutter vertical rail (quick-note style) ── */
    .cm-timer-widget.cm-timer-rail {
      width: 42px; max-width: none; height: 140px;
      margin: 0.4em 0; padding: 8px 0 6px;
      align-items: center; gap: 7px;
    }
    .cm-timer-rail .cm-timer-bar {
      flex: 1; width: 3px; height: auto; border-radius: 2px;
      background: var(--border); overflow: hidden;
      display: flex; flex-direction: column; justify-content: flex-start;
    }
    .cm-timer-rail .cm-timer-fill {
      width: 100%; height: 100%; background: var(--accent);
      border-radius: 2px; transition: height 1s linear;
    }
    .cm-timer-rail .cm-timer-time {
      writing-mode: vertical-rl; font-size: 12px; font-weight: 600;
      letter-spacing: .05em; line-height: 1;
    }
    .cm-timer-railbtns { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .cm-timer-rail .cm-timer-btn { width: 20px; height: 18px; margin: 0; }

    /* ── /math zone badge ── */
    .cm-mathzone-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 2px 10px 2px 8px; border-radius: 999px;
      border: 1px solid var(--borderSubtle, var(--border));
      background: var(--surfaceAlt, var(--surface));
      color: var(--textDim); font-size: 10.5px; font-weight: 600;
      letter-spacing: .06em; text-transform: uppercase;
      vertical-align: middle; user-select: none; cursor: default;
    }
    .cm-mathzone-icon { color: var(--accent); font-size: 12px; font-weight: 500; }
    .nb-mathzone-indicator {
      position: absolute; top: 10px; left: 12px; z-index: 5;
      padding: 3px 7px; pointer-events: none;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }
    .nb-mathzone-indicator .cm-mathzone-icon { font-size: 13px; }
    .cm-mathzone-end { opacity: .6; }
    .cm-mathzone-end .cm-mathzone-icon { color: var(--textDim); }

    /* ── Pomodoro widget ── */
    .cm-pomo-widget {
      margin: 0.6em 0; padding: 14px 16px; border-radius: 12px;
      border: 1px solid var(--border); background: var(--surface);
      display: flex; flex-direction: column; gap: 8px; max-width: 340px;
    }
    .cm-pomo-hdr {
      display: flex; align-items: center; justify-content: space-between;
    }
    .cm-pomo-title {
      font-size: 13px; font-weight: 700; color: var(--text);
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }
    .cm-pomo-sessions {
      font-size: 10px; font-weight: 600; color: var(--textDim);
      background: var(--surfaceAlt); border: 1px solid var(--borderSubtle);
      border-radius: 4px; padding: 2px 6px;
    }
    .cm-pomo-phase-row { display: flex; gap: 4px; }
    .cm-pomo-phase-btn {
      flex: 1; padding: 4px 0; border-radius: 6px; border: 1px solid var(--borderSubtle);
      background: none; color: var(--textDim); cursor: pointer;
      font-size: 11px; font-weight: 600; font-family: inherit;
      transition: all 0.12s;
    }
    .cm-pomo-phase-btn:hover { background: var(--surfaceAlt); color: var(--text); }
    .cm-pomo-phase-btn.active {
      background: var(--accent); color: var(--bg); border-color: var(--accent);
    }
    .cm-pomo-time {
      font-size: 36px; font-weight: 700; color: var(--text);
      font-variant-numeric: tabular-nums; text-align: center;
      letter-spacing: 2px; padding: 4px 0;
    }
    .cm-pomo-bar {
      height: 4px; border-radius: 2px; background: var(--borderSubtle); overflow: hidden;
    }
    .cm-pomo-fill {
      height: 100%; border-radius: 2px; transition: width 1s linear;
    }
    .cm-pomo-fill-work { background: var(--accent); }
    .cm-pomo-fill-break { background: #3fb950; }
    .cm-pomo-controls { display: flex; gap: 6px; justify-content: center; }
    .cm-pomo-btn {
      background: none; border: 1px solid var(--border); border-radius: 8px;
      color: var(--text); cursor: pointer; width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; transition: background .1s;
    }
    .cm-pomo-btn:hover { background: var(--surfaceAlt); }
    .cm-pomo-play { width: 48px; }
    .cm-pomo-prev {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-radius: 10px; border: 1px solid var(--border); background: var(--surface);
      margin: 0.6em 0; max-width: 320px;
    }
    .cm-pomo-prev-icon { font-size: 18px; }
    .cm-pomo-prev-text { font-size: 13px; font-weight: 600; color: var(--text); }
    .cm-pomo-prev-sub { font-size: 10px; color: var(--textDim); margin-left: auto; }

    /* ── /pomo as a left-gutter vertical rail ── */
    .cm-pomo-widget.cm-pomo-rail {
      width: 52px; max-width: none; height: 190px;
      margin: 0.5em 0; padding: 8px 4px 8px;
      align-items: center; gap: 7px;
    }
    .cm-pomo-tag {
      font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      border: 1px solid var(--borderSubtle); border-radius: 5px;
      padding: 2px 6px; background: none; cursor: pointer; font-family: inherit;
      color: var(--textDim); transition: all .12s;
    }
    .cm-pomo-tag-work  { color: var(--accent); border-color: var(--accent); }
    .cm-pomo-tag-break { color: #3fb950; border-color: #3fb950; }
    .cm-pomo-rail .cm-pomo-bar {
      flex: 1; width: 3px; height: auto; border-radius: 2px;
      background: var(--borderSubtle); overflow: hidden;
      display: flex; flex-direction: column; justify-content: flex-start;
    }
    .cm-pomo-rail .cm-pomo-fill { width: 100%; height: 100%; transition: height 1s linear; }
    .cm-pomo-rail .cm-pomo-time {
      writing-mode: vertical-rl; font-size: 14px; font-weight: 700;
      letter-spacing: 1px; padding: 0; text-align: center;
    }
    .cm-pomo-rail .cm-pomo-sessions {
      font-size: 10px; padding: 1px 6px; border-radius: 4px;
    }
    .cm-pomo-rail .cm-pomo-controls {
      flex-direction: column; gap: 2px; opacity: 0; transition: opacity .15s;
    }
    .cm-pomo-rail:hover .cm-pomo-controls { opacity: 1; }
    .cm-pomo-rail .cm-pomo-btn { width: 26px; height: 22px; font-size: 12px; }
    .cm-pomo-rail .cm-pomo-play { width: 26px; }

    /* ── Calendar widget ── */
    .cm-calendar-widget {
      margin: 0.6em 0; border-radius: 10px; border: 1px solid var(--border);
      background: var(--surface); padding: 12px; width: 100%; box-sizing: border-box;
    }

    /* ── Calendar topbar & mode toggle ── */
    .cm-cal-topbar {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 6px;
    }
    .cm-cal-main-title {
      font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer;
      padding: 2px 4px; border-radius: 3px; transition: background .1s;
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }
    .cm-cal-main-title:hover { background: rgba(128,128,128,.08); }
    .cm-cal-title-input {
      background: none; border: none; outline: none;
      font-size: 13px; font-weight: 600; color: var(--text);
      font-family: inherit; width: 100%;
    }
    .cm-cal-mode-bar {
      display: flex; gap: 1px; background: var(--borderSubtle); border-radius: 5px; padding: 1px;
    }
    .cm-cal-mode-btn {
      background: none; border: none; color: var(--textDim); cursor: pointer;
      font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
      transition: background .1s, color .1s;
    }
    .cm-cal-mode-btn:hover { color: var(--text); }
    .cm-cal-mode-active { background: var(--surface); color: var(--text); }

    /* ── Calendar nav ── */
    .cm-cal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px;
    }
    .cm-cal-nav {
      background: none; border: none; border-radius: 4px;
      color: var(--textDim); cursor: pointer; width: 24px; height: 24px;
      display: flex; align-items: center; justify-content: center; font-size: 16px;
      transition: background .1s, color .1s;
    }
    .cm-cal-nav:hover { background: var(--surfaceAlt); color: var(--text); }
    .cm-cal-month {
      font-size: 12px; font-weight: 600; color: var(--text);
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }

    /* ── Calendar month grid ── */
    .cm-cal-grid {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px;
      background: var(--borderSubtle); border-radius: 6px; overflow: hidden;
      border: 1px solid var(--borderSubtle);
    }
    .cm-cal-day-hdr {
      font-size: 9px; font-weight: 700; color: var(--textDim); text-align: center;
      padding: 5px 0; text-transform: uppercase; letter-spacing: .08em;
      background: var(--surface);
    }
    .cm-cal-blank { min-height: 72px; background: var(--surface); }
    .cm-cal-day {
      text-align: left; padding: 4px 5px; font-size: 11px;
      color: var(--text); cursor: pointer; transition: background .1s;
      position: relative; min-height: 72px; background: var(--surface);
    }
    .cm-cal-day:hover { background: var(--surfaceAlt); }
    .cm-cal-today { color: var(--accent); }
    .cm-cal-today > span:first-child {
      background: var(--accent); color: var(--bg); border-radius: 50%; width: 20px; height: 20px;
      display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
    }
    .cm-cal-selected { background: color-mix(in srgb, var(--accent) 6%, transparent) !important; }
    .cm-cal-has-event::after {
      content: ''; position: absolute; top: 5px; right: 5px;
      width: 4px; height: 4px; border-radius: 50%; background: var(--accent);
    }

    /* ── Month view day event labels ── */
    .cm-cal-day-evt {
      font-size: 9px; color: var(--text); white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; margin-top: 2px; line-height: 1.2;
      background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 2px; padding: 1px 3px;
      border-left: 2px solid var(--accent);
    }

    /* ── Calendar event panel (month view selected day) ── */
    .cm-cal-event-panel {
      margin-top: 8px; padding: 8px 10px; background: var(--surfaceAlt);
      border-radius: 6px; max-height: 400px; overflow-y: auto;
    }
    .cm-cal-event-panel-hdr {
      font-size: 11px; font-weight: 600; color: var(--text); margin-bottom: 4px;
      font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', sans-serif;
    }

    /* ── Calendar event rows (shared across views) ── */
    .cm-cal-evt-row {
      display: flex; align-items: center; gap: 5px; padding: 2px 4px;
      border-radius: 3px; transition: background .1s;
    }
    .cm-cal-evt-row:hover { background: rgba(128,128,128,.06); }
    .cm-cal-evt-row:hover .cm-todo-del { opacity: 1; }
    .cm-cal-evt-dot {
      width: 5px; height: 5px; border-radius: 50%; background: var(--accent); flex-shrink: 0;
    }
    .cm-cal-evt-text { font-size: 11px; color: var(--text); flex: 1; min-width: 0; }
    .cm-cal-evt-add {
      width: 100%; background: none; border: none; border-bottom: 1px solid var(--borderSubtle);
      padding: 4px 2px; font-size: 11px; color: var(--text); font-family: inherit;
      outline: none; margin-top: 3px; transition: border-color .15s;
    }
    .cm-cal-evt-add:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
    .cm-cal-evt-add::placeholder { color: var(--textDim); opacity: .4; }

    /* ── 24-hour time grid (shared by day/week/expanded month) ── */
    .cm-cal-time-grid {
      max-height: 360px; overflow-y: auto;
    }
    .cm-cal-time-row {
      display: flex; min-height: 28px; border-bottom: 1px solid var(--borderSubtle);
    }
    .cm-cal-time-label {
      width: 48px; flex-shrink: 0; font-size: 9px; color: var(--textDim);
      text-align: right; padding: 2px 6px 0 0; font-weight: 500;
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    .cm-cal-time-slot {
      flex: 1; min-height: 28px; cursor: pointer; padding: 1px 4px;
      transition: background .1s; position: relative;
    }
    .cm-cal-time-slot:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }
    .cm-cal-time-evt {
      font-size: 10px; color: var(--text); background: color-mix(in srgb, var(--accent) 10%, transparent);
      border-left: 2px solid var(--accent); border-radius: 2px;
      padding: 1px 6px; margin: 1px 0; display: flex; align-items: center; gap: 4px;
    }
    .cm-cal-time-evt .cm-todo-del { margin-left: auto; }
    .cm-cal-time-add {
      width: 100%; background: none; border: none; border-bottom: 1px solid var(--accent);
      padding: 2px 2px; font-size: 10px; color: var(--text); font-family: inherit;
      outline: none;
    }
    .cm-cal-time-add::placeholder { color: var(--textDim); opacity: .4; }

    /* ── Week view (time-grid version) ── */
    .cm-cal-week-hdr-row {
      display: flex; border-bottom: 1px solid var(--border);
    }
    .cm-cal-week-time-gutter {
      width: 48px; flex-shrink: 0;
    }
    .cm-cal-week-col-hdr {
      flex: 1; text-align: center; font-size: 9px; font-weight: 600;
      color: var(--textDim); text-transform: uppercase; letter-spacing: .05em;
      padding: 4px 0; font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    .cm-cal-week-col-hdr.cm-cal-week-today { color: var(--accent); }
    .cm-cal-week-body {
      max-height: 360px; overflow-y: auto;
    }
    .cm-cal-week-time-row {
      display: flex; min-height: 28px; border-bottom: 1px solid var(--borderSubtle);
    }
    .cm-cal-week-cell {
      flex: 1; min-height: 28px; cursor: pointer; padding: 1px 2px;
      border-left: 1px solid var(--borderSubtle);
      transition: background .1s; position: relative;
    }
    .cm-cal-week-cell:hover { background: color-mix(in srgb, var(--accent) 4%, transparent); }

    /* ── Day view ── */
    .cm-cal-day-panel {
      background: var(--surfaceAlt); border-radius: 6px; padding: 4px 0;
    }

    /* ── Wiki dropdown rendered by React (positioned fixed) ── */

    /* ── Live list items ── */
    .nb-live .cm-lv-li { position: relative; }
    .cm-list-marker {
      display: inline-block; color: var(--textDim); min-width: 0.7em; margin-right: 0;
    }
    .cm-list-marker-ord { font-weight: 600; color: var(--text); opacity: 0.6; }

    /* ══════════════════════════════════════════════════════
       PREVIEW — identical typography to live
    ══════════════════════════════════════════════════════ */
    .nb-prev {
      flex: 1; overflow: auto;
      padding: var(--nb-py) var(--nb-px);
      font-size: var(--nb-fs);
      line-height: var(--nb-lh);
      font-family: var(--nb-ff);
      color: var(--nb-color);
      max-width: var(--nb-max); margin: 0 auto; width: 100%;
      box-sizing: border-box;
    }
    /* Headings — match live exactly */
    .nb-prev h1 { font-size:var(--nb-h1); font-weight:600; margin:1.15em 0 .45em; font-family:'Stack Sans Text','Switzer','Satoshi',sans-serif; color:var(--nb-h1-color); line-height:1.25; letter-spacing:-0.3px; }
    .nb-prev h2 { font-size:var(--nb-h2); font-weight:600; margin:1.1em 0 .4em;  font-family:'Stack Sans Text','Switzer','Satoshi',sans-serif; color:var(--nb-h2-color); line-height:1.3; letter-spacing:-0.2px; }
    .nb-prev h3 { font-size:var(--nb-h3); font-weight:600; margin:1em 0 .35em;   font-family:'Stack Sans Text','Satoshi','Switzer',sans-serif; color:var(--nb-h3-color); line-height:1.4; }
    .nb-prev h4 { font-size:var(--nb-h4); font-weight:600; margin:.9em 0 .3em;   font-family:'Stack Sans Text','Satoshi','Switzer',sans-serif; color:var(--nb-h4-color); }
    .nb-prev h5 { font-size:var(--nb-h5); font-weight:600; margin:.85em 0 .25em; font-family:'Stack Sans Text','Satoshi','Switzer',sans-serif; color:var(--nb-h5-color); }
    .nb-prev h6 { font-size:var(--nb-h6); font-weight:600; margin:.8em 0 .25em;  font-family:'Stack Sans Text','Satoshi','Switzer',sans-serif; color:var(--nb-h6-color); opacity:.65; }
    .nb-prev p  { margin: 0 0 var(--nb-para-gap); }
    .nb-prev blockquote {
      border-left: 3px solid var(--nb-quote-border); margin: .8em 0; padding: 8px 14px;
      color: var(--nb-quote-color); border-radius: 0 4px 4px 0;
      background: var(--nb-quote-bg); font-style: italic;
    }
    .nb-prev pre.nb-pre { background:var(--surfaceAlt); border:1px solid var(--border); border-radius:8px; padding:14px 16px; overflow-x:auto; margin:.8em 0; }
    /* Mermaid diagrams + inline SVG — centred, never wider than the page.
       An author SVG can carry width/height:100% (or none at all), which without
       these constraints expands to cover the page and blanks the content behind
       it. Clamp the box, force the SVG to lay out inside it, and contain paint
       so it can never draw outside its own block. */
    .nb-mermaid, .nb-svg {
      margin:.9em 0; text-align:center; overflow:auto;
      width:100%; max-width:100%; max-height:70vh; contain:paint;
    }
    /* Clamp with max-* only. Forcing width/height:auto collapses an SVG that
       has no viewBox (no intrinsic size) to 0×0 — which is what made the block
       look like it blanked the page. */
    .nb-mermaid svg, .nb-svg svg {
      max-width:100%; max-height:70vh;
      display:inline-block; position:static !important;
    }
    /* Mermaid sizes every node box by measuring its label FIRST, then emits
       fixed geometry. The notebook's own font-size/line-height cascade into the
       SVG afterwards and the text no longer fits — labels render clipped. Pin
       the typography mermaid assumed, and let labels overflow rather than crop. */
    .nb-mermaid svg { font-size:16px; line-height:normal; }
    .nb-mermaid svg text,
    .nb-mermaid svg .nodeLabel,
    .nb-mermaid svg foreignObject div,
    .nb-mermaid svg foreignObject span {
      font-family:'trebuchet ms', verdana, arial, sans-serif !important;
      font-size:16px !important;
      line-height:normal !important;
      letter-spacing:normal !important;
      text-indent:0 !important;
    }
    .nb-mermaid svg foreignObject { overflow:visible; }
    .nb-diagram-live { margin:.4em 0; }
    .nb-diagram-pending { color:var(--textDim); font-size:.88em; font-style:italic; padding:10px; }
    .nb-diagram-error {
      color:#f85149; font-size:.85em; font-family:SF Mono,Menlo,monospace; text-align:left;
      background:rgba(248,81,73,0.08); border:1px solid rgba(248,81,73,0.3);
      border-radius:6px; padding:8px 12px;
    }
    .nb-prev code { font-family:SF Mono,Menlo,Consolas,monospace; font-size:.87em; }
    .nb-ic { background:var(--nb-code-bg); border-radius:4px; padding:1px 5px; font-family:SF Mono,Menlo,Consolas,monospace; font-size:.87em; color:var(--nb-code-color); }
    .nb-prev table.nb-table { border-collapse:collapse; width:100%; margin:.8em 0; font-size:.93em; }
    .nb-prev table.nb-table th,.nb-prev table.nb-table td { border:1px solid var(--border); padding:6px 10px; }
    .nb-prev table.nb-table th { background:var(--surfaceAlt); font-weight:600; }
    .nb-prev ul,.nb-prev ol { margin:0 0 .75em; padding-left:1.6em; list-style-position: outside; }
    .nb-prev li { margin-bottom:.25em; }
    .nb-prev ul ul,.nb-prev ol ol,.nb-prev ul ol,.nb-prev ol ul { margin:.2em 0; padding-left:1.4em; }
    .nb-prev ul.nb-tl { list-style:none; padding-left:.4em; }
    .nb-prev li.nb-task { display:flex; gap:8px; align-items:baseline; cursor:pointer; }
    .nb-prev li.nb-task:hover { opacity:.85; }
    .nb-prev .nb-cb { display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border:1.5px solid var(--border); border-radius:3px; font-size:10px; flex-shrink:0; cursor:pointer; user-select:none; transition:background .1s,border-color .1s; }
    .nb-prev li.checked .nb-cb { background:var(--accent); border-color:var(--accent); color:var(--bg); }
    .nb-prev li.checked>span:last-child { text-decoration:line-through; opacity:.55; }
    .nb-hl { background:var(--nb-hl-bg); border-radius:2px; padding:0 2px; }
    /* Inline text formats — match live */
    .nb-bold   { font-weight:700; color:var(--nb-bold-color); }
    .nb-italic { font-style:italic; color:var(--nb-italic-color); }
    .nb-strike { text-decoration:line-through; color:var(--nb-strike-color); opacity:.75; }
    .nb-sup    { font-size:.75em; vertical-align:super; color:var(--nb-link-color); }
    .nb-sub    { font-size:.75em; vertical-align:sub;   color:var(--nb-link-color); }
    .wikilink     { border-bottom:1px solid var(--nb-wikilink-color); cursor:pointer; color:var(--nb-wikilink-color); }
    .wikilink:hover { opacity:.8; }
    .wikilink-new { color:var(--textDim); border-bottom-color:var(--textDim); }
    /* Images in preview */
    .nb-img {
      max-width:100%; max-height:500px; border-radius:6px;
      margin:.75em 0; display:block; object-fit:contain;
      box-shadow:0 2px 12px rgba(0,0,0,.2);
    }
    .nb-img[src=""],
    .nb-img:not([src]) { display: none; }
    .nb-prev a { color:var(--nb-link-color); text-decoration:underline; }
    .nb-prev hr { border:none; border-top:1px solid var(--border); margin:1.2em 0; }
    /* MathQuill static display in preview */
    .nb-math { display:inline-block; }
    .nb-math-block { display:block; text-align:center; margin:1em 0; overflow-x:auto; }
    .nb-math-mq .mq-root-block { color: var(--text) !important; }
    /* Preview-mode calendar block */
    .cm-cal-prev-block { border: 1px solid var(--borderSubtle); border-radius: 8px; overflow: hidden; margin: .6em 0; }
    .cm-cal-prev-title { font-size: 11px; font-weight: 600; padding: 6px 10px; background: var(--surface); color: var(--text); border-bottom: 1px solid var(--borderSubtle); font-family: 'Stack Sans Text','Switzer','Satoshi',sans-serif; }
    .cm-cal-prev-day { display: flex; align-items: baseline; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--borderSubtle); flex-wrap: wrap; }
    .cm-cal-prev-day:last-child { border-bottom: none; }
    .cm-cal-prev-date { font-size: 10px; font-weight: 600; color: var(--textDim); min-width: 80px; font-family: 'Stack Sans Text','Switzer',system-ui,sans-serif; }
    .cm-cal-prev-evt { font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--accent) 8%, transparent); border-left: 2px solid var(--accent); border-radius: 2px; padding: 1px 6px; }
    /* Preview-mode timer block */
    .cm-timer-prev { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1px solid var(--borderSubtle); border-radius: 8px; margin: .4em 0; background: var(--surfaceAlt); }
    .cm-timer-prev-time { font-size: 18px; font-weight: 600; color: var(--text); font-family: 'Stack Sans Text','Satoshi','Switzer',sans-serif; font-variant-numeric: tabular-nums; }
    .cm-timer-prev-label { font-size: 11px; color: var(--textDim); }
    .nb-fn-ref sup { font-size:.75em; }
    .nb-fn-ref a { color:var(--accent); text-decoration:none; }
    .nb-fn-def { font-size:12px; color:var(--textDim); padding:4px 0; border-top:1px solid var(--borderSubtle); margin-top:8px; }
    .nb-fn-back { color:var(--accent); text-decoration:none; margin-left:4px; }
    .nb-fns { margin-top:2em; }
    /* Definition lists */
    .nb-dl { margin: 0 0 .75em; padding: 0; }
    .nb-dt { font-weight: 600; color: var(--text); margin-top: .6em; font-family: 'Stack Sans Text','Satoshi','Switzer',sans-serif; letter-spacing: .01em; }
    .nb-dd { margin-left: 1.6em; color: var(--textDim); margin-bottom: .25em; padding-left: .4em; border-left: 2px solid var(--borderSubtle); }
    /* Live view definition list line classes */
    .nb-live .cm-lv-dt { font-weight: 600; color: var(--text); font-family: 'Stack Sans Text','Satoshi','Switzer',sans-serif; margin-top: .5em; }
    .nb-live .cm-lv-dd { padding-left: 1.6em; color: var(--textDim); border-left: 2px solid var(--borderSubtle); }
    .nb-live .cm-lv-fn-def { font-size: .88em; color: var(--textDim); border-top: 1px solid var(--borderSubtle); padding-top: 2px; }
    /* Footnote ref widget in live mode */
    .cm-fn-ref-widget {
      font-size: .72em; vertical-align: super; color: var(--accent);
      background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 3px;
      padding: 0 3px; cursor: default; font-weight: 600;
      font-family: 'Stack Sans Text', 'Switzer', system-ui, sans-serif;
    }
    mark.nb-fhl { background:rgba(210,153,34,.4); border-radius:2px; padding:0 1px; }
    /* ── Ghost hint ─────────────────────────────────────── */
    .cm-ghost-hint {
      color: var(--textDim);
      opacity: 0.35;
      font-style: italic;
      pointer-events: none;
      user-select: none;
    }
    /* ── Uniform number styling ──────────────────────────── */
    .cm-nb-num {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.015em;
    }
    /* ── Math variable names ─────────────────────────────── */
    .cm-math-var {
      color: #e8a87c;
      font-weight: 500;
    }
    .cm-math-var-live {
      color: #f0a060;
    }
    .cm-math-colon {
      color: #e8a87c;
      opacity: 0.45;
    }
    /* Blue complement to orange — drawn from the app's existing accent hue */
    .cm-math-ref {
      color: #79b8ff;
      font-weight: 500;
    }
    /* Bold ghost text result */
    .cm-math-ghost {
      font-weight: 700;
    }
    /* Gradient shimmer sweep when a live result auto-updates */
    @keyframes mathResultShimmer {
      0%   { background-position: -200% center; }
      100% { background-position: 200% center; }
    }
    .cm-math-live-updated {
      background: linear-gradient(
        90deg,
        #f0a060 0%,
        #ffd4a0 30%,
        #fff3e0 50%,
        #ffd4a0 70%,
        #f0a060 100%
      );
      background-size: 400% auto;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: mathResultShimmer 1.4s ease-in-out;
      animation-iteration-count: 1;
      animation-fill-mode: none;
    }
    mark.nb-fhl-a { background:color-mix(in srgb, var(--accent) 50%, transparent); outline:2px solid var(--accent); }

    /* ── Cover banner ─────────────────────────────────── */
    .nb-cover-banner {
      position: relative;
      width: 100%;
      flex-shrink: 0;
      overflow: hidden;
    }
    .nb-cover-img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      user-select: none;
    }
    .nb-cover-img-draggable { cursor: grab; }
    .nb-cover-img-draggable:active { cursor: grabbing; }
    .nb-cover-actions {
      position: absolute;
      bottom: 10px; right: 14px;
      display: flex; gap: 6px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .nb-cover-banner:hover .nb-cover-actions { opacity: 1; }
    .nb-cover-action-btn {
      background: rgba(15,15,15,0.6);
      border: none;
      color: #fff;
      font-size: 11.5px;
      border-radius: 5px;
      padding: 4px 10px;
      cursor: pointer;
      font-family: inherit;
      backdrop-filter: blur(4px);
      transition: background 0.12s;
    }
    .nb-cover-action-btn:hover { background: rgba(15,15,15,0.82); }

    /* ── Cover image picker modal ─────────────────────── */
    .nb-cover-picker-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nb-cover-picker-panel {
      background: var(--surface);
      border-radius: 12px;
      padding: 20px;
      width: 600px;
      max-width: 92vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.55);
    }
    .nb-cover-picker-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nb-cover-picker-header > span:first-child { font-weight: 600; font-size: 14px; color: var(--text); }
    .nb-cover-picker-hint { font-size: 12px; color: var(--textDim); }
    .nb-cover-picker-stage {
      position: relative;
      overflow: hidden;
      border-radius: 8px;
      cursor: grab;
      user-select: none;
      width: 100%;
      min-height: 120px;
      background: #000;
      flex-shrink: 0;
    }
    .nb-cover-picker-stage:active { cursor: grabbing; }
    .nb-cover-picker-img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .nb-cpick-dim {
      position: absolute;
      left: 0; right: 0;
      background: rgba(0,0,0,0.55);
      pointer-events: none;
    }
    .nb-cpick-vp {
      position: absolute;
      box-shadow: 0 0 0 2px rgba(255,255,255,0.8) inset;
    }
    /* north/south resize handles (horizontal pill) */
    .nb-cpick-resize-n,
    .nb-cpick-resize-s {
      position: absolute;
      left: 0; right: 0;
      height: 12px;
      cursor: ns-resize;
      display: flex;
      justify-content: center;
    }
    .nb-cpick-resize-n { top: 0; align-items: flex-start; padding-top: 3px; }
    .nb-cpick-resize-s { bottom: 0; align-items: flex-end; padding-bottom: 3px; }
    .nb-cpick-resize-n::after,
    .nb-cpick-resize-s::after {
      content: '';
      width: 36px; height: 3px;
      border-radius: 2px;
      background: rgba(255,255,255,0.75);
      display: block;
    }
    /* west/east resize handles (vertical pill) */
    .nb-cpick-resize-w,
    .nb-cpick-resize-e {
      position: absolute;
      top: 0; bottom: 0;
      width: 12px;
      cursor: ew-resize;
      display: flex;
      align-items: center;
    }
    .nb-cpick-resize-w { left: 0; justify-content: flex-start; padding-left: 3px; }
    .nb-cpick-resize-e { right: 0; justify-content: flex-end; padding-right: 3px; }
    .nb-cpick-resize-w::after,
    .nb-cpick-resize-e::after {
      content: '';
      width: 3px; height: 36px;
      border-radius: 2px;
      background: rgba(255,255,255,0.75);
      display: block;
    }
    .nb-cpick-zoom {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .nb-cpick-zoom-btn {
      width: 26px; height: 26px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: none;
      color: var(--text);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      transition: background 0.1s;
    }
    .nb-cpick-zoom-btn:hover { background: var(--surfaceAlt); }
    .nb-cpick-zoom-slider {
      flex: 1;
    }
    .nb-cover-picker-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-shrink: 0;
    }
    .nb-cover-picker-cancel {
      background: none;
      border: 1px solid var(--border);
      color: var(--textDim);
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .nb-cover-picker-cancel:hover { background: var(--surfaceAlt); color: var(--text); }
    .nb-cover-picker-apply {
      background: var(--accent);
      border: none;
      color: #fff;
      border-radius: 6px;
      padding: 6px 18px;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.12s;
    }
    .nb-cover-picker-apply:hover { opacity: 0.88; }

    /* ── /linkw URL input modal ────────────────────────── */
    .nb-linkw-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.55);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nb-linkw-modal {
      background: var(--surface);
      border-radius: 10px;
      padding: 18px 20px 14px;
      width: 420px;
      max-width: 92vw;
      display: flex;
      flex-direction: column;
      gap: 10px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .nb-linkw-modal-title { font-weight: 600; font-size: 14px; color: var(--text); }
    .nb-linkw-modal-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--surfaceAlt, #252525);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 13px;
      color: var(--text);
      font-family: inherit;
      outline: none;
    }
    .nb-linkw-modal-input:focus { border-color: var(--focusBorder); box-shadow: var(--focusRing); }
    .nb-linkw-modal-hint { font-size: 11px; color: var(--textDim); }

    /* ── /linkf file badge ─────────────────────────────── */
    .cm-linkf-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 9px 2px 6px;
      border-radius: 5px;
      background: var(--surfaceAlt, #252525);
      border: 1px solid var(--border);
      font-size: 13px;
      cursor: pointer;
      vertical-align: middle;
      max-width: 340px;
      transition: background 0.12s, border-color 0.12s;
      white-space: nowrap;
      overflow: hidden;
      line-height: 1.6;
    }
    .cm-linkf-badge:hover { background: var(--accentDim, rgba(100,149,237,0.14)); border-color: var(--accent); }
    .cm-linkf-icon { display: inline-flex; align-items: center; flex-shrink: 0; color: var(--textDim); }
    .cm-linkf-name { color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── /linkw web viewer (embedded native webview) ───── */
    .cm-linkw-wrap {
      display: block;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin: 4px 0;
      background: var(--surfaceAlt, #252525);
      width: 100%;
    }
    .cm-linkw-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--surfaceAlt, #252525);
      height: 32px;
      box-sizing: border-box;
    }
    .cm-linkw-glob { display: inline-flex; align-items: center; flex-shrink: 0; color: var(--textDim); }
    .cm-linkw-info {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .cm-linkw-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex-shrink: 1;
      min-width: 0;
    }
    .cm-linkw-url {
      font-size: 11px;
      color: var(--textDim);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cm-linkw-open-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      background: var(--accent);
      border: none;
      color: #fff;
      border-radius: 5px;
      padding: 4px 9px;
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      transition: opacity 0.12s;
      white-space: nowrap;
    }
    .cm-linkw-open-btn:hover { opacity: 0.82; }
    .cm-linkw-view-area {
      width: 100%;
      height: 460px;
      background: var(--surfaceAlt, #252525);
      display: block;
      position: relative;
    }
    .cm-linkw-load-overlay {
      position: absolute;
      inset: 0;
      cursor: pointer;
      overflow: hidden;
      background: var(--surfaceAlt, #252525);
    }
    .cm-linkw-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      display: block;
    }
    .cm-linkw-favicon-badge {
      position: absolute;
      bottom: 10px;
      left: 10px;
      background: rgba(0,0,0,0.55);
      border-radius: 6px;
      padding: 4px;
      display: flex;
      align-items: center;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .cm-linkw-favicon-badge img { width: 20px; height: 20px; display: block; }

    /* ── /linkv video player ────────────────────────────── */
    .cm-linkv-wrap {
      display: block;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      margin: 4px 0;
      background: #000;
    }
    .cm-linkv-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-bottom: 1px solid var(--border);
      background: var(--surfaceAlt, #252525);
      height: 26px;
      box-sizing: border-box;
    }
    .cm-linkv-icon { display: inline-flex; align-items: center; flex-shrink: 0; color: var(--textDim); }
    .cm-linkv-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }
    .cm-linkv-video {
      display: block;
      width: 100%;
      max-height: 340px;
      background: #000;
    }
    .cm-linkv-unavailable {
      padding: 12px 14px;
      background: var(--surfaceAlt);
      border: 1px dashed var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      font-size: 12px;
      color: var(--textDim);
    }

    /* ── Title meta row (Add cover hint) ──────────────── */
    .nb-title-area { }
    .nb-title-meta-row {
      height: 22px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .nb-title-area:hover .nb-title-meta-row { opacity: 1; }
    .nb-title-meta-btn {
      display: inline-flex;
      align-items: center;
      background: none;
      border: none;
      color: var(--textDim);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
      border-radius: 4px;
      padding: 2px 6px;
      opacity: 0.7;
      transition: opacity 0.12s, background 0.12s;
    }
    .nb-title-meta-btn:hover { opacity: 1; background: var(--surfaceAlt); }

    /* ── Progress bar / misc ───────────────────────────── */
    .nb2-fb { background:none; border:none; color:var(--textDim); cursor:pointer; border-radius:5px; padding:3px 7px; font-size:11px; font-family:inherit; transition:background .1s,color .1s; }
    .nb2-fb:hover { background:var(--surfaceAlt); color:var(--text); }
    .nb2-fc { font-size:16px; opacity:.6; background:none; border:none; cursor:pointer; color:var(--textDim); padding:0 4px; line-height:1; }
    .nb2-fc:hover { opacity:1; }

    /* ── Save indicator animation ──────────────────────── */
    .nb-findbar {
      position:absolute; top:10px; right:16px; z-index:400;
      display:flex; align-items:center; gap:7px;
      width:300px; height:32px; padding:0 10px;
      background:var(--surface); border:1px solid var(--borderSubtle);
      border-radius:9px; color:var(--textDim);
      box-shadow:0 0 0 1px rgba(0,0,0,0.04), 0 10px 24px rgba(0,0,0,0.25);
      animation: nb-findbar-in .13s cubic-bezier(0.2,0.8,0.3,1);
    }
    @keyframes nb-findbar-in { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:none } }
    .nb-findbar input {
      flex:1; min-width:0; background:none; border:none; outline:none;
      color:var(--text); font-size:12.5px; font-family:inherit;
    }
  `


  // ── Per-theme syntax colors — derived from known theme palettes ───────────
  // Derived directly from themes.js exact palette values
  const THEME_SYNTAX = {
    dark: {
      italic:'#79b8ff', bold:'#f0883e', bi:'#d2a8ff', h1:'#e6edf3', h2:'#79b8ff', h3:'#56d4dd',
      h4:'#b392f0', h5:'#f97583', h6:'#8b949e',
      quote:'#8b949e', quoteBg:'color-mix(in srgb, var(--accent) 7%, transparent)', quoteBorder:'#388bfd',
      link:'#58a6ff', wiki:'#58a6ff', hl:'rgba(255,212,59,.35)',
      code:'#e2c08d', codeBg:'rgba(255,218,120,.10)',
      strike:'#f85149',
    },
    sepia: {
      italic:'#b06830', bold:'#c44d2a', bi:'#a05020', h1:'#3b2f20', h2:'#9b5430', h3:'#b87340',
      h4:'#8a6040', h5:'#7a5030', h6:'#7a6652',
      quote:'#7a6652', quoteBg:'rgba(139,94,60,.09)', quoteBorder:'#8b5e3c',
      link:'#8b5e3c', wiki:'#a0714e', hl:'rgba(210,170,60,.45)',
      code:'#9b5e3c', codeBg:'rgba(139,94,60,.15)',
      strike:'#c0392b',
    },
    light: {
      italic:'#0550ae', bold:'#9a3412', bi:'#6639a6', h1:'#1f2328', h2:'#0550ae', h3:'#0969da',
      h4:'#8250df', h5:'#cf222e', h6:'#636c76',
      quote:'#636c76', quoteBg:'rgba(9,105,218,.05)', quoteBorder:'#0969da',
      link:'#0550ae', wiki:'#0860c7', hl:'rgba(255,212,0,.55)',
      code:'#0550ae', codeBg:'rgba(9,105,218,.12)',
      strike:'#cf222e',
    },
    moss: {
      italic:'#2d8a2d', bold:'#b5651d', bi:'#5a8a1d', h1:'#2a3320', h2:'#2d8a2d', h3:'#4a9a3f',
      h4:'#6a8c3f', h5:'#3d6934', h6:'#5a7048',
      quote:'#5a7048', quoteBg:'rgba(74,124,63,.08)', quoteBorder:'#4a7c3f',
      link:'#2d8a2d', wiki:'#3d6934', hl:'rgba(180,220,80,.45)',
      code:'#2d8a2d', codeBg:'rgba(74,124,63,.15)',
      strike:'#d44040',
    },
    cherry: {
      italic:'#ff7eb3', bold:'#f5a623', bi:'#ff5c8a', h1:'#f2dde1', h2:'#ff5c8a', h3:'#ff7eb3',
      h4:'#d88ca0', h5:'#f07090', h6:'#9e6d76',
      quote:'#9e6d76', quoteBg:'rgba(224,92,122,.09)', quoteBorder:'#e05c7a',
      link:'#ff5c8a', wiki:'#f07090', hl:'rgba(255,100,140,.30)',
      code:'#ff7eb3', codeBg:'rgba(255,126,179,.15)',
      strike:'#f85149',
    },
    sunset: {
      italic:'#ffb347', bold:'#e84855', bi:'#ff8c42', h1:'#f5e6c8', h2:'#ffa020', h3:'#ffb347',
      h4:'#e8b060', h5:'#f0a840', h6:'#a07840',
      quote:'#a07840', quoteBg:'rgba(232,146,42,.09)', quoteBorder:'#e8922a',
      link:'#ffa020', wiki:'#f0a840', hl:'rgba(255,170,40,.35)',
      code:'#ffb347', codeBg:'rgba(255,179,71,.15)',
      strike:'#e84855',
    },
  }
  const tc = THEME_SYNTAX[themeKey] || THEME_SYNTAX.dark
  const THEME_CSS = `
    .nb-root {
      --nb-bold-color:     ${tc.bold || 'var(--text)'};
      --nb-bi-color:       ${tc.bi || tc.bold || 'var(--text)'};
      --nb-italic-color:   ${tc.italic};
      --nb-strike-color:   ${tc.strike || 'var(--textDim)'};
      --nb-h1-color:       ${tc.h1};
      --nb-h2-color:       ${tc.h2};
      --nb-h3-color:       ${tc.h3};
      --nb-h4-color:       ${tc.h4 || tc.h3};
      --nb-h5-color:       ${tc.h5 || tc.h3};
      --nb-h6-color:       ${tc.h6 || 'var(--textDim)'};
      --nb-quote-color:    ${tc.quote};
      --nb-quote-bg:       ${tc.quoteBg};
      --nb-quote-border:   ${tc.quoteBorder};
      --nb-link-color:     ${tc.link};
      --nb-wikilink-color: ${tc.wiki};
      --nb-hl-bg:          ${tc.hl};
      --nb-code-color:     ${tc.code};
      --nb-code-bg:        ${tc.codeBg};
    }
  `

  return (
    <div className="nb-root" style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--readerBg, var(--bg))', color:'var(--text)', position:'relative', '--nb-fs': `${(nbFontSize * 0.9).toFixed(2)}px` }}>
      <style>{CSS}</style>
      <style>{THEME_CSS}</style>

      {/* ── Header replaced by title bar: word count lives in the omnibar,
             actions in the quick-access strip, find is a floating bar (⌘F) ── */}
      <QuickAccess>
        <button className={`gnos-settings-btn${(findOpen || findQ) ? ' active' : ''}`} title="Find in note (⌘F)"
          onClick={() => {
            if (findOpen) { setFindOpen(false); setFindQ(''); doFind('') }
            else { setFindOpen(true); setTimeout(() => findRef.current?.focus(), 30) }
          }}>
          <Search size={14} strokeWidth={1.7} />
        </button>
        <ViewModeBtn viewMode={viewMode} setViewMode={switchMode} />
        <NbShareMenu
          noteTitle={noteTitle}
          notebookTitle={notebook?.title}
          contentRef={contentRef}
          previewHtml={previewHtml}
          sharing={sharing}
          guestCount={collabGuestCount}
          onStartLiveShare={() => { setSharing(true); setCollabOpen(true) }}
          onOpenLiveShare={() => setCollabOpen(true)}
        />
        <button className="gnos-settings-btn" onClick={() => setHistoryOpen(true)} title="Version history">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l3 2" />
          </svg>
        </button>
        <button className="gnos-settings-btn" onClick={() => setEditModal(true)} title="Backlinks & tags">
          <Link2 size={15} strokeWidth={1.7} />
        </button>
      </QuickAccess>

      {/* Floating find bar — appears on ⌘F or via the quick-access button */}
      {(findOpen || findQ) && (
        <div className="nb-findbar">
          <Search size={12} strokeWidth={1.6} style={{ flexShrink: 0, opacity: .55 }} />
          <input ref={findRef} id="nb-search-input"
            placeholder="Find in note…" value={findQ}
            onChange={e => { setFindQ(e.target.value); doFind(e.target.value) }}
            onKeyDown={e => {
              if (e.key==='Enter') { e.preventDefault(); findNav(e.shiftKey?-1:1) }
              if (e.key==='Escape') { setFindQ(''); doFind(''); setFindOpen(false) }
            }}
          />
          {findQ && (
            <span style={{ fontSize:11, color:'var(--textDim)', whiteSpace:'nowrap' }}>
              {findCount>0?`${findCurD+1}/${findCount}`:'Not found'}
            </span>
          )}
          <button className="nb2-fb" onClick={() => findNav(-1)} title="Previous">↑</button>
          <button className="nb2-fb" onClick={() => findNav(1)}  title="Next">↓</button>
          <button className="nb2-fc" onClick={() => { setFindQ(''); doFind(''); setFindOpen(false) }} title="Close">×</button>
        </div>
      )}

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      {!isLoaded ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:'var(--textDim)', fontSize:13 }}>
          <div className="spinner" />Loading…
        </div>
      ) : (
        <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', position:'relative', background:'var(--readerBg,var(--bg))' }}>
          {/* ∑ indicator — top-left of the editor area while a /math zone is active */}
          {hasMathZone && (
            <span className="cm-mathzone-badge nb-mathzone-indicator" title="Math calc zone active">
              <span className="cm-mathzone-icon">∑</span>
            </span>
          )}
          {/* Hidden file input for cover image — lives outside the hover area */}
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            style={{ display:'none' }}
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file || !notebookId) return
              const objectUrl = URL.createObjectURL(file)
              setCoverPicker({ objectUrl, file, pos: { x: 50, y: 50 }, scale: 1 })
            }}
          />

          {/* ── Cover banner (full-width, Notion-style) ── */}
          {coverImage ? (
            <div className="nb-cover-banner" style={{ height: 220 }}>
              <img
                src={coverImage}
                alt="cover"
                className={`nb-cover-img${viewMode !== 'preview' ? ' nb-cover-img-draggable' : ''}`}
                style={{
                  transform: `scale(${coverScale})`,
                  transformOrigin: `${coverPos.x}% ${coverPos.y}%`,
                }}
                draggable={false}
                onMouseDown={viewMode !== 'preview' ? e => {
                  e.preventDefault()
                  coverDragRef.current = { startX: e.clientX, startY: e.clientY, px: coverPos.x, py: coverPos.y }
                  const banner = e.currentTarget.parentElement
                  const bW = banner.offsetWidth, bH = banner.offsetHeight
                  // overflow in each axis created by the scale factor
                  const overflowX = bW * (coverScale - 1)
                  const overflowY = bH * (coverScale - 1)
                  const onMove = ev => {
                    const d = coverDragRef.current
                    if (!d) return
                    const dx = overflowX > 0 ? (ev.clientX - d.startX) / overflowX * 100 : 0
                    const dy = overflowY > 0 ? (ev.clientY - d.startY) / overflowY * 100 : 0
                    setCoverPos({ x: Math.max(0, Math.min(100, d.px - dx)), y: Math.max(0, Math.min(100, d.py - dy)) })
                  }
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove)
                    window.removeEventListener('mouseup', onUp)
                    coverDragRef.current = null
                    setCoverPos(p => {
                      updateNotebook(notebookId, { coverPos: p })
                      useAppStore.getState().persistNotebooks?.()
                      return p
                    })
                  }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                } : undefined}
              />
              {viewMode !== 'preview' && (
                <div className="nb-cover-actions">
                  <button className="nb-cover-action-btn" onClick={openPickerForEdit}>Edit</button>
                  <button className="nb-cover-action-btn" onClick={() => coverInputRef.current?.click()}>Change</button>
                  <button className="nb-cover-action-btn" onClick={() => {
                    setCoverImage(null)
                    setCoverPos({ x: 50, y: 50 })
                    updateNotebook(notebookId, { coverImage: null, coverPos: null })
                    useAppStore.getState().persistNotebooks?.()
                  }}>Remove</button>
                </div>
              )}
            </div>
          ) : null}

          {/* ── Title area ── */}
          <div className={`nb-title-area${viewMode === 'preview' ? ' nb-title-area-preview' : ''}`}>
            <div className="nb-content-wrap" style={{ maxWidth:780, margin:'0 auto', width:'100%', padding:`${coverImage ? 16 : 24}px 48px 0`, boxSizing:'border-box' }}>
              {/* "Add cover" hint — only in edit mode, revealed on hover via CSS */}
              {viewMode !== 'preview' && (
                <div className="nb-title-meta-row">
                  {!coverImage && (
                    <button className="nb-title-meta-btn" onClick={() => coverInputRef.current?.click()}>
                      <Image size={13} strokeWidth={1.4} style={{ marginRight: 5, flexShrink: 0 }} />
                      Add cover
                    </button>
                  )}
                </div>
              )}
              {viewMode === 'preview' ? (
                noteTitle && (
                  <div style={{ fontFamily:"'Stack Sans Text','Switzer','Satoshi',sans-serif", fontSize:'1.7em', fontWeight:700, color:'var(--text)', lineHeight:1.2 }}>
                    {noteTitle}
                  </div>
                )
              ) : (
                <input value={noteTitle}
                  onChange={e => { const t=e.target.value; setTitle(t); titleRef.current=t; scheduleSave(contentRef.current) }}
                  placeholder="Title…"
                  style={{ width:'100%', background:'none', border:'none', outline:'none', fontFamily:"'Stack Sans Text','Switzer','Satoshi',sans-serif", fontSize:'1.7em', fontWeight:700, color:'var(--text)', lineHeight:1.1, padding:0, caretColor:'var(--accent)' }}
                  onKeyDown={e => { if(e.key==='Enter'){e.preventDefault();cmRef.current?.focus()} }}
                />
              )}
            </div>
          </div>
          {/* Divider — hidden in preview */}
          {viewMode !== 'preview' && (
            <div style={{ maxWidth:780, margin:'0 auto 0', width:'100%', padding:'0 48px', boxSizing:'border-box', pointerEvents:'none' }}>
              <div style={{ height:1, background:'var(--borderSubtle)', opacity:.5 }} />
            </div>
          )}
          {/* CodeMirror — mounted in all modes; read-only + live decorations in preview */}
          {nbError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
              margin: '0 0 8px', padding: '7px 12px', borderRadius: 9,
              background: 'color-mix(in srgb, #f0883e 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, #f0883e 40%, transparent)',
              fontSize: 12, color: 'var(--text)', lineHeight: 1.4,
            }}>
              <TriangleAlert size={13} strokeWidth={1.4} color="#f0883e" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{nbError}</span>
              <button onClick={() => setNbError(null)} style={{ border: 'none', background: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>×</button>
            </div>
          )}
          {/* External edit landed while this note had unsaved local changes —
              never resolved silently, either side would lose text. */}
          {extConflict && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap',
              margin: '0 0 8px', padding: '7px 12px', borderRadius: 9,
              background: 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
              border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
              fontSize: 12, color: 'var(--text)', lineHeight: 1.4,
            }}>
              <span style={{ flex: 1, minWidth: 180 }}>
                This note changed on disk while you had unsaved edits.
              </span>
              <button
                onClick={() => { applyExternal(extConflict.text, extConflict.title, extConflict.mtimeMs); setExtConflict(null) }}
                style={{ border: '1px solid var(--border)', background: 'none', color: 'var(--text)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', borderRadius: 7, padding: '4px 10px' }}
              >Load from disk</button>
              <button
                onClick={() => {
                  // Keep what's in the editor: re-baseline to the disk stamp so
                  // the next save is allowed to overwrite, then flush it.
                  diskMtimeRef.current = extConflict.mtimeMs
                  setExtConflict(null)
                  doSave(contentRef.current, titleRef.current)
                }}
                style={{ border: 'none', background: 'var(--accent)', color: 'var(--bg)', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', borderRadius: 7, padding: '4px 10px' }}
              >Keep mine</button>
            </div>
          )}
          <div ref={editorRef} className={`nb-cm${(viewMode==='live'||viewMode==='preview')?' nb-live':''}${viewMode==='preview'?' nb-preview':''}${viewMode==='source'?' nb-source':''}`} style={{ flex:1, overflow:'hidden', minHeight:0 }} />
          {/* Wiki-link dropdown */}
          {wikiDrop && wikiDrop.coords && (
            <div className="nb-wiki-dropdown" style={{
              position: 'fixed',
              left: Math.min(wikiDrop.coords.left, window.innerWidth - 370),
              top: Math.min(wikiDrop.coords.top, window.innerHeight - 340),
              zIndex: 9999,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              padding: 6,
              minWidth: 260,
              maxWidth: 360,
              maxHeight: 320,
              overflow: 'auto',
            }}>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {wikiDrop.options.map((opt, i) => (
                  <li key={`${opt.detail}-${opt.label}-${i}`}
                    onMouseDown={e => {
                      e.preventDefault()
                      // Confirm this option
                      const view = cmRef.current
                      if (view) {
                        const state = view.state
                        const cur = state.selection.main.head
                        const line = state.doc.lineAt(cur)
                        const col = cur - line.from
                        const textBefore = line.text.slice(0, col)
                        const idx = textBefore.lastIndexOf('[[')
                        if (idx !== -1) {
                          view.dispatch({ changes: { from: line.from + idx, to: cur, insert: opt.insert } })
                        }
                      }
                      setWikiDrop(null)
                    }}
                    style={{
                      padding: '9px 12px',
                      borderRadius: 8,
                      margin: '1px 0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                      transition: 'background 0.08s',
                      background: i === wikiDrop.selectedIdx ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                      color: i === wikiDrop.selectedIdx ? 'var(--accent)' : 'var(--text)',
                    }}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
                    <span style={{ fontSize: 12, opacity: 0.65, flexShrink: 0, paddingLeft: 8 }}>{opt.detail}</span>
                  </li>
                ))}
              </ul>
              <div style={{
                padding: '5px 12px 6px',
                fontSize: 10.5,
                color: 'var(--textDim)',
                opacity: 0.65,
                borderTop: '1px solid var(--borderSubtle)',
                marginTop: 4,
                textAlign: 'center',
                letterSpacing: '0.01em',
              }}>Tab to confirm · Esc to dismiss</div>
            </div>
          )}
          {/* ── Inline command dropdown (/color, /font, /spacing, /size) ──── */}
          {inlineCmd && inlineCmd.coords && (() => {
            const { type, hint, selectedIdx, coords, lineFrom, lineTo } = inlineCmd
            const options = type === 'color' ? INLINE_COLORS
              : type === 'font' ? INLINE_FONTS
              : type === 'spacing' ? INLINE_SPACINGS
              : type === 'size' ? INLINE_SIZES
              : type === 'align' ? INLINE_ALIGNS
              : type === 'columns' ? INLINE_COLUMNS
              : []  // bold/italic/bi/strike/highlight/code/sup/sub — no picker

            const filtered = hint
              ? options.filter(o => o.name.toLowerCase().startsWith(hint))
              : options
            const activeIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1))

            const TITLES = {
              color: 'Text Color', font: 'Font', spacing: 'Line Spacing', size: 'Text Size',
              align: 'Text Alignment', columns: 'Columns',
              bold: 'Bold', italic: 'Italic', bi: 'Bold Italic', strike: 'Strikethrough',
              highlight: 'Highlight', code: 'Inline Code', sup: 'Superscript', sub: 'Subscript',
            }

            const confirmOption = opt => {
              const view = cmRef.current
              if (!view || !opt) return
              const marker = `{${type}:${opt.value}}`
              view.dispatch({
                changes: { from: lineFrom, to: lineTo, insert: marker },
                selection: { anchor: lineFrom + marker.length },
              })
              setInlineCmd(null)
              view.focus()
            }

            return (
              <div style={{
                position: 'fixed',
                left: Math.min(coords.left, window.innerWidth - 380),
                top: Math.min(coords.top, window.innerHeight - 380),
                zIndex: 9999,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                padding: 6,
                minWidth: type === 'color' ? 280 : 240,
                maxWidth: 380,
                maxHeight: 360,
                overflow: 'auto',
              }}>
                <div style={{ padding: '4px 10px 6px', fontSize: 11, color: 'var(--textDim)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.7 }}>
                  {TITLES[type]}
                </div>
                {filtered.length === 0 ? (
                  <div style={{ padding: '10px 14px 8px', fontSize: 13, color: 'var(--textDim)', textAlign: 'center' }}>
                    Press <strong>Enter</strong> or <strong>Tab</strong> to apply
                  </div>
                ) : type === 'color' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, padding: '0 4px 4px' }}>
                    {filtered.map((opt, i) => (
                      <button key={opt.name} title={opt.name}
                        onMouseDown={e => { e.preventDefault(); confirmOption(opt) }}
                        style={{
                          width: 36, height: 36, borderRadius: 8,
                          border: i === activeIdx ? '2px solid var(--accent)' : '2px solid transparent',
                          background: opt.value.startsWith('var(') ? opt.value : opt.value === 'inherit' ? 'var(--surfaceAlt)' : opt.value,
                          cursor: 'pointer', outline: 'none', position: 'relative',
                        }}>
                        {opt.value === 'inherit' && (
                          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--text)', fontWeight: 700 }}>∅</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {filtered.map((opt, i) => (
                      <li key={opt.name}
                        onMouseDown={e => { e.preventDefault(); confirmOption(opt) }}
                        style={{
                          padding: '8px 12px', borderRadius: 8, margin: '1px 0',
                          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                          background: i === activeIdx ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
                          color: i === activeIdx ? 'var(--accent)' : 'var(--text)',
                        }}>
                        {type === 'font' && (
                          <>
                            <span style={{ flex: 1, fontSize: 14, fontFamily: opt.value, fontWeight: 500 }}>{opt.name}</span>
                            <span style={{ fontSize: 11, opacity: 0.5, fontFamily: opt.value }}>Abc</span>
                          </>
                        )}
                        {type === 'size' && (
                          <>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{opt.name}</span>
                            <span style={{ fontSize: opt.value, opacity: 0.75, lineHeight: 1 }}>Aa</span>
                          </>
                        )}
                        {(type === 'spacing') && (
                          <>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{opt.name}</span>
                            <span style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>{opt.preview}</span>
                          </>
                        )}
                        {type === 'align' && (() => {
                          const Glyph = opt.value === 'left'
                            ? AlignLeft
                            : opt.value === 'center'
                            ? AlignCenter
                            : opt.value === 'right'
                            ? AlignRight
                            : AlignJustify
                          return (
                            <>
                              <Glyph size={16} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.7 }} />
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{opt.name}</span>
                            </>
                          )
                        })()}
                        {type === 'columns' && (
                          <>
                            <span style={{ fontSize: 13, opacity: 0.7, width: 28, textAlign: 'center', flexShrink: 0, letterSpacing: 1 }}>{opt.preview}</span>
                            <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{opt.name}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ padding: '5px 12px 6px', fontSize: 10.5, color: 'var(--textDim)', opacity: 0.65, borderTop: '1px solid var(--borderSubtle)', marginTop: 4, textAlign: 'center', letterSpacing: '0.01em' }}>
                  {filtered.length > 0 ? '↑↓ navigate · Tab/Enter confirm · Esc dismiss' : 'Tab/Enter confirm · Esc dismiss'}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {editModal && <NotebookBacklinksPanel notebook={notebook} notebooks={notebooks} onClose={() => setEditModal(false)} />}
      {historyOpen && (
        <NotebookHistoryPanel
          notebook={notebook}
          currentText={titleRef.current ? `# ${titleRef.current}\n${contentRef.current}` : contentRef.current}
          onRestore={(text) => {
            // Reuse the external-adopt path: pushes into CM6 with the cursor kept,
            // refreshes the card, and re-bases the merge baseline.
            const r = splitTitle(text)
            applyExternal(r.text, r.title, Date.now())
            flushSaveRef.current?.()
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {sharing && (
        <Suspense fallback={null}>
          <NoteCollabPanel
            notebookId={notebookId}
            noteTitle={titleRef.current || noteTitle}
            notebookDir={notebookDirRef.current}
            seedText={contentRef.current}
            visible={collabOpen}
            onClose={(ended) => { setCollabOpen(false); if (ended) { setSharing(false); setCollabBits(null) } }}
            onReady={setCollabBits}
            onGuestCount={setCollabGuestCount}
          />
        </Suspense>
      )}

      {/* Ambient "this note is live" reminder — the panel itself can be
          closed while the session keeps running (same relationship as
          History has to collabOpen), so without this there'd be no visible
          sign a note is being shared once you dismiss the panel. Icon-only
          (matches gnos-settings-btn's own economy), guest count as a small
          badge rather than inline text. `absolute` within .nb-root (which
          is `position: relative`), not `fixed` to the window, so split-pane
          notes each get their own, correctly scoped to their own pane
          rather than one indicator fixed to a window corner regardless of
          which pane is actually sharing. */}
      {sharing && !collabOpen && (
        <button
          onClick={() => setCollabOpen(true)}
          title={`This note is being live-shared${collabGuestCount ? ` — ${collabGuestCount} connected` : ''} — click to open the panel`}
          style={{
            position: 'absolute', bottom: 14, right: 14, zIndex: 1080,
            width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--borderSubtle)',
            boxShadow: '0 4px 16px rgba(0,0,0,.25)', color: 'var(--text)', cursor: 'pointer', padding: 0,
          }}
        >
          <Users size={14} strokeWidth={1.8} />
          {collabGuestCount > 0 && (
            <span style={{
              position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7,
              background: '#2eaf7d', color: '#fff', fontSize: 9.5, fontWeight: 700, lineHeight: '14px', textAlign: 'center',
            }}>
              {collabGuestCount}
            </span>
          )}
        </button>
      )}

      {showMobileViewMenu && (
        <div style={{ position:'fixed', bottom:'calc(max(12px,env(safe-area-inset-bottom,0px)+6px)+45px+8px)',
          left:'50%', transform:'translateX(-50%)',
          background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
          boxShadow:'0 4px 24px rgba(0,0,0,0.35)', zIndex:9200, overflow:'hidden',
          display:'flex', flexDirection:'column' }}>
          {['live','source','preview'].map(m => (
            <button key={m} onClick={() => { switchMode(m); setShowMobileViewMenu(false) }}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 20px',
                border:'none', background:'none', cursor:'pointer', textAlign:'left',
                fontSize:14, fontFamily:'inherit', color: viewMode===m?'var(--accent)':'var(--text)',
                fontWeight: viewMode===m ? 700 : 500 }}>
              {MODE_META[m].icon}
              <span>{MODE_META[m].label}</span>
              {viewMode===m && <span style={{ marginLeft:'auto', fontSize:11, opacity:0.7 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
      {showMobileViewMenu && <div style={{ position:'fixed', inset:0, zIndex:9199 }} onClick={() => setShowMobileViewMenu(false)} />}

      {/* ── /linkw URL input modal ──────────────────────────────────────────── */}
      {linkPicker?.type === 'web' && (
        <div className="nb-linkw-modal-backdrop" onMouseDown={e => {
          if (e.target === e.currentTarget) { setLinkPicker(null); setLinkWebUrl('') }
        }}>
          <form className="nb-linkw-modal" onSubmit={e => {
            e.preventDefault()
            const url = linkWebUrl.trim()
            if (url && cmRef.current) {
              const insertText = `/linkw:${url}\n`
              cmRef.current.dispatch({
                changes: { from: linkPicker.lineFrom, to: linkPicker.lineTo, insert: insertText },
                selection: { anchor: linkPicker.lineFrom + insertText.length },
              })
            }
            setLinkPicker(null); setLinkWebUrl('')
          }}>
            <div className="nb-linkw-modal-title">Embed webpage</div>
            <input
              autoFocus
              className="nb-linkw-modal-input"
              type="url"
              placeholder="https://example.com"
              value={linkWebUrl}
              onChange={e => setLinkWebUrl(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { e.preventDefault(); setLinkPicker(null); setLinkWebUrl('') }
              }}
            />
            <div className="nb-linkw-modal-hint">Press Enter to embed · Esc to cancel</div>
          </form>
        </div>
      )}

      {/* ── Cover image picker ──────────────────────────────────────────────── */}
      {coverPicker && (
        <div className="nb-cover-picker-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) cancelPicker() }}>
          <div className="nb-cover-picker-panel">
            <div className="nb-cover-picker-header">
              <span>Position cover image</span>
              <span className="nb-cover-picker-hint">Drag to reposition · Use slider to zoom</span>
            </div>

            {/* Thumbnail preview — image zooms and pans within the fixed frame */}
            <div
              className="nb-cover-picker-stage"
              style={{ aspectRatio: `${Math.round((window.innerWidth || 1200) / 220 * 100) / 100}` }}
              onMouseDown={e => {
                e.preventDefault()
                const startX = e.clientX, startY = e.clientY
                const snap = { ...coverPicker.pos }
                const sc = Math.max(1, coverPicker.scale ?? 1)
                const el = e.currentTarget
                const sW = el.offsetWidth, sH = el.offsetHeight
                const overflowX = sW * (sc - 1)
                const overflowY = sH * (sc - 1)
                const onMove = ev => {
                  const dx = ev.clientX - startX, dy = ev.clientY - startY
                  const newX = overflowX > 0 ? Math.max(0, Math.min(100, snap.x - dx / overflowX * 100)) : 50
                  const newY = overflowY > 0 ? Math.max(0, Math.min(100, snap.y - dy / overflowY * 100)) : 50
                  setCoverPicker(p => p ? { ...p, pos: { x: newX, y: newY } } : p)
                }
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            >
              <img
                src={coverPicker.objectUrl}
                className="nb-cover-picker-img"
                draggable={false}
                style={{
                  transform: `scale(${Math.max(1, coverPicker.scale ?? 1)})`,
                  transformOrigin: `${coverPicker.pos.x}% ${coverPicker.pos.y}%`,
                }}
              />
            </div>

            {/* Zoom controls */}
            <div className="nb-cpick-zoom">
              <button className="nb-cpick-zoom-btn" onClick={() => {
                setCoverPicker(p => p ? { ...p, scale: Math.max(1, (p.scale ?? 1) / 1.2) } : p)
              }} title="Zoom out">−</button>
              <Slider
                min={1} max={4} step={0.01}
                value={Math.max(1, coverPicker.scale ?? 1)}
                className="nb-cpick-zoom-slider"
                onChange={v => setCoverPicker(p => p ? { ...p, scale: v } : p)}
              />
              <button className="nb-cpick-zoom-btn" onClick={() => {
                setCoverPicker(p => p ? { ...p, scale: Math.min(4, (p.scale ?? 1) * 1.2) } : p)
              }} title="Zoom in">+</button>
            </div>

            <div className="nb-cover-picker-footer">
              <button className="nb-cover-picker-cancel" onClick={cancelPicker}>Cancel</button>
              <button className="nb-cover-picker-apply" onClick={applyPicker}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Version history panel ────────────────────────────────────────────────────
// The retrospective "merge chooser". Merges are silent by design, so this is
// where they become visible: `remote` entries are what arrived from disk/a peer,
// `local` entries are what a conflict discarded. That audit trail is what makes
// silent merging safe rather than lossy. See PLAN_CONCURRENCY.md.
// App.jsx exports TITLEBAR_H, but App imports this file — importing back would
// be circular. The chapters pop-in uses the same 34px offset.
const NB_TITLEBAR_H = 34

function NotebookHistoryPanel({ notebook, currentText, onRestore, onClose }) {
  const [versions, setVersions] = useState(null)
  const [openFile, setOpenFile] = useState(null)   // which row is expanded
  const [texts, setTexts] = useState({})           // file -> loaded text
  const [busy, setBusy] = useState(false)
  const [H, setH] = useState(null)

  useEffect(() => {
    let gone = false
    ;(async () => {
      try {
        const h = await import('@/lib/history')
        const list = await h.listVersions(notebook?.id)
        if (!gone) { setH(h); setVersions(list) }
      } catch { if (!gone) setVersions([]) }
    })()
    return () => { gone = true }
  }, [notebook?.id])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function toggle(v) {
    if (openFile === v.file) { setOpenFile(null); return }
    setOpenFile(v.file)
    if (texts[v.file] == null && H) {
      const t = await H.readVersion(notebook.id, v.file)
      setTexts(prev => ({ ...prev, [v.file]: t ?? '' }))
    }
  }

  async function doRestore(v) {
    if (busy || !H) return
    setBusy(true)
    try {
      const text = await H.restoreVersion(notebook.id, v.file, currentText)
      if (text != null) { onRestore?.(text); onClose?.() }
    } finally { setBusy(false) }
  }

  // "Was this me, or something outside Gnos?" is the first question — so origin
  // is the row's primary label, not a footnote.
  const ORIGIN = {
    external: { color: '#4a90e2', icon: 'M12 5v14M19 12l-7 7-7-7' },
    internal: { color: '#8b949e', icon: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z' },
    merged:   { color: '#2eaf7d', icon: 'M7 3v12a4 4 0 0 0 4 4h6M17 3v6' },
  }
  const metaOf = k => {
    const o = H ? H.originOf(k) : { origin: 'internal', label: k, hint: '' }
    return { ...o, ...ORIGIN[o.origin] }
  }

  const dayLabel = ts => {
    const d = new Date(ts), now = new Date()
    const same = (a, b) => a.toDateString() === b.toDateString()
    if (same(d, now)) return 'Today'
    const y = new Date(now); y.setDate(y.getDate() - 1)
    if (same(d, y)) return 'Yesterday'
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  }
  const timeLabel = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const groups = []
  for (const v of (versions || [])) {
    const label = dayLabel(v.ts)
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] })
    groups[groups.length - 1].items.push(v)
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1099 }} />
      <aside style={{
        // Same language as the audiobook chapters pop-in: a floating rounded
        // card tucked under the title bar, not a full-bleed panel.
        position: 'fixed', right: 8, top: NB_TITLEBAR_H + 6, bottom: 8, width: 340, maxWidth: '92vw', zIndex: 1100,
        background: 'var(--surface)', border: '1px solid var(--borderSubtle)',
        borderRadius: 12, boxShadow: '-8px 0 32px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'nbh-in .18s cubic-bezier(.16,1,.3,1)',
      }}>
        <style>{`
          @keyframes nbh-in { from { opacity:0; transform: translateX(8px) } to { opacity:1; transform:none } }
          @keyframes nbh-open { from { opacity:0 } to { opacity:1 } }
          .nbh-row { display:flex; align-items:center; gap:8px; width:100%; text-align:left;
                     padding:6px 8px; border:none; background:none; cursor:pointer;
                     font-family:inherit; transition:background .1s }
          .nbh-row:hover { background: var(--hover) }
          .nbh-item[data-on="1"] { background: var(--surfaceAlt) }
          .nbh-scroll::-webkit-scrollbar { width:8px }
          .nbh-scroll::-webkit-scrollbar-thumb { background:var(--border); border-radius:6px; border:2px solid var(--surface) }
          .nbh-scroll::-webkit-scrollbar-track { background:transparent }
          .nbh-day { position:sticky; top:0; z-index:1; padding:7px 14px 3px; font-size:10px; font-weight:700;
                     letter-spacing:.06em; text-transform:uppercase; color:var(--textDim); background:var(--surface) }
        `}</style>

        {/* Header — no divider rule; the spacing carries the separation */}
        <div style={{
          padding: '11px 12px 4px 14px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--textDim)' }}>
            History
          </span>
          <button onClick={onClose} title="Close (Esc)" style={{
            width: 20, height: 20, padding: 0, border: 'none', background: 'none',
            color: 'var(--textDim)', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', transition: 'color .12s',
          }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f85149' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--textDim)' }}>
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>

        <div className="nbh-scroll" style={{ overflowY: 'auto', flex: 1, minHeight: 0, paddingBottom: 8 }}>
          {versions === null && <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--textDim)' }}>Loading…</div>}

          {versions?.length === 0 && (
            <div style={{ padding: '26px 20px', textAlign: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.6" strokeLinecap="round" style={{ marginBottom: 9 }}>
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 550, marginBottom: 3 }}>No earlier versions</div>
              <div style={{ fontSize: 11, color: 'var(--textDim)', lineHeight: 1.5 }}>
                Snapshots are taken as you write, and when changes arrive from elsewhere. Kept 7 days.
              </div>
            </div>
          )}

          {groups.map(g => (
            <div key={g.label}>
              <div className="nbh-day">{g.label}</div>
              {g.items.map(v => {
                const m = metaOf(v.kind)
                const on = openFile === v.file
                const text = texts[v.file]
                const rows = (on && H && text != null) ? H.diffRows(text, currentText) : null
                const stats = (on && H && text != null) ? H.diffLines(text, currentText) : null
                return (
                  <div key={v.file} className="nbh-item" data-on={on ? '1' : '0'}
                    style={{ borderRadius: 8, margin: '0 6px 1px', overflow: 'hidden' }}>
                    {/* Accordion header */}
                    <button className="nbh-row" onClick={() => toggle(v)} title={m.hint}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--textDim)"
                        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flexShrink: 0, transform: on ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={m.color}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d={m.icon} />
                      </svg>
                      <span style={{ fontSize: 12, color: 'var(--text)', width: 58, flexShrink: 0 }}>{timeLabel(v.ts)}</span>
                      <span style={{ fontSize: 11.5, color: m.color, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.label}
                      </span>
                    </button>

                    {/* Accordion body */}
                    {on && (
                      <div style={{ animation: 'nbh-open .15s ease', padding: '0 8px 8px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '1px 2px 8px' }}>
                          {stats && (
                            <span style={{ fontSize: 10.5, fontFamily: 'SF Mono,Menlo,monospace', display: 'flex', gap: 5 }}>
                              <span style={{ color: '#2eaf7d' }}>+{stats.added}</span>
                              <span style={{ color: '#f85149' }}>−{stats.removed}</span>
                            </span>
                          )}
                          <span style={{ flex: 1 }} />
                          <button onClick={() => doRestore(v)} disabled={busy} style={{
                            padding: '4px 12px', borderRadius: 7, border: 'none', flexShrink: 0,
                            background: busy ? 'var(--surfaceAlt)' : 'var(--accent)',
                            color: busy ? 'var(--textDim)' : '#fff',
                            fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer',
                          }}>{busy ? '…' : 'Restore'}</button>
                        </div>
                        {text == null ? (
                          <div style={{ fontSize: 11, color: 'var(--textDim)', padding: '4px 2px' }}>Loading…</div>
                        ) : (
                          <div style={{
                            borderRadius: 7, overflow: 'hidden',
                            border: '1px solid var(--borderSubtle)',
                            fontSize: 11, lineHeight: 1.55, fontFamily: 'SF Mono,Menlo,Consolas,monospace',
                            background: 'color-mix(in srgb, var(--surfaceAlt) 50%, transparent)',
                          }}>
                            {(rows || []).map((r, i) => {
                              if (r.type === 'skip') return (
                                <div key={i} style={{ padding: '2px 9px', color: 'var(--textDim)', fontSize: 10 }}>
                                  ⋯ {r.count} unchanged {r.count === 1 ? 'line' : 'lines'}
                                </div>
                              )
                              const tint = r.type === 'add' ? 'rgba(46,175,125,.13)' : r.type === 'del' ? 'rgba(248,81,73,.12)' : 'transparent'
                              const col  = r.type === 'add' ? '#2eaf7d' : r.type === 'del' ? '#f85149' : 'var(--textDim)'
                              return (
                                <div key={i} style={{ display: 'flex', gap: 7, padding: '1px 9px', background: tint, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                  <span style={{ color: col, flexShrink: 0, userSelect: 'none' }}>{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
                                  <span style={{ color: r.type === 'ctx' ? 'var(--textDim)' : 'var(--text)', flex: 1 }}>{r.text || ' '}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}

// ─── Backlinks & tags panel ───────────────────────────────────────────────────
// The markdown syntax reference formerly shown here now lives in the Settings
// window (Notebook page) — see src/lib/markdownSyntaxRef.js.
function NotebookBacklinksPanel({ notebook, notebooks, onClose }) {
  const [blView, setBlView] = useState('list') // 'list' | 'graph'
  const [backlinks, setBacklinks] = useState(null) // null = loading, [] = none
  const [forwardsLinks, setForwardsLinks] = useState(null) // null = loading, [] = none
  const [tagSearch, setTagSearch] = useState('')
  const [tagResults, setTagResults] = useState(null) // null = idle, [] = no matches
  const title = notebook?.title || ''

  useEffect(() => {
    if (backlinks !== null) return
    let gone = false
    ;(async () => {
      const { loadNotebookContent } = await import('@/lib/storage')
      const refs = []
      for (const nb of (notebooks || [])) {
        if (nb.id === notebook?.id) continue
        try {
          const content = await loadNotebookContent(nb.id)
          const pattern = new RegExp(`\\[\\[${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^\\]]*)?\\]\\]`, 'i')
          if (pattern.test(content || '')) refs.push(nb)
        } catch { /* skip */ }
      }
      if (!gone) setBacklinks(refs)
    })()
    return () => { gone = true }
  }, [backlinks, notebooks, notebook, title])

  // Scan current notebook's content for outgoing [[wikilinks]]
  useEffect(() => {
    if (forwardsLinks !== null || !notebook?.id) return
    let gone = false
    ;(async () => {
      const { loadNotebookContent } = await import('@/lib/storage')
      try {
        const content = await loadNotebookContent(notebook.id)
        const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
        const seen = new Set()
        const fwd = []
        let m
        while ((m = wikiRe.exec(content || '')) !== null) {
          const linkedTitle = m[1].trim()
          if (seen.has(linkedTitle)) continue
          seen.add(linkedTitle)
          const found = (notebooks || []).find(n => n.title?.toLowerCase() === linkedTitle.toLowerCase() && n.id !== notebook.id)
          if (found) fwd.push(found)
        }
        if (!gone) setForwardsLinks(fwd)
      } catch { if (!gone) setForwardsLinks([]) }
    })()
    return () => { gone = true }
  }, [forwardsLinks, notebook, notebooks])

  useEffect(() => {
    const raw = tagSearch.replace(/^::/, '').trim().toLowerCase()
    if (!raw) { setTagResults(null); return }
    const now = new Date()
    const todayStr = now.toDateString()
    if (raw === 'today') {
      const matches = (notebooks || [])
        .filter(nb => nb.id !== notebook?.id && nb.dueDate && new Date(nb.dueDate).toDateString() === todayStr)
        .map(nb => ({ nb, dueLabel: new Date(nb.dueDate).toLocaleDateString('en-US', { month:'short', day:'numeric' }), dueState: 'today' }))
      setTagResults(matches); return
    }
    if (raw === 'overdue') {
      const matches = (notebooks || [])
        .filter(nb => nb.id !== notebook?.id && nb.dueDate && new Date(nb.dueDate) < now)
        .map(nb => ({ nb, dueLabel: new Date(nb.dueDate).toLocaleDateString('en-US', { month:'short', day:'numeric' }), dueState: 'overdue' }))
      setTagResults(matches); return
    }
    let gone = false
    setTagResults(null)
    ;(async () => {
      const { loadNotebookContent } = await import('@/lib/storage')
      const tagRe = /::([a-zA-Z][a-zA-Z0-9_-]*)/g
      const matches = []
      for (const nb of (notebooks || [])) {
        if (nb.id === notebook?.id) continue
        try {
          const content = await loadNotebookContent(nb.id)
          tagRe.lastIndex = 0
          const tags = new Set()
          let m
          while ((m = tagRe.exec(content || '')) !== null) tags.add(m[1].toLowerCase())
          const hit = [...tags].filter(t => t.includes(raw))
          if (hit.length) matches.push({ nb, tags: hit })
        } catch { /* skip */ }
      }
      if (!gone) setTagResults(matches)
    })()
    return () => { gone = true }
  }, [tagSearch, notebooks, notebook])

  // Tree graph: backlinks feed INTO the current note (arrows pointing right → current)
  // forwards links branch OUT from the current note (arrows pointing right → linked)
  function ConnectionsTree({ backlinks: bls, forwardsLinks: fwds }) {
    const loading = bls === null || fwds === null
    if (loading) return (
      <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--textDim)', fontSize:12, padding:'8px 0' }}>
        <div className="spinner" /><span>Scanning…</span>
      </div>
    )
    const hasBls = bls?.length > 0
    const hasFwds = fwds?.length > 0
    if (!hasBls && !hasFwds) return (
      <div style={{ color:'var(--textDim)', fontSize:13, padding:'12px 0', textAlign:'center' }}>No connections found.</div>
    )

    const NODE_W = 110, NODE_H = 28, GAP_Y = 10, COL_GAP = 70
    const CENTER_X = 160, CENTER_Y_BASE = 20

    // Layout backlink nodes on the left, forwards on the right
    const blNodes = (bls || []).map((nb, i) => ({ nb, x: CENTER_X - COL_GAP - NODE_W, y: CENTER_Y_BASE + i * (NODE_H + GAP_Y) }))
    const fwNodes = (fwds || []).map((nb, i) => ({ nb, x: CENTER_X + COL_GAP, y: CENTER_Y_BASE + i * (NODE_H + GAP_Y) }))

    const allRows = Math.max(blNodes.length, fwNodes.length, 1)
    const centerY = CENTER_Y_BASE + ((allRows - 1) * (NODE_H + GAP_Y)) / 2
    const svgH = CENTER_Y_BASE * 2 + allRows * (NODE_H + GAP_Y)
    const svgW = CENTER_X * 2 + COL_GAP + NODE_W

    function nodeLabel(nb) {
      const t = nb.title || 'Untitled'
      return t.length > 13 ? t.slice(0, 12) + '…' : t
    }

    function ArrowLine({ x1, y1, x2, y2 }) {
      const dx = x2 - x1, dy = y2 - y1
      const len = Math.sqrt(dx * dx + dy * dy)
      const ux = dx / len, uy = dy / len
      const AH = 7
      const ax = x2 - ux * AH, ay = y2 - uy * AH
      const perp = { x: -uy * 3, y: ux * 3 }
      return (
        <g>
          <line x1={x1} y1={y1} x2={ax} y2={ay} stroke="var(--border)" strokeWidth="1.4" />
          <polygon points={`${x2},${y2} ${ax + perp.x},${ay + perp.y} ${ax - perp.x},${ay - perp.y}`} fill="var(--border)" />
        </g>
      )
    }

    function NoteBox({ x, y, nb, accent }) {
      return (
        <g>
          <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={6} fill={accent ? 'var(--accent)' : 'var(--surfaceAlt)'} stroke={accent ? 'var(--accent)' : 'var(--border)'} strokeWidth="1.2" />
          <text x={x + NODE_W / 2} y={y + NODE_H / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill={accent ? '#fff' : 'var(--text)'} fontWeight={accent ? 700 : 500}>
            {nodeLabel(nb)}
          </text>
        </g>
      )
    }

    return (
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ maxHeight: Math.min(svgH, 320), overflow: 'visible' }}>
        {/* Backlink arrows: from right-edge of bl node → left-edge of center */}
        {blNodes.map(({ nb, x, y }) => (
          <ArrowLine key={nb.id}
            x1={x + NODE_W} y1={y + NODE_H / 2}
            x2={CENTER_X} y2={centerY + NODE_H / 2}
          />
        ))}
        {/* Forwards arrows: from right-edge of center → left-edge of fwd node */}
        {fwNodes.map(({ nb, x, y }) => (
          <ArrowLine key={nb.id}
            x1={CENTER_X + NODE_W} y1={centerY + NODE_H / 2}
            x2={x} y2={y + NODE_H / 2}
          />
        ))}
        {/* Backlink nodes */}
        {blNodes.map(({ nb, x, y }) => <NoteBox key={nb.id} x={x} y={y} nb={nb} />)}
        {/* Center node */}
        <NoteBox x={CENTER_X} y={centerY} nb={{ title }} accent />
        {/* Forwards link nodes */}
        {fwNodes.map(({ nb, x, y }) => <NoteBox key={nb.id} x={x} y={y} nb={nb} />)}
        {/* Legend */}
        {hasBls && <text x={blNodes[0].x + NODE_W / 2} y={CENTER_Y_BASE - 8} textAnchor="middle" fontSize={8} fill="var(--textDim)" opacity={0.7}>links here</text>}
        {hasFwds && <text x={fwNodes[0].x + NODE_W / 2} y={CENTER_Y_BASE - 8} textAnchor="middle" fontSize={8} fill="var(--textDim)" opacity={0.7}>linked from here</text>}
      </svg>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:10000, display:'flex', alignItems:'center', justifyContent:'center' }} onClick={onClose}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, width:620, maxWidth:'94vw', maxHeight:'80vh', display:'flex', flexDirection:'column', boxShadow:'0 20px 60px rgba(0,0,0,.55)' }} onClick={e=>e.stopPropagation()}>
        {/* Header — markdown syntax reference moved to Settings → Notebook */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', flexShrink:0 }}>
          <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>Backlinks & Tags</span>
          <button onClick={onClose} title="Close" style={{width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s,color 0.1s,border-color 0.1s'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(248,81,73,0.12)';e.currentTarget.style.color='#f85149';e.currentTarget.style.borderColor='rgba(248,81,73,0.4)'}} onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)';e.currentTarget.style.borderColor='var(--border)'}}><X size={9} strokeWidth={1.5} /></button>
        </div>
        <div style={{ borderTop:'1px solid var(--border)', marginTop:0 }} />

        <div style={{ overflow:'auto', padding:'14px 20px 20px', flex:1, display:'flex', flexDirection:'column', gap:16 }}>

            {/* ── Tag search ─────────────────────────────────────────── */}
            <div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--textDim)', opacity:.6, marginBottom:8 }}>Search by Tag</div>
              <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:7, padding:'5px 10px', marginBottom:8 }}>
                <Search size={12} strokeWidth={1.5} style={{ opacity: .5, flexShrink: 0 }} />
                <input
                  value={tagSearch}
                  onChange={e => setTagSearch(e.target.value)}
                  placeholder="::tagname or ::today"
                  style={{ flex:1, background:'none', border:'none', outline:'none', fontSize:12, color:'var(--text)', fontFamily:'inherit' }}
                />
                {tagSearch && <button onClick={() => setTagSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--textDim)', padding:0, lineHeight:1 }}>✕</button>}
              </div>
              {(() => {
                const raw = tagSearch.replace(/^::/, '').trim().toLowerCase()
                if (!raw) return null
                if (tagResults === null) return (
                  <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--textDim)', fontSize:12, padding:'4px 2px' }}>
                    <div className="spinner" /><span>Scanning…</span>
                  </div>
                )
                const emptyMsg = raw === 'today' ? 'Nothing due today'
                  : raw === 'overdue' ? 'No overdue notes'
                  : <span>No notes tagged <strong>{raw}</strong></span>
                return tagResults.length === 0
                  ? <div style={{ fontSize:12, color:'var(--textDim)', padding:'4px 2px' }}>{emptyMsg}</div>
                  : <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {tagResults.map(({ nb, tags, dueLabel, dueState }) => (
                        <div key={nb.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 11px', borderRadius:7, border:'1px solid var(--border)', background:'var(--surfaceAlt)' }}>
                          <NotebookText size={13} strokeWidth={1.3} />
                          <span style={{ fontSize:12, color:'var(--text)', fontWeight:500, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nb.title}</span>
                          <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                            {dueLabel
                              ? <span style={{ fontSize:10, padding:'1px 5px', borderRadius:4, background:'var(--surface)', border:'1px solid var(--border)', color: dueState === 'overdue' ? '#c02020' : '#b87000' }}>{dueLabel}</span>
                              : tags?.map(t => (
                                  <span key={t} style={{ fontSize:10, padding:'1px 5px', borderRadius:4, background:'var(--surface)', border:'1px solid var(--border)', color:'var(--textDim)' }}>{t}</span>
                                ))
                            }
                          </div>
                        </div>
                      ))}
                    </div>
              })()}
            </div>

            {/* ── Connections ─────────────────────────────────────────── */}
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', color:'var(--textDim)', opacity:.6 }}>Connections</div>
                <div style={{ display:'flex', gap:4 }}>
                  {[['list','List'],['graph','Graph']].map(([v,lbl]) => (
                    <button key={v} onClick={() => setBlView(v)} style={{
                      padding:'3px 9px', fontSize:11, fontWeight:600, borderRadius:6,
                      border:'1px solid var(--border)',
                      background: v === blView ? 'var(--accent)' : 'none',
                      color: v === blView ? '#fff' : 'var(--textDim)',
                      cursor:'pointer', fontFamily:'inherit',
                    }}>{lbl}</button>
                  ))}
                </div>
              </div>

              {blView === 'graph' ? (
                <ConnectionsTree backlinks={backlinks} forwardsLinks={forwardsLinks} />
              ) : (
                <>
                  {/* Backlinks */}
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--textDim)', marginBottom:5, marginTop:2 }}>← Links to this note</div>
                  {backlinks === null ? (
                    <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--textDim)', fontSize:12, padding:'6px 0 10px' }}>
                      <div className="spinner" /><span>Scanning…</span>
                    </div>
                  ) : backlinks.length === 0 ? (
                    <div style={{ color:'var(--textDim)', fontSize:12, padding:'4px 0 10px' }}>No notes link to this one yet.</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:12 }}>
                      {backlinks.map(nb => (
                        <div key={nb.id} onClick={() => { const s = useAppStore.getState(); s.setActiveNotebook(nb); s.updateTab(s.activeTabId, { view: 'notebook', activeNotebook: nb }); s.setView('notebook') }} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surfaceAlt)', cursor:'pointer' }}>
                          <NotebookText size={13} strokeWidth={1.3} />
                          <span style={{ fontSize:12, color:'var(--text)', fontWeight:500 }}>{nb.title}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Forwards links */}
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--textDim)', marginBottom:5 }}>→ Links from this note</div>
                  {forwardsLinks === null ? (
                    <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--textDim)', fontSize:12, padding:'6px 0' }}>
                      <div className="spinner" /><span>Scanning…</span>
                    </div>
                  ) : forwardsLinks.length === 0 ? (
                    <div style={{ color:'var(--textDim)', fontSize:12, padding:'4px 0' }}>No outgoing links in this note.</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                      {forwardsLinks.map(nb => (
                        <div key={nb.id} onClick={() => { const s = useAppStore.getState(); s.setActiveNotebook(nb); s.updateTab(s.activeTabId, { view: 'notebook', activeNotebook: nb }); s.setView('notebook') }} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surfaceAlt)', cursor:'pointer' }}>
                          <NotebookText size={13} strokeWidth={1.3} />
                          <span style={{ fontSize:12, color:'var(--text)', fontWeight:500 }}>{nb.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
      </div>
    </div>
  )
}