# Task: kill the ~1s cold-start flash (default theme + empty library)

Gnos: Tauri + React + zustand. Archive lives on disk (often iCloud — slow reads).
Symptom: app paints dark default theme + empty views, then ~1s later theme + files pop in.
Verify anchors with grep before editing; line numbers approximate.

## Root causes (confirmed)

1. `useAppStore.js` `init()` (~:566): `applyTheme(themeKey, customThemes)` runs only AFTER
   `Promise.all([loadLibrary, loadNotebooksMeta, loadSketchbooksMeta, loadPreferences, ...])`
   resolves (~:578-585). Theme is gated on the slowest disk scan.
2. `loadNotebooksMeta()` (`storage.js` ~:398) re-reads every notebook folder's `meta.json`
   + a trash-manifest scan on every boot. `saveNotebooksMeta` already maintains a flat
   `setJSON('notebooks_meta', …)` index (~:524, comment "quick cold-start") — init never
   uses it for first paint. Same pattern likely for library/sketchbooks.

## Fix (cache-first paint, reconcile after)

### A. Instant theme (biggest visible win)
- On every `applyTheme` success or `persistPreferences`, mirror `{ themeKey, customThemes }`
  to `localStorage.gnos_theme_cache` (JSON).
- In `src/main.jsx`, BEFORE `createRoot(...)`: read that key synchronously, call
  `applyTheme(cached.themeKey, cached.customThemes)` if present. `applyTheme` is in
  `src/lib/themes.js` — check it only sets CSS vars/classes (no async) so it's safe pre-mount.
- Precedent: App.jsx ~:1841 already uses `localStorage.gnos_onboarding_done` sync-read to
  stop the onboarding flash. Same idiom.
- Also apply in secondary windows (quicknote/settings/profile boots each call
  `loadPreferences` then `applyTheme` — cache read makes those instant too; keep the async
  re-apply as reconciliation).

### B. Instant data (files visible on first paint)
- In `init()`: step 1 (archive pointer) unchanged. Then FIRST do a fast pass:
  `getJSON('notebooks_meta')`, `getJSON('library_index'
  — grep storage.js for what flat indexes actually exist for library/sketchbooks; use
  whichever do)` and `set(...)` immediately so views render real lists.
- THEN run the existing full disk scans in the background and `set(...)` again to reconcile
  (authoritative). Don't skip the scans — they self-heal (trash filtering, folder renames).
- If library/sketchbooks lack a flat index, add one: write on each `saveLibrary`/
  `saveSketchbooksMeta` (pattern at storage.js ~:524), read in fast pass. Note these JSON
  blobs live in the archive dir too (`getJSON` → disk) — still much faster than N folder
  reads, but if archive itself is slow to first-byte (iCloud eviction), consider mirroring
  the small meta indexes to localStorage as a second-level cache. Measure before adding.
- Guard: fast-pass data may be stale (deleted notebook reappears for <1s until reconcile).
  Acceptable; reconcile pass fixes it. Do NOT persist anything from the fast pass.
- Prefs too: `loadPreferences()` can run before the heavy loaders instead of inside the same
  `Promise.all` — split: `await loadPreferences()` early (small file), apply theme + prefs,
  then `Promise.all` the rest.

## Accept
- Cold start: first paint already has chosen theme (no dark flash) and notebook/book lists
  populated from cache; reconcile happens invisibly.
- Onboarding (no archive yet) unaffected. Secondary windows keep working.
- `npm run build` green. Log visual changes to `UI_CHANGES.md` (append). No commits unless asked.
