import { useEffect, useState } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadArchivePointer, loadPreferences, loadLibrary, loadNotebooksMeta } from '@/lib/storage'
import { applyTheme } from '@/lib/themes'
import ProfileContent from '@/components/ProfileContent'

// ─────────────────────────────────────────────────────────────────────────────
// ProfileWindowView — the profile as its own window (label "profile").
// Reads library/notebooks straight from the archive, then renders the shared
// ProfileContent (Stats + Review) so it matches the in-app profile modal.
// Overlay title bar like Settings.
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [['stats', 'Stats'], ['review', 'Review']]

export default function ProfileWindowView() {
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('stats')

  useEffect(() => {
    async function boot() {
      try {
        const archivePath = await loadArchivePointer()
        if (archivePath) useAppStore.setState({ archivePath })
        const prefs = await loadPreferences()
        applyTheme(prefs?.themeKey || 'dark', prefs?.customThemes || {})

        const [library, notebooks] = await Promise.all([
          loadLibrary(),
          loadNotebooksMeta(),
        ])
        setData({ username: prefs?.username || '', library: library || [], notebooks: notebooks || [] })
      } catch (e) {
        console.warn('[Profile] boot failed:', e)
        setData({ username: '', library: [], notebooks: [] })
      }
    }
    boot()
    document.body.style.background = 'var(--bg)'
  }, [])

  if (!data) return <div style={{ height: '100vh', background: 'var(--bg)' }} />

  const title = data.username ? `${data.username} — Profile` : 'Reading Profile'

  return (
    <div className="pw-root">
      <style>{PW_CSS}</style>
      {/* Drag strip under the overlay traffic lights */}
      <div className="pw-drag" data-tauri-drag-region />

      <div className="pw-header">
        <div className="pw-avatar">{(data.username || 'G').slice(0, 1).toUpperCase()}</div>
        <div className="pw-title">{title}</div>
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
    font-family: 'Satoshi', 'Switzer', -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .pw-drag { height: 40px; flex-shrink: 0; }
  .pw-header {
    flex-shrink: 0; display: flex; align-items: center; gap: 12px;
    padding: 0 24px 14px; border-bottom: 1px solid var(--borderSubtle);
  }
  .pw-avatar {
    width: 40px; height: 40px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 700; flex-shrink: 0;
    box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .pw-title { font-size: 15px; font-weight: 700; letter-spacing: -.01em; flex: 1; min-width: 0; }
  .pw-tabs {
    display: flex; gap: 2px; background: var(--surfaceAlt);
    border: 1px solid var(--border); border-radius: 8px; padding: 3px;
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.15);
  }
  .pw-tab {
    height: 24px; padding: 0 12px; font-size: 11px; font-weight: 600;
    border-radius: 5px; border: none; cursor: pointer; font-family: inherit;
    background: none; color: var(--textDim); transition: all 0.15s;
  }
  .pw-tab.on { background: var(--accent); color: #fff; }
  .pw-body {
    flex: 1; overflow-y: auto; padding: 18px 24px 40px;
  }
`
