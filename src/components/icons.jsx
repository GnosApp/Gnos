// Shared app icons — keep a single source so identical marks don't drift.

// The Live-mode quill (feather strokes + nib + baseline). Used by the notebook
// view-mode switcher and the sidebar header app mark. `currentColor` inherits theme.
export const IconQuill = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path d="M26 3C22 5 14 10 10 18C8 22 7 25 6.5 28" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M26 3C24 8 18 15 10 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    <path d="M26 3C25 6 22 10 16 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
    <path d="M6.5 28L9 23" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M3 30h26" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" opacity="0.55" />
  </svg>
)
