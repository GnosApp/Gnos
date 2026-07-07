# Changelog

All notable changes to Gnos are documented here.

## [0.1.1]

### Added
- **Quick Note** — chromeless, always-on-top scratchpad summoned from anywhere with **⌥N**. Inline markdown rendering, swipe/click fanned cards to flip through past notes, `/timer` and `/pomo` rails, inline math calculator (`expr=`, `/math` zones, named variables), autosave to a **quicknotes** collection or a chosen folder, self-cleaning empty notes, and a Settings toggle for the fanned-card peek.
- **Browser-style workspace** — rebuilt centered top bar (sidebar toggle + Home, back/forward + search + add, page actions + tab grid), search bar that doubles as the page title, Zen-style sidebar tabs, a tab overview grid, and drag-and-drop toolbar customization across Left/Center/Right zones.
- **Redesigned Profile & Settings windows** — macOS-style windows with overlay title bars. Profile now includes reading-streak stats, activity heat grid with legend, Top Books by Progress, and Stats/Review tabs.

### Changed
- **Much faster startup** — opens straight into the saved theme and files; no default-dark-mode flash or empty shelves. Splash no longer waits on network; library/notebook/sketchbook data loads in parallel.
- **Faster e-reader** — chapters lay out once and page by sliding instead of rebuilding up front; long books no longer stall on page one. Read-aloud starts at the top of the current page and continues across page turns.
- **Faster notebook editor** — no more re-serializing the document several times per keystroke; widget scanners skip notes with no widgets.
- **Unified controls** across reader, audio, Settings, sidebar, graph, and plugins: white-bar slider handles with accent-filled tracks, Apple-style spring toggles, rounded chevron dropdowns.
- **Cleaner per-view chrome** — removed per-view header bars; actions moved to a shared quick-access strip and page settings to the menu bar / Settings window. Per-view: Books chapter dropdown + combined bookmarks/notes; Audiobooks segmented speed + sleep-timer + chapters toggle; Notebooks word count, quick-access view switcher/share/backlinks, floating ⌘F find; Sketchbooks cycling background button + shape count; Flashcards stats and Study/Edit footer.
- **Softer typography** — humanist sans instead of serif in notebooks, flashcards, and prose. Modernized menus, shadows, focus rings, scrollbars, and inline widgets (timer, habits, calendar, kanban).

### Fixed
- Quick Note phantom blank notes — fixed cloud-sync timing that duplicated a note across folders; real content kept and future duplication prevented.
- Quick Note no longer deletes a note on restart before its content finishes loading — only deletes when emptied by the user.
- Removed stray shadow/halo around the Quick Note window and fanned cards.
- Book covers in global search render at the correct size.
- Fixed plus buttons that silently failed to create notebooks and collections.
- Fixed crashes from global-shortcut handling and from clicking notebook backlinks.
