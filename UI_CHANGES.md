# UI Changes — July 2026 pass

## A125. Focus highlight removed entirely, no color at all

User: don't want the focus highlight at all. `--focusBorder` now equals
plain `var(--border)` (a true no-op — focused and unfocused border are
identical) and the global `:focus-visible` outline rule (plus its
`.ctx-item`/`.add-choice-btn` overrides, both touched in A124) all set
`outline: none`. The only remaining focus cue anywhere is each field's
own pre-existing background darkening where one exists (e.g.
`.cm-task-add-input`'s `surfaceAlt`→`bg` swap) — nothing added, nothing
colored, matching "the darkening is fine... visual cues are good enough"
from earlier in this thread, taken to its conclusion.

**Trade-off flagged, not hidden**: this removes the app's one universal
keyboard-focus indicator — a keyboard-only user tabbing through buttons/
links/menu items now gets no visual cue where focus landed. Called out
in the CSS comment at the rule itself for whoever touches this next.

**Verified live**: focused the add-card input, computed styles confirm
`outline: none` and `border` identical to the resting color — only the
background changed. Build backgrounded, will confirm; A124 (same file,
smaller diff) built clean immediately before this.

## A124. Actual root cause of the remaining blue: a global focus-visible outline

User: still seeing blue in `/kanban` after A123. Traced it properly this
time via computed styles instead of guessing — `outline: 2px solid
color-mix(in srgb, var(--accent) 60%, transparent)` from a single
app-wide rule in `global.css` (`button:focus-visible, input:focus-visible,
textarea:focus-visible, select:focus-visible, a:focus-visible`), entirely
separate from any component's own border/box-shadow. This is why no
amount of per-field `--focusBorder`/`--focusRing` tuning ever fully
removed it — outline isn't border, and for text inputs specifically most
browsers treat *any* focus (including a plain mouse click, not just Tab)
as focus-visible, so it showed up on every click into a field, everywhere
in the app. Changed its color to `var(--focusBorder)` (neutral, no
accent) — kept the outline itself since it's a real keyboard-a11y
affordance, just recolored it. Same fix applied to the two other
`:focus-visible` rules that had their own accent-colored outline
(`.ctx-item`, `.add-choice-btn`) for full consistency.

**Also while in the file**: found two always-on (not `:focus`-gated)
accent borders inside the `/kanban` widget's CSS that A121-A123 couldn't
have caught since they aren't focus rules — `.cm-task-add-col-input`
(recolored to `--focusBorder`) and `.cm-task-card-edit` (dead CSS, no
JSX applies this class anymore since A120 replaced inline-rename with
the modal — removed outright).

**Verified live**: focused the exact add-card input again, computed
styles confirm outline color now matches the neutral border color
exactly, no accent hue anywhere in the box. Build backgrounded (CSS +
one dead-rule removal, low risk); eslint baseline unchanged on
`NotebookView.jsx`.

## A123. Focus ring: dropped the blue entirely, neutral only

User: even the muted blue from A121 "looks tacky" — a field's own
background darkening (already present on several inputs, e.g.
`.cm-task-add-input` swapping `--surfaceAlt`→`--bg`) is signal enough on
its own; asked for a plain color shift instead of any accent color.

Since every site from A121 reads `var(--focusBorder)`/`var(--focusRing)`,
this was a 2-line change at the token definitions in `global.css`
`:root`, no per-site edits needed: `--focusBorder` is now
`color-mix(in srgb, var(--text) 35%, var(--border))` (neutral gray, no
blue channel) and `--focusRing` is `none` (ring dropped entirely).

**Verified live**: focused the same add-card input, confirmed via
computed styles — border-color has no accent hue, `box-shadow: none`.
Build green (CSS-only change, nothing to eslint).

## A122. FlashcardView side-tab border → color dot (impeccable finding)

The design hook flagged 2 `side-tab` findings in `FlashcardView.jsx`
(craft-floor's banned "thick colored border on one side of a card" tell)
while I was in the file for A121's focus-ring sweep. Checked both:
- L201's `.fc-card-row[data-color] { border-left: 3px solid; }` — dead
  CSS, no JSX in the file ever sets a `data-color` attribute. Removed
  outright rather than "fixing" a rule that never rendered.
- L920's `card.color` list-row `borderLeft: 3px solid ${card.color}` —
  live and real, same pattern already banned and replaced with a small
  swatch dot on the standalone Kanban board (A110). Replaced identically:
  a small filled `.fc-list-color-dot` (8px circle) in the row's status
  column instead of a border stripe.

3 unrelated `broken-image` findings on this file (L354/447/455) are
false positives — each `<img>` is behind an `{card.imageUrl && (...)}`
guard, never rendered with an empty src; left unchanged.

**Verify**: eslint baseline unchanged (2 pre-existing, unrelated), build
green. Not live-clicked through (store wiring to open a flashcard deck
tab via script proved fiddlier than the fix itself warranted) — verified
by code review instead, low-risk mechanical swap.

## A121. App-wide text-entry focus ring toned down

User screenshotted the notebook `/kanban` add-card input focused: a full-
saturation 1px `var(--accent)` (`#388bfd`) border reads as a bright neon
rectangle against these dark surfaces, and asked for the same cleanup
"across text entry forms." Grepped every genuine text-input/textarea/
select `:focus`/`:focus-within` rule and inline JS focus handler in the
codebase (excluding button hovers, active/selected states, and
toggle-fill backgrounds — a different, intentionally-bold concern, not
what was flagged) — 18 sites across `App.jsx`, `global.css`,
`LibraryView.jsx`, `NotebookView.jsx`, `FlashcardView.jsx`,
`SettingsWindowView.jsx`.

**New shared tokens** (`global.css` `:root`): `--focusBorder:
color-mix(in srgb, var(--accent) 55%, var(--border))` (a muted blend, not
the raw accent) and `--focusRing: 0 0 0 3px color-mix(in srgb, var(--accent)
14%, transparent)` (a soft outer glow carrying the rest of the "focused"
signal, adapted from `.nb-search-bar`'s already-existing ring pattern,
now standardized everywhere instead of being that one component's own
one-off). All 18 sites swept to `border-color: var(--focusBorder);
box-shadow: var(--focusRing)`; `LibraryView.jsx`'s `KanbanCardModal` uses
inline JS handlers (not CSS `:focus`) so its `onFocusRing`/`onBlurRing`
were updated to match, with `box-shadow` added to the field's transition.

**Deliberately left alone**: `OnboardingView.jsx`'s name-input focus
state — a growing underline bar, not a boxed border, a different and
already-subtle visual language, and it only ever appears once on
first-run.

**Verified live**: focused the exact input from the screenshot, confirmed
via computed styles the border is now a muted blend (not raw `#388bfd`)
with a 14%-opacity ring, not a solid line. eslint baseline unchanged
across all touched files; build green.

## A120. Notebook-embedded `/kanban` cards get a real edit modal

User: "I don't see any sort of edit modal, what can I do?" — the A119
redesign fixed this widget's visuals but the interaction was still
click-text-to-inline-rename; there was no modal at all, because the
underlying task data model only ever had `{text, date}`. Asked whether to
extend the data model or leave it — user chose to extend it and match the
standalone board's modal fully.

**Data model extended**: notebook `/kanban` tasks now carry
`priority`/`description`/`comments`, same shape as the standalone board's
cards. Markdown encoding (`parseTaskBlock`/`serializeTaskBlock` in
`NotebookView.jsx`, plus `TaskBlockWidget._serialize`) extended with
`{priority:id}`, `{desc:BASE64}`, `{comments:BASE64-JSON}` tags appended
to the existing `- [ ] text {date:...}` line — base64 so free-text
description/comments can't break the single-line format on braces,
colons, or newlines. Old boards without these tags parse the same as
before (fields just default to none/empty). Factored the per-task
parse/serialize logic that used to be duplicated across
`parseTaskBlock`'s two branches into shared `_parseTaskLine`/
`_serializeTaskLine` helpers rather than tripling the tag list by hand.

**New modal**: `_openTaskCardModal`, a vanilla-DOM rebuild of
`KanbanCardModal` for this non-React render path — same 440px width,
17/13/11 type scale, 4px-grid spacing, 8px radius family, and white/dim
color hierarchy as the standalone board (A113-A118), plus a segmented
priority pill row (reusing lucide's flag path as a hand-written SVG,
since `lucide-react` components aren't usable outside React), due date,
description, comments thread, and Delete (left) / Cancel+Save (50/50,
right) footer. Clicking a card's text now opens this modal instead of
inline-renaming; the inline add-input at the bottom of each column is
unchanged (still the quick-create path, matching the standalone board's
own design where a lightweight add precedes the richer edit modal).

**Verified live**: typed `/kanban` fresh, added a card, opened the modal,
set High priority + a description, saved, reopened the same card and
confirmed both persisted (proves the markdown round-trip, not just
in-memory state). eslint baseline unchanged; build green.

## A119. Notebook-embedded `/kanban` widget redesigned to match

User pointed at a live `/kanban` block inside a notebook doc and asked
"what happened" — turned out A110-A118 only ever touched the standalone
Tasks-view `KanbanBoard`/`KanbanCardModal` in `LibraryView.jsx`. The
in-notebook `/kanban` block is a completely separate implementation
(`TaskBlockWidget`, a vanilla-DOM CodeMirror widget in `NotebookView.jsx`,
plus a parallel read-only HTML renderer for preview mode) that never got
touched. It still had: a solid-fill rainbow header bar per column
(`_colColors` array painted straight into `colHdr.style.background`),
uppercase 10px column titles, unicode `×` for every delete/clear button,
and 6 different one-off font sizes (9/10/11/12/13/14px) plus a scatter of
border-radii (4/5/6/7/9/10px) — the same clutter pattern fixed in the
standalone board's modal (A115), just never applied here.

**Fixed, matching the standalone board's language**:
- Solid header bar → a small hollow color ring next to the (now
  non-uppercase) column title — same "ring not fill" direction as the
  standalone board's own column-color redesign (A110 Round 2).
- Type scale collapsed to 2 sizes for this widget (13 body/title/cards,
  11 meta/badges) + one 14px board-title accent, matching A115's
  reasoning.
- Border-radius unified to 8px across columns/cards/inputs (was 4-10px
  scattered); the `!important` global.css override for `.cm-task-col-w`
  snapped from 9px to the same 8px.
- Unicode `×` (column delete, card delete, date-clear) replaced with the
  same inline stroke-X SVG already used elsewhere in this file for the
  Habits widget's delete button — not a new pattern, reused the existing
  one.
- Read-only preview-mode HTML renderer (used when live-preview is on)
  updated in parallel so it renders the same ring + title, not just the
  interactive editor widget.

**Verified live**: typed `/kanban` fresh in a notebook, added a card,
confirmed the ring color, 8px radii, real-case title, and the delete/
add-date icons render as proper SVGs (checked via computed styles, not
just visually). eslint baseline unchanged (pre-existing errors are all
in an unrelated part of the file, none in the touched regions); build
green.

## A118. KanbanCardModal: narrowed overall width, 500→440px

User: modal wasn't using its space efficiently. Checked the tightest row
(5 priority pills, "Medium"/"Urgent" the longest labels) still holds up
without wrapping or crowding at 440px, so dropped the fixed width there.
Verified live, eslint/build clean.

## A117. KanbanCardModal: tightened horizontal padding

User: side margins too generous. Header/body/footer horizontal padding
24px→20px (still on the A115 4px grid, just one step down); field/button
internal padding untouched. Verified live, eslint/build clean.

## A116. KanbanCardModal: fixed white/dim color hierarchy, was arbitrary

User: type scale fix (A115) helped, but flagged the white-vs-dim split
felt arbitrary — no rule for what got `var(--text)` vs `var(--textDim)`.
Correct: section labels (Title/Priority/Due Date/Description/Comments)
were dim by default (should read as prominent structure, not muted
metadata) and the Cancel button was dim-at-rest, only flipping white on
hover — meaning its resting state didn't match its own hover state or
the always-white primary button next to it.

**Rule now applied**: `var(--text)` (white) = section labels, the
selected/active priority pill, and both footer action buttons (Cancel +
Create Task/Save Changes). `var(--textDim)` = everything else — subtitle,
placeholders, unselected priority pills, comment timestamps. Delete stays
its own red, untouched (semantic, not part of this scale). Selected
priority text was already white — no change needed there, called out by
the user as already correct.

**Verified live**: labels and Cancel now read white at rest, matching
Create Task/heading/selected-pill. eslint baseline unchanged, build green.

## A115. KanbanCardModal: collapsed type scale + spacing onto a real grid

User called the modal "off" again after A114's fixes, and pinned it to
"scaling and spacing, especially text." Counted the actual sizes in play:
**7 font sizes bunched in a small range with no rhythm** — 18, 12.5, 12,
11, 10.5, 10, 9, 13 — heading, subtitle, comment body, labels, comment
meta/avatar, footer/fields all landing on slightly different numbers for
no reason. Spacing was the same story: 7, 9, 11, 13, 14, 18, 22px one-offs
instead of a grid.

**Collapsed to 3 font sizes**: 17 (heading), 13 (body — fields, buttons,
comment text, subtitle), 11 (labels, meta, priority pills, comment
timestamp/avatar). Subtitle now differs from body text by color/weight
only, not a 4th in-between size (was 12.5). Comment body text 12→13 to
match the field/body size instead of sitting alone between it and the
11px meta size.

**Spacing moved onto a 4px grid** (4/8/12/16/20/24, matching
`impeccable`'s craft-floor spacing guidance): header padding
22/18→20/16, body gap 18→20, field padding 9px vert→8px, label
margin-bottom 7→8, priority-toggle gap 2→4 + container padding 3→4,
comment bubble padding 7/10→8/12, comment-input row gap 6→8, comment
input padding 7/11→8/12 (now literally reuses the shared `field` style
instead of its own smaller one-off), Send button padding 7/14→8/16,
footer buttons 9px vert→10px (a deliberately larger step for the row's
primary actions, not a leftover one-off). Added explicit `lineHeight` to
every text style so line-box height is also on-grid, not left to each
font's default metrics.

**Verified live**: create + edit modals both re-screenshotted, spacing/
type now reads as one deliberate scale rather than a pile of near-misses.
eslint baseline unchanged; build in progress at write time (backgrounded,
prior build was clean on the same file).

## A114. KanbanCardModal follow-up: footer weight + premature Comments

User asked for the footer's Cancel/primary buttons 50/50, and flagged the
modal still felt off without saying why. Ran it back through the
`impeccable` critique checklist — the mismatch: **Comments rendered
unconditionally**, including in "New Task" (create) mode, so the modal
asked you to write and Send a comment on a task that doesn't exist yet
(no id, no persisted entity, nothing to actually be commenting on). None
of the 3 reference dialogs (Create Event / Schedule Interview / Share
Project) put a comment thread in their create flow either — only their
edit/detail view. Fixed: Comments block (and its divider) now gated on
`!isNew`, same as Delete already was.

**Footer**: Cancel + primary action now split the remaining row 50/50
(`flex:1` each) instead of shrink-to-content right-aligned. Delete stays
fixed-width, far left, untouched — the 50/50 split is scoped to the two
action buttons the user asked about, not a 3-way split with Delete.

**Verified live**: create flow no longer shows Comments; created a real
card; reopened it in edit mode and confirmed Comments reappears,
pre-filled, Delete still left/separate, Cancel/Save Changes now equal
width. eslint baseline unchanged (15 pre-existing, none new); build green.

## A113. KanbanCardModal rebuilt around 3 reference edit-modal screenshots

User supplied a macOS-style "Create an Event" dialog, a light "Schedule
new interview" form, and a dark "Share project" panel, and asked for the
task-edit modal's cleanliness/spacing specifically — the card redesign
from A110-A112 was fine, the modal it opens still looked like the old
"pile of icon+field rows" shape.

**Common language across all three references, applied:**
- **Fixed heading + muted subtitle, separate from the editable fields.**
  The old modal's editable title input *was* the header (giant borderless
  18px text) — now a plain "New Task"/"Edit Task" heading + a one-line
  description sits above a real, separately-labeled Title field. Every
  reference does this.
- **Uppercase section labels** ("Title", "Priority", "Due Date",
  "Description", "Comments") above each field/group, replacing the old
  icon-per-row convention (a `Calendar`/`Flag`/`AlignLeft`/`MessageSquare`
  icon to the left of each field, no label text).
- **Real divider lines** — header/body, body/comments, and body/footer —
  matching the reference panels' section breaks.
- **Bordered fields with an accent focus ring** (`onFocus`/`onBlur` swap
  `border-color`, same inline-handler convention this codebase already
  uses for hover everywhere) — the old fields had no focus state at all.
- **Priority became a segmented pill toggle** — one bordered strip, the
  active option raised on its own inset background — instead of a wrapped
  row of individually-bordered buttons. Directly modeled on the Event/
  Reminder toggle and the 30/60 min duration toggle in two of the
  references.
- **Footer**: destructive action (`Delete`, now with a `Trash2` icon) kept
  separate on the left; `Cancel` (new — there was no explicit cancel
  button before, only the X and backdrop-click) + the solid primary action
  right-aligned. Matches all three references' footer shape.

**Not copied**: the character-limit counter pill next to "Title" in the
event dialog (we don't enforce a max length — a fake counter would be
decoration, not data) and the linked-record preview card in the interview
form (no equivalent concept in this app's task model). Consistent with
every prior pass's rule: match the design language, don't fabricate fields
the reference implies but this app doesn't have.

**Verified live** (see A112 for how) — opened the real modal in the
browser preview, typed a title, picked a priority, confirmed the accent
focus ring, created the task, reopened it in edit mode and confirmed every
field pre-fills correctly including the Delete button appearing only in
edit mode. Screenshotted at each step.

**Verify:** `npx eslint` clean (`AlignLeft` import dropped — no longer used
anywhere in the file — everything else pre-existing baseline); `npx vite
build` green; impeccable `detect.mjs`: zero findings in the modal.

## A112. Kanban board pushed closer to 1:1, and a real live-verification breakthrough

User pushed back: A110/A111 were "better ish" but wanted the dark reference
matched much more closely, and pointed out the onboarding screen can be
skipped to see the real app.

**The onboarding bypass**: `localStorage.setItem('gnos_onboarding_done',
'1')` then reload. `App.jsx` already reads exactly this key
(`onboardingCompleteStore || localStorage.getItem('gnos_onboarding_done')
=== '1'`) — setting it in a fresh browser tab (no real archive, no Tauri)
drops straight into the app with its bundled sample library. **This is the
first time in this whole popup-revamp project that live visual
verification was actually possible** — every prior pass (A101–A111) was
verified by code review alone, with a standing note that the Tauri-fs
onboarding gate blocked the browser preview. It didn't; only the
first-run *screen* did, and it can be skipped.

**Used it to verify and refine the kanban board live**, including actually
creating cards through the real UI (title, due date, priority, comments)
and confirming the result end-to-end:
- Widened columns (240px card slot → 280px) — the reference boards give
  cards noticeably more breathing room than the initial pass had.
- Card padding 10px/11px → 12px/13px, corner radius 10→12px, title
  14→14px (was 13, this is now the *actual verified* size, not a guess).
- Confirmed live: card creation, priority picker, due-date relative
  labels, comment counts, the overdue-red state, and the new "…" column
  menu (Rename/Delete via the shared `ContextMenu`) — all render and
  behave correctly. Screenshotted directly against the dark reference.

**Also confirmed harmless**: kanban board data lives in local component
state, loaded/saved through Tauri fs calls that fail silently in the
browser preview (expected, same as every other view) — test cards created
during this verification session don't persist and won't pollute the
user's real data.

**For future sessions on this project**: the onboarding-skip trick means
**live visual verification is available going forward** — the standing
"needs `npm run tauri:dev`, can't verify" caveat on A101 through A111
no longer has to apply to new UI work. Worth re-verifying older passes
opportunistically if touching that code again, rather than as its own
project.

**Verify:** confirmed live in the browser preview (see above) rather than
by code review alone, for the first time this project — `npx eslint`
clean (baseline unchanged), `npx vite build` green.

## A111. Fix: the `/kanban` notebook widget A110 shipped didn't actually run

User report: "the kanban widget isn't running." A110's `/todo`→`/kanban`
rename only updated `parseTaskBlock`'s own header regex — missed **four
other places** that gate on the literal string `/task` *before*
`parseTaskBlock` is ever reached, so a freshly-typed `/kanban` block never
made it far enough to render:

- `_buildTaskDecos`'s whole-document early-exit (`if
  (!fullDoc.includes('/task'))`) — skipped the entire line-scan for any
  notebook that didn't *also* happen to contain the literal text "/task".
- The same function's per-line gate (`/^\/task(?::.*)?$/`) run right
  before calling `parseTaskBlock` — independently hardcoded, not reading
  from the already-fixed regex inside `parseTaskBlock` itself.
- The **preview-mode** markdown-to-HTML renderer's own separate `/task`
  detector (a completely different code path from the live editor).
- The paragraph-buffering pass that keeps a kanban block's lines grouped
  instead of being split apart at blank lines — also its own hardcoded
  `/task` regex.

All four now accept `/(?:task|kanban)`. **Also found**: `TaskBlockWidget`
(the actual live, interactive widget class) has its *own* internal
`_serialize()` method — separate from the standalone `serializeTaskBlock`
function A110 already fixed — which was still writing the header back out
as `/task` on every interaction (drag, checkbox toggle), silently
reverting the rename each time the widget touched itself. Fixed to match:
always writes `/kanban` now.

This is the actual lesson from A110: a single rename inside one "obviously
central" parser function looked complete, but the same trigger string was
duplicated across five independent call sites (four gates + one
serializer) that don't share the check. Grepped the whole file for every
remaining `/task` occurrence after fixing these — the rest are comments
only.

**Verify:** `npx eslint` clean on `NotebookView.jsx` (pre-existing-only,
same baseline as A110); `npx vite build` green. **Not visually verified**
— can't reach the notebook editor through the browser-preview onboarding
flow (same Tauri-fs limitation as every prior pass); needs a real check in
`npm run tauri:dev`: type `/kanban` in a notebook, confirm the board
renders, add/drag/check a task, confirm the source line stays `/kanban`
(not reverting to `/task`) after each interaction.

## A110. Kanban board — real redesign toward the dark reference, real fields only

User asked for the kanban board to match the reference screenshots
"near 1 to 1," especially the dark Linear-style one. Went further than
A107's earlier pass, but stopped short of literal 1:1 anywhere the
reference needed data this app doesn't have — no fabricated
assignee/attachment/sub-task fields standing in for real ones.

**Elevation hierarchy was backwards, fixed.** The reference boards get
progressively *lighter* from page → column → card (each layer floats above
the one below). Ours had it backwards: columns used `var(--surfaceAlt)`
(the lighter token) and cards used `var(--surface)` (darker), so columns
visually sat *above* their own cards. Swapped: column background → `var(
--surface)`, card background → `var(--surfaceAlt)`, page stays `var(--bg)`
— now cards correctly pop off a darker column, matching the reference.

**Column header** — the color swatch became a hollow colored ring (was a
solid dot), closer to the reference's circular status token; the count
badge now sits on `var(--bg)` (the darkest tier, for contrast against the
now-darker column); the bare delete `×` button became a `…` button that
opens the shared `ContextMenu` with Rename/Delete — matches the reference's
overflow-menu pattern instead of one exposed destructive action.

**Card layout rebuilt** into the reference's three-row shape:
1. Status ring + a real ticket-style code (`TASK-1234`, derived from the
   card's own id/creation-timestamp — genuine data reformatted, not
   invented) + a priority flag icon (see below) + the edit affordance.
2. Title, bold.
3. Meta row: comment count (left) and a **relative due-date label** (right)
   — "Today"/"Yesterday"/"in 3 days"/"5d overdue", colored, replacing the
   old literal ISO-date chip. Real data, reformatted to match the
   reference's phrasing exactly.

**New real field: `card.priority`** (`none`/`low`/`medium`/`high`/
`urgent`), user-set via a row of colored flag buttons in
`KanbanCardModal` (same pattern as the existing due-date/description
rows). Shows as a small colored `Flag` icon on the card when set. This is
the one place the redesign adds a field rather than reformatting an
existing one — justified because it's genuinely useful and fully
user-controlled, unlike an avatar (no assignee/user system in this
single-user app) or an attachment count (no attachment feature), which
the redesign deliberately does **not** fake.

**"+ Add task"** — was a dashed-border box requiring hover to show any
color; now a plain text row (icon + label), matching the reference's
minimal link-style affordance.

**Default board** — the 4 starter columns (`Backlog`/`To Do`/`In
Progress`/`Done`) now ship with distinct colors instead of all defaulting
to the same red, so a fresh board's rings read as differentiated status
tokens immediately instead of needing manual setup first.

**`/todo` → `/kanban`, notebooks.** Separately: `/todo` (a "To-do list
block" slash command) turned out to be **dead** — it inserted plain text
but nothing anywhere built a widget to render it (confirmed: no code
creates a `.cm-todo-block-w` element, only orphaned CSS and a click handler
remain, left in place — untangling ~70 lines of dead CSS wasn't part of
this ask). Meanwhile `/task` already **is** a real, working multi-column
kanban board embedded in notebooks (`parseTaskBlock`/`serializeTaskBlock`/
`.cm-task-board-w`, fully wired). Consolidated: removed the dead `/todo`
entry, renamed `/task`'s trigger to `/kanban` in the command palette.
`parseTaskBlock`'s header regex accepts both `/task` and `/kanban` (so
notebooks written before this rename still render); `serializeTaskBlock`
now always writes `/kanban` going forward — an old `/task`-headed board
silently migrates to the new header the next time it's touched.

**Verify:** `npx eslint` clean on `LibraryView.jsx`/`NotebookView.jsx`
(pre-existing-only baseline, unchanged); `npx vite build` green; impeccable
`detect.mjs` on the touched kanban region: zero findings. **Not visually
verified** — same Tauri-fs onboarding limitation as every prior pass in
this project; the kanban board specifically also can't be reached through
the browser-preview onboarding flow at all. Needs a look in `npm run
tauri:dev`.

## A109. Hardcoded dark-theme accent color — codebase-wide mechanical fix

Follow-up to A108's flagged finding. User asked for a quick pass rather
than deferring it.

Every `rgba(56,139,253,X)` — the dark theme's accent blue, `#388bfd`,
written out as a literal RGB triple instead of referencing `var(--accent)`
— replaced with `color-mix(in srgb, var(--accent) {X*100}%, transparent)`
across `App.jsx`, `SideNav.jsx`, `LibraryView.jsx`, `NotebookView.jsx`,
`ReaderView.jsx`, `SketchbookView.jsx`, and `global.css`. **80 instances**
(A108's "151" was an artifact of an overlapping shell-glob double-counting
some files in the earlier count, not a real discrepancy — every real
instance is now fixed, confirmed by a zero-result re-grep).

Mechanical, one-for-one value substitution — a Python regex pass, not
hand-edited, since the transform is identical at every site and manual
editing 80 spots would only add transcription risk. Two `--addBookBg`/
`--addBookHover` root CSS custom properties were among the hits — these
now correctly derive from `var(--accent)` inside their own definitions
(valid CSS; custom properties resolve lazily), instead of being permanently
pinned to dark-theme blue.

**Deliberately not touched, different bug** — solid hardcoded `#388bfd`
(no alpha) used as a plain fill/border color, e.g. `--addBookIcon: #388bfd`
in the same `:root` block. That's a separate question (is this specific
spot *supposed* to always be blue regardless of theme, or should it track
`var(--accent)` too?) that needs case-by-case judgment, not a mechanical
sweep — flagged, not fixed.

**Verify:** `npx eslint` on all seven files — zero new errors (spot-checked
line ranges against each file's pre-existing baseline; several of these
files were linted for the first time this session and carry large
pre-existing debt unrelated to this change); `npx vite build` green;
impeccable `detect.mjs` — 39 pre-existing findings across these files,
none related to (or newly introduced by) this pure color-value swap.

## A108. Popup/dropdown revamp Pass 5 — dropdowns/pickers, and two systemic bugs

Swept the Pass-5 list (`NavDropdown`, `SearchDropdown`, `ChapterDropdown`,
`MonthYearPicker`, `NbShareMenu`, `CollectionSwitcher`'s picker, the
bulk-select Add-to-Collection picker) for the bug classes prior passes kept
finding (unicode-as-icon, wrong red, radius outliers). Most were already
clean — this pass's real value was two **systemic, codebase-wide** bugs
found while checking `CollectionSwitcher`, not confined to popups.

**Fixed in this pass's actual scope:**
- **Bulk-select "Add to Collection" picker** (`LibraryView.jsx`) — same
  `quicknotes`-leak-plus-unsorted bug flagged back in A102, now fixed here:
  filtered, sorted, and using `CollectionFace` for real icons (was
  emoji/color-only). Bulk-delete button's red was `#ef5350` — app standard
  is `#f85149` (Pass 1) — fixed.
- **`CollectionSwitcher`'s picker popup** (`SideNav.jsx`) — container
  background was `var(--bg)` instead of `var(--surface)` (inconsistent
  with the rest of the menu family) and radius 10→8 to match; **found a
  real bug in the process**: the active row's highlight was
  `background: active ? 'var(--accent)14' : 'none'` — `'var(--accent)14'`
  is not valid CSS (you cannot append a hex-alpha suffix to a `var()`
  call), so the browser silently dropped it and the active row never
  actually highlighted. Fixed with `color-mix(in srgb, var(--accent) 14%,
  transparent)`.

**Systemic bug #1 — the same `var(--accent)NN` invalid-CSS typo, found
everywhere.** A codebase-wide grep for the pattern turned up 8 more
identical instances: `GraphView.jsx` (5, at 18%/22% opacity — active-state
highlights on the search view toggle, label toggle, link-filter toggle),
`LibraryView.jsx` (2 more: a smart-collection badge border at 44%, and a
quick-switch collection button's active background at 18%). All fixed the
same way. One of the `LibraryView.jsx` spots also had a `⚡ Smart` emoji
standing in for an icon — replaced with a proper `Zap` icon.

**Systemic bug #2 — hardcoded dark-theme accent color instead of
`var(--accent)`, found while checking the notebook date-picker widgets.**
`showDateTimePicker`/`_makeTaskDatePicker` (vanilla-DOM CodeMirror popups
in `NotebookView.jsx`) had their "selected date" highlight hardcoded as
`rgba(56,139,253,X)` — the literal RGB of the **dark theme's** accent blue
— instead of `color-mix(in srgb, var(--accent) X%, transparent)`. This app
ships 6 themes with different accent colors (Coffee `#8b5e3c`, Light
`#0969da`, Cherry `#e05c7a`, Sunset `#e8922a`, Moss `#3d6e32`); on every
theme except Dark, this highlight silently shows the wrong (blue) color
instead of the theme's actual accent. Fixed both instances in scope.

**This bug is much bigger than two instances — flagging, not fixing
further here.** A full-codebase grep for the literal string
`rgba(56,139,253` (excluding the theme-definition file itself, where it's
correctly the *literal value being defined*) returns **151 matches across
7 files**: `App.jsx`, `SideNav.jsx`, `LibraryView.jsx`, `NotebookView.jsx`,
`ReaderView.jsx`, `SketchbookView.jsx`, and `global.css` itself. Every one
of these is a spot where a non-Dark theme user sees a blue tint where the
UI meant to show their actual accent color — active tab highlights, hover
states, focus rings, drag-over states, and more, all app-wide, predating
this popup-revamp project entirely. Not attempted here: the fix pattern is
mechanical (`rgba(56,139,253,X)` → `color-mix(in srgb, var(--accent)
{X*100}%, transparent)`) but 151 instances across 7 files is a real,
separate undertaking that deserves its own reviewed pass, not a blind
sweep folded into Pass 5. Flagged for the user to decide on.

**Also checked, not fixed — architecturally different, larger undertaking:**
the wiki-link (`@`) and slash-command (`/`) autocomplete menus
(`makeWikiDropdownPlugin`/`makeSlashSource`, `NotebookView.jsx`) are
CodeMirror `autocomplete()` extensions with **no custom styling at all** —
no `.cm-tooltip-autocomplete`/`.cm-completionLabel` overrides found
anywhere in the codebase, so they render in CodeMirror's bare default
theme, not this app's design language. Reskinning them needs a proper
`EditorView.theme()` block, a different kind of work than the React-modal
passes so far.

**Swept clean, no changes needed:** `NavDropdown`, `SearchDropdown`,
`ChapterDropdown`, `MonthYearPicker`, `NbShareMenu`,
`showDateTimePicker`/`_makeTaskDatePicker`'s own chrome (radius, shadow,
spacing — solid already, only their one color token was wrong).

**Also fixed in code touched along the way (impeccable flagged all three):**
the bulk-select toolbar's entrance animation used a bounce/overshoot easing
curve (`cubic-bezier(0.34,1.56,0.64,1)`, craft-floor bans this) — changed
to the same exponential ease-out `gnos-pop-in` already uses elsewhere. Two
progress bars animated `width` (layout-thrash risk) — a collection's
completion bar in `LibraryView.jsx` and a stat bar in `GraphView.jsx`
(caught by the post-turn design-hook re-scan) — both changed to
`transform: scaleX()`.

**Verify:** `npx eslint` clean on every touched file (pre-existing-only
errors, same baseline as prior passes); `npx vite build` green (transiently
blocked mid-session by another chat's in-flight `collab.html`/
`collab-main.jsx` work, unrelated to this session — resolved once that
landed); impeccable `detect.mjs` re-run on the touched files after the
easing/progress-bar fixes: both findings gone, one unrelated pre-existing
finding remains elsewhere in `LibraryView.jsx`.

## A107. Popup/dropdown revamp Pass 4 (kanban board) — real redesign, not just polish

User supplied three reference kanban screenshots (Linear-style light, Linear-style
dark, a CRM leads board) and flagged our kanban as looking "terrible." This one
warranted an actual redesign, not the polish level of A106.

**`KanbanBoard`/`KanbanCardModal` (`src/views/LibraryView.jsx`):**
- **Removed the colored left border-bar on every card** — `craft-floor`
  explicitly bans this exact shape ("a colored border-left or border-right
  above 1px on cards... the most recognizable tell of AI-generated UIs"),
  confirmed by impeccable's mechanical detector flagging the identical
  pattern elsewhere in this codebase's CSS. Replaced with a small 6px color
  dot inline before the title — same information (the column's tag color),
  reads like the status dots in all three reference boards, not a slop tell.
- **Column title** — was uppercase/10.5px/textDim (borrowed the app's
  section-label convention, which fits a category label but not a column
  heading). Every reference board uses a plain bold heading for columns.
  Changed to 13px/600/normal-case/full-text-color, both the display span and
  the rename input.
- **Column color swatch** — square (radius 3) → circle, in both the trigger
  dot and the picker grid, closer to the reference boards' circular status
  indicators.
- **Unicode-glyph icons replaced** (same craft-floor rule as A106): column
  delete `×` → lucide `X`; card's `⋯` edit-affordance → lucide `Ellipsis`
  (now with a proper hover background circle, was just an opacity fade);
  "+ Column"/"+ Add task" leading `+` text → lucide `Plus`; comment-remove
  `×` (in `KanbanCardModal`) → lucide `X`; the description indicator dots
  `···` → a small `AlignLeft` icon (matches the description field's own
  icon in the edit modal, more legible than three punctuation dots).
- **Wrong red, again** — `KanbanCardModal`'s delete button and the overdue-
  date chip both used `#ef4444`/`rgba(239,68,68,…)` instead of the app-wide
  `#f85149` danger red (Pass 1 standardized this everywhere else). Fixed
  both. **Also found and fixed the identical copy-pasted pattern in
  `EventModal` (`src/components/Calendar.jsx`)** — byte-identical delete-
  button style object, same wrong red, clearly copy-pasted from the same
  origin as the kanban one. A stray third instance in `NotebookView.jsx`
  is a genuine multi-color palette array (not a semantic "danger" use) —
  left alone, not a bug.
- `KanbanCardModal` corner radius 18px → 14px (same less-round direction as
  every prior pass; 14 keeps this modal in the same tier as `SideEditModal`/
  `CollectionEditModal`, which already sit at 14).
- Card padding evened out to `11px 12px` (was asymmetric `10px 10px 9px
  10px`, a leftover from when the left color bar needed the padding to
  work around it).
- Cleaned up one truly-dead line found along the way: `isInlineColorOpen`
  was computed every card render and never read (the per-card color-picker
  UI it would have gated was never built — `updateCardColor` is also fully
  unused, left alone since removing it is unrelated cleanup, not a visual
  fix, and rebuilding the half-finished per-card-color feature it implies
  would be inventing new functionality, not a design pass).

**Other Pass 4 modals** (`SideEditModal`, `EditItemModal`,
`MissingSourceModal`) — swept for the same bug classes (unicode-as-icon,
wrong red, radius outliers); none found. These three were already clean.

**Verify:** `npx eslint` clean (`LibraryView.jsx` down one error from
baseline — the dead `isInlineColorOpen` removal — `Calendar.jsx`
pre-existing-only); `npx vite build` green; impeccable `detect.mjs` on the
touched kanban region: zero findings (was flagging the side-tab pattern
before this pass, confirmed gone after).

## A106. Popup/dropdown revamp Pass 3 — Settings modal polish

`UniversalSettingsModal` (`SideNav.jsx`) — unlike Pass 1/2's targets, this
one was already well-architected (shared `SettingsRow`/`SettingsSectionLabel`/
`Toggle`/`Slider`/`.gnos-select` used consistently across all 7 tabs, no
duplicate popup implementations to unify). Pass was craft-floor polish +
one real find, not a rebuild:

- **Unicode glyphs standing in for icons** — craft-floor explicitly bans
  this ("icons are drawn, from a real library... in one consistent stroke
  and weight"), and the rest of the app is 100% lucide-react. Fixed four:
  `⇄ Switch Archive` → `RefreshCw` icon + text, `↓ Export`/`↑ Import` →
  `Download`/`Upload` icons, `✓ Piper is installed` → `Check` icon (tinted
  accent, only shown when actually installed — was baked into the string
  unconditionally reachable only via the ternary's true branch, now an
  explicit conditional element).
- **Real find: `PluginsSettingsPanel` had its own hand-rolled toggle
  switch** (34×20px, custom inline styles, its own knob-transition timing)
  instead of using the shared `Toggle` component every other setting in
  this exact modal uses (38×22px, `.gnos-toggle`). A third toggle
  implementation hiding in a file that already has one canonical one.
  Replaced with `<Toggle on disabled title onChange>` — `Toggle` already
  supports `disabled`+`title`, no new capability needed.
- **Missing `fontFamily: 'inherit'`** on the Export/Import buttons — every
  sibling button in the same tab had it, these two didn't, so they'd have
  rendered in the browser's default UI font instead of the app's font
  stack. Fixed alongside the icon change.
- **Modal corner radius** 14px → 10px, closer to (not identical to) the
  5px/8px scale Pass 1/2 settled on for menus/popups — a modal is a bigger
  surface than a context menu and conventionally keeps a larger radius,
  but 14px was noticeably rounder than everything else in the app's
  "less round" direction from A102.

**Verify:** `npx eslint` clean (pre-existing-only, same 2 errors as every
prior pass); `npx vite build` green; impeccable `detect.mjs` over the
whole file: zero findings, including the touched region.

## A105. Popup/dropdown revamp Pass 2 — one shared AddPopup component

Same treatment Pass 1 gave the context menus. Three implementations found:
`SidebarAddPopup` (`SideNav.jsx`), `AddPopup` + `LibContextMenu`
(`LibraryView.jsx` — the latter a mislabeled duplicate of the former,
identified during Pass 1). Real inconsistencies between them, not just
duplicated code:
- **`SidebarAddPopup` was missing "Open File…" entirely** — the other two
  had it, the sidebar's version didn't.
- **Audiobook icon disagreed** — `Volume2` in one, `Music` in the other two.
- **Icon color disagreed** — muted `var(--textDim)` in the sidebar version,
  accent-tinted in the other two (CSS forced icons to 16×16 regardless of
  the `size={20}` prop in the JSX — dead prop value).
- **Header text disagreed** — "Add to Library" vs "Add".
- **A real functional bug**: `LibraryView.jsx`'s `addOpen` state (set by
  the empty-library "+" button and an `open-add` command) only ever
  rendered something when `isMobile` was true — the desktop path was
  completely dead, no popup, no error, just nothing. Found while tracing
  where `<AddPopup>` was actually used.

**New `src/components/AddPopup.jsx`** — the one component now used
everywhere, with a `variant` prop covering every anchor shape the old three
needed: `up` (sidebar footer, opens upward), `down` (a header/toolbar
button, opens downward), `fixed` (right-click, viewport-clamped like
`ContextMenu`), `sheet` (mobile bottom-sheet embedding), and new `center`
(viewport-centered — used to finally wire up that dead desktop path, with
a dismiss-on-click-outside backdrop matching the mobile sheet's). Container
is literally `ContextMenu.jsx`'s `.context-menu` class — same chrome
(radius, shadow, entrance animation, z-index token) for both popup
families now, not just visually similar. Row styling (`.add-choice-btn`
etc.) brought in line with Pass 1's leaner type (accent-icon convention
kept — 2 of 3 old implementations already did this — font-weight 500 for
labels, a dedicated `.add-choice-sub` class for the format-hint captions,
which are kept — informative, low-cost, no reason to cut them).

**All four call sites updated**, each still supplying its own
creation-logic callbacks (same pattern as `ContextMenu`'s caller-supplied
`items`): `SideNav.jsx`'s footer button (`variant="up"`), `App.jsx`'s
titlebar button (`variant="down"`, and its redundant manual positioning
wrapper div removed now that the component handles its own placement),
`LibraryView.jsx`'s right-click-empty-space (`variant="fixed"`) and its
add-triggers (`variant="sheet"`/`"center"` by device, fixing the dead
desktop path above).

**Verify:** `npx eslint` clean on all four touched files (pre-existing-only
errors — this was the first time this session `App.jsx` got linted; its
~70 pre-existing errors are almost all one cascading `react-hooks/
rules-of-hooks` report from an intentional early-return-before-hooks
dev-only code path, confirmed none fall inside the edited region);
`npx vite build` green; impeccable `detect.mjs` over all five touched
files: zero findings in new/changed code.

## A104. Two quick fixes — quicknotes leak in CollectionSwitcher, Quicknotes added to the type-filter cycle

- `CollectionSwitcher`'s `workspaces` list (`SideNav.jsx`) was still missing
  the `quicknotes` exclusion everything else in the sidebar got in A102 —
  fixed, one-line filter.
- **`LibraryView.jsx`'s header `TypeFilterBtn`** (All → Books → Audiobooks
  → Notebooks → Sketchbooks → Flashcards → All) gained a 7th stop:
  **Quicknotes**. Not a real content type — it's notebooks that belong to
  the auto-managed `quicknotes` collection — so `renderAll()`'s filter
  branches specially for `tf === 'quicknotes'`: resolves that collection's
  item-id set and filters `notebooks` down to it, while books/audio/
  sketchbooks/flashcards are hidden entirely (same as any other single-type
  filter). New `StickyNote` icon in `TYPE_FILTER_META`, matching the
  sidebar's Quicknotes row icon (A100).

**Verify:** `npx eslint` clean (pre-existing-only), `npx vite build` green.

## A103. Pass 1 round 3 — lighter/leaner context-menu type, real icons in collection pickers, emoji picker dropped

Reference: a Todoist-style context menu screenshot the user liked ("more
comfortable and ample spacing + clean look"). Adopted the parts of its
system that fit our scale (regular-weight type, comfortable-not-cramped
rows) rather than copying its literal desktop-app pixel sizes, which are
much bigger than this app's compact chrome.

**`.ctx-item` typography/spacing (`global.css`):** font-weight 500 → 400
(this — not the earlier size numbers — was most of the "fat/bloated"
complaint: medium weight at small size reads heavier than it looks at a
glance), font-size 13px → 12.5px, padding 7px → 8px, icon-label gap 7px →
8px. Net: leaner glyph weight, slightly roomier row.

**Emoji picker removed from `CollectionEditModal`** ("isn't necessary") —
the input is gone; the `emoji` field itself stays in the save payload
untouched so any collection that already has one doesn't lose it, and
`CollectionFace` still renders it (emoji still wins over icon if both are
somehow set) — just nothing left in the UI to set a *new* one. Picking an
icon still clears a legacy emoji so the icon actually takes effect instead
of being silently outranked.

**Real collection icons now show in both places asked for:**
- **"Add to Collection" picker** (`buildAddToCollectionSubmenu`,
  `src/lib/collectionSubmenu.jsx`) — each row now renders via
  `CollectionFace` (emoji/icon/color) instead of plain text.
- **"Move Into" / "Move into"** (collection → collection reparenting, both
  `SideNav.jsx` and `LibraryView.jsx`) — same treatment, plus alphabetical
  sort and a `quicknotes` exclusion (was leaking in here too, same bug
  class as A102's fix to the Add-to-Collection list) and a divider before
  the real collection list in `LibraryView.jsx`'s version.

**`ContextMenu.jsx` gained a general `iconNode` escape hatch** (top-level
items and submenu items) alongside the existing raw-SVG-string `icon` —
takes priority when both are given. Needed because a collection's glyph
can be an emoji, a lucide icon, or a color dot depending on the collection,
which doesn't fit the app-wide "icon is a raw `<path>` string" convention.

**File shuffle to satisfy `react-refresh/only-export-components`** (an
enforced eslint error for a component file that also exports plain
data/functions, hit twice this round): `CollectionFace` moved to
`src/lib/collectionIcons.jsx` (component-only); the `COLLECTION_ICONS`
array/map that used to live next to it moved to new
`src/lib/collectionIconData.js` (plain data, imported by both
`collectionIcons.jsx` and `SideNav.jsx`'s icon-picker grid).
`collectionSubmenu.js` → `.jsx` (now renders `<CollectionFace/>`, needs JSX).

**Not done:** LibraryView.jsx's own collection cards, collection detail
header, and bulk-select picker still don't render `col.icon` — same gap
noted in A102, still open in `PLAN_POPUP_REVAMP.md`. LibraryView also has
its own separate collection-edit surface (`EditItemModal` with
`fields:['color']`, no emoji field to begin with so nothing to remove
there, but also no icon field — a third, still-inconsistent editing
surface alongside `CollectionEditModal`).

**Follow-up, same session:** the sidebar footer's `CollectionSwitcher`
(the "Home / Web Design / Otis / …" popup you cycle collections from) was
missed in the sweep above — still rendering the old emoji/color-dot/plain-
House fallback in both the picker-popup rows and the collapsed switcher
button. Fixed: both spots now render `<CollectionFace col={ws}/>`, with the
synthetic `id: null` "Home" entry (not a real collection, no `col.icon` to
read) kept on its explicit House icon. Also caught and fixed the sidebar
tree's own active-collection-workspace header row (`activeCol.emoji`
ternary) — same stale pattern, same fix.

**Verify:** `npx eslint` clean on every touched file (pre-existing-only
errors remain — same set as A101/A102); `npx vite build` green; impeccable
`detect.mjs` scan over all seven touched files: zero findings in the new
code (all 21 pre-existing, elsewhere).

## A102. Pass 1 round 2 — sidebar chevron alignment, collection icon picker, context-menu spacing

Another live-screenshot round on top of A101.

**Sidebar chevrons misaligned.** Type-folder rows (Books/Audiobooks/…) wrap
their chevron in `.sidenav-nav-expand` (adds 2px padding); collection rows
rendered `<ChevronIcon/>` bare with slightly different row padding —
different total inset from the row's right edge, so the two groups'
chevrons sat a few px apart instead of forming one column. Root cause was
collection rows being a fully bespoke inline-styled div instead of sharing
`.sidenav-nav-item`/`.sidenav-nav-icon`/`.sidenav-nav-expand` with the
type-folder rows above them — which was also *why* they "looked different"
(brighter resting-state text since collections hardcoded `color:
var(--text)` instead of inheriting `.sidenav-nav-item`'s dimmed
`var(--textDim)`-until-hover, different icon opacity, no keyboard
support). Collection rows in `SideNav.jsx` now render through the same
three classes as every other row — only the per-depth left indent stays as
an inline override. Manual `onMouseEnter`/`onMouseLeave` background swap
removed in favor of the class's own `:hover` rule.

**Icon picker added to the collection edit modal** (`CollectionEditModal`,
`SideNav.jsx`). New `col.icon` field (a key into a curated 16-icon
lucide-react set — folder, archive, bookmark, tag, star, heart, flame,
graduation-cap, briefcase, globe, palette, music, coffee, layers, +2 folder
variants), mutually exclusive with emoji (picking one clears the other —
avoids ambiguity about which face wins). New `CollectionFace` component
centralizes the precedence every collection-glyph render site should use:
emoji → icon → color dot → plain Folder. Wired into the sidebar tree row;
**not yet wired into LibraryView.jsx's own collection cards, the collection
detail header, or the bulk-select picker** — those still render emoji-only
and won't show a chosen icon yet. Flagged in `PLAN_POPUP_REVAMP.md`.

**Context menu spacing, per feedback ("add padding top/bottom to match
horizontal, corners less round, drop 2-4px on the bevel"):** `.ctx-item`
vertical padding 5px → 7px (now equals the 7px horizontal, was
asymmetric); `.context-menu` corner radius 8px → 5px, `.ctx-item` corner
radius 5px → 3px.

**Also:** exported `buildAddToCollectionSubmenu` moved out of
`ContextMenu.jsx` into new `src/lib/collectionSubmenu.js` —
`react-refresh/only-export-components` errors on a component file mixing
in a plain function export; this project enforces that rule.

**Verify:** `npx eslint` clean on all touched files (pre-existing-only
errors remain, same set as A101); `npx vite build` green.

## A101. Popup/dropdown revamp Pass 1 — one shared ContextMenu component

First pass of `PLAN_POPUP_REVAMP.md` (queued in [[project_popup_revamp]]).
Scope: unify the app's right-click/dots-menu implementations and give the
result a real design pass — impeccable + the Lookatthis UI/UX guidelines
(4pt/8pt spacing, layered shadow calibration for popovers, one authored
entrance motion, keyboard-focus states).

**Found on inspection, not assumed:** three near-duplicate menu components
existed (`SideNavCtxMenu` in `SideNav.jsx`; `ContextMenu` + `CtxSubmenu` in
`LibraryView.jsx`), each pure-inline-styled with its own ad hoc numbers
(danger color `#ef5350` vs the app-wide `#f85149`, icon size 13 vs 14px,
hardcoded z-index 9999/99999/100000 instead of the existing `--z-popover`
token, zero keyboard support, no entrance animation on the sidebar's
version). CSS was worse: **four** overlapping, mostly-dead class families
in `global.css` — `.lib-context-menu` (zero JSX usages, fully dead),
`.card-ctx-menu`/`.lib-ctx-item` (the only one actually wired up, to
LibraryView's menu), and an unused `.context-menu`/`.ctx-item` pair that a
later "section 6" polish block (deeper layered shadow + `gnos-pop-in`
entrance) was already targeting — but nothing in the app rendered with
those exact class names, so that polish was dead code no one ever saw.

**New: `src/components/ContextMenu.jsx`** — the one menu component now used
everywhere. `SideNavCtxMenu` and `ContextMenu`/`CtxSubmenu` deleted from
their old files; both call sites (`SideNav.jsx`'s sidebar right-click menu,
`LibraryView.jsx`'s card/collection right-click menu) now import and render
this. Same `items` prop shape as before (`{ label, icon, action, danger,
disabled, submenu }`, icon as a raw `<path>` SVG-fragment string — kept
because dozens of call sites across the app build menus this way; rewriting
every caller onto `lucide-react` components is out of scope for a container
redesign and would be a separate, much larger pass).

- **Keyboard nav added** — none of the three old menus had any. Up/Down
  moves a highlighted row (wraps, skips disabled items), Enter activates it
  or opens its submenu, Right opens a submenu, Left/Escape closes the
  nearest open layer, `:focus-visible` gets an accent outline ring.
  `role="menu"`/`role="menuitem"` added.
- **Submenu positioning** — kept LibraryView's viewport-aware version
  (flips left/right, clamps + scrolls vertically) over SideNav's cruder
  one (computed once from initial `x`, no vertical clamp — could run off
  the bottom of the screen).
- **Visual, `global.css`:** collapsed the four class families into one —
  `.context-menu` (container: `var(--z-popover)` instead of a hardcoded
  number, `var(--surface)`/`var(--border)`, 10px radius) + `.ctx-item` (rows:
  8px/12px padding, 7px radius, pill-hover via `var(--hover)`, no divider
  lines — matches the sidebar's own rounded-pill row language). Danger rows
  standardized on the app-wide `#f85149` red (was `#ef5350`, inconsistent
  with every other danger-red in the app). The dormant "section 6" polish
  (layered shadow `0 0 0 1px / 0 10px 24px / 0 24px 64px`, `gnos-pop-in`
  0.13s entrance) now actually applies, extended to cover the submenu too.
  Deleted the fully-dead `.lib-context-menu` block and the now-superseded
  `.card-ctx-menu`/`.lib-ctx-item` rules.
- Icon size standardized to 14px (was 13 in one implementation, 14 in the
  other); submenu color-swatches to 14px/4px-radius.
- **Tightened after user feedback ("too much horizontal space, looks
  cheap — Notion-quality")**: row padding 8px/12px → 5px/7px, icon-label
  gap 9→7, row radius 7→5, container padding 4→3, container min-width
  180→160, swatch 14px/4px-radius → 13px/3px. Denser rows, menu width now
  hugs its content instead of leaving dead space around short labels.

**Follow-up after live screenshots — real data/content bugs, not just
sizing:**
- **`quicknotes` was leaking into every "Add to Collection" picker.** Both
  files built that submenu as a raw, unfiltered `collections.map(...)` —
  the auto-managed `quicknotes` collection (meant to read as a type-folder
  everywhere else, per A100) showed up as a normal pickable target.
  New exported helper `buildAddToCollectionSubmenu()` in `ContextMenu.jsx`
  is now the one place this list gets built: filters out `quicknotes`,
  **sorts alphabetically** (was raw insertion order — unscannable once a
  user has 8+ collections), and **checkmarks collections the item already
  belongs to** (previously no indication at all, so re-adding to a
  collection you're already in gave silent no-op feedback). Both
  `SideNav.jsx`'s `colSub` and `LibraryView.jsx`'s `makeCollectionSubmenu`
  now call the shared helper instead of hand-rolling their own copy.
  A 4th unfiltered `collections.map` was found in the bulk-select toolbar's
  own "Add to Collection" picker (`LibraryView.jsx:3333`, a bespoke dropdown
  that doesn't go through `ContextMenu` at all) — not fixed here, flagged
  in `PLAN_POPUP_REVAMP.md` for whichever pass covers it.
- **Ellipsis/chevron affordance was mixed on submenu-opening items** —
  "Move Into…" carried both a trailing "…" *and* a chevron, while "Add to
  Collection" (same submenu behavior) had only the chevron. Ellipsis
  conventionally signals "opens a dialog needing more input"; chevron
  signals "opens a submenu" — using both on one but not the other was an
  inconsistent, slightly conflicting signal. Standardized: submenu-openers
  keep the chevron only, ellipsis reserved for real dialog-openers (Edit…,
  Edit Collection…). Renamed "Move Into…"/"Move into…" → "Move Into"/
  "Move into" in both files.
- **`ContextMenu`'s "Move Into" icon read as a plain inbox/drawer**, not
  "move into a folder" — swapped for a folder-outline + arrow-entering
  glyph (LibraryView's own "Move into" icon was already this shape;
  SideNav's collection-row version wasn't).
- New general-purpose support added to `ContextMenu.jsx`/`global.css` while
  fixing the above, available to any menu now: `{ divider: true }` items
  (top-level or submenu) render a thin separator (used between "+ New
  Collection" and the real collection list); submenu items can carry
  `checked: true` for a trailing checkmark.

**Verify:** `npx eslint` clean (same pre-existing-only errors as before);
`npx vite build` green.

**Verify:** `npx eslint` clean on all three touched files (only pre-existing
unrelated errors remain — same set noted in A100, plus one new-then-fixed
`useLayoutEffect` unused-import in `SideNav.jsx` after `SideNavCtxMenu`'s
removal); `npx vite build` green. Ran the impeccable mechanical detector
(`detect.mjs`) over all four changed files — zero findings in the new/
changed code (everything it flagged is pre-existing, elsewhere in
`global.css`/`LibraryView.jsx`, unrelated to this pass). **Not visually
verified** — same browser-preview limitation as A100 (the onboarding
archive-folder picker needs a real Tauri `invoke()`); needs a look in
`npm run tauri:dev`: right-click a sidebar item and a library card, confirm
both render the same menu, submenu flip/scroll still works, arrow keys move
the highlight, Enter/Escape work, danger rows read red.

## A100. Library nav v2 — single "Library" accordion, bigger, click-to-expand

User saw A99 live and asked for a revision — full plan handed off in
`PLAN_LIBRARY_NAV.md`. Reverses A99's "flatten collections to be siblings of
the type buckets" piece while keeping the rest of A99 (header filter/sort
buttons, Sketchbooks as its own row, collection-workspace flat view).

**`SideNav.jsx`:**
- **Single top-level accordion.** `NAV_ITEMS` split: `LIBRARY_ITEM` (id
  `library`) is now the one parent row, rendered above a `NAV_ITEMS` array
  that holds only Books/Audiobooks/Notebooks/Sketchbooks/Flashcards. Its own
  expand state (`isLibraryExpanded()`/`toggleLibraryExpanded()`) is
  independent of the type-folder accordion sweep in `toggleExpanded()` —
  collapsing Library doesn't clobber which type-folder or collection was
  open inside it. Starts expanded (`expanded.library === undefined` reads as
  open). Everything nested below it — type-folders, Quicknotes, collections
  — sits inside a `paddingLeft: 14` wrapper for one visual indent level; each
  folder's own contents indent further via `NavDropdown`'s existing padding,
  same as before. Net structure: `Library > Books/Audiobooks/Notebooks/
  Sketchbooks/Flashcards/Quicknotes/Collection A/Collection B`.
- **Quicknotes reads as a type-folder.** New block between the `NAV_ITEMS`
  map and the collections sweep: finds the collection via
  `collections.find(c => c.name === 'quicknotes')` (matches the auto-managed
  collection from A61-era `addToQuickNotesCollection()` in `storage.js` —
  data model unchanged), renders it with the same `.sidenav-nav-item` row
  markup as the type-folders (plain `Folder` icon, no emoji/color-dot/count),
  and the `rootCollections` filter in the collections sweep now excludes
  `c.name === 'quicknotes'` so it doesn't also render there with the
  ordinary card treatment.
- **Click = expand, ⌘/Ctrl+click = navigate.** Library's row and each
  type-folder row now branch in `onClick`: `e.metaKey || e.ctrlKey` calls
  `handleNavItem(id)` (today's navigate + apply-filter behavior), otherwise
  toggles expand only. The old separate chevron `<button>` (`toggleExpanded`
  as its own click target) is now a plain `<span className="sidenav-nav-
  expand">` — same hover-opacity affordance, glyph still visible, but the
  row itself is the only click target (no more double-click-target
  redundancy). Collection rows and item rows are unchanged — plain click was
  already toggle-only / open-only there, no regression.
- **Sizing brought back up — roughly midway between pre-A99 and A99,** not a
  straight revert (user: "make everything slightly bigger... it's too
  small"). Every place A99 shrank: `.sidenav-nav-item` (gap 7→8, padding
  5/6→6/7, font 10→11px), `NAV_ITEMS`/`LIBRARY_ITEM` icon size (11→13),
  `ChevronIcon` (8→9), `MiniCover` (15×21/26→18×25/30, radius 3→4),
  `NavDropdown` row (gap 6→7, padding, title 9→10px, author/due-date 8→9px,
  progress-pct 7→8px, format-tag 7→8px + padding, Ellipsis button 19→22px +
  icon 10→12), collection row (gap 5→6, padding, emoji 11→13px, color-dot
  10→12px, `Folder` icon 10→12, name 10→11px, count 8→9px).

**`LibraryView.jsx`:**
- **Removed the duplicate collection-identity bar.** The `app-header`
  workspace-indicator block used to show a chip with the active collection's
  name + a ✕-to-exit button whenever `activeCollectionId` was set —
  redundant once the sidebar already shows the active collection (workspace
  flat-view header row, plus the footer `CollectionSwitcher`, which has its
  own "Home" entry that fully exits the workspace via `setActiveCollectionId
  (null)`). Removed; the `typeFilter !== 'all'` badge in the same block is
  untouched (separate concern, still shows on its own). `setActiveCollectionId`
  import dropped from the file — it was only ever called from the removed
  ✕ button.

**Quicknotes icon** — plain `Folder` swapped for `StickyNote` (lucide-react)
in the Quicknotes row so it reads as its own thing instead of landing as a
generic file/folder.

**Resolved after a live screenshot:** the redundant text was the
`sidenav-section-label` reading "LIBRARY" directly above the nav tree —
harmless on its own pre-A100, but now literally duplicated by the new
Library accordion row right underneath it (both say "Library"). Dropped for
the non-workspace case; kept for the "Collection" workspace label since
nothing else in that view repeats it.

**Verify:** `npx eslint` clean on both files (same pre-existing unrelated
errors noted in A99 — `SideNav.jsx`'s 2 in the untouched External-files
block, `LibraryView.jsx`'s pre-existing set from other concurrent in-flight
work — none in the new/changed code); `npx vite build` green after the
label fix too. **Not visually
verified** — the web preview (`vite preview`, since this session's dev-server
port was already held by another chat) can't get past onboarding: the
"Begin" button's archive-folder picker calls a real Tauri `invoke()` that
never resolves outside the packaged app, so the library never loads far
enough to render the sidebar. Same limitation as every prior sizing/sidebar
pass in this project — needs a look in `npm run tauri:dev`: Library
expanded by default with everything nested inside and indented, Quicknotes
reads as a folder not a collection card, sizing feels right (denser than
pre-A99, roomier than A99), plain click expands / ⌘-click navigates, and the
collection workspace no longer shows the duplicate identity bar.

## A99. Library header filters + sidebar reads as flat folder management

User: two header filter buttons for Library (type cycle + sort, "like the live/preview/source switcher"), and a sidebar redesign — nested under one "Library" heading instead of a separate "Collections" bucket one level deeper, Sketchbooks split out on its own, everything ~25% smaller for denser navigation, and a collection workspace should show one flat file list instead of type-bucketed sections.

**Header — two new buttons, `LibraryView.jsx`, portaled via `<QuickAccess>` (the same titlebar slot NotebookView's view-mode switcher uses — Library had never used this slot before):**
- `TypeFilterBtn` — click cycles `typeFilter` through All → Books → Audiobooks → Notebooks → Sketchbooks → Flashcards → All; long-press (300ms) opens a dropdown to jump straight to one. Exact interaction shape as `ViewModeBtn`.
- `SortFilterBtn` — click opens a dropdown: Manual order (existing drag-order/insertion-order behavior, unchanged default) / Name / Date Modified / Date Created; re-clicking the active field flips ascending/descending. New `_itemCreatedAt`/`_itemModifiedAt` helpers normalize the inconsistent field names across types (books/audio use `addedAt` from import, notebooks/sketchbooks/decks use `createdAt`/`updatedAt`). **No "Size" option** — no file byte-size is tracked anywhere yet (would need a new async stat pass over every book/audio/note file); user chose to skip it for now rather than fake it with a proxy.
- Wired into `renderAll()`'s existing ordering step: an active sort overrides `unifiedLibraryOrder` (manual drag order) while active; switching back to "Manual order" restores prior behavior exactly.

**Sidebar — `SideNav.jsx`, three structural changes:**
- **Sketchbooks split out.** `NAV_ITEMS` had no entry of its own — sketchbooks rode along inside the `notebooks` bucket (`case 'notebooks': return [...nbs, ...sbs]`). Now `sketchbooks` is its own top-level row (Books → Audiobooks → Notebooks → Sketchbooks → Flashcards), `getItemsForTab`/`VIEW_TO_TAB` updated to match.
- **Collections flattened.** The old `NAV_ITEMS` had a separate `collections` entry — expanding it revealed the individual collections one level deeper. Removed that intermediate bucket entirely; every root collection (recursive sub-collections still nest inside their parent, unchanged) now renders as a **direct sibling** of Books/Audiobooks/Notebooks/Sketchbooks/Flashcards, right under the same "Library" label. Reads as one flat folder listing — one expand step from "Library" to any collection, not two. The existing `quicknotes` collection (already a real auto-managed collection, A61-era) comes along for free, no special-casing needed.
- **Collection workspace goes flat.** Switching into a collection workspace (`activeCollectionId` set, via the sidebar footer's `CollectionSwitcher`) used to still show the full Books/Audiobooks/Notebooks/Sketchbooks/Flashcards breakdown, just filtered to that collection's items. Now it replaces the whole bucket list with **one** flat item list under the collection's own name — matches "Collection folder > File 1/File 2/File 3" exactly. Reuses the existing `getItemsForTab('library')` collection-filter (smart-filter rules included) for the item set; search stays global (`SideNavSearch` was never scoped to the active collection), so finding and opening something outside the workspace never requires leaving it first.
- **~25% smaller across the board** — `.sidenav-nav-item` padding/font (7px→5px, 12.5px→10px), `NAV_ITEMS` icon size (14→11), `NavDropdown` row padding/fonts/Ellipsis-button/format-tag, `MiniCover` (20×28→15×21), collection-row padding/fonts/icons, `ChevronIcon` (10→8) — denser list, more of the tree visible without scrolling.

**Verify:** `npx eslint` clean on both files (same 2 pre-existing unrelated errors in `SideNav.jsx`, from the other concurrent chat's in-flight external-ref work, untouched); `npx vite build` green (two earlier failures were transient `ENODEV`/`ETIMEDOUT` iCloud asset-copy flakes unrelated to this change — a clean retry succeeded). **Not yet visually verified** — the browser-preview tool hit a transient overload during this session; needs a look in the running Tauri app: header buttons cycle/sort correctly, Sketchbooks shows its own row, collections sit flush under Library, a collection workspace shows one flat list, and the whole tree reads noticeably denser.

## A98. Folder existence alone now registers as a collection

User tested the "AI agents/other devices can just use a folder" claim directly: dropped a `tutor/` folder with a random `.md` in it straight into the archive via Finder, outside the app. The note self-heal-adopted fine (existing orphan-scan already covered every folder), but `tutor` never showed up as a Collections card — that tab only ever read `collections_meta.json`, and nothing synthesized an entry from a bare folder on disk. Real gap vs. the collections design intent.

- New `syncFolderCollections()` (`storage.js`) — NOT a one-time migration, runs every reconcile: (1) registers any real, non-reserved root folder that has no matching `collections_meta` entry yet, name-cased off the folder itself; (2) for notebooks/sketchbooks — whose index already tracks each item's real path — rewrites `items[]` to match physical location exactly, so a note moved, renamed-folder, or dropped in externally is always correctly attributed, notebooks/sketchbooks membership stops being something the app has to be told about.
- **Books/audio deliberately excluded from the physical-location reconcile** — unlike notebooks/sketchbooks they have no orphan-adopt tied to physical path, so guessing membership from a filename match would be fragile guesswork, not a real self-heal. They keep using the explicit `book.collection` field (A96's in-app move, A97's id-based backfill).
- Wired into `useAppStore.js` at two points: `init()` (chained after the flatten migrations, before A97's backfill — so a freshly-discovered collection's notebook/sketchbook membership is already correct by the time A97 runs, making its move calls no-ops for those) and `rescanNotebooks()` (the existing "pick up external edits without a restart" poll) — so a folder dropped in while the app is already open shows up live, not just on next launch.

**Verify:** build green; eslint clean (same 2 pre-existing unrelated `storage.js` errors, untouched). **Runtime-verified by user** — `tutor/Tutor Test Note.md` dropped directly into the archive via Finder showed up correctly as a "tutor" collection card containing the note.

## A97. Backfill: pre-A96 collection membership now physically moves files too

User, after confirming A96 worked for a fresh "Add to Collection": "auto update everything that is already in a collection." Real gap — several collections (e.g. "Early Christianity and Greek Studies" already listed an audiobook id) had items added back when only notebooks had a mover; `collections_meta.json`'s `items[]` said they belonged, but the file itself was still sitting in `audio/`/`books/`/`sketches/`, never moved.

- New `migrateCollectionMembershipToFolders()` (`storage.js`) — one-time, guarded (`collection_membership_backfilled_v1`). Walks every collection's `items[]`, looks each id up (notebook index → sketchbook index → library), and calls the matching A96 mover. All 4 movers already no-op if the file's already in the right place, so this is safe to run over notebooks too even though they never needed it.
- Wired into `useAppStore.js` init(), chained after `Promise.allSettled([...])` on the 5 flatten-migration promises — has to run after them so paths resolve against final on-disk shape, not a mid-flatten one. Fire-and-forget overall (doesn't block startup), just internally sequenced.

**Verify:** build green; eslint clean (same 2 pre-existing unrelated `storage.js` errors, untouched). Runs automatically on next launch — watch for the pre-existing audiobook (and anything else added to a collection before today) to physically move into its collection folder.

## A96. Collections generalized to all 4 content types (books, audio, sketchbooks, notebooks)

User's collections redesign, confirmed earlier: a collection is a real folder at archive root; the Library workspace ignores collection folders and shows everything flat; other workspaces (notebooks/sketchbooks) only show their own group's files; single membership per item, no type-subfolders inside a collection. Notebooks already worked this way (A61). This extends the same real-folder-move mechanism to sketchbooks, books, and audio — the last piece before "Now run through the collections changes please" is done.

- **Sketchbooks** (`storage.js`): new `_splitSkPath`/`_resolveSkPath`/`_resolveSkDir` — generic archive-relative path resolvers mirroring notebooks' `_splitIndexPath`/`_resolveIndexPath`, since a sketch's `file` in `sketches_index` can now point inside a collection folder instead of always under `sketches/`. `loadSketchbookContent`/`saveSketchbookContent`/`saveSketchbooksMeta`/`deleteSketchbookContent`/`moveToTrash('sketchbook', …)` all route through them. New `moveSketchbookToCollection(id, collectionName)`, mirroring `moveNotebookToCollection`. `_adoptSketchOrphans` rewritten to scan collection folders too — normalizes both sides through `_splitSkPath` before comparing, to avoid misreading an existing (bare-path) sketchbook as orphaned the moment collection-folder paths enter the comparison (same bug class as A88, caught before shipping this time).
- **Books** (`storage.js`): new `getBookBaseDir(book)` — returns the book's collection dir if set, else `getBooksDir()`. `saveBookContent`/`loadBookContent`/`moveToTrash('book', …)`/`loadLibrary`'s `attachPdf` + `sourceMissing` check all resolve through it instead of a hardcoded `books/`. New `moveBookToCollection(book, collectionName)`, handles `.pdf`/`.epub`/`content.json` uniformly.
- **Audio** (`storage.js`): new `getAudioBaseDir(book)`; `getAudioBookDir`/`getAudioFlatPath` now call it, which cascades the collection-awareness to everything downstream (`saveAudiobookMeta`, `deleteAudiobookMeta`, chapter read/write) for free. New `moveAudioToCollection(book, collectionName)` — handles both the multi-chapter chunk-folder case and the single-track flat-file case.
- **Store** (`useAppStore.js`): `syncCollectionFolders`/`removeFromCollection` now route through a new generic `_moveItemToCollection(itemId, collectionName, storageMod)` — looks up the item's type across `notebooks`/`sketchbooks`/`library`, calls the matching mover. Books/audio have no index (unlike notebooks/sketchbooks), so this patches `book.collection` onto the `library` entry and persists on success.
- **UI**: no changes needed. Both context-menu builders (`LibraryView.jsx`'s `makeCollectionSubmenu`, `SideNav.jsx`'s `colSub`) already built "Add to Collection" off a bare item id, and the collection-detail view already resolved `col.items` across `library`/`notebooks`/`sketchbooks`/`flashcardDecks` generically — that UI was already type-agnostic from the notebooks-only days; only the underlying move mechanics were notebooks-only until now.

**Verify:** `npx eslint` clean on `storage.js`/`useAppStore.js` (same 2 pre-existing unrelated errors in `storage.js`, untouched; `useAppStore.js` fully clean); `npx vite build` green. **Not yet runtime-verified** — needs a live launch: create a collection, drag/menu a book, an audiobook, and a sketchbook into it, confirm the physical files move into the collection folder and the collection-detail view still opens/plays/edits them correctly from the new location.

## A95. `_internal/` hidden from Finder — without renaming it

User wants `_internal/` out of the way so it can't get accidentally deleted browsing the archive, but a dot-prefix rename is exactly the move that's broken this app twice already (A52 — the fs capability scope rejects dot-prefixed paths outright). Different mechanism, same path: macOS/Windows both support an OS-level "hidden" attribute completely separate from the filename.

- New Rust command `hide_path` (`src-tauri/src/lib.rs`) — runs `chflags hidden <path>` on macOS, `attrib +h <path>` on Windows. Fire-and-forget from the JS side, errors swallowed — this is cosmetic, never allowed to block a real write.
- `storage.js`'s `keyToPath()` calls it exactly once, right where `_internal/` gets `mkdir`'d for the first time — covers every future install/archive automatically, no separate migration needed. Only `_internal/` gets this treatment; the real content folders (`books/audio/notebooks/sketches/covers`) stay normally visible.
- Applied directly to the live archive too (`chflags hidden`) rather than waiting for a fresh-creation trigger that will never fire again for an `_internal/` that already exists.

Terminal tools, scripts, and the app itself all still see the folder exactly as before — `chflags hidden` only affects a default Finder/Explorer browse, not the filesystem path. The user can still reveal it anytime (Finder's `Cmd+Shift+.`, or `chflags nohidden`).

**Verify:** frontend build green, eslint clean (same 2 pre-existing unrelated errors); `cargo check` clean, exit 0, no warnings. **Not yet confirmed the folder actually disappears from Finder on this machine** — `chflags` succeeded without error, but hasn't been visually confirmed in a Finder window yet.

## A94. Eight migration-guard files → one `migrations.json`

User, looking at the still-long `_internal/` listing: "there's nothing about this we could consolidate?" Right call — every one-time migration in `storage.js` had been guarding itself with its own dedicated boolean file (`nb_flat_migrated_v2.json`, `sk_flat_migrated.json`, `root_files_migrated.json`, `nb_foldernotes_indexed.json`, `type_meta_migrated.json`, `nb_legacy_cleaned.json`, `books_flat_migrated.json`, `audio_flat_migrated_v2.json`) — eight tiny files that are each just the literal value `true`.

- New `_migrationDone(key)`/`_markMigrationDone(key)` helpers read/write one consolidated `_internal/migrations.json` map instead. All 8 call-site pairs across the file swapped over.
- **Self-healing, no dedicated migration needed**: `_migrationDone` checks the combined file first; if a key isn't there, it falls back to checking for the OLD separate file, folds a `true` value into the combined map, and deletes the stale separate file. Every existing install picks this up automatically the next time each guard is normally consulted — same pattern as every other migration this session, just for the guards themselves.
- Also did the live consolidation directly on the archive (all 8 were already `true`) rather than waiting for the next launch to self-heal it.

**What's staying separate, and why:** the real per-item data (`nb_index`, `sketches_index`, annotations, calendar events, flashcard decks, kanban boards, reading progress/log, collections, quicknote map) each get written independently by unrelated features at unrelated times. Merging those into one mega-file would mean any small edit rewrites everyone else's data too — reintroducing the exact whole-file-rewrite cost A83/A84 spent today's session removing from `library.json`. Guard flags were different: pure booleans, all written together at startup by the same migration-runner code, no independent-write-frequency concern.

**Verify:** build green; eslint clean (same 2 pre-existing unrelated errors, untouched). `_internal/` went from 23 items to 15. **Not yet re-verified live** — the self-heal fallback path (old-file-not-found-in-combined) hasn't been exercised by an actual launch yet, only the direct-consolidation path (done manually, matches what the code would have produced).

## A93. A87 shipped a real regression: startup race mass-duplicated notebook/sketchbook indexes

User noticed `nb_index.json` and `sketches_index.json` each existed in TWO places — root **and** `_internal/` — and asked to scrub `_internal/`. Investigating surfaced active, serious data corruption from earlier today, not just stray files.

**Root cause:** `useAppStore.js`'s init runs `migrateRootFilesToInternal()` (A87) as fire-and-forget, positioned *after* the `Promise.all([loadLibrary, loadNotebooksMeta, loadSketchbooksMeta])` reconcile step. On the very first launch after A87 shipped: the reconcile step's self-heal orphan-adopt logic looked for `_internal/nb_index.json` / `_internal/sketches_index.json` — not there yet, migration hadn't run — read as empty, and treated **every real note and sketchbook** as an orphan, mass-adopting all of them with fresh random ids. The migration then ran moments later, saw its own just-created (bad) file already sitting at the destination, and — per its own "don't clobber" safety check — skipped moving the real data over. Net effect: the good original index (55 real notes with tags/due-dates/fork-history intact, 8 sketchbooks with real cover art) got stranded at the archive root, invisible to the app, while `_internal/` held a corrupted index of mostly-bare re-adopted duplicates.

**Fix (`useAppStore.js`):** moved `migrateRootFilesToInternal()`/`migrateTypeMetaCachesToInternal()`/`migrateCachesToLocal()` earlier and **awaited** them, before the reconcile `Promise.all` runs — so relocation is always complete before anything can misread an empty destination as "nothing indexed yet."

**Data recovery (live archive):** backed up both copies of each index file first. Reconciled `nb_index.json` by matching entries on their **file path** (not id, since ids differed) — the 55 real notes kept their original id + full metadata (tags, due dates, fork history); the only entries kept from the corrupted `_internal` copy were 6 that checked out as legitimate — today's own A90/A91 migration output (Koine_greek, two flattened notes, the `Questions`/`Quesitons` id-collision fix, the two folder-notes), not corruption artifacts. None of the ~53 phantom duplicates survived. `sketches_index.json` was simpler — all 8 real entries matched 1:1 by file, root's copy (with real cover art) replaced the corrupted one outright. Verified afterward: all 59 final `nb_index` entries resolve to a real file on disk. Also removed the stale root copies and one unrelated dead file found in passing: a stray `notebooks/app_prefs.json` (traced to a Jul 21 — three weeks old, unrelated to today — period where `archivePath` was itself misconfigured to point at `.../Gnos/notebooks`).

**On "scrub `_internal/` of bloat":** checked every file in it. All but one are either real user data or an **active** guard flag whose job is to persist forever (tiny, one-time migration markers — deleting one just makes its migration pointlessly re-run, not "cleans up"). Found and removed exactly one genuinely dead one: `nb_flat_migrated.json` (v1, superseded by `_v2`, same as the `audio_flat_migrated` v1 already cleaned up in A87 — this one just never got the same treatment).

**Verify:** build green; eslint clean. Ordering fix not yet re-verified live (the bug it fixes can now only occur on a first-run-after-A87 basis, which has already happened once for this archive — this closes it for any future install/user).

## A91. Folder-notes' `meta.json` folded into `nb_index` — folder + `images/` stay, sidecar file goes

User: keep the `images/` subfolder (looks more visually consistent), but flatten the JSON — matching the treatment every other type's per-item `meta.json` already got this session (audio A73, books A77, sketchbooks A72). Notebooks were the one holdout because folder-notes (kept as folders specifically for `images/`) were never index-backed at all — `nb_index` only ever covered fully-flat notes.

- New `folderNote: true` flag on an `nb_index` entry — same entry shape as a flat note, `file` just points at `notebooks/<Title>/<Title>.md` instead of a bare `notebooks/<Title>.md`. The folder and its `images/` are completely unchanged; only `meta.json` disappears.
- `_renameFolderNoteIfNeeded()` — new shared helper both `saveNotebooksMeta` and `saveNotebookContent` call for a `folderNote` entry: renames the whole **folder** (not just the `.md` inside it) when the title changes, so the folder name stays in sync. Wired into both save paths' existing flat-note branch (title changes could arrive through either).
- `moveToTrash('notebook', …)` now trashes the whole folder for a `folderNote` entry instead of just the `.md` inside it.
- `moveNotebookToCollection` still excludes `folderNote` entries (same "not movable yet" status as before — collections work is next).
- **Caught a real conflict before it shipped**: `syncNotebooksFromDisk()` (runs at the top of every `loadNotebooksMeta()`) treats any folder with a `.md` but no `meta.json` as "externally created" and mints it a **fresh random id** — which would have re-broken A90's fix the moment a `folderNote`'s `meta.json` disappeared, on the very next load. Added an index-membership check so it skips anything already `folderNote`-tracked.
- New **`migrateNotebookFoldersToIndex()`** — one-time, guarded (`nb_foldernotes_indexed`), converts existing folder-notes (found by having a `meta.json`) into index entries and removes the sidecar file. Atomic per note — only removes `meta.json` after the index write succeeds.

**Verify:** build green; eslint clean (one pre-existing `notebooksDir` unused-var warning incidentally fixed as a byproduct of this edit; two unrelated ones remain from other in-flight work). **Not yet runtime-verified.**

## A92. `notebooks_meta.json`/`sketchbooks_meta.json` → `_internal/` too

Answering "what's `sketchbooks_meta.json` and how's it different from `sketches_index.json`": the index is the canonical id→file/metadata map (source of truth); the `*_meta.json` file is just a flat order-cache (preserves manual drag-reorder) plus an emergency cold-start fallback if the index+folder-scan both come up empty — same role `library.json`'s slim array plays for books/audio. Unlike `library.json`, which the user asked to keep visible in `books/` because it carries real per-item fields, these two carry no such user-facing value — pure bookkeeping, same as `nb_index`/`sketches_index` (A87).

- `getSubfolder()` now special-cases these two exact keys to `_internal` before the general type-prefix rules (which would otherwise route them into `notebooks/`/`sketches/`).
- New `migrateTypeMetaCachesToInternal()` — A87's root-only scan never touched these since they live inside their type folder, not archive root; this one-time migration relocates the two existing files into `_internal/`.

**Verify:** build green, eslint clean. **Not yet runtime-verified.**

## A90. Notebooks stuck as orphan folders — a second save function that defaulted to folder instead of flat

User's Finder screenshot of `notebooks/` showed several folders — `Koine_greek`, `CFM Lesson`, `CFM Lesson May 31`, `Questions`/`Quesitons`, two "Odyssey…Highlights" — that weren't the known "kept for images" case. Checked all 9 non-indexed folders directly: 2 legitimately have `images/` (correctly excluded from flattening, working as designed); the other 7 were pure bug fallout, split two ways:

- **4 had real content** (`CFM Lesson` 5252B, `Koine_greek` 21324B, `Questions` 12B, `[[…]] — Highlights` 672B) but were never in `nb_index.json` at all.
- **3 were empty ghosts** (0 bytes) — `CFM Lesson May 31`, `The Odyssey…— Highlights` (no brackets), and `Quesitons`. That last one shared its **exact id** with `Questions` — a rename had created a second, empty folder instead of renaming in place, leaving the real content stranded under the old name.

**Root cause:** `saveNotebooksMeta` and `saveNotebookContent` disagreed on what a brand-new note defaults to. `saveNotebookContent`'s new-note path already creates it flat (comment: *"New note — create it FLAT"*). `saveNotebooksMeta`'s equivalent fallback — reached when a note has no index entry and no folder found by id — called `getNotebookDir(nb)`, which unconditionally creates a **folder**. Whichever of the two save functions happened to run first for a given note silently decided its format forever, since `migrateNotebooksToFlat` only ever runs once (guarded) and never revisits a note already accounted for.

**Fix (`storage.js`):** `saveNotebooksMeta`'s brand-new-note fallback now creates the note flat too — same `_flatFileName` + index-entry pattern `saveNotebookContent` already used, so both paths agree.

**Data cleanup (live archive):**
- 3 confirmed-empty ghost folders backed up (`~/Gnos-backups/<ts>-notebook-ghosts/`) then OS-trashed.
- Guard bumped `nb_flat_migrated` → `nb_flat_migrated_v2` (same pattern as A75) so the 4 real-content orphan folders get correctly swept into flat `.md` files by the existing (already-correct) `migrateNotebooksToFlat()` on the next launch — no manual reconciliation needed, and by then the `Questions`/`Quesitons` id collision has only one folder left to resolve, so no ambiguity.

**Verify:** build green; eslint clean (pre-existing unrelated errors only). **Not yet re-verified against a live launch.**

## A89. Pure caches split out of `_internal/` into per-machine app data — not synced

Follow-up to A87. User plans to use Gnos across multiple devices via this same iCloud archive eventually, so `_internal/` (synced) needs to stay reserved for things that matter for continuity — but 3 of its key families are pure regenerable caches with no reason to make that trip: `reader_pageindex_book_*` (rebuilds from the book), `reader_perf_report` (a debug snapshot), `epub_content_cache` (A86 — re-derivable from the kept `.epub`).

- New **`getLocalJSON`/`setLocalJSON`** (`storage.js`) — same tiny key→JSON-file interface as `getJSON`/`setJSON`, but rooted in Tauri's `appDataDir()` (next to the existing `archive_path.json`) instead of the archive. Per-machine, never touches iCloud.
- Rewired the 3 cache families to use it: `loadEpubCache`/`_saveEpubCache`, `ReaderView.jsx`'s page-index store, `readerPerf.js`'s `/perf report` save.
- **`migrateCachesToLocal()`** — one-time relocation of whatever already exists archive-side (checks both root and `_internal/`, since a user could be on either side of A87's migration) into the new local cache dir; copies then removes, nothing lost. Guarded **locally** (per-machine) rather than via the synced archive — correct here, since a second device would have its own leftover archive-side cache files to migrate independently.

**Everything that genuinely needs to sync stays in `_internal/`** — `nb_index`, `sketches_index`, `reading_progress`, `annotations_*`, `flashcard_decks`, `kanban_boards`, `calendar_events`, `collections_meta`, `app_prefs`, etc.

**Verify:** build green; eslint clean (pre-existing unrelated errors/warnings only). **Needs the Tauri app** — watch the next launch: `reader_pageindex_*`/`reader_perf_report`/`epub_content_cache` should disappear from `_internal/` and reappear under the app's own data directory; reading position/pagination and `/perf report` should keep working unchanged.

## A88. RUNAWAY SKETCHBOOK DUPLICATION — race in the orphan-adopt self-heal, materialized by a missing migration guard

User's Finder screenshot of `sketches/` — 24 stray folders, 3 phantom duplicates for each of 8 real sketchbooks (`Char_30008_659ydo`, `Char_30008_wz2gow`, `Char_6610962_nvxs`, …), each **meta.json-only, zero real content**. `sketches_index.json` itself was clean (8 correct entries) — the mess was entirely orphaned folders the index no longer even referenced.

**Root cause — two bugs compounding:**
1. `loadSketchbooksMeta`'s orphan-adopt self-heal (A72) read the index, scanned for `.excalidraw` files not in it, and wrote a fresh entry — but had no protection against two overlapping calls to `loadSketchbooksMeta()` each reading the SAME pre-write index and independently "adopting" the same file under its own fresh random id (`sk_<Date.now()>_<rand>`) — matching ids down to the millisecond confirmed this (`sk_1787029930008_659ydo` / `sk_1787029930008_wz2gow`). Whichever call's `saveSketchesIndex` wrote last won — the other's index entry was silently lost, but the phantom entry still existed in that call's *returned in-memory array*.
2. `migrateSketchbooksToFolders` (still wired for the oldest keyed-store shape) had no "already flat-indexed" guard — the exact bug class A53 already fixed for `migrateNotebooksToFolders`, missed when A72 built the sketchbook equivalent. It received the polluted in-memory array and unconditionally materialized *every* entry — including the phantom, lost-the-race ones — as a real folder + `meta.json` on disk. Every launch that raced added a fresh pair.

**Fix (`storage.js`):**
- Orphan-adopt now runs through `_adoptSketchOrphans()`, chained on a module-level promise so concurrent calls serialize — the second call's index re-read happens *after* the first call's write, so it correctly sees the file as no longer orphaned. Both the flat-index listing and the legacy-folder dedup check in `loadSketchbooksMeta` now read from this one authoritative post-heal index instead of two independently-stale snapshots.
- `migrateSketchbooksToFolders` now skips anything already in `sketches_index` — mirrors A53's notebooks fix exactly.

**Data cleanup (live archive):** backed up all 24 folders to `~/Gnos-backups/<ts>-sketch-dupes/`, verified each held only `meta.json` (no `sketch.json`, no unique content — safe), moved to OS Trash. `sketches/` back to 8 real files + the order cache.

**Verify:** build green; eslint clean (pre-existing unrelated errors only). **Not yet re-verified against a live launch** — watch the next one: no new duplicate folders should appear regardless of how many times init runs.

## A87. Archive root decluttered — ~23 loose internal JSON files → `_internal/`

User showed a screenshot of the archive root: 6 real content folders (`audio/books/notebooks/plugins/sketches/covers`) buried among ~23 loose bookkeeping files (`nb_index.json`, `reading_progress.json`, `reader_pageindex_book_*.json`, migration-done flags, annotations, prefs, etc.) — asked what could be hidden or compartmentalized.

- **One-line fix at the root of the problem**: `getSubfolder()` (`storage.js`) is the single routing function every `storage.get/set/delete` call goes through. Its fallback for anything that isn't a real content type (`book_*`/`library`, `notebook_*`, `sketchbook_*`, `audiochap_*`) used to be `''` (loose at archive root) — now it's `'_internal'`. One line catches all ~23 existing keys **and** every future one, with no per-key list to maintain. Underscore prefix, not a dot — the fs capability scope only rejects leading-dot paths (A52, hit twice already); confirmed the app still boots against this change, live disk relocation still needs the real Tauri app to verify.
- `library.json` stays inside `books/`, deliberately **not** moved — per the user, it's useful for them to see there.
- **`migrateRootFilesToInternal()`** — one-time relocation of whatever already exists at root into the new folder (guarded, `rename`, never clobbers). Also deletes the one confirmed-dead file it finds along the way: `audio_flat_migrated.json`, the old v1 migration flag superseded by A75's `_v2` — nothing reads the old key any more.
- `_internal` added to `RESERVED_DIRS` (a collection can't claim that name) and to `list()`'s subfolder scan (unused by any current caller, kept correct anyway).

**Verify:** build green; eslint clean (pre-existing unrelated errors only). App boots fine in browser preview (no crash from the new migration call — it no-ops harmlessly there, no Tauri fs). **Needs the Tauri app** for the actual file relocation — watch the next launch: archive root should drop from ~29 items to 7 (6 content folders + `_internal/`), and every feature that reads one of the relocated keys (prefs, annotations, reading progress, page-index cache, etc.) should keep working unchanged since `keyToPath` resolves the same way for reads and writes.

## A86. Epub books keep the real `.epub` file — content.json becomes a disposable cache

User proposal: keep the real `.epub` in `books/` (portable, grab-able, backup-able) instead of only the parsed text — connected such that the epub is the source of truth and the parsed content is just an accelerator, not the only copy. Only possible now because A77 restricted book import to `.epub`/`.pdf` — with `.txt`/`.md` gone, epub is deterministically re-parseable from its own bytes, unlike before when the original file was discarded and `content.json` really was the only copy.

- **Extracted `parseEpub` + its helpers into `src/lib/epubParser.js`** — needed regardless of everything else below, since `storage.js` regenerating a stale cache can't import from `bookImport.js` (backwards) without a shared lower-level module. `bookImport.js` shrank by ~400 lines to just the import glue.
- **New imports**: keep the real bytes → flat `books/<Author - Title>.epub` (mirrors how `.pdf` already works) + seed a root-keyed `epub_content_cache.json` (`{id: {chapters, sourceMtime}}`, same shape family as `nb_index`/`reading_progress`). No `content.json` written for these.
- **`loadBookContent`**: cache hit + `.epub` mtime unchanged → fast path. Cache miss or a newer `.epub` (user swapped the file) → re-parse live via `parseEpub`, repopulate the cache. **A `.epub` that's gone is NOT served from a stale cache** — by design, per the user's framing: the file is the connection, not a fallback source. Only a book with no cache entry at all (imported before this feature) falls through to the old `content.json`/legacy-folder/chunked-store paths, unaffected.
- **`moveToTrash('book', …)`** now checks all three possible flat shapes (pdf / epub / content.json) and drops the cache entry — covers deleting a book with the kept file present.
- **Missing-file handling — deliberately NOT silent auto-delete.** `loadLibrary` flags a book `sourceMissing: true` (runtime-only, stripped before every save, same treatment as `pdfUrl`) when it has a cache entry (i.e. was imported under this flow) but its `.epub` is gone — iCloud sync gaps could otherwise make a real book vanish from a race, no confirmation. Opening a flagged book (grid click, new-tab, sidebar, search) now shows a **"File not found" prompt** — Keep or Remove, Remove goes through the normal `moveToTrash` path (OS Trash, reversible, not a true irreversible delete) — instead of navigating into a broken reader. Small red "MISSING" badge on the card too, so it's visible before clicking. SideNav can't reach LibraryView's modal state directly, so it dispatches a `gnos:missing-book-prompt` event LibraryView listens for — same cross-component pattern already used for `gnos:import-books`.

**Verify:** build green; eslint clean (pre-existing unrelated errors only, untouched). Verified live in the browser preview (injected a book with `sourceMissing: true`): badge renders, clicking it shows the correct prompt with the right title, Keep dismisses, a normal book without the flag opens straight into the reader unaffected. **Needs the Tauri app** for the actual import/cache/regenerate-on-stale flow (preview has no FS) — import a fresh epub, confirm `books/<Name>.epub` + an `epub_content_cache` entry appear, reading works, and manually deleting the `.epub` in Finder makes the book show Missing on next launch.

## A85. A83/A84 verified with a real `/perf report` — ~21x less stall time

User re-ran `/perf report` after relaunching. Confirms the fix, with numbers:

| | before (A83's report) | after |
|---|---|---|
| flip→paint p95 / max | 154ms / 397ms | 31ms / 34ms |
| dropped frames | 7/41 | 2/86 |
| chapter MISS p50 / max | 90ms / **1224ms** | 22ms / **39ms** |
| long frames (count, total time) | 129, **28,395ms** | 14, **1,350ms** |
| stalls = scan? | 65% | 11% |
| write:library | **25,686ms / 37 calls** | gone entirely |
| write/read:reading_progress | — | 569ms/40, 453ms/40 (~14ms avg — the replacement is cheap, as designed) |

Remaining flag (`cache hit rate 20%`) is now cosmetic — a chapter-cache miss costs 22-39ms post-fix vs up to 1224ms before, so it's no longer perceptible. Not chasing further. The CSS-strip-width theory from the original investigation never needed testing — the library.json bloat (A83) was the entire story.

## A84. Reading-progress autosave split out of `library.json`
## A84. Reading-progress autosave split out of `library.json`

Follow-up to A83. Even at a healthy size, `library.json` is one file for the whole library — `persistLibrary()` always rewrites every book's full metadata, no matter which single field changed. ReaderView's position autosave calls that on every settle-after-pause while reading, i.e. constantly — the exact mechanism that turned a 750MB stray field into 37 full-file rewrites in one 10-minute read (A83). Fixing the stray field fixed the size; this fixes the *pattern*, so a future bloat (or just a bigger library) can't reproduce the same cost.

- New root-keyed `reading_progress.json` (`{ [bookId]: {currentChapter, currentPage, updatedAt} }`) — same shape as `nb_index`/`sketches_index`. `patchReadingProgress(id, {...})` writes ONE entry; `loadLibrary()` merges it back onto each book so `book.currentChapter`/`currentPage` reads exactly the same everywhere downstream (LibraryView resume cards, ProfileContent, etc.) — no caller besides ReaderView's own save path had to change.
- New store action `persistBookProgress(id, chapter, page)` — thin wrapper, used in place of `persistLibrary()` for the two autosave call sites (debounced settle + unmount-flush) in `ReaderView.jsx`. `persistLibrary()` itself is untouched and still used everywhere it should be (add/remove/edit book) — those are already infrequent, user-driven, not a perf concern.
- No migration needed / no data loss on upgrade: `reading_progress.json` starts empty, `loadLibrary` only overrides a book's position when an entry exists there, so existing `library.json` positions keep showing until the next time that book is read (at which point the small file becomes authoritative for it).

**Verify:** build green; eslint clean (pre-existing unrelated errors only). **Needs the Tauri app** — read a book, confirm position survives a relaunch, and confirm (via `/perf report` or just watching `reading_progress.json`'s mtime) that reading no longer touches `library.json` at all.

## A83. THE real reader perf villain: a 750MB `library.json`, not the CSS strip

User ran `/perf report` while reading (per the A73-era investigation's resume instructions) chasing the "89% unattributed" reader stall. Report showed something new: `write:library 25686ms/37` — 37 whole-`library.json` rewrites in one 10-minute read (periodic reading-progress autosave), ~694ms average each.

**Root cause:** `books/library.json` was **788,461,556 bytes** (~750MB). One entry — the "Great Expectations" audiobook — was **786,798,456 bytes** on its own: its `audioChapters[]` carried a base64 `dataUrl` per chapter (59 of them), a pre-binary-storage shape from before `writeAudioFile` existed. A73/A75 fixed the *keyed-store* (`audiochap_<id>_<n>`) and the on-disk orphan-folder copies of this same bloat, but never checked whether the **live book object in the `library` array itself** carried the same stale shape — it did, and every `saveLibrary()` call (including the periodic reading-progress autosave, for a *completely unrelated* book) re-serialized and rewrote the whole 750MB file.

**Fix:**
- **Data (live archive, backed up first to `~/Gnos-backups/<ts>-library-bloat-fix/`):** stripped `dataUrl` from all 59 `audioChapters` entries, keeping `title`/`index`/`ext` (derived from the dataUrl's mime where missing). The real audio bytes already live on disk as `chapter_N.mp3` (A73/A75) — nothing lost. `library.json`: 750MB → 1.67MB; the Great Expectations entry alone: 786MB → 4.8KB.
- **Code (`saveLibrary`, storage.js):** now defensively strips any stray `audioChapters[].dataUrl` before writing, same treatment `pdfDataUrl`/`rawDataUrl` already got — so this class of bug can't silently reoccur and balloon the file again.

**Lesson:** A75's "check the oldest legacy shape, don't assume folder-based is the only thing to migrate" needed to extend one level further — to the metadata object itself, not just its keyed-store/on-disk siblings. Next time a migration strips a legacy payload from disk, also check the in-memory/library.json copy of the same object for the same stale shape.

**Not yet re-verified with a fresh `/perf report`** — the CSS-strip-width theory from the same investigation is still untested and may still be a real secondary contributor; this fix targets the dominant cost the report actually surfaced, not everything in the `long frames` bucket.

## A82. History panel — tightened spacing, aligned headings, hint removed

- **Origin hint text dropped.** "Arrived from disk — another app, device, or collaborator"
  restated what the row's coloured label already said. The expanded body now goes straight to
  `+n −n` + Restore, then the diff. (`originOf().hint` is still the row's `title` tooltip.)
- **HISTORY / TODAY / rows share one 14px left edge.** They were at 16 / 12 / 18px. Rows sit
  inside `.nbh-item` (`margin: 0 6px`), so their own padding-left is 8px to land on the same
  edge as the two headings.
- **Vertical spacing tightened throughout:** header `14/14/10/16` → `11/12/4/14`, day heading
  `9/12/4` → `7/14/3`, rows `8/12` → `6/8`, accordion body `10px` → `8px`. The list reads as
  one dense block instead of a loose stack.

**Verify:** build green; measured left offsets — `History` text, `Today` text and the row
chevrons all land at 15px from the panel edge. Screenshotted collapsed and expanded. Seeding
stub **removed and rebuilt (0 occurrences)**.

*(Measurement note: comparing `getBoundingClientRect().left` of an inline `<span>` against a
full-width `<div>` looks like a 14px misalignment when the text is actually flush — compare
text offsets, not box offsets.)*

## A81. History panel polish — full-height expansion, cleaner header

Five fixes from the user's review of A80:

- **Expanded rows show their whole diff.** The inner `maxHeight: 220 / overflow: auto` meant a
  scroll *inside* an accordion inside a scrolling panel — three nested scroll contexts. The
  expansion is now the full height of its content; the panel itself is the only scroller.
- **Header divider removed** — spacing carries the separation. Also removed the rule under the
  list, and re-padded the header (`14px 14px 10px 16px`).
- **Bare close X instead of a boxed button.** The bordered 26px box read as cheap; it is now a
  plain 13px X that turns red on hover.
- **"Current version" row dropped.** It was redundant — nothing is altered unless the user
  explicitly hits Restore, so a row representing "no change" carried no information.
- **Expanded-row layout fixed.** The origin hint shared a row with the `+n −n` counts and the
  Restore button, so it wrapped to two lines and crowded them. The hint now has its own line;
  counts sit left, Restore right.

**Verify:** build green; screenshotted with a seeded timeline — clean header, no dividers, no
Current row, full-height diff, hint on its own line. Temporary seeding stub **removed and
rebuilt (0 occurrences)**.

## A80. History → accordion rows in a header-anchored pop-in

Third pass on the presentation, per the user: *"each history addition sits accordion style —
clicking opens it with the info + restore button. Keep this pop-up inside the header space,
similar to the audiobook chapter pop-in."*

- **Adopts the chapters pop-in language exactly** (`AudioPlayerView`): floating rounded card,
  `right: 8, top: TITLEBAR_H + 6, bottom: 8`, 12px radius, `-8px 0 32px` shadow, uppercase
  section header + matching close button. It now reads as part of the app's existing
  vocabulary rather than a bespoke dialog.
- **Accordion rows.** Each version is a compact row (chevron · origin icon · time · origin
  label). Clicking expands it **in place** to reveal the hint, `+n −n` counts, **Restore**,
  and the red/green diff (max 220px, scrolls). Only one row open at a time; the chevron
  rotates. Version text is fetched lazily on first expand and cached.
- Dropped the separate bottom detail pane entirely — that split was what made the previous
  version feel heavy.
- `TITLEBAR_H` is **inlined as `NB_TITLEBAR_H = 34`**: `App.jsx` exports it but also imports
  `NotebookView`, so importing it back would be circular.

**Verify:** build green; screenshotted with a seeded timeline — day grouping, three origin
types, expanded accordion with diff + Restore, note still readable beside it. Temporary stub
used for seeding was **removed and rebuilt (0 occurrences remain)**.

## A79. History: most external edits weren't recorded + side-panel redesign

**Bug (user: "not for every external edit").** The watcher only snapshotted on the *merge*
branch — i.e. when you had unsaved local edits. The `else` branch, where there are no local
edits and the incoming text is simply adopted, recorded nothing. That is the **common**
external case (you aren't typing; Obsidian or another device saves), so most external edits
never appeared in History. Now both sides of that swap are snapshotted (`local` = your text
before, `remote` = what arrived).

**Origin is now explicit.** `originOf(kind)` in `history.js` maps storage kinds to what a
human actually wants to know first — *was this me, or something outside Gnos?*
| kind | shown as | origin |
|---|---|---|
| `remote` | **External edit** — "Arrived from disk — another app, device, or collaborator" | external (blue, arrow-in icon) |
| `auto` | **You edited** | internal (grey, pencil) |
| `local` | **Your version** — "Your text just before changes arrived" | internal |
| `merge` | **Merged** | merged (green) |
| `pre-restore` | **Before restore** | internal |

**Redesigned as a right-hand side panel** (the modal felt "cheap" because it was the wrong
shape — a centered dialog covers the very note you are comparing against). This follows the
pattern used by Google Docs, Notion, Craft and Dropbox Paper:
- **Note stays visible and readable** on the left while you browse versions.
- Timeline **grouped by day** with sticky `Today` / `Yesterday` / date headers.
- Per-row: origin icon, time, coloured origin label; selected row gets an accent spine.
- **Real diff instead of a raw text dump** — new `diffRows()` (LCS-based) renders green
  additions / red deletions with `⋯ N unchanged lines` collapsing, plus `+n −n` counts and a
  one-line explanation of where the version came from.
- Restore stays the primary action; Esc closes.

**Verify:** build green. Verified visually with a seeded timeline (temporary stub, since real
snapshots need Tauri FS — **stub removed and rebuilt afterwards, 0 occurrences remain**):
day grouping, all three origin labels, and the red/green diff all render correctly against
the live note.

## A78. History: snapshots never fired + panel redesign

**Bug — the panel was correctly empty.** Every `historySnapshot()` call sat inside a
*conflict* path (merge, external change, iCloud copy), so during ordinary editing nothing
was ever recorded. The `auto` kind was specced in `PLAN_CONCURRENCY.md` but never wired.
- **On open:** baseline snapshot of the loaded text, so History always has a recovery point
  instead of nothing until the first tick. Also prunes >7-day entries there.
- **While writing:** periodic `auto` snapshot in `doSave`, throttled to one per 3 min so the
  800 ms autosave can't spam it (`history.js` additionally skips text identical to the last
  snapshot).

**Panel redesign** — the first pass was functional but cheap-looking. Rebuilt:
- **Timeline spine** — connecting rail with colour-coded dots per kind, trimmed at the first
  and last rows so it reads as a true timeline rather than a list.
- **Badges** for kind (`From disk`, `Discarded edit`, `Merged`, `Snapshot`, `Before restore`)
  using `color-mix` tints so they inherit the active theme.
- **Header** gains the clock icon + the note's title as a subtitle.
- **Empty states** with icons and real explanation ("Snapshots are taken as you write, and
  whenever changes arrive from elsewhere. Kept for 7 days.") instead of a bare sentence.
- Backdrop blur, entrance animation, hover states, custom scrollbars, monospace diff counts
  (`+12 −3 vs current`), tinted preview surface, **Esc to close**, taller fixed 520px body so
  the layout doesn't jump between states.

**Verify:** build green; rendered and screenshotted in **both light and dark** themes —
hierarchy, icons, badges and empty states all read correctly. The populated timeline uses the
same primitives but needs real snapshots (i.e. a Tauri run) to see.

## A77. Stage 1 complete — History panel + iCloud conflict-copy merging

**Version History panel** (`NotebookHistoryPanel`) — the retrospective "merge chooser".
Because merges are silent by design, this is where they become visible: `remote` entries are
what arrived from disk/a peer, `local` entries are what a conflict discarded. That audit
trail is what makes silence safe rather than lossy.
- Button in the **right** titlebar zone beside Backlinks (the left zone is hard-capped at two
  buttons — a third overflows into the macOS traffic lights).
- Left rail = timeline (colour-coded by kind, relative timestamps); right = full text of the
  selected version with a `+added / −removed` line count vs current.
- **Restore is non-destructive** — the current text is snapshotted as `pre-restore` first,
  then applied through the existing `applyExternal` path (cursor preserved, card refreshed,
  merge baseline re-based) and flushed to disk.
- Empty state states the 7-day retention explicitly.

**iCloud conflict copies** (`loadNotebooksMeta` self-heal): iCloud resolves its *own* sync
races by writing `Note 2.md` beside the original. Adopting those as new notes silently
duplicated the library — the same class of clutter the fork produced. Now they are merged
back into the original and the copy goes to the OS Trash.
- **Guard:** only treated as a conflict copy when the original (`Note.md`) actually exists in
  the index. A legitimately-named `Chapter 2.md` with no `Chapter.md` is left alone as a real
  note.
- No shared base exists for an iCloud copy, so the two sides are **unioned** rather than one
  being picked; the incoming side is snapshotted to history first.

**Verify:** build green; merge/union and the filename guard table-tested (`Note 2.md` /
`Note 3.md` detected, `Note.md` not, `Chapter 2.md` only when an original exists).

**Stage 1 is now feature-complete.** Remaining before it can be called done: a real
`tauri:dev` run to exercise the two genuinely new filesystem paths —
(1) `appDataDir/history/<noteId>/` directory creation, and (2) the `.md.tmp` → `rename()`
atomic write. Neither can execute in the browser preview.

## A77. Books flattened — `<Author - Title>/{meta.json,content.json,source.pdf,cover.*}` → one flat file

Part 3 of 3 of the file-type flatten (see `PLAN_FLATTEN.md`, A72/A73/A75). Corrected a wrong assumption from the earlier design notes before writing any migration code: `content.json` is a disposable placeholder **only for `format: 'pdf'`** (PdfView renders the real `.pdf` live) — for epub/txt/md it's the **only surviving copy of the book's text**, not a cache. Moving that to `appDataDir` as originally planned would have been real data loss; caught by actually reading `bookImport.js`/`ReaderView.jsx` first.

- `format: 'pdf'` → flat `books/<Author - Title>.pdf` (rescued from a legacy folder or base64-in-library.json, same rescue logic as before, now targeting the flat path); no content.json written for these at all.
- epub/txt/md → flat `books/<Author - Title>.content.json` — every book fully flattens, no folder ever needed (unlike notebooks, which keep a folder for image attachments).
- Cover → shared `covers/<id>.<ext>` (the dir A73 introduced for audio).
- No id→name index — same reasoning as audio: book title isn't user-editable (`EditItemModal`'s book fields are author/rating/tags/description), so the file name is a stable pure function of title+author and every call site's own book object is enough. Two callers needed a one-line fix to actually hold that object: `ReaderView.jsx`'s load effect now passes `activeBook` instead of `activeBook.id` to `loadBookContent`, and `SideNav.jsx`/`LibraryView.jsx`'s book-delete handlers now pass the book as `moveToTrash`'s 4th arg.
- **`moveToTrash('book', …)`** gets the same flat-first branch `moveToTrash('audio', …)` already had.
- **`migrateBooksToFlat()`** replaces `migrateBooksToNamedFolders`. Applies the A75 lesson up front this time: checks the oldest chunked-keyed-store shape (`book_<id>_data`/`_chunks`/`_chunk_N`, which routes to flat `books/book_<id>_*.json` files with no folder at all) unconditionally, not gated on a legacy folder existing. Also stricter than audio's migration — the old folder is only sent to the OS Trash once the flat target is *confirmed* on disk, never unconditionally after just attempting the move.

**Verify:** build green; eslint clean (pre-existing unrelated errors elsewhere in `storage.js`/`LibraryView.jsx`/`SideNav.jsx` from other in-flight work, not touched). **Needs the Tauri app** for the actual migration (preview has no FS/`invoke`) — watch the next real launch: book folders under `books/` should be replaced by flat `.pdf`/`.content.json` files; opening a PDF, opening an epub/txt/md, editing rating/tags/description, and deleting should all keep working.

## A76. Stage 1 of concurrency — silent 3-way merge + invisible history

Replaces both bad options (clobber the file, or fork it into a `(offline edit …)` duplicate)
with **line-level merging**. Design: `PLAN_CONCURRENCY.md`.

**New `src/lib/merge3.js`** — vendored line-based diff3 (no dependency; this project has
been bitten by transitive deps). `merge3(base, ours, theirs)` + `mergeSilently()` policy
wrapper. Line granularity is deliberate: character-level merging of prose produces word
salad. Disjoint edits combine; a true overlap keeps ours and flags that the losing side
needs preserving. 12 unit cases pass (disjoint, identical, one-sided, deletions, appends,
true conflict, realistic note).

**New `src/lib/history.js`** — per-note snapshots in **`appDataDir/history/<noteId>/`**,
never the archive. This is what makes silence safe: *you cannot silently discard an edit
unless the user can get it back*. `snapshot/listVersions/readVersion/restoreVersion/prune`,
kinds `remote|local|merge|auto|pre-restore`, **7-day retention**, restore is
non-destructive (snapshots current first). Note: a `.history/` folder inside the archive is
impossible — leading-dot paths are rejected by the fs scope (A52, the bug that once made 64
notes vanish); appDataDir also means history never syncs to iCloud.

**`storage.js`**
- `contentHash()` (FNV-1a) — change detection no longer trusts mtime alone. **iCloud rewrites
  mtimes on byte-identical syncs**, which is what produced false "changed underneath us"
  conclusions and fed the fork storm.
- `writeTextAtomic()` — temp file + `rename()`, so no reader (or iCloud) can observe a
  half-written note. Falls back to a direct write.
- `saveNotebookContent(nb, content, { baseText })` now merges instead of overwriting, on
  **both** the flat and folder paths, snapshots both sides, writes atomically, stamps
  `contentHash`, and **returns the text actually written**.

**`NotebookView.jsx`** — `doSave` passes `syncedTextRef` as the merge base and adopts the
returned text when a merge changed it (silently). The disk watcher no longer force-saves
over an external change: it merges in place, snapshots both sides, then persists.

**Verify:** build green; 12 merge unit tests pass; end-to-end scenario confirmed — editing
§3 in Gnos while "Obsidian" adds a paragraph to §6 keeps **both**, clean, no prompt, no fork.
Still needs a real Tauri run for the FS paths (history dir creation, atomic rename).

## A75. Audio flatten fix — oldest legacy books (base64-in-JSON chapters) were being skipped entirely

User: *"I don't see how the audiobooks got flattened in my folder, I still see every single chapter in its own json file."* Correct — A73's migration missed an entire legacy shape.

**Root cause:** `audio/` has always had a second, older storage format underneath the per-book folder one: the generic keyed store routes `audiochap_<id>_<n>` / `audiodata_<id>` (base64 `data:` URL strings) to `audio/audiochap_<id>_<n>.json` etc — flat files sitting directly in `audio/`, never inside a per-book folder at all. A73's `migrateAudiobooksToFlat` only looked for the binary chunk-folder shape (`audio/<Name>/chapter_N.<ext>`) and `continue`d immediately for any book with no such folder — silently skipping every book that was still in this oldest format, which is exactly what the user has.

**Fix (`storage.js`):** `migrateAudiobooksToFlat` now handles both shapes per book, independent of whether a folder exists — decodes any `audiochap_<id>_<n>`/`audiodata_<id>` still in the keyed store straight into a real binary file (chunk folder for multi-chapter, flat file for single-track) and deletes the JSON. Guard flag bumped `audio_flat_migrated` → `audio_flat_migrated_v2` so this fix re-runs even though the buggy v1 pass already completed (and would otherwise have been permanently skipped by its own done-flag).

**Verify:** build green; eslint clean (pre-existing unrelated warnings only). **Needs the Tauri app** — watch the next real launch: the individual `audiochap_*.json`/`audiodata_*.json` files in `audio/` should be gone, replaced by real audio chunks/files; playback should keep working for both single-track and multi-chapter books.

## A74. Audio player — chapters panel moved to the right side

User request. Floating chapters `<aside>` (`AudioPlayerView.jsx`) was inset from the left edge; moved to the right — `left: 8` → `right: 8`, shadow flipped (`8px 0` → `-8px 0`), and the `ap-slide-in` keyframe now slides in from `translateX(100%)` instead of `-100%` so it still enters from its own edge instead of sliding in backwards. Verified live in the browser preview (injected a fake audio book into the store, since preview has no Tauri fs) — panel docks flush right with correct shadow direction, rounding, and slide-in animation.

## A72. Sketchbooks flattened — `<Title>_<id>/{meta.json,sketch.json}` → single `<Title>.excalidraw`

Part 1 of 3 of the file-type flatten (see `PLAN_FLATTEN.md`) — sketchbooks/audio/books de-cluttered the way notebooks were in A50/A51/A61. Sketchbooks were the easy case: Excalidraw's own scene JSON already embeds pasted images as base64 in its `files` map, so unlike notebooks there is no "keep the folder for attachments" exception — **every** sketchbook can go flat.

- **`sketches_index`** (root-keyed, mirrors `nb_index`) now holds all sketchbook meta (title, elementCount, coverColor, timestamps) + the flat filename. **Not** a dotfile inside `sketches/` — A52's lesson holds here too: the fs capability scope rejects leading-dot paths.
- `loadSketchbooksMeta`/`saveSketchbooksMeta`/`loadSketchbookContent`/`saveSketchbookContent`/`deleteSketchbookContent` all now check the index first, fall back to the legacy folder scan for anything not yet migrated, and write brand-new sketchbooks straight to a flat file. `moveToTrash('sketchbook', …)` got the same flat-first branch `moveToTrash('notebook', …)` already had.
- **Self-heal**: `loadSketchbooksMeta` adopts any orphan `.excalidraw` file the index lost track of (fresh id minted, same resilience pattern as the notebook self-heal from A52).
- **`migrateSketchbooksToFlat()`** — guarded (`sk_flat_migrated`), atomic (index written and confirmed before old folders go to the OS Trash, never hard-deleted), runs in `useAppStore.js` init right after the existing `migrateSketchbooksToFolders` (super-legacy keyed-store → folder, unchanged; folder → flat is the new second hop).
- `SketchbookView.jsx` untouched — `loadSketchbookContent(id)` / `saveSketchbookContent(sb, data)` call signatures didn't change.

**Verify:** build green; eslint clean (pre-existing unrelated `no-unused-vars` warnings elsewhere in `storage.js` from other in-flight work, not touched). **Needs the Tauri app for the actual migration** (preview has no FS/`invoke`) — watch the next real launch: sketchbook folders under `sketches/` should be replaced by flat `.excalidraw` files, old folders recoverable in the OS Trash; open/edit/rename/delete each still work.

**Next:** audiobooks (partial flatten — single-track only, multi-chapter keeps a folder but drops `meta.json`), then books/PDF (moves the derived `content.json` text-cache out of the archive into `appDataDir`). Full design in `PLAN_FLATTEN.md`.

## A73. Audiobooks flattened — single-track → flat file, covers → shared `covers/`

Part 2 of 3 of the file-type flatten (see `PLAN_FLATTEN.md`, A72). Audio is binary, so unlike sketchbooks it can't fully flatten — a multi-chapter book can't merge its chunks into one file. Key fact that made this simpler than sketchbooks: `library.json` (`loadLibrary`/`saveLibrary`) was **already** the sole meta source of truth for books/audio — the per-folder `meta.json` was pure duplication, never actually load-bearing. And unlike notebooks/sketchbooks, the audio folder/file name is a **pure function of title+author** (`bookFolderName`) and title isn't user-editable for audio (`EditItemModal`'s audio fields are `author/color/image` only) — so no id→name index was needed at all; every call site already hands over the full book object.

- **Single-track (`format: 'audio'`)**: flattened to `audio/<Author - Title>.<ext>` — no per-item folder at all any more, not even transiently (new imports via `bookImport.js` write straight to the flat path from the start).
- **Multi-chapter (`format: 'audiofolder'`)**: keeps its folder (chunks can't merge) but the folder now holds chunks *only* — `meta.json` dropped.
- **New shared `covers/<id>.<ext>`** dir (+ `<id>.thumb.jpg` cache, same thumb strategy as the existing per-folder book covers) replaces the per-item `cover.<ext>` sidecar for audio. `RESERVED_DIRS` already blocked a collection from claiming that name.
- `writeAudioFile`/`readAudioFile` branch on `book.format`; `readAudioFile` falls back to the legacy per-book folder if the flat file isn't there yet (mid-migration safety). `saveAudiobookMeta` now only writes the shared cover (meta itself lives solely in library.json).
- **`moveToTrash('audio', …)`** — this was the one genuinely risky spot: it used to *scan* `meta.json` files to find an id's folder, which no longer exist. Rewritten to resolve the path deterministically from the `bookObj` it's already passed (single-file → flat path or legacy-folder fallback; multi-chapter → chunk folder), so delete can't silently no-op and orphan files on disk.
- **`migrateAudiobooksToFlat()`** — guarded (`audio_flat_migrated`), replaces the old `migrateAudiobooksToFolders` (whose entire job was writing the now-unwanted `meta.json`). Pulls the cover out to `covers/` for both formats, then either promotes the single audio file to flat + OS-trashes the emptied folder, or just strips `meta.json`/the thumb from a multi-chapter folder in place. Runs in `useAppStore.js` init.

**Verify:** build green; eslint clean (pre-existing unrelated warnings only, untouched). **Needs the Tauri app** for the actual migration (preview has no FS/`invoke`) — watch the next real launch: single-track audiobook folders under `audio/` should disappear (replaced by a flat file, old folder recoverable in OS Trash), multi-chapter folders should lose their `meta.json`, covers should show up under `covers/`, and playback/delete should keep working for both formats.

**Next:** books/PDF — moves the derived `content.json` text-cache out of the archive into `appDataDir`, flattens the PDF itself, and reuses the same shared `covers/` dir. Full design in `PLAN_FLATTEN.md`.

## A61. Collections are real folders (one collection per item)

Per the user's spec — *"collections saved in folders named after the collection; library ignores folders and displays all files in the archive"* — and their explicit choice of **true folder semantics** (an item lives in exactly one collection, like a file on disk). Collections were previously virtual (id lists in `collections_meta.json`).

**Index paths are now archive-relative.** `nb_index` entries store `"notebooks/Note.md"` or `"My Research/Note.md"` instead of a bare filename; `_splitIndexPath` / `_resolveIndexPath` resolve them and treat a legacy bare filename as living in `notebooks/` (backward compatible — verified against all four path shapes). Every read/write/rename/delete/asset-base site was routed through the resolver, so a note works identically wherever it is filed.

**New storage helpers:** `getCollectionDir`, `ensureCollectionFolder(name, oldName)` (creates, or renames + `_repointIndexDir` so notes inside follow the rename), `moveNotebookToCollection(id, name|null)` (physically `rename`s the file; collision-safe, never clobbers), `listCollectionFolders()`. `RESERVED_DIRS` protects `notebooks/books/audio/sketches/plugins/trash/covers` from being treated as — or overwritten by — a collection.

**Store:** `addCollection` creates the folder; `updateCollection` renames it; `addToCollection` **removes the item from every other collection** and moves the file; `removeFromCollection` moves it back to `notebooks/`.

**Discovery:** the `loadNotebooksMeta` self-heal now scans `notebooks/` **and every collection folder**, so a `.md` dropped into a collection folder by hand shows up in the library — the "displays all files in the archive" half of the spec.

**Verify:** build green; path-splitting verified incl. legacy/bare/nested; one-collection-per-item confirmed live (adding to a 2nd collection removed it from the 1st). **Needs the Tauri app for the file moves themselves** (preview has no FS): create a collection → confirm a folder appears at the archive root; drag a note in → confirm the `.md` physically moves; rename the collection → folder renames and the note still opens; remove from collection → file returns to `notebooks/`.

**Scope note:** this covers **notebooks**. Books/audio/sketches still live in their type folders — `moveNotebookToCollection` returns false for folder-format items, so nothing breaks, they just don't move yet. Extending to those belongs with the sketches/audio flatten work.

## A71. Conflict-fork DISABLED (per request) + resize grows/tracks + no text wrap

**1. Conflict forking removed.** Duplicates kept appearing, so per the user's instruction the safeguard is gone: both save paths (flat + folder) now simply write our content and `console.warn` when the file had changed underneath, instead of branching it into `<title> (offline edit …)`. `_forkExternalConflict` is retained but unreferenced (marked, so lint stays quiet) in case we want a real merge UI later. **Trade-off, stated plainly:** if a note is edited outside the app while open here, our version now wins and the external edit is overwritten. That is the behaviour asked for; the mtime check still logs when it happens.

**2. Resizing could only shrink.** `_applySize` gives the wrapper the explicit width and makes the image `width:100%` of it — so setting `img.style.width` during a drag could never exceed the wrapper. The drag now sizes the **wrapper**, capped at the line width. Measured: 300 → **500px** (previously impossible).

**3. Handle snapped into place only after the drag.** Same cause — the wrapper (which the handle is anchored to) wasn't resized until commit. Now it moves with the pointer, so the handle stays glued to the corner throughout.

**4. Text no longer wraps beside images.** `left`/`right` used `float`, so body text flowed alongside. Floats dropped in favour of `display:block` + auto margins, in **both** the live editor and `inlineToHtml` (preview/export): an image owns its line, and alignment only decides which side of that line it sits on.

**Verify:** build green. Simulated a real pointer drag: width grew 300→500, handle tracked the corner *during* the drag (within 8px), saved `![PIC|500]`. Alignment confirmed via computed styles — `float: none` on every image, right-aligned pushed by `margin-left:434px`.

## A70. THE duplication cause: stale widget offset corrupted the markdown

The A68 meta-merge fix was necessary but not sufficient — duplication continued after relaunch. The user's file showed why:

```
![The five vowel sounds … maps to eac](images/…_1.svg )
                              ^ lost "h"                ^ stray space inside the parens
```

**Root cause:** `ImgWidget` stores `this.from` — the document offset captured when the widget is built. `updateDOM` deliberately **reuses the existing DOM** (to avoid a remount flash), so the resize/align handlers keep a closure over an *older* widget instance whose `from` is stale the moment anything above it edits the document. Writing back at that drifted offset sliced the markdown mid-token, mangling the alt and the `)`. The corrupted file then no longer matched what the app held → the conflict-fork fired → `(offline edit …)` duplicates. The earlier `:cr|405` corruption was the same bug.

This is also why it looked resize-triggered: resizing is the action that performs the write-back.

**Fixes (`ImgWidget`):**
- New `_livePos(view, wrap)` asks the view where the widget's DOM node *currently* is (`view.posAtDOM`), falling back to `this.from`. Both the resize commit and `setAlign` now use it instead of the captured offset.
- Defence in depth: both handlers refuse to write unless the text at the resolved column literally starts with `![`. A drifted offset can no longer corrupt anything — worst case the edit is skipped.

**Data repair (backup taken first):** removed the stray space inside the image parens, restored the truncated alt (`maps to eac` → `maps to each`); both refs verified to resolve on disk. Retired 2 new fork folders + 1 recreated legacy JSON to `~/Gnos-backups/…-fork-cleanup2` (moved, not deleted).

**Verify:** build green. Drift simulation: a write at a drifted offset is now REFUSED by the guard. Live end-to-end — aligned the **second** image (the offset-drift-prone case), then the first: both alts survived intact ("maps to each"), no stray space, correct per-image alignment.

## A69. Image controls: buttons showed no state, handle drifted off the image

Follow-ups from A67, all in `ImgWidget`:

- **Align buttons looked dead.** They *were* writing correctly (verified: clicking centre saved `![PIC:center|405]` and the image moved) — but the `.active` class was only applied in `toDOM`, and CM6 reuses the DOM through `updateDOM`, so the state never changed. With a subtle move and no button feedback it read as "nothing happened". New `_syncAlignButtons()` (buttons tagged `data-align`) is called from **both** `toDOM` and `updateDOM`.
- **Resize handle didn't follow the image.** A65's fix for zero-intrinsic-size SVGs stretched the *wrapper* to `width:100%`, but the image inside is only as wide as its set width — so the handle (anchored to the wrapper's bottom-right) sat far to the right, and the align bar drifted too. New `_applySize()` gives the wrapper the image's explicit width (image then fills it), used by `toDOM` and `updateDOM`; the two `width:100%` fallbacks now carry `:not([style*="width"])` so they only apply when no width is set.
- `updateDOM` previously set only `img.style.width`, never the wrapper — which is why the controls stayed wherever the image was first laid out.

**Verify:** build green. Measured with a `viewBox`-only SVG at `|405`: wrapper hugs the image at 405px, handle lands on the image's bottom-right corner, align bar sits on the image. Click centre → button shows active + saves `:center|405`; click again → clears to `|405`, width preserved throughout.

**Note on the duplication report:** the A68 meta-merge fix landed after that session's relaunch, so the resize-triggers-duplication observation predates it. Resize dispatches a normal doc change → autosave, which is the same path A68 repaired; needs one clean run to confirm.

## A68. RUNAWAY FILE DUPLICATION — `saveNotebooksMeta` wiped the sync stamp every save

User: *"the SVGs are no longer connected to the file, and we keep duplicating files."* Archive showed `Koine_greek (offline edit …)` ×3 (one even ` 2`), a `Look Here (offline edit …)`, and legacy `notebook_*.json` files reappearing.

**Root cause — a feedback loop:**
1. `saveNotebooksMeta` wrote `JSON.stringify(nb)` — the **in-memory store object** — straight over `meta.json`. That object has no `contentSyncedAt`, so every save **erased the sync stamp**.
2. `doSave` calls `persistNotebooks()` after each save, so the stamp was wiped moments after being written.
3. The next save then read `contentSyncedAt = 0`, concluded "the .md is newer than we last synced", and ran the conflict-fork — creating `<title> (offline edit …)` with a **fresh id**. The app followed the new id, so the next save forked again. Runaway.
4. Forks copy only the `.md`, never `images/` — which is exactly why **the SVGs disconnected**: the live note kept becoming a new folder with no images.
5. The legacy `notebook_*.json` files are the `saveNotebookContent` catch-all fallback firing when the folder path failed — a symptom of the same churn.

**Fixes (`storage.js`):**
- `saveNotebooksMeta` now **merges over the meta.json on disk** instead of replacing it, and explicitly preserves `contentSyncedAt` / `forkedFrom` / `forkedFromTitle` / `adoptedFromDisk` when the store object doesn't carry them.
- **Never fork against an unknown baseline.** Both the folder and flat save paths now require a truthy `contentSyncedAt` before forking. Without a stamp we cannot distinguish an external edit from our own last write, and guessing "external" is what let this run away. No stamp → treat as ours, save, re-stamp.

**Data repair (live archive, backed up first to `~/Gnos-backups/…-forkfix`):**
- **`Look Here/Look Here.md` was 0 bytes** — the fork held the only copy. Restored (888 B).
- Main `Koine_greek.md` contained a corrupted alignment token `:cr|405` (invalid, so it would render as caption text). Repaired to `:center|405`.
- Verified every fork's content against its main, then retired the 4 fork folders + 2 recreated legacy JSONs to `~/Gnos-backups/…-fork-cleanup` (moved, not deleted). `notebooks/` back to 58 flat + 10 folders.

**Verify:** build green; merge + fork-guard logic table-tested — stamp survives a save, no fork when the stamp is missing, genuine external edit still forks. **Watch the next real session**: save a note repeatedly and confirm no new `(offline edit …)` folders appear and `images/` stays attached.

## A67. Image alignment — finished and made usable

Alignment was half-built: the live path parsed `:left|:center|:right` off the alt and `_applyAlign` implemented the CSS, but (a) the suffix was never stripped, so `:center` leaked into the visible caption, (b) preview/export ignored alignment entirely, and (c) there was no way to set it short of hand-editing the alt.

- **`parseImgAlt` now returns `{alt, width, align}`** and strips both suffixes in **either order**, so `caption:center|600` and `caption|600:center` are equivalent; new `composeImgAlt()` is its inverse. A caption containing an unrelated colon (`cap:notreal`) is left untouched. Used by the live path, the legacy `=Nx` fallback, preview/export, and the write-backs.
- **Alignment now survives into preview/export** — emitted as `margin:auto` (center) or `float` (left/right), matching live.
- **Hover controls** (`.cm-img-align-bar`): ⇤ / ↔ / ⇥ buttons on the image, styled like the resize handle. Clicking the active one clears alignment. They preserve width and title, and **resizing preserves alignment** (previously a resize would have clobbered it).

**Verify:** build green; parse/compose table-tested across 8 forms including both orders and the false-positive colon. Rendered live at 1280px: DEFAULT x=48, CENTER x=240 (auto margins), RIGHT floated to x=482 with body text wrapping beside it; zero raw markdown leakage; align bar present on every image; screenshot taken.

## A66. Image resize always broke rendering + blank regions above images

**Why resizing broke images.** The resize handle wrote the width as `![alt](src =600x)`. That is **not valid CommonMark** — a space inside the parens that isn't a quoted title means the whole thing stops being an image, so the markdown parser emitted no Image node and the raw markdown leaked out as text. The live handler *did* read `=(\d+)x`, but it only ran for parser-produced Image nodes, so it could never fire. Confirmed by test: `![SIZED](… =500x)` rendered as literal text.
- Width now lives in the alt, Obsidian-style: **`![caption|600](src)`** — valid CommonMark, so the image still parses. New `parseImgAlt()` splits alt/width; the live path, `inlineToHtml` and the resize write-back all use it.
- **Legacy `=Nx` notes still render**: a fallback pass matches them by regex and builds the widget directly (the parser never will). It defers to any widget the tree already made, and the existing replace-vs-mark reconciliation strips the parser's stray marks — an earlier attempt to splice those out by hand regressed the *other* images, so that was removed.
- `inlineToHtml` also never parsed a width at all, so a resized image broke preview/export too. It now accepts both forms and emits `style="width:Npx"`.
- The write-back was anchored on the line's trailing `)`, which mangled any image with text after it on the same line. It now rewrites the image at the widget's own offset, preserving trailing text and titles (verified on 4 shapes).

**Why the top of the page blanked.** CodeMirror caches the height of every block widget, but an image changes size *after* that measurement — it decodes asynchronously, the A65 no-intrinsic-size fallback widens it, and dragging resizes it live. Nothing told the view, so cached heights went stale and the editor painted blank regions. `ImgWidget` now attaches a `ResizeObserver` to the wrapper that calls `view.requestMeasure()` on any height change, disconnected in `destroy()`.

**Verify:** build green; all three forms render with zero raw leakage — no-width, `|500`, and legacy `=450x` — with the paragraph above them staying visible; screenshot taken. Regex/write-back logic table-tested (widths, titles, trailing text, already-sized).

## A65. The actual SVG bug: markdown IMAGE refs — unresolved relative paths + zero-size SVGs

The reported problem was never a ```svg fence (A60–A64 chased the wrong feature). The user's note contains a markdown **image**:
`![The five vowel sounds…](images/koine_greek_pronunciation_habit_vowel_system_1.svg)`
The grey pill was `.cm-img-err` — the alt text of a **broken image**. Three separate causes, found by reading the real note and the real files:

**1. Relative paths without `./` were never resolved.** `ImgWidget` only handled `this.src.startsWith('./')`. The app's own inserter writes `./images/x`, but markdown written by hand/another tool writes `images/x` — those fell through unresolved, hit the page origin, 404'd, and rendered the alt-text pill. New shared `resolveImgSrc(src, notebookDir)` handles `./images/x`, `images/x`, `x.png` and absolute paths, while passing through `data:`/`blob:`/`http(s):` untouched. Used by both `ImgWidget` sites **and** the HTML renderer (`inlineToHtml`), which previously emitted `src` completely unresolved — so preview/export was broken for every relative image too. `renderMarkdown` gained a `notebookDir` arg (module-level `_imgBaseDir`) rather than threading it through every caller.

**2. The referenced files did not exist.** No `images/` dir in `notebooks/Koine_greek/`, and zero `.svg` files anywhere in the archive or backups — the note's markdown had been generated with image references but the files were never written. Copied the two real SVGs from `~/learning-tutor/images/` into `notebooks/Koine_greek/images/`; both refs now resolve on disk (verified by walking every `![…](…)` in the note).

**3. SVGs with only a `viewBox` render 0×0.** The user's files are `<svg viewBox="0 0 900 480">` with **no width/height attributes**, so they have no intrinsic size; inside `.cm-img-wrap { width: fit-content }` the sizing resolves circularly to **0×0** — the image loads successfully and is invisible. Isolated with a controlled test (no-attrs → 0×0, with-attrs → 600×320) and compared four candidate fixes. Fix: CSS fast-path `.cm-img-wrap:has(.cm-img[src*=".svg"]) { width:100% }` **plus** a general JS safety net — on load, if the laid-out width is <1px, tag the wrapper `.cm-img-nosize` (width:100%, max-height:70vh). The JS net is the one that generalises: it caught a `data:` URL the CSS selector can't match.

**Verify:** build green; measured 0×0 → **684×350** and confirmed visually with a `viewBox`-only SVG in the exact shape of the user's files; screenshot taken. *(Build note: backticks inside a CSS comment terminated the surrounding JS template literal — caught and fixed.)*

## A64. SVG rendered blank with only stray caption text — my sanitiser was destroying it

User: *"the svg is no longer destroying the page but it also isn't rendering correctly"* — screenshots showed an empty block with a small grey pill of text underneath (the diagram's own `<title>`/`<desc>` copy), no graphic.

**Two bugs in `_sanitizeSvg`, both mine:**
1. **It deleted every `<foreignObject>`.** I stripped them wholesale in A60 as a blunt safety measure — but that is exactly where many exported diagrams (and mermaid-style output) keep their *visible content*. Removing it left an empty graphic with only `<title>`/`<desc>` text surviving, which is precisely the reported symptom.
2. **No handling of an XML prolog / DOCTYPE.** Exported `.svg` files routinely begin with `<?xml …?>` and a `<!DOCTYPE svg …>`; feeding that to `innerHTML` parses unreliably.

**Rewritten:** slice out just the root `<svg>…</svg>` (dropping prolog/DOCTYPE/trailing junk), then parse with `DOMParser('image/svg+xml')` and prune dangerous **nodes/attributes** — `<script>` elements, every `on*` handler, and `javascript:` in `href`/`xlink:href` — instead of deleting whole elements by regex. `foreignObject` is preserved with its contents sanitised. Parser errors report cleanly; a parse failure falls back to the old conservative string scrub.

**Verify:** build green; both previously-broken shapes confirmed rendering in a real viewport — an SVG with XML prolog + DOCTYPE + `<title>`/`<desc>` (renders "PROLOG OK", 684×182) and a `foreignObject`-only SVG (renders "FOREIGNOBJECT CONTENT"); screenshot taken. Surrounding paragraphs unaffected.

## A63. Mermaid/SVG render in LIVE mode (A60 was preview-only) + SVG no longer collapses

A60 only taught `blockToHtml` (preview/export) about diagrams. **Live mode is the default view**, and it renders code fences via CM6 decorations, not that function — so a ```mermaid block still showed raw source (user screenshot). The ```svg block "blanked parts of the page".

- **`DiagramWidget` + `_buildDiagramDecos`** (`NotebookView.jsx`): a block widget replacing ```mermaid / ```svg fences in live mode, following the existing `_buildColumnsDecos` pattern (regex over the doc → `Decoration.replace({block:true})`, skipped while the cursor is inside so editing reveals the source). Registered as `diagramDecoField` alongside the task/table/columns fields, and added to the `WidgetType` patch list. Mermaid renders async: `toDOM` returns a placeholder and calls `hydrateDiagrams` on itself.
- **SVG collapse fixed.** My A60 CSS forced `width:auto; height:auto` on the SVG — an SVG with no `viewBox` has *no intrinsic size*, so it computed to **0×0** and the block appeared to blank. Now clamped with `max-*` only, plus `width:100%` on the container, `max-height:70vh` and `contain:paint` so an oversized author SVG can never paint over the page.
- **Mermaid label clipping fixed.** Mermaid measures each label, then emits fixed box geometry; the notebook's own font-size/line-height then cascaded into the SVG and the text no longer fit ("Nouns"/"Verbs" rendered cut off). Pinned the typography mermaid assumes inside `.nb-mermaid svg` and set `foreignObject { overflow:visible }`.
- **Mermaid follows the app theme** — was hardcoded `theme:'base'` (light boxes in a dark notebook). Now picks `dark`/`default` from the measured `body` background luminance, so custom themes work too.

**Verify:** build green; confirmed live in a real 1280×820 viewport — mermaid renders inline between paragraphs (684×224), dark-themed, long labels like "Alphabet & Phonology (YOU ARE HERE)" fully legible; ```svg renders at 684×150 with no collapse and no page takeover; screenshots taken. *(Earlier 0×0 readings in this session were a collapsed preview viewport, not a bug — worth remembering when measuring layout here.)*

## A62. `## Heading` wrong size/colour in live mode — the actual bug

A60 fixed the wrong direction. The real complaint was that **spaced** headings (`## Text`) got the wrong **size and colour** in the live editor; `##Text` was the one rendering correctly.

**Root cause:** heading appearance is owned by the `.cm-lv-hN` **line** classes (carrying `--nb-hN` / `--nb-hN-color`), but `makeHighlight()` also styled `tags.heading1–4` with `fontSize` + `color`. Those tag styles land on a span **inside** the line, so:
- `fontSize: '1.35em'` **multiplied** the line's already-scaled size → 18.9px became **25.5px**
- `color: 'var(--text)'` overrode the heading colour → white instead of the h2 blue

Only *spaced* headings were hit, because `##Text` is not parsed as an ATXHeading and therefore never received the tag styles — exactly why the two forms looked different. (My first measurement missed it: I read the computed style of the `.cm-line`, which was correct; the damage was on the child span.)

**Fix:** heading tag styles keep `fontWeight`/`fontFamily`/`letterSpacing` only — no `fontSize`, no `color`. Line classes are the single source of truth for heading size and colour.

**Also corrected a bug A60 introduced:** the guard `([^\s#].*?)` rejected legitimate content starting with `#` after a space, so `## #1 Priority` stopped being a heading. Regex is now `^(#{1,6})(?:[ \t]+|(?=[^\s#]))(.+?)(?:\s+\{#([^}]+)\})?$` — verified against 12 cases (`## #Hash inside` ✓, `#######Seven` ✗, bare `###` ✗, `{#anchor}` ✓).

**Verify:** build green; measured live — `## H2 spaced` went 25.5px/white → **18.9px/h2-blue**, now identical to `##H2nospace`; h3 likewise.

## A60. Notebook headings without a space + mermaid & SVG rendering

**1. `##Heading` now renders everywhere.** The live editor already accepted a missing space (the no-space heading pass in `makeLivePlugin`), but the preview/export renderers required `\s+` after the hashes — so the same note looked different in the two modes. Changed the three renderer regexes (`blockToHtml`, the `/toc` collector, the live `/toc` widget) to `^(#{1,6})[ \t]*([^\s#].*?)…`. The `[^\s#]` guard keeps a bare `###`, a lone `## `, and a 7-hash line from matching, and `{#custom-anchor}` still works. Verified against 11 cases incl. those edges.

**2. Mermaid diagrams.** A `/mermaid` slash-command existed but nothing rendered its output — mermaid was only present transitively (via `@excalidraw/mermaid-to-excalidraw`). Now: ```mermaid fences render to real SVG. Mermaid is **declared as a direct dependency** (`^10.9.3` — relying on a transitive one is fragile) and **lazily imported on first diagram only** (~1.4MB; it must never touch startup, given the reader-perf work). `blockToHtml` emits a `.nb-mermaid` placeholder carrying the source; new exported `hydrateDiagrams(root)` renders pending nodes after paint (idempotent via `data-rendered`), called alongside `hydrateMathNodes`. Render errors show inline instead of throwing.

**3. Inline SVG.** ```svg fences render the markup, passed through a new `_sanitizeSvg()` first — strips `<script>`, all `on*=` handlers, `javascript:` URLs and `<foreignObject>`, since notes can arrive from outside the archive (sync, external refs). Verified: `<svg onload=… ><script>…` → cleaned.

**4. `vite.config.js`:** added `mermaid` to `optimizeDeps.include`. Without pre-bundling, the dev server transforms mermaid's dependency tree on first use and the first diagram hangs (observed: a >30s stall, then success once pre-bundled — 407ms cold render after).

**Verify:** build green. Live-mode headings confirmed (`# Title`→h1, `## With space`→h2, `##Without space`→h2, `###Deep no space`→h3); regex table verified for all edge cases; mermaid confirmed rendering a real 19-shape SVG in 407ms; sanitiser output checked.

## A59. Attribute the remaining stalls (~89% unexplained) — labelled task timing

Fourth session confirms the earlier fixes and **clears the index build**:

```
flip → paint    p50=22  p95=35   (1/5 dropped)
chapter HIT     5ms      MISS 376ms (was 1111ms)   hit rate 67% (was 20%)
scan layout     p50=16  max=18            ← index build is cheap now
stalls = scan?  6%  (scan 474ms of 8552ms)  ← and NOT the cause
long frames     n=28  p50=291  max=576     ← still the problem
```

Scan (474ms) + chapter loads (~386ms) + React (~112ms) explain only **~11%** of the 8552ms of stall time. Rather than guess a fourth time, added labelled attribution for the rest:

- **`readerPerf.markTask(label, ms)`** + `taskTotals` in the report (total ms per label, biggest first, shown as `other work`). Exposed as **`window.__perfTask`** so modules this file indirectly depends on can report without an import cycle.
- **Instrumented the suspects:** `storage.set` / `storage.get` (labelled per key — `JSON.stringify` of `library.json`/page indexes is synchronous main-thread work, and the reader writes progress on a 400ms/500ms debounce while flipping), and the **notebook disk watcher** (`notebookWatcherTick` — polls the filesystem every 1.5s *per open notebook*, and the archive is on iCloud where a `stat` can be slow).

**Verify:** build green; hook confirmed live in preview against real storage calls → `write:app_prefs 15ms/1 · write:perf_probe 0ms/1 · read:perf_probe 0ms/1`.

**Next run — reproduce a NORMAL setup** (notebook tabs open as usual, not a clean reader-only window) so the real cause shows up. Read the `other work` line: whichever label dominates is the culprit. If nothing does, the stalls are outside JS (image decode / WKWebView compositing) and the next step is a different tool, not more of this one.

## A58. Fix MY A57 regression (prewarm starved → 1111ms chapter misses) + fix the long-frame detector

Third measured session. **Flips are confirmed solid: p50 27ms, p95 32ms, 0/8 dropped** (n=8, bigger sample). **The index build is exonerated** — `scan layout` is now p50 16ms / max 93ms, so A56's throttling worked.

But two problems, one of them mine:

**1. REGRESSION I INTRODUCED IN A57.** Cache hit rate collapsed **100% → 20%**, and chapter misses cost **p50 1111ms**. Cause: A57 made *both* scans defer on `_lastActivity()` (any input incl. `pointermove`). The neighbour prewarm therefore never got its 2.5s quiet window while the user was reading with a hand on the mouse — so it never ran, and every chapter crossing became a full ~1111ms layout. Fix: split the *activity source*, not just the backoff length — prewarm gates on **page turns only** (`_lastNavTime`), the full-book build keeps the presence gate (`_lastActivity()`). Lesson: prewarm must stay responsive *while the user reads*; that is exactly when it earns its value.

**2. My long-frame detector was wrong.** It logged a **207,308ms** "long frame" — that's the window backgrounded/machine asleep, where rAF stops firing, not a stall. It swamped the totals and made the scan attribution read a misleading **1%** (real figure ≈14% once the bogus entry is removed). Fixed: ignore deltas > `SUSPEND_MS` (5s) and any frame while `document.hidden`.

**Verify:** build green; report math re-checked in preview. **Next run** should show cache hit rate back near 100%, chapter MISS rare, and a long-frame max in the hundreds of ms (not minutes) with a trustworthy `stalls = scan?`.

## A57. Flip lag fixed (1211ms → 27ms); stalls now attributed + deferred on user presence

A56 verified — measured before/after:

| | before | after |
|---|---|---|
| flip → paint p95 | **1211ms** | **27ms** |
| flip max | 1211ms | 27ms |
| dropped frames | 2/6 | **0/2** |
| cache hit rate | 100% | 100% (still 5–19ms) |

Flips are fixed. But long frames persisted (17, p50 331ms, max 786ms) in a session with only **2 flips** — revealing the remaining flaw: the scan deferred only on page FLIPS, and a reader spends most of their time *reading*, not flipping. So the index build ran happily while the user sat looking at the page.

- **Attribution (don't guess twice):** `readerPerf.markScanStep()` now times every background scan layout; the report adds `scanLayout` and **`stalls = scan?`** — the % of long-frame time the index build accounts for. If it's high the scan is confirmed; if low, something else is stalling and we look elsewhere.
- **Presence-aware deferral (`Paginationengine.js`):** new `_lastInputTime` fed by passive capture listeners (`pointerdown/pointermove/wheel/keydown/touchstart/scroll`), hooked idempotently from `setupColumns`. The backoff now tests `_lastActivity()` = `max(lastNav, lastInput)`, so the expensive build only runs when the user is genuinely away from the book — not merely between page turns.

**Verify:** build green; attribution math confirmed in preview (synthetic data → `98% (scan 1090ms of 1117ms)`). **Next Tauri run:** `/perf on` → read → `/perf report`. Expect long-frame count to drop sharply; read `stalls = scan?` to confirm the cause. If it reports a LOW % , the index build is exonerated and the remaining stalls are something else (image decode, storage writes) — investigate from there rather than tuning the scan further.

## A56. Reader flip lag — ROOT CAUSE FOUND + fixed (background index build stalled the main thread)

A54/A55's profiling paid off. Real numbers from the user's session:

```
flip → paint    n=6   p50=27    p95=1211  max=1211
dropped frames  2/6
chapter HIT     n=1   p50=5                  cache hit rate 100%
chapter MISS    —
React render    n=24  p50=1     p95=5
long frames     n=23  p50=261   p95=881   max=1202
```

**All three original suspects were WRONG.** Chapter layout is 5ms with a 100% cache-hit rate; React render p95 is 5ms. The killer is the third row: **23 main-thread stalls, median 261ms, max 1202ms** — and the worst flip (1211ms) is almost exactly the worst stall (1202ms). The slow flip *is* a flip that landed inside a background stall.

**Root cause:** the full-book pagination index build (`scanAllChapters`). Each step does `_scanEl.innerHTML = <whole chapter>` then a rect read → a synchronous, uninterruptible multi-column layout of an entire chapter (~261ms). Two guards existed and BOTH failed:
1. `requestIdleCallback(fn, {timeout: 2000})` — the timeout **defeats the purpose**: rIC fires after it *regardless of whether the thread is idle*, so during active reading it fired constantly.
2. The 3s post-nav backoff was checked only at *step start*. Reading a page takes tens of seconds, so the scan reliably woke mid-read; and once a step began, a flip had to queue behind the whole layout.

**Fix (`Paginationengine.js`):**
- rIC timeout 2s → `SCAN_FALLBACK_MS` 30s, so steps wait for **genuine** idle (long backstop still completes the index when the user pauses).
- New `MIN_IDLE_MS` gate: if `deadline.timeRemaining()` says there's no real idle time, reschedule instead of starting a ~261ms layout.
- Post-nav backoff 3s → `SCAN_NAV_BACKOFF_MS` 9s, and **re-checked immediately before** the `innerHTML` (a step can sit queued a long time); on bail it decrements `i` so the chapter is retried, not skipped.
- **Neighbour prewarm keeps a short 2.5s backoff** (`opts.neighborsOnly`) — it's small (radius 2) and is exactly what makes chapter crossings a 5ms cache hit, so it must stay responsive. Only the expensive full-book build gets the long backoff.

**Verify:** build green. **Needs the Tauri app to confirm the win** — re-run `/perf on` → read/flip a minute → `/perf report`. Expect `long frames` count/median to drop sharply and `flip → paint` p95 to fall from ~1200ms toward the ~27ms median. Chapter cache-hit rate should stay high (if it drops, the prewarm backoff is too long).

## A55. `/perf` commands — reader profiling without devtools

User reports that **opening the inspector blanks the whole app window** outside the devtools pane (WKWebView repaint failure on webview resize — this codebase has prior form: see the `.book-cover` comment in global.css about WKWebView rendering skipped subtrees blank). Not reproducible in the Chromium preview, and it blocked A54's profiling, so the profiler no longer needs devtools at all.

- **`readerPerf.js`:** `report()` now ALSO (a) renders an **in-app overlay** (fixed, bottom-right, metrics table + verdict + close button) and (b) writes `reader_perf_report.json` to the archive root via `setJSON` — so results are readable on screen and off disk. New `gnos:perf-cmd` window listener drives on/report/off.
- **`LibraryView.jsx` SearchDropdown:** typing `/perf` in the search bar lists **/perf on · /perf report · /perf off**, each dispatching `gnos:perf-cmd`.
- **`App.jsx`:** imports `@/lib/readerPerf` at app level so the API + listener exist before ReaderView mounts (still inert until `on()`).

**Verify:** build green; verified live in preview — `/perf` rows render in the titlebar search, `report` draws the overlay with real stats + verdict, `off` clears it. Metrics still need the Tauri app + a real book.

**NOTE — the blanking bug itself is NOT fixed** (diagnosed, not reproducible outside WKWebView). Prime suspects: heavy `backdrop-filter` usage (notorious for WKWebView repaint bugs on resize) and/or huge compositor layers (the reader strip is ~70,000px wide). Worth its own pass; the `/perf` route means it no longer blocks the reader work.

## A54. Reader page-flip profiling instrumentation (diagnostic only)

User reports book page-flips lag vs other e-readers. Rather than guess-optimise a 636-line pagination engine, added opt-in profiling to find the dominant cost. **No behaviour change** — every hook is a no-op until enabled (one boolean check per flip).

- **`src/lib/readerPerf.js` (new):** `markFlip` (input → actual painted frame, via double-rAF; flags >32ms as a dropped frame), `markChapterStart/End` (chapter layout time + **cache hit/miss**), `markRender` (ReaderView render pass), plus a long-frame observer (>50ms main-thread stalls). `report()` prints a console table with p50/p95/max and a **verdict** naming the likely bottleneck.
- **`ReaderView.jsx`:** `markFlip` in `flipTo`; chapter timers around BOTH the cache-hit and cache-miss branches of the chapter-render effect; render timer at the top of the component paired with a `useLayoutEffect`.

**Three suspects it distinguishes:** (1) CSS multi-column lays out the ENTIRE chapter at once (no virtualization) → long chapters stall on entry; (2) chapter crossings that miss the prewarm cache do a full synchronous layout+measure; (3) every deliberate flip's `setCurPage` re-renders the whole 2,690-line view.

**Usage (in the Tauri app's devtools console):** `__readerPerf.on()` → read/flip normally for a minute, crossing chapters → `__readerPerf.report()` → `__readerPerf.off()`.

**Verify:** build green; API confirmed live in preview (`on`/`report`/`off`, all metric keys present), off by default. Real numbers need the Tauri app with a real book.

**Revert:** delete `readerPerf.js`, its import, the 5 call sites.

## A53. External file references + pin, and a re-foldering bug fix

**Re-foldering bug (fixed):** `migrateNotebooksToFolders` runs every launch and unconditionally created a folder+meta.json for every notebook — so after the A51 flatten it **re-created 69 folders**, un-flattening on each relaunch. Now it skips any note already in the flat index or present as an on-disk flat `<Title>.md`, and only folds notes that genuinely have legacy flat-JSON and no folder. Cleaned up the 59 dup folders it had made (→ `~/Gnos-backups/…-refolder-dups`); verified 0 content loss. `notebooks/` = 64 flat + 9 folders.

**External file references** — edit a `.md` that lives OUTSIDE the archive (a download, an Obsidian vault); never copied in, reads/saves hit the original absolute path.
- **`storage.js`:** `loadExternalRefs`/`saveExternalRefs` (root `external_refs.json`, pinned only), `readExternalFile`. `loadNotebookContent`/`saveNotebookContent`/`getNotebookMdPath` handle `ext_…` ids by resolving the ref's absolute path — save writes straight back + updates the ref's derived title.
- **store:** `externalRefs` slice (add/remove/pin/update/persist) + `openExternalFile()` (dialog → `.md` → transient ref → open in a notebook tab). Loads pinned refs at init.
- **NotebookView:** `doSave` detects external notes → writes the file, updates the ref title, skips all notebook-meta/folder/wikilink work. Watcher (live external-edit sync) works via `getNotebookMdPath`.
- **UI:** sidebar **EXTERNAL** section (pinned refs persist; unpinned dimmed, this-session only; right-click Pin/Unpin/Remove) + "Open File…" row; "Open File…" also in the Add menu.

**Verify:** build green; wired end-to-end in preview (inject ref → sidebar EXTERNAL shows it → click opens as an `ext_` notebook, no crash). **Real read/write/live-sync needs the Tauri app** (preview has no FS/dialog): Add → Open File… → pick a `.md` anywhere → edit → saves write to the original path; right-click → Pin to keep it in the sidebar; edit the file externally → live-syncs in.

**Revert:** drop the external-ref storage helpers + `ext_` branches; the store slice + `openExternalFile` + init load; the NotebookView `doSave` external branch; the SideNav EXTERNAL section + Add-menu entry. Re-foldering fix: restore the old unconditional `migrateNotebooksToFolders` loop.

## A52. Flatten HOTFIX — index write failed (dotfile scope) → notes vanished; recovered

**Bug:** A51 stored the central index as `notebooks/.index.json`. The fs capability scope (`/**`, `$HOME/**`) rejects a **leading-dot** path, so every `writeTextFile('.index.json')` failed silently (caught → returned false). The migration then went on to trash the source folders anyway (no atomicity), so 64 flat `.md` files were written but their id→metadata map was lost → those notes disappeared from the library. (Plain `Name.md` writes and root `setJSON` files were unaffected — only the dotfile.)

**Fixes (`storage.js`):**
- **Index → root keyed storage.** `loadNotebooksIndex`/`saveNotebooksIndex` now use `getJSON/setJSON('nb_index')` → archive-root `nb_index.json`, the same proven-writable pattern as `flashcard_decks.json`. `notebooks/` stays pure markdown. Dotfile approach removed.
- **Atomicity.** `migrateNotebooksToFlat` now aborts (keeps folders, doesn't set the done-flag) if the index doesn't persist — never trashes a source before its replacement is safely saved.
- **Self-heal.** `loadNotebooksMeta` adopts any top-level flat `.md` not referenced by the index (mints a fresh id, writes it back) — a flat note can never be invisible again even if the index is lost.

**Data recovery performed (this session, on the live archive):**
- Rebuilt `nb_index.json` (64 notes) from the backup's `meta.json` files, matched to the flat files by name + content hash (0 unmatched).
- Reconciled leftover folders: 5 content-identical dup folders + 4 empty stale folders → recovery dirs under `~/Gnos-backups/`. 3 folders with unique content whose id was shadowed by a **pre-existing duplicate-id** collision (notably `CFM Lesson`, 5252 B) were rescued — given fresh ids so they load as their own notes. 2 attachment folders kept.
- **Verified: 0 non-empty notes from the backup are missing live.** Final `notebooks/` = 64 flat `.md` + 5 folders; `nb_index.json` at root.

**Verify:** build green; preview boots clean. On next `tauri:dev` launch all notebooks (flat + folder) should appear; `nb_index.json` persists metadata; open/edit/save/rename/delete work. Backups: `~/Gnos-backups/20260816-074818` (original), plus `-stale-folders` / `-empty-stale` recovery dirs.

## A51. Flatten step 2 — notes are single `.md` files + one hidden index (SHIP-UNVERIFIED)

Per-note folders (`Name/Name.md` + `meta.json`) → **flat pure-markdown `notebooks/Name.md`**. All app metadata (id, cover, createdAt, wordCount, dueDate, tags, order) lives in ONE hidden `notebooks/.index.json` keyed by id. A note becomes a folder ONLY when it has image attachments. Chosen over YAML frontmatter (which would clutter the file body).

**storage.js:**
- Index helpers: `loadNotebooksIndex()` / `saveNotebooksIndex()` / `_patchNbIndex` / `_removeNbIndex`; `_flatFileName` (collision-safe `Title.md`); `getNotebookMdPath(note)` (exact .md path — flat file or folder).
- `migrateNotebooksToFlat()`: converts plain folder-notes → flat file + index entry, then sends the **old folder to the OS Trash** (reversible, never rm). Notes with `images/` or a `coverImage` file stay folders. Guarded by `nb_flat_migrated`; crash-resumable (skips ids already in index).
- All read/write paths made flat-aware **and backward-compatible** (still read folders, so a partial/failed migration never blanks the library): `loadNotebookContent` (index first), `loadNotebooksMeta` (merges index notes, refreshes ones edited externally), `saveNotebookContent` (flat fast-path with conflict-fork; NEW notes are flat), `saveNotebooksMeta` (flat branch → index, renames flat file on title change), `getNotebookFolderPath` (flat → notebooks dir), `moveToTrash`/`deleteNotebookContent` (trash the flat file + drop index entry), `saveNotebookImage` (promotes a flat note to a folder on first image).
- Wired `migrateNotebooksToFlat` into store `init()` after `cleanupLegacyNotebookFiles`.

**NotebookView.jsx:** md-path resolution (watcher baseline + post-first-save) now uses `getNotebookMdPath(note)` instead of scanning the folder (a flat note's "folder" is the whole notebooks dir).

**Verify (SHIP-UNVERIFIED — no FS in preview; boots clean, seed library renders, no new console errors):** on next `tauri:dev` launch, console logs `Removed 84 legacy…` then `Flattened N notebook(s) → single .md files`. Then: `notebooks/` should hold ~70 flat `Name.md` + hidden `.index.json` + 2–3 attachment folders; old folders in macOS Trash; all notebooks still in the library; open/edit/save, rename (file renames), new note (created flat), delete (flat file → Trash) all work.

**Rollback (backup `~/Gnos-backups/20260816-074818`):** quit app → `rm notebooks/.index.json`, restore `notebooks/` from backup. Migration won't re-run (`nb_flat_migrated` set); folders load via the backward-compat path. To retry, also clear the `nb_flat_migrated` flag.

**Revert (code):** drop the index helpers + `migrateNotebooksToFlat` + `getNotebookMdPath` + all flat branches; restore folder-only `saveNotebookContent`/`saveNotebooksMeta`/`loadNotebookContent`/etc.; revert NotebookView to `resolveNotebookMdPath`; drop the `init()` call.

## A50. Notebooks de-clutter (flatten step 1) — remove legacy junk

Diagnosed the archive's `notebooks/` mess (user: "storage is a nightmare"). 160 entries = **73 real notebooks** (folder + meta.json + .md) buried under junk: **75 legacy `notebook_*.json`** flat files (old pre-folder format — 53 dupes of existing folders, 9 empty, 13 abandoned orphans the user chose to drop) + **9 empty stray folders** (4 blank test notes + 5 root-name dirs `books`/`sketches`/`trash`/`plugins`/`notebooks` from an old base-dir bug) + `.DS_Store`.

- **`storage.js` `cleanupLegacyNotebookFiles()`** (new): one-shot startup migration (guarded by `nb_legacy_cleaned` flag). Removes `notebook_*.json` files and any notebooks/ subfolder that has NEITHER `meta.json` NOR a `.md` (so real notebooks are never touched). Everything goes to the **OS Trash** (recoverable) via the `move_to_trash` command. Wired into store `init()` after `cleanupTrash()`.
- Selection dry-run on the real archive: **84 junk → trash, 73 notebooks kept** — verified exact.
- Backup taken first: `~/Gnos-backups/20260816-074818` (verified == live).

**Revert:** drop `cleanupLegacyNotebookFiles` + its `init()` call + the import.

**Verify:** build green; selection dry-run confirmed. **Runs in the Tauri app on next launch** — check console for "Removed 84 legacy notebook junk file(s) → OS Trash", confirm `notebooks/` now holds 73 folders + nothing else, and the junk sits in macOS Trash. All 73 visible notebooks remain in the library.

**DEFERRED — flatten step 2 (folder → flat `Name.md` + `.index.json`):** the structural conversion (drop per-note folders/meta.json for pure-markdown files) rewrites `saveNotebookContent`/`loadNotebooksMeta` — the SAME functions the other chat just rewrote for A46 conflict-fork. Doing both concurrently risks a corrupt merge on live iCloud data, and it can't be runtime-verified from preview (no FS). Held for a focused pass once A46's storage.js edits settle. Design unchanged: central hidden `.index.json` (id/cover/createdAt), folder only when a note has image attachments.

## A49. Sidebar nav — correct cover colors + reveal open file in place

- **Cover colors** (`SideNav.jsx` `MiniCover`): the sidebar thumbnail defaulted uncoloured items to a single near-black `#1a1a2e`, while the library cards default notebooks to `#2d1b69`, sketchbooks `#0d5eaf`, decks `#7a3b8f`. So a note with no `coverColor` showed black in the sidebar but purple in the grid. Default now branches per type to match the cards. Verified in preview: notebook rows `rgb(45,27,105)`, sketchbook `rgb(13,94,175)`.
- **Reveal open file in place** (`SideNav.jsx` `NavDropdown`): opening the sidebar while editing a file only highlighted the active row — if it was scrolled off, the user had to hunt for it. Added a `scrollRef` + effect that `scrollIntoView({block:'nearest'})` on the active row when the list mounts (section auto-expands on open) or the sidebar re-opens (`revealSignal={sideNavOpen}`). Uses `CSS.escape` on the id.

**Revert:** restore `MiniCover` single `#1a1a2e` default; drop the `scrollRef`/reveal effect + `revealSignal` prop.

## A48. Delete actually deletes — to the OS Trash, not an in-archive folder

Deleting an item wasn't removing its files. Two bugs + a UX complaint:
1. **Sidebar delete skipped disk entirely** — `SideNav.jsx` notebook/book/audio "Delete" called only `removeNotebook`/`removeBook` (state), never `moveToTrash`. Files stayed; notes resurrected on next launch via `loadNotebooksMeta` (folder scan) + `syncNotebooksFromDisk` orphan-adoption.
2. **Even the working path only *moved* files** into `<archive>/trash/` for 7 days — still sitting in the user's Gnos folder.

Now delete goes to the **operating-system Trash** (recoverable in Finder, genuinely gone from the archive):
- **Rust:** new `move_to_trash(paths: Vec<String>)` command (`src-tauri/src/lib.rs`) using the `trash` crate (Cargo dep added), registered in `generate_handler!`. Skips non-existent paths, returns what it trashed. `cargo check` green.
- **`storage.js` `moveToTrash`** rewritten: locate the item's content folder by id, `invoke('move_to_trash', {paths:[folder]})`. Fallback if the OS move fails: strip `meta.json` (`_stripMeta`) so it can't resurrect. Dropped the in-archive trash dir + manifest writing. Audio keyed-store payload cleanup kept.
- **Wired every delete path:** `SideNav.jsx` notebook/book/audio/sketchbook now `await moveToTrash(...)` before removing from state; `LibraryView.jsx` card menus already did.
- **Legacy cleanup:** `getTrashDir` no longer *creates* `<archive>/trash` (it was being recreated empty on every load = clutter). `cleanupTrash` now one-shot **migrates** any leftover `<archive>/trash/*` to the OS Trash and removes the empty dir on startup. `loadNotebooksMeta`'s trash-manifest filter guards on `exists`.

**Revert:** remove `move_to_trash` (lib.rs + Cargo `trash` dep + handler line); restore old `moveToTrash` (in-archive trash dir + rename + manifest) and `getTrashDir` mkdir + old `cleanupTrash`; revert the four SideNav delete actions to state-only.

**Verify:** `cargo check --lib` green ×3; `vite build` green. **Needs the running Tauri app** (browser preview has no `invoke`/FS): delete a notebook from BOTH the sidebar menu and a library card → folder leaves `notebooks/` and lands in the macOS Trash → relaunch, it stays gone (no resurrection). On startup the two legacy `<archive>/trash/` stragglers should move to the OS Trash and the `trash/` folder disappear.

**NOTE (next):** metadata re-architecture — flatten the 162 per-note folders to pure-markdown `Name.md` with a single hidden `.gnos-index.json` (id/cover/createdAt), no sidecars, no folder unless attachments. Chosen over YAML frontmatter (which would clutter the file body). Deferred: needs a full backup + dry-run and coordination with the other chat's in-flight `storage.js` (conflict-save) work. External-file references (open/edit any `.md` in place + pin to sidebar) also pending.

## A47. Heading fold arrows moved to the left gutter + collapsed-state fix

Fold chevrons were **inline**, replacing the hidden `#` marks, so each heading's text started shifted right by the arrow's width and the arrows never lined up (deeper headings sat further in). Now they're parked in the left gutter:

- **`NotebookView.jsx` CSS:** `.cm-fold-arrow` → `position: absolute; left: -22px; top:0; bottom:0` (16px wide, vertically centered on the heading line). Foldable heading lines (`.nb-live .cm-line.cm-lv-h1…h6`) get `position: relative` to anchor it. Rotation moved from the button to the inner `<svg>` (`.cm-fold-arrow-open svg { rotate 90 }`) so the absolute box is free. `@media (max-width:640px)` pulls it in to `-18px`. Result: every heading's text left-aligns with the body text and the arrows form one consistent gutter column regardless of level.
- **Collapsed-state fix (found while testing):** the live ViewPlugin only rebuilt decorations on `docChanged || selectionSet`; a fold/unfold changes neither, so the chevron stayed pointing "open" after a section collapsed. Added a `foldChanged` check (`upd.transactions.some(tr => tr.effects.some(e => e.is(foldEffect)||e.is(unfoldEffect)))`) to the update condition; `foldEffect`/`unfoldEffect` now destructured from `cm.language` in `makeLivePlugin`. Chevron now flips right⇄down correctly.

**Revert:** restore the old inline `.cm-fold-arrow` rule (inline-flex, `margin-right:3px`, button-transform rotate); drop the heading-line `position:relative` block and the media query; remove `foldChanged` from the update condition and the `foldEffect,unfoldEffect` destructure.

**Verify:** build green; verified live in preview — three headings' arrows sit in one gutter column at the same x, heading text aligns with body text; real click on a section folds it AND the chevron flips to point right, sibling stays down; no new console errors (only the expected Tauri-runtime-missing `invoke`/`transformCallback` preview noise).

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
