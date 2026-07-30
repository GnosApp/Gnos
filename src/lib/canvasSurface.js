/**
 * canvasSurface.js — shared canvas-background language for GraphView and
 * SketchbookView so both surfaces use identical dot/line/grid rendering.
 */

// Shared constants — one source of truth for canvas backgrounds app-wide.
export const DOT_BASE = 22      // px between dots at zoom 1
export const DOT_RADIUS = 1.2   // dot radius at zoom 1
export const DOT_ALPHA = 0.18
export const LINE_BASE = 28     // ruled-line spacing at zoom 1
export const GRID_BASE = 20     // minor grid cell (matches Excalidraw gridSize)

/** Luminance of a resolved CSS color string (#rrggbb). Returns 0-255 or null. */
export function hexLuminance(color) {
  const m = (color || '').trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

/** True when the current theme background is dark. Reads --bg off :root. */
export function isThemeDark() {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    const lum = hexLuminance(bg)
    if (lum != null) return lum <= 128
  } catch { /* SSR / detached */ }
  return true
}

/** Round to device pixels so background offsets don't shimmer at fractional zooms. */
export function snapToDevicePixels(v) {
  const dpr = window.devicePixelRatio || 1
  return Math.round(v * dpr) / dpr
}

/**
 * Compute background-image styles for a pannable surface layer.
 * style: 'dots' | 'lines' | 'grid' | anything else = none
 * view:  { zoom, scrollX, scrollY, gridSize? } — scroll in canvas units
 * dark:  boolean
 * Returns { backgroundImage, backgroundSize, backgroundPosition }.
 */
export function surfaceBackground(style, view, dark) {
  const zoom = view.zoom ?? 1
  const sx = view.scrollX ?? 0
  const sy = view.scrollY ?? 0

  if (style === 'dots') {
    const S = DOT_BASE * zoom
    const r = Math.max(0.5, DOT_RADIUS * zoom)
    const bx = snapToDevicePixels((((sx % DOT_BASE) + DOT_BASE) % DOT_BASE) * zoom)
    const by = snapToDevicePixels((((sy % DOT_BASE) + DOT_BASE) % DOT_BASE) * zoom)
    const c = dark ? `rgba(255,255,255,${DOT_ALPHA})` : `rgba(0,0,0,${DOT_ALPHA})`
    return {
      backgroundImage: `radial-gradient(circle, ${c} ${r}px, transparent ${r}px)`,
      backgroundSize: `${S}px ${S}px`,
      backgroundPosition: `${bx}px ${by}px`,
    }
  }

  if (style === 'lines') {
    const S = LINE_BASE * zoom
    const by = snapToDevicePixels((((sy % LINE_BASE) + LINE_BASE) % LINE_BASE) * zoom)
    const c = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
    return {
      backgroundImage: `repeating-linear-gradient(to bottom, ${c} 0px, ${c} 1px, transparent 1px, transparent ${S}px)`,
      backgroundSize: `100% ${S}px`,
      backgroundPosition: `0px ${by}px`,
    }
  }

  if (style === 'grid') {
    const BASE = view.gridSize ?? GRID_BASE
    const MAJOR = BASE * 5
    const S_minor = BASE * zoom
    const S_major = MAJOR * zoom
    const bx = snapToDevicePixels((((sx % MAJOR) + MAJOR) % MAJOR) * zoom)
    const by = snapToDevicePixels((((sy % MAJOR) + MAJOR) % MAJOR) * zoom)
    const minorC = dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.10)'
    const majorC = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)'
    const lines = []
    for (let i = 1; i < 5; i++) {
      const p = i * S_minor
      lines.push(
        `<line x1="${p}" y1="0" x2="${p}" y2="${S_major}" stroke="${minorC}" stroke-width="0.6" stroke-dasharray="4 3"/>`,
        `<line x1="0" y1="${p}" x2="${S_major}" y2="${p}" stroke="${minorC}" stroke-width="0.6" stroke-dasharray="4 3"/>`
      )
    }
    lines.push(
      `<line x1="0" y1="0" x2="${S_major}" y2="0" stroke="${majorC}" stroke-width="1"/>`,
      `<line x1="0" y1="0" x2="0" y2="${S_major}" stroke="${majorC}" stroke-width="1"/>`
    )
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S_major}" height="${S_major}">${lines.join('')}</svg>`
    return {
      backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
      backgroundSize: `${S_major}px ${S_major}px`,
      backgroundPosition: `${bx}px ${by}px`,
    }
  }

  return { backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0' }
}

/** Apply surfaceBackground() result straight onto a DOM element (no re-render). */
export function paintSurfaceBackground(el, style, view, dark) {
  if (!el) return
  const s = surfaceBackground(style, view, dark)
  el.style.backgroundImage = s.backgroundImage
  el.style.backgroundSize = s.backgroundSize
  el.style.backgroundPosition = s.backgroundPosition
}
