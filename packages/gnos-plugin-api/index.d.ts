/**
 * gnos-plugin-api
 *
 * Type definitions for the Gnos plugin API.
 * This package contains types only — the implementation is provided by the
 * Gnos app at runtime. Do NOT import runtime values from this package.
 *
 * Usage:
 *   import type { GnosAPI, GnosPlugin } from 'gnos-plugin-api'
 */

// ── Domain types ──────────────────────────────────────────────────────────────

export interface Book {
  id: string
  title: string
  author?: string
  coverColor?: string
  currentChapter?: number
  currentPage?: number
  wordCount?: number
  genre?: string[]
  rating?: number
  description?: string
  createdAt?: string
  updatedAt?: string
}

export interface Notebook {
  id: string
  title: string
  wordCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface Highlight {
  id: string
  chapterIdx: number
  page?: number
  text: string
  color: 'yellow' | 'green' | 'pink' | 'blue' | 'purple'
  note?: string
}

export interface Bookmark {
  id: string
  chapterIdx: number
  page: number
  label: string
  createdAt: string
}

// ── Events ────────────────────────────────────────────────────────────────────

export type GnosEventMap = {
  'book:opened':         Book
  'book:closed':         Book
  'page:changed':        { book: Book; chapter: number; page: number }
  'highlight:created':   Highlight
  'highlight:deleted':   { id: string }
  'view:changed':        { view: string }
}

export type GnosEvent = keyof GnosEventMap

// ── TTS Provider ──────────────────────────────────────────────────────────────

export interface TTSProvider {
  id: string
  name: string
  /** Return available voice IDs. */
  getVoices(): Promise<string[]>
  /** Speak text. Resolves when finished. */
  speak(text: string, voice: string, rate: number): Promise<void>
  stop(): void
  pause(): void
  resume(): void
}

// ── Toolbar button ────────────────────────────────────────────────────────────

export interface ToolbarButtonOptions {
  /** Unique within your plugin. */
  id: string
  /** SVG string or emoji. */
  icon: string
  title: string
  onClick(): void
}

// ── Settings tab ─────────────────────────────────────────────────────────────

export interface SettingsTabOptions {
  id: string
  label: string
  /** Return an HTMLElement to render in the settings panel. */
  render(): HTMLElement
}

// ── Storage ───────────────────────────────────────────────────────────────────

export interface PluginStorage {
  get<T = unknown>(key: string): T | null
  set<T = unknown>(key: string, value: T): void
  delete(key: string): void
}

// ── UI ────────────────────────────────────────────────────────────────────────

export interface GnosUI {
  addToolbarButton(options: ToolbarButtonOptions): void
  removeToolbarButton(id: string): void
  showToast(message: string, duration?: number): void
  addSettingsTab(options: SettingsTabOptions): void
}

// ── TTS namespace ─────────────────────────────────────────────────────────────

export interface GnosTTS {
  registerProvider(provider: TTSProvider): void
  unregisterProvider(): void
}

// ── Main API ──────────────────────────────────────────────────────────────────

export interface GnosAPI {
  /** This plugin's id, as declared in manifest.json. */
  readonly pluginId: string

  // ── Library access (read-only) ──────────────────────────────────────────────
  getBooks(): Book[]
  getActiveBook(): Book | null
  getActiveView(): 'library' | 'reader' | 'notebook' | 'sketchbook' | 'flashcard' | 'audio-player' | 'graph' | 'calendar' | 'kanban' | 'plugins' | string

  // ── Events ──────────────────────────────────────────────────────────────────
  /**
   * Subscribe to a Gnos event. Returns an unsubscribe function.
   * @example
   * const off = api.on('book:opened', book => console.log(book.title))
   * // later:
   * off()
   */
  on<E extends GnosEvent>(event: E, handler: (payload: GnosEventMap[E]) => void): () => void
  on(event: string, handler: (payload: unknown) => void): () => void

  // ── UI contributions ─────────────────────────────────────────────────────────
  readonly ui: GnosUI

  // ── TTS ──────────────────────────────────────────────────────────────────────
  readonly tts: GnosTTS

  // ── Tauri invoke (permission-gated) ─────────────────────────────────────────
  /**
   * Call a Tauri command. The command must be listed in manifest.json `permissions`
   * as `"invoke:<commandName>"` or `"invoke:*"`.
   */
  invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>

  // ── Per-plugin storage ───────────────────────────────────────────────────────
  readonly storage: PluginStorage
}

// ── Plugin interface ──────────────────────────────────────────────────────────

/**
 * Every plugin module must export `onLoad` (required) and optionally `onUnload`.
 *
 * @example
 * ```ts
 * import type { GnosPlugin } from 'gnos-plugin-api'
 *
 * const plugin: GnosPlugin = {
 *   async onLoad(api) {
 *     api.on('book:opened', book => api.ui.showToast(`Opened ${book.title}`))
 *   },
 *   onUnload() {},
 * }
 *
 * export default plugin
 * // Also works:
 * export const onLoad = plugin.onLoad
 * export const onUnload = plugin.onUnload
 * ```
 */
export interface GnosPlugin {
  onLoad(api: GnosAPI): void | Promise<void>
  onUnload?(): void | Promise<void>
}

// ── Manifest ──────────────────────────────────────────────────────────────────

export interface PluginManifest {
  /** Unique reverse-domain id, e.g. "com.yourname.my-plugin" */
  id: string
  name: string
  version: string
  /** Minimum Gnos version required. */
  minAppVersion: string
  description?: string
  author?: string
  /** Entry file inside the plugin folder. Defaults to "index.js". */
  main?: string
  /**
   * Tauri commands the plugin may call via `api.invoke()`.
   * Use `"invoke:*"` to allow all (not recommended).
   * @example ["invoke:piper_speak", "invoke:piper_list_voices"]
   */
  permissions?: string[]
}
