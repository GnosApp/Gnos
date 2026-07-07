import { useState, useEffect, useSyncExternalStore, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import pluginHost from '@/lib/PluginHost'
import { loadPlugins, reloadPlugin, fetchRegistry, installPlugin, uninstallPlugin } from '@/lib/loadPlugins'
import { Toggle } from '@/components/Controls'

// ── Shared plugin card icon ───────────────────────────────────────────────────

function PluginIcon() {
  return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--surfaceAlt)', border: '1px solid var(--borderSubtle)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M6 2H3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zM13 2h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1zM6 9H3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1zM13 9h-3a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1z" stroke="var(--textDim)" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    </div>
  )
}

// ── Installed tab ─────────────────────────────────────────────────────────────

function InstalledTab() {
  const installedPlugins = useAppStore(s => s.installedPlugins)
  const enabledPluginIds = useAppStore(s => s.enabledPluginIds)
  const setPluginEnabled  = useAppStore(s => s.setPluginEnabled)

  const hostSnap = useSyncExternalStore(
    cb => pluginHost.subscribe(cb),
    () => pluginHost.getSnapshot()
  )

  const [busy, setBusy] = useState(null)

  async function toggle(id, enabled) {
    setBusy(id)
    setPluginEnabled(id, enabled)
    try {
      if (enabled) await reloadPlugin(id)
      else await pluginHost.unload(id)
    } catch (err) {
      console.error('[PluginManager] toggle error', err)
    }
    setBusy(null)
  }

  async function handleUninstall(id) {
    setBusy(id)
    try {
      await uninstallPlugin(id)
    } catch (err) {
      console.error('[PluginManager] uninstall error', err)
    }
    setBusy(null)
  }

  if (installedPlugins.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--textDim)', fontSize: 13, padding: '60px 0' }}>
        No plugins installed yet. Browse the community registry to find plugins.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {installedPlugins.map(plugin => {
        const enabled  = enabledPluginIds.includes(plugin.id)
        const loaded   = hostSnap.loaded.includes(plugin.id)
        const spinning = busy === plugin.id

        return (
          <div key={plugin.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 16,
            padding: '14px 16px', borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            opacity: spinning ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}>
            <PluginIcon />

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{plugin.name}</span>
                <span style={{ fontSize: 10, color: 'var(--textDim)', background: 'var(--surfaceAlt)', border: '1px solid var(--borderSubtle)', borderRadius: 4, padding: '1px 6px' }}>
                  v{plugin.version}
                </span>
                {plugin.bundled && (
                  <span style={{ fontSize: 10, color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)', borderRadius: 4, padding: '1px 6px' }}>
                    built-in
                  </span>
                )}
                {enabled && loaded && !plugin.error && (
                  <span style={{ fontSize: 10, color: '#3fb950', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: 4, padding: '1px 6px' }}>
                    active
                  </span>
                )}
                {plugin.error && (
                  <span style={{ fontSize: 10, color: '#f85149', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.25)', borderRadius: 4, padding: '1px 6px' }} title={plugin.error}>
                    error
                  </span>
                )}
              </div>
              {plugin.description && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--textDim)', lineHeight: 1.5 }}>{plugin.description}</p>
              )}
              <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--textDim)', opacity: 0.6 }}>{plugin.id}</p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginTop: 2 }}>
              {!plugin.bundled && (
                <button
                  disabled={spinning}
                  onClick={() => handleUninstall(plugin.id)}
                  style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 5,
                    border: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--textDim)', cursor: spinning ? 'default' : 'pointer',
                  }}
                >
                  {spinning ? '…' : 'Uninstall'}
                </button>
              )}
              <Toggle
                on={enabled}
                onChange={v => toggle(plugin.id, v)}
                disabled={spinning || plugin.bundled}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function BrowseTab() {
  const installedPlugins = useAppStore(s => s.installedPlugins)
  const [registry, setRegistry] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [query, setQuery]       = useState('')
  const [busy, setBusy]         = useState(null) // plugin id currently installing

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const entries = await fetchRegistry()
      setRegistry(entries)
    } catch (err) {
      setError(String(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const installedIds = new Set(installedPlugins.map(p => p.id))

  const filtered = (registry || []).filter(entry => {
    if (!query) return true
    const q = query.toLowerCase()
    return (
      entry.name?.toLowerCase().includes(q) ||
      entry.description?.toLowerCase().includes(q) ||
      entry.author?.toLowerCase().includes(q)
    )
  })

  async function handleInstall(entry) {
    setBusy(entry.id)
    try {
      await installPlugin(entry)
    } catch (err) {
      console.error('[PluginManager] install error', err)
      alert(`Install failed: ${err}`)
    }
    setBusy(null)
  }

  async function handleUninstall(entry) {
    setBusy(entry.id)
    try {
      await uninstallPlugin(entry.id)
    } catch (err) {
      console.error('[PluginManager] uninstall error', err)
    }
    setBusy(null)
  }

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search plugins…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surfaceAlt)', color: 'var(--text)',
            fontSize: 13, outline: 'none',
          }}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--textDim)', fontSize: 13, padding: '48px 0' }}>
          Fetching registry…
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <p style={{ color: '#f85149', fontSize: 13, marginBottom: 12 }}>Could not load registry: {error}</p>
          <button
            onClick={load}
            style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surfaceAlt)', color: 'var(--text)', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--textDim)', fontSize: 13, padding: '48px 0' }}>
          {query ? 'No plugins match your search.' : 'No community plugins listed yet.'}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(entry => {
            const isInstalled = installedIds.has(entry.id)
            const isBusy     = busy === entry.id

            return (
              <div key={entry.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 16,
                padding: '14px 16px', borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                opacity: isBusy ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}>
                <PluginIcon />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{entry.name}</span>
                    {entry.version && (
                      <span style={{ fontSize: 10, color: 'var(--textDim)', background: 'var(--surfaceAlt)', border: '1px solid var(--borderSubtle)', borderRadius: 4, padding: '1px 6px' }}>
                        v{entry.version}
                      </span>
                    )}
                    {isInstalled && (
                      <span style={{ fontSize: 10, color: '#3fb950', background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: 4, padding: '1px 6px' }}>
                        installed
                      </span>
                    )}
                  </div>
                  {entry.description && (
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--textDim)', lineHeight: 1.5 }}>{entry.description}</p>
                  )}
                  {entry.author && (
                    <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--textDim)', opacity: 0.6 }}>by {entry.author}</p>
                  )}
                </div>

                <div style={{ flexShrink: 0, marginTop: 2 }}>
                  {isInstalled ? (
                    <button
                      disabled={isBusy}
                      onClick={() => handleUninstall(entry)}
                      style={{
                        fontSize: 12, padding: '5px 14px', borderRadius: 6,
                        border: '1px solid var(--border)', background: 'transparent',
                        color: 'var(--textDim)', cursor: isBusy ? 'default' : 'pointer',
                      }}
                    >
                      {isBusy ? 'Removing…' : 'Remove'}
                    </button>
                  ) : (
                    <button
                      disabled={isBusy}
                      onClick={() => handleInstall(entry)}
                      style={{
                        fontSize: 12, padding: '5px 14px', borderRadius: 6,
                        border: 'none', background: 'var(--accent)',
                        color: '#fff', cursor: isBusy ? 'default' : 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {isBusy ? 'Installing…' : 'Install'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Dev hint */}
      <div style={{ marginTop: 28, padding: '14px 16px', borderRadius: 8, background: 'var(--surfaceAlt)', border: '1px solid var(--borderSubtle)' }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--textDim)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Publish your plugin</strong><br/>
          Build with <code>esbuild --format=cjs</code>, create a GitHub release with <code>manifest.json</code> + <code>index.js</code> as assets,
          then submit a PR to <code>GnosApp/gnos-plugins</code> to add it to this list.
        </p>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function PluginManagerView() {
  const [tab, setTab] = useState('installed')

  const TAB_STYLE = (active) => ({
    fontSize: 13, fontWeight: active ? 600 : 400,
    color: active ? 'var(--text)' : 'var(--textDim)',
    background: 'none', border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    padding: '6px 4px', cursor: 'pointer',
    transition: 'color 0.1s, border-color 0.1s',
  })

  return (
    <div style={{ padding: '32px 40px', maxWidth: 680, margin: '0 auto' }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>Plugins</h2>
      <p style={{ fontSize: 13, color: 'var(--textDim)', marginBottom: 20 }}>
        Extend Gnos with community plugins. Each plugin runs in a sandboxed context with explicit permissions.
      </p>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 20, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        <button style={TAB_STYLE(tab === 'installed')} onClick={() => setTab('installed')}>Installed</button>
        <button style={TAB_STYLE(tab === 'browse')}    onClick={() => setTab('browse')}>Browse</button>
      </div>

      {tab === 'installed' && <InstalledTab />}
      {tab === 'browse'    && <BrowseTab />}
    </div>
  )
}
