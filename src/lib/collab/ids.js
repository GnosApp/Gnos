// PLAN_CONCURRENCY.md §2.3 capability-link primitives — room id (opaque,
// sent to the signaling server) and key (secret, lives only in a URL
// fragment or equivalent out-of-band channel, never sent to any server).
// No React, no Yjs — pure ID/color utilities shared by every collab surface
// (the dev harness, NotebookView's host wiring, the web guest client).

// First 6 are the original set (index 0 reserved for the host — see below —
// index 1 the guest default; both callers keep working unchanged). Every
// later append (2026-08-19) only ever adds to the end, so those two indices
// stay stable — most recently 7 more (red, yellow, emerald, cyan, violet,
// fuchsia, stone) to bring the preset count to 19, one short of the 20 the
// join screen's own icon picker has; the 20th slot there is a custom
// hex-code picker, not a 20th preset (see GuestApp.jsx's JoinScreen). Every
// entry sits at the same saturation/lightness so the full set reads as one
// consistent family, not several eras stitched together.
export const PALETTE = [
  '#3b82f6', '#f97316', '#10b981', '#e11d48', '#8b5cf6', '#0ea5e9',
  '#ec4899', '#14b8a6', '#f59e0b', '#6366f1', '#84cc16', '#64748b',
  '#ef4444', '#eab308', '#059669', '#06b6d4', '#7c3aed', '#d946ef', '#78716c',
]

// Join-screen avatar icons — plain lucide glyphs (path data copied straight
// out of node_modules/lucide-react's own icon source, not hand-drawn), NOT
// emoji: rendered as `currentColor` strokes so an icon always matches the
// guest's chosen color exactly, which an emoji glyph (fixed colors baked
// into the character) can't do. `'user'` is first and is the default —
// matches the join screen's own placeholder avatar before anyone picks
// anything. No React here on purpose (see this file's own header) — each
// icon is `{ id, node }` where `node` is lucide's raw `[tag, props][]`
// shape; GuestApp.jsx's `Icon` component turns that into actual SVG
// elements at render time.
export const AVATAR_ICONS = [
  { id: 'user', node: [['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }], ['circle', { cx: '12', cy: '7', r: '4' }]] },
  { id: 'smile', node: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'M8 14s1.5 2 4 2 4-2 4-2' }], ['line', { x1: '9', x2: '9.01', y1: '9', y2: '9' }], ['line', { x1: '15', x2: '15.01', y1: '9', y2: '9' }]] },
  { id: 'cat', node: [['path', { d: 'M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z' }], ['path', { d: 'M8 14v.5' }], ['path', { d: 'M16 14v.5' }], ['path', { d: 'M11.25 16.25h1.5L12 17l-.75-.75Z' }]] },
  { id: 'dog', node: [['path', { d: 'M11.25 16.25h1.5L12 17z' }], ['path', { d: 'M16 14v.5' }], ['path', { d: 'M4.42 11.247A13.152 13.152 0 0 0 4 14.556C4 18.728 7.582 21 12 21s8-2.272 8-6.444a11.702 11.702 0 0 0-.493-3.309' }], ['path', { d: 'M8 14v.5' }], ['path', { d: 'M8.5 8.5c-.384 1.05-1.083 2.028-2.344 2.5-1.931.722-3.576-.297-3.656-1-.113-.994 1.177-6.53 4-7 1.923-.321 3.651.845 3.651 2.235A7.497 7.497 0 0 1 14 5.277c0-1.39 1.844-2.598 3.767-2.277 2.823.47 4.113 6.006 4 7-.08.703-1.725 1.722-3.656 1-1.261-.472-1.855-1.45-2.239-2.5' }]] },
  { id: 'ghost', node: [['path', { d: 'M9 10h.01' }], ['path', { d: 'M15 10h.01' }], ['path', { d: 'M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z' }]] },
  { id: 'rocket', node: [['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }], ['path', { d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09' }], ['path', { d: 'M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z' }], ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05' }]] },
  { id: 'star', node: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' }]] },
  { id: 'zap', node: [['path', { d: 'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z' }]] },
  { id: 'heart', node: [['path', { d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5' }]] },
  { id: 'bird', node: [['path', { d: 'M16 7h.01' }], ['path', { d: 'M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20' }], ['path', { d: 'm20 7 2 .5-2 .5' }], ['path', { d: 'M10 18v3' }], ['path', { d: 'M14 17.75V21' }], ['path', { d: 'M7 18a6 6 0 0 0 3.84-10.61' }]] },
  // Added 2026-08-19, doubling the join-screen picker to 20 — more animals
  // (matching the playful register the first 10 already set) plus a few
  // that lean into what this app actually is: reading/writing/ideas,
  // without literal pencil/eye/sun/moon/search glyphs already claimed
  // elsewhere in this UI (source mode, preview mode, the theme toggle,
  // find) — an avatar icon that doubles as a mode button would be a real
  // point of confusion, not just a style nit.
  { id: 'panda', node: [['path', { d: 'M11.25 17.25h1.5L12 18z' }], ['path', { d: 'm15 12 2 2' }], ['path', { d: 'M18 6.5a.5.5 0 0 0-.5-.5' }], ['path', { d: 'M20.69 9.67a4.5 4.5 0 1 0-7.04-5.5 8.35 8.35 0 0 0-3.3 0 4.5 4.5 0 1 0-7.04 5.5C2.49 11.2 2 12.88 2 14.5 2 19.47 6.48 22 12 22s10-2.53 10-7.5c0-1.62-.48-3.3-1.3-4.83' }], ['path', { d: 'M6 6.5a.495.495 0 0 1 .5-.5' }], ['path', { d: 'm9 12-2 2' }]] },
  { id: 'rabbit', node: [['path', { d: 'M13 16a3 3 0 0 1 2.24 5' }], ['path', { d: 'M18 12h.01' }], ['path', { d: 'M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 2.8-2.8L15.8 7h.2c3.3 0 6 2.7 6 6v1a2 2 0 0 1-2 2h-1a3 3 0 0 0-3 3' }], ['path', { d: 'M20 8.54V4a2 2 0 1 0-4 0v3' }], ['path', { d: 'M7.612 12.524a3 3 0 1 0-1.6 4.3' }]] },
  { id: 'turtle', node: [['path', { d: 'm12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z' }], ['path', { d: 'M4.82 7.9 8 10' }], ['path', { d: 'M15.18 7.9 12 10' }], ['path', { d: 'M16.93 10H20a2 2 0 0 1 0 4H2' }]] },
  { id: 'fish', node: [['path', { d: 'M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z' }], ['path', { d: 'M18 12v.5' }], ['path', { d: 'M16 17.93a9.77 9.77 0 0 1 0-11.86' }], ['path', { d: 'M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33' }], ['path', { d: 'M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4' }], ['path', { d: 'm16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98' }]] },
  { id: 'coffee', node: [['path', { d: 'M10 2v2' }], ['path', { d: 'M14 2v2' }], ['path', { d: 'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1' }], ['path', { d: 'M6 2v2' }]] },
  { id: 'book', node: [['path', { d: 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20' }]] },
  { id: 'lightbulb', node: [['path', { d: 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5' }], ['path', { d: 'M9 18h6' }], ['path', { d: 'M10 22h4' }]] },
  { id: 'sparkle', node: [['path', { d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z' }]] },
  { id: 'gem', node: [['path', { d: 'M10.5 3 8 9l4 13 4-13-2.5-6' }], ['path', { d: 'M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z' }], ['path', { d: 'M2 9h20' }]] },
  { id: 'crown', node: [['path', { d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z' }], ['path', { d: 'M5 21h14' }]] },
]

export function randomKey(bytes = 24) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}

export function randomRoomId(prefix = 'gnos') {
  return `${prefix}-` + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')
}

export function colorFor(clientId) {
  return PALETTE[Math.abs(Number(clientId) || 0) % PALETTE.length]
}
