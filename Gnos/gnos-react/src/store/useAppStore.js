import { create } from 'zustand'
import { loadLibrary, saveLibrary, loadNotebooksMeta, saveNotebooksMeta, loadPreferences, savePreferences, loadSketchbooksMeta, saveSketchbooksMeta, migrateBooksToNamedFolders, migrateNotebooksToFolders, migrateSketchbooksToFolders, migrateAudiobooksToFolders, saveArchivePointer, loadArchivePointer } from '@/lib/storage'
import { applyTheme, BUILT_IN_THEMES } from '@/lib/themes'
import { makeId } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// App-wide state store
// ─────────────────────────────────────────────────────────────────────────────

const useAppStore = create((set, get) => ({

  // ── View routing ────────────────────────────────────────────────────────────
  view: 'library',
  activeLibTab: 'library',
  setView: (view) => set({ view }),
  setActiveLibTab: (tab) => set({ activeLibTab: tab }),

  // ── Side nav ────────────────────────────────────────────────────────────────
  sideNavOpen: false,
  openSideNav:  () => set({ sideNavOpen: true }),
  closeSideNav: () => set({ sideNavOpen: false }),

  // ── Tabs (max 2) ─────────────────────────────────────────────────────────────
  // Each tab: { id, view, activeLibTab, activeBook, activeNotebook, activeAudioBook, activeSketchbook }
  tabs: [{ id: 'tab_main', view: 'library', activeLibTab: 'library', activeBook: null, activeNotebook: null, activeAudioBook: null, activeSketchbook: null }],
  activeTabId: 'tab_main',

  /** Snapshot current view state into the active tab, then switch to target tab */
  switchTab(targetId) {
    const s = get()
    const updatedTabs = s.tabs.map(t =>
      t.id === s.activeTabId
        ? { ...t, view: s.view, activeLibTab: s.activeLibTab, activeBook: s.activeBook, activeNotebook: s.activeNotebook, activeAudioBook: s.activeAudioBook, activeSketchbook: s.activeSketchbook }
        : t
    )
    const target = updatedTabs.find(t => t.id === targetId)
    if (!target) return
    set({
      tabs: updatedTabs,
      activeTabId: targetId,
      view: target.view,
      activeLibTab: target.activeLibTab,
      activeBook: target.activeBook,
      activeNotebook: target.activeNotebook,
      activeAudioBook: target.activeAudioBook,
      activeSketchbook: target.activeSketchbook,
    })
  },

  /** Open a new tab (no limit). */
  openNewTab(snapshot = {}) {
    const s = get()
    // Save current state into active tab
    const updatedTabs = s.tabs.map(t =>
      t.id === s.activeTabId
        ? { ...t, view: s.view, activeLibTab: s.activeLibTab, activeBook: s.activeBook, activeNotebook: s.activeNotebook, activeAudioBook: s.activeAudioBook, activeSketchbook: s.activeSketchbook }
        : t
    )
    const newTab = {
      id: makeId('tab'),
      view: snapshot.view || 'library',
      activeLibTab: snapshot.activeLibTab || 'library',
      activeBook: snapshot.activeBook || null,
      activeNotebook: snapshot.activeNotebook || null,
      activeAudioBook: snapshot.activeAudioBook || null,
      activeSketchbook: snapshot.activeSketchbook || null,
    }
    // Always append — no tab limit
    const finalTabs = [...updatedTabs, newTab]
    set({
      tabs: finalTabs,
      activeTabId: newTab.id,
      view: newTab.view,
      activeLibTab: newTab.activeLibTab,
      activeBook: newTab.activeBook,
      activeNotebook: newTab.activeNotebook,
      activeAudioBook: newTab.activeAudioBook,
      activeSketchbook: newTab.activeSketchbook,
    })
  },

  /** Directly update a specific tab's snapshot without switching to it.
   *  Used by split-pane views to keep their own state independent. */
  updateTab(tabId, patch) {
    set(s => ({
      tabs: s.tabs.map(t => t.id === tabId ? { ...t, ...patch } : t),
    }))
  },

  /** Close a tab, switch to the remaining one */
  closeTab(tabId) {
    const s = get()
    if (s.tabs.length <= 1) return // never close the last tab
    const remaining = s.tabs.filter(t => t.id !== tabId)
    const next = remaining[0]
    set({
      tabs: remaining,
      activeTabId: next.id,
      view: next.view,
      activeLibTab: next.activeLibTab,
      activeBook: next.activeBook,
      activeNotebook: next.activeNotebook,
      activeAudioBook: next.activeAudioBook,
      activeSketchbook: next.activeSketchbook,
    })
  },

  // ── Library ─────────────────────────────────────────────────────────────────
  library: [],
  setLibrary: (library) => set({ library }),
  addBook: (book) => set(s => ({ library: [...s.library, book] })),
  updateBook: (id, patch) => set(s => ({
    library: s.library.map(b => b.id === id ? { ...b, ...patch } : b),
  })),
  removeBook: (id) => set(s => ({ library: s.library.filter(b => b.id !== id) })),
  reorderLibrary: (fromIdx, toIdx) => set(s => {
    const lib = [...s.library]
    const [moved] = lib.splice(fromIdx, 1)
    lib.splice(toIdx, 0, moved)
    return { library: lib }
  }),

  // ── Notebooks ───────────────────────────────────────────────────────────────
  notebooks: [],
  setNotebooks: (notebooks) => set({ notebooks }),
  addNotebook: (nb) => set(s => ({ notebooks: [nb, ...s.notebooks] })),
  updateNotebook: (id, patch) => set(s => ({
    notebooks: s.notebooks.map(n => n.id === id ? { ...n, ...patch } : n),
  })),
  removeNotebook: (id) => set(s => ({ notebooks: s.notebooks.filter(n => n.id !== id) })),

  // ── Active reader ────────────────────────────────────────────────────────────
  activeBook: null,
  chapters: [],
  currentChapter: 0,
  currentPage: 0,
  setActiveBook: (book) => set({ activeBook: book }),
  setChapters: (chapters) => set({ chapters }),
  setCurrentChapter: (n) => set({ currentChapter: n }),
  setCurrentPage: (n) => set({ currentPage: n }),

  // ── Active notebook ──────────────────────────────────────────────────────────
  activeNotebook: null,
  setActiveNotebook: (nb) => set({ activeNotebook: nb }),

  // ── Sketchbooks ──────────────────────────────────────────────────────────────
  sketchbooks: [],
  activeSketchbook: null,
  setSketchbooks: (sketchbooks) => set({ sketchbooks }),
  setActiveSketchbook: (sb) => set({ activeSketchbook: sb }),
  addSketchbook: (sb) => set(s => ({ sketchbooks: [sb, ...s.sketchbooks] })),
  updateSketchbook: (id, patch) => set(s => ({
    sketchbooks: s.sketchbooks.map(sb => sb.id === id ? { ...sb, ...patch } : sb),
  })),
  removeSketchbook: (id) => set(s => ({ sketchbooks: s.sketchbooks.filter(sb => sb.id !== id) })),

  // ── Active audio book ────────────────────────────────────────────────────────
  activeAudioBook: null,
  setActiveAudioBook: (book) => set({ activeAudioBook: book }),

  // ── Notes (keyed by bookId) ──────────────────────────────────────────────────
  notes: {},
  setNotes: (notes) => set({ notes }),
  addNote: (bookId, note) => set(s => ({
    notes: { ...s.notes, [bookId]: [...(s.notes[bookId] ?? []), note] },
  })),

  // ── Reader preferences ───────────────────────────────────────────────────────
  themeKey: 'dark',
  customThemes: {},
  fontSize: 18,
  lineSpacing: 1.7,
  fontFamily: 'Georgia, serif',
  tapToTurn: true,
  twoPage: false,
  justifyText: true,
  highlightWords: false,
  underlineLine: false,
  setPreference: (key, value) => set({ [key]: value }),
  setPref: (key, value) => set({ [key]: value }),
  updateBookProgress: (id, chapter, page) => set(s => ({
    library: s.library.map(b => b.id === id ? { ...b, currentChapter: chapter, currentPage: page } : b),
  })),

  // ── Ollama (optional AI) ─────────────────────────────────────────────────────
  ollamaUrl: '',
  ollamaModel: 'llama3',

  // ── User profile & archive ──────────────────────────────────────────────────────
  username: '',
  archivePath: '',
  onboardingComplete: false,
  setUsername: (username) => set({ username }),
  setArchivePath: (archivePath) => set({ archivePath }),
  setOnboardingComplete: (v) => set({ onboardingComplete: v }),

  // ── Async actions ─────────────────────────────────────────────────────────────

  async init() {
    // ── Step 1: read the pointer file from appDataDir/gnos/archive_path.json ──
    // This is a tiny file that always lives in the default location regardless
    // of where the user's archive is. It tells us the archive path so we can
    // point storage there before loading anything else.
    const savedArchivePath = await loadArchivePointer()
    if (savedArchivePath) {
      // Set archivePath in the store NOW so getBaseDir() resolves to the archive
      set({ archivePath: savedArchivePath })
    }

    // ── Step 2: load everything from the correct location ─────────────────────
    const [library, notebooks, sketchbooks, prefs] = await Promise.all([
      loadLibrary(),
      loadNotebooksMeta(),
      loadSketchbooksMeta(),
      loadPreferences(),
    ])

    if (prefs) {
      const {
        themeKey = 'dark', customThemes = {},
        fontSize = 18, lineSpacing = 1.7, fontFamily = 'Georgia, serif',
        tapToTurn = true, twoPage = false,
        justifyText = true, highlightWords = false, underlineLine = false,
        ollamaUrl = '', ollamaModel = 'llama3',
        username = '', archivePath = '', onboardingComplete = false,
      } = prefs
      // archivePath from prefs wins over the pointer (they should match, but prefs is authoritative)
      set({ themeKey, customThemes, fontSize, lineSpacing, fontFamily,
            tapToTurn, twoPage, justifyText, highlightWords, underlineLine,
            ollamaUrl, ollamaModel, username,
            archivePath: archivePath || savedArchivePath,
            onboardingComplete })
      applyTheme(themeKey, customThemes)
    } else {
      applyTheme('dark')
    }
    set({ library: library ?? [], notebooks: notebooks ?? [], sketchbooks: sketchbooks ?? [] })
    migrateBooksToNamedFolders(library ?? []).catch(err => console.warn('[Gnos] Migration error:', err))
    migrateNotebooksToFolders(notebooks ?? []).catch(err => console.warn('[Gnos] Notebook migration error:', err))
    migrateSketchbooksToFolders(sketchbooks ?? []).catch(err => console.warn('[Gnos] Sketchbook migration error:', err))
    migrateAudiobooksToFolders(library ?? []).catch(err => console.warn('[Gnos] Audio migration error:', err))
  },

  async persistLibrary() {
    await saveLibrary(get().library)
  },
  async persistNotebooks() {
    await saveNotebooksMeta(get().notebooks)
  },
  async persistSketchbooks() {
    await saveSketchbooksMeta(get().sketchbooks)
  },
  async persistPreferences() {
    const s = get()
    await savePreferences({
      themeKey: s.themeKey, customThemes: s.customThemes,
      fontSize: s.fontSize, lineSpacing: s.lineSpacing, fontFamily: s.fontFamily,
      tapToTurn: s.tapToTurn, twoPage: s.twoPage,
      justifyText: s.justifyText, highlightWords: s.highlightWords, underlineLine: s.underlineLine,
      ollamaUrl: s.ollamaUrl, ollamaModel: s.ollamaModel,
      username: s.username, archivePath: s.archivePath, onboardingComplete: s.onboardingComplete,
    })
    // Always keep the pointer file up to date so init() can find the archive on next launch
    if (s.archivePath) {
      await saveArchivePointer(s.archivePath)
    }
  },
  setTheme(key) {
    const { customThemes } = get()
    set({ themeKey: key })
    applyTheme(key, customThemes)
    get().persistPreferences()
  },
}))

export default useAppStore

import { useShallow } from 'zustand/react/shallow'
export const useAppStoreShallow = (selector) => useAppStore(useShallow(selector))