import { createContext } from 'react'

// PaneContext: tells views which tab they belong to in split mode.
// null  = single-pane layout, views use the global store directly.
// tabId = split-pane layout, views write to that specific tab's snapshot.
export const PaneContext = createContext(null)

// PaneChromeContext: when the app is split, each pane provides its OWN chrome
// host ids so per-view actions (quick-access buttons, the save indicator) land
// in that pane's local header instead of the global titlebar. null = single
// pane → per-view actions go to the global header as before.
//   { qaHostId: string, saveIconId: string }
export const PaneChromeContext = createContext(null)