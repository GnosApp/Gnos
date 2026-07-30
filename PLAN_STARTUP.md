# Plan STARTUP — launch speed + library scroll jank

User report: "either loads in too quick → tons of lag, or loading-in causes insane
lag and cards disappear when scrolling." Two coupled problems: (A) splash timing
decoupled from data readiness, (B) library grid mount/scroll cost. Recon done.

## Root causes (grounded in code)

### R1. Splash dismisses on a FIXED timer, not on data ready — App.jsx:1428
`GnosLoadingScreen` does `quickDismiss = setTimeout(dismiss, 350)` regardless of
whether `init()` (store hydration: library/notebooks/covers from disk) has
finished. So:
- init fast → splash still waits ~350ms (feels sluggish for empty libs), OR
- init slow → splash gone at 350ms, then the ENTIRE library grid mounts in one
  synchronous React commit while the user is already looking/scrolling = the
  "loads too quick → lag" spike.
The splash is brand-flash only; it never gates on `init()`.

### R2. `useIdleReady` thundering herd — LibraryView.jsx:53-62, used per card (66,68,122…)
EVERY BookCard/AudiobookCard mounts its OWN `requestIdleCallback`. `imgReady`
gates whether the cover `<img>` renders at all. On first idle, N callbacks fire
in a burst → N cards flip state → N cover images inject + decode in the same
few frames = paint/decode storm right at open. Covers are data-URL base64
(heavy decode). This is the "insane lag" on load.

### R3. No virtualization — every card is in the DOM (renderAll → library-grid, 2556+)
`renderAll()` maps the full filtered library/notebooks/sketchbooks/decks; the
grid renders all of them. A 200-item library = 200 cards, 200 idle callbacks,
200 absolutely-positioned cover imgs. Non-virtualized.

### R4. "Cards disappear when scrolling" — compositor/paint, not unmount
No IntersectionObserver / content-visibility in LibraryView, so cards aren't
being unmounted. Disappearing-on-scroll of a huge non-virtualized grid with
absolutely-positioned cover imgs (`.book-cover img { position:absolute }`) +
per-card fade animation (`.cover-img-fade`) is a classic WebKit tile-raster
dropout: too many layers/large paint area, tiles evict, blank until repaint.
Confirm in Web Inspector (paint flashing / layer count), but the fix (fewer
simultaneous layers via windowing + no per-card idle churn) addresses it
regardless.

## Fixes (ordered by impact / low risk first)

### F1. Gate splash on init() + min/max window  (App.jsx)  ★ do first
Pass an `initDone` signal into GnosLoadingScreen. Dismiss = `max(minShow=250ms,
init-complete)` capped at `maxShow≈2.5s` (so a stuck disk read still opens).
Kills the "open before data → mount storm mid-interaction": the grid is already
hydrated when the splash lifts.

### F2. Replace per-card useIdleReady with ONE shared idle gate
A single module/context idle flag (or a small provider) flipped once ~1 idle
after the grid mounts; all cards read it. One callback, one coordinated flip.
Covers still defer (no decode during the open frame) but as ONE batched paint,
not N. Keeps memo. ~15 lines.

### F3. Windowed grid render (virtualization-lite)
Render first ~48 cards immediately; append the rest in requestIdleCallback
chunks (or on first scroll near the end). No external dep — a `visibleCount`
state that grows. Bounds DOM nodes + layers during the open + scroll. Covers
the disappearing-on-scroll (fewer live layers) AND the mount spike.
Alternative if libraries can be huge (>500): IntersectionObserver sentinel
"load more" or a real virtualizer (`@tanstack/react-virtual`). Start with the
cheap grow-on-idle; escalate only if profiling shows need.

### F4. Cover paint containment
`.book-cover { content-visibility: auto; contain-intrinsic-size: <cover dims> }`
so offscreen covers skip rendering — BUT past A-pass gotcha: content-visibility
on cards can break hover-lift/shadow. Apply to the inner `.book-cover` image
wrapper only, not `.book-card-container`, and verify hover still lifts. If it
fights the hover transform, drop F4 and rely on F3 windowing.

### F5. Covers off the hot path (bigger, optional)
Covers are base64 in the store JSON (also flagged in PLAN_A38 §1.4). Each is
decoded twice (JSON in RAM + img decode). Switch card imgs to `convertFileSrc()`
file URLs (lazy-decodable, browser-cached) instead of data URLs; keep JSON
fallback for older entries. Removes the biggest per-card decode cost. Do after
F1-F3 if lag persists.

## Verify
Browser preview at the seed library is small — real test needs the Tauri app
with a large imported library (Web Inspector: Timeline on launch, paint-flashing
on scroll, layer count). Targets: splash→interactive with no >100ms long task
after lift; 60fps scroll; no blank cards. Build green each step.

## Order
F1 → F2 → F3 → (profile) → F4 / F5 as needed.
