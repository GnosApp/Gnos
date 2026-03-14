import { useEffect, useRef, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { generateCoverColor } from '@/lib/utils'
import { GnosNavButton } from '@/components/SideNav'

// ── Load PDF.js from CDN ───────────────────────────────────────────────────────

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(window.pdfjsLib)
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
}

// ── Load PDF.js text layer CSS ─────────────────────────────────────────────────
function ensureTextLayerCss() {
  if (document.getElementById('pdfjs-text-layer-css')) return
  const link = document.createElement('link')
  link.id = 'pdfjs-text-layer-css'
  link.rel = 'stylesheet'
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css'
  document.head.appendChild(link)
}

export default function PdfView() {
  const activeBook = useAppStore(s => s.activeBook)
  const setView    = useAppStore(s => s.setView)

  const [pdf,       setPdf]       = useState(null)
  const [pageNum,   setPageNum]   = useState(1)
  const [numPages,  setNumPages]  = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [scale,     setScale]     = useState(1.0)
  const [fitScale,  setFitScale]  = useState(1.0)
  const [pageInput, setPageInput] = useState(null)
  const [coverDataUrl, setCoverDataUrl] = useState(null)

  const canvasRef    = useRef()
  const textLayerRef = useRef()
  const renderTask   = useRef(null)
  const pdfRef       = useRef(null)

  const [c1, c2] = generateCoverColor(activeBook?.title || '')
  const bookId = activeBook?.id

  // ── Load PDF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBook) return
    let cancelled = false
    ensureTextLayerCss()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const pdfjsLib = await loadPdfJs()

        const src = activeBook.pdfDataUrl || activeBook.rawDataUrl || null

        if (!src) {
          setError('PDF source not found. Please re-import this file.')
          setLoading(false)
          return
        }

        // data: URIs must be passed as `data`, http(s) URLs as `url`
        const pdfDocSource = src.startsWith('data:') ? { data: atob(src.split(',')[1]) } : { url: src }
        const pdfDoc = await pdfjsLib.getDocument(pdfDocSource).promise
        if (cancelled) return

        pdfRef.current = pdfDoc
        setPdf(pdfDoc)
        setNumPages(pdfDoc.numPages)

        const saved = (activeBook.currentChapter || 0) + 1
        const startPage = Math.max(1, Math.min(saved, pdfDoc.numPages))
        setPageNum(startPage)

        // Compute fit scale from first page
        try {
          const firstPage = await pdfDoc.getPage(1)
          const rawViewport = firstPage.getViewport({ scale: 1 })
          const containerEl = document.getElementById('pdf-main-container')
          const availW = containerEl ? containerEl.clientWidth  - 48 : window.innerWidth  - 48
          const availH = containerEl ? containerEl.clientHeight - 48 : window.innerHeight - 96
          const scaleW = availW / rawViewport.width
          const scaleH = availH / rawViewport.height
          const computed = Math.min(scaleW, scaleH, 2.5)
          setFitScale(computed)
          setScale(computed)

          // Render cover thumbnail at high quality
          const thumbScale = Math.min(280 / rawViewport.width, 380 / rawViewport.height)
          const dpr = window.devicePixelRatio || 1
          const thumbVp = firstPage.getViewport({ scale: thumbScale * dpr })
          const offscreen = document.createElement('canvas')
          offscreen.width  = thumbVp.width
          offscreen.height = thumbVp.height
          const octx = offscreen.getContext('2d')
          await firstPage.render({ canvasContext: octx, viewport: thumbVp }).promise
          const thumbUrl = offscreen.toDataURL('image/jpeg', 0.9)
          setCoverDataUrl(thumbUrl)
          if (!activeBook.coverDataUrl) {
            useAppStore.getState().updateBook(activeBook.id, { coverDataUrl: thumbUrl })
            useAppStore.getState().persistLibrary()
          }
        } catch { /* non-fatal */ }

        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          console.error('[PdfView] load error:', err)
          setError(`Failed to load PDF: ${err.message}`)
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [activeBook, bookId])

  // ── Render page (high-DPI + text layer) ────────────────────────────────────
  useEffect(() => {
    if (!pdf || !canvasRef.current || loading) return
    let cancelled = false

    async function renderCurrentPage() {
      if (renderTask.current) {
        renderTask.current.cancel()
        renderTask.current = null
      }

      // Clear text layer
      if (textLayerRef.current) textLayerRef.current.innerHTML = ''

      try {
        const page    = await pdf.getPage(pageNum)
        if (cancelled) return

        const containerEl = document.getElementById('pdf-main-container')
        const availW = containerEl ? containerEl.clientWidth  - 48 : window.innerWidth  - 48
        const availH = containerEl ? containerEl.clientHeight - 48 : window.innerHeight - 96
        const rawVp  = page.getViewport({ scale: 1 })
        const scaleW = availW / rawVp.width
        const scaleH = availH / rawVp.height
        const autoFit = Math.min(scaleW, scaleH, 2.5)
        setFitScale(prev => Math.abs(prev - autoFit) > 0.02 ? autoFit : prev)

        // Use devicePixelRatio for high-DPI rendering
        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale })
        const canvas   = canvasRef.current
        const ctx      = canvas.getContext('2d')

        // Physical pixels (sharp on retina)
        canvas.width  = Math.floor(viewport.width  * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        // CSS size stays at logical pixels
        canvas.style.width  = viewport.width  + 'px'
        canvas.style.height = viewport.height + 'px'
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        renderTask.current = page.render({ canvasContext: ctx, viewport })
        await renderTask.current.promise
        renderTask.current = null

        // ── Text layer for copy-paste ────────────────────────────────────
        if (textLayerRef.current && window.pdfjsLib) {
          const textContent = await page.getTextContent()
          if (cancelled) return

          const tl = textLayerRef.current
          tl.innerHTML = ''
          tl.style.width  = viewport.width  + 'px'
          tl.style.height = viewport.height + 'px'
          // PDF.js 3.x requires --scale-factor to match viewport.scale
          tl.style.setProperty('--scale-factor', viewport.scale)

          window.pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: tl,
            viewport,
            textDivs: [],
          })
        }

        useAppStore.getState().updateBookProgress(bookId, pageNum - 1, 0)
        useAppStore.getState().persistLibrary()
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('[PdfView] render error:', err)
        }
      }
    }

    renderCurrentPage()
    return () => {
      cancelled = true
      if (renderTask.current) { renderTask.current.cancel(); renderTask.current = null }
    }
  }, [pdf, pageNum, scale, bookId, loading])

  // ── Keyboard nav ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setPageNum(p => Math.min(p + 1, numPages))
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   setPageNum(p => Math.max(p - 1, 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [numPages])

  const pct = numPages > 1 ? ((pageNum - 1) / (numPages - 1)) * 100 : 0

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--readerBg)', color:'var(--text)' }}>

      {/* Header */}
      <header className="gnos-header" style={{
        display:'flex', alignItems:'center', gap:10, padding:'0 20px', height:52,
        borderBottom:'1px solid var(--borderSubtle)', background:'var(--headerBg)', flexShrink:0,
      }}>
        <GnosNavButton />
        <div style={{ width:1, height:16, background:'var(--border)' }} />

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {activeBook?.title || 'PDF'}
          </div>
          {activeBook?.author && (
            <div style={{ fontSize:11, color:'var(--textDim)' }}>{activeBook.author}</div>
          )}
        </div>

        {/* Zoom controls — order: Fit | − | % | + */}
        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
          <button onClick={() => setScale(fitScale)} title="Fit to screen"
            style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--textDim)', borderRadius:7, height:30, padding:'0 9px', cursor:'pointer', fontSize:11, fontFamily:'inherit', whiteSpace:'nowrap', fontWeight:600, transition:'background 0.1s' }}>Fit</button>
          <button onClick={() => setScale(s => Math.max(0.3, +(s - 0.15).toFixed(2)))} title="Zoom out"
            style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:7, width:30, height:30, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.1s' }}>−</button>
          <span style={{ fontSize:11, color:'var(--textDim)', minWidth:38, textAlign:'center', fontVariantNumeric:'tabular-nums' }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, +(s + 0.15).toFixed(2)))} title="Zoom in"
            style={{ background:'var(--surface)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:7, width:30, height:30, cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', transition:'background 0.1s' }}>+</button>
        </div>
      </header>

      {/* Main */}
      <main id="pdf-main-container" style={{ flex:1, overflow:'auto', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', background:'var(--readerBg)' }}>
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:20 }}>
            <div style={{ width:140, height:190, borderRadius:8, overflow:'hidden', display:'flex', alignItems:'flex-end', padding:0, boxSizing:'border-box', boxShadow:'0 8px 32px rgba(0,0,0,0.3)', background:`linear-gradient(135deg,${c1},${c2})` }}>
              {coverDataUrl
                ? <img src={coverDataUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <span style={{ color:'rgba(255,255,255,0.9)', fontSize:11, fontWeight:700, fontFamily:'Georgia,serif', lineHeight:1.3, padding:12 }}>{activeBook?.title}</span>
              }
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, color:'var(--textDim)', fontSize:12 }}>
              <div className="spinner" /><span>Loading PDF…</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:16, padding:40, textAlign:'center' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ opacity:0.3 }}>
              <path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p style={{ color:'var(--textDim)', fontSize:13, maxWidth:340, lineHeight:1.6 }}>{error}</p>
            <button onClick={() => setView('library')} style={{ background:'var(--accent)', color:'#fff', border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:13 }}>
              Back to Library
            </button>
          </div>
        )}

        {!loading && !error && (
          <div style={{ position: 'relative', boxShadow:'0 8px 40px rgba(0,0,0,0.4)', borderRadius:2, overflow:'hidden', background:'#fff', display:'inline-block' }}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
            {/* Text layer for copy-paste — positioned exactly over canvas */}
            <div
              ref={textLayerRef}
              className="textLayer"
              style={{
                position: 'absolute',
                top: 0, left: 0,
                overflow: 'hidden',
                opacity: 0.2,
                lineHeight: 1,
                userSelect: 'text',
                pointerEvents: 'auto',
              }}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      {!loading && !error && numPages > 0 && (
        <footer style={{
          display:'flex', flexDirection:'column', gap:0,
          background:'var(--headerBg)', borderTop:'1px solid var(--border)', flexShrink:0,
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px' }}>
            <button
              disabled={pageNum <= 1}
              onClick={() => setPageNum(p => Math.max(1, p - 1))}
              style={{ background:'none', border:'1px solid var(--border)', color: pageNum <= 1 ? 'var(--textDim)' : 'var(--text)', borderRadius:6, padding:'5px 14px', cursor: pageNum <= 1 ? 'default' : 'pointer', fontSize:12, opacity: pageNum <= 1 ? 0.4 : 1 }}>
              ← Prev
            </button>

            <span style={{ fontSize:12, color:'var(--textDim)' }}>
              {'Page '}
              {pageInput !== null
                ? <input type="number" min={1} max={numPages} value={pageInput} autoFocus
                    style={{ width:48, background:'transparent', border:'none', borderBottom:'1px solid var(--textDim)', color:'var(--text)', fontSize:'inherit', textAlign:'center', outline:'none', padding:'0 2px' }}
                    onChange={e => setPageInput(e.target.value)}
                    onBlur={e => { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= numPages) setPageNum(n); setPageInput(null) }}
                    onKeyDown={e => { if (e.key === 'Enter') { const n = parseInt(e.target.value, 10); if (n >= 1 && n <= numPages) setPageNum(n); setPageInput(null) } if (e.key === 'Escape') setPageInput(null) }} />
                : <span style={{ cursor:'pointer', color:'var(--text)', fontWeight:600 }} onClick={() => setPageInput(pageNum)}>{pageNum}</span>
              }
              {` of ${numPages} · ${Math.round(pct)}%`}
            </span>

            <button
              disabled={pageNum >= numPages}
              onClick={() => setPageNum(p => Math.min(numPages, p + 1))}
              style={{ background:'none', border:'1px solid var(--border)', color: pageNum >= numPages ? 'var(--textDim)' : 'var(--text)', borderRadius:6, padding:'5px 14px', cursor: pageNum >= numPages ? 'default' : 'pointer', fontSize:12, opacity: pageNum >= numPages ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
          <div style={{ height:2, background:'var(--border)' }}>
            <div style={{ height:'100%', width:`${pct}%`, background:'var(--accent)', transition:'width 0.2s' }} />
          </div>
        </footer>
      )}
    </div>
  )
}