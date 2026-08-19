# PLAN — Concurrent editing → collaboration

Status: **design only, nothing implemented.** Written 2026-08-17 after disabling the
conflict-fork (A71). Decisions below are Ethan's, taken 2026-08-17.

---

## 0. Decisions locked

| Question | Answer | Consequence |
|---|---|---|
| Conflict UI | Merge chooser exists, but **silent essentially always** | auto-resolve everything; the chooser becomes a *retrospective* tool, never a blocking dialog |
| Who collaborates | **Ethan + other people** | needs a relay + identity + a sharing model — not just device-to-device |
| Announce merges | **Fully silent** | no toasts, no banners |

### The constraint that falls out of "fully silent"

> You cannot silently discard an edit unless the user can get it back.

Silent auto-resolution **without history is data loss**; with history it is just
convenience. So **local version history is not optional here — it is the safety net that
makes silence acceptable**, and it must land in the same step as silent merging.

This is also the honest replacement for forking. Forking's legitimate purpose was *"don't
lose the other version"*. History serves that purpose **invisibly, in `appDataDir`**,
instead of littering the archive with `Note (offline edit …)` files.

---

## 1. Why forking was the wrong shape

Saving is a **whole-file overwrite**, so a changed file on disk left only: clobber it, or
branch it. But two editors rarely touch the same *line* — they touch different paragraphs.
Reconcile **text**, not files, and the whole problem class disappears.

## 2. Three problems, kept separate

| # | Scenario | Status |
|---|---|---|
| **A** | Two views inside one app instance | solved (`notebookContentCache`) |
| **B** | App **+ outside writer** (Obsidian, vim, iCloud from another device) | **broken today — external edits silently overwritten** |
| **C** | **Live multi-user** | the goal |

**B is asynchronous** (reconcile two finished versions). **C is real-time** (converge a live
session). Different machinery; conflating them is how binary CRDT state ends up sitting in
a folder we just spent days flattening.

---

# STAGE 1 — Silent merge + invisible history (fixes B)

## 1.1 All three merge inputs already exist

| input | source |
|---|---|
| **base** — text at last agreement with disk | `syncedTextRef` (NotebookView, already maintained) |
| **ours** | `contentRef` / CM6 doc |
| **theirs** | disk read in the A45 watcher / pre-save check |

**No schema change, no new archive files.** That is why this goes first.

## 1.2 Pieces

**`src/lib/merge3.js`** (new, vendored ~120 lines — do **not** add a dependency; the
mermaid transitive-dep episode is a good enough warning)

```js
merge3(base, ours, theirs) -> { clean: boolean, text, hunks: [{ours, theirs, resolved}] }
```

Line granularity. Character-level merging of prose produces word salad; paragraphs are the
natural unit for markdown.

**Silent resolution policy** (no prompt, ever):
1. Disjoint hunks → merge both. *(the overwhelming majority)*
2. Overlapping hunks → **keep ours**, and record the losing side in history.
3. Either way: write, stamp, snapshot.

**`src/lib/history.js`** (new) — versions live **outside the archive**:

```
appDataDir/history/<noteId>/<epochMs>-<local|remote|merge>.md
   macOS → ~/Library/Application Support/com.gnos.dev/history/…
```

### Why not a hidden folder *inside* the archive

The requirement is "invisible to the user"; `appDataDir` satisfies it — `~/Library` is
hidden in Finder by default, and the archive folder stays pure markdown. A `.history/`
folder next to the notes would look equivalent but **cannot work here**:

> **A52, learned the hard way:** a leading-dot path in the archive is silently rejected by
> the Tauri fs capability scope (`/**`, `$HOME/**`). That is exactly what made
> `notebooks/.index.json` fail to persist, which made 64 notes vanish.

So: dotfiles in the archive are a proven failure mode in this app. `appDataDir` is the only
correct home for hidden per-user state, and it has the additional benefit that history
**never syncs to iCloud** — snapshots stay local, don't consume iCloud quota, and can't
themselves become a sync-conflict source.

- snapshot on: pre-merge (both sides), and every N minutes of active editing
- retention: **keep 7 days, then discard** (decided 2026-08-17); prune on note open
- `listVersions(id)` / `restoreVersion(id, ts)` / `diffVersions(a, b)`

**Retrospective chooser** — a "History" panel in the notebook: timeline, side-by-side diff,
restore. This is the "merge chooser" from Q1, moved *after* the fact so it never blocks.

## 1.3 Save protocol (compare-and-swap)

```
save(text):
  snapshot = text                       # freeze; autosave debounce keeps moving
  cur = readMeta(); st = stat(path)
  if hash(disk) == cur.contentHash:     # untouched
      writeAtomic(path, snapshot)
  else:
      theirs = read(path)
      if theirs == snapshot: stamp(); return
      history.snapshot(id, theirs, 'remote')
      r = merge3(syncedText, snapshot, theirs)
      if !r.clean: history.snapshot(id, snapshot, 'local')
      writeAtomic(path, r.text)
  stamp(mtime, contentHash); syncedText = written
```

**Two fixes worth doing even alone:**
- **`writeAtomic`** — write `Name.md.tmp`, then `rename()`. Atomic on one filesystem, so no
  reader (or iCloud) ever sees a half-written note. Removes a real corruption class.
- **Content hash, not mtime** — iCloud rewrites mtimes on sync, which already produced false
  conflicts here. Store `contentHash` beside `contentSyncedAt` in `nb_index`; "changed"
  means *hash differs*.

## 1.4 Also in scope

- iCloud's own `Name 2.md` conflict copies: detect in the self-heal scan, merge + remove,
  rather than adopting them as new notes.
- The A45 watcher adopts disk changes via the same `merge3` path instead of replacing text.

---

# STAGE 2 — Collaboration with other people (fixes C)

## 2.1 Model: markdown is the artifact, CRDT is the session

- **Durable truth:** `notebooks/Name.md` — unchanged, still plain markdown.
- **Live session:** a Yjs document, alive only while the note is open/shared.
- **CRDT state never enters the archive.** `appDataDir/crdt/<noteId>.y` — same rule already
  applied to the reader's parsed cache in `PLAN_FLATTEN.md`: derived data lives outside the
  user's folder.
- Serialize Yjs → markdown on save / last-peer-leaves. If CRDT state is lost, nothing is
  lost; the markdown is authoritative.

**Why this makes silence native:** a CRDT has *no conflicts by construction*. Concurrent
edits always converge deterministically. Stage 2 needs no chooser at all — the Stage 1
history panel remains the escape hatch.

## 2.2 Stack

- **Yjs** + **`y-codemirror.next`** — binds to the CodeMirror 6 already in use; shared
  cursors/selections come nearly free via the awareness protocol.
- **Transport:** `y-websocket` against a small relay.
- **Presence:** awareness gives name, colour, cursor, selection.

## 2.3 Sharing model — capability links, no accounts

Real people, minimal identity, maximum privacy:

```
gnos://join/<roomId>#<key>          (or https://…/join/<roomId>#<key>)
```

- `roomId` — random, opaque; the relay only ever sees this.
- `key` — symmetric key in the **URL fragment**, which is *never sent to the server*.
- Client encrypts every Yjs update with `key`; **the relay stores and forwards ciphertext
  only.** It cannot read a note.
- Possession of the link = permission. No signup for the guest.

**Identity:** a display name + a locally generated keypair, stored in preferences. Enough
for "who is typing"; no auth server, no passwords. Upgrade to real accounts only if
per-person revocation is needed later.

**Permissions & revocation — superseded by §14.1.** Rather than baking the role into the
link, the **host approves each joiner** and sets their role at that moment ("link = knock,
host = doorman"). This gives per-person control and per-person kick without rotating keys or
building auth. Key rotation remains available as a blunt "invalidate every outstanding
link".

## 2.4 Relay

Minimal `y-websocket` server: rooms, fan-out, ciphertext only, no persistence beyond a
short buffer for late joiners. Deployment (small VPS / Fly / Cloudflare Durable Objects) is
an ops decision, not a storage one. Because updates are encrypted, **hosting it never grants
access to note content** — which matters for a personal-archive product.

## 2.5 The integration risk, stated plainly

`makeLivePlugin` builds decorations from **document offsets**, and **A70 — today's
corruption + duplication bug — was caused by exactly one captured stale offset.** Remote
edits shift offsets continuously, so that bug class becomes constant.

**Before any CRDT work:** audit every widget for captured offsets and move them to live
resolution (the `_livePos` pattern from A70) or CM6 position mapping. Also keep the
`safeExt()` discipline and the one-`autocompletion()`-per-editor rule (A39.1). Remote
updates must arrive as ordinary CM6 transactions so decorations remap correctly.

### 2.5.1 Widget offset audit — DONE (2026-08-17)

Every widget class in `src/views/NotebookView.jsx`, the `interaction-handlers` `safeExt`
block, and `makeLivePlugin`'s `build(view)` were audited for the A70 shape (offset captured
at decoration-build time, trusted blindly by an async event handler after the doc has since
changed). **Result: everything already safe — no code changes were required.**

The reason is structural, not luck: `build(view)` (and the sibling `_buildTaskDecos` /
`_buildTableDecos` / `_buildColumnsDecos` / `_buildDiagramDecos` StateFields) fully
recompute every widget from `state.doc` on every `docChanged` transaction — positions are
never memoized across transactions. What survives across a transaction is a widget's *DOM*,
reused by CM6 when `eq()` says "unchanged." Two safe conventions cover every case that
matters:

1. **Position is part of `eq()`, and the DOM attribute is read live at click-time.**
   (`CheckboxWidget.pos`, `StatusWidget.pos`, `FoldArrowWidget.foldFrom/foldTo`.) If the
   offset changes, `eq()` goes false and — since none of these define `updateDOM` — CM6
   fully destroys and remounts via `toDOM()`, so `dataset.pos`/`dataset.foldFrom` is always
   current when the global handler (`makeCheckboxHandler` etc.) reads it.
2. **Position is only ever a locality hint; the write is content-verified.**
   (`_replaceInDoc`'s `hintFrom` param, `ImgWidget._livePos` + the `raw.slice(col,col+2)
   !== '!['` guard, `TableWidget`/`TaskBlockWidget`/`HabitsWidget`'s inline
   `doc.indexOf(this.rawText)` scans.) A stale offset can only narrow *where* the search
   looks first; every one of these falls back to a full-document scan for the widget's own
   known-good source text, and only dispatches a change at a position it just verified holds
   that exact text. This is structurally immune to the A70 mid-token slice, because the
   `from`/`to` used in `view.dispatch` is always derived from a successful string match, never
   trusted as a raw number.

| Widget / handler | Captures offset? | Resolves live before writeback? | Verdict | Reason |
|---|---|---|---|---|
| `FoldArrowWidget` | `foldFrom`/`foldTo` | in `eq()` + DOM dataset read live | SAFE | offset drives rebuild; handler reads live DOM |
| `HRWidget` | no | n/a | SAFE | pure display |
| `ColumnsWidget` | no | n/a | SAFE | pure display, `ignoreEvent` true |
| `CheckboxWidget` | `pos` | in `eq()` + DOM dataset read live | SAFE | same pattern as fold arrow |
| `ImgWidget` | `from` (hint only) | yes — `_livePos()` (`posAtDOM`) + content guard | SAFE | the reference pattern (A70 fix) |
| `DueDateWidget` | no | n/a | SAFE | pure display, no writeback |
| `QuestionWidget` | `from` | captured but **unused** for writeback; writes via `_replaceInDoc(rawText)` full scan | SAFE | offset is vestigial |
| `TimeRefWidget` | no | n/a | SAFE | pure display |
| `TagWidget` | no | n/a | SAFE | pure display |
| `StatusWidget` | `pos` | in `eq()` + DOM dataset read live | SAFE | same pattern as checkbox |
| `ListMarkerWidget` | no | n/a | SAFE | pure display |
| `MathWidget` | `from`/`to` | captured but **unused**; `makeMathClickHandler` full-scans `docStr.indexOf('$'+latex+'$')` | SAFE | offset is vestigial |
| `WikiWidget` | no | n/a | SAFE | navigation only, no writeback |
| `LinkWidget` | no | n/a | SAFE | navigation only, no writeback |
| `HabitsWidget` | `blockFrom` (hint) | yes — `_replaceInDoc`/inline scan on `rawLine` | SAFE | hint + fallback scan (`eq()` includes `blockFrom`, but even the `updateDOM` reuse path never trusts it directly) |
| `TaskBlockWidget` | `blockFrom` (hint) | yes — inline `doc.indexOf(this.rawMd)` scan | SAFE | hint + fallback scan; `eq()` excludes `blockFrom` on purpose (content-only equality), writeback never trusts it |
| `TableWidget` | none (rawText only) | yes — fresh `full.indexOf(this.rawText)` on every write | SAFE | strongest form of the pattern — no stored offset at all |
| `SupWidget` | no | n/a | SAFE | pure display |
| `HtmlBlockWidget` | no | n/a | SAFE | pure display |
| `DiagramWidget` | no | n/a | SAFE | pure display (mermaid/svg render) |
| `SubWidget` | no | n/a | SAFE | pure display |
| `FnRefWidget` | no | n/a | SAFE | pure display |
| `MathZoneWidget` | no | n/a | SAFE | pure display badge |
| `TimerWidget` | `rawLine` (text, not offset) | yes — `_replaceInDoc(rawLine)` full scan | SAFE | no numeric offset stored at all |
| `PomoWidget` | no | n/a | SAFE | ephemeral in-memory timer, never writes to doc |
| `CalendarWidget` | no | n/a | SAFE | delegates to `FullCalendar`, no CM6 offset writeback |
| `FileLinkWidget` | no | n/a | SAFE | navigation only |
| `WebLinkWidget` | no | n/a | SAFE | opens embedded webview, no writeback |
| `VideoLinkWidget` | no | n/a | SAFE | pure display |
| `makeCheckboxHandler`/`makeStatusHandler`/`makeHeadingFoldHandler` | reads `dataset.pos`/`foldFrom`/`foldTo` | live DOM read, and doc-fresh because widget rebuilds on offset change | SAFE | see widgets above |
| `makeWikiHandler` | no | n/a | SAFE | navigation only |
| `makeMathClickHandler` | no | full-text scan (`docStr.indexOf`) | SAFE | see `MathWidget` |
| `makeTodoHandler`/`makeTaskHandler` | reads `dataset.pos` | live DOM read | SAFE (also currently unreachable — no `.cm-todo-block-w`/checkbox markup is emitted into `.cm-task-board-w` today, so these two handlers are dead code, not a correctness risk) |
| `makeLinkHandler` | no | yes — `view.posAtDOM(el)` then regex-matches the link at that live position | SAFE | live resolution |
| `makeLivePlugin` `build(view)` | n/a (the source of all the above) | n/a | SAFE | fully rebuilt from `state.doc`/syntax tree on every relevant transaction; no cross-call memoization of positions |

**No fixes were needed.** `src/views/NotebookView.jsx` was not modified by this audit.
`npm run build` was run afterward and passed clean (only the pre-existing chunk-size
warnings, no errors).

**Adjacent finding, fixed same day:** the image drag/drop and paste handlers registered
directly in the editor's `extensions` array (not part of `makeLivePlugin`) —
`EditorView.domEventHandlers({ drop, paste })` around the `saveNotebookImage` calls. On
inspection, `paste` was already safe — it reads `view.state.selection.main.head` *after* the
`await saveNotebookImage`, so it's always current. `drop`'s image-save branch was not: it
captured `dropPos` via `posAtCoords` *before* `await saveNotebookImage`, then reused it
unclamped. Fixed by re-clamping (`Math.min(dropPos, view.state.doc.length)`) at each dispatch
site inside that async branch, so a doc-length change during the await can't produce an
out-of-bounds `from`. `npm run build` passed clean afterward. Narrower than A70 either way —
plain insert, not a slice/replace — but now closed instead of deferred.

## 2.6 Offline-first

Local Yjs doc is always authoritative for the local user; queue updates while offline and
sync on reconnect — the CRDT merges them without conflict. Collaboration must be **fully
optional**: an unshared note never touches the network.

---

## 3. Data model changes

| Where | Field | Purpose |
|---|---|---|
| `nb_index[id]` | `contentHash` | change detection that survives iCloud mtime rewrites |
| `nb_index[id]` | `shared?: { roomId, role }` | which notes are live-shared (no key — see below) |
| preferences | `identity: { displayName, publicKey }` | presence |
| **keychain / secure store** | room keys | **never** in the archive or a synced JSON |
| `appDataDir/history/<id>/` | version snapshots | silent-merge safety net |
| `appDataDir/crdt/<id>.y` | CRDT state | live session, disposable |

Archive stays **pure markdown**. Every new artifact is derived, disposable, and outside it.

---

## 4. Threat model (short)

- Relay is **untrusted** — sees ciphertext + room ids only.
- Link possession = access; treat links as secrets (they contain the key).
- No E2E identity verification in v1 — a leaked link means a silent reader. Acceptable for
  v1, must be stated in the UI ("anyone with the link can edit").
- Local history is plaintext on disk, same trust level as the archive itself.

---

## 5. Failure modes to design for

| Failure | Behaviour |
|---|---|
| Relay down | editing continues locally; queue + resync |
| Two peers edit the same word | CRDT converges; no prompt (by design) |
| CRDT state corrupt | discard it, rebuild from markdown |
| History dir grows | thinning + per-note cap |
| Peer on an old app version | version the update protocol; refuse mismatched rooms with a clear message |

---

## 6. Sequencing

| Step | Scope | Risk | Value |
|---|---|---|---|
| **1** | ✅ **DONE** — `writeAtomic` + `contentHash` detection (`src/lib/storage.js`) | low | correctness everywhere; good standalone win |
| **2** | ✅ **DONE** — `history.js` snapshots + retention | low | **prerequisite for silent merging** |
| **3** | ✅ **DONE** — `merge3()` + silent merge in save & watcher | medium | **fixes B**, ends the fork problem |
| **4** | ✅ **DONE** — History panel (timeline, diff, restore) — `NotebookHistoryPanel` in `src/views/NotebookView.jsx` | medium | the retrospective chooser |
| **5** | ✅ **DONE (2026-08-17)** — Offset audit of the widget layer | medium | **gate for step 6** — prevents an A70 repeat |
| **6** | ✅ **DONE (2026-08-17)** — Yjs ↔ CM6, local only (two panes) | medium | proves the binding, improves A |
| **7** | ✅ **DONE (2026-08-18)** — Relay + encrypted transport + presence | high | **C** |
| **8** | ✅ **DONE (2026-08-18)** — Share links, roles, key rotation | high | real multi-user |
| **9** | ✅ **DONE (2026-08-18)** — Host-mediated role enforcement (Option A) | high | closes §14.4's UI-only-enforcement gap for the normal code path |

Steps 1–3 deliver the whole of today's problem. Step 5's audit (see §2.5.1) found every
widget already safe — no `NotebookView.jsx` changes were needed. Step 6 is now unblocked
and done — see §6.1. Step 7's transport + presence are proven for real, cross-device — see
§6.2 — with the fallback relay, default-server reliability, joiner-approval, and session
lifecycle pieces still open as separate work, not blockers on what step 7 itself asked for.
Step 8 proved the joiner-approval + roles + key-rotation piece step 7 left open — see §6.3.
**Still harness-only** — none of steps 6–8 are wired into `NotebookView.jsx` or production;
that wiring is unscheduled follow-on work, not part of this table.

### 6.1 Step 6 — Yjs ↔ CM6 proof rig (2026-08-17)

`src/dev/YjsProofHarness.jsx` — deliberately **standalone**, not wired into `NotebookView.jsx`
or any storage path. Mounted only behind `?yjsProof=1` in `App.jsx` (checked before any hooks
run, so the normal render path is untouched), lazy-imported so `yjs`/`y-codemirror.next` never
enter the main bundle otherwise.

Two independent `Y.Doc` + `Awareness` pairs (not a shared object reference — that would prove
nothing about the sync protocol), each bound to its own CM6 `EditorView` via `yCollab`.
Connected by a same-tab "loopback" — a plain function call forwarding Yjs update bytes and
awareness bytes both ways — deliberately the exact shape a real transport (step 7) will
occupy later: swap the function body for a socket, nothing else changes.

**Verified live in the browser preview:**
- Typing in Pane A appears in Pane B (and vice versa) with no explicit save/sync action.
- Concurrent edits to the same line from both panes converge deterministically — both
  insertions land, no merge dialog, no history entry (unlike Stage 1 — there is nothing to
  reconcile, both sides already agree by construction).
- Remote peer cursor renders in the other pane via awareness (`user.name`/`color`).
- `npm run build` passes clean.

**A real bug the rig surfaced (worth keeping, not just a footnote):** the first version
seeded both peers independently with the identical string *before* wiring the loopback. That
gave each `Y.Doc` its own unrelated op history that only coincidentally rendered the same
text. When A's later edits referenced CRDT neighbors (its own seed-insertion ops) that B had
never received, `Y.applyUpdate` on B accepted them silently into `pendingStructs` and just
never applied them — no error, no console warning, permanent divergence. The "converged"
indicator sat on "diverged" for 30+ checks with zero signal why.

Fix: wire the loopback first, then seed **once, from one side only**, after listeners exist.
Lesson for step 7: forwarding live deltas alone is not sync — a peer joining a session that
already has history needs an explicit state-vector exchange (`Y.encodeStateVector` /
`Y.encodeStateAsUpdate` diff) on connect, exactly what `y-webrtc`/`y-websocket` providers do
and this loopback deliberately does not (both peers exist before either has content, so it
never needed to). Don't skip that exchange when step 7 lands.

Retire `src/dev/YjsProofHarness.jsx` and the `?yjsProof=1` guard in `App.jsx` once step 7's
real provider replaces the loopback — its job here is done.

### 6.2 Step 7 — relay + encrypted transport + presence (2026-08-17, partial)

`src/dev/YjsRelayHarness.jsx` — same standalone-dev-rig rules as §6.1 (behind `?yjsRelay=1` in
`App.jsx`, lazy-imported, no production wiring). This one swaps the same-tab loopback for a
**real** transport: `y-webrtc`'s `WebrtcProvider` against its own default public signaling
server (`wss://y-webrtc-eu.fly.dev` — free, community-run, sees room id + ciphertext only).

**Encryption is real, not a placeholder.** `WebrtcProvider`'s `password` option (we generate a
random key and pass it here) derives an AES-256-GCM key via PBKDF2 (`key + roomName` as salt,
100k iterations — see `node_modules/y-webrtc/src/crypto.js`) and encrypts every signaling AND
webrtc payload with it. The key lives only in the URL fragment (`#key=...`, never sent to any
server on navigation); the room id lives in the query string, which is fine — room ids are
meant to be opaque, not secret. This is exactly §2.3's capability-link model, now load-bearing
instead of just described.

**Verified live, two separate browser tabs, same room link:**
- Both connect to the signaling server, discover each other, converge on identical content —
  including the same divergence-then-seed hazard as §6.1's rig if seeded wrong (fixed the same
  way: seed once, after connecting).
- Presence (name/color) and a remote cursor render across the real connection.
- Typing in either tab lands in the other with no explicit save/sync.

**Two real bugs this surfaced, both fixed (not just this rig's problem — anything hosting a
`WebrtcProvider` in a component the runtime can remount is exposed to the second one):**

1. *(Same species as §6.1's seeding bug.)* Nothing new here — carried the "wire before seed"
   fix forward.
2. **New, sharper one:** `Room.disconnect()` (called from `provider.destroy()`) does
   `awarenessProtocol.removeAwarenessStates(awareness, [clientID])` — it deletes the *local*
   client's entry from whatever `Awareness` object it was given. `WebrtcProvider`'s room is
   created **asynchronously** (the PBKDF2 key derivation is a promise), so that disconnect can
   fire *after* a later mount already set local presence — if both mounts share one `Awareness`
   instance. React 18 dev StrictMode's mount→cleanup→mount makes this concrete and 100%
   reproducible: the first (discarded) provider's async room-creation finishes late, sees it
   was already told to disconnect, and wipes presence — sometimes after the second, actually-live
   provider already set it. Result: local presence silently absent, own cursor never appears to
   peers, zero error, zero console warning. Fix: **scope a fresh `Awareness` instance to each
   effect run** (1:1 with its own provider) instead of sharing one across remounts — a discarded
   provider's delayed cleanup then only ever touches its own already-abandoned object. This is a
   real hazard for anything that mounts a `WebrtcProvider` inside a React effect, not specific to
   this rig; worth remembering wherever step 7's real UI ends up living.

**First pass was same-browser only.** Multiple tabs in one browser instance rode `y-webrtc`'s
same-origin `BroadcastChannel` fast-path (`bcConns`), not `webrtcConns` — a real, useful path on
its own (e.g. Gnos open in two windows on one device) but not proof of actual cross-device
WebRTC.

### Real cross-device verification (2026-08-18) — DONE

Tested for real: this Mac ↔ Ethan's phone, same WiFi, genuinely separate devices and network
stacks. `room.webrtcConns` populated with a real peer connection id (not `bcConns`), and typed
text ("Hello Claude!") crossed from the phone to the desktop tab with no explicit save/sync.
**This is the actual thing step 7 needed to prove**, and it now has.

Getting there needed infrastructure this session doesn't keep, worth remembering if revisiting
this architecture:

- **The public default signaling server went down mid-test.** `wss://y-webrtc-eu.fly.dev`
  (free, community-run, no SLA) started timing out on every connection attempt partway through
  this session — not a one-off blip, sustained across retries. `WebrtcProvider`'s `connected`
  getter is misleading here: it means "room object exists," not "signaling actually succeeded"
  (the library's own doc comment says as much) — both sides showed green "connected" while
  neither could reach the server. **Confirms §8's own conclusion, sooner than expected: the
  free public default is not reliable enough to depend on, even for testing, let alone product.**
- **Worked around it by running y-webrtc's own tiny signaling server** (`bin/server.js` in the
  npm package — ~100 lines, in-memory topic pub/sub) locally instead. Real fallback-relay work
  (§8) still needs an actual deployment decision (Cloudflare Worker / Deno Deploy, needs an
  account) — this was just a throwaway local stand-in to unblock the test, not that.
- **Mobile needs a secure context, and a raw LAN IP over `http://` isn't one.**
  `WebrtcProvider`'s `password` option derives its key via `crypto.subtle` (PBKDF2), which
  browsers disable outside HTTPS/localhost. On an insecure origin it throws *synchronously*
  inside the mount effect, with no error boundary — React unmounts the whole tree, and the
  visible symptom is just a blank/dark screen, no console hint on the device itself. Added a
  `window.isSecureContext` guard to `YjsRelayHarness.jsx` that renders an explicit message
  instead of blank-screening — a real robustness fix, not just a workaround for this test.
- **A self-signed cert's trust exception is scoped per exact origin (host *and* port), and a
  WebSocket has no click-through UI for a TLS failure.** Accepting the warning for the app page
  (`:5191`) did not extend to the signaling server (`:4444`) on the same host — the WS just
  failed silently, no dialog, same as it did in this session's own sandboxed test browser
  earlier. Fix on mobile: visit the signaling server's bare HTTPS URL directly first (any normal
  page load, accept its warning), *then* load the app — only after that does the WebSocket to
  that origin succeed. None of this friction exists with a real CA-signed cert (production would
  never hit it) — it's purely a self-signed-LAN-testing artifact, but a sharp one if this comes
  up again.
- Also had to bind Vite to `0.0.0.0` (not just `localhost`) and, since the sandboxed test browser
  in this session refuses to navigate to any self-signed-cert origin at all (no click-through
  available to automation), ran the signaling server with **two listeners sharing one in-memory
  room state** — `wss://` with the cert for the phone, plain `ws://` for the sandboxed side —
  rather than needing the sandbox to trust a cert it structurally can't.

**Still open before step 7 is fully done (transport + presence are now proven; these are the
remaining, separate pieces):**
- Real fallback WS relay when P2P/STUN fails (~10–20% of networks, §8) — *our own* deployment,
  an account/ops decision, not code written yet. Today: no fallback, a blocked network just
  hangs at "connecting."
- A production-grade default signaling server — the public free one has now been observed going
  down mid-session; don't ship depending on it alone.
- ~~Host-approves-joiner flow (§14.1)~~ — done, see §6.3.
- Live-Share session lifecycle (§13) — no "host ends session, room dies" yet; the room persists
  per the signaling server's own bookkeeping.

### 6.3 Step 8 — approval, roles, key rotation (2026-08-18)

Extended `src/dev/YjsRelayHarness.jsx` in place — same standalone-dev-rig rules as §6.1/§6.2
(behind `?yjsRelay=1`, lazy-imported, no production wiring). Chose to extend the harness
rather than wire a real Share button into `NotebookView.jsx` — consistent with how 6/7
shipped (prove the mechanic in isolation first), and step 8's own table entry doesn't demand
production wiring, just "share links, roles, key rotation" as CRDT-native mechanics. Wiring
into the real editor is unscheduled follow-on work, not part of this table.

**§14.1's join flow, implemented as a shared `access` Y.Map** (`{clientId: {name, role,
status}}`) rather than a server: opening a link doesn't hand you the document. A guest's row
starts `pending`; only the host is expected to flip it to `approved` + a role. This is a
convention enforced by the harness's own UI, **not a security boundary** — anyone with
devtools could write their own row directly. Real enforcement needs signed updates (§14.4's
own stated limitation, carried forward honestly rather than glossed over).

**Verified live, two tabs, real host-approval round trip:**
- Guest opens the link → lands on a name-entry screen, then a "waiting for host approval"
  screen — sees no document content until approved (`useAccessControl`'s `mine.status`
  gate runs before the `Editor` ever mounts for a pending guest).
- Host sees "Sam wants to join" with **Approve · Editor / Approve · Viewer / Deny** inline.
- Approved as **viewer**: guest's CM6 instance mounts with `EditorState.readOnly.of(true)` +
  `EditorView.editable.of(false)` — typed keystrokes are dropped locally, confirmed by
  reading the doc text back unchanged. Awareness/cursor still shows (§14.4: viewer sees
  everything, writes nothing).
- **Live-upgraded** the same guest to **editor** via a role `<select>` on the host's already-
  approved row (no reconnect) — the guest's `Editor` remounts (readOnly is in its effect
  deps) and typed text now lands in the shared doc, visible on the host's pane in real time.
- **Kick**: host sets an approved row to `denied` — the guest's own effect (`mine.status ===
  'denied'`) calls `disconnect()` (`provider.destroy()`) and renders an "Access denied,
  ask for a fresh link" screen. No auto-reconnect attempt.
- **Key rotation**: host-only button, confirms ("every current link stops working"), mints a
  fresh room + key and does a full `window.location.href` navigation — simplest correct way
  to tear down every hook/provider/doc and rebuild clean, rather than hand-rolling in-place
  teardown. Verified the host's own reload of the *new* URL still renders the host panel
  (the `sessionStorage` host flag is written *before* navigating, keyed by the new room id) —
  a real risk this session specifically checked for, since it's exactly the kind of "host
  demoted to pending guest of their own new room" bug a naive rotation would produce.

**Two honest limitations carried forward, not fixed here (both already named in
PLAN_CONCURRENCY.md §14.4 and this file's own header comment, not new discoveries):**
1. Role enforcement is UI-level (`readOnly` on the guest's own CM6 instance), not a signature
   check rejecting a viewer's writes at the CRDT layer. A modified client could still emit
   Yjs updates; other honest peers would currently apply them. Fine for a proof, not for
   production without signed updates.
2. "Host" is decided by a `sessionStorage` flag written at room-mint time — convenient for a
   proof, trivially spoofable, not a real identity/authority boundary.

`npm run build` passes clean (only the pre-existing chunk-size warnings). Screenshots and the
two-tab approve/viewer/editor/kick/rotate sequence above were verified in the browser preview
this session, not just read from source.

### 6.4 Step 9 — host-mediated role enforcement (2026-08-18)

§6.3 flagged role enforcement as UI-only (`readOnly` on the guest's own CM6 instance) — a
viewer's *own* client had nothing stopping a hand-crafted write. Chose **Option A: host is
the sole applier of `Y.applyUpdate` to the canonical doc** over signed capability tokens —
cheaper, matches Live-Share semantics already decided (§13), and this app only ever needs
"Ethan + a handful of collaborators" (§8). Real production want: permanent per-file invites
managing different documents — noted as a later want, not designed yet, doesn't change this
shape (a room already models `docs: Map<docId, Y.Doc>`, §11).

**Why this needed a real architecture change, not a filter.** `doc.on('update', (update,
origin) => …)` cannot tell *which* peer sent a remote update — confirmed by reading
`node_modules/y-webrtc/src/y-webrtc.js`: `readSyncMessage(decoder, encoder, doc, room)` is
called with `room` as origin for every remote peer alike, sender identity is discarded by the
time it reaches the doc. So an editor guest's CM6 was rearchitected to bind to a **local-only
`draftDoc`** (never bound to `WebrtcProvider`, so nothing typed there can auto-broadcast).
Local edits are relayed to the host as proposals over `awareness` instead — unlike a doc
update event, an awareness state **is** keyed by clientID (`Map<clientID, state>`), so sender
attribution is real. `useHostRelay` is the one place `Y.applyUpdate` is ever called for
content that didn't originate on the host's own machine: it checks the proposer's role in
`accessMap` and drops anything not `'editor'` before it ever reaches the canonical doc.

**A real bug this surfaced, same species as §6.1's divergence bug, self-inflicted by a
different route this time:** the first version seeded `draftDoc` by reading canonical text
and doing `delete(0, len); insert(0, text)` — which inserts the text as *brand-new* items
under `draftDoc`'s own client id. Every later keystroke's delta (only the delta since a
post-seed state vector is sent, to keep proposals small) then anchors to those brand-new
items — which the host's canonical doc never received, since only the delta was ever sent,
not the seed. `Y.applyUpdate` doesn't error on a missing dependency; it buffers the op into
`pendingStructs` and never integrates it. No exception, no console warning, text silently
never arrives — verified via live `console.log` instrumentation that the relay *fired*,
`accessMap` lookup was correct, `Y.applyUpdate` threw nothing, and the canonical doc's text
was still unchanged. Exactly §6.1's "seed once, from one side only" lesson, recurring in a
new shape. Fix: seed `draftDoc` by **importing the canonical doc's actual CRDT state**
(`Y.applyUpdate(draftDoc, Y.encodeStateAsUpdate(peer.doc), RESEED_ORIGIN)`) instead of
re-typing its text — later local inserts then anchor to items the host already has, so every
delta a guest proposes is dependency-complete. Also strictly better than the text-replace it
replaced: it's a real CRDT merge instead of a wholesale overwrite, so it no longer stomps a
guest's in-progress local edit on every remote change.

**Verified live, two tabs, full role-enforcement round trip:**
- Editor guest's keystrokes land in `draftDoc` locally, get relayed via `awareness`, and show
  up on the **host's** canonical doc — confirmed the text arrived through the host's own
  `Y.applyUpdate` call, not a direct mesh write, by reading `accessMap`/`awareness` state
  directly via devtools mid-test, not just trusting the rendered result.
- **Live role downgrade**: flipped the same connected guest from editor → viewer via the
  host's role `<select>` — `RelayedEditor` unmounted, plain read-only `Editor` mounted in its
  place, content preserved, "view only" badge shown, no reconnect needed.
- Host's own typing is untouched — host was never routed through the relay, it edits the
  canonical doc directly as before (host is trusted by construction, per §13/§14.4).

**Residual gap from this pass — closed same day, see §6.5.** Left here for the historical
record: at this point, every participant in the single shared WebRTC room still held a live
*read* reference to the canonical doc, and nothing stopped a hand-crafted script from writing
to that reference directly, bypassing the relay app-code path entirely.

`npm run build` passes clean. Verified in the browser preview this session (not read from
source): host-applies-not-guest-broadcasts, live editor→viewer downgrade, host's own typing
unaffected.

### 6.5 Residual gap closed — private `canonicalDoc` (2026-08-18)

§6.4's relay was correct but pointed at the wrong doc: `useHostRelay` applied accepted guest
proposals into `doc` — the *same* `Y.Doc` bound to `WebrtcProvider` that everyone, including
guests, holds a live reference to for reading. A hand-crafted script calling
`ytext.insert()` directly on that reference (skipping the app's `draftDoc`/relay path
entirely) would mesh-broadcast unconditionally — confirmed by reading
`node_modules/y-webrtc/src/y-webrtc.js`: `readSyncMessage` applies incoming bytes to
`room.doc` with no per-sender check at all.

**Fix: split the doc, not filter the write.** `netDoc` (renamed conceptually, same object as
before — still bound to `WebrtcProvider`, still what every peer connects through) is now
purely a *broadcast* copy. `useCanonicalDoc` gives the host a second, private `canonicalDoc`
— a plain `Y.Doc` **never bound to any provider, ever**. Host's own typing and
`useHostRelay`'s accepted guest proposals both go into `canonicalDoc` only; a one-way mirror
(`canonicalDoc.on('update', …) → Y.applyUpdate(netDoc, Y.encodeStateAsUpdate(canonicalDoc),
'host-mirror')`) pushes accepted content out to `netDoc` so guests keep seeing it exactly as
before, zero changes needed on the guest side. There is no longer a filter to bypass, because
there is no inbound path to `canonicalDoc` at all except the two the host's own code controls.

**A bug this surfaced, same species as §6.1's/§6.4's, a third recurrence via a third route:**
initial seeding raced the same way *within a single doc* — `useCanonicalDoc`'s seed-effect and
mirror-effect both needed to see the SEED insert. Non-issue once written correctly (seed, then
mirror, same synchronous effect, no timer) — noted only because the instinct to reach for a
`setTimeout` here (matching the old netDoc-seeding code this replaced) would have reintroduced
the exact class of bug the private doc was supposed to make structurally impossible.

**Verified live, not just reasoned about — this was the actual point of the exercise:**
- Normal path unaffected: host's own typing, guest→host relay (`SPLIT-DOC-VERIFIED`), and the
  mirror out to guests (`HOST-EDIT-OK` visible in the guest's pane) all still work.
- **Attack simulation**: from the guest's own devtools, called
  `window.__yjsRelayDebug.doc.getText('codemirror').insert(0, 'HACKED-DIRECT-WRITE ')` —
  i.e. wrote directly to `netDoc`, bypassing `draftDoc`/the proposal relay entirely, exactly
  the bypass the residual gap named. Confirmed the text **did** reach the host's `netDoc`
  (the mesh, as expected — that's the remaining smaller gap, below) but **never appeared** in
  what the host's own editor actually renders (`canonicalDoc`, read back via the page's own
  visible text, not just an internal doc dump).

**What's still open, correctly scoped as smaller than what this closed:** `netDoc` remains
one shared mesh room, so a rogue write like the one above still reaches every *other* guest's
`netDoc` — confusing what other low-trust participants see. It can no longer reach the
document that's actually authoritative. Fully isolating guests from each other needs
per-guest 1:1 "star" rooms instead of one shared mesh room — a real, separate, larger
transport change, not done here. Also unaffected by this fix, still true: viewer/pending
proposals were already dropped at the `accessMap` role check (§6.4), host authority is still
a spoofable `sessionStorage` flag (file header), and the app itself is still not wired into
`NotebookView.jsx` — all separate, already-tracked items.

`npm run build` passes clean.

### 6.6 Production wiring — NotebookView.jsx + web guest client (2026-08-18)

Went further than the table above asked: wired the proven engine into the real app instead of
leaving it harness-only.

**Extracted the engine** — `usePeer`/`useAccessControl`/`useCanonicalDoc`/`useHostRelay` moved
into `src/lib/collab/engine.js` (+ `ids.js`, `CollabEditor.jsx`) so the harness, the desktop
host wiring, and the web guest client all share one already-verified implementation instead of
diverging copies. Harness re-verified end to end afterward — identical behavior.

**Host side — `NotebookView.jsx`:** "Start Live Share…" in the existing Share menu opens
`src/components/NoteCollabPanel.jsx` (link, approve/deny, roles, kick, rotate — styled to match
`NotebookHistoryPanel`'s own language, not the harness's placeholder look). The host's REAL
editor binds to `canonicalText` via a CM6 `Compartment`, added as a single inert slot in the
existing extensions array (`collabCompartment.of([])` when not sharing — zero behavior change
for the overwhelming majority of notes that never share) and reconfigured in place — no
remount, so starting/stopping a share never costs the host their cursor, scroll position, or
undo stack. Guest edits arrive as ordinary CM6 transactions, so the existing autosave
(`updateListener` → `contentRef` → `scheduleSave`) already persists them — no new save path.
`yjs`/`y-webrtc`/`y-codemirror.next` are lazy — confirmed via build output that
`NotebookView`'s own chunk grew by ~2KB while a new ~112KB chunk split out separately, so a
user who never shares never pays for any of it.

Caught and fixed one real bug before it shipped: the panel's close button and backdrop did
`onClick={onClose}`, which forwards the DOM click event as `onClose`'s first argument — since
`onClose(ended)` treats a truthy `ended` as "the session actually ended," a plain click to
dismiss the panel would have silently ended the whole share. Fixed to `onClick={() =>
onClose?.()}`.

**Live-verified by the user, in the real desktop app** (this session had no way to run the
Tauri shell itself — the browser-preview tool only reaches the plain web build, which never
gets past its own splash screen without `window.__TAURI__.invoke`): host's own editing is
unaffected with the panel open or closed, panel opens/closes cleanly. Per their follow-up
feedback, replaced an initial pulsing "Live" text pill with a plain icon-only button (two-
person glyph, small count badge only when guests are actually connected) — ambient reminder
that survives closing the panel, `position: absolute` within `.nb-root` (not `fixed` to the
window) so each pane in a split view gets its own, correctly scoped indicator.

**Guest side — `collab.html` + `src/collab-main.jsx` + `src/collab/`:** the §7 web guest
client, a genuinely separate Vite entry (`vite.config.js`'s `build.rollupOptions.input`) that
never imports `useAppStore`/`storage.js` — a guest touching disk is structurally impossible,
not just avoided by convention. Parses `/join/<roomId>#key=<key>` (matching what
`NoteCollabPanel` generates) and, since no hosting/rewrite rules exist yet (§6's step-8 table
item, unstarted), also accepts `?room=<roomId>` as an equally-valid form — not a test shortcut,
a real fallback that works with zero server-side routing config. Join → waiting-room →
role-gated editor, using `CollabEditor.jsx`'s plain `Editor`/`RelayedEditor` (markdown syntax
highlighting, not Gnos's full widget/decoration pipeline — see the file's own header for
exactly what that trades away: mermaid and wikilinks render as literal text to a guest today,
a real, separate, larger piece of work to close. Images are handled — see §6.7.)

**Verified live, real end-to-end test:** hosted from `src/dev/YjsRelayHarness.jsx` (still using
the identical engine, so this is a meaningful cross-implementation test, not host-testing-
itself), joined from `collab.html` in a separate tab, approved as editor, typed
`GUEST-CLIENT-VERIFIED` in the new guest client — landed on the host's canonical doc through
the same host-mediated relay path proven in §6.4/§6.5.

**Still open at this point:** asset upload for referenced local images (§7's own "asset
problem" — closed same day, see §6.7), the §14.5 "keep a copy" download prompt on session end,
and actual hosting/deployment to getgnos.com (§15) — the last one needs the user's own
hosting-account decision, not just code.

`npm run build` passes clean.

### 6.7 Asset upload — §7's "asset problem" (2026-08-18)

§10 resolved this as option (1): collect referenced local images on share, publish them into
the room encrypted with the room key, oversized ones fall back to a placeholder. Built both
halves.

**Host side — `src/lib/collab/hostAssets.js` (Tauri-only, isolated on purpose):** scans the
note for local-looking `![alt](src)` refs (skips `http(s):`/`data:` — those need no upload at
all, see below), reads each via `@tauri-apps/plugin-fs` `readFile` resolved against
`notebookDirRef.current` (the same resolution `resolveImgSrc` already uses elsewhere in
`NotebookView.jsx`), and publishes bytes into `netDoc.getMap('assets')` — never `canonicalDoc`,
which is deliberately unreachable from the network at all (§6.5); assets need guests to
actually read them. A 2MB-per-image cap (a starting point, not a measured limit) routes
anything bigger into `assetsMeta` as `{oversized: true}` instead, so a guest can tell "too big"
from "still arriving" apart. Wired from `NoteCollabPanel.jsx`: scans once on share start and
again (debounced) on every later change to the canonical text, so an image the host adds
mid-session gets picked up too. This file is imported ONLY from `NoteCollabPanel.jsx` — never
from `engine.js` or `CollabEditor.jsx`, which the web guest bundle also imports; a guest
reading a real filesystem path must stay structurally impossible, not just unused in practice.

**Guest side — `src/lib/collab/assetsPlugin.js`:** a CM6 `ViewPlugin` for `CollabEditor.jsx`'s
plain `Editor`/`RelayedEditor` (opt-in via a new `assets` prop — omitted entirely for e.g. the
harness's own throwaway proof room). Remote `http(s)`/`data:` images render directly, no room
involvement needed — free, the guest's own browser just fetches them. Local-looking refs look
up bytes in the `assets`/`assetsMeta` maps: present → real `<img>` from a `Blob`/object URL;
`oversized` → a clear "too large to preview" placeholder; neither → "not available yet" (covers
both "host hasn't published it yet" and "host never had it" — no way to tell those apart from
here, so the label stays honest rather than claiming certainty it doesn't have). Rebuilds
decorations on ordinary CM6 doc changes AND on the Yjs maps' own changes (an out-of-band event
CM6 doesn't know about on its own — an empty `view.dispatch({})` is the standard way to make
CM6 re-run its update cycle for a purely external state change).

**Verified live:** typed a remote-image markdown ref (`https://picsum.photos/…`) into the
harness's host editor — the guest client (`collab.html`) rendered a real `<img>`, not literal
text. Typed a local-looking ref with nothing published (nothing publishes assets in the harness
context) — guest correctly showed "🖼 local — not available yet," not broken text, not a crash.
The Tauri-dependent host-side collection/publish half (`readFile` off real disk) could not be
exercised in this sandbox, same limitation as §6.6's host-side verification — reviewed against
the existing, working `readFile`/`saveNotebookImage` pattern already used elsewhere in
`NotebookView.jsx` rather than invented fresh.

`npm run build` passes clean.

### 6.8 Guest "keep a copy" prompt — §14.5 (2026-08-18)

Built in `src/collab/GuestApp.jsx`: `SessionEndScreen`, shown whenever a guest's session ends —
covers both directions §14.5 asks for, one screen, not two. Host-initiated (deny, or
`NoteCollabPanel`'s rotate-key ending the session outright) and guest-initiated (a new "Leave"
link in the connected view's status bar) both land here. Snapshot of `peer.ytext`/the assets map
is taken *before* `peer.disconnect()` — safe either order since disconnecting only kills the
network connection, the in-memory Y.Doc is untouched, but taking it first matches the actual
intent ("what this guest last saw") rather than relying on that.

Markdown-only download when the note has no local images (`Blob` + `<a download>`, no extra
weight); `.zip` (note + an `images/` folder) when it does, via `jszip` — already a project
dependency used elsewhere, lazy-imported so the guest bundle's base weight is unaffected unless
a download with assets actually happens. Note title comes from the first `# heading` line in
the content, falling back to "shared note". Entirely client-side, per §14.5 — nothing new is
uploaded or stored anywhere; the guest's browser already held everything being offered.

**Verified live, both paths:** guest-initiated Leave → prompt shows "Keep a copy of "<title>"?"
→ **Download .md** → confirmed `Saved` state, correct filename derived from the note's own
heading. Re-ran with a fake asset injected into the guest's own `assets` map (devtools,
`doc.getMap('assets').set(...)`, since the Tauri-dependent host-publish half can't run in this
sandbox — see §6.7) → prompt correctly read "Includes 1 image" and offered **Download .zip**
→ completed, confirmed the `jszip` chunk loaded (200, after a false-alarm 404 from a stale
`dist/` mid-session — a concurrent process had cleared it; rebuilding fixed it, not a bug in
this code) and the flow reached `Saved`.

`npm run build` passes clean.

### 6.9 Deploy prep — task #6, repo side (2026-08-18)

Decided: **Cloudflare Pages, its own project, `join.getgnos.com`** — free either way (a
subdomain of a domain you already own costs nothing extra), independent of `gnos-landing`'s
own host (currently Firebase, a Hostinger/Cloudways move under consideration) and of any
migration timeline. No account/DNS access in this session, so this is the repo-side half only.

**A dedicated build, not a slice of the desktop app's `dist/`.** The multi-entry `dist/` from
`vite.config.js` bundles `collab.html` alongside the ENTIRE desktop app — Excalidraw, mermaid,
pdf.js, algebrite, KaTeX, every view. None of it is reachable from `collab.html`, none of it
needed by a guest joining a note; deploying that whole thing to serve one small page would be
real, needless weight and would publicly expose the desktop app's bundle for no reason.
`vite.collab.config.js` builds `collab.html` alone to its own `dist-collab/` — confirmed by
building it: **5 files, 1.0MB (≈330KB gzipped)**, vs. the 40+ chunks / many MB of the full
`dist/`. `jszip` still lazy-splits correctly in this build too (its own chunk, not bundled into
the main one) — the boundary from §6.8 holds regardless of which config builds it.

- `public-collab/_redirects` — Cloudflare Pages' rewrite-rule convention: `/* /collab.html 200`
  (a "200 rewrite," not a redirect — the URL in the browser never changes, only which file is
  served, so `GuestApp.jsx`'s own `window.location.pathname`/`hash` parsing sees the real
  `/join/<roomId>#key=<key>` URL untouched). A single catch-all is enough — `GuestApp.jsx`
  already handles "no room/key in the URL" with a clear message, not a crash, so a narrower
  `/join/*`-only rule would add nothing.
- `collab.html`'s favicon changed from `/book.svg` (confirmed via `find` — that file doesn't
  exist anywhere in the repo, a pre-existing broken reference in the main app's own
  `index.html`, not introduced here) to an inline data-URI SVG, so this page never 404s on it
  regardless of deploy target.
- `npm run build:collab` (new script) → `dist-collab/`. `.gitignore` updated.
- `.claude/launch.json` gained a `gnos-collab-preview` entry (`vite preview --config
  vite.collab.config.js --port 4174`) for local checks — **`_redirects` itself only works on
  real Cloudflare Pages hosting**; confirmed `vite preview` doesn't interpret it (root `/`
  404s locally, expected) and confirmed the page itself is correct by hitting `/collab.html`
  directly — join screen rendered, correct title, no console errors.

**Still needed, not code — the user's own account/DNS steps:** create the Cloudflare Pages
project (git-connected to `github.com/GnosApp/Gnos`, build command `npm run build:collab`,
output directory `dist-collab`), add it as a custom domain (`join.getgnos.com`), and add the
one CNAME record wherever `getgnos.com`'s DNS currently lives. None of this needed moving
`gnos-landing` or its hosting.

### 6.10 Guest UI pass — brand + minimal toolbar (2026-08-18)

Two rounds of feedback after seeing the pages live. First: quill logo + "Gnos" wordmark added
to every guest screen (`Logo()` in `GuestApp.jsx`, same hand-drawn quill as
`src/components/icons.jsx`'s `IconQuill`, inlined rather than imported — one static SVG isn't
worth pulling in `lucide-react`'s provider setup for), copy trimmed to one line per screen
throughout. Second, after seeing the connected view: redesigned to actually look like a real
notebook rather than a proof-rig text box, plus the two toolbar buttons the user asked for by
name, with their real functionality from the app carried over faithfully — not just visual
lookalikes:

- **`CollabEditor.jsx`'s `notebookTheme()`** — copied `NotebookView.jsx`'s own `.nb-cm` layout
  tokens (`--nb-max: 780px`, `--nb-px: 48px`, `--nb-lh: 1.8`) into the CM6 theme, dropped
  `lineNumbers()` (the real notebook editor never had one either — a proof-rig affordance, not
  a design choice worth keeping), dropped the colored border-box wrapper. Font-family is NOT
  copied (`'Stack Sans Text'`/`'Switzer'` are the self-hosted webfont files this page
  deliberately never loads) — falls through to system sans, same rhythm, none of the weight.
  Shared by the harness too (same component), which now also looks better for free.
- **Quill button** = `NotebookView.jsx`'s real `ViewModeBtn`, specifically: `IconQuill` is
  confirmed (`icons.jsx`'s own comment, `MODE_META`) to literally BE that button's "Live" mode
  icon, and `Eye` its "Preview" icon — same two glyphs, same swap-on-click behavior here.
  What's real, not just visual: clicking actually toggles a working **Preview mode** —
  `src/collab/renderMarkdown.js`, a compact, self-contained markdown→HTML renderer (headings,
  bold/italic/strikethrough, code, links, lists, blockquotes, rules, and images through the
  same `assets`/`assetsMeta` maps `assetsPlugin.js` already reads) — NOT
  `NotebookView.jsx`'s own `inlineToHtml` (coupled to wikilink/notebook context a guest
  doesn't have; reusing it wasn't an option). Escape-first ordering (`esc()` before any markup
  substitution) — same safety pattern the real renderer uses, not a new one invented here, so
  `dangerouslySetInnerHTML` is safe against the note's own content.
- **Users button** = the connected-participants concept, same `Users` glyph
  `NotebookView.jsx`'s own ambient Live-Share indicator uses (inlined, same reasoning as the
  quill). Click opens a popover listing everyone `approved` (name + role, "(you)" on the
  guest's own row) — genuinely reading `access.entries`, not a static mock. Per the specific
  ask: **"Leave the room" now lives at the bottom of this popover**, replacing the old
  always-visible text link — same `setLeftManually(true)` call, same §14.5 keep-a-copy screen
  on the way out, just relocated. The old inline status row (connected dot, "View
  only"/"Editing" text) is gone entirely — a real notebook doesn't show persistent status
  text either, and disconnection already routes to its own full-screen state regardless.

**Verified live, full round trip:** hosted from the harness, joined from `collab.html`,
approved as editor — connected view now shows the centered notebook-style column, no line
numbers, two circular buttons top-right with a live guest-count badge. Opened the Users
popover — correctly listed "Sam (you) · editor" and "Ethan · host". Clicked the quill button —
swapped to Eye, rendered a real `<h1>` and paragraphs from the note's actual markdown, not a
placeholder. Clicked "Leave the room" from inside the popover — landed on the same
`SessionEndScreen` as before, `Download .md` completed cleanly.

`npm run build` and `npm run build:collab` both pass clean.

---

## 7. Resolved: collaborators do NOT need Gnos (2026-08-17)

Guests join from a browser. Cheaper than it sounds, because **Gnos is already a web app in
a Tauri shell** — React + CodeMirror 6 run in a browser unmodified.

**Build a second, slim entry point** (`src/collab-main.jsx` + its own Vite input), not a
second codebase:

| Reused as-is | Excluded |
|---|---|
| CM6 editor + `makeLivePlugin` decorations | archive / filesystem / `storage.js` |
| markdown renderers, mermaid, SVG, images pipeline | library, sidebar, tabs, collections |
| theme tokens + notebook CSS | plugins, PDF/reader/audio, settings |

Guest session = **one note, CRDT-connected, memory-only**. Nothing touches a disk.

### The asset problem (flag before building)

Notes reference `images/foo.svg` **relative to a local folder**. A browser guest has no
archive, so those break — the same class of bug as A65, but unfixable client-side.

Options, decide before step 7:
1. **Upload referenced assets into the room**, encrypted with the room key (consistent with
   the transport; costs relay storage).
2. **Inline small assets** as data URIs in the shared doc (simple; bloats the text and
   pollutes the markdown the host keeps).
3. **Degrade** — guests see a placeholder for host-local images (cheapest, worst UX).

Recommend **(1)**, with **(3)** as the fallback for anything oversized.

## 8. Resolved: relay hosting

**Self-hosted vs managed matters far less here than usual, because updates are encrypted
client-side — neither can read note content.** The real differences:

| | Self-hosted | Managed (Liveblocks, PartyKit, Y-Sweet, …) |
|---|---|---|
| Sees note content | no (E2E) | no (E2E) |
| Sees **metadata** | you keep it | third party keeps it: room ids, IPs, timings, connection graph |
| Ops burden | yours (TLS, uptime, updates, scaling) | theirs |
| Cost | flat, cheap at low usage | per-connection/MAU; grows with success |
| Time to ship | days | hours |
| Privacy story | "we can't see it *and* nobody else is in the path" | needs explaining |

### RESOLVED: make it free for everyone (2026-08-17) — peer-to-peer first

Guests already pay nothing (they just open a URL). The goal is that **the host pays nothing
either**. Achievable at personal scale with a hybrid, because the expensive part of any
relay is *bandwidth*, and P2P removes it from the server entirely.

```
         ┌── WebRTC data channel (note content) ──┐      ← free, never touches a server
   Host ─┤                                        ├─ Guest
         └── signaling only (tiny handshake) ─────┘
                        │
                  free-tier worker            ← ~KB per session
                        │
                  fallback WS relay           ← only when P2P fails
```

| Layer | Choice | Cost |
|---|---|---|
| Web client (static) | Cloudflare Pages / GitHub Pages | free, unmetered static |
| Signalling | Deno Deploy or CF Worker | free tier; handshakes only |
| Data transport | **`y-webrtc` peer-to-peer** | **free — never transits a server** |
| NAT traversal | public STUN | free |
| Fallback relay | same worker, WebSocket | free tier; minority of sessions |

**`y-webrtc` is the key choice** — same Yjs document, but peers exchange updates directly.
The server only introduces them, then steps out of the data path.

### The honest catch: TURN

Roughly 10–20% of connections (symmetric NAT, restrictive corporate/hotel Wi-Fi) can't
establish a direct peer link. Those need **TURN**, which *does* relay bytes and is rarely
free. Three options, in order of preference:

1. **Fall back to our own WebSocket relay** on the free tier — it's already E2E-encrypted,
   so this is just "server forwards ciphertext". Free-tier bandwidth is ample for a handful
   of collaborators.
2. Free TURN tier (e.g. Open Relay) as a stopgap.
3. Accept failure with a clear message ("couldn't connect — try another network").

Option 1 means **no TURN needed at all**: P2P when possible, encrypted server-forward when
not, both free at this scale.

### Where "free" stops being true

State it plainly rather than discover it later: free tiers have request/bandwidth caps. This
architecture is free for **Ethan + a handful of collaborators**. If sharing becomes a
headline feature with hundreds of concurrent rooms, the fallback relay's bandwidth is what
starts costing money — and that is a nice problem to have, solvable then by moving that one
component. Nothing in this design has to change to do so.

*(Verify current free-tier limits at build time — they move.)*

**Self-hosting on hardware Ethan already owns** is the other genuinely free path, but costs
uptime, dynamic DNS and TLS upkeep; not recommended as the default for guests.

## 9. Version history — how it works and where it lives

### Storage

```
appDataDir/history/<noteId>/<epochMs>-<kind>.md      kind = local | remote | merge | auto | pre-restore
```

Full text per snapshot (markdown is tiny — a 21 KB note × 200 versions ≈ 4 MB worst case;
delta-compress later only if it ever matters). Outside the archive, so the user's folder
stays pure markdown.

### When a snapshot is taken

| Trigger | kind | why |
|---|---|---|
| about to merge, disk side | `remote` | preserves the incoming version |
| about to merge, our side, **non-clean only** | `local` | preserves what silent resolution discarded |
| after a merge | `merge` | the resulting text |
| every ~5 min of *active* editing | `auto` | ordinary undo-beyond-session |
| immediately before a restore | `pre-restore` | restore is never destructive |

### Retention

**7 days, full fidelity, then discarded.** No thinning tiers and no permanent archive:
a week is ample to recover anything a silent merge dropped, and it keeps a long-lived note
from accumulating unbounded snapshots. Pruned incrementally on note open.

### Where in the editor

**Right titlebar zone**, beside Find / Backlinks / Share — as a `gnos-settings-btn` with a
clock-rewind icon. *(The left zone `.gnos-tb-left` is fixed 172px and fits exactly two
buttons — never add a third; it overflows into the macOS traffic lights.)*

Opens a **side panel mirroring `NotebookBacklinksPanel`** (same component shape, same
open/close pattern):

```
┌ History ─────────────────────────────┐
│ ● now            current             │
│ ○ 2:14 PM  merge     +12 −3   [view] │
│ ○ 2:14 PM  remote    from disk       │
│ ○ 1:50 PM  auto      +40 −1          │
│ ○ 1:05 PM  local     discarded edit  │
└──────────────────────────────────────┘
   [ Compare with current ]  [ Restore ]
```

- Click a version → **side-by-side diff vs current**, additions/deletions highlighted.
- **Restore** → snapshot current as `pre-restore`, then replace content. Always reversible.
- Because merges are silent, **this panel is where a merge becomes visible** — the `remote`
  and `local` entries are the audit trail that makes silence safe.

## 10. Resolved (2026-08-17)

- **Assets for web guests: option (1) — upload into the room**, encrypted with the room key.
  Referenced local images are collected on share, encrypted, and published to the room so a
  browser guest sees the same note the host does. Oversized files fall back to a placeholder.
- **History retention: 7 days full, then discard.** No thinning tiers, no indefinite
  archive — a week is enough to recover anything a silent merge discarded, and it bounds
  growth for long-lived notes. Prune on note open.
- **Transport: peer-to-peer first** (`y-webrtc`), free-tier signalling, encrypted
  WebSocket forward only as fallback. Free for every party at personal scale.

## 11. Sharing scope — per note vs per collection

| | **Per note** | **Per collection** |
|---|---|---|
| Mental model | "share this page" | "share this folder" |
| Access precision | exact — nothing leaks | coarse — everything in the folder goes |
| **Wikilinks** | **guest sees dead `[[links]]`** to notes they don't have | links inside the collection resolve |
| Guest UI | single editor | needs a mini library/sidebar |
| Assets | collect from one note | collect across N notes |
| Membership churn | none | notes added/renamed/moved **mid-session** must sync |
| Effort | small | substantially larger |

**Wikilinks are the deciding factor.** Gnos notes are densely interlinked (wikilinks +
backlinks panel), so a lone shared note hands the guest a page full of dead links. That
argues for collections eventually — but it is a much bigger build.

**Decision: ship per-note, architect for per-collection.**

Design the room as **"a room contains N documents"** from day one, not "a room is a
document":

```
room = { id, key, docs: Map<docId, Y.Doc>, assets: Map<hash, blob> }
```

Yjs supports this natively (subdocuments / named docs in one provider). Per-note v1 is then
simply *a room with one doc*, and per-collection later is *put the collection's notes in the
same room* — no re-architecture, no protocol break. Getting this shape right on day one is
the whole reason to decide it now.

## 12. Shared Excalidraw — yes, and it fits the same room

Sketchbooks are now flat `sketches/<Title>.excalidraw` files (A72), which makes them just
another document type in the room.

- An Excalidraw scene is an array of elements, each carrying `id`, `version` and
  `versionNonce` — **Excalidraw already has element-level conflict resolution built in**,
  precisely because it was designed for collaboration. Reconciliation is per element, not
  per file, so it needs no diff3.
- Two viable bindings: put the element array in a Yjs map (community `y-excalidraw`
  bindings), or reuse Excalidraw's own reconcile function over our transport. **Prefer the
  Yjs map** — one transport, one encryption path, one presence layer for both notes and
  sketches.
- **Caveat:** Excalidraw scenes embed images as base64 (noted in A72), so scenes can be
  large. Fine over P2P; it matters for the fallback relay and for the asset-upload budget.
  Send element-level deltas, never whole scenes.

Sequence it **after** notes collaboration — same room, same crypto, different binding. Not
bundled into the first release.

## 13. Session model — Live Share semantics (decided 2026-08-17)

> *"Guest edits survive if I go offline while we're both on, but the server ends when I end.
> The primary user controls access and hosting."*

That is VS Code Live Share, and it makes the server **simpler**, not harder:

- **The host owns the session.** Starting a share creates the room; ending it destroys the
  room and invalidates the key. Guests are disconnected.
- **The relay stays stateless.** It never persists a document — it only introduces peers
  (and forwards ciphertext when P2P fails).
- **Durability lives in the peers.** The Yjs doc is replicated in every connected client, so
  if the host's network drops mid-session the guests keep editing among themselves; when the
  host returns it **syncs the missed updates back from them** and writes to disk. This is
  ordinary CRDT behaviour — no server storage required.
- **If everyone disconnects**, the room is gone — but nothing is lost: the host's
  `notebooks/Name.md` is the durable artifact, and Stage 1 history holds the snapshots.
- **Host controls:** who can join (link + role), revoke (rotate key), and end (kill room).
  A "Sharing" panel lists connected guests with a per-guest disconnect.

**Honest limitation to surface in the UI:** if the host quits while a guest is mid-sentence,
the guest's last unsynced keystrokes have nowhere to land. Mitigate by flushing to the host
on a short interval and warning the guest ("host ended the session") rather than silently
closing.

## 14. Guests without Gnos — identity, keys and access

**The Live Share model does most of the security work for us.** Because a room dies when the
host ends the session, **links are inherently short-lived** — there is no long-lived secret
to manage, rotate or leak. Most of the "key management" problem simply doesn't exist here.

### 14.1 Join flow

```
1. Host clicks Share            → room created, key generated locally
                                  link: https://gnos.app/join/<roomId>#<key>
2. Guest opens the link         → web client loads; key is read from the fragment
                                  (fragments are never sent to a server)
3. Guest types a display name   → no account, no email, no signup
4. Host sees "Sam wants to join" → Approve / Deny, and Edit / Read-only
5. Connected                    → P2P if possible, encrypted forward if not
```

**Link = knock. Host = doorman.** Possession of the link gets you to the door; the **host
decides who actually comes in.** That gives real per-person control without building auth,
and it fixes the weakness of pure capability links (where kicking one person means rotating
the key and re-sharing with everybody).

### 14.2 Key lifecycle (guest side)

| | |
|---|---|
| Where it arrives | URL fragment — **never transmitted to the relay** |
| Where it lives | **browser memory only**, for the session |
| Persisted? | **No** by default. Guests are often on shared machines; a key in `localStorage` outlives the session and the trust |
| After session | discarded with the tab; room is dead anyway |
| Rejoining later | needs a fresh link — by design |

Host-side keys live in the OS keychain / secure store, never in the archive or a synced JSON
(§3 data model).

### 14.3 Guest identity

- Display name, typed at join. Optional colour (auto-assigned for cursors).
- An **ephemeral keypair generated in-browser** per session, used to sign updates so peers
  can attribute them. Thrown away at the end.
- No email, no password, no profile, nothing stored server-side.

### 14.4 Enforcing read-only

Honest about where the boundary is:

- The **host is the only writer to disk.** A read-only guest's updates are not applied by
  the host and not written to `Name.md` — so read-only is genuinely enforced *for the
  artifact that matters*.
- Between guests, enforcement is by signature check (peers ignore unsigned/unauthorised
  updates), not by cryptography preventing transmission.
- **Stated limitation:** a determined read-only guest can alter their own local view. They
  cannot change the host's file. That is the correct and explainable boundary.

### 14.5 Session end — guests keep a copy (decided 2026-08-17)

When the host ends the session, the guest is **asked**, not silently dropped:

```
┌──────────────────────────────────────┐
│  Ethan ended this session.           │
│                                      │
│  Keep a copy of "Koine Greek"?       │
│    [ Download .md ]  [ No thanks ]   │
└──────────────────────────────────────┘
```

- Download is the note's markdown as it stood, plus referenced assets (zip if >1 file).
- Purely client-side — the guest's browser already holds the document; nothing new is
  uploaded or stored anywhere.
- Same prompt if the guest leaves first.

### 14.6 Security caveats to surface in the UI

- **Anyone with the link can request access** — say so plainly in the share dialog.
- Fragment keys are safe from the server, but leak through screen-sharing, chat logs and
  browser history. Ephemeral rooms bound the damage.
- No verified identity in v1: "Sam" is whoever typed "Sam". Host approval is the real gate.
- Traffic is E2E encrypted; the relay sees room ids and ciphertext, never note content.

## 15. What it actually costs you (getgnos.com)

**The economic property that matters: with P2P, server cost is nearly independent of how
much people type.** The note data goes peer-to-peer; the server only introduces peers.

| Piece | Where | Traffic | Cost |
|---|---|---|---|
| `getgnos.com/join/*` — static page + editor bundle | Cloudflare Pages | ~1–2 MB per first visit, then cached | **$0** (Pages doesn't meter static egress) |
| Signalling — peer introductions | CF Worker / Deno Deploy | **a few KB per session** | **$0** on free tier |
| Note updates | **peer ↔ peer** | never touches your server | **$0** |
| Fallback forward (P2P blocked, ~10–20%) | same worker | see below | **$0** at this scale |
| Domain | already owned | — | already paid |

**Scale check.** A Yjs update for one keystroke is ~20–50 bytes. An hour of heavy two-person
editing ≈ 5,000 keystrokes ≈ **~250 KB** — and that only crosses the server in the fallback
case. Text collaboration is thousands of times cheaper than anything media-related. Free
tiers (CF Workers 100k req/day; Deno Deploy similar) absorb hundreds of sessions a day.

**Where it would stop being free:** not typing volume — *concurrent room count*. If Gnos
collaboration became popular enough for thousands of simultaneous rooms, the fallback relay
is the first thing to cost money, and it's the one component that can be swapped without
touching the rest of the design. Verify current free-tier limits at build time; they move.

## 16. Can guests use their own markdown editor?

Two honest tiers — and the second is already half-built.

### Tier 1 — live, in-browser (cursors, keystroke-level)
Requires our editor (the web client, or Gnos). A third-party editor has no CRDT and no
network layer; it cannot join a Yjs room. **Not possible** with Typora/iA Writer/etc.

### Tier 2 — near-live, any editor, via a file bridge
A small "join" client mirrors the shared document to a **real `.md` file on the guest's
disk**, then watches that file:

```
room ⇄ bridge ⇄ ~/GnosShared/Koine Greek.md ⇄ [Typora | vim | Obsidian | anything]
```

- Guest edits in **whatever editor they like** and hits save.
- The bridge sees the change, merges it, publishes to the room.
- Remote changes are merged into the file, which their editor reloads.

**We already built the engine for this.** `merge3.js` + the disk watcher + `contentHash`
are exactly the "an outside editor changed the file, reconcile it" primitive (Stage 1,
scenario B). The bridge is that logic plus a transport.

Trade-offs vs Tier 1: propagation is per-save (~1–2 s), not per-keystroke; **no cursors or
presence**, because their editor can't render them; conflicts are resolved by merge rather
than CRDT.

**Note this already works for you locally.** Stage 1 means you can keep Gnos open and edit
the same note in Obsidian — that is Tier 2 with the transport being your own filesystem.

Ship Tier 1 first (it's the demo-able one), Tier 2 as a follow-on for power users.

## 17. Still open

1. Should the host be able to **re-open a previous session** with the same guests (a
   "resume" link), or is every session strictly new? (Strictly-new is simpler and safer.)
2. Guest download: markdown only, or markdown + assets as a zip when images are present?
