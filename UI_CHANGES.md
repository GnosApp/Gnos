# UI Changes — July 2026 pass

## A46. Forty-fifth pass — conflict-safe save: keep BOTH edits, never prompt

Refines A45's conflict handling per user ask: "allow the app to save both the offline edits and current edits whenever the edit is made." A45 surfaced an interactive banner (Load from disk / Keep mine) when a note was open and its `.md` changed on disk. User wants no prompt — auto-keep both.

- **`storage.js` auto-fork** (`_forkExternalConflict` + guard in `saveNotebookContent`): before overwriting the existing folder's `.md`, if disk mtime > `meta.contentSyncedAt` (+1s slack) AND disk text ≠ what we're writing, the external/offline version is written into its own new notebook — "<title> (offline edit <date>)", unique-suffixed, fresh id, `forkedFrom`/`forkedFromTitle` in meta — then our edits save to the original. Fires `gnos:notebook-conflict`.
- **`NotebookView.jsx`:** `doSave` conflict branch no longer sets the banner/returns — it falls through to `saveNotebookContent` (which forks), keeping only the "disk == what we're writing" fast re-baseline. The disk watcher's divergence branch (unsaved local edits + external change) now calls `flushSaveRef.current()` (new ref → `flushSave`) instead of `setExtConflict`, so local persists + external forks. `extConflict` state + banner JSX left in place but now unused (legacy; safe to remove later).
- **`App.jsx`:** `gnos:notebook-conflict` → toast ("External edit kept separately… saved as '<fork>'") + `rescanNotebooks()` so the fork appears immediately; auto-dismiss 8s.

**Revert:** restore A45 `doSave` banner branch + watcher `setExtConflict`; drop `_forkExternalConflict` + storage guard + `flushSaveRef` + the App toast/listener.

**Verify:** build green. Needs Tauri (preview has no FS): open a note, change its `.md` externally to different text, edit in-app → save → original keeps in-app text, a "(offline edit …)" note holds the external text, toast fires. Nothing lost, no dialog.

## A45. Forty-fourth pass — live external-edit sync in the open notebook + Flashcards sidebar tab

Two asks: (1) markdown saved externally should hit the open note "as soon as possible", (2) flashcards get their own sidebar tab and turn up in search.

### 1. Live external sync (closes the A44 KNOWN GAP)

A44 only refreshed cards at startup/focus; a note open in the editor kept stale text and autosave clobbered the external write. Now the editor watches its own file.

- **`storage.js` (new helpers):** `resolveNotebookMdPath(folderPath)` (prefers `<folder>/<folder>.md`, else first `.md`), `getFileMtimeMs(path)`, `readNotebookMdAt(path)` (text + mtime), `stampNotebookSynced(folderPath, mtimeMs)` (writes `contentSyncedAt` into `meta.json` without touching the `.md`, so the disk scan doesn't re-derive after the editor already adopted the change).
- **`NotebookView.jsx` watcher:** on load, the note's md path + mtime are resolved into `mdPathRef`/`diskMtimeRef` (one `stat` per poll — no directory scan). While the note is open and the document is visible, a 1.5s interval plus `focus`/`visibilitychange` listeners compare mtime. Newer file → read → if the bytes match what's already in the editor, just re-baseline; otherwise adopt via `applyExternal()`, which pushes the text into CM6 **preserving the cursor**, updates title/wordCount on the card, and fills the cross-tab content cache.
- **Conflict guard (never silently resolves):** `syncedTextRef` tracks the text as of the last agreement with disk. If the editor has unsaved local edits when an external change lands, no auto-replace — a banner appears with **Load from disk** / **Keep mine**. `doSave` re-checks mtime before writing, so autosave can't overwrite an external edit that arrived between keystroke and flush; it bails into the same banner.

### 2. Flashcards sidebar tab + search

- **`SideNav.jsx`:** new `flashcards` entry in `NAV_ITEMS`; `getItemsForTab('flashcards')` returns decks (`_isDeck`), which also join the `library` section and collection smart-filters (`type: flashcard`); `openItemInCurrentTab` / `openItemInNewTab` / `resolveCollectionItems` / `MiniCover` handle `_isDeck`; `VIEW_TO_TAB` maps `flashcard → flashcards` so the section auto-expands with a deck open.
- **Search — decks match on title AND card text.** Sidebar search (`SideNavSearch`, badge `DECK`) and the titlebar omnibar (`SearchDropdown`, new `flashcardDecks`/`onOpenDeck` props, deck badge icon, `N cards` sub-line, plus a matched-card snippet when the hit came from a card rather than the title). Wired at both call sites (`App.jsx` titlebar, `LibraryView.jsx` mobile).
- **`LibraryView.jsx`:** `activeTab === 'flashcards'` renders a decks-only grid (drag-enabled, same `FlashcardDeckCard`) with its own empty state that creates a deck — the tab is a real destination, not another view of the unified grid.

**Revert:** drop the four storage helpers; remove the watcher effect + `applyExternal`/`splitTitle`/`extConflict` banner + the `doSave` mtime guard; drop the `flashcards` NAV_ITEM + `_isDeck` branches + deck search in both search components + the `flashcards` renderTab branch.

**Verify:** build green; preview clean. Verified live in the browser: Flashcards nav item → decks-only grid; omnibar search for a *card body* term ("hippocampus") lists the deck with the card snippet and opens it into study mode; sidebar search shows the `DECK` badge; notebook opens with the watcher running, no console errors. **The sync itself needs the Tauri app** (preview has no FS — `mdPathRef` stays null and the watcher no-ops): open a note, edit its `.md` externally, confirm the text swaps in within ~1.5s with the caret intact; then type locally without saving, edit the file externally, confirm the conflict banner instead of a silent overwrite.

## A44. Forty-third pass — external markdown changes picked up (off-device sync)

Markdown edited OUTSIDE the app (synced from another device, edited in Obsidian/vim, dropped in by hand) now shows up. Two real gaps existed: (a) card metadata (title/date/word count) comes from `meta.json`, which an external editor never touches — so content changed but the card stayed stale; (b) a folder holding a `.md` with **no** `meta.json` was completely invisible to the library. (Note content itself already re-read from disk per open — the in-memory `notebookContentCache` is runtime-only.)

- **`syncNotebooksFromDisk()`** (`storage.js`, new): per notebook folder — **ADOPT** a `.md` with no `meta.json` by writing one (id, title from leading `# `, timestamps from file mtime, `adoptedFromDisk: true`); **REFRESH** when the `.md`'s mtime is newer than the recorded `contentSyncedAt` by re-deriving title/wordCount/updatedAt and rewriting `meta.json`. Helpers `_deriveMetaFromMd` / `_mtimeMs`. Idempotent — only writes when a file is genuinely newer, so it's safe to call repeatedly.
- **Wired into `loadNotebooksMeta()`** (runs first), so `init()` picks up external edits at every launch — the "after start up" ask.
- **`saveNotebookContent` stamps `contentSyncedAt`** (via `stat` after write, both existing-folder and new-folder branches) so the app's own saves aren't mistaken for external edits on the next scan.
- **Focus re-scan**: new store action `rescanNotebooks()`; `App.jsx` adds a `window focus` listener (throttled 5s, removed on cleanup) so a mid-session sync appears without restarting.

**Revert:** drop `syncNotebooksFromDisk` + its call in `loadNotebooksMeta`; revert the two `contentSyncedAt` stamps; remove `rescanNotebooks` + the focus listener.

**Verify:** build green; app boots clean, no console errors. Real test needs the Tauri app: edit a note's `.md` in an external editor (or drop a new `Foo/Foo.md` into the notebooks dir) → relaunch (or just refocus the window) → updated title/date appears, new note is adopted into the library.

**KNOWN GAP (not addressed):** if a note is OPEN in the app while the file changes externally, the editor still holds the old text and autosave can overwrite the external edit. A conflict guard (compare mtime before write; reload-or-branch) is the natural follow-up.

## A43. Forty-second pass — covers off base64 + paint containment (PLAN_STARTUP F4/F5)

Covers were still slow to render + on scroll. Cause: `loadCoverFromFolder` (storage.js) read each cover file, base64-encoded it (byte loop + btoa), and stored the giant `data:` string in `library.json` → re-decoded on every paint, bloated the store.

- **F5 covers → asset URLs** (`storage.js`): `loadCoverFromFolder` now returns `convertFileSrc(coverPath)` (asset:// URL) instead of base64. The webview streams + decodes the file natively and CACHES it across scroll. `saveLibrary` strips any non-`data:` cover URL before persisting (asset URLs are runtime-only + path-dependent) — keeps `library.json` small and re-derives covers from the folder each launch; base64 fallback preserved for un-migrated books. Asset scope already `**`.
- **F4 paint containment** (`global.css` `.book-cover`): `content-visibility: auto` + `contain-intrinsic-size: 110px 155px` — the browser skips painting offscreen covers (image decode + gradient) until scrolled near, with a reserved size so the scrollbar stays stable. Applied to the cover box (not the card container — avoids the position:fixed/hover gotcha); the `:hover` lift rule is untouched.

**Revert:** `loadCoverFromFolder` back to base64 read; `saveLibrary` back to plain `setJSON`; drop `.book-cover` content-visibility.

**Verify:** build green; app boots clean, cards render, no console errors. Cover-scroll gain needs the Tauri app with real book-cover files (browser seed has only gradient notebook cards — the asset-URL path can't be exercised without Tauri FS). Watch that book-cover hover-lift still works in-app (content-visibility on the cover box).

## A42. Forty-first pass — startup speed + library scroll jank (PLAN_STARTUP F1-F3)

Root causes: splash lifted on a fixed 350ms timer regardless of `init()` → grid mounted mid-interaction (spike); every card scheduled its OWN requestIdleCallback gating cover render → N-callback decode storm at open; no virtualization → all cards + absolute cover imgs in one commit → WebKit tile-dropout on scroll ("cards disappear").

- **F1 splash gated on init** (`App.jsx`): `initDone` state set when `init()` resolves, passed to `GnosLoadingScreen`; new dismiss effect lifts the splash at `max(MIN_SHOW 260ms, init-complete)` capped at `MAX_SHOW 2600ms`. Grid is hydrated before the splash fades — no mount storm after. (Old fixed-350ms `quickDismiss` removed; update-available path sets phase 'idle' to halt auto-dismiss.)
- **F2 one shared idle gate** (`LibraryView.jsx` useIdleReady): module-scope latch + subscriber set — a single requestIdleCallback flips all cards' cover-decode gate together (one batched paint), instead of one callback per card.
- **F3 windowed grid**: `visibleCount` (start 60, +60 per idle) slices the ordered card list; resets on filter/collection/tab change. Bounds DOM nodes + compositor layers at open and while scrolling. Full `orderedIds` still drives drag/selection ranges.

**Revert:** restore fixed `quickDismiss` + drop initDone; restore per-card useIdleReady; drop visibleCount window (render full `ordered`).

**Verify:** build green; app boots clean in preview (no GnosLoadingScreen crash after wiring fix), grid renders, no console errors. Real perf gain needs the Tauri app with a large imported library (Web Inspector timeline on launch + paint-flashing on scroll). F4 (cover content-visibility) / F5 (covers off base64) held pending that profiling — see PLAN_STARTUP.md.

## A41. Fortieth pass — YAML frontmatter properties card

- **Frontmatter → properties card** (`NotebookView.jsx`): new `parseFrontmatter` (tiny, no yaml dep) + `frontmatterHtml`. Leading `--- key: value --- ` block renders as a key/value card (live + export); `tags:`/`tag:` values become accent chips, others plain. Live-plugin gotcha fixed: the opening `---` was being consumed as a HorizontalRule widget, overlapping the card decoration (this is why the leading `---` "vanished" from the live DOM). Now `build()` computes the frontmatter char-range up front (`fmEnd`), the HR handler skips any rule inside it, and the card replaces `[0, fmEnd)` as a single non-overlapping widget (cursor-aware — editing reveals raw YAML). CSS `.nb-props/.nb-prop-*` added.
- Excalidraw dark buttons confirmed legible via user screenshot (verifies A40 var fix / task 5.3).

**Revert:** drop parseFrontmatter/frontmatterHtml + renderMarkdown strip + build() fmEnd block + HR skip + CSS.

**Verify:** build green. Live render of the card blocked only by a flaky browser-input harness this session (same HtmlBlockWidget path as progress/rating/toc which DID verify live earlier); logic fixes the confirmed HR-overlap root cause — glance in the Tauri app to confirm.

NOTE: user also supplied a "Mobile changes" spec (full-screen sidebar sheet, bottom nav bar with home/plus/search, library streak-to-top + always-show ellipsis) → captured in PLAN_MOBILE.md as the next batch.

## A40. Thirty-ninth pass — EventKit system calendar + notebook widgets (Obsidian gap)

- **macOS EventKit system calendar** (`src-tauri/src/eventkit.rs`, new; `Cargo.toml` objc2/objc2-event-kit/objc2-foundation/block2 macOS-only deps; `Info.plist` new with NSCalendars(FullAccess)UsageDescription; `lib.rs` module + 2 handlers). `eventkit_fetch(start,end)` requests full access (blocks on the completion block via mpsc), fetches events in range, maps to JSON; `eventkit_status()` probes without prompting. Non-macOS builds compile (stub returns Err). `cargo check` green. JS: `Calendar.jsx` fetches around the visible month on `viewDate` change via `invoke('eventkit_fetch')`, maps to muted-grey read-only events (`source:'system'`, `readOnly`), merged into `allEventsForDate`; all three event click handlers gated `!ev.readOnly` so system events can't open the edit modal. Fails silently off-Tauri/denied. NEEDS the Tauri app to grant permission + verify events appear.
- **Notebook widgets — render live AND in export** (`NotebookView.jsx` renderMarkdown/blockToHtml/inlineToHtml + makeLivePlugin `build()` + `HtmlBlockWidget`; global.css). Preview/export renderers: `%%comment%%` strip, `progress:: 7/10 Label` bar, `rating:: 4/5` stars, `/toc` headings list (auto-slug ids on headings for anchors). Callout `> [!note]`/highlight `==`/footnotes `[^id]` already rendered in export. **Live-mode decorations added** (the real gap — editor is live/source only, no separate preview view): regex passes push `nb-hl` mark for `==`, dimmed `cm-lv-comment` for `%%%%`, and `HtmlBlockWidget` block-replace for progress/rating/toc lines — all cursor-line-aware (editing the line reveals raw source). Slash menu gained /toc, /progress, /rating. Verified live in preview: progress 70% bar, 4 stars, 2-item TOC card, highlight, dimmed comment — screenshot.

**Revert:** drop eventkit.rs + Cargo deps + Info.plist + handler lines + Calendar.jsx sysEvents effect/merge/guards; remove widget renderers + live passes + HtmlBlockWidget + slash entries + CSS.

**Verify:** build green ×3; `cargo check` green; widgets confirmed rendering live in browser preview (screenshot). EventKit needs `npm run tauri:dev` (permission prompt + real calendar).

## A39.1. Blank-notebook root cause FIXED + editor crash hardening

The recurring "notebook blanks when adding widgets" bug is dead. Three layers:

- **ROOT CAUSE**: `lib/notebookEditor.js:963` — the math-calc plugin registers its OWN `cm.autocomplete.autocompletion({override:[varCompleteSource]})`. CM6 permits ONE autocompletion config per editor; any new widget adding another (A39's slash menu, and past widget attempts) → `Error: Config merge conflict for field override` thrown inside `EditorState.create` → unhandled rejection in the mount effect → cmRef never set → **permanently blank page with only a console error**. Invisible to grep because the file contained a raw `\x00` byte (a cache-key separator string) making every tool treat it as binary — now escaped to `' '`, file greps normally.
- **FIX**: single-autocompletion contract. `makeMathCalcPlugin(cm, extraCompletionSources = [])` owns the ONE `autocompletion()` (override: `[...extraSources, varCompleteSource]`); the slash menu became `makeSlashSource()` (a completion SOURCE) passed in by NotebookView. Rule documented at both sites: widgets contribute sources, never call `autocompletion()` themselves — THE contract for future third-party widget plugins.
- **HARDENING** (validated live — it caught this very bug on first run):
  (a) notebook load chain got a `.catch` → blank-copy editor + warning banner instead of eternal blank (also makes the editor mountable in browser dev, where Tauri FS rejects — the whole bug became reproducible in preview thanks to this);
  (b) `safeExt(name, factory)` wraps every optional widget extension — a throwing factory logs, lands in the banner ("widgets disabled: X"), and is skipped;
  (c) safe-mode mount: if `EditorState.create` still throws, retry with a minimal core set (theme/markdown/history/keymaps/save listener) + banner "Editor started in safe mode: <error>".
  New `nbError` state + dismissible banner above the editor; cleared per-notebook.
- **Vite prophylactics**: `resolve.dedupe` + `optimizeDeps.include` for the whole @codemirror family (duplicate module copies are the OTHER classic cause of this exact error).
- **Tab overview below native header**: `.gnos-tab-overview` now `top: TITLEBAR_H` (z 8990) — the real app header (sidebar toggle, search, actions) stays visible and interactive above the switcher, per request. Known cosmetic: an open CM autocomplete tooltip can float above the overlay.

**Verify (all in browser preview — now possible)**: notebook mounts with full extensions, no safe-mode banner; typing `/` opens the styled slash menu (screenshot); overview opens under the intact titlebar (screenshot). Build green ×4.

## A39. Thirty-eighth pass — slash-command menu + overview current-view title

- **Notion-style slash menu** (`NotebookView.jsx` `makeSlashMenu`, wired into live-mode extensions before smartEnter): typing `/` opens a CM6 autocomplete menu of every command. Machinery commands (/table /todo /task /math /timer /linkf /linkw /linkv) insert their command text — existing Enter-keymap expansion machinery stays the single source of truth; snippet commands insert markdown directly: /h1-3, /bullet, /numbered, /check, /quote, /callout (`> [!note]` — renderer comes with B1.1), /divider, /code (cursor inside fence), /mermaid, /date, /wiki. Trigger only at line start/after whitespace. Tooltip styled to app language in global.css (`.cm-tooltip-autocomplete`: surface card, accent selection, label+detail row).
- **Tab overview header** now leads with the CURRENT view's title: "The Odyssey — 4 tabs · type to filter" (verified: "Library — 1 tab · type to filter").

**Revert:** remove makeSlashMenu + its extension line + tooltip CSS; overview title back to count-only.

**Verify:** build green; overview title verified in preview. Slash menu needs Tauri app (notebook content doesn't load in browser): type `/` in a note → menu; `/tab⏎⏎` → table; `/code⏎` → fence with cursor inside.

## A38.1. Reverts by user request

- **Tab overview header bar restored** (count/filter status + "Split layout…" + "Done"); kept from the redesign: content-cover cards, type-to-filter (status shown in the header title), arrow-key nav, focus ring, middle-click close.
- **Audiobook mostly reverted**: play button back to outlined square w/ accent ring; speed picker back to joined accent pills; ONLY the chapters panel keeps a new look — stays LEFT but restyled to the zen-sidebar language (floating rounded card: inset 8px, radius 12, `var(--surface)`, side shadow — mirrors `body.zen-active .sidenav-panel.pinned`). Unused SegmentedControl import + `ap-slide-in-right` keyframe removed.

**Verify:** build green; preview: overview header shows "N tab(s) · type to filter" + both buttons. Audiobook needs Tauri check (zen-card panel).

## A38. Thirty-seventh pass — hardware usage, tab manager, customizer, audiobook, split, Excalidraw dark (PLAN_A38 first pass)

- **Graph render loop sleeps** (`GraphView.jsx` tick): full sim + canvas draw ran 60fps forever once a graph tab existed — even hidden (`display:none`) or window-backgrounded. Now: `document.hidden || canvas.offsetWidth === 0 || tags tab` → 300ms poll instead of rAF (zero-cost check — offsetWidth was already read). Cleanup clears the sleep timer.
- **Excalidraw dark buttons** (`SketchbookView.jsx` bridge): extended the var block with 0.18.0's ACTUAL internal names (read from dist CSS): `--icon-fill-color`, `--color-on-surface`, `--color-on-primary-container`, `--color-surface-primary-container`, `--dropdown-icon`, `--button-hover/active/selected-*`; plus `button svg { color: var(--text) }` currentColor fallback. Version pinned `^0.18.0` → `0.18.0` (bridge is version-coupled). Visual audit per cluster still pending (needs dark Tauri app).
- **Tab manager redesign** (`App.jsx` TabOverview): header bar gone → quiet caption ("N tabs · type to filter") + icon-only split button; cards show REAL content via new `tabCardPreview` (book/audio covers, notebook cover color/img, sketchbook thumbnail — library-card language; generic icon fallback); type-to-filter (letters/Backspace, ESC clears then closes), arrow-key navigation + Enter + ⌘W close, focus ring, middle-click close, hover-only ✕ (already), New-tab card hidden while filtering. Verified: filter "g" → 1 match.
- **Customizer Firefox parity** (`App.jsx`): real toolbar slots are grabbable (window-level pointerdown delegation on `.gnos-tb-slot`, shared drag state with palette chips via window move/up listeners); live drop preview — accent caret inserted at the target index + 16px gap opens (`tb-gap`) + source slot dims (`tb-dragging`), imperative DOM classes driven by a `[drag, target]` effect; dropping anywhere on the palette removes (tray strip = visual affordance); ESC cancels the in-flight drag; slots get grab cursor + hover ring, children `pointer-events:none`. Verified programmatically: slot drag → ghost/caret/dim mid-drag → committed to right zone.
- **Audiobook** (`AudioPlayerView.jsx`): chapters sheet moved left→RIGHT as a NebuliSettings-style panel (border-left, shadow, `ap-slide-in-right`); speed picker → shared `SegmentedControl`; play button: outline-ring square → solid accent circle with accent-tinted shadow. (Transport pill + furniture still open — plan 4.3/4.5.)
- **Split chrome** (`App.jsx`): pane headers gain hover-reveal window-manager buttons — swap sides, expand-pane (unsplit to that tab), close-pane (keep other); divider now 7px grab area with 1px visible line (accent on hover/drag), pointer-drag resizes (`splitRatio` 0.2-0.8 clamped, panes `flex: ratio`), double-click resets 50/50. Verified: drag → 30/70, unsplit works.

**Revert:** each bullet independent — git-revert or: restore rAF-always tick; drop new Excalidraw vars + unpin; restore old TabOverview head/icon cards; restore per-chip-only drag handlers; restore left chapters sheet/joined speed pills/outlined play; remove wm buttons + fixed 1px divider.

**Verify:** build green ×6; preview: tab overview caption/filter/preview-cards, customizer full drag cycle, split resize + unsplit all confirmed by DOM assertions. Console errors = pre-existing Tauri-FS-in-browser noise. Needs Tauri app: Excalidraw dark audit (5.3), graph CPU drop w/ hidden tab.

## A37. Thirty-sixth pass — reader: rapid-flip blank pages fixed + page-number hover

- **Rapid-flip blank pages fixed** (`ReaderView.jsx` nextPage/prevPage/scheduleSettle): the rapid burst path used to skip `showPage` entirely and only advance the counter — the strip stayed frozen on a stale transform, and crossing a chapter boundary mid-burst fired `setCurChapter` racing the buffer swap → the strip could land empty (blank). Root: the skip existed to avoid layout backlog, but the actual costs (highlight rescan, progress write) were already removed in earlier passes, so a bare `showPage` is now just a compositor transform. New `flipTo(np, ch, trans, rapid)` helper ALWAYS translates the strip per tap (instant when rapid via showPage's own <120ms detection; animated when slow); the React page-number update is what's deferred to settle (avoids re-rendering the 2.6k-line view every keypress), not the content move. `scheduleSettle` now only commits `setCurPage` + `saveProgress` (content already positioned). Content scrubs live during bursts — no freeze, no settle-jump, no blank.
- **Page number furniture**: shows just the number by default; hover reveals "N of total" (absolute page + total when the persistent index is complete, else chapter-local). New `pagenumHover` state.

**Revert:** restore the rapid counter-only branches + old scheduleSettle (showPage in settle); furniture back to always "X of N".

**Verify:** build green; preview boots clean (reader needs Tauri FS). In-app: hold arrow key fast within a chapter — pages scrub visibly, no blank frames; fast across chapter boundaries — old page holds, no blank; number alone shown, hover → "N of total".

## A36. Thirty-fifth pass — reader R5: transient GPU layer, scanner discipline, persistent page index

Root-caused the residual flip lag (research: WebKit large-layer tile raster + our own scanner cadence) + brought back EXACT global page numbers the Apple-Books way (compute once per layout, persist, never recompute per flip).

- **A. Transient layer promotion** (`Paginationengine.js`): the strip is the whole chapter (tens of thousands of px). It carried a PERMANENT `will-change:transform` → a giant compositor layer whose cold tiles stall the first flip into never-shown columns (the "page 1→2" + random stutters). Removed permanent promotion from strip creation and `swapBufferToStrip`; added `promoteStrip()` called by `showPage` — sets `will-change` during an active flip burst, drops it 600ms after the last turn. Tiles rasterize once per burst and cache; idle reading holds no giant layer. `invalidateCache` clears the de-promote timer.
- **B. Scanner discipline**: `PREWARM_RADIUS` 3→2; nav backoff 1.2s→3s so a scan-step layout never lands between reading-cadence turns.
- **C. Persistent pagination index** (`ReaderView.jsx` + engine `getLayoutMetrics`, `scanAllChapters` `hasCount` skip): once every chapter is measured for the current layout, `chapterPageCountsRef` is cached to disk under `reader_pageindex_<bookId>[layoutKey]` (layoutKey = fontSize|lineSpacing|fontFamily|justify|weight|twoPage|colWxcolH). Reopen at same layout → counts restored from disk instantly, exact "page X of N" shown, zero re-measure. Build runs at DEEP idle (4s) and the scan already backs off 3s on nav; `hasCount` makes it resumable across the `_scanAbort` restarts chapter-nav triggers (never re-lays-out a measured chapter). Layout change (font/size/resize/two-page) → `setIndexComplete(false)` + rebuild for the new key, "calculating pages…" shown meanwhile. Global numbers appear ONLY when complete (no estimates, no per-flip recompute — reverses A34's removal correctly: the sin was computing on open on the main thread with no persistence). `startBackgroundScan` now branches: complete → neighbor-HTML prewarm only; incomplete → `ensurePageIndex` (restore or schedule build). `handleRebuild` invalidates the index; `load()` sets `bookIdRef`/resets index early.

**Revert:** re-add permanent `will-change` to strip + swap, drop `promoteStrip`; radius 3 + 1.2s; strip all index code (`ensurePageIndex`/`runIndexBuild`/`startNeighborPrewarm`/`computeLayoutKey`/`getLayoutMetrics`/`hasCount`, indexComplete state, global furniture branch) back to chapter-local only.

**Verify:** build green ×3, preview boots no console errors (reader needs Tauri FS). In-app: (1) first page 1→2 flip smooth, no stutter; rapid flipping smooth; (2) open a book, read ~5s → "calculating pages…" → settles to "page X of N", flip around: number exact + instant, never recomputing; (3) reopen same book → numbers instant from disk; (4) change font size → reverts to "X of Y in chapter" + recalculates.

## A35. Thirty-fourth pass — reader R4: chapter flash eliminated (double-buffer), two-page gutters

- **Chapter-transition flash killed**: transitions used to raise a solid overlay (blank readerCard flash) while the new chapter laid out in the visible strip. Now both chapter paths (cache hit AND miss) render into the hidden buffer element (`renderChapterIntoBuffer`) and atomically role-swap buffer↔strip (`swapBufferToStrip(pageIdx)`) — old page stays on screen until the exact frame the new one is fully laid out, then swaps with the transform pre-applied. Zero blank frames; layout is never repeated on swap (elements exchange roles, no node moves). Buffer doubles as the scan container (`_scanAbort` takeover); demoted strip is emptied and becomes the next buffer. Engine also gained `getCachedChapter` (read-only lookup); `loadCachedChapter`/`raiseOverlay` no longer used by the chapter path (kept for compat; overlay still used by initial load + rebuild via `renderChapterContent`).
- **Two-page side gutters**: `.reader-card.two-page { max-width: min(1400px, calc(100% - 150px)) }` — hover chevrons never overlap the text columns.

**Revert:** restore old chapter effect (loadCachedChapter + raiseOverlay + renderChapterContent paths); drop buffer exports; two-page max-width back to 1400px.

**Verify:** build green ×2. In-app: hold arrow key across chapter boundaries — no blank flash, old page persists until new chapter appears; two-page arrows sit in clear gutters.

## A34. Thirty-third pass — reader R3: full-book scan freeze killed, global page numbers removed

User report: first clicks after opening a book froze an M4 Pro. Cause: `scanAllChapters` laid out EVERY chapter of the book into the hidden scan container (each a synchronous multi-hundred-ms CSS-column layout, 10× worse with word-wrap spans), re-triggered after every chapter switch, with `requestIdleCallback(timeout:2000)` forcing steps mid-interaction. Also explains why the global page estimate was garbage: `getTotalPages` guessed unmeasured chapters from the average and re-jumped every scan tick — accurate global totals REQUIRE laying out the whole book, i.e. the freeze. Both fixed by dropping global numbers (user's call).

- **Engine** (`Paginationengine.js`): `_scanOrder` gains `neighborsOnly` — scan = ±3 neighbors, nothing else. `step()` backs off (1.2s retry) while `_lastNavTime` is fresh so a scan layout can never land mid-flip; already-prewarmed chapters skip layout and reuse the cached count.
- **View** (`ReaderView.jsx`): `startBackgroundScan` passes `neighborsOnly: true`. Page furniture now chapter-local: center "X of Y in chapter" (exact) + bottom-right "N pages left". Removed: `handlePageJump`, `pageInput` state, `getTotalPages` import, `totalPages/globalPage/displayPage/displayTotal` deriveds; `pct` (focus-mode progress) now chapter-local. Focus footer shows `page X/Y` in chapter. ChapterDropdown: global `p. N` labels + "Go to page N" entry removed (offsets would lie with unmeasured chapters); typing a number still jumps to that chapter index.
- `.reader-pagenum-input` CSS + dropdown `chapterStartPages` map deleted (dead).

**Revert:** restore full `_scanOrder` iteration + no backoff; restore getTotalPages-based deriveds, furniture globals, handlePageJump/pageInput, dropdown page labels/jump. (Don't — global totals can't be both accurate and cheap in this architecture.)

**Verify:** build green ×3. In-app: open a big EPUB → flip immediately, no freeze (scan touches ≤6 chapters, only when nav idle >1.2s); furniture shows "X of Y in chapter"; dropdown has no page labels.

## A33. Thirty-second pass — reader R2: flip lag fixed, Books-style furniture

Research-verified (epub.js/foliate both bottleneck on CSS-column layout — our strip design already avoids it; lag was React/store fan-out).

- **Flip lag root causes fixed** (`ReaderView.jsx`):
  (a) `applyHighlightsToCard` ran on EVERY page flip — O(word-spans × highlights) sliding-window scan over thousands of spans. Removed from nextPage/prevPage/scheduleSettle; highlight classes live on the strip DOM and survive translates. Still applied on chapter render (×2 paths), rebuild, and highlight creation.
  (b) `saveProgress` wrote `updateBookProgress` per flip → new `library` array → re-rendered every subscriber incl. the kept-alive LibraryView grid. Now debounced 400ms with an unmount flush (updateBookProgress + persistLibrary from refs) so closing the tab can't lose position.
  (c) Card components (`BookCard/AudiobookCard/NotebookCard/SketchbookCard/FlashcardDeckCard`) wrapped in `React.memo` — any future library write stops repainting untouched cards.
- **Chapter dropdown fixed**: A32's `overflow:hidden` on `.gnos-titlebar-search` clipped the `.gnos-tbs-drop` panel. Removed (input truncates via its own `min-width:0`).
- **Running head removed** (duplicated titlebar info; user request).
- **Footer bar deleted** → Books-style page furniture on the paper: `.reader-pagenum` centered under the column (`25%/75%` in two-page, `50%` single), click → inline jump input (same handlePageJump); `.reader-pagesleft` "N pages left in chapter" bottom-right. Engine reserves `COL_BOTTOM_PAD = 28` under the strip. Prev/Next buttons + progress bar gone — nav = margin chevrons/keys/tap zones (margin hover-chevrons now render regardless of tapToTurn; outer tap-zones still pref-gated). `atStart/atEnd` dead vars removed; `pct` kept (focus mode).
- **Paper polish**: reader card side rules removed (one clean sheet); two-page gets a faint `::after` gutter gradient; chapter `h2` now centered + letter-spaced (1.45× size, 600 weight) — Gospel-Library-style chapter openings.

**Revert:** restore footer JSX + `.reader-footer` usage, side borders, h2 style (1.65×/700/left), `tapToTurnLive` gates, per-flip applyHighlights + immediate saveProgress, remove memo wrappers/`COL_BOTTOM_PAD`/furniture CSS; re-add `overflow:hidden` (don't).

**Verify:** build green ×3; app boots clean in preview (reader needs Tauri). In-app: rapid arrow-key flips smooth with a big library + a second tab open; chapter dropdown opens from search bar; page numbers/pages-left render on paper; click number → jump; two-page gutter; no footer bar.

## A32. Thirty-first pass — reader speed + typography + search (PLAN_READER R1)

Save-icon relocation + reader phases 1-3. Engine = `src/lib/Paginationengine.js`, view = `src/views/ReaderView.jsx`.

- **Save flash → search bar**: `#nb-save-icon` moved from the titlebar lead zone into a new `.gnos-tbs-glyph` slot inside `TitlebarSearch` — magnifier fades out while the check-ring flashes over it (`:has(.nb-save-icon.vis)`), zero layout shift. `renderItem('save')` now returns null (kept for layout compat); pane-header icons (`nbsave-<tabId>`, global.css) untouched — TAB_CSS absolute rule scoped to `.gnos-tbs-glyph .nb-save-icon`.
- **Chapter prewarm** (engine): `scanAllChapters(…, { around })` scans neighbors first (±1..±3) and caches their RENDERED HTML into `_chapterCache` (scan container has identical geometry) — next/prev chapter switch becomes an instant cache-hit swap. `prunePrewarm(around)` bounds memory to ±3 chapters (called from `startBackgroundScan`).
- **Position anchoring** (engine + view): `getVisibleChildIndex(pageIdx)` / `pageOfChild(childIdx)` — `handleRebuild` records the first visible block before relayout and restores it after, so font-size changes / resizes / two-page toggles keep the same paragraph on screen (was: same page index → wrong position). Two-page snaps to spread boundary.
- **Rebuild coalescing**: `requestRebuild()` (250ms debounce) wired to SettingsPanel `onRebuild` and ⌘+/- zoom — rapid changes relayout once.
- **contain + lang**: strip wrapper gets `contain:layout style paint`; `setupColumns` sets `lang` (from new `dc:language` parse in bookImport.js → `book.language`) so `hyphens:auto` actually uses WebKit hyphenation dictionaries. Existing books lack `language` — fallback 'en'.
- **Typography** (buildPageStyles): `-webkit-hyphenate-limit-before/after: 3`, `-limit-lines: 2`, `font-kerning: normal`, `text-wrap: pretty` on paragraphs (hanging-punctuation/orphans/widows/onum were already present). New running head (`.reader-running-head`, global.css ~643): book title left / chapter title right, uppercase 9.5px, in the card's top pad; width follows two-page via `:has`.
- **In-book search**: third "Search" tab in ReviewPanel — full-text over in-memory chapter blocks (min 2 chars, cap 100, highlighted snippet with chapter label). Click → `locateBlock(chIdx, blockIdx)`: same-chapter resolves block→page instantly; cross-chapter stashes `pendingLocateRef` which the chapter-render effect resolves (both cache-hit and full-render paths) — lands on the exact page containing the match.
- Dictionary already existed (dictionaryapi.dev); footnote popovers skipped — import pipeline stores plain-text blocks, inline anchors don't survive import (would need bookImport rework).

**Revert:** restore `renderItem('save')` svg + `.nb-save-indicator` collapse rule and drop `.gnos-tbs-glyph`; engine — remove `_scanOrder`/`prunePrewarm`/anchor helpers + scan `opts`, restore plain iteration; view — restore old `handleRebuild` (clamped pg), drop `requestRebuild`/`locateBlock`/`resolvePendingLocate`/Search tab; bookImport — drop `dc:language`/`language` field; styles — drop hyphenate/kerning/pretty lines + `.reader-running-head`.

**Verify:** `npm run build` green ×3. Browser preview can't load book content (Tauri FS) — needs in-app pass: chapter next/prev instant after ~2s idle; ⌘+ font change keeps paragraph; running head shows; ReviewPanel Search finds + jumps to exact page; hyphenation visible in justified text.

## A31. Thirtieth pass — titlebar zones fixed for good, graph canvas readability

- **Root cause of the "toggle/home pushed left" bug**: `.gnos-tb-left` is a FIXED-width zone (172px, `justify-content:flex-end`, 88px traffic-light padding) that fits exactly two buttons; A30's Import button made three → overflow shoved the group into the traffic lights. Rule: never add buttons to `.gnos-tb-left`.
- **New `.gnos-tb-ctx` zone** (normal flex flow, right of the lead zone): holds the Calendar and Nebuli quick-open buttons (moved from `.gnos-tb-right`); each hides while its view is the active tab. Import .ics moved to the RIGHT zone (calendar view only, before `layout.right`), still via the `gnos:import-ics` CustomEvent.
- **Header can no longer self-overlap**: the absolutely-centered `.gnos-tb-center` now sizes off `--tb-clear`, measured live by a ResizeObserver on left/ctx/right zones (set on the `.gnos-titlebar` element; `min(560px, calc(100vw - 2*var(--tb-clear)))`). Search bar made shrinkable (`min-width:64px`, center children `min-width:0`) so the center degrades by truncating search instead of overflowing. Verified: zero overlap at 740px wide.
- **"+ Event" restyle**: solid accent square → app-standard ghost button (surfaceAlt bg, border, accent-colored plus glyph, accent border on hover) — matches Today/nav buttons.
- **Graph canvas readability**: label pills get a hairline `--border` stroke; canvas fonts switched from `system-ui` to `'Stack Sans Text'` (labels + sector labels).
- **A31.1 follow-up (user feedback)**: contrast ring removed ("no borders on nodes"); node fill now near-solid (`E6`) with no per-node stroke; hardcoded purple edge colors replaced with theme-derived — normal edges `textColor` at low alpha (neutral gray, Obsidian-like), connected edges `--accent` (via new `hexWithAlpha` helper reading live vars each frame). Equal header spacing: invisible `.nb-save-indicator` (22px) in the lead zone was the phantom gap between Home and the ctx buttons — collapsed to width 0 unless the save icon is flashing (`:not(:has(.nb-save-icon.vis))`), ctx margin removed (lead zone's trailing 3px flex gap provides the spacing). Verified: toggle→home→ctx gaps all 3px.

**Revert:** delete `.gnos-tb-ctx` block + CSS and move quick-opens back to `.gnos-tb-right`; restore `width: min(560px, calc(100vw - 520px))` on center + `min-width:120px` on search; drop the ref-callback observer; restore solid-accent + Event button; remove contrast ring/pill stroke/font changes in GraphView tick().

**Verify:** build green. Preview at 740px: Add ends x449, Import starts x454, New event 485 — no overlap; calendar view shows toggle/home/nebuli left (calendar btn hidden), import+add+event+switcher right; graph view hides nebuli btn, shows calendar btn; nodes show dark contrast ring — screenshots.

## A30. Twenty-ninth pass — graph polish, calendar modernization, startup lag

Executes PLAN_NEXT_PASS.md (now done; file can be deleted).

- **Nebuli header icon-only** (`GraphView.jsx` QuickAccess block): Reset → reload glyph, Settings → gear, tab switcher → `SegmentedControl` with graph/tag icons (icon support added to `SegmentedControl.jsx`: option `{value,label,icon}`, icon-only when no `showLabel`, label becomes tooltip). Fits at 800px width.
- **Graph canvas**: hover dimming (non-neighbors → 0.35 alpha, edges touching hovered node boosted, rest ×0.3 — mirrors existing selection dimming); ambient labels fade in with zoom (`labelFade = (z-0.45)/0.3` clamped, selected/hovered/hub exempt); Simulation presets row (Calm 0.4/0.6, Default 1/1, Energetic 1.8/1.6 → orbitSpeed/lerpRate).
- **Tags tab rebuilt** (`TagsHeatmap`): search input, Count/A–Z sort (SegmentedControl), min-uses range slider, "N of M tags" counter; word-cloud spans → tinted chip buttons (color-mix bg/border/text, bucketed 11–17px); **click tag → sets `filterTags` to that tag + jumps to Connections tab** (`onTagClick` prop wired at render site). Bar chart unchanged, respects filters.
- **Calendar titlebar**: "Open Calendar" quick-open button hidden while active tab view is `calendar` (App.jsx right zone). New "Import calendar (.ics)" icon button in the LEFT zone next to Home, calendar-view only — dispatches `gnos:import-ics` CustomEvent; FullCalendar (fullHeight only) listens and clicks its hidden file input. Import button + ics toast removed from the QuickAccess portal (toast now renders beside the inline date nav) — portal is just `+` and Month/Week/Day, search-bar clipping gone.
- **EventModal**: MiniCalendar collapsed behind a compact formatted-date row (chevron, accent border when open; picking a date closes it); color grid of big squares → single row of 18px circle swatches with selection ring (kanban/sketch swatch language).
- **Startup lag**: `loadPlugins()` moved from immediately-post-hydration to `requestIdleCallback` (timeout 6s) in App.jsx init; `loading="lazy" decoding="async"` added to NotebookCard/SketchbookCard/collection-stack cover imgs (book cards already had it). NOTE: no sql.js found in `src/lib` (stale memory) — skipped. If lag persists in Tauri app, profile: card mount flood → windowed grid render is next lever.

**Revert:** git-revert the pass; discrete pieces: SegmentedControl icon prop, GraphView hovIds/labelFade blocks + presets row, TagsHeatmap controls block, App.jsx calendar-view conditionals + `gnos:import-ics` button, Calendar.jsx listener + `{!fullHeight && …}` import guards + showDatePicker state, App.jsx loadPlugins idle wrapper, LibraryView img attrs.

**Verify:** `npm run build` green ×5. Browser preview (dark): graph header icons fit at 800px; settings shows preset row; tags tab shows controls + empty state (seed data tagless — chip/click path untested visually); calendar titlebar has import at left, no calendar icon, `+`+switcher right, no search clipping; EventModal shows date row expanding to MiniCalendar + circle swatches — screenshots. No console errors. Hover dimming/label fade + .ics event wiring need a look in the Tauri app with real data.

## A29. Twenty-eighth pass — Nebuli/Calendar/Excalidraw unification

Design-language pass unifying graph + calendar + sketchbook with the app conventions (no view headers, theme-var colors, shared canvas backgrounds).

- **Calendar extracted** from `LibraryView.jsx` (~780 lines) into `src/components/Calendar.jsx` (FullCalendar, EventModal, MiniCalendar, MonthYearPicker, event helpers). `LibraryView` re-exports `FullCalendar` for back-compat; `CalendarView` imports from the new module. Kanban helpers (`CARD_COLORS`, `makeCardId/ColId/CmtId`) stayed in LibraryView. Unused `CloseBtn` dropped.
- **New shared modules**: `src/components/SegmentedControl.jsx` (the surfaceAlt-pill switcher; now used by calendar Month/Week/Day and graph Connections/Tags) and `src/lib/canvasSurface.js` (dot/line/grid background painter + `hexLuminance`/`isThemeDark` + device-pixel snapping; single source for canvas-surface constants).
- **Calendar theming**: event pills are now tinted chips (`color-mix` bg 18-20% over `--surface`, tinted text, 3px left color bar) instead of solid hex + white text — readable on all themes. `.ics` default color uses `EVENT_COLORS[0]` not hardcoded `#388bfd`. Full-page calendar portals its actions (import icon, `+`, Month/Week/Day) into the global header via `QuickAccess`; date nav (‹ › Today Month-label) stays inline above the grid. NOTE: `.gnos-tb-center` is absolutely centered with ~250px clearance per side — quick-access content must stay compact or it overlaps the search bar.
- **Nebuli graph**: in-view header removed; Reset/Settings/tab-switcher portal into the global header. Node/edge counts moved into the bottom-right hint. Node palette is theme-aware — `LIGHT_NODE_COLORS` (darkened 0.72×) auto-selected per frame from `--bg` luminance so yellow/green nodes stay readable on light themes; legend/panels/filters read the same palette. Dot grid uses shared canvasSurface constants (22px/1.2px/0.18).
- **Sketchbook (Excalidraw)**: `paintDotGrid` now delegates to the shared painter (device-pixel-snapped offsets — kills fractional-zoom shimmer). New effect subscribes `api.onScrollChange` + a `ResizeObserver` on the wrapper so the grid repaints on programmatic scroll and container resize (both previously left it stale → the resize/scroll de-sync). `getThemeConfig` fallback for custom themes now derives `canvasBg` from `--surface` (keeps content-card contrast, was `--bg`) and stroke from `--text`. CSS bridge patched: HintViewer, Tooltip, Modal/ExportDialog/HelpDialog, sidebar/library container, color-picker interior, `input[type=range]` accent (now in all themes, was dark-only).

**Revert:** delete `src/components/Calendar.jsx`, `src/components/SegmentedControl.jsx`, `src/lib/canvasSurface.js`; restore FullCalendar block into LibraryView (git); restore GraphView in-view header + fixed `NODE_COLORS` reads; restore SketchbookView inline `paintDotGrid` body, `--bg`-based fallback, and drop the bridge additions + scroll/resize effect.

**Verify:** `npm run build` green. Live (dark, browser preview): graph header shows Reset/Settings/segmented in titlebar, counts bottom-right; calendar full-page shows date nav inline + actions in titlebar with no overlap; created event renders as tinted chip with left color bar — screenshots. Excalidraw chrome + light-theme palette need a visual pass in the Tauri app (browser preview has no FS, sketch content won't load).

## A28. Twenty-seventh pass — sidebar restyle toward Safari/Comet

Adopted the flat, monotone browser-sidebar aesthetic (reference: Safari light + Comet dark). Decisions confirmed with the user first: neutral pill + accent-icon cue, fully flat (removes last pass's elevation), keep 12.5px/600 weight, style-only (no new controls).

- **Fully flat again** (`Sidenav.jsx` `.sidenav-panel.pinned`): background `var(--surface)` → `var(--bg)` (= content tone), inset right-edge shadow removed. Sidebar + content are one continuous monotone canvas — no border, no shadow, no elevation. (This intentionally reverses the A24 raised-page look; the user chose the flat ref style.)
- **Neutral active pill + accent-icon cue**: `.sidenav-nav-item.active` was accent-blue tint pill + accent text; now a neutral `var(--surfaceAlt)` gray pill with a full-strength `var(--text)` label — the accent survives only on the active row's **icon** (`.sidenav-nav-item.active .sidenav-nav-icon { color: var(--accent) }`) as a small brand cue. This matches the refs' single-neutral-pill pattern and unifies with the Tabs section (which already used a neutral pill + accent dot).
- Weight/spacing/labels unchanged (kept the bolder 12.5px/600 per the user's call); no inline section actions added.

**Revert:** `.sidenav-panel.pinned` back to `background: var(--surface)` + `box-shadow: inset -11px 0 14px -12px rgba(0,0,0,0.35) !important`; `.sidenav-nav-item.active` back to `color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent)` and drop the accent `color` from the active `.sidenav-nav-icon`.

**Verify:** `npm run build` green. Live (dark): panel bg `rgb(13,17,23)` == body bg, `box-shadow: none`; active pill bg `rgb(28,33,40)` (surfaceAlt), label `rgb(230,237,243)` (text), active icon `rgb(56,139,253)` (accent) — screenshot matches the flat/neutral reference look.

## A27. Twenty-sixth pass — app sans → Stack Sans Text

Swapped the app's primary sans from Satoshi/Switzer to **Stack Sans Text** (Koto, built for Stack Overflow; free on Google Fonts — the user picked it over Libre Franklin after a compare). Loaded via a Google Fonts `<link>` in `index.html` (`Stack+Sans+Text:wght@400;500;600;700`); Satoshi/Switzer kept as fallbacks.

- `global.css` vars: `--font-ui`, `--font-sub`, `--font-body`, `--font-prose` (both the base and the modernization-block override) now lead with `'Stack Sans Text'`. `--font-title` still leads with Clash Display (display headings), just with Stack Sans as the fallback. `--font-logo`/`--font-serif` (Lora) untouched — book covers stay serif.
- Inline font stacks across `NotebookView`, `QuickNoteView`, `FlashcardView`, `ProfileWindowView`, `SettingsWindowView` (every `'Satoshi', 'Switzer'` / `'Switzer', 'Satoshi'` / `'Switzer', system-ui` variant) prepended with `'Stack Sans Text'`.

**Revert:** in `index.html` drop the `Stack+Sans+Text` family from the Google Fonts link; run the inverse of the prepend across the five view files + `global.css` vars (remove the leading `'Stack Sans Text', `).

**Verify:** `npm run build` green. Live: `document.fonts.check("14px 'Stack Sans Text'")` → true (font actually loaded), `body` computed font-family leads with `"Stack Sans Text"`; notebook prose + UI render in the new geometric sans — screenshot (heading still Clash Display).

## A26. Twenty-fifth pass — de-clutter the "+" add popup

- **Simplified the add popup** (`AddPopup` + `LibContextMenu` in `LibraryView.jsx`): dropped every `<small>` subtitle (`.epub · .txt · .md · .pdf`, `Markdown · wikilinks · live preview`, etc.), shortened each item to a single word (Import Book → **Book**, Import Audiobook → **Audiobook**, New Notebook → **Notebook**, New Sketchbook → **Sketchbook**, New Flashcard Deck → **Flashcards**, New Collection → **Collection**), and shortened the header "Add to Library" → **Add**. The two-line `.add-choice-text` span/small markup collapsed to a single `.add-choice-label` (13px). Icons unchanged, so each row is now icon + one word.

**Revert:** restore the `<div className="add-choice-text"><span>…</span><small>…</small></div>` markup + long titles + "Add to Library" header, and the `.add-choice-text span/small` CSS (replacing `.add-choice-label`).

**Verify:** `npm run build` green. Live: popup header reads "Add" with items Book / Audiobook / Notebook / Sketchbook / Flashcards / Collection, no sublines — screenshot.

## A25. Twenty-fourth pass — Calendar + Nebuli header buttons

- **Calendar + Nebuli graph moved to the titlebar** (`App.jsx`): two new `.gnos-settings-btn` icon buttons in `.gnos-tb-right`, rendered just left of the tab-manager button. Calendar (`navigate({ view: 'calendar' })`) switches the current tab; Nebuli (`openNewTab({ view: 'graph' })`) opens the graph in a new tab — same actions the add popup used.
- **Removed "Open Nebuli" from the "+" add popups** (`LibraryView.jsx`): deleted the entry from both `AddPopup` (the titlebar + and library +) and `LibContextMenu` (right-click-empty add menu), and dropped the now-unused `onOpenNebuli` prop from both signatures + all call sites. (Calendar was never in the add popup — it lives in search/profile — so nothing to remove there.)

**Revert:** remove the two buttons from `.gnos-tb-right` in App.jsx; re-add the `onOpenNebuli` "Open Nebuli" button to `AddPopup` + `LibContextMenu` and their props/callers.

**Verify:** `npm run build` green, eslint no new errors. Live: titlebar right reads `Add · Open Calendar · Open Nebuli graph · Show all tabs`; clicking Calendar sets the active tab's view to `calendar`, Nebuli opens a 2nd tab with view `graph`; the "+" popup now lists only Import Book/Audiobook + New Notebook/Sketchbook/Flashcard Deck/Collection (no Nebuli) — screenshot.

## A24. Twenty-third pass — sidebar elevation + proper zen titlebar reveal

- **Sidebar is a raised base with the page elevated above it**: `.sidenav-panel.pinned` background back to `var(--surface)` (that's `#fff` in Light, and each theme's relatively-lighter tone), plus an inset right-edge shadow (`inset -11px 0 14px -12px rgba(0,0,0,0.35)`) that reads as the content page casting onto the recessed sidebar — the page now sits visibly higher in elevation. (The previous flat-`--bg` look is gone; this is the intentional two-plane look the user asked for.)
- **Zen titlebar slides away + reveals on hover** (replaces the opacity:0 "bad fix"): `body.zen-active .gnos-titlebar` now `translateY(-100%)` (slid up, animated) and slides back to `translateY(0)` when `.zen-peek-top` is set. New `zenPeekTop` state in App.jsx, driven by the same zen mousemove handler (mouse within 12px of the top edge → reveal; below 72px → hide after 600ms), mirroring the existing left-edge sidebar peek.
- **Cmd+\ works in zen**: the shortcut still toggles `sideNavOpen`, which adds `.open` to the panel; new rule `body.zen-active .sidenav-panel.pinned.open` forces the sidebar visible (as the floating card) so you can open it persistently, not just peek it.
- **Zen sidebar clears the traffic lights**: kept `top: 44px` on the zen floating card so it sits below the macOS window controls instead of clipping through them.

**Revert:** `.sidenav-panel.pinned` bg back to `var(--bg)` + `box-shadow: none`; in global.css restore `body.zen-active .gnos-titlebar { opacity: 0; pointer-events: none }` and remove the `.zen-peek-top` + `.pinned.open` rules; remove `zenPeekTop` state, its mousemove branch, and the `zen-peek-top` className in App.jsx.

**Verify:** eslint (App.jsx's 2 flags pre-existing) + `npm run build` green. Live (dark): non-zen sidebar bg `rgb(22,27,34)` (surface) vs body `rgb(13,17,23)` with the inset shadow applied and content pushed 238px; zen titlebar `translateY(-34px)` hidden → `translateY(0)` on `.zen-peek-top`; zen sidebar `top: 44px`, shown via `.open` (Cmd+\).

## A23. Twenty-second pass — zen sidebar sits under the traffic lights

- **Zen sidebar clears the traffic lights**: the zen hover-overlay panel had `top: 0`, so its rounded card started at the very top-left and clipped through the macOS traffic-light buttons. Moved to `top: 44px` so the floating card sits *underneath* the lights.
- **Zen sidebar is a proper floating card again**: the zen override didn't set a background, so it inherited the flush `var(--bg)` from `.pinned` — meaning the zen "plateau" was the same colour as the canvas. Added `background: var(--surface) !important` so the zen peek is a distinct floating card (which is what the plateau *should* be in zen — the flush one-colour treatment is only for non-zen).
- **Note on the non-zen "plateau still there" report**: the current source already renders the open sidebar flush and flat — verified live in both dark and light themes (panel bg === body bg, `border-radius: 0`, `box-shadow: none`, `border-right: 0`, content pushed 238px). The screenshot showing a floating rounded card is from a **packaged build that predates the A20–A22 sidebar changes**; a rebuild of the Tauri app picks up the flush look. No further code change was needed for non-zen.

**Revert:** set the `body.zen-active .sidenav-panel.pinned` `top` back to `0` and drop the `background: var(--surface)` line.

**Verify:** eslint (1 pre-existing warning) + `npm run build` green. Live: non-zen sidebar flat one-colour in dark (bg `rgb(13,17,23)`) and light (`rgb(246,248,250)`) — matches body; zen peek card at `top: 44px`, `left: 8px`, radius 12, surface bg distinct from content, hidden (`translateX -254`) until `zen-force-nav` slides it to 0, no content push.

## A22. Twenty-first pass — zen traffic-light space + flat sidebar

- **Zen keeps room for the macOS traffic lights**: last pass zeroed the content's top padding in zen, which slid content under the traffic-light dots. Removed that `padding-top: 0` override — the wrapper keeps its inline `TITLEBAR_H` (34px) top gap, so the top strip stays clear (titlebar chrome is still hidden via opacity). No more UI fighting up there.
- **Flat, non-floating sidebar**: the flush sidebar used `var(--surface)` (a shade lighter than the `var(--bg)` content) plus a right border, so it read as a card floating over the canvas. Changed `.sidenav-panel.pinned` to `background: var(--bg)` with `border-right: none` — sidebar + content are now one continuous colour (the active-item accent pill still gives the current row definition). The floating-card `var(--surface)` look is kept only for the non-flush overlay states (split-pane / zen peek), where a card is correct.
- **Reverted the A18 titlebar seam special-case**: that hack (transparent titlebar border + a `::after` hairline starting at 238px) existed *because* the sidebar used to match the titlebar's surface colour. Now that the sidebar is `var(--bg)`, the titlebar's normal full-width `border-bottom` is correct and even again — removed the `body:has(.sidenav-panel.pinned)` override from App.jsx.

**Revert:** re-add `padding-top: 0 !important` to `body.zen-active .sidenav-push-wrapper`; set `.sidenav-panel.pinned` back to `var(--surface)` + `border-right: 1px solid var(--borderSubtle)`; restore the A18 `body:has(.sidenav-panel.pinned) .gnos-titlebar` transparent-border + `::after` rules in App.jsx.

**Verify:** eslint (App.jsx's 2 issues are pre-existing) + `npm run build` green. Confirmed live: open sidebar bg `rgb(13,17,23)` == body bg, border-right 0 (flat, screenshot); zen keeps wrapper padding-top 34px with titlebar opacity 0 (traffic-light space preserved).

## A21. Twentieth pass — Shortcuts settings tab + zen hides the titlebar

- **Shortcuts tab in Settings** (`SettingsWindowView.jsx`): new sidebar section (`id: 'shortcuts'`, keyboard-glyph icon) that renders a static `SHORTCUT_GROUPS` reference — Windows & Navigation / Tabs / Library / Editing — each shortcut shown as individual `<kbd>` chips (new `.sw-kbd-combo` flex row; reuses the existing `.sw-kbd` chip). Keys are pulled from the real bindings (App.jsx keydown handlers + the native menu accelerators in `lib.rs`). Dropped the JS ⌘1–9 "switch to tab" line from the list because it collides with the native menu's ⌘1–5 (Library sections) — listed the menu ones since those are the authoritative, menu-bar-visible bindings.
- **Zen mode now hides the top titlebar too** (`global.css`): zen already hid the per-view headers but left the top window titlebar (omnibar + tab strip). Added `body.zen-active .gnos-titlebar { opacity: 0; pointer-events: none }` and `body.zen-active .sidenav-push-wrapper { padding-top: 0 !important }` — the wrapper's inline `padding-top: TITLEBAR_H` reserved 34px, so content now reclaims it for a fully chromeless canvas. Native macOS traffic lights still fade in on hover (Overlay title-bar style).

**Revert:** remove the `shortcuts` SECTIONS entry + `SHORTCUT_GROUPS` + its render block + `.sw-kbd-combo` in `SettingsWindowView.jsx`; remove the `body.zen-active .gnos-titlebar` + `.sidenav-push-wrapper` padding rules in `global.css`.

**Verify:** eslint clean (1 pre-existing warning) + `npm run build` green. Zen titlebar-hide confirmed live: entering zen sets titlebar opacity 0 / pointer-events none and wrapper padding-top 34px→0 (content fills to top) — screenshot. Shortcuts tab is a Tauri-only Settings window (no browser-preview route) — verified by wiring check + lint/build + code review.

## A20. Nineteenth pass — flush sidebar, zen overlay, ctx colors, book menu (again)

- **Sidebar is now flush/integrated whenever open** (Arc/Dia style): reused the "pinned" flush-and-push visual for *any* open main sidebar, not just the always-visible pref. `Sidenav.jsx` panel gets `.pinned` when `(sidebarPinned || sideNavOpen) && !isSplitPane`; `App.jsx` push-wrapper gets `pushed pinned` when open (flush 238px margin, no floating card, no backdrop). The `sidebarPinned` pref now just controls "always-on vs toggleable" — both look flush. Removed the old floating-card backdrop + gutter-fill for the main sidebar (kept backdrop for split-pane float only).
- **Zen mode overlays instead of pushing**: added `body.zen-active` overrides in global.css that revert the flush panel back to a floating card, hide it off-screen (`translateX(calc(-100% - 16px)) !important` — needed `!important` to beat `.pinned`'s own `!important`), and drop the content push (`margin-left: 0`). The existing left-edge peek (`zen-force-nav`) slides it in as an overlay. So: normal = flush + push; zen = chromeless canvas with a hover-in sidebar.
- **Book / audiobook menus fixed — the actual root cause**: `showBookMenu` had a dead self-referencing line `const ICON_EDIT = ICON_EDIT` (collateral from an earlier `perl` icon-swap that replaced the pencil SVG string with the constant name inside the function's own local `const`). That's a TDZ error — the function **threw on the first line every time**, from both the ⋯ dots button *and* right-click, so no book/PDF menu ever opened. (Prior passes' "verified working" checks had unknowingly hit notebook cards, which use a different, un-broken function.) Removed the line; also deleted a now-unused `const ICON_SKETCH = ICON_EDIT` left by the same swap. Secondary fixes that were also needed: the Books/Audiobooks/Notebooks dedicated-tab wrappers called `e.preventDefault()` unconditionally in `onPointerDown`, which cancels the dots button's `click` — guarded with `|| e.target.closest('button')`; and added `stopPropagation` + `onContextMenu` to the book/audio cards to match the working types.
- **Context-menu colors**: icon color now tracks the row's text via `currentColor` (was a fixed `--textMuted` gray) — so a normal row's icon matches its label exactly, and the **Delete** row's icon goes red along with its text (the `danger` inline `#ef5350` now flows to the icon too). Dropped the hover-turns-icon-accent rule so icon+text stay unified.

**Revert:** `Sidenav.jsx` panel `.pinned` back to `sidebarPinned && !isSplitPane`, restore the `!sidebarPinned` backdrop + gutter-fill; `App.jsx` wrapper back to `pushed` + separate `pinned` on `sidebarPinned`; remove the `body.zen-active .sidenav-panel.pinned` / `.pushed` overrides in global.css; ctx-menu `svg` color back to `var(--textMuted)` + re-add `:hover svg { color: var(--accent) }`; remove `stopPropagation` from the two book/audio dots buttons.

**Verify:** eslint (16 errors, all pre-existing) + `npm run build` green. Confirmed live: toggled-open sidebar is flush (panel `.pinned`, left 0, no backdrop, content margin 238) — screenshot; zen mode hides the panel (translateX −254) and peeks it in on `zen-force-nav` with no push; book dots menu opens; every ctx row's icon color equals its text, Delete both red — screenshot.

## A19. Eighteenth pass — ctx-menu weight, book/pdf menu fix, sidebar polish

- **Context-menu text weight**: `.lib-ctx-item` in global.css 500 → **600** (Switzer is static so 550 would round; 600 is the real next step up). Reads solid instead of thin.
- **Book / audiobook right-click menus were dead** (the "ereader/pdf files context menus do not work" report): `BookCard` and `AudiobookCard` in LibraryView had `onClick` to open but **no `onContextMenu`** — right-clicking an epub/pdf/txt/audio card did nothing, while notebook/sketchbook/deck cards worked. Added `onContextMenu={e => { e.preventDefault(); onMenu(e, book) }}` to both card containers, so right-click anywhere on the card opens the same menu the ⋯ button gives.
- **Sidebar polish**: the main Library nav rows (`.sidenav-nav-item`) were flat full-bleed rows at 12px/500 — the Tabs section right below them already used rounded pills, so the nav read as unfinished by comparison. Now rounded 8px pills with an 8px side margin (icon still aligns to the section label), 12.5px/**600** text, and the active state is a `color-mix` accent tint pill instead of a hard-edged full-width block. Brings the nav in line with the app's pill language.

**Revert:** global.css `.lib-ctx-item` weight back to (no weight / 500); remove the two `onContextMenu` handlers on BookCard/AudiobookCard; restore `.sidenav-nav-item` to `padding: 6px 9px 6px 16px; width:100%; font-size:12px; font-weight:500;` with no radius/margin and the `rgba(56,139,253,0.08)` active bg.

**Verify:** eslint (Sidenav 0 errors; LibraryView net −1 vs baseline, all pre-existing) + `npm run build` green. Confirmed live: menu text renders at 600, right-click on a `.book-card-container` opens the menu (was dead), sidebar screenshot shows rounded nav pills.

## A18. Seventeenth pass — ctx-menu icon system, sidebar seam, unified Edit dialog

All in `LibraryView.jsx` + one CSS block in `App.jsx`.

- **Context-menu icon system**: every card/collection context-menu glyph redrawn as one family — 16×16, 1.5px stroke, round caps/joins — matching the titlebar/settings icon language. New constants near the `show*Menu` builders: `ICON_BOOK/AUDIO/NB/SB/CARDS/EDIT/COLLECT/MOVE/TRASH/SEARCH/NEWTAB`. Killed 12+ inline duplicated icon strings (incl. a malformed `v0` arc in the old book glyph, the clunky 3-rect "Add to Collection", and the pencil being reused for both Edit and Sketchbook). Sketchbooks now have their own pencil-in-canvas glyph distinct from Edit's pen. Comment at the constants tells future edits to stay in-family.
- **Sidebar seam (pinned mode)**: the titlebar's full-width `var(--border)` hairline cut across the top of the pinned sidebar while the sidebar's right border was `var(--borderSubtle)` — two mismatched lines meeting unevenly, making the sidebar feel detached. Fixed in `App.jsx` TAB_CSS with `body:has(.sidenav-panel.pinned)` rules: titlebar border-bottom goes transparent and a `::after` hairline is drawn only from `left: 238px` (SIDEBAR_WIDTH) rightward in `var(--borderSubtle)` — titlebar+sidebar now read as one continuous chrome surface with a single even L-line around the content.
- **Unified Edit dialog**: replaced three near-duplicate modals (`EditNotebookModal`, `EditAudiobookModal`, `EditBookMetaModal`, ~200 lines) with one `EditItemModal({heading, item, fields, colors})`. Field list per type: book = author/rating/tags/description; audio = author/color/image; notebook = color/image; sketchbook = image; **collection = color** (new — collections never had a proper edit dialog). Consistent everywhere: autofocused + preselected Name field, **Enter saves, Esc cancels**. Collection context menus' separate "Rename" + "Change Color" (hex-swatch submenu) collapsed into one "Edit…"; the collection header's ⋯ "Rename" also became "Edit…" (inline click-to-rename on the title is kept as the fast path). `COLLECTION_COLORS`/`NB_COLORS` hoisted to module scope.
- **Bug fix**: all four item onSave handlers did `await persist…()` *before* closing the modal — a persist failure left the dialog stuck open. Now they close immediately and persist in the background with a warn on failure.

**Revert:** restore the old ICON_* constants + inline icon strings, the three deleted modal components and their render blocks, the Rename/Change Color menu items, and drop the `body:has(.sidenav-panel.pinned)` rules in App.jsx.

**Verify:** eslint (14 errors, all pre-existing — actually 2 fewer than before), `npm run build` green. Confirmed live in browser preview: pinned-sidebar seam screenshot (continuous chrome), notebook context menu screenshot (new icons), Edit dialog screenshot, and full flow right-click → Edit… → type → Enter closes + renames.

## A17. Sixteenth pass — lock profile window, Recently Active list, popup clamp

- **Profile window non-resizable** (`lib.rs`): added `.resizable(false)`, dropped `min_inner_size` (moot when fixed). Stays 600×720. Note: a window pre-warmed in a prior session keeps its old resizable state until the next fresh launch.
- **"Recently Active" section fills the review empty space** (`ProfileContent.jsx`): a list of the 6 most-recently-touched files across every type the profile sees — books, audiobooks, notebooks — each with a color-coded type badge (Book=accent, Audio=accentSecondary purple, Note=green), title, a per-type sub (book progress % / notebook word count), and a relative timestamp ("2d ago"). We don't track true per-file *time spent* (only aggregate daily minutes), so recency via `updatedAt` (falling back to `addedAt`/`createdAt`) is the honest cross-type signal. `nowMs` captured once via `useState(() => Date.now())` and relative times precomputed in the `useMemo` to keep `Date.now()` out of the render body (satisfies `react-hooks/purity`).
- **Popup clip fix** (`LibraryView.jsx`): the card context-menu's "Add to Collection" flyout had no vertical clamp — near the bottom of the window it ran off-screen. Extracted the flyout into a self-clamping `CtxSubmenu` component whose `useLayoutEffect` measures its own rect and (1) flips it to the left of the parent item if it overruns the right edge, (2) pins it near the top + enables scroll if it's taller than the viewport, else (3) shifts it up by the overflow amount if it runs past the bottom. Verified via a synthetic worst-case (a tall menu at the bottom-right corner ends up fully inside the viewport). Applies to every ContextMenu submenu, incl. the collection color/rename flyouts.

**Revert:** `lib.rs` remove `.resizable(false)` (restore `min_inner_size(560,560)`); `ProfileContent.jsx` remove the `recentActive` memo + `nowMs` + `relTime`/`TYPE_COLOR` module helpers + the "Recently Active" render block; `LibraryView.jsx` inline `CtxSubmenu` back into `ContextMenu` as the old `top:-4` absolute div with `subLeft`/`subRight`.

**Verify:** `cargo check` + `eslint` (ProfileContent clean; LibraryView's 16 errors are all pre-existing unused-vars on unrelated lines) + `npm run build` green. Recently-Active list confirmed live in browser (screenshot); submenu clamp confirmed via in-page geometry test (`insideViewport: true`).

## A16. Fifteenth pass — profile window size + de-gradient the bars

- **Profile window default size**: `lib.rs` bumped `inner_size` 560×640 → **600×720**, and raised `min_inner_size` 440×480 → **560×560** so the content never gets clipped narrower than it's designed for (no manual resize needed). Note: a window pre-warmed in a prior session keeps its old size until the next fresh launch — new size applies from build time.
- **Removed the bar gradient**: the vertical accent gradient read as tacky. Bars are now a clean solid fill — `color-mix(var(--accent) 82%)` at rest, full `var(--accent)` on hover — keeping the rounded tops. All the good bits (gridlines, dashed AVG line, trend line, hover tooltips + insights) untouched.

**Revert:** in `lib.rs` restore `inner_size(560,640)` + `min_inner_size(440,480)`; in `ProfileContent.jsx` restore the `linear-gradient(...)` bar background + the old opacity/boxShadow/brightness hover treatment.

**Verify:** `cargo check` + `eslint` clean. Solid bars confirmed live in browser preview (screenshot).

## A15. Fourteenth pass — modernized review graphs + rich hover

All in `src/components/ProfileContent.jsx` (shared by the in-app `ProfileModal` and the standalone profile window, so both get it).

- **Custom hover tooltips (replaces the native `title=` popups)**: a floating card with a weekday/date header, a large duration value (`fmtMins` → `1h 8m` / `45 min`), and an insight line. Follows the cursor (`position:fixed` at `clientX/Y`), has a pointer nub, and a small fade-in. Shared `renderTip()` + `tip` state used by both the bar chart and the heatmap. (Written as a `renderTip()` function, not a `<HoverTip>` component, to satisfy the `react-hooks/static-components` lint rule.)
- **Bar-chart insights**: each bar's tooltip computes context — "▲ Best day" for the period max, "▲ N% vs avg" / "▼ N% vs avg" (green/terracotta) relative to the period's per-day average, or "Around average". Empty days read "No study logged".
- **Modernized bar chart**: flat single-color bars → vertical accent gradient with rounded tops; hovered bar brightens + gets an accent ring; added faint horizontal gridlines, a dashed **AVG** reference line (labeled), and an `avg N min/day` caption in the section header. The existing dashed linear-regression trend line was kept and re-fitted to the new plot height.
- **Heatmap hover**: same tooltip, with a level label (`No activity` / `Light session` / `Moderate` / `Focused` / `Deep focus`) and an accent outline on the hovered cell — was a bare browser `title`.

**Revert:** `git checkout src/components/ProfileContent.jsx` (all changes are in that one file).

**Verify:** `eslint` + `npm run build` clean. Confirmed live in browser preview (the in-app ProfileModal renders ProfileContent): screenshots show the gradient bars + AVG/trend lines, and hovering a bar produced the "SUN, JUL 5 / 1h 8m / ▲ Best day" card; the heatmap hover produced the weekday/level card. (Reading-log data was injected via the React fiber for the shot since the browser has no Tauri fs; real data flows the same render path.)

## A14. Thirteenth pass — keep the profile window warm

The bundle-split (A13) shrank the profile chunk, but the dominant cost remained: the native title-bar **close button destroyed the window**, so every reopen paid a full cold WebKit + React + vendor boot (and the new dynamic import added a module waterfall on that cold path — likely why it felt slower, not faster). Fixed by keeping the window warm.

- **Hide-on-close (`src-tauri/src/lib.rs`)**: extracted `build_or_show_profile_window(app, visible)`. The built window gets a `CloseRequested` handler that calls `api.prevent_close()` + `win.hide()` — so closing hides instead of destroys. Every open after the first is a native `show()`/`set_focus()` with zero webview or JS reload.
- **Pre-warm at idle**: new `prewarm_profile_window` command builds the window hidden (`.visible(false)`). `App.jsx` calls it via `requestIdleCallback` (2s `setTimeout` fallback) after `init()` completes — so even the *first* user open is an instant show(), and the warm build never competes with app launch.
- **Refresh-on-show**: because the window is now long-lived (warmed once, hidden between opens), it would otherwise show stale stats. `build_or_show_profile_window` emits a `profile:refresh` event when showing an existing window; `ProfileWindowView.jsx`'s data load was extracted into a reusable `load()` that runs on mount *and* on every `profile:refresh`, with a `disposed` guard on the async listener setup.

**Net:** first open ≈ instant (pre-warmed), every subsequent open = native show(), data always fresh.

**Revert:** in `lib.rs` collapse `build_or_show_profile_window` back into the old `open_profile_window` (reuse-or-build, no close handler, no `.visible()`), delete `prewarm_profile_window` + its handler-list entry + the `profile:refresh` emit; in `App.jsx` remove the `prewarm`/`requestIdleCallback` block; in `ProfileWindowView.jsx` revert `load()`+listener back to the one-shot `boot()`.

**Verify:** `cargo check` + `eslint` (no new errors; the 2 App.jsx lint errors are pre-existing) + `npm run build` all green. Profile window is Tauri-only (no browser-preview route) — verified by compile/lint/build + code review, not a live screenshot.

## A13. Twelfth pass — tab-manager icon, profile window speed + cleanup

- **Tab manager icon**: replaced the four-square grid glyph with a two-overlapping-rounded-window icon (open L-shaped "back" square + closed "front" square), matching a reference image. Two call sites updated in `App.jsx` — the live titlebar button (`case 'tabManager'` in the titlebar render switch) and the matching glyph in `chipIcon()` (used by the Customize Toolbar drag palette), so both stay visually in sync.
- **Profile window — removed the dead circular avatar**: `.pw-avatar` (initial-letter circle) had no click handler and led nowhere; the in-app `ProfileModal` (`LibraryView.jsx`) never had one either, so this makes the standalone window consistent with it. Replaced with a title + subtitle ("`N books · N notebooks`") — same header real estate, but it's no longer a decorative dead-end.
- **Profile window — fixed the slow cold load**: `ProfileWindowView.jsx` was calling `loadLibrary()`/`loadNotebooksMeta()`, which do a full per-folder `readDir` + read-every-`meta.json` + (for library) base64-decode-every-cover-image reconciliation scan — the same expensive pass `useAppStore.init()`'s "fast pass" optimization (see the "Empty-view flash" note further down this file) exists specifically to avoid blocking on. Since this window opens cold with zero cache, that scan was the entire multi-second delay. Swapped both for direct `getJSON('library', [])` / `getJSON('notebooks_meta', [])` — flat, single-file reads, run in parallel with `loadPreferences()`. Trade-off: a book cover that only ever got written to its folder (never back to the flat index) won't show here — `ProfileContent` already falls back to a numbered placeholder for a missing `coverDataUrl`, so this degrades invisibly, matching the same trade-off the main window already accepts.
- **Profile window — loading state**: blank `<div>` flash replaced with the app's existing `.spinner` (global.css), centered, drag region preserved so the window stays draggable while loading.
- **Profile window — the actual speed fix (bundle split)**: the flat-read swap above helped the *data* load, but the dominant delay was the JS bundle itself. `main.jsx` statically imported `App.jsx`, which transitively pulls the entire heavy dep tree (Excalidraw, CodeMirror, mermaid ~1.4MB, KaTeX, Algebrite…). Because it was a static import, the lightweight profile/settings/quicknote windows had to download + parse + evaluate all of it before their first paint. Reworked `main.jsx` to branch on the Tauri window label and `await import()` only the needed root — so each secondary window gets its own tiny code-split chunk (profile is now **3.16 KB / 1.38 KB gzip**, was bundled into App's multi-MB chunk). Excalidraw's CSS import also moved behind the main-app branch (only the sketchbook view needs it). This is the change that makes the window open effectively instantly.

**Revert:** restore the four-rect grid SVGs in `App.jsx` (both call sites) from git history; restore `loadLibrary`/`loadNotebooksMeta` imports + calls and the `.pw-avatar` div in `ProfileWindowView.jsx`; restore `main.jsx`'s static top-level imports of `App`/`QuickNoteView`/`SettingsWindowView`/`ProfileWindowView` + the Excalidraw CSS import, replacing the async `mount()` with the old synchronous `Root` ternary + `render`.

**Verify:** `eslint` + `npm run build` clean. Tab-manager icon confirmed live in browser preview (desktop titlebar screenshot). Profile window is a Tauri-only window (label `profile`, no browser-preview route — same limitation noted for Settings/QuickNote) — verified by code review + lint/build only, not a live screenshot.

## A12. Eleventh pass — remove the inline "=" ghost

`notebookEditor.js`: deleted the whole ghost-hint subsystem — `MathGhostWidget`, the `mathPlugin` ViewPlugin that computed the dim inline suggestion after a typed "=", and the `mathKeymap` Tab-to-insert handler. Typing "=" (or "=:.N" for a rounding-precision override) no longer inserts anything into the document or shows dim inline text next to the cursor; the answer only ever appears as the bold right-column result (already built in A10), which now renders unconditionally (dropped the "suppress while ghost is active" check in `mathResultsPlugin`).

`"=:.N"` precision is preserved but now handled in `buildDocScope` instead of the (removed) ghost logic: new `stripTrailingEquals()` extracts the precision digits before evaluating, `applyPrecisionToDisplay()` rounds the leading numeric part of the result (keeping any unit/currency suffix) before it reaches the right column. Aggregates (`prev`/`sum`/`average`) still use the unrounded raw value — only the displayed digits for that specific line are rounded.

**Bug fix along the way:** the existing "Label: expr" colon-split (for lines like `Utilities: 8% of Rent`) was misreading the colon inside `=:.N` as a label separator — `2*32.12321 =:.2` was being mangled to just `.2` before evaluation. Fixed by excluding `=` from the label character class (`/^[^:=]+:\s*(.+)$/`), so a colon that's part of `=:.N` no longer triggers the label split.

**Revert:** restore `MathGhostWidget` + `mathPlugin` + `mathKeymap` from git history, re-add the ghost-suppression check in `mathResultsPlugin`, and revert `stripTrailingEquals`/`applyPrecisionToDisplay` back to the old plain regex-strip (which discarded precision).

**Verify:** `eslint` shows the same 3 pre-existing errors (none new), `npm run build` green. Confirmed live in browser preview: no `.cm-math-ghost` element ever renders; `=:.2`/`=:.1` correctly round the right-column value (`64.25`, `20`) while `sum` downstream still uses the unrounded values.

## A11. Tenth pass — Switzer replaces Author

Swapped the "Author" sans (Fontshare) for "Switzer" (Fontshare) everywhere it was used as the prose/UI-body font — cleaner, more neutral neo-grotesque. Same CDN, one-line swap: `index.html`'s Fontshare link now pulls `switzer@400,500,600,700` instead of `author@400,500,600,700`. Every `'Author'` font-family reference across `global.css`, `NotebookView.jsx`, `ProfileWindowView.jsx`, `FlashcardView.jsx`, `SettingsWindowView.jsx`, `QuickNoteView.jsx` renamed to `'Switzer'` (including the unquoted `'Author, Satoshi, sans-serif'` list variants in NotebookView's CodeMirror highlight styles). Satoshi (UI chrome) and Lora (logo/book covers) untouched.

**Revert:** `perl -pi -e "s/'Switzer'/'Author'/g"` across the same six files, restore `author@400,500,600,700` in `index.html`'s Fontshare link.

**Verify:** `eslint` shows zero new errors from this change (pre-existing NotebookView.jsx lint debt unaffected). `npm run build` green. Confirmed live in browser preview — `document.fonts` shows Switzer loaded, notebook editor's computed font-family resolves to `Switzer, Satoshi, sans-serif`.

## A10. Ninth pass — result text style, Quick Note tab, drag-to-resize

- **Math result display**: right-column results were a bordered/filled pill; now plain bold accent-colored text (`.cm-math-result` in `notebookEditor.js` — removed background/border/radius/padding, kept click-to-copy with an opacity flash instead of an inverted background). Revert: restore the earlier `mathResultTheme` block (background/border/radius/padding + inverted `-copied` state).
- **Quick Note settings moved to its own tab**: was a group crammed into General; now a dedicated sidebar section (`SettingsWindowView.jsx`, id `quicknote`) with its own icon, split into "Quick Note" (shortcut, save location), "Appearance" (fan peek toggle), and "Window size" groups.
- **Drag-to-resize preview**: the window-size control is now a scaled-down "example window" (`QuickNoteSizePreview`, ~0.26x scale, max 900×1000) with a corner grip handle — drag it to resize, snapped to 10px, with live dimension label. Steppers underneath still allow exact width/height entry. Drag only commits (persists + resizes the real popup via `setQuickNoteSize`) on release; the box itself updates live during the drag. Revert: restore the two-Stepper-only Row that used to sit in the General tab.
- **Verify:** `eslint` + `npm run build` clean. Math-result styling confirmed live via browser preview (screenshot). Quick Note tab/resize preview are Tauri-window-only UI — not browser-previewable (see A9's note); reviewed by code read only.

## A9. Eighth pass — quick note resizing + lighter shadow

- **Resizable, persisted window size**: Settings → General → Quick Note → "Window size" (width/height steppers, 280–900 / 240–1000px). Dragging the popup's edges by hand also persists (debounced `onResized` listener). New Rust command `quick_note_set_size(width, height, show)` (`src-tauri/src/lib.rs`) resizes the live window and optionally reveals it; new pref `quickNoteSize` (`{ width, height }`), added to `persistPreferences()`'s whitelist.
  - The quicknote window now builds `.visible(false)` and stays hidden until the frontend reads the saved size and calls `quick_note_set_size(..., show: true)` — otherwise it would flash at the 400×540 default before snapping to the saved size on every launch. Wrapped in try/finally so a prefs-read failure can never leave it stuck invisible.
  - QuickNoteView writes the drag-resized size straight to the prefs file (`loadPreferences()` + `savePreferences()`), not through the store's `persistPreferences()` — the quicknote window's Zustand store only carries local state, never the full prefs blob, so going through the store would have clobbered every other setting with defaults.
  - **Revert:** drop the `quickNoteSize` Row + `setQuickNoteSize` in `SettingsWindowView.jsx`; remove the `onResized` effect + boot's size/show logic in `QuickNoteView.jsx`; remove `quick_note_set_size` + `.visible(false)` in `lib.rs` (restore plain `.build()` reveal); drop `quickNoteSize` from `persistPreferences()`.
- **Shadow**: `.qn-card`'s box-shadow was `0 16px 44px rgba(0,0,0,.5)` — with the native macOS window shadow already off (see A-prior note in `lib.rs`), that CSS shadow was the only one left, and at that size/opacity it drew a visible dark halo floating over the desktop behind the transparent window. Tightened to `0 4px 14px rgba(0,0,0,.28), 0 1px 3px rgba(0,0,0,.2)` — reads as a thin card edge instead. Revert: restore the old box-shadow value in `QuickNoteView.jsx`'s `QN_CSS`.
- **Verify:** `cargo check` + `eslint` both clean. The quicknote/settings windows are Tauri-only (gated by window label in `main.jsx`) with no browser-preview route, so live visual confirmation needs a real `tauri dev` launch — not verified in-browser.

## A8. Seventh pass — numi-style notebook calculator

All in `src/lib/notebookEditor.js` (shared by NotebookView + QuickNoteView). Still opt-in via `/math` … `/math end` zones.

- **Right-column result chips**: every evaluable line in a `/math` zone shows its result as a pill pinned to the right edge (accent-tinted, tabular numbers, click to copy). Styled via CM `baseTheme` inside the plugin — no view CSS was touched. Chip hides while the ghost `=` hint is active on that line. Revert: remove `mathResultsPlugin` + `mathResultTheme` from the return array in `makeMathCalcPlugin`.
- **Aggregates**: `prev`, `sum`/`total`, `average`/`avg`/`mean` reference earlier line results (sum/average over the contiguous run above; blank lines and headings reset the run; unit-aware via mathjs `add`).
- **Natural language**: word numbers ("twenty five times four", "3 million"), `5k`/`2M`/`1bn` magnitudes, percent grammar ("20% of 80", "200 + 10%", "25% off 80", "increase X by 15%", "30 as % of 120"), "half of / double / squared / square root of", `x` as multiply, "in" as conversion ("100 usd in eur").
- **Offline currency**: ~34 currencies + BTC/ETH as mathjs units with a **static approximate rate snapshot** (`FX_PER_USD` table, mid-2026) — no network, ever. `$`/`€`/`£`/`¥`/`₹`/`₩` symbols map to units. Update the table to refresh rates.
- **CSS units**: `px`/`pt`/`em` at 96 ppi (`pt` overrides mathjs's pint alias; `pint` still works).
- **Timezones**: "time in tokyo", "9am in london" via `Intl` + a bundled city→IANA map (offline).
- **Chip display formatting**: thousands separators + FP-noise trimming (display only; Tab-inserted ghost results stay plain/parseable).

**Revert:** `git checkout` `src/lib/notebookEditor.js` (whole subsystem lives in this one file).

## A7. Sixth pass — typography, speed, premium controls

- **Typography**: notebook headings/body/title dropped the Erode/Georgia serif for **Author** (soft humanist sans, already loaded from Fontshare); flashcard faces and `--font-prose` likewise. Book covers keep their serif (bookish on purpose). Revert: swap `'Author', 'Satoshi', sans-serif` back to `'Erode', Georgia, serif` in NotebookView + delete item 11 in the global block.
- **Sidebar logo**: "Gnos" wordmark → quill + line SVG mark.
- **Launch speed**: splash no longer blocks on the updater network check (was up to 2.5s + 600ms minimum every launch; now ~350ms flash, check continues in background and fires `gnos:update-available` if something lands). Notebook/sketchbook/library/audio folder meta reads now run in parallel instead of serially per folder.
- **Premium controls (item 12 in global block)**: Apple-style sliders (4px track, accent fill via `--fill`, white 19px knob) + iOS-style toggles across reader/audio panels; panel selects and section labels cleaned up. Audio speed + sleep timer are segmented controls now.
- **Quicknote**: note flipping is **horizontal** (two-finger swipe left = older, right = newer / new note); fanned card slivers peek from the left (older exist) and right (newer exist) edges; previously saved notes that are emptied out are **auto-deleted** from disk + the quicknotes collection.
- **Notebook engine perf**: shared per-doc string cache (was re-serializing the whole document 4-5× per keystroke across decoration builders); task-board/table/columns builders bail immediately when the doc contains no `/task` / `|` / `{columns:` .
- **Inline widgets (item 13 in global block)**: habits/calendar/pomodoro/kanban containers unified to the timer-pill language — surfaceAlt, hairline borders, 12px radius, softer card shadows.
- **Customize Toolbar**: right-click the title bar → Firefox-style panel with toggles for Home, arrows, add, save indicator, page actions, tab manager (search is always on). Persisted in `titlebarItems` pref.
- **Bug fix**: clicking a backlink/tag result in the notebook Backlinks panel threw (`paneTabId is not defined` — pre-existing); now uses the store's active tab.


Every visual change from this pass, with revert instructions. Ask Claude to revert any numbered item, or do it yourself as described.

## A. Global CSS modernization block

All rules live in **one block at the very end of `src/styles/global.css`**, under the banner `UI MODERNIZATION PASS — July 2026`. **Deleting that whole block reverts items 1–9 at once.** Individual items are numbered comments inside the block:

1. **Type rendering** — antialiased font smoothing + accent-tinted text selection.
2. **Scrollbars** — thin inset rounded thumb, invisible track, darkens on hover (was: 6px flat thumb on a bg-colored track).
3. **Focus rings** — keyboard focus (`:focus-visible`) now shows a consistent accent outline on buttons/inputs/links.
4. **Header** — removed the doubled bottom edge (border + 1px shadow line made a "double rule"); now a single hairline.
5. **Header buttons** — plus button no longer scales up on hover (subtle glow instead); round icon buttons are borderless until hovered; filter button lost its blue outer glow.
6. **Menus/popovers** — context menus and dropdowns get a deeper two-layer shadow, rounded inset hover rows, and a 130ms fade/slide entrance (disabled under reduced-motion).
7. **Library spacing** — tab panel padding 16/36 → 20/40, grid gap 28 → 30.
8. **Book cards** — softer resting shadow, radius 7 → 8, hover lift 4px → 3px with a wider soft shadow.
9. **Reduced motion** — new popover animation respects `prefers-reduced-motion`.

10. **File card under-text** — card titles switch from serif Lora to the UI sans (Satoshi) at 12.5px semibold; author line drops the ALL-CAPS letter-spaced treatment for a plain 11px dim line.

## A2. Browser-style chrome (second pass)

These are structural (JSX) changes, revert via git or by asking:

- **Sidebar toggle** — `GnosNavButton` (was the "Gnos ›" logo button in every view header) is now a traditional sidebar icon that purely opens/closes; a copy lives permanently in the title bar. Library header no longer has its own.
- **Top tab strip removed permanently** — this is no longer a toggle. The top-of-window tab strip and its "+" are gone for good; tabs always dock in the sidebar's "Open Tabs" section and are managed via the tab-overview grid. Back/forward arrows stay in the title bar.
- **Search + add live in the title bar** — always on, not gated by any preference. Search opens the same dropdown as before; add opens the same popup, and now correctly respects "Open on create" (highlights the new item in the grid instead of jumping to it when that preference is off).
- **Tab overview** — grid button in the title bar opens a Safari-style all-tabs grid (Esc closes, x closes tabs, includes New Tab card and "Split layout…" access).
- **View menu** — the quick type-filter chips (All/Books/Audio/Notes/Sketches/Cards) and Manage Collections moved from the library header into the native macOS View menu (⌘⌥0–5, ⌘⇧M). A small dismissible badge shows in the header when a filter/workspace is active.
- **Gnos menu** — new "Profile…" and "Settings…" (⌘,) items; the header's profile/gear icon buttons are gone.
- **Settings window** — dedicated macOS-style settings window (sidebar categories, grouped rows) replaces the in-app modal on desktop; mobile keeps the modal. Changes sync live to the main window.
- **Bigger title-bar icons** — sidebar toggle, tab-overview, and back/forward icons enlarged (were reported as too small).

### A3. Quick note — removed Option key note

Shortcut is **⌥N (Option+N)**, not right-⌘N. The right-command-only version used a low-level keyboard event tap (`rdev`) that crashed the app; it's been removed entirely in favor of the standard OS global-shortcut API.

## A4. Title-bar layout (third pass)

Title bar is now a three-section layout (`.gnos-tb-left / -center / -right` in `App.jsx` TAB_CSS), with a full-width drag layer behind it:

- **Left**: sidebar toggle + new **Home** button (clears the active collection and returns to Library).
- **Center (absolutely centered in the window)**: back/forward arrows + the search bar. Search now shows the **current page's title** as its idle text (Safari omnibar style) — click it to search the whole library. This "title in the search bar" applies to every view, not just Library.
- **Right**: add button, then the **tab-overview button pinned to the far right**. It's now a **toggle** — clicking it while the overview is open closes it (and it highlights while open).
- **Per-page settings → native menu**: View → **Page Settings…** (⌘⌥,) opens the settings panel for whatever view is active (reader/pdf/notebook/sketchbook/audio); on Library/other it opens the settings window. Each view already had a settings command event; audio got a new `gnos:audio-cmd` listener.

### Tab overview restyle
- No longer covers the sidebar — the overlay starts to the right of the sidebar when it's open (`leftOffset`).
- Lighter background, softer card shadows, close-buttons appear on hover — matches the rest of the app.

### Sidebar tabs — Zen-style
- The sidebar's "Tabs" list is always shown (even with one tab), rows are rounded pills with an active highlight, close-on-hover, and a "New tab" row at the bottom. Switching tabs from here keeps the sidebar open (Zen behavior).

## A5. Header removal + quick-access strip (fourth pass)

Title bar layout: **left** sidebar toggle + Home · **center** ‹ › + omnibar + add (all centered) · **right** per-view quick-access buttons | tab manager. Search text is bold; new icons thickened.

- **Quick-access strip** (`#gnos-quick-access`, `src/components/QuickAccess.jsx`) — views portal their action buttons into the title bar; only the active tab's buttons show. Omnibar extras (counts, dropdowns) via `useTitlebarMeta`.
- **PDF**: header removed; Fit / − % + zoom controls → quick access.
- **Reader (books)**: header removed. Chapter dropdown lives *inside the omnibar* (chevron; current chapter shown as count text). Bookmarks + notes combined into one panel ("Bookmarks & Notes" — bookmark-this-page button moved inside it). TTS + settings → quick access.
- **Notebook**: header removed. View switcher, share/upload, settings → quick access. Word count → omnibar. In-document find is now a floating bar (⌘F or quick-access search icon).
- **Audiobooks**: header removed; chapters toggle + playback settings → quick access; chapters sidebar sits flush under the title bar (floating "Chapters" pill deleted).
- **Sketchbook**: header removed. Save dot, background-style cycle button (shows current style's icon: dots→lines→grid→none), lock, PDF import, share → quick access. Shape count → omnibar. Contrast fix: custom themes now derive light/dark canvas from the actual background color instead of always assuming dark. Old background picker panel still opens via View → Page Settings.
- **Flashcards**: header removed; share → quick access; cards/due/streak + front-back flip + Study/Edit → new footer bar at the bottom. (Deck rename now via library/sidebar edit.)
- **Quicknote**: markdown renders inline (CodeMirror styling), 15px font, save dot only (top-right), focus outlines killed (the two blue lines). Scroll past top of newest note = new note (if it has text); scroll past bottom = older quick notes; "n / total" pill flashes while flipping.
- **Sidebar pinned option** — Settings → General → "Sidebar always visible": flush native panel (no float/shadow/radius, hairline right border, content permanently pushed). Off = previous floating behavior.
- **Settings window** — macOS overlay title bar (traffic lights over the sidebar), full-height sidebar like System Settings.
- **Profile window** — Gnos menu → Profile… now opens a dedicated window (avatar, streak dots, reading time, per-type counts).

## A6. Fifth pass — polish + notebook settings relocation

- **Nav arrows**: rounded SVG chevrons (were sharp ‹ › glyphs), sized to match the other titlebar icons and vertically centered.
- **Per-view settings icons**: reader gets an "Aa" text-size icon, audio gets a speaker/waveform icon — no more generic gear duplicated everywhere.
- **Notebook settings gear removed** — the old panel bundled two unrelated things: a static markdown syntax cheat sheet and per-note backlinks/tag search. The cheat sheet moved to **Settings → Notebook → Markdown Syntax Reference** (`src/lib/markdownSyntaxRef.js`, shared by the settings window). The backlinks/tag-search panel stayed, now opened by a dedicated "Backlinks & Tags" (chain icon) button in quick access instead of a generic gear.
- **Save indicator moved to the title bar's top-left**, next to the sidebar toggle and Home button — one shared `#nb-save-icon` element that both the notebook and sketchbook save logic target (previously two near-duplicate indicators lived in each view's quick-access strip).
- **Notebook quick-access icons** (find, view mode, share, backlinks) lost their boxed border — they use the same borderless `.gnos-settings-btn` style as the rest of the title bar now.
- **Quick notes** saved to the archive are automatically added to a **"quicknotes" collection** (auto-created on first save). The main window re-syncs its in-memory collections list when a quick note saves, so it doesn't get overwritten by a later `persistCollections()` call from the main window.

## B. Timer widget restyle (antinote-look)

`src/views/NotebookView.jsx` — `TimerWidget` + `.cm-timer-*` CSS:

- Compact pill (max 260px), label now sits inline next to the time instead of above it.
- Time 22px bold → 19px semibold; progress bar 4px → 2px hairline.
- Pause/reset buttons are hidden until you hover the widget, then fade in as ghost icons.
- Finished state pulses the time in accent color.

**Revert:** `git diff` the `TimerWidget` class and the `/* ── Timer widget` CSS block in `NotebookView.jsx`, or ask to restore the old boxed layout.

## C. New styling that is additive (no old look to revert)

- `.cm-mathzone-badge` — pill shown for `/math` / `/math end` lines.
- Quick note popup styles — self-contained in `src/views/QuickNoteView.jsx` (`qn-*` classes).

## Not changed

- Theme palettes (`src/lib/themes.js`) untouched — all changes use existing CSS variables, so every theme keeps working.
- Sidebar panel background stays `var(--surface)` (matches headers, avoids the color seam).
- Mobile liquid-glass styles untouched.

## D. Unified controls — one Toggle/Slider/Select everywhere

New `src/components/Controls.jsx` (+ `.gnos-toggle` / `.gnos-slider` / `.gnos-select` in `global.css` section 12). All duplicate control definitions deleted and routed through the shared module.

- **Sliders**: white vertical **bar** thumb (6×18px pill, no circle), accent-filled track. `--fill` is computed by the component now — callers no longer set it inline. Applies to: reader settings (font size, line spacing, TTS speed), sidebar settings (font size, line spacing), audio volume, graph physics sliders, notebook cover-picker zoom.
- **Toggles**: Apple-style 38×22, 18px knob, spring cubic-bezier. One look across reader settings, settings window, sidebar settings, plugin manager, graph settings, titlebar customize popover.
- **Selects**: rounded surfaceAlt native selects with custom chevron (`.gnos-select`): reader font/Piper voice/translate-language, settings window, sidebar settings (font, TTS, view mode, playback, calendar), graph collection filter.
- **Deleted**: `Toggle` defs in ReaderView/SettingsWindowView/PluginManagerView, `SettingsToggle` in Sidenav, toggle button in GraphView `ToggleRow`; both `.toggle-track` CSS blocks; `.sw-toggle`/`.sw-select` CSS; old `.settings-panel input[type=range]` accent-color rule; `.gnos-apple-slider` (renamed `.gnos-slider`).
- **Not changed**: LibraryView modal selects (recurrence/smart-filter) keep their compact inline form styling; Excalidraw's internal sliders untouched.

**Revert:** restore the per-view control defs from git and delete `src/components/Controls.jsx` + the section-12 `.gnos-*` CSS block.

## E. Reader pagination engine — single-render strip

`src/lib/Paginationengine.js` rewritten (D2 buffer → D3 strip). Chapter is laid out once by the CSS column engine; page turns translate the strip. No per-page DOM cloning/extraction.

- **Visual difference:** the "slide" page transition now scrolls the actual text strip (continuous motion) instead of sliding a pre-cut page copy in from the edge. Fade transition unchanged. Timing 0.14s ease-out (was 0.1s).
- TTS started from the speaker button now anchors to the first words visible on the current page (the strip holds the whole chapter, so playback continues across page turns instead of stopping at the page edge).
- Debug `[Reader]` console noise removed; background chapter scan now waits for idle time.

**Revert:** `git checkout HEAD -- src/lib/Paginationengine.js src/views/ReaderView.jsx` (note: this also reverts the shared-controls migration inside ReaderView).

## F. Quick note — fan slivers splay outward and are clickable

`src/views/QuickNoteView.jsx` (`qn-fan` CSS + JSX):

- Slivers moved on-screen (`left/right: 4px`, were `-8px`) and tilt **outward** (±3°, origin at the bottom) for a stacked-deck look; a second, fainter sliver appears when ≥2 notes remain on that side.
- Clicking the left sliver flips to the older note, right to the newer (same as swiping). Hover nudges the sliver toward center and raises opacity.

**Revert:** restore the `.qn-fan*` CSS block and the two-line fan JSX from git.

## G. Customize Toolbar — drag-and-drop page (replaces the toggle popover)

`src/App.jsx` (`CustomizeToolbarPage`, `TITLEBAR_CHIP_DEFS`, `.ct-*` CSS), `src/store/useAppStore.js`, `src-tauri/src/lib.rs`:

- Right-clicking the title bar (or **View → Customize Toolbar…**) now opens a full overlay with a live mock of the three toolbar zones (Left / Center / Right) plus a "Hidden" tray below — Firefox/Zen style. Drag chips between zones to reorder or move controls; drop into the tray to hide. Changes apply and persist immediately; pointer-based drag (no HTML5 DnD).
- **Data model:** `titlebarItems` boolean map replaced by ordered `titlebarLayout: { left, center, right, tray }`. Old prefs migrate automatically (`false` → tray). Search is fixed in the center; the sidebar toggle always renders first on the left.
- Title bar now renders items in the customized order (previously fixed order with hide-only).
- Save indicator and quick-access strip stay mounted (hidden) when trayed — notebook/sketchbook save flashes and per-view actions keep working.

**Revert:** restore `CustomizeToolbar` popover in App.jsx, the `titlebarItems` store fields, and drop the `customize_toolbar` menu item in lib.rs.

---

# Phase 2

## H. Global search covers no longer render huge

`src/styles/global.css`, `src/views/LibraryView.jsx`:

- The `.search-drop-item` / `.search-drop-cover` / `.search-drop-*` rules that sized
  result covers to 30×42 lived inside LibraryView's inline `<style>`. When the titlebar
  mounted `SearchDropdown` on its own (LibraryView not rendered) those rules were absent,
  so book covers rendered at natural (huge) size. Rules moved to `global.css`; the inline
  copy in LibraryView removed. No JSX/markup change.

**Revert:** move the `.search-drop-*` block back into LibraryView's inline `<style>` and
delete it from `global.css`.

## I. Natural-language date math — shorthand units + more phrasing

`src/views/NotebookView.jsx` (`tryDateMath`). Not strictly visual, but changes what ghost
`=` results appear after math-zone lines.

- **Bug fix:** `today - 2d` used to fall through to mathjs and render `-2*d`. Shorthand
  units now recognized: `s h d w y mo`, bare `m` = **month**, `min`/`mins` = minutes,
  `hr(s)` `sec(s)` `yr(s)`. So `today + 7w`, `in 3mo`, `5y ago`, `today + 5m` (→ +5 months).
- Date − date subtraction → duration in days (`2026-01-01 - today` → `-184 days`); guarded
  so bare-number subtraction (`2020 - 2000`) stays arithmetic.
- `weeks/months until` and `... since` added alongside `days/hours`; `<weekday> after next`,
  `MM/DD` and ISO `YYYY-MM-DD` bases parsed locally (no UTC shift).
- until/since phrase matchers now run before the standalone base parse, since V8's lenient
  `new Date` would otherwise extract the embedded date and return it verbatim.

**Revert:** `git checkout HEAD -- src/views/NotebookView.jsx` (also reverts unrelated NB work).

## J. Quick note fan — re-splayed as a deck peeking behind-and-above

`src/views/QuickNoteView.jsx` (`.qn-fan*` CSS). Supersedes the fan tweak in section F.

- Slivers now pivot on their **inner-bottom corner** (`transform-origin` 0%/100% 100%) and
  translate up-and-out (`translateY(-6px) rotate(±5deg)`, back sliver `translateY(-11px)
  rotate(±8deg)` at lower opacity), so each edge reads as another card stacked behind and
  slightly above the current one, splayed outward — instead of tilting inward/down.
- Click handlers unchanged (left → older `idx+1`, right → newer `idx-1`); hover still nudges
  toward center and raises opacity.

**Revert:** restore the `.qn-fan-left/right(.qn-fan-back)` rules from section F / git.

## K. Sidebar app mark → notebook Live-mode quill

`src/components/icons.jsx` (new), `src/components/Sidenav.jsx`, `src/views/NotebookView.jsx`:

- The sidebar header logo was a filled calligraphy-nib quill. Replaced with the notebook
  Live-mode quill (feather strokes + nib + baseline). Extracted that SVG into a shared
  `IconQuill({ size })` so the sidebar header and the notebook view-mode switcher render
  the exact same mark (NotebookView's `IconLive` now delegates to it). Sidebar renders at
  size 21, switcher at 15; still `currentColor`. Dock/window PNG icons untouched.

**Revert:** restore the inline `<svg>` in Sidenav's logo button and NotebookView's inline
`IconLive`; delete `src/components/icons.jsx`.

## L. Notebook /timer and /pomo as left-gutter vertical rails

`src/views/NotebookView.jsx` (`TimerWidget`, `PomoWidget`, CSS):

- The inline horizontal `/timer` and `/pomo` widgets now render as thin vertical rails
  (quick-note style): a vertical drain track + vertical time readout, with pause/reset
  (timer) or play/skip/reset + phase tag (pomo) revealed on hover. Progress fill switched
  from `width%` to `height%`. Each rail is ~42px (timer) / 52px (pomo) wide and sits at the
  left of its line, so multiple `/timer`/`/pomo` lines stack down the page (multi-timer
  preserved). All tick/pause/persist/edit logic unchanged; pomo phase buttons collapsed
  into a single click-to-cycle tag (Focus → Break → Long), fill color still marks phase.

**Revert:** `git checkout HEAD -- src/views/NotebookView.jsx` (also reverts other NB work).

## M. ∑ indicator when a /math zone is active

`src/views/NotebookView.jsx`, `src/views/QuickNoteView.jsx`:

- **Notebook:** a small ∑ chip (reuses `.cm-mathzone-badge`/`.cm-mathzone-icon`) appears
  at the top-left of the editor area whenever the doc has a `/math` calc zone (open or a
  closed `/math`…`/math end` pair). Driven by a new `hasMathZone` memo over `content`.
- **Quicknote:** a matching ∑ chip appears top-right, just left of the save dot, using the
  same open/closed-zone detection (`docHasMathZone`) over the note text.

**Revert:** remove the `hasMathZone`/indicator JSX + `.nb-mathzone-indicator` CSS in
NotebookView, and the `docHasMathZone` chip + `.qn-mathzone-badge` CSS in QuickNoteView.

## N. Customize Toolbar — edit the real title bar (replaces the mock page)

`src/App.jsx` (`CustomizeToolbarOverlay` replaces `CustomizeToolbarPage`, `CUSTOMIZE_CSS`,
titlebar render). Supersedes section G's mock-page approach.

- Opening customize (right-click title bar / View → Customize Toolbar…) now blurs + dims the
  whole app behind a scrim while the **real** title bar stays crisp and raised above it
  (`.customizing` class, z-index bump + accent ring). The real `.gnos-tb-left/center/right`
  zones become live drop targets (dashed outlines).
- A floating **palette** (bottom-center) lists every movable chip; drag one onto a zone to
  place/reorder it (a dot marks chips already in the toolbar), or drop it on the palette's
  "Drop here to hide" tray to remove it. Insertion index is hit-tested against real
  `[data-tb-id]` slot wrappers rendered into the toolbar only while customizing.
- Reuses the phase-1 `titlebarLayout` store model + `moveItem`; changes persist immediately.
  Search stays fixed in the center. Done / Restore Defaults in the palette header; Esc or
  scrim-click closes.

**Revert:** restore `CustomizeToolbarPage` + old `CUSTOMIZE_CSS` from git and drop the
`.customizing`/slot wrapping in the titlebar render.

## O. Shared editor module — inline math calc in quick notes (item 5, partial)

`src/lib/notebookEditor.js` (new), `src/views/NotebookView.jsx`, `src/views/QuickNoteView.jsx`:

- Extracted the self-contained math-calc subsystem (`makeMathCalcPlugin` + lazy mathjs/
  algebrite loaders, `expr=` ghost results, `/math` zones, variable scope, and the
  natural-language date math from section I) out of NotebookView into a shared module.
  NotebookView now imports it — no behavior change (build green).
- QuickNoteView builds a `cm` shim from its CM imports (+`@codemirror/autocomplete`) and
  enables `...makeMathCalcPlugin(cm)`, so `expr=`, `/math` zones and variable math now work
  in quick notes, matching the notebook. Ported the math CSS classes into QN_CSS.

**Status:** the math portion of item 5 is done. The widget-based plugins (`/tasks`,
`/graph`, `/habits`) are NOT yet shared — they live in `makeLivePlugin` with ~20
interdependent widget classes + notebook-context handlers, whose extraction is a larger
incremental refactor (notebook behavior must be re-verified at runtime after each move,
not just via build). `/timer` already works natively in quick notes (its own left rail).

**Revert:** move `makeMathCalcPlugin` + the mathjs/algebrite loaders back into NotebookView,
delete `src/lib/notebookEditor.js`, and remove the `makeMathCalcPlugin` wiring + math CSS
from QuickNoteView.

## P. Quick note fan — true fanned-deck stacking (supersedes J)

`src/views/QuickNoteView.jsx` (JSX structure + `.qn-root`/`.qn-card`/`.qn-fan` CSS).

- Old fans were thin edge slivers at `z-index:2` — they rendered *in front* of the note
  and were clipped by `overflow:hidden`, so they overlapped the active note instead of
  sitting behind it.
- Restructured: `.qn-root` is now a transparent stage. The note content is wrapped in an
  opaque **`.qn-card`** (front, `z-index:2`) inset `26px 34px 12px 34px` from the window
  edges — the extra side inset leaves room for the fan to splay without the 400×540 window
  clipping it. Behind it sits **one** `.qn-fan` card per side (`z-index:1`, same footprint)
  pivoting from its bottom-centre (`transform-origin:50% 100%`) and rotated `±3°`, so each
  swings out from behind the front card like a card fanned from a hand. The fan cards are
  **opaque and a shade lighter** than the front card (`color-mix(... 84%, #fff)`) and inset
  more top+bottom (`40px 34px 26px 34px`) than the front card so they stay within its
  vertical bounds — peeking only on the sides, never over the top or under the bottom. Hover
  nudges the card ~4px outward. Click targets unchanged (left → older, right → newer).

**Revert:** restore the section-J `.qn-fan*` sliver CSS and unwrap the `.qn-card` div.

## Q. Fix: custom-folder quick notes weren't reloaded on restart

`src/lib/storage.js` (`loadQuickNotesFromDir`), `src/views/QuickNoteView.jsx` (boot).

- Behaviour fix, not visual. The quick-note boot only rebuilt the note stack in **archive
  mode** (`!prefs.quickNoteDir`). When a custom quick-note **folder** was set, notes were
  written to disk as `.md` files but never read back — so every restart the stack was just a
  fresh empty draft and older notes looked deleted.
- Added `loadQuickNotesFromDir(dir)` (reads every `.md`, newest first by mtime) and wired the
  boot's `else` branch to reload them, preloading content so flipping needs no re-read.
  Archive-mode reload (quickNote notebooks + "quicknotes" collection) was already working.

**Revert:** drop `loadQuickNotesFromDir` and the boot `else` branch; remove `stat` from the
storage.js fs import.

## R. Fix: quick notes deleted on restart (archive mode)

`src/views/QuickNoteView.jsx` (`doSave`).

- **Root cause of the data loss.** `doSave` auto-deletes a saved quick note whenever the
  editor text is empty (`!note.draft && archive mode`). But an old note's content is loaded
  lazily, and if it ever came back empty (untouched reloaded note, a failed read, or a
  base-dir mismatch), the very next save saw empty text and **deleted the note from disk +
  the quicknotes collection** — so notes vanished on restart.
- Fix: only auto-delete when the note **previously had content** this session (`prev` snapshot
  before the save) and the user actively cleared it. A note whose content is empty merely
  because it hasn't loaded is now left alone. Intentional "empty a saved note to delete it"
  still works.

**Revert:** drop the `prev` snapshot + guard, restoring the unconditional `!content.trim()`
delete in `doSave`.

## S. Fix: quick note shows N phantom blank cards on every open (archive mode)

`src/lib/storage.js` (new `loadQuickNoteNotebooks` + `removeNotebookFolder`, hardened
`saveQuickNoteAsNotebook`, `deleteQuickNote`), `src/views/QuickNoteView.jsx` (boot).

- **Root cause (confirmed against real iCloud archive, NOT the wordCount hypothesis).**
  The same quick note (identical id incl. random suffix) had been re-saved into several
  title-named folders. Mechanism: `saveQuickNoteAsNotebook` reuses a folder found by id, but
  when `findNotebookFolderById` *missed* the existing folder (iCloud sync latency — archive
  is in `com~apple~CloudDocs`), it created a fresh folder each time the note's first-line
  title changed. Several old folders' `.md` files ended up 0 bytes. `loadNotebooksMeta`
  returns one meta *per folder* with no id dedupe, so the boot stack got one entry per
  duplicate folder; `loadNotebookContent(id)` returns the *first* id match — usually an empty
  folder — so most cards rendered blank. Meta `wordCount` was stale (said 8 while the `.md`
  was 0 bytes), so the planned `wordCount > 0` filter would not have worked.
- **Fix.** New `loadQuickNoteNotebooks()` groups quickNote folders by id, keeps the folder
  with the most real on-disk content (ties → most recently updated), deletes the redundant
  duplicate folders, drops ids whose every copy is empty (and removes them from disk), and
  returns one entry per id with content preloaded. Boot uses it and preloads `contentsRef`.
- **Hardening (stop future dups).** Added a persisted `quicknote_folder_map` (id → folder).
  `saveQuickNoteAsNotebook` consults it before `findNotebookFolderById`, so an id reuses its
  real folder even when iCloud hasn't materialized the folder's meta.json yet. The map is
  updated on every save, on consolidation, and cleared on delete.

**Revert:** restore the archive-mode boot block to `loadNotebooksMeta().filter(m => m.quickNote)`,
re-import `loadNotebooksMeta`, and remove `loadQuickNoteNotebooks`/`removeNotebookFolder`, the
`quicknote_folder_map` lookups in `saveQuickNoteAsNotebook`/`deleteQuickNote`.

## T. Fix: ragged outline/halo around the quick-note window (macOS)

`src-tauri/src/lib.rs` (quicknote `WebviewWindowBuilder`).

- **Root cause.** The borderless/transparent quicknote window never set `.shadow(false)`,
  so macOS drew its own rectangular drop shadow on the window bounds. That compounded with
  the `.qn-card` and `.qn-fan` CSS box-shadows into a jagged halo around the rounded card.
- **Fix.** Added `.shadow(false)` to the builder chain — only the CSS shadows render now.
- **Verify:** Rust + native chrome, unverifiable from the web preview. `cargo check` passes;
  needs a real `tauri dev`/`tauri build` to confirm the fringe is gone. If any halo remains it
  is the compounded CSS shadows (card + 2 fans) — next step would be reducing `.qn-fan`'s
  box-shadow blur.

**Revert:** remove the `.shadow(false)` line.

## U. New setting: toggle the quick-note fanned-card peek

`src/store/useAppStore.js` (new `quickNoteFanEnabled` pref), `src/components/Sidenav.jsx`
(Settings → Quick Note), `src/views/QuickNoteView.jsx` (gate the fans).

- Store: added `quickNoteFanEnabled: true` default, threaded through `init()` destructure/set
  and `persistPreferences()` payload — mirrors `quickNoteDir`/`sidebarPinned`.
- Settings UI: a `SettingsRow` + `Toggle` "Show fanned card peek" after the folder buttons,
  wired via `pref('quickNoteFanEnabled', …)`.
- QuickNoteView: reads the pref at boot into `fanEnabled` state and refreshes it in the
  `quicknote:focus` listener (so flipping it while the popup is hidden takes effect next open).
  Both `.qn-fan` renders are gated behind `fanEnabled &&`. Off = no peeking cards; card inset
  left as-is (plain card with a little extra margin).

**Revert:** remove the `SettingsRow` in Sidenav, the `quickNoteFanEnabled` store wiring, and
the `fanEnabled` state/gates in QuickNoteView.

## V. Profile window: reuse the app's real profile design (Stats + Review)

New `src/components/ProfileContent.jsx`; `src/views/LibraryView.jsx` (ProfileModal),
`src/views/ProfileWindowView.jsx` (rewritten body).

- **Problem.** `ProfileWindowView` was a bare reimplementation (avatar, 7-dot streak, plain
  3-col grid) that never reused the app's real profile — the 365-day-style heat grid, Top
  Books by Progress, and Review bars that live in `ProfileModal`.
- **Extraction.** New shared `ProfileContent` owns the **Stats** and **Review** tab bodies:
  it self-loads the reading log and computes every stat from `library`/`notebooks` props,
  rendering the body for the requested `tab` (returns null otherwise). `ProfileStatCard` moved
  into it. Calendar/Habits (which need `FullCalendar`, `PaneContext`, and notebook navigation)
  stay in `ProfileModal` — kept out of the shared file to avoid circular imports.
- **ProfileModal** now renders `<ProfileContent tab="stats"…/>` / `tab="review"` where the
  inline panels used to be; its log state, `reviewPeriod`, and the stats/review useMemos were
  removed (behavior-identical, all 4 tabs still work; mobile unchanged).
- **Profile window** (per user: Stats + Review only) drops its bespoke avatar/streak/grid and
  renders a small Stats/Review tab bar + `<ProfileContent/>`, so it now shows the streak stat
  cards, heat grid + legend, and Top Books — matching the in-app modal. Loads `library` +
  `notebooks` from the archive on boot.

**Revert:** restore the old `ProfileWindowView.jsx` bespoke body and the inline stats/review
panels + memos/state in `ProfileModal`; delete `src/components/ProfileContent.jsx`.

## W. Remove leftover shadow around the quick-note fanned cards

`src/views/QuickNoteView.jsx` (`.qn-fan` CSS).

- Dropped `box-shadow: 0 8px 24px rgba(0,0,0,.35)` from `.qn-fan`. The fan cards now rely on
  their border + the front card's shadow for depth — no shadow halo behind the peek.

**Revert:** restore the `.qn-fan` box-shadow line.

## X. Fan toggle moved to the real settings window; correction to §U

The §U toggle was added to `Sidenav.jsx`, but the user's actual settings UI is the separate
`SettingsWindowView.jsx`. Added the same "Show fanned card peek" `Toggle` to its "Quick Note"
Group (bound to `quickNoteFanEnabled`, same store wiring). The Sidenav one from §U is
harmless/redundant.

**Revert:** remove the `Show fanned card peek` Row in `SettingsWindowView.jsx`.

## Y. Fast cold-start: no flash of default theme + empty library

`src/lib/themes.js` (`applyTheme` cache + new `applyCachedTheme`), `src/main.jsx`
(pre-mount theme), `src/store/useAppStore.js` (`init()` fast-pass + reconcile).

- **Theme flash.** `applyTheme` now mirrors `{ themeKey, customThemes }` to
  `localStorage.gnos_theme_cache` (preserving prior customThemes when a bare
  `applyTheme('dark')` carries none, so it can't wipe custom themes). New `applyCachedTheme()`
  reads it synchronously; `main.jsx` calls it before `createRoot`, so the very first frame
  paints the chosen theme. Applies to all windows (shared entry). Async re-apply in `init()`
  / secondary-window boots still runs as reconciliation.
- **Empty-view flash.** `init()` was gated on `Promise.all` of the heavy per-folder scans
  (`loadLibrary`/`loadNotebooksMeta`/`loadSketchbooksMeta`), which finish after the ~350ms
  splash fades. Now: (1) `await loadPreferences()` first (one small file) → apply theme +
  prefs; (2) FAST PASS reads the single-file flat indexes (`library`, `notebooks_meta`,
  `sketchbooks_meta`, + collections/decks/calendar) and `set()`s them — real lists on first
  frame; (3) RECONCILE runs the authoritative folder scans and `set()`s again (self-heals
  trash/renames, attaches book covers). Fast-pass data is never persisted.
- Trade-off: book covers still pop in at reconcile (flat `library` index has titles, covers
  attach during `loadLibrary`); titles/list are instant. A deleted item could reappear for
  <1s until reconcile — acceptable, self-corrects.
- **Verify:** needs a real `tauri dev`/packaged launch (Tauri fs + localStorage) — not the web
  preview. `npm run build` green.

**Revert:** remove `applyCachedTheme` import+call in `main.jsx`, the cache block in
`applyTheme`, and restore `init()`'s single `Promise.all` load.

## Z. Startup covers: scroll-driven grid window, no idle cover gate

`src/views/LibraryView.jsx`. Follow-up to the F1–F5 startup work in `PLAN_STARTUP.md`.
Covers still felt slow/janky for the first ~10s; two of the earlier fixes were the cause.

- **Idle grow → scroll grow.** The windowed grid grew via `requestIdleCallback(..., {timeout: 400})`.
  On launch the main thread is saturated, so the timeout always won: `visibleCount` climbed every
  400ms and `renderAll()` rebuilt the entire grid each step, repeatedly, on top of launch work.
  Now growth is driven by a capture-phase `scroll` listener on `#library-content` (scroll doesn't
  bubble; the real scroller is `.lib-tab-panel.active`), rAF-coalesced, growing when within 800px
  of the bottom. An idle library renders exactly one window and never re-renders.
- **Removed the `useIdleReady` cover gate.** It withheld every cover until one idle flip, then
  mounted them all at once = simultaneous decode. With asset:// URLs (F5), `loading="lazy"`,
  `decoding="async"`, and `content-visibility:auto` on `.book-cover` (F4), the browser already
  defers offscreen decode. `<img>` now renders immediately so the first screenful snaps in.
  Module-scope `_idleReady`/`_idleSubs`/`_armIdleReady`/`useIdleReady` deleted.
- **Verify:** `npm run build` green; web preview boots with no console errors — but it only has 3
  seed cards and no real cover files, so it can't exercise the asset-URL or grow path. Real
  measurement needs `npm run tauri:dev` against the actual library + Web Inspector.

- **Reverted F4 (`content-visibility: auto` on `.book-cover`).** This was the actual blank-screen
  cause: WKWebView renders a skipped subtree *synchronously* as it scrolls into view, and while the
  main thread is saturated (first ~10s after launch) it can't keep up — the grid scrolls in empty,
  then is fine once launch work settles. Removed along with `contain-intrinsic-size`. Offscreen cost
  is covered by `loading="lazy"` + the grid window. Side benefit: `.book-cover`'s hover-lift no
  longer sits on a contained box.

**Revert:** restore the `useIdleReady` helper + the `imgReady &&` guards in `BookCard`/`AudiobookCard`,
swap the scroll effect back for the `requestIdleCallback` grow effect, and re-add
`content-visibility: auto` + `contain-intrinsic-size: 110px 155px` to `.book-cover`.

## AA. Cover thumbnail cache (blank-on-scroll-back fix)

`src/lib/storage.js`, `src/App.jsx`. Follow-up to Z — removing `content-visibility` helped but
blanking still appeared on the third/fourth scroll *up* after scrolling down.

- **Cause.** Cover files on disk are full-size art (often 1600x2400). The grid paints them at
  110x155, but the webview decodes and holds the FULL bitmap per mounted cover — ~14.6MB each.
  A few hundred mounted covers blows WebKit's bitmap budget, it evicts backing store, and
  scrolling back up repaints blank until each cover re-decodes. Explains why it needs a few
  scroll cycles to appear and why it's worse right after launch.
- **Fix.** `cover_thumb.jpg` (220x310, JPEG q0.82) cached next to each `cover.*`.
  `loadCoverFromFolder` prefers the thumb; if missing it returns the full cover and pushes a job
  onto `_thumbQueue` (deduped — loadLibrary runs twice per session, fast pass + reconcile).
  `generatePendingThumbs()` drains the queue **serially** with a 30ms yield between covers, called
  from `App.jsx` at `requestIdleCallback(..., {timeout: 8000})` after `init()`. Stale thumbs are
  detected by `stat` mtime compare (thumb older than cover → regenerate), so replacing cover art
  still works. Self-healing, no migration; deleting thumbs just regenerates them.
- **Effect.** Decoded bitmap per cover 14.6MB → 0.27MB (~54x). One slow pass on the launch after a
  book is added; every later launch reads the small thumb.
- **Verify:** `npm run build` green. Downscale math exercised in the browser preview against a
  synthetic 1600x2400 image: draws 220x330 (covers the 220x310 box, centered crop), non-blank
  pixel, ~1.2KB out. The disk/queue path needs Tauri fs — confirm in `npm run tauri:dev` that
  `cover_thumb.jpg` appears in book folders after the first launch, then relaunch and scroll.

**Revert:** in `loadCoverFromFolder` return `convertFileSrc(coverPath)` unconditionally, delete the
thumbnail block above `loadLibrary`, and drop the `thumbs` idle call in `App.jsx`.

## AB. PDF source moved to disk (P0.1) + Home no longer re-loads covers (Q1)

`src/lib/storage.js`, `src/views/PdfView.jsx`, `src/views/LibraryView.jsx`.
First items of `PLAN_PDF.md`.

### P0.1 — the raw PDF was never saved, and library.json was carrying it as base64

`saveBookContent` stripped `pdfDataUrl` before writing `meta.json`, and nothing else
wrote the bytes — so no `.pdf` file existed in the archive. Meanwhile `saveLibrary`
only stripped *non-`data:`* covers, so `pdfDataUrl` (a `data:` URL) was persisted
verbatim into `library.json`: ~1.37x the bytes of every imported PDF, re-parsed on
every launch. `PdfView` then called `persistLibrary()` on **every page render**,
re-serializing all of it per page turn, and `atob()`'d the whole document on open for
a second in-memory copy.

- `saveBookContent` now writes `<bookDir>/source.pdf` (new `PDF_SOURCE_NAME`,
  `dataUrlToBytes` helper shared with the cover writer).
- `loadLibrary` attaches `pdfUrl = convertFileSrc(sourcePath)`, and **migrates**: a
  book whose bytes still live as base64 gets `source.pdf` written once, logged as
  `[Gnos] migrated PDF out of library.json:`. Either way `pdfDataUrl`/`rawDataUrl` are
  nulled on the way through.
- `saveLibrary` strips `pdfDataUrl`/`rawDataUrl`/`pdfUrl` unconditionally (`pdfUrl` is
  a runtime asset:// path, re-derived each load — same reasoning as covers in F5).
- `PdfView` reads `pdfUrl` and streams it; no `atob`. Progress writes are debounced
  1s trailing with a flush on unmount (`queueProgressFlush`/`flushProgressNow`).
- Books imported before this whose base64 is also missing genuinely have no
  recoverable source; the error message now says so instead of "please re-import".

### Q1 — covers appeared to re-load when Home was clicked

`App.jsx`'s `ViewPanel` picks a component from `tab.view`, so reader → library
**unmounts** `LibraryView` (only *tabs* are kept mounted, not views within a tab).
Every cover came back as a fresh `<img>`, `.cover-img-fade` replayed as an entrance
animation, `visibleCount` reset to 60 and scroll to 0.

- New `CoverImg` component: a cached image is already `complete` on first commit, so
  the fade class is only applied when the image actually had to load.
- `_gridState` module Map (keyed by pane) restores `visibleCount` + `scrollTop` on
  mount and records them on unmount. The filter-reset effect skips its first run so it
  can't clobber the restore.

**Verify:** `npm run build` green; eslint clean on `storage.js` and `PdfView.jsx`
(`LibraryView.jsx`'s 14 errors are pre-existing unused-var warnings, none in the new
code). In the web preview, library → notebook → library round-trips render 3/3 cards
with no console errors, which proves no crash on remount — but seed data has no cover
files and 3 cards can't scroll, so **the fade skip and the scroll restore are not
actually exercised there**. Both need `npm run tauri:dev`. The PDF path needs Tauri fs
entirely: confirm `source.pdf` appears in book folders, watch for the migration log
line, and check `library.json` shrinks.

**Revert:** restore the unconditional `convertFileSrc(coverPath)`-era `loadCoverFromFolder`
return and the old `saveLibrary` map; drop `PDF_SOURCE_NAME`/`dataUrlToBytes` and the
`source.pdf` write; put `persistLibrary()` back in PdfView's render effect; replace
`CoverImg` with the plain `<img className="cover-img-fade">` and delete `_gridState`.

## AC. pdf.js bundled, off the CDN (P0.2 + P0.3)

`package.json`, `scripts/copy-pdfjs-assets.mjs`, `src/lib/pdfjs.js` (new),
`src/views/PdfView.jsx`, `src/lib/bookImport.js`, `src/views/SketchbookView.jsx`.

`PdfView`, `bookImport` and `SketchbookView` each injected their own
`<script src="cdnjs.cloudflare.com/.../pdf.js/3.11.174">` at runtime. In a packaged
Tauri app that means **PDFs do not open offline at all**, in three separate places,
plus third-party script execution on every PDF touch.

- `pdfjs-dist@5.7.284` is now a real dependency. New `src/lib/pdfjs.js` is the single
  loader: dynamic `import()` so the ~1.6MB of library + worker stays out of the main
  bundle (most sessions never open a PDF), worker wired via Vite `?url`. All three
  call sites use it; no `window.pdfjsLib` anywhere.
- **v5 API migration** (the CDN build was 3.11, several breaking changes back):
  `renderTextLayer()` no longer exists — replaced with `new TextLayer({...}).render()`,
  which streams its own text content, so the separate `getTextContent()` call is gone.
  The CSS variable is now `--total-scale-factor`, not `--scale-factor`. `page.render()`
  wants the `canvas` element, not just `canvasContext` — updated at all four render
  sites. The TextLayer instance is kept in a ref and cancelled alongside the render task.
- **P0.3 came free**: the real `pdf_viewer.css` is now bundled, and it sets text-layer
  spans to `color: transparent`. The old inline `opacity: 0.2` was a hand-rolled
  stand-in for that stylesheet and left ghost text visible over the page raster.
- **Runtime assets**: v5 does not inline the standard-14 font data, CJK cmaps, or the
  image-decoder wasm — it fetches them from URLs passed to `getDocument()`.
  `scripts/copy-pdfjs-assets.mjs` copies them into `public/pdfjs/` on `predev` and
  `prebuild` (gitignored, 4.2MB in `dist/`), and the new `openPdf()` helper applies
  `standardFontDataUrl` / `cMapUrl` / `wasmUrl` / `iccUrl` so no call site can forget
  them. Without these, non-embedded fonts don't render.

**Verify — read this before trusting it.** In the web preview: the module loads,
`workerSrc` resolves to `node_modules/...` (not cdnjs), `TextLayer` is a function and
`renderTextLayer` is `undefined` (confirming the migration was required),
`pdf_viewer.css`'s `.textLayer` rules are live, `/pdfjs/standard_fonts/` and
`/pdfjs/wasm/` serve 200, and a hand-built minimal PDF **parses** end-to-end through
`openPdf()` (`numPages` correct, `getPage(1)` resolves).

**Canvas rasterization could NOT be verified**: `page.render()` never settles in the
Browser pane. This is an environment limitation, not a regression — the *old* 3.11 CDN
build was loaded into the same preview as a control and hangs identically, while
parsing works in both. So the render path is unproven either way and must be checked
in `npm run tauri:dev`: open a PDF, confirm pages raster, text selects cleanly with no
ghost text, and PDF→sketchbook import still rasterizes.

**Revert:** remove the `pdfjs-dist` dep, the `predev`/`prebuild` hooks, the script,
`src/lib/pdfjs.js` and `public/pdfjs/`; restore the per-file CDN `loadPdfJs()` in the
three views, the `renderTextLayer()` call with `--scale-factor`, the inline
`opacity: 0.2` text layer style, and drop the `canvas:` param from the render calls.

## AD. Everything else that needed the network at runtime

`index.html`, `scripts/vendor-fonts.mjs` (new), `public/fonts/` (new, committed),
`src/views/NotebookView.jsx`, `package.json`.

Audit of every remote URL in shipped code turned up three more offline breakages
beyond the pdf.js one in AC. All are now bundled; `src/` and `index.html` contain no
runtime CDN references at all.

- **Webfonts.** `index.html` `<link>`ed straight to `api.fontshare.com` (Clash Display,
  Satoshi, Switzer, Erode, Britney) and `fonts.googleapis.com` (Stack Sans Text, Lora,
  Inter). No network → the entire typographic identity, reader included, silently fell
  back to system fonts. `scripts/vendor-fonts.mjs` fetches both provider stylesheets
  with a desktop UA (so they serve woff2, not legacy formats), downloads every
  referenced binary, and rewrites the `@font-face` srcs to local paths. Output is
  `public/fonts/` — **committed, not generated at build**, so builds are offline too.
  23 files / 0.6MB covering 93 `@font-face` rules (the families are variable fonts, so
  one file serves many weights and unicode-ranges). Re-run the script only to add a
  family or refresh versions.
- **KaTeX.** `index.html` loaded KaTeX's JS+CSS from jsdelivr with a comment claiming
  it was "so window.katex is available to NotebookView" — but NotebookView has used the
  bundled npm package for a while and nothing reads `window.katex`. Dead tags, removed.
  Removing them exposed a latent bug: the CSS was imported as `?inline` and injected
  into a `<style>`, so KaTeX's relative `url(fonts/KaTeX_*)` resolved against the
  document root and every glyph font 404'd — masked until now by the CDN stylesheet.
  Changed to a plain side-effect `import 'katex/dist/katex.min.css'` so Vite rewrites
  the URLs and emits the fonts.
- **jQuery + MathQuill.** The `/math` edit popup injected three more cdnjs tags, so math
  zones broke offline. Both are npm deps now. MathQuill 0.10.1's build is a plain IIFE
  reading `window.jQuery` at execution time with no require()/exports, so the loader
  sets the global *before* importing it. **Security note:** mathquill's package.json
  asks for `jquery ^1.12.3` and npm nests a `jquery@1.12.4` (moderate XSS advisories).
  Because the build has no `require()`, that copy is never imported and never bundled —
  verified the shipped `jquery` chunk contains `3.7.1` and not `1.12.4`. It sits unused
  in node_modules; `npm audit` will still report it.

**Verify:** `npm run build` green. In the preview, after reload: **zero remote
stylesheet/script resources** on the page, `/fonts/fonts.css` + woff2 serve 200, and
`Stack Sans Text` is loaded and applied to body. Typed `$$\frac{a}{b}=\sqrt{c}$$` into
a notebook — it renders as real math, `KaTeX_Main`/`KaTeX_Math` report **loaded** (the
exact thing the `?inline` bug broke), and screenshotted correct. Clicking the math ran
the MathQuill loader: `window.MathQuill` is a function and `window.jQuery.fn.jquery`
is `3.7.1`; instantiating a `MathField` round-trips latex and renders an `.mq-root-block`.
The test edit did not persist (storage.set fails without Tauri fs, as expected).

Still needs `npm run tauri:dev`: confirm fonts look right in the packaged app, and that
the reader's font stack is unchanged.

**Revert:** restore the four `<link>`/`<script>` tags in `index.html`, delete
`public/fonts/` and `scripts/vendor-fonts.mjs`, put the `?inline` KaTeX CSS injection
and the cdnjs jQuery/MathQuill script loaders back in `NotebookView.jsx`, and
`npm rm jquery mathquill`.
