# Plan FLATTEN — flatten sketchbooks/audio/books like notebooks (2026-08)

**Status: all three done** (sketchbooks A72, audio A73/A75-fix, books A76).
None runtime-verified beyond audio (user confirmed on real data + one manual
cleanup of an orphaned legacy duplicate, see A75). Watch the next launch for
sketchbooks and books.

User wants sketchbooks (excalidraw), audiobooks, and books (e-reader/PDF)
flattened the same way notebooks were (see A50/A51/A61 in UI_CHANGES.md):
fewer files, no redundant per-item `meta.json` where a central index can hold
it instead. Archive lives on iCloud — each step gets its own backup +
migration + verify pass, never a single mega-migration.

Key fact that shapes all three: `library.json` already centrally indexes
books+audio meta (`loadLibrary`/`saveLibrary`, storage.js). Per-folder
`meta.json` there is redundant duplication, not source of truth. Sketchbooks
had no such index — closer to notebooks pre-flatten.

## 1. Sketchbooks — DONE (this session, → A72; renumbered from A69 to dodge a collision with another concurrent chat's A69/A70/A71 in `storage.js`)

Same shape as notebooks flatten. `sketches/<Title>_<id>/{meta.json,
sketch.json}` → flat `sketches/<Title>.excalidraw` (Excalidraw's own scene
JSON, embeds pasted images as base64 in its own `files` map — no assets dir
ever needed, so **every** sketchbook can flatten, unlike notebooks which keep
a folder when there are attachments) + central `sketches_index` (root-keyed,
NOT a dotfile — A52 lesson: leading-dot paths are rejected by the fs scope).

- `loadSketchesIndex`/`saveSketchesIndex`/`_patchSkIndex`/`_removeSkIndex` —
  mirrors `loadNotebooksIndex` etc.
- `loadSketchbooksMeta` — index entries + legacy folder scan (skips ids
  already in the index) + orphan `.excalidraw` self-heal (adopts a file the
  index lost track of, fresh id, same spirit as the notebook self-heal).
- `saveSketchbooksMeta`/`saveSketchbookContent`/`loadSketchbookContent`/
  `deleteSketchbookContent` — flat-index path first, legacy-folder fallback
  second, brand-new-item-goes-flat third. `moveToTrash('sketchbook', …)` gets
  the same flat-first branch `moveToTrash('notebook', …)` already had.
- `migrateSketchbooksToFlat()` — guarded `sk_flat_migrated`, atomic (index
  persisted before folders go to OS Trash), runs after the existing
  `migrateSketchbooksToFolders` in `useAppStore.js` init.
- SketchbookView.jsx untouched — `loadSketchbookContent`/`saveSketchbookContent`
  call signatures didn't change.

**Verify:** build green, eslint clean (pre-existing unrelated warnings only).
**Needs the Tauri app** for the actual migration/file moves (preview has no
FS) — watch first launch on real data: sketchbook folders should disappear
from `sketches/`, replaced by flat `.excalidraw` files; open/edit/rename/
delete each still work; confirm via `sketches_index` in the keyed store.

## 2. Audiobooks — DONE (this session, → A73)

Binary, so no full flatten — can't merge multi-track chapters into one file.
- Single-file (`mp3`/`m4b`/one blob): flattened to `audio/<Name>.<ext>`,
  per-folder `meta.json` dropped (library.json already had the meta — it was
  pure duplication).
- Multi-chapter (`audiofolder`, many `chapter_N.<ext>`): folder kept, but
  `meta.json` dropped too — folder is chunks-only now.
- Cover moved out of both into the new shared `covers/<id>.<ext>` dir (+
  `<id>.thumb.jpg` cache). `RESERVED_DIRS` already blocked a collection from
  claiming that name.
- No id→name index needed (unlike sketchbooks/notebooks) — the folder/file
  name is a pure function of title+author, and title isn't user-editable for
  audio, so every call site's own `book` object is enough.
- `moveToTrash('audio', …)` rewritten to resolve the path deterministically
  from `bookObj` instead of scanning for `meta.json` — that scan would have
  silently found nothing post-flatten and orphaned files on delete.
- **Not yet runtime-verified** — needs the Tauri app, watch the next launch.

## 3. Books (PDF/e-reader) — DONE (this session, → A76)

**Correction before implementing:** the original design note above was WRONG.
`content.json` is derived (safe to discard/regen) **only for `format: 'pdf'`**
— those chapters are a one-paragraph placeholder, PdfView renders the real
`.pdf` live. For **epub/txt/md**, `content.json` is NOT a cache — it's the
**only surviving copy** of the book's text (the original file is discarded at
import; only the parsed `chapters` survive). Moving that to a volatile
`appDataDir` cache would have been real data loss. Caught this by reading
`bookImport.js`/`ReaderView.jsx` before writing any migration code — worth
doing that read on every "is X derived?" assumption before acting on it.

Shipped instead:
- `format: 'pdf'` → flat `books/<Author - Title>.pdf` (the real source,
  rescued from a legacy folder or base64-in-library.json same as before);
  no content.json is ever written for these.
- epub/txt/md → flat `books/<Author - Title>.content.json` (the actual book
  text — every format fully flattens, unlike audio).
- Cover → shared `covers/<id>.<ext>`, same dir as audio.
- No id→name index needed — same reasoning as audio (title not user-editable
  via `EditItemModal`, callers already hold the full book object). Two
  call-site fixes needed for that to hold: `ReaderView.jsx`'s load effect now
  passes `activeBook` (not `activeBook.id`) to `loadBookContent`, and
  `SideNav.jsx`/`LibraryView.jsx`'s book-delete handlers now pass the book
  object as `moveToTrash`'s 4th arg (audio already did).
- **Applied the A75 lesson up front**: `migrateBooksToFlat` checks the
  oldest chunked-keyed-store shape (`book_<id>_data`/`_chunks`/`_chunk_N`,
  which routes to flat `books/book_<id>_*.json` files with no folder at all)
  unconditionally, not gated on a legacy folder existing.
- **Extra safety vs. audio's migration**: the old folder is only trashed
  once the flat target is CONFIRMED on disk (`await exists(flatPdf)` /
  `flatJson`) — audio's migration trashed unconditionally after attempting
  the move, which worked out but wasn't as careful; books (harder to
  reacquire, esp. PDFs) get the stricter atomic-style guard.
- **Not yet runtime-verified** — needs the Tauri app, watch the next launch.

## 4. Epub-keeps-real-file (this session, → A86)

User proposal, refining #3 above: instead of `content.json` being the only
copy for epub books, keep the real `.epub` file (like PDF already does) and
make `content.json` (now `epub_content_cache.json`, root-keyed) a disposable,
regenerable cache. This only became POSSIBLE after restricting book import to
epub/pdf (#3) — epub is deterministically re-parseable from its own bytes,
unlike txt/md which never kept a source file to regenerate from.

- `parseEpub` extracted to `src/lib/epubParser.js` (shared — `storage.js`
  regenerating a stale cache can't import from `bookImport.js`).
- Real `.epub` kept flat + `epub_content_cache.json` seeded on import.
- `loadBookContent`: cache hit + unchanged mtime → fast path; miss/stale →
  re-parse live. Missing `.epub` → never silently served from cache (the file
  IS the connection, per the user's framing) — `sourceMissing` flag surfaces
  a Keep/Remove prompt instead of a silent auto-delete (iCloud sync gaps
  could false-positive a real book as gone).
- Books imported before this feature (no cache entry) are permanently exempt
  — no retroactive `.epub` reconstruction is possible, they keep working off
  their existing `content.json` unchanged.
- Verified live in browser preview (badge/modal/unaffected-normal-book). Not
  yet verified against the real Tauri FS flow (import → cache → regen →
  actually-missing-file).

## Collision risk

Another chat may be concurrently editing `storage.js` — same warning as the
A61 collections work. Re-read the relevant section before editing if picking
this back up in a new session.
