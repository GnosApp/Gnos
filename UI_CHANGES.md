# UI Changes — July 2026 pass

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
