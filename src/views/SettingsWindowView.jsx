import { useEffect, useRef, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadArchivePointer, loadPreferences, loadLibrary, getPluginsDir } from '@/lib/storage'
import { applyTheme, BUILT_IN_THEMES } from '@/lib/themes'
import { SYNTAX_SUBTABS, SYNTAX_SECTIONS } from '@/lib/markdownSyntaxRef'
import { Toggle, Select } from '@/components/Controls'

// ─────────────────────────────────────────────────────────────────────────────
// SettingsWindowView — dedicated macOS-style settings window (label "settings").
// Left sidebar of categories, right pane of grouped rows, like System Settings.
// Every change persists to the prefs file and emits `gnos:prefs-updated`, which
// the main window listens to and re-applies live.
// ─────────────────────────────────────────────────────────────────────────────

async function broadcast() {
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('gnos:prefs-updated')
  } catch { /* not in tauri */ }
}

const SECTIONS = [
  { id: 'general',    label: 'General',    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> },
  { id: 'appearance', label: 'Appearance', icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.8v12.4A6.2 6.2 0 0 0 8 1.8z" fill="currentColor" opacity="0.5"/></svg> },
  { id: 'reader',     label: 'Reader',     icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2H8v12H3.5A1.5 1.5 0 0 1 2 12.5v-9zM14 3.5A1.5 1.5 0 0 0 12.5 2H8v12h4.5a1.5 1.5 0 0 0 1.5-1.5v-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
  { id: 'notebook',   label: 'Notebook',   icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><line x1="5.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5.5" y1="8" x2="10.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5.5" y1="11" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
  { id: 'quicknote',  label: 'Quick Note', icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.3"/><line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg> },
  { id: 'audio',      label: 'Audio',      icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 6h2.5L8.5 2.5v11L5 10H2.5V6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M11 5c.9.8 1.4 1.8 1.4 3s-.5 2.2-1.4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
  { id: 'calendar',   label: 'Calendar',   icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><line x1="5" y1="1.5" x2="5" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="11" y1="1.5" x2="11" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.3"/></svg> },
  { id: 'archive',    label: 'Archive',    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.8 1.8h5.6a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
  { id: 'plugins',    label: 'Plugins',    icon: <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 2v3H3a1 1 0 0 0-1 1v3h3a2 2 0 1 1 0 4h11-8v-3h3V7a1 1 0 0 0-1-1H7V3a2 2 0 1 0-4 0" stroke="currentColor" strokeWidth="0"/><rect x="2.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6.5 5.5V3.8a1.3 1.3 0 1 1 2.6 0v1.7M10.5 9.5h1.7a1.3 1.3 0 1 1 0 2.6h-1.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg> },
]

function Row({ label, desc, children, last }) {
  return (
    <div className={`sw-row${last ? ' sw-row-last' : ''}`}>
      <div className="sw-row-text">
        <div className="sw-row-label">{label}</div>
        {desc && <div className="sw-row-desc">{desc}</div>}
      </div>
      <div className="sw-row-ctrl">{children}</div>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div className="sw-group-wrap">
      {title && <div className="sw-group-title">{title}</div>}
      <div className="sw-group">{children}</div>
    </div>
  )
}

function Stepper({ value, onChange, min, max, step = 1, suffix = '' }) {
  return (
    <div className="sw-stepper">
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}>−</button>
      <span>{value}{suffix}</span>
      <button onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}>+</button>
    </div>
  )
}

// ── Quick Note size preview ────────────────────────────────────────────────
// A scaled-down "example window" the size lives in — drag its corner handle
// to resize (snapped to 10px), or use the steppers below for exact values.
// Drag updates the preview live; the real popup + prefs only commit on release
// (and on every stepper click) via onCommit.
const QN_MIN = { width: 280, height: 240 }
const QN_MAX = { width: 900, height: 1000 }
const QN_PREVIEW_SCALE = 0.26

function QuickNoteSizePreview({ width, height, onCommit }) {
  const [draft, setDraft] = useState(null) // { width, height } while actively dragging — visual only
  const dragState = useRef(null)
  const draftRef = useRef(null)
  const onCommitRef = useRef(onCommit)
  useEffect(() => { onCommitRef.current = onCommit }, [onCommit])

  const w = draft?.width ?? width
  const h = draft?.height ?? height

  // Attached once — reads live values via refs instead of re-subscribing on
  // every pointermove (which fires dozens of times per second while dragging).
  useEffect(() => {
    function onMove(e) {
      const d = dragState.current
      if (!d) return
      const nw = Math.min(QN_MAX.width, Math.max(QN_MIN.width, Math.round((d.startW + (e.clientX - d.startX) / QN_PREVIEW_SCALE) / 10) * 10))
      const nh = Math.min(QN_MAX.height, Math.max(QN_MIN.height, Math.round((d.startH + (e.clientY - d.startY) / QN_PREVIEW_SCALE) / 10) * 10))
      draftRef.current = { width: nw, height: nh }
      setDraft(draftRef.current)
    }
    function onUp() {
      if (dragState.current && draftRef.current) onCommitRef.current(draftRef.current)
      dragState.current = null
      draftRef.current = null
      setDraft(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function onHandleDown(e) {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startY: e.clientY, startW: width, startH: height }
    draftRef.current = { width, height }
    setDraft(draftRef.current)
  }

  return (
    <div className="sw-qn-preview">
      <div className="sw-qn-preview-stage">
        <div className="sw-qn-preview-box" style={{ width: w * QN_PREVIEW_SCALE, height: h * QN_PREVIEW_SCALE }}>
          <span className="sw-qn-preview-dims">{w} × {h}</span>
          <div className="sw-qn-preview-handle" onPointerDown={onHandleDown} title="Drag to resize">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M8 1v3M8 8H5M8 8L1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
      </div>
      <div className="sw-qn-preview-steppers">
        <Stepper value={w} min={QN_MIN.width} max={QN_MAX.width} step={10} suffix="w" onChange={width => onCommit({ width, height: h })} />
        <Stepper value={h} min={QN_MIN.height} max={QN_MAX.height} step={10} suffix="h" onChange={height => onCommit({ width: w, height })} />
      </div>
    </div>
  )
}

export default function SettingsWindowView() {
  const [section, setSection] = useState('general')
  const [ready, setReady] = useState(false)
  const [plugins, setPlugins] = useState([])
  const [syntaxTab, setSyntaxTab] = useState('formatting')

  const s = useAppStore()

  function pref(key, value) {
    useAppStore.setState({ [key]: value })
    useAppStore.getState().persistPreferences().then(broadcast)
  }

  function setTheme(key) {
    const { customThemes } = useAppStore.getState()
    useAppStore.setState({ themeKey: key })
    applyTheme(key, customThemes)
    useAppStore.getState().persistPreferences().then(broadcast)
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function boot() {
      try {
        const archivePath = await loadArchivePointer()
        if (archivePath) useAppStore.setState({ archivePath })
        const prefs = await loadPreferences()
        if (prefs) {
          useAppStore.setState(prefs)
          applyTheme(prefs.themeKey || 'dark', prefs.customThemes || {})
        } else {
          applyTheme('dark')
        }
      } catch (e) { console.warn('[Settings] boot failed:', e) }
      setReady(true)
    }
    boot()
    document.body.style.background = 'var(--bg)'
  }, [])

  // Load community plugin manifests when the Plugins section opens
  useEffect(() => {
    if (section !== 'plugins') return
    async function load() {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const dir = await getPluginsDir()
        const list = await invoke('plugin_list', { pluginsDir: dir })
        setPlugins(list || [])
      } catch { setPlugins([]) }
    }
    load()
  }, [section])

  function setQuickNoteSize(patch) {
    const next = { width: 400, height: 540, ...(s.quickNoteSize || {}), ...patch }
    pref('quickNoteSize', next)
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('quick_note_set_size', { width: next.width, height: next.height, show: false })
    ).catch(() => {}) // not in tauri, or popup isn't open — command no-ops either way
  }

  async function pickQuickNoteDir() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const sel = await open({ directory: true, multiple: false, title: 'Quick Note Folder' })
      if (sel) pref('quickNoteDir', sel)
    } catch (e) { console.error('folder pick failed:', e) }
  }

  async function switchArchive() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const sel = await open({ directory: true, multiple: false, title: 'Select Archive Folder' })
      if (!sel) return
      pref('archivePath', sel) // persist + broadcast — the main window reloads its data
    } catch (e) { console.error('archive switch failed:', e) }
  }

  async function exportLibrary() {
    try {
      const library = await loadLibrary()
      const blob = new Blob([JSON.stringify({ _readme: 'Gnos Archive', books: library }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), { href: url, download: 'gnos-library.json' }).click()
      URL.revokeObjectURL(url)
    } catch (e) { console.error('export failed:', e) }
  }

  const allThemes = { ...BUILT_IN_THEMES, ...(s.customThemes || {}) }

  if (!ready) return <div style={{ height: '100vh', background: 'var(--bg)' }} />

  return (
    <div className="sw-root">
      <style>{SW_CSS}</style>

      {/* Drag strip under the overlay traffic lights */}
      <div className="sw-drag" data-tauri-drag-region />

      {/* Sidebar */}
      <aside className="sw-side">
        <div className="sw-side-head">Settings</div>
        {SECTIONS.map(sec => (
          <button
            key={sec.id}
            className={`sw-side-item${section === sec.id ? ' active' : ''}`}
            onClick={() => setSection(sec.id)}
          >
            <span className="sw-side-icon">{sec.icon}</span>
            {sec.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <main className="sw-main">
        <div className="sw-main-title">{SECTIONS.find(x => x.id === section)?.label}</div>

        {section === 'general' && (
          <>
            <Group title="Profile">
              <Row label="Name" desc="Shown on your library profile" last>
                <input
                  className="sw-input"
                  value={s.username || ''}
                  placeholder="Your name"
                  onChange={e => useAppStore.setState({ username: e.target.value })}
                  onBlur={e => pref('username', e.target.value)}
                />
              </Row>
            </Group>
            <Group title="Layout">
              <Row label="Sidebar always visible" desc="Keep the sidebar pinned like a native app. Off = floating sidebar that hides.">
                <Toggle on={!!s.sidebarPinned} onChange={() => pref('sidebarPinned', !s.sidebarPinned)} />
              </Row>
              <Row label="Open on create" desc="Open new notebooks, sketchbooks, and decks right away" last>
                <Toggle on={s.openOnCreate !== false} onChange={() => pref('openOnCreate', s.openOnCreate === false)} />
              </Row>
            </Group>
          </>
        )}

        {section === 'quicknote' && (
          <>
            <Group title="Quick Note">
              <Row label="Summon shortcut" desc="Works anywhere, even when Gnos is in the background">
                <span className="sw-kbd">⌥ N</span>
              </Row>
              <Row label="Save location" desc={s.quickNoteDir || 'Archive (saved as notebooks)'} last>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sw-btn" onClick={pickQuickNoteDir}>Choose Folder…</button>
                  {s.quickNoteDir && <button className="sw-btn" onClick={() => pref('quickNoteDir', '')}>Use Archive</button>}
                </div>
              </Row>
            </Group>
            <Group title="Appearance">
              <Row label="Show fanned card peek" desc="Stacked cards peeking behind the active note" last>
                <Toggle on={s.quickNoteFanEnabled !== false} onChange={() => pref('quickNoteFanEnabled', s.quickNoteFanEnabled === false)} />
              </Row>
            </Group>
            <Group title="Window size">
              <div className="sw-qn-size-block">
                <div className="sw-row-text">
                  <div className="sw-row-label">Drag the corner to resize</div>
                  <div className="sw-row-desc">Snaps to 10px. Also updates automatically when you drag the popup's own edges.</div>
                </div>
                <QuickNoteSizePreview
                  width={s.quickNoteSize?.width ?? 400}
                  height={s.quickNoteSize?.height ?? 540}
                  onCommit={setQuickNoteSize}
                />
              </div>
            </Group>
          </>
        )}

        {section === 'appearance' && (
          <>
            <Group title="Theme">
              <div className="sw-theme-grid">
                {Object.entries(allThemes).map(([key, t]) => (
                  <button
                    key={key}
                    className={`sw-theme${s.themeKey === key ? ' active' : ''}`}
                    onClick={() => setTheme(key)}
                    title={t.name || key}
                  >
                    <span className="sw-theme-chip" style={{ background: t.bg }}>
                      <span style={{ background: t.surface }} />
                      <span style={{ background: t.accent }} />
                    </span>
                    <span className="sw-theme-name">{t.name || key}</span>
                  </button>
                ))}
              </div>
            </Group>
            <Group title="Type">
              <Row label="Reader font size">
                <Stepper value={s.fontSize} onChange={v => pref('fontSize', v)} min={12} max={30} suffix="px" />
              </Row>
              <Row label="Reader line spacing">
                <Stepper value={s.lineSpacing} onChange={v => pref('lineSpacing', v)} min={1.2} max={2.4} step={0.1} />
              </Row>
              <Row label="Reader font weight">
                <Select value={String(s.fontWeight)} onChange={v => pref('fontWeight', parseInt(v))} options={[
                  { value: '300', label: 'Light' }, { value: '400', label: 'Regular' },
                  { value: '500', label: 'Medium' }, { value: '600', label: 'Semibold' },
                ]} />
              </Row>
              <Row label="Notebook font size" last>
                <Stepper value={s.nbFontSize} onChange={v => pref('nbFontSize', v)} min={11} max={24} suffix="px" />
              </Row>
            </Group>
          </>
        )}

        {section === 'reader' && (
          <Group title="Reading">
            <Row label="Justify text"><Toggle on={s.justifyText !== false} onChange={() => pref('justifyText', s.justifyText === false)} /></Row>
            <Row label="Tap edges to turn pages"><Toggle on={s.tapToTurn !== false} onChange={() => pref('tapToTurn', s.tapToTurn === false)} /></Row>
            <Row label="Two-page spread"><Toggle on={!!s.twoPage} onChange={() => pref('twoPage', !s.twoPage)} /></Row>
            <Row label="Highlight words while reading"><Toggle on={!!s.highlightWords} onChange={() => pref('highlightWords', !s.highlightWords)} /></Row>
            <Row label="Underline current line"><Toggle on={!!s.underlineLine} onChange={() => pref('underlineLine', !s.underlineLine)} /></Row>
            <Row label="Page transition" last>
              <Select value={s.pageTransition} onChange={v => pref('pageTransition', v)} options={[
                { value: 'slide', label: 'Slide' }, { value: 'fade', label: 'Fade' }, { value: 'none', label: 'None' },
              ]} />
            </Row>
          </Group>
        )}

        {section === 'notebook' && (
          <>
          <Group title="Editing">
            <Row label="Default view mode">
              <Select value={s.defaultViewMode} onChange={v => pref('defaultViewMode', v)} options={[
                { value: 'live', label: 'Live preview' }, { value: 'source', label: 'Source' }, { value: 'preview', label: 'Preview' },
              ]} />
            </Row>
            <Row label="Autosave"><Toggle on={s.autosave !== false} onChange={() => pref('autosave', s.autosave === false)} /></Row>
            <Row label="Smart list continuation" desc="Enter inside a list continues it"><Toggle on={s.smartListContinuation !== false} onChange={() => pref('smartListContinuation', s.smartListContinuation === false)} /></Row>
            <Row label="Syntax autocomplete" desc="Suggestions while typing markdown and /commands" last><Toggle on={s.syntaxAutocomplete !== false} onChange={() => pref('syntaxAutocomplete', s.syntaxAutocomplete === false)} /></Row>
          </Group>

          <Group title="Markdown Syntax Reference">
            <div className="sw-syntax-tabs">
              {SYNTAX_SUBTABS.map(st => (
                <button key={st.id} className={`sw-syntax-tab${st.id === syntaxTab ? ' active' : ''}`} onClick={() => setSyntaxTab(st.id)}>
                  {st.label}
                </button>
              ))}
            </div>
            <div className="sw-syntax-body">
              {SYNTAX_SECTIONS.filter(sec => (SYNTAX_SUBTABS.find(st => st.id === syntaxTab)?.sections || []).includes(sec.title)).map(sec => (
                <div key={sec.title} className="sw-syntax-group">
                  <div className="sw-syntax-group-title">{sec.title}</div>
                  {sec.rows.map(({ k, d }) => (
                    <div key={k} className="sw-syntax-row">
                      <code>{k}</code>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Group>
          </>
        )}

        {section === 'audio' && (
          <Group title="Playback">
            <Row label="Remember position"><Toggle on={s.rememberPosition !== false} onChange={() => pref('rememberPosition', s.rememberPosition === false)} /></Row>
            <Row label="Default speed">
              <Select value={String(s.defaultPlaybackSpeed)} onChange={v => pref('defaultPlaybackSpeed', parseFloat(v))} options={[
                { value: '0.75', label: '0.75×' }, { value: '1', label: '1×' }, { value: '1.25', label: '1.25×' },
                { value: '1.5', label: '1.5×' }, { value: '2', label: '2×' },
              ]} />
            </Row>
            <Row label="Text-to-speech rate" last>
              <Stepper value={s.ttsRate} onChange={v => pref('ttsRate', v)} min={0.5} max={2} step={0.1} suffix="×" />
            </Row>
          </Group>
        )}

        {section === 'calendar' && (
          <Group title="Day view">
            <Row label="Day starts at">
              <Select value={String(s.calendarStartHour)} onChange={v => pref('calendarStartHour', parseInt(v))}
                options={Array.from({ length: 13 }, (_, i) => ({ value: String(i), label: `${i}:00` }))} />
            </Row>
            <Row label="Day ends at">
              <Select value={String(s.calendarEndHour)} onChange={v => pref('calendarEndHour', parseInt(v))}
                options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 13), label: `${i + 13}:00` }))} />
            </Row>
            <Row label="Week starts on" last>
              <Select value={String(s.calendarWeekStart)} onChange={v => pref('calendarWeekStart', parseInt(v))} options={[
                { value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' },
              ]} />
            </Row>
          </Group>
        )}

        {section === 'archive' && (
          <>
            <Group title="Location">
              <Row label="Archive folder" desc={s.archivePath || 'Default app data folder'}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="sw-btn" onClick={switchArchive}>Change…</button>
                  {s.archivePath && (
                    <button className="sw-btn" onClick={() => import('@tauri-apps/api/core').then(({ invoke }) => invoke('open_in_finder', { path: s.archivePath }))}>
                      Show in Finder
                    </button>
                  )}
                </div>
              </Row>
              <Row label="Everything lives here" desc="Books, notebooks, sketches, audio, plugins — plain files you can back up or sync" last>
                <span />
              </Row>
            </Group>
            <Group title="Backup">
              <Row label="Export library index" desc="Download gnos-library.json" last>
                <button className="sw-btn" onClick={exportLibrary}>Export…</button>
              </Row>
            </Group>
          </>
        )}

        {section === 'plugins' && (
          <Group title="Installed plugins">
            {plugins.length === 0 && (
              <Row label="No community plugins" desc="Install plugins from the in-app Plugin Manager" last><span /></Row>
            )}
            {plugins.map((p, i) => (
              <Row key={p.id} label={p.name || p.id} desc={`v${p.version}${p.description ? ` — ${p.description}` : ''}`} last={i === plugins.length - 1}>
                <Toggle
                  on={(s.enabledPluginIds || []).includes(p.id)}
                  onClick={() => {
                    const ids = (s.enabledPluginIds || []).includes(p.id)
                      ? s.enabledPluginIds.filter(x => x !== p.id)
                      : [...(s.enabledPluginIds || []), p.id]
                    pref('enabledPluginIds', ids)
                  }}
                />
              </Row>
            ))}
          </Group>
        )}
      </main>
    </div>
  )
}

const SW_CSS = `
  html, body, #root { height: 100%; margin: 0; }
  .sw-root {
    display: flex; height: 100vh; overflow: hidden; position: relative;
    background: var(--bg); color: var(--text);
    font-family: 'Satoshi', 'Switzer', -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .sw-drag { position: absolute; top: 0; left: 0; right: 0; height: 34px; z-index: 10; }
  .sw-side {
    width: 185px; flex-shrink: 0; box-sizing: border-box;
    padding: 44px 8px 14px; border-right: 1px solid var(--borderSubtle);
    background: var(--surface); overflow-y: auto;
    display: flex; flex-direction: column; gap: 1px;
  }
  .sw-side-head {
    font-size: 15px; font-weight: 700; padding: 4px 10px 12px; letter-spacing: -.01em;
  }
  .sw-side-item {
    display: flex; align-items: center; gap: 9px;
    padding: 6px 10px; border: none; border-radius: 7px;
    background: none; color: var(--text); font-size: 12.5px; font-weight: 500;
    cursor: pointer; text-align: left; font-family: inherit;
    transition: background .1s;
  }
  .sw-side-item:hover { background: var(--hover); }
  .sw-side-item.active { background: var(--accent); color: #fff; }
  .sw-side-icon { display: flex; opacity: .75; flex-shrink: 0; }
  .sw-side-item.active .sw-side-icon { opacity: 1; }
  .sw-main {
    flex: 1; overflow-y: auto; padding: 42px 28px 40px;
  }
  .sw-main-title { font-size: 19px; font-weight: 700; letter-spacing: -.02em; margin-bottom: 16px; }
  .sw-group-wrap { margin-bottom: 22px; max-width: 560px; }
  .sw-group-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
    color: var(--textDim); margin: 0 2px 7px;
  }
  .sw-group {
    background: var(--surface); border: 1px solid var(--borderSubtle);
    border-radius: 11px; overflow: hidden;
  }
  .sw-row {
    display: flex; align-items: center; gap: 14px;
    padding: 11px 14px; border-bottom: 1px solid var(--borderSubtle);
  }
  .sw-row-last { border-bottom: none; }
  .sw-row-text { flex: 1; min-width: 0; }
  .sw-row-label { font-size: 13px; font-weight: 500; }
  .sw-row-desc { font-size: 11px; color: var(--textDim); margin-top: 2px; line-height: 1.45; overflow-wrap: break-word; }
  .sw-row-ctrl { flex-shrink: 0; display: flex; align-items: center; }
  .sw-btn {
    background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 7px;
    color: var(--text); font-size: 12px; font-weight: 500; padding: 5px 12px;
    cursor: pointer; font-family: inherit; transition: background .12s;
  }
  .sw-btn:hover { background: var(--hover); }
  .sw-input {
    background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 7px;
    color: var(--text); font-size: 12.5px; padding: 6px 10px; font-family: inherit;
    outline: none; width: 180px;
  }
  .sw-input:focus { border-color: var(--accent); }
  .sw-kbd {
    font-size: 11.5px; font-weight: 600; color: var(--textDim);
    background: var(--surfaceAlt); border: 1px solid var(--border); border-bottom-width: 2px;
    border-radius: 6px; padding: 3px 8px;
  }
  .sw-stepper {
    display: flex; align-items: center; gap: 0;
    border: 1px solid var(--border); border-radius: 7px; overflow: hidden;
    background: var(--surfaceAlt);
  }
  .sw-stepper button {
    width: 26px; height: 26px; border: none; background: none; color: var(--text);
    font-size: 14px; cursor: pointer; font-family: inherit;
  }
  .sw-stepper button:hover { background: var(--hover); }
  .sw-stepper span {
    min-width: 46px; text-align: center; font-size: 12px; font-weight: 600;
    font-variant-numeric: tabular-nums; padding: 0 4px;
    border-left: 1px solid var(--borderSubtle); border-right: 1px solid var(--borderSubtle);
    line-height: 26px;
  }
  .sw-qn-size-block {
    display: flex; flex-direction: column; gap: 14px;
    padding: 14px;
  }
  .sw-qn-preview { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .sw-qn-preview-stage {
    width: 100%; height: 270px; display: flex; align-items: center; justify-content: center;
    background: var(--surfaceAlt); border: 1px dashed var(--border); border-radius: 10px;
  }
  .sw-qn-preview-box {
    position: relative; box-sizing: border-box;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
    box-shadow: 0 4px 14px rgba(0,0,0,.2);
    display: flex; align-items: center; justify-content: center;
    transition: background .12s;
  }
  .sw-qn-preview-dims {
    font-size: 12px; font-weight: 600; color: var(--textDim);
    font-variant-numeric: tabular-nums; user-select: none;
  }
  .sw-qn-preview-handle {
    position: absolute; right: -1px; bottom: -1px;
    width: 18px; height: 18px; border-radius: 0 0 10px 0;
    background: var(--accent); color: var(--bg, #fff);
    display: flex; align-items: flex-end; justify-content: flex-end; padding: 3px;
    cursor: nwse-resize; touch-action: none;
  }
  .sw-qn-preview-steppers { display: flex; gap: 10px; }
  .sw-theme-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px; padding: 12px;
  }
  .sw-theme {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    background: none; border: 1px solid transparent; border-radius: 10px;
    padding: 8px 6px; cursor: pointer; font-family: inherit;
    transition: border-color .12s, background .12s;
  }
  .sw-theme:hover { background: var(--hover); }
  .sw-theme.active { border-color: var(--accent); }
  .sw-theme-chip {
    width: 54px; height: 36px; border-radius: 8px; border: 1px solid var(--border);
    position: relative; overflow: hidden; display: block;
  }
  .sw-theme-chip span:first-child {
    position: absolute; left: 6px; top: 6px; right: 6px; height: 14px; border-radius: 4px;
  }
  .sw-theme-chip span:last-child {
    position: absolute; left: 6px; bottom: 5px; width: 18px; height: 5px; border-radius: 3px;
  }
  .sw-theme-name { font-size: 10.5px; font-weight: 600; color: var(--textDim); }
  .sw-theme.active .sw-theme-name { color: var(--accent); }

  .sw-syntax-tabs { display: flex; gap: 2px; padding: 10px 10px 0; }
  .sw-syntax-tab {
    padding: 5px 12px; font-size: 11px; font-weight: 600; font-family: inherit;
    border-radius: 6px 6px 0 0; border: 1px solid transparent; border-bottom: none;
    background: none; color: var(--textDim); cursor: pointer;
    transition: background .1s, color .1s;
  }
  .sw-syntax-tab:hover { color: var(--text); }
  .sw-syntax-tab.active { background: var(--bg); border-color: var(--borderSubtle); color: var(--text); }
  .sw-syntax-body { padding: 12px 14px 14px; border-top: 1px solid var(--borderSubtle); }
  .sw-syntax-group { margin-bottom: 14px; }
  .sw-syntax-group:last-child { margin-bottom: 0; }
  .sw-syntax-group-title {
    font-size: 10px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
    color: var(--textDim); opacity: .65; margin-bottom: 6px;
  }
  .sw-syntax-row {
    display: flex; align-items: baseline; gap: 10px; padding: 4px 0;
    border-bottom: 1px solid var(--borderSubtle);
  }
  .sw-syntax-row:last-child { border-bottom: none; }
  .sw-syntax-row code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
    background: var(--surfaceAlt); border: 1px solid var(--border); border-radius: 5px;
    padding: 2px 7px; color: var(--accent); flex-shrink: 0; min-width: 130px;
  }
  .sw-syntax-row span { font-size: 12px; color: var(--textDim); }
`
