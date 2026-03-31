// Pure utility functions — no DOM, no React, no side-effects.
// Safe to import anywhere including workers.

// ── File reading ──────────────────────────────────────────────────────────────

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

// ── String helpers ────────────────────────────────────────────────────────────

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}

// ── Cover colours ─────────────────────────────────────────────────────────────

const COVER_PALETTES = [
  // Blues
  ['#0d2137', '#1565c0'], ['#0a1628', '#0d5eaf'],
  // Purples
  ['#2a0a3e', '#7b2d8b'], ['#1c0a2e', '#5c35a0'],
  // Greens
  ['#0a2213', '#1b6b3a'], ['#082a10', '#2e7d32'],
  // Reds / Crimsons
  ['#2a0808', '#8b1a1a'], ['#1e0505', '#b71c1c'],
  // Teals / Cyans
  ['#062020', '#00695c'], ['#041c1c', '#006064'],
  // Oranges / Ambers
  ['#1e0f00', '#e65100'], ['#1a0c00', '#bf360c'],
  // Pinks / Roses
  ['#2a0820', '#880e4f'], ['#1e061a', '#ad1457'],
  // Indigos
  ['#080e2a', '#283593'], ['#0a0f26', '#1a237e'],
  // Warm earth
  ['#1a0f00', '#5d4037'], ['#140800', '#4e342e'],
  // Slate
  ['#0d1117', '#263238'], ['#111827', '#1e3a5f'],
]

export function generateCoverColor(title = '') {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i)
    hash |= 0
  }
  return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length]
}

// ── Time formatting ───────────────────────────────────────────────────────────

export function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── ID generation ─────────────────────────────────────────────────────────────

export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// ── Audio file detection ──────────────────────────────────────────────────────

export const AUDIO_EXTENSIONS = /\.(mp3|m4b|m4a|wav|ogg|flac|aac|opus)$/i

export function isAudioFile(filename) {
  return AUDIO_EXTENSIONS.test(filename)
}

export function cleanFilename(filename) {
  return filename
    .replace(AUDIO_EXTENSIONS, '')
    .replace(/[_-]/g, ' ')
    .trim()
}