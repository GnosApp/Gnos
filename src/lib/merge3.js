/* merge3.js — line-based three-way merge (diff3).
 *
 * Used to reconcile a note that changed in two places at once: the editor
 * ("ours") and the file on disk ("theirs"), against the text as it stood when
 * we last agreed with disk ("base").
 *
 * WHY THIS EXISTS: saving used to be a whole-file overwrite, so a changed file
 * left only bad options — clobber it, or branch it into a "(offline edit …)"
 * duplicate. But two editors rarely touch the same LINE; they touch different
 * paragraphs. Reconciling text instead of files makes almost every case merge
 * silently. See PLAN_CONCURRENCY.md.
 *
 * Granularity is deliberately LINES, not characters: character-level merging of
 * prose interleaves words into nonsense. Paragraphs are the natural unit for
 * markdown.
 *
 * Vendored rather than added as a dependency — it is small, and this project
 * has been bitten by transitive deps (mermaid).
 */

/** Longest common subsequence of two arrays of lines → [[aIdx, bIdx], …]. */
function lcsPairs(a, b) {
  const n = a.length, m = b.length
  if (!n || !m) return []
  // Classic DP. Notes are small (tens of KB); O(n·m) is fine and predictable.
  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i, j) => dp[i * (m + 1) + j]
  const set = (i, j, v) => { dp[i * (m + 1) + j] = v }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1)))
    }
  }
  const out = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++ }
    else if (at(i + 1, j) >= at(i, j + 1)) i++
    else j++
  }
  return out
}

/**
 * Which base line maps to which side line, for lines that are UNCHANGED on that
 * side. Anything absent from the map was touched (edited or deleted).
 */
function matchMap(base, side) {
  const map = new Map()
  for (const [bi, si] of lcsPairs(base, side)) map.set(bi, si)
  return map
}

const splitLines = (s) => String(s ?? '').split('\n')

/**
 * Three-way merge.
 *
 * @returns {{clean: boolean, text: string, conflicts: number,
 *            hunks: Array<{type:'ours'|'theirs'|'both'|'conflict', ours:string[], theirs:string[]}>}}
 *
 * `clean === false` means at least one region was changed incompatibly on both
 * sides. The caller still gets usable `text` — the resolution policy is applied
 * (see mergeSilently) — plus the hunks so the losing side can be preserved.
 */
export function merge3(base, ours, theirs, opts = {}) {
  const preferOurs = opts.prefer !== 'theirs'   // default: ours wins a true conflict
  const B = splitLines(base), O = splitLines(ours), T = splitLines(theirs)

  // Fast paths — by far the most common cases.
  if (ours === theirs) return { clean: true, text: ours, conflicts: 0, hunks: [] }
  if (base === ours)   return { clean: true, text: theirs, conflicts: 0, hunks: [] }
  if (base === theirs) return { clean: true, text: ours, conflicts: 0, hunks: [] }

  const oMap = matchMap(B, O)   // baseIdx -> oursIdx  (unchanged in ours)
  const tMap = matchMap(B, T)   // baseIdx -> theirsIdx(unchanged in theirs)

  const out = []
  const hunks = []
  let conflicts = 0
  let bi = 0, oi = 0, ti = 0

  const pushHunk = (type, o, t) => { if (o.length || t.length) hunks.push({ type, ours: o, theirs: t }) }

  while (bi < B.length) {
    const oAnchor = oMap.get(bi)
    const tAnchor = tMap.get(bi)

    if (oAnchor !== undefined && tAnchor !== undefined) {
      // This base line survives on BOTH sides. Everything queued before it on
      // either side is an insertion/edit belonging to that side.
      const oIns = O.slice(oi, oAnchor)
      const tIns = T.slice(ti, tAnchor)
      if (oIns.length && tIns.length) {
        // Both inserted here. Identical → take one. Different → conflict.
        if (oIns.join('\n') === tIns.join('\n')) { out.push(...oIns); pushHunk('both', oIns, tIns) }
        else {
          conflicts++
          out.push(...(preferOurs ? oIns : tIns))
          pushHunk('conflict', oIns, tIns)
        }
      } else if (oIns.length) { out.push(...oIns); pushHunk('ours', oIns, []) }
      else if (tIns.length)   { out.push(...tIns); pushHunk('theirs', [], tIns) }

      out.push(B[bi])           // the shared line itself
      oi = oAnchor + 1; ti = tAnchor + 1; bi++
      continue
    }

    // The base line is missing from at least one side: it was edited or deleted
    // there. Collect the full run of such base lines and compare both sides'
    // replacement for that run.
    const runStart = bi
    while (bi < B.length && !(oMap.has(bi) && tMap.has(bi))) bi++

    // Where each side resumes (next shared anchor, or end of file).
    const oEnd = bi < B.length ? oMap.get(bi) : O.length
    const tEnd = bi < B.length ? tMap.get(bi) : T.length
    const oSeg = O.slice(oi, oEnd)
    const tSeg = T.slice(ti, tEnd)
    const baseSeg = B.slice(runStart, bi)

    const oChanged = oSeg.join('\n') !== baseSeg.join('\n')
    const tChanged = tSeg.join('\n') !== baseSeg.join('\n')

    if (oChanged && tChanged) {
      if (oSeg.join('\n') === tSeg.join('\n')) { out.push(...oSeg); pushHunk('both', oSeg, tSeg) }
      else {
        conflicts++
        out.push(...(preferOurs ? oSeg : tSeg))
        pushHunk('conflict', oSeg, tSeg)
      }
    } else if (oChanged) { out.push(...oSeg); pushHunk('ours', oSeg, []) }
    else if (tChanged)   { out.push(...tSeg); pushHunk('theirs', [], tSeg) }
    else out.push(...baseSeg)   // neither side actually changed it

    oi = oEnd; ti = tEnd
  }

  // Trailing insertions past the last shared line.
  const oTail = O.slice(oi), tTail = T.slice(ti)
  if (oTail.length && tTail.length) {
    if (oTail.join('\n') === tTail.join('\n')) { out.push(...oTail); pushHunk('both', oTail, tTail) }
    else {
      conflicts++
      out.push(...(preferOurs ? oTail : tTail))
      pushHunk('conflict', oTail, tTail)
    }
  } else if (oTail.length) { out.push(...oTail); pushHunk('ours', oTail, []) }
  else if (tTail.length)   { out.push(...tTail); pushHunk('theirs', [], tTail) }

  return { clean: conflicts === 0, text: out.join('\n'), conflicts, hunks }
}

/**
 * The policy wrapper used by the save path: ALWAYS returns text to write, never
 * prompts. Disjoint edits merge; a true conflict keeps ours and reports that the
 * other side needs preserving in history (PLAN_CONCURRENCY.md §0 — silence is
 * only safe because history keeps the discarded version).
 */
export function mergeSilently(base, ours, theirs) {
  const r = merge3(base, ours, theirs, { prefer: 'ours' })
  return { text: r.text, clean: r.clean, needsSnapshot: !r.clean, conflicts: r.conflicts }
}
