# Plan R1 — world-class e-reader — STATUS: mostly DONE (see UI_CHANGES A32)

DONE: 1.1 prewarm, 1.2 anchor restore, 1.4 coalescing, 1.5 contain, 2.1 lang+limits,
2.2 text-wrap pretty, 2.4/2.5 (were already present), 2.7 running head, 3.1 search,
3.3 dictionary (already existed).
REMAINING: Phase 0 measurements (needs Tauri app), 1.3 image pre-sizing, 2.3 verify
hanging-punctuation renders, 2.6 bundled book face + weight slider, 3.2 footnotes
(blocked: import strips inline anchors — needs bookImport rework), 3.4 selection-pill
audit, 3.5 scroll mode, 3.6 min-left estimate, 3.7 spread shadow.

Pickup doc. Reader = `src/views/ReaderView.jsx` (2.6k lines: settings, ReviewPanel
highlights/bookmarks/notes, Piper TTS, two-page, transitions) +
`src/lib/Paginationengine.js` (453 lines: CSS-columns "single strip" — chapter rendered
ONCE into `_strip` (multi-column, `MAX_COLS` wide), `measurePageCount()` reads last-rect,
`trimContainerWidth()` shrinks, paging = transform translate). Already good bones:
layout happens once per chapter, paging is compositor-only.

Phase order = measure → speed → typography → features. Each phase shippable.

## Phase 0 — measure (do first, 30min)
Tauri Web Inspector, large EPUB (e.g. Critique of Pure Reason):
- Time: chapter switch (innerHTML → strip layout → measure), resize repagination,
  book open → first page visible.
- Note GC/long tasks during rapid paging and TTS.
Record numbers in this file. Targets: open <300ms, chapter switch <120ms, resize
repaginate <150ms, page turn 60fps always.

## Phase 1 — speed (bleeding-edge feel = latency, not features)
1. **Adjacent-chapter prewarm**: after current chapter settles, build next (and prev)
   chapter strips into hidden offscreen containers during `requestIdleCallback`; chapter
   switch becomes a swap, not a re-render. Cache keyed `chapterIdx|colW|colH|fontPrefs`.
   Evict >3 entries. This is the single biggest win — do it first.
2. **Resize/repagination debounce + anchor restore**: repaginate once per 150ms trailing;
   preserve position by first-visible-word index (check what engine uses today — grep
   `anchor|firstWord|restore` in Paginationengine) not page number. During live resize,
   scale the existing strip with a transform so it never blanks, then snap to the real
   re-layout.
3. **Image handling**: `decoding="async"` + `loading="lazy"` on chapter imgs won't work
   inside columns reliably — instead pre-size imgs from EPUB metadata (width/height attrs)
   to avoid layout shift, decode() before strip swap-in.
4. **Font pref changes**: currently `onRebuild` per toggle — coalesce; rebuild once per
   settings-close or 300ms debounce. Bold toggle already setTimeout(20) hack — replace.
5. **contain**: `contain: layout paint` on the strip wrapper (NOT the content card — see
   A-pass gotchas), isolates reader layout from app.

## Phase 2 — typography (what makes it look professional)
1. **Real hyphenation**: `hyphens:auto` already set — verify `lang` attr propagates from
   EPUB metadata to strip root (WebKit needs correct lang); add `hyphenate-limit-chars`
   equivalents via `-webkit-hyphenate-limit-*`.
2. **Justification polish**: when justify on, enable `text-wrap: pretty` (WebKit 17.5+?
   feature-detect) for last-line/short-word control; `word-spacing` clamp.
3. **Optical margins**: hanging punctuation (`hanging-punctuation: first last` — WebKit
   supports!) — instant book-grade look, one line of CSS.
4. **Widow/orphan control**: `orphans: 2; widows: 2` in column CSS (works in columns).
5. **Ligatures/kerning**: `font-feature-settings` on strip: liga, kern on; oldstyle nums
   for body (`onum`) optional pref.
6. **Font stack**: bundle 1-2 great book faces (Literata / Source Serif variable) —
   variable weight axis replaces the Bold toggle with a weight slider.
7. **Page furniture**: running header (book title left, chapter right, small caps,
   textDim), page x/y bottom center — inside the reader card, not the app header.

## Phase 3 — features (gap to world-class)
1. **In-book search**: index chapters lazily (strip innerText per chapter, cached);
   titlebar search scoped to book when reader active (useTitlebarMeta already used —
   add `scope: 'book'`); results panel with chapter + snippet, jump = chapter + word
   index. No worker needed under ~5MB text; profile first.
2. **Footnote popovers**: intercept `a[href^="#"]` clicks whose target is a footnote
   (epub:type="noteref" or heuristic: target element is small block near end) → show
   floating card popover instead of jumping. Back-jump preserved as button in popover.
3. **Dictionary**: macOS native — Tauri shell `open dict://<word>` on selection
   context-menu "Define". Zero-dependency, native panel.
4. **Selection → highlight flow**: verify current UX; want: select → floating pill
   (Highlight · Note · Copy · Define · Send to notebook) at selection rect.
5. **Scroll mode toggle**: alternative continuous-scroll renderer (no columns, plain
   flow, same stylesheet) for users who hate pagination; position maps via word index.
6. **Progress precision**: store word-index-based location (survives font changes,
   window sizes); show "page x of y · z% · ~n min left in chapter" (words/wpm from
   reading-log).
7. **Page-turn**: keep transform slide; add subtle spread shadow gradient between the
   two columns in twoPage mode. No skeuomorphic curl.

## Explicitly NOT doing
- No epub.js/foliate rewrite — the strip engine is the right architecture; improving it
  beats replacing it.
- No canvas text rendering, no WASM layout — CSS columns on WebKit is already native-fast.

## Order
Phase 0 → 1.1 (prewarm) → 1.2 (resize anchor) → 2 (all CSS, one pass) → 1.3-1.5 →
3.4/3.6 (selection + progress) → 3.1 (search) → 3.2/3.3 → 3.5.
Verify per step: `npm run build`; reader is previewable in browser only if book content
loads without Tauri FS — otherwise verify in `npm run tauri:dev`.
