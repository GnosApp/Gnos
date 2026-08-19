// Shared app icons — keep a single source so identical marks don't drift.
//
// Every glyph in the app comes from lucide (lucide.dev) via `lucide-react`.
// Icons are imported directly from 'lucide-react' at each call site; this file
// only holds (a) the app-wide lucide defaults provider and (b) the handful of
// named marks that more than one view shares.
import { LucideProvider } from 'lucide-react'

// App-wide lucide defaults. `absoluteStrokeWidth` makes every `strokeWidth`
// value read as REAL pixels regardless of the icon's rendered size, so a
// 13px icon and a 28px icon with the same strokeWidth look equally heavy —
// matching the hand-drawn SVGs these replaced. Mount this around every React
// root (see main.jsx and the notebook's nested widget root).
export function IconDefaults({ children }) {
  return (
    <LucideProvider size={16} strokeWidth={1.5} absoluteStrokeWidth>
      {children}
    </LucideProvider>
  )
}

// The Live-mode quill (feather strokes + nib + baseline). Used by the notebook
// view-mode switcher and the sidebar header app mark. `currentColor` inherits
// theme. This one is hand-drawn on purpose — it's the Gnos brand mark, NOT a
// lucide glyph, so leave it out of any icon-set swap.
export const IconQuill = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    <path d="M26 3C25 6 22 10 16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
    <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55" />
  </svg>
)
