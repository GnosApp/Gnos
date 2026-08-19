import { Folder } from 'lucide-react'
import { COLLECTION_ICON_MAP } from '@/lib/collectionIconData'

// Renders a collection's face — legacy emoji > custom icon > color dot >
// plain Folder — the one precedence every collection-glyph render site
// should use. Emoji is read-only history now (CollectionEditModal dropped
// the emoji picker — "isn't necessary" — but existing collections that
// already have one still render it until an icon is chosen instead).
export function CollectionFace({ col, size = 13 }) {
  if (col.emoji) return <span style={{ fontSize: size, flexShrink: 0, lineHeight: 1 }}>{col.emoji}</span>
  const IconComp = col.icon && COLLECTION_ICON_MAP[col.icon]
  if (IconComp) return <IconComp size={size} strokeWidth={1.3} style={{ flexShrink: 0, color: col.color || undefined }} />
  if (col.color) return <span style={{ width: size - 1, height: size - 1, borderRadius: 4, background: col.color, flexShrink: 0 }} />
  return <Folder size={size} strokeWidth={1.3} style={{ flexShrink: 0 }} />
}
