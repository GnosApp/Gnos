import { useState, useEffect, useRef, useContext, useCallback } from 'react'
import useAppStore from '@/store/useAppStore'
import { PaneContext } from '@/lib/PaneContext'
import { loadNotebookContent } from '@/lib/storage'

// ── Constants ──────────────────────────────────────────────────────────────────
const LERP_RATE    = 0.035
const GOLDEN_ANGLE = 2.39996322972865   // radians ≈ 137.5°
const ORBIT_SPEED  = 0.00055            // base rad/frame at r=100
const HUB_ORBIT_R  = 40                 // hub nodes orbit this far from center
const BTN_H        = 28

// Sector anchor definitions for stray (unlinked) nodes
// Each type clusters in a region of "deep space" around the center
const SECTORS = {
  notebook:   { angle: -Math.PI / 2,           dist: 330 },  // top
  book:       { angle: Math.PI * 0.1667,        dist: 390 },  // upper-right
  audio:      { angle: Math.PI * 0.5833,        dist: 370 },  // lower-right
  sketchbook: { angle: Math.PI * 1.0,           dist: 390 },  // left
  flashcard:  { angle: -Math.PI * 0.8333,       dist: 360 },  // upper-left
}

// Visual styling per node type
const NODE_COLORS = {
  notebook:   '#7C6EFA',
  book:       '#4ADE80',
  audio:      '#F472B6',
  sketchbook: '#FB923C',
  flashcard:  '#FACC15',
}

const ALL_TYPES = ['notebook','book','audio','sketchbook','flashcard']

const TYPE_LABELS = {
  notebook:   'Notebook',
  book:       'Book',
  audio:      'Audio',
  sketchbook: 'Sketchbook',
  flashcard:  'Flashcard',
}

const DEFAULT_SETTINGS = {
  orbitSpeed:       1.0,       // multiplier on ORBIT_SPEED
  lerpRate:         1.0,       // multiplier on LERP_RATE
  nodeSizeMul:      1.0,       // multiplier on base node radii
  orbitRadiusMul:   1.0,       // multiplier on each node's orbit radius
  hubOrbitR:        40,        // hub-to-hub orbit radius (px)
  clusterSpacing:   28,        // stray cluster spiral step (px)
  showLabels:      'linked',   // 'always' | 'linked' | 'hovered'
  showEdges:        true,
  showSectorLabels: true,
  showLegend:       true,
  edgeOpacityMul:   1.0,       // multiplier on edge alpha
  glowEnabled:      true,
  focusZoom:        true,      // animate camera to focused node
}

function nodeRadius(node, mul = 1) {
  if (node.isHub) return 16 * mul
  if (node.linkCount > 0) return 9 * mul
  return 6 * mul
}

function headerBtn(active = false) {
  return {
    height: BTN_H, padding: '0 10px', fontSize: 11, fontWeight: 600, border: '1px solid',
    borderColor: active ? 'var(--accent)' : 'var(--border)',
    background: active ? 'var(--accent)18' : 'none',
    color: active ? 'var(--accent)' : 'var(--textDim)',
    borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
    display: 'flex', alignItems: 'center', gap: 5,
    transition: 'border-color 0.12s, background 0.12s, color 0.12s',
  }
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function GraphView() {
  const paneTabId      = useContext(PaneContext)
  const navigate       = useAppStore(s => s.navigate)
  const setView        = useAppStore(s => s.setView)
  const notebooks      = useAppStore(s => s.notebooks)
  const library        = useAppStore(s => s.library)
  const sketchbooks    = useAppStore(s => s.sketchbooks)
  const flashcardDecks = useAppStore(s => s.flashcardDecks)

  const collections    = useAppStore(s => s.collections)

  const canvasRef   = useRef(null)
  const containerRef = useRef(null)

  // All mutable simulation state lives here — no React re-renders per frame
  const simRef = useRef({
    nodes:   [],
    edges:   [],
    clock:   0,
    camera:  { x: 0, y: 0, zoom: 1 },
    hovered: null,        // node id
    selected: null,       // node id — focused node
    focusAnim: null,      // { tx, ty, tz, startX, startY, startZ, t0, dur }
    pan:     null,
    dragNode: null,
    pointerDown: null,
  })

  // Settings: settingsRef is read every frame by the animation loop (no re-render overhead).
  // React state `settings` is the UI mirror — update both together via `applySettings`.
  const settingsRef = useRef({ ...DEFAULT_SETTINGS })
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS })

  function applySettings(patch) {
    Object.assign(settingsRef.current, patch)
    setSettings(s => ({ ...s, ...patch }))
  }

  const [graphTab,     setGraphTab]     = useState('connections')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [nodeCount,    setNodeCount]    = useState(0)
  const [edgeCount,    setEdgeCount]    = useState(0)
  const [focusedNode,  setFocusedNode]  = useState(null)  // node object for the info panel

  // ── Filter state ───────────────────────────────────────────────────────────────
  const [filterTypes,      setFilterTypes]      = useState(() => new Set(ALL_TYPES))
  const [filterCollection, setFilterCollection] = useState(null)
  const [filterTags,       setFilterTags]       = useState(() => new Set())
  const [filterSearch,     setFilterSearch]     = useState('')
  const [filterLinked,     setFilterLinked]     = useState('all')
  const [allTags,          setAllTags]          = useState([])
  const [tagFrequencies,   setTagFrequencies]   = useState({})

  const rafRef       = useRef(null)
  const graphTabRef  = useRef(graphTab)  // readable inside RAF without closure staleness
  const spawnRef     = useRef(null)   // timeout handle for node-by-node spawn
  const allNodesRef  = useRef([])     // full unfiltered node list

  // Keep graphTabRef in sync so RAF tick can read it without stale closure
  useEffect(() => { graphTabRef.current = graphTab }, [graphTab])

  // Drip nodes in one-at-a-time, oldest → newest
  const startSpawn = useCallback((nodes) => {
    clearTimeout(spawnRef.current)
    const sim = simRef.current
    sim.nodes = []
    sim.selected = null
    setFocusedNode(null)

    // Sort oldest → newest so history "builds up" visually
    const sorted = [...nodes].sort((a, b) =>
      new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0)
    )
    // NOTE: allNodesRef.current is set by buildGraph (full unfiltered list), not here

    // Scale interval so the full animation is ~2.5s regardless of library size
    const interval = Math.max(20, Math.min(120, 2500 / Math.max(sorted.length, 1)))

    let i = 0
    function next() {
      if (i >= sorted.length) return
      const node = sorted[i++]
      node.spawnProgress = 0
      sim.nodes.push(node)
      spawnRef.current = setTimeout(next, interval)
    }
    next()
  }, [])

  function toggleType(type) {
    setFilterTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) { if (next.size > 1) next.delete(type) }
      else next.add(type)
      return next
    })
  }

  function toggleTag(tag) {
    setFilterTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function goBack() {
    if (paneTabId) { setView('library') }
    else navigate({ view: 'library' })
  }

  // ── Graph builder ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function buildGraph() {
      setLoading(true)
      const nodesMap = new Map()

      // Helper: add a node
      function addNode(id, title, type, updatedAt) {
        nodesMap.set(id, {
          id, title, type,
          x: (Math.random() - 0.5) * 300,
          y: (Math.random() - 0.5) * 300,
          tx: 0, ty: 0,
          angle: Math.random() * Math.PI * 2,
          radius: 42 + Math.random() * 32,
          parents: [], children: [],
          linkCount: 0,
          isHub: false,
          sectorIdx: 0, sectorType: type,
          updatedAt: updatedAt || 0,
          dragged: false, dragX: 0, dragY: 0,
        })
      }

      for (const nb of notebooks)      addNode(nb.id, nb.title, 'notebook',   nb.updatedAt)
      for (const b  of library)        addNode(b.id,  b.title,  b.type === 'audio' ? 'audio' : 'book', b.updatedAt)
      for (const sb of sketchbooks)    addNode(sb.id, sb.title, 'sketchbook', sb.updatedAt)
      for (const fd of flashcardDecks) addNode(fd.id, fd.title, 'flashcard',  fd.updatedAt)

      // Pull any tags already stored in notebook metadata
      for (const nb of notebooks) {
        const node = nodesMap.get(nb.id)
        if (node && nb.tags?.length) {
          node.tags = nb.tags.map(t => t.toLowerCase())
        }
      }

      // Scan notebook contents for [[wikilinks]] and ::tags
      const edges = []
      const wikiRE = /\[\[([^\]|#]+?)(?:[|#][^\]]+)?\]\](?:\([^)]*\))?/g
      const tagRE  = /::([a-zA-Z0-9_-]+)/g

      for (const nb of notebooks) {
        if (cancelled) return
        try {
          const content = await loadNotebookContent(nb.id)
          if (!content) continue
          const fromNode = nodesMap.get(nb.id)
          let m

          // Wikilinks → edges
          wikiRE.lastIndex = 0
          while ((m = wikiRE.exec(content)) !== null) {
            const linkTitle = m[1].trim().toLowerCase()
            for (const [targetId, targetNode] of nodesMap) {
              if (targetId !== nb.id && (targetNode.title || '').trim().toLowerCase() === linkTitle) {
                if (!edges.some(e => e.fromId === nb.id && e.toId === targetId)) {
                  edges.push({ fromId: nb.id, toId: targetId })
                  if (fromNode && !fromNode.children.includes(targetId)) fromNode.children.push(targetId)
                  if (targetNode && !targetNode.parents.includes(nb.id))  targetNode.parents.push(nb.id)
                }
                break
              }
            }
          }

          // Inline ::tags
          if (fromNode) {
            tagRE.lastIndex = 0
            while ((m = tagRE.exec(content)) !== null) {
              const tag = m[1].toLowerCase()
              if (!fromNode.tags) fromNode.tags = []
              if (!fromNode.tags.includes(tag)) fromNode.tags.push(tag)
            }
          }
        } catch { /* content unavailable */ }
      }

      if (cancelled) return

      // Compute link counts and hub status
      for (const node of nodesMap.values()) {
        node.linkCount = node.parents.length + node.children.length
        // MOC = no parents, 2+ children (it's a hub of a cluster)
        node.isHub = node.parents.length === 0 && node.children.length >= 2
      }

      // Single isolated notebooks with many cross-links can also be hubs
      // (treat any node with linkCount >= 4 as hub even if it has parents)
      for (const node of nodesMap.values()) {
        if (node.linkCount >= 4) node.isHub = true
      }

      // Assign sector indices for stray (unlinked) nodes, sorted by updatedAt desc
      // Most recent files sit at the center of their nebula
      const strayByType = {}
      for (const node of nodesMap.values()) {
        if (node.linkCount === 0) {
          if (!strayByType[node.type]) strayByType[node.type] = []
          strayByType[node.type].push(node)
        }
      }
      for (const nodes of Object.values(strayByType)) {
        nodes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        nodes.forEach((n, i) => { n.sectorIdx = i })
      }

      // Seed hub positions evenly around center so they start spread out
      const hubs = [...nodesMap.values()].filter(n => n.isHub)
      hubs.forEach((n, i) => {
        const a = (i / Math.max(hubs.length, 1)) * Math.PI * 2
        n.x = Math.cos(a) * (hubs.length > 1 ? HUB_ORBIT_R : 0)
        n.y = Math.sin(a) * (hubs.length > 1 ? HUB_ORBIT_R : 0)
        n.tx = n.x; n.ty = n.y
      })

      const sim = simRef.current
      sim.edges = edges
      sim.clock = 0

      // Store full unfiltered list — getFilteredNodes reads from here
      allNodesRef.current = [...nodesMap.values()]

      // Gather all unique tags and their frequencies across all nodes
      const tagSet = new Set()
      const tagFreqMap = {}
      for (const node of nodesMap.values()) {
        node.tags?.forEach(t => {
          tagSet.add(t)
          tagFreqMap[t] = (tagFreqMap[t] || 0) + 1
        })
      }
      setAllTags([...tagSet].sort())
      setTagFrequencies(tagFreqMap)

      setNodeCount(nodesMap.size)
      setEdgeCount(edges.length)
      setLoading(false)

      // Always spawn the full set here; filter effect handles reactive filtering
      startSpawn([...nodesMap.values()])
    }

    buildGraph()
    return () => { cancelled = true; clearTimeout(spawnRef.current) }
  }, [notebooks, library, sketchbooks, flashcardDecks])

  // Re-apply filters whenever any filter changes
  useEffect(() => {
    if (allNodesRef.current.length === 0) return
    const filtered = allNodesRef.current.filter(n => {
      if (!filterTypes.has(n.type)) return false
      if (filterCollection) {
        const col = collections.find(c => c.id === filterCollection)
        if (col && !col.items.includes(n.id)) return false
      }
      if (filterTags.size > 0 && !n.tags?.some(t => filterTags.has(t))) return false
      if (filterSearch.trim()) {
        if (!(n.title || '').toLowerCase().includes(filterSearch.trim().toLowerCase())) return false
      }
      if (filterLinked === 'linked'   && n.linkCount === 0) return false
      if (filterLinked === 'unlinked' && n.linkCount >  0) return false
      return true
    })
    startSpawn(filtered)
  }, [filterTypes, filterCollection, filterTags, filterSearch, filterLinked])

  // ── Animation / render loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function resizeCanvas() {
      const container = canvas.parentElement
      if (!container) return
      const dpr = window.devicePixelRatio || 1
      const w = container.offsetWidth
      const h = container.offsetHeight
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width  = w * dpr
        canvas.height = h * dpr
        canvas.style.width  = w + 'px'
        canvas.style.height = h + 'px'
      }
    }

    resizeCanvas()
    const ro = new ResizeObserver(resizeCanvas)
    ro.observe(canvas.parentElement)

    function tick() { try {
      if (graphTabRef.current === 'tags') {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const sim  = simRef.current
      const cfg  = settingsRef.current
      const ctx  = canvas.getContext('2d')
      const dpr  = window.devicePixelRatio || 1
      const W    = canvas.offsetWidth
      const H    = canvas.offsetHeight

      // ── Focus animation (smooth zoom-to-node) ──────────────────────────────
      if (sim.focusAnim) {
        const fa  = sim.focusAnim
        const raw = Math.min((performance.now() - fa.t0) / fa.dur, 1)
        const t   = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw  // ease-in-out
        sim.camera.x    = fa.startX + (fa.tx - fa.startX) * t
        sim.camera.y    = fa.startY + (fa.ty - fa.startY) * t
        sim.camera.zoom = fa.startZ + (fa.tz - fa.startZ) * t
        if (raw >= 1) sim.focusAnim = null
      }

      const cx   = W / 2 + sim.camera.x
      const cy   = H / 2 + sim.camera.y
      const z    = sim.camera.zoom

      // Read theme colors once per frame (cheap — just a map lookup in the browser)
      const style     = getComputedStyle(document.documentElement)
      const textColor = style.getPropertyValue('--text').trim()    || '#1a1a1a'
      const bgColor   = style.getPropertyValue('--bg').trim()      || '#f5f0e8'

      sim.clock += 1

      const nodesMap   = new Map(sim.nodes.map(n => [n.id, n]))
      const hubR       = cfg.hubOrbitR
      const orbitMul   = cfg.orbitSpeed
      const lerpRate   = LERP_RATE * cfg.lerpRate
      const clusterSpc = cfg.clusterSpacing

      // ── Update targets ─────────────────────────────────────────────────────
      const hubs = sim.nodes.filter(n => n.isHub)

      for (const node of sim.nodes) {
        if (node.dragged) {
          node.x = node.dragX;  node.y = node.dragY
          node.tx = node.dragX; node.ty = node.dragY
          continue
        }
        // Pinned nodes stay where the user dropped them
        if (node.pinned) continue

        if (node.isHub) {
          if (hubs.length === 1) {
            node.tx = 0; node.ty = 0
          } else {
            // node.hubOrbitR overrides the global setting when user has repositioned this hub
            const r      = node.hubOrbitR ?? hubR
            const hubIdx = hubs.indexOf(node)
            const baseA  = (hubIdx / hubs.length) * Math.PI * 2
            const speed  = ORBIT_SPEED * orbitMul * (100 / Math.max(r, 1))
            node.angle   = baseA + sim.clock * speed + (node.hubAngleOffset ?? 0)
            node.tx = Math.cos(node.angle) * r
            node.ty = Math.sin(node.angle) * r
          }
        } else if (node.linkCount === 0) {
          const sector  = SECTORS[node.sectorType] || SECTORS.notebook
          const anchorX = Math.cos(sector.angle) * sector.dist
          const anchorY = Math.sin(sector.angle) * sector.dist
          const si      = node.sectorIdx
          const r       = clusterSpc * Math.sqrt(si + 0.5)
          const gAngle  = si * GOLDEN_ANGLE
          node.tx = anchorX + r * Math.cos(gAngle)
          node.ty = anchorY + r * Math.sin(gAngle)
        } else {
          let px = 0, py = 0, pCount = 0
          for (const parentId of node.parents) {
            const p = nodesMap.get(parentId)
            if (p) { px += p.x; py += p.y; pCount++ }
          }
          if (pCount === 0) { px = 0; py = 0; pCount = 1 }
          else { px /= pCount; py /= pCount }

          const r     = node.radius * cfg.orbitRadiusMul
          const speed = ORBIT_SPEED * orbitMul * (100 / Math.max(r, 30))
          node.angle += speed
          node.tx = px + Math.cos(node.angle) * r
          node.ty = py + Math.sin(node.angle) * r
        }

        node.x += (node.tx - node.x) * lerpRate
        node.y += (node.ty - node.y) * lerpRate
        if ((node.spawnProgress ?? 1) < 1)
          node.spawnProgress = Math.min((node.spawnProgress ?? 0) + 0.055, 1)
      }

      // ── Render ─────────────────────────────────────────────────────────────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(z, z)

      // Build focus context: which nodes are "lit" when something is selected
      const sel     = sim.selected
      const selNode = sel ? nodesMap.get(sel) : null
      const litIds  = sel ? new Set([sel]) : null
      if (selNode) {
        selNode.parents.forEach(id => litIds.add(id))
        selNode.children.forEach(id => litIds.add(id))
      }

      // Edges
      if (cfg.showEdges) {
        for (const edge of sim.edges) {
          const from = nodesMap.get(edge.fromId)
          const to   = nodesMap.get(edge.toId)
          if (!from || !to) continue
          const edgeSp = Math.min(from.spawnProgress ?? 1, to.spawnProgress ?? 1)
          if (edgeSp <= 0) continue

          const isConnected = sel && (edge.fromId === sel || edge.toId === sel)
          const isDimmed    = sel && !isConnected

          const dx    = to.x - from.x
          const dy    = to.y - from.y
          const dist  = Math.hypot(dx, dy) || 1
          const naturalDist  = Math.hypot(to.tx - from.tx, to.ty - from.ty) || dist
          const stretchRatio = dist / naturalDist

          const mx   = (from.x + to.x) / 2
          const my   = (from.y + to.y) / 2
          const perp = { x: -(dy / dist), y: dx / dist }
          const bow  = Math.min(dist * 0.22, 60) * Math.max(stretchRatio - 1, 0)
          const cpx  = mx + perp.x * bow
          const cpy  = my + perp.y * bow

          let alpha = (0.55 + (stretchRatio - 1) * 0.35) * cfg.edgeOpacityMul * edgeSp
          if (isConnected) alpha = Math.max(alpha, 0.75 * edgeSp)
          if (isDimmed)    alpha *= 0.06
          alpha = Math.min(alpha, 0.92)

          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.quadraticCurveTo(cpx, cpy, to.x, to.y)
          ctx.strokeStyle = isConnected
            ? `rgba(220,200,255,${alpha})`
            : `rgba(170,150,255,${alpha})`
          ctx.lineWidth = (isConnected ? 2.8 : (from.isHub || to.isHub ? 2.0 : 1.4)) / z
          ctx.stroke()
        }
      }

      // Nodes — hubs last so they render on top
      const sorted = [...sim.nodes].sort((a, b) => (a.isHub ? 1 : 0) - (b.isHub ? 1 : 0))
      const nMul   = cfg.nodeSizeMul

      for (const node of sorted) {
        const color      = NODE_COLORS[node.type] || '#888'
        const sp         = node.spawnProgress ?? 1
        const r          = nodeRadius(node, nMul) * sp
        const hovered    = sim.hovered === node.id
        const isSelected = node.id === sel
        const isLit      = !sel || litIds.has(node.id)
        const dimAlpha   = (isLit ? 1 : 0.1) * sp

        ctx.globalAlpha = dimAlpha

        // Glow halo for hubs (and selected node)
        if ((node.isHub && cfg.glowEnabled) || isSelected) {
          const glowR = isSelected ? r * 4 : r * 3
          const grd   = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR)
          grd.addColorStop(0, isSelected ? `${color}66` : `${color}44`)
          grd.addColorStop(1, `${color}00`)
          ctx.beginPath()
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
          ctx.fillStyle = grd
          ctx.fill()
        }

        if (hovered || isSelected) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + (isSelected ? 5 : 4) / z, 0, Math.PI * 2)
          ctx.strokeStyle = isSelected ? color : `${color}99`
          ctx.lineWidth   = (isSelected ? 2 : 1.5) / z
          ctx.stroke()
        }

        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fillStyle   = (hovered || isSelected) ? color : `${color}CC`
        ctx.fill()
        ctx.strokeStyle = `${color}55`
        ctx.lineWidth   = 1 / z
        ctx.stroke()

        // Labels — always show for selected/connected nodes, otherwise respect setting
        const sl = cfg.showLabels
        const showLabel = isSelected || isLit && (
          hovered
          || (sl === 'always')
          || (sl === 'linked' && (node.isHub || (node.linkCount > 0 && z >= 0.65)))
        )
        if (showLabel && isLit) {
          const fSize = (isSelected ? 11.5 : node.isHub ? 10.5 : 8.5) / z
          ctx.font    = `${(isSelected || node.isHub) ? 700 : 500} ${fSize}px system-ui, -apple-system, sans-serif`
          ctx.textAlign = 'center'

          // Pill background so the label is readable on any theme
          const rawTitle = node.title || ''
          const label   = rawTitle.length > (node.isHub ? 22 : 18)
            ? rawTitle.slice(0, node.isHub ? 21 : 17) + '…'
            : rawTitle
          const padding = 4 / z
          const tw      = ctx.measureText(label).width
          const lx      = node.x
          const ly      = node.y + r + 13 / z
          const ph      = fSize + padding * 2
          const pw      = tw + padding * 3

          // Semi-transparent background pill using theme bg color
          ctx.globalAlpha = dimAlpha * 0.85
          ctx.fillStyle   = bgColor
          ctx.beginPath()
          ctx.roundRect?.(lx - pw / 2, ly - ph * 0.78, pw, ph, ph / 2)
            ?? ctx.rect(lx - pw / 2, ly - ph * 0.78, pw, ph)
          ctx.fill()

          // Text in theme text color
          ctx.globalAlpha = dimAlpha
          ctx.fillStyle   = isSelected ? color : textColor
          ctx.fillText(label, lx, ly)
        }

        ctx.globalAlpha = 1
      }

      // Sector anchor labels
      if (cfg.showSectorLabels && z < 0.9) {
        ctx.font      = `600 ${11 / z}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        for (const [type, sector] of Object.entries(SECTORS)) {
          const ax = Math.cos(sector.angle) * sector.dist
          const ay = Math.sin(sector.angle) * sector.dist
          const hasStrays = sim.nodes.some(n => n.sectorType === type && n.linkCount === 0)
          if (!hasStrays) continue
          ctx.fillStyle = `${NODE_COLORS[type]}55`
          ctx.fillText(TYPE_LABELS[type] + 's', ax, ay - 28 / z)
        }
      }

      ctx.restore()

      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.error('[Nebuli] render tick error:', err)
      rafRef.current = requestAnimationFrame(tick)
    } }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [])   // canvas is stable — no deps needed

  // ── Pointer interaction ────────────────────────────────────────────────────────
  const hitTest = useCallback((canvasX, canvasY) => {
    const sim = simRef.current
    const W   = canvasRef.current?.offsetWidth  || 0
    const H   = canvasRef.current?.offsetHeight || 0
    const cx  = W / 2 + sim.camera.x
    const cy  = H / 2 + sim.camera.y
    const z   = sim.camera.zoom
    // Convert canvas coords → world coords
    const wx  = (canvasX - cx) / z
    const wy  = (canvasY - cy) / z
    for (let i = sim.nodes.length - 1; i >= 0; i--) {
      const n = sim.nodes[i]
      const r = nodeRadius(n) + 4   // a little extra hit area
      if (Math.hypot(wx - n.x, wy - n.y) <= r / Math.min(z, 1)) return n
    }
    return null
  }, [])

  const toWorldCoords = useCallback((canvasX, canvasY) => {
    const sim = simRef.current
    const W   = canvasRef.current?.offsetWidth  || 0
    const H   = canvasRef.current?.offsetHeight || 0
    const cx  = W / 2 + sim.camera.x
    const cy  = H / 2 + sim.camera.y
    const z   = sim.camera.zoom
    return { x: (canvasX - cx) / z, y: (canvasY - cy) / z }
  }, [])

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const cx     = e.clientX - rect.left
    const cy     = e.clientY - rect.top
    const sim    = simRef.current

    sim.pointerDown = { x: cx, y: cy, time: Date.now(), button: e.button }

    // Middle mouse or alt+left = pan mode
    if (e.button === 1 || e.altKey) {
      sim.pan = { startX: cx, startY: cy, camX0: sim.camera.x, camY0: sim.camera.y }
      canvas.style.cursor = 'grabbing'
      return
    }

    // Check if a node was hit
    const node = hitTest(cx, cy)
    if (node) {
      const wc = toWorldCoords(cx, cy)
      node.dragged    = true
      node.dragX      = node.x
      node.dragY      = node.y
      node.unpinnedX  = node.x   // snapshot for drag-distance check on release
      node.unpinnedY  = node.y
      sim.dragNode = { id: node.id, ox: wc.x - node.x, oy: wc.y - node.y }
      canvas.style.cursor = 'grabbing'
    } else {
      // Background pan
      sim.pan = { startX: cx, startY: cy, camX0: sim.camera.x, camY0: sim.camera.y }
      canvas.style.cursor = 'grabbing'
    }
  }

  function onPointerMove(e) {
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const cx     = e.clientX - rect.left
    const cy     = e.clientY - rect.top
    const sim    = simRef.current

    if (sim.pan) {
      sim.camera.x = sim.pan.camX0 + (cx - sim.pan.startX)
      sim.camera.y = sim.pan.camY0 + (cy - sim.pan.startY)
      return
    }

    if (sim.dragNode) {
      const wc = toWorldCoords(cx, cy)
      const node = sim.nodes.find(n => n.id === sim.dragNode.id)
      if (node) {
        node.dragX = wc.x - sim.dragNode.ox
        node.dragY = wc.y - sim.dragNode.oy
        node.x     = node.dragX
        node.y     = node.dragY
      }
      return
    }

    // Hover detection
    const hit = hitTest(cx, cy)
    sim.hovered = hit?.id ?? null
    canvas.style.cursor = hit ? 'pointer' : 'default'
  }

  function onPointerUp(e) {
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const cx     = e.clientX - rect.left
    const cy     = e.clientY - rect.top
    const sim    = simRef.current
    const pd     = sim.pointerDown

    // Release drag — re-anchor orbital parameters to the dropped position
    if (sim.dragNode) {
      const node = sim.nodes.find(n => n.id === sim.dragNode.id)
      if (node) {
        const moved = Math.hypot(node.x - (node.unpinnedX ?? node.x), node.y - (node.unpinnedY ?? node.y))
        node.dragged = false

        if (moved > 4) {
          const nodesMap = new Map(sim.nodes.map(n => [n.id, n]))

          if (node.isHub) {
            // Store per-node orbit radius from the drop distance
            node.hubOrbitR = Math.max(10, Math.hypot(node.x, node.y))
            // Re-anchor angle offset so the hub continues from here
            const hubs    = sim.nodes.filter(n => n.isHub)
            const hubIdx  = hubs.indexOf(node)
            const baseA   = (hubIdx / Math.max(hubs.length, 1)) * Math.PI * 2
            const speed   = ORBIT_SPEED * settingsRef.current.orbitSpeed * (100 / Math.max(node.hubOrbitR, 1))
            node.hubAngleOffset = Math.atan2(node.y, node.x) - (baseA + sim.clock * speed)

          } else if (node.linkCount > 0) {
            // Recompute angle + radius relative to weighted parent midpoint
            let px = 0, py = 0, pCount = 0
            for (const parentId of node.parents) {
              const p = nodesMap.get(parentId)
              if (p) { px += p.x; py += p.y; pCount++ }
            }
            if (pCount === 0) { px = 0; py = 0 }
            else { px /= pCount; py /= pCount }

            const dx = node.x - px
            const dy = node.y - py
            node.angle  = Math.atan2(dy, dx)
            node.radius = Math.max(20, Math.hypot(dx, dy))   // no upper cap

          } else {
            // Stray node — pin it (formula-driven target, can't infer intent)
            node.pinned = true
            node.tx = node.x
            node.ty = node.y
          }
        }
      }
      sim.dragNode = null
    }

    sim.pan = null
    canvas.style.cursor = sim.hovered ? 'pointer' : 'default'

    // Click detection: small movement + fast release = click
    if (pd && Math.hypot(cx - pd.x, cy - pd.y) < 6 && Date.now() - pd.time < 400) {
      const node = hitTest(cx, cy)
      if (node) {
        if (node.id === sim.selected) {
          // Second click on same node → open it
          openNode(node)
        } else {
          focusNode(node)
        }
      } else {
        // Click on background → deselect
        sim.selected = null
        setFocusedNode(null)
      }
    }

    sim.pointerDown = null
  }

  function onWheel(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const sim    = simRef.current

    const factor = e.deltaY < 0 ? 1.1 : 0.909
    const newZ   = Math.min(Math.max(sim.camera.zoom * factor, 0.18), 5)

    // Zoom toward cursor position
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
    const W     = canvas.offsetWidth
    const H     = canvas.offsetHeight
    const scale = newZ / sim.camera.zoom

    // Zoom toward cursor: keep the world point under the mouse stationary
    sim.camera.x = mx - (mx - (W / 2 + sim.camera.x)) * scale - W / 2
    sim.camera.y = my - (my - (H / 2 + sim.camera.y)) * scale - H / 2
    sim.camera.zoom = newZ
  }

  function openNode(node) {
    const s = useAppStore.getState()
    if (node.type === 'notebook') {
      const nb = s.notebooks.find(n => n.id === node.id)
      if (!nb) return
      if (paneTabId) {
        s.updateTab?.(paneTabId, { view: 'notebook', activeNotebook: nb })
        s.setView('notebook')
      } else {
        s.navigate({ view: 'notebook', activeNotebook: nb })
      }
    } else if (node.type === 'book' || node.type === 'audio') {
      const b = s.library.find(x => x.id === node.id)
      if (!b) return
      if (b.type === 'audio') {
        if (paneTabId) { s.updateTab?.(paneTabId, { view: 'audioplayer', activeAudioBook: b }); s.setView('audioplayer') }
        else s.navigate({ view: 'audioplayer', activeAudioBook: b })
      } else {
        if (paneTabId) { s.updateTab?.(paneTabId, { view: 'reader', activeBook: b }); s.setView('reader') }
        else s.navigate({ view: 'reader', activeBook: b })
      }
    } else if (node.type === 'sketchbook') {
      const sb = s.sketchbooks.find(x => x.id === node.id)
      if (!sb) return
      if (paneTabId) { s.updateTab?.(paneTabId, { view: 'sketchbook', activeSketchbook: sb }); s.setView('sketchbook') }
      else s.navigate({ view: 'sketchbook', activeSketchbook: sb })
    } else if (node.type === 'flashcard') {
      const fd = s.flashcardDecks.find(x => x.id === node.id)
      if (!fd) return
      if (paneTabId) { s.updateTab?.(paneTabId, { view: 'flashcards', activeFlashcardDeck: fd }); s.setView('flashcards') }
      else s.navigate({ view: 'flashcards', activeFlashcardDeck: fd })
    }
  }

  // ── Focus a node: animate camera to it and highlight connections ─────────────
  function focusNode(node) {
    const sim    = simRef.current
    const canvas = canvasRef.current
    if (!canvas) return

    sim.selected = node.id
    setFocusedNode(node)

    if (!settingsRef.current.focusZoom) return  // zoom disabled — just highlight

    // Zoom level that fits the node + its neighbours comfortably
    const connectedCount = node.parents.length + node.children.length
    const targetZoom     = connectedCount > 6 ? 1.2 : connectedCount > 2 ? 1.6 : 2.2

    // camera.x = -node.x * zoom  →  centers the node at canvas midpoint
    sim.focusAnim = {
      tx:     -node.x * targetZoom,
      ty:     -node.y * targetZoom,
      tz:     targetZoom,
      startX: sim.camera.x,
      startY: sim.camera.y,
      startZ: sim.camera.zoom,
      t0:     performance.now(),
      dur:    520,
    }
  }

  // ── Escape deselects ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        simRef.current.selected = null
        setFocusedNode(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Reset camera ─────────────────────────────────────────────────────────────
  function resetCamera() {
    simRef.current.camera = { x: 0, y: 0, zoom: 1 }
    simRef.current.clock  = 0
    startSpawn(allNodesRef.current)
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:'var(--bg)', userSelect:'none' }}>

      {/* Header */}
      <div style={{
        display:'flex', alignItems:'center', gap:8, padding:'0 12px',
        height:46, borderBottom:'1px solid var(--border)', flexShrink:0,
        background:'var(--surface)', boxSizing:'border-box',
      }}>
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

        {!loading && (
          <span style={{ fontSize:11, color:'var(--textDim)', marginLeft:4 }}>
            {nodeCount} nodes · {edgeCount} links
          </span>
        )}

        <div style={{ flex:1 }} />

        {/* Reset camera */}
        <button onClick={resetCamera} style={headerBtn()}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/>
          </svg>
          Reset
        </button>

        {/* Settings */}
        <button onClick={() => setSettingsOpen(o => !o)} style={headerBtn(settingsOpen)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.4 2.4l.7.7M8.9 8.9l.7.7M9.6 2.4l-.7.7M3.1 8.9l-.7.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          Settings
        </button>

        {/* Tab switcher */}
        <div style={{ display:'flex', gap:3, background:'var(--surfaceAlt)', border:'1px solid var(--border)', borderRadius:9, padding:3 }}>
          {[['connections','Connections'],['tags','Tags']].map(([k,l]) => (
            <button key={k} onClick={() => setGraphTab(k)} style={{
              height:22, padding:'0 10px', fontSize:11, fontWeight:600, border:'none',
              borderRadius:6, cursor:'pointer', fontFamily:'inherit',
              background: graphTab===k ? 'var(--surface)' : 'none',
              color: graphTab===k ? 'var(--text)' : 'var(--textDim)',
              boxShadow: graphTab===k ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              transition:'background 0.12s,color 0.12s',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} style={{ flex:1, position:'relative', overflow:'hidden', background:'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--surfaceAlt) 55%, var(--bg)) 0%, var(--bg) 70%)' }}>

        {/* Dot-grid background */}
        <div style={{
          position:'absolute', inset:0, pointerEvents:'none',
          backgroundImage:'radial-gradient(circle, var(--border) 0.8px, transparent 0.8px)',
          backgroundSize:'26px 26px', opacity:0.18,
        }} />

        <canvas
          ref={canvasRef}
          style={{ position:'absolute', inset:0, display: graphTab === 'tags' ? 'none' : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        />

        {/* Tags — full-area separate view, not an overlay on the canvas */}
        {graphTab === 'tags' && !loading && (
          <div style={{ position:'absolute', inset:0, overflow:'auto' }}>
            <TagsHeatmap tagFrequencies={tagFrequencies} />
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{
            position:'absolute', inset:0, display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:14,
            background:'rgba(0,0,0,0.18)', pointerEvents:'none',
          }}>
            <div style={{
              width:32, height:32, borderRadius:'50%',
              border:'2px solid var(--border)', borderTopColor:'var(--accent)',
              animation:'spin 0.9s linear infinite',
            }} />
            <span style={{ fontSize:13, color:'var(--textDim)' }}>Building knowledge graph…</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Bottom-left: legend when idle, info panel when a node is focused — hidden on tags tab */}
        {!loading && graphTab !== 'tags' && (
          <div style={{ position:'absolute', bottom:14, left:14, maxWidth:300 }}>
            {focusedNode ? (
              <NodeInfoPanel
                node={focusedNode}
                allNodes={simRef.current.nodes}
                onOpen={() => openNode(focusedNode)}
                onUnpin={() => {
                  const n = simRef.current.nodes.find(x => x.id === focusedNode.id)
                  if (n) {
                    n.pinned = false
                    n.hubAngleOffset = 0
                    n.hubOrbitR = undefined
                    n.angle  = Math.random() * Math.PI * 2
                    n.radius = 42 + Math.random() * 32
                  }
                }}
                onClose={() => { simRef.current.selected = null; setFocusedNode(null) }}
              />
            ) : settings.showLegend ? (
              <div style={{
                background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:10, padding:'8px 12px', display:'flex', gap:10,
                flexWrap:'wrap', pointerEvents:'none',
              }}>
                {Object.entries(NODE_COLORS).map(([type, color]) => (
                  <div key={type} style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:color, flexShrink:0 }} />
                    <span style={{ fontSize:10, color:'var(--textDim)', fontWeight:500 }}>
                      {TYPE_LABELS[type]}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Controls hint — bottom-right, hidden while a node is focused or on tags tab */}
        {!loading && !focusedNode && graphTab !== 'tags' && (
          <div style={{
            position:'absolute', bottom:14, right:14,
            fontSize:10, color:'var(--textDim)', textAlign:'right',
            lineHeight:1.6, pointerEvents:'none',
          }}>
            Scroll to zoom · Drag to pan · Click node to focus
          </div>
        )}

        {/* Settings panel */}
        {settingsOpen && (
          <NebuliSettings
            settings={settings}
            onChange={applySettings}
            onClose={() => setSettingsOpen(false)}
            filterTypes={filterTypes}
            filterCollection={filterCollection}
            filterTags={filterTags}
            filterSearch={filterSearch}
            filterLinked={filterLinked}
            allTags={allTags}
            collections={collections}
            onToggleType={toggleType}
            onToggleTag={toggleTag}
            onSetCollection={setFilterCollection}
            onSetSearch={setFilterSearch}
            onSetLinked={setFilterLinked}
            onClearFilters={() => {
              setFilterTypes(new Set(ALL_TYPES))
              setFilterCollection(null)
              setFilterTags(new Set())
              setFilterSearch('')
              setFilterLinked('all')
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Settings panel ─────────────────────────────────────────────────────────────
function NebuliSettings({
  settings, onChange, onClose,
  filterTypes, filterCollection, filterTags, filterSearch, filterLinked,
  allTags, collections,
  onToggleType, onToggleTag, onSetCollection, onSetSearch, onSetLinked, onClearFilters,
}) {
  const hasActiveFilters = filterTypes.size < ALL_TYPES.length || filterCollection || filterTags.size > 0 || filterSearch.trim() || filterLinked !== 'all'
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 272,
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 20,
      boxShadow: '-8px 0 24px rgba(0,0,0,0.22)',
    }}>
      {/* Panel header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: 44, borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.03em' }}>
          Nebuli Settings
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--textDim)',
          padding: 4, borderRadius: 5, display: 'flex', alignItems: 'center',
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px 20px' }}>

        <SettingsSection label="Simulation">
          <SliderRow
            label="Orbit Speed"
            value={settings.orbitSpeed}
            min={0} max={3} step={0.05}
            display={v => `${v.toFixed(2)}×`}
            onChange={v => onChange({ orbitSpeed: v })}
          />
          <SliderRow
            label="Smoothness"
            value={settings.lerpRate}
            min={0.05} max={2} step={0.05}
            display={v => `${v.toFixed(2)}×`}
            onChange={v => onChange({ lerpRate: v })}
          />
          <SliderRow
            label="Orbit Radius"
            value={settings.orbitRadiusMul}
            min={0.3} max={2.5} step={0.05}
            display={v => `${v.toFixed(2)}×`}
            onChange={v => onChange({ orbitRadiusMul: v })}
          />
          <SliderRow
            label="Hub Spacing"
            value={settings.hubOrbitR}
            min={0} max={200} step={5}
            display={v => `${v}px`}
            onChange={v => onChange({ hubOrbitR: v })}
          />
          <SliderRow
            label="Cluster Spacing"
            value={settings.clusterSpacing}
            min={10} max={80} step={2}
            display={v => `${v}px`}
            onChange={v => onChange({ clusterSpacing: v })}
          />
        </SettingsSection>

        <SettingsSection label="Visuals">
          <SliderRow
            label="Node Size"
            value={settings.nodeSizeMul}
            min={0.4} max={2.5} step={0.05}
            display={v => `${v.toFixed(2)}×`}
            onChange={v => onChange({ nodeSizeMul: v })}
          />
          <SliderRow
            label="Edge Opacity"
            value={settings.edgeOpacityMul}
            min={0} max={3} step={0.05}
            display={v => `${v.toFixed(2)}×`}
            onChange={v => onChange({ edgeOpacityMul: v })}
          />
          <ToggleRow label="Show Edges"         value={settings.showEdges}        onChange={v => onChange({ showEdges: v })} />
          <ToggleRow label="Hub Glow"            value={settings.glowEnabled}      onChange={v => onChange({ glowEnabled: v })} />
          <ToggleRow label="Focus Zoom"          value={settings.focusZoom}        onChange={v => onChange({ focusZoom: v })} />
          <ToggleRow label="Sector Labels"       value={settings.showSectorLabels} onChange={v => onChange({ showSectorLabels: v })} />
          <ToggleRow label="Legend"              value={settings.showLegend}       onChange={v => onChange({ showLegend: v })} />
        </SettingsSection>

        <SettingsSection label="Labels">
          {[['always','Always'],['linked','Linked & hovered'],['hovered','Hovered only']].map(([k,l]) => (
            <button key={k} onClick={() => onChange({ showLabels: k })} style={{
              width: '100%', textAlign: 'left', padding: '6px 10px', marginBottom: 3,
              background: settings.showLabels === k ? 'var(--accent)18' : 'var(--surfaceAlt)',
              border: `1px solid ${settings.showLabels === k ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 11, fontWeight: settings.showLabels === k ? 600 : 400,
              color: settings.showLabels === k ? 'var(--accent)' : 'var(--textDim)',
              transition: 'all 0.1s',
            }}>{l}</button>
          ))}
        </SettingsSection>

        <SettingsSection label="Filters">

          {/* Type toggles */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, display: 'block', marginBottom: 6 }}>File Type</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {ALL_TYPES.map(type => {
                const active = filterTypes.has(type)
                const color  = NODE_COLORS[type]
                return (
                  <button key={type} onClick={() => onToggleType(type)} style={{
                    height: 22, padding: '0 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    borderRadius: 20, border: `1.5px solid ${active ? color : 'var(--border)'}`,
                    background: active ? `${color}22` : 'none',
                    color: active ? color : 'var(--textDim)',
                    display: 'flex', alignItems: 'center', gap: 4, transition: 'all 0.1s', fontFamily: 'inherit',
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? color : 'var(--border)', flexShrink: 0 }} />
                    {TYPE_LABELS[type]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Connections */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Connections</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {[['all','All'],['linked','Linked only'],['unlinked','Unlinked only']].map(([k,l]) => (
                <button key={k} onClick={() => onSetLinked(k)} style={{
                  flex: 1, padding: '5px 0', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  borderRadius: 6, border: '1px solid',
                  borderColor: filterLinked===k ? 'var(--accent)' : 'var(--border)',
                  background: filterLinked===k ? 'var(--accent)18' : 'none',
                  color: filterLinked===k ? 'var(--accent)' : 'var(--textDim)',
                  fontFamily: 'inherit', transition: 'all 0.1s',
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Search</span>
            <input
              type="text"
              placeholder="Filter by name…"
              value={filterSearch}
              onChange={e => onSetSearch(e.target.value)}
              style={{
                width: '100%', height: 28, padding: '0 8px', fontSize: 11, boxSizing: 'border-box',
                background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Collection */}
          {collections.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Collection</span>
              <select
                value={filterCollection || ''}
                onChange={e => onSetCollection(e.target.value || null)}
                style={{
                  width: '100%', height: 28, padding: '0 6px', fontSize: 11, boxSizing: 'border-box',
                  background: 'var(--surfaceAlt)', border: '1px solid var(--border)',
                  borderRadius: 6, color: filterCollection ? 'var(--accent)' : 'var(--text)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <option value="">All Collections</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500, display: 'block', marginBottom: 6 }}>Tags</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {allTags.map(tag => {
                  const active = filterTags.has(tag)
                  return (
                    <button key={tag} onClick={() => onToggleTag(tag)} style={{
                      height: 20, padding: '0 7px', fontSize: 9, fontWeight: 600, cursor: 'pointer',
                      borderRadius: 20, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)22' : 'none',
                      color: active ? 'var(--accent)' : 'var(--textDim)',
                      fontFamily: 'inherit', transition: 'all 0.1s',
                    }}>#{tag}</button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Clear filters */}
          {hasActiveFilters && (
            <button onClick={onClearFilters} style={{
              marginTop: 4, width: '100%', padding: '6px 0', fontSize: 10, fontWeight: 600,
              background: 'none', border: '1px solid var(--accent)', borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit', color: 'var(--accent)',
            }}>Clear Filters</button>
          )}

        </SettingsSection>

        {/* Reset to defaults */}
        <button
          onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          style={{
            marginTop: 6, width: '100%', padding: '7px 0', fontSize: 11, fontWeight: 600,
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            cursor: 'pointer', fontFamily: 'inherit', color: 'var(--textDim)',
            transition: 'border-color 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--textDim)' }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}

function SettingsSection({ label, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--textDim)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 8, paddingBottom: 5,
        borderBottom: '1px solid var(--border)',
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function SliderRow({ label, value, min, max, step, display, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, minWidth: 38, textAlign: 'right' }}>
          {display ? display(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
      />
    </div>
  )
}

function ToggleRow({ label, value, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 8,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
          background: value ? 'var(--accent)' : 'var(--border)',
          position: 'relative', transition: 'background 0.15s', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 2, left: value ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </button>
    </div>
  )
}

function NodeChip({ node }) {
  const c = NODE_COLORS[node.type] || '#888'
  const raw = node.title || ''
  const t = raw.length > 18 ? raw.slice(0, 17) + '…' : raw
  return (
    <span style={{
      fontSize:10, padding:'2px 8px', borderRadius:20,
      background:`${c}1a`, color:c, fontWeight:600,
      border:`1px solid ${c}33`, whiteSpace:'nowrap',
    }}>{t}</span>
  )
}

// ── Node info panel ────────────────────────────────────────────────────────────
function NodeInfoPanel({ node, allNodes, onOpen, onUnpin, onClose }) {
  const color       = NODE_COLORS[node.type] || '#888'
  const typeLabel   = TYPE_LABELS[node.type]  || node.type
  const totalConns  = node.parents.length + node.children.length

  // Resolve connected node titles from the live sim nodes array
  const nodeMap     = new Map(allNodes.map(n => [n.id, n]))
  const parentNodes = node.parents.map(id => nodeMap.get(id)).filter(Boolean)
  const childNodes  = node.children.map(id => nodeMap.get(id)).filter(Boolean)
  const isPinned    = nodeMap.get(node.id)?.pinned ?? false

  return (
    <div style={{
      background: 'var(--surface)', border: `1.5px solid ${color}44`,
      borderRadius: 14, padding: '14px 16px',
      width: 260,
      boxShadow: `0 8px 32px rgba(0,0,0,0.28), 0 0 0 1px ${color}22`,
      zIndex: 30,
      animation: 'fadeUp 0.18s ease-out both',
    }}>
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }`}</style>

      {/* Header row */}
      <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%', background: color,
          marginTop: 3, flexShrink: 0,
          boxShadow: `0 0 8px ${color}88`,
        }} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', lineHeight:1.3, wordBreak:'break-word' }}>
            {node.title}
          </div>
          <div style={{ fontSize:10, color:'var(--textDim)', marginTop:2, fontWeight:500 }}>
            {typeLabel} · {totalConns} connection{totalConns !== 1 ? 's' : ''}
          </div>
        </div>
        <button onClick={onClose} style={{
          background:'none', border:'none', cursor:'pointer',
          color:'var(--textDim)', padding:2, borderRadius:4, flexShrink:0,
          display:'flex', alignItems:'center',
        }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Orbital relationships */}
      <div style={{ marginBottom:12, display:'flex', flexDirection:'column', gap:8 }}>

        {/* What this node orbits around */}
        {parentNodes.length > 0 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0 }}>
                <circle cx="5" cy="5" r="1.8" fill={color}/>
                <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" stroke={color} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              </svg>
              <span style={{ fontSize:9, fontWeight:700, color:'var(--textDim)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Orbits around
              </span>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {parentNodes.slice(0, 5).map(n => (
                <NodeChip key={n.id} node={n} />
              ))}
              {parentNodes.length > 5 && <span style={{ fontSize:10, color:'var(--textDim)', alignSelf:'center' }}>+{parentNodes.length-5} more</span>}
            </div>
          </div>
        )}

        {/* What orbits this node */}
        {childNodes.length > 0 && (
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:5 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0 }}>
                <circle cx="5" cy="5" r="2.2" stroke={color} strokeWidth="1.2" fill="none"/>
                <circle cx="8.2" cy="5" r="1.2" fill={color}/>
              </svg>
              <span style={{ fontSize:9, fontWeight:700, color:'var(--textDim)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
                Orbited by
              </span>
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {childNodes.slice(0, 5).map(n => (
                <NodeChip key={n.id} node={n} />
              ))}
              {childNodes.length > 5 && <span style={{ fontSize:10, color:'var(--textDim)', alignSelf:'center' }}>+{childNodes.length-5} more</span>}
            </div>
          </div>
        )}

        {/* Stray / unlinked */}
        {parentNodes.length === 0 && childNodes.length === 0 && (
          <div style={{ fontSize:11, color:'var(--textDim)', fontStyle:'italic' }}>
            Unlinked — drifting in the {TYPE_LABELS[node.type]} cluster
          </div>
        )}

        {/* Hub with no parents */}
        {node.isHub && parentNodes.length === 0 && childNodes.length > 0 && null /* already shown above */}
      </div>

      {/* Action buttons */}
      <div style={{ display:'flex', gap:6 }}>
        <button
          onClick={onOpen}
          style={{
            flex:1, padding:'7px 0', fontSize:11, fontWeight:700,
            background: color, border:'none', borderRadius:8,
            cursor:'pointer', fontFamily:'inherit', color:'#fff',
            letterSpacing:'0.02em', boxShadow:`0 2px 8px ${color}55`,
            transition:'opacity 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity='0.85'}
          onMouseLeave={e => e.currentTarget.style.opacity='1'}
        >
          Open
        </button>
        {isPinned && (
          <button
            onClick={onUnpin}
            style={{
              padding:'7px 10px', fontSize:11, fontWeight:600,
              background:'none', border:'1px solid var(--border)', borderRadius:8,
              cursor:'pointer', fontFamily:'inherit', color:'var(--textDim)',
              transition:'border-color 0.12s, color 0.12s', whiteSpace:'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.color='var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--textDim)' }}
            title="Release this node back into orbit"
          >
            Unpin
          </button>
        )}
      </div>

      <div style={{ fontSize:9, color:'var(--textDim)', textAlign:'center', marginTop:7 }}>
        Click node again to open · Drag to pin · Esc to dismiss
      </div>
    </div>
  )
}

// ── Tags heatmap overlay ───────────────────────────────────────────────────────
function TagsHeatmap({ tagFrequencies }) {
  const entries = Object.entries(tagFrequencies).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) {
    return (
      <div style={{
        position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
        pointerEvents:'none',
      }}>
        <span style={{ fontSize:13, color:'var(--textDim)' }}>No tags found in your library.</span>
      </div>
    )
  }
  const maxFreq = entries[0][1]
  // Heatmap accent colours: low → dim, high → accent with glow
  const HEAT_COLORS = ['#6366f1','#818cf8','#a78bfa','#c084fc','#e879f9','#f472b6']
  return (
    <div style={{
      position:'absolute', inset:0, overflowY:'auto',
      background:'radial-gradient(ellipse at 50% 40%, color-mix(in srgb, var(--surfaceAlt) 55%, var(--bg)) 0%, var(--bg) 70%)',
      padding:'32px 40px',
      display:'flex', flexDirection:'column', gap:20,
    }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--textDim)', textTransform:'uppercase', letterSpacing:'0.08em' }}>
        Tag Frequency
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'10px 12px', alignItems:'flex-end' }}>
        {entries.map(([tag, count]) => {
          const ratio = count / maxFreq   // 0..1
          const tier  = Math.floor(ratio * (HEAT_COLORS.length - 1))
          const color = HEAT_COLORS[tier]
          // Font size: 11px (rare) → 26px (most frequent)
          const fs    = 11 + Math.round(ratio * 15)
          const opacity = 0.45 + ratio * 0.55
          return (
            <span key={tag} title={`${count} file${count !== 1 ? 's' : ''}`} style={{
              fontSize: fs,
              fontWeight: ratio > 0.6 ? 700 : ratio > 0.3 ? 600 : 500,
              color,
              opacity,
              lineHeight: 1.2,
              cursor: 'default',
              textShadow: ratio > 0.7 ? `0 0 12px ${color}88` : 'none',
              transition: 'opacity 0.1s',
            }}>
              {tag}
              <sup style={{ fontSize: 8, opacity: 0.7, marginLeft: 2, fontWeight: 500 }}>{count}</sup>
            </span>
          )
        })}
      </div>
      {/* Bar chart for top 20 */}
      {entries.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize:10, fontWeight:700, color:'var(--textDim)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>
            Top {Math.min(entries.length, 20)} Tags
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
            {entries.slice(0, 20).map(([tag, count]) => {
              const ratio = count / maxFreq
              const tier  = Math.floor(ratio * (HEAT_COLORS.length - 1))
              const color = HEAT_COLORS[tier]
              return (
                <div key={tag} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:11, color:'var(--text)', width:120, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tag}</span>
                  <div style={{ flex:1, height:8, background:'var(--surfaceAlt)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{
                      height:'100%', borderRadius:4,
                      width:`${ratio * 100}%`,
                      background:color,
                      boxShadow: ratio > 0.7 ? `0 0 6px ${color}88` : 'none',
                      transition:'width 0.3s ease',
                    }} />
                  </div>
                  <span style={{ fontSize:10, color:'var(--textDim)', width:24, textAlign:'right', flexShrink:0 }}>{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
