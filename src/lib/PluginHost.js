/**
 * PluginHost — runtime for Gnos plugins.
 *
 * Two plugin types:
 *   Bundled   — shipped with the app (src/plugins/), imported as ES modules.
 *   Community — installed by user into {archive}/plugins/{id}/, loaded from
 *               disk via Rust and executed with new Function().
 *
 * All plugins receive a GnosAPI instance that controls exactly what they can
 * touch. Nothing from the module scope leaks in.
 */

// ── Types (JSDoc only — no runtime overhead) ──────────────────────────────────
/**
 * @typedef {{ id:string, name:string, version:string, minAppVersion:string,
 *             description?:string, main?:string, permissions?:string[] }} PluginManifest
 *
 * @typedef {{ speak(text:string,voice:string,rate:number):Promise<void>,
 *             stop():void, pause():void, resume():void,
 *             getVoices():Promise<string[]> }} TTSProvider
 *
 * @typedef {{ id:string, manifest:PluginManifest, enabled:boolean,
 *             bundled:boolean, error:string|null }} PluginRecord
 */

// ── GnosAPI ───────────────────────────────────────────────────────────────────

class GnosAPI {
  /** @param {string} pluginId @param {PluginManifest} manifest @param {PluginHost} host */
  constructor(pluginId, manifest, host) {
    this.pluginId = pluginId
    this._manifest  = manifest
    this._host      = host
  }

  // ── Library access (read-only snapshots) ──────────────────────────────────

  getBooks() {
    const s = this._host._getStore()
    return s ? [...(s.library || [])] : []
  }

  getActiveBook() {
    const s = this._host._getStore()
    return s ? (s.activeBook ?? null) : null
  }

  getActiveView() {
    const s = this._host._getStore()
    return s ? (s.view ?? 'library') : 'library'
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /**
   * Subscribe to a Gnos event. Returns an unsubscribe function.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void}
   */
  on(event, handler) {
    return this._host._subscribe(this.pluginId, event, handler)
  }

  // ── UI contributions ──────────────────────────────────────────────────────

  get ui() {
    const host = this._host
    const pid  = this.pluginId
    return {
      /**
       * Add a button to the reader toolbar.
       * @param {{ id:string, icon:string, title:string, onClick:()=>void }} opts
       */
      addToolbarButton(opts) {
        host._addToolbarButton(pid, opts)
      },
      removeToolbarButton(id) {
        host._removeToolbarButton(pid, id)
      },
      showToast(message, duration = 2000) {
        host._emit('_toast', { message, duration })
      },
      /** Register a tab in the Plugin Manager settings. */
      addSettingsTab(opts) {
        host._addSettingsTab(pid, opts)
      },
    }
  }

  // ── TTS provider registration ─────────────────────────────────────────────

  get tts() {
    const host = this._host
    const pid  = this.pluginId
    return {
      /** @param {TTSProvider} provider */
      registerProvider(provider) {
        host._registerTTSProvider(pid, provider)
      },
      unregisterProvider() {
        host._unregisterTTSProvider(pid)
      },
    }
  }

  // ── Tauri invoke (permission-gated) ───────────────────────────────────────

  async invoke(command, args = {}) {
    const perms = this._manifest.permissions || []
    const allowed = perms.includes(`invoke:${command}`) || perms.includes('invoke:*')
    if (!allowed) throw new Error(`[${this.pluginId}] Not permitted to invoke "${command}". Add "invoke:${command}" to manifest permissions.`)
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke(command, args)
  }

  // ── Per-plugin storage ────────────────────────────────────────────────────

  get storage() {
    const ns = `gnos_plugin_${this.pluginId}_`
    return {
      get(key) {
        try { const raw = localStorage.getItem(ns + key); return raw !== null ? JSON.parse(raw) : null } catch { return null }
      },
      set(key, value) {
        try { localStorage.setItem(ns + key, JSON.stringify(value)) } catch { /* quota */ }
      },
      delete(key) {
        localStorage.removeItem(ns + key)
      },
    }
  }
}

// ── PluginHost ────────────────────────────────────────────────────────────────

class PluginHost {
  constructor() {
    /** @type {Map<string, { instance: any, api: GnosAPI, manifest: PluginManifest }>} */
    this._loaded = new Map()

    /** @type {Map<string, Map<string, Set<Function>>>} */
    this._listeners = new Map() // event → pluginId → Set<handler>

    /** @type {Map<string, TTSProvider>} */
    this._ttsProviders = new Map() // pluginId → provider

    /** @type {Array<{ pluginId:string, id:string, icon:string, title:string, onClick:()=>void }>} */
    this._toolbarButtons = []

    /** @type {Array<{ pluginId:string, id:string, label:string, render:()=>import('react').ReactElement }>} */
    this._settingsTabs = []

    /** @type {Function|null} store getter — set by init() */
    this._getStore = () => null

    /** @type {Function|null} store subscriber */
    this._storeSubscribe = null

    /** @type {Set<Function>} host-level change listeners (for React) */
    this._changeListeners = new Set()
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Call once after the Zustand store is available.
   * @param {Function} getStore  — returns current store state snapshot
   */
  init(getStore) {
    this._getStore = getStore
  }

  // ── Bundled plugin registration ───────────────────────────────────────────

  /**
   * Register a bundled plugin (imported ES module).
   * @param {PluginManifest} manifest
   * @param {{ onLoad(api:GnosAPI):void|Promise<void>, onUnload?():void }} plugin
   */
  async registerBundled(manifest, plugin) {
    const api = new GnosAPI(manifest.id, manifest, this)
    try {
      await plugin.onLoad(api)
      this._loaded.set(manifest.id, { instance: plugin, api, manifest })
      this._notify()
    } catch (err) {
      console.error(`[PluginHost] Bundled plugin "${manifest.id}" failed to load:`, err)
    }
  }

  // ── Community plugin loading ──────────────────────────────────────────────

  /**
   * Load and execute a community plugin from a JS string.
   * @param {PluginManifest} manifest
   * @param {string} code  — full plugin bundle source
   */
  async loadCommunity(manifest, code) {
    if (this._loaded.has(manifest.id)) await this.unload(manifest.id)
    const api = new GnosAPI(manifest.id, manifest, this)
    try {
      // Execute the bundle as CommonJS (standard esbuild --format=cjs output).
      // We provide a fake `require` that returns the api for 'gnos-plugin-api',
      // and a module/exports object to collect the plugin's exports.
      const mod = { exports: {} }
      const fakeRequire = (id) => {
        if (id === 'gnos-plugin-api') return {} // types-only at runtime
        throw new Error(`[${manifest.id}] require("${id}") not supported. Bundle all deps.`)
      }
      // eslint-disable-next-line no-new-func
      new Function('module', 'exports', 'require', `"use strict";\n${code}`)(mod, mod.exports, fakeRequire)

      // Resolve the plugin object — support default export or named exports
      const exports = mod.exports
      const instance = exports.default ?? exports

      if (typeof instance.onLoad !== 'function') {
        throw new Error(`Plugin "${manifest.id}" must export an onLoad function.`)
      }
      await instance.onLoad(api)
      this._loaded.set(manifest.id, { instance, api, manifest })
      this._notify()
    } catch (err) {
      console.error(`[PluginHost] Community plugin "${manifest.id}" failed:`, err)
      throw err
    }
  }

  async unload(id) {
    const entry = this._loaded.get(id)
    if (!entry) return
    try { if (typeof entry.instance.onUnload === 'function') await entry.instance.onUnload() } catch { /* */ }
    this._listeners.forEach(byPlugin => byPlugin.delete(id))
    this._ttsProviders.delete(id)
    this._toolbarButtons = this._toolbarButtons.filter(b => b.pluginId !== id)
    this._settingsTabs   = this._settingsTabs.filter(t => t.pluginId !== id)
    this._loaded.delete(id)
    this._notify()
  }

  // ── Event bus ─────────────────────────────────────────────────────────────

  /** Emit an event to all subscribed plugin handlers. */
  emit(event, payload) {
    this._emit(event, payload)
  }

  _emit(event, payload) {
    const byPlugin = this._listeners.get(event)
    if (!byPlugin) return
    byPlugin.forEach(handlers => handlers.forEach(h => { try { h(payload) } catch { /* */ } }))
  }

  _subscribe(pluginId, event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Map())
    const byPlugin = this._listeners.get(event)
    if (!byPlugin.has(pluginId)) byPlugin.set(pluginId, new Set())
    byPlugin.get(pluginId).add(handler)
    return () => byPlugin.get(pluginId)?.delete(handler)
  }

  // ── TTS providers ─────────────────────────────────────────────────────────

  _registerTTSProvider(pluginId, provider) {
    this._ttsProviders.set(pluginId, provider)
    this._notify()
  }

  _unregisterTTSProvider(pluginId) {
    this._ttsProviders.delete(pluginId)
    this._notify()
  }

  /** Returns the first registered TTS provider, or null. */
  getActiveTTSProvider() {
    const [provider] = this._ttsProviders.values()
    return provider ?? null
  }

  // ── UI contributions ──────────────────────────────────────────────────────

  _addToolbarButton(pluginId, opts) {
    this._toolbarButtons = this._toolbarButtons.filter(b => !(b.pluginId === pluginId && b.id === opts.id))
    this._toolbarButtons.push({ pluginId, ...opts })
    this._notify()
  }

  _removeToolbarButton(pluginId, id) {
    this._toolbarButtons = this._toolbarButtons.filter(b => !(b.pluginId === pluginId && b.id === id))
    this._notify()
  }

  _addSettingsTab(pluginId, opts) {
    this._settingsTabs = this._settingsTabs.filter(t => !(t.pluginId === pluginId && t.id === opts.id))
    this._settingsTabs.push({ pluginId, ...opts })
    this._notify()
  }

  // ── React integration ─────────────────────────────────────────────────────

  /** Subscribe to host changes (toolbar buttons, loaded plugins, etc.) for React re-renders. */
  subscribe(listener) {
    this._changeListeners.add(listener)
    return () => this._changeListeners.delete(listener)
  }

  getSnapshot() {
    return {
      loaded: [...this._loaded.keys()],
      toolbarButtons: this._toolbarButtons,
      settingsTabs: this._settingsTabs,
      activeTTSProvider: this.getActiveTTSProvider(),
    }
  }

  _notify() {
    this._changeListeners.forEach(l => l())
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  isLoaded(id) { return this._loaded.has(id) }
  getLoadedIds() { return [...this._loaded.keys()] }
  getToolbarButtons() { return this._toolbarButtons }
  getSettingsTabs() { return this._settingsTabs }
}

// Singleton
export const pluginHost = new PluginHost()
export default pluginHost
