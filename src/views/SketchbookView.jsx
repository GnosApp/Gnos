/**
 * SketchbookView.jsx — Excalidraw-powered sketchpad + PDF canvas import
 *
 * New in this version:
 * ────────────────────
 * • PDF import button in the header — opens a file picker for .pdf files.
 *   Each PDF page is rasterized via a hidden <canvas> (using the bundled
 *   pdf.js, see lib/pdfjs.js) and added to the Excalidraw canvas as an image
 *   element. Pages are placed in a vertical column so they don't overlap.
 * • pdf.js is imported lazily by that shared loader, so it stays out of the
 *   main bundle.
 * • A subtle import progress toast shows while pages are being rasterized.
 * • All other Excalidraw / storage / save behaviour is unchanged.
 */

import { useEffect, useRef, useState, useCallback, useContext } from 'react'
import useAppStore from '@/store/useAppStore'
import { PaneContext, PaneChromeContext } from '@/lib/PaneContext'
import { useIsActiveTab } from '@/lib/useIsActiveTab'
import { openPdf } from '@/lib/pdfjs'
import { loadSketchbookContent, saveSketchbookContent } from '@/lib/storage'
import QuickAccess, { useTitlebarMeta } from '@/components/QuickAccess'
import { useIsMobile } from '@/lib/useIsMobile'
import { paintSurfaceBackground, hexLuminance } from '@/lib/canvasSurface'
import { AlignJustify, FilePlus2, Grid2x2, Grip, LoaderCircle, Lock, LockOpen, Share, Square } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Per-theme Excalidraw configuration
// ─────────────────────────────────────────────────────────────────────────────
const THEME_CONFIG = {
  sepia:  { mode: 'light', canvasBg: '#faf8f5', strokeColor: '#3b2f20' },
  light:  { mode: 'light', canvasBg: '#f6f8fa', strokeColor: '#1f2328' },
  moss:   { mode: 'light', canvasBg: '#eef3e8', strokeColor: '#1e2c14' },
  dark:   { mode: 'dark',  canvasBg: '#1c2128', strokeColor: '#e6edf3' },  // slate blue — distinct from app bg
  cherry: { mode: 'dark',  canvasBg: '#1e0d12', strokeColor: '#f2dde1' },  // deep cherry
  sunset: { mode: 'dark',  canvasBg: '#1e1408', strokeColor: '#f5e6c8' },  // deep warm amber
}

function getThemeConfig(themeKey) {
  if (THEME_CONFIG[themeKey]) return THEME_CONFIG[themeKey]
  // Unknown (custom) theme — derive from live theme vars. Canvas uses --surface
  // (not --bg) so the sketch surface keeps the app's content-card contrast
  // against the chrome; stroke follows --text so shapes stay readable.
  try {
    const css = getComputedStyle(document.documentElement)
    const surface = css.getPropertyValue('--surface').trim()
    const text    = css.getPropertyValue('--text').trim()
    const lum = hexLuminance(surface)
    if (lum != null) {
      const light = lum > 128
      return {
        mode: light ? 'light' : 'dark',
        canvasBg: surface,
        strokeColor: /^#[0-9a-f]{6}$/i.test(text) ? text : (light ? '#1f2328' : '#e6edf3'),
      }
    }
  } catch { /* fall through */ }
  return THEME_CONFIG.dark
}

// ─────────────────────────────────────────────────────────────────────────────
// Gnos-to-Excalidraw CSS bridge — updated dynamically on every theme change
// ─────────────────────────────────────────────────────────────────────────────
function buildExcalidrawStyles(isDark = false) {
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

    /* ── Icon/button internals (names verified against @excalidraw 0.18.0 dist
       CSS). theme="light" defaults leave these near-black — glyphs were
       invisible on dark Gnos surfaces. ── */
    --icon-fill-color:                 var(--text);
    --color-on-surface:                var(--text);
    --color-on-primary-container:      var(--accent);
    --color-surface-primary-container: color-mix(in srgb, var(--accent, #388bfd) 16%, var(--surface));
    --dropdown-icon:                   var(--textDim);
    --button-hover-bg:                 var(--hover, var(--border));
    --button-hover-border:             var(--border);
    --button-hover-color:              var(--text);
    --button-active-bg:                color-mix(in srgb, var(--accent, #388bfd) 18%, transparent);
    --button-active-border:            var(--accent, #388bfd);
    --button-selected-bg:              color-mix(in srgb, var(--accent, #388bfd) 18%, transparent);
    --button-selected-border:          var(--accent, #388bfd);
    --button-selected-hover-bg:        color-mix(in srgb, var(--accent, #388bfd) 26%, transparent);
  }
  /* Glyph fallback: most 0.18 icons stroke/fill with currentColor — make sure
     buttons that miss the vars above still inherit a visible color. */
  .excalidraw-wrapper .excalidraw button svg { color: var(--text); }

  /* ── Structural rules ── */
  .excalidraw { font-family: var(--font-ui, system-ui, -apple-system, sans-serif) !important; }
  .excalidraw .App-toolbar { border-radius: 12px !important; }
  .excalidraw .App-toolbar--top { max-width: 100vw !important; overflow-x: auto !important; }
  .excalidraw .ToolIcon__icon { border-radius: 8px !important; transition: background 0.1s !important; }
  .excalidraw ::-webkit-scrollbar { width: 6px; height: 6px; }
  .excalidraw ::-webkit-scrollbar-track { background: transparent; }
  .excalidraw ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* ── Force all UI chrome to Gnos theme vars (needed because we pass theme="light"
     to prevent Excalidraw's image inversion, so we must override light-mode defaults) ── */

  /* Islands (toolbars, panels) */
  .excalidraw-wrapper .excalidraw .Island {
    background: var(--surface) !important;
    border-color: var(--border) !important;
    box-shadow: 0 2px 16px rgba(0,0,0,0.35) !important;
    color: var(--text) !important;
  }

  /* All text inside the UI */
  .excalidraw-wrapper .excalidraw .layer-ui__wrapper,
  .excalidraw-wrapper .excalidraw .layer-ui__wrapper * {
    color: var(--text);
  }

  /* Tool icons */
  .excalidraw-wrapper .excalidraw .ToolIcon__icon,
  .excalidraw-wrapper .excalidraw button.ToolIcon,
  .excalidraw-wrapper .excalidraw .ToolIcon {
    color: var(--text) !important;
    background: transparent !important;
  }
  .excalidraw-wrapper .excalidraw .ToolIcon__icon:hover,
  .excalidraw-wrapper .excalidraw button.ToolIcon:hover {
    background: var(--hover) !important;
  }
  .excalidraw-wrapper .excalidraw .ToolIcon--selected .ToolIcon__icon,
  .excalidraw-wrapper .excalidraw .ToolIcon.active .ToolIcon__icon {
    background: color-mix(in srgb, var(--accent) 18%, transparent) !important;
    color: var(--accent) !important;
  }
  .excalidraw-wrapper .excalidraw .ToolIcon__label,
  .excalidraw-wrapper .excalidraw .ToolIcon__keybinding {
    color: var(--textDim) !important;
  }

  /* Popups, popovers, context menus, dropdowns */
  .excalidraw-wrapper .excalidraw .popover,
  .excalidraw-wrapper .excalidraw .Popover,
  .excalidraw-wrapper .excalidraw [role="dialog"],
  .excalidraw-wrapper .excalidraw .context-menu,
  .excalidraw-wrapper .excalidraw .dropdown-menu,
  .excalidraw-wrapper .excalidraw .dropdown-menu-container,
  .excalidraw-wrapper .excalidraw .stats,
  .excalidraw-wrapper .excalidraw .Dialog,
  .excalidraw-wrapper .excalidraw .Dialog__content {
    background: var(--surface) !important;
    border: 1px solid var(--border) !important;
    color: var(--text) !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.45) !important;
  }
  /* Menu / list items */
  .excalidraw-wrapper .excalidraw .context-menu-option,
  .excalidraw-wrapper .excalidraw .dropdown-menu-item,
  .excalidraw-wrapper .excalidraw .menu-item,
  .excalidraw-wrapper .excalidraw li[role="menuitem"],
  .excalidraw-wrapper .excalidraw button[role="menuitem"] {
    background: transparent !important;
    color: var(--text) !important;
  }
  .excalidraw-wrapper .excalidraw .context-menu-option:hover,
  .excalidraw-wrapper .excalidraw .dropdown-menu-item:hover,
  .excalidraw-wrapper .excalidraw .menu-item:hover,
  .excalidraw-wrapper .excalidraw li[role="menuitem"]:hover,
  .excalidraw-wrapper .excalidraw button[role="menuitem"]:hover {
    background: var(--surfaceAlt) !important;
  }
  /* Separator lines in menus */
  .excalidraw-wrapper .excalidraw .context-menu-option--separator,
  .excalidraw-wrapper .excalidraw hr {
    border-color: var(--border) !important;
  }

  /* Property panel section labels */
  .excalidraw-wrapper .excalidraw .panelColumn label,
  .excalidraw-wrapper .excalidraw .panelColumn span,
  .excalidraw-wrapper .excalidraw .sidebar-trigger,
  .excalidraw-wrapper .excalidraw h3,
  .excalidraw-wrapper .excalidraw .section-heading {
    color: var(--textDim) !important;
  }

  /* Buttons inside panels */
  .excalidraw-wrapper .excalidraw button:not(.ToolIcon):not([class*="color"]) {
    background: var(--surfaceAlt) !important;
    border-color: var(--border) !important;
    color: var(--text) !important;
  }
  .excalidraw-wrapper .excalidraw button:not(.ToolIcon):not([class*="color"]):hover {
    background: var(--border) !important;
  }

  /* Inputs / selects */
  .excalidraw-wrapper .excalidraw input,
  .excalidraw-wrapper .excalidraw select,
  .excalidraw-wrapper .excalidraw textarea {
    background: var(--surfaceAlt) !important;
    border-color: var(--border) !important;
    color: var(--text) !important;
  }
  .excalidraw-wrapper .excalidraw input:focus,
  .excalidraw-wrapper .excalidraw select:focus {
    border-color: var(--accent) !important;
    outline: none !important;
  }

  /* Zoom / footer */
  .excalidraw-wrapper .excalidraw .zoom-value,
  .excalidraw-wrapper .excalidraw .App-menu__left,
  .excalidraw-wrapper .excalidraw .App-menu__right,
  .excalidraw-wrapper .excalidraw .footer-center button {
    color: var(--text) !important;
  }

  /* Highlight / selection — tone down to avoid blinding bright blue on dark bg */
  .excalidraw-wrapper .excalidraw ::selection {
    background: color-mix(in srgb, var(--accent) 30%, transparent) !important;
  }
  .excalidraw-wrapper .excalidraw [aria-selected="true"],
  .excalidraw-wrapper .excalidraw .selected {
    background: color-mix(in srgb, var(--accent) 16%, transparent) !important;
    border-color: var(--accent) !important;
  }

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

  /* ── Color swatches — remove boxy button borders, keep only a ring on selected ── */
  .excalidraw-wrapper .excalidraw .color-picker-swatch,
  .excalidraw-wrapper .excalidraw [class*="ColorPicker"] button,
  .excalidraw-wrapper .excalidraw [class*="color-swatch"],
  .excalidraw-wrapper .excalidraw .colorList button,
  .excalidraw-wrapper .excalidraw .buttonList button[aria-label] {
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    border-radius: 6px !important;
  }
  .excalidraw-wrapper .excalidraw .color-picker-swatch--selected,
  .excalidraw-wrapper .excalidraw [class*="ColorPicker"] button[aria-selected="true"],
  .excalidraw-wrapper .excalidraw [class*="color-swatch"][aria-selected="true"],
  .excalidraw-wrapper .excalidraw .colorList button[aria-checked="true"] {
    outline: 2px solid var(--accent) !important;
    outline-offset: 2px !important;
    box-shadow: none !important;
  }

  /* ── Remaining chrome holes: hints, tooltips, modals, sidebar/library ── */
  .excalidraw-wrapper .excalidraw .HintViewer,
  .excalidraw-wrapper .excalidraw .HintViewer span {
    color: var(--textDim) !important;
  }
  .excalidraw-wrapper .excalidraw .Tooltip,
  .excalidraw-wrapper .excalidraw .Tooltip__label {
    background: var(--surfaceAlt) !important;
    color: var(--text) !important;
    border: 1px solid var(--border) !important;
  }
  .excalidraw-wrapper .excalidraw .Modal__content,
  .excalidraw-wrapper .excalidraw .ExportDialog,
  .excalidraw-wrapper .excalidraw .HelpDialog,
  .excalidraw-wrapper .excalidraw .sidebar,
  .excalidraw-wrapper .excalidraw .layer-ui__sidebar,
  .excalidraw-wrapper .excalidraw .library-menu-items-container {
    background: var(--surface) !important;
    color: var(--text) !important;
    border-color: var(--border) !important;
  }
  .excalidraw-wrapper .excalidraw .Modal__background {
    background: rgba(0,0,0,0.55) !important;
  }
  /* Color-picker popover interior (hex input row, custom picker) */
  .excalidraw-wrapper .excalidraw .color-picker-container,
  .excalidraw-wrapper .excalidraw .color-picker-content,
  .excalidraw-wrapper .excalidraw .color-picker {
    background: var(--surface) !important;
    border-color: var(--border) !important;
    color: var(--text) !important;
  }
  /* Range sliders follow the accent in all themes */
  .excalidraw-wrapper .excalidraw input[type="range"] {
    accent-color: var(--accent) !important;
  }

  ${isDark ? `
  /* ── Dark-mode specific: ensure panel/popup backgrounds are surface, not black ── */
  .excalidraw-wrapper .excalidraw .Island,
  .excalidraw-wrapper .excalidraw [role="dialog"],
  .excalidraw-wrapper .excalidraw .popover,
  .excalidraw-wrapper .excalidraw .Popover,
  .excalidraw-wrapper .excalidraw .context-menu,
  .excalidraw-wrapper .excalidraw .dropdown-menu,
  .excalidraw-wrapper .excalidraw .stats,
  .excalidraw-wrapper .excalidraw .Dialog,
  .excalidraw-wrapper .excalidraw .Dialog__content {
    background-color: var(--surface) !important;
  }
  /* Panel body rows and sections */
  .excalidraw-wrapper .excalidraw .panelColumn,
  .excalidraw-wrapper .excalidraw .panelRow,
  .excalidraw-wrapper .excalidraw .section {
    background: transparent !important;
    color: var(--text) !important;
  }
  /* Active/selected state for property buttons (stroke width, style etc.) — muted */
  .excalidraw-wrapper .excalidraw .buttonList button.active,
  .excalidraw-wrapper .excalidraw .buttonList button[aria-checked="true"],
  .excalidraw-wrapper .excalidraw .ToolIcon--selected .ToolIcon__icon {
    background: color-mix(in srgb, var(--accent) 20%, transparent) !important;
    color: var(--accent) !important;
  }
  /* Slider track */
  .excalidraw-wrapper .excalidraw input[type="range"] {
    accent-color: var(--accent) !important;
  }
  ` : ''}
`
}
function syncExcalidrawThemeStyles(isDark = false) {
  const id = 'gnos-excalidraw-theme'
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = buildExcalidrawStyles(isDark)
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
// PDF → Excalidraw image elements
// Scale 1 pdf unit ≈ 1.5 px for decent resolution on canvas
// ─────────────────────────────────────────────────────────────────────────────
async function pdfToExcalidrawImages(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await openPdf({ data: arrayBuffer })
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
    await page.render({ canvas, canvasContext: ctx, viewport: scaledViewport }).promise
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
// Thumbnail generation — exports canvas, downscales to a compact JPEG
// ─────────────────────────────────────────────────────────────────────────────
// Returns { dataUrl, bgColor } so the card can match the canvas background exactly.
async function generateSketchbookThumbnail(api, files) {
  const elements = (api.getSceneElements() || []).filter(e => !e.isDeleted)
  if (!elements.length) return null
  try {
    const appState = api.getAppState()
    const currentThemeKey = useAppStore.getState().themeKey ?? 'dark'
    const bgColor = THEME_CONFIG[currentThemeKey]?.canvasBg || appState.viewBackgroundColor || '#ffffff'
    const { utils } = await loadExcalidraw()
    const blob = await utils.exportToBlob({
      elements,
      appState: { exportBackground: true, viewBackgroundColor: bgColor, exportWithDarkMode: false },
      files: files || {},
      mimeType: 'image/png',
    })
    const url = URL.createObjectURL(blob)
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    URL.revokeObjectURL(url)
    const MAX_W = 280, MAX_H = 400
    const ratio = Math.min(MAX_W / img.naturalWidth, MAX_H / img.naturalHeight, 1)
    const w = Math.max(1, Math.round(img.naturalWidth * ratio))
    const h = Math.max(1, Math.round(img.naturalHeight * ratio))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.72), bgColor }
  } catch (err) {
    console.warn('[SketchbookView] thumbnail failed:', err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SketchbookView
// ─────────────────────────────────────────────────────────────────────────────
export default function SketchbookView() {
  const paneTabId           = useContext(PaneContext)
  const paneChrome          = useContext(PaneChromeContext)
  const isActive            = useIsActiveTab()
  const sketchbook          = useAppStore(useCallback(
    s => {
      const tab = paneTabId ? s.tabs.find(t => t.id === paneTabId) : null
      return tab?.activeSketchbook ?? null
    },
    [paneTabId]
  ))
  const setView             = useAppStore(s => s.setView)
  const updateSketchbook    = useAppStore(s => s.updateSketchbook)
  const setActiveSketchbook = useAppStore(s => s.setActiveSketchbook)
  const themeKey            = useAppStore(s => s.themeKey ?? 'dark')

  const [ExcalidrawCmp, setExcalidrawCmp] = useState(null)
  const [sketchState, setSketchState] = useState({ loaded: false, initialData: null })
  const [loadError,   setLoadError]   = useState(null)
  const [saving,      setSaving]      = useState(false)
  // Shape count lives in the title-bar search bar
  useTitlebarMeta(sketchbook?.elementCount > 0
    ? { text: `${sketchbook.elementCount} ${sketchbook.elementCount === 1 ? 'shape' : 'shapes'}` }
    : null)
  const [saveVisible, setSaveVisible] = useState(false)
  // PDF import state
  const [pdfImporting, setPdfImporting] = useState(false)
  const [pdfProgress,  setPdfProgress]  = useState('')
  const [bgLocked,     setBgLocked]     = useState(false)
  const [sbSettingsOpen, setSbSettingsOpen] = useState(false)
  const [sketchBgStyle, setSketchBgStyle] = useState(() => {
    // If the sketchbook was saved with grid enabled, restore grid mode
    const savedGridSize = sketchbook?.lastGridSize ?? 0
    return savedGridSize > 0 ? 'grid' : 'dots'
  }) // 'dots' | 'lines' | 'grid' | 'none'
  const settingsBtnRef = useRef(null)
  const pdfInputRef = useRef(null)

  const isMobile = useIsMobile()

  const dotGridRef        = useRef(null)  // direct-DOM dot grid — no re-render on scroll
  const excalidrawApiRef  = useRef(null)
  const prevGridActiveRef = useRef(false)  // track Excalidraw grid toggle without re-renders
  const saveTimerRef      = useRef(null)
  const saveVisTimer      = useRef(null)
  const savedFilesRef     = useRef({})   // accumulates all files ever seen — never loses images
  const lastSavedSigRef   = useRef(null) // dirty-flag: skip saves when only viewport changed
  const latestSaveArgsRef = useRef(null) // latest onChange args — flushed synchronously on unmount
  const thumbnailTimerRef = useRef(null) // debounces thumbnail regeneration after saves
  const ocrTimerRef       = useRef(null) // debounces auto-OCR indexing after saves
  // Always holds the last non-null sketchbook so the unmount cleanup can save
  // even after `sketchbook` has become null in the selector (tab closed).
  const stableSketchbookRef = useRef(sketchbook)

  // Keep stableSketchbookRef pointing at the last non-null sketchbook.
  // Never nulled — the unmount cleanup needs the previous value after the tab closes.
  useEffect(() => { if (sketchbook) stableSketchbookRef.current = sketchbook }, [sketchbook])

  const themeConfig = getThemeConfig(themeKey)
  // Always 'light' — we theme Excalidraw via CSS variables ourselves.
  // Passing 'dark' causes Excalidraw to invert images via filter which we don't want.
  const excalidrawTheme = 'light'

  // Sync CSS bridge on mount and whenever Gnos theme changes
  useEffect(() => {
    syncExcalidrawThemeStyles(themeConfig.mode === 'dark')
  }, [themeKey, themeConfig.mode])

  // Shared fn: paint dot grid div from appState + current style/theme.
  // Called from onChange (every frame) and imperatively on style/theme switch.
  const paintDotGrid = useCallback((appState) => {
    const el = dotGridRef.current
    if (!el || !appState) return
    // Shared painter (canvasSurface.js) — same dot/line/grid language as the
    // Nebuli graph, with offsets snapped to device pixels to avoid shimmer.
    paintSurfaceBackground(el, sketchBgStyle, {
      zoom:    appState.zoom?.value ?? 1,
      scrollX: appState.scrollX ?? 0,
      scrollY: appState.scrollY ?? 0,
      gridSize: appState.gridSize ?? undefined,
    }, themeConfig.mode === 'dark')
  }, [sketchBgStyle, themeConfig.mode])

  // Keep the grid synced when the viewport changes WITHOUT an onChange event:
  // programmatic scroll/zoom (onScrollChange) and container resizes (no
  // Excalidraw event at all) — both previously left the grid offset stale.
  useEffect(() => {
    const repaint = () => paintDotGrid(excalidrawApiRef.current?.getAppState?.())
    const unsub = excalidrawApiRef.current?.onScrollChange?.(repaint)
    let ro
    const host = dotGridRef.current?.parentElement
    if (host) {
      ro = new ResizeObserver(repaint)
      ro.observe(host)
    }
    return () => { unsub?.(); ro?.disconnect() }
  }, [paintDotGrid, sketchState.loaded, sketchbook?.id])

  // Repaint immediately when style or theme changes using last known appState
  useEffect(() => {
    const api = excalidrawApiRef.current
    paintDotGrid(api?.getAppState?.() ?? { zoom: { value: 1 }, scrollX: 0, scrollY: 0 })
  }, [sketchBgStyle, themeConfig.mode, paintDotGrid])

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

  // Reset state when sketchbook changes so stale data isn't shown
  useEffect(() => {
    if (!sketchbook?.id) return
    if (loadedForId !== sketchbook.id) {
      setSketchState({ loaded: false, initialData: null })
    }
  }, [sketchbook?.id, loadedForId])

  useEffect(() => {
    if (!sketchbook?.id) return
    let cancelled = false
    // Do NOT null excalidrawApiRef here — the switch-save effect (below) needs the old
    // API reference to flush a save before the new sketchbook loads. The ref will be
    // overwritten naturally when the new Excalidraw instance calls its onMount callback.
    lastSavedSigRef.current = null  // reset dirty-flag for fresh load

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
        gnos_canvasBg:          themeConfig.canvasBg,
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
    const patch = { updatedAt: new Date().toISOString(), elementCount: elements?.length ?? 0, lastGridSize: appState?.gridSize ?? 0, gnos_canvasBg: themeConfig.canvasBg }
    updateSketchbook(sketchbook.id, patch)
    // Get the latest sketchbook object (with updated fields) and pass it directly so
    // saveSketchbookContent can use getSketchDir without a folder scan
    const latestSb = useAppStore.getState().sketchbooks.find(s => s.id === sketchbook.id) ?? { ...sketchbook, ...patch }
    const saved = await saveSketchbookContent(latestSb, { excalidraw: saveState })
    if (!saved) console.error('[SketchbookView] saveSketchbookContent returned false for sketchbook', sketchbook.id)
    await useAppStore.getState().persistSketchbooks?.()
    // Update dirty-flag so subsequent viewport-only onChange calls are skipped
    lastSavedSigRef.current = elements?.length
      ? elements.map(e => `${e.id}:${e.versionNonce ?? e.version ?? 0}`).join(',')
      : '[]'
    setSaving(false)
    const el = document.getElementById(paneChrome?.saveIconId || 'nb-save-icon')
    if (el) {
      el.classList.remove('anim', 'vis', 'closing'); void el.offsetWidth
      el.classList.add('anim', 'vis')
      clearTimeout(saveVisTimer.current)
      saveVisTimer.current = setTimeout(() => {
        el.classList.remove('anim')
        el.classList.add('closing')
        saveVisTimer.current = setTimeout(() => el.classList.remove('vis', 'closing'), 450)
      }, 600)
    }

    // Regenerate cover thumbnail 2s after the last save, non-blocking
    clearTimeout(thumbnailTimerRef.current)
    const sbId = latestSb.id
    thumbnailTimerRef.current = setTimeout(async () => {
      const api = excalidrawApiRef.current
      if (!api) return
      const thumb = await generateSketchbookThumbnail(api, savedFilesRef.current)
      if (!thumb) return
      useAppStore.getState().updateSketchbook?.(sbId, { coverDataUrl: thumb.dataUrl, coverBgColor: thumb.bgColor })
      useAppStore.getState().persistSketchbooks?.()
    }, 2000)

    // Auto-index text 45s after the last save (debounced), non-blocking background OCR
    clearTimeout(ocrTimerRef.current)
    if (elements?.length) {
      ocrTimerRef.current = setTimeout(async () => {
        const api = excalidrawApiRef.current
        if (!api) return
        const els = api.getSceneElements()
        if (!els?.length) return
        try {
          const { utils } = await loadExcalidraw()
          const blob = await utils.exportToBlob({
            elements: els,
            appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: themeConfig.canvasBg },
            files: savedFilesRef.current,
            mimeType: 'image/png',
            quality: 1,
          })
          const { createWorker } = await import('tesseract.js')
          const worker = await createWorker('eng')
          const { data: { text } } = await worker.recognize(blob)
          await worker.terminate()
          const ocrText = text.trim()
          useAppStore.getState().updateSketchbook?.(sbId, { ocrText, ocrIndexedAt: new Date().toISOString() })
          await useAppStore.getState().persistSketchbooks?.()
        } catch { /* silent — OCR failure should never surface to the user */ }
      }, 45000)
    }
  }, [sketchbook, updateSketchbook, themeConfig.canvasBg])

  const scheduleSave = useCallback((elements, appState, files) => {
    // Build a cheap signature of element IDs + version nonces.
    // If only viewport (scroll/zoom) changed, elements are identical — skip the save.
    const sig = elements?.length
      ? elements.map(e => `${e.id}:${e.versionNonce ?? e.version ?? 0}`).join(',')
      : '[]'
    if (sig === lastSavedSigRef.current) return

    clearTimeout(saveTimerRef.current)
    // Deep-copy files immediately — Excalidraw can mutate the reference after onChange
    const filesCopy = files ? JSON.parse(JSON.stringify(files)) : null
    // Also merge into savedFilesRef right away (don't wait for the debounce)
    if (filesCopy) Object.assign(savedFilesRef.current, filesCopy)
    // Track latest args so unmount flush can use them
    latestSaveArgsRef.current = { elements, appState, files: filesCopy }
    saveTimerRef.current = setTimeout(() => doSave(elements, appState, filesCopy), 300)
  }, [doSave])

  // Flush any pending save when this component unmounts.
  //
  // IMPORTANT: do NOT call api.getSceneElements() here. When a tab is closed,
  // `sketchbook` becomes null → `isLoaded` becomes false → Excalidraw unmounts
  // internally BEFORE this cleanup runs. At that point getSceneElements() returns []
  // and would overwrite the real save with an empty canvas (the 324-byte bug).
  //
  // Instead, use latestSaveArgsRef which was updated by every real onChange call
  // and always holds the actual elements the user drew. Call saveSketchbookContent
  // directly through stableSketchbookRef so we bypass doSave's `if (!sketchbook)`
  // guard (sketchbook is null in the closure by unmount time).
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current)
      clearTimeout(ocrTimerRef.current)
      const args = latestSaveArgsRef.current
      if (!args) return
      const sig = args.elements?.length
        ? args.elements.map(e => `${e.id}:${e.versionNonce ?? e.version ?? 0}`).join(',')
        : '[]'
      if (sig === lastSavedSigRef.current) return // already saved — nothing to do
      const sb = stableSketchbookRef.current
      if (!sb) return
      // Prefer the live store value so a rename that happened before close is reflected
      const liveSb = useAppStore.getState().sketchbooks.find(s => s.id === sb.id) ?? sb
      const allFiles = { ...savedFilesRef.current, ...(args.files || {}) }
      saveSketchbookContent(liveSb, {
        excalidraw: {
          elements: args.elements ?? [],
          appState: args.appState ?? {},
          files: allFiles,
        },
      }).catch(e => console.warn('[SketchbookView] flush-save on unmount failed:', e))
    }
  }, []) // empty deps — refs only

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


  // Mobile event bridge — NOT gated on isMobile: 'settings' is also how the
  // native "Page Settings…" menu (⌘⌥,) reaches this view on desktop
  // (App.jsx's page_settings handler dispatches this same event for every
  // view, not just mobile ones — see AudioPlayerView's identical unconditional
  // pattern). 'import'/'lock-toggle' only ever fire from the mobile bottom
  // nav in practice (desktop already has its own QuickAccess buttons for
  // both), so leaving the listener unconditional is harmless for them, and
  // was the actual bug: this whole effect used to early-return `if
  // (!isMobile) return`, which silently dropped 'settings' too — the desktop
  // canvas-background panel below was unreachable by any real trigger.
  useEffect(() => {
    const h = e => {
      const { cmd } = e.detail || {}
      if (cmd === 'import') openPdfPicker()
      if (cmd === 'lock-toggle') bgLocked ? unlockBackground() : lockBackground()
      if (cmd === 'settings') setSbSettingsOpen(o => !o)
    }
    window.addEventListener('gnos:mobile-sb-cmd', h)
    return () => window.removeEventListener('gnos:mobile-sb-cmd', h)
  }, [bgLocked, lockBackground, unlockBackground, openPdfPicker])

  // Keep a ref to the latest doSave so the unmount effect can call the current version
  const doSaveRef = useRef(doSave)
  useEffect(() => { doSaveRef.current = doSave }, [doSave])

  // Force-save when the app window closes
  useEffect(() => {
    const handler = () => {
      clearTimeout(saveTimerRef.current)
      const api = excalidrawApiRef.current
      if (!api) return
      const elements = api.getSceneElements() ?? []
      const appState = api.getAppState()
      const newFiles = api.getFiles() ?? {}
      if (newFiles) Object.assign(savedFilesRef.current, newFiles)
      const sig = elements.length
        ? elements.map(e => `${e.id}:${e.versionNonce ?? e.version ?? 0}`).join(',')
        : '[]'
      if (sig !== lastSavedSigRef.current) {
        doSaveRef.current(elements, appState, savedFilesRef.current)
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ── Flush save on sketchbook switch — saves to the PREVIOUS sketchbook ──────
  // We capture the full previous sketchbook object (not just id) inside this single
  // effect so it always uses the OLD value before updating the ref.
  const prevSketchbookRef = useRef(sketchbook)
  useEffect(() => {
    const prevSb = prevSketchbookRef.current
    prevSketchbookRef.current = sketchbook           // update for next run
    if (!prevSb || prevSb.id === sketchbook?.id) return
    clearTimeout(saveTimerRef.current)
    const api = excalidrawApiRef.current
    if (!api) return
    try {
      const elements  = api.getSceneElements()
      const appState  = api.getAppState()
      const newFiles  = api.getFiles()
      if (newFiles) Object.assign(savedFilesRef.current, newFiles)
      const allFiles  = { ...savedFilesRef.current }
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
      const patch = { updatedAt: new Date().toISOString(), elementCount: elements?.length ?? 0 }
      useAppStore.getState().updateSketchbook?.(prevSb.id, patch)
      saveSketchbookContent({ ...prevSb, ...patch }, { excalidraw: saveState })
        .then(() => useAppStore.getState().persistSketchbooks?.())
        .catch(e => console.warn('[SketchbookView] flush-save on switch failed:', e))
    } catch (e) { console.warn('[SketchbookView] flush-save on switch failed:', e) }
  }, [sketchbook]) // eslint-disable-line react-hooks/exhaustive-deps


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
    <div className="sb-root" style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'var(--bg)' }}>

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

      {/* Mobile floating title button (replaces header on mobile) */}
      {isMobile && (
        <div className="mobile-view-title-pill">
          <div className="mobile-view-title-btn">
            <span className="mobile-view-title-name">{sketchbook.title || 'Sketchbook'}</span>
            {sketchbook.elementCount > 0 && (
              <span className="mobile-view-title-meta">{sketchbook.elementCount} {sketchbook.elementCount === 1 ? 'shape' : 'shapes'}</span>
            )}
          </div>
        </div>
      )}

      {/* Mobile sketchbook settings panel */}
      {isMobile && sbSettingsOpen && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:9099 }} onClick={() => setSbSettingsOpen(false)} />
          <div className="mobile-sb-settings-panel">
            <div style={{ fontWeight:700, fontSize:13, color:'var(--text)', marginBottom:12 }}>Sketchbook Settings</div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:4 }}>Rename</div>
              <input
                autoFocus
                defaultValue={sketchbook.title}
                onBlur={e => {
                  const t = e.target.value.trim() || sketchbook.title
                  updateSketchbook(sketchbook.id, { title: t })
                  const fresh = useAppStore.getState().sketchbooks.find(s => s.id === sketchbook.id) ?? { ...sketchbook, title: t }
                  setActiveSketchbook(fresh)
                  if (paneTabId) useAppStore.getState().updateTab?.(paneTabId, { activeSketchbook: fresh })
                  useAppStore.getState().persistSketchbooks?.()
                  setSbSettingsOpen(false)
                }}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                style={{ width:'100%', background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:13, color:'var(--text)', fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Header replaced by title bar: shape count in the omnibar, actions
             in the quick-access strip, bg style is a cycle-through button ── */}
      <QuickAccess>

          {/* Background style — cycles dots → lines → grid → none */}
          {isLoaded && ExcalidrawCmp && (
            <button
              className="gnos-settings-btn"
              onClick={() => {
                const ORDER = ['dots', 'lines', 'grid', 'none']
                const next = ORDER[(ORDER.indexOf(sketchBgStyle) + 1) % ORDER.length]
                setSketchBgStyle(next)
                const api = excalidrawApiRef.current
                if (api?.updateScene) api.updateScene({ appState: { gridSize: next === 'grid' ? 20 : null } })
              }}
              title={`Canvas background: ${{ dots: 'Dot grid', lines: 'Lined paper', grid: 'Grid', none: 'None' }[sketchBgStyle] || 'Dot grid'} — click to change`}
            >
              {sketchBgStyle === 'lines'
                ? <AlignJustify size={15} strokeWidth={1.5} />
                : sketchBgStyle === 'grid'
                ? <Grid2x2 size={15} strokeWidth={1.5} />
                : sketchBgStyle === 'none'
                ? <Square size={15} strokeWidth={1.5} />
                : <Grip size={15} strokeWidth={1.8} />}
            </button>
          )}

          {/* Lock background images */}
          {isLoaded && ExcalidrawCmp && (
            <button
              className={`gnos-settings-btn${bgLocked ? ' active' : ''}`}
              onClick={bgLocked ? unlockBackground : lockBackground}
              title={bgLocked ? 'Unlock background images (make editable)' : 'Lock background images (protect from eraser)'}
            >
              {bgLocked
                ? <Lock size={14} strokeWidth={1.7} />
                : <LockOpen size={14} strokeWidth={1.7} />
              }
            </button>
          )}

          {/* PDF import */}
          <button
            className="gnos-settings-btn"
            onClick={openPdfPicker}
            disabled={pdfImporting || !isLoaded || !ExcalidrawCmp}
            title="Import PDF into canvas"
            style={{ opacity: (pdfImporting || !isLoaded) ? 0.5 : 1 }}
          >
            <FilePlus2 size={14} strokeWidth={1.6} />
          </button>

          {/* Share / Export PNG button */}
          {isLoaded && ExcalidrawCmp && (
            <button
              title="Share"
              onClick={async () => {
                const api = excalidrawApiRef.current
                if (!api) return
                const elements = (api.getSceneElements() || []).filter(e => !e.isDeleted)
                if (!elements.length) return
                try {
                  const { utils } = await loadExcalidraw()
                  const appState = api.getAppState()
                  const currentThemeKey = useAppStore.getState().themeKey ?? 'dark'
                  const bgColor = THEME_CONFIG[currentThemeKey]?.canvasBg || appState.viewBackgroundColor || '#ffffff'
                  const blob = await utils.exportToBlob({
                    elements,
                    appState: { exportBackground: true, viewBackgroundColor: bgColor },
                    files: savedFilesRef.current,
                    mimeType: 'image/png',
                  })
                  const filename = (sketchbook?.title || 'sketchbook') + '.png'
                  if (navigator.share) {
                    try {
                      const file = new File([blob], filename, { type: 'image/png' })
                      await navigator.share({ files: [file], title: sketchbook?.title || 'sketchbook' })
                      return
                    } catch (e) { if (e.name === 'AbortError') return }
                  }
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = filename; a.click()
                  setTimeout(() => URL.revokeObjectURL(url), 1000)
                } catch (err) { console.error('[Sketchbook] export PNG failed:', err) }
              }}
              className="gnos-settings-btn"
            >
              <Share size={14} strokeWidth={1.7} />
            </button>
          )}
      </QuickAccess>

          {/* Canvas settings panel — opened via View → Page Settings… (⌘⌥,) */}
          <div>
            {!isMobile && sbSettingsOpen && (
              <>
                <div style={{ position:'fixed', inset:0, zIndex:9099 }} onClick={() => setSbSettingsOpen(false)} />
                <div ref={settingsBtnRef} style={{
                  position:'fixed', top:44, right:12, zIndex:9100,
                  background:'var(--surface)', border:'1px solid var(--borderSubtle)',
                  borderRadius:8, padding:'12px 16px', minWidth:200,
                  boxShadow:'0 0 0 1px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.3)',
                }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--textDim)', letterSpacing:'0.05em', textTransform:'uppercase', marginBottom:10 }}>Canvas Background</div>
                  {[
                    { value:'dots',  label:'Dot Grid',
                      icon: <Grip size={18} strokeWidth={1.8} /> },
                    { value:'lines', label:'Lined Paper',
                      icon: <AlignJustify size={18} strokeWidth={1.2} /> },
                    { value:'grid',  label:'Grid',
                      icon: <Grid2x2 size={18} strokeWidth={1.2} /> },
                    { value:'none',  label:'None',
                      icon: <Square size={18} strokeWidth={1.2} /> },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSketchBgStyle(opt.value)
                        setSbSettingsOpen(false)
                        // Keep Excalidraw's gridSize in sync so snapping matches
                        const api = excalidrawApiRef.current
                        if (api?.updateScene) {
                          api.updateScene({ appState: { gridSize: opt.value === 'grid' ? 20 : null } })
                        }
                      }}
                      style={{
                        display:'flex', alignItems:'center', gap:10, width:'100%',
                        padding:'8px 12px', marginBottom:4, borderRadius:8, cursor:'pointer',
                        background: sketchBgStyle === opt.value ? 'var(--accentDim, color-mix(in srgb, var(--accent) 12%, transparent))' : 'transparent',
                        border: sketchBgStyle === opt.value ? '1px solid var(--accent)' : '1px solid transparent',
                        color: sketchBgStyle === opt.value ? 'var(--accent)' : 'var(--text)',
                        fontSize:13, textAlign:'left', fontFamily:'inherit',
                        transition:'background 0.1s, border-color 0.1s',
                      }}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

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
          <LoaderCircle size={14} strokeWidth={2} color="var(--accent)" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          {pdfProgress}
        </div>
      )}

      {/* ── Canvas ───────────────────────────────────────────────────────────── */}
      <div className="sb-canvas-wrap" style={{ flex:1, position:'relative', overflow:'hidden', minHeight:0, minWidth:0, padding:0, margin:0 }}>

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
            <LoaderCircle size={16} strokeWidth={2} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
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
          // Solid canvas background lives here as CSS — Excalidraw canvas is transparent
          // so the dot grid div behind it shows through without covering any UI chrome.
          <div className="excalidraw-wrapper" style={{ position:'absolute', inset:0, width:'100%', height:'100%', background: themeConfig.canvasBg }}>

            {/* Dot grid — z-index 0, behind the Excalidraw canvas layer.
                backgroundPosition/Size updated directly via ref on every onChange
                so dots track canvas pan/zoom without triggering React re-renders. */}
            <div
              ref={dotGridRef}
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                backgroundSize: '22px 22px',
                backgroundPosition: '0px 0px',
              }}
            />

            <ExcalidrawCmp
              key={sketchbook.id}
              initialData={{
                elements: sketchState.initialData?.elements ?? [],
                appState: {
                  ...sketchState.initialData?.appState,
                  // Canvas is transparent — background handled by wrapper CSS + dot grid div
                  viewBackgroundColor: 'transparent',
                  currentItemStrokeColor: sketchState.initialData?.appState?.currentItemStrokeColor
                    ?? themeConfig.strokeColor,
                },
                files: sketchState.initialData?.files ?? {},
              }}
              theme={excalidrawTheme}
              excalidrawAPI={api => { excalidrawApiRef.current = api }}
              onChange={(elements, appState, files) => {
                scheduleSave(elements, appState, files)
                // Sync dot grid to canvas viewport — direct DOM, zero re-renders
                paintDotGrid(appState)
                // Detect Excalidraw's built-in grid toggle and mirror it to our bg style
                const gridNowActive = (appState.gridSize ?? 0) > 0
                if (gridNowActive !== prevGridActiveRef.current) {
                  prevGridActiveRef.current = gridNowActive
                  setSketchBgStyle(prev => {
                    if (gridNowActive) return 'grid'
                    // Grid turned off — revert to dots unless user was on lines/none
                    return prev === 'grid' ? 'dots' : prev
                  })
                }
              }}
              onKeyDown={!isActive ? (e) => { e.stopPropagation(); return true } : undefined}
              UIOptions={{
                canvasActions: {
                  changeViewBackgroundColor: false, // bg managed by Gnos wrapper + dot grid
                  clearCanvas: true,
                  export: { saveFileToDisk: true },
                  loadScene: true,
                  saveToActiveFile: false,
                  theme: false,
                  saveAsImage: true,
                },
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