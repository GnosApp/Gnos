import { useEffect, useRef, useState, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadSketchbookContent, saveSketchbookContent } from '@/lib/storage'
import { GnosNavButton } from '@/components/SideNav'

// ─────────────────────────────────────────────────────────────────────────────
// Why native canvas instead of Excalidraw:
// @excalidraw/excalidraw requires a bundler-specific setup and its peer deps
// (roughjs, etc.) are not installed. A native canvas is more reliable,
// faster to load, and works everywhere including Tauri.
// ─────────────────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#e6edf3', '#ffffff', '#ef5350', '#ff7043', '#ffca28',
  '#66bb6a', '#29b6f6', '#7c6af7', '#f06292', '#90a4ae',
]

const STROKE_WIDTHS = [2, 4, 8, 16]

export default function SketchbookView() {
  const sketchbook     = useAppStore(s => s.activeSketchbook)
  const setView        = useAppStore(s => s.setView)
  const updateSketchbook = useAppStore(s => s.updateSketchbook)

  const canvasRef      = useRef(null)
  const overlayRef     = useRef(null)  // temp stroke canvas
  const strokesRef     = useRef([])    // [{tool,color,width,points}]
  const redoRef        = useRef([])
  const drawingRef     = useRef(false)
  const currentStroke  = useRef(null)
  const saveTimerRef   = useRef(null)

  const [tool,       setTool]       = useState('pen')   // 'pen' | 'eraser'
  const [color,      setColor]      = useState('#e6edf3')
  const [strokeWidth, setStrokeWidth] = useState(4)
  const [saving,     setSaving]     = useState(false)
  const [loaded,     setLoaded]     = useState(false)

  // ── Load strokes from storage ──────────────────────────────────────────────
  const sketchbookId = sketchbook?.id
  useEffect(() => {
    if (!sketchbookId) return
    loadSketchbookContent(sketchbookId).then(data => {
      if (data?.strokes) {
        strokesRef.current = data.strokes
      } else {
        strokesRef.current = []
      }
      redoRef.current = []
      setLoaded(true)
    })
  }, [sketchbookId])

  // ── Drawing helpers ────────────────────────────────────────────────────────
  const drawStroke = useCallback((ctx, stroke) => {
    if (!stroke.points || stroke.points.length < 1) return
    ctx.beginPath()
    ctx.lineCap    = 'round'
    ctx.lineJoin   = 'round'
    ctx.lineWidth  = stroke.width

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = stroke.color
    }

    const pts = stroke.points
    if (pts.length === 1) {
      ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [])

  // ── Redraw all strokes onto main canvas ────────────────────────────────────
  const redrawAll = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke)
    }
  }, [drawStroke])

  // ── Fit canvas to container ────────────────────────────────────────────────
  useEffect(() => {
    if (!loaded) return
    const resize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const parent = canvas.parentElement
      canvas.width  = parent.clientWidth
      canvas.height = parent.clientHeight
      const overlay = overlayRef.current
      if (overlay) { overlay.width = canvas.width; overlay.height = canvas.height }
      redrawAll()
    }
    resize()
    const ro = new ResizeObserver(resize)
    const parent = canvasRef.current?.parentElement
    if (parent) ro.observe(parent)
    return () => ro.disconnect()
  }, [loaded, redrawAll])

  function getPoint(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height),
    }
  }

  function onPointerDown(e) {
    e.preventDefault()
    drawingRef.current = true
    redoRef.current = []
    const pt = getPoint(e)
    currentStroke.current = { tool, color, width: strokeWidth, points: [pt] }
    // Draw a dot immediately
    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')
      ctx.clearRect(0, 0, overlay.width, overlay.height)
    }
  }

  function onPointerMove(e) {
    if (!drawingRef.current || !currentStroke.current) return
    e.preventDefault()
    const pt = getPoint(e)
    currentStroke.current.points.push(pt)
    // Draw current stroke on overlay
    const overlay = overlayRef.current
    if (overlay) {
      const ctx = overlay.getContext('2d')
      ctx.clearRect(0, 0, overlay.width, overlay.height)
      drawStroke(ctx, currentStroke.current)
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    if (!sketchbook) return
    setSaving(true)
    await saveSketchbookContent(sketchbook.id, { strokes: strokesRef.current, version: 2 })
    updateSketchbook(sketchbook.id, { updatedAt: new Date().toISOString() })
    useAppStore.getState().persistSketchbooks?.()
    setSaving(false)
  }, [sketchbook, updateSketchbook])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(doSave, 1000)
  }, [doSave])

  function onPointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    if (currentStroke.current && currentStroke.current.points.length > 0) {
      strokesRef.current = [...strokesRef.current, currentStroke.current]
      currentStroke.current = null
      redrawAll()
      // Clear overlay
      const overlay = overlayRef.current
      if (overlay) {
        const ctx = overlay.getContext('2d')
        ctx.clearRect(0, 0, overlay.width, overlay.height)
      }
      scheduleSave()
    }
  }

  // ── Undo / Redo ─────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    if (!strokesRef.current.length) return
    const last = strokesRef.current[strokesRef.current.length - 1]
    redoRef.current = [...redoRef.current, last]
    strokesRef.current = strokesRef.current.slice(0, -1)
    redrawAll()
    scheduleSave()
  }, [redrawAll, scheduleSave])

  const redo = useCallback(() => {
    if (!redoRef.current.length) return
    const next = redoRef.current[redoRef.current.length - 1]
    redoRef.current = redoRef.current.slice(0, -1)
    strokesRef.current = [...strokesRef.current, next]
    redrawAll()
    scheduleSave()
  }, [redrawAll, scheduleSave])

  function clearCanvas() {
    if (!strokesRef.current.length) return
    redoRef.current = [...strokesRef.current, ...redoRef.current]
    strokesRef.current = []
    redrawAll()
    scheduleSave()
  }

  // ── Export PNG ───────────────────────────────────────────────────────────────
  function exportPng() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `${sketchbook?.title || 'sketch'}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
      if (isMod && e.key === 's') { e.preventDefault(); doSave() }
      if (e.key === 'e') setTool('eraser')
      if (e.key === 'p') setTool('pen')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, doSave])

  function exit() {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); doSave() }
    setView('library')
  }

  if (!sketchbook) return (
    <div style={{ display:'flex', height:'100vh', alignItems:'center', justifyContent:'center', background:'var(--bg)', color:'var(--textDim)', flexDirection:'column', gap:16 }}>
      <p style={{ fontSize:14 }}>No sketchbook selected.</p>
      <button onClick={() => setView('library')} style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:13 }}>Back to Library</button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg)', overflow:'hidden' }}>

      {/* Header */}
      <header style={{
        display:'flex', alignItems:'center', gap:10, padding:'0 12px', height:48,
        background:'var(--headerBg)', borderBottom:'1px solid var(--border)', flexShrink:0,
      }}>
        <GnosNavButton />
        <div style={{ width:1, height:16, background:'var(--border)' }} />
        <div style={{ flex:1, fontSize:13, fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {sketchbook.title}
        </div>
        {saving && <span style={{ fontSize:11, color:'var(--textDim)', opacity:0.6 }}>Saving…</span>}
        <button onClick={exportPng} title="Export PNG"
          style={{ background:'var(--surfaceAlt)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, padding:'5px 10px', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M2 11v3h12v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Export
        </button>
        <button onClick={exit} style={{ background:'none', border:'1px solid var(--border)', color:'var(--textDim)', borderRadius:6, padding:'5px 10px', cursor:'pointer', fontSize:12 }}>Done</button>
      </header>

      {/* Toolbar */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
        background:'var(--surface)', borderBottom:'1px solid var(--border)', flexShrink:0,
        flexWrap:'wrap',
      }}>
        {/* Tool selector */}
        <div style={{ display:'flex', gap:4 }}>
          {[
            { id:'pen', label:'Pen', icon: (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M11.5 2.5a2.121 2.121 0 0 1 3 3L5 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )},
            { id:'eraser', label:'Eraser', icon: (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M12 2L14 4L6 12H3L2 11L10 3L12 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                <line x1="2" y1="14" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            )},
          ].map(t => (
            <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
              style={{
                display:'flex', alignItems:'center', gap:5,
                background: tool === t.id ? 'var(--accent)' : 'var(--surfaceAlt)',
                border: '1px solid ' + (tool === t.id ? 'var(--accent)' : 'var(--border)'),
                color: tool === t.id ? '#fff' : 'var(--textDim)',
                borderRadius:6, padding:'5px 10px', cursor:'pointer', fontSize:12,
                transition:'all 0.12s',
              }}>
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'var(--border)' }} />

        {/* Stroke width */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {STROKE_WIDTHS.map(w => (
            <button key={w} onClick={() => setStrokeWidth(w)} title={`${w}px`}
              style={{
                width:28, height:28, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center',
                background: strokeWidth === w ? 'var(--hover)' : 'none',
                border: '1px solid ' + (strokeWidth === w ? 'var(--accent)' : 'transparent'),
                cursor:'pointer',
              }}>
              <div style={{ borderRadius:'50%', background: strokeWidth === w ? 'var(--accent)' : 'var(--textDim)', width:w < 8 ? w+2 : w, height:w < 8 ? w+2 : w, maxWidth:16, maxHeight:16 }} />
            </button>
          ))}
        </div>

        <div style={{ width:1, height:24, background:'var(--border)' }} />

        {/* Color swatches */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => { setColor(c); setTool('pen') }}
              style={{
                width:20, height:20, borderRadius:4, background:c, cursor:'pointer',
                border: color === c && tool === 'pen' ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.15)',
                boxSizing:'border-box', transition:'transform 0.1s',
                transform: color === c && tool === 'pen' ? 'scale(1.2)' : 'scale(1)',
              }} />
          ))}
          {/* Custom color */}
          <label title="Custom color" style={{ cursor:'pointer', position:'relative' }}>
            <div style={{ width:20, height:20, borderRadius:4, background:'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)', border:'1px solid rgba(255,255,255,0.15)', boxSizing:'border-box' }} />
            <input type="color" value={color} onChange={e => { setColor(e.target.value); setTool('pen') }}
              style={{ position:'absolute', opacity:0, width:0, height:0, pointerEvents:'none' }} />
          </label>
        </div>

        <div style={{ width:1, height:24, background:'var(--border)' }} />

        {/* Actions */}
        <div style={{ display:'flex', gap:4 }}>
          <button onClick={undo} title="Undo (⌘Z)"
            style={{ background:'none', border:'1px solid var(--border)', color:'var(--textDim)', borderRadius:6, padding:'4px 8px', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8a5 5 0 1 1 .9 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M3 4v4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Undo
          </button>
          <button onClick={redo} title="Redo (⌘⇧Z)"
            style={{ background:'none', border:'1px solid var(--border)', color:'var(--textDim)', borderRadius:6, padding:'4px 8px', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 8a5 5 0 1 0-.9 2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M13 4v4H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Redo
          </button>
          <button onClick={clearCanvas} title="Clear canvas"
            style={{ background:'none', border:'1px solid var(--border)', color:'#ef5350', borderRadius:6, padding:'4px 8px', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', gap:4 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><polyline points="3,6 5,6 13,6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M11 6V4H5v2M14 6l-.867 9H2.867L2 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Clear
          </button>
        </div>

        {/* Keyboard hint */}
        <div style={{ marginLeft:'auto', fontSize:11, color:'var(--textDim)', opacity:0.5 }}>
          P = pen · E = eraser · ⌘Z = undo
        </div>
      </div>

      {/* Canvas area */}
      <div style={{ flex:1, position:'relative', overflow:'hidden', background:'#1a1a1a', cursor: tool === 'eraser' ? 'none' : 'crosshair' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Main canvas (committed strokes) */}
        <canvas ref={canvasRef}
          style={{ position:'absolute', top:0, left:0, touchAction:'none' }} />
        {/* Overlay canvas (current stroke being drawn) */}
        <canvas ref={overlayRef}
          style={{ position:'absolute', top:0, left:0, touchAction:'none', pointerEvents:'none' }} />
        {/* Loading state */}
        {!loaded && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--textDim)', fontSize:13 }}>
            Loading canvas…
          </div>
        )}
      </div>
    </div>
  )
}