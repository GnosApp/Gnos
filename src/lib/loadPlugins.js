/**
 * loadPlugins — discovers and loads all enabled plugins at startup.
 *
 * Call once after the store is hydrated. Re-call after user enables/disables a plugin.
 */

import { getPluginsDir } from '@/lib/storage'
import pluginHost from '@/lib/PluginHost'
import useAppStore from '@/store/useAppStore'

const isTauri = typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined'

export const REGISTRY_URL =
  'https://raw.githubusercontent.com/GnosApp/gnos-plugins/main/registry.json'

/**
 * Load all enabled community plugins from the archive's plugins/ directory.
 * Also registers bundled plugins (imported as ES modules).
 */
export async function loadPlugins() {
  const store = useAppStore.getState()
  const enabledIds = new Set(store.enabledPluginIds)

  // ── Community plugins (disk) ───────────────────────────────────────────────
  if (isTauri) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const pluginsDir = await getPluginsDir()

      await invoke('plugin_ensure_dir', { pluginsDir }).catch(() => {})

      const manifests = await invoke('plugin_list', { pluginsDir }).catch(() => [])

      const records = manifests.map(m => ({
        id:          m.id,
        name:        m.name,
        version:     m.version,
        description: m.description || '',
        bundled:     false,
        error:       null,
      }))
      store.setInstalledPlugins([...BUNDLED_RECORDS, ...records])

      for (const manifest of manifests) {
        if (!enabledIds.has(manifest.id)) continue
        if (pluginHost.isLoaded(manifest.id)) continue
        try {
          const code = await invoke('plugin_load_bundle', {
            pluginsDir,
            pluginId: manifest.id,
            mainFile: manifest.main || 'index.js',
          })
          await pluginHost.loadCommunity(manifest, code)
        } catch (err) {
          console.error(`[Plugins] Failed to load "${manifest.id}":`, err)
          store.setInstalledPlugins(
            useAppStore.getState().installedPlugins.map(p =>
              p.id === manifest.id ? { ...p, error: String(err) } : p
            )
          )
        }
      }
    } catch (err) {
      console.warn('[Plugins] Community plugin scan failed:', err)
    }
  } else {
    store.setInstalledPlugins(BUNDLED_RECORDS)
  }
}

/**
 * Fetch the community registry from GitHub.
 * Returns array of registry entries, or throws.
 * @returns {Promise<RegistryEntry[]>}
 */
export async function fetchRegistry() {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    const json = await invoke('plugin_fetch_registry', { url: REGISTRY_URL })
    return JSON.parse(json)
  }
  // Dev / web fallback — direct fetch (may hit CORS in production)
  const res = await fetch(REGISTRY_URL)
  if (!res.ok) throw new Error(`Registry fetch failed: ${res.status}`)
  return res.json()
}

/**
 * Download and install a plugin from its registry entry.
 * Writes manifest.json + index.js to {archive}/plugins/{id}/.
 * Then re-runs loadPlugins() so the store reflects the new plugin.
 * @param {{ id:string, repo:string }} entry
 */
export async function installPlugin(entry) {
  if (!isTauri) throw new Error('Tauri required to install plugins')
  const { invoke } = await import('@tauri-apps/api/core')
  const pluginsDir = await getPluginsDir()
  const base = `https://github.com/${entry.repo}/releases/latest/download`
  await invoke('plugin_install', {
    pluginsDir,
    pluginId: entry.id,
    manifestUrl: `${base}/manifest.json`,
    bundleUrl:   `${base}/index.js`,
  })
  // Enable automatically after install
  useAppStore.getState().setPluginEnabled(entry.id, true)
  await loadPlugins()
}

/**
 * Unload and delete a community plugin.
 * @param {string} id
 */
export async function uninstallPlugin(id) {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  const pluginsDir = await getPluginsDir()
  await pluginHost.unload(id)
  await invoke('plugin_uninstall', { pluginsDir, pluginId: id })
  useAppStore.getState().setPluginEnabled(id, false)
  await loadPlugins()
}

/**
 * Unload a specific plugin and reload it from disk.
 * @param {string} id
 */
export async function reloadPlugin(id) {
  await pluginHost.unload(id)
  await loadPlugins()
}

// ── Bundled plugin registry ───────────────────────────────────────────────────

/** @type {Array<{id,name,version,description,bundled,error}>} */
const BUNDLED_RECORDS = []

/**
 * Register a bundled plugin. Call before loadPlugins().
 * @param {{ manifest: import('@/lib/PluginHost').PluginManifest, onLoad: Function, onUnload?: Function }} plugin
 */
export function registerBundledPlugin(plugin) {
  const { manifest } = plugin
  BUNDLED_RECORDS.push({
    id:          manifest.id,
    name:        manifest.name,
    version:     manifest.version,
    description: manifest.description || '',
    bundled:     true,
    error:       null,
  })

  const store = useAppStore.getState()
  if (!store.enabledPluginIds.includes(manifest.id)) {
    store.setPluginEnabled(manifest.id, true)
  }

  pluginHost.registerBundled(manifest, plugin).catch(err => {
    console.error(`[Plugins] Bundled plugin "${manifest.id}" load error:`, err)
    BUNDLED_RECORDS.forEach(r => { if (r.id === manifest.id) r.error = String(err) })
  })
}
