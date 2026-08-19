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
