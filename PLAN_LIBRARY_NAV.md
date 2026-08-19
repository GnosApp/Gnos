# Plan — Library nav v2: single accordion, bigger, click-to-expand

Handoff doc. Supersedes part of A99 (see `UI_CHANGES.md`) based on live user
feedback after seeing it running. Do NOT re-derive A99's reasoning from
scratch — read the A99 entry in `UI_CHANGES.md` first, then this doc for what
changes on top of it. Memory: `project_library_nav.md` in the user's Claude
memory dir has the same pointer.

## Context

A99 flattened the sidebar so every collection sat as a **direct sibling** of
Books/Audiobooks/Notebooks/Sketchbooks/Flashcards, all under one "Library"
section label — reasoning: fewer expand-steps to reach a collection. Live
testing showed this reads wrong: "Library" itself needs to be the outer
accordion, with the type-folders + collections nested **inside** it as
children, not loose siblings next to a label. This plan reverses that one
piece of A99's structure while keeping everything else A99 built (the header
filter/sort buttons, Sketchbooks as its own type-folder, the flat
collection-workspace view, the size-down direction).

Also new in this round: quicknotes should look like a type-folder, not a
user collection; sizing needs to come back up; and the click/expand
interaction model needs to invert.

## Requirements (verbatim intent from the user)

1. **Single top-level accordion.** The sidebar's "Library" row becomes the
   one parent. Books, Audiobooks, Notebooks, Sketchbooks, Flashcards, a
   Quicknotes folder, and every user collection all live **nested inside**
   it, indented to show they're children — not flush siblings under a bare
   "Library" label the way A99 left it. Library starts expanded by default.

2. **Quicknotes reads as a type-folder, not a collection.** Under the hood
   `quicknotes` is a real entry in `collections_meta.json` (auto-managed
   since the A61-era `addToQuickNotesCollection()` in `storage.js`) holding
   `.md` files — that data model does NOT change. Only the sidebar's
   *visual* treatment changes: give it the same row styling as
   Books/Audiobooks/Notebooks/Sketchbooks/Flashcards (plain folder icon,
   same row component/sizing), not the colored-dot/emoji + item-count
   styling `renderCollection()` gives ordinary user collections. Simplest
   approach: special-case the collection literally named `quicknotes` (or
   better, thread through its real id if one is fixed/known) to render via
   the type-folder row style, positioned right after Flashcards, and
   exclude it from the ordinary `renderCollection()` sweep so it doesn't
   also show up twice down in the regular collections list.

3. **Bigger — A99's 25% shrink overshot.** User: "Make everything slightly
   bigger please, it's too small." Come back up from A99's sizing — do not
   just revert straight to pre-A99 numbers, aim roughly midway (or iterate
   live with the user) since pre-A99 was the size they wanted denser in the
   first place. Every place A99 touched needs revisiting:
   `.sidenav-nav-item` (padding/font/gap), `NAV_ITEMS` icon `size` props,
   `NavDropdown` row (padding/fonts/Ellipsis button/format tag),
   `MiniCover` (width/height), collection-row padding/fonts/icons,
   `ChevronIcon`. Pre-A99 and current A99 values are both in the A99
   changelog entry and in git history for exact before/after numbers.

4. **Click = expand, not navigate/filter.** Right now (`SideNav.jsx`,
   `handleNavItem()` ~line 1630) clicking a nav row does
   `navigate({view:'library', activeLibTab:id})` (+ resets `libSubFilter`),
   and there's a **separate** small chevron button (`toggleExpanded()`
   ~line 1643) that does the accordion open/close. User wants this
   inverted for Library/Books/Audiobooks/Notebooks/Sketchbooks/Flashcards:
   - **Plain click anywhere on the row** → toggle expand/collapse only
     (today's chevron-only behavior, now on the whole row).
   - **Cmd/Ctrl+click** → today's `handleNavItem()` behavior (navigate +
     apply the type filter / jump to that tab).
   Implementation sketch: in the row's `onClick`, branch on
   `e.metaKey || e.ctrlKey` — if set, call `handleNavItem(item.id)`; else
   call the same toggle logic `toggleExpanded` already does (can now retire
   the separate small chevron button as a *click target*, but keep the
   chevron **glyph** visible as a pure visual affordance/indicator of
   open state — don't remove the visual cue, just stop it being a second
   redundant click target).
   Decide alongside this: should the same modifier-click convention apply
   to individual **collection** rows (`renderCollection()`'s click handler,
   currently plain-click = toggle-only, no navigate action exists there
   today) and to items inside a folder? Likely no change needed there
   (items already open on click, collections already toggle on click) —
   just confirm no regression.

5. **Visual indent for the nested tree.** Type-folders + quicknotes-folder +
   collections all sit indented under "Library" (per #1) — items within
   each folder indent further still, same as today's `NavDropdown`
   left-padding pattern. Should read like a real Finder disclosure tree:
   Library › (indent) Books/Audiobooks/…/Quicknotes/Collection A/
   Collection B › (indent again) individual files.

6. **Collection workspace: remove the duplicate identity bar.** When
   `activeCollectionId` is set, `LibraryView.jsx`'s main-content
   `<header className="app-header">` (~line 3542, the "Workspace indicator
   + active filter badge" block, ~3547 `activeCollectionId && (() => {...
   col.name ...})`) renders a small chip showing the active collection's
   name + a close (✕) button. User: that's redundant once the sidebar
   already shows which collection is active (via A99's workspace flat-view
   header row, or the footer `CollectionSwitcher`) — remove this
   content-area bar when a collection is active. Confirm what (if
   anything) should replace the ✕-to-exit affordance it carried — likely
   nothing needed since Home/sidebar already exits the workspace, but
   check no dead functionality is lost (e.g. is this the ONLY visible
   "leave collection" control on some layout/window size?).
   The `typeFilter !== 'all'` badge in that same block is a **separate**
   concern (not what the user is asking to cut) — leave it as is unless
   it's now doing something confusing given point #4's interaction change.

7. **Drop a redundant "Library" + "folder" text label.** User: "That
   library text that subsequently says folder is not needed... adds visual
   clutter." **Not pinned down precisely in this handoff** — the
   screenshot describing it didn't fully come through in the source
   conversation, and it does not obviously match any current
   `sidenav-section-label` string (`"Library"` / A99's
   `{activeCollectionId ? 'Collection' : 'Library'}`) or any string
   literally containing "folder" found in a repo-wide check at hand-off
   time. **Before implementing this one:** ask the user for a fresh
   screenshot of the specific text (or have them point at it live), find
   the exact element, then remove/simplify it. Don't guess and delete the
   wrong label.

## Explicit undo from A99

- Revert the "flatten Collections to be siblings of the type buckets"
  structural change (A99 point 2) — collections go back to nesting under a
  single parent, but that parent is now literally "Library" itself (not a
  separate intermediate "Collections" bucket like pre-A99, and not flush
  siblings like A99 shipped). Net new structure:

  ```
  Library (expanded by default, click = toggle, ⌘/Ctrl+click = navigate)
    Books
    Audiobooks
    Notebooks
    Sketchbooks
    Flashcards
    Quicknotes            ← folder-styled, not collection-styled (#2)
    Collection A
    Collection B
    …
  ```

  All of these are indented one level under Library; each one's own
  contents (files, or nested sub-collections) indent one level further,
  same as today.

- Keep from A99 as-is: the two header buttons (`TypeFilterBtn`,
  `SortFilterBtn`) in `LibraryView.jsx`; Sketchbooks as its own row (now
  nested rather than a flat sibling, but still a distinct type-folder);
  the collection-workspace flat-item-list behavior (sidebar shows one flat
  list under the active collection's name) — only the redundant identity
  *bar in the main content header* goes away (#6), not the sidebar
  workspace view itself.

## Suggested order of work

1. Sizing pass (#3) first — quick, low-risk, unblocks visually judging
   everything else at the right scale.
2. Nesting restructure (#1) — wrap the type-folder rows + collections
   render back under a single "Library" parent row with its own expand
   state, indent children.
3. Quicknotes visual special-case (#2).
4. Click/expand interaction inversion (#4) — do after #1 so there's one
   consistent row component to wire the modifier-click logic into, not
   two.
5. Content-header collection bar removal (#6) — isolated, `LibraryView.jsx`
   only.
6. Confirm-then-fix the "Library…folder" text (#7) — needs a fresh
   screenshot/confirmation from the user first.

## Files

- `src/components/SideNav.jsx` — `NAV_ITEMS`, `handleNavItem`,
  `toggleExpanded`, the Library-section render block (~2126-2370 as of
  A99), `renderCollection()`, `.sidenav-nav-item`/`.sidenav-nav-expand`/
  `NavDropdown`/`MiniCover`/`ChevronIcon` sizing.
- `src/views/LibraryView.jsx` — `TypeFilterBtn`/`SortFilterBtn` (keep
  as-is), the `app-header` workspace-indicator block (~3542+).
- `UI_CHANGES.md` — log this as the next `A1xx` entry once implemented
  (check the current highest number first, other chats may have added
  entries since A99).
- Memory: update `project_library_nav.md` when done; it currently only
  describes A99.

## Verification

Same pattern as every other entry this project's `UI_CHANGES.md` uses:
`npx eslint` clean (watch for the ~2 pre-existing unrelated errors from
another concurrent chat's in-flight work — confirm current line
numbers/messages match before assuming any new error is pre-existing),
`npx vite build` green, then a live check in the running Tauri app since
this is pure UI — screenshot or have the user confirm: Library expanded by
default with everything nested inside, Quicknotes reads as a folder not a
collection, sizing feels right, plain click expands / ⌘-click navigates,
collection workspace has no duplicate identity bar.
