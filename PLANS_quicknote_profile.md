# Handoff plan — quicknote bugs + settings + profile window

4 items from user review. Anchors are file:line at write time — reverify with grep.
Build: `npm run build`; Rust: `cd src-tauri && cargo check` only if lib.rs touched.
Log every visual change to `UI_CHANGES.md` (append; user reverts by section).
Don't commit unless asked.

Order: 1 (data-loss-adjacent, do first) → 3 (quick, isolated) → 2 → 4 (biggest).

---

## 1. "9 empty notes" on every quick-note open

**Root cause (leading hypothesis, unverified — needs runtime check):** the archive-mode
reload in `QuickNoteView.jsx` boot (~`:117-126`) adds every notebook meta with
`m.quickNote === true` to the stack, with **no check that the note actually has content**:

```js
const olds = (metas || [])
  .filter(m => m.quickNote)
  .sort(...)
  .map(m => ({ id: m.id, createdAt: m.createdAt, filePath: null, draft: false }))
```

Before the `prev`-guard fix landed this session (`UI_CHANGES.md` §R), `doSave` auto-deleted
any saved quick note whenever the editor emptied — but only *reactively*, when the user
next typed in that specific note. If a note was ever created with borderline/empty content
via a race (autosave firing during window-hide, or a StrictMode double-effect in `tauri dev`),
its `meta.json` + empty `.md` could persist on disk indefinitely, uncounted and unfiltered.
Each launch re-adds all of them → the stack balloons with blanks. "9" is just how many such
orphans have accumulated in this archive.

**Plan:**
- Add a **one-time sweep** (on boot, archive mode only): for each `quickNote` meta, check
  `wordCount` (already stored in `meta.json` by `saveQuickNoteAsNotebook`,
  `storage.js:1013`) — if `0`/falsy, treat as an orphan. Two options, pick one:
  - (a) Filter them out of the stack silently (`.filter(m => m.quickNote && m.wordCount > 0)`),
    leaving the orphaned folders on disk (safe, non-destructive, but doesn't clean up).
  - (b) Same filter, **plus** call `deleteQuickNote(m.id)` on each orphan so they stop
    existing at all (matches user intent — they don't want 9 phantom notes). Recommended.
- **Before shipping the fix**, actually reproduce: open the real app, open quick note,
  count how many blank cards appear (flip via swipe/arrow), and inspect
  `<archive>/notebooks/*/meta.json` for `quickNote: true, wordCount: 0` entries to confirm
  this hypothesis before writing the fix. If wordCount isn't 0 for these entries, the bug is
  elsewhere (e.g. `loadNotebookContent` failing to find the matching folder — check
  `storage.js:527-556` folder-lookup logic against these specific IDs) and needs fresh
  investigation.
- If `tauri dev` is how the user runs this, also check whether `main.jsx`'s `<StrictMode>`
  (`main.jsx:25`) is responsible for any *new* orphans going forward (StrictMode
  double-invokes effects in dev only, never in the packaged app) — not a fix, just rule
  in/out as an ongoing source during development.

**Accept:** launching quick note shows only notes with real content; the 9 existing blanks
are gone from the stack (and from disk, if option b).

---

## 2. Setting to disable the fanned-card peek

**Plan:**
- Store: add `quickNoteFanEnabled: true` to `useAppStore.js` defaults (~`:513` alongside
  `quickNoteDir`), thread it through `init()`'s destructure/set (~`:601-615`) and
  `persistPreferences()`'s payload (~`:673-675`) — mirror exactly how `quickNoteDir` and
  `sidebarPinned` are wired.
- Settings UI: `Sidenav.jsx`, in the existing "Quick Note" section (`:966-1000`, right
  after the folder-picker buttons at `:983-1000`) — add a `Toggle` (`@/components/Controls`,
  already imported at `Sidenav.jsx:8`) labeled "Show fanned card peek" bound to
  `quickNoteFanEnabled`, calling `pref('quickNoteFanEnabled', v)` (same pattern as the
  folder buttons' `pref(...)` calls).
- `QuickNoteView.jsx`: read the pref at boot (`loadPreferences()` already happens at
  `:112`) and store it in state; also refresh it in the existing `quicknote:focus` listener
  (`:333-344`) so a toggle flipped while the popup is hidden takes effect next open without
  a full relaunch. Gate the two `<div className="qn-fan ...">` renders (`:428-437`) behind
  `fanEnabled &&`.
- When disabled, `.qn-card`'s inset can optionally tighten back toward the window edges
  (currently `26px 34px 12px 34px` to leave fan room) — cosmetic, not required, flag to user
  whether they want the card to reclaim that space when fans are off or keep consistent
  sizing. Simplest: leave the inset as-is either way (less code, fan-off just shows the
  plain card with a bit of extra margin).

**Accept:** toggle in Settings → Quick Note; off = no peeking cards ever, on = current
behavior. Persists across restart.

---

## 3. Weird outline around the quick-note window

**Root cause (leading hypothesis):** the quick-note `WebviewWindowBuilder` in
`src-tauri/src/lib.rs` (~`:322-335`) sets `.decorations(false)` and `.transparent(true)`
but never calls `.shadow(false)`. macOS draws its own soft drop shadow around borderless/
transparent windows by default, following the **rectangular window bounds** — not the
rounded `.qn-card` inside it. That native shadow compounds with the CSS shadows already on
`.qn-card` (`box-shadow: 0 16px 44px rgba(0,0,0,.5)`, `QuickNoteView.jsx:515`) and each
`.qn-fan` (`0 8px 24px rgba(0,0,0,.35)`, `:527`), producing the ragged/jagged halo visible
around the card in screenshots.

**Plan:**
- Add `.shadow(false)` to the quicknote `WebviewWindowBuilder` chain in `lib.rs` (same
  builder as `:322-335`), so only the CSS-drawn shadows render.
- Rebuild via Tauri (`cargo check` first, then a real `tauri dev`/`tauri build` — this is
  Rust + native window chrome, unverifiable from the web preview) and confirm the fringe is
  gone. If any halo remains, it's coming from the compounded CSS shadows themselves (card +
  2 fan cards each with their own blur) — reduce `.qn-fan`'s box-shadow blur/spread or drop
  it entirely and rely on the border + front card's shadow to imply depth.

**Accept:** quick-note window has a single clean shadow matching `.qn-card`'s rounded
corners, no rectangular ghost/fringe beyond it.

---

## 4. Profile window lost the app's design language (heat grid + Top Books)

**Current state:** `src/views/ProfileWindowView.jsx` (177 lines) is a bare-bones
reimplementation — avatar, name, a 7-dot streak row, and a plain 3-col stat grid. It does
**not** reuse any of the app's existing profile design.

**The real design already exists** in `ProfileModal` inside `LibraryView.jsx`
(`:2356-2760`, ~400 lines) — this is what mobile still uses. It has:
- Tabs: `const TABS = [['stats','Stats'],['review','Review'],['calendar','Calendar'],['habits','Habits']]`
  (`LibraryView.jsx:2461`, tab bar rendered `:2517-2524` and again `:2747`).
- **365-day GitHub-style heatmap** — computed in a `useMemo` (`:2461-2480`,
  `heatmapDays` built from the reading log, bucketed into levels), rendered as a CSS grid of
  10px cells (`:2696-2697`) with a legend (`:2700+`) using
  `heatAlpha = ['0','0.22','0.45','0.7','1']` opacity buckets over `var(--accent)`.
- **"Top Books by Progress"** section header at `:2711`, listing books ranked by reading
  progress.
- Review-period switcher (week/month/year, `reviewPeriod` state, `:2489`).

**Plan — don't reimplement, extract and share:**
- Pull the *content* of `ProfileModal` (everything inside the modal panel, not the
  fixed-position backdrop/modal chrome at `:2506-2513`) into a new shared component, e.g.
  `src/components/ProfileContent.jsx`, parameterized so it works both:
  - embedded in `LibraryView`'s modal wrapper (mobile + desktop-in-app profile), and
  - as the full page body of `ProfileWindowView.jsx` (desktop dedicated window).
- `ProfileContent` needs: `library`, `notebooks`, `username`, `calendarEvents` — same data
  `ProfileWindowView` already loads at boot (`:26-32`) plus whatever `ProfileModal` reads
  from `useAppStore` directly (`:2360-2363`) that `ProfileWindowView` doesn't currently
  fetch (habits needs `loadNotebookContent` per-notebook, todos needs its own loader — grep
  `todoLists`/`habitBlocks` state in `ProfileModal` for the full data-fetch list before
  extracting, `:2370-2410` is the habits-tab loader as a starting point).
  loaded).
- Update `LibraryView.jsx`'s `ProfileModal` (`:2356`) to render `<ProfileContent .../>`
  inside its existing modal chrome — should be behavior-identical after the split (verify
  mobile profile still opens/tabs correctly).
- Update `ProfileWindowView.jsx` to drop its bespoke avatar/streak/grid JSX (`:89-125`) and
  render `<ProfileContent .../>` inside its own `.pw-root`/`.pw-drag` wrapper (`:90-93`),
  passing whatever props it already loads. This is the biggest single piece of the 4 items —
  budget for it accordingly, and keep `npm run build` green after the extraction step, before
  wiring the second consumer.
- Confirm which tabs the user actually wants in the **window** version — Stats + the heat
  grid + Top Books were named explicitly; Review/Calendar/Habits tabs may or may not be
  wanted in the compact window (ask if unclear, don't assume all 4 need to fit).

**Accept:** Profile window shows the same visual language as the in-app profile modal —
streak, 365-day heat grid with legend, Top Books by Progress — not the current bare stat
grid.

---

### Cross-cutting
- Reuse `@/components/Controls` (`Toggle`) for item 2's new setting.
- Item 3 is Rust/native — can't be verified via the web preview; needs a real `tauri dev`
  run.
- Item 1's fix should not ship without first confirming the root-cause hypothesis against
  the user's actual archive data (read a few `meta.json` files for `quickNote: true`
  entries) — don't blind-fix based on code reading alone this time, since a wrong
  assumption here risks deleting notes that aren't actually empty.
