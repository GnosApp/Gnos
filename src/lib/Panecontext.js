import { createContext } from 'react'

// PaneContext: tells views which tab they belong to in split mode.
// null  = single-pane layout, views use the global store directly.
// tabId = split-pane layout, views write to that specific tab's snapshot.
export const PaneContext = createContext(null)