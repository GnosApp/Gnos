import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react'
import useAppStore from '@/store/useAppStore'
import { loadNotebookContent } from '@/lib/storage'
import { PaneContext } from '@/lib/PaneContext'

const TAG_PALETTE = ['#388bfd','#e05c7a','#56b050','#e8922a','#8250df','#56d4dd','#f0883e','#d29922','#3fb950','#c04060','#e05cbc','#54a0ff']

const DEFAULT_SETTINGS = {
  showOrphans:      true,
  showGhosts:       true,
  showBooks:        true,
  showAudio:        true,
  showSketches:     true,
  colorBy:          'type',
  nodeSize:         4,
  linkThickness:    1.5,
  attrLink:         20,
  attrCollection:   5,
  attrTag:          1.5,
  attrTime:         0.8,
  universalGravity: 0.18,
  repelForce:       1100,
  centerForce:      0.003,
  orbitRadius:      380,
  orbitStrength:    0.35,
  showLabels:       true,
  labelsOnHover:    false,
  animate:          true,
  speed:            0.22,
}

const DEFAULT_TAG_SETTINGS = {
  sortBy:      'frequency',
  showCounts:  true,
  bubbleScale: 1,
  colorBy:     'palette',
}

// ── Node geometry ──────────────────────────────────────────────────────────────
function nodeW(title, degree, sizeFactor, hasIcon = false) {
  const display = (title || '').slice(0, 28)
  const base = Math.max(96, Math.min(260, display.length * 8.5 + 44))
  return base + Math.pow(degree, 0.72) * 8 + sizeFactor * 3 + (hasIcon ? 22 : 0)
}
function nodeH(degree, sizeFactor) {
  return 32 + Math.pow(degree, 0.65) * 6 + sizeFactor * 2
}

// Rectangle-edge intersection for clean edge routing
function rectEdgePoint(cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const hw = w / 2 + 3, hh = h / 2 + 3
  if (Math.abs(dx) * hh >= Math.abs(dy) * hw) {
    const t = hw / Math.abs(dx)
    return { x: cx + Math.sign(dx) * hw, y: cy + dy * t }
  } else {
    const t = hh / Math.abs(dy)
    return { x: cx + dx * t, y: cy + Math.sign(dy) * hh }
  }
}

// ── BFS for nodeLevel (used in selected-node card) ────────────────────────────
function buildNodeLevels(nodes, edges) {
  if (!nodes.length) return {}
  const adjOut = {}, inDeg = {}
  nodes.forEach(n => { adjOut[n.id] = []; inDeg[n.id] = 0 })
  edges.forEach(({ from, to }) => {
    if (adjOut[from]) { adjOut[from].push(to); inDeg[to] = (inDeg[to] || 0) + 1 }
  })
  let roots = nodes.filter(n => (inDeg[n.id] || 0) === 0)
  if (!roots.length) roots = [nodes[0]]
  const nodeLevel = {}, visited = new Set()
  const queue = roots.map(r => ({ id: r.id, level: 0 }))
  while (queue.length) {
    const { id, level } = queue.shift()
    if (visited.has(id)) continue
    visited.add(id); nodeLevel[id] = level
    adjOut[id].forEach(cid => { if (!visited.has(cid)) queue.push({ id: cid, level: level + 1 }) })
  }
  nodes.forEach(n => { if (!visited.has(n.id)) nodeLevel[n.id] = 999 })
  return nodeLevel
}

// ── Temporal spiral initial placement ─────────────────────────────────────────
function applyInitialPositions(nodes, W, H, orphanSet) {
  const cx = W / 2, cy = H / 2
  // Scatter across a large area so nodes migrate toward their attractors.
  // Inner band: 400–900 units; outer band for orphans: 900–1400 units.
  nodes.forEach(n => {
    const isOrphan = orphanSet.has(n.id)
    const minR = isOrphan ? 700 : 350
    const maxR = isOrphan ? 1400 : 950
    const r     = minR + Math.random() * (maxR - minR)
    const angle = Math.random() * Math.PI * 2
    n.x = cx + r * Math.cos(angle)
    n.y = cy + r * Math.sin(angle)
    // Small random velocity — no forced direction so nodes drift naturally
    const vMag = 0.4 + Math.random() * 0.8
    const vAngle = Math.random() * Math.PI * 2
    n.vx = Math.cos(vAngle) * vMag
    n.vy = Math.sin(vAngle) * vMag
    n.isOrphan = isOrphan
  })
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step = 1, fmt, onChange }) {
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
        <span style={{ fontSize:11, color:'var(--textDim)' }}>{label}</span>
        <span style={{ fontSize:10, color:'var(--text)', fontWeight:600, fontVariantNumeric:'tabular-nums' }}>
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
        style={{ width:'100%', accentColor:'var(--accent)', cursor:'pointer' }} />
    </div>
  )
}
function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:9 }}>
      <span style={{ fontSize:11, color:'var(--textDim)' }}>{label}</span>
      <button onClick={() => onChange(!value)} style={{
        width:30, height:16, borderRadius:8, border:'none', cursor:'pointer', padding:0,
        background: value ? 'var(--accent)' : 'var(--border)', position:'relative', transition:'background 0.15s', flexShrink:0,
      }}>
        <span style={{ position:'absolute', top:2, left: value ? 14 : 2, width:12, height:12, borderRadius:'50%', background:'#fff', transition:'left 0.15s', display:'block' }} />
      </button>
    </div>
  )
}
function Section({ title, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--textDim)', opacity:.55, marginBottom:8, paddingBottom:5, borderBottom:'1px solid var(--border)' }}>{title}</div>
      {children}
    </div>
  )
}

// ── Type icons — match the add-dropdown icons in LibraryView exactly ──────────
function TypeIcon({ kind, size = 10, color = 'currentColor' }) {
  const s = { flexShrink: 0 }
  if (kind === 'notebook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={s}>
      <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.6"/>
      <line x1="7" y1="8"  x2="17" y2="8"  stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="7" y1="12" x2="17" y2="12" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="7" y1="16" x2="12" y2="16" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
  if (kind === 'book') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={s}>
      <path d="M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2zm0 0a2 2 0 0 0 2 2h13"
        stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="9" y1="7"  x2="16" y2="7"  stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="9" y1="11" x2="14" y2="11" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
  if (kind === 'audiobook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={s}>
      <path d="M9 18c0 1.66-1.34 3-3 3H4c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1zM22 15c0 1.66-1.34 3-3 3h-2c-1.66 0-3-1.34-3-3v-1c0-1.66 1.34-3 3-3h2c1.66 0 3 1.34 3 3v1z"
        stroke={color} strokeWidth="1.5"/>
      <path d="M9 19V8l13-3v10" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (kind === 'sketchbook') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={s}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        stroke={color} strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
        stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (kind === 'ghost') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={s}>
      <path d="M12 3a7 7 0 0 0-7 7v11l3-3 2 2 2-2 2 2 2-2 3 3V10a7 7 0 0 0-7-7z"
        stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  )
  return null
}

// ── Tag Bubble Canvas ──────────────────────────────────────────────────────────
function TagBubbleCanvas({ tags, maxCount, selected, onSelect, notebooks, tagSettings, graphTab, setGraphTab }) {
  const ref = useRef(null)
  const [bubbles, setBubbles] = useState([])
  const [hovered, setHovered] = useState(null)
  const [listOpen, setListOpen] = useState(true)

  const sortedTags = useMemo(() => {
    if (tagSettings.sortBy === 'alpha') return [...tags].sort((a, b) => a[0].localeCompare(b[0]))
    return tags
  }, [tags, tagSettings.sortBy])

  useEffect(() => {
    const el = ref.current
    if (!el || !sortedTags.length) return
    const W = el.clientWidth || 600, H = el.clientHeight || 500
    const cx = W / 2, cy = H / 2
    const scale = tagSettings.bubbleScale ?? 1
    setBubbles(sortedTags.map(([tag, count], i) => {
      const r = (14 + Math.sqrt(count / maxCount) * 64) * scale
      const angle = i * 2.399, dist = 55 + Math.sqrt(i) * 62
      return {
        tag, count, r,
        x: Math.max(r + 10, Math.min(W - r - 10, cx + dist * Math.cos(angle))),
        y: Math.max(r + 10, Math.min(H - r - 10, cy + dist * Math.sin(angle))),
      }
    }))
  }, [sortedTags, maxCount, tagSettings.bubbleScale])

  const taggedNotes = selected ? notebooks.filter(nb => (nb.tags || []).includes(selected)) : []

  return (
    <div ref={ref} style={{ flex:1, position:'relative', overflow:'hidden',
      background:'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--surfaceAlt) 55%, var(--bg)) 0%, var(--bg) 70%)' }}>

      <div style={{ position:'absolute', inset:0, pointerEvents:'none',
        backgroundImage:'radial-gradient(circle, var(--border) 0.8px, transparent 0.8px)',
        backgroundSize:'26px 26px', opacity:.2 }} />

      {/* Floating tab switcher */}
      <div style={{ position:'absolute', top:12, left:12, zIndex:20, display:'flex', gap:3,
        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:3,
        boxShadow:'0 2px 14px rgba(0,0,0,0.25)', backdropFilter:'blur(8px)' }}>
        {[['connections','Connections'],['tags','Tags']].map(([k,l]) => (
          <button key={k} onClick={() => setGraphTab(k)} style={{
            height:24, padding:'0 10px', fontSize:11, fontWeight:600, borderRadius:6,
            border:'none', cursor:'pointer', fontFamily:'inherit',
            background: graphTab===k ? 'var(--accent)' : 'none',
            color: graphTab===k ? '#fff' : 'var(--textDim)',
            transition:'all 0.15s',
          }}>{l}</button>
        ))}
      </div>

      <svg width="100%" height="100%" style={{ display:'block' }}>
        {bubbles.map(({ tag, count, r, x, y }, i) => {
          const palette = TAG_PALETTE[i % TAG_PALETTE.length]
          const color   = tagSettings.colorBy === 'accent' ? 'var(--accent)' : palette
          const active  = selected === tag || hovered === tag
          return (
            <g key={tag} style={{ cursor:'pointer' }}
              onClick={() => onSelect(selected === tag ? null : tag)}
              onMouseEnter={() => setHovered(tag)} onMouseLeave={() => setHovered(null)}>
              <circle cx={x} cy={y} r={r}
                fill={`${palette}${active ? 'cc' : '22'}`}
                stroke={color} strokeWidth={active ? 2.5 : 1.5}
                style={{ transition:'all 0.2s' }} />
              {tagSettings.showCounts && r > 22 && (
                <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                  fontSize={Math.max(8, r * 0.3)} fontWeight={600}
                  fill={active ? 'var(--text)' : color + '99'}
                  style={{ pointerEvents:'none', fontFamily:'inherit' }}>
                  {count}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Floating tag list */}
      <div style={{ position:'absolute', top:12, right:12, zIndex:20, display:'flex', flexDirection:'column', gap:0 }}>
        <button onClick={() => setListOpen(o => !o)} style={{
          alignSelf:'flex-end', height:26, padding:'0 10px', fontSize:11, fontWeight:600,
          background:'var(--surface)', border:'1px solid var(--border)', borderRadius:listOpen ? '7px 7px 0 0' : 7,
          color:'var(--textDim)', cursor:'pointer', fontFamily:'inherit',
          boxShadow:'0 2px 10px rgba(0,0,0,0.2)',
        }}>
          {listOpen ? 'Hide tags ↑' : 'Tags ↓'}
        </button>
        {listOpen && (
          <div style={{
            background:'var(--surface)', border:'1px solid var(--border)', borderTop:'none',
            borderRadius:'0 0 10px 10px', maxHeight:320, overflowY:'auto', minWidth:170,
            boxShadow:'0 6px 20px rgba(0,0,0,0.3)', backdropFilter:'blur(8px)',
          }}>
            {sortedTags.length === 0 && (
              <div style={{ padding:'10px 14px', fontSize:11, color:'var(--textDim)' }}>No tags yet.</div>
            )}
            {sortedTags.map(([tag, count], i) => {
              const color = TAG_PALETTE[i % TAG_PALETTE.length]
              const isSel = selected === tag
              return (
                <button key={tag} onClick={() => onSelect(isSel ? null : tag)} style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%',
                  padding:'6px 12px', background: isSel ? `${color}20` : 'none',
                  border:'none', borderLeft: isSel ? `3px solid ${color}` : '3px solid transparent',
                  cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }} />
                  <span style={{ flex:1, fontSize:12, fontWeight:500, color: isSel ? color : 'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tag}</span>
                  {tagSettings.showCounts && (
                    <span style={{ fontSize:10, color:'var(--textDim)', background:'var(--surfaceAlt)', borderRadius:4, padding:'1px 5px', flexShrink:0 }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selected && taggedNotes.length > 0 && (
        <div style={{ position:'absolute', bottom:16, left:16, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'12px 14px', minWidth:180, maxWidth:260, boxShadow:'0 4px 20px rgba(0,0,0,.4)', zIndex:10 }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--textDim)', marginBottom:8 }}>Notes tagged "{selected}"</div>
          {taggedNotes.map(nb => (
            <div key={nb.id} style={{ fontSize:12, color:'var(--text)', padding:'2px 0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nb.title || 'Untitled'}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Pairwise attraction key ────────────────────────────────────────────────────
function pairKey(a, b) {
  return a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id
}

// ── Main Nebuli view ───────────────────────────────────────────────────────────
export default function GraphView() {
  const paneTabId   = useContext(PaneContext)
  const notebooks   = useAppStore(s => s.notebooks)
  const library     = useAppStore(s => s.library)
  const sketchbooks = useAppStore(s => s.sketchbooks)
  const collections = useAppStore(s => s.collections)

  const [graphTab,     setGraphTab]    = useState('connections')
  const [loading,      setLoading]     = useState(true)
  const [edges,        setEdges]       = useState([])
  const [ghostNodes,   setGhostNodes]  = useState([])
  const [hoveredId,    setHoveredId]   = useState(null)
  const [selectedId,   setSelectedId]  = useState(null)
  const [selectedTag,  setSelectedTag] = useState(null)
  const [settings,     setSettings]    = useState(DEFAULT_SETTINGS)
  const [tagSettings,  setTagSettings] = useState(DEFAULT_TAG_SETTINGS)
  const [settingsOpen, setSettingsOpen]= useState(true)
  const [search,       setSearch]      = useState('')
  const [revealCount,  setRevealCount] = useState(0)
  const [circleNodes,    setCircleNodes]    = useState(false)
  const [showPlanetsCmd, setShowPlanetsCmd] = useState(false)
  const [showOrbitalInfo, setShowOrbitalInfo] = useState(false)
  const [showAttrInfo,    setShowAttrInfo]    = useState(false)

  const setSetting    = useCallback((k, v) => setSettings(s => ({ ...s, [k]: v })), [])
  const setTagSetting = useCallback((k, v) => setTagSettings(s => ({ ...s, [k]: v })), [])

  const [offset, setOffset] = useState({ x:0, y:0 })
  const [scale,  setScale]  = useState(1)

  const containerRef = useRef(null)
  const nodesRef     = useRef([])
  const alphaRef     = useRef(1)
  const animRef      = useRef(null)
  const settingsRef  = useRef(settings)
  const followIdRef      = useRef(null)   // id of node the viewport is tracking
  const scaleRef         = useRef(1)      // mirror of scale state for use inside step()
  const primarySunRef    = useRef({})     // live copy of primarySun map for overlay
  const orbitersOfRef    = useRef({})     // live copy of orbitersOf map for overlay
  const sunWeightRef     = useRef({})     // live copy of sunAttrWeight for overlay
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => { scaleRef.current = scale }, [scale])

  const [, forceRender] = useState(0)

  // ── Normalise all content into unified items ──────────────────────────────────
  const books      = useMemo(() => library.filter(b => b.type !== 'audio'), [library])
  const audiobooks = useMemo(() => library.filter(b => b.type === 'audio'), [library])

  // ── Load wikilinks + detect ghost nodes ──────────────────────────────────────
  // linkedPairs is a Set of "id|id" keys (sorted)
  const linkedPairsRef = useRef(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const seen = new Set(), result = []
      const ghostMap = new Map()
      const linkedSet = new Set()
      // All real items are valid link targets (not just notebooks)
      const allTargets = [
        ...notebooks.map(n => ({ id: n.id, title: n.title })),
        ...books.map(b => ({ id: b.id, title: b.title })),
        ...audiobooks.map(b => ({ id: b.id, title: b.title })),
        ...sketchbooks.map(s => ({ id: s.id, title: s.title })),
      ]
      for (const nb of notebooks) {
        try {
          const content = await loadNotebookContent(nb.id)
          const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
          let m
          while ((m = re.exec(content || '')) !== null) {
            const refTitle = m[1].trim()
            const refLower = refTitle.toLowerCase()
            const t = allTargets.find(n => n.title?.toLowerCase() === refLower && n.id !== nb.id)
            if (t) {
              const key = [nb.id, t.id].sort().join('|')
              linkedSet.add(key)
              if (!seen.has(key)) { seen.add(key); result.push({ from: nb.id, to: t.id }) }
            } else {
              const ghostId = `ghost:${refLower}`
              if (!ghostMap.has(ghostId)) ghostMap.set(ghostId, { id: ghostId, title: refTitle, isGhost: true, _kind: 'ghost', tags: [], createdAt: null })
              const key = [nb.id, ghostId].sort().join('|')
              linkedSet.add(key)
              if (!seen.has(key)) { seen.add(key); result.push({ from: nb.id, to: ghostId }) }
            }
          }
        } catch { /* skip */ }
      }
      if (!cancelled) {
        linkedPairsRef.current = linkedSet
        setEdges(result)
        setGhostNodes([...ghostMap.values()])
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [notebooks, books, audiobooks, sketchbooks])

  // ── All items unified ─────────────────────────────────────────────────────────
  const allItems = useMemo(() => {
    const nbItems = notebooks.map(nb => ({ ...nb, _kind: 'notebook', tags: nb.tags || [], createdAtMs: nb.createdAt ? new Date(nb.createdAt).getTime() : 0 }))
    const bookItems = books.map(b => ({ ...b, _kind: 'book', tags: b.tags || [], createdAtMs: b.createdAt ? new Date(b.createdAt).getTime() : 0 }))
    const audioItems = audiobooks.map(b => ({ ...b, _kind: 'audiobook', tags: b.tags || [], createdAtMs: b.createdAt ? new Date(b.createdAt).getTime() : 0 }))
    const sketchItems = sketchbooks.map(sb => ({ ...sb, _kind: 'sketchbook', tags: sb.tags || [], createdAtMs: sb.createdAt ? new Date(sb.createdAt).getTime() : 0 }))
    const ghostItems = ghostNodes.map(g => ({ ...g, _kind: 'ghost', tags: [], createdAtMs: 0 }))
    return [...nbItems, ...bookItems, ...audioItems, ...sketchItems, ...ghostItems]
  }, [notebooks, books, audiobooks, sketchbooks, ghostNodes])

  // ── Degree map (wikilinks only, for orphan determination) ─────────────────────
  const degreeMap = useMemo(() => {
    const m = {}
    allItems.forEach(n => { m[n.id] = 0 })
    edges.forEach(({ from, to }) => {
      if (m[from] != null) m[from]++
      if (m[to]   != null) m[to]++
    })
    return m
  }, [allItems, edges])

  // ── Orphan set (degree 0 in wikilink graph) ────────────────────────────────────
  const orphanSet = useMemo(() => {
    const s = new Set()
    allItems.forEach(n => { if ((degreeMap[n.id] || 0) === 0) s.add(n.id) })
    return s
  }, [allItems, degreeMap])

  // ── Pairwise attraction — precomputed ─────────────────────────────────────────
  const pairwiseAttr = useMemo(() => {
    const cfg = {
      attrLink:       settings.attrLink,
      attrCollection: settings.attrCollection,
      attrTag:        settings.attrTag,
      attrTime:       settings.attrTime,
    }
    const map = {}
    const items = allItems
    const linked = linkedPairsRef.current

    // Build per-item collection membership
    const itemCollections = {}
    items.forEach(n => { itemCollections[n.id] = [] })
    collections.forEach(col => {
      (col.items || []).forEach(itemId => {
        if (itemCollections[itemId]) itemCollections[itemId].push(col.id)
      })
    })

    const MS_PER_DAY = 86400000
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j]
        let attr = 0.03 // base — all nodes weakly attract

        // Same type (weak background pull)
        if (a._kind === b._kind) attr += 0.15

        // Temporal cohesion
        if (a.createdAtMs && b.createdAtMs) {
          const daysDiff = Math.abs(a.createdAtMs - b.createdAtMs) / MS_PER_DAY
          attr += cfg.attrTime * Math.exp(-daysDiff / 2)
        }

        // Shared tags
        const aTags = a.tags || [], bTags = b.tags || []
        let sharedTags = 0
        aTags.forEach(t => { if (bTags.includes(t)) sharedTags++ })
        attr += cfg.attrTag * sharedTags

        // Shared collections
        const aColls = itemCollections[a.id] || [], bColls = itemCollections[b.id] || []
        let sharedColls = 0
        aColls.forEach(c => { if (bColls.includes(c)) sharedColls++ })
        attr += cfg.attrCollection * sharedColls

        // Direct wikilink
        const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id
        if (linked.has(key)) attr += cfg.attrLink

        map[key] = attr
      }
    }
    return map
  }, [allItems, edges, collections, settings.attrLink, settings.attrCollection, settings.attrTag, settings.attrTime])

  // ── Node attract score (sum of all pairwise) — used for mass ─────────────────
  const nodeAttractScore = useMemo(() => {
    const score = {}
    allItems.forEach(n => { score[n.id] = 0 })
    Object.entries(pairwiseAttr).forEach(([key, val]) => {
      const [aId, bId] = key.split('|')
      if (score[aId] != null) score[aId] += val
      if (bId && score[bId] != null) score[bId] += val
    })
    return score
  }, [allItems, pairwiseAttr])

  // ── All visible nodes (filtered by settings) ──────────────────────────────────
  const allVisibleNodes = useMemo(() => {
    const connSet = new Set(edges.flatMap(e => [e.from, e.to]))
    const result = []

    // Notebooks
    const nbs = settings.showOrphans
      ? notebooks.map(nb => ({ ...nb, _kind: 'notebook', tags: nb.tags || [], createdAtMs: nb.createdAt ? new Date(nb.createdAt).getTime() : 0 }))
      : notebooks.filter(nb => connSet.has(nb.id)).map(nb => ({ ...nb, _kind: 'notebook', tags: nb.tags || [], createdAtMs: nb.createdAt ? new Date(nb.createdAt).getTime() : 0 }))
    result.push(...nbs)

    // Books
    if (settings.showBooks) {
      const bks = settings.showOrphans ? books : books.filter(b => connSet.has(b.id))
      result.push(...bks.map(b => ({ ...b, _kind: 'book', tags: b.tags || [], createdAtMs: b.createdAt ? new Date(b.createdAt).getTime() : 0 })))
    }

    // Audiobooks
    if (settings.showAudio) {
      const abs = settings.showOrphans ? audiobooks : audiobooks.filter(b => connSet.has(b.id))
      result.push(...abs.map(b => ({ ...b, _kind: 'audiobook', tags: b.tags || [], createdAtMs: b.createdAt ? new Date(b.createdAt).getTime() : 0 })))
    }

    // Sketchbooks
    if (settings.showSketches) {
      const sbs = settings.showOrphans ? sketchbooks : sketchbooks.filter(sb => connSet.has(sb.id))
      result.push(...sbs.map(sb => ({ ...sb, _kind: 'sketchbook', tags: sb.tags || [], createdAtMs: sb.createdAt ? new Date(sb.createdAt).getTime() : 0 })))
    }

    // Ghosts
    if (settings.showGhosts) {
      result.push(...ghostNodes.map(g => ({ ...g, _kind: 'ghost', tags: [], createdAtMs: 0 })))
    }

    return result
  }, [notebooks, books, audiobooks, sketchbooks, ghostNodes, edges, settings.showOrphans, settings.showGhosts, settings.showBooks, settings.showAudio, settings.showSketches])

  // ── Visible degree map ────────────────────────────────────────────────────────
  const visibleDegreeMap = useMemo(() => {
    const m = {}
    allVisibleNodes.forEach(n => { m[n.id] = 0 })
    edges.forEach(({ from, to }) => {
      if (m[from] != null) m[from]++
      if (m[to]   != null) m[to]++
    })
    return m
  }, [allVisibleNodes, edges])

  // ── Visible orphan set ────────────────────────────────────────────────────────
  const visibleOrphanSet = useMemo(() => {
    const s = new Set()
    allVisibleNodes.forEach(n => { if ((visibleDegreeMap[n.id] || 0) === 0) s.add(n.id) })
    return s
  }, [allVisibleNodes, visibleDegreeMap])

  // ── Chronological order (for reveal animation) ────────────────────────────────
  const chronoOrder = useMemo(() =>
    [...allVisibleNodes].sort((a, b) => {
      if (a._kind === 'ghost' && b._kind !== 'ghost') return 1
      if (a._kind !== 'ghost' && b._kind === 'ghost') return -1
      return (a.createdAtMs || 0) - (b.createdAtMs || 0)
    }),
    [allVisibleNodes]
  )

  // ── Node level lookup ─────────────────────────────────────────────────────────
  const nodeLevel = useMemo(() =>
    buildNodeLevels(allVisibleNodes, edges),
    [allVisibleNodes, edges]
  )

  // ── Tag color map ─────────────────────────────────────────────────────────────
  const tagColorMap = useMemo(() => {
    const freq = {}
    for (const nb of notebooks) for (const t of (nb.tags || [])) freq[t] = (freq[t] || 0) + 1
    const sorted = Object.keys(freq).sort((a, b) => freq[b] - freq[a])
    const m = {}
    sorted.forEach((t, i) => { m[t] = TAG_PALETTE[i % TAG_PALETTE.length] })
    return m
  }, [notebooks])

  // ── Init / rebuild physics nodes ──────────────────────────────────────────────
  useEffect(() => {
    if (loading || graphTab !== 'connections') return
    const el = containerRef.current
    const W = el?.clientWidth || 800, H = el?.clientHeight || 600
    const existingById = {}
    nodesRef.current.forEach(n => { existingById[n.id] = n })

    const newNodes = allVisibleNodes.map(nd => {
      const deg         = visibleDegreeMap[nd.id] || 0
      const hasIcon     = nd._kind !== 'ghost' // all real types get an icon
      const w           = nodeW(nd.title || 'Untitled', deg, settings.nodeSize, hasIcon)
      const h           = nodeH(deg, settings.nodeSize)
      const attrScore   = nodeAttractScore[nd.id] || 0
      const mass        = 1 + Math.sqrt(attrScore) * 2.5
      const refCount    = deg  // total wikilink degree (in + out), used for orbital direction
      const createdAtMs = nd.createdAtMs || 0
      const ex = existingById[nd.id]
      if (ex) return { ...ex, title: nd.title || 'Untitled', tags: nd.tags || [], _kind: nd._kind, isGhost: nd._kind === 'ghost', w, h, mass, refCount, createdAtMs }
      return {
        id: nd.id, title: nd.title || 'Untitled', tags: nd.tags || [], _kind: nd._kind,
        createdAt: nd.createdAt, createdAtMs,
        isGhost: nd._kind === 'ghost', isOrphan: visibleOrphanSet.has(nd.id),
        x: W/2 + (Math.random()-0.5)*80, y: H/2 + (Math.random()-0.5)*80,
        vx: 0, vy: 0, w, h, mass, refCount,
      }
    })
    applyInitialPositions(newNodes, W, H, visibleOrphanSet)
    nodesRef.current = newNodes
    alphaRef.current = 1
    forceRender(c => c + 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allVisibleNodes, edges, graphTab, settings.nodeSize])

  // ── Chronological reveal ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || graphTab !== 'connections') return
    setRevealCount(0)
    const total = chronoOrder.length
    if (!total) return
    let i = 0
    const t = setInterval(() => {
      i++; setRevealCount(i)
      if (i >= total) clearInterval(t)
    }, Math.max(40, Math.min(200, 1200 / total)))
    return () => clearInterval(t)
  }, [loading, graphTab, chronoOrder.length])

  // ── Physics loop — gravity-only orbits ────────────────────────────────────────
  useEffect(() => {
    if (graphTab !== 'connections') return
    if (!settings.animate) { if (animRef.current) cancelAnimationFrame(animRef.current); return }

    const step = () => {
      const ns  = nodesRef.current
      const cfg = settingsRef.current
      if (!ns.length) { animRef.current = requestAnimationFrame(step); return }

      const el = containerRef.current
      const W = el?.clientWidth || 800, H = el?.clientHeight || 600
      const cx = W/2, cy = H/2
      const alpha = Math.max(alphaRef.current, 0.02)

      ns.forEach(n => { n.fx = 0; n.fy = 0 })

      // ── Wall repulsion — soft push from world-space canvas boundaries ─────
      // Only activates within wallM of the world edge; quadratic so the effect
      // is nearly invisible at the margin and firm near the edge.
      {
        const hwW = W * 1.8, hwH = H * 1.8
        const wallM = Math.min(W, H) * 0.32
        ns.forEach(n => {
          const rx = n.x - cx, ry = n.y - cy
          const dL = rx + hwW;     if (dL < wallM) n.fx += Math.pow(1 - dL / wallM, 2) * 3
          const dR = hwW - rx;     if (dR < wallM) n.fx -= Math.pow(1 - dR / wallM, 2) * 3
          const dT = ry + hwH;     if (dT < wallM) n.fy += Math.pow(1 - dT / wallM, 2) * 3
          const dB = hwH - ry;     if (dB < wallM) n.fy -= Math.pow(1 - dB / wallM, 2) * 3
        })
      }

      // ── Node repulsion + hard collision prevention ─────────────────────────
      // Short-range 1/r² repulsion keeps nodes apart.
      // Medium-range mass-weighted 1/r repulsion separates clusters ("galaxy repulsion").
      const rep = cfg.repelForce * alpha
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const d2 = Math.max(dx*dx + dy*dy, 1)
          const d  = Math.sqrt(d2)
          const nx = dx/d, ny = dy/d
          const mA = a.mass || 1, mB = b.mass || 1

          // Short-range repulsion (falls off as 1/r²)
          const fShort = Math.min(rep / d2, 160)
          // Medium-range galaxy-scale repulsion (1/r, mass-weighted) — separates clusters
          const fMid   = Math.min(rep * Math.sqrt(mA * mB) * 0.08 / d, 40)
          const fTotal = fShort + fMid
          a.fx -= nx*fTotal; a.fy -= ny*fTotal
          b.fx += nx*fTotal; b.fy += ny*fTotal

          // Soft personal-space bubble: smooth repulsion that activates before nodes
          // physically overlap so they steer around each other instead of colliding.
          const bubbleR = (a.w + b.w) / 2 + 80   // 80 units of padding beyond node edges
          if (d < bubbleR) {
            const strength = Math.pow((bubbleR - d) / bubbleR, 2) * 18
            a.fx -= nx * strength; a.fy -= ny * strength
            b.fx += nx * strength; b.fy += ny * strength
          }

          // Orphan mutual attraction: orphans visibly congregate into clouds.
          // Acts as a medium-range soft gravity only between orphan nodes so
          // they cluster without being pulled into the main solar systems.
          if (a.isOrphan && b.isOrphan) {
            const orphanF = Math.min(20 / (d + 60), 0.55)
            a.fx += nx * orphanF; a.fy += ny * orphanF
            b.fx -= nx * orphanF; b.fy -= ny * orphanF
          }

          // Hard collision: mass-weighted position correction + momentum impulse.
          // Heavier node moves less of the separation; lighter node gets pushed away.
          // "Stuck burst" fires when nodes overlap but aren't moving apart, preventing
          // them from freezing together under gravity.
          const halfW = (a.w + b.w) / 2 + 4
          const halfH = (a.h + b.h) / 2 + 4
          const overlapX = halfW - Math.abs(dx)
          const overlapY = halfH - Math.abs(dy)
          if (overlapX > 0 && overlapY > 0) {
            const totalMass = mA + mB
            const shareA = mB / totalMass   // heavy B → A moves less
            const shareB = mA / totalMass   // heavy A → B moves less
            let cnx = 0, cny = 0, overlapDepth = 0
            if (overlapX < overlapY) {
              cnx = dx >= 0 ? 1 : -1
              overlapDepth = overlapX
              a.x -= cnx * overlapX * shareA
              b.x += cnx * overlapX * shareB
            } else {
              cny = dy >= 0 ? 1 : -1
              overlapDepth = overlapY
              a.y -= cny * overlapY * shareA
              b.y += cny * overlapY * shareB
            }
            const vRelN = (a.vx - b.vx) * cnx + (a.vy - b.vy) * cny
            // Stuck burst: when nodes are deeply overlapping but barely moving relative
            // to each other, inject a separation kick proportional to overlap depth.
            // The lighter node absorbs more of the burst (impulse ÷ mass).
            const stuckBurst = Math.abs(vRelN) < 0.8 ? overlapDepth * 0.12 : 0
            const effectiveVRel = vRelN + stuckBurst
            if (effectiveVRel > 0) {
              const e = 0.18
              const j = (1 + e) * effectiveVRel / (1 / mA + 1 / mB)
              a.vx -= j / mA * cnx;  a.vy -= j / mA * cny
              b.vx += j / mB * cnx;  b.vy += j / mB * cny
              const capV = 14
              const va2 = a.vx*a.vx + a.vy*a.vy
              if (va2 > capV*capV) { const s = capV/Math.sqrt(va2); a.vx *= s; a.vy *= s }
              const vb2 = b.vx*b.vx + b.vy*b.vy
              if (vb2 > capV*capV) { const s = capV/Math.sqrt(vb2); b.vx *= s; b.vy *= s }
            }
          }
        }
      }

      // ── Find each node's primary sun + accumulate sun attraction weight ───
      // primarySun[id]     = id of strongest attractor (the node's "sun")
      // sunAttrWeight[id]  = sum of pairwiseAttr from every orbiter pointing here
      //                      → drives how fixed the sun is. A sun with a directly
      //                        linked orbiter (attr=20) is far more fixed than one
      //                        with only base-attraction orphan orbiters (attr≈0.18).
      const primarySun = {}
      const sunAttrWeight = {}
      ns.forEach(n => { sunAttrWeight[n.id] = 0 })
      ns.forEach(n => {
        let bestAttr = -1, bestId = null
        const nMass = n.mass || 1
        // Real nodes use mass-based dominance: only orbit nodes with mass >= 90% of own.
        // This means the most-connected node in a cluster naturally becomes a free sun —
        // it finds no neighbor dominant enough to orbit and gets no primarySun assigned.
        // Equal-mass nodes (orphans, evenly connected) still form binary orbits since
        // otherMass (= nMass) passes the 0.9 threshold.
        // Ghosts skip this check entirely and just find their closest real-node attractor.
        for (let j = 0; j < ns.length; j++) {
          const other = ns[j]
          if (other.id === n.id) continue
          if (!n.isGhost && other.isGhost) continue          // real nodes never orbit ghosts
          if (!n.isGhost && (other.mass || 1) < nMass * 0.9) continue  // skip less-dominant nodes
          const k = n.id < other.id ? n.id + '|' + other.id : other.id + '|' + n.id
          const a = (pairwiseAttr && pairwiseAttr[k]) || 0.03
          if (a > bestAttr) { bestAttr = a; bestId = other.id }
        }
        // Ghosts: find best real-node attractor with no mass restriction
        if (!bestId && n.isGhost) {
          for (let j = 0; j < ns.length; j++) {
            const other = ns[j]
            if (other.id === n.id) continue
            const k = n.id < other.id ? n.id + '|' + other.id : other.id + '|' + n.id
            const a = (pairwiseAttr && pairwiseAttr[k]) || 0.03
            if (a > bestAttr) { bestAttr = a; bestId = other.id }
          }
        }
        if (bestId) {
          primarySun[n.id] = bestId
          sunAttrWeight[bestId] = (sunAttrWeight[bestId] || 0) + bestAttr
        }
      })

      // ── Hierarchical sun re-assignment ────────────────────────────────────
      // If node1 wants to orbit node2, but node2's bond to its own sun is stronger
      // than node2's bond to node1, redirect node1 to orbit node2's sun instead
      // (node1 joins the outer ring of the same solar system).
      // If node1-node2 bond is stronger, keep the hierarchy: node1 orbits node2
      // which itself orbits node2's sun (moon → planet → star).
      {
        const toReassign = []
        ns.forEach(node1 => {
          const node2Id = primarySun[node1.id]
          if (!node2Id) return
          const node2SunId = primarySun[node2Id]
          if (!node2SunId) return  // node2 is a free sun — hierarchy is fine
          const k12 = node1.id < node2Id ? node1.id + '|' + node2Id : node2Id + '|' + node1.id
          const attr12 = (pairwiseAttr && pairwiseAttr[k12]) || 0.03
          const k2s = node2Id < node2SunId ? node2Id + '|' + node2SunId : node2SunId + '|' + node2Id
          const attr2s = (pairwiseAttr && pairwiseAttr[k2s]) || 0.03
          if (attr2s > attr12) {
            toReassign.push([node1.id, node2SunId, attr12, node2Id])
          }
        })
        toReassign.forEach(([node1Id, node2SunId, attr12, oldSunId]) => {
          sunAttrWeight[oldSunId] = Math.max((sunAttrWeight[oldSunId] || 0) - attr12, 0)
          primarySun[node1Id] = node2SunId
          sunAttrWeight[node2SunId] = (sunAttrWeight[node2SunId] || 0) + attr12
        })
      }

      // ── Co-orbiter angular spreading ───────────────────────────────────────
      // Planets sharing the same sun get extra repulsion between each other so
      // they spread around the orbit instead of stacking at the same position.
      const nodeById = {}
      ns.forEach(n => { nodeById[n.id] = n })
      const orbitersOf = {}
      ns.forEach(n => {
        const sunId = primarySun[n.id]
        if (sunId) { (orbitersOf[sunId] = orbitersOf[sunId] || []).push(n) }
      })
      // Publish to refs so the overlay can read them without extra state updates
      primarySunRef.current = primarySun
      orbitersOfRef.current = orbitersOf
      sunWeightRef.current  = sunAttrWeight
      Object.values(orbitersOf).forEach(group => {
        if (group.length < 2) return
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i], b = group[j]
            const dx = b.x - a.x, dy = b.y - a.y
            const d2 = dx*dx + dy*dy || 1
            const d  = Math.sqrt(d2)
            const nx = dx/d, ny = dy/d
            // Stronger repulsion between co-orbiters to spread them angularly
            const f = Math.min(260 / d2, 22)
            a.fx -= nx*f; a.fy -= ny*f
            b.fx += nx*f; b.fy += ny*f
          }
        }
      })

      // ── Solar corona: suns repel all nearby nodes ─────────────────────────
      // Every node acting as a sun emits an outward pressure that scales with
      // how many/how strongly nodes orbit it (sunAttrWeight). Force intensifies
      // as nodes get closer, keeping the area around the sun clear and preventing
      // collisions. Unrelated passing nodes are also pushed clear.
      ns.forEach(sun => {
        const solarWeight = sunAttrWeight[sun.id] || 0
        if (solarWeight < 0.5) return  // only nodes actually acting as suns
        const coronaRadius = 280 + solarWeight * 3  // heavier suns have wider corona
        for (let k = 0; k < ns.length; k++) {
          const other = ns[k]
          if (other.id === sun.id) continue
          const cdx = other.x - sun.x, cdy = other.y - sun.y
          const cr = Math.sqrt(cdx*cdx + cdy*cdy) || 1
          if (cr >= coronaRadius) continue
          const cnx = cdx/cr, cny = cdy/cr
          // 1/r force — gets much stronger close in, fades at corona edge
          const f = Math.min(solarWeight * 0.9 / (cr + 15), 12)
          other.fx += cnx * f;  other.fy += cny * f
          // Sun barely reacts (it's stabilised by drag)
          sun.fx -= cnx * f * 0.08;  sun.fy -= cny * f * 0.08
        }
      })

      // ── Orbital target-tracking ────────────────────────────────────────────
      // Each orbiting node has a target position on its ideal ring around its sun.
      // Every frame the target advances CW by dTheta. A spring pulls the node
      // toward that target. Because the target is always moving CW, the node
      // always has somewhere to go — no oscillation, guaranteed revolution.
      //
      // Tier-based idealR:  attr≥15→500  attr≥5→700  attr≥1.5→950  attr≥0.3→1250  →1700
      // dTheta scales with sqrt(attr) so wikilink nodes orbit faster than tag nodes.
      const tierR = (a) => a >= 15 ? 500 : a >= 5 ? 700 : a >= 1.5 ? 950 : a >= 0.3 ? 1250 : 1700
      const ORB_K = 0.010   // spring stiffness toward the moving target
      const SUN_K = 0.04    // fraction of spring force that nudges the sun

      ns.forEach(orbiter => {
        const sunId = primarySun[orbiter.id]
        if (!sunId) return
        const sun = nodeById[sunId]
        if (!sun) return

        const key = orbiter.id < sunId ? orbiter.id + '|' + sunId : sunId + '|' + orbiter.id
        const attr = (pairwiseAttr && pairwiseAttr[key]) || 0.03
        const idealR = tierR(attr)

        // Current angle of orbiter relative to sun
        const angle = Math.atan2(orbiter.y - sun.y, orbiter.x - sun.x)

        // Advance CW: in screen coords (y-down), increasing angle = CW
        const dTheta = 0.0008 * Math.sqrt(attr)

        // Target: idealR from sun at the advanced angle
        const tAngle = angle + dTheta
        const tx = sun.x + idealR * Math.cos(tAngle)
        const ty = sun.y + idealR * Math.sin(tAngle)

        // Spring force toward target — handles radial correction and CW advance
        const fx = (tx - orbiter.x) * ORB_K
        const fy = (ty - orbiter.y) * ORB_K
        orbiter.fx += fx
        orbiter.fy += fy
        // Sun barely reacts so it stays stable
        sun.fx -= fx * SUN_K
        sun.fy -= fy * SUN_K
      })

      // ── Sun stability driven by total orbiter attraction weight ────────────
      // sunAttrWeight sums the pairwiseAttr of every node orbiting this sun.
      // A sun with one directly-linked orbiter (attr=20) gets drag≈0.50 → very stable.
      // A sun with five linked orbiters (weight=100) gets drag≈0.92 → nearly fixed.
      // An orphan "sun" with base-only orbiters (weight≈0.18) gets drag≈0.005 →
      //   still mobile, so the two orphans genuinely orbit each other rather than
      //   one freezing while the other spins around a stationary point.
      ns.forEach(n => {
        const drag = Math.min((sunAttrWeight[n.id] || 0) * 0.025, 0.97)
        n.fx -= n.vx * drag
        n.fy -= n.vy * drag
      })

      // ── System-level target-tracking ──────────────────────────────────────
      // Each system's center of mass orbits the dominant system's CoM, same
      // target-tracking mechanic as individual nodes. The spring force is applied
      // as a uniform translation to every node in the subordinate system so the
      // whole structure moves as a rigid unit. Similar-mass systems mutually orbit.
      {
        const sysRoot = {}
        const getRoot = (id, depth = 0) => {
          if (depth > 12 || !primarySun[id]) return id
          return sysRoot[id] || (sysRoot[id] = getRoot(primarySun[id], depth + 1))
        }
        ns.forEach(n => { sysRoot[n.id] = getRoot(n.id) })

        const sysNodes = {}
        ns.forEach(n => { const r = sysRoot[n.id]; (sysNodes[r] = sysNodes[r] || []).push(n) })
        const rootIds = Object.keys(sysNodes)

        if (rootIds.length < 2) {
          // Single system — free suns drift gently CW around the scene centroid
          const scx = ns.reduce((s, n) => s + n.x, 0) / ns.length
          const scy = ns.reduce((s, n) => s + n.y, 0) / ns.length
          ns.forEach(n => {
            if (primarySun[n.id]) return
            const dx = n.x - scx, dy = n.y - scy
            const d = Math.sqrt(dx*dx + dy*dy)
            if (d < 80) return
            const f = Math.min(0.08 * d / 600, 0.25)
            n.fx += (dy/d) * f; n.fy -= (dx/d) * f   // CW
          })
        } else {
          const sysMass = {}, sysCoM = {}
          rootIds.forEach(rid => {
            let tm = 0, wx = 0, wy = 0
            sysNodes[rid].forEach(n => { const m = n.mass || 1; tm += m; wx += n.x*m; wy += n.y*m })
            sysMass[rid] = tm
            sysCoM[rid]  = { x: wx/tm, y: wy/tm }
          })

          for (let i = 0; i < rootIds.length; i++) {
            for (let j = i + 1; j < rootIds.length; j++) {
              const rA = rootIds[i], rB = rootIds[j]
              const mA = sysMass[rA], mB = sysMass[rB]
              const dominant    = mA >= mB ? rA : rB
              const subordinate = mA >= mB ? rB : rA
              const ratio = Math.min(mA, mB) / Math.max(mA, mB)

              const domCoM = sysCoM[dominant]
              const subCoM = sysCoM[subordinate]

              // Angle of sub CoM around dom CoM, advanced CW each frame
              const sysAngle  = Math.atan2(subCoM.y - domCoM.y, subCoM.x - domCoM.x)
              const sysDTheta = 0.00025   // slow system-level orbit
              const sysIdealR = 1200 + Math.sqrt(mA + mB) * 80

              const tAngle = sysAngle + sysDTheta
              const tSysX  = domCoM.x + sysIdealR * Math.cos(tAngle)
              const tSysY  = domCoM.y + sysIdealR * Math.sin(tAngle)

              // Uniform spring force applied to every node in sub-system
              const SYS_K = 0.005
              const sfx = (tSysX - subCoM.x) * SYS_K
              const sfy = (tSysY - subCoM.y) * SYS_K
              sysNodes[subordinate].forEach(n => { n.fx += sfx; n.fy += sfy })

              // Similar-mass systems mutually orbit (binary stars)
              if (ratio > 0.4) {
                sysNodes[dominant].forEach(n => { n.fx -= sfx * ratio; n.fy -= sfy * ratio })
              }
            }
          }
        }
      }

      // ── Integrate — damping preserves orbital velocity ─────────────────────
      const spd = cfg.speed, damp = 0.978
      const maxV = 22 + spd * 10  // velocity cap scales with speed but prevents tunneling
      ns.forEach(n => {
        n.vx = (n.vx + n.fx * spd) * damp
        n.vy = (n.vy + n.fy * spd) * damp
        // Hard velocity clamp — prevents freeze/explosion at high speed settings
        const v2 = n.vx*n.vx + n.vy*n.vy
        if (v2 > maxV*maxV) { const s = maxV / Math.sqrt(v2); n.vx *= s; n.vy *= s }
        n.x += n.vx
        n.y += n.vy
      })

      alphaRef.current = Math.max(alpha * 0.995, 0.02)

      // ── Viewport follow — smoothly pan toward the selected node ───────────
      if (followIdRef.current) {
        const followed = ns.find(n => n.id === followIdRef.current)
        if (followed) {
          const el = containerRef.current
          const W = el?.clientWidth || 800, H = el?.clientHeight || 600
          const tx = W / 2 - followed.x * scaleRef.current
          const ty = H / 2 - followed.y * scaleRef.current
          setOffset(prev => ({
            x: prev.x + (tx - prev.x) * 0.08,
            y: prev.y + (ty - prev.y) * 0.08,
          }))
        }
      }

      forceRender(c => c + 1)
      animRef.current = requestAnimationFrame(step)
    }

    if (animRef.current) cancelAnimationFrame(animRef.current)
    animRef.current = requestAnimationFrame(step)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [loading, graphTab, settings.animate, pairwiseAttr])

  // ── Node drag ─────────────────────────────────────────────────────────────────
  const onNodePointerDown = useCallback((e, nodeId) => {
    e.stopPropagation()
    const node = nodesRef.current.find(n => n.id === nodeId)
    if (!node) return
    // No alpha bump — don't jolt the rest of the simulation on click/drag
    const ox = node.x, oy = node.y, sx = e.clientX, sy = e.clientY
    const onMove = me => { node.x = ox+(me.clientX-sx)/scale; node.y = oy+(me.clientY-sy)/scale; node.vx=0; node.vy=0; forceRender(c=>c+1) }
    const onUp   = () => { window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }, [scale])

  // ── Pan ───────────────────────────────────────────────────────────────────────
  const onBgPointerDown = useCallback(e => {
    if (e.button !== 0) return
    setSelectedId(null)
    followIdRef.current = null
    const ox = offset.x, oy = offset.y, sx = e.clientX, sy = e.clientY
    const onMove = me => setOffset({ x: ox + me.clientX - sx, y: oy + me.clientY - sy })
    const onUp   = () => { window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp) }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp)
  }, [offset])

  // ── Zoom ──────────────────────────────────────────────────────────────────────
  const onWheel = useCallback(e => {
    e.preventDefault()
    const delta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 50)
    setScale(s => Math.max(0.1, Math.min(6, s * (1 - delta * 0.003))))
  }, [])

  // ── Neighbor set ──────────────────────────────────────────────────────────────
  const neighborIds = useMemo(() => {
    if (!selectedId) return null
    const s = new Set()
    edges.forEach(({ from, to }) => { if (from === selectedId) s.add(to); if (to === selectedId) s.add(from) })
    return s
  }, [selectedId, edges])

  const nodeOpacity = id => {
    if (!selectedId) return 1
    if (id === selectedId || neighborIds?.has(id)) return 1
    return 0.1
  }
  const edgeOpacity = (from, to) => {
    if (!selectedId) return 0.72
    if (from === selectedId || to === selectedId) return 1
    return 0.05
  }

  const chronoIdx = useMemo(() => {
    const m = {}
    chronoOrder.forEach((nb, i) => { m[nb.id] = i })
    return m
  }, [chronoOrder])

  // ── Tag data ──────────────────────────────────────────────────────────────────
  const tagFreq = useMemo(() => {
    const f = {}
    for (const nb of notebooks) for (const t of (nb.tags || [])) f[t] = (f[t] || 0) + 1
    return Object.entries(f).sort((a, b) => b[1] - a[1])
  }, [notebooks])

  // ── Navigate back ─────────────────────────────────────────────────────────────
  const goBack = () => {
    const store = useAppStore.getState()
    if (paneTabId) store.updateTab(paneTabId, { view: 'library', activeLibTab: 'library' })
    store.setView('library')
    store.setActiveLibTab('library')
  }

  // ── Button helpers ────────────────────────────────────────────────────────────
  const BTN_H = 28
  const headerBtn = (active = false) => ({
    height:BTN_H, padding:'0 10px', display:'flex', alignItems:'center', justifyContent:'center',
    gap:5, fontSize:12, fontWeight:600, borderRadius:7, cursor:'pointer', fontFamily:'inherit',
    border:'1px solid', borderColor: active ? 'var(--accent)' : 'var(--border)',
    background: active ? 'var(--accent)18' : 'none', color: active ? 'var(--accent)' : 'var(--textDim)',
    flexShrink:0,
  })
  const iconBtn = (active = false) => ({
    width:BTN_H, height:BTN_H, display:'flex', alignItems:'center', justifyContent:'center',
    borderRadius:7, cursor:'pointer', flexShrink:0,
    border:'1px solid', borderColor: active ? 'var(--accent)' : 'var(--border)',
    background: active ? 'var(--accent)18' : 'none', color: active ? 'var(--accent)' : 'var(--textDim)',
  })

  // ── Node fill by kind and colorBy ─────────────────────────────────────────────
  const getNodeFill = useCallback((node, isSel, isNeighbor) => {
    if (node.isGhost) return 'transparent'
    if (isSel) return 'var(--accent)'
    const cfg = settingsRef.current
    if (cfg.colorBy === 'tags') {
      const t = (node.tags || [])[0]
      if (t && tagColorMap[t]) return `${tagColorMap[t]}1a`
    }
    if (cfg.colorBy === 'type') {
      if (node._kind === 'notebook') return 'var(--surface)'
      if (node._kind === 'book')     return '#388bfd1f'
      if (node._kind === 'audiobook') return '#8250df1f'
      if (node._kind === 'sketchbook') return '#56b0501f'
    }
    // 'none' or fallback
    if (isNeighbor) return 'var(--surfaceAlt)'
    return 'var(--surface)'
  }, [tagColorMap])

  const getNodeStroke = useCallback((node, isSel, isHov, isOrphan, isNeighbor) => {
    if (node.isGhost) return 'var(--textDim)'
    if (isSel) return 'var(--accent)'
    if (isHov) return 'var(--text)'
    if (isNeighbor) return 'var(--accent)'
    const cfg = settingsRef.current
    if (cfg.colorBy === 'tags') {
      const t = (node.tags || [])[0]
      if (t && tagColorMap[t]) return tagColorMap[t]
    }
    if (cfg.colorBy === 'type') {
      if (node._kind === 'book')      return '#388bfd'
      if (node._kind === 'audiobook') return '#8250df'
      if (node._kind === 'sketchbook') return '#56b050'
    }
    if (isOrphan) return 'var(--border)'
    return 'var(--border)'
  }, [tagColorMap])

  // ── Type legend entries ────────────────────────────────────────────────────────
  const typeLegend = [
    { kind:'notebook',   label:'Notebook',   color:'var(--accent)' },
    { kind:'book',       label:'Book',       color:'#388bfd' },
    { kind:'audiobook',  label:'Audiobook',  color:'#8250df' },
    { kind:'sketchbook', label:'Sketchbook', color:'#56b050' },
    { kind:'ghost',      label:'Referenced, not created', color:'var(--textDim)' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', userSelect:'none' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 12px', height:46, borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--surface)', boxSizing:'border-box', position:'relative' }}>

        <button onClick={goBack} style={{ ...headerBtn(), paddingLeft:8 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M6 1L2 5l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Library
        </button>

        <div style={{ width:1, height:20, background:'var(--border)', flexShrink:0 }} />

        <span style={{ fontSize:13, fontWeight:800, color:'var(--accent)', flexShrink:0, letterSpacing:'0.04em' }}>
          Nebuli
        </span>

        {/* Centered search — absolute so it doesn't shift left/right content */}
        {graphTab === 'connections' && (
          <div style={{ position:'absolute', left:'50%', transform:'translateX(-50%)', zIndex:10 }}>
            <div style={{ position:'relative' }}>
              <svg style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', opacity:.4, pointerEvents:'none' }} width="12" height="12" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="9.8" y1="9.8" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input value={search}
                onChange={e => {
                  const v = e.target.value
                  setSearch(v)
                  const q = v.trim().toLowerCase()
                  setShowPlanetsCmd(q === '/planets' || q.startsWith('/planets '))
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setSearch(''); setShowPlanetsCmd(false) }
                  if (e.key === 'Enter' && showPlanetsCmd) {
                    setCircleNodes(c => !c); setSearch(''); setShowPlanetsCmd(false)
                  }
                }}
                placeholder="Search nodes… or /planets"
                style={{ height:BTN_H, padding:'0 10px 0 28px', fontSize:12, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:7, color:'var(--text)', outline:'none', fontFamily:'inherit', width:260, boxSizing:'border-box' }} />
              {/* /planets command dropdown */}
              {showPlanetsCmd && (
                <div style={{ position:'absolute', top:'calc(100% + 5px)', left:0, width:'100%', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.25)', zIndex:200, overflow:'hidden' }}>
                  <button
                    onClick={() => { setCircleNodes(c => !c); setSearch(''); setShowPlanetsCmd(false) }}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 12px', background:'none', border:'none', color:'var(--text)', cursor:'pointer', textAlign:'left', fontSize:13 }}
                    onMouseEnter={e => e.currentTarget.style.background='var(--surfaceAlt)'}
                    onMouseLeave={e => e.currentTarget.style.background='none'}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink:0 }}>
                      <circle cx="12" cy="12" r="5" stroke="var(--accent)" strokeWidth="1.8"/>
                      <circle cx="4"  cy="6"  r="2.5" stroke="var(--accent)" strokeWidth="1.4" opacity=".7"/>
                      <circle cx="20" cy="6"  r="2.5" stroke="var(--accent)" strokeWidth="1.4" opacity=".7"/>
                      <circle cx="4"  cy="18" r="2.5" stroke="var(--accent)" strokeWidth="1.4" opacity=".7"/>
                      <circle cx="20" cy="18" r="2.5" stroke="var(--accent)" strokeWidth="1.4" opacity=".7"/>
                    </svg>
                    <div>
                      <div style={{ fontWeight:600 }}>{circleNodes ? 'Disable Planets' : 'Enable Planets'}</div>
                      <div style={{ fontSize:11, color:'var(--textDim)', marginTop:1 }}>Change all nodes to circular planet shapes</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ flex:1 }} />

        {graphTab === 'connections' && !loading && (
          <span style={{ fontSize:10, color:'var(--textDim)', flexShrink:0 }}>
            {nodesRef.current.length} nodes · {edges.length} links
          </span>
        )}

        {graphTab === 'connections' && !loading && (
          <button onClick={() => setShowAttrInfo(v => !v)}
            title="Show attraction values between nodes"
            style={headerBtn(showAttrInfo)}>
            Attract
          </button>
        )}

        {graphTab === 'connections' && !loading && (
          <button onClick={() => setShowOrbitalInfo(v => !v)}
            title="Toggle orbital info overlay"
            style={headerBtn(showOrbitalInfo)}>
            Orbits
          </button>
        )}

        {graphTab === 'connections' && !loading && (
          <button onClick={() => {
            setOffset({x:0,y:0}); setScale(1)
            nodesRef.current.forEach(n => { n.vx = 0; n.vy = 0 })
            alphaRef.current = 1
          }} style={headerBtn()}>
            Reset
          </button>
        )}

        {(graphTab === 'connections' || graphTab === 'tags') && (
          <button onClick={() => setSettingsOpen(o => !o)} title="Settings" style={iconBtn(settingsOpen)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M12.6 3.4l-.85.85M4.25 11.75l-.85.85" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Connections canvas */}
        {graphTab === 'connections' && (
          <>
            <div ref={containerRef} style={{ flex:1, position:'relative', overflow:'hidden',
              background:'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--surfaceAlt) 60%, var(--bg)) 0%, var(--bg) 70%)' }}>

              <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:0,
                backgroundImage:'radial-gradient(circle, var(--border) 0.8px, transparent 0.8px)',
                backgroundSize:'26px 26px', opacity:.22 }} />

              {/* Floating tab switcher */}
              <div style={{ position:'absolute', top:12, left:12, zIndex:20, display:'flex', gap:3,
                background:'var(--surface)', border:'1px solid var(--border)', borderRadius:9, padding:3,
                boxShadow:'0 2px 14px rgba(0,0,0,0.25)', backdropFilter:'blur(8px)' }}>
                {[['connections','Connections'],['tags','Tags']].map(([k,l]) => (
                  <button key={k} onClick={() => setGraphTab(k)} style={{
                    height:24, padding:'0 10px', fontSize:11, fontWeight:600, borderRadius:6,
                    border:'none', cursor:'pointer', fontFamily:'inherit',
                    background: graphTab===k ? 'var(--accent)' : 'none',
                    color: graphTab===k ? '#fff' : 'var(--textDim)',
                    transition:'all 0.15s',
                  }}>{l}</button>
                ))}
              </div>

              <style>{`@keyframes gv-spin { to { transform:rotate(360deg) } }`}</style>

              {loading ? (
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', gap:10, color:'var(--textDim)', zIndex:1 }}>
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ animation:'gv-spin 0.9s linear infinite' }}>
                    <circle cx="8" cy="8" r="6" stroke="var(--border)" strokeWidth="2"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Scanning wikilinks…
                </div>
              ) : (
                <svg width="100%" height="100%" style={{ display:'block', cursor:'grab', position:'relative', zIndex:1 }}
                  onPointerDown={onBgPointerDown} onWheel={onWheel}>
                  <defs>
                    <filter id="gv-glow" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur stdDeviation="5" result="b"/>
                      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                    <filter id="gv-edge-glow" x="-20%" y="-200%" width="140%" height="500%">
                      <feGaussianBlur stdDeviation="1.5" result="b"/>
                      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>

                  <g transform={`translate(${offset.x},${offset.y}) scale(${scale})`}>

                    {/* Orphan galaxy cloud */}
                    {(() => {
                      const orphanNodes = nodesRef.current.filter(n => n.isOrphan)
                      if (orphanNodes.length < 1) return null
                      const ocx = orphanNodes.reduce((s,n)=>s+n.x,0) / orphanNodes.length
                      const ocy = orphanNodes.reduce((s,n)=>s+n.y,0) / orphanNodes.length
                      const maxD = Math.max(...orphanNodes.map(n=>Math.sqrt((n.x-ocx)**2+(n.y-ocy)**2)), 50)
                      return (
                        <g style={{ pointerEvents:'none' }}>
                          <defs>
                            <radialGradient id="gv-orphan-grad" cx="50%" cy="50%" r="50%">
                              <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.07" />
                              <stop offset="55%"  stopColor="var(--accent)" stopOpacity="0.04" />
                              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"    />
                            </radialGradient>
                          </defs>
                          <ellipse cx={ocx} cy={ocy} rx={maxD+130} ry={maxD+80} fill="url(#gv-orphan-grad)" />
                          <ellipse cx={ocx} cy={ocy} rx={maxD+70}  ry={maxD+42} fill="var(--surfaceAlt)" fillOpacity={0.1} />
                        </g>
                      )
                    })()}

                    {/* Edges — only wikilinks */}
                    {edges.map(({ from, to }, i) => {
                      const a = nodesRef.current.find(n => n.id === from)
                      const b = nodesRef.current.find(n => n.id === to)
                      if (!a || !b) return null
                      const aRev = (chronoIdx[from] ?? 0) < revealCount
                      const bRev = (chronoIdx[to]   ?? 0) < revealCount
                      if (!aRev || !bRev) return null
                      const isSel = selectedId && (from === selectedId || to === selectedId)
                      const aw = a.w || 80, ah = a.h || 26, bw = b.w || 80, bh = b.h || 26
                      let pa, pb
                      if (circleNodes) {
                        const dx = b.x-a.x, dy = b.y-a.y, dist = Math.sqrt(dx*dx+dy*dy)||1
                        pa = { x: a.x + dx/dist*(aw/2), y: a.y + dy/dist*(aw/2) }
                        pb = { x: b.x - dx/dist*(bw/2), y: b.y - dy/dist*(bw/2) }
                      } else {
                        pa = rectEdgePoint(a.x, a.y, aw, ah, b.x, b.y)
                        pb = rectEdgePoint(b.x, b.y, bw, bh, a.x, a.y)
                      }
                      const toGhost = b.isGhost || a.isGhost
                      return (
                        <line key={i}
                          x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                          stroke={isSel ? 'var(--accent)' : 'var(--textDim)'}
                          strokeWidth={(settings.linkThickness * (isSel ? 2.5 : 1)) / scale}
                          strokeDasharray={toGhost ? `${5/scale},${3/scale}` : undefined}
                          opacity={edgeOpacity(from, to)}
                          filter={isSel ? 'url(#gv-edge-glow)' : undefined}
                        />
                      )
                    })}

                    {/* Attraction overlay — hidden lines + attr value labels */}
                    {showAttrInfo && (() => {
                      const visibleIds = new Set(nodesRef.current.map(n => n.id))
                      const edgeSet   = new Set(edges.map(e => [e.from, e.to].sort().join('|')))
                      const lines = [], labels = []

                      Object.entries(pairwiseAttr).forEach(([key, attr]) => {
                        if (attr < 1.0) return  // skip near-base pairs
                        const [aId, bId] = key.split('|')
                        if (!visibleIds.has(aId) || !visibleIds.has(bId)) return
                        const na = nodesRef.current.find(n => n.id === aId)
                        const nb = nodesRef.current.find(n => n.id === bId)
                        if (!na || !nb) return

                        const isWikilink = edgeSet.has(key)
                        const mx = (na.x + nb.x) / 2
                        const my = (na.y + nb.y) / 2

                        // Color by dominant source of attraction
                        let color = '#8b949e'   // dim — type/temporal only
                        if      (attr >= 20)  color = '#f0883e'  // wikilink
                        else if (attr >= 5)   color = '#e8922a'  // collection
                        else if (attr >= 1.5) color = '#56d4dd'  // tag match

                        // Draw a faint line for non-wikilink attractions
                        if (!isWikilink) {
                          lines.push(
                            <line key={`al-${key}`}
                              x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                              stroke={color} strokeWidth={1/scale}
                              strokeDasharray={`${6/scale},${4/scale}`}
                              opacity={0.25} style={{ pointerEvents:'none' }}
                            />
                          )
                        }

                        // Label at midpoint — pill background for readability
                        const label = attr.toFixed(1)
                        const pw = (label.length * 6 + 8) / scale
                        const ph = 14 / scale
                        labels.push(
                          <g key={`av-${key}`} style={{ pointerEvents:'none' }}>
                            <rect x={mx - pw/2} y={my - ph/2} width={pw} height={ph} rx={3/scale}
                              fill="var(--surface)" fillOpacity={0.85}
                              stroke={color} strokeWidth={0.6/scale} />
                            <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                              fontSize={9/scale} fontWeight={700} fill={color}
                              style={{ fontFamily:'inherit' }}>
                              {label}
                            </text>
                          </g>
                        )
                      })

                      return <g>{lines}{labels}</g>
                    })()}

                    {/* Nodes */}
                    {nodesRef.current.map(node => {
                      const revealed   = (chronoIdx[node.id] ?? 0) < revealCount
                      const nd         = allVisibleNodes.find(n => n.id === node.id)
                      const degree     = visibleDegreeMap[node.id] || 0
                      const w          = node.w || nodeW(node.title, degree, settings.nodeSize)
                      const h          = node.h || nodeH(degree, settings.nodeSize)
                      const isGhost    = node.isGhost || node._kind === 'ghost'
                      const isOrphan   = node.isOrphan && !isGhost
                      const isHov      = hoveredId  === node.id
                      const isSel      = selectedId === node.id
                      const isNeighbor = neighborIds?.has(node.id)
                      const op         = nodeOpacity(node.id)
                      const inSearch   = search.trim() && node.title.toLowerCase().includes(search.toLowerCase())

                      const fillColor   = getNodeFill(node, isSel, isNeighbor)
                      const strokeColor = getNodeStroke(node, isSel, isHov, isOrphan, isNeighbor)
                      const strokeW     = (isSel || isHov ? 2 : 1.2) / scale
                      const strokeDash  = isGhost ? `${4/scale},${2.5/scale}` : undefined

                      const textColor = isGhost
                        ? 'var(--textDim)'
                        : isSel
                          ? '#fff'
                          : isNeighbor
                            ? 'var(--text)'
                            : 'var(--textDim)'

                      const fontStyle = isGhost ? 'italic' : 'normal'

                      const showLabel = settings.labelsOnHover
                        ? (isHov || isSel)
                        : settings.showLabels

                      const hasTypeIcon = node._kind !== 'ghost'
                      // Compute max chars that fit in the box at current zoom
                      // Font ~7.5px/char at fontSize 12px. Icon takes ~22px, padding ~14px.
                      const boxPx = w * scale
                      const usedPx = (hasTypeIcon ? 22 : 0) + 14
                      const maxChars = Math.max(4, Math.floor((boxPx - usedPx) / 7.5))
                      const rawTitle = node.title || ''
                      const displayTitle = rawTitle.length > maxChars
                        ? rawTitle.slice(0, maxChars - 1) + '…'
                        : rawTitle
                      const iconColor = isSel ? '#fff' : strokeColor

                      return (
                        <g key={node.id}
                          style={{ opacity: revealed ? op : 0, transition: revealed ? 'opacity 0.45s ease' : 'none', cursor: 'pointer' }}
                          onPointerDown={e => !isGhost && onNodePointerDown(e, node.id)}
                          onMouseEnter={() => setHoveredId(node.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={e => {
                            e.stopPropagation()
                            const next = selectedId === node.id ? null : node.id
                            setSelectedId(next)
                            if (!isGhost) followIdRef.current = next
                          }}
                          onDoubleClick={e => {
                            e.stopPropagation()
                            if (!isGhost && nd && nd._kind === 'notebook') {
                              const store = useAppStore.getState()
                              store.setActiveNotebook(nd)
                              if (paneTabId) store.updateTab(paneTabId, { view:'notebook', activeNotebook:nd })
                              store.setView('notebook')
                            }
                          }}>

                          {/* Glow ring */}
                          {(isSel || isHov || inSearch) && (circleNodes
                            ? <circle cx={node.x} cy={node.y} r={w/2+6}
                                fill="none"
                                stroke={isSel ? 'var(--accent)' : inSearch ? '#f0883e' : 'var(--accent)'}
                                strokeWidth={1.5/scale} opacity={0.35} filter="url(#gv-glow)" />
                            : <rect x={node.x-w/2-6} y={node.y-h/2-6} width={w+12} height={h+12} rx={11}
                                fill="none"
                                stroke={isSel ? 'var(--accent)' : inSearch ? '#f0883e' : 'var(--accent)'}
                                strokeWidth={1.5/scale} opacity={0.35} filter="url(#gv-glow)" />
                          )}

                          {/* Main shape */}
                          {circleNodes
                            ? <circle cx={node.x} cy={node.y} r={w/2}
                                fill={fillColor}
                                fillOpacity={isOrphan && !isSel && node._kind === 'notebook' ? 0.38 : 1}
                                stroke={strokeColor}
                                strokeWidth={strokeW}
                                strokeDasharray={strokeDash}
                              />
                            : <rect x={node.x-w/2} y={node.y-h/2} width={w} height={h} rx={7}
                                fill={fillColor}
                                fillOpacity={isOrphan && !isSel && node._kind === 'notebook' ? 0.38 : 1}
                                stroke={strokeColor}
                                strokeWidth={strokeW}
                                strokeDasharray={strokeDash}
                              />
                          }

                          {/* Ghost "?" badge top-right */}
                          {/* Ghost "?" badge — rect mode only */}
                          {isGhost && !circleNodes && (
                            <text x={node.x+w/2-3/scale} y={node.y-h/2+1/scale}
                              textAnchor="end" dominantBaseline="hanging"
                              fontSize={7/scale} fontWeight={800} fill="var(--textDim)" opacity={0.6}
                              style={{ pointerEvents:'none', fontFamily:'inherit' }}>?</text>
                          )}

                          {/* Type icon */}
                          {hasTypeIcon && showLabel && (circleNodes
                            // Circle mode: icon centered above text
                            ? <g transform={`translate(${node.x - 4.5/scale}, ${node.y - 10/scale}) scale(${1/scale})`} style={{ pointerEvents:'none' }}>
                                <TypeIcon kind={node._kind} size={9} color={iconColor} />
                              </g>
                            // Rect mode: icon fixed at left edge
                            : <g transform={`translate(${node.x - w/2 + 5/scale}, ${node.y - 4.5/scale}) scale(${1/scale})`} style={{ pointerEvents:'none' }}>
                                <TypeIcon kind={node._kind} size={9} color={iconColor} />
                              </g>
                          )}

                          {/* Label */}
                          {showLabel && (
                            <text
                              x={node.x + (circleNodes ? 0 : (hasTypeIcon ? 7/scale : 0))}
                              y={node.y + (circleNodes && hasTypeIcon ? 5/scale : 0)}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize={12/scale} fontWeight={isSel || isNeighbor ? 700 : 500}
                              fontStyle={fontStyle}
                              fill={textColor}
                              style={{ pointerEvents:'none', fontFamily:'inherit' }}>
                              {displayTitle}
                            </text>
                          )}
                          {!showLabel && isHov && (
                            <text x={node.x} y={node.y + (circleNodes ? w/2 : h/2) + 13/scale}
                              textAnchor="middle" dominantBaseline="middle"
                              fontSize={11/scale} fontWeight={600}
                              fill="var(--text)" style={{ pointerEvents:'none', fontFamily:'inherit' }}>
                              {node.title}{isGhost ? ' (not created)' : ''}
                            </text>
                          )}

                          {/* Orbital info overlay */}
                          {showOrbitalInfo && (() => {
                            const mySunId   = primarySunRef.current[node.id]
                            const mySun     = mySunId ? nodesRef.current.find(n => n.id === mySunId) : null
                            const myOrbiters = (orbitersOfRef.current[node.id] || [])
                            const isSun     = (sunWeightRef.current[node.id] || 0) > 0.5
                            const topY      = node.y - (circleNodes ? w/2 : h/2) - 6/scale
                            const lines     = []
                            if (isSun) {
                              const names = myOrbiters.map(o => (o.title || o.id).slice(0, 12)).join(', ')
                              lines.push({ text: `☀ Sun to: ${names || '—'}`, color: '#f0c040' })
                            }
                            if (mySun) {
                              lines.push({ text: `↻ Orbiting: ${(mySun.title || mySunId).slice(0, 16)}`, color: '#56d4dd' })
                            }
                            if (!isSun && !mySun) {
                              lines.push({ text: '◌ Free (no orbit)', color: 'var(--textDim)' })
                            }
                            return lines.map((line, li) => (
                              <text key={li}
                                x={node.x} y={topY - (lines.length - 1 - li) * 13/scale}
                                textAnchor="middle" dominantBaseline="auto"
                                fontSize={10/scale} fontWeight={600}
                                fill={line.color}
                                style={{ pointerEvents:'none', fontFamily:'inherit' }}
                                opacity={0.9}>
                                {line.text}
                              </text>
                            ))
                          })()}
                        </g>
                      )
                    })}
                  </g>
                </svg>
              )}

              {/* Legend bottom-left */}
              {!loading && nodesRef.current.length > 0 && (
                <div style={{ position:'absolute', bottom:16, left:16, display:'flex', flexDirection:'column', gap:5, zIndex:5 }}>
                  {visibleOrphanSet.size > 0 && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:7, padding:'5px 10px', fontSize:10, color:'var(--textDim)', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
                      <svg width="28" height="12" viewBox="0 0 28 12">
                        <rect x="0" y="2" width="28" height="8" rx="3" fill="var(--border)" fillOpacity="0.38" stroke="var(--border)" strokeWidth="1.2"/>
                      </svg>
                      Unlinked
                    </div>
                  )}
                  {ghostNodes.length > 0 && settings.showGhosts && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:7, padding:'5px 10px', fontSize:10, color:'var(--textDim)', boxShadow:'0 2px 8px rgba(0,0,0,0.2)' }}>
                      <svg width="28" height="12" viewBox="0 0 28 12">
                        <rect x="0" y="2" width="28" height="8" rx="3" fill="none" stroke="var(--textDim)" strokeWidth="1.2" strokeDasharray="3,2"/>
                      </svg>
                      Referenced, not created
                    </div>
                  )}
                  {settings.colorBy === 'type' && (
                    <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:7, padding:'6px 10px', fontSize:10, color:'var(--textDim)', boxShadow:'0 2px 8px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column', gap:4 }}>
                      {typeLegend.map(({ kind, label, color }) => (
                        <div key={kind} style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ width:8, height:8, borderRadius:2, background:color, flexShrink:0, border:'1px solid', borderColor:color }} />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Selected node card */}
              {selectedId && (() => {
                const nd  = allVisibleNodes.find(n => n.id === selectedId)
                const deg = visibleDegreeMap[selectedId] || 0
                if (!nd) return null
                const isGhost = nd._kind === 'ghost'
                const kindLabel = nd._kind ? nd._kind.charAt(0).toUpperCase() + nd._kind.slice(1) : ''
                return (
                  <div style={{ position:'absolute', bottom:16, left: (visibleOrphanSet.size > 0 || ghostNodes.length > 0) ? 180 : 16, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:'11px 14px', zIndex:10, minWidth:180, boxShadow:'0 4px 20px rgba(0,0,0,.4)' }}>
                    <div style={{ fontSize:10, color:'var(--textDim)', marginBottom:2, textTransform:'capitalize' }}>{kindLabel}</div>
                    <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:3 }}>{nd.title||'Untitled'}</div>
                    <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:10 }}>
                      {deg} connection{deg!==1?'s':''} · level {nodeLevel[nd.id] ?? 0}
                      {isGhost && <span style={{ marginLeft:6, color:'#e8922a' }}>· not yet created</span>}
                    </div>
                    {!isGhost && nd._kind === 'notebook' && (
                      <button onClick={() => {
                        const store = useAppStore.getState()
                        store.setActiveNotebook(nd)
                        if (paneTabId) store.updateTab(paneTabId, { view:'notebook', activeNotebook:nd })
                        store.setView('notebook')
                      }} style={{ background:'var(--accent)', border:'none', color:'#fff', borderRadius:6, padding:'5px 12px', fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
                        Open note →
                      </button>
                    )}
                    {isGhost && (
                      <button onClick={() => {
                        const store = useAppStore.getState()
                        const nb = {
                          id: `nb-${Date.now()}`,
                          title: nd.title || 'Untitled',
                          wordCount: 0,
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        }
                        store.addNotebook?.(nb)
                        store.persistNotebooks?.()
                        store.setActiveNotebook(nb)
                        if (paneTabId) store.updateTab(paneTabId, { view:'notebook', activeNotebook:nb })
                        store.setView('notebook')
                        setSelectedId(null)
                      }} style={{ background:'var(--accent)', border:'none', color:'#fff', borderRadius:6, padding:'5px 12px', fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight:600 }}>
                        Create &amp; Open →
                      </button>
                    )}
                  </div>
                )
              })()}

              {/* Empty states */}
              {!loading && nodesRef.current.length === 0 && (
                <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--textDim)', fontSize:13, flexDirection:'column', gap:8, zIndex:2 }}>
                  No nodes to show.
                  {!settings.showOrphans && <span style={{ fontSize:11, opacity:.55 }}>Enable "Show orphans" to show unlinked items.</span>}
                </div>
              )}
              {!loading && edges.length === 0 && nodesRef.current.length > 0 && (
                <div style={{ position:'absolute', bottom:16, right: settingsOpen ? 232 : 16, fontSize:10, color:'var(--textDim)', opacity:.4, pointerEvents:'none', zIndex:2 }}>
                  No wikilinks yet — use [[Note Title]] inside a note to connect it
                </div>
              )}
              {!loading && !selectedId && nodesRef.current.length > 0 && edges.length > 0 && (
                <div style={{ position:'absolute', bottom:16, right: settingsOpen ? 232 : 16, fontSize:10, color:'var(--textDim)', opacity:.35, pointerEvents:'none', zIndex:2 }}>
                  Scroll to zoom · Drag to pan · Click to select · Double-click to open
                </div>
              )}
            </div>

            {/* Connections settings panel */}
            {settingsOpen && (
              <div style={{ width:216, borderLeft:'1px solid var(--border)', background:'var(--surface)', overflowY:'auto', flexShrink:0, padding:'14px 14px 20px', boxSizing:'border-box' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:14 }}>Nebuli Settings</div>

                <Section title="Filters">
                  <Toggle label="Show orphan nodes"   value={settings.showOrphans}  onChange={v => setSetting('showOrphans', v)} />
                  <Toggle label="Show ghost nodes"    value={settings.showGhosts}   onChange={v => setSetting('showGhosts', v)} />
                  <Toggle label="Show books"          value={settings.showBooks}    onChange={v => setSetting('showBooks', v)} />
                  <Toggle label="Show audiobooks"     value={settings.showAudio}    onChange={v => setSetting('showAudio', v)} />
                  <Toggle label="Show sketchbooks"    value={settings.showSketches} onChange={v => setSetting('showSketches', v)} />
                </Section>

                <Section title="Groups">
                  <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:6 }}>Color nodes by</div>
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                    {[['type','Type'],['tags','Tags'],['none','None']].map(([k,l]) => (
                      <button key={k} onClick={() => setSetting('colorBy', k)} style={{
                        flex:1, padding:'4px 0', fontSize:11, fontWeight:600, borderRadius:6,
                        border:'1px solid', borderColor: settings.colorBy===k ? 'var(--accent)' : 'var(--border)',
                        background: settings.colorBy===k ? 'var(--accent)18' : 'none',
                        color: settings.colorBy===k ? 'var(--accent)' : 'var(--textDim)',
                        cursor:'pointer', fontFamily:'inherit',
                      }}>{l}</button>
                    ))}
                  </div>
                </Section>

                <Section title="Display">
                  <Slider label="Node size"      value={settings.nodeSize}      min={1}   max={10}  step={0.5} onChange={v => setSetting('nodeSize', v)} />
                  <Slider label="Link thickness" value={settings.linkThickness} min={0.5} max={5}   step={0.5} onChange={v => setSetting('linkThickness', v)} />
                  <Toggle label="Show labels"    value={settings.showLabels}   onChange={v => setSetting('showLabels', v)} />
                  {settings.showLabels && <Toggle label="Hover only" value={settings.labelsOnHover} onChange={v => setSetting('labelsOnHover', v)} />}
                </Section>

                <Section title="Attraction">
                  <Slider label="Wikilink pull"     value={settings.attrLink}        min={0}    max={40}   step={0.5}   fmt={v=>v.toFixed(1)} onChange={v => setSetting('attrLink', v)} />
                  <Slider label="Collection pull"   value={settings.attrCollection}  min={0}    max={15}   step={0.25}  fmt={v=>v.toFixed(2)} onChange={v => setSetting('attrCollection', v)} />
                  <Slider label="Tag pull"          value={settings.attrTag}         min={0}    max={5}    step={0.1}   fmt={v=>v.toFixed(1)} onChange={v => setSetting('attrTag', v)} />
                  <Slider label="Temporal pull"     value={settings.attrTime}        min={0}    max={3}    step={0.1}   fmt={v=>v.toFixed(1)} onChange={v => setSetting('attrTime', v)} />
                  <Slider label="Universal gravity" value={settings.universalGravity} min={0}   max={1}    step={0.01}  fmt={v=>v.toFixed(2)} onChange={v => setSetting('universalGravity', v)} />
                  <Slider label="Orbit strength"    value={settings.orbitStrength}   min={0}    max={3}    step={0.05}  fmt={v=>v.toFixed(2)} onChange={v => setSetting('orbitStrength', v)} />
                  <Slider label="Repel force"       value={settings.repelForce}      min={10}   max={1000} step={10}    onChange={v => setSetting('repelForce', v)} />
                  <Slider label="Center pull"       value={settings.centerForce}     min={0}    max={0.02} step={0.001} fmt={v=>v.toFixed(3)} onChange={v => setSetting('centerForce', v)} />
                </Section>

                <Section title="Animation">
                  <button onClick={() => {
                    const next = !settings.animate
                    setSetting('animate', next)
                    if (next) alphaRef.current = Math.max(alphaRef.current, 0.1)
                  }} style={{
                    width:'100%', padding:'6px 0', fontSize:11, fontFamily:'inherit', fontWeight:700,
                    background: settings.animate ? 'var(--accent)18' : 'var(--surfaceAlt)',
                    border:`1px solid ${settings.animate ? 'var(--accent)' : 'var(--border)'}`,
                    color: settings.animate ? 'var(--accent)' : 'var(--text)',
                    borderRadius:6, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, marginBottom:10,
                  }}>
                    {settings.animate ? (
                      <><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="3" height="8" rx="1"/><rect x="6" y="1" width="3" height="8" rx="1"/></svg> Pause simulation</>
                    ) : (
                      <><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l7 4-7 4V1z"/></svg> Play simulation</>
                    )}
                  </button>
                  <Slider label="Speed" value={settings.speed} min={0.1} max={3} step={0.1} fmt={v=>v.toFixed(1)+'×'} onChange={v => setSetting('speed', v)} />
                  <button onClick={() => {
                    const el = containerRef.current
                    const W = el?.clientWidth || 800, H = el?.clientHeight || 600
                    applyInitialPositions(nodesRef.current, W, H, visibleOrphanSet)
                    nodesRef.current.forEach(n => { n.vx = 0; n.vy = 0 })
                    alphaRef.current = 1
                    if (!settings.animate) setSetting('animate', true)
                    forceRender(c=>c+1)
                  }} style={{ width:'100%', padding:'5px 0', fontSize:11, fontFamily:'inherit', fontWeight:600, background:'var(--surfaceAlt)', border:'1px solid var(--border)', color:'var(--text)', borderRadius:6, cursor:'pointer', marginTop:4 }}>
                    Reset layout
                  </button>
                </Section>

                {settings.colorBy === 'tags' && tagFreq.length > 0 && (
                  <Section title="Tag groups">
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {tagFreq.slice(0,8).map(([tag], i) => (
                        <div key={tag} style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ width:8, height:8, borderRadius:2, background:TAG_PALETTE[i%TAG_PALETTE.length], flexShrink:0 }} />
                          <span style={{ fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{tag}</span>
                        </div>
                      ))}
                      {tagFreq.length > 8 && <span style={{ fontSize:10, color:'var(--textDim)', opacity:.6 }}>+{tagFreq.length-8} more</span>}
                    </div>
                  </Section>
                )}

                {settings.colorBy === 'type' && (
                  <Section title="Type legend">
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {typeLegend.map(({ kind, label, color }) => (
                        <div key={kind} style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ color, flexShrink:0, display:'flex', alignItems:'center' }}>
                            <TypeIcon kind={kind} size={12} color={color} />
                          </span>
                          <span style={{ fontSize:11, color:'var(--text)', flex:1 }}>{label}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </div>
            )}
          </>
        )}

        {/* Tags tab */}
        {graphTab === 'tags' && (
          <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
            <TagBubbleCanvas
              tags={tagFreq} maxCount={tagFreq[0]?.[1]||1}
              selected={selectedTag} onSelect={setSelectedTag}
              notebooks={notebooks} tagSettings={tagSettings}
              graphTab={graphTab} setGraphTab={setGraphTab}
            />

            {settingsOpen && (
              <div style={{ width:216, borderLeft:'1px solid var(--border)', background:'var(--surface)', overflowY:'auto', flexShrink:0, padding:'14px 14px 20px', boxSizing:'border-box' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:14 }}>Tag Settings</div>

                <Section title="Sort">
                  <div style={{ display:'flex', gap:4 }}>
                    {[['frequency','Frequency'],['alpha','A–Z']].map(([k,l]) => (
                      <button key={k} onClick={() => setTagSetting('sortBy', k)} style={{
                        flex:1, padding:'4px 0', fontSize:11, fontWeight:600, borderRadius:6,
                        border:'1px solid', borderColor: tagSettings.sortBy===k ? 'var(--accent)' : 'var(--border)',
                        background: tagSettings.sortBy===k ? 'var(--accent)18' : 'none',
                        color: tagSettings.sortBy===k ? 'var(--accent)' : 'var(--textDim)',
                        cursor:'pointer', fontFamily:'inherit',
                      }}>{l}</button>
                    ))}
                  </div>
                </Section>

                <Section title="Display">
                  <Toggle label="Show counts"  value={tagSettings.showCounts}  onChange={v => setTagSetting('showCounts', v)} />
                  <Slider label="Bubble scale" value={tagSettings.bubbleScale} min={0.4} max={2} step={0.1} fmt={v=>v.toFixed(1)+'×'} onChange={v => setTagSetting('bubbleScale', v)} />
                </Section>

                <Section title="Color">
                  <div style={{ fontSize:11, color:'var(--textDim)', marginBottom:6 }}>Color scheme</div>
                  <div style={{ display:'flex', gap:4 }}>
                    {[['palette','Palette'],['accent','Accent']].map(([k,l]) => (
                      <button key={k} onClick={() => setTagSetting('colorBy', k)} style={{
                        flex:1, padding:'4px 0', fontSize:11, fontWeight:600, borderRadius:6,
                        border:'1px solid', borderColor: tagSettings.colorBy===k ? 'var(--accent)' : 'var(--border)',
                        background: tagSettings.colorBy===k ? 'var(--accent)18' : 'none',
                        color: tagSettings.colorBy===k ? 'var(--accent)' : 'var(--textDim)',
                        cursor:'pointer', fontFamily:'inherit',
                      }}>{l}</button>
                    ))}
                  </div>
                </Section>

                {tagFreq.length > 0 && (
                  <Section title="Tag legend">
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {tagFreq.slice(0,10).map(([tag, count], i) => (
                        <div key={tag} style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ width:8, height:8, borderRadius:'50%', background:TAG_PALETTE[i%TAG_PALETTE.length], flexShrink:0 }} />
                          <span style={{ fontSize:11, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{tag}</span>
                          <span style={{ fontSize:10, color:'var(--textDim)' }}>{count}</span>
                        </div>
                      ))}
                      {tagFreq.length > 10 && <span style={{ fontSize:10, color:'var(--textDim)', opacity:.6 }}>+{tagFreq.length-10} more</span>}
                    </div>
                  </Section>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
