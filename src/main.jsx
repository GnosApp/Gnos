import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/global.css'
import useAppStore from '@/store/useAppStore'
import { applyCachedTheme } from '@/lib/themes'
window.__appStore = useAppStore

// Paint the last-used theme synchronously, before React mounts, so the first
// frame already shows the chosen theme instead of flashing default dark.
applyCachedTheme()

// Secondary windows (quick note popup, settings, profile) run the same bundle —
// the Tauri window label picks which root component mounts.
let windowLabel = 'main'
try {
  windowLabel = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || 'main'
} catch { /* browser dev — treat as main */ }

const root = createRoot(document.getElementById('root'))

// Each root is a dynamic import so a window only downloads/parses its own chunk.
// The main App drags in the entire heavy dep tree (Excalidraw, CodeMirror,
// mermaid, KaTeX…); statically importing it here meant the lightweight
// quicknote/settings/profile windows paid to parse all of it before first
// paint — the reason the profile window felt slow to open. Branching on the
// window label BEFORE importing keeps those windows off App's chunk entirely.
async function mount() {
  let Root
  if (windowLabel === 'quicknote') {
    ({ default: Root } = await import('@/views/QuickNoteView'))
  } else if (windowLabel === 'settings') {
    ({ default: Root } = await import('@/views/SettingsWindowView'))
  } else if (windowLabel === 'profile') {
    ({ default: Root } = await import('@/views/ProfileWindowView'))
  } else {
    // Excalidraw styles are only needed by the main app's sketchbook view.
    await import('@excalidraw/excalidraw/index.css')
    ;({ default: Root } = await import('./App.jsx'))
  }
  const { IconDefaults } = await import('@/components/icons')
  root.render(
    <StrictMode>
      <IconDefaults>
        <Root />
      </IconDefaults>
    </StrictMode>,
  )
}

mount()
