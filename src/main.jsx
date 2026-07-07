import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/global.css'
import '@excalidraw/excalidraw/index.css'
import App from './App.jsx'
import QuickNoteView from '@/views/QuickNoteView'
import SettingsWindowView from '@/views/SettingsWindowView'
import ProfileWindowView from '@/views/ProfileWindowView'
import useAppStore from '@/store/useAppStore'
import { applyCachedTheme } from '@/lib/themes'
window.__appStore = useAppStore

// Paint the last-used theme synchronously, before React mounts, so the first
// frame already shows the chosen theme instead of flashing default dark.
applyCachedTheme()

// Secondary windows (quick note popup, settings) run the same bundle —
// the Tauri window label picks which root component mounts.
let windowLabel = 'main'
try {
  windowLabel = window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || 'main'
} catch { /* browser dev — treat as main */ }

const Root = windowLabel === 'quicknote' ? QuickNoteView
  : windowLabel === 'settings' ? SettingsWindowView
  : windowLabel === 'profile' ? ProfileWindowView
  : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
