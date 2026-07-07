# Handoff plans — phase 2

8 items from user review. Anchors are file:line at write time — reverify with grep.
Build: `npm run build`; Rust: `cd src-tauri && cargo check`. Log every visual change
to `UI_CHANGES.md` (append; user reverts by section). Don't commit unless asked.

Suggested order: 3 (quick, isolated) → 8 → 2 → 1 → 7 → 6 → 4 → 5 (5 is the big refactor;
6 and 7 get easier once 5 lands, so if doing 5 first, fold 6/7 into it).

---

## 1. Sidebar-nav quill mark → notebook Live-mode quill

**What:** the quill/app-mark in the sidebar nav header reads as a filled calligraphy
nib and should be swapped for the notebook Live-mode quill (cleaner feather strokes).

**Target (replace this):** `src/components/Sidenav.jsx:2073` — sidebar header logo button
(`.sidenav-logo`, commented "Quill + line — the app mark"). Current SVG is a
leaf/blob quill (`M19.5 4.5c-4.5.5-8.5 2.5-11 6.5…` + a stroke line + a baseline),
21×21 in a 24×24 viewBox.

**Source of the good icon:** `IconLive` at `src/views/NotebookView.jsx:6140` — the quill
used for "Live" mode in the notebook view-mode switcher. Three tapering feather strokes +
a short nib stroke + a baseline, 32×32 viewBox, `currentColor`.

**Plan (pure JSX/SVG swap, no assets):**
- Replace the header logo's inner `<svg>` paths with the `IconLive` paths, keeping the
  header's sizing (width/height 21, adjust `viewBox` to 32×32 or rescale the paths) and
  `stroke="currentColor"` so it inherits theme color.
- Consider extracting `IconLive` into a shared icon (e.g. `src/components/icons.jsx` or
  export from where it lives) so the sidebar header and the notebook switcher render the
  exact same source — avoids drift.
- Leave the notebook window/dock PNG icons alone; this is only the in-app sidebar mark.

**Accept:** sidebar header shows the same quill as the notebook Live-mode button, in
theme stroke color (no filled nib).

---

## 2. Quicknote fan still fans inward/down — want a card peeking behind, up-and-out

**File:** `src/views/QuickNoteView.jsx` — `.qn-fan*` CSS (~463–483), fan JSX (~411–423).
Current: `left/right:4px`, `transform-origin:50% 100%`, `rotate(±3deg)`; back sliver at
`±-2px rotate(±6.5deg)`. Reads as bottom-inward because the sliver sits under the card
with origin at the bottom.

**Wanted:** looks like another card stacked *behind* the current one, offset up and
outward (top corner splayed away from center), like a deck.

**Plan:**
- Move origin to the inner-bottom corner (`left`→`0% 100%`, `right`→`100% 100%`) so
  rotation swings the top edge outward, not the whole sliver.
- Add an upward + outward translate so the peek clears the card top:
  e.g. `.qn-fan-left{ left:-3px; transform: translateY(-6px) rotate(-5deg) }`.
- Back sliver sits higher and further out still (`translateY(-11px) rotate(-8deg)`,
  lower opacity) to imply depth.
- Keep click handlers (left→`goToIndex(idx+1)`, right→`idx-1`) and hover nudge.

**Accept:** with ≥3 notes both edges show a card peeking behind-and-above, splayed out.

---

## 3. Book covers render huge in global search  ← quick win, do first

**Root cause:** `SearchDropdown` (`src/views/LibraryView.jsx:497`) relies on
`.search-drop-*` CSS that is defined *inside LibraryView's render* `<style>` block
(`LibraryView.jsx:4097`, `.search-drop-cover{width:30px;height:42px;overflow:hidden}`).
When the titlebar mounts `SearchDropdown` standalone (`App.jsx:1492`) LibraryView isn't
rendered, so that CSS is absent → cover `<img>` renders at natural (massive) size.

**Fix:** move the `.search-drop-*` rules out of LibraryView's inline `<style>` into
`src/styles/global.css` (or emit them from inside `SearchDropdown` itself). No JSX
change needed. Verify covers are 30×42 in the titlebar search after.

---

## 4. Toolbar customizer — edit the real toolbar, not a mock page

**Current:** `CustomizeToolbarPage` (`src/App.jsx`) is a separate overlay with a mock of
the three zones. User wants: the *actual* title bar stays visible and interactive as the
drop surface, the rest of the app dims/blurs, and a floating **palette box** holds all
toolbar elements (available + hidden) to drag onto/around the toolbar.

**Plan (reuse existing `titlebarLayout` model + pointer DnD from phase 1):**
- Keep the store model (`titlebarLayout {left,center,right,tray}`, `migrateTitlebarLayout`
  in `useAppStore.js`) and the `TITLEBAR_CHIP_DEFS` + `chipIcon` registry.
- Replace the mock-page overlay with: full-screen scrim that `backdrop-filter: blur` +
  dims everything EXCEPT the real `.gnos-titlebar` (raise titlebar z-index above scrim
  while customize is open; add a `.customizing` class on it).
- Titlebar zones become live drop targets in customize mode: hovering shows insertion
  indicators; drop rewrites the zone arrays + persists (same `moveItem`/`hitTest` logic,
  retargeted at the real `.gnos-tb-left/center/right` DOM via refs).
- Floating **palette box** (bottom-center) lists every movable id as a draggable chip;
  dragging one onto a zone inserts it, dragging a toolbar item onto the palette trays it.
- Keep entry points (titlebar right-click, View→Customize Toolbar…) and Done/Restore.

**Accept:** open customize → app dims, toolbar stays crisp; drag Home from the palette
into the center, reorder in place, drag it back to the palette → persists across relaunch.

---

## 5. Widgets in quick notes (math, graph, tasks, timer, habits)  ← biggest

**Current split:** the notebook CM editor wires the rich plugins —
`makeMathCalcPlugin` (`NotebookView.jsx:1012`), `makeLivePlugin` (widget decorations for
`/tasks` `/habits` `/timer` `/graph` `/pomo`), slash commands, etc., assembled at
`NotebookView.jsx:6612` `const extensions = [...]`. The quick-note editor
(`QuickNoteView.jsx:123–185`) is a minimal CodeMirror with only markdown styling.

**Plan — extract shared, then opt-in for quicknote:**
- New module `src/lib/notebookEditor.js` (or `cmExtensions.js`) exporting factory fns for
  the reusable plugins (math calc, live widgets, slash commands, smart-enter, theme).
  Move them out of `NotebookView.jsx`; NotebookView imports them (no behavior change).
- QuickNoteView builds its extension list from the shared module, enabling the subset:
  math calc, `/tasks`, `/timer`, `/graph`, `/habits`. Skip wikilinks/backlinks (no
  notebook context in the popup) unless trivially safe.
- Watch for notebook-only deps the widgets close over (notebooks/library/sketchbooks
  lists, `notebookDirRef`) — pass empty/quicknote-appropriate values or guard.
- Persistence: quicknote already saves raw markdown; widgets serialize back to their
  `/…` source lines, so round-trip should hold — verify save/reload keeps widget state.

**Accept:** in a quick note, `/tasks`, `/timer`, a `/graph`, and `expr=` all render and
work like the notebook; saving and reopening preserves them.

**Risk:** heaviest item; NotebookView is ~9k lines. Extract incrementally, keep notebook
green (`npm run build`) after each moved plugin before wiring quicknote.

---

## 6. `/math` active indicator (∑) at top of editor area

**What:** when a `/math` zone is open, show just the ∑ indicator symbol:
- **Notebook:** top-left of the text/editor area (top of the page).
- **Quicknote:** top-right next to the save dot (`.qn-save-dot`, `QuickNoteView.jsx:419`).

**State source:** notebook already computes open math zones
(`computeMathZones`, ~`NotebookView.jsx:1214`). Expose whether the doc currently has an
open `/math` zone (or the cursor sits inside one) as React state, render a small absolute
`∑` chip in the editor's top-left. Quicknote: detect `/math`…`/math end` in `text`
(same regex as `parseTimerLine` neighbors) and render a `∑` next to the save dot.

Reuse the existing `.cm-mathzone-badge` / `.cm-mathzone-icon` styling
(`global.css`, added phase "C"). Symbol-only, no label.

**Note:** user gave two placements ("top of page" + "top-right by save"); resolved as
per-view above (notebook=top-left editor, quicknote=top-right by save). Flag if they meant
identical placement in both.

---

## 7. Notebook `/timer` as a left-side rail (like quicknote)

**Current:** notebook `/timer` renders an inline `cm-timer` widget in the flow. Quicknote
has a vertical left-edge rail (`.qn-rail*`, `QuickNoteView.jsx:379`, CSS in QN_CSS).

**Wanted:** notebook timer sits on the left-hand side as a rail, same as quicknote.

**Plan:** give the notebook timer the qn-rail treatment — a fixed/absolute vertical rail
pinned to the left of the editor column instead of an inline widget. Simplest: port the
`.qn-rail` markup+CSS into a small notebook-side component driven by the notebook's timer
state (or, if timers live as `/timer` widgets, have the widget mount the rail into a
left gutter rather than inline). Confirm whether multiple concurrent notebook timers are
allowed — quicknote assumes one; if notebook allows many, stack rails or keep one active.

---

## 8. Natural math — shorthand units + more date phrasing  ← `today - 2d` is broken

**Bug:** `today - 2d` yields `-2*d` — `tryDateMath` (`NotebookView.jsx:1063`) only accepts
full unit words; its `UNITS` regex (~`:1066`) has no shorthand, so `2d` falls through to
mathjs which reads `d` as a variable.

**Plan:**
- Extend `UNITS` + `applyDur`/`isTimeUnit` to accept shorthand: `s h d w y`, `mo`/`m`
  (disambiguate `m`=month vs `min` — treat bare `m` as month, `min`/`mins` as minutes),
  e.g. `today + 7w`, `today - 2d`, `in 3mo`, `5y ago`.
- Add date−date subtraction → duration (e.g. `2026-01-01 - today` → “N days”).
- Broaden phrasing already partially there (`next friday + 2w`, `days until <date>`); add
  `weeks/months until`, `<weekday> after next`, ISO/`MM/DD` bases.
- Keep it inside `tryDateMath` so it runs before mathjs and returns a formatted string.

**Accept:** `today - 2d`, `today + 7w`, `in 3mo`, `next friday + 2w` all render correct
dates as ghost text after `=`.

---

### Cross-cutting
- Shared controls (phase 1) already landed — reuse `@/components/Controls` for any new
  toggles/sliders/selects.
- Pre-existing lint noise: `App.jsx` impure-function-in-render; PluginManagerView unused
  import + effect-setState warnings; ~20 NotebookView unused-vars. Not yours — diff
  against `git show HEAD:<file>` before chasing.
