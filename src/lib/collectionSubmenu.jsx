import { CollectionFace } from '@/lib/collectionIcons'

// buildAddToCollectionSubmenu — the "Add to Collection" submenu list, shared
// by every item context menu (SideNav.jsx and LibraryView.jsx each used to
// hand-roll this the same way, unfiltered and unsorted). Filters out the
// auto-managed `quicknotes` collection (it's not a user-facing target — see
// A100), sorts alphabetically instead of raw insertion order, checkmarks any
// collection the item already belongs to, and shows each collection's real
// face (emoji/icon/color) via CollectionFace instead of plain text.
//
// Lives outside ContextMenu.jsx (which stayed component-only) so Vite Fast
// Refresh can still hot-swap that file — react-refresh/only-export-components
// errors on a component file that also exports a plain function.
export function buildAddToCollectionSubmenu({ collections, itemId, onCreateNew, onAdd }) {
  const visible = (collections || [])
    .filter(c => c.name !== 'quicknotes')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
  return [
    { label: '+ New Collection', action: () => onCreateNew(itemId) },
    ...(visible.length ? [{ divider: true }] : []),
    ...visible.map(c => ({
      label: c.name,
      iconNode: <CollectionFace col={c} size={13} />,
      checked: (c.items || []).includes(itemId),
      action: () => onAdd(c.id, itemId),
    })),
  ]
}
