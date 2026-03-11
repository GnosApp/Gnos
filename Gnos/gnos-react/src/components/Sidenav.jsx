import { useEffect } from 'react'
import useAppStore from '@/store/useAppStore'

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────
const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

const NAV_ITEMS = [
  {
    id: 'library', label: 'Library',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        <rect x="9" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    id: 'books', label: 'Books',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M3 14V3a1.5 1.5 0 0 1 1.5-1.5h9V14H4.5A1.5 1.5 0 0 1 3 12.5v0A1.5 1.5 0 0 1 4.5 11H13.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'audiobooks', label: 'Audiobooks',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M3 6h3l3-3.5v11L6 10H3V6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        <path d="M11 5c.8.7 1.3 1.6 1.3 3s-.5 2.3-1.3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'notebooks', label: 'Notebooks',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'collections', label: 'Collections',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="5" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
        <path d="M5 5V4a3 3 0 0 1 6 0v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  },
]

const VIEW_LABELS = {
  library: 'Library',
  reader: 'Reading',
  'audio-player': 'Listening',
  notebook: 'Notebook',
  pdf: 'PDF',
  sketchbook: 'Sketchbook',
}

// ─────────────────────────────────────────────────────────────────────────────
// GnosNavButton — logo + chevron, imported in every view header
// ─────────────────────────────────────────────────────────────────────────────
export function GnosNavButton() {
  const openSideNav = useAppStore(s => s.openSideNav)
  return (
    <button className="gnos-nav-btn" onClick={openSideNav} title="Open navigation">
      <span className="gnos-nav-logo">Gnos</span>
      <svg className="gnos-nav-chevron" width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SideNav — global slide-in panel, mounted once in App.jsx
// ─────────────────────────────────────────────────────────────────────────────
export default function SideNav() {
  const sideNavOpen     = useAppStore(s => s.sideNavOpen)
  const closeSideNav    = useAppStore(s => s.closeSideNav)
  const tabs            = useAppStore(s => s.tabs)
  const activeTabId     = useAppStore(s => s.activeTabId)
  const switchTab       = useAppStore(s => s.switchTab)
  const closeTab        = useAppStore(s => s.closeTab)
  const view            = useAppStore(s => s.view)
  const setView         = useAppStore(s => s.setView)
  const setActiveLibTab = useAppStore(s => s.setActiveLibTab)
  const activeLibTab    = useAppStore(s => s.activeLibTab)

  // Close on Escape
  useEffect(() => {
    if (!sideNavOpen) return
    const h = (e) => { if (e.key === 'Escape') closeSideNav() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [sideNavOpen, closeSideNav])

  function handleNavItem(id) {
    setView('library')
    setActiveLibTab(id)
    closeSideNav()
  }

  function handleTabSwitch(tabId) {
    switchTab(tabId)
    closeSideNav()
  }

  function handleTabClose(e, tabId) {
    e.stopPropagation()
    closeTab(tabId)
  }

  const showTabs = tabs.length > 1

  return (
    <>
      <style>{`
        /* ── GnosNavButton ─────────────────────────────────────────────────── */
        .gnos-nav-btn {
          display: flex; align-items: center; gap: 5px;
          background: none; border: none; cursor: pointer;
          padding: 4px 8px; border-radius: 6px;
          transition: background 0.12s; flex-shrink: 0;
          line-height: 1;
        }
        .gnos-nav-btn:hover { background: var(--hover); }
        .gnos-nav-logo {
          font-family: Georgia, serif; font-size: 15px; font-weight: 700;
          color: var(--text); letter-spacing: -0.3px;
        }
        .gnos-nav-chevron {
          color: var(--textDim); opacity: 0.65;
          transition: transform 0.15s, opacity 0.12s;
          display: block;
        }
        .gnos-nav-btn:hover .gnos-nav-chevron { opacity: 1; transform: translateX(1px); }

        /* ── Backdrop ──────────────────────────────────────────────────────── */
        .sidenav-backdrop {
          position: fixed; inset: 0; z-index: 8000;
          background: transparent; pointer-events: none;
          transition: background 0.22s ease;
        }
        .sidenav-backdrop.open {
          background: rgba(0,0,0,0.42); pointer-events: all;
        }

        /* ── Panel ─────────────────────────────────────────────────────────── */
        .sidenav-panel {
          position: fixed; top: 0; left: 0; bottom: 0; width: 264px;
          z-index: 8001;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex; flex-direction: column;
          transform: translateX(-100%);
          transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
          will-change: transform;
        }
        .sidenav-panel.open {
          transform: translateX(0);
          box-shadow: 6px 0 40px rgba(0,0,0,0.3);
        }

        .sidenav-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 16px 14px 12px 18px; flex-shrink: 0;
          border-bottom: 1px solid var(--borderSubtle);
        }
        .sidenav-logo {
          font-family: Georgia, serif; font-size: 19px; font-weight: 700;
          color: var(--text); letter-spacing: -0.4px;
        }
        .sidenav-close-btn {
          width: 26px; height: 26px; border-radius: 6px;
          border: none; background: none; color: var(--textDim);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.1s, color 0.1s;
        }
        .sidenav-close-btn:hover { background: var(--hover); color: var(--text); }

        .sidenav-scroll { flex: 1; overflow-y: auto; padding-bottom: 16px; }

        .sidenav-section { padding: 10px 0 4px; }
        .sidenav-section-label {
          padding: 0 18px 5px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--textDim); opacity: 0.55;
        }

        /* Tab items */
        .sidenav-tab-item {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 10px 7px 18px;
          border: none; background: none; width: 100%;
          color: var(--text); cursor: pointer; text-align: left;
          transition: background 0.1s;
        }
        .sidenav-tab-item:hover { background: var(--hover); }
        .sidenav-tab-item.active { background: rgba(56,139,253,0.09); color: var(--accent); }
        .sidenav-tab-indicator {
          width: 7px; height: 7px; border-radius: 50%;
          background: var(--textDim); flex-shrink: 0; opacity: 0.5;
          transition: background 0.1s, opacity 0.1s;
        }
        .sidenav-tab-item.active .sidenav-tab-indicator { background: var(--accent); opacity: 1; }
        .sidenav-tab-name {
          flex: 1; font-size: 13px; font-weight: 500;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sidenav-tab-close {
          width: 20px; height: 20px; border-radius: 4px;
          border: none; background: none; cursor: pointer; color: var(--textDim);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity 0.1s, background 0.1s;
          flex-shrink: 0;
        }
        .sidenav-tab-item:hover .sidenav-tab-close { opacity: 0.7; }
        .sidenav-tab-close:hover { background: var(--hover); opacity: 1 !important; color: var(--text); }

        /* Nav items */
        .sidenav-nav-item {
          display: flex; align-items: center; gap: 10px;
          padding: 7px 12px 7px 18px;
          border: none; background: none; width: 100%;
          color: var(--textDim); cursor: pointer; text-align: left;
          font-size: 13px; font-weight: 500;
          transition: background 0.1s, color 0.1s;
        }
        .sidenav-nav-item:hover { background: var(--hover); color: var(--text); }
        .sidenav-nav-item.active { color: var(--accent); background: rgba(56,139,253,0.08); }
        .sidenav-nav-icon { display: flex; align-items: center; flex-shrink: 0; opacity: 0.8; }
        .sidenav-nav-item.active .sidenav-nav-icon { opacity: 1; }

        .sidenav-divider { height: 1px; background: var(--borderSubtle); margin: 6px 14px; }
      `}</style>

      {/* Backdrop */}
      <div
        className={`sidenav-backdrop${sideNavOpen ? ' open' : ''}`}
        onClick={closeSideNav}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className={`sidenav-panel${sideNavOpen ? ' open' : ''}`} role="navigation" aria-label="Main navigation">
        {/* Header */}
        <div className="sidenav-header">
          <span className="sidenav-logo">Gnos</span>
          <button className="sidenav-close-btn" onClick={closeSideNav} title="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="sidenav-scroll">
          {/* Open Tabs */}
          {showTabs && (
            <div className="sidenav-section">
              <div className="sidenav-section-label">Open Tabs</div>
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  className={`sidenav-tab-item${tab.id === activeTabId ? ' active' : ''}`}
                  onClick={() => handleTabSwitch(tab.id)}
                >
                  <div className="sidenav-tab-indicator" />
                  <span className="sidenav-tab-name">
                    {VIEW_LABELS[tab.view] || tab.view}
                  </span>
                  <button
                    className="sidenav-tab-close"
                    onClick={e => handleTabClose(e, tab.id)}
                    title="Close tab"
                  >
                    <CloseIcon />
                  </button>
                </button>
              ))}
              <div className="sidenav-divider" />
            </div>
          )}

          {/* Navigation */}
          <div className="sidenav-section">
            <div className="sidenav-section-label">Navigate</div>
            {NAV_ITEMS.map(item => {
              const isActive = view === 'library' && activeLibTab === item.id
              return (
                <button
                  key={item.id}
                  className={`sidenav-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => handleNavItem(item.id)}
                >
                  <span className="sidenav-nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}