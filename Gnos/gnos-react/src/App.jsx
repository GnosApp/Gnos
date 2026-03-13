import { useEffect } from 'react'
import useAppStore from '@/store/useAppStore'

import LibraryView     from '@/views/LibraryView'
import ReaderView      from '@/views/ReaderView'
import AudioPlayerView from '@/views/AudioPlayerView'
import NotebookView    from '@/views/NotebookView'
import PdfView         from '@/views/PdfView'
import SketchbookView  from '@/views/SketchbookView'
import SideNav         from '@/components/SideNav'

const VIEW_LABELS = {
  library: 'Library', reader: 'Reading', 'audio-player': 'Listening',
  notebook: 'Notebook', pdf: 'PDF', sketchbook: 'Sketchbook',
}

export default function App() {
  const view        = useAppStore(s => s.view)
  const init        = useAppStore(s => s.init)
  const tabs        = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const switchTab   = useAppStore(s => s.switchTab)
  const sideNavOpen = useAppStore(s => s.sideNavOpen)

  useEffect(() => { init() }, [init])

  const showTabBar = tabs.length > 1

  return (
    <div id="app">
      {/* Global slide-in navigation */}
      <SideNav />

      {/* Push wrapper — shifts right when sidenav is open */}
      <div className={`sidenav-push-wrapper${sideNavOpen ? ' pushed' : ''}`}>
        {/* Tab bar — visible only when 2 tabs are open */}
        {showTabBar && (
          <div style={{
            position: 'sticky', top: 0, left: 0, right: 0, height: 34,
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'stretch', zIndex: 7000,
            paddingLeft: 8,
          }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  background: tab.id === activeTabId ? 'var(--bg)' : 'none',
                  border: 'none',
                  borderRight: '1px solid var(--borderSubtle)',
                  color: tab.id === activeTabId ? 'var(--text)' : 'var(--textDim)',
                  cursor: 'pointer',
                  padding: '0 16px',
                  fontSize: 12,
                  fontWeight: tab.id === activeTabId ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {VIEW_LABELS[tab.view] || tab.view}
              </button>
            ))}
          </div>
        )}

        <div style={showTabBar ? { paddingTop: 0, height: 'calc(100vh - 34px)', boxSizing: 'border-box' } : { height: '100vh' }}>
          {view === 'library'      && <LibraryView />}
          {view === 'reader'       && <ReaderView />}
          {view === 'audio-player' && <AudioPlayerView />}
          {view === 'notebook'     && <NotebookView />}
          {view === 'pdf'          && <PdfView />}
          {view === 'sketchbook'   && <SketchbookView />}
        </div>
      </div>
    </div>
  )
}