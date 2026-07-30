# Plan MOBILE — from user's excalidraw "Mobile changes" spec (2026-07)

User hand-drew a mobile-layout spec. Verbatim intent:

1. **Sidebar opener (top-left)**: the button that opens the sidebar-nav version
   should make the sidebar nav FILL THE SCREEN (full-screen overlay) while still
   keeping the other nav elements present (search, tabs, etc.). Currently it's a
   push/slide panel. Mobile = full-screen nav sheet.
2. **Bottom nav bar** (mobile): home button · plus button · search button. The
   search button "effectively replaces the search bar" in each respective view
   (i.e. tap search → search UI, instead of an always-present search field).
   Drawn as a bottom pill/bar with ~5 icon slots (star/streak, L:b library,
   plus, search/magnify, book/library).
3. **Library view**: move the STREAK button to the TOP, between the sidebar
   button and the settings modal button. "We'll start with this." Also: ALWAYS
   display all three context-menu ellipsis buttons (don't hide behind hover —
   mobile has no hover).

## Recon needed first
- `src/lib/useIsMobile.js` — currently STUBBED to always-desktop in dev (per
  CLAUDE notes). Mobile layout gated on this; confirm real detection path +
  how to force it for testing (`resize_window` mobile preset in browser).
- `App.jsx` MobileTabSwitcher / MobileViewTitle / `.mobile-bottom-bar` already
  exist (grep `mobile-bottom-bar`, `MobileTabSwitcher`) — partial mobile chrome
  is there. Extend rather than build fresh.
- SideNav.jsx sidebar panel — add full-screen variant for mobile.
- LibraryView streak footer (`STREAK` pill) → move to a top slot on mobile;
  card context-menu ellipsis → always-visible on mobile (touch).

## Order (start with #3 per user)
3 (streak to top + always-show ellipsis — smallest, "start with this") →
1 (full-screen sidebar sheet) → 2 (bottom nav: home/plus/search, search
replaces the bar per view).

Verify with browser `resize_window` mobile preset (375x812) — useIsMobile must
report mobile there (fix the dev stub or key off width).
