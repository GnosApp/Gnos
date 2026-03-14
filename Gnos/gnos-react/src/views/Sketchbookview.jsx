/**
 * SketchbookView.jsx — Excalidraw-powered sketchpad + PDF canvas import
 *
 * New in this version:
 * ────────────────────
 * • PDF import button in the header — opens a file picker for .pdf files.
 *   Each PDF page is rasterized via a hidden <canvas> (using pdf.js loaded
 *   from CDN) and added to the Excalidraw canvas as an image element.
 *   Pages are placed in a vertical column so they don't overlap.
 * • pdf.js is loaded lazily from the cdnjs CDN so it doesn't add to the
 *   main bundle.
 * • A subtle import progress toast shows while pages are being rasterized.
 * • All other Excalidraw / storage / save behaviour is unchanged.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadSketchbookContent, saveSketchbookContent } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'

// ─────────────────────────────────────────────────────────────────────────────
// Per-theme Excalidraw configuration
// ─────────────────────────────────────────────────────────────────────────────
const THEME_CONFIG = {
  sepia:  { mode: 'light', canvasBg: '#f4efe6', strokeColor: '#3b2f20' },
  light:  { mode: 'light', canvasBg: '#f6f8fa', strokeColor: '#1f2328' },
  moss:   { mode: 'light', canvasBg: '#f2f5ee', strokeColor: '#2a3320' },
  dark:   { mode: 'dark',  canvasBg: '#0d1117', strokeColor: '#e6edf3' },
  cherry: { mode: 'dark',  canvasBg: '#0e0608', strokeColor: '#f2dde1' },
  sunset: { mode: 'dark',  canvasBg: '#0f0a04', strokeColor: '#f5e6c8' },
}

function getThemeConfig(themeKey) {
  return THEME_CONFIG[themeKey] ?? THEME_CONFIG.dark
}

// ─────────────────────────────────────────────────────────────────────────────
// Gnos-to-Excalidraw CSS bridge — updated dynamically on every theme change
// ─────────────────────────────────────────────────────────────────────────────
function buildExcalidrawStyles() {
  return `
  /* ── Theme via CSS variables (official Excalidraw approach) ── */
  .excalidraw-wrapper .excalidraw,
  .excalidraw-wrapper .excalidraw.theme--dark,
  .excalidraw-wrapper .excalidraw.theme--light {
    --color-primary:           var(--accent, #388bfd);
    --color-primary-darker:    var(--accentHover, #2d7de8);
    --color-primary-darkest:   color-mix(in srgb, var(--accent, #388bfd) 80%, #000);
    --color-primary-light:     color-mix(in srgb, var(--accent, #388bfd) 15%, transparent);
    --color-text:              var(--text);
    --color-icon:              var(--textDim);
    --color-surface-mid:       var(--surface);
    --color-surface-low:       var(--surfaceAlt);
    --color-surface-lowest:    var(--bg);
    --color-surface-high:      var(--surface);
    --color-outline:           var(--border);
    --color-border:            var(--border);
    --color-gray-10:           var(--surfaceAlt);
    --color-gray-20:           var(--border);
    --color-gray-30:           var(--borderSubtle);
    --color-gray-40:           var(--textDim);
    --color-gray-50:           var(--textDim);
    --default-font-family:     var(--font-ui, system-ui, -apple-system, sans-serif);
    --color-input-background:  var(--surfaceAlt);
    --button-bg:               var(--surfaceAlt);
    --button-color:            var(--text);
    --button-border:           var(--border);
    --overlay-bg-color:        rgba(0,0,0,0.55);
    --select-highlight-color:  color-mix(in srgb, var(--accent, #388bfd) 18%, transparent);
  }

  /* ── Structural rules only — no color overrides that could hit swatches ── */
  .excalidraw { font-family: var(--font-ui, system-ui, -apple-system, sans-serif) !important; }
  .excalidraw .App-toolbar { border-radius: 12px !important; }
  .excalidraw .App-toolbar--top { max-width: 100vw !important; overflow-x: auto !important; }
  .excalidraw .ToolIcon__icon { border-radius: 8px !important; transition: background 0.1s !important; }
  .excalidraw ::-webkit-scrollbar { width: 6px; height: 6px; }
  .excalidraw ::-webkit-scrollbar-track { background: transparent; }
  .excalidraw ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* ── Fix: Radix popper color picker renders at position:fixed which breaks
     when Excalidraw is inside a non-fullscreen container. Override to absolute. ── */
  .excalidraw-wrapper [data-radix-popper-content-wrapper] {
    position: absolute !important;
  }

  /* ── Toolbar overflow fix for dropdowns ── */
  .excalidraw .Island.App-toolbar { overflow: visible !important; }
  .excalidraw .App-toolbar--right {
    right: 8px !important;
    max-width: min(260px, calc(100vw - 16px)) !important;
  }
  .excalidraw .App-toolbar--right,
  .excalidraw .right-panel,
  .excalidraw .panel-container {
    max-height: calc(100vh - 80px) !important;
    overflow-y: auto !important;
  }
  .excalidraw .layer-ui__sidebar,
  .excalidraw .layer-ui__wrapper__footer-center .Island {
    max-width: calc(100vw - 16px) !important;
    right: 8px !important;
    left: auto !important;
  }
  @media (max-width: 640px) {
    .excalidraw .ToolIcon__icon { width: 28px !important; height: 28px !important; }
    .excalidraw .App-toolbar { gap: 2px !important; padding: 4px !important; }
    .excalidraw .App-toolbar--right { right: 4px !important; }
  }
`
}
function syncExcalidrawThemeStyles() {
  const id = 'gnos-excalidraw-theme'
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = buildExcalidrawStyles()
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-load Excalidraw
// ─────────────────────────────────────────────────────────────────────────────
let _excalidrawPromise = null
function loadExcalidraw() {
  if (_excalidrawPromise) return _excalidrawPromise
  _excalidrawPromise = import('@excalidraw/excalidraw').then(mod => {
    if (mod.Excalidraw) return { Excalidraw: mod.Excalidraw, utils: mod }
    if (typeof mod.default === 'function') return { Excalidraw: mod.default, utils: mod }
    if (mod.default?.Excalidraw) return { Excalidraw: mod.default.Excalidraw, utils: mod.default }
    throw new Error('Cannot locate Excalidraw export in @excalidraw/excalidraw')
  })
  return _excalidrawPromise
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-load pdf.js from CDN
// ─────────────────────────────────────────────────────────────────────────────
let _pdfJsPromise = null
function loadPdfJs() {
  if (_pdfJsPromise) return _pdfJsPromise
  _pdfJsPromise = loadPdfJsAsync()
  return _pdfJsPromise
}

async function loadPdfJsAsync() {
  if (window.pdfjsLib) return window.pdfjsLib
  await new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = res; s.onerror = rej
    document.head.appendChild(s)
  })
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  return window.pdfjsLib
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF → Excalidraw image elements
// Scale 1 pdf unit ≈ 1.5 px for decent resolution on canvas
// ─────────────────────────────────────────────────────────────────────────────
async function pdfToExcalidrawImages(file, onProgress) {
  const pdfjsLib = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const numPages = pdf.numPages

  // Target render width in px (Excalidraw scene units)
  const TARGET_W = 800
  const GAP = 40 // vertical gap between pages

  const images = [] // { dataUrl, width, height }
  for (let i = 1; i <= numPages; i++) {
    onProgress?.(i, numPages)
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const scale = TARGET_W / viewport.width
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement('canvas')
    canvas.width  = Math.round(scaledViewport.width)
    canvas.height = Math.round(scaledViewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise
    images.push({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height })
  }

  // Build Excalidraw elements + files map
  const elements = []
  const files = {}
  let y = 0

  for (const { dataUrl, width, height } of images) {
    // Unique fileId for Excalidraw
    const fileId = `pdf_page_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    // Strip data URL prefix to get mimeType and base64
    const header = dataUrl.split(',')[0]
    const mimeType = header.match(/:(.*?);/)[1]

    files[fileId] = {
      id: fileId,
      mimeType,
      dataURL: dataUrl,
      created: Date.now(),
    }

    elements.push({
      id: `el_${fileId}`,
      type: 'image',
      fileId,
      x: 0,
      y,
      width,
      height,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 1e9),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1e9),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: 'saved',
      scale: [1, 1],
    })

    y += height + GAP
  }

  return { elements, files }
}

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookView
// ─────────────────────────────────────────────────────────────────────────────
export default function SketchbookView() {
  const sketchbook          = useAppStore(s => s.activeSketchbook)
  const setView             = useAppStore(s => s.setView)
  const updateSketchbook    = useAppStore(s => s.updateSketchbook)
  const setActiveSketchbook = useAppStore(s => s.setActiveSketchbook)
  const themeKey            = useAppStore(s => s.themeKey ?? 'dark')

  const [ExcalidrawCmp, setExcalidrawCmp] = useState(null)
  const [sketchState, setSketchState] = useState({ loaded: false, initialData: null })
  const [loadError,   setLoadError]   = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft,   setTitleDraft]   = useState('')
  const [saveVisible, setSaveVisible] = useState(false)
  // PDF import state
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfProgress,  setPdfProgress]  = useState('')
  const [bgLocked,     setBgLocked]     = useState(false)
  const pdfInputRef = useRef(null)

  const excalidrawApiRef = useRef(null)
  const saveTimerRef     = useRef(null)
  const saveVisTimer     = useRef(null)
  const savedFilesRef    = useRef({})   // accumulates all files ever seen — never loses images

  const themeConfig = getThemeConfig(themeKey)
  const excalidrawTheme = themeConfig.mode

  // Sync CSS bridge on mount and whenever Gnos theme changes
  useEffect(() => {
    syncExcalidrawThemeStyles()
  }, [themeKey])

  // Push the correct default stroke color into Excalidraw whenever the API
  // becomes available or the theme changes, so new shapes are always visible.
  useEffect(() => {
    const api = excalidrawApiRef.current
    if (!api?.updateScene) return
    api.updateScene({
      appState: {
        currentItemStrokeColor: themeConfig.strokeColor,
        currentItemBackgroundColor: 'transparent',
        currentItemFillStyle: 'hachure',
      },
    })
  }, [themeKey, themeConfig.strokeColor])

  // ── Lazy-load Excalidraw bundle ─────────────────────────────────────────────
  useEffect(() => {
    loadExcalidraw()
      .then(({ Excalidraw }) => setExcalidrawCmp(() => Excalidraw))
      .catch(err => {
        console.error('[SketchbookView] Failed to load Excalidraw:', err)
        setLoadError(err.message)
      })
  }, [])
  const [loadedForId, setLoadedForId] = useState(null)

  useEffect(() => {
    if (!sketchbook?.id) return
    let cancelled = false
    excalidrawApiRef.current = null

    loadSketchbookContent(sketchbook.id).then(data => {
      if (cancelled) return
      const nextData = data?.excalidraw ?? { elements: [], appState: {}, files: {} }
      // Seed the accumulated files ref so existing images survive saves
      savedFilesRef.current = { ...(nextData.files ?? {}) }
      setSketchState({ loaded: true, initialData: nextData })
      setLoadedForId(sketchbook.id)
    }).catch(err => {
      if (cancelled) return
      console.error('[SketchbookView] load error:', err)
      setSketchState({ loaded: true, initialData: { elements: [], appState: {}, files: {} } })
      setLoadedForId(sketchbook.id)
    })

    return () => { cancelled = true }
  }, [sketchbook?.id])

  const isLoaded = sketchState.loaded && loadedForId === sketchbook?.id

  // ── Save ─────────────────────────────────────────────────────────────────────
  const doSave = useCallback(async (elements, appState, files) => {
    if (!sketchbook) return
    setSaving(true)
    // Merge with accumulated files ref so images are never lost.
    // Excalidraw only passes changed/new files in onChange.
    if (files) Object.assign(savedFilesRef.current, files)
    const allFiles = savedFilesRef.current
    const saveState = {
      elements: elements ?? [],
      appState: {
        gridSize:               appState?.gridSize ?? null,
        viewBackgroundColor:    appState?.viewBackgroundColor,
        currentItemFontFamily:  appState?.currentItemFontFamily,
        currentItemFontSize:    appState?.currentItemFontSize,
        currentItemTextAlign:   appState?.currentItemTextAlign,
        currentItemStrokeColor: appState?.currentItemStrokeColor,
        currentItemFillStyle:   appState?.currentItemFillStyle,
        currentItemStrokeWidth: appState?.currentItemStrokeWidth,
        currentItemRoughness:   appState?.currentItemRoughness,
        currentItemOpacity:     appState?.currentItemOpacity,
      },
      files: allFiles,
    }
    await saveSketchbookContent(sketchbook.id, { excalidraw: saveState })
    updateSketchbook(sketchbook.id, {
      updatedAt: new Date().toISOString(),
      elementCount: elements?.length ?? 0,
    })
    useAppStore.getState().persistSketchbooks?.()
    setSaving(false)
    clearTimeout(saveVisTimer.current)
    setSaveVisible(true)
    saveVisTimer.current = setTimeout(() => setSaveVisible(false), 1800)
  }, [sketchbook, updateSketchbook])

  const scheduleSave = useCallback((elements, appState, files) => {
    clearTimeout(saveTimerRef.current)
    // Deep-copy files immediately — Excalidraw can mutate the reference after onChange
    const filesCopy = files ? JSON.parse(JSON.stringify(files)) : null
    // Also merge into savedFilesRef right away (don't wait for the debounce)
    if (filesCopy) Object.assign(savedFilesRef.current, filesCopy)
    saveTimerRef.current = setTimeout(() => doSave(elements, appState, filesCopy), 1200)
  }, [doSave])

  // ── PDF import ────────────────────────────────────────────────────────────────
  const handlePdfImport = useCallback(async (file) => {
    if (!file || !excalidrawApiRef.current) return
    setPdfImporting(true)
    setPdfProgress('Loading PDF…')

    try {
      const { elements: newEls, files: newFiles } = await pdfToExcalidrawImages(
        file,
        (page, total) => setPdfProgress(`Rendering page ${page} / ${total}…`)
      )

      const api = excalidrawApiRef.current

      // Get current elements and files from the API
      const existingElements = api.getSceneElements() ?? []
      const existingFiles    = api.getFiles() ?? {}

      // Offset new elements so they appear to the right of existing content
      let offsetX = 0
      if (existingElements.length) {
        const maxX = existingElements.reduce((m, el) => Math.max(m, (el.x ?? 0) + (el.width ?? 0)), 0)
        offsetX = maxX + 80
      }
      const shiftedEls = newEls.map(el => ({ ...el, x: el.x + offsetX }))

      // Merge files into Excalidraw
      api.addFiles(Object.values(newFiles))

      // Merge elements via updateScene
      api.updateScene({
        elements: [...existingElements, ...shiftedEls],
      })

      // Scroll to bring the new content into view
      try {
        api.scrollToContent(shiftedEls, { fitToContent: false })
      } catch { /* optional */ }

      // Persist
      const appState = api.getAppState()
      await doSave([...existingElements, ...shiftedEls], appState, { ...existingFiles, ...newFiles })

      setPdfProgress(`Done — ${newEls.length} page${newEls.length === 1 ? '' : 's'} added`)
      setTimeout(() => { setPdfImporting(false); setPdfProgress('') }, 1600)
    } catch (err) {
      console.error('[SketchbookView] PDF import failed:', err)
      setPdfProgress('Import failed: ' + (err.message || String(err)))
      setTimeout(() => { setPdfImporting(false); setPdfProgress('') }, 2800)
    }
  }, [doSave])

  const openPdfPicker = useCallback(() => {
    pdfInputRef.current?.click()
  }, [])

  // ── Lock / unlock background images ──────────────────────────────────────────
  // Locks all image elements so they can't be accidentally selected or erased,
  // acting as a "background layer". Unlock restores them to editable.
  const lockBackground = useCallback(() => {
    const api = excalidrawApiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    const updated = elements.map(el =>
      el.type === 'image' ? { ...el, locked: true } : el
    )
    api.updateScene({ elements: updated })
    setBgLocked(true)
    const appState = api.getAppState()
    scheduleSave(updated, appState, api.getFiles())
  }, [scheduleSave])

  const unlockBackground = useCallback(() => {
    const api = excalidrawApiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    const updated = elements.map(el =>
      el.type === 'image' ? { ...el, locked: false } : el
    )
    api.updateScene({ elements: updated })
    setBgLocked(false)
    const appState = api.getAppState()
    scheduleSave(updated, appState, api.getFiles())
  }, [scheduleSave])

  // ── Flush save on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current)
      const api = excalidrawApiRef.current
      if (api) {
        try { doSave(api.getSceneElements(), api.getAppState(), api.getFiles()) }
        catch (e) { console.warn('[SketchbookView] flush-save on unmount failed:', e) }
      }
    }
  }, [doSave])


  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!sketchbook) return (
    <div style={{ display:'flex', height:'100%', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:14, margin:0 }}>No sketchbook selected.</p>
      <button onClick={() => setView('library')}
        style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
        Back to Library
      </button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg)' }}>

      {/* Hidden PDF file input */}
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display:'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) handlePdfImport(f)
        }}
      />

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="gnos-header" style={{
        display:'flex', alignItems:'center', gap:10, padding:'0 20px', height:52,
        background:'var(--headerBg)',
        borderBottom:'1px solid var(--borderSubtle)',
        flexShrink:0, zIndex:20, position:'relative',
      }}>
        <GnosNavButton />
        <div style={{ width:1, height:18, background:'var(--border)', flexShrink:0 }} />

        {/* Title — absolutely centered to the full header width */}
        <div style={{ position:'absolute', left:0, right:0, display:'flex', justifyContent:'center', alignItems:'center', pointerEvents:'none', zIndex:1 }}>
          <div style={{ pointerEvents:'auto' }}>
            {editingTitle
              ? <input
                  autoFocus
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    const t = titleDraft.trim() || sketchbook.title
                    updateSketchbook(sketchbook.id, { title: t })
                    setActiveSketchbook({ ...sketchbook, title: t })
                    useAppStore.getState().persistSketchbooks?.()
                    setEditingTitle(false)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                  }}
                  style={{
                    fontSize:13, fontWeight:600, color:'var(--text)',
                    background:'var(--surfaceAlt)', border:'1px solid var(--accent)',
                    borderRadius:6, padding:'3px 10px', outline:'none',
                    fontFamily:'inherit', textAlign:'center', minWidth:120, maxWidth:280,
                  }}
                />
              : <button
                  onClick={() => { setTitleDraft(sketchbook.title); setEditingTitle(true) }}
                  title="Click to rename"
                  style={{
                    fontSize:13, fontWeight:600, color:'var(--text)', background:'none',
                    border:'1px solid transparent', borderRadius:6, padding:'3px 10px',
                    cursor:'text', fontFamily:'inherit', textAlign:'center',
                    transition:'border-color 0.12s, background 0.12s',
                    maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.background='var(--surfaceAlt)'}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor='transparent';e.currentTarget.style.background='none'}}
                >{sketchbook.title}</button>
            }
          </div>
        </div>

        {/* Right-side actions */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'flex-end', gap:8 }}>
          {/* Save status */}
          <div style={{ fontSize:11, color:'var(--textDim)', opacity: saving || saveVisible ? 0.75 : 0, transition:'opacity 0.3s ease', whiteSpace:'nowrap' }}>
            {saving ? 'Saving…' : 'Saved'}
          </div>

          {sketchbook.elementCount > 0 && (
            <div style={{ fontSize:10, color:'var(--textDim)', background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 6px', fontVariantNumeric:'tabular-nums' }}>
              {sketchbook.elementCount} {sketchbook.elementCount === 1 ? 'shape' : 'shapes'}
            </div>
          )}

          {/* Lock Background button — locks all image elements as a background layer */}
          {isLoaded && ExcalidrawCmp && (
            <button
              onClick={bgLocked ? unlockBackground : lockBackground}
              title={bgLocked ? 'Unlock background images (make editable)' : 'Lock background images (protect from eraser)'}
              style={{
                display:'flex', alignItems:'center', gap:5,
                background: bgLocked ? 'rgba(56,139,253,0.12)' : 'var(--surfaceAlt)',
                border: bgLocked ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius:7, padding:'0 10px', height:28, cursor:'pointer',
                fontSize:12, fontFamily:'inherit',
                color: bgLocked ? 'var(--accent)' : 'var(--text)',
                transition:'background 0.1s, border-color 0.1s, color 0.1s',
              }}
              onMouseEnter={e=>{if(!bgLocked){e.currentTarget.style.borderColor='var(--accent)'}}}
              onMouseLeave={e=>{if(!bgLocked){e.currentTarget.style.borderColor='var(--border)'}}}
            >
              {bgLocked
                ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                : <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7V5a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
              }
              {bgLocked ? 'BG Locked' : 'Lock BG'}
            </button>
          )}

          {/* PDF Import button */}
          <button
            onClick={openPdfPicker}
            disabled={pdfImporting || !isLoaded || !ExcalidrawCmp}
            title="Import PDF into canvas"
            style={{
              display:'flex', alignItems:'center', gap:5,
              background:'var(--surfaceAlt)', border:'1px solid var(--border)',
              borderRadius:7, padding:'0 10px', height:28, cursor:'pointer',
              fontSize:12, fontFamily:'inherit', color:'var(--text)',
              transition:'background 0.1s, border-color 0.1s',
              opacity: (pdfImporting || !isLoaded) ? 0.5 : 1,
            }}
            onMouseEnter={e=>{ if (!pdfImporting) { e.currentTarget.style.background='var(--hover,rgba(255,255,255,0.06))'; e.currentTarget.style.borderColor='var(--accent)' }}}
            onMouseLeave={e=>{ e.currentTarget.style.background='var(--surfaceAlt)'; e.currentTarget.style.borderColor='var(--border)' }}
          >
            {/* PDF icon */}
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="1" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 7h4M5 9.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="12.5" cy="12.5" r="2.5" fill="var(--accent)" stroke="none"/>
              <path d="M12.5 11.5v2M11.5 12.5h2" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Import PDF
          </button>

        </div>
      </header>

      {/* ── PDF import progress toast ─────────────────────────────────────────── */}
      {pdfImporting && (
        <div style={{
          position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:10, padding:'10px 18px',
          boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
          display:'flex', alignItems:'center', gap:10,
          fontSize:13, color:'var(--text)',
          zIndex:1000, whiteSpace:'nowrap',
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ animation:'spin 0.8s linear infinite', flexShrink:0 }}>
            <circle cx="8" cy="8" r="6" stroke="var(--border)" strokeWidth="2"/>
            <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          {pdfProgress}
        </div>
      )}

      {/* ── Canvas ───────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', overflow:'auto', minHeight:0, minWidth:0, padding:0, margin:0 }}>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          .excalidraw-wrapper {
            position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important;
          }
          .excalidraw-wrapper > .excalidraw {
            position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important;
            /* No transform here — any transform offset breaks cursor coordinates */
          }
          .excalidraw-wrapper > .excalidraw > div,
          .excalidraw-wrapper > .excalidraw .App-container,
          .excalidraw-wrapper > .excalidraw .excalidraw-container {
            width: 100% !important; height: 100% !important;
          }
          /* Ensure pointer/cursor layers are also positioned correctly */
          .excalidraw .cursor,
          .excalidraw canvas { position: absolute !important; top: 0 !important; left: 0 !important; }
        `}</style>

        {/* Loading / error overlay */}
        {(!isLoaded || !ExcalidrawCmp) && !loadError && (
          <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', fontSize:13, gap:10 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation:'spin 1s linear infinite' }}>
              <circle cx="8" cy="8" r="6" stroke="var(--border)" strokeWidth="2"/>
              <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Loading canvas…
          </div>
        )}

        {loadError && (
          <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', fontSize:13, gap:12, padding:32, textAlign:'center' }}>
            <p style={{ margin:0, maxWidth:360 }}>Failed to load Excalidraw: {loadError}</p>
            <p style={{ margin:0, fontSize:11, opacity:0.6 }}>Make sure <code>@excalidraw/excalidraw</code> is installed and its CSS is available:<br/><code>npm install @excalidraw/excalidraw</code></p>
            <button onClick={() => setView('library')} style={{ marginTop:8, background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'7px 16px', cursor:'pointer', fontSize:12 }}>Back to Library</button>
          </div>
        )}

        {/* Excalidraw — key forces full remount when sketchbook changes */}
        {isLoaded && ExcalidrawCmp && !loadError && (
          <div className="excalidraw-wrapper" style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}>
            <ExcalidrawCmp
              key={sketchbook.id}
              initialData={{
                elements: sketchState.initialData?.elements ?? [],
                appState: {
                  ...sketchState.initialData?.appState,
                  viewBackgroundColor: sketchState.initialData?.appState?.viewBackgroundColor
                    ?? themeConfig.canvasBg,
                  currentItemStrokeColor: sketchState.initialData?.appState?.currentItemStrokeColor
                    ?? themeConfig.strokeColor,
                },
                // files must be passed explicitly — spread loses it
                files: sketchState.initialData?.files ?? {},
              }}
              theme={excalidrawTheme}
              excalidrawAPI={api => { excalidrawApiRef.current = api }}
              onChange={(elements, appState, files) => scheduleSave(elements, appState, files)}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: true,
                  clearCanvas: true,
                  export: { saveFileToDisk: true },
                  loadScene: true,
                  saveToActiveFile: false,
                  theme: false,        // theme toggle hidden — Gnos controls theme
                  saveAsImage: true,
                },
                // Show all toolbars so user has full access to features
                tools: { image: true },
                welcomeScreen: false,
              }}
              langCode="en"
              autoFocus
              handleKeyboardGlobally={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}