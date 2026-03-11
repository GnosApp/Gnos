import { GnosNavButton } from '@/components/SideNav'
import { useEffect, useRef, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadBookContent } from '@/lib/storage'
import { generateCoverColor } from '@/lib/utils'

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

export default function PdfView() {
  const activeBook = useAppStore(s => s.activeBook)
  const setView    = useAppStore(s => s.setView)

  const [pdf,       setPdf]       = useState(null)
  const [pageNum,   setPageNum]   = useState(1)
  const [numPages,  setNumPages]  = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [scale,     setScale]     = useState(1.2)
  const [pageInput, setPageInput] = useState(null)

  const canvasRef    = useRef()
  const renderTask   = useRef(null)
  const pdfRef       = useRef(null)

  const [c1, c2] = generateCoverColor(activeBook?.title || '')

  const bookId = activeBook?.id

  // ── Load PDF ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeBook) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const pdfjsLib = await loadPdfJs()

        // PDF books store their source as a data URL in the book object or storage
        // Try book.audioDataUrl equivalent — books import a coverDataUrl but for PDF
        // we stored chapters as pdfPage blocks — check that first
        const chapters = await loadBookContent(activeBook.id)
        let src = null

        if (chapters?.[0]?.blocks?.[0]?.type === 'pdfPage') {
          // Legacy pdfPage block format — reconstruct from data URLs
          // Fall through to raw PDF source
        }

        // Try raw PDF data URL stored on book object
        src = activeBook.pdfDataUrl || activeBook.rawDataUrl || null

        if (!src) {
          // No raw PDF source — show the rendered pdfPage images if available
          if (chapters?.some(c => c.blocks?.some(b => b.type === 'pdfPage'))) {
            setError('PDF was imported as images. Re-import for full PDF viewing.')
          } else {
            setError('PDF source not found. Please re-import this file.')
          }
          setLoading(false)
          return
        }

        const pdfDoc = await pdfjsLib.getDocument({ url: src }).promise
        if (cancelled) return

        pdfRef.current = pdfDoc
        setPdf(pdfDoc)
        setNumPages(pdfDoc.numPages)

        const saved = (activeBook.currentChapter || 0) + 1
        const startPage = Math.max(1, Math.min(saved, pdfDoc.numPages))
        setPageNum(startPage)
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

  // ── Render page ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdf || !canvasRef.current || loading) return
    let cancelled = false

    async function renderCurrentPage() {
      if (renderTask.current) {
        renderTask.current.cancel()
        renderTask.current = null
      }

      try {
        const page    = await pdf.getPage(pageNum)
        if (cancelled) return

        const viewport = page.getViewport({ scale })
        const canvas   = canvasRef.current
        const ctx      = canvas.getContext('2d')

        canvas.width  = viewport.width
        canvas.height = viewport.height
        canvas.style.width  = viewport.width  + 'px'
        canvas.style.height = viewport.height + 'px'

        renderTask.current = page.render({ canvasContext: ctx, viewport })
        await renderTask.current.promise
        renderTask.current = null

        // Save progress
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
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--readerBg)', color:'var(--text)' }}>

      {/* Header */}
      <header style={{
        display:'flex', alignItems:'center', gap:10, padding:'0 16px', height:48,
        borderBottom:'1px solid var(--border)', background:'var(--headerBg)', flexShrink:0,
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

        {/* Zoom controls */}
        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
          <button onClick={() => setScale(s => Math.max(0.5, +(s - 0.2).toFixed(1)))}
            style={{ background:'var(--surfaceAlt)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, width:28, height:28, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
          <span style={{ fontSize:11, color:'var(--textDim)', minWidth:36, textAlign:'center' }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(3, +(s + 0.2).toFixed(1)))}
            style={{ background:'var(--surfaceAlt)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, width:28, height:28, cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
        </div>
      </header>

      {/* Main */}
      <main style={{ flex:1, overflow:'auto', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', background:'var(--readerBg)' }}>
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:20 }}>
            <div style={{ width:140, height:190, borderRadius:8, background:`linear-gradient(135deg,${c1},${c2})`, display:'flex', alignItems:'flex-end', padding:12, boxSizing:'border-box', boxShadow:'0 8px 32px rgba(0,0,0,0.3)' }}>
              <span style={{ color:'rgba(255,255,255,0.9)', fontSize:11, fontWeight:700, fontFamily:'Georgia,serif', lineHeight:1.3 }}>{activeBook?.title}</span>
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
          <div style={{ boxShadow:'0 8px 40px rgba(0,0,0,0.4)', borderRadius:2, overflow:'hidden', background:'#fff' }}>
            <canvas ref={canvasRef} />
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