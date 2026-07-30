# Plan P — PDF reader/annotator parity + reader aesthetic — STATUS: P0.1–P0.3 + Q1 DONE (UI_CHANGES AB, AC, AD)

Companion to `PLAN_READER.md` (e-reader) and `PLAN_STARTUP.md` (launch perf).
Current PDF surface: `src/views/PdfView.jsx`, 328 lines. Renders **one page** to a
single canvas, no annotations of any kind, pdf.js pulled from a CDN.

Decisions taken (2026-07-18): **continuous scroll + paged mode, user-toggleable**;
**annotations written into the PDF file itself** (portable to Preview/Acrobat).

---

## P0 — Blockers. Do these before any feature work.

> **P0.1, P0.2 and P0.3 are DONE** (`UI_CHANGES.md` AB + AC), as is Q1. pdf.js is now
> bundled at v5.7.284 via `src/lib/pdfjs.js`; the CDN is gone from all three call sites.
>
> **Two things need a real `npm run tauri:dev` run before P1 starts:**
> 1. `source.pdf` lands in book folders, the migration log line fires, `library.json` shrinks.
> 2. **PDF page rendering works at all** — `page.render()` cannot be exercised in the web
>    preview (it hangs there for the old 3.11 build too, so it's the environment), which
>    means the v5 render migration is currently unproven in either direction.
>
> **Next up: Q5 (measure), then P1.**

### P0.1 The raw PDF is never saved to disk, and `library.json` is being poisoned

Trace:

- `bookImport.js:528` — `pdfDataUrl = await readFileAsDataURL(file)`. The entire PDF
  becomes a base64 string on the book object.
- `storage.js:792` — `saveBook` destructures `pdfDataUrl` out before writing
  `meta.json`. **The PDF bytes are never written to the book folder.** Nothing in
  `src/` writes a `.pdf` file.
- `storage.js` `saveLibrary` — strips only *non-`data:`* `coverDataUrl`. `pdfDataUrl`
  is a `data:` URL, so it is **persisted verbatim into `library.json`**.

Consequences:

1. `library.json` contains the full base64 of every imported PDF (~1.37x the file
   size). `loadLibrary()` parses that JSON on every launch — likely a large share of
   whatever startup cost is left after `PLAN_STARTUP` F1–F5 and the thumbnail cache.
2. `PdfView.jsx:197-198` calls `updateBookProgress` + **`persistLibrary()` on every
   page render**. Each page turn re-serializes every PDF in the library to disk.
3. `PdfView.jsx:76` does `atob(src.split(',')[1])` — decodes the whole document into
   a JS string on open, on top of the copy already in the store.
4. There is no file to write annotations back into, so P0.1 gates the whole
   annotation phase.

Fix:

- At import, write the bytes to `<bookDir>/source.pdf` via `writeFile` (same pattern
  as `cover.${ext}` at `storage.js:804`). Keep only `{ hasSource: true }` in meta.
- `loadLibrary` attaches `pdfUrl = convertFileSrc(sourcePath)` the way covers now do.
  pdf.js streams from the URL — no `atob`, no base64 in memory.
- `saveLibrary`: strip `pdfDataUrl` / `rawDataUrl` unconditionally, next to the
  existing cover strip.
- **Migration**: on load, any book with a `data:` `pdfDataUrl` gets its bytes written
  to `source.pdf` once, then the field nulled and the library re-saved. Self-healing,
  same shape as the thumbnail cache. Log how much `library.json` shrinks.
- Remove `persistLibrary()` from the render effect — debounce progress writes
  (~1s trailing, plus flush on unmount), matching what the e-reader should do too.

**Books imported before this fix have no recoverable PDF** (bytes only ever lived in
`library.json`, which is at least a real source for migration — verify that first; if
a given entry has no `pdfDataUrl`, it must be re-imported). Surface that honestly in
the UI rather than the current bare "PDF source not found. Please re-import this file."

### P0.2 pdf.js is loaded from a CDN

`PdfView.jsx:12` and `bookImport.js:539` inject
`cdnjs.cloudflare.com/.../pdf.js/3.11.174`. In a packaged Tauri app this means **PDFs
do not open offline**, and it's a third-party script execution + CSP hole.

- Add `pdfjs-dist` as a real dependency, import the worker with Vite `?url`.
- Single shared module (`src/lib/pdfjs.js`) used by both the viewer and the importer.
- Pin to a version whose annotation API matches what P3 needs; 3.11 → 4.x is a
  breaking change for `renderTextLayer` (P1.4 touches this anyway).

### P0.3 Text layer is a hack

`PdfView.jsx:278` sets `opacity: 0.2` on the text layer, so selectable text is
*faintly visible on top of the rendered page*. It should be
`color: transparent` with `::selection` styled — the pdf.js `text_layer` CSS already
does this correctly once bundled (P0.2). This also blocks precise selection rects,
which P3 needs for highlight anchoring.

---

## P1 — Viewer parity

Reference set: Preview, Acrobat, Zotero, Skim, PDF Expert. Common denominator that
Gnos is missing.

1. **Continuous scroll**, virtualized. Page column in a scroll container, only pages
   near the viewport rendered to canvas; the rest hold a sized placeholder. Reuse the
   sentinel/near-viewport approach now in `LibraryView`, and **do not** reach for
   `content-visibility: auto` — see `UI_CHANGES` Z for why that blanks under load.
2. **Paged mode toggle**, preserving today's one-page behaviour. Same pref surface as
   the e-reader's planned scroll-mode toggle (`PLAN_READER` 3.5) so the two views
   speak the same language.
3. **Zoom**: fit-width / fit-page / actual-size presets + ⌘+ / ⌘− / ⌘0, pinch on
   trackpad. Today: fixed steps only, and `fitScale` is recomputed inside the render
   effect, which fights the user's manual zoom.
4. **Render quality/cost**: cap canvas backing store (`dpr` unbounded × zoom 3 on a
   large page is a huge allocation), reuse canvases across pages, cancel offscreen
   render tasks. Render at devicePixelRatio but clamp total pixels.
5. **Two-page spread** for continuous mode, matching `.reader-card.two-page`.
6. **Rotate** (per-page and document), persisted.
7. **Outline / TOC** from `pdfDoc.getOutline()` → reuse `ChapterDropdown`
   (`ReaderView.jsx:383`) so it looks and behaves like chapter nav.
8. **Thumbnail sidebar**, page grid, current page tracked, click to jump.
9. **In-document search** via `getTextContent()` per page, lazily indexed and cached.
   Hit list with page + snippet, highlight-all, next/prev. Mirrors `PLAN_READER` 3.1
   and should share the titlebar search scope mechanism.
10. **Link annotations** clickable (internal jumps + external via Tauri `open`).
11. **Page-label support** (`getPageLabels()`) so roman-numeral front matter shows the
    printed page number, not the index — a real differentiator vs. naive viewers.

## P2 — Aesthetic parity with the e-reader

The reader's visual language lives in `global.css`: `.reader-header` (561),
`.reader-main` (622), `.reader-card` (629), `.reader-pagenum` (647),
`.reader-footer` (740), `.footer-nav`, `.page-indicator`, `.progress-track`, and the
`--readerBg` / `--readerCard` / `--readerText` vars.

`PdfView` currently ignores nearly all of it — it's inline-styled, with a footer built
from ad-hoc bordered buttons that matches nothing else in the app.

1. Rebuild the PDF chrome on the reader's classes: `.reader-main` wrapper,
   `.reader-card` page surface, `.reader-footer` + `.footer-nav` + `.progress-track`
   footer, `.reader-pagenum` furniture. Delete the ad-hoc inline footer.
2. **Dead CSS**: `#pdf-view`, `.pdf-card`, `.pdf-page-full` (global.css 777–800) are
   from a previous PDF implementation and are referenced by nothing. Either adopt them
   in the rebuild or delete them — don't leave both.
3. **Settings panel** styled on `SettingsPanel` (`ReaderView.jsx:24`): scroll/paged,
   spread, theme, invert.
4. **Page appearance**: dark-mode invert / sepia tint for the page raster, so a white
   PDF doesn't torch the eyes in the dark theme. Preview and Acrobat both ship this;
   it's also the single biggest "feels native to Gnos" win.
5. **QuickAccess** titlebar strip already used — extend with the new mode/zoom
   controls rather than adding a second toolbar.

## P3 — Annotation, written into the PDF

Chosen: real PDF annotation objects, portable to Acrobat/Preview.

**Architecture.** Re-writing a multi-MB PDF on every stroke is untenable, so:

- Live edits go to an in-memory annotation store (same shape as
  `annotations_highlights`, keyed by book → page → annotation).
- A **debounced writer** (~2s idle, plus on close/blur) uses `pdf-lib` to write the
  annotations into `source.pdf` and atomically replace it (write temp, rename).
- **The PDF file is the source of truth.** On open, annotations are read from the
  document via pdf.js `getAnnotations()`, not from a sidecar.
- A small sidecar is kept **only as a crash buffer** — unflushed edits, cleared on
  successful write. It is not a second source of truth.

**Annotation types**, in priority order:

1. Highlight (multi-colour), underline, strikeout — quadpoints from text-layer
   selection rects. Requires P0.3.
2. Sticky note / text annotation with popup content.
3. Freehand ink — reuse `src/lib/canvasSurface.js` (already exists for the
   sketchbook) so pressure/Apple Pencil handling isn't reinvented.
4. Shapes (rect/ellipse/line/arrow), typewriter text box.
5. Signature stamp.

**Reuse from the e-reader:** the selection pill (`ReaderView.jsx:2355` `commitHL`) and
`ReviewPanel` (`ReaderView.jsx:158`) — highlights list, notes, colour change, delete,
`exportHighlightsMarkdown`, `sendHighlightsToNotebook`. Getting PDF annotations into
that panel means export-to-markdown and send-to-notebook work for PDFs for free, which
is the actual Gnos differentiator over Preview.

**Interop caveat to verify early:** Preview and Acrobat disagree about ink and
free-text rendering details. Build one highlight end-to-end, write it, and open the
file in both **before** building types 2–5 on the same foundation.

---

## Separate track — remaining perf work

### Q1. Covers re-load when the home button is clicked  ← reported

`ViewPanel` (`App.jsx:69-84`) picks a component from `tab.view`. `TabPane` keeps a
*tab* mounted across tab switches, but changing the view **within** a tab
(reader → library) unmounts `LibraryView` entirely. On return: every cover `<img>` is
a new element (re-decode), `.cover-img-fade` replays as an entrance animation,
`visibleCount` resets to 60, and scroll position resets to 0. That combination reads
as "the library is loading again".

Options, cheapest first:

- **a.** Skip the fade for already-decoded images (`img.complete` / `onLoad` check) —
  kills the animation replay, which is most of the perceived jarring. ~10 lines.
- **b.** Lift `visibleCount` + scrollTop into the store or a module-level cache keyed
  by tab, restored on mount. Fixes losing your place.
- **c.** Keep `LibraryView` mounted per tab behind `display: none` instead of
  unmounting, the way `TabPane` already does for tabs. Costs one live grid per tab in
  memory; makes home instant and preserves everything.

Recommend **a + b** first, measure, then **c** only if it still reads as a reload.

### Q2. `persistLibrary()` on every progress update

`PdfView.jsx:198` per page render; check `ReaderView` for the same pattern. Every call
serializes the entire library to disk. Debounce to ~1s trailing + flush on unmount.
Compounds badly with P0.1 today.

### Q3. Annotation writes

`ReaderView.jsx:1270-1278` — `saveHighlights`/`saveBookmarks` write to **both**
`localStorage` and `setJSON` on every single change, with no debounce. Same treatment.

### Q4. Cover thumbnail generation for non-folder covers

The `cover_thumb.jpg` cache (`UI_CHANGES` AA) only covers art loaded from book
folders. PDF-derived covers (`PdfView.jsx:110`) still go in as full `data:` URLs on
the book object and land in `library.json`. Route them through the same path: write
`cover.jpg` + `cover_thumb.jpg` to the book folder, keep no base64 in the store.

### Q5. Measure, finally

Everything in `PLAN_STARTUP` Phase 0 is still unmeasured — all of this has been
reasoned from code, not from a profile. Before P1, run `npm run tauri:dev` with the
real library and record in `PLAN_STARTUP.md`: `library.json` size before/after P0.1,
launch-to-first-paint, PDF open time, page-turn frame times.

---

## Order

P0.1 → P0.2 → Q1 → Q5 (measure) → P0.3 → P1.1-1.4 → P2 → P1.5-1.11 → P3 → Q2-Q4.

P0.1 first because it is a live data bug that also gates P3 and probably dominates
startup. Q1 early because it's small and user-visible. Measure before the big P1
rewrite so the rewrite can be judged.

Verify per step: `npm run build`. The PDF path **cannot** be verified in the browser
preview — it needs Tauri fs for `source.pdf` and `convertFileSrc`. Real checks go in
`npm run tauri:dev`, and P3 additionally requires opening written files in Preview and
Acrobat.
