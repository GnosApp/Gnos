# Plan A38 — STATUS after first pass (see UI_CHANGES A38)

DONE: 1.1 (graph rAF sleep), 5.1/5.2/5.4 (Excalidraw vars + svg fallback + pin —
5.3 visual audit still needs the dark Tauri app), 6.1-6.3 (tab manager cards/
caption/filter/keyboard), 3.1-3.3 (real-slot drag + caret/gap + palette remove),
4 partial (chapters panel → right NebuliSettings style, speed → SegmentedControl,
play button → accent circle; 4.3 transport pill + 4.5 furniture not done),
2.2-2.3 (pane wm buttons, divider drag/double-click, ratio).
REMAINING: 1.2 TabPane eviction, 1.3 reader cache clear on deactivate, 1.4 cover
base64 out of JSON, 2.1 drag-to-split, 2.4 grids, 2.5 keyboard, 3.4 spacers,
3.5 wiggle affordance, 4.3/4.5, 5.3 audit, 6.4 card split/context menu,
6.5 entry animation, 6.6 reorder.

# Plan A38 — hardware usage, split mode, icon mover, audiobook, Excalidraw dark

Self-contained pickup doc. Five areas, each independently shippable. Anchors verified
against the code July 2026.

## 1. Speed / GPU / RAM reductions (ordered by measured-impact likelihood)

1.1 **Graph rAF loop never stops** (`GraphView.jsx` tick(), ~line 425): the sim +
canvas draw runs EVERY frame for as long as the graph view is mounted — including
when the graph tab is hidden (TabPane keeps views mounted with `display:none`) and
when the user is in another tab entirely. Each frame: full sim update loop over all
nodes, `getComputedStyle(document.documentElement)` (style read), canvas 2D draw.
FIX: gate tick on `useIsActiveTab()` (already imported app-wide) — when inactive,
cancel the rAF entirely and resume on activation; also pause when `document.hidden`.
Cheap, big — a hidden graph tab currently burns CPU/GPU forever.

1.2 **TabPane immortality = RAM growth** (`App.jsx` TabPane ~86-125): every tab ever
activated stays mounted forever (`everActive`). A session with 8 tabs holds 8 live
views: Excalidraw scenes + their canvases, CodeMirror instances, reader strips
(whole-chapter DOM + prewarm caches), audio player. FIX: eviction policy — unmount a
pane after N minutes inactive (except audio-player while playing and the active/split
panes), keeping `everActive` semantics via a `lastActiveAt` map. Views already
restore their own state from the store/disk on remount (each has a load effect), so
eviction = free RAM with a one-off reload cost on return. Suggest N=10min, and cap
concurrent mounted panes at 4 (LRU).

1.3 **Reader prewarm cache HTML strings**: `_chapterCache` holds up to 5 chapters'
full HTML (`PREWARM_RADIUS=2` + visited). With word-wrap spans that's MBs per big
book, per reader tab. Already pruned to radius — additionally clear the cache when
the reader tab deactivates (hook into 1.2's eviction or `useIsActiveTab`).

1.4 **Cover base64 in store JSON**: covers are saved as separate files with the data
URL kept in JSON "as a reliable fallback" (`storage.js` ~345, 718-722) — meaning every
cover lives in RAM twice (store JSON + <img decode) and inflates every
`persistLibrary()` serialize (CPU on each save). FIX (bigger): stop persisting
`coverDataUrl` in library JSON when the file exists; on load, hydrate cover paths via
`convertFileSrc()` URLs instead of data URLs. RAM drops by total-covers-size; persist
becomes small. Migration: keep reading old JSON fallback.

1.5 **Excalidraw hidden instances**: covered by 1.2 (eviction unmounts them).

1.6 **Verify** (Tauri Activity Monitor / Web Inspector): idle CPU with graph tab open
but hidden should be ~0% (currently constant); RAM after opening 6 heavy tabs then
waiting 10min should drop back near 2-tab baseline.

## 2. Split mode → Zen-browser/window-manager feel

Current (`App.jsx`): `splitPanes` (exactly 2), modal (`TabLayoutModal`) to pick the
second tab, 1px divider with accent hover, per-pane headers, sidebar disabled in
split. Gaps vs Zen (docs.zen-browser.app split view): no drag-to-split, only 2 panes,
no drop indicators, unsplit is buried in the modal.

2.1 **Drag-to-split** (the core interaction): dragging a tab (from the TabOverview
grid AND from the sidebar Tabs section) over the content area shows edge drop zones —
translucent overlay hinting left/right/top/bottom halves (Zen's "split indicator
placeholder"). Drop → enter split with dragged tab on that side. Implementation:
HTML5 drag or pointer-drag on existing tab rows; a fixed overlay div with 4 hit
bands (25% edges) + center (= replace active tab, existing behavior); reuse
`setSplitPanes([active, dragged])` + new `splitDir`.

2.2 **Pane chrome as window manager**: per-pane header gets (a) an unsplit button
(`‒` promotes that pane to the single active tab — Zen's Unsplit), (b) a swap-sides
button or drag-the-header-to-the-other-side, (c) close-pane (closes split, keeps
other). Active pane already highlighted — strengthen with an accent top border like
the pane-header `.active` class.

2.3 **Divider**: widen hit area to 8px (visual 1px), double-click divider → reset to
50/50. Persist split ratio per pair (store: `splitRatio`).

2.4 **Later (only if wanted)**: 3-4 pane grid à la Zen (binary-tree layout). Big
lift; current 2-pane covers the study use-case (notebook + book). Explicitly out of
scope for the first pass.

2.5 **Keyboard**: ⌘⇧S toggle split with last tab; ⌘⇧← / ⌘⇧→ focus pane.

## 3. Icon mover → Firefox CustomizeMode parity

Current (`App.jsx` ~1769-1908): palette of chips + pointer-drag with `hitTest` over
zone slot midpoints; tray = hide; Search locked to center; per-move commit. Gaps vs
Firefox (firefox-source-docs CustomizeMode):

3.1 **Drag the REAL toolbar items** — in customize mode, the actual buttons in the
title bar must be grabbable (Firefox's core interaction), not only palette chips.
Slots already render `[data-tb-id]` wrappers while customizing — attach the same
pointer handlers to those wrappers (reuse onChipPointerDown/Move/Up with the slot's
id). Ghost follows cursor; item's slot collapses while dragging.

3.2 **Live gap animation + insertion indicator**: `hitTest` already computes
`{zone, index}` but nothing visualizes it in the bar. Render a 2px accent caret at
the insertion point AND open a gap: give the slot after the insertion index a
`margin-left` transition (Firefox shifts items to preview the drop). Pure CSS class
on the `[data-tb-id]` slots keyed off `target`.

3.3 **Drag-out-to-remove**: dropping a toolbar item anywhere on the palette (not
just the tray strip) removes it — make the whole palette a 'tray' hit zone;
keep the labeled tray as the visual affordance.

3.4 **Spacers**: add two pseudo-items to `TITLEBAR_CHIP_DEFS`: `spacer` (fixed 20px)
and `flex-spacer` (flex:1) — both multi-instance (ids `spacer-<n>`), rendered as
empty slots in the bar, dashed outline while customizing. Layout arrays already
handle arbitrary ids; `renderItem` gains two cases. Firefox's most-missed feature.

3.5 **Affordances**: chips + toolbar items get a subtle wiggle or dashed outline in
customize mode (Firefox highlights movable items); cursor `grab/grabbing`; ESC
cancels the in-flight drag (currently only closes the mode).

## 4. Audiobook player → new design language

Current (`AudioPlayerView.jsx`, 664 lines): themed with vars but pre-redesign
patterns — its own fixed chapters sidebar with an "integrated header row" (view-level
headers are supposed to be dead), ad-hoc pill groups for speed/skip, custom panels.

4.1 **Actions → global header**: chapters toggle, sleep timer, speed — icon buttons
via `QuickAccess` (reader is the reference). Kill the sidebar's own header row;
the fixed `<aside>` becomes a right-side panel styled like NebuliSettings
(`var(--surface)`, border-left, 272px, slide-in) instead of a left fixed sheet.

4.2 **Speed control** → shared `SegmentedControl` (0.75/1/1.25/1.5/2) inside the
settings popover; skip-interval picker likewise.

4.3 **Transport bar** → the dark rounded pill language (reader footer/streak pills):
one floating pill centered at bottom: prev-chapter / skip-back / play / skip-fwd /
next-chapter + scrubber + time. Currently it's a full-width surface strip.

4.4 **Now-playing card**: center cover art with the same shadow treatment as the
reader loading cover (`0 8px 40px rgba(0,0,0,0.35)`, radius 8), title + author in
Stack Sans hierarchy, chapter title in textDim smallcaps — matches library card
typography.

4.5 **Progress furniture**: quiet "ch 3 of 12 · 42:10 left" bottom-right in the
reader's `.reader-pagesleft` style instead of inline stat rows.

## 5. Excalidraw dark-theme button visibility

Known setup: `theme="light"` + CSS-var bridge (`SketchbookView.jsx` buildExcalidrawStyles).
Reported: some buttons hard to see in dark themes. Likely mechanism: our bridge sets
button BACKGROUNDS (`--surfaceAlt`) and `color`, but Excalidraw draws many glyphs with
its own internal vars we don't override — `--icon-fill-color`, `--color-on-surface`,
`--button-hover-bg`, `--color-surface-primary-container` (version-dependent) — so
icons render near-black on our dark surfaces.

5.1 **Var-first fix**: extend the `:root`-level block (lines ~59-85) with the full
icon/button var set for the installed Excalidraw version (read
`node_modules/@excalidraw/excalidraw/dist/*.css` for the actual custom-property names
— don't guess): `--icon-fill-color`, `--color-on-surface`, `--button-*`,
`--color-surface-*`. Vars beat `!important` selector whack-a-mole.
5.2 **SVG fallback**: `.excalidraw-wrapper .excalidraw button svg { color: var(--text) }`
(most Excalidraw glyphs use `currentColor`; the ones using `fill="#..."` need
`fill: currentColor !important` scoped to `.ToolIcon__icon svg path` — audit first).
5.3 **Audit protocol** (needs Tauri app, dark theme): open every cluster — toolbar,
properties Island, hamburger menu, zoom/undo footer, color picker popover, context
menu, export dialog — screenshot, list invisible/low-contrast glyphs, patch via 5.1
vars, only then selectors. Record the checklist results in this file.
5.4 Pin `@excalidraw/excalidraw` version in package.json (bridge selectors/vars are
version-coupled).

## 6. Tab manager (TabOverview) → new design language

Current (`App.jsx` TabOverview ~1510-1585): full overlay with a header row
("N tabs" + "Split layout…" + "Done" buttons), grid of cards showing a generic
per-view ICON (VIEW_PREVIEW color/icon) + label + close ✕, and a "New tab" card.
Feels like a settings dialog, not a tab switcher. Gaps vs the app's current language
(no view headers, contextual actions in chrome, content-first cards, tinted-chip
accents) and vs good switchers (Arc/Zen/Safari tab overview):

6.1 **Real content thumbnails, not icons**: cards should preview the tab's actual
content the way library cards preview books.
  - Cheap tier (do first): view-specific rich placeholder — book tabs show the
    book's coverDataUrl (already in store), notebooks show the notebook cover
    color + title (NotebookCard's spine style), sketchbooks their thumbnail
    (`coverDataUrl` exists), audio its cover + a playing indicator. This reuses
    the library-card visual system 1:1 — instant design-language match.
  - Rich tier (later, optional): live DOM snapshot — panes stay mounted
    (TabPane), so a scaled-down `transform: scale()` clone is possible but heavy;
    html2canvas-style capture is NOT worth it. Skip unless cheap tier disappoints.

6.2 **Kill the header row** (view-header rule): no "N tabs / Done" bar. Overlay =
grid only; ESC/click-outside closes (already works). Tab count moves to a quiet
corner caption in `.reader-pagesleft` style. "Split layout…" button dies — replaced
by split affordances on the cards themselves (6.4).

6.3 **Card anatomy** (library-card language): cover/preview block with the same
radius + hover-lift as `.book-card-container`, title below in card typography,
active tab = accent ring (like calendar selected-day outline), close ✕ appears on
hover only (top-right, ghost circle), middle-click closes. Keyboard: arrows move
focus, Enter opens, ⌘W closes focused card; type-to-filter (reuse SearchDropdown
matching against tab labels).

6.4 **Split integration (ties into §2)**: drag one card onto another → split those
two (edge halves of the target card = side placement; uses §2.1's drop-zone
overlay). Right-click card → context menu: "Open in split", "Close others",
"Close to the right". This makes the overview the window manager surface.

6.5 **Entry animation**: cards scale-in from the active tab position (Arc-style
zoom-out feel) — pure CSS transform/opacity, respects `prefers-reduced-motion`.

6.6 **Reorder**: drag cards to reorder `tabs` array (store already has tab order;
sidebar Tabs section reflects it). Same pointer-drag pattern as the customizer.

## Order
1.1 (10 lines, biggest hardware win) → 5 (user-visible bug) → 6.1-6.3 (tab manager
core — quick, high-visibility) → 3.1-3.3 (customizer core) → 4 (audiobook) →
2.1-2.3 + 6.4 (split + card integration, one pass) → 1.2/1.4 (RAM, bigger
surgeries) → 3.4-3.5, 2.5, 6.5-6.6. Build check per step; graph/customizer/
audiobook/tab-manager verifiable in browser preview, Excalidraw + RAM need the
Tauri app.
