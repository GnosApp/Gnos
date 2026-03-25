import { useState, useEffect, useRef, useCallback } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { mkdir, exists, readDir, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import useAppStore from '@/store/useAppStore'
import { applyTheme } from '@/lib/themes'
import { resetBaseDir, loadLibrary, loadNotebooksMeta, loadSketchbooksMeta, getJSON, saveLibrary } from '@/lib/storage'

const STEPS = ['welcome', 'username', 'archive', 'theme', 'done']
const TOTAL_CIRCLES = STEPS.length - 1 // 4 — "done" has no circle of its own

const THEME_OPTIONS = [
  { key: 'sepia',  name: 'Sepia',  bg: '#f4efe6', surface: '#faf6ef', accent: '#8b5e3c', text: '#3b2f20', dim: '#7a6652', border: '#c8b89a', preview: ['#f4efe6','#faf6ef','#8b5e3c'] },
  { key: 'light',  name: 'Light',  bg: '#f6f8fa', surface: '#ffffff', accent: '#0969da', text: '#1f2328', dim: '#636c76', border: '#d0d7de', preview: ['#f6f8fa','#ffffff','#0969da'] },
  { key: 'moss',   name: 'Moss',   bg: '#f2f5ee', surface: '#f8faf5', accent: '#4a7c3f', text: '#2a3320', dim: '#5a7048', border: '#b8c9a8', preview: ['#f2f5ee','#f8faf5','#4a7c3f'] },
  { key: 'dark',   name: 'Dark',   bg: '#0d1117', surface: '#161b22', accent: '#388bfd', text: '#e6edf3', dim: '#8b949e', border: '#30363d', preview: ['#0d1117','#161b22','#388bfd'] },
  { key: 'cherry', name: 'Cherry', bg: '#0e0608', surface: '#170b0d', accent: '#e05c7a', text: '#f2dde1', dim: '#9e6d76', border: '#3d1a20', preview: ['#0e0608','#170b0d','#e05c7a'] },
  { key: 'sunset', name: 'Sunset', bg: '#0f0a04', surface: '#1a1008', accent: '#e8922a', text: '#f5e6c8', dim: '#a07840', border: '#4a3010', preview: ['#0f0a04','#1a1008','#e8922a'] },
]

// Circumference of r=9 circle. Checkmark path length.
const C  = 2 * Math.PI * 9  // ≈ 56.55
const CK = 15               // checkmark stroke length

// ─── Quill icon ───────────────────────────────────────────────────────────────
function QuillIcon({ accent = '#8b5e3c', size = 32, opacity = 0.4 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ opacity }}>
      <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M26 3C24 8 18 15 10 18" stroke={accent} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M26 3C25 6 22 10 16 14" stroke={accent} strokeWidth="0.8" strokeLinecap="round" opacity="0.35" />
      <path d="M6.5 28L9 23" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3 30h26" stroke={accent} strokeWidth="1.8" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

// ─── Fade + rise wrapper — entry animation only ───────────────────────────────
function FadeUp({ children, delay = 0, style = {} }) {
  const ref = useRef()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = 'translateY(14px)'
    const t = setTimeout(() => {
      el.style.transition = `opacity 0.48s ease ${delay}ms, transform 0.48s cubic-bezier(0.16,1,0.3,1) ${delay}ms`
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    }, 20)
    return () => clearTimeout(t)
  }, [delay])
  return <div ref={ref} style={style}>{children}</div>
}

// ─── Underline text input ─────────────────────────────────────────────────────
function AcademicInput({ value, onChange, onKeyDown, placeholder, autoFocus, label, palette }) {
  const [focused, setFocused] = useState(false)
  const accent = palette?.accent || '#8b5e3c'
  const text   = palette?.text   || '#3b2f20'
  const dim    = palette?.dim    || '#7a6652'
  const border = palette?.border || '#c8b89a'
  return (
    <div style={{ textAlign: 'left', marginBottom: 20 }}>
      {label && (
        <label style={{
          display: 'block', marginBottom: 7, fontSize: 10, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: dim,
          transition: 'color 0.3s',
        }}>{label}</label>
      )}
      <div style={{
        position: 'relative',
        borderBottom: `1.5px solid ${focused ? accent : border}`,
        transition: 'border-color 0.2s', paddingBottom: 2,
      }}>
        <input
          autoFocus={autoFocus} value={value}
          onChange={onChange} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={placeholder}
          style={{
            width: '100%', padding: '8px 0', fontSize: 17,
            fontFamily: 'Georgia, serif', background: 'transparent',
            border: 'none', outline: 'none', color: text,
            letterSpacing: '0.01em', boxSizing: 'border-box',
            transition: 'color 0.3s',
          }}
        />
        <div style={{
          position: 'absolute', bottom: -1.5, left: 0, height: 1.5,
          background: accent, width: focused ? '100%' : '0%',
          transition: 'width 0.28s ease, background 0.3s', borderRadius: 1,
        }} />
      </div>
    </div>
  )
}

// ─── Theme card ───────────────────────────────────────────────────────────────
function ThemeCard({ theme: t, selected, onClick, palette }) {
  const [hovered, setHovered] = useState(false)
  const [p0, p1, p2] = t.preview
  const accent = palette?.accent || '#8b5e3c'
  const text   = palette?.text   || '#3b2f20'
  const border = palette?.border || '#c8b89a'
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        width: '100%', padding: '11px 16px',
        background: selected ? `${accent}14` : hovered ? `${accent}08` : 'transparent',
        border: selected ? `1px solid ${accent}60` : '1px solid transparent',
        borderBottom: selected ? `1px solid ${accent}60` : `1px solid ${border}`,
        borderRadius: selected ? 8 : 0, cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.18s ease',
        transform: hovered && !selected ? 'translateX(3px)' : 'translateX(0)',
      }}
    >
      <div style={{
        width: 42, height: 28, borderRadius: 5, overflow: 'hidden', flexShrink: 0,
        border: '1px solid rgba(0,0,0,0.14)', display: 'grid', gridTemplateColumns: '1fr 1fr',
        boxShadow: '0 1px 4px rgba(0,0,0,0.16)',
      }}>
        <div style={{ background: p0, gridColumn: '1/3', height: '60%' }} />
        <div style={{ background: p1, height: '40%' }} />
        <div style={{ background: p2, height: '40%' }} />
      </div>
      <span style={{
        fontFamily: 'Georgia, serif', fontSize: 15, color: text,
        fontWeight: selected ? 600 : 400, flex: 1, transition: 'color 0.3s',
      }}>{t.name}</span>
      <div style={{
        width: 18, height: 18, borderRadius: '50%',
        background: selected ? accent : 'transparent',
        border: `1.5px solid ${selected ? accent : border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.2s ease', flexShrink: 0,
      }}>
        {selected && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </button>
  )
}

// ─── Corner bracket ───────────────────────────────────────────────────────────
function CornerBracket({ accent, style }) {
  return (
    <svg style={{ opacity: 0.16, pointerEvents: 'none', ...style }}
      width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M4 44 L4 4 L44 4" stroke={accent} strokeWidth="1.2" fill="none" />
      <path d="M4 4 L13 4 M4 4 L4 13" stroke={accent} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OnboardingView({ onComplete, devMode = false }) {
  const [step, setStep]             = useState(0)
  const [username, setUsernameVal]  = useState('')
  const [archiveMode, setArchiveMode] = useState('create') // 'create' | 'connect'
  const [archiveLocation, setArchiveLocation] = useState('')
  const [archiveName, setArchiveName] = useState('My Archive')
  const [existingArchivePath, setExistingArchivePath] = useState('')
  const [selectedTheme, setSelectedTheme] = useState('sepia')
  const [error, setError]           = useState('')
  const [creating, setCreating]     = useState(false)
  const [stepKey, setStepKey]       = useState(0)
  // { step, total, label, books, notebooks, sketchbooks } — shown during archive sync
  const [syncProgress, setSyncProgress] = useState(null)

  const palette = THEME_OPTIONS.find(t => t.key === selectedTheme) || THEME_OPTIONS[0]
  const { accent, text: txtCol, dim: dimCol, border: bdrCol, bg: bgCol } = palette

  const circDoms = useRef(Array.from({ length: TOTAL_CIRCLES }, () => ({})))
  const doneRef  = useRef(new Set())
  const pulseRafRef = useRef(null)   // current rAF id
  const pulseIdxRef = useRef(0)      // which circle is currently pulsing

  // Stop any running pulse and snap that halo back to rest
  const stopPulse = useCallback(() => {
    if (pulseRafRef.current) {
      cancelAnimationFrame(pulseRafRef.current)
      pulseRafRef.current = null
    }
  }, [])

  // Start pulsing halo on circle[idx] — pure JS, no CSS animation property
  const startPulse = useCallback((idx) => {
    stopPulse()
    pulseIdxRef.current = idx
    const d = circDoms.current[idx]
    if (!d?.halo) return

    // Instantly show this halo at base state
    d.halo.style.transition = 'none'
    d.halo.style.opacity    = '0.22'
    d.halo.style.transform  = 'scale(1)'

    const period = 2000 // ms per full cycle
    const start  = performance.now()

    const tick = (now) => {
      // If this circle got completed, stop immediately
      if (doneRef.current.has(idx)) return
      const el = circDoms.current[idx]?.halo
      if (!el) return

      const t = ((now - start) % period) / period   // 0→1 repeating
      // Sine wave: 0→peak→0. Scale 1→1.25, opacity 0.22→0.05
      const s = Math.sin(t * Math.PI)
      const scale   = 1 + s * 0.25
      const opacity = 0.22 - s * 0.17

      el.style.transform = `scale(${scale.toFixed(3)})`
      el.style.opacity   = opacity.toFixed(3)

      pulseRafRef.current = requestAnimationFrame(tick)
    }

    pulseRafRef.current = requestAnimationFrame(tick)
  }, [stopPulse])

  // Called once per step advance — animates circle[idx] from active→done
  const animateCircle = useCallback((idx) => {
    const d = circDoms.current[idx]
    if (!d) return

    // ── Stop the pulse and dissipate the halo outward ─────────────────────
    stopPulse()
    if (d.halo) {
      d.halo.style.transition = 'opacity 0.2s ease, transform 0.2s ease'
      d.halo.style.opacity    = '0'
      d.halo.style.transform  = 'scale(1.7)'
    }

    // ── Ring closes ───────────────────────────────────────────────────────
    if (d.ring) {
      d.ring.style.transition       = 'none'
      d.ring.style.strokeDashoffset = String(C)
      d.ring.style.stroke           = accent
      void d.ring.getBoundingClientRect()
      d.ring.style.transition       = `stroke-dashoffset 0.55s ease`
      d.ring.style.strokeDashoffset = '0'
    }

    // ── Fill blooms in ────────────────────────────────────────────────────
    if (d.fill) {
      d.fill.style.transition = 'none'
      d.fill.style.transform  = 'scale(0.4)'
      d.fill.style.opacity    = '0'
      void d.fill.getBoundingClientRect()
      setTimeout(() => {
        if (!d.fill) return
        d.fill.style.transition = `transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s ease`
        d.fill.style.transform  = 'scale(1)'
        d.fill.style.opacity    = '1'
      }, 160)
    }

    // ── Checkmark draws in ────────────────────────────────────────────────
    if (d.check) {
      d.check.style.transition       = 'none'
      d.check.style.strokeDashoffset = String(CK)
      void d.check.getBoundingClientRect()
      setTimeout(() => {
        if (!d.check) return
        d.check.style.transition       = `stroke-dashoffset 0.28s ease`
        d.check.style.strokeDashoffset = '0'
      }, 480)
    }

    doneRef.current.add(idx)

    // ── Start pulse on the next circle once check is done ─────────────────
    const nextIdx = idx + 1
    if (nextIdx < TOTAL_CIRCLES) {
      setTimeout(() => startPulse(nextIdx), 650)
    }
  }, [accent, stopPulse, startPulse])

  // Re-color connector lines and pending circles when palette changes
  useEffect(() => {
    circDoms.current.forEach((d, i) => {
      const isDone = doneRef.current.has(i)
      if (d.line) {
        d.line.style.background = isDone ? accent : bdrCol
        d.line.style.opacity    = isDone ? '0.55' : '0.22'
      }
      if (!isDone && d.ring) {
        d.ring.style.stroke = i === step ? accent : bdrCol
      }
      if (d.fill) {
        d.fill.style.fill = accent
      }
    })
  }, [accent, bdrCol, step])

  const setUsername           = useAppStore(s => s.setUsername)
  const setArchivePath        = useAppStore(s => s.setArchivePath)
  const setOnboardingComplete = useAppStore(s => s.setOnboardingComplete)
  const setTheme              = useAppStore(s => s.setTheme)
  const persistPreferences    = useAppStore(s => s.persistPreferences)
  const setLibraryStore       = useAppStore(s => s.setLibrary)
  const setNotebooksStore     = useAppStore(s => s.setNotebooks)
  const setSketchbooksStore   = useAppStore(s => s.setSketchbooks)
  const setFlashcardDecksStore = useAppStore(s => s.setFlashcardDecks)
  const setCollectionsStore   = useAppStore(s => s.setCollections)

  const currentStep = STEPS[step]
  const contentRef  = useRef(null)

  useEffect(() => { applyTheme('sepia') }, [])

  // Start pulsing circle 0 on mount; clean up rAF on unmount
  useEffect(() => {
    // Small delay so refs are populated after first render
    const t = setTimeout(() => startPulse(0), 50)
    return () => { clearTimeout(t); stopPulse() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function pickTheme(key) { setSelectedTheme(key); applyTheme(key) }

  // ── Step advance: animate circle → fade content → mount next step ─────────
  const advancingRef = useRef(false)
  function goNext() {
    if (advancingRef.current) return
    setError('')
    advancingRef.current = true
    const idx = step

    // 1. Animate the circle for this step (ring closes, fill blooms, check draws)
    animateCircle(idx)

    // 2. At ~650ms (check fully drawn) — smoothly fade+lift content out
    setTimeout(() => {
      if (contentRef.current) {
        contentRef.current.style.transition = 'opacity 0.2s ease, transform 0.2s ease'
        contentRef.current.style.opacity    = '0'
        contentRef.current.style.transform  = 'translateY(-8px)'
      }
    }, 650)

    // 3. At ~850ms — swap step; content wrapper resets for next FadeUp entry
    setTimeout(() => {
      if (contentRef.current) {
        contentRef.current.style.transition = 'none'
        contentRef.current.style.opacity    = '1'
        contentRef.current.style.transform  = 'none'
      }
      setStepKey(k => k + 1)
      setStep(s => s + 1)
      advancingRef.current = false
    }, 850)
  }

  function goBack() {
    setError('')
    setStepKey(k => k + 1)
    setStep(s => s - 1)
  }

  async function pickFolder() {
    if (devMode) return  // no file system access in dev preview
    try {
      const sel = await open({ directory: true, multiple: false, title: 'Choose Archive Location' })
      if (sel) setArchiveLocation(sel)
    } catch { setError('Could not open folder picker.') }
  }

  async function pickExistingArchive() {
    if (devMode) return
    try {
      const sel = await open({ directory: true, multiple: false, title: 'Select Existing Archive Folder' })
      if (sel) setExistingArchivePath(sel)
    } catch { setError('Could not open folder picker.') }
  }

  async function createArchive() {
    if (devMode) { goNext(); return }  // skip all filesystem work in dev preview
    if (!archiveLocation) { setError('Please choose a location for your Archive.'); return }
    if (!archiveName.trim()) { setError('Please enter a name for your Archive.'); return }
    setCreating(true); setError('')
    try {
      const archivePath = await join(archiveLocation, archiveName.trim())
      for (const sub of ['books', 'notebooks', 'sketches', 'audio']) {
        const subPath = await join(archivePath, sub)
        if (!(await exists(subPath))) await mkdir(subPath, { recursive: true })
      }
      setArchivePath(archivePath)
      goNext()
    } catch (e) {
      setError('Failed to create Archive: ' + e.message)
    } finally { setCreating(false) }
  }

  async function connectArchive() {
    if (devMode) { goNext(); return }
    if (!existingArchivePath) { setError('Please select your existing Archive folder.'); return }
    setCreating(true); setError('')
    setSyncProgress({ step: 0, total: 6, label: 'Connecting to archive…', books: 0, notebooks: 0, sketchbooks: 0 })

    try {
      // Point storage at the new path immediately so all storage calls use it
      setArchivePath(existingArchivePath)
      resetBaseDir()

      // Step 1: Ensure expected subdirs exist
      setSyncProgress(p => ({ ...p, step: 1, label: 'Checking folder structure…' }))
      for (const sub of ['books', 'notebooks', 'sketches', 'audio']) {
        const subPath = await join(existingArchivePath, sub)
        if (!(await exists(subPath))) await mkdir(subPath, { recursive: true })
      }

      // Step 2: Load library index, then scan books/ for any unindexed entries
      setSyncProgress(p => ({ ...p, step: 2, label: 'Scanning books…' }))
      let library = await loadLibrary()
      const indexedIds = new Set(library.map(b => b.id))
      const booksDir = await join(existingArchivePath, 'books')
      if (await exists(booksDir)) {
        const entries = await readDir(booksDir)
        for (const entry of entries) {
          if (!entry.name) continue
          try {
            const metaPath = await join(booksDir, entry.name, 'meta.json')
            if (await exists(metaPath)) {
              const meta = JSON.parse(await readTextFile(metaPath))
              if (meta.id && !indexedIds.has(meta.id)) {
                library = [...library, meta]
                indexedIds.add(meta.id)
              }
            }
          } catch { /* skip corrupt entries */ }
        }
      }
      setSyncProgress(p => ({ ...p, books: library.length }))

      // Step 3: Load notebooks
      setSyncProgress(p => ({ ...p, step: 3, label: 'Loading notebooks…' }))
      const notebooks = await loadNotebooksMeta()
      setSyncProgress(p => ({ ...p, notebooks: notebooks.length }))

      // Step 4: Load sketchbooks
      setSyncProgress(p => ({ ...p, step: 4, label: 'Loading sketchbooks…' }))
      const sketchbooks = await loadSketchbooksMeta()
      setSyncProgress(p => ({ ...p, sketchbooks: sketchbooks.length }))

      // Step 5: Load flashcard decks + collections
      setSyncProgress(p => ({ ...p, step: 5, label: 'Loading collections…' }))
      const flashcardDecks = await getJSON('flashcard_decks', [])
      const collections = await getJSON('collections_meta', [])

      // Step 6: Populate store + persist updated library index
      setSyncProgress(p => ({ ...p, step: 6, label: 'Sync complete!' }))
      setLibraryStore(library)
      setNotebooksStore(notebooks)
      setSketchbooksStore(sketchbooks)
      setFlashcardDecksStore(flashcardDecks)
      setCollectionsStore(collections)
      if (library.length > 0) await saveLibrary(library)

      await new Promise(r => setTimeout(r, 800))
      setSyncProgress(null)
      goNext()
    } catch (e) {
      setError('Failed to connect Archive: ' + e.message)
      setSyncProgress(null)
    } finally { setCreating(false) }
  }

  async function finish() {
    if (devMode) { onComplete(); return }  // skip all store writes in dev preview
    setUsername(username.trim() || 'Reader')
    setTheme(selectedTheme)
    setOnboardingComplete(true)
    await persistPreferences()  // writes app_prefs.json + archive_path.json pointer
    resetBaseDir()              // clear path cache only AFTER saving
    onComplete()
  }

  function nextStep() {
    setError('')
    if (currentStep === 'username' && !username.trim()) {
      setError('Please enter your name.'); return
    }
    goNext()
  }

  // ── Buttons ────────────────────────────────────────────────────────────────
  const btnPrimary = {
    padding: '11px 32px', fontSize: 14, fontWeight: 600,
    fontFamily: 'Georgia, serif', letterSpacing: '0.04em',
    background: accent, border: `1px solid ${accent}cc`,
    borderRadius: 6, color: '#fff', cursor: 'pointer',
    transition: 'filter 0.15s, box-shadow 0.15s',
    boxShadow: `0 2px 10px ${accent}40`,
  }
  const btnSecondary = {
    padding: '11px 24px', fontSize: 14, fontWeight: 500,
    fontFamily: 'Georgia, serif', letterSpacing: '0.02em',
    background: 'transparent', border: `1px solid ${bdrCol}`,
    borderRadius: 6, color: dimCol, cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
  }

  // ── Inline shared sub-components ──────────────────────────────────────────
  const StepLabel = ({ n }) => (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: dimCol, marginBottom: 10,
      transition: 'color 0.3s',
    }}>Step {n}</div>
  )
  const Heading = ({ children }) => (
    <h2 style={{
      fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700,
      color: txtCol, margin: 0, lineHeight: 1.25, transition: 'color 0.3s',
    }}>{children}</h2>
  )
  const Sub = ({ children }) => (
    <p style={{
      fontFamily: 'Georgia, serif', fontSize: 13, color: dimCol,
      marginTop: 8, lineHeight: 1.65, fontStyle: 'italic', transition: 'color 0.3s',
    }}>{children}</p>
  )
  const Divider = () => (
    <div style={{
      width: 36, height: 1.5, background: accent, opacity: 0.55, borderRadius: 1,
      margin: '14px auto 18px', transition: 'background 0.3s',
    }} />
  )
  const ErrorLine = () => error ? (
    <p style={{ color: '#d9534f', fontSize: 12, marginBottom: 8, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{error}</p>
  ) : null

  const ruleOpacity = (selectedTheme === 'sepia' || selectedTheme === 'light' || selectedTheme === 'moss') ? 0.05 : 0.03

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: bgCol, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.4s ease',
    }}>

      {/* Ruled paper lines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: `repeating-linear-gradient(transparent, transparent 27px, ${accent} 28px)`,
        backgroundSize: '100% 28px', opacity: ruleOpacity,
        transition: 'opacity 0.35s',
      }} />

      {/* Corner brackets — top-right, bottom-left */}
      <CornerBracket accent={accent} style={{ position: 'absolute', top: 18, right: 22, transform: 'scaleX(-1)' }} />
      <CornerBracket accent={accent} style={{ position: 'absolute', bottom: 18, left: 22, transform: 'scaleY(-1)' }} />

      {/* ── Step circles — permanently mounted, never re-rendered by step changes ── */}
      {/* They sit outside contentRef so typing/re-renders never touch them */}
      <div style={{
        position: 'absolute', bottom: 52, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2, pointerEvents: 'none',
      }}>
        {Array.from({ length: TOTAL_CIRCLES }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Connector line */}
            {i > 0 && (
              <div
                ref={el => { if (el) circDoms.current[i].line = el }}
                style={{
                  width: 30, height: 1.5, borderRadius: 1,
                  background: bdrCol, opacity: 0.22,
                  transition: 'background 0.4s ease, opacity 0.4s ease',
                }}
              />
            )}

            {/* SVG circle — purely DOM, no React animation logic */}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
              style={{ overflow: 'visible', flexShrink: 0 }}>

              {/* Pulsing halo — driven by rAF in JS, not CSS animation */}
              <circle
                ref={el => {
                  if (el) {
                    circDoms.current[i].halo = el
                    el.style.opacity   = '0'
                    el.style.transform = 'scale(1)'
                    el.style.transformOrigin = '12px 12px'
                  }
                }}
                cx="12" cy="12" r="11.5"
                stroke={accent} strokeWidth="1.2" fill="none"
              />

              {/* Filled background — starts invisible, blooms in during animation */}
              <circle
                ref={el => {
                  if (el) {
                    circDoms.current[i].fill = el
                    el.style.transformOrigin = '12px 12px'
                    // Already-done circles (e.g. on back-navigation) show filled immediately
                    if (doneRef.current.has(i)) {
                      el.style.opacity   = '1'
                      el.style.transform = 'scale(1)'
                      el.style.fill      = accent
                    } else {
                      el.style.opacity   = '0'
                      el.style.transform = 'scale(0.4)'
                      el.style.fill      = accent
                    }
                  }
                }}
                cx="12" cy="12" r="9"
              />

              {/* Ring stroke — rotated so it draws clockwise from top */}
              <circle
                ref={el => {
                  if (el) {
                    circDoms.current[i].ring = el
                    // Done circles: full opaque ring
                    if (doneRef.current.has(i)) {
                      el.style.stroke           = accent
                      el.style.strokeDashoffset = '0'
                      el.style.strokeOpacity    = '1'
                    } else {
                      el.style.stroke           = i === step ? accent : bdrCol
                      el.style.strokeDashoffset = '0'  // start as full outline ring for pending/active
                      el.style.strokeOpacity    = i === step ? '0.9' : '0.28'
                    }
                  }
                }}
                cx="12" cy="12" r="9"
                fill="none" strokeWidth="1.4"
                style={{
                  strokeDasharray: C,
                  transform: 'rotate(-90deg)',
                  transformOrigin: '12px 12px',
                  transition: 'stroke 0.3s ease, stroke-opacity 0.3s ease',
                }}
              />

              {/* Checkmark — always in DOM, dashoffset hides/shows it */}
              <path
                ref={el => {
                  if (el) {
                    circDoms.current[i].check = el
                    el.style.strokeDashoffset = doneRef.current.has(i) ? '0' : String(CK)
                    el.style.opacity          = '1'
                  }
                }}
                d="M7.5 12 L10.5 15 L16.5 9"
                stroke="#fff" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: CK }}
              />

            </svg>
          </div>
        ))}
      </div>

      {/* ── Step content — only this div fades/swaps ── */}
      <div
        ref={contentRef}
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: 460,
          padding: '0 40px',
          boxSizing: 'border-box',
        }}
      >

        {/* ══ WELCOME ══ */}
        {currentStep === 'welcome' && (
          <div key={`welcome-${stepKey}`} style={{ textAlign: 'center' }}>
            <FadeUp delay={0}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <QuillIcon accent={accent} size={34} opacity={0.42} />
              </div>
              <div style={{
                fontFamily: 'Georgia, serif', fontSize: 60, fontWeight: 700,
                letterSpacing: '-1.5px', color: txtCol, lineHeight: 1,
                transition: 'color 0.3s',
              }}>Gnos</div>
              <Divider />
              <p style={{
                fontFamily: 'Georgia, serif', fontSize: 16, color: dimCol,
                lineHeight: 1.75, marginBottom: 4, fontStyle: 'italic',
                transition: 'color 0.3s',
              }}>Your personal reading space.</p>
              <p style={{
                fontFamily: 'Georgia, serif', fontSize: 13, color: dimCol,
                lineHeight: 1.7, marginBottom: 48, opacity: 0.75,
                transition: 'color 0.3s',
              }}>Books, audio, notes, sketches — privately archived just for you.</p>
              <button style={btnPrimary}
                onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.87)'}
                onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
                onClick={nextStep}>Begin</button>
            </FadeUp>
          </div>
        )}

        {/* ══ USERNAME ══ */}
        {currentStep === 'username' && (
          <div key={`username-${stepKey}`}>
            <FadeUp delay={0}>
              <StepLabel n={1} />
              <Heading>What should we call you?</Heading>
              <Sub>This shows in your profile — just for you.</Sub>
            </FadeUp>
            <FadeUp delay={90} style={{ marginTop: 28 }}>
              <AcademicInput
                autoFocus value={username}
                onChange={e => setUsernameVal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && nextStep()}
                placeholder="Your name…" palette={palette}
              />
              <ErrorLine />
              <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
                <button style={btnSecondary}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = txtCol }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = bdrCol; e.currentTarget.style.color = dimCol }}
                  onClick={goBack}>Back</button>
                <button style={{ ...btnPrimary, flex: 1 }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.87)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
                  onClick={nextStep}>Continue</button>
              </div>
            </FadeUp>
          </div>
        )}

        {/* ══ ARCHIVE ══ */}
        {currentStep === 'archive' && (
          <div key={`archive-${stepKey}`}>
            <FadeUp delay={0}>
              <StepLabel n={2} />
              <Heading>{archiveMode === 'create' ? 'Create your Archive' : 'Connect your Archive'}</Heading>
              <Sub>{archiveMode === 'create' ? 'A folder on your Mac where books, notes, and sketches live.' : 'Point Gnos to an existing Archive folder.'}</Sub>
            </FadeUp>
            <FadeUp delay={70} style={{ marginTop: 20 }}>
              {/* Mode toggle */}
              <div style={{
                display: 'flex', gap: 6, marginBottom: 22,
                background: `${accent}08`, borderRadius: 8, padding: 4,
                border: `1px solid ${bdrCol}`,
              }}>
                {[['create', 'New Archive'], ['connect', 'Existing Archive']].map(([mode, label]) => (
                  <button key={mode} onClick={() => { setArchiveMode(mode); setError('') }} style={{
                    flex: 1, padding: '7px 10px', fontSize: 12, fontWeight: 600,
                    fontFamily: 'Georgia, serif', letterSpacing: '0.02em',
                    background: archiveMode === mode ? accent : 'transparent',
                    border: 'none', borderRadius: 5,
                    color: archiveMode === mode ? '#fff' : dimCol,
                    cursor: 'pointer', transition: 'all 0.18s ease',
                  }}>{label}</button>
                ))}
              </div>

              {archiveMode === 'create' ? (<>
                <AcademicInput
                  label="Archive name" value={archiveName}
                  onChange={e => setArchiveName(e.target.value)}
                  placeholder="My Archive" palette={palette}
                />
                {devMode ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8, marginBottom: 20,
                    background: `${accent}0a`, border: `1px dashed ${bdrCol}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 16 }}>🧪</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: txtCol }}>Dev preview — no folder needed</div>
                      <div style={{ fontSize: 11, color: dimCol, marginTop: 2 }}>Click Continue to proceed without creating any files.</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'left', marginBottom: 20 }}>
                    <label style={{
                      display: 'block', marginBottom: 7, fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.12em', textTransform: 'uppercase', color: dimCol,
                      transition: 'color 0.3s',
                    }}>Location</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{
                        flex: 1, padding: '9px 12px', fontSize: 13, fontFamily: 'monospace',
                        background: `${accent}09`, border: `1px solid ${bdrCol}`, borderRadius: 6,
                        color: archiveLocation ? txtCol : dimCol,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        transition: 'all 0.3s',
                      }}>{archiveLocation || 'No location chosen'}</div>
                      <button onClick={pickFolder} style={{
                        padding: '9px 14px', fontSize: 13, background: 'transparent',
                        border: `1px solid ${bdrCol}`, borderRadius: 6, color: txtCol,
                        cursor: 'pointer', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = `${accent}12` }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = bdrCol; e.currentTarget.style.background = 'transparent' }}
                      >Choose…</button>
                    </div>
                    {archiveLocation && (
                      <div style={{
                        marginTop: 8, padding: '7px 10px',
                        background: `${accent}08`, border: `1px solid ${accent}20`,
                        borderRadius: 5, fontSize: 11.5, color: dimCol, fontFamily: 'monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{archiveLocation}/{archiveName}</div>
                    )}
                  </div>
                )}
              </>) : (<>
                {/* ── Sync progress overlay ───────────────────────────── */}
                {syncProgress ? (
                  <div style={{
                    padding: '20px 16px', borderRadius: 10, marginBottom: 20,
                    background: `${accent}08`, border: `1px solid ${accent}25`,
                  }}>
                    <div style={{
                      height: 5, borderRadius: 3, background: `${accent}18`,
                      overflow: 'hidden', marginBottom: 14,
                    }}>
                      <div style={{
                        height: '100%', borderRadius: 3, background: accent,
                        width: `${Math.round((syncProgress.step / syncProgress.total) * 100)}%`,
                        transition: 'width 0.4s cubic-bezier(0.4,0,0.2,1)',
                        boxShadow: `0 0 8px ${accent}60`,
                      }} />
                    </div>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: txtCol, marginBottom: 6,
                      fontFamily: 'Georgia, serif', transition: 'color 0.3s',
                    }}>{syncProgress.label}</div>
                    {(syncProgress.books > 0 || syncProgress.notebooks > 0 || syncProgress.sketchbooks > 0) && (
                      <div style={{
                        display: 'flex', gap: 12, flexWrap: 'wrap',
                        fontSize: 11, color: dimCol, fontFamily: 'Georgia, serif',
                        fontStyle: 'italic', transition: 'color 0.3s',
                      }}>
                        {syncProgress.books > 0 && <span>{syncProgress.books} book{syncProgress.books !== 1 ? 's' : ''}</span>}
                        {syncProgress.notebooks > 0 && <span>{syncProgress.notebooks} notebook{syncProgress.notebooks !== 1 ? 's' : ''}</span>}
                        {syncProgress.sketchbooks > 0 && <span>{syncProgress.sketchbooks} sketchbook{syncProgress.sketchbooks !== 1 ? 's' : ''}</span>}
                      </div>
                    )}
                  </div>
                ) : devMode ? (
                  <div style={{
                    padding: '12px 14px', borderRadius: 8, marginBottom: 20,
                    background: `${accent}0a`, border: `1px dashed ${bdrCol}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{ fontSize: 16 }}>🧪</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: txtCol }}>Dev preview — no folder needed</div>
                      <div style={{ fontSize: 11, color: dimCol, marginTop: 2 }}>Click Continue to proceed without creating any files.</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'left', marginBottom: 20 }}>
                    <label style={{
                      display: 'block', marginBottom: 7, fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.12em', textTransform: 'uppercase', color: dimCol,
                      transition: 'color 0.3s',
                    }}>Archive folder</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{
                        flex: 1, padding: '9px 12px', fontSize: 13, fontFamily: 'monospace',
                        background: `${accent}09`, border: `1px solid ${bdrCol}`, borderRadius: 6,
                        color: existingArchivePath ? txtCol : dimCol,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        transition: 'all 0.3s',
                      }}>{existingArchivePath || 'No folder selected'}</div>
                      <button onClick={pickExistingArchive} style={{
                        padding: '9px 14px', fontSize: 13, background: 'transparent',
                        border: `1px solid ${bdrCol}`, borderRadius: 6, color: txtCol,
                        cursor: 'pointer', fontFamily: 'Georgia, serif', whiteSpace: 'nowrap',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.background = `${accent}12` }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = bdrCol; e.currentTarget.style.background = 'transparent' }}
                      >Browse…</button>
                    </div>
                    {existingArchivePath && (
                      <div style={{
                        marginTop: 8, padding: '7px 10px',
                        background: `${accent}08`, border: `1px solid ${accent}20`,
                        borderRadius: 5, fontSize: 11, color: dimCol, fontStyle: 'italic',
                        fontFamily: 'Georgia, serif',
                      }}>Any missing subfolders will be created automatically.</div>
                    )}
                  </div>
                )}
              </>)}

              <ErrorLine />
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button style={{ ...btnSecondary, opacity: syncProgress ? 0.4 : 1, pointerEvents: syncProgress ? 'none' : 'auto' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = txtCol }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = bdrCol; e.currentTarget.style.color = dimCol }}
                  onClick={goBack}>Back</button>
                <button style={{ ...btnPrimary, flex: 1, opacity: creating ? 0.65 : 1 }}
                  onMouseEnter={e => { if (!creating) e.currentTarget.style.filter = 'brightness(0.87)' }}
                  onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
                  onClick={archiveMode === 'create' ? createArchive : connectArchive}
                  disabled={creating}>
                  {syncProgress
                    ? 'Syncing…'
                    : creating
                      ? (archiveMode === 'create' ? 'Creating…' : 'Connecting…')
                      : (archiveMode === 'create' ? 'Create Archive' : 'Connect Archive')}
                </button>
              </div>
            </FadeUp>
          </div>
        )}

        {/* ══ THEME ══ */}
        {currentStep === 'theme' && (
          <div key={`theme-${stepKey}`}>
            <FadeUp delay={0}>
              <StepLabel n={3} />
              <Heading>Choose your theme</Heading>
              <Sub>You can always change this in settings.</Sub>
            </FadeUp>
            <FadeUp delay={80} style={{ marginTop: 20 }}>
              <div style={{
                borderTop: `1px solid ${bdrCol}`, borderBottom: `1px solid ${bdrCol}`,
                marginBottom: 22, transition: 'border-color 0.3s',
              }}>
                {THEME_OPTIONS.map(t => (
                  <ThemeCard key={t.key} theme={t}
                    selected={selectedTheme === t.key}
                    onClick={() => pickTheme(t.key)}
                    palette={palette} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={btnSecondary}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.color = txtCol }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = bdrCol; e.currentTarget.style.color = dimCol }}
                  onClick={goBack}>Back</button>
                <button style={{ ...btnPrimary, flex: 1 }}
                  onMouseEnter={e => e.currentTarget.style.filter = 'brightness(0.87)'}
                  onMouseLeave={e => e.currentTarget.style.filter = 'brightness(1)'}
                  onClick={nextStep}>Continue</button>
              </div>
            </FadeUp>
          </div>
        )}

        {/* ══ DONE ══ */}
        {currentStep === 'done' && (
          <div key={`done-${stepKey}`} style={{ textAlign: 'center' }}>
            <FadeUp delay={0}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                border: `2px solid ${accent}45`, background: `${accent}0e`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 28px',
                animation: 'ob-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards',
              }}>
                <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                  <circle cx="17" cy="17" r="14"
                    stroke={accent} strokeWidth="1.4" fill="none" strokeOpacity="0.3"
                    style={{ strokeDasharray: 88, strokeDashoffset: 88, animation: 'ob-ring-in 0.5s ease 0.05s forwards' }}
                  />
                  <path d="M10 17 L15 22 L24 11"
                    stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ strokeDasharray: 25, strokeDashoffset: 25, animation: 'ob-draw-check 0.38s ease 0.32s forwards' }}
                  />
                </svg>
              </div>
            </FadeUp>
            <FadeUp delay={130}>
              <h2 style={{
                fontFamily: 'Georgia, serif', fontSize: 26, fontWeight: 700,
                color: txtCol, marginBottom: 10, transition: 'color 0.3s',
              }}>All set{username ? `, ${username}` : ''}.</h2>
            </FadeUp>
            <FadeUp delay={210}>
              <p style={{
                fontFamily: 'Georgia, serif', fontSize: 14, color: dimCol,
                lineHeight: 1.75, fontStyle: 'italic', marginBottom: 10,
                transition: 'color 0.3s',
              }}>Your Archive is ready. Start by importing a book<br />or creating a notebook.</p>
            </FadeUp>
            <FadeUp delay={280}>
              <p style={{
                fontSize: 11, color: dimCol, opacity: 0.5, marginBottom: 38,
                fontFamily: 'monospace', transition: 'color 0.3s',
              }}>{useAppStore.getState().archivePath}</p>
            </FadeUp>
            <FadeUp delay={360}>
              <button style={{ ...btnPrimary, padding: '12px 48px' }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.87)'; e.currentTarget.style.boxShadow = `0 4px 18px ${accent}55` }}
                onMouseLeave={e => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.boxShadow = `0 2px 10px ${accent}40` }}
                onClick={finish}>Open Gnos</button>
            </FadeUp>
          </div>
        )}
      </div>

      <style>{`
        @keyframes ob-pop {
          from { transform: scale(0.55); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes ob-ring-in {
          to { stroke-dashoffset: 0; }
        }
        @keyframes ob-draw-check {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}