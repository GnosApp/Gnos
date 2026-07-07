# Gnos — Release Notes

**Search**
- Fixed book covers rendering huge in global search — now correctly sized (30×42) in the title bar search dropdown.

**Notebook math**
- Natural-language date math now understands shorthand: `today - 2d`, `today + 7w`, `in 3mo`, `5y ago`. Added date-minus-date (`2026-01-01 - today` → days), `weeks/months until/since`, `<weekday> after next`, and `MM/DD` / ISO date parsing.
- New ∑ indicator shows when a `/math` calc zone is active — top-left in the notebook editor, top-right by the save dot in quick notes.
- Quick notes now support the same inline math calculator as the notebook: `expr=` results, `/math` zones, and named variables.

**Quick notes**
- Fixed: quick notes could silently be deleted on restart if an old note's content hadn't finished loading when autosave fired. Now only deletes a note if you actually empty it out yourself.
- The card-fan UI (peek at older/newer notes) reworked twice this session — now shows one real card fanned to each side, pivoting from the bottom like a hand of cards, opaque and a shade lighter than the active note, contained within the card's top/bottom edges so nothing pokes out or gets clipped by the window.
- `/timer` and `/pomo` in the notebook now render as compact vertical rails (matching quick notes' style) instead of full inline widgets — multiple timers/pomodoros stack down the page.

**Sidebar & toolbar**
- Sidebar app mark now matches the notebook's Live-mode quill icon (was a different quill design).
- Customize Toolbar rebuilt: instead of a separate mock page, the real title bar now stays visible (raised above a blurred scrim) as the live drag-and-drop surface, with a floating palette to add/remove/reorder controls.

**Known issues carried into next session** (see `PLANS_quicknote_profile.md`)
- Quick note may show a handful of empty notes on open — suspected leftover empty notes from before this session's delete-on-restart fix; needs confirmation against real data before cleanup.
- A stray shadow/outline artifact appears around the quick-note window — likely the native macOS window shadow stacking with the card's own shadow.
- No setting yet to turn off the card-fan effect.
- The dedicated Profile window is much simpler than the in-app profile (missing the reading-activity heat grid and Top Books section) — plan is to share the richer component instead of the current stripped-down version.
