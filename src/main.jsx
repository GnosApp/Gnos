import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/global.css'
import '@excalidraw/excalidraw/index.css'
import App from './App.jsx'
import useAppStore from '@/store/useAppStore'
window.__appStore = useAppStore

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)