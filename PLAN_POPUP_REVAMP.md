# Plan — Pop-out/dropdown/modal revamp, one component at a time

Living checklist. Each pass: redesign one component below using the
`impeccable` skill, `ui-ux-pro-max` skill, and the UI/UX guidelines in
`~/Lookatthis/*.md` (via `webdesign`). Confirm each with the user before
moving to the next — same small-steps approach as `PLAN_LIBRARY_NAV.md`.

Full repo scan for every named Modal/Popup/Menu/Dropdown/Picker component is
below, grouped into passes. Order picked so early passes establish a shared
visual language (menu style, form style) that later passes can just reuse
instead of re-deciding from scratch each time.

## Process — read this first if you're picking this up fresh

**Workflow, every single change, no exceptions:**
1. Pick ONE item from the audit list below. Don't batch multiple items into
   one change — this project's whole value has been going slow and
   confirming with the user at each step, not big-bang rewrites.
2. Look for the bug classes below before inventing new work — they've
   repeated across nearly every pass so far and are cheap to check for:
   - Unicode glyph standing in for an icon (`×`, `⋯`, `···`, `‹`/`›`) —
     replace with a real `lucide-react` icon (or, in a vanilla-DOM
     CodeMirror widget where React components aren't available, a
     hand-written inline `<svg>` matching lucide's path data — grep
     `node_modules/lucide-react/dist/esm/icons/<name>.mjs` for the exact
     `d=` path rather than approximating it).
   - `'var(--accent)14'`-style string concatenation for alpha — invalid
     CSS, silently produces no color at all. Fix: `color-mix(in srgb,
     var(--accent) 14%, transparent)`.
   - Hardcoded `rgba(56,139,253,X)` or solid `#388bfd` — the dark theme's
     literal accent RGB baked in instead of `var(--accent)`; wrong on any
     other theme. (Solid, non-alpha instances like `--addBookIcon` are a
     separate, deliberately-deferred case — see audit list.)
   - A colored left/top border ("side-tab") on a card/row as a status or
     category indicator — craft-floor's most-flagged AI-slop tell. Replace
     with a small dot/ring, not a border stripe (see `KanbanCardModal`'s
     column-color ring, or `FlashcardView.jsx`'s `.fc-list-color-dot`).
   - Wrong red for destructive actions — app standard is `#f85149`, not
     `#ef4444`/`#ef5350`.
3. Verify — **live, not just code review** — before calling anything done:
   - Onboarding bypass unlocks real browser-preview testing:
     `localStorage.setItem('gnos_onboarding_done','1')` then reload. Skips
     straight to the app with its sample library. `window.__appStore` is
     exposed globally for direct state/nav
     (`window.__appStore.getState().navigate({view:'kanban'})`) — faster
     than clicking through nav for a specific view.
   - `npx eslint <file>` — compare the error *count* against what it was
     before your change, don't chase pre-existing unrelated errors in the
     same file (this repo has a real baseline in several files; check
     `UI_CHANGES.md`'s recent entries for the current baseline per file
     you're touching).
   - `npx vite build` — must stay green. Can take >120s; let it background
     and check back rather than blocking.
   - `node ~/.claude/skills/impeccable/scripts/detect.mjs --json <file>` —
     the mechanical antipattern scanner. A finding isn't automatically a
     defect (read its context before "fixing" it) but don't ignore it
     silently either.
4. Log the change in **both** places, every time:
   - `UI_CHANGES.md` — new lettered entry (currently at A125; next is
     A126), same format as the existing entries: what was wrong, what
     changed, what was deliberately left alone and why, how it was
     verified.
   - This file — check the box, add a line under the relevant pass (or add
     a new pass if it's not covered by an existing one).
5. Confirm with the user before moving to the next item. Don't chain
   multiple audit items into one uninterrupted run — several rounds in
   this project only found their real fix after the user saw a live result
   and reacted (e.g. the kanban modal took 6 rounds — A113 through A118 —
   each driven by fresh user feedback on the *previous* round's output,
   not predicted up front).

**Established design language so far** (don't reinvent per-component):
- Radius family: 8px for cards/fields/buttons/columns in anything touched
  by this project. Collapse one-off 4-10px values you find to this.
- Type scale inside modals: settled at roughly 11px (labels/meta/badges),
  13px (body/fields/buttons), 17px (modal heading) — see
  `KanbanCardModal`'s comment block in `LibraryView.jsx` for the reasoning
  (was 7 near-duplicate sizes bunched together with no rhythm).
- Spacing: 4px-based grid (4/8/12/16/20/24), not arbitrary values.
- Color hierarchy inside modals: `var(--text)` (white) reserved for
  section labels, the selected/active state of a segmented control, and
  primary+secondary footer action buttons. `var(--textDim)` for
  everything else (subtitles, placeholders, unselected states, meta/
  timestamps). Don't let the white/dim split be arbitrary — pick which
  bucket a new element belongs to on purpose.
- Footer convention: destructive action separate on the left (own red
  outline style), Cancel + primary action split 50/50 on the right.
- **Focus state — deliberately none, as of A125.** No border color change,
  no box-shadow ring, no outline, anywhere in the app — the user
  explicitly asked for this after several rounds of "still too blue" (see
  A121/A123/A124/A125 in `UI_CHANGES.md`). `--focusBorder`/`--focusRing`
  tokens in `global.css` `:root` exist and are wired everywhere but both
  currently resolve to a no-op. **Do not "fix" this by reintroducing a
  focus ring/outline/border-color change** — that undoes an explicit,
  repeated user decision, not a bug. If accessibility concerns come up,
  raise it with the user rather than silently reverting.
- No-fake-data principle, every pass: never invent UI for a field the data
  model doesn't have (assignee avatars, attachment counts, character
  counters, linked-record previews). Reformat/derive from real fields, or
  — if the feature genuinely needs it — extend the data model for real
  (see A120: extended the notebook `/kanban` widget's task shape with
  `priority`/`description`/`comments` rather than faking a modal around
  fields that didn't exist) and say so explicitly in the changelog entry.

## Status

- [x] **Pass 1 — Context menus** — DONE, logged as A101 in `UI_CHANGES.md`.
  - [x] `SideNavCtxMenu` — was `src/components/SideNav.jsx:1194`, deleted
  - [x] `ContextMenu`/`CtxSubmenu` — was `src/views/LibraryView.jsx:217`,
        deleted
  - Unified into one shared `src/components/ContextMenu.jsx`, imported by
    both files. Also collapsed 4 overlapping CSS class families in
    `global.css` down to one (`.context-menu`/`.ctx-item`), added keyboard
    nav (none of the old three had any), standardized danger-red and icon
    size, kept the better of the two submenu-positioning implementations.
  - `LibContextMenu` (`src/views/LibraryView.jsx:344`) turned out to be a
    mislabeled duplicate of `AddPopup`, not a real "context menu" — moved to
    the Pass 2 grouping below, not touched in Pass 1.
  - **Round 2 (A102)**, from live screenshots: fixed sidebar collection-row/
    type-folder-row chevron misalignment (collections now share
    `.sidenav-nav-item` styling instead of a bespoke divergent row);
    context-menu row padding now symmetric (7px/7px, was 5px/7px); corners
    less round (container 8→5px, row 5→3px); added a collection icon
    picker + `CollectionFace` precedence component (emoji > icon > color >
    Folder) — wired into the sidebar tree only, **not yet** into
    LibraryView.jsx's collection cards/detail header/bulk picker.
  - **Round 3 (A103)**, from a reference screenshot the user liked
    (Todoist-style menu): `.ctx-item` font-weight 500→400, size 13→12.5px,
    padding 7→8px — was the "fat/bloated" complaint, mostly the weight.
    Emoji picker dropped from `CollectionEditModal` (kept as read-only
    legacy field). Real `CollectionFace` icons now render in both the
    Add-to-Collection picker and the Move-Into submenu (was plain text);
    Move-Into also sorted alphabetically and had its own `quicknotes` leak
    fixed. `ContextMenu.jsx` gained a general `iconNode` prop (top-level +
    submenu) for non-string icons. File shuffle:
    `src/lib/collectionIcons.jsx` (CollectionFace, component-only) +
    `src/lib/collectionIconData.js` (the icon array/map, plain data) +
    `collectionSubmenu.jsx` — split to satisfy
    `react-refresh/only-export-components`.
  - **Not yet visually verified** — browser preview can't clear onboarding
    (needs real Tauri fs). Confirm in `npm run tauri:dev` before calling
    this pass fully closed: both menus render identically, submenu
    flip/scroll, arrow-key nav, danger-red rows, sidebar chevrons now form
    one column, collection icon picker saves/renders correctly, menu text
    reads leaner not bloated, collection icons show in both pickers.

- [x] **Pass 2 — Add-item popups** — DONE, logged as A105 in `UI_CHANGES.md`.
  - [x] `SidebarAddPopup`, `AddPopup`, `LibContextMenu` — all three deleted,
        unified into `src/components/AddPopup.jsx` with a `variant` prop
        (`up`/`down`/`fixed`/`sheet`/`center`) covering every anchor shape.
        Container reuses `ContextMenu.jsx`'s `.context-menu` class — both
        popup families share one chrome now.
  - Real inconsistencies found and fixed, not just duplicated code: sidebar
    version was missing "Open File…"; Audiobook icon disagreed (Volume2 vs
    Music); icon color disagreed (muted vs accent-tinted); header text
    disagreed ("Add to Library" vs "Add").
  - **Real bug found and fixed**: `LibraryView.jsx`'s desktop "add" path
    (empty-library "+", `open-add` command) was completely dead —
    `addOpen` state existed but nothing rendered for it outside
    `isMobile`. New `variant="center"` wires it up.
  - Still open (not done in this pass): wire `CollectionFace` (A102,
    `src/lib/collectionIcons.jsx`) into LibraryView.jsx's collection
    cards, collection detail header, and the bulk-select "Add to
    Collection" picker — they still render emoji-only and don't know
    about `col.icon` yet.
  - **Not yet visually verified** — browser preview can't clear onboarding
    (needs real Tauri fs). Confirm in `npm run tauri:dev`: all four
    trigger points (sidebar +, titlebar +, library right-click,
    empty-library +) open the same-looking popup with all 7 choices,
    mobile sheet still works, desktop centered popup (previously blank)
    now actually shows something.

- [x] **Pass 3 — Settings** — DONE, logged as A106 in `UI_CHANGES.md`.
  - [x] `UniversalSettingsModal` — already well-architected (shared
        `SettingsRow`/`SettingsSectionLabel`/`Toggle`/`Slider`/
        `.gnos-select` used consistently, no duplicate popups to unify).
        Pass was polish: 4 unicode-glyph-as-icon spots replaced with real
        lucide icons (craft-floor ban); `PluginsSettingsPanel` had its own
        hand-rolled toggle (34×20px) instead of the shared `Toggle` used
        everywhere else in the same modal — replaced; Export/Import
        buttons were missing `fontFamily: 'inherit'` (would've rendered in
        the browser default font); modal corner radius 14→10px, closer to
        Pass 1/2's less-round direction.
  - **Not yet visually verified** — same Tauri-fs limitation as every
    prior pass.

- [x] **Pass 4 — Edit/detail modals** — DONE, logged as A107 in
      `UI_CHANGES.md`. Turned out to be mostly a `KanbanBoard`/
      `KanbanCardModal` redesign (user supplied 3 reference screenshots and
      flagged the kanban board specifically as looking "terrible") plus a
      consistency sweep of the rest.
  - [x] `KanbanCardModal` — `src/views/LibraryView.jsx` — real redesign:
        removed the card's colored left border-bar (craft-floor's banned
        "side-tab" AI-slop tell, confirmed by the mechanical detector) in
        favor of a small color dot; column titles un-uppercased into real
        headings; column color swatches squared→circular; 5 unicode-glyph
        icons replaced with lucide (`×`→`X`, `⋯`→`Ellipsis` with a real
        hover state, `+`→`Plus`, `···`→`AlignLeft`); wrong red (`#ef4444`)
        → app-standard `#f85149`; radius 18→14px; padding evened out;
        one dead line (`isInlineColorOpen`) removed.
  - [x] **Same wrong-red bug found and fixed in `EventModal`**
        (`src/components/Calendar.jsx`) — byte-identical delete-button
        style object to the kanban one, clearly copy-pasted from the same
        origin. A third instance in `NotebookView.jsx` is a genuine
        multi-color palette array, not a bug — left alone.
  - [x] **Round 2 (A110)** — user asked for "near 1:1" matching against
        the reference screenshots, specifically the dark one. Fixed the
        column/card elevation hierarchy (was backwards — columns lighter
        than cards, opposite of the reference); column color swatch dot→
        hollow ring; column delete button→`…`-menu via the shared
        `ContextMenu` (Rename/Delete); card rebuilt into the reference's
        3-row shape (status ring + real ticket code + priority flag +
        edit / title / comment-count + relative due-date label); new real
        `card.priority` field (colored flag, user-set — the one place this
        round added a field rather than reformatting one, deliberately not
        faking an assignee avatar or attachment count since this app has
        no backing feature for either); "+ Add task" simplified to a plain
        text row. Default board's 4 starter columns now get distinct
        colors instead of all-red. Also, separately: `/todo` (dead — no
        widget ever rendered it) removed and consolidated into `/kanban`,
        which is `/task`'s already-working multi-column board renamed
        (`parseTaskBlock` accepts both headers for old notebooks;
        `serializeTaskBlock` now always writes `/kanban`).
  - [x] `SideEditModal`, `EditItemModal`, `MissingSourceModal` — swept for
        the same bug classes (unicode-icons, wrong red, radius outliers).
        None found; already clean, no changes made.
  - [x] `CollectionEditModal` — already got its own pass across A102/A103
        (icon picker, emoji removal) earlier in this project; not revisited
        here.
  - [x] **Round 3 (A113)** — user supplied 3 more edit-modal references
        (macOS "Create an Event", light "Schedule new interview", dark
        "Share project") and asked specifically for `KanbanCardModal`'s
        cleanliness to match. Rebuilt: fixed heading+subtitle separate
        from the editable Title field (was: editable title doubled as the
        header); uppercase section labels replacing the old icon-per-row
        convention; real divider lines between sections; bordered fields
        with an accent focus ring (fields had none before); priority
        moved from wrapped bordered buttons to one segmented pill toggle;
        footer rebuilt to Delete (left) + new Cancel + solid primary
        (right). Skipped the character-limit counter and linked-record
        preview card from the refs — no backing data for either. Verified
        live in the browser preview (create flow, focus ring, edit-mode
        prefill, Delete only in edit mode). eslint/build/impeccable clean.
  - [x] **Round 4 (A114)** — user asked for Cancel/primary footer 50/50,
        plus flagged the modal still felt off, unspecified. Diagnosed via
        `impeccable` critique checklist instead of guessing: Comments was
        rendering unconditionally, so create-mode showed a comment thread
        for a task with no id yet. Gated `!isNew`, same as Delete. Footer
        Cancel+primary now `flex:1` each; Delete unaffected, still
        fixed-width/left. Verified live both modes, eslint/build clean.
  - **Visually verified live** — onboarding bypass unblocked real
    browser-preview testing starting at A112; this pass (and A113) were
    checked against the actual running app, not just static review.

- [ ] Bulk-select "Add to Collection" picker — `src/views/LibraryView.jsx:3333`
      (the multi-select toolbar's own bespoke dropdown, not the shared
      `ContextMenu`). Found during the Pass-1 follow-up fix below with the
      same bug: `(collections || []).map(...)` unfiltered/unsorted, leaks
      `quicknotes` into the list. Not fixed yet — flagged for whichever pass
      covers this picker (Pass 5, or fold into Pass 1's follow-up if doing
      another round there).

- [x] **Pass 5 — Dropdowns & pickers** — DONE, logged as A108 in
      `UI_CHANGES.md`. Most items were already clean; the real value was
      two systemic bugs found while checking `CollectionSwitcher`.
  - [x] `NavDropdown`, `SearchDropdown`, `ChapterDropdown`,
        `MonthYearPicker`, `NbShareMenu` — swept for unicode-icons/wrong-red/
        radius outliers, all clean, no changes needed.
  - [x] `CollectionSwitcher` picker popup — container bg/radius aligned;
        **found and fixed a real bug**: active-row highlight used the
        invalid CSS string `'var(--accent)14'` (not a valid way to add
        alpha to a `var()`), so it silently never highlighted. Fixed with
        `color-mix(...)`.
  - [x] Bulk-select "Add to Collection" picker — the quicknotes-leak fix
        flagged back in A102, done now: filtered, sorted, real
        `CollectionFace` icons. Bulk-delete button's wrong red
        (`#ef5350`) also fixed.
  - [x] `showDateTimePicker`/`_makeTaskDatePicker` — chrome already solid;
        found their "selected date" highlight hardcoded as
        `rgba(56,139,253,X)` (the dark theme's literal accent RGB) instead
        of `var(--accent)` — wrong color on every other theme. Fixed both.
  - [ ] `makeWikiDropdownPlugin` (`@`-mention autocomplete) and the
        slash-command menu (`makeSlashSource`) — **not done**. These are
        CodeMirror `autocomplete()` extensions with zero custom styling
        found anywhere (no `.cm-tooltip-autocomplete`/`.cm-completionLabel`
        overrides) — render in CodeMirror's bare default theme. Needs an
        `EditorView.theme()` block, different work than the React-modal
        passes so far. Not started.
  - **New finding, `var(--accent)14`-style bug**: 8 near-identical siblings
    found (`GraphView.jsx` ×5, `LibraryView.jsx` ×2 more) — all fixed.
  - **New finding, `rgba(56,139,253,X)` hardcoded-dark-accent bug — DONE,
    logged as A109.** User asked for a quick pass rather than deferring.
    80 real instances (not 151 — that figure was a shell-glob
    double-counting artifact) across `App.jsx`, `SideNav.jsx`,
    `LibraryView.jsx`, `NotebookView.jsx`, `ReaderView.jsx`,
    `SketchbookView.jsx`, `global.css` — mechanical mass-replace to
    `color-mix(in srgb, var(--accent) X%, transparent)`, confirmed
    zero remaining via re-grep. Solid (non-alpha) hardcoded `#388bfd`
    fills deliberately left alone — different, needs-judgment bug, not
    swept.

- [x] **Notebook-embedded `/kanban` widget — DONE, logged as A119.**
      Separate implementation from Pass 4's `KanbanBoard` — a vanilla-DOM
      `TaskBlockWidget` in `NotebookView.jsx` (plus a read-only preview
      HTML renderer) that A110-A118 never touched. User spotted it live
      and asked what happened. Redesigned to match: solid rainbow header
      bar → hollow color ring, uppercase 10px titles → real-case 13px,
      unicode `×` → the existing stroke-X SVG pattern (reused from the
      Habits widget), 6 scattered font sizes → 2 (13/11) + one 14px board
      title, border-radii 4-10px → unified 8px including the global.css
      `!important` override. Verified live in a real notebook + computed
      styles.
  - [x] **Follow-up (A120)** — user asked for a real edit modal on these
        cards, not just inline rename; chose to extend the widget's task
        data model too (was `{text,date}` only). Added
        `priority`/`description`/`comments`, extended the `{date:...}`
        markdown tag convention with `{priority:...}`/`{desc:BASE64}`/
        `{comments:BASE64-JSON}`, built `_openTaskCardModal` — a
        vanilla-DOM rebuild of `KanbanCardModal` matching its exact
        visual language (A113-A118) since this render path can't use
        React components. Verified live: set priority+description,
        saved, reopened, confirmed both round-tripped through markdown.

- [ ] **Pass 6 — Standalone bigger modals**
  - [ ] `ProfileModal` — `src/views/LibraryView.jsx:1546`
  - [ ] `TabLayoutModal` — `src/App.jsx:173`

- [x] Notebook-embedded `/kanban` widget follow-ups — DONE, logged as
      A121-A125 in `UI_CHANGES.md`. Not a new component, a cross-cutting
      fix that started here and ended up touching every text-entry field
      app-wide: the add-card input's focus border read as "bright blue,
      distracting," which led through 4 rounds (muted-accent → neutral →
      found the real global `:focus-visible` outline rule as root cause →
      dropped to no highlight at all) to the "Focus state" rule in the
      Process section above. Also fixed two always-on (non-focus) accent
      borders found along the way: `.cm-task-add-col-input` and dead CSS
      `.cm-task-card-edit` (orphaned once A120 replaced inline-rename with
      a modal).

- [x] `FlashcardView.jsx` side-tab border — DONE, logged as A122. Only a
      partial fix, not a full pass on this file (see open item below):
      the `impeccable` hook flagged 2 `side-tab` findings while the file
      was open for the focus-ring sweep. One was dead CSS (`[data-color]`
      attribute selector, never actually set by any JSX — removed
      outright), the other was live (`card.color` list-row left border) —
      replaced with `.fc-list-color-dot`, same fix as `KanbanCardModal`'s
      A110 round. 3 `broken-image` findings on the same file are false
      positives (each `<img>` is behind an `{card.imageUrl && (...)}`
      guard) — left alone, don't re-flag without checking the guard first.

## Open — audit list for the next session

Roughly in priority order (highest-value / most user-visible first), but
pick whichever you actually have a good lead on — this isn't a strict
queue.

- [x] **`FlashcardView.jsx` — full pass** — DONE, logged as A126. Wrong red
      (`#ef5350`→`#f85149`) on rate/delete/remove-hover states; Study mode's
      + Edit mode's remaining color-border side-tabs (A122 only fixed List
      mode) replaced with the same dot pattern; 9 unicode `×` + 2 HTML-entity
      arrows replaced with real `lucide-react` icons; a chunk of dead CSS
      (`.fc-header`/`.fc-header-title` — including a stray accent-blue focus
      ring left over from before A121-A125 — `.fc-card-row`, `.fc-del-btn`,
      `.fc-canvas-wrap`, `.fc-img-preview`, `.fc-card-tools`) removed. The
      card-color picker itself (`CARD_COLORS` swatch row, List/Edit mode) was
      already a plain dot grid, not a stripe — nothing to align there. CSV/
      Anki import dialog is a native OS file picker (`@tauri-apps/plugin-dialog`
      `open()`), not an in-app popup — out of scope for this plan by
      construction, nothing to redesign.
- [ ] **Wiki-link (`@`-mention) and slash-command (`/`) autocomplete
      menus** — `makeWikiDropdownPlugin`/`makeSlashSource` in
      `NotebookView.jsx`. Flagged since Pass 5 (A108), still zero custom
      styling — these are CodeMirror `autocomplete()` extensions rendering
      in CM6's bare default theme (no `.cm-tooltip-autocomplete`/
      `.cm-completionLabel` overrides anywhere). Needs an
      `EditorView.theme()` block — different mechanism than every other
      item on this list, budget extra time to learn the CM6 theming API
      first.
- [x] **`SketchbookView.jsx` settings popup** — DONE, logged as A131. A fresh
      `position:'fixed'` grep found exactly 3 hits, all one feature (desktop +
      mobile canvas-background panel) — the "4 found" note above was stale,
      this genuinely is the only popup in the file. Style-wise already clean
      (no unicode/wrong-red/accent-string issues); only real finding was a
      real bug, not a style nit — the mobile-command bridge's `if (!isMobile)
      return` guard silently dropped the `settings` cmd on desktop too, so
      the native ⌘⌥, "Page Settings…" menu had **no way to open the desktop
      panel at all**. Fixed by removing the guard (matches
      `AudioPlayerView.jsx`'s identical unconditional listener). Also snapped
      the desktop panel's radius/padding to the established 8px/4px-grid
      family.
- [ ] **`AudioPlayerView.jsx` fixed side panel** — around line 471
      (`position:'fixed', right:8, width:270`), likely a queue/chapters/
      lyrics panel. Never audited.
- [ ] **`OnboardingView.jsx` fixed overlay** — around line 546
      (`position:'fixed', inset:0, zIndex:10000`). Never audited; low
      priority given it only ever appears once, first-run.
- [ ] **`SettingsWindowView.jsx`, `PdfView.jsx`, `GraphView.jsx`,
      `PluginManagerView.jsx`** — re-run the
      Modal/Popup/Menu/Dropdown/Picker/Dialog name grep AND a
      `position:.fixed` grep (name-only missed real popups elsewhere on
      this list) before trusting the old "nothing found" note. As of this
      writing (2026-08-19) the name grep still finds nothing in these
      four and the fixed-position grep also comes back empty, but this
      branch has had a lot of unrelated feature work land on it — don't
      assume that's still true without re-checking.
- [ ] **`col.icon` still not rendered** in `LibraryView.jsx`'s own
      collection cards, collection detail header, or the bulk-select
      "Add to Collection" picker — flagged back in A102 (2026-08-18),
      still open. `CollectionFace` (the icon-precedence component,
      `src/lib/collectionIcons.jsx`) is only wired into the sidebar tree.
- [ ] **Solid (non-alpha) hardcoded `#388bfd`** instances, e.g.
      `--addBookIcon` in `global.css`. Flagged during the A109 sweep as a
      separate, needs-judgment bug (unlike the alpha `rgba(56,139,253,X)`
      case, a solid fill might be an intentional fixed brand color rather
      than a should've-been-`var(--accent)` bug) — deliberately not swept
      mechanically. Actually look at each site before deciding.
- [ ] **Drift risk: `_openTaskCardModal` (`NotebookView.jsx`, vanilla DOM)
      vs `KanbanCardModal` (`LibraryView.jsx`, React)** — A120 built the
      notebook one to visually match the standalone one exactly, "kept in
      sync by eye," not by shared code (can't share a React component with
      a CodeMirror widget). If `KanbanCardModal` changes again, check
      whether `_openTaskCardModal` needs the same change and note it
      either way.

## Log

Update this section (or `UI_CHANGES.md` with a new letter entry) each time a
component finishes its pass, and check its box above.
