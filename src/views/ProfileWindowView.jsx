import { useEffect, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadArchivePointer, loadPreferences, getJSON } from '@/lib/storage'
import { applyTheme } from '@/lib/themes'
import ProfileContent from '@/components/ProfileContent'

// ─────────────────────────────────────────────────────────────────────────────
// ProfileWindowView — the profile as its own window (label "profile").
// Reads the flat `library`/`notebooks_meta` index files directly (one JSON
// read each) instead of the folder-scanning `loadLibrary()`/`loadNotebooksMeta()`
// — this window opens cold with nothing cached, so the full per-folder
// meta.json + cover-image reconciliation scan those do was the whole reason it
// felt slow. Same trade-off the main window's fast-pass boot already makes:
// a book cover added only via its folder (never written back to the flat
// index) won't show here — ProfileContent already falls back to a numbered
// placeholder when coverDataUrl is missing, so this degrades invisibly.
// Renders the shared ProfileContent (Stats + Review) so it matches the
// in-app profile modal. Overlay title bar like Settings.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [['stats', 'Stats'], ['review', 'Review']]

export default function ProfileWindowView() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('stats')

  useEffect(() => {
    let disposed = false
    async function load() {
      try {
        const archivePath = await loadArchivePointer()
        if (archivePath) useAppStore.setState({ archivePath })
        // All three reads are flat single-file JSON — no folder scans, no
        // cover-image decoding. Firing them together is what makes this
        // window feel instant instead of the multi-second folder reconcile.
        const [prefs, library, notebooks] = await Promise.all([
          loadPreferences(),
          getJSON('library', []),
          getJSON('notebooks_meta', []),
        ])
        if (disposed) return
        applyTheme(prefs?.themeKey || 'dark', prefs?.customThemes || {})
        setData({ username: prefs?.username || '', library: library || [], notebooks: notebooks || [] })
      } catch (e) {
        console.warn('[Profile] load failed:', e)
        if (!disposed) setData({ username: '', library: [], notebooks: [] })
      }
    }
    load()
    document.body.style.background = 'var(--bg)'

    // The window is kept warm (hidden, not destroyed) between opens and may be
    // pre-warmed at launch, so re-read whenever it's shown — otherwise it would
    // display whatever data was current when it was first built.
    let unlisten = null
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('profile:refresh', () => load()))
      .then(un => { if (disposed) un(); else unlisten = un })
      .catch(() => { /* not in tauri */ })

    return () => { disposed = true; if (unlisten) unlisten() }
  }, [])

  if (!data) {
    return (
      <div className="pw-root pw-loading">
        <style>{PW_CSS}</style>
        <div className="pw-drag" data-tauri-drag-region />
        <div className="spinner" />
      </div>
    )
  }

  const title = data.username ? `${data.username}'s Profile` : 'Reading Profile'
  const subtitle = `${data.library.length} book${data.library.length === 1 ? '' : 's'} · ${data.notebooks.length} notebook${data.notebooks.length === 1 ? '' : 's'}`

  return (
    <div className="pw-root">
      <style>{PW_CSS}</style>
      {/* Drag strip under the overlay traffic lights */}
      <div className="pw-drag" data-tauri-drag-region />

      <div className="pw-header">
        <div className="pw-heading">
          <div className="pw-title">{title}</div>
          <div className="pw-subtitle">{subtitle}</div>
        </div>
        <div className="pw-tabs">
          {TABS.map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`pw-tab${tab === t ? ' on' : ''}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="pw-body">
        <ProfileContent tab={tab} library={data.library} notebooks={data.notebooks} />
      </div>
    </div>
  )
}

const PW_CSS = `
  html, body, #root { height: 100%; margin: 0; }
  .pw-root {
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
    background: var(--bg); color: var(--text);
    font-family: 'Stack Sans Text', 'Satoshi', 'Switzer', -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .pw-loading { align-items: center; justify-content: center; }
  .pw-drag { height: 40px; flex-shrink: 0; }
  .pw-loading .pw-drag { position: absolute; top: 0; left: 0; right: 0; }
  .pw-header {
    flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 0 24px 16px; border-bottom: 1px solid var(--borderSubtle);
  }
  .pw-heading { min-width: 0; }
  .pw-title { font-size: 17px; font-weight: 700; letter-spacing: -.015em; line-height: 1.25; }
  .pw-subtitle { font-size: 11.5px; color: var(--textDim); margin-top: 3px; font-variant-numeric: tabular-nums; }
  .pw-tabs {
    display: flex; gap: 2px; background: var(--surfaceAlt); flex-shrink: 0;
    border: 1px solid var(--border); border-radius: 8px; padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.15);
  }
  .pw-tab {
    height: 24px; padding: 0 12px; font-size: 11px; font-weight: 600;
    border-radius: 5px; border: none; cursor: pointer; font-family: inherit;
    background: none; color: var(--textDim); transition: all 0.15s;
  }
  .pw-tab.on { background: var(--accent); color: var(--bg); }
  .pw-body {
    flex: 1; overflow-y: auto; padding: 18px 24px 40px;
  }
`
