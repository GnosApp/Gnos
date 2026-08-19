import { Archive, Bookmark, BookMarked, Briefcase, Coffee, Flame, Folder, FolderOpen, Globe, GraduationCap, Heart, Layers, Music, Palette, Star, Tag } from 'lucide-react'

// Curated icon set for collections. Keyed by name so it's what persists on
// the collection (`col.icon`), not a component reference. Plain data lives
// here (not in collectionIcons.jsx, which stays component-only) —
// react-refresh/only-export-components errors on a component file that
// also exports a constant.
export const COLLECTION_ICONS = [
  { key: 'folder', Icon: Folder }, { key: 'folder-open', Icon: FolderOpen }, { key: 'archive', Icon: Archive },
  { key: 'bookmark', Icon: Bookmark }, { key: 'book-marked', Icon: BookMarked }, { key: 'tag', Icon: Tag },
  { key: 'star', Icon: Star }, { key: 'heart', Icon: Heart }, { key: 'flame', Icon: Flame },
  { key: 'graduation-cap', Icon: GraduationCap }, { key: 'briefcase', Icon: Briefcase }, { key: 'globe', Icon: Globe },
  { key: 'palette', Icon: Palette }, { key: 'music', Icon: Music }, { key: 'coffee', Icon: Coffee }, { key: 'layers', Icon: Layers },
]
export const COLLECTION_ICON_MAP = Object.fromEntries(COLLECTION_ICONS.map(({ key, Icon }) => [key, Icon]))
