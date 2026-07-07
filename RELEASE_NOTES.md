# Gnos — Release Notes

## ✨ New

**Quick Note** — summon a chromeless, always-on-top scratchpad from anywhere with **⌥N**. Markdown renders inline as you type. Swipe or click the fanned card edges to flip through past notes; swipe past newest for a fresh one. `/timer 5` and `/pomo` start countdowns on slim vertical rails. Inline math calculator (`expr=`, `/math` zones, named variables) — same as the notebook. Notes autosave to a **quicknotes** collection or a folder you pick in Settings. Empty notes clean themselves up. Toggle the fanned-card peek in **Settings → Quick Note**.

**Browser-style workspace** — rebuilt top bar into a clean centered layout: sidebar toggle + Home left, back/forward + search + add center, page actions + tab grid right. Search bar doubles as the page title. Top tab strip gone — tabs live in the sidebar (Zen-style) and a new tab overview grid. Right-click the title bar to customize toolbar controls via drag-and-drop across Left/Center/Right zones; changes persist. Sidebar can be pinned open or auto-hide.

**Redesigned Profile & Settings windows** — proper macOS-style windows with overlay title bars. Profile now matches the in-app version: reading-streak stats, activity heat grid with legend, Top Books by Progress, plus Stats and Review tabs.

## ⚡ Improvements

**Much faster startup** — opens straight into your theme and files. No default-dark-mode flash, no empty shelves. Splash no longer waits on network; library/notebook/sketchbook data loads in parallel.

**Faster e-reader** — chapters lay out once and page by sliding instead of rebuilding up front. Long books no longer stall on page one. Read-aloud starts at the top of the current page and continues across page turns.

**Faster notebook editor** — no more re-serializing the document several times per keystroke; widget scanners skip notes with no widgets.

**Unified controls everywhere** — one look across reader, audio, Settings, sidebar, graph, plugins: white-bar slider handles with accent-filled tracks, Apple-style spring toggles, rounded dropdowns with a consistent chevron.

**Cleaner per-view chrome** — removed old per-view header bars. Actions moved to a shared quick-access strip in the title bar; page settings moved to the menu bar or Settings window. Books: chapter dropdown in search bar, combined bookmarks + notes. Audiobooks: segmented speed + sleep-timer controls, chapters toggle. Notebooks: word count in search bar; view switcher, share, backlinks in quick access; floating ⌘F find. Sketchbooks: cycling background-style button, shape count in search bar. Flashcards: stats and Study/Edit in a bottom footer.

**Softer typography** — notebooks, flashcards, and prose use a humanist sans instead of serif. Modernized menus, shadows, focus rings, scrollbars, and inline widgets (timer, habits, calendar, kanban).

## 🐛 Fixes

- Quick Note no longer shows phantom blank notes — fixed cloud-sync timing that duplicated a note across folders. Real content kept, future duplication prevented.
- Quick Note no longer deletes a note on restart if its content hadn't finished loading — only deletes when you empty it yourself.
- Removed stray shadow/halo around the Quick Note window and fanned cards.
- Book covers in global search render at the correct size (no longer oversized).
- Fixed plus buttons that silently failed to create notebooks and collections.
- Fixed crashes from global-shortcut handling and from clicking notebook backlinks.
