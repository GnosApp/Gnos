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
  ['#1a1a2e', '#16213e'], ['#0f3460', '#533483'],
  ['#2d6a4f', '#1b4332'], ['#6b2d2d', '#3d1515'],
  ['#1d3557', '#457b9d'], ['#4a1942', '#7b2d8b'],
  ['#2c3e50', '#34495e'], ['#1a472a', '#2d6a4f'],
  ['#3d1a00', '#6b3300'], ['#1a1a1a', '#2d2d2d'],
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