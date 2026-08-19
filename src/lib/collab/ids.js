// PLAN_CONCURRENCY.md §2.3 capability-link primitives — room id (opaque,
// sent to the signaling server) and key (secret, lives only in a URL
// fragment or equivalent out-of-band channel, never sent to any server).
// No React, no Yjs — pure ID/color utilities shared by every collab surface
// (the dev harness, NotebookView's host wiring, the web guest client).

export const PALETTE = ['#3b82f6', '#f97316', '#10b981', '#e11d48', '#8b5cf6', '#0ea5e9']

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
