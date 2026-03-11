import { useEffect, useRef, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadAudioChapter, loadSingleAudioData } from '@/lib/storage'
import { generateCoverColor } from '@/lib/utils'
import { GnosNavButton } from '@/components/SideNav'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const fmt = (s) => {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`
}

export default function AudioPlayerView() {
  const book    = useAppStore(s => s.activeAudioBook)
  const setView = useAppStore(s => s.setView)

  const audioRef    = useRef(null)
  const chapCacheRef = useRef({})

  const [chapIdx,   setChapIdx]   = useState(0)
  const [speed,     setSpeed]     = useState(1)
  const [playing,   setPlaying]   = useState(false)
  const [progress,  setProgress]  = useState(0)   // 0–1
  const [timeCur,   setTimeCur]   = useState('0:00')
  const [timeDur,   setTimeDur]   = useState('0:00')
  const [volume,    setVolume]    = useState(1)

  const chapIdxRef = useRef(0)
  const speedRef    = useRef(1)
  chapIdxRef.current = chapIdx
  speedRef.current   = speed

  const chaps = book?.audioChapters
  const isMulti = chaps && chaps.length > 1

  // ── Load chapter ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!book) return
    chapCacheRef.current = {}
    const startIdx = book.currentChapter || 0
    setChapIdx(startIdx)
    setSpeed(1)
    loadAndPlayChapter(startIdx, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id])

  async function loadAndPlayChapter(idx, autoplay = true) {
    const audio = audioRef.current
    const book = useAppStore.getState().activeAudioBook
    if (!audio || !book) return

    audio.pause()
    setPlaying(false)
    setProgress(0)
    setTimeCur('0:00')
    setTimeDur('—')
    setChapIdx(idx)
    chapIdxRef.current = idx

    let src = ''
    const cache = chapCacheRef.current

    if (book.format === 'audiofolder') {
      if (cache[idx]) {
        src = cache[idx]
      } else {
        try {
          const stored = await loadAudioChapter(book.id, idx)
          if (stored) {
            const val = stored.value ?? stored
            src = val instanceof Blob ? URL.createObjectURL(val) : val
          }
        } catch { /* fall through */ }
        // Fall back to in-memory dataUrl stored on the chapter object at import time
        if (!src) src = book.audioChapters?.[idx]?.dataUrl || ''
        if (src) cache[idx] = src
      }
    } else {
      // Single audio file — try cache, then storage, then book object directly
      if (cache[0]) {
        src = cache[0]
      } else {
        try {
          const stored = await loadSingleAudioData(book.id)
          if (stored) {
            const val = stored.value ?? stored
            src = typeof val === 'string' && val.startsWith('data:') ? val
                : val instanceof Blob ? URL.createObjectURL(val) : ''
            if (src) cache[0] = src
          }
        } catch { /* fall through */ }
        // Always fall back to the in-memory dataUrl on the book object
        if (!src) src = book.audioDataUrl || ''
        if (src) cache[0] = src
      }
    }

    if (!src) {
      console.warn('[AudioPlayer] No audio source found for book', book.id)
      return
    }

    audio.src = src
    audio.playbackRate = speedRef.current

    // Preload next chapter quietly
    if (book.format === 'audiofolder' && book.audioChapters && idx + 1 < book.audioChapters.length) {
      setTimeout(async () => {
        if (!cache[idx + 1]) {
          try {
            const s = await loadAudioChapter(book.id, idx + 1)
            if (s) {
              const val = s.value ?? s
              cache[idx + 1] = val instanceof Blob ? URL.createObjectURL(val) : val
            }
          } catch { /* ignore */ }
        }
      }, 5000)
    }

    if (autoplay) {
      audio.play().catch(err => console.warn('[AudioPlayer] play() failed:', err))
    }

    useAppStore.getState().updateBookProgress(book.id, idx, 0)
  }

  // ── Audio event handlers ───────────────────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      if (!audio.duration || !isFinite(audio.duration)) return
      setProgress(audio.currentTime / audio.duration)
      setTimeCur(fmt(audio.currentTime))
      // Save overall listen progress across all chapters
      const b = useAppStore.getState().activeAudioBook
      if (b?.audioChapters?.length > 1) {
        const totalChaps = b.audioChapters.length
        const chapProgress = (chapIdxRef.current + audio.currentTime / audio.duration) / totalChaps
        useAppStore.getState().updateBook(b.id, { listenProgress: chapProgress })
      } else if (b) {
        useAppStore.getState().updateBook(b.id, { listenProgress: audio.currentTime / audio.duration })
      }
    }
    const onLoaded = () => setTimeDur(fmt(audio.duration))
    const onPlay   = () => setPlaying(true)
    const onPause  = () => setPlaying(false)
    const onEnded  = () => {
      setPlaying(false)
      const b = useAppStore.getState().activeAudioBook
      if (b?.audioChapters && chapIdxRef.current < b.audioChapters.length - 1)
        loadAndPlayChapter(chapIdxRef.current + 1, true)
    }

    audio.addEventListener('timeupdate',    onTimeUpdate)
    audio.addEventListener('loadedmetadata',onLoaded)
    audio.addEventListener('play',          onPlay)
    audio.addEventListener('pause',         onPause)
    audio.addEventListener('ended',         onEnded)
    return () => {
      audio.removeEventListener('timeupdate',    onTimeUpdate)
      audio.removeEventListener('loadedmetadata',onLoaded)
      audio.removeEventListener('play',          onPlay)
      audio.removeEventListener('pause',         onPause)
      audio.removeEventListener('ended',         onEnded)
    }
  }, [])

  // ── Controls ───────────────────────────────────────────────────────────────
  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return

    // Pause is always synchronous — do it immediately
    if (!audio.paused) { audio.pause(); return }

    // Detect un-loaded state: blank src resolves to the page URL in browsers
    const srcIsBlank = !audio.src || audio.src === window.location.href ||
      audio.src === window.location.origin + window.location.pathname

    if (!srcIsBlank) {
      // Src already set — play directly, staying inside the gesture context
      audio.play().catch(() => loadAndPlayChapter(chapIdxRef.current, true))
      return
    }

    // Src is blank — resolve synchronously from cache or book object so
    // audio.play() is called within the same user-gesture stack frame.
    const bk    = useAppStore.getState().activeAudioBook
    const cache = chapCacheRef.current
    const idx   = chapIdxRef.current
    const syncSrc = bk?.format === 'audiofolder'
      ? (cache[idx] || bk?.audioChapters?.[idx]?.dataUrl || '')
      : (cache[0]   || bk?.audioDataUrl || '')

    if (syncSrc) {
      audio.src = syncSrc
      audio.playbackRate = speedRef.current
      // play() called synchronously — browser gesture context still alive
      audio.play().catch(err => {
        console.warn('[AudioPlayer] sync play failed:', err)
        loadAndPlayChapter(idx, true)
      })
    } else {
      // Nothing in memory yet — async load (may need one retry tap)
      loadAndPlayChapter(idx, true)
    }
  }

  function skipBy(sec) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + sec))
  }

  function cycleSpeed() {
    const next = SPEEDS[(SPEEDS.indexOf(speedRef.current) + 1) % SPEEDS.length]
    speedRef.current = next
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  function scrubTo(clientX, rect) {
    const audio = audioRef.current
    if (!audio?.duration) return
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    audio.currentTime = pct * audio.duration
  }

  function onProgressPointerDown(e) {
    const track = e.currentTarget
    track.setPointerCapture(e.pointerId)
    scrubTo(e.clientX, track.getBoundingClientRect())
    const onMove = mv => scrubTo(mv.clientX, track.getBoundingClientRect())
    const onUp   = () => { track.removeEventListener('pointermove', onMove); track.removeEventListener('pointerup', onUp) }
    track.addEventListener('pointermove', onMove)
    track.addEventListener('pointerup', onUp)
  }

  function onVolChange(e) {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
  }

  function exit() {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.src = '' }
    setView('library')
  }

  // ── Cover ──────────────────────────────────────────────────────────────────
  const [c1, c2] = generateCoverColor(book?.title || '')
  const hasCover = !!book?.coverDataUrl

  const chapName = isMulti
    ? (chaps[chapIdx]?.title || `Chapter ${chapIdx + 1}`)
    : ''
  const chapLabel = isMulti
    ? `Chapter ${chapIdx + 1} of ${chaps.length} — ${chapName}`
    : ''

  if (!book) return null

  return (
    <div className="view active" style={{ padding: 0 }}>
      <div className="ap-layout">

        {/* ── Sidebar ── */}
        <aside className="ap-sidebar">
          <div className="ap-sidebar-header">
            <GnosNavButton />
            <button className="ap-gnos-logo" onClick={exit}>Gnos</button>
            <div className="ap-sidebar-title">Chapters</div>
          </div>
          <div className="ap-chapter-list">
            {isMulti ? chaps.map((c, i) => (
              <button key={i} className={`ap-chap-item${i === chapIdx ? ' active' : ''}`}
                onClick={() => loadAndPlayChapter(i, true)}>
                <span className="ap-chap-num">{i + 1}</span>
                <span className="ap-chap-name">{c.title || `Chapter ${i + 1}`}</span>
                {i === chapIdx && (
                  <span className="ap-chap-playing">
                    <span className="ap-chap-bar" />
                    <span className="ap-chap-bar" />
                    <span className="ap-chap-bar" />
                  </span>
                )}
              </button>
            )) : (
              <button className="ap-chap-item active">
                <span className="ap-chap-num">1</span>
                <span className="ap-chap-name">{book.title || 'Track'}</span>
                <span className="ap-chap-playing">
                  <span className="ap-chap-bar" />
                  <span className="ap-chap-bar" />
                  <span className="ap-chap-bar" />
                </span>
              </button>
            )}
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="ap-main">

          {/* Cover */}
          <div className="ap-cover-wrap">
            <div className={`ap-cover${playing ? ' playing' : ''}`}>
              {hasCover
                ? <img src={book.coverDataUrl} alt="" style={{ width:'100%',height:'100%',objectFit:'cover',borderRadius:14 }} />
                : <div className="ap-cover-placeholder"
                    style={{ width:'100%',height:'100%',background:`linear-gradient(135deg,${c1},${c2})`,borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center' }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                      <path d="M9 18c0 1.66-1.34 3-3 3H4c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1zM22 15c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      <path d="M9 19V8l13-3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
              }
            </div>
          </div>

          {/* Track info */}
          <div className="ap-track-info">
            <div className="ap-track-title">{book.title || 'Audiobook'}</div>
            <div className="ap-track-author">{book.author || ''}</div>
            {chapLabel && <div className="ap-track-chapter">{chapLabel}</div>}
          </div>

          {/* Progress bar */}
          <div className="ap-progress-wrap">
            <span className="ap-time">{timeCur}</span>
            <div
              className="ap-progress-bar-track"
              onPointerDown={onProgressPointerDown}
              style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }}
            >
              <div className="ap-progress-fill" style={{ width: `${progress * 100}%` }} />
              <div className="ap-progress-thumb" style={{
                position: 'absolute',
                left: `${progress * 100}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }} />
            </div>
            <span className="ap-time">{timeDur}</span>
          </div>

          {/* Controls */}
          <div className="ap-controls">
            <button className="ap-ctrl-btn ap-speed-cycle" onClick={cycleSpeed}>{speed}×</button>
            <button className="ap-ctrl-btn ap-skip" onClick={() => skipBy(-30)} title="Back 30s">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V2L7 7l5 5V8a7 7 0 1 1-5.3 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <text x="6" y="16" fontSize="6" fill="currentColor" fontFamily="sans-serif" textAnchor="middle">30</text>
              </svg>
            </button>
            <button className="ap-ctrl-btn ap-prev" onClick={() => chapIdx > 0 && loadAndPlayChapter(chapIdx - 1, true)} title="Previous chapter">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <polygon points="19,5 9,12 19,19" fill="currentColor"/>
                <rect x="5" y="5" width="3" height="14" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button onClick={togglePlay}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 54, height: 54, borderRadius: 13,
                background: 'var(--surface)',
                color: 'var(--accent)',
                border: '1.5px solid var(--border)',
                outline: '3px solid var(--accent)',
                outlineOffset: '2px',
                cursor: 'pointer', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transition: 'transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surfaceAlt)' }}
              onMouseDown={e => { e.currentTarget.style.transform='scale(0.93)'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.15)' }}
              onMouseUp={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.2)' }}
              onMouseLeave={e => { e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.2)'; e.currentTarget.style.background='var(--surface)' }}
            >
              {playing
                ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ display:'block' }}>
                    <rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"/>
                    <rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"/>
                  </svg>
                : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ display:'block', marginLeft: 2 }}>
                    <polygon points="6,4 20,12 6,20" fill="currentColor"/>
                  </svg>
              }
            </button>
            <button className="ap-ctrl-btn ap-next"
              onClick={() => isMulti && chapIdx < chaps.length - 1 && loadAndPlayChapter(chapIdx + 1, true)}
              title="Next chapter">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <polygon points="5,5 15,12 5,19" fill="currentColor"/>
                <rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor"/>
              </svg>
            </button>
            <button className="ap-ctrl-btn ap-skip" onClick={() => skipBy(30)} title="Forward 30s">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 5V2l5 5-5 5V8a7 7 0 1 0 5.3 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <text x="18" y="16" fontSize="6" fill="currentColor" fontFamily="sans-serif" textAnchor="middle">30</text>
              </svg>
            </button>
            <button className="ap-ctrl-btn" title="Volume">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
                <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          {/* Volume slider */}
          <div className="ap-vol-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
            </svg>
            <input type="range" className="ap-vol-slider" min="0" max="1" step="0.02"
              value={volume} onChange={onVolChange}
              style={{ '--val': `${volume * 100}%` }} />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
              <path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>

        </main>
      </div>
      <audio ref={audioRef} preload="metadata" />
    </div>
  )
}