// Entry point for collab.html — the PLAN_CONCURRENCY.md §7 web guest client.
// Deliberately its own root, not a mode of src/main.jsx: that file's `mount()`
// branches on a Tauri window label and, even in its lightest branch, still
// pulls in useAppStore/applyCachedTheme (src/store/useAppStore.js — the whole
// archive/filesystem layer this page must never touch, per §7's own
// exclusion list). Keeping this genuinely separate is what makes "a guest
// never touches disk" true by construction, not just by convention.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/collab/guest.css'
import GuestApp from '@/collab/GuestApp'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GuestApp />
  </StrictMode>,
)

// A COMMENT alone here didn't change the emitted bundle's hash — esbuild
// strips comments during minification before Vite hashes the output, so a
// comment-only edit produces byte-identical minified output. This line is
// a real, side-effecting statement (can't be tree-shaken — it mutates a
// global) specifically so the hash actually changes. Why that's needed:
// Cloudflare's edge cache poisoned the OLD hash's URL with the wrong
// content-type, from a stray response cached during the pre-fix deploy
// where every asset request got redirect-looped into serving HTML instead
// of JS. Fixing that redirect bug didn't change this file's emitted bytes,
// so the bundle kept the same hash, and the poisoned cache entry for that
// exact URL kept being served regardless of the fix. Forcing a new
// hash/URL sidesteps the poisoned entry entirely — a URL that was never
// cached can't serve a stale response. One-time fix, not a recurring
// pattern: only this specific deploy's mistake poisoned anything.
if (typeof window !== 'undefined') window.__gnosCollabBuild = 'cache-bust-1'
