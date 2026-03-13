/**
 * SketchbookView.jsx — Excalidraw-powered sketchpad
 *
 * Fixes vs previous version
 * ──────────────────────────
 * • Dynamic import now handles all known Excalidraw export shapes:
 *     mod.Excalidraw  (v0.17+)
 *     mod.default     (some bundled builds)
 * • Removed the invalid `ref` prop — Excalidraw only supports the
 *   `excalidrawAPI` callback prop for its imperative handle.
 * • Added `UIOptions.tools` guard so missing optional toolbar items
 *   don't throw.
 * • initialData is only passed once per sketchbook load; switching
 *   sketchbooks forces a remount via the `key` prop.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadSketchbookContent, saveSketchbookContent } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'

// ─────────────────────────────────────────────────────────────────────────────
// Gnos-to-Excalidraw CSS bridge
// ─────────────────────────────────────────────────────────────────────────────
const EXCALIDRAW_THEME_STYLES = `
  .excalidraw,
  .excalidraw.theme--dark,
  .excalidraw.theme--light {
    --color-primary:         var(--accent,      #7c6af7);
    --color-primary-darker:  var(--accentHover, #6254d4);
    --color-primary-darkest: var(--accentDark,  #4c3fb8);
    --color-primary-light:   var(--accentGlow,  rgba(124,106,247,0.15));
  }
  .excalidraw .Island {
    background: var(--surface) !important;
    border: 1px solid var(--border) !important;
    border-radius: 12px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.35) !important;
  }
  .excalidraw .App-toolbar { border-radius: 12px !important; }
  .excalidraw .ToolIcon__icon {
    border-radius: 8px !important;
    transition: background 0.1s, color 0.1s !important;
  }
  .excalidraw .ToolIcon.is-selected .ToolIcon__icon,
  .excalidraw .ToolIcon:active .ToolIcon__icon {
    background: var(--accent) !important; color: #fff !important;
  }
  .excalidraw .ToolIcon:hover:not(.is-selected) .ToolIcon__icon {
    background: var(--surfaceAlt) !important;
  }
  .excalidraw .popover {
    background: var(--surface) !important; border: 1px solid var(--border) !important;
    border-radius: 10px !important; box-shadow: 0 8px 28px rgba(0,0,0,0.4) !important;
  }
  .excalidraw .context-menu {
    background: var(--surface) !important; border: 1px solid var(--border) !important;
    border-radius: 10px !important;
  }
  .excalidraw .context-menu-item:hover { background: var(--surfaceAlt) !important; }
  .excalidraw { font-family: var(--font-ui, system-ui, -apple-system, sans-serif) !important; }
  .excalidraw .Island label,
  .excalidraw .Island button,
  .excalidraw .Island span { font-family: inherit !important; font-size: 13px !important; }
  /* Hide Excalidraw's hamburger — we have GnosNavButton */
  .excalidraw .App-menu__left { display: none !important; }
  .excalidraw .App-canvas-container { background: var(--readerBg, var(--bg)) !important; }
  .excalidraw.theme--dark .canvas-container { background: var(--bg) !important; }
  /* Fill container */
  .excalidraw { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; }
  .excalidraw > div, .excalidraw .App-container, .excalidraw .excalidraw-container {
    width: 100% !important; height: 100% !important;
  }
  .excalidraw ::-webkit-scrollbar { width: 6px; height: 6px; }
  .excalidraw ::-webkit-scrollbar-track { background: transparent; }
  .excalidraw ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
`

function injectExcalidrawThemeStyles() {
  const id = 'gnos-excalidraw-theme'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = EXCALIDRAW_THEME_STYLES
  document.head.appendChild(style)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lazy-load Excalidraw — handles all known export shapes
// ─────────────────────────────────────────────────────────────────────────────
let _excalidrawPromise = null
function loadExcalidraw() {
  if (_excalidrawPromise) return _excalidrawPromise
  _excalidrawPromise = import('@excalidraw/excalidraw').then(mod => {
    // v0.17+: named export
    if (mod.Excalidraw) return mod.Excalidraw
    // Older: default export is the component
    if (typeof mod.default === 'function') return mod.default
    // Wrapped: default.Excalidraw
    if (mod.default?.Excalidraw) return mod.default.Excalidraw
    throw new Error('Cannot locate Excalidraw export in @excalidraw/excalidraw')
  })
  return _excalidrawPromise
}

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookView
// ─────────────────────────────────────────────────────────────────────────────
export default function SketchbookView() {
  const sketchbook       = useAppStore(s => s.activeSketchbook)
  const setView          = useAppStore(s => s.setView)
  const updateSketchbook = useAppStore(s => s.updateSketchbook)
  const themeKey         = useAppStore(s => s.themeKey ?? 'dark')

  const [ExcalidrawCmp, setExcalidrawCmp] = useState(null)
  // sketchState batches loaded+initialData into one setState to avoid cascading renders
  const [sketchState, setSketchState] = useState({ loaded: false, initialData: null })
  const [loadError,   setLoadError]   = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [saveVisible, setSaveVisible] = useState(false)

  // Excalidraw imperative API — set ONLY via excalidrawAPI callback prop
  const excalidrawApiRef = useRef(null)
  const saveTimerRef     = useRef(null)
  const saveVisTimer     = useRef(null)

  // ── Lazy-load Excalidraw bundle ─────────────────────────────────────────────
  useEffect(() => {
    injectExcalidrawThemeStyles()
    loadExcalidraw()
      .then(Cmp => setExcalidrawCmp(() => Cmp))
      .catch(err => {
        console.error('[SketchbookView] Failed to load Excalidraw:', err)
        setLoadError(err.message)
      })
  }, [])

  // ── Load sketchbook data ────────────────────────────────────────────────────
  // loadedForId tracks which sketchbook id the current sketchState belongs to.
  // When id changes, we treat state as "not loaded" without any synchronous setState.
  const [loadedForId, setLoadedForId] = useState(null)

  useEffect(() => {
    if (!sketchbook?.id) return
    let cancelled = false
    excalidrawApiRef.current = null

    loadSketchbookContent(sketchbook.id).then(data => {
      if (cancelled) return
      const nextData = data?.excalidraw ?? { elements: [], appState: {}, files: {} }
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

  // Derived: only treat state as loaded if it belongs to the current sketchbook
  const isLoaded = sketchState.loaded && loadedForId === sketchbook?.id

  // ── Save ─────────────────────────────────────────────────────────────────────
  const doSave = useCallback(async (elements, appState, files) => {
    if (!sketchbook) return
    setSaving(true)
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
      files: files ?? {},
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
    saveTimerRef.current = setTimeout(() => doSave(elements, appState, files), 1200)
  }, [doSave])

  // ── Exit ──────────────────────────────────────────────────────────────────────
  function exit() {
    clearTimeout(saveTimerRef.current)
    const api = excalidrawApiRef.current
    if (api) {
      try {
        doSave(api.getSceneElements(), api.getAppState(), api.getFiles())
      } catch (e) {
        console.warn('[SketchbookView] flush-save on exit failed:', e)
      }
    }
    setView('library')
  }

  const excalidrawTheme = themeKey?.toLowerCase().includes('light') ? 'light' : 'dark'

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!sketchbook) return (
    <div style={{ display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:14, margin:0 }}>No sketchbook selected.</p>
      <button onClick={() => setView('library')}
        style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
        Back to Library
      </button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'var(--bg)' }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header style={{
        display:'flex', alignItems:'center', gap:10, padding:'0 12px', height:48,
        background:'var(--headerBg, var(--surface))',
        borderBottom:'1px solid var(--border)',
        flexShrink:0, zIndex:20,
      }}>
        <GnosNavButton />
        <div style={{ width:1, height:18, background:'var(--border)', flexShrink:0 }} />

        <div style={{ flex:1, fontSize:13, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {sketchbook.title}
        </div>

        <div style={{ fontSize:11, color:'var(--textDim)', opacity: saving || saveVisible ? 0.75 : 0, transition:'opacity 0.3s ease', whiteSpace:'nowrap' }}>
          {saving ? 'Saving…' : 'Saved'}
        </div>

        {sketchbook.elementCount > 0 && (
          <div style={{ fontSize:10, color:'var(--textDim)', background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:4, padding:'2px 6px', fontVariantNumeric:'tabular-nums' }}>
            {sketchbook.elementCount} {sketchbook.elementCount === 1 ? 'shape' : 'shapes'}
          </div>
        )}

        <button
          onClick={exit}
          style={{ background:'none', border:'1px solid var(--border)', color:'var(--textDim)', borderRadius:6, padding:'5px 14px', cursor:'pointer', fontSize:12, fontFamily:'inherit', transition:'background 0.1s, color 0.1s' }}
          onMouseEnter={e => { e.currentTarget.style.background='var(--surfaceAlt)'; e.currentTarget.style.color='var(--text)' }}
          onMouseLeave={e => { e.currentTarget.style.background='none'; e.currentTarget.style.color='var(--textDim)' }}
        >
          Done
        </button>
      </header>

      {/* ── Canvas ───────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', overflow:'hidden', minHeight:0 }}>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }
          .excalidraw-wrapper, .excalidraw-wrapper > .excalidraw,
          .excalidraw-wrapper > .excalidraw > div,
          .excalidraw-wrapper > .excalidraw .App-container,
          .excalidraw-wrapper > .excalidraw .excalidraw-container {
            position: absolute !important; inset: 0 !important;
            width: 100% !important; height: 100% !important;
          }`}
        </style>

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
            <p style={{ margin:0, fontSize:11, opacity:0.6 }}>Make sure <code>@excalidraw/excalidraw</code> is installed: <code>npm install @excalidraw/excalidraw</code></p>
            <button onClick={() => setView('library')} style={{ marginTop:8, background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'7px 16px', cursor:'pointer', fontSize:12 }}>Back to Library</button>
          </div>
        )}

        {/* Excalidraw — key forces full remount when sketchbook changes */}
        {isLoaded && ExcalidrawCmp && !loadError && (
          <div className="excalidraw-wrapper" style={{ position:'absolute', inset:0 }}>
            <ExcalidrawCmp
              key={sketchbook.id}
              initialData={sketchState.initialData}
              theme={excalidrawTheme}
              // ⚠️ Do NOT use ref= on Excalidraw — use excalidrawAPI callback only
              excalidrawAPI={api => { excalidrawApiRef.current = api }}
              onChange={(elements, appState, files) => scheduleSave(elements, appState, files)}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: true,
                  clearCanvas: true,
                  export: { saveFileToDisk: true },
                  loadScene: true,
                  saveToActiveFile: false,
                  theme: false,
                  saveAsImage: true,
                },
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