/* history.js — invisible per-note version history.
 *
 * This is the safety net that makes SILENT merging acceptable:
 *   "You cannot silently discard an edit unless the user can get it back."
 * It is also the honest replacement for the old conflict-fork, which achieved
 * the same goal by littering the archive with "(offline edit …)" duplicates.
 *
 * LOCATION — appDataDir, never the archive:
 *   macOS → ~/Library/Application Support/com.gnos.dev/history/<noteId>/…
 *   • the user's archive stays pure markdown
 *   • ~/Library is hidden from Finder, so it is invisible in practice
 *   • it never syncs to iCloud: no quota cost, and snapshots can't themselves
 *     become a sync-conflict source
 *   • a `.history/` folder INSIDE the archive is not an option — leading-dot
 *     paths are silently rejected by the Tauri fs scope. That exact mistake
 *     (notebooks/.index.json) once made 64 notes vanish. See A52.
 *
 * Retention: 7 days, full fidelity, then discarded (PLAN_CONCURRENCY.md §10).
 */

import { readDir, readTextFile, writeTextFile, mkdir, exists, remove } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'

const RETAIN_MS = 7 * 24 * 60 * 60 * 1000

/** Snapshot kinds — why a version was captured. */
export const KIND = {
  REMOTE: 'remote',           // the incoming disk/peer version, before merging
  LOCAL: 'local',             // our version, when a conflict discarded part of it
  MERGE: 'merge',             // the merged result
  AUTO: 'auto',               // periodic, while actively editing
  PRE_RESTORE: 'pre-restore', // current text, captured before a restore
}

async function historyRoot() {
  const dir = await join(await appDataDir(), 'history')
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

async function noteDir(noteId, create = false) {
  const dir = await join(await historyRoot(), String(noteId).replace(/[^a-zA-Z0-9_-]/g, '_'))
  if (create && !(await exists(dir))) await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Store one version. Never throws — history must never be able to break a save.
 * @returns {Promise<string|null>} the snapshot filename, or null if skipped
 */
export async function snapshot(noteId, text, kind = KIND.AUTO) {
  if (!noteId || typeof text !== 'string' || !text.length) return null
  try {
    const dir = await noteDir(noteId, true)
    // Skip if identical to the most recent snapshot — avoids autosave spam.
    const last = await latest(noteId)
    if (last && last.text === text) return null
    const name = `${Date.now()}-${kind}.md`
    await writeTextFile(await join(dir, name), text)
    return name
  } catch (err) {
    console.debug('[Gnos] history.snapshot failed (non-fatal):', err)
    return null
  }
}

function parseName(fileName) {
  const m = /^(\d+)-([a-z-]+)\.md$/i.exec(fileName || '')
  return m ? { ts: parseInt(m[1], 10), kind: m[2], file: fileName } : null
}

/** All versions for a note, newest first. Metadata only — no file contents. */
export async function listVersions(noteId) {
  try {
    const dir = await noteDir(noteId)
    if (!(await exists(dir))) return []
    const entries = await readDir(dir)
    return (entries || [])
      .map(e => parseName(e.name))
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts)
  } catch { return [] }
}

/** Read one version's text. */
export async function readVersion(noteId, file) {
  try { return await readTextFile(await join(await noteDir(noteId), file)) }
  catch { return null }
}

/** Newest version, with text. */
export async function latest(noteId) {
  const [top] = await listVersions(noteId)
  if (!top) return null
  const text = await readVersion(noteId, top.file)
  return text == null ? null : { ...top, text }
}

/**
 * Restore is NON-DESTRUCTIVE: the current text is snapshotted first, so a
 * restore can itself be undone.
 * @returns {Promise<string|null>} the restored text for the caller to apply
 */
export async function restoreVersion(noteId, file, currentText) {
  const text = await readVersion(noteId, file)
  if (text == null) return null
  await snapshot(noteId, currentText, KIND.PRE_RESTORE)
  return text
}

/** Drop anything older than the retention window. Safe to call often. */
export async function prune(noteId, retainMs = RETAIN_MS) {
  try {
    const dir = await noteDir(noteId)
    if (!(await exists(dir))) return 0
    const cutoff = Date.now() - retainMs
    const versions = await listVersions(noteId)
    let removed = 0
    for (const v of versions) {
      if (v.ts >= cutoff) continue
      try { await remove(await join(dir, v.file)); removed++ } catch { /* skip */ }
    }
    return removed
  } catch { return 0 }
}

/** Coarse line-diff for the history UI: which lines were added/removed. */
export function diffLines(a, b) {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n')
  const setA = new Map(), setB = new Map()
  for (const l of A) setA.set(l, (setA.get(l) || 0) + 1)
  for (const l of B) setB.set(l, (setB.get(l) || 0) + 1)
  let added = 0, removed = 0
  for (const [l, n] of setB) added += Math.max(0, n - (setA.get(l) || 0))
  for (const [l, n] of setA) removed += Math.max(0, n - (setB.get(l) || 0))
  return { added, removed }
}

/**
 * Where a version came from. The kinds are storage-level; this is what the UI
 * should say to a human, because "was this me or something else?" is the first
 * question you ask when scanning history.
 */
export function originOf(kind) {
  switch (kind) {
    case 'remote':      return { origin: 'external', label: 'External edit',  hint: 'Arrived from disk — another app, device, or collaborator' }
    case 'local':       return { origin: 'internal', label: 'Your version',   hint: 'Your text just before changes arrived' }
    case 'merge':       return { origin: 'merged',   label: 'Merged',         hint: 'Your edits combined with incoming changes' }
    case 'auto':        return { origin: 'internal', label: 'You edited',     hint: 'Snapshot taken while you were writing' }
    case 'pre-restore': return { origin: 'internal', label: 'Before restore', hint: 'Captured just before restoring another version' }
    default:            return { origin: 'internal', label: kind,             hint: '' }
  }
}

/**
 * Line diff for display: a list of {type:'ctx'|'add'|'del', text} rows.
 * Context lines far from any change are collapsed into {type:'skip', count}.
 */
export function diffRows(oldText, newText, context = 2) {
  const A = String(oldText ?? '').split('\n')
  const B = String(newText ?? '').split('\n')
  const n = A.length, m = B.length
  // LCS table (documents here are small; predictable beats clever)
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  const rows = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { rows.push({ type: 'ctx', text: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: A[i] }); i++ }
    else { rows.push({ type: 'add', text: B[j] }); j++ }
  }
  while (i < n) rows.push({ type: 'del', text: A[i++] })
  while (j < m) rows.push({ type: 'add', text: B[j++] })

  // Collapse long unchanged stretches so the eye goes straight to the changes.
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, k) => {
    if (r.type === 'ctx') return
    for (let d = -context; d <= context; d++) if (rows[k + d]) keep[k + d] = true
  })
  const out = []
  let skipped = 0
  rows.forEach((r, k) => {
    if (keep[k] || r.type !== 'ctx') {
      if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0 }
      out.push(r)
    } else skipped++
  })
  if (skipped) out.push({ type: 'skip', count: skipped })
  return out
}
