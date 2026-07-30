# Plan A39 — Notion/AppFlowy-style blocks, Zotero research, remaining checks

## 0. Architecture ground rule (read first)

The notebook editor is CodeMirror 6 over MARKDOWN with widget decorations
(`NotebookView.jsx` ~9k lines, shared pieces in `lib/notebookEditor.js`), NOT a
block-model editor. Existing "blocks" are markdown-native + CM widgets: /table,
/todo, /task, /math zones, /timer, /link(f|w|v), mermaid, KaTeX, checkboxes,
calculator. THE PLAN IS NOT A BLOCK-ENGINE REWRITE — every new block must be
(a) plain markdown on disk (portable, diffable, works in any editor) and
(b) a CM decoration/widget in edit view + a renderer in preview.
Obsidian proves this model reaches Notion-league UX without a proprietary format.

## 1. Notion vs AppFlowy — what they have, what we take

Comparison (sources: appflowy.com/compare, AFFiNE/Anytype comparisons):
- BOTH: paragraph/heading/list/quote/divider/code/image + toggles, callouts,
  columns, synced/linked content, slash menu, drag handles, templates.
- Notion extra: huge block arsenal, inline databases everywhere, synced blocks,
  AI, integrations. AppFlowy (open-source, local-first — closer cousin to Gnos):
  40+ block types; databases with Grid/Kanban/Calendar/Gallery/List/Feed/Chart
  views, filters, two-way relations, rollups, grouping; weaker realtime collab.
- Insight: the differentiating power is (1) slash-menu breadth, (2) database
  views of the same data, (3) transclusion/synced content, (4) manipulation
  ergonomics (drag handle, block select). Gnos ALREADY has the view engines
  (kanban, calendar, library grid, flashcards) — we get "databases" by EMBEDDING
  our existing views, which neither Notion parity path requires building a DB engine.

### Phase B1 — markdown-native blocks (CM widget + preview renderer each)
1. **Callouts** — Obsidian syntax `> [!note] Title` (also tip/warning/quote/
   important). Tinted-chip language (color-mix bg + left bar — same as calendar
   event chips). Cheap, high-visibility, ecosystem-compatible.
2. **Toggles** — `> [!toggle]- Title` collapsed-by-default callout variant +
   heading folding affordance in the gutter (CM6 foldService already available).
3. **Columns** — fenced container: `:::columns` / `---` splits / `:::`.
   Preview: flex row. Edit view: light border decoration. Keep to 2-4 cols.
4. **Slash menu unification** — one real autocomplete popup for `/` listing ALL
   commands with icons + descriptions (current commands are scattered regexes;
   CM6 autocomplete facet). This is the Notion "feel" more than any block.
5. **Drag handle** — hover gutter dot per top-level block (paragraph/list/fence),
   drag to reorder lines (CM line ranges). Block select via handle click.

### Phase B2 — embeds of existing Gnos surfaces (our unfair advantage)
6. **/kanban embed** — `\`\`\`gnos-kanban <boardId>\`\`\`` fence renders the live
   KanbanBoard (read/write) inline in preview; edit view shows a badge widget.
7. **/calendar embed** — embedded FullCalendar (already componentized in
   `components/Calendar.jsx` — embedded mode exists!) filtered to a tag.
8. **/deck embed** — flashcard deck card w/ "review now" (deck stats + jump).
9. **/shelf embed** — library query widget: `\`\`\`gnos-shelf collection:X tag:Y\`\`\``
   renders matching book/notebook cards (reuses memoized library cards).
10. **Transclusion** — `![[note]]` and `![[note#heading]]` render the target
    section READ-ONLY inline (synced-block-lite; single source of truth, no
    sync machinery). Wikilink parsing already exists for the graph.

### B1.6 — further widget candidates (from Notion/AppFlowy inventories)
- **/toc** — table-of-contents block: lists the note's headings as links (regen
  on render; both apps have it, cheap for us — headings already parsed).
- **/bookmark** — link-preview card: URL → fetch title/favicon (browser
  workspace fetch), render as a rich card (Notion's web bookmark).
- **/progress** — progress bar block `progress: 7/10` (Notion formula-lite);
  also auto-progress for /todo blocks (n checked / total).
- **/rating** — 1-5 stars inline (book reviews in notes).
- **/file** — attachment block: copy file into notebook dir, chip w/ open icon.
- **/audio** — audio snippet player (points at a library audiobook chapter or
  local file; reuses globalAudio).
- **/button** (AppFlowy/Notion) — action chip: open note/board/URL; ours can
  target any tab view (open book at chapter, start deck review).
- **/columns**, **/toggle**, **/callout** — already in B1.1-B1.3.
- Skipped: Notion AI blocks, embeds of external SaaS (Figma/Maps), comments.

### B1.7 — Obsidian gap (STATUS: comments/highlight/footnotes/progress/rating/toc DONE live+export A40; remaining: block refs ^id, YAML properties, outline pane, image sizing)
### B1.7 — Obsidian block/feature gap analysis (vs our editor)

Already have: wikilinks `[[...]]`, tables, task lists, mermaid, KaTeX math,
code fences, HR, images, tags (graph), backlinks (graph), slash-ish commands.
Obsidian blocks/features we LACK, ranked by fit:
1. **Callout rendering** — `> [!note|tip|warning|quote|...]` with fold variant
   `[!note]-`. Syntax already inserted by /callout; renderer = B1.1. Highest.
2. **Block references** — `![[note#^blockid]]` + `^blockid` anchors. Pairs with
   B2.10 transclusion; block-level granularity is Obsidian's edge over Notion.
3. **Footnotes** — `[^1]` markdown footnotes with hover preview. (Reader
   footnotes blocked on bookImport, but NOTEBOOK footnotes are pure markdown —
   independent, doable now.)
4. **Comments** — `%%hidden text%%` stripped from preview. Trivial decoration.
5. **Highlight syntax** — `==mark==`. Trivial (lezer-markdown Mark extension or
   regex decoration).
6. **Properties/frontmatter** — YAML block rendered as a key-value card at note
   top (tags, aliases, dates). Medium; unlocks smart collections for notes too.
7. **Outline pane** — heading tree sidebar (our /toc block is the inline
   cousin; outline = panel). Medium.
8. **Embedded images with size** — `![[img.png|300]]`. Small.
9. NOT pursuing: Canvas (Excalidraw covers), community-plugin surface area,
   Dataview query language (our /shelf + smart collections cover the 80%),
   sync/publish.

### System calendar connection (user question — answer + plan)
Two viable routes, not mutually exclusive:
- USER DECISION: EventKit (S2) chosen over subscriptions — plan the Rust
  objc2-event-kit command + entitlement work as its own pass.
- **S1. .ics subscription URLs (recommended first)** — cross-platform, ~50
  lines: store `subscribedCalendars: [{url, color, name}]`, fetch+parse with the
  existing `parseIcs` on open + every N hours, merge as read-only events
  (source:'subscription'). Covers Google/Outlook/iCloud published calendars.
  Caveat: iCloud requires the user to make the calendar public or use its
  private webcal URL.
- **S2. macOS EventKit (native two-way)** — needs a Rust-side Tauri command via
  `objc2-event-kit`, `NSCalendarsFullAccessUsageDescription` in Info.plist, and
  the system permission prompt; macOS-only; read AND write. Real work (~1-2
  days incl. entitlement debugging). Do only after S1 proves demand.
No official Tauri calendar plugin exists as of mid-2026.

### Phase B3 — ergonomics
11. Templates: `/template` inserts from `templates/` notebooks folder.
12. Block duplicate/move-to-note via drag-handle context menu.
Order: 4 (slash menu — unlocks discoverability) → 1 → 2 → 10 → 6-9 → 3, 5, 11-12.

## 2. Zotero comparison — research findings (no build commitment yet)

What Zotero is (wikipedia/paperguide/libguides): reference manager — metadata-
rich item library (any type: paper/book/webpage), collections + saved searches,
tags, integrated PDF/EPUB/HTML readers with annotations synced across devices,
notes editor, 9000+ citation styles, word-processor plugins, browser clipper
with automatic metadata extraction, BibTeX/RIS/etc import-export, group libraries.

Overlap Gnos already has: EPUB/PDF readers w/ highlights+notes+md export,
collections, tags (graph), notebooks, reading progress/streaks.

Worth pulling (ranked by fit with "personal reading + study" identity):
Z1. **Rich item metadata**: add year/publisher/ISBN/abstract/language/custom
    fields + an editable metadata panel on book cards (we store title/author only).
    Unlocks everything below.
Z2. **Saved searches (smart collections)**: collection defined by query
    (tag/author/format/unread) — auto-updates. Cheap on top of existing filters.
Z3. **Cite/copy**: reader selection pill gains "Copy citation" (title, author,
    chapter, page) + per-book BibTeX entry export; highlight md-export gains
    citation footers. No 9000-style CSL engine — one good default + BibTeX.
Z4. **BibTeX/RIS import**: drop a .bib → creates library items (metadata-only
    entries allowed, "wishlist" items without files).
Z5. **Web clipper**: browser workspace (0.2.0) gains "save page to library" —
    readability-extracted article as a reading item with source URL metadata.
Z6. **Annotation manager**: cross-BOOK annotations view (all highlights across
    library, filterable by color/tag/book) — Zotero's killer review surface;
    we already store everything needed (`annotations_highlights`).
NOT pulling: word-processor plugins, group libraries/sync, CSL style engine.
Use cases unlocked: student research workflow (import .bib, annotate, export
cited notes), sermon/lesson prep (cross-book annotation review), article triage
(clipper + smart collections).

## 3. Remaining checks (carried from PLAN_A38 + reader plan)

- A38 leftovers: 1.2 TabPane eviction, 1.3 reader cache clear on deactivate,
  1.4 covers out of JSON, 2.1 drag-to-split, 3.4 toolbar spacers, 5.3 Excalidraw
  dark audit (Tauri), 6.4 tab-card split/context menu.
- Reader leftovers: image pre-sizing (1.3), footnotes (needs bookImport inline-
  anchor preservation — ALSO a prerequisite for good Zotero-style citation of
  locations), scroll mode, spread shadow.
- In-app verifications pending: graph CPU drop, Excalidraw dark buttons,
  reader flip smoothness on real books, audiobook zen-card chapters look.

## Order overall
B1.4 slash menu → B1.1 callouts → B1.2 toggles → Z6 annotation manager (quick,
high value, zero schema change) → B2.10 transclusion → Z1 metadata + Z2 smart
collections → B2.6-9 embeds → Z3/Z4 citations/BibTeX → B1.3/5, Z5, B3.
