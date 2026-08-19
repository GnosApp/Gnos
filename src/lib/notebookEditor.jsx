// Shared notebook CodeMirror plugins, extracted from NotebookView so the quick-note
// editor can opt into the same rich behaviours. Each factory takes the loaded CM
// module bundle (`cm`) and returns CM extensions.
//
// Exports the math-calc subsystem: inline `expr=` calculator, `/math` zones,
// variable scope, natural-language math (word numbers, percentages, magnitudes),
// date/time + timezone math, offline currency/CSS units, per-line right-column
// results (numi-style) with prev/sum/total/average aggregates.
// Used by both NotebookView and QuickNoteView — keep both callers green.
// Also exports the full widget zoo (Live/Source/Preview rendering, every
// CM6 widget, makeLivePlugin) — moved here from NotebookView.jsx per
// PLAN_CONCURRENCY.md §18.3 "Phase A — Extraction"; see the section header
// further down this file for the full rationale.
import { useState, useRef, useEffect, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Eye, Pencil } from 'lucide-react'
import { IconQuill, IconDefaults } from '@/components/icons'
// NOTE: deliberately no `useAppStore` import here (removed 2026-08-19, Phase D,
// PLAN_CONCURRENCY.md §18.6) — this file is shared with the web guest bundle,
// which must stay structurally unable to touch the desktop app's disk-backed
// state (@/store/useAppStore → @/lib/storage → Tauri fs), same guarantee
// hostAssets.js's own header already states for itself. Confirmed empirically,
// not just reasoned about: importing `useAppStore` here — even from a single
// function neither the guest nor most callers use — pulled `storage.js`'s own
// function names (`migrateBooksToFlat`, `cleanupTrash`, …) straight into
// `dist-collab`'s EAGER entry chunk; tree-shaking a same-file unused export
// does NOT reliably drop a sibling export's top-level import in practice, so
// don't rely on it — decouple instead. `QuestionWidget` and
// `makeWikiDropdownPlugin` (the two things that used to read it) now take an
// optional injected accessor; see their own header comments.

// ─── Per-extension failure isolation ──────────────────────────────────────────
// Historically ONE throwing widget factory killed the whole EditorView mount →
// permanently blank page (NotebookView.jsx's own war story, predating this
// file). Each optional widget extension loads independently; a failure logs
// loudly and is skipped rather than taking the editor down with it. A factory,
// not a bare function, because the caller owns what happens with the list of
// what failed (NotebookView.jsx surfaces it in an error banner; a caller that
// doesn't care can just ignore the array). PLAN_CONCURRENCY.md §18.6 "Phase D"
// pulled this out of NotebookView.jsx's own mount effect so the web guest
// editor gets the identical insurance — arguably needs it more, being
// untrusted-network-facing.
export function makeSafeExt(failedExts) {
  return (name, make) => {
    try {
      const e = make()
      return Array.isArray(e) ? e : [e]
    } catch (err) {
      console.error(`[Notebook] widget extension "${name}" failed — skipped:`, err)
      failedExts.push(name)
      return []
    }
  }
}

// ─── Lazy math libraries ─────────────────────────────────────────────────────
let _mathP = null
function getMathjs() {
  if (_mathP) return _mathP
  _mathP = import('mathjs').then(m => m).catch(() => null)
  return _mathP
}
let _algP = null
function getAlgebrite() {
  if (_algP) return _algP
  _algP = import('algebrite').then(m => m.default || m).catch(() => null)
  return _algP
}

// ─── Offline unit setup (currencies, CSS units) ─────────────────────────────
// Static FX snapshot (approx mid-2026, per 1 USD). Fully offline by design —
// values are approximate and only refreshed when this table is updated.
const FX_PER_USD = {
  EUR: [0.93,  ['eur', 'euro', 'euros']],
  GBP: [0.79,  ['gbp', 'pound', 'pounds', 'quid']],
  JPY: [155,   ['jpy', 'yen']],
  CNY: [7.25,  ['cny', 'rmb', 'yuan']],
  CAD: [1.37,  ['cad']],
  AUD: [1.52,  ['aud']],
  CHF: [0.88,  ['chf', 'franc', 'francs']],
  INR: [84,    ['inr', 'rupee', 'rupees']],
  KRW: [1380,  ['krw', 'won']],
  MXN: [18.2,  ['mxn', 'peso', 'pesos']],
  BRL: [5.5,   ['brl', 'real', 'reais']],
  SEK: [10.6,  ['sek']],
  NOK: [10.7,  ['nok']],
  DKK: [6.95,  ['dkk']],
  PLN: [4.0,   ['pln', 'zloty']],
  NZD: [1.65,  ['nzd']],
  SGD: [1.35,  ['sgd']],
  HKD: [7.8,   ['hkd']],
  TWD: [32,    ['twd']],
  THB: [34,    ['thb', 'baht']],
  TRY: [35,    ['lira']],
  ZAR: [18.5,  ['zar', 'rand']],
  AED: [3.67,  ['aed', 'dirham', 'dirhams']],
  SAR: [3.75,  ['sar', 'riyal', 'riyals']],
  ILS: [3.7,   ['ils', 'shekel', 'shekels']],
  RUB: [92,    ['rub', 'ruble', 'rubles']],
  CZK: [23,    ['czk', 'koruna']],
  HUF: [360,   ['huf', 'forint']],
  PHP: [58,    ['php']],
  IDR: [16200, ['idr', 'rupiah']],
  MYR: [4.4,   ['myr', 'ringgit']],
  VND: [25400, ['vnd', 'dong']],
  BTC: [1 / 105000, ['btc', 'bitcoin', 'bitcoins']],
  ETH: [1 / 3800,   ['eth', 'ether', 'ethereum']],
}

let _unitsReady = false
export function setupMathUnits(m) {
  if (_unitsReady || !m || !m.createUnit) return
  _unitsReady = true
  try { m.createUnit('USD', { aliases: ['usd', 'dollar', 'dollars', 'buck', 'bucks'] }) } catch { /* exists */ }
  for (const [code, [perUSD, aliases]] of Object.entries(FX_PER_USD)) {
    try { m.createUnit(code, { definition: `${1 / perUSD} USD`, aliases }) } catch { /* exists */ }
  }
  // CSS units (96 ppi reference; 1 em = 16 px browser default)
  try { m.createUnit('px', { definition: `${1 / 96} inch`, aliases: ['pixel', 'pixels'] }) } catch { /* exists */ }
  // mathjs ships `pt` as pint — in a notes calculator, typography point wins
  // (`pint`/`pints` remain available for the liquid kind)
  try { m.createUnit('pt', { definition: `${1 / 72} inch` }, { override: true }) } catch { /* ignore */ }
  try { m.createUnit('em', { definition: `${16 / 96} inch` }) } catch { /* exists */ }
}

// ─── Currency symbols → unit names ───────────────────────────────────────────
export function currencySymbolsToUnits(expr) {
  return expr
    .replace(/\$\s?(\d+(?:\.\d+)?)/g, '$1 USD')
    .replace(/€\s?(\d+(?:\.\d+)?)/g, '$1 EUR')
    .replace(/£\s?(\d+(?:\.\d+)?)/g, '$1 GBP')
    .replace(/¥\s?(\d+(?:\.\d+)?)/g, '$1 JPY')
    .replace(/₹\s?(\d+(?:\.\d+)?)/g, '$1 INR')
    .replace(/₩\s?(\d+(?:\.\d+)?)/g, '$1 KRW')
    .replace(/₿\s?(\d+(?:\.\d+)?)/g, '$1 BTC')
}

// ─── Word-number parsing ─────────────────────────────────────────────────────
const _SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const _TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const _SCALES = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 }
const _NW = [...Object.keys(_SMALL), ...Object.keys(_TENS), ...Object.keys(_SCALES)].join('|')
const _NUM_RUN_RE = new RegExp(`\\b(?:${_NW})(?:[\\s-]+(?:and[\\s-]+)?(?:${_NW}))*\\b`, 'gi')

function parseNumberWords(words) {
  let total = 0, current = 0, matched = false
  for (const w of words) {
    if (w === 'and' || !w) continue
    if (_SMALL[w] != null) { current += _SMALL[w]; matched = true }
    else if (_TENS[w] != null) { current += _TENS[w]; matched = true }
    else if (w === 'hundred') { current = (current || 1) * 100; matched = true }
    else if (_SCALES[w]) { total += (current || 1) * _SCALES[w]; current = 0; matched = true }
    else return null
  }
  return matched ? total + current : null
}

export function wordsToNumbers(s) {
  // digit + scale word: "3 million" → 3000000 (loop for "3 hundred thousand")
  let prev
  do {
    prev = s
    s = s.replace(/(\d+(?:\.\d+)?)\s+(hundred|thousand|million|billion|trillion)\b/gi,
      (_, n, sc) => String(parseFloat(n) * _SCALES[sc.toLowerCase()]))
  } while (s !== prev)
  // pure word runs: "twenty five", "one hundred and six"
  s = s.replace(_NUM_RUN_RE, run => {
    const n = parseNumberWords(run.toLowerCase().split(/[\s-]+/))
    return n != null ? String(n) : run
  })
  // "3 point 5" → 3.5
  s = s.replace(/(\d+)\s+point\s+(\d+)/gi, '$1.$2')
  return s
}

// ─── Magnitude suffixes (case-sensitive; fallback path only) ─────────────────
// Plain eval runs first, so "5K" as Kelvin / "5m" as meters get their chance.
export function expandMagnitudes(expr) {
  return expr
    .replace(/(\d+(?:\.\d+)?)[kK]\b/g, (_, n) => String(parseFloat(n) * 1e3))
    .replace(/(\d+(?:\.\d+)?)M\b/g, (_, n) => String(parseFloat(n) * 1e6))
    .replace(/(\d+(?:\.\d+)?)\s?(?:bn|B)\b/g, (_, n) => String(parseFloat(n) * 1e9))
    .replace(/(\d+(?:\.\d+)?)\s?(?:mil|mm)\b/gi, (_, n) => String(parseFloat(n) * 1e6))
}

// ─── Percentage preprocessing ────────────────────────────────────────────────
export function percentPreprocess(expr) {
  let s = expr
  // "X% of Y" → (X/100) * Y
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s+(?:of|from)\b/gi, '($1/100) *')
  // "X% off Y" → Y * (1 - X/100)
  s = s.replace(/(\d+(?:\.\d+)?)\s*%\s+off\s+(.+)$/i, '($2) * (1 - $1/100)')
  // "increase/decrease Y by X%"
  s = s.replace(/^(?:increase|raise|grow)\s+(.+?)\s+by\s+(\d+(?:\.\d+)?)\s*%$/i, '($1) * (1 + $2/100)')
  s = s.replace(/^(?:decrease|reduce|discount|lower)\s+(.+?)\s+by\s+(\d+(?:\.\d+)?)\s*%$/i, '($1) * (1 - $2/100)')
  // compounding "+ X%" / "- X%" — numi semantics: 200 + 10% = 220
  let prev
  do {
    prev = s
    s = s.replace(/([\d)])\s*([-+])\s*(\d+(?:\.\d+)?)%(?![\w%])/, (_, a, op, b) => `${a} * (1 ${op} ${b}/100)`)
  } while (s !== prev)
  // "* X%" / "/ X%" → fraction
  s = s.replace(/([*/])\s*(\d+(?:\.\d+)?)%(?![\w%])/g, '$1 ($2/100)')
  // bare "X%" → fraction
  if (/^\s*\d+(?:\.\d+)?%\s*$/.test(s)) s = s.replace('%', '/100')
  return s
}

// ─── Natural language → expression ───────────────────────────────────────────
export function naturalLangToExpr(expr) {
  let s = expr.toLowerCase()
  s = s.replace(/^(?:what\s+is|what's|how\s+much\s+is|calculate|compute|find|evaluate)\s+/i, '')
  s = s.replace(/\?+\s*$/, '')
  s = wordsToNumbers(s)
  s = s.replace(/\bnegative\s+(\d)/g, '-$1')
  s = s.replace(/\bplus\b/g, '+')
  s = s.replace(/\bminus\b/g, '-')
  s = s.replace(/\btimes\b/g, '*')
  s = s.replace(/\bmultiplied\s+by\b/g, '*')
  s = s.replace(/\bdivided\s+by\b/g, '/')
  s = s.replace(/\bover\b/g, '/')
  s = s.replace(/\bmodulo\b/g, 'mod')
  s = s.replace(/\bto\s+the\s+power\s+of\b/g, '^')
  s = s.replace(/(\d)\s*x\s*(\d)/g, '$1 * $2')          // 5 x 3
  s = s.replace(/\bsquared\b/g, '^2')
  s = s.replace(/\bcubed\b/g, '^3')
  s = s.replace(/\bsquare\s+root\s+of\s+(.+)$/, 'sqrt($1)')
  s = s.replace(/\bcube\s+root\s+of\s+(.+)$/, 'cbrt($1)')
  s = s.replace(/\bhalf\s+of\b/g, '0.5 *')
  s = s.replace(/\ba\s+third\s+of\b/g, '(1/3) *')
  s = s.replace(/\ba\s+quarter\s+of\b/g, '0.25 *')
  s = s.replace(/\bdouble\b/g, '2 *')
  s = s.replace(/\btriple\b/g, '3 *')
  s = s.replace(/\btwice\b/g, '2 *')
  s = s.replace(/\bpercent\b/g, '%')
  // Conversion sugar: "100 usd in eur" → "100 usd to eur" (dates already
  // handled by tryDateMath before this fallback runs)
  s = s.replace(/(\d|\w)\s+in\s+([a-z])/g, '$1 to $2')
  return s
}

// ─── Result display formatting (right-column chips only; inserts stay raw) ──
export function formatDisplay(str) {
  if (str == null) return str
  const s = String(str).trim()
  const numM = s.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(\s.*)?$/i)
  if (!numM) return s
  const n = parseFloat(numM[1])
  if (!isFinite(n)) return s
  const clean = Number(n.toPrecision(12))
  let numStr
  if (clean !== 0 && (Math.abs(clean) >= 1e15 || Math.abs(clean) < 1e-6)) numStr = clean.toExponential(4)
  else numStr = clean.toLocaleString('en-US', { maximumFractionDigits: 8 })
  return numStr + (numM[2] || '')
}

// ─── Timezone lookup (offline via Intl) ──────────────────────────────────────
const CITY_TZ = {
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York',
  miami: 'America/New_York', atlanta: 'America/New_York', toronto: 'America/Toronto',
  chicago: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago',
  denver: 'America/Denver', phoenix: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', vancouver: 'America/Vancouver',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  honolulu: 'Pacific/Honolulu', anchorage: 'America/Anchorage',
  london: 'Europe/London', dublin: 'Europe/Dublin', lisbon: 'Europe/Lisbon',
  paris: 'Europe/Paris', berlin: 'Europe/Berlin', madrid: 'Europe/Madrid',
  rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', brussels: 'Europe/Brussels',
  zurich: 'Europe/Zurich', geneva: 'Europe/Zurich', vienna: 'Europe/Vienna',
  stockholm: 'Europe/Stockholm', oslo: 'Europe/Oslo', copenhagen: 'Europe/Copenhagen',
  helsinki: 'Europe/Helsinki', warsaw: 'Europe/Warsaw', prague: 'Europe/Prague',
  athens: 'Europe/Athens', istanbul: 'Europe/Istanbul', moscow: 'Europe/Moscow',
  dubai: 'Asia/Dubai', 'tel aviv': 'Asia/Jerusalem', riyadh: 'Asia/Riyadh',
  mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', kolkata: 'Asia/Kolkata',
  singapore: 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai', taipei: 'Asia/Taipei', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo',
  seoul: 'Asia/Seoul', bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', manila: 'Asia/Manila',
  sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne', brisbane: 'Australia/Brisbane',
  perth: 'Australia/Perth', auckland: 'Pacific/Auckland',
  cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg', utc: 'UTC', gmt: 'UTC',
}
function fmtInZone(date, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit',
    }).format(date)
  } catch { return null }
}

// ─── Comprehensive date/time math ────────────────────────────────────────────
export function tryDateMath(expr) {
  const lower = expr.toLowerCase().trim()
  const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  // Longest alternatives first so e.g. "mins" matches before "min", "mo" before "m".
  // Shorthand: s(ec) min/m(in) h(r) d w mo/m(onth) y(r). Bare `m` = month, `min`=minutes.
  const UNITS = 'seconds|second|secs|sec|minutes|minute|mins|min|hours|hour|hrs|hr|days|day|weeks|week|months|month|mo|years|year|yrs|yr|s|h|d|w|m|y'

  // Canonical unit → used by applyDur / isTimeUnit. null = unrecognized.
  function normUnit(u) {
    u = u.toLowerCase()
    if (u === 's' || u === 'sec' || u === 'secs' || u.startsWith('second')) return 'second'
    if (u === 'min' || u === 'mins' || u.startsWith('minute')) return 'minute'
    if (u === 'h' || u === 'hr' || u === 'hrs' || u.startsWith('hour')) return 'hour'
    if (u === 'd' || u.startsWith('day')) return 'day'
    if (u === 'w' || u.startsWith('week')) return 'week'
    if (u === 'mo' || u === 'm' || u.startsWith('month')) return 'month'
    if (u === 'y' || u === 'yr' || u === 'yrs' || u.startsWith('year')) return 'year'
    return null
  }

  function parseBase(s) {
    s = s.trim()
    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    if (s === 'today') return new Date(today)
    if (s === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return d }
    if (s === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d }
    if (s === 'now') return new Date(now)
    // next/last/this [weekday]
    const nextDayM = s.match(/^(?:next|this)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
    if (nextDayM) {
      const target = DAY_NAMES.indexOf(nextDayM[1])
      const d = new Date(today); let diff = target - d.getDay(); if (diff <= 0) diff += 7
      d.setDate(d.getDate() + diff); return d
    }
    const lastDayM = s.match(/^last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/)
    if (lastDayM) {
      const target = DAY_NAMES.indexOf(lastDayM[1])
      const d = new Date(today); let diff = d.getDay() - target; if (diff <= 0) diff += 7
      d.setDate(d.getDate() - diff); return d
    }
    // next/last week/month/year
    if (s === 'next week') { const d = new Date(today); d.setDate(d.getDate() + 7); return d }
    if (s === 'last week') { const d = new Date(today); d.setDate(d.getDate() - 7); return d }
    if (s === 'next month') { const d = new Date(today); d.setMonth(d.getMonth() + 1); return d }
    if (s === 'last month') { const d = new Date(today); d.setMonth(d.getMonth() - 1); return d }
    if (s === 'next year') { const d = new Date(today); d.setFullYear(d.getFullYear() + 1); return d }
    if (s === 'last year') { const d = new Date(today); d.setFullYear(d.getFullYear() - 1); return d }
    // time: "9am", "9:30am", "14:30"
    const timeM = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
    if (timeM) {
      const d = new Date(now); let h = parseInt(timeM[1], 10); const m = parseInt(timeM[2] || '0', 10)
      if (timeM[3] === 'pm' && h !== 12) h += 12; if (timeM[3] === 'am' && h === 12) h = 0
      d.setHours(h, m, 0, 0); return d
    }
    const time24M = s.match(/^(\d{1,2}):(\d{2})$/)
    if (time24M) { const d = new Date(now); d.setHours(parseInt(time24M[1], 10), parseInt(time24M[2], 10), 0, 0); return d }
    // "<weekday> after next" → the weekday two weeks out from today's week
    const afterNextM = s.match(/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+after\s+next$/)
    if (afterNextM) {
      const target = DAY_NAMES.indexOf(afterNextM[1])
      const d = new Date(today); let diff = target - d.getDay(); if (diff <= 0) diff += 7
      d.setDate(d.getDate() + diff + 7); return d
    }
    // "MM/DD" (current year, no year given)
    const mdM = s.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (mdM) {
      const d = new Date(today); d.setMonth(parseInt(mdM[1], 10) - 1, parseInt(mdM[2], 10)); return d
    }
    // ISO "YYYY-MM-DD" → parse as local (avoid UTC shift from new Date)
    const isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (isoM) return new Date(parseInt(isoM[1], 10), parseInt(isoM[2], 10) - 1, parseInt(isoM[3], 10))
    // Try JS date parsing
    const parsed = new Date(s)
    if (!isNaN(parsed.getTime())) return parsed
    return null
  }

  function applyDur(d, sign, n, unit) {
    const r = new Date(d)
    const u = normUnit(unit)
    if (u === 'second') r.setSeconds(r.getSeconds() + sign * n)
    else if (u === 'minute') r.setMinutes(r.getMinutes() + sign * n)
    else if (u === 'hour') r.setHours(r.getHours() + sign * n)
    else if (u === 'day') r.setDate(r.getDate() + sign * n)
    else if (u === 'week') r.setDate(r.getDate() + sign * n * 7)
    else if (u === 'month') r.setMonth(r.getMonth() + sign * n)
    else if (u === 'year') r.setFullYear(r.getFullYear() + sign * n)
    return r
  }

  function isTimeUnit(u) { const c = normUnit(u); return c === 'second' || c === 'minute' || c === 'hour' }

  function fmtDate(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
  function fmtTime(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' @ ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
  function fmt(d, wasTime) { return wasTime ? fmtTime(d) : fmtDate(d) }

  // ── Timezone queries (before generic patterns; fully offline via Intl) ──
  // "time in tokyo" / "now in london" / "what time is it in nyc"
  const tzNowM = lower.match(/^(?:what\s+time\s+(?:is\s+it\s+)?in|time\s+in|now\s+in)\s+(.+?)\s*\??$/)
  if (tzNowM) {
    const tz = CITY_TZ[tzNowM[1].trim()]
    if (tz) { const r = fmtInZone(new Date(), tz); if (r) return r }
  }
  // "9am in tokyo" / "14:30 in london" — local time expressed in another zone
  const tzAtM = lower.match(/^(.+?)\s+in\s+([a-z ]+?)\s*\??$/)
  if (tzAtM) {
    const tz = CITY_TZ[tzAtM[2].trim()]
    if (tz) {
      const base = parseBase(tzAtM[1].trim())
      if (base && !isNaN(base.getTime())) { const r = fmtInZone(base, tz); if (r) return r }
    }
  }

  // Phrase matchers first: they embed a date that V8's lenient `new Date`
  // would otherwise extract in the standalone base check below.

  // "days/weeks/months until [date]"
  const untilM = lower.match(/^(?:how many )?(days|hours|weeks|months) until (.+)$/)
  if (untilM) {
    const d = parseBase(untilM[2])
    if (d && !isNaN(d.getTime())) {
      const ms = d.getTime() - Date.now()
      if (untilM[1] === 'days') { const n = Math.ceil(ms / 86400000); return `${n} day${Math.abs(n) !== 1 ? 's' : ''}` }
      if (untilM[1] === 'hours') { const n = Math.ceil(ms / 3600000); return `${n} hour${Math.abs(n) !== 1 ? 's' : ''}` }
      if (untilM[1] === 'weeks') { const n = Math.ceil(ms / 604800000); return `${n} week${Math.abs(n) !== 1 ? 's' : ''}` }
      if (untilM[1] === 'months') { const n = Math.round(ms / 2629800000); return `${n} month${Math.abs(n) !== 1 ? 's' : ''}` }
    }
  }

  // "days/weeks/months since [date]"
  const sinceM = lower.match(/^(?:how many )?(days|hours|weeks|months) since (.+)$/)
  if (sinceM) {
    const d = parseBase(sinceM[2])
    if (d && !isNaN(d.getTime())) {
      const ms = Date.now() - d.getTime()
      if (sinceM[1] === 'days') { const n = Math.floor(ms / 86400000); return `${n} day${n !== 1 ? 's' : ''}` }
      if (sinceM[1] === 'hours') { const n = Math.floor(ms / 3600000); return `${n} hour${n !== 1 ? 's' : ''}` }
      if (sinceM[1] === 'weeks') { const n = Math.floor(ms / 604800000); return `${n} week${n !== 1 ? 's' : ''}` }
      if (sinceM[1] === 'months') { const n = Math.floor(ms / 2629800000); return `${n} month${n !== 1 ? 's' : ''}` }
    }
  }

  // Standalone: "today", "tomorrow", "yesterday", "next monday", etc.
  // (Gate to known keywords — the lenient parseBase would swallow arithmetic.)
  if (/^(?:today|tomorrow|yesterday|now|(?:next|last|this)\s|\w+day\s+after\s+next$|\d{1,2}(?::\d{2})?\s*(?:am|pm)$|\d{1,2}:\d{2}$|\d{1,2}\/\d{1,2}$|\d{4}-\d{1,2}-\d{1,2}$)/.test(lower)) {
    const base = parseBase(lower)
    if (base) return fmtDate(base)
  } else if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(lower) && /\d/.test(lower) && !/[+*/^%=]/.test(lower)) {
    // Month-name dates only ("Jul 4 2026") — V8's lenient Date parser would
    // otherwise swallow arbitrary prose/arithmetic as a date.
    const base = parseBase(lower)
    if (base) return fmtDate(base)
  }

  // "base +/- N units"
  const durRe = new RegExp(`^(.+?)\\s*([+-])\\s*(\\d+)\\s*(${UNITS})$`)
  const durM = lower.match(durRe)
  if (durM) {
    const b = parseBase(durM[1].trim())
    if (b) {
      const sign = durM[2] === '+' ? 1 : -1
      const n = parseInt(durM[3], 10), u = durM[4]
      return fmt(applyDur(b, sign, n, u), isTimeUnit(u))
    }
  }

  // "dateA - dateB" → duration in days (when RHS isn't a bare N-units duration).
  // durRe above already handled "base +/- N units"; this catches two real dates.
  const diffM = lower.match(/^(.+?)\s+-\s+(.+)$/)
  // Skip when either side is a bare number — that's arithmetic ("2020 - 2000"), not dates.
  if (diffM && !durM && !/^\d+$/.test(diffM[1].trim()) && !/^\d+$/.test(diffM[2].trim())) {
    const a = parseBase(diffM[1].trim()), b = parseBase(diffM[2].trim())
    if (a && b) {
      const n = Math.round((a.getTime() - b.getTime()) / 86400000)
      return `${n} day${Math.abs(n) !== 1 ? 's' : ''}`
    }
  }

  // "N units ago"
  const agoM = lower.match(new RegExp(`^(\\d+)\\s*(${UNITS})\\s+ago$`))
  if (agoM) {
    const r = applyDur(new Date(), -1, parseInt(agoM[1], 10), agoM[2])
    return fmt(r, isTimeUnit(agoM[2]))
  }
  // "in N units"
  const inM = lower.match(new RegExp(`^in\\s+(\\d+)\\s*(${UNITS})$`))
  if (inM) {
    const r = applyDur(new Date(), 1, parseInt(inM[1], 10), inM[2])
    return fmt(r, isTimeUnit(inM[2]))
  }

  return null
}

// ─── Aggregate keywords (prev / sum / total / average) ──────────────────────
const AGG_RE = /\b(prev|sum|total|average|avg|mean)\b(?!\s*\()/gi
function substAggregates(expr, agg) {
  let used = false
  if (!agg) return { out: expr, used }
  const out = expr.replace(AGG_RE, w => {
    const lw = w.toLowerCase()
    let v = null
    if (lw === 'prev') v = agg.prev
    else if (lw === 'sum' || lw === 'total') v = agg.sum
    else v = agg.avg
    if (v == null) return w
    used = true
    return v
  })
  return { out, used }
}

// extraCompletionSources: completion sources from OTHER widgets (e.g. the
// slash-command menu) — merged into this plugin's single autocompletion()
// instance. See the comment at varAutocompletion.
export function makeMathCalcPlugin(cm, extraCompletionSources = []) {
  const { ViewPlugin, Decoration, WidgetType, EditorView } = cm.view

  // Right-column result chip (numi-style). Click copies the value.
  class MathResultWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-math-result'
      span.textContent = this.text
      span.setAttribute('aria-hidden', 'true')
      span.onmousedown = e => {
        e.preventDefault(); e.stopPropagation()
        try { navigator.clipboard?.writeText(this.text) } catch { /* ignore */ }
        span.classList.add('cm-math-result-copied')
        setTimeout(() => span.classList.remove('cm-math-result-copied'), 500)
      }
      return span
    }
    eq(o) { return o instanceof MathResultWidget && o.text === this.text }
    ignoreEvent() { return true }
  }

  let mathLib = null
  let algLib = null
  getMathjs().then(m => {
    if (m) {
      try {
        m.import({
          FV: function(rate, nper, pmt, pv) {
            pv = pv || 0
            return pv * Math.pow(1 + rate, nper) + pmt * (Math.pow(1 + rate, nper) - 1) / rate
          },
          PV: function(rate, nper, pmt, fv) {
            fv = fv || 0
            return (pmt * (1 - Math.pow(1 + rate, -nper)) / rate) + fv * Math.pow(1 + rate, -nper)
          },
          PMT: function(rate, nper, pv, fv) {
            fv = fv || 0
            return (pv * rate * Math.pow(1 + rate, nper) + fv * rate) / (Math.pow(1 + rate, nper) - 1)
          },
          NPV: function(rate, ...cashflows) {
            return cashflows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + rate, t + 1), 0)
          },
        }, { override: false })
      } catch { /* ignore */ }
      setupMathUnits(m)
    }
    mathLib = m
  })
  getAlgebrite().then(a => { algLib = a })

  // Patterns that should go directly to Algebrite (symbolic CAS)
  const CAS_RE = /\b(integral|integrate|roots|solve|factor|expand|taylor|defint|laplace)\b/i

  // ─── Expression evaluation ─────────────────────────────────────────────────
  // Returns { str, raw } — str is the plain display/insert string (parseable),
  // raw is the mathjs value (number or Unit) when available, for aggregates.
  function stringifyMathResult(result) {
    if (typeof result === 'number') return String(Number(result.toPrecision(12)))
    return String(typeof result === 'object' && result.toString ? result.toString() : result)
  }

  // Small memo cache — buildDocScope re-evaluates every zone line per keystroke.
  let _evalCache = new Map()
  let _evalCacheTime = Date.now()
  function evalExprFull(expr, scope = {}) {
    const now = Date.now()
    if (now - _evalCacheTime > 30000 || _evalCache.size > 400) { _evalCache = new Map(); _evalCacheTime = now }
    const key = expr + '\u0000' + Object.keys(scope).map(k => k + ':' + String(scope[k])).join(',')
    if (_evalCache.has(key)) return _evalCache.get(key)
    const r = _evalExprFull(expr, scope)
    _evalCache.set(key, r)
    return r
  }

  function _evalExprFull(expr, scope) {
    // Strip thousands-separator commas (e.g. 1,000 → 1000, 1,000,000 → 1000000)
    expr = expr.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, m => m.replace(/,/g, ''))
    // Currency symbols → unit names ($100 → 100 USD)
    expr = currencySymbolsToUnits(expr)

    // Try date math first
    const dateResult = tryDateMath(expr)
    if (dateResult !== null) return { str: dateResult, raw: null }

    // "A as (a) % of B" → percentage (before percentPreprocess mangles "of")
    const asPctM = expr.match(/^(.+?)\s+as\s+(?:a\s+)?(?:%|percent(?:age)?)\s+of\s+(.+)$/i)
    if (asPctM && mathLib) {
      try {
        const a = mathLib.evaluate(percentPreprocess(asPctM[1]), { ...scope })
        const b = mathLib.evaluate(percentPreprocess(asPctM[2]), { ...scope })
        if (typeof a === 'number' && typeof b === 'number' && b !== 0) {
          const pct = Number((a / b * 100).toPrecision(12))
          return { str: `${pct}%`, raw: pct }
        }
      } catch { /* fall through */ }
    }

    // Route CAS-like expressions to Algebrite first
    if (algLib && CAS_RE.test(expr)) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil') return { str: r, raw: null }
      } catch { /* fall through to mathjs */ }
    }

    const attempts = []
    const pExpr = percentPreprocess(expr)
    attempts.push(pExpr)
    const magExpr = percentPreprocess(expandMagnitudes(expr))
    if (magExpr !== pExpr) attempts.push(magExpr)
    const natExpr = percentPreprocess(naturalLangToExpr(expandMagnitudes(expr)))
    if (natExpr !== pExpr && natExpr !== magExpr) attempts.push(natExpr)

    if (mathLib) {
      for (const att of attempts) {
        try {
          const result = mathLib.evaluate(att, { ...scope })
          if (result === undefined || result === null || typeof result === 'function') continue
          const raw = (typeof result === 'number' || (result && result.constructor && result.constructor.name === 'Unit')) ? result : null
          return { str: stringifyMathResult(result), raw }
        } catch { /* next attempt */ }
      }
    }
    // Algebrite fallback for anything math.js couldn't handle. Guarded so prose
    // lines don't echo back as "results" — needs math operators, and the output
    // must differ from the input.
    if (algLib && /[+\-*/^()]/.test(expr)) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil' && String(r).trim() !== expr.trim() && !/Stop:/.test(r)) {
          return { str: String(r), raw: null }
        }
      } catch { /* give up */ }
    }
    return null
  }

  function evalExpr(expr, scope = {}) {
    const r = evalExprFull(expr, scope)
    return r ? r.str : null
  }

  // ─── Variable name registry ───────────────────────────────────────────────
  // Stable mapping from lowercase display name → internal math.js-safe token.
  // Each editor instance gets its own registry via closure.
  const _nameToToken = new Map()
  let _tokenCtr = 0
  function getVarToken(name) {
    const key = name.toLowerCase()
    if (!_nameToToken.has(key)) _nameToToken.set(key, `_mv${_tokenCtr++}`)
    return _nameToToken.get(key)
  }

  // ─── Math zones ───────────────────────────────────────────────────────────
  // The calculator is opt-in: it only runs on lines after a `/math` line,
  // until a `/math end` (or `/endmath`) line or the end of the document.
  function computeMathZones(state) {
    const zones = []
    let open = null
    for (let ln = 1; ln <= state.doc.lines; ln++) {
      const t = state.doc.line(ln).text.trim()
      if (open === null) {
        if (/^\/math$/i.test(t)) open = ln
      } else if (/^(?:\/math\s+end|\/endmath)$/i.test(t)) {
        zones.push({ from: open + 1, to: ln - 1 })
        open = null
      }
    }
    if (open !== null) zones.push({ from: open + 1, to: state.doc.lines })
    return zones
  }
  function inMathZone(zones, ln) {
    return zones.some(z => ln >= z.from && ln <= z.to)
  }

  // ─── Variable substitution ────────────────────────────────────────────────
  // Replaces multi-word variable names (and "per X" sugar) with internal tokens.
  function applyVarSubstitution(expr, varDefs) {
    let result = expr
    // "0.25 per mile" → "0.25 * _mv1"
    result = result.replace(/\bper\s+([a-zA-Z][a-zA-Z0-9 ]*)/g, (_, unit) => {
      const match = varDefs.find(v => v.name.toLowerCase() === unit.trim().toLowerCase() && v.value !== null)
      return match ? `* ${match.token}` : `/ ${unit.trim()}`
    })
    // Replace variable names longest-first to avoid partial matches
    const sorted = [...varDefs].sort((a, b) => b.name.length - a.name.length)
    for (const { name, token } of sorted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      result = result.replace(new RegExp(`(?<![_a-zA-Z0-9])${escaped}(?![_a-zA-Z0-9])`, 'gi'), token)
    }
    return result
  }

  // Strips a trailing "=", "=:.N" (rounding precision), or an already-typed
  // "= 42" off the end of a line so the remainder can be evaluated. No-op
  // (returns the text unchanged) when there's no trailing "=" at all.
  function stripTrailingEquals(text) {
    const m = text.match(/^(.*?)\s*=(?::\.(\d+))?\s*(?:-?[\d.,]+)?\s*$/)
    if (!m) return { text, precision: null }
    return { text: m[1], precision: m[2] != null ? parseInt(m[2], 10) : null }
  }

  // Rounds the leading numeric part of a result string to `precision` decimals,
  // preserving any trailing unit/currency suffix ("5.126 km" → "5.13 km").
  function applyPrecisionToDisplay(str, precision) {
    if (precision == null || str == null) return str
    const m = String(str).match(/^(-?\d+(?:\.\d+)?)(.*)$/)
    if (!m) return str
    const n = parseFloat(m[1])
    return isNaN(n) ? str : n.toFixed(precision) + m[2]
  }

  // ─── Document scope + per-line results (single top-to-bottom pass) ────────
  // Scans math-zone lines in order, registering "Name: expression" variable
  // defs and evaluating every line for the right-column result. Also tracks
  // the running values that power prev / sum / total / average.
  function buildDocScope(state) {
    const varDefs = []      // [{ name, token, value, lineFrom, lineEnd, nameFrom, nameEnd, colonFrom, rhsFrom }]
    const scope = {}
    const zones = computeMathZones(state)
    const lineResults = new Map()   // ln → formatted display string
    const lineAggs = new Map()      // ln → { prev, sum, avg } substitution strings (context BEFORE the line)
    if (!zones.length) return { varDefs, scope, zones, lineResults, lineAggs }

    // Aggregate substitution strings from run entries [{ raw, val }]
    function aggStr(entries, mode) {
      const usable = entries.filter(e => e.raw != null || (e.val != null && isFinite(e.val)))
      if (!usable.length) return null
      if (mathLib && usable.every(e => e.raw != null)) {
        try {
          let acc = usable[0].raw
          for (let i = 1; i < usable.length; i++) acc = mathLib.add(acc, usable[i].raw)
          if (mode === 'avg') acc = mathLib.divide(acc, usable.length)
          return `(${typeof acc === 'number' ? Number(acc.toPrecision(12)) : acc.toString()})`
        } catch { /* mixed types — numeric fallback */ }
      }
      const nums = usable.map(e => e.val).filter(v => v != null && isFinite(v))
      if (!nums.length) return null
      let s = nums.reduce((a, b) => a + b, 0)
      if (mode === 'avg') s = s / nums.length
      return `(${Number(s.toPrecision(12))})`
    }

    for (const zone of zones) {
      let run = []           // contiguous result entries (reset on blank line / heading)
      let prevEntry = null   // last result entry (survives blank lines)

      for (let ln = zone.from; ln <= zone.to && ln <= state.doc.lines; ln++) {
        const line = state.doc.line(ln)
        const t = line.text.trim()
        if (!t) { run = []; continue }                                 // blank resets sum run
        if (/^#{1,6}\s/.test(t) || /^>|^```/.test(t)) { run = []; continue }  // heading/quote/fence resets

        const prevStr = prevEntry
          ? `(${prevEntry.raw != null && typeof prevEntry.raw === 'object' ? prevEntry.raw.toString() : (prevEntry.raw != null ? Number(prevEntry.raw.toPrecision ? prevEntry.raw.toPrecision(12) : prevEntry.raw) : prevEntry.val)})`
          : null
        const agg = { prev: prevStr, sum: aggStr(run, 'sum'), avg: aggStr(run, 'avg') }
        lineAggs.set(ln, agg)

        // ── Variable definition line? ──
        const m = line.text.match(/^(.+?):\s*(.+)$/)
        let handled = false
        if (m) {
          const name = m[1].trim()
          let valStr = m[2].trim()
          // Same gates as before: skip markdown artifacts / URLs / long names
          const nameOk = name && !/^[-*#>|`\\]/.test(name) && !/[:/\\]/.test(name) &&
            /^[a-zA-Z]/.test(name) && name.length <= 50
          if (nameOk) {
            const hasDigit = /\d/.test(valStr)
            const refsKnownVar = varDefs.some(v => {
              const esc = v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              return new RegExp(`(?<![_a-zA-Z0-9])${esc}(?![_a-zA-Z0-9])`, 'i').test(valStr)
            })
            AGG_RE.lastIndex = 0
            const hasAgg = AGG_RE.test(valStr)
            if (hasDigit || refsKnownVar || hasAgg) {
              // Strip a trailing "=", "=:.N" (rounding precision), or an
              // already-typed "= 42" so the RHS evaluates cleanly.
              const { text: evalStr, precision } = stripTrailingEquals(valStr)
              let substituted = applyVarSubstitution(evalStr, varDefs)
              substituted = substAggregates(substituted, agg).out
              let value = null, rawVal = null, display = null
              const r = evalExprFull(substituted, scope)
              if (r && r.str != null) {
                const n = typeof r.raw === 'number' ? r.raw : parseFloat(r.str)
                if (isFinite(n)) value = n
                rawVal = r.raw
                display = applyPrecisionToDisplay(r.str, precision)
              }
              const token = getVarToken(name)
              const nameFrom = line.from + m[1].search(/\S/)
              const nameEnd = nameFrom + name.length
              const colonFrom = line.from + m[1].length
              const rhsFrom = line.from + m[0].length - m[2].length
              varDefs.push({ name, token, value, lineFrom: line.from, lineEnd: line.to, nameFrom, nameEnd, colonFrom, rhsFrom })
              if (value !== null) scope[token] = (rawVal != null && typeof rawVal === 'object') ? rawVal : value
              if (display != null) {
                lineResults.set(ln, formatDisplay(display))
                const entry = { raw: rawVal, val: value }
                if (entry.raw != null || (entry.val != null && isFinite(entry.val))) { run.push(entry); prevEntry = entry }
              }
              handled = true
            }
          }
        }
        if (handled) continue

        // ── Expression line ──
        let raw = t.replace(/^(?:[-*+]|\d+\.)\s+/, '').replace(/\*{2,}|[_~`]+/g, '')
        // "Label: expr" that didn't qualify as a def still evaluates its RHS.
        // Excludes "=" from the label run so "expr =:.2" (precision syntax)
        // never gets misread as "Label: expr" with the colon from ":.2".
        const colonM = raw.match(/^[^:=]+:\s*(.+)$/)
        if (colonM && !/https?:/i.test(raw)) raw = colonM[1].trim()
        // Strip trailing "=", "=:.N" (rounding precision), or an already-typed "= 42"
        const { text: strippedRaw, precision } = stripTrailingEquals(raw)
        raw = strippedRaw
        if (!raw) continue

        let expr = applyVarSubstitution(raw, varDefs)
        const { out, used: usedAgg } = substAggregates(expr, agg)
        expr = out
        const hasVar = varDefs.some(v => v.value !== null && expr.includes(v.token))
        const hasDigit = /\d/.test(expr)
        const isDateish = /\b(today|tomorrow|yesterday|now|time\s+in|what\s+time|next\s|last\s|ago\b|until\s|since\s)|^in\s/i.test(raw)
        _NUM_RUN_RE.lastIndex = 0
        const hasNumWord = _NUM_RUN_RE.test(raw)
        if (!hasDigit && !hasVar && !usedAgg && !isDateish && !hasNumWord) continue

        const rEval = evalExprFull(expr, scope)
        if (!rEval || rEval.str == null) continue
        const r = { ...rEval, str: applyPrecisionToDisplay(rEval.str, precision) }
        // Track the value for aggregates even when we skip the echo chip below
        const val = typeof r.raw === 'number' ? r.raw : parseFloat(r.str)
        const entry = { raw: r.raw, val: isFinite(val) ? val : null }
        if (entry.raw != null || entry.val != null) { run.push(entry); prevEntry = entry }
        // Skip echo results (line "42" → "42") — chip adds nothing
        if (rEval.str.trim() === raw.trim()) continue
        lineResults.set(ln, formatDisplay(r.str))
      }
    }
    return { varDefs, scope, zones, lineResults, lineAggs }
  }

  // ─── Scope state field ───────────────────────────────────────────────────
  // Caches the document scope; rebuilt only on doc changes, not cursor moves.
  const docScopeField = cm.state.StateField.define({
    create: state => buildDocScope(state),
    update: (val, tr) => tr.docChanged ? buildDocScope(tr.state) : val,
  })

  // ─── Right-column results (numi-style) ────────────────────────────────────
  // Renders each math-zone line's result as bold colored text pinned to the
  // right edge. No inline ghost/Tab-insert — typing "=" (or "=:.N" for a
  // rounding precision override) is purely syntactic; the answer only ever
  // shows in this column, so the source line stays clean.
  const mathResultsPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = this._build(view) }
    update(upd) {
      if (upd.docChanged || upd.viewportChanged) this.deco = this._build(upd.view)
    }
    _build(view) {
      const { lineResults } = view.state.field(docScopeField)
      if (!lineResults || !lineResults.size) return Decoration.none
      const builder = new cm.state.RangeSetBuilder()
      for (const { from, to } of view.visibleRanges) {
        let pos = from
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos)
          const display = lineResults.get(line.number)
          if (display != null) {
            try { builder.add(line.to, line.to, Decoration.widget({ widget: new MathResultWidget(display), side: 1 })) } catch { /* ignore */ }
          }
          pos = line.to + 1
        }
      }
      return builder.finish()
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.deco })

  // Bold colored text — baseTheme so both NotebookView and QuickNoteView get it.
  const mathResultTheme = EditorView.baseTheme({
    '.cm-line': { position: 'relative' },
    '.cm-math-result': {
      position: 'absolute',
      right: '14px',
      top: '50%',
      transform: 'translateY(-50%)',
      fontSize: '0.92em',
      fontWeight: '700',
      fontVariantNumeric: 'tabular-nums',
      fontStyle: 'normal',
      lineHeight: '1.55',
      color: 'var(--accent, #79b8ff)',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      userSelect: 'none',
      zIndex: '1',
      transition: 'opacity 0.15s ease',
    },
    '.cm-math-result:hover': {
      opacity: '0.75',
    },
    '.cm-math-result.cm-math-result-copied': {
      opacity: '0.45',
    },
  })

  // ─── Variable definition decorator ───────────────────────────────────────
  // Colors: name (pastel orange), colon (dim orange), var refs everywhere (blue).
  const varDecoPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none; this._rebuild(view) }
    update(upd) { if (upd.docChanged) this._rebuild(upd.view) }
    _rebuild(view) {
      const { varDefs, zones } = view.state.field(docScopeField)
      if (!varDefs.length) { this.deco = Decoration.none; return }
      const liveVars = varDefs.filter(v => v.value !== null).sort((a, b) => b.name.length - a.name.length)

      // Track which lines are definition lines so we skip them in the ref scan below
      const defLineFroms = new Set(varDefs.map(v => v.lineFrom))

      // Helper: scan a text segment for variable name references, push into ranges[]
      function addRefs(ranges, basePos, text) {
        if (!liveVars.length) return
        const covered = []
        for (const { name } of liveVars) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const re = new RegExp(`(?<![_a-zA-Z0-9])${escaped}(?![_a-zA-Z0-9])`, 'gi')
          let hit
          while ((hit = re.exec(text)) !== null) {
            const from = basePos + hit.index
            const to = from + name.length
            if (covered.some(r => from < r.to && to > r.from)) continue
            covered.push({ from, to })
            ranges.push({ from, to, cls: 'cm-math-ref' })
          }
        }
      }

      // Collect all ranges then sort — RangeSetBuilder requires ascending order
      const ranges = []

      // 1. Definition lines: name, colon, RHS references
      for (const { nameFrom, nameEnd, colonFrom, rhsFrom, lineEnd, value } of varDefs) {
        ranges.push({ from: nameFrom, to: nameEnd, cls: value !== null ? 'cm-math-var cm-math-var-live' : 'cm-math-var' })
        ranges.push({ from: colonFrom, to: colonFrom + 1, cls: 'cm-math-colon' })
        if (rhsFrom < lineEnd)
          addRefs(ranges, rhsFrom, view.state.doc.sliceString(rhsFrom, lineEnd))
      }

      // 2. Non-definition lines: highlight any variable references on lines that
      //    look like expressions (contain = or math operators)
      for (let ln = 1; ln <= view.state.doc.lines; ln++) {
        if (!inMathZone(zones, ln)) continue
        const line = view.state.doc.line(ln)
        if (defLineFroms.has(line.from)) continue  // already handled
        const text = line.text
        if (!text.includes('=') && !/[+\-*/^%]/.test(text)) continue
        addRefs(ranges, line.from, text)
      }

      ranges.sort((a, b) => a.from - b.from || a.to - b.to)
      const builder = new cm.state.RangeSetBuilder()
      for (const { from, to, cls } of ranges) builder.add(from, to, Decoration.mark({ class: cls }))
      this.deco = builder.finish()
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.deco })

  // ─── Variable autocomplete ────────────────────────────────────────────────
  // Triggers on lines containing ":" or "=" and offers defined variable names.
  function varCompleteSource(context) {
    const line = context.state.doc.lineAt(context.pos)
    const lineText = line.text
    // Only activate on expression/definition lines
    if (!lineText.includes(':') && !lineText.includes('=')) return null
    const { varDefs, zones } = context.state.field(docScopeField, false) || buildDocScope(context.state)
    if (!inMathZone(zones, line.number)) return null
    const liveVars = varDefs.filter(v => v.value !== null)
    if (!liveVars.length) return null
    const word = context.matchBefore(/[a-zA-Z][a-zA-Z0-9 ]{1,40}/)
    if (!word || (word.from === word.to && !context.explicit)) return null
    const typed = word.text.toLowerCase().trimEnd()
    if (typed.length < 2) return null
    const options = liveVars
      .filter(v => v.name.toLowerCase().startsWith(typed) && v.name.toLowerCase() !== typed)
      .map(v => ({ label: v.name, detail: `= ${v.value}`, type: 'variable', apply: v.name }))
    if (!options.length) return null
    return { from: word.from, options, validFor: /^[a-zA-Z][a-zA-Z0-9 ]*$/ }
  }

  // ONE autocompletion() per editor — CM6 throws "Config merge conflict for
  // field override" (→ historically a blank notebook) if two extensions each
  // call autocompletion() with their own `override`. Widgets therefore
  // contribute completion SOURCES here via `extraCompletionSources` instead of
  // creating their own instance. Sources run in order; return null to pass.
  const varAutocompletion = cm.autocomplete.autocompletion({
    override: [...extraCompletionSources, varCompleteSource],
    icons: false,
    closeOnBlur: true,
    activateOnTyping: true,
    selectOnOpen: true,
  })

  // ─── Update animation ────────────────────────────────────────────────────
  // Tracks which line numbers currently have a live-update animation playing.
  const varUpdateEffect = cm.state.StateEffect.define()
  const varUpdateField = cm.state.StateField.define({
    create: () => new Set(),
    update: (val, tr) => {
      for (const e of tr.effects) if (e.is(varUpdateEffect)) return new Set(e.value)
      return val
    },
  })

  // Decorates updated result numbers with the shimmer animation class.
  const varResultDecoPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none }
    update(upd) {
      const updatedLines = upd.state.field(varUpdateField)
      if (!updatedLines.size) { this.deco = Decoration.none; return }
      const builder = new cm.state.RangeSetBuilder()
      const sorted = [...updatedLines].sort((a, b) => a - b)
      for (const ln of sorted) {
        if (ln > upd.state.doc.lines) continue
        const line = upd.state.doc.line(ln)
        const m = line.text.match(/^(.*?\S)(\s*=\s*)(-?\d+(?:\.\d+)?)/)
        if (!m) continue
        const numFrom = line.from + m[1].length + m[2].length
        builder.add(numFrom, numFrom + m[3].length, Decoration.mark({ class: 'cm-math-live-updated' }))
      }
      this.deco = builder.finish()
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.deco })

  // ─── Live result updater ─────────────────────────────────────────────────
  // When a variable value changes, auto-updates any Tab-accepted results in the doc.
  const liveResultAnnotation = cm.state.Annotation.define()

  const liveResultPlugin = ViewPlugin.fromClass(class {
    constructor() { this._clearTimer = null }
    update(upd) {
      if (!upd.docChanged) return
      if (upd.transactions.some(tr => tr.annotation(liveResultAnnotation))) return
      if (!mathLib) return
      const { varDefs, scope, zones } = upd.state.field(docScopeField)
      if (!varDefs.length) return
      const curLine = upd.state.doc.lineAt(upd.state.selection.main.head).number
      const changes = []
      const updatedLineNums = []
      for (let ln = 1; ln <= upd.state.doc.lines; ln++) {
        if (ln === curLine) continue  // skip line being typed on
        if (!inMathZone(zones, ln)) continue
        const line = upd.state.doc.line(ln)
        // Match lines ending with "= <number>" — a previously accepted ghost result
        const m = line.text.match(/^(.*?\S)(\s*=\s*)(-?\d+(?:\.\d+)?)(\s*)$/)
        if (!m) continue
        let rawExpr = m[1].trim()
        const colonM = rawExpr.match(/^[^:]+:\s*(.+)$/)
        if (colonM) rawExpr = colonM[1].trim()
        rawExpr = rawExpr.replace(/^(?:[-*+]|\d+\.)\s+/, '').replace(/\*{2,}|[_~`]+/g, '')
        const expr = applyVarSubstitution(rawExpr, varDefs)
        if (!varDefs.some(v => v.value !== null && expr.includes(v.token))) continue
        const result = evalExpr(expr, scope)
        if (!result) continue
        const newNum = parseFloat(result)
        const storedNum = parseFloat(m[3])
        if (isNaN(newNum) || isNaN(storedNum) || Math.abs(newNum - storedNum) < 1e-10) continue
        const numFrom = line.from + m[1].length + m[2].length
        changes.push({ from: numFrom, to: numFrom + m[3].length, insert: result })
        updatedLineNums.push(ln)
      }
      if (!changes.length) return
      const view = upd.view
      // Defer dispatch to avoid mutating state inside an update cycle
      setTimeout(() => {
        try {
          view.dispatch({
            changes,
            annotations: liveResultAnnotation.of(true),
            effects: [varUpdateEffect.of(new Set(updatedLineNums))],
          })
          // Guard: cancel any pending clear so rapid updates don't retrigger the animation
          clearTimeout(this._clearTimer)
          this._clearTimer = setTimeout(() => {
            try { view.dispatch({ effects: [varUpdateEffect.of(new Set())] }) } catch {}
          }, 1800)  // matches animation duration + buffer
        } catch { /* view destroyed */ }
      }, 0)
    }
  })

  // ─── Prose number decorator ───────────────────────────────────────────────
  // Applies uniform tabular-nums + slightly heavier weight to all digit sequences
  // in editor text (the highlight style only fires inside code contexts).
  const _numRE = /(?<![_a-zA-Z#])\d+(?:[.,]\d+)*/g
  const _numMark = Decoration.mark({ class: 'cm-nb-num' })
  const numberDecoPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = this._build(view) }
    update(upd) { if (upd.docChanged || upd.viewportChanged) this.deco = this._build(upd.view) }
    _build(view) {
      const builder = new cm.state.RangeSetBuilder()
      for (const { from, to } of view.visibleRanges) {
        let pos = from
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos)
          const end = Math.min(line.to, to)
          _numRE.lastIndex = 0
          const text = line.text.slice(pos - line.from, end - line.from)
          let m
          while ((m = _numRE.exec(text)) !== null) {
            const s = pos + m.index
            try { builder.add(s, s + m[0].length, _numMark) } catch {}
          }
          pos = line.to + 1
        }
      }
      return builder.finish()
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.deco })

  return [docScopeField, varUpdateField, mathResultsPlugin, mathResultTheme, varDecoPlugin, varResultDecoPlugin, numberDecoPlugin, liveResultPlugin, varAutocompletion]
}


// ═══════════════════════════════════════════════════════════════════════════
// Widget zoo — extracted from NotebookView.jsx (PLAN_CONCURRENCY.md §18.3,
// "Phase A — Extraction"). Everything below (through the end of this file)
// used to live inline in NotebookView.jsx: every rendering widget, the
// Live-mode decoration builder (`makeLivePlugin`), the interaction handlers,
// Source/Preview mode, and the view-mode toggle button. Moved here — not to a
// second location — so NotebookView.jsx and the web guest client
// (`src/lib/collab/CollabEditor.jsx`) can share one implementation with no
// drift possible by construction, per §18's stated goal ("full editor parity
// for the browser guest"). NotebookView.jsx now imports everything below
// instead of defining it locally.
//
// This extraction is code motion only — no widget behavior was changed.
// Every exported function/class below still takes the same params
// (`notebooks, library, sketchbooks, flashcardDecks, notebookDir` default to
// `[]`/`null` already, from before this move) so callers that don't have a
// vault to resolve against (a guest, eventually) can pass nothing and get a
// degraded-but-safe render — see each widget's own use of those params.
// Phases B–H (asset-map resolution, wikilink degrade, CM6 extension port,
// mode-toggle parity, lazy-load verification, a CRDT-safety re-audit, and
// `RelayedEditor` reconciliation) are separate, later work — not done here.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tauri convertFileSrc cache (loaded once, used synchronously in widgets) ───
export let _convertFileSrc = null
export let _invoke = null
export let _dialogOpen = null
;(async () => {
  try {
    const { convertFileSrc, invoke } = await import('@tauri-apps/api/core')
    _convertFileSrc = convertFileSrc
    _invoke = invoke
  } catch { /* non-Tauri env — ignore */ }
})()
;(async () => {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    _dialogOpen = open
  } catch { /* non-Tauri env — ignore */ }
})()

// ─── Tiny id helper ───────────────────────────────────────────────────────────
export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ─── Shared doc-string cache ──────────────────────────────────────────────────
// Several decoration builders need the full document as a string on every
// update; CM's Text is immutable, so cache the stringification per doc instance
// instead of re-serializing 4-5× per keystroke.
const _docStrCache = new WeakMap()
function docString(doc) {
  let s = _docStrCache.get(doc)
  if (s === undefined) { s = doc.toString(); _docStrCache.set(doc, s) }
  return s
}

// ─── KaTeX lazy loader (static rendering) ────────────────────────────────────
let _ktP = null
export function getKaTeX() {
  if (_ktP) return _ktP
  _ktP = (async () => {
    try {
      // Load KaTeX from the npm package (bundled, no CDN needed).
      // The stylesheet is imported as a normal side-effect import, NOT `?inline`:
      // KaTeX's CSS references its glyph fonts as relative `url(fonts/KaTeX_*)`,
      // and injecting the raw text into a <style> resolved those against the
      // document root instead of the stylesheet, so every font 404'd. A plain
      // import lets Vite rewrite the URLs and emit the font files.
      const [katex] = await Promise.all([
        import('katex'),
        import('katex/dist/katex.min.css'),
      ])
      return katex.default || katex
    } catch (e) {
      console.warn('[KaTeX] failed to load:', e)
      return null
    }
  })()
  return _ktP
}

// Render LaTeX into a DOM element using KaTeX (synchronous once loaded)
export function renderMathStatic(el, latex, displayMode) {
  getKaTeX().then(katex => {
    if (!katex) { el.textContent = latex; return }
    try {
      katex.render(latex, el, { displayMode, throwOnError: false, strict: false })
    } catch { el.textContent = latex }
  })
}

// ─── MathQuill lazy loader (edit popup only) ─────────────────────────────────
let _mqP = null
export function getMQ() {
  if (_mqP) return _mqP
  _mqP = (async () => {
    try {
      if (window.MathQuill) return window.MathQuill.getInterface(2)

      // Both were <script> tags from cdnjs, so math zones broke with no network.
      // Now bundled. MathQuill 0.10.1's build is a plain IIFE that reads
      // `window.jQuery` at execution time — it has no require()/exports — so the
      // global MUST be set before its module is imported, and importing it does
      // NOT pull in the stale jquery@1.12.4 that its package.json asks for.
      const [{ default: jQuery }] = await Promise.all([
        import('jquery'),
        import('mathquill/build/mathquill.css'),
      ])
      window.jQuery = window.$ = jQuery
      await import('mathquill/build/mathquill.js')

      return window.MathQuill?.getInterface(2) ?? null
    } catch (e) {
      console.warn('[MathQuill] failed to load:', e)
      return null
    }
  })()
  return _mqP
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ─── Inline markdown → HTML ───────────────────────────────────────────────────
// Notebook folder used to resolve relative image paths in the HTML renderers.
// Set by renderMarkdown; module-level so inlineToHtml doesn't need the arg
// threaded through every caller.
let _imgBaseDir = null
// Room asset maps (`{ assetsMap, assetsMetaMap }`) — the Preview-mode
// counterpart to ImgWidget's own `assets` fallback (PLAN_CONCURRENCY.md
// §18.4 "Phase B", now reused here for §18.7 "Phase E"). Same module-level-
// var-set-by-renderMarkdown pattern as `_imgBaseDir` right above, same
// reasoning: `blockToHtml` calls `inlineToHtml` internally, so threading a
// new arg through every intermediate caller would touch far more call sites
// than a shared module var does.
let _imgAssets = null
// Same "no vault to check against at all" signal as `makeLivePlugin`'s own
// `hasVault` (PLAN_CONCURRENCY.md §18.5/§18.7) — module-level for the exact
// same reason `_imgBaseDir` is: `inlineToHtml` is called recursively from
// deep inside `blockToHtml` (callouts, tables, …), and threading a new arg
// through every one of those call sites would touch far more than a shared
// var does. Default `true` — `NotebookView.jsx`'s own Preview mode never
// passes anything else, zero behavior change there.
let _hasVault = true

/** Builds one `<img>` tag (or an honest placeholder) for the Preview-mode
 *  HTML renderer — the exact same three states as `ImgWidget._resolveSrc`/
 *  `resolveAssetImg` (PLAN_CONCURRENCY.md §18.4), reused rather than
 *  reimplemented: a host with `_imgBaseDir` set resolves normally
 *  (`resolveImgSrc`, unchanged, zero behavior difference for
 *  `NotebookView.jsx`'s own Preview mode); a guest with no vault
 *  (`_imgBaseDir` null) and a room's published `_imgAssets` falls back to a
 *  blob URL, or a `.cm-img-asset-ph`-styled placeholder honest about
 *  "too large" vs. "not available yet" — same class name `ImgWidget` itself
 *  uses, so both look identical, not two different placeholder languages. */
function _imgTag(src, alt, title, style) {
  const titleAttr = title ? ` title="${esc(title)}"` : ''
  const styleAttr = style ? ` style="${style}"` : ''
  if (!_imgBaseDir && _imgAssets && !_isRemoteSrc(src)) {
    const resolved = resolveAssetImg(src, _imgAssets)
    if (resolved.status === 'ready') {
      return `<img src="${esc(resolved.url)}" alt="${esc(alt)}"${titleAttr}${styleAttr} class="nb-img" loading="lazy">`
    }
    const msg = resolved.status === 'oversized' ? 'too large to preview' : 'not available yet'
    return `<span class="cm-img-asset-ph">🖼 ${esc(alt || 'image')} — ${msg}</span>`
  }
  return `<img src="${esc(resolveImgSrc(src, _imgBaseDir))}" alt="${esc(alt)}"${titleAttr}${styleAttr} class="nb-img" loading="lazy">`
}

export function inlineToHtml(text, notebooks = [], library = [], sketchbooks = [], flashcardDecks = []) {
  const buckets = []
  const ph = html => { const k = `\x02${buckets.length}\x03`; buckets.push(html); return k }

  let s = esc(text)

  // Obsidian comments %%…%% — stripped from rendered output
  s = s.replace(/%%[\s\S]*?%%/g, '')

  // Images  ![alt](src)  — with an optional `=600x` width spec.
  // Dragging the resize handle writes that spec into the link. The live editor
  // has always parsed it, but this renderer did not, so its regex failed to
  // match the whole image and the markdown leaked through as literal text —
  // i.e. resizing an image "broke" it everywhere except the live view.
  s = s.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x)?(?:\s+"([^"]*)")?\)/g, (_, alt, src, w, title) => {
    const a = parseImgAlt(alt)              // `caption:center|600` → width + align
    const width = a.width || (w ? +w : 0)   // legacy `=600x` still honoured
    // Alignment must survive into preview/export too — it was live-only before.
    // No floats — the image owns its line, text never wraps beside it (matches
    // the live editor). Alignment is just which side of the line it sits on.
    const style = [
      'display:block',
      width ? `width:${width}px` : '',
      a.align === 'center' ? 'margin-left:auto;margin-right:auto' : '',
      a.align === 'right'  ? 'margin-left:auto;margin-right:0'    : '',
      a.align === 'left'   ? 'margin-left:0;margin-right:auto'    : '',
    ].filter(Boolean).join(';')
    return ph(_imgTag(src, a.alt, title, style))
  })

  // Links  [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_, txt, url, title) =>
    ph(`<a href="${esc(url)}" target="_blank" rel="noopener"${title ? ` title="${esc(title)}"` : ''}>${txt}</a>`))

  // Inline code  ``…`` then `…`
  s = s.replace(/``([^`]+)``/g, (_, c) => ph(`<code class="nb-ic">${esc(c)}</code>`))
  s = s.replace(/`([^`\n]+)`/g, (_, c) => ph(`<code class="nb-ic">${esc(c)}</code>`))

  // Math  $$…$$ inline  $…$
  s = s.replace(/\$\$(.+?)\$\$/g, (_, m) => ph(`<span class="nb-math nb-math-mq" data-latex="${esc(m)}" data-display="1"></span>`))
  s = s.replace(/\$([^$\n]+)\$/g, (_, m) => ph(`<span class="nb-math nb-math-mq" data-latex="${esc(m)}"></span>`))

  // Bold-italic ***…*** or ___…___
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="nb-bold"><em class="nb-italic">$1</em></strong>')
  s = s.replace(/___(.+?)___/g,       '<strong class="nb-bold"><em class="nb-italic">$1</em></strong>')
  // Bold **…** or __…__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="nb-bold">$1</strong>')
  s = s.replace(/__([^_\n]+)__/g,  '<strong class="nb-bold">$1</strong>')
  // Italic *…* or _…_
  s = s.replace(/\*([^*\n]+)\*/g, '<em class="nb-italic">$1</em>')
  s = s.replace(/_([^_\n]+)_/g,   '<em class="nb-italic">$1</em>')
  // Strikethrough ~~…~~
  s = s.replace(/~~(.+?)~~/g, '<del class="nb-strike">$1</del>')
  // Highlight ==…==
  s = s.replace(/==(.+?)==/g, '<mark class="nb-hl">$1</mark>')
  // Superscript ^…^
  s = s.replace(/\^([^\s^]+)\^/g, '<sup class="nb-sup">$1</sup>')
  // Subscript ~…~
  s = s.replace(/~([^\s~]+)~/g, '<sub class="nb-sub">$1</sub>')
  // Footnote refs [^id]
  s = s.replace(/\[\^([^\]\n]+)\]/g, (_, id) =>
    ph(`<sup class="nb-fn-ref"><a href="#fn-${esc(id)}">[${esc(id)}]</a></sup>`))
  // Wikilinks [[Title]] with optional (sketch) or (flash) suffix
  s = s.replace(/\[\[([^\]\n]{1,120})\]\](?:\((sketch|flash)\))?/g, (_, raw, suffix) => {
    const title = raw.trim()
    if (!_hasVault) {
      // No vault to check at all (guest, PLAN_CONCURRENCY.md §18.7) — never
      // claim "doesn't exist, click to create"; same distinction WikiWidget's
      // own `unavailable` state draws in Live mode (§18.5), reused here for
      // Preview mode rather than a second, differently-worded degrade.
      return ph(`<span class="wikilink wikilink-unavailable" title="Not available in a shared note">${esc(title)}</span>`)
    }
    const nb = notebooks.find(n => n.title?.toLowerCase() === title.toLowerCase())
    const bk = !nb && library.find(b => b.title?.toLowerCase() === title.toLowerCase())
    const sb = !nb && !bk && sketchbooks.find(s => s.title?.toLowerCase() === title.toLowerCase())
    const fd = !nb && !bk && !sb && flashcardDecks.find(d => d.title?.toLowerCase() === title.toLowerCase())
    // Suffix overrides type for new items
    const forceType = suffix === 'sketch' ? 'new-sketch' : suffix === 'flash' ? 'new-flash' : null
    const cls  = nb ? 'wikilink wikilink-nb' : bk ? 'wikilink wikilink-bk' : sb ? 'wikilink wikilink-sb' : fd ? 'wikilink wikilink-fd' : 'wikilink wikilink-new'
    const type = nb ? 'notebook' : bk ? 'book' : sb ? 'sketchbook' : fd ? 'flashcard' : (forceType || 'new')
    const id   = nb ? nb.id : bk ? bk.id : sb ? sb.id : fd ? fd.id : ''
    return ph(`<span class="${cls}" data-wl-type="${type}" data-wl-id="${esc(id)}" data-wl-title="${esc(title)}">${esc(title)}</span>`)
  })

  // Restore placeholders without using control-char regex
  s = s.split('\x02').reduce((acc, part, idx) => {
    if (idx === 0) return part
    const end = part.indexOf('\x03')
    const bucketIdx = parseInt(part.slice(0, end), 10)
    return acc + (buckets[bucketIdx] ?? '') + part.slice(end + 1)
  }, '')
  return s
}

// ─── Block renderer ───────────────────────────────────────────────────────────

export function renderList(rawLines, il) {
  let html = ''
  const stack = []
  const openTag = (tag, start) => {
    html += (tag === 'ol' && start > 1) ? `<ol start="${start}">` : `<${tag}>`
  }
  const closeTag = () => { const top = stack.pop(); html += `</${top.tag}>` }

  rawLines.forEach(line => {
    const olM = line.match(/^(\s*)(\d+)[.)]\s+(.*)/)
    const ulM = !olM && line.match(/^(\s*)([-*+])\s+(.*)/)
    const m = olM || ulM
    if (!m) return
    const indent = m[1].length
    const tag    = olM ? 'ol' : 'ul'
    const num    = olM ? parseInt(m[2], 10) : 1
    const item   = m[3]

    if (!stack.length) {
      openTag(tag, num); stack.push({ tag, indent })
    } else if (indent > stack[stack.length - 1].indent) {
      openTag(tag, num); stack.push({ tag, indent })
    } else {
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) closeTag()
      if (stack[stack.length - 1].tag !== tag) {
        closeTag(); openTag(tag, num); stack.push({ tag, indent })
      }
    }
    html += `<li>${il(item)}</li>`
  })
  while (stack.length) closeTag()
  return html
}

/** Strip anything executable from author-supplied SVG before it goes into the
 *  DOM: <script>, event handlers (onclick=…), and javascript: URLs. Notes can
 *  arrive from outside the archive (sync, external refs), so treat their SVG as
 *  untrusted. */
export function _sanitizeSvg(src) {
  let s = String(src || '')
  // Drop an XML prolog / DOCTYPE and any trailing junk, keeping just the root
  // <svg>…</svg>. Exported files routinely carry these and they confuse parsing.
  const start = s.search(/<svg[\s>]/i)
  if (start === -1) return `<div class="nb-diagram-error">Not valid SVG</div>`
  const end = s.toLowerCase().lastIndexOf('</svg>')
  s = end === -1 ? s.slice(start) : s.slice(start, end + 6)

  try {
    // Parse as real SVG and prune dangerous NODES/ATTRS, rather than deleting
    // whole elements by regex. An earlier version removed every <foreignObject>,
    // which is where many exported diagrams keep their visible content — the
    // graphic came out blank with only stray <title> text showing.
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.nodeName.toLowerCase() === 'parsererror' || doc.querySelector('parsererror')) {
      return `<div class="nb-diagram-error">Could not parse SVG</div>`
    }
    root.querySelectorAll('script').forEach(n => n.remove())
    root.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase(), v = (attr.value || '').trim().toLowerCase()
        if (n.startsWith('on')) el.removeAttribute(attr.name)
        else if ((n === 'href' || n === 'xlink:href') && v.startsWith('javascript:')) el.removeAttribute(attr.name)
      }
    })
    return new XMLSerializer().serializeToString(root)
  } catch {
    // Parsing failed — fall back to the conservative string scrub.
    return s
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '')
  }
}

// Mermaid is a very large dependency — loaded on first use only, then reused.
let _mermaidPromise = null
export function getMermaid() {
  if (!_mermaidPromise) {
    _mermaidPromise = import('mermaid').then(m => {
      const mer = m.default || m
      // Follow the app's theme — a light-on-white diagram in a dark notebook is
      // unreadable. Read the real background so custom themes work too.
      let dark = true
      try {
        const bg = getComputedStyle(document.body).backgroundColor || ''
        const n = bg.match(/\d+/g)
        if (n && n.length >= 3) dark = (+n[0] * 299 + +n[1] * 587 + +n[2] * 114) / 1000 < 128
      } catch { /* default dark */ }
      mer.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: "'trebuchet ms', verdana, arial, sans-serif",
        fontSize: 16,
      })
      return mer
    })
  }
  return _mermaidPromise
}

/** Render any pending `.nb-mermaid` placeholders inside `root`. Idempotent —
 *  each node is marked done, so re-running after a re-render is cheap. */
export async function hydrateDiagrams(root) {
  if (!root) return
  const nodes = [...root.querySelectorAll('.nb-mermaid:not([data-rendered])')]
  if (!nodes.length) return
  let mer
  try { mer = await getMermaid() }
  catch { nodes.forEach(n => { n.dataset.rendered = '1'; n.innerHTML = '<div class="nb-diagram-error">Mermaid failed to load</div>' }); return }
  for (const n of nodes) {
    n.dataset.rendered = '1'
    const src = n.dataset.mermaid || ''
    try {
      const id = `mmd-${Math.random().toString(36).slice(2, 9)}`
      const { svg } = await mer.render(id, src)
      n.innerHTML = svg
    } catch (err) {
      n.innerHTML = `<div class="nb-diagram-error">${esc(String(err?.message || err).split('\n')[0])}</div>`
    }
  }
}

export function blockToHtml(raw, notebooks, library, footnotesBuf, sketchbooks = [], flashcardDecks = []) {
  const il = t => inlineToHtml(t, notebooks, library, sketchbooks, flashcardDecks)
  const lines = raw.split('\n')
  const first = lines[0]

  // Space after the hashes is OPTIONAL — `## Title` and `##Title` both render.
  // The live editor already accepted both (see the no-space heading pass in
  // makeLivePlugin), but preview/export required the space, so the same note
  // looked different in the two modes. `[^\s#]` guards against a bare `###` and
  // against eating a 7th hash.
  const hm = first.match(/^(#{1,6})(?:[ \t]+|(?=[^\s#]))(.+?)(?:\s+\{#([^}]+)\})?$/)
  if (hm) {
    const lv = hm[1].length
    const id = ` id="${esc(hm[3] || _slugify(hm[2]))}"`
    return `<h${lv}${id}>${il(hm[2])}</h${lv}>`
  }

  if (/^(---+|\*\*\*+|___+)$/.test(first.trim())) return '<hr>'

  // /toc — table of contents (regenerated from the doc's headings at render)
  if (/^\s*(?:\/toc|\[toc\]|\{toc\})\s*$/i.test(first.trim())) {
    const heads = (_tocHeadings || []).filter(h => h.level >= 1 && h.level <= 6)
    if (!heads.length) return '<div class="nb-toc nb-toc-empty">No headings yet</div>'
    const items = heads.map(h =>
      `<a class="nb-toc-item" style="padding-left:${(h.level - 1) * 14}px" href="#${esc(h.slug)}">${il(h.text)}</a>`
    ).join('')
    return `<div class="nb-toc"><div class="nb-toc-head">Contents</div>${items}</div>`
  }

  // progress:: 7/10  →  labeled progress bar
  const progM = first.trim().match(/^progress::\s*(\d+)\s*\/\s*(\d+)(?:\s+(.+))?$/i)
  if (progM) {
    const cur = +progM[1], max = Math.max(1, +progM[2])
    const pct = Math.max(0, Math.min(100, Math.round((cur / max) * 100)))
    const label = progM[3] ? esc(progM[3]) : ''
    return `<div class="nb-progress"><div class="nb-progress-top"><span>${label}</span><span class="nb-progress-num">${cur}/${max}</span></div><div class="nb-progress-track"><div class="nb-progress-fill" style="width:${pct}%"></div></div></div>`
  }

  // rating:: 4/5  →  stars
  const rateM = first.trim().match(/^rating::\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?$/i)
  if (rateM) {
    const val = +rateM[1], out = rateM[2] ? +rateM[2] : 5
    let stars = ''
    for (let i = 1; i <= out; i++) stars += `<span class="nb-star${i <= val ? ' on' : ''}">${i <= val ? '★' : '☆'}</span>`
    return `<div class="nb-rating">${stars}</div>`
  }

  // status:: Todo  →  status badge
  const statusM = first.trim().match(/^status::\s*(\w+)$/i)
  if (statusM) {
    const def = _STATUS_DEFS[_statusDefIdx(statusM[1])]
    return `<div class="nb-status-badge" style="color:${def.color};background:${def.color}18;border-color:${def.color}40">${def.icon}<span>${esc(def.value)}</span></div>`
  }

  if (/^(`{3,}|~{3,})/.test(first)) {
    const lang = first.replace(/^`{3,}|^~{3,}/, '').trim()
    const body = raw.replace(/^[^\n]*\n/, '').replace(/\n[`~]{3,}\s*$/, '')
    // ```mermaid — emit a placeholder carrying the source; hydrateDiagrams()
    // renders it after paint. Mermaid is ~1.4MB, so it is imported lazily and
    // ONLY when a diagram actually exists — it must never touch startup.
    if (/^mermaid$/i.test(lang)) {
      return `<div class="nb-mermaid" data-mermaid="${esc(body)}"><div class="nb-diagram-pending">rendering diagram…</div></div>`
    }
    // ```svg — render the markup inline (sanitised: no scripts/handlers).
    if (/^svg$/i.test(lang)) {
      return `<div class="nb-svg">${_sanitizeSvg(body)}</div>`
    }
    return `<pre class="nb-pre${lang ? ' lang-'+esc(lang) : ''}"><code>${esc(body)}</code></pre>`
  }

  if (/^>\s?/.test(first)) {
    const inner = lines.map(l => l.replace(/^>\s?/, '')).join('\n').trim()
    const callM = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|SUCCESS|DANGER)\](.*)/i)
    if (callM) {
      const kind  = callM[1].toUpperCase()
      const title = callM[2].trim() || kind.charAt(0)+kind.slice(1).toLowerCase()
      const palettes = {NOTE:'#388bfd',TIP:'#3fb950',IMPORTANT:'#a371f7',WARNING:'#d29922',CAUTION:'#f85149',INFO:'#388bfd',SUCCESS:'#3fb950',DANGER:'#f85149'}
      const c = palettes[kind] || '#388bfd'
      return `<div class="nb-callout" style="border-left:3px solid ${c};background:${c}18;padding:10px 14px;border-radius:0 6px 6px 0;margin:.6em 0"><div style="font-weight:700;color:${c};margin-bottom:4px;font-size:.93em">${esc(title)}</div><div>${il(inner.replace(/^\[[^\]]+\][^\n]*\n?/, '').trim())}</div></div>`
    }
    return `<blockquote>${il(inner.replace(/\n/g, '<br>'))}</blockquote>`
  }

  if ((/^\s*\|/.test(first) || /^\[[^\]]+\]$/.test(first.trim())) && lines.length >= 2) {
    const parseRow = row => {
      const trimmed = row.trim()
      const inner = trimmed.replace(/^(?<!\\)\|/, '').replace(/(?<!\\)\|$/, '')
      return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
    }
    // Extract optional caption line (first or last line matching [caption text])
    let captionText = null
    let tLines = lines
    if (/^\[[^\]]+\]$/.test(lines[lines.length - 1].trim())) {
      captionText = lines[lines.length - 1].trim().slice(1, -1)
      tLines = lines.slice(0, -1)
    } else if (/^\[[^\]]+\]$/.test(lines[0].trim())) {
      captionText = lines[0].trim().slice(1, -1)
      tLines = lines.slice(1)
    }
    if (tLines.length < 2 || !/^\s*\|/.test(tLines[0])) return `<p>${il(raw)}</p>`
    const headers = parseRow(tLines[0])
    const sep     = tLines[1] ? parseRow(tLines[1]) : []
    const aligns  = sep.map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left')
    const isSepRow = l => parseRow(l).every(c => /^:?-+:?$/.test(c))
    const rows    = tLines.slice(2).filter(l => /\|/.test(l) && !isSepRow(l))
    const thHtml  = headers.map((h, i) => `<th style="text-align:${aligns[i]||'left'}">${il(h)}</th>`).join('')
    const tbHtml  = rows.map(r => {
      const cells = parseRow(r)
      const norm  = Array.from({ length: headers.length }, (_, i) => cells[i] ?? '')
      return `<tr>${norm.map((c, i) => `<td style="text-align:${aligns[i]||'left'}">${il(c)}</td>`).join('')}</tr>`
    }).join('')
    const tableHtml = `<table class="nb-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table>`
    return captionText
      ? `<figure class="nb-table-fig">${tableHtml}<figcaption class="nb-table-cap">${il(captionText)}</figcaption></figure>`
      : tableHtml
  }

  if (/^\s*[-*+]\s\[[ xX]\]/.test(first)) {
    let idx = 0
    const items = lines.filter(l => /^\s*[-*+]\s\[[ xX]\]/.test(l)).map(l => {
      const checked = /\[[xX]\]/.test(l)
      const text    = l.replace(/^\s*[-*+]\s\[[ xX]\]\s*/, '')
      return `<li class="nb-task${checked?' checked':''}" data-ti="${idx++}"><span class="nb-cb" data-ti="${idx-1}">${checked?'✓':''}</span><span>${il(text)}</span></li>`
    })
    return `<ul class="nb-tl">${items.join('')}</ul>`
  }

  if (/^\s*[-*+]\s/.test(first)) return renderList(lines, il)
  if (/^\s*\d+[.)]\s/.test(first)) return renderList(lines, il)

  // Definition list: any line followed by ": definition"
  if (lines.length >= 2 && lines.some(l => /^:\s+/.test(l))) {
    let dlHtml = ''; let i = 0
    while (i < lines.length) {
      const l = lines[i]
      if (/^:\s+/.test(l)) {
        dlHtml += `<dd class="nb-dd">${il(l.replace(/^:\s+/, ''))}</dd>`
        i++
      } else if (l.trim()) {
        dlHtml += `<dt class="nb-dt">${il(l.trim())}</dt>`
        i++
      } else { i++ }
    }
    return `<dl class="nb-dl">${dlHtml}</dl>`
  }

  const fnM = first.match(/^\[\^([^\]]+)\]:\s*(.*)/)
  if (fnM) {
    footnotesBuf?.push({ id: fnM[1], text: fnM[2] })
    return `<div class="nb-fn-def" id="fn-${esc(fnM[1])}"><sup>${esc(fnM[1])}</sup> ${il(fnM[2])} <a href="#fnref-${esc(fnM[1])}" class="nb-fn-back">↩</a></div>`
  }

  // Math block $$…$$
  if (/^\$\$/.test(first)) {
    const body = raw.replace(/^\$\$\n?/, '').replace(/\n?\$\$$/, '')
    return `<div class="nb-math nb-math-block nb-math-mq" data-latex="${esc(body)}" data-display="1"></div>`
  }

  // /habits block — render as habit tracker preview
  if (/^\/habits(?::.*)?$/.test(first)) {
    try {
      const m = first.match(/^\/habits(?::(.*))?$/)
      const data = (m && m[1]) ? JSON.parse(m[1]) : { habits: [], log: {} }
      const today = new Date().toISOString().slice(0, 10)
      const rowsHtml = (data.habits || []).map((h, hi) => {
        const done = !!(data.log && data.log[today] && data.log[today][hi])
        return `<div class="cm-habits-preview-row"><span class="cm-habits-name">${esc(h)}</span><span class="cm-habits-cell${done ? ' done' : ''}" style="display:inline-block;width:12px;height:12px;border-radius:3px;margin-left:8px;vertical-align:middle;"></span></div>`
      }).join('')
      return `<div class="cm-habits-widget" style="pointer-events:none"><div class="cm-habits-hdr"><span class="cm-habits-title">Habits</span></div>${rowsHtml || '<div class="cm-habits-empty">No habits yet</div>'}</div>`
    } catch { return '' }
  }

  // /kanban block — render as a kanban board (matches widget CSS). Accepts
  // the old '/task' header too so notebooks written before the rename
  // still render.
  if (/^\/(?:task|kanban)(?::.*)?$/.test(first)) {
    const block = parseTaskBlock(raw, 0)
    if (block) {
      const _colColors = ['#f59e0b','#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4']
      const colsHtml = block.columns.map((col, ci) => {
        const tasksHtml = col.tasks.map(t => {
          return `<div class="cm-task-card-w">
            <div class="cm-task-card-body">
              <span class="cm-task-card-text">${esc(t.text)}</span>
            </div>
          </div>`}).join('')
        return `<div class="cm-task-col-w">
          <div class="cm-task-col-hdr-w">
            <div class="cm-task-col-hdr-left">
              <span class="cm-task-col-ring" style="--ring-color:${_colColors[ci % _colColors.length]}"></span>
              <span class="cm-task-col-title">${esc(col.title)}</span>
            </div>
            <span class="cm-task-col-w-badge">${col.tasks.length}</span>
          </div>
          <div class="cm-task-cards-area">${tasksHtml}</div>
        </div>`
      }).join('')
      const titleHtml = block.boardTitle ? `<div class="cm-task-titlebar"><span class="cm-task-title-w">${esc(block.boardTitle)}</span></div>` : ''
      return `<div class="cm-task-board-w">${titleHtml}<div class="cm-task-cols-w">${colsHtml}</div></div>`
    }
  }

  // /calendar block — render as a simple event summary in preview
  if (/^\/calendar(?::.*)?$/.test(first)) {
    let data = {}
    try { const jsonPart = first.replace(/^\/calendar:/, ''); data = JSON.parse(jsonPart) } catch { /**/ }
    const events = data.events || {}
    const titleText = data.title || 'Calendar'
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    // Show next 7 days of events
    const days = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i)
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      if (events[k]?.length) days.push({ date: d, key: k, evts: events[k] })
    }
    const evtHtml = days.length ? days.map(({ date, evts }) => {
      const label = date.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })
      return `<div class="cm-cal-prev-day"><span class="cm-cal-prev-date">${esc(label)}</span>${evts.map(e => `<span class="cm-cal-prev-evt">${esc(e)}</span>`).join('')}</div>`
    }).join('') : '<div style="font-size:11px;color:var(--textDim);padding:6px 0">No upcoming events</div>'
    return `<div class="cm-cal-prev-block"><div class="cm-cal-prev-title">${esc(titleText)}</div>${evtHtml}</div>`
  }

  // /math zone command — render as a small badge in preview
  if (/^\/(?:math(?:\s+end)?|endmath)\s*$/i.test(first)) {
    const isEnd = /end/i.test(first)
    return `<div><span class="cm-mathzone-badge${isEnd ? ' cm-mathzone-end' : ''}"><span class="cm-mathzone-icon">∑</span>${isEnd ? 'math off' : 'math on'}</span></div>`
  }

  // /pomo block — render as pomodoro status in preview
  if (/^\/pomo$/.test(first)) {
    return `<div class="cm-pomo-prev"><span class="cm-pomo-prev-icon">\u{1F345}</span><span class="cm-pomo-prev-text">Pomodoro Timer</span><span class="cm-pomo-prev-sub">25 min focus · 5 min break</span></div>`
  }

  // /timer block — render as a simple timer display in preview
  if (/^\/timer(?::.*)?$/.test(first)) {
    const m = first.match(/^\/timer:(\d+)(?::(.+))?$/)
    const totalSec = m ? parseInt(m[1]) : 0
    const label = m?.[2] || ''
    const h = Math.floor(totalSec / 3600), min = Math.floor((totalSec % 3600) / 60), sec = totalSec % 60
    const display = totalSec > 0 ? (h > 0 ? `${h}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${min}:${String(sec).padStart(2,'0')}`) : '0:00'
    return `<div class="cm-timer-prev"><span class="cm-timer-prev-time">${esc(display)}</span>${label ? `<span class="cm-timer-prev-label">${esc(label)}</span>` : ''}</div>`
  }

  return `<p>${il(raw.replace(/\n/g, '<br>'))}</p>`
}

export function parseBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  let buf = [], inFence = false, fenceMarker = ''

  const flush = () => {
    const raw = buf.join('\n').trim()
    if (raw) blocks.push(raw)
    buf = []
  }

  for (const line of lines) {
    if (!inFence && /^(`{3,}|~{3,})/.test(line)) {
      flush(); inFence = true; fenceMarker = line.match(/^(`{3,}|~{3,})/)[1]
      buf.push(line); continue
    }
    if (inFence) {
      buf.push(line)
      if (line.startsWith(fenceMarker) && line.trim().length === fenceMarker.length) {
        flush(); inFence = false; fenceMarker = ''
      }
      continue
    }
    if (line.trim() === '$$') { buf.push(line); continue }
    if (line.trim() === '') { flush(); continue }

    // Keep /kanban block lines together (column headers == ... == and task items - [ ] ...)
    const wasTaskBlock = buf.length > 0 && /^\/(?:task|kanban)(?::.*)?$/.test(buf[0])
    if (wasTaskBlock) { buf.push(line); continue }

    const isTable   = /^\s*\|/.test(line)
    const wasTable  = buf.length > 0 && /^\s*\|/.test(buf[0])
    if (isTable && wasTable) { buf.push(line); continue }
    if (isTable && !wasTable) { flush(); buf.push(line); continue }
    // Body rows without a leading pipe (optional outer pipes) continue a table block
    if (!isTable && wasTable && /\|/.test(line) && !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)] |>|`{3,}|~{3,})/.test(line)) { buf.push(line); continue }

    const isUl   = /^\s*[-*+]\s/.test(line) && !/^\s*[-*+]\s\[[ xX]\]/.test(line)
    const isOl   = /^\s*\d+[.)]\s/.test(line)
    const isTask = /^\s*[-*+]\s\[[ xX]\]/.test(line)
    const isList = isUl || isOl || isTask
    const wasList = buf.length > 0 && (
      /^\s*[-*+]\s/.test(buf[0]) || /^\s*\d+[.)]\s/.test(buf[0])
    )
    if (isList && wasList) { buf.push(line); continue }
    if (isList) { flush() }

    flush(); buf.push(line)
  }
  flush()
  return blocks
}

// Parse a leading YAML-ish frontmatter block (--- … ---) into ordered
// key/value pairs. Values may be comma lists or `[a, b]`. Returns
// { props:[{key,values}], bodyStart } or null. Deliberately tiny (no yaml dep).
export function parseFrontmatter(text) {
  const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
  if (!m) return null
  const props = []
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    let raw = kv[2].trim()
    let values
    if (/^\[.*\]$/.test(raw)) values = raw.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
    else if (raw.includes(',')) values = raw.split(',').map(s => s.trim()).filter(Boolean)
    else values = raw ? [raw] : []
    props.push({ key: kv[1], values })
  }
  return { props, length: m[0].length }
}

export function frontmatterHtml(props) {
  if (!props.length) return ''
  const rows = props.map(p => {
    const isTag = /^tags?$/i.test(p.key)
    const vals = p.values.length
      ? p.values.map(v => isTag
          ? `<span class="nb-prop-tag">#${esc(v.replace(/^#/, ''))}</span>`
          : `<span class="nb-prop-val">${esc(v)}</span>`).join(' ')
      : '<span class="nb-prop-empty">—</span>'
    return `<div class="nb-prop-row"><span class="nb-prop-key">${esc(p.key)}</span><span class="nb-prop-vals">${vals}</span></div>`
  }).join('')
  return `<div class="nb-props">${rows}</div>`
}

// Populated by renderMarkdown before block rendering so a /toc block can list
// the document's headings (blockToHtml sees one block at a time).
let _tocHeadings = []
export function _slugify(t) {
  return String(t).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 64)
}

// `assets` — optional `{ assetsMap, assetsMetaMap }`, the same Yjs maps
// ImgWidget's own fallback reads (PLAN_CONCURRENCY.md §18.4/§18.7). Only
// consulted when `notebookDir` is null, same condition as the live editor —
// `NotebookView.jsx`'s own Preview mode never passes it, zero behavior
// change there.
// `hasVault` — default `true` (see `_hasVault`'s own header comment).
export function renderMarkdown(text, notebooks = [], library = [], sketchbooks = [], flashcardDecks = [], notebookDir = null, assets = null, hasVault = true) {
  if (!text?.trim()) return ''
  const footnotes = []
  // Leading YAML frontmatter → properties card, stripped before block parsing
  let fmHtml = ''
  const fm = parseFrontmatter(text)
  if (fm) { fmHtml = frontmatterHtml(fm.props); text = text.slice(fm.length) }
  const blocks = parseBlocks(text)
  // Collect headings for /toc (level + visible text + slug for anchors)
  _imgBaseDir = notebookDir
  _hasVault = hasVault
  _imgAssets = assets
  _tocHeadings = []
  for (const b of blocks) {
    const hm = b.match(/^(#{1,6})(?:[ \t]+|(?=[^\s#]))(.+?)(?:\s+\{#([^}]+)\})?\s*$/)
    if (hm) _tocHeadings.push({ level: hm[1].length, text: hm[2], slug: hm[3] || _slugify(hm[2]) })
  }
  // Merge standalone [caption] blocks with adjacent table blocks
  for (let ci = 0; ci < blocks.length; ci++) {
    if (!/^\[[^\]]+\]$/.test(blocks[ci].trim())) continue
    if (ci + 1 < blocks.length && /^\s*\|/.test(blocks[ci + 1])) {
      blocks[ci + 1] = blocks[ci] + '\n' + blocks[ci + 1]
      blocks.splice(ci, 1); ci--
    } else if (ci > 0 && /^\s*\|/.test(blocks[ci - 1])) {
      blocks[ci - 1] = blocks[ci - 1] + '\n' + blocks[ci]
      blocks.splice(ci, 1); ci--
    }
  }
  const html = fmHtml + blocks.map((raw, i) =>
    blockToHtml(raw, notebooks, library, footnotes, sketchbooks, flashcardDecks)
      .replace(/^(<\w+)/, `$1 data-bi="${i}"`)
  ).join('\n')
  if (!footnotes.length) return html
  const fnHtml = `<section class="nb-fns"><hr>${footnotes.map(f =>
    `<div id="fn-${esc(f.id)}" class="nb-fn-def"><sup>${esc(f.id)}</sup> ${inlineToHtml(f.text, notebooks, library, sketchbooks, flashcardDecks)} <a href="#fnref-${esc(f.id)}" class="nb-fn-back">↩</a></div>`
  ).join('')}</section>`
  return html + fnHtml
}

// Hydrate math nodes in a container after innerHTML is set — uses KaTeX
export function hydrateMathNodes(container) {
  const nodes = Array.from(container.querySelectorAll('.nb-math-mq'))
  if (!nodes.length) return
  getKaTeX().then(katex => {
    nodes.forEach(el => {
      const latex = el.dataset.latex || ''
      const display = el.dataset.display === '1'
      if (!katex) { el.textContent = latex; return }
      try {
        katex.render(latex, el, { displayMode: display, throwOnError: false, strict: false })
      } catch { el.textContent = latex }
    })
  })
}

// ─── CodeMirror theme ─────────────────────────────────────────────────────────
export function makeTheme(cm) {
  const { EditorView } = cm.view
  return EditorView.theme({
    // In live mode we style lines via CSS classes, not the base editor font.
    // Keep base styles minimal so .nb-live CSS classes dominate.
    '&': {
      background: 'transparent',
      color: 'var(--text)',
      height: '100%',
      fontFamily: 'Switzer, Satoshi, sans-serif',
      fontSize: '15px',
      fontWeight: '450',
    },
    '.cm-content': { caretColor: 'var(--accent)', padding: '16px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      background: 'var(--nb-sel, color-mix(in srgb, var(--accent) 28%, transparent)) !important',
    },
    '.cm-activeLine': { background: 'transparent' },
    '.cm-searchMatch': { background: 'rgba(210,153,34,0.35)', borderRadius: '2px' },
    '.cm-searchMatch.cm-searchMatch-selected': { background: 'color-mix(in srgb, var(--accent) 45%, transparent)' },
    '.cm-panels': { display: 'none' },
    '.cm-panel': { display: 'none' },
    '.cm-panel button': { background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', cursor: 'pointer', padding: '3px 8px', fontFamily: 'inherit', fontSize: '12px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  }, { dark: true })
}

export function makeHighlight(cm) {
  const { tags } = cm.highlight
  const { HighlightStyle } = cm.language
  return HighlightStyle.define([
    // Headings: weight/family ONLY — never fontSize or color.
    // Heading appearance is owned by the `.cm-lv-hN` LINE classes (which carry
    // --nb-hN / --nb-hN-color). These tag styles land on a span INSIDE that
    // line, so a `fontSize: '1.35em'` here multiplied the line's already-scaled
    // size (18.9px → 25.5px) and `color: var(--text)` overrode the heading
    // colour. Only *spaced* headings were affected, because `##Text` isn't
    // parsed as an ATXHeading and so never received these tag styles — which is
    // why the two forms looked different.
    { tag: tags.heading1, fontWeight: '600', fontFamily: 'Switzer, Satoshi, sans-serif', letterSpacing: '-0.3px' },
    { tag: tags.heading2, fontWeight: '600', fontFamily: 'Switzer, Satoshi, sans-serif', letterSpacing: '-0.2px' },
    { tag: tags.heading3, fontWeight: '600', fontFamily: 'Satoshi, Author, sans-serif' },
    { tag: tags.heading4, fontWeight: '600', fontFamily: 'Satoshi, Author, sans-serif' },
    { tag: tags.strong,   color: 'var(--nb-bold-color)', fontWeight: '700' },
    { tag: tags.emphasis, color: 'var(--nb-italic-color)', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: 'var(--textDim)', textDecoration: 'line-through' },
    { tag: tags.link,   color: 'var(--accent)' },
    { tag: tags.url,    color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.monospace, color: 'var(--accent)', fontFamily: 'SF Mono,Menlo,Consolas,monospace', fontSize: '0.88em' },
    { tag: tags.meta,   color: 'var(--textDim)', opacity: '0.4' },
    { tag: tags.atom,   color: 'var(--textDim)' },
    { tag: tags.comment, color: 'var(--textDim)', fontStyle: 'italic' },
    { tag: tags.processingInstruction, color: 'var(--textDim)', opacity: '0.6' },
    { tag: tags.keyword, color: '#d2a8ff' },
    { tag: tags.string,  color: '#a5d6ff' },
    { tag: tags.number,  fontWeight: '600' },
    { tag: tags.operator, color: 'var(--textDim)' },
  ])
}

// ─── Wiki-link dropdown (custom React-driven, no CM6 autocompletion) ─────────
// A ViewPlugin detects [[…  before the cursor and pushes state to React via
// a callback. React renders the floating dropdown. The plugin also provides
// a keymap (Tab confirm, ArrowUp/Down navigate, Escape dismiss).
// `getFreshVaultData` — optional `() => { notebooks, library, sketchbooks,
// flashcardDecks }`, injected rather than read from a hard `useAppStore`
// import — same reasoning as QuestionWidget's own `storeApi` (see its header
// comment): this file is shared with the web guest bundle, which must never
// transitively pull in the desktop app's whole state layer. `null` (nothing
// passes anything else yet) falls back to the constructor-passed snapshot
// arrays below, same as before this was injectable.
export function makeWikiDropdownPlugin(cm, _notebooks, _library, _sketchbooks, _flashcardDecks, onStateChange, getFreshVaultData = null) {
  const { Prec } = cm.state
  const { ViewPlugin, EditorView, keymap: keymapFacet } = cm.view

  // Shared mutable state the keymap closures can read
  const shared = { active: false, options: [], selectedIdx: 0, from: 0, to: 0 }

  function buildOptions(query) {
    const q = query.toLowerCase()
    // Always read fresh data from the store to avoid stale closures
    const store = getFreshVaultData ? getFreshVaultData() : {}
    const notebooks = store.notebooks || _notebooks || []
    const library = store.library || _library || []
    const sketchbooks = store.sketchbooks || _sketchbooks || []
    const flashcardDecks = store.flashcardDecks || _flashcardDecks || []
    const make = (items, detail) =>
      items.filter(i => i.title?.toLowerCase().includes(q))
        .slice(0, 6)
        .map(i => ({ label: i.title, detail, insert: `[[${i.title}]]` }))
    const opts = [
      ...make(notebooks, 'Notebook'),
      ...make(library.filter(b => b.format !== 'audiofolder' && b.format !== 'audio'), 'Book'),
      ...make(library.filter(b => b.format === 'audiofolder' || b.format === 'audio'), 'Audio'),
      ...make(sketchbooks, 'Sketchbook'),
      ...make(flashcardDecks, 'Flashcards'),
    ].slice(0, 8)
    // "Create new" options
    const trimmed = query.trim()
    if (trimmed.length > 0 && !opts.some(o => o.label.toLowerCase() === trimmed.toLowerCase())) {
      opts.push({ label: trimmed, detail: '+ New notebook', insert: `[[${trimmed}]]` })
      opts.push({ label: trimmed, detail: '+ New sketchbook', insert: `[[${trimmed}]](sketch)` })
      opts.push({ label: trimmed, detail: '+ New flashcards', insert: `[[${trimmed}]](flash)` })
    }
    return opts
  }

  function detectWiki(state) {
    const cur = state.selection.main.head
    const line = state.doc.lineAt(cur)
    const col = cur - line.from
    const textBefore = line.text.slice(0, col)
    // Find last [[ that isn't closed
    const idx = textBefore.lastIndexOf('[[')
    if (idx === -1) return null
    const afterBrackets = textBefore.slice(idx + 2)
    // If there's a ]] inside, the wikilink is already closed
    if (afterBrackets.includes(']]')) return null
    // If there's a newline, not valid
    if (afterBrackets.includes('\n')) return null
    return { from: line.from + idx, query: afterBrackets }
  }

  function pushState(view) {
    const result = detectWiki(view.state)
    if (!result) {
      if (shared.active) {
        shared.active = false
        shared.options = []
        onStateChange(null)
      }
      return
    }
    const opts = buildOptions(result.query)
    shared.active = opts.length > 0
    shared.options = opts
    shared.from = result.from
    shared.to = view.state.selection.main.head
    if (shared.selectedIdx >= opts.length) shared.selectedIdx = 0
    if (!shared.active) { onStateChange(null); return }
    // Get cursor coordinates for positioning
    const coords = view.coordsAtPos(view.state.selection.main.head)
    onStateChange({
      options: opts,
      selectedIdx: shared.selectedIdx,
      coords: coords ? { left: coords.left, top: coords.bottom + 4 } : null,
    })
  }

  function confirmSelection(view) {
    if (!shared.active || !shared.options.length) return false
    const opt = shared.options[shared.selectedIdx]
    if (!opt) return false
    view.dispatch({ changes: { from: shared.from, to: shared.to, insert: opt.insert } })
    shared.active = false
    shared.options = []
    onStateChange(null)
    return true
  }

  const plugin = ViewPlugin.fromClass(class {
    constructor(view) { this._raf = null; this._schedule(view) }
    update(upd) { if (upd.docChanged || upd.startState.selection.main.head !== upd.state.selection.main.head) this._schedule(upd.view) }
    _schedule(view) {
      if (this._raf) cancelAnimationFrame(this._raf)
      this._raf = requestAnimationFrame(() => { this._raf = null; pushState(view) })
    }
    destroy() { if (this._raf) cancelAnimationFrame(this._raf); onStateChange(null) }
  })

  const wikiKeymap = Prec.high(keymapFacet.of([
    {
      key: 'Tab',
      run: view => shared.active ? confirmSelection(view) : false,
    },
    {
      key: 'Escape',
      run: _view => {
        if (!shared.active) return false
        shared.active = false; shared.options = []
        onStateChange(null)
        return true
      },
    },
    {
      key: 'ArrowDown',
      run: view => {
        if (!shared.active) return false
        shared.selectedIdx = (shared.selectedIdx + 1) % shared.options.length
        pushState(view)
        return true
      },
    },
    {
      key: 'ArrowUp',
      run: view => {
        if (!shared.active) return false
        shared.selectedIdx = (shared.selectedIdx - 1 + shared.options.length) % shared.options.length
        pushState(view)
        return true
      },
    },
  ]))

  return [plugin, wikiKeymap]
}

// ─── Paired-syntax auto-wrap (transaction filter — no dropdown) ───────────────
// When the user types an opening token, we check if there's a selection or
// a word to the left and wrap it. If nothing is selected, we insert both tokens
// and place the cursor in the middle. This is the Obsidian-style approach.
export function makePairInputHandler(cm) {
  // Obsidian-style: only auto-wrap when there's a selection.
  // No selection → just type the character normally (no auto-closing).
  // Exception: backtick and $ get lightweight auto-close (easy to dismiss).
  const WRAP_PAIRS = { '*':'*', '_':'_', '=':'=', '`':'`', '$':'$' }  // '~' removed: sup/sub should not auto-wrap
  return cm.view.EditorView.inputHandler.of((view, _from, _to, text) => {
    if (!WRAP_PAIRS[text]) return false
    const sel = view.state.selection.main

    // ── Selection → wrap it (like Obsidian) ─────────────────────────────
    if (!sel.empty) {
      const selected = view.state.doc.sliceString(sel.from, sel.to)
      // Determine the wrapper based on what's already around the selection
      let open = text, close = WRAP_PAIRS[text]
      // If wrapping with * or _, check if we should use ** or *** based on context
      // Simple: just wrap with whatever the user typed
      view.dispatch({
        changes: [
          { from: sel.from, to: sel.from, insert: open },
          { from: sel.to, to: sel.to, insert: close },
        ],
        selection: cm.state.EditorSelection.range(sel.from + open.length, sel.to + open.length),
      })
      return true
    }

    // ── No selection → skip-over if next char matches (prevents doubled closers) ──
    const after1 = view.state.doc.sliceString(sel.from, sel.from + 1)
    if (after1 === text) {
      // Check if we're inside a pair (simple heuristic: char before us is not whitespace
      // and char after is the same as what we're typing)
      const before1 = sel.from >= 1 ? view.state.doc.sliceString(sel.from - 1, sel.from) : ''
      if (before1 && before1 !== ' ' && before1 !== '\n') {
        // Skip over the existing character
        view.dispatch({ selection: { anchor: sel.from + 1 } })
        return true
      }
    }

    // ── No selection → no auto-close, let character type naturally ──────
    return false
  })
}

export function makeSmartEnter(cm) {
  const smartEnterRun = ({ state, dispatch }) => {
    const sel = state.selection.main
    if (!sel.empty) return false // Let default handle selections
    const line = state.doc.lineAt(sel.from)
    const text = line.text

    // Detect unordered list item: leading spaces + marker (- * +) + space
    const ulMatch = text.match(/^(\s*)([-*+]) /)
    // Detect ordered list item: leading spaces + digits + . + space
    const olMatch = text.match(/^(\s*)(\d+)\. /)

    const match = ulMatch || olMatch
    if (!match) return false

    // Content after the marker
    const prefixLen = match[0].length
    const contentStart = line.from + prefixLen
    const isEmpty = sel.from <= contentStart && text.slice(prefixLen).trim() === ''

    if (isEmpty) {
      // Empty list item — clear the line (exit the list)
      dispatch(state.update({
        changes: { from: line.from, to: line.to, insert: '' },
        selection: { anchor: line.from },
        scrollIntoView: true,
      }))
      return true
    }

    // Build next-line prefix: same indent + same marker (or incremented number)
    let nextPrefix
    if (olMatch) {
      const n = parseInt(olMatch[2], 10)
      nextPrefix = olMatch[1] + (n + 1) + '. '
    } else {
      nextPrefix = ulMatch[1] + ulMatch[2] + ' '
    }

    // Insert exactly one newline + list prefix (no blank line)
    const insert = '\n' + nextPrefix
    dispatch(state.update({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + insert.length },
      scrollIntoView: true,
    }))
    return true
  }
  return cm.view.keymap.of([{ key: 'Enter', run: smartEnterRun }])
}

// ─── Inline format shortcuts ──────────────────────────────────────────────────
export function makeFormatKeys(cm) {
  const wrap = m => ({ state, dispatch }) => {
    const changes = state.selection.ranges.map(r => {
      const sel = state.doc.sliceString(r.from, r.to)
      return { from: r.from, to: r.to, insert: sel ? `${m}${sel}${m}` : `${m}${m}` }
    })
    dispatch(state.update({ changes, scrollIntoView: true }))
    return true
  }
  const link = ({ state, dispatch }) => {
    const sel = state.doc.sliceString(state.selection.main.from, state.selection.main.to)
    dispatch(state.update({ changes: { from: state.selection.main.from, to: state.selection.main.to, insert: sel ? `[${sel}](url)` : '[link text](url)' }, scrollIntoView: true }))
    return true
  }
  return cm.view.keymap.of([
    { key: 'Mod-b', run: wrap('**') },
    { key: 'Mod-i', run: wrap('*') },
    { key: 'Mod-e', run: wrap('`') },
    { key: 'Mod-k', run: link },
    { key: 'Mod-Shift-h', run: wrap('==') },
  ])
}


// ─── Ghost hint plugin ────────────────────────────────────────────────────────
// Shows placeholder ghost text after typing an opening syntax token.
// Tab accepts. Ghost dismisses automatically when cursor moves away or a space
// is typed. The opening syntax markers are NEVER removed — space after syntax
// means the user intended them as literal text.
export function makeGhostHintPlugin(cm) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view

  const HINTS = {
    '***': '***',
    '**':  '**',
    '*':   '*',
    '___': '___',
    '__':  '__',
    '_':   '_',
    '~~':  '~~',
    '==':  '==',
    '`':   '`',
    '$$':  '$$',
    '$':   '$',
  }

  class GhostWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-ghost-hint'
      span.textContent = this.text
      span.setAttribute('aria-hidden', 'true')
      return span
    }
    eq(o) { return o instanceof GhostWidget && o.text === this.text }
    ignoreEvent() { return true }
  }

  const ghostPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; this._compute(view) }
    update(upd) { if (upd.docChanged || upd.startState.selection.main.head !== upd.state.selection.main.head) this._compute(upd.view) }
    _compute(view) {
      const { state } = view
      const cur = state.selection.main
      if (!cur.empty) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }
      const line = state.doc.lineAt(cur.head)
      const col = cur.head - line.from
      const textBefore = line.text.slice(0, col)
      const after = line.text.slice(col)

      let matched = null
      for (const token of ['***', '___', '$$', '**', '__', '~~', '==', '*', '_', '`', '$']) {
        if (textBefore.endsWith(token)) {
          const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const count = (textBefore.match(new RegExp(escaped, 'g')) || []).length
          if (count % 2 === 1 && !after.includes(token)) {
            matched = token; break
          }
        }
      }

      // If we had a ghost and user typed a letter (not space), persist it
      if (!matched && this._activeToken && this._hint) {
        const lastChar = col > 0 ? line.text[col - 1] : ''
        // Space or moving away → dismiss ghost, keep syntax as-is
        if (lastChar === ' ' || lastChar === '') {
          this.deco = Decoration.none; this._hint = null; this._activeToken = null; return
        }
        const close = HINTS[this._activeToken]
        const escaped = this._activeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const count = (textBefore.match(new RegExp(escaped, 'g')) || []).length
        if (count % 2 === 1 && !after.includes(close)) {
          const builder = new cm.state.RangeSetBuilder()
          try {
            builder.add(cur.head, cur.head, Decoration.widget({ widget: new GhostWidget(close), side: 1 }))
          } catch { /* ignore */ }
          this.deco = builder.finish()
          this._hint = { pos: cur.head, insert: close }
          return
        }
      }

      if (!matched || !HINTS[matched]) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }
      const close = HINTS[matched]

      if (after.startsWith(close)) { this.deco = Decoration.none; this._hint = null; this._activeToken = null; return }

      const builder = new cm.state.RangeSetBuilder()
      try {
        builder.add(cur.head, cur.head, Decoration.widget({ widget: new GhostWidget(close), side: 1 }))
      } catch { /* ignore */ }
      this.deco = builder.finish()
      this._hint = { pos: cur.head, insert: close }
      this._activeToken = matched
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.decorations })

  // Only Tab to accept — no Enter handler, no space handler
  // Ghost dismisses automatically when cursor moves away (handled by _compute)
  const ghostKeymap = cm.state.Prec.high(cm.view.keymap.of([
    {
      key: 'Tab',
      run: view => {
        const plugin = view.plugin(ghostPlugin)
        if (!plugin?._hint) return false
        const { pos, insert } = plugin._hint
        if (view.state.selection.main.head !== pos) return false
        view.dispatch({
          changes: { from: pos, to: pos, insert },
          selection: { anchor: pos },
        })
        return true
      },
    },
  ]))

  return [ghostPlugin, ghostKeymap]
}


// ─── /table slash command ────────────────────────────────────────────────────
// Typing `/table` or `/table NxM` then Enter inserts a markdown table template.
export function makeTableCommand(cm) {
  const { Prec } = cm.state
  return Prec.high(cm.view.keymap.of([{
    key: 'Enter',
    run: (view) => {
      const { state } = view
      const line = state.doc.lineAt(state.selection.main.head)
      const match = line.text.match(/^\s*\/table(?:\s+(\d+)x(\d+))?\s*$/)
      if (!match) return false
      const cols = Math.min(parseInt(match[1]) || 3, 10)
      const rows = Math.min(parseInt(match[2]) || 2, 20)
      const header = '| ' + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(' | ') + ' |'
      const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |'
      const row = '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |'
      const table = [header, sep, ...Array(rows).fill(row)].join('\n')
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: table },
        selection: { anchor: line.from + 2 },
      })
      return true
    },
  }]))
}

// ─── Slash-command menu (Notion-style autocomplete) ──────────────────────────
// Typing `/` opens a menu of every command. Two kinds of entries:
//  • snippets — apply inserts the markdown directly
//  • machinery commands (/table, /todo, /math, …) — apply inserts the command
//    text; the existing Enter-keymap machinery expands it (menu = discovery
//    layer, expansion logic stays in one place)
// Returns a completion SOURCE, not an autocompletion() extension — CM6 allows
// exactly one autocompletion() config per editor ("Config merge conflict for
// field override" otherwise). The single instance lives in makeMathCalcPlugin;
// this source is passed into it. Future widget plugins must follow the same
// pattern: contribute sources, never call autocompletion() themselves.
export function makeSlashSource() {
  const machinery = (label, detail) =>
    ({ label, detail: `${detail} — press Enter`, type: 'keyword', apply: `${label} ` })
  const snippet = (label, detail, insert, cursorBack = 0) => ({
    label, detail, type: 'text',
    apply: (view, _c, from, to) => {
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length - cursorBack },
      })
    },
  })

  const OPTIONS = [
    machinery('/table',  'Insert a table (or /table 4x3)'),
    // '/todo' removed — it inserted plain text with no widget ever built to
    // render it (dead: no code created a `.cm-todo-block-w` element, only
    // orphaned CSS + a click handler remained). '/task' already IS a real
    // multi-column kanban board (see parseTaskBlock/serializeTaskBlock
    // below) — consolidated the two under one clearer name instead of
    // shipping a second, differently-named trigger for the same widget.
    machinery('/kanban', 'Task board (kanban)'),
    machinery('/math',  'Math zone (calculator)'),
    machinery('/timer', 'Countdown timer'),
    machinery('/linkf', 'Link a file'),
    machinery('/linkw', 'Link a webpage'),
    machinery('/linkv', 'Embed a video'),
    snippet('/h1', 'Heading 1', '# '),
    snippet('/h2', 'Heading 2', '## '),
    snippet('/h3', 'Heading 3', '### '),
    snippet('/bullet',   'Bulleted list',  '- '),
    snippet('/numbered', 'Numbered list',  '1. '),
    snippet('/check',    'Checkbox',       '- [ ] '),
    snippet('/quote',    'Quote block',    '> '),
    snippet('/callout',  'Callout (note)', '> [!note] Title\n> ', 0),
    snippet('/divider',  'Horizontal rule', '---\n'),
    snippet('/toc',      'Table of contents', '/toc\n'),
    snippet('/progress', 'Progress bar',    'progress:: 7/10 Label\n'),
    snippet('/rating',   'Star rating',     'rating:: 4/5\n'),
    snippet('/status',   'Status badge (click to cycle Todo/Doing/Blocked/Review/Done)', 'status:: Todo\n'),
    snippet('/code',     'Code block',     '```\n\n```', 5),
    snippet('/mermaid',  'Mermaid diagram', '```mermaid\nflowchart TD\n  A --> B\n```\n', 0),
    snippet('/date',     "Today's date",   new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })),
    snippet('/wiki',     'Wiki link',      '[[', 0),
  ]

  return (ctx) => {
    // Trigger on "/" at line start or after whitespace
    const word = ctx.matchBefore(/\/[\w-]*$/)
    if (!word) return null
    const before = ctx.state.doc.sliceString(Math.max(0, word.from - 1), word.from)
    if (before && !/\s/.test(before)) return null
    return { from: word.from, options: OPTIONS, validFor: /^\/[\w-]*$/ }
  }
}

// ─── Widgets ─────────────────────────────────────────────────────────────────

// Heading fold arrow — replaces the (already-hidden) # marks when a heading has
// foldable content below it. Click toggles CM6's native fold state for the
// section (this heading's line-end through the line before the next heading of
// equal-or-higher level). Chevron rotates 90deg when expanded, lucide chevron-right.
export class FoldArrowWidget {
  constructor(collapsed, foldFrom, foldTo) {
    this.collapsed = collapsed; this.foldFrom = foldFrom; this.foldTo = foldTo
  }
  toDOM() {
    const btn = document.createElement('span')
    btn.className = 'cm-fold-arrow' + (this.collapsed ? '' : ' cm-fold-arrow-open')
    btn.dataset.foldFrom = String(this.foldFrom)
    btn.dataset.foldTo = String(this.foldTo)
    btn.title = this.collapsed ? 'Expand section' : 'Collapse section'
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
    return btn
  }
  eq(o) { return o instanceof FoldArrowWidget && o.collapsed === this.collapsed && o.foldFrom === this.foldFrom && o.foldTo === this.foldTo }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

export class HRWidget {
  toDOM() {
    const d = document.createElement('div')
    d.className = 'cm-hr'
    return d
  }
  eq(o) { return o instanceof HRWidget }
  compare(o) { return o instanceof HRWidget }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return 2 }
  coordsAt() { return null }
}

export class ColumnsWidget {
  constructor(cols, innerHtml, rawText) { this.cols = cols; this.innerHtml = innerHtml; this.rawText = rawText }
  eq(o) { return o instanceof ColumnsWidget && o.rawText === this.rawText }
  compare(o) { return this.eq(o) }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-columns-widget'
    wrap.style.cssText = `column-count:${this.cols};column-gap:1.6em;column-rule:1px solid var(--border,#333);width:100%;box-sizing:border-box;padding:0.25em 0;`
    wrap.innerHTML = this.innerHtml
    return wrap
  }
  ignoreEvent() { return true }
  get estimatedHeight() { return 80 }
  coordsAt() { return null }
  destroy() {}
}

export class CheckboxWidget {
  constructor(checked, pos) { this.checked = checked; this.pos = pos }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-cb' + (this.checked ? ' cm-cb-on' : '')
    s.textContent = this.checked ? '✓' : ''
    s.dataset.pos = String(this.pos)
    return s
  }
  eq(o) { return o instanceof CheckboxWidget && o.checked === this.checked && o.pos === this.pos }
  compare(o) { return o instanceof CheckboxWidget && o.checked === this.checked && o.pos === this.pos }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

/**
 * Turn a markdown image `src` into something the webview can actually load.
 *
 * Relative paths are resolved against the notebook's folder — and crucially NOT
 * just `./`-prefixed ones. The app's own inserter writes `./images/x.png`, but
 * markdown written by hand, by another editor, or by an export tool normally
 * writes `images/x.png`. Those were left untouched, so the webview resolved
 * them against the page origin, 404'd, and the note showed the alt text in an
 * error pill instead of the picture.
 */
/**
 * Split an image's alt text into its display text and an optional width.
 *
 * Width is stored Obsidian-style INSIDE the alt (`![caption|600](src)`) rather
 * than as `![caption](src =600x)`. The `=600x` form is not valid CommonMark —
 * a space inside the parens that isn't a quoted title makes the whole thing not
 * an image, so the parser produced no Image node and the markdown leaked
 * through as raw text. That's why resizing an image always "broke" it.
 * Legacy `=Nx` is still read (see callers) so old notes keep working.
 */
export function parseImgAlt(alt) {
  let s = String(alt ?? '')
  let width = 0, align = null
  // Strip trailing `|600` and `:center` in EITHER order, repeatedly, so
  // `caption:center|600` and `caption|600:center` both work — and so neither
  // suffix leaks into the caption the reader sees.
  for (let i = 0; i < 2; i++) {
    let m = /^(.*)\|\s*(\d+)\s*$/.exec(s)
    if (m) { s = m[1]; width = parseInt(m[2], 10) || width; continue }
    m = /^(.*?):(left|right|center)\s*$/i.exec(s)
    if (m) { s = m[1]; align = m[2].toLowerCase(); continue }
    break
  }
  return { alt: s, width, align }
}

/** Rebuild an alt string from its parts — inverse of parseImgAlt. */
export function composeImgAlt(alt, width, align) {
  return `${alt}${align ? `:${align}` : ''}${width ? `|${width}` : ''}`
}

export function resolveImgSrc(src, notebookDir) {
  const s = String(src || '')
  if (!s) return s
  // Already loadable: data/blob URIs, or anything with an explicit scheme.
  if (/^(data:|blob:|[a-z][a-z0-9+.-]*:)/i.test(s)) return s
  if (!_convertFileSrc) return s
  // Absolute filesystem paths (POSIX or Windows).
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) return _convertFileSrc(s)
  if (!notebookDir) return s
  // Everything else is relative to the notebook: "./images/x", "images/x", "x".
  const rel = s.replace(/^\.\//, '')
  return _convertFileSrc(`${notebookDir.replace(/\/+$/, '')}/${rel}`)
}

// A src is "remote" if it's already loadable as-is (http(s), data, blob, or
// any other explicit scheme) — those work in any context, host or guest,
// with no resolution needed at all. Anything else is "local-looking": a
// relative or absolute filesystem path that only means something with a
// vault to resolve it against.
const _isRemoteSrc = s => /^(data:|blob:|[a-z][a-z0-9+.-]*:)/i.test(String(s || ''))

/** Resolve a local-looking image src against a room's published Yjs asset
 *  maps (`{ assetsMap, assetsMetaMap }`, from src/lib/collab/hostAssets.js /
 *  NoteCollabPanel.jsx) — the fallback `resolveImgSrc`+`_convertFileSrc` has
 *  no path for when there's no local vault at all (`notebookDir` null,
 *  PLAN_CONCURRENCY.md §18.4 "Phase B"). Mirrors
 *  src/lib/collab/assetsPlugin.js's own lookup exactly (same three states)
 *  so the plain guest editor and this real widget read the same published
 *  data with no drift — extends §6.7's asset pipeline, doesn't rebuild it.
 *  Caller owns the returned blob URL's lifetime (revoke once loaded/replaced,
 *  same discipline as assetsPlugin.js's LocalImageWidget). */
export function resolveAssetImg(src, assets) {
  const bytes = assets?.assetsMap?.get?.(src)
  if (bytes) return { status: 'ready', url: URL.createObjectURL(new Blob([bytes])) }
  if (assets?.assetsMetaMap?.get?.(src)?.oversized) return { status: 'oversized' }
  return { status: 'missing' }
}

export class ImgWidget {
  // `assets` — optional `{ assetsMap, assetsMetaMap }` (both Yjs Y.Maps), the
  // guest-safe alternative to `notebookDir`+`_convertFileSrc`. Only consulted
  // when `notebookDir` is null AND the src doesn't already resolve on its
  // own (a remote http(s)/data/blob URL never needs it) — a host with a real
  // vault never touches this path, zero behavior change for the common case.
  constructor(src, alt, notebookDir = null, from = -1, width = 0, align = null, assets = null) {
    this.src = src; this.alt = alt; this.notebookDir = notebookDir
    this.from = from  // doc offset for write-back on resize
    this.width = width  // user-set pixel width (0 = auto)
    this.align = align  // null | 'left' | 'right' | 'center'
    this.assets = assets
  }
  /** `{ mode: 'direct', src }` via the normal resolver, or `{ mode: 'asset',
   *  status, url? }` when falling back to the room's published asset map. */
  _resolveSrc() {
    if (!this.notebookDir && this.assets && !_isRemoteSrc(this.src)) {
      return { mode: 'asset', ...resolveAssetImg(this.src, this.assets) }
    }
    return { mode: 'direct', src: resolveImgSrc(this.src, this.notebookDir) }
  }
  /** Keep the wrapper hugging the image so the overlay controls (resize handle,
   *  align bar) sit on the image's own corners. Without this the wrapper can be
   *  full-width — the `.svg` no-intrinsic-size rule does exactly that — and the
   *  handle floats off to the right of the page instead of tracking the image. */
  /**
   * The widget's CURRENT document offset.
   *
   * `this.from` is captured when the widget is built, but `updateDOM` reuses the
   * existing DOM — so the resize/align handlers keep a closure over an OLD
   * widget whose `from` is stale as soon as anything above it edits the doc.
   * Writing back at a stale offset sliced the markdown mid-token, producing
   * corruption like `…maps to eac](…svg )` and `:cr|405`. A corrupted file then
   * no longer matched what the app held, which tripped the conflict-fork and
   * duplicated the note. Ask the view where this DOM node actually is instead.
   */
  _livePos(view, wrap) {
    try {
      const p = view.posAtDOM(wrap)
      if (Number.isInteger(p) && p >= 0 && p <= view.state.doc.length) return p
    } catch { /* fall back below */ }
    return this.from
  }
  _applySize(wrap, img) {
    if (this.width) {
      wrap.style.width = this.width + 'px'
      img.style.width = '100%'
    } else {
      wrap.style.width = ''
      img.style.width = ''
    }
  }
  /** Reflect the current alignment on the buttons (called on create AND update —
   *  updateDOM reuses the DOM, so without this the active state never changed
   *  and clicking a button looked like it did nothing). */
  _syncAlignButtons(wrap) {
    wrap.querySelectorAll('.cm-img-align-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.align === (this.align || ''))
    })
  }
  _applyAlign(wrap) {
    // NO FLOATS — an image owns its whole line and text never wraps beside it.
    // Alignment is purely which side of that line the image sits on, done with
    // auto margins so the resize handle and align bar stay on the image.
    wrap.style.float = ''
    wrap.style.marginBottom = ''
    wrap.style.display = 'block'
    if (this.align === 'center')     { wrap.style.marginLeft = 'auto'; wrap.style.marginRight = 'auto' }
    else if (this.align === 'right') { wrap.style.marginLeft = 'auto'; wrap.style.marginRight = '0' }
    else                             { wrap.style.marginLeft = '0';    wrap.style.marginRight = 'auto' }  // left / default
  }
  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-img-wrap'
    this._applyAlign(wrap)

    const resolved = this._resolveSrc()
    // Asset-map lookup came back empty — no img to show at all (nothing to
    // resize/align either), same "too large" / "not available yet" honesty
    // as assetsPlugin.js's LocalImageWidget for the exact same reason: no
    // way to tell "still arriving" from "host never had it" from here.
    if (resolved.mode === 'asset' && resolved.status !== 'ready') {
      const ph = document.createElement('div')
      ph.className = 'cm-img-asset-ph'
      ph.textContent = resolved.status === 'oversized'
        ? `🖼 ${this.alt || 'image'} — too large to preview`
        : `🖼 ${this.alt || 'image'} — not available yet`
      wrap.appendChild(ph)
      return wrap
    }

    const img = document.createElement('img')
    // Resolve relative paths (./images/...) or absolute paths to Tauri asset://
    // URLs — or, with no local vault at all, a blob URL from the room's
    // published asset map (see `_resolveSrc`, PLAN_CONCURRENCY.md §18.4).
    const resolvedSrc = resolved.mode === 'asset' ? resolved.url : resolved.src
    img.src = resolvedSrc; img.alt = this.alt; img.loading = 'lazy'
    img.className = 'cm-img'
    img.draggable = false
    img.setAttribute('draggable', 'false')
    if (resolved.mode === 'asset') {
      // Blob URL — the browser has its own decoded copy once loaded, and this
      // widget's DOM is reused (via eq()) rather than recreated on every
      // keystroke, so there's no later re-read of img.src that would need it
      // to still be valid. Same discipline as assetsPlugin.js's own widget.
      img.addEventListener('load', () => URL.revokeObjectURL(resolvedSrc), { once: true })
    }
    this._applySize(wrap, img)
    img.onerror = () => {
      img.style.display = 'none'
      const ph = document.createElement('span')
      ph.className = 'cm-img-err'
      ph.textContent = this.alt || this.src || 'image'
      wrap.appendChild(ph)
    }
    // Safety net for images with no intrinsic size (SVG with only a viewBox):
    // they load successfully but lay out at 0×0. Detect after layout and give
    // the wrapper a definite width so the aspect ratio has something to resolve
    // against. Covers sources the `[src*=".svg"]` rule can't match.
    img.addEventListener('load', () => {
      requestAnimationFrame(() => {
        if (!img.isConnected) return
        if (img.getBoundingClientRect().width < 1) wrap.classList.add('cm-img-nosize')
      })
    })

    // CodeMirror caches the height of every block widget. An image changes size
    // AFTER that measurement — it decodes asynchronously, the no-size fallback
    // above may widen it, and dragging the handle resizes it live. Without
    // telling the view, those cached heights go stale and the editor paints
    // blank regions / mis-positioned content. Re-measure on any size change.
    if (view && typeof ResizeObserver !== 'undefined') {
      let lastH = -1
      const ro = new ResizeObserver(() => {
        const h = Math.round(wrap.getBoundingClientRect().height)
        if (h === lastH) return
        lastH = h
        try { view.requestMeasure() } catch { /* view torn down */ }
      })
      ro.observe(wrap)
      this._ro = ro   // disconnected in destroy()
    }
    wrap.appendChild(img)

    // ── Resize handle ──────────────────────────────────────────────────────
    if (view && this.from >= 0) {
      const handle = document.createElement('div')
      handle.className = 'cm-img-resize-handle'
      handle.title = 'Drag to resize'
      let startX = 0, startW = 0
      handle.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation()
        startX = e.clientX
        startW = wrap.offsetWidth || img.offsetWidth || this.width || 200
        handle.setPointerCapture(e.pointerId)
        // Widest the image may become: the editor line it sits on.
        const maxW = Math.max(80, (wrap.parentElement?.clientWidth || startW))
        let liveW = startW
        const onMove = ev => {
          // Size the WRAPPER, not just the image. The image is width:100% of the
          // wrapper, so setting the image alone could never grow past the
          // wrapper's fixed width — that's why resizing only ever shrank. Moving
          // the wrapper also keeps the handle glued to the corner DURING the
          // drag instead of snapping into place afterwards.
          liveW = Math.min(maxW, Math.max(60, startW + (ev.clientX - startX)))
          wrap.style.width = liveW + 'px'
          img.style.width = '100%'
        }
        const onUp = () => {
          handle.removeEventListener('pointermove', onMove)
          const newW = Math.max(60, Math.round(liveW || wrap.offsetWidth || startW))
          if (!view.state) return
          const pos = this._livePos(view, wrap)
          if (!(pos >= 0) || pos >= view.state.doc.length) return
          const line = view.state.doc.lineAt(pos)
          const raw = line.text
          // Rewrite THIS image's width spec, located at the widget's own offset.
          // The previous version anchored on the line's trailing ")", so an
          // image with any text after it on the line was rewritten wrongly (or
          // not at all).
          const col = Math.max(0, pos - line.from)
          // Safety: only write if an image starts EXACTLY here. A drifted
          // offset used to slice mid-token and corrupt the markdown.
          if (raw.slice(col, col + 2) !== '![') return
          const m = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+=\d+x)?(?:\s+"([^"]*)")?\)/.exec(raw.slice(col))
          if (!m) return
          const title = m[3] ? ` "${m[3]}"` : ''
          // Write the width into the ALT (`caption|600`) — valid CommonMark, so
          // the image still parses. Any legacy `=Nx` is dropped in the process.
          // Alignment is preserved rather than clobbered by a resize.
          const pa = parseImgAlt(m[1])
          const replacement = `![${composeImgAlt(pa.alt, newW, pa.align)}](${m[2]}${title})`
          const updated = raw.slice(0, col) + replacement + raw.slice(col + m[0].length)
          if (updated !== raw) {
            view.dispatch({ changes: { from: line.from, to: line.to, insert: updated }, scrollIntoView: false })
          }
        }
        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', onUp, { once: true })
      })
      wrap.appendChild(handle)

      // ── Alignment buttons ────────────────────────────────────────────────
      // Alignment was already understood by the renderer but there was no way
      // to set it short of hand-editing the alt text. Same hover affordance as
      // the resize handle; writes `:left|:center|:right` into the alt.
      const bar = document.createElement('div')
      bar.className = 'cm-img-align-bar'
      const setAlign = (next) => {
        if (!view.state) return
        const pos = this._livePos(view, wrap)
        if (!(pos >= 0) || pos >= view.state.doc.length) return
        const line = view.state.doc.lineAt(pos)
        const raw = line.text
        const col = Math.max(0, pos - line.from)
        if (raw.slice(col, col + 2) !== '![') return
        const mm = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x)?(?:\s+"([^"]*)")?\)/.exec(raw.slice(col))
        if (!mm) return
        const pa = parseImgAlt(mm[1])
        const width = pa.width || (mm[3] ? parseInt(mm[3], 10) : 0)
        const title = mm[4] ? ` "${mm[4]}"` : ''
        // Clicking the active alignment clears it (back to default flow).
        const align = pa.align === next ? null : next
        const updated = raw.slice(0, col)
          + `![${composeImgAlt(pa.alt, width, align)}](${mm[2]}${title})`
          + raw.slice(col + mm[0].length)
        if (updated !== raw) {
          view.dispatch({ changes: { from: line.from, to: line.to, insert: updated }, scrollIntoView: false })
        }
      }
      for (const [key, label, title] of [
        ['left', '⇤', 'Align left (wrap text)'],
        ['center', '↔', 'Center'],
        ['right', '⇥', 'Align right (wrap text)'],
      ]) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'cm-img-align-btn'
        b.dataset.align = key
        b.textContent = label
        b.title = title
        b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation() })
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setAlign(key) })
        bar.appendChild(b)
      }
      wrap.appendChild(bar)
      this._syncAlignButtons(wrap)
    }

    return wrap
  }
  eq(o) { return o instanceof ImgWidget && o.src === this.src && o.notebookDir === this.notebookDir && o.width === this.width && o.align === this.align }
  compare(o) { return o instanceof ImgWidget && o.src === this.src && o.notebookDir === this.notebookDir && o.width === this.width && o.align === this.align }
  // Called when eq() is false — update DOM in-place to avoid flash
  updateDOM(dom) {
    const img = dom.querySelector('.cm-img')
    // No `.cm-img` to update — either this was already a placeholder, or the
    // src/notebookDir change now needs one (asset went from ready to
    // oversized/missing, or vice versa). Either way a plain DOM patch can't
    // get there from here — fall through to a full toDOM() remount.
    if (!img) return false
    const resolved = this._resolveSrc()
    if (resolved.mode === 'asset' && resolved.status !== 'ready') return false
    const resolvedSrc = resolved.mode === 'asset' ? resolved.url : resolved.src
    img.src = resolvedSrc
    if (resolved.mode === 'asset') {
      img.addEventListener('load', () => URL.revokeObjectURL(resolvedSrc), { once: true })
    }
    this._applySize(dom, img)
    this._applyAlign(dom)
    this._syncAlignButtons(dom)
    return true  // reuse DOM, no remount flash
  }
  destroy() { try { this._ro?.disconnect() } catch { /* already gone */ } }
  ignoreEvent() { return false }
  get estimatedHeight() { return 160 }
  coordsAt() { return null }
}

// ─── Timer persistence — survives widget reconstruction within a session ──────
export const _timerPersist = new Map() // rawLine → { remaining: number, paused: boolean }

// ─── Due-date helpers ────────────────────────────────────────────────────────
export function parseDueDate(expr) {
  try {
    if (!expr) return null
    // Relative: +2d, +3h
    const rel = expr.match(/^\+(\d+)([dh])$/)
    if (rel) {
      const n = parseInt(rel[1]), unit = rel[2]
      const d = new Date()
      if (unit === 'd') d.setDate(d.getDate() + n)
      else d.setHours(d.getHours() + n)
      return d
    }
    // HH:MM (time today)
    const tod = expr.match(/^(\d{1,2}):(\d{2})$/)
    if (tod) {
      const d = new Date()
      d.setHours(parseInt(tod[1]), parseInt(tod[2]), 0, 0)
      return d
    }
    // YYYY-MM-DD or YYYY-MM-DD,HH:MM
    const ymd = expr.match(/^(\d{4}-\d{2}-\d{2})(?:,(\d{1,2}:\d{2}))?$/)
    if (ymd) return new Date(ymd[2] ? `${ymd[1]}T${ymd[2]}` : `${ymd[1]}T00:00`)
    // DD-MM-YYYY or DD-MM-YYYY,HH:MM
    const dmy4 = expr.match(/^(\d{2})-(\d{2})-(\d{4})(?:,(\d{1,2}:\d{2}))?$/)
    if (dmy4) {
      const [, dd, mm, yyyy, t] = dmy4
      return new Date(t ? `${yyyy}-${mm}-${dd}T${t}` : `${yyyy}-${mm}-${dd}T00:00`)
    }
    // DD-MM-YY or DD-MM-YY,HH:MM (2-digit year → 2000s)
    const dmy2 = expr.match(/^(\d{2})-(\d{2})-(\d{2})(?:,(\d{1,2}:\d{2}))?$/)
    if (dmy2) {
      const [, dd, mm, yy, t] = dmy2
      const yyyy = 2000 + parseInt(yy)
      return new Date(t ? `${yyyy}-${mm}-${dd}T${t}` : `${yyyy}-${mm}-${dd}T00:00`)
    }
    return null
  } catch { return null }
}
export function formatDueBadge(expr) {
  const d = parseDueDate(expr)
  if (!d) return expr
  // Relative: +2d or +2h → show as-is
  if (/^\+\d+[dh]$/.test(expr)) return expr
  // Time-only: @HH:MM
  if (/^\d{1,2}:\d{2}$/.test(expr)) {
    const [h, m] = expr.split(':')
    return `@${h.padStart(2, '0')}:${m}`
  }
  // Any format with time (contains comma) → "Mar 18 @14:30"
  const timeMatch = expr.match(/,(\d{1,2}:\d{2})$/)
  if (timeMatch) return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} @${timeMatch[1]}`
  // Date-only → "Mar 18"
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export class DueDateWidget {
  constructor(expr) { this.expr = expr }
  toDOM() {
    const span = document.createElement('span')
    const d = parseDueDate(this.expr)
    const now = new Date()
    const isOverdue = d && d < now
    const isSoon = d && !isOverdue && (d - now) < 1000 * 60 * 60 * 24
    span.className = 'cm-due-badge' + (isOverdue ? ' cm-due-overdue' : isSoon ? ' cm-due-today' : '')
    span.textContent = formatDueBadge(this.expr)
    return span
  }
  eq(o) { return o instanceof DueDateWidget && o.expr === this.expr }
  compare(o) { return o instanceof DueDateWidget && o.expr === this.expr }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// ─── ?[question](ref) — review/flashcard question widget ─────────────────────
// `storeApi` — optional `{ getFlashcardDecks(), addCardToDeck(deckId, card) }`,
// injected rather than read from a hard `useAppStore` import. This file gets
// imported into the web guest bundle (PLAN_CONCURRENCY.md §18.6 "Phase D"),
// which must never transitively pull in the desktop app's whole state layer
// (@/store/useAppStore → @/lib/storage → Tauri fs) just to build a shared
// widget — that's exactly the "guest touching disk is structurally
// impossible" guarantee §6.6 already established for hostAssets.js, extended
// here to this file too. Defaults below make an un-injected widget behave
// exactly like the pre-decoupling code did when there's nothing to read
// (empty deck list, add-to-deck a no-op) — the real store-backed behavior is
// NotebookView.jsx's own responsibility to inject (see its makeLivePlugin
// call site), unchanged from before this move.
const _NOOP_QUESTION_STORE = { getFlashcardDecks: () => [], addCardToDeck: () => {} }
export class QuestionWidget {
  constructor(fullAlt, ref, rawText, from, storeApi = null) {
    // Parse "question:answer" — colon separates front from back of card
    const sep = fullAlt.indexOf(':')
    this.question = (sep >= 0 ? fullAlt.slice(0, sep) : fullAlt).trim()
    this.answer   = (sep >= 0 ? fullAlt.slice(sep + 1) : '').trim()
    this.fullAlt  = fullAlt   // preserved for write-back
    this.ref = ref            // '' | 'YYYY-MM-DD' | deck-id
    this.rawText = rawText
    this.from = from
    this.storeApi = storeApi || _NOOP_QUESTION_STORE
  }
  toDOM(cmView) {
    const wrap = document.createElement('span')
    wrap.className = 'cm-question-widget'

    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(this.ref)
    const decks = this.storeApi.getFlashcardDecks() || []
    const linkedDeck = this.ref && !isDate ? decks.find(d => d.id === this.ref) : null

    const badge = document.createElement('span')
    const qText = this.question || '…'
    const mkSpan = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s }
    if (linkedDeck) {
      badge.className = 'cm-question-badge cm-question-flash'
      badge.appendChild(mkSpan('cm-q-text', qText))
      badge.appendChild(mkSpan('cm-q-ref', `\uD83C\uDFA0 ${linkedDeck.title}`))
    } else if (isDate) {
      badge.className = 'cm-question-badge cm-question-date'
      badge.appendChild(mkSpan('cm-q-text', qText))
      badge.appendChild(mkSpan('cm-q-ref', `\uD83D\uDDD3 ${this.ref}`))
    } else {
      badge.className = 'cm-question-badge cm-question-open'
      badge.appendChild(mkSpan('cm-q-mark', '?'))
      badge.appendChild(mkSpan('cm-q-text', qText))
    }

    badge.onclick = (e) => {
      e.preventDefault(); e.stopPropagation()
      const existing = document.querySelector('.cm-question-dropdown')
      if (existing) {
        const isSame = existing._sourceBadge === badge
        existing.remove()
        if (isSame) return
      }

      const dropdown = document.createElement('div')
      dropdown.className = 'cm-question-dropdown'
      dropdown._sourceBadge = badge

      // ── Section: Answer reveal ────────────────────────────
      const answerSection = document.createElement('div')
      answerSection.className = 'cm-qd-section cm-qd-answer-section'
      const answerLabel = document.createElement('div')
      answerLabel.className = 'cm-qd-label'
      answerLabel.textContent = 'Answer'
      answerSection.appendChild(answerLabel)
      if (this.answer) {
        const answerBody = document.createElement('div')
        answerBody.className = 'cm-qd-answer-body cm-qd-answer-hidden'
        answerBody.textContent = this.answer
        const revealBtn = document.createElement('button')
        revealBtn.className = 'cm-qd-reveal-btn'
        revealBtn.textContent = 'Reveal'
        revealBtn.onclick = () => {
          answerBody.classList.toggle('cm-qd-answer-hidden')
          revealBtn.textContent = answerBody.classList.contains('cm-qd-answer-hidden') ? 'Reveal' : 'Hide'
        }
        answerSection.appendChild(answerBody)
        answerSection.appendChild(revealBtn)
      } else {
        const noAnswer = document.createElement('div')
        noAnswer.className = 'cm-qd-none'
        noAnswer.textContent = 'No answer — add one with ?[question:answer]()'
        answerSection.appendChild(noAnswer)
      }
      dropdown.appendChild(answerSection)

      // ── Divider ───────────────────────────────────────────
      const divider = document.createElement('div')
      divider.className = 'cm-qd-divider'
      dropdown.appendChild(divider)

      // ── Section: Set review date ──────────────────────────
      const dateSection = document.createElement('div')
      dateSection.className = 'cm-qd-section'
      const dateLabel = document.createElement('div')
      dateLabel.className = 'cm-qd-label'
      dateLabel.textContent = 'Set review date'
      const dateRow = document.createElement('div')
      dateRow.className = 'cm-qd-row'
      const dateInp = document.createElement('input')
      dateInp.type = 'date'
      dateInp.className = 'cm-qd-date-inp'
      dateInp.value = isDate ? this.ref : ''
      const dateConfirm = document.createElement('button')
      dateConfirm.className = 'cm-qd-confirm'
      dateConfirm.textContent = 'Set'
      dateConfirm.onclick = () => {
        const v = dateInp.value
        if (!v) return
        _replaceInDoc(cmView, this.rawText, `?[${this.fullAlt}](${v})`)
        dropdown.remove()
      }
      dateRow.appendChild(dateInp)
      dateRow.appendChild(dateConfirm)
      dateSection.appendChild(dateLabel)
      dateSection.appendChild(dateRow)

      // ── Section: Add to flashcard deck ────────────────────
      const flashSection = document.createElement('div')
      flashSection.className = 'cm-qd-section'
      const flashLabel = document.createElement('div')
      flashLabel.className = 'cm-qd-label'
      flashLabel.textContent = 'Add to flashcard deck'
      flashSection.appendChild(flashLabel)

      const freshDecks = this.storeApi.getFlashcardDecks() || []
      if (freshDecks.length === 0) {
        const none = document.createElement('div')
        none.className = 'cm-qd-none'
        none.textContent = 'No flashcard decks yet'
        flashSection.appendChild(none)
      } else {
        freshDecks.forEach(deck => {
          const btn = document.createElement('button')
          btn.className = 'cm-qd-deck-btn' + (deck.id === this.ref ? ' cm-qd-deck-active' : '')
          btn.textContent = deck.title || 'Untitled Deck'
          btn.onclick = () => {
            const card = {
              id: `fc-${Date.now()}`,
              front: this.question,
              back: this.answer,    // answer after ':' becomes the card back
              nextReview: 0, interval: 1, ease: 2.5, repetitions: 0
            }
            this.storeApi.addCardToDeck(deck.id, card)
            _replaceInDoc(cmView, this.rawText, `?[${this.fullAlt}](${deck.id})`)
            dropdown.remove()
          }
          flashSection.appendChild(btn)
        })
      }

      dropdown.appendChild(dateSection)
      dropdown.appendChild(flashSection)
      document.body.appendChild(dropdown)

      const rect = badge.getBoundingClientRect()
      const ddW = 240
      let left = rect.left
      if (left + ddW > window.innerWidth - 8) left = window.innerWidth - ddW - 8
      dropdown.style.cssText = `position:fixed;top:${rect.bottom + 6}px;left:${left}px;z-index:9999;`

      const close = (ev) => {
        if (!dropdown.contains(ev.target) && ev.target !== badge) {
          dropdown.remove()
          document.removeEventListener('mousedown', close, true)
        }
      }
      setTimeout(() => document.addEventListener('mousedown', close, true), 10)
    }

    wrap.appendChild(badge)
    return wrap
  }
  eq(o) { return o instanceof QuestionWidget && o.fullAlt === this.fullAlt && o.ref === this.ref }
  compare(o) { return this.eq(o) }
  destroy() { document.querySelector('.cm-question-dropdown')?.remove() }
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// Time reference widget — renders @HH:MM or @hh:mmam/pm as a styled time badge
export class TimeRefWidget {
  constructor(raw, display) { this.raw = raw; this.display = display }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-time-badge'
    span.textContent = this.display
    return span
  }
  eq(o) { return o instanceof TimeRefWidget && o.raw === this.raw }
  compare(o) { return o instanceof TimeRefWidget && o.raw === this.raw }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// Tag widget — renders ::tagname as a subtle #tag badge
export class TagWidget {
  constructor(tag) { this.tag = tag }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-tag-badge'
    span.textContent = this.tag
    return span
  }
  eq(o) { return o instanceof TagWidget && o.tag === this.tag }
  compare(o) { return o instanceof TagWidget && o.tag === this.tag }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// ─── status:: field — clickable status badge (Todo/Doing/Blocked/Review/Done) ─
// Icons are lucide glyphs (Circle/CircleDot/CircleSlash/Eye/CircleCheck), inlined
// as raw SVG strings — CM6 widgets are plain DOM, not JSX, so they can't use the
// lucide-react components directly. Same convention as _LINK_ICONS/_GLOBE_ICON.
export const _STATUS_DEFS = [
  { value: 'Todo', color: '#8b949e',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>` },
  { value: 'Doing', color: '#388bfd',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>` },
  { value: 'Blocked', color: '#f85149',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/></svg>` },
  { value: 'Review', color: '#a371f7',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>` },
  { value: 'Done', color: '#3fb950',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>` },
]
export function _statusDefIdx(value) {
  const i = _STATUS_DEFS.findIndex(d => d.value.toLowerCase() === String(value || '').toLowerCase())
  return i === -1 ? 0 : i
}
export class StatusWidget {
  constructor(value, pos) { this.idx = _statusDefIdx(value); this.pos = pos }
  toDOM() {
    const def = _STATUS_DEFS[this.idx]
    const span = document.createElement('span')
    span.className = 'cm-status-badge'
    span.dataset.pos = String(this.pos)
    span.title = 'Click to change status'
    span.style.color = def.color
    span.style.background = def.color + '18'
    span.style.borderColor = def.color + '40'
    span.innerHTML = def.icon
    const label = document.createElement('span')
    label.className = 'cm-status-label'
    label.textContent = def.value
    span.appendChild(label)
    return span
  }
  eq(o) { return o instanceof StatusWidget && o.idx === this.idx && o.pos === this.pos }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// List marker widget — shows styled bullet or number when cursor is off the line
export class ListMarkerWidget {
  constructor(text, isOrdered) { this.text = text; this.isOrdered = isOrdered }
  toDOM() {
    const span = document.createElement('span')
    span.className = this.isOrdered ? 'cm-list-marker cm-list-marker-ord' : 'cm-list-marker'
    span.textContent = this.isOrdered ? this.text : '•'
    return span
  }
  eq(w) { return w instanceof ListMarkerWidget && w.text === this.text && w.isOrdered === this.isOrdered }
  compare(w) { return w instanceof ListMarkerWidget && w.text === this.text && w.isOrdered === this.isOrdered }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return -1 }
  coordsAt() { return null }
}

// MathQuill-backed widget — renders math, clicking opens an inline MathQuill editor
export class MathWidget {
  constructor(tex, display, from, to) {
    this.tex = tex
    this.display = display
    this.from = from   // doc position — used to commit edits back
    this.to = to
  }
  toDOM() {
    const wrap = document.createElement(this.display ? 'div' : 'span')
    wrap.className = this.display ? 'cm-math-block cm-math-mq' : 'cm-math-inline cm-math-mq'
    wrap.dataset.latex = this.tex
    wrap.dataset.display = this.display ? '1' : '0'
    wrap.title = 'Click to edit'
    // Render static math immediately
    const staticSpan = document.createElement('span')
    wrap.appendChild(staticSpan)
    renderMathStatic(staticSpan, this.tex, this.display)
    return wrap
  }
  eq(o) { return o instanceof MathWidget && o.tex === this.tex && o.display === this.display }
  compare(o) { return o instanceof MathWidget && o.tex === this.tex && o.display === this.display }
  destroy() {}
  ignoreEvent() { return false }
  get estimatedHeight() { return this.display ? 44 : 22 }
  coordsAt() { return null }
}

export class WikiWidget {
  constructor(title, cls, type, id) { this.title = title; this.cls = cls; this.type = type; this.id = id }
  toDOM() {
    const s = document.createElement('span')
    s.className = this.cls
    s.textContent = this.title
    s.dataset.wlType = this.type; s.dataset.wlId = this.id; s.dataset.wlTitle = this.title
    // `unavailable` (PLAN_CONCURRENCY.md §18.5) is a DIFFERENT unresolved state
    // from `new`: `new` means "checked your vault, this doesn't exist yet —
    // click to create it," which is only true when there IS a vault to check.
    // A guest has none, so offering "Create: X" would be an honest-looking lie
    // for a click that (makeWikiHandler, no onNavRef wired) already safely
    // does nothing — say so instead of implying an action that can't happen.
    s.title = this.type === 'unavailable' ? 'Not available in a shared note'
      : this.type.startsWith('new') ? `Create: ${this.title}` : `Open ${this.type}`
    return s
  }
  eq(o) { return o instanceof WikiWidget && o.title === this.title && o.cls === this.cls }
  compare(o) { return o instanceof WikiWidget && o.title === this.title && o.cls === this.cls }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

export class LinkWidget {
  constructor(text, href) { this.text = text; this.href = href }
  toDOM() {
    const a = document.createElement('a')
    a.className = 'cm-link-widget'
    a.textContent = this.text || this.href
    a.href = this.href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.title = this.href
    a.addEventListener('click', e => {
      e.preventDefault()
      const href = this.href
      if (/^https?:\/\//i.test(href)) {
        if (_invoke) _invoke('plugin:shell|open', { path: href }).catch(() => window.open(href, '_blank'))
        else window.open(href, '_blank')
      } else if (_invoke) {
        _invoke('open_in_finder', { path: href }).catch(() => {})
      }
    })
    return a
  }
  eq(o) { return o instanceof LinkWidget && o.text === this.text && o.href === this.href }
  compare(o) { return o instanceof LinkWidget && o.text === this.text && o.href === this.href }
  destroy() {}
  ignoreEvent() { return true }
  coordsAt() { return null }
}

// ─── Widget helpers ───────────────────────────────────────────────────────────

// Custom date/time picker popup
export const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export function showDateTimePicker(anchorEl, currentDate, currentTime, onChange) {
  document.querySelectorAll('.gnos-dtp').forEach(e => e.remove())
  const todayD = new Date()
  const todayStr = `${todayD.getFullYear()}-${String(todayD.getMonth()+1).padStart(2,'0')}-${String(todayD.getDate()).padStart(2,'0')}`
  let selDate = currentDate || '', selTime = currentTime || ''
  let viewYear = todayD.getFullYear(), viewMonth = todayD.getMonth()
  if (selDate) { try { const d = new Date(selDate + 'T00:00'); viewYear = d.getFullYear(); viewMonth = d.getMonth() } catch {} }

  const popup = document.createElement('div')
  popup.className = 'gnos-dtp'

  const render = () => {
    popup.innerHTML = ''
    // Nav row
    const nav = document.createElement('div'); nav.className = 'gnos-dtp-nav'
    const prev = document.createElement('button'); prev.className = 'gnos-dtp-nav-btn'; prev.textContent = '‹'
    prev.onclick = e => { e.stopPropagation(); if (--viewMonth < 0) { viewMonth = 11; viewYear-- }; render() }
    const lbl = document.createElement('span'); lbl.className = 'gnos-dtp-month-label'
    lbl.textContent = `${_MONTHS[viewMonth]} ${viewYear}`
    const next = document.createElement('button'); next.className = 'gnos-dtp-nav-btn'; next.textContent = '›'
    next.onclick = e => { e.stopPropagation(); if (++viewMonth > 11) { viewMonth = 0; viewYear++ }; render() }
    nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next); popup.appendChild(nav)
    // Grid
    const grid = document.createElement('div'); grid.className = 'gnos-dtp-grid'
    for (const d of ['Su','Mo','Tu','We','Th','Fr','Sa']) {
      const h = document.createElement('div'); h.className = 'gnos-dtp-wday'; h.textContent = d; grid.appendChild(h)
    }
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    for (let i = 0; i < firstDay; i++) grid.appendChild(Object.assign(document.createElement('div'), { className: 'gnos-dtp-day gnos-dtp-empty' }))
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const el = document.createElement('div'); el.className = 'gnos-dtp-day'; el.textContent = String(d)
      if (ds === selDate) el.classList.add('gnos-dtp-selected')
      if (ds === todayStr) el.classList.add('gnos-dtp-today')
      el.onclick = ev => { ev.stopPropagation(); selDate = selDate === ds ? '' : ds; render() }
      grid.appendChild(el)
    }
    popup.appendChild(grid)
    // Time row
    const tr = document.createElement('div'); tr.className = 'gnos-dtp-time-row'
    const tl = document.createElement('span'); tl.className = 'gnos-dtp-time-label'; tl.textContent = 'Time'
    const ti = document.createElement('input'); ti.className = 'gnos-dtp-time-inp'; ti.type = 'time'; ti.value = selTime
    ti.onchange = e => { selTime = e.target.value || '' }
    tr.appendChild(tl); tr.appendChild(ti); popup.appendChild(tr)
    // Actions
    const acts = document.createElement('div'); acts.className = 'gnos-dtp-actions'
    const clr = document.createElement('button'); clr.className = 'gnos-dtp-clear'; clr.textContent = 'Clear'
    clr.onclick = e => { e.stopPropagation(); onChange('', ''); popup.remove() }
    const done = document.createElement('button'); done.className = 'gnos-dtp-done'; done.textContent = 'Done'
    done.onclick = e => { e.stopPropagation(); onChange(selDate, selTime); popup.remove() }
    acts.appendChild(clr); acts.appendChild(done); popup.appendChild(acts)
  }
  render()
  // Position
  const rect = anchorEl.getBoundingClientRect()
  let left = rect.left, top = rect.bottom + 6
  if (left + 222 > window.innerWidth) left = window.innerWidth - 228
  if (top + 300 > window.innerHeight) top = rect.top - 306
  popup.style.cssText = `position:fixed;left:${left}px;top:${Math.max(4, top)}px;z-index:10000;`
  document.body.appendChild(popup)
  const outside = e => { if (!popup.contains(e.target) && e.target !== anchorEl) { popup.remove(); document.removeEventListener('mousedown', outside) } }
  setTimeout(() => document.addEventListener('mousedown', outside), 0)
}
export function _replaceInDoc(view, oldText, newText, hintFrom = -1) {
  if (!view) return false
  const doc = view.state.doc.toString()
  // Try near the known position first (most reliable), then fall back to full scan
  let idx = -1
  if (hintFrom >= 0) {
    const window = 200
    const start = Math.max(0, hintFrom - window)
    const end = Math.min(doc.length, hintFrom + oldText.length + window)
    const slice = doc.slice(start, end)
    const local = slice.indexOf(oldText)
    if (local !== -1) idx = start + local
  }
  if (idx === -1) idx = doc.indexOf(oldText)
  if (idx === -1) return false
  view.dispatch({ changes: { from: idx, to: idx + oldText.length, insert: newText }, scrollIntoView: false })
  return true
}

// ─── /habits widget (habit tracker with day grid + line graph) ───────────────
export class HabitsWidget {
  constructor(rawData, rawLine, blockFrom = -1) {
    this.rawLine = rawLine; this.blockFrom = blockFrom
    try { this.data = rawData ? JSON.parse(rawData) : {} }
    catch { this.data = {} }
    if (!this.data.habits) this.data.habits = []
    if (!this.data.log) this.data.log = {}
    if (!this.data.startDate) {
      const logKeys = Object.keys(this.data.log || {}).sort()
      this.data.startDate = logKeys.length > 0 ? logKeys[0] : new Date().toISOString().slice(0, 10)
    }
    if (!this.data.length) this.data.length = 30
    if (!this.data.view) this.data.view = 'grid'
    if (!this.data.title) this.data.title = 'Habits'
  }
  _serialize() { return `/habits:${JSON.stringify(this.data)}` }
  _dk(d) { return d.toISOString().slice(0, 10) }
  toDOM(cmView) {
    const data = this.data, widget = this
    const wrap = document.createElement('div')
    wrap.className = 'cm-habits-widget'

    const save = () => {
      const newLine = widget._serialize()
      if (_replaceInDoc(cmView, widget.rawLine, newLine, widget.blockFrom)) widget.rawLine = newLine
    }

    const render = () => {
      wrap.innerHTML = ''
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const todayKey = widget._dk(today)

      const start = new Date(data.startDate + 'T00:00:00')
      const dates = []
      for (let i = 0; i < data.length; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i); dates.push(d)
      }

      // ── Header ────────────────────────────────────────────────────────────
      const hdr = document.createElement('div')
      hdr.className = 'cm-habits-hdr'
      const titleEl = document.createElement('span')
      titleEl.className = 'cm-habits-title'
      titleEl.textContent = data.title || 'Habits'
      titleEl.title = 'Click to rename'
      titleEl.style.cursor = 'pointer'
      titleEl.onclick = e => {
        e.stopPropagation()
        const inp = document.createElement('input')
        inp.className = 'cm-habits-title-inp'
        inp.value = data.title || 'Habits'
        inp.style.cssText = 'font-size:13px;font-weight:700;background:transparent;border:none;border-bottom:1px solid var(--accent);outline:none;color:var(--text);width:120px;font-family:var(--font-ui);'
        hdr.replaceChild(inp, titleEl)
        inp.focus(); inp.select()
        const commit = () => {
          const v = inp.value.trim() || 'Habits'
          data.title = v; save(); render()
        }
        inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit() } else if (ev.key === 'Escape') render() }
        inp.onblur = commit
      }
      hdr.appendChild(titleEl)

      // ── Animated view toggle ─────────────────────────────────────────────
      const toggleBtn = document.createElement('button')
      toggleBtn.className = 'cm-habits-view-toggle'
      toggleBtn.dataset.view = data.view
      toggleBtn.title = data.view === 'grid' ? 'Switch to graph' : 'Switch to grid'
      toggleBtn.innerHTML = `<svg class="cm-habits-toggle-icon" data-for="grid" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg><svg class="cm-habits-toggle-icon" data-for="graph" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/></svg>`
      toggleBtn.onclick = e => { e.stopPropagation(); data.view = data.view === 'grid' ? 'graph' : 'grid'; save(); render() }
      hdr.appendChild(toggleBtn)

      // ── Delete widget button ──────────────────────────────────────────────
      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'cm-habits-delete-btn'
      deleteBtn.title = 'Delete habits tracker'
      deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
      deleteBtn.onclick = e => {
        e.stopPropagation()
        if (!cmView) return
        const doc = cmView.state.doc.toString()
        let idx = -1
        if (widget.blockFrom >= 0) {
          const s = Math.max(0, widget.blockFrom - 200)
          const slice = doc.slice(s, Math.min(doc.length, s + widget.rawLine.length + 400))
          const li = slice.indexOf(widget.rawLine)
          if (li !== -1) idx = s + li
        }
        if (idx === -1) idx = doc.indexOf(widget.rawLine)
        if (idx === -1) return
        const end = idx + widget.rawLine.length
        const to = end < doc.length && doc[end] === '\n' ? end + 1 : end
        cmView.dispatch({ changes: { from: idx, to }, scrollIntoView: false })
      }
      hdr.appendChild(deleteBtn)
      wrap.appendChild(hdr)

      // ── Content ───────────────────────────────────────────────────────────
      if (data.view === 'graph') {
        // Line graph view
        if (!data.habits.length) {
          const e = document.createElement('div'); e.className = 'cm-habits-empty'
          e.textContent = 'No habits yet'; wrap.appendChild(e)
        } else {
          const graphWrap = document.createElement('div')
          graphWrap.className = 'cm-habits-graph-wrap'
          const W = 600, H = 130, PAD_L = 28, PAD_R = 10, PAD_T = 10, PAD_B = 22
          const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B
          const maxY = data.habits.length
          const NS = 'http://www.w3.org/2000/svg'
          const svg = document.createElementNS(NS, 'svg')
          svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
          svg.style.cssText = 'width:100%;height:130px;display:block;overflow:visible'

          // Y gridlines + labels
          for (let y = 0; y <= maxY; y++) {
            const yPx = PAD_T + innerH - (y / maxY) * innerH
            const gl = document.createElementNS(NS, 'line')
            gl.setAttribute('x1', PAD_L); gl.setAttribute('x2', W - PAD_R)
            gl.setAttribute('y1', yPx); gl.setAttribute('y2', yPx)
            gl.setAttribute('stroke', 'var(--borderSubtle)'); gl.setAttribute('stroke-width', '1')
            svg.appendChild(gl)
            const lt = document.createElementNS(NS, 'text')
            lt.setAttribute('x', PAD_L - 4); lt.setAttribute('y', yPx + 4)
            lt.setAttribute('text-anchor', 'end'); lt.setAttribute('font-size', '9')
            lt.setAttribute('fill', 'var(--textDim)'); lt.textContent = String(y)
            svg.appendChild(lt)
          }

          // Data points
          const pts = dates.map((d, i) => {
            const k = widget._dk(d)
            const logRow = data.log[k]
            const count = logRow ? logRow.reduce((s, v) => s + (v ? 1 : 0), 0) : 0
            const x = PAD_L + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
            const y = PAD_T + innerH - (maxY > 0 ? (count / maxY) * innerH : 0)
            return { x, y, count, k, d }
          })

          if (pts.length > 1) {
            // Area
            const area = document.createElementNS(NS, 'path')
            area.setAttribute('d', `M${pts[0].x},${PAD_T + innerH} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[pts.length-1].x},${PAD_T + innerH} Z`)
            area.setAttribute('fill', 'var(--accent)'); area.setAttribute('fill-opacity', '0.12')
            svg.appendChild(area)
            // Line
            const lp = document.createElementNS(NS, 'path')
            lp.setAttribute('d', `M${pts.map(p => `${p.x},${p.y}`).join(' L')}`)
            lp.setAttribute('stroke', 'var(--accent)'); lp.setAttribute('stroke-width', '2')
            lp.setAttribute('fill', 'none'); lp.setAttribute('stroke-linejoin', 'round'); lp.setAttribute('stroke-linecap', 'round')
            svg.appendChild(lp)
          }

          // Dots
          pts.forEach(p => {
            const c = document.createElementNS(NS, 'circle')
            c.setAttribute('cx', p.x); c.setAttribute('cy', p.y)
            c.setAttribute('r', '3'); c.setAttribute('fill', 'var(--accent)')
            const t = document.createElementNS(NS, 'title')
            t.textContent = `${p.k}: ${p.count}/${maxY}`
            c.appendChild(t); svg.appendChild(c)
          })

          // X labels (sparse)
          const step = Math.max(1, Math.ceil(data.length / 7))
          pts.forEach((p, i) => {
            if (i % step !== 0 && i !== pts.length - 1) return
            const xt = document.createElementNS(NS, 'text')
            xt.setAttribute('x', p.x); xt.setAttribute('y', H - 4)
            xt.setAttribute('text-anchor', 'middle'); xt.setAttribute('font-size', '9')
            xt.setAttribute('fill', 'var(--textDim)')
            xt.textContent = `${p.d.getMonth()+1}/${p.d.getDate()}`
            svg.appendChild(xt)
          })

          graphWrap.appendChild(svg)
          wrap.appendChild(graphWrap)
        }
      } else {
        // Grid view
        if (!data.habits.length) {
          const e = document.createElement('div'); e.className = 'cm-habits-empty'
          e.textContent = 'No habits yet'; wrap.appendChild(e)
        } else {
          const grid = document.createElement('div')
          grid.className = 'cm-habits-grid'

          // Date header row
          const dateRow = document.createElement('div')
          dateRow.className = 'cm-habits-row date-hdr-row'
          const corner = document.createElement('div')
          corner.className = 'cm-habits-name-cell'
          dateRow.appendChild(corner)
          dates.forEach(d => {
            const k = widget._dk(d), lbl = document.createElement('div')
            lbl.className = 'cm-habits-day-lbl' + (k === todayKey ? ' cm-habits-today-lbl' : '')
            lbl.textContent = k === todayKey ? '•' : String(d.getDate())
            lbl.title = k
            dateRow.appendChild(lbl)
          })
          grid.appendChild(dateRow)

          // Habit rows — mouse-event-based reorder (avoids CodeMirror's capture-phase
          // dragover interception which prevents HTML5 DnD from working in live mode).
          data.habits.forEach((hName, hi) => {
            const row = document.createElement('div')
            row.className = 'cm-habits-row'
            row.dataset.hi = String(hi)
            const nameWrap = document.createElement('div')
            nameWrap.className = 'cm-habits-name-cell'
            // Drag handle — uses mousedown/mousemove/mouseup to bypass CM's
            // capture-phase dragover intercept that blocks HTML5 DnD in live mode.
            const dragHandle = document.createElement('span')
            dragHandle.className = 'cm-habits-drag-handle'
            dragHandle.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>'
            dragHandle.title = 'Drag to reorder'
            dragHandle.addEventListener('mousedown', e => {
              e.preventDefault(); e.stopPropagation()
              const allRows = [...grid.querySelectorAll('.cm-habits-row[data-hi]')]
              let targetIdx = hi

              const indicator = document.createElement('div')
              indicator.style.cssText = 'position:fixed;left:0;right:0;height:2px;background:var(--accent);pointer-events:none;z-index:99999;border-radius:2px;display:none;'
              document.body.appendChild(indicator)
              row.style.opacity = '0.4'

              const onMove = ev => {
                let newTarget = hi
                for (let i = 0; i < allRows.length; i++) {
                  const r = allRows[i]
                  const rect = r.getBoundingClientRect()
                  if (ev.clientY <= rect.top + rect.height / 2) { newTarget = parseInt(r.dataset.hi, 10); break }
                  newTarget = parseInt(r.dataset.hi, 10)
                }
                targetIdx = newTarget
                // Show insertion line above the target row
                const targetRow = allRows.find(r => parseInt(r.dataset.hi, 10) === targetIdx)
                if (targetRow && targetIdx !== hi) {
                  const rect = targetRow.getBoundingClientRect()
                  const insertBefore = ev.clientY <= rect.top + rect.height / 2
                  indicator.style.display = 'block'
                  indicator.style.top = (insertBefore ? rect.top : rect.bottom) - 1 + 'px'
                } else {
                  indicator.style.display = 'none'
                }
              }

              const onUp = () => {
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
                indicator.remove()
                row.style.opacity = ''
                if (targetIdx !== hi) {
                  const from = hi, to = targetIdx
                  const [movedH] = data.habits.splice(from, 1)
                  data.habits.splice(to, 0, movedH)
                  for (const k of Object.keys(data.log)) {
                    if (Array.isArray(data.log[k])) {
                      const [movedL] = data.log[k].splice(from, 1)
                      data.log[k].splice(to, 0, movedL ?? 0)
                    }
                  }
                  save(); render()
                }
              }

              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            })
            nameWrap.appendChild(dragHandle)
            const nameSpan = document.createElement('span')
            nameSpan.className = 'cm-habits-name'; nameSpan.textContent = hName; nameSpan.title = hName
            nameSpan.onclick = e => {
              e.stopPropagation()
              const inp = document.createElement('input')
              inp.className = 'cm-habits-name-inp'; inp.value = hName; inp.type = 'text'
              nameWrap.innerHTML = ''; nameWrap.appendChild(inp)
              inp.focus(); inp.select()
              const commit = () => { const v = inp.value.trim(); if (v) data.habits[hi] = v; save(); render() }
              inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit() } else if (ev.key === 'Escape') render() }
              inp.onblur = commit
            }
            const delBtn = document.createElement('button')
            delBtn.className = 'cm-habits-del'; delBtn.textContent = '×'; delBtn.title = 'Remove'
            delBtn.onclick = e => {
              e.stopPropagation()
              data.habits.splice(hi, 1)
              for (const k of Object.keys(data.log)) { if (Array.isArray(data.log[k])) data.log[k].splice(hi, 1) }
              save(); render()
            }
            nameWrap.appendChild(nameSpan); nameWrap.appendChild(delBtn)
            row.appendChild(nameWrap)

            dates.forEach(d => {
              const k = widget._dk(d)
              const done = !!(data.log[k] && data.log[k][hi])
              const isToday = k === todayKey
              const cell = document.createElement('div')
              cell.className = 'cm-habits-cell' + (done ? ' done' : '') + (isToday ? ' today' : '')
              cell.title = `${hName} — ${k}`
              cell.onclick = e => {
                e.stopPropagation()
                if (!data.log[k]) data.log[k] = []
                while (data.log[k].length <= hi) data.log[k].push(0)
                data.log[k][hi] = data.log[k][hi] ? 0 : 1
                save(); render()
              }
              row.appendChild(cell)
            })
            grid.appendChild(row)
          })
          wrap.appendChild(grid)
        }
      }

      // ── Date/days meta row (right-aligned) ────────────────────────────────
      const metaRow = document.createElement('div')
      metaRow.className = 'cm-habits-meta-row'

      const sdFormatted = new Date(data.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const endD = new Date(data.startDate + 'T00:00:00'); endD.setDate(endD.getDate() + data.length - 1)
      const edFormatted = endD.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

      const sdChip = document.createElement('button')
      sdChip.className = 'cm-habits-meta-chip'; sdChip.title = 'Change start date'
      const sdHiddenInp = document.createElement('input')
      sdHiddenInp.type = 'date'; sdHiddenInp.value = data.startDate
      sdHiddenInp.style.cssText = 'position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;'
      sdHiddenInp.onchange = e => { e.stopPropagation(); data.startDate = sdHiddenInp.value; save(); render() }
      sdHiddenInp.onkeydown = e => e.stopPropagation()
      sdChip.appendChild(document.createTextNode(sdFormatted)); sdChip.appendChild(sdHiddenInp)
      sdChip.onclick = e => { e.stopPropagation(); sdHiddenInp.showPicker ? sdHiddenInp.showPicker() : sdHiddenInp.click() }

      const metaArrow = document.createElement('span'); metaArrow.className = 'cm-habits-meta-sep'; metaArrow.textContent = '→'
      const edSpan = document.createElement('span'); edSpan.className = 'cm-habits-meta-text'; edSpan.textContent = edFormatted
      const metaDot = document.createElement('span'); metaDot.className = 'cm-habits-meta-sep'; metaDot.textContent = '·'

      const lenChip = document.createElement('button')
      lenChip.className = 'cm-habits-meta-chip'; lenChip.title = 'Edit number of days'
      lenChip.textContent = `${data.length}d`
      lenChip.onclick = e => {
        e.stopPropagation()
        const inp = document.createElement('input')
        inp.type = 'number'; inp.value = String(data.length); inp.min = '1'; inp.max = '365'
        inp.className = 'cm-habits-meta-inp'; lenChip.replaceWith(inp); inp.focus(); inp.select()
        const commit = () => { const v = parseInt(inp.value); if (v > 0) { data.length = v; save(); render() } else render() }
        inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit() } else if (ev.key === 'Escape') render() }
        inp.onblur = commit
      }

      metaRow.appendChild(sdChip); metaRow.appendChild(metaArrow); metaRow.appendChild(edSpan)
      metaRow.appendChild(metaDot); metaRow.appendChild(lenChip)
      wrap.appendChild(metaRow)

      // ── Add habit row ──────────────────────────────────────────────────────
      const addRow = document.createElement('div')
      addRow.className = 'cm-habits-add-row'
      const addInput = document.createElement('input')
      addInput.className = 'cm-habits-add-inp'; addInput.type = 'text'; addInput.placeholder = 'New habit…'
      const addBtn = document.createElement('button')
      addBtn.className = 'cm-habits-add-btn'; addBtn.textContent = '+'
      const doAdd = () => {
        const v = addInput.value.trim(); if (!v) return
        addInput.value = ''; data.habits.push(v); save(); render()
        const ni = wrap.querySelector('.cm-habits-add-inp'); if (ni) ni.focus()
      }
      addInput.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); doAdd() } }
      addBtn.onclick = e => { e.stopPropagation(); doAdd() }
      addRow.appendChild(addInput); addRow.appendChild(addBtn)
      wrap.appendChild(addRow)
    }

    wrap._habitsRender = render
    wrap._habitsData = data
    render()
    return wrap
  }
  eq(o) {
    return o instanceof HabitsWidget &&
      o.blockFrom === this.blockFrom &&
      o.data.view === this.data.view &&
      o.data.title === this.data.title &&
      o.data.startDate === this.data.startDate &&
      o.data.length === this.data.length &&
      JSON.stringify(o.data.habits) === JSON.stringify(this.data.habits) &&
      JSON.stringify(o.data.log) === JSON.stringify(this.data.log)
  }
  compare(o) { return this.eq(o) }
  updateDOM(dom) {
    if (!dom._habitsRender || !dom._habitsData) return false
    Object.assign(dom._habitsData, this.data)
    dom._habitsRender()
    return true
  }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return 80 + (this.data?.habits?.length || 0) * 26 }
  coordsAt() { return null }
}

// ─── /task mini calendar date picker ─────────────────────────────────────────
export function _makeTaskDatePicker(anchor, currentDate, onPick) {
  document.querySelectorAll('.cm-task-date-picker').forEach(el => el.remove())
  const today = new Date()
  let viewYear  = currentDate ? parseInt(currentDate.slice(0,4)) : today.getFullYear()
  let viewMonth = currentDate ? parseInt(currentDate.slice(5,7)) - 1 : today.getMonth()

  const picker = document.createElement('div')
  picker.className = 'cm-task-date-picker'

  const positionPicker = () => {
    const rect = anchor.getBoundingClientRect()
    const ph = picker.offsetHeight || 240
    const pw = picker.offsetWidth  || 214
    const top = (window.innerHeight - rect.bottom >= ph + 8)
      ? rect.bottom + 4
      : rect.top - ph - 4
    picker.style.top  = `${Math.max(4, top)}px`
    picker.style.left = `${Math.min(rect.left, window.innerWidth - pw - 8)}px`
  }

  const render = () => {
    picker.innerHTML = ''
    // Header
    const hdr = document.createElement('div'); hdr.className = 'cm-cal-header'
    const prev = document.createElement('button'); prev.className = 'cm-cal-nav'; prev.textContent = '‹'
    prev.onclick = e => { e.stopPropagation(); viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear-- }; render(); positionPicker() }
    const lbl = document.createElement('span'); lbl.className = 'cm-cal-month'
    lbl.textContent = `${_MONTHS[viewMonth]} ${viewYear}`
    const next = document.createElement('button'); next.className = 'cm-cal-nav'; next.textContent = '›'
    next.onclick = e => { e.stopPropagation(); viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++ }; render(); positionPicker() }
    hdr.appendChild(prev); hdr.appendChild(lbl); hdr.appendChild(next)
    picker.appendChild(hdr)
    // Grid
    const grid = document.createElement('div'); grid.className = 'cm-cal-grid'
    for (const d of ['Su','Mo','Tu','We','Th','Fr','Sa']) {
      const dh = document.createElement('div'); dh.className = 'cm-cal-day-hdr cm-task-date-hdr'; dh.textContent = d; grid.appendChild(dh)
    }
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    for (let i = 0; i < firstDay; i++) {
      const b = document.createElement('div'); b.className = 'cm-task-date-blank'; grid.appendChild(b)
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const cell = document.createElement('div'); cell.className = 'cm-task-date-cell'
      const isToday = today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d
      if (isToday) cell.classList.add('cm-task-date-today')
      if (currentDate === ds) cell.classList.add('cm-task-date-selected')
      cell.textContent = String(d)
      cell.onclick = e => { e.stopPropagation(); onPick(ds); picker.remove(); document.removeEventListener('mousedown', outside) }
      grid.appendChild(cell)
    }
    picker.appendChild(grid)
  }

  render()
  document.body.appendChild(picker)
  positionPicker()

  const outside = e => { if (!picker.contains(e.target) && e.target !== anchor) { picker.remove(); document.removeEventListener('mousedown', outside) } }
  setTimeout(() => document.addEventListener('mousedown', outside), 0)
}

// ─── /kanban card edit modal ───────────────────────────────────────────────
// Vanilla-DOM counterpart to LibraryView.jsx's KanbanCardModal — same
// product surface, different render path (this is a CodeMirror widget, not
// React), so it's rebuilt here rather than shared. Same visual language:
// 17/13/11 type scale, 4px-grid spacing, 8px radius family, and the white
// (label/selected-pill/footer-buttons) vs dim (subtitle/placeholder/
// unselected-pill) color hierarchy settled on in that component's A113-A118
// passes. Kept in sync by eye — if that component's language changes again,
// this one should follow.
export const PRIORITY_LEVELS = [
  { id: 'none',   label: 'No priority', color: null },
  { id: 'low',    label: 'Low',         color: '#6b7280' },
  { id: 'medium', label: 'Medium',      color: '#eab308' },
  { id: 'high',   label: 'High',        color: '#f97316' },
  { id: 'urgent', label: 'Urgent',      color: '#f85149' },
]
export const _flagSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>'
export const _xSvg = size => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
export const _trashSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>'

export function _openTaskCardModal(task, { colTitle, onSave, onDelete }) {
  document.querySelectorAll('.cm-task-modal-overlay').forEach(el => el.remove())

  let title = task.text
  let dueDate = task.date || ''
  let priority = task.priority || 'none'
  let description = task.description || ''
  let comments = (task.comments || []).slice()
  let newCmt = ''
  let firstFocusEl = null

  const overlay = document.createElement('div')
  overlay.className = 'cm-task-modal-overlay'
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc) }
  const onEsc = e => { if (e.key === 'Escape') close() }
  overlay.onclick = e => { if (e.target === overlay) close() }
  document.addEventListener('keydown', onEsc)

  const box = document.createElement('div')
  box.className = 'cm-task-modal-box'
  box.onclick = e => e.stopPropagation()
  overlay.appendChild(box)

  const divider = () => { const d = document.createElement('div'); d.className = 'cm-task-modal-divider'; return d }

  const render = () => {
    box.innerHTML = ''
    const canSave = title.trim().length > 0

    // Header
    const hdr = document.createElement('div'); hdr.className = 'cm-task-modal-hdr'
    const hdrText = document.createElement('div')
    const hTitle = document.createElement('div'); hTitle.className = 'cm-task-modal-title'; hTitle.textContent = 'Edit Task'
    const hSub = document.createElement('div'); hSub.className = 'cm-task-modal-subtitle'
    hSub.textContent = colTitle ? `In ${colTitle}` : 'Update the details for this task.'
    hdrText.appendChild(hTitle); hdrText.appendChild(hSub)
    const closeBtn = document.createElement('button'); closeBtn.className = 'cm-task-modal-close'; closeBtn.title = 'Close'
    closeBtn.innerHTML = _xSvg(13)
    closeBtn.onclick = close
    hdr.appendChild(hdrText); hdr.appendChild(closeBtn)
    box.appendChild(hdr)
    box.appendChild(divider())

    // Body
    const body = document.createElement('div'); body.className = 'cm-task-modal-body'

    const titleGroup = document.createElement('div')
    const titleLabel = document.createElement('label'); titleLabel.className = 'cm-task-modal-label'; titleLabel.textContent = 'Title'
    const titleInput = document.createElement('input'); titleInput.className = 'cm-task-modal-field'; titleInput.type = 'text'
    titleInput.value = title; titleInput.placeholder = 'e.g. Fix modal mobile breakpoint'
    titleInput.oninput = e => { title = e.target.value; saveBtn.disabled = !title.trim() }
    titleInput.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') close() }
    titleGroup.appendChild(titleLabel); titleGroup.appendChild(titleInput)
    body.appendChild(titleGroup)
    firstFocusEl = titleInput

    const priGroup = document.createElement('div')
    const priLabel = document.createElement('label'); priLabel.className = 'cm-task-modal-label'; priLabel.textContent = 'Priority'
    const priRow = document.createElement('div'); priRow.className = 'cm-task-modal-priority'
    PRIORITY_LEVELS.forEach(p => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'cm-task-modal-pri-btn' + (priority === p.id ? ' active' : '')
      btn.title = p.label
      btn.innerHTML = (p.color ? `<span style="color:${p.color};display:flex">${_flagSvg}</span>` : '') + (p.id === 'none' ? 'None' : p.label)
      btn.onclick = () => { priority = p.id; render() }
      priRow.appendChild(btn)
    })
    priGroup.appendChild(priLabel); priGroup.appendChild(priRow)
    body.appendChild(priGroup)

    const dateGroup = document.createElement('div')
    const dateLabel = document.createElement('label'); dateLabel.className = 'cm-task-modal-label'; dateLabel.textContent = 'Due Date'
    const dateInput = document.createElement('input'); dateInput.className = 'cm-task-modal-field'; dateInput.type = 'date'
    dateInput.value = dueDate
    dateInput.onchange = e => { dueDate = e.target.value }
    dateInput.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') close() }
    dateGroup.appendChild(dateLabel); dateGroup.appendChild(dateInput)
    body.appendChild(dateGroup)

    const descGroup = document.createElement('div')
    const descLabel = document.createElement('label'); descLabel.className = 'cm-task-modal-label'; descLabel.textContent = 'Description'
    const descInput = document.createElement('textarea'); descInput.className = 'cm-task-modal-field cm-task-modal-textarea'; descInput.rows = 3
    descInput.placeholder = 'Add more detail…'
    descInput.value = description
    descInput.oninput = e => { description = e.target.value }
    descInput.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') close() }
    descGroup.appendChild(descLabel); descGroup.appendChild(descInput)
    body.appendChild(descGroup)

    // Comments — task is always a real, already-created entity by the time
    // this modal can open (created via the column's inline add-input), so
    // unlike the standalone board's create/edit modal there's no isNew case
    // where this section would need to be hidden.
    body.appendChild(divider())
    const cmtGroup = document.createElement('div')
    const cmtLabel = document.createElement('label'); cmtLabel.className = 'cm-task-modal-label'
    cmtLabel.textContent = 'Comments' + (comments.length ? ` (${comments.length})` : '')
    cmtGroup.appendChild(cmtLabel)
    if (comments.length) {
      const list = document.createElement('div')
      list.style.cssText = 'margin-bottom:8px;display:flex;flex-direction:column;gap:8px'
      comments.forEach(c => {
        const row = document.createElement('div'); row.className = 'cm-task-modal-comment-row'
        const av = document.createElement('div'); av.className = 'cm-task-modal-comment-avatar'
        av.textContent = (c.text[0] || '?').toUpperCase()
        const bubble = document.createElement('div'); bubble.className = 'cm-task-modal-comment-bubble'
        const ctext = document.createElement('div'); ctext.className = 'cm-task-modal-comment-text'; ctext.textContent = c.text
        const meta = document.createElement('div'); meta.className = 'cm-task-modal-comment-meta'
        meta.textContent = new Date(c.createdAt).toLocaleDateString()
        const cdel = document.createElement('button'); cdel.className = 'cm-task-modal-comment-del'; cdel.title = 'Remove comment'
        cdel.innerHTML = _xSvg(11)
        cdel.onclick = () => { comments = comments.filter(x => x.id !== c.id); render() }
        bubble.appendChild(ctext); bubble.appendChild(meta); bubble.appendChild(cdel)
        row.appendChild(av); row.appendChild(bubble)
        list.appendChild(row)
      })
      cmtGroup.appendChild(list)
    }
    const cmtInputRow = document.createElement('div'); cmtInputRow.style.cssText = 'display:flex;gap:8px'
    const cmtInput = document.createElement('input'); cmtInput.className = 'cm-task-modal-field'; cmtInput.style.flex = '1'
    cmtInput.placeholder = 'Write a comment…'; cmtInput.value = newCmt
    cmtInput.oninput = e => { newCmt = e.target.value }
    const addCmt = () => {
      if (!newCmt.trim()) return
      comments = [...comments, { id: makeId('cmt'), text: newCmt.trim(), createdAt: new Date().toISOString() }]
      newCmt = ''
      render()
    }
    cmtInput.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCmt() } if (e.key === 'Escape') close() }
    const sendBtn = document.createElement('button'); sendBtn.className = 'cm-task-modal-send'; sendBtn.textContent = 'Send'
    sendBtn.disabled = !newCmt.trim()
    sendBtn.onclick = addCmt
    cmtInputRow.appendChild(cmtInput); cmtInputRow.appendChild(sendBtn)
    cmtGroup.appendChild(cmtInputRow)
    body.appendChild(cmtGroup)

    box.appendChild(body)
    box.appendChild(divider())

    // Footer — Delete separate on the left, Cancel + Save split 50/50.
    const footer = document.createElement('div'); footer.className = 'cm-task-modal-footer'
    const delBtn = document.createElement('button'); delBtn.className = 'cm-task-modal-delete'; delBtn.title = 'Delete task'
    delBtn.innerHTML = _trashSvg + 'Delete'
    delBtn.onclick = () => { close(); onDelete() }
    footer.appendChild(delBtn)
    const actions = document.createElement('div'); actions.className = 'cm-task-modal-actions'
    const cancelBtn = document.createElement('button'); cancelBtn.className = 'cm-task-modal-cancel'; cancelBtn.textContent = 'Cancel'
    cancelBtn.onclick = close
    const saveBtn = document.createElement('button'); saveBtn.className = 'cm-task-modal-save'; saveBtn.textContent = 'Save Changes'
    saveBtn.disabled = !canSave
    saveBtn.onclick = () => {
      if (!title.trim()) return
      close()
      onSave({ text: title.trim(), date: dueDate || null, priority, description, comments })
    }
    actions.appendChild(cancelBtn); actions.appendChild(saveBtn)
    footer.appendChild(actions)
    box.appendChild(footer)
  }

  render()
  document.body.appendChild(overlay)
  firstFocusEl?.focus()
  firstFocusEl?.select()
}

// ─── /task single-block widget (interactive kanban) ───────────────────────────
// Module-level pointer drag state for kanban boards
let _kbDrag = null

export class TaskBlockWidget {
  constructor(boardTitle, columns, rawMd, blockFrom = -1) {
    this.boardTitle = boardTitle
    // Default kanban columns when empty
    this.columns = columns.length ? columns : [
      { title: 'To Do', tasks: [] },
      { title: 'In Progress', tasks: [] },
      { title: 'Done', tasks: [] },
    ]
    this.rawMd = rawMd
    this.blockFrom = blockFrom
    this._needsDefault = !columns.length
  }
  _serialize(title, cols) {
    // Always '/kanban' going forward — mirrors serializeTaskBlock's same
    // migration (an old '/task'-headed board still parses via
    // parseTaskBlock, but rewrites itself to the new header on next edit).
    const lines = [`/kanban${title ? ':' + title : ''}`]
    for (const col of cols) {
      lines.push(`== ${col.title} ==`)
      for (const t of col.tasks) lines.push(`- [ ] ${_serializeTaskLine(t)}`)
    }
    return lines.join('\n')
  }
  toDOM(cmView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-task-board-w'
    try {
    const cols = this.columns.map(c => ({
      title: c.title,
      tasks: c.tasks.map(t => ({
        text: t.text, date: t.date || null,
        priority: t.priority || 'none', description: t.description || '', comments: t.comments || [],
      })),
    }))
    const bt = this.boardTitle
    const save = () => {
      const newMd = this._serialize(bt, cols)
      if (_replaceInDoc(cmView, this.rawMd, newMd, this.blockFrom)) { this.rawMd = newMd; this.blockFrom = -1 }
    }

    if (this._needsDefault) {
      this._needsDefault = false
      setTimeout(() => save(), 0)
    }

    const render = () => {
      wrap.innerHTML = ''

      // Board title bar
      if (bt) {
        const titleBar = document.createElement('div')
        titleBar.className = 'cm-task-titlebar'
        const titleEl = document.createElement('span')
        titleEl.className = 'cm-task-title-w'
        titleEl.textContent = bt
        titleBar.appendChild(titleEl)
        wrap.appendChild(titleBar)
      }

      const colsRow = document.createElement('div')
      colsRow.className = 'cm-task-cols-w'

      cols.forEach((col, ci) => {
        const colDiv = document.createElement('div')
        colDiv.className = 'cm-task-col-w'

        // Column header \u2014 a hollow ring dot instead of the old solid-fill
        // header bar (matches the standalone Tasks board's redesign), real
        // (non-uppercase) title text, unicode \u00d7 swapped for a stroke icon.
        const _colColors = ['#f59e0b','#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4']
        const colHdr = document.createElement('div')
        colHdr.className = 'cm-task-col-hdr-w'
        const hdrLeft = document.createElement('div')
        hdrLeft.className = 'cm-task-col-hdr-left'
        const ring = document.createElement('span')
        ring.className = 'cm-task-col-ring'
        ring.style.setProperty('--ring-color', _colColors[ci % _colColors.length])
        const colTitleEl = document.createElement('span')
        colTitleEl.className = 'cm-task-col-title'
        colTitleEl.textContent = col.title
        colTitleEl.onclick = () => {
          const inp = document.createElement('input')
          inp.className = 'cm-task-col-title-inp'
          inp.value = col.title; inp.type = 'text'
          colTitleEl.textContent = ''; colTitleEl.appendChild(inp)
          inp.focus(); inp.select()
          const commit = () => { col.title = inp.value.trim() || col.title; save(); render() }
          inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commit() } if (ev.key === 'Escape') render() }
          inp.onblur = commit
        }
        hdrLeft.appendChild(ring)
        hdrLeft.appendChild(colTitleEl)

        const hdrRight = document.createElement('div')
        hdrRight.className = 'cm-task-col-hdr-right'
        const badge = document.createElement('span')
        badge.className = 'cm-task-col-w-badge'
        badge.textContent = String(col.tasks.length)

        const delCol = document.createElement('button')
        delCol.className = 'cm-task-col-del'
        delCol.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
        delCol.title = 'Delete column'
        delCol.onclick = e => { e.stopPropagation(); cols.splice(ci, 1); save(); render() }

        hdrRight.appendChild(badge)
        hdrRight.appendChild(delCol)
        colHdr.appendChild(hdrLeft)
        colHdr.appendChild(hdrRight)
        colDiv.appendChild(colHdr)

        // Cards area
        const cardsArea = document.createElement('div')
        cardsArea.className = 'cm-task-cards-area'
        col.tasks.forEach((task, ti) => {
          const card = document.createElement('div')
          card.className = 'cm-task-card-w'
          card.style.touchAction = 'none'

          // Pointer-based drag
          card.onpointerdown = e => {
            if (e.button !== 0) return
            e.stopPropagation()
            if (e.target.closest('.cm-task-card-date-row')) return
            if (e.target.closest('.cm-task-card-del-btn')) return
            if (e.target.closest('.cm-task-card-text')) return
            e.preventDefault()
            const rect = card.getBoundingClientRect()
            const ghost = card.cloneNode(true)
            ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;pointer-events:none;z-index:9999;opacity:0.85;transform:rotate(1.5deg);box-shadow:0 8px 24px rgba(0,0,0,.3);border-radius:6px;`
            document.body.appendChild(ghost)
            card.classList.add('cm-task-card-dragging')
            _kbDrag = { wrap, ci, ti, ghost, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
            card.setPointerCapture(e.pointerId)
          }
          card.onpointermove = e => {
            if (!_kbDrag || _kbDrag.wrap !== wrap) return
            _kbDrag.ghost.style.left = `${e.clientX - _kbDrag.offX}px`
            _kbDrag.ghost.style.top = `${e.clientY - _kbDrag.offY}px`
            const el = document.elementFromPoint(e.clientX, e.clientY)
            const targetCol = el?.closest('.cm-task-col-w')
            wrap.querySelectorAll('.cm-task-col-w').forEach(c => c.classList.remove('cm-task-col-drop'))
            if (targetCol && wrap.contains(targetCol)) targetCol.classList.add('cm-task-col-drop')
          }
          const endDrag = e => {
            if (!_kbDrag || _kbDrag.wrap !== wrap) return
            _kbDrag.ghost.remove()
            wrap.querySelectorAll('.cm-task-col-w').forEach(c => c.classList.remove('cm-task-col-drop'))
            card.classList.remove('cm-task-card-dragging')
            if (e.type === 'pointerup') {
              const el = document.elementFromPoint(e.clientX, e.clientY)
              const targetColEl = el?.closest('.cm-task-col-w')
              if (targetColEl && wrap.contains(targetColEl)) {
                const colEls = [...wrap.querySelectorAll('.cm-task-col-w')]
                const targetCi = colEls.indexOf(targetColEl)
                if (targetCi !== -1 && targetCi !== _kbDrag.ci) {
                  const [moved] = cols[_kbDrag.ci].tasks.splice(_kbDrag.ti, 1)
                  cols[targetCi].tasks.push(moved)
                  _kbDrag = null; save(); render(); return
                }
              }
            }
            _kbDrag = null
          }
          card.onpointerup = endDrag
          card.onpointercancel = endDrag

          const cardBody = document.createElement('div')
          cardBody.className = 'cm-task-card-body'

          // Click opens the full edit modal (title/priority/due date/
          // description/comments) — matches the standalone Tasks board's
          // KanbanCardModal. Was a bare inline-rename-on-click before this
          // widget had any of those other fields to edit.
          const txt = document.createElement('span')
          txt.className = 'cm-task-card-text'
          txt.textContent = task.text
          txt.onclick = e => {
            e.stopPropagation()
            _openTaskCardModal(task, {
              colTitle: col.title,
              onSave: updated => { Object.assign(task, updated); save(); render() },
              onDelete: () => { cols[ci].tasks.splice(ti, 1); save(); render() },
            })
          }

          const del = document.createElement('button')
          del.className = 'cm-task-card-del-btn'
          del.title = 'Delete'
          del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
          del.onclick = e => { e.stopPropagation(); cols[ci].tasks.splice(ti, 1); save(); render() }

          cardBody.appendChild(txt)
          cardBody.appendChild(del)
          card.appendChild(cardBody)

          // Date row
          const dateRow = document.createElement('div')
          dateRow.className = 'cm-task-card-date-row'
          if (task.date) {
            const badge = document.createElement('span')
            badge.className = 'cm-task-card-date-badge'
            badge.textContent = task.date
            badge.onclick = e => { e.stopPropagation(); _makeTaskDatePicker(badge, task.date, ds => { task.date = ds; save(); render() }) }
            const clearBtn = document.createElement('button')
            clearBtn.className = 'cm-task-card-date-clear'
            clearBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
            clearBtn.title = 'Remove date'
            clearBtn.onclick = e => { e.stopPropagation(); task.date = null; save(); render() }
            dateRow.appendChild(badge)
            dateRow.appendChild(clearBtn)
          } else {
            const addDateBtn = document.createElement('button')
            addDateBtn.className = 'cm-task-card-add-date'
            addDateBtn.textContent = '+ date'
            addDateBtn.onclick = e => { e.stopPropagation(); _makeTaskDatePicker(addDateBtn, null, ds => { task.date = ds; save(); render() }) }
            dateRow.appendChild(addDateBtn)
          }
          card.appendChild(dateRow)
          cardsArea.appendChild(card)
        })
        // Add task input — sits between header and cards
        const addRow = document.createElement('div')
        addRow.className = 'cm-task-add-row'
        const addInput = document.createElement('input')
        addInput.className = 'cm-task-add-input'
        addInput.type = 'text'
        addInput.placeholder = '+ Add a card...'
        addInput.onkeydown = (e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            const val = addInput.value.trim()
            if (!val) return
            addInput.value = ''
            cols[ci].tasks.push({ text: val, done: false, label: null, date: null, priority: 'none', description: '', comments: [] })
            save(); render()
            const col = wrap.querySelectorAll('.cm-task-add-input')[ci]
            if (col) col.focus()
          }
        }
        addRow.appendChild(addInput)
        colDiv.appendChild(cardsArea)
        colDiv.appendChild(addRow)
        colsRow.appendChild(colDiv)
      })

      // Add-column button
      const addCol = document.createElement('div')
      addCol.className = 'cm-task-add-col'
      const addColBtn = document.createElement('button')
      addColBtn.className = 'cm-task-add-col-btn'
      addColBtn.textContent = '+'
      addColBtn.onclick = () => {
        cols.push({ title: 'New List', tasks: [], color: null })
        save(); render()
        // After render, open title edit on the new column
        setTimeout(() => {
          const titles = wrap.querySelectorAll('.cm-task-col-title')
          const last = titles[titles.length - 1]
          if (last) last.click()
        }, 0)
      }
      addCol.appendChild(addColBtn)
      colsRow.appendChild(addCol)
      wrap.appendChild(colsRow)
    }
    render()
    } catch (err) {
      wrap.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.style.cssText = 'padding:8px 12px;color:var(--textDim,#888);font-size:12px;border-left:3px solid var(--border,#ccc);margin:4px 0;'
      errEl.textContent = '/kanban — render error: ' + (err?.message || err)
      wrap.appendChild(errEl)
    }
    return wrap
  }
  eq(o) {
    if (!(o instanceof TaskBlockWidget) || o.boardTitle !== this.boardTitle || o.columns.length !== this.columns.length) return false
    return this.columns.every((col, ci) => {
      const oc = o.columns[ci]
      if (oc.title !== col.title || oc.tasks.length !== col.tasks.length) return false
      return col.tasks.every((t, ti) => oc.tasks[ti].text === t.text && oc.tasks[ti].date === t.date)
    })
  }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return 38 + 32 + Math.max(...this.columns.map(c => c.tasks.length), 1) * 56 }
  coordsAt() { return null }
}

// ─── Helpers for parsing inline block commands ────────────────────────────────
/** Parse /todo block: returns { listName, items:[{text,checked,dateStr,timeStr,lineIdx}], startLine, endLine } or null */

// Unicode-safe base64, used to pack a /kanban task's free-text description
// and comment thread into a single markdown line's {tag:...} suffix without
// fighting braces/newlines/colons in the actual content.
export function _b64enc(str) {
  try {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  } catch { return '' }
}
export function _b64dec(str) {
  try {
    const bin = atob(str)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch { return '' }
}

/** Parse one `- [ ] text {tag:...}...` task line's content (after the
 * checkbox marker is stripped) into { text, label, date, priority,
 * description, comments }. Shared by parseTaskBlock's two branches. */
export function _parseTaskLine(raw) {
  const lblM = raw.match(/\{label:(\d+)\}/)
  const label = lblM ? parseInt(lblM[1]) : null
  const dateM = raw.match(/\{date:(\d{4}-\d{2}-\d{2})\}/)
  const date = dateM ? dateM[1] : null
  const priM = raw.match(/\{priority:(\w+)\}/)
  const priority = priM ? priM[1] : 'none'
  const descM = raw.match(/\{desc:([A-Za-z0-9+/=]*)\}/)
  const description = descM ? _b64dec(descM[1]) : ''
  const cmtM = raw.match(/\{comments:([A-Za-z0-9+/=]*)\}/)
  let comments = []
  if (cmtM) { try { comments = JSON.parse(_b64dec(cmtM[1])) || [] } catch { comments = [] } }
  const text = raw
    .replace(/\{label:\d+\}/, '')
    .replace(/\{date:\d{4}-\d{2}-\d{2}\}/, '')
    .replace(/\{priority:\w+\}/, '')
    .replace(/\{desc:[A-Za-z0-9+/=]*\}/, '')
    .replace(/\{comments:[A-Za-z0-9+/=]*\}/, '')
    .trim()
  return { text, label, date, priority, description, comments }
}

/** Inverse of _parseTaskLine — serializes a task object back to the part of
 * the line after `- [ ] `. */
export function _serializeTaskLine(t) {
  let line = t.text
  if (t.date) line += ` {date:${t.date}}`
  if (t.priority && t.priority !== 'none') line += ` {priority:${t.priority}}`
  if (t.description) line += ` {desc:${_b64enc(t.description)}}`
  if (t.comments && t.comments.length) line += ` {comments:${_b64enc(JSON.stringify(t.comments))}}`
  return line
}

/** Parse /task block: returns { boardTitle, columns, startLine, endLine } */
export function parseTaskBlock(docStr, startLineIdx) {
  const lines = docStr.split('\n')
  const hdrLine = lines[startLineIdx]
  // Accepts both headers: '/kanban' is the current trigger, '/task' stays
  // recognized so notebooks written before the rename still render.
  const hdrM = hdrLine.match(/^\/(?:task|kanban)(?::(.*))?$/)
  if (!hdrM) return null
  const boardTitle = (hdrM[1] || '').trim()
  let endLine = startLineIdx + 1
  const columns = []
  let currentCol = null

  while (endLine < lines.length) {
    const l = lines[endLine]
    if (l.trim() === '') break // empty line ends the block
    const colM = l.match(/^==\s*(.*?)\s*==(?:\{color:(\d+)\})?$/)
    if (colM) {
      currentCol = { title: colM[1], tasks: [], lineIdx: endLine, color: colM[2] != null ? parseInt(colM[2]) : null }
      columns.push(currentCol)
    } else if (currentCol && /^\s*[-*+]\s\[[ xX]\]/.test(l)) {
      const done = /\[[xX]\]/.test(l)
      const raw = l.replace(/^\s*[-*+]\s\[[ xX]\]\s*/, '').trim()
      currentCol.tasks.push({ ..._parseTaskLine(raw), done, lineIdx: endLine })
    } else if (!currentCol && /^\s*[-*+]\s\[[ xX]\]/.test(l)) {
      currentCol = { title: 'Tasks', tasks: [], lineIdx: endLine, color: null }
      columns.push(currentCol)
      const done = /\[[xX]\]/.test(l)
      const raw = l.replace(/^\s*[-*+]\s\[[ xX]\]\s*/, '').trim()
      currentCol.tasks.push({ ..._parseTaskLine(raw), done, lineIdx: endLine })
    } else {
      break // non-task content ends the block
    }
    endLine++
  }

  return { boardTitle, columns, startLine: startLineIdx, endLine: endLine - 1 }
}

/** Serialize a parsed task board back to markdown lines */
export function serializeTaskBlock(boardTitle, columns) {
  // Always writes '/kanban' — an old '/task'-headed board still parses (see
  // parseTaskBlock) but migrates to the new header the next time it's
  // touched.
  const lines = [`/kanban${boardTitle ? ':' + boardTitle : ''}`]
  for (const col of columns) {
    lines.push(`== ${col.title} ==`)
    for (const t of col.tasks) lines.push(`- ${t.done ? '[x]' : '[ ]'} ${_serializeTaskLine(t)}`)
  }
  return lines.join('\n')
}

// Pending Tab/Enter focus across widget rebuilds (set before dispatch, read in new toDOM)
let _tablePendingFocus = null // { rawText, rowIdx, colIdx } | null

// Table widget — renders markdown table as a contenteditable HTML table.
// All events are stopped at the wrap boundary (bubble phase) so CM6 never sees
// typing or mouse activity inside the table. CM6's MutationObserver already
// ignores widget DOM by default, so contenteditable cells work without interference.
export class TableWidget {
  constructor(html, rawText) { this.html = html; this.rawText = rawText }

  toDOM(cmView) {
    // outer has padding (counted in offsetHeight by CM6) instead of margin (not counted)
    // This prevents the widget from visually overlapping adjacent text lines.
    const outer = document.createElement('div')
    outer.className = 'cm-table-outer'

    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    wrap.innerHTML = this.html
    outer.appendChild(wrap)

    // Make every cell contenteditable and store its original text for change detection
    wrap.querySelectorAll('td, th').forEach(cell => {
      cell.contentEditable = 'true'
      cell.spellcheck = false
      cell._nbRaw = cell.textContent
    })

    // Resume Tab/Enter navigation after a cell write triggered a widget rebuild
    if (_tablePendingFocus) {
      const full = cmView.state.doc.toString()
      const myFrom = full.indexOf(this.rawText)
      if (myFrom !== -1 && myFrom === _tablePendingFocus.tableFrom) {
        const pf = _tablePendingFocus
        _tablePendingFocus = null
        requestAnimationFrame(() => {
          const rows = Array.from(wrap.querySelectorAll('tr'))
          const cell = rows[pf.rowIdx]?.querySelectorAll('td, th')[pf.colIdx]
          if (cell) { cell.focus(); this._selectAll(cell) }
        })
      }
    }

    // Stop all events from bubbling past the wrap to CM6's cm-content listeners
    ;['keydown','keyup','keypress','input','beforeinput',
      'compositionstart','compositionend','compositionupdate',
      'mousedown','mouseup','click','contextmenu','paste','cut','copy','dragstart','drop'
    ].forEach(type => wrap.addEventListener(type, e => e.stopPropagation()))

    // Force plain-text paste (no rich HTML)
    wrap.addEventListener('paste', e => {
      e.preventDefault()
      const text = (e.clipboardData || window.clipboardData).getData('text/plain')
      document.execCommand('insertText', false, text)
    })

    // Commit cell when focus leaves the table entirely
    wrap.addEventListener('focusout', e => {
      if (wrap.contains(e.relatedTarget)) return // focus still inside table
      const cell = e.target.closest('td, th')
      if (!cell) return
      const { rowIdx, colIdx } = this._indices(wrap, cell)
      if (rowIdx !== -1) this._commitCell(cmView, cell, rowIdx, colIdx, null)
    })

    // Right-click context menu for row/column management
    wrap.addEventListener('contextmenu', e => {
      e.preventDefault()
      const cell = e.target.closest('td, th')
      if (!cell) return
      const { rowIdx, colIdx } = this._indices(wrap, cell)
      if (rowIdx !== -1) this._showContextMenu(e, cmView, rowIdx, colIdx)
    })

    // Keyboard navigation: Enter (next row), Tab (next/prev cell), Escape (revert)
    wrap.addEventListener('keydown', e => {
      const cell = e.target.closest('td, th')
      if (!cell || !wrap.contains(cell)) return
      const { rowIdx, colIdx } = this._indices(wrap, cell)
      if (rowIdx === -1) return

      if (e.key === 'Escape') {
        e.preventDefault()
        cell.textContent = cell._nbRaw
        cell.blur()
        return
      }

      if (e.key === 'Backspace' && cell.textContent.trim() === '') {
        e.preventDefault()
        const rows = Array.from(wrap.querySelectorAll('tr'))
        const rowCells = Array.from(rows[rowIdx].querySelectorAll('td, th'))
        // Leftmost cell + entire row empty → delete the row (never delete header)
        if (colIdx === 0 && rowIdx !== 0 && rowCells.every(c => c.textContent.trim() === '')) {
          this._deleteRow(cmView, rowIdx)
          return
        }
        // Otherwise navigate to previous cell, cursor at end
        const cols = rowCells.length
        let nRow = rowIdx, nCol = colIdx - 1
        if (nCol < 0) {
          nRow--
          nCol = nRow >= 0 ? (rows[nRow]?.querySelectorAll('td, th').length ?? 1) - 1 : 0
        }
        if (nRow >= 0 && nRow < rows.length) {
          const prev = rows[nRow].querySelectorAll('td, th')[nCol]
          if (prev) {
            prev.focus()
            const range = document.createRange()
            range.selectNodeContents(prev)
            range.collapse(false) // cursor at end
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
          }
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const rows = Array.from(wrap.querySelectorAll('tr'))
        const cols = rows[rowIdx]?.querySelectorAll('td, th').length ?? 0
        const isLastCol = colIdx === cols - 1
        const isLastRow = rowIdx === rows.length - 1

        if (!isLastCol) {
          // Move to next cell in same row
          const dispatched = this._commitCell(cmView, cell, rowIdx, colIdx,
            { rowIdx, colIdx: colIdx + 1 })
          if (!dispatched) {
            const next = rows[rowIdx].querySelectorAll('td, th')[colIdx + 1]
            if (next) { next.focus(); this._selectAll(next) }
          }
        } else if (!isLastRow) {
          // Last cell of row but not last row — move to first cell of next row
          const dispatched = this._commitCell(cmView, cell, rowIdx, colIdx,
            { rowIdx: rowIdx + 1, colIdx: 0 })
          if (!dispatched) {
            const next = rows[rowIdx + 1].querySelectorAll('td, th')[0]
            if (next) { next.focus(); this._selectAll(next) }
          }
        } else {
          // Last cell of last row — commit, insert new row, focus its first cell
          const numCols = this._parseRowRaw(this.rawText.split('\n')[0]).length
          const newRow = '|' + Array(numCols).fill('    ').join('|') + '|'
          const lines = this.rawText.split('\n')
          const newRaw = [...lines, newRow].join('\n')
          // Store pending focus on the new row (rows.length = new row index after insert)
          const full = cmView.state.doc.toString()
          const tIdx = full.indexOf(this.rawText)
          if (tIdx !== -1) {
            _tablePendingFocus = { tableFrom: tIdx, rowIdx: rows.length, colIdx: 0 }
            setTimeout(() => { _tablePendingFocus = null }, 500)
          }
          // Commit cell edit (if changed) then insert new row
          if (cell.textContent.trim() !== (cell._nbRaw ?? '').trim()) {
            // cell changed — commit first; pendingFocus already set, new row insert piggybacks
            // We need to do both atomically: commit cell + append row
            const full2 = cmView.state.doc.toString()
            const tIdx2 = full2.indexOf(this.rawText)
            if (tIdx2 !== -1) {
              const lineIdx = rowIdx === 0 ? 0 : rowIdx + 1
              const oldLines = this.rawText.split('\n')
              const line = oldLines[lineIdx]
              const r = this._cellRange(line, colIdx)
              if (r) {
                let lineStart = tIdx2
                for (let i = 0; i < lineIdx; i++) lineStart += oldLines[i].length + 1
                const old = line.slice(r[0], r[1])
                const lead = old.match(/^\s*/)[0], trail = old.match(/\s*$/)[0]
                const insert = lead + cell.textContent.trim() + trail
                const patchedLines = [...oldLines]
                patchedLines[lineIdx] = line.slice(0, r[0]) + insert + line.slice(r[1])
                const finalRaw = [...patchedLines, newRow].join('\n')
                cmView.dispatch({ changes: { from: tIdx2, to: tIdx2 + this.rawText.length, insert: finalRaw } })
              }
            }
          } else {
            this._replaceRaw(cmView, newRaw)
          }
        }
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        const rows = Array.from(wrap.querySelectorAll('tr'))
        const cols = rows[rowIdx]?.querySelectorAll('td, th').length ?? 0
        let nRow = rowIdx, nCol = colIdx + (e.shiftKey ? -1 : 1)
        if (nCol >= cols)  { nRow++; nCol = 0 }
        else if (nCol < 0) { nRow--; nCol = Math.max(0, cols - 1) }
        const valid = nRow >= 0 && nRow < rows.length
        const dispatched = this._commitCell(cmView, cell, rowIdx, colIdx,
          valid ? { rowIdx: nRow, colIdx: nCol } : null)
        if (!dispatched && valid) {
          const next = rows[nRow].querySelectorAll('td, th')[nCol]
          if (next) { next.focus(); this._selectAll(next) }
        }
      }
    })

    return outer
  }

  // Select all content in a contenteditable cell
  _selectAll(cell) {
    const range = document.createRange()
    range.selectNodeContents(cell)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)
  }

  // Return { rowIdx, colIdx } of a cell within its table wrap
  _indices(wrap, cell) {
    const row  = cell.parentElement
    const rows = Array.from(wrap.querySelectorAll('tr'))
    return {
      rowIdx: rows.indexOf(row),
      colIdx: Array.from(row.querySelectorAll('td, th')).indexOf(cell),
    }
  }

  // Write the cell's current textContent back to the CM6 doc if it changed.
  // Returns true if a dispatch was made (widget will rebuild).
  _commitCell(cmView, cell, rowIdx, colIdx, pendingNext) {
    const newValue = cell.textContent
    const rawValue = cell._nbRaw ?? ''
    if (newValue.trim() === rawValue.trim()) return false

    const full = cmView.state.doc.toString()
    const tIdx = full.indexOf(this.rawText)
    if (tIdx === -1) return false

    // Widget will rebuild — store pending focus using table start position as key
    // (rawText changes after the edit, but the table's document position stays the same)
    if (pendingNext) {
      _tablePendingFocus = { tableFrom: tIdx, rowIdx: pendingNext.rowIdx, colIdx: pendingNext.colIdx }
      setTimeout(() => { _tablePendingFocus = null }, 500)
    }

    const lines   = this.rawText.split('\n')
    const lineIdx = rowIdx === 0 ? 0 : rowIdx + 1
    if (lineIdx >= lines.length) return false
    const line = lines[lineIdx]
    const r = this._cellRange(line, colIdx)
    if (!r) return false

    let lineStart = tIdx
    for (let i = 0; i < lineIdx; i++) lineStart += lines[i].length + 1

    const old    = line.slice(r[0], r[1])
    const lead   = old.match(/^\s*/)[0]
    const trail  = old.match(/\s*$/)[0]
    const insert = lead + newValue.trim() + trail

    cmView.dispatch({ changes: { from: lineStart + r[0], to: lineStart + r[1], insert } })
    return true
  }

  _cellRange(line, colIdx) {
    let pipe = -1, start = -1
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { i++; continue } // skip escaped pipe
      if (line[i] !== '|') continue
      pipe++
      if (pipe === colIdx) start = i + 1
      else if (pipe === colIdx + 1) return [start, i]
    }
    return start !== -1 ? [start, line.length] : null
  }

  _parseRowRaw(row) {
    const trimmed = row.trim()
    const inner = trimmed.replace(/^(?<!\\)\|/, '').replace(/(?<!\\)\|$/, '')
    return inner.split(/(?<!\\)\|/).map(c => c.trim())
  }

  _replaceRaw(cmView, newRaw) {
    const full = cmView.state.doc.toString()
    const from = full.indexOf(this.rawText)
    if (from === -1) return
    cmView.dispatch({ changes: { from, to: from + this.rawText.length, insert: newRaw } })
  }

  _insertRow(cmView, rowIdx, below) {
    const lines = this.rawText.split('\n')
    const numCols = this._parseRowRaw(lines[0]).length
    const newRow = '|' + Array(numCols).fill('    ').join('|') + '|'
    // rowIdx 0 = header; body rows map to lines[rowIdx + 1] (separator is at lines[1])
    const insertAt = rowIdx === 0 ? 2 : (below ? rowIdx + 2 : rowIdx + 1)
    lines.splice(insertAt, 0, newRow)
    this._replaceRaw(cmView, lines.join('\n'))
  }

  _deleteRow(cmView, rowIdx) {
    if (rowIdx === 0) return // never delete header
    const lines = this.rawText.split('\n')
    const lineIdx = rowIdx + 1 // separator at 1, body rows at 2+
    if (lineIdx >= lines.length) return
    lines.splice(lineIdx, 1)
    this._replaceRaw(cmView, lines.join('\n'))
  }

  _insertCol(cmView, colIdx, right) {
    const insertAt = right ? colIdx + 1 : colIdx
    const lines = this.rawText.split('\n')
    const newLines = lines.map((line, li) => {
      if (!line.trim()) return line
      const cells = this._parseRowRaw(line)
      cells.splice(insertAt, 0, li === 1 ? '---' : '')
      return '| ' + cells.join(' | ') + ' |'
    })
    this._replaceRaw(cmView, newLines.join('\n'))
  }

  _deleteCol(cmView, colIdx) {
    const lines = this.rawText.split('\n')
    const newLines = lines.map(line => {
      if (!line.trim()) return line
      const cells = this._parseRowRaw(line)
      if (cells.length <= 1) return line
      cells.splice(colIdx, 1)
      return '| ' + cells.join(' | ') + ' |'
    })
    this._replaceRaw(cmView, newLines.join('\n'))
  }

  _showContextMenu(e, cmView, rowIdx, colIdx) {
    document.querySelectorAll('.nb-table-ctx').forEach(m => m.remove())
    const numCols = this._parseRowRaw(this.rawText.split('\n')[0]).length
    const isHeader = rowIdx === 0
    const menu = document.createElement('div')
    menu.className = 'nb-table-ctx'

    const items = [
      !isHeader && { label: 'Add row above', fn: () => this._insertRow(cmView, rowIdx, false) },
      { label: isHeader ? 'Add row below header' : 'Add row below', fn: () => this._insertRow(cmView, rowIdx, true) },
      !isHeader && { label: 'Delete row', fn: () => this._deleteRow(cmView, rowIdx), danger: true },
      null,
      { label: 'Add column left',  fn: () => this._insertCol(cmView, colIdx, false) },
      { label: 'Add column right', fn: () => this._insertCol(cmView, colIdx, true) },
      numCols > 1 && { label: 'Delete column', fn: () => this._deleteCol(cmView, colIdx), danger: true },
    ].filter(Boolean)

    for (const item of items) {
      if (item === null) {
        const sep = document.createElement('div'); sep.className = 'nb-table-ctx-sep'; menu.appendChild(sep); continue
      }
      const el = document.createElement('div')
      el.className = 'nb-table-ctx-item' + (item.danger ? ' nb-table-ctx-danger' : '')
      el.textContent = item.label
      el.addEventListener('mousedown', ev => { ev.preventDefault(); menu.remove(); item.fn() })
      menu.appendChild(el)
    }

    document.body.appendChild(menu)
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    const safeX = Math.max(8, Math.min(e.clientX, window.innerWidth - mw - 8))
    const safeY = Math.max(60, Math.min(e.clientY, window.innerHeight - mh - 8))
    menu.style.left = safeX + 'px'
    menu.style.top  = safeY + 'px'
    const dismiss = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss) } }
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0)
  }

  eq(o) { return o instanceof TableWidget && o.rawText === this.rawText }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return true }
  get estimatedHeight() { return 80 }
  coordsAt() { return null }
}

export class SupWidget {
  constructor(text) { this.text = text }
  toDOM() {
    const el = document.createElement('sup')
    el.className = 'nb-sup'
    el.textContent = this.text
    return el
  }
  eq(o) { return o instanceof SupWidget && o.text === this.text }
  compare(o) { return o instanceof SupWidget && o.text === this.text }
  destroy() {}
  ignoreEvent() { return true }
  coordsAt() { return null }
}

// Generic block widget rendering pre-built HTML for the live editor (progress
// bar, rating, callout, toc). `key` makes eq() cheap + correct.
export class HtmlBlockWidget {
  constructor(html, key) { this.html = html; this.key = key }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'nb-live-widget'
    el.innerHTML = this.html
    return el
  }
  eq(o) { return o instanceof HtmlBlockWidget && o.key === this.key }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

// Live-mode ```mermaid / ```svg block. Renders the diagram in place of the
// fence; editing the block (cursor inside) reveals the raw source, matching how
// every other live widget behaves. Mermaid renders asynchronously — toDOM
// returns immediately with a placeholder and hydrateDiagrams fills it in.
export class DiagramWidget {
  constructor(kind, src) { this.kind = kind; this.src = src }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'nb-live-widget nb-diagram-live'
    if (this.kind === 'svg') {
      el.innerHTML = `<div class="nb-svg">${_sanitizeSvg(this.src)}</div>`
    } else {
      el.innerHTML = `<div class="nb-mermaid" data-mermaid="${esc(this.src)}"><div class="nb-diagram-pending">rendering diagram…</div></div>`
      hydrateDiagrams(el)
    }
    return el
  }
  eq(o) { return o instanceof DiagramWidget && o.kind === this.kind && o.src === this.src }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return true }
  coordsAt() { return null }
}

/** Block decorations for ```mermaid / ```svg fences (live + preview). */
export function _buildDiagramDecos(state, Decoration, RangeSetBuilder, isPreview) {
  const builder = new RangeSetBuilder()
  try {
    const full = docString(state.doc)
    if (!/```\s*(mermaid|svg)/i.test(full)) return builder.finish()
    const cur = state.selection.main.head
    const re = /^[ \t]*```[ \t]*(mermaid|svg)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gim
    let m
    while ((m = re.exec(full)) !== null) {
      const blockFrom = state.doc.lineAt(m.index).from
      const blockTo   = state.doc.lineAt(Math.min(m.index + m[0].length, state.doc.length)).to
      // Editing the block? Show the source instead of the render.
      if (!isPreview && cur >= blockFrom && cur <= blockTo) continue
      const kind = m[1].toLowerCase()
      const src  = m[2].replace(/\s+$/, '')
      if (!src.trim()) continue
      try {
        builder.add(blockFrom, blockTo, Decoration.replace({ widget: new DiagramWidget(kind, src), block: true }))
      } catch { /**/ }
    }
  } catch { /**/ }
  return builder.finish()
}

export class SubWidget {
  constructor(text) { this.text = text }
  toDOM() {
    const el = document.createElement('sub')
    el.className = 'nb-sub'
    el.textContent = this.text
    return el
  }
  eq(o) { return o instanceof SubWidget && o.text === this.text }
  compare(o) { return o instanceof SubWidget && o.text === this.text }
  destroy() {}
  ignoreEvent() { return true }
  coordsAt() { return null }
}

// ─── Footnote reference widget [^id] ─────────────────────────────────────────
export class FnRefWidget {
  constructor(id) { this.id = id }
  toDOM() {
    const sup = document.createElement('sup')
    sup.className = 'cm-fn-ref-widget'
    sup.textContent = this.id
    return sup
  }
  eq(o) { return o instanceof FnRefWidget && o.id === this.id }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

// ─── /math zone badge — marks where the inline calculator turns on/off ────────
export class MathZoneWidget {
  constructor(kind) { this.kind = kind }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-mathzone-badge' + (this.kind === 'end' ? ' cm-mathzone-end' : '')
    const icon = document.createElement('span')
    icon.className = 'cm-mathzone-icon'
    icon.textContent = '∑'
    const txt = document.createElement('span')
    txt.textContent = this.kind === 'end' ? 'math off' : 'math on'
    el.appendChild(icon); el.appendChild(txt)
    return el
  }
  eq(o) { return o instanceof MathZoneWidget && o.kind === this.kind }
  compare(o) { return this.eq(o) }
  ignoreEvent() { return false }
}

// ─── /timer widget (interactive: pause/resume/edit) ───────────────────────────
export class TimerWidget {
  constructor(totalSec, label, rawLine) {
    this.totalSec = totalSec; this.label = label; this.rawLine = rawLine
    this._ref = { interval: null, remaining: -1, paused: false }
  }
  toDOM(cmView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-timer-widget'
    try {
    const ref = this._ref
    const fmt = (s) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
      if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      return `${m}:${String(sec).padStart(2,'0')}`
    }

    // ── Empty state: show editable 00:00 timer ────────────
    if (this.totalSec === 0) {
      let editing = true
      let localSec = 0
      let localPaused = true

      const row = document.createElement('div')
      row.className = 'cm-timer-row'

      const timeText = document.createElement('div')
      timeText.className = 'cm-timer-time cm-timer-time-editable'
      timeText.textContent = '0:00'

      // Clicking time opens an inline input to set the time
      const showEdit = () => {
        const inp = document.createElement('input')
        inp.className = 'cm-timer-edit-input'
        inp.value = ''
        inp.type = 'text'
        inp.placeholder = 'mm:ss'
        timeText.textContent = ''
        timeText.appendChild(inp)
        inp.focus()
        const commit = () => {
          const v = inp.value.trim()
          if (!v) { timeText.textContent = fmt(localSec); return }
          let ns = 0
          const hms = v.match(/^(\d+):(\d{2}):(\d{2})$/)
          const ms = v.match(/^(\d+):(\d{2})$/)
          const mn = v.match(/^(\d+)$/)
          if (hms) ns = +hms[1]*3600 + +hms[2]*60 + +hms[3]
          else if (ms) ns = +ms[1]*60 + +ms[2]
          else if (mn) ns = +mn[1]*60
          if (ns > 0) {
            _replaceInDoc(cmView, this.rawLine, `/timer ${v}`)
          } else {
            timeText.textContent = fmt(localSec)
          }
        }
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { timeText.textContent = fmt(localSec) } }
        inp.onblur = commit
      }
      timeText.onclick = showEdit

      row.appendChild(timeText)
      wrap.appendChild(row)
      return wrap
    }

    // ── Active timer ─────────────────────────────────────
    const total = this.totalSec
    // Restore state — pick up time ticked by background interval while widget was unmounted
    const _tp = _timerPersist.get(this.rawLine)
    if (_tp?.bgInterval) { clearInterval(_tp.bgInterval); _tp.bgInterval = null }
    let remaining = (_tp && _tp.remaining >= 0) ? _tp.remaining : total
    let paused = _tp ? _tp.paused : false
    // Live shared entry — both DOM interval and destroy's background interval mutate this
    const entry = { remaining, paused, bgInterval: null }
    _timerPersist.set(this.rawLine, entry)

    // Vertical left-gutter rail (mirrors the quick-note timer). Multiple /timer
    // lines each float their own rail on the left and stack down the page.
    wrap.classList.add('cm-timer-rail')
    if (this.label) wrap.title = this.label

    const timeText = document.createElement('div')
    timeText.className = 'cm-timer-time'
    timeText.textContent = fmt(remaining)

    // Click time to edit (only when paused) — this is the only path that writes to doc
    timeText.onclick = () => {
      if (!paused) return
      const inp = document.createElement('input')
      inp.className = 'cm-timer-edit-input'
      inp.value = fmt(remaining)
      inp.type = 'text'
      timeText.textContent = ''
      timeText.appendChild(inp)
      inp.focus(); inp.select()
      const commit = () => {
        const v = inp.value.trim()
        let ns = 0
        const hms = v.match(/^(\d+):(\d{2}):(\d{2})$/)
        const ms = v.match(/^(\d+):(\d{2})$/)
        const mn = v.match(/^(\d+)$/)
        if (hms) ns = +hms[1]*3600 + +hms[2]*60 + +hms[3]
        else if (ms) ns = +ms[1]*60 + +ms[2]
        else if (mn) ns = +mn[1]*60
        if (ns > 0) {
          // Clear persist so new widget starts fresh at the edited value
          _timerPersist.delete(this.rawLine)
          const newLine = this.label ? `/timer ${v} ${this.label}` : `/timer ${v}`
          _replaceInDoc(cmView, this.rawLine, newLine)
        } else {
          timeText.textContent = fmt(remaining)
        }
      }
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') timeText.textContent = fmt(remaining) }
      inp.onblur = commit
    }

    const pauseBtn = document.createElement('button')
    pauseBtn.className = 'cm-timer-btn'
    pauseBtn.textContent = paused ? '\u25b6' : '\u23f8'
    const resetBtn = document.createElement('button')
    resetBtn.className = 'cm-timer-btn'
    resetBtn.textContent = '\u21ba'

    // Vertical track \u2014 fill drains from the top (height shrinks as time elapses).
    const bar = document.createElement('div')
    bar.className = 'cm-timer-bar'
    const fill = document.createElement('div')
    fill.className = 'cm-timer-fill'
    fill.style.height = `${(remaining / total) * 100}%`
    bar.appendChild(fill)

    const btnRow = document.createElement('div')
    btnRow.className = 'cm-timer-railbtns'
    btnRow.appendChild(pauseBtn)
    btnRow.appendChild(resetBtn)

    wrap.appendChild(bar)
    wrap.appendChild(timeText)
    wrap.appendChild(btnRow)

    const playTimerSound = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const playTone = (freq, start, dur) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.value = freq; osc.type = 'sine'
          gain.gain.setValueAtTime(0.3, ctx.currentTime + start)
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur)
          osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
        }
        playTone(880, 0, 0.15); playTone(880, 0.2, 0.15); playTone(1100, 0.45, 0.3)
      } catch { /* no audio context available */ }
    }

    const tick = () => {
      remaining--
      entry.remaining = remaining
      if (remaining <= 0) {
        remaining = 0; entry.remaining = 0
        clearInterval(ref.interval); ref.interval = null
        timeText.textContent = 'Done!'
        timeText.classList.add('cm-timer-done')
        fill.style.height = '0%'
        pauseBtn.textContent = '\u23f8'
        _timerPersist.delete(this.rawLine)
        playTimerSound()
        return
      }
      timeText.textContent = fmt(remaining)
      fill.style.height = `${(remaining / total) * 100}%`
    }

    if (!paused) {
      ref.interval = setInterval(tick, 1000)
    }

    pauseBtn.onclick = () => {
      if (remaining <= 0) return
      if (paused) {
        paused = false; pauseBtn.textContent = '\u23f8'
        entry.paused = false
        ref.interval = setInterval(tick, 1000)
      } else {
        paused = true; pauseBtn.textContent = '\u25b6'
        entry.paused = true
        if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
      }
    }
    resetBtn.onclick = () => {
      remaining = total; paused = false
      entry.remaining = total; entry.paused = false
      timeText.textContent = fmt(remaining)
      timeText.classList.remove('cm-timer-done')
      fill.style.height = '100%'
      pauseBtn.textContent = '\u23f8'
      if (ref.interval) clearInterval(ref.interval)
      ref.interval = setInterval(tick, 1000)
    }

    } catch (err) {
      wrap.innerHTML = ''
      const errEl = document.createElement('div')
      errEl.style.cssText = 'padding:8px 12px;color:var(--textDim,#888);font-size:12px;border-left:3px solid var(--border,#ccc);margin:4px 0;'
      errEl.textContent = '/timer — render error: ' + (err?.message || err)
      wrap.appendChild(errEl)
    }
    return wrap
  }
  eq(o) { return o instanceof TimerWidget && o.totalSec === this.totalSec && o.label === this.label }
  compare(o) { return this.eq(o) }
  destroy() {
    if (this._ref.interval) { clearInterval(this._ref.interval); this._ref.interval = null }
    // If still running, hand off to a background interval so time keeps ticking while unmounted
    const entry = _timerPersist.get(this.rawLine)
    if (entry && !entry.paused && entry.remaining > 0) {
      entry.bgInterval = setInterval(() => {
        if (!entry || entry.paused || entry.remaining <= 0) {
          clearInterval(entry.bgInterval); entry.bgInterval = null; return
        }
        entry.remaining = Math.max(0, entry.remaining - 1)
        if (entry.remaining <= 0) { clearInterval(entry.bgInterval); entry.bgInterval = null }
      }, 1000)
    }
  }
  ignoreEvent() { return true }
  get estimatedHeight() { return this.totalSec === 0 ? 40 : 56 }
  coordsAt() { return null }
}

// ─── /pomo widget (pomodoro timer) ───────────────────────────────────────────
export class PomoWidget {
  constructor(rawLine) {
    this.rawLine = rawLine
    this._ref = { interval: null }
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-pomo-widget'
    const ref = this._ref

    const WORK = 25 * 60, SHORT = 5 * 60, LONG = 15 * 60
    let phase = 'work' // 'work' | 'short' | 'long'
    let remaining = WORK
    let paused = true
    let sessions = 0

    const fmt = (s) => {
      const m = Math.floor(s / 60), sec = s % 60
      return `${m}:${String(sec).padStart(2, '0')}`
    }

    const playSound = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const playTone = (freq, start, dur) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain); gain.connect(ctx.destination)
          osc.frequency.value = freq; osc.type = 'sine'
          gain.gain.setValueAtTime(0.3, ctx.currentTime + start)
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + dur)
          osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
        }
        playTone(660, 0, 0.12); playTone(880, 0.15, 0.12); playTone(1100, 0.3, 0.25)
      } catch { /* */ }
    }

    // Vertical left-gutter rail (mirrors the /timer rail). Phase shown as a small
    // tag + fill color; click the tag or skip to advance phase.
    wrap.classList.add('cm-pomo-rail')
    const phaseLabels = { work: 'Focus', short: 'Break', long: 'Long' }

    // Phase tag \u2014 click cycles work \u2192 short \u2192 long \u2192 work
    const phaseTag = document.createElement('button')
    phaseTag.className = 'cm-pomo-tag'
    phaseTag.onclick = () => {
      phase = phase === 'work' ? 'short' : phase === 'short' ? 'long' : 'work'
      remaining = getTotal()
      paused = true
      if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
      update()
    }
    wrap.appendChild(phaseTag)

    // Vertical track + fill (drains from the top)
    const bar = document.createElement('div')
    bar.className = 'cm-pomo-bar'
    const fill = document.createElement('div')
    fill.className = 'cm-pomo-fill'
    fill.style.height = '100%'
    bar.appendChild(fill)
    wrap.appendChild(bar)

    // Time display (vertical)
    const timeText = document.createElement('div')
    timeText.className = 'cm-pomo-time'
    timeText.textContent = fmt(remaining)
    wrap.appendChild(timeText)

    // Session count
    const sessionBadge = document.createElement('span')
    sessionBadge.className = 'cm-pomo-sessions'
    sessionBadge.textContent = '0'
    sessionBadge.title = 'Completed focus sessions'
    wrap.appendChild(sessionBadge)

    // Controls (compact, revealed on hover)
    const controls = document.createElement('div')
    controls.className = 'cm-pomo-controls'
    const playBtn = document.createElement('button')
    playBtn.className = 'cm-pomo-btn cm-pomo-play'
    playBtn.textContent = '\u25b6'
    const resetBtn = document.createElement('button')
    resetBtn.className = 'cm-pomo-btn'
    resetBtn.textContent = '\u21ba'
    const skipBtn = document.createElement('button')
    skipBtn.className = 'cm-pomo-btn'
    skipBtn.textContent = '\u23ed'
    skipBtn.title = 'Skip to next phase'
    controls.appendChild(playBtn)
    controls.appendChild(resetBtn)
    controls.appendChild(skipBtn)
    wrap.appendChild(controls)

    const getTotal = () => phase === 'work' ? WORK : phase === 'short' ? SHORT : LONG

    const update = () => {
      timeText.textContent = fmt(remaining)
      const total = getTotal()
      fill.style.height = `${(remaining / total) * 100}%`
      fill.className = `cm-pomo-fill ${phase === 'work' ? 'cm-pomo-fill-work' : 'cm-pomo-fill-break'}`
      playBtn.textContent = paused ? '\u25b6' : '\u23f8'
      sessionBadge.textContent = `${sessions}`
      phaseTag.textContent = phaseLabels[phase]
      phaseTag.className = `cm-pomo-tag ${phase === 'work' ? 'cm-pomo-tag-work' : 'cm-pomo-tag-break'}`
    }

    const nextPhase = () => {
      playSound()
      if (phase === 'work') {
        sessions++
        phase = sessions % 4 === 0 ? 'long' : 'short'
      } else {
        phase = 'work'
      }
      remaining = getTotal()
      paused = true
      if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
      update()
    }

    const tick = () => {
      remaining--
      if (remaining <= 0) {
        remaining = 0
        if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
        update()
        nextPhase()
        return
      }
      update()
    }

    playBtn.onclick = () => {
      if (remaining <= 0) return
      if (paused) {
        paused = false
        ref.interval = setInterval(tick, 1000)
      } else {
        paused = true
        if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
      }
      update()
    }

    resetBtn.onclick = () => {
      remaining = getTotal()
      paused = true
      if (ref.interval) { clearInterval(ref.interval); ref.interval = null }
      update()
    }

    skipBtn.onclick = nextPhase

    update()
    return wrap
  }
  eq(o) { return o instanceof PomoWidget }
  compare(o) { return this.eq(o) }
  destroy() { if (this._ref.interval) clearInterval(this._ref.interval) }
  ignoreEvent() { return true }
  get estimatedHeight() { return 140 }
  coordsAt() { return null }
}

// ─── /calendar widget (full-width, day/week/month, inline events) ─────────────
export class CalendarWidget {
  constructor(rawData, rawLine) { this.rawData = rawData || ''; this.rawLine = rawLine; this._root = null }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-calendar-widget'
    wrap.style.minHeight = '400px'
    // Dynamically import FullCalendar (avoids circular-dep at module load time)
    import('../views/LibraryView').then(({ FullCalendar }) => {
      if (this._root) return // already mounted
      this._root = createRoot(wrap)
      // Nested root → React context from the app root doesn't reach it, so the
      // lucide defaults (see components/icons.jsx) have to be re-provided here.
      this._root.render(createElement(IconDefaults, null, createElement(FullCalendar, null)))
    })
    return wrap
  }
  eq(o) { return o instanceof CalendarWidget }
  compare(o) { return this.eq(o) }
  destroy() {
    if (this._root) {
      const r = this._root; this._root = null
      // Defer unmount to avoid React warning about unmounting during render
      setTimeout(() => { try { r.unmount() } catch { /**/ } }, 0)
    }
  }
  ignoreEvent() { return true }
  get estimatedHeight() { return 400 }
  coordsAt() { return null }
}

// ─── Inline link widgets (/linkf, /linkw, /linkv) ────────────────────────────

// SVG icon strings keyed by category
export const _LINK_ICONS = {
  image:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
  audio:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/></svg>`,
  video:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>`,
  pdf:    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
  doc:    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`,
  sheet:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>`,
  archive:`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M8 12v-1"/><path d="M8 18v-2"/><path d="M8 7V6"/><circle cx="8" cy="20" r="2"/></svg>`,
  code:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
  text:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>`,
  config: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>`,
  file:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.57" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></svg>`,
}

export function _fileLinkIcon(ext) {
  const e = (ext || '').toLowerCase()
  if (['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tiff'].includes(e)) return _LINK_ICONS.image
  if (['mp3','wav','ogg','flac','aac','m4a','opus'].includes(e))                     return _LINK_ICONS.audio
  if (['mp4','mov','avi','mkv','webm','flv','wmv','m4v'].includes(e))               return _LINK_ICONS.video
  if (e === 'pdf')                                                                   return _LINK_ICONS.pdf
  if (['doc','docx','rtf'].includes(e))                                              return _LINK_ICONS.doc
  if (['xls','xlsx','csv'].includes(e))                                              return _LINK_ICONS.sheet
  if (['zip','gz','tar','rar','7z'].includes(e))                                     return _LINK_ICONS.archive
  if (['js','ts','jsx','tsx','py','rb','go','rs','java','c','cpp','h','css','html'].includes(e)) return _LINK_ICONS.code
  if (['md','txt'].includes(e))                                                      return _LINK_ICONS.text
  if (['json','yaml','yml','xml','toml'].includes(e))                                return _LINK_ICONS.config
  return _LINK_ICONS.file
}

// SVG icon for the web link widget
export const _GLOBE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.77" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`
export const _OPEN_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`

export class FileLinkWidget {
  constructor(path, name) { this.path = path; this.name = name }
  toDOM() {
    const ext = (this.path || '').split('.').pop()
    const wrap = document.createElement('span')
    wrap.className = 'cm-linkf-badge'
    wrap.dataset.linkfPath = this.path
    // `guest-asset:` keys (PLAN_CONCURRENCY.md §18.6, guestAssets.js) are a
    // synthetic room-asset id, not a real path — nothing a person should
    // read as one. The display name is the only meaningful thing to show
    // either as the tooltip or (for makeLinkHandler's click-to-download
    // fallback, since a synthetic key makes a poor download filename) here.
    const isRoomAsset = String(this.path || '').startsWith('guest-asset:')
    const displayName = this.name || this.path.split(/[/\\]/).pop() || this.path
    wrap.dataset.linkfName = displayName
    wrap.title = isRoomAsset ? displayName : this.path

    const iconEl = document.createElement('span')
    iconEl.className = 'cm-linkf-icon'
    iconEl.innerHTML = _fileLinkIcon(ext)

    const nameEl = document.createElement('span')
    nameEl.className = 'cm-linkf-name'
    nameEl.textContent = displayName

    wrap.appendChild(iconEl)
    wrap.appendChild(nameEl)
    return wrap
  }
  eq(o) { return o instanceof FileLinkWidget && o.path === this.path && o.name === this.name }
  compare(o) { return this.eq(o) }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

let _webviewCounter = 0

export class WebLinkWidget {
  constructor(url, title) {
    this.url = url
    this.title = title
    this._label = `gnos-wv-${++_webviewCounter}`
    this._wv = null
    this._cleanup = null
  }

  toDOM() {
    const urlObj = (() => { try { return new URL(this.url) } catch { return null } })()
    const domain = urlObj?.hostname || this.url

    const wrap = document.createElement('div')
    wrap.className = 'cm-linkw-wrap'

    // ── Header bar (single line) ────────────────────────────
    const header = document.createElement('div')
    header.className = 'cm-linkw-header'

    const iconEl = document.createElement('span')
    iconEl.className = 'cm-linkw-glob'
    iconEl.innerHTML = _GLOBE_ICON

    const titleEl = document.createElement('span')
    titleEl.className = 'cm-linkw-title'
    titleEl.textContent = this.title || domain

    const domainEl = document.createElement('span')
    domainEl.className = 'cm-linkw-url'
    domainEl.textContent = this.title ? ` — ${domain}` : ''

    const info = document.createElement('div')
    info.className = 'cm-linkw-info'
    info.appendChild(titleEl); info.appendChild(domainEl)

    const openBtn = document.createElement('button')
    openBtn.className = 'cm-linkw-open-btn'
    openBtn.dataset.linkwUrl = this.url
    openBtn.dataset.linkwTitle = this.title || domain
    openBtn.title = 'Open in new window'
    openBtn.innerHTML = _OPEN_ICON + ' Open'

    header.appendChild(iconEl); header.appendChild(info); header.appendChild(openBtn)

    // ── Native webview area (lazy — thumbnail preview until clicked) ───────
    const viewArea = document.createElement('div')
    viewArea.className = 'cm-linkw-view-area'

    const loadOverlay = document.createElement('div')
    loadOverlay.className = 'cm-linkw-load-overlay'

    // Thumbnail — src set once fetch_og_image resolves
    const thumbImg = document.createElement('img')
    thumbImg.className = 'cm-linkw-thumb'
    thumbImg.alt = ''
    thumbImg.onerror = () => { thumbImg.style.display = 'none' }

    // Favicon badge pinned bottom-left, always visible as fallback
    const faviconBadge = document.createElement('div')
    faviconBadge.className = 'cm-linkw-favicon-badge'
    const faviconImg = document.createElement('img')
    faviconImg.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
    faviconImg.alt = ''
    faviconImg.onerror = () => { faviconBadge.style.display = 'none' }
    faviconBadge.appendChild(faviconImg)

    loadOverlay.appendChild(thumbImg)
    loadOverlay.appendChild(faviconBadge)
    viewArea.appendChild(loadOverlay)

    // Fetch og:image via Rust (bypasses CORS)
    if (_invoke) {
      _invoke('fetch_og_image', { url: this.url }).then(ogUrl => {
        if (ogUrl && loadOverlay.isConnected) thumbImg.src = ogUrl
      }).catch(() => {})
    }

    loadOverlay.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    loadOverlay.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      loadOverlay.remove()
      this._mountWebview(viewArea)
    }, { once: true })

    wrap.appendChild(header)
    wrap.appendChild(viewArea)

    return wrap
  }

  _mountWebview(viewArea) {
    const url = this.url
    const label = this._label
    let attempts = 0

    const getHeaderBottom = () => {
      const hdr = document.querySelector('.nb-header') || document.querySelector('.gnos-header') || document.querySelector('.gnos-titlebar')
      return hdr ? Math.ceil(hdr.getBoundingClientRect().bottom) : 0
    }

    const clampedBounds = (r) => {
      const minY = getHeaderBottom()
      const rawTop = Math.round(r.top)
      const clampedTop = Math.max(rawTop, minY)
      const clampedHeight = Math.max(60, Math.round(r.height) - (clampedTop - rawTop))
      return { x: Math.round(r.left), y: clampedTop, width: Math.max(100, Math.round(r.width)), height: clampedHeight }
    }

    const tryCreate = async () => {
      if (!viewArea.isConnected) {
        if (++attempts < 40) requestAnimationFrame(tryCreate)
        return
      }
      if (!_invoke) {
        // Not in a Tauri context — the card header with Open button is the fallback
        return
      }
      const rect = viewArea.getBoundingClientRect()
      try {
        await _invoke('create_inline_webview', { label, url, ...clampedBounds(rect) })
        this._created = true
      } catch (err) {
        console.warn('[linkw] embedded webview failed:', err)
        return
      }

      let rafId = null
      const reposition = () => {
        if (!viewArea.isConnected || !this._created) return
        const r = viewArea.getBoundingClientRect()
        _invoke('reposition_inline_webview', { label, ...clampedBounds(r) }).catch(() => {})
      }
      const scheduleRepos = () => {
        if (rafId) return
        rafId = requestAnimationFrame(() => { rafId = null; reposition() })
      }

      document.addEventListener('scroll', scheduleRepos, { capture: true, passive: true })
      window.addEventListener('resize', scheduleRepos, { passive: true })

      this._cleanup = () => {
        document.removeEventListener('scroll', scheduleRepos, { capture: true })
        window.removeEventListener('resize', scheduleRepos)
        if (rafId) { cancelAnimationFrame(rafId); rafId = null }
      }
    }
    requestAnimationFrame(tryCreate)
  }

  eq(o) { return o instanceof WebLinkWidget && o.url === this.url && o.title === this.title }
  compare(o) { return this.eq(o) }
  get estimatedHeight() { return 500 }

  destroy() {
    if (this._cleanup) { this._cleanup(); this._cleanup = null }
    if (this._created && _invoke) {
      _invoke('close_inline_webview', { label: this._label }).catch(() => {})
      this._created = false
    }
  }

  ignoreEvent() { return false }
  coordsAt() { return null }
}

export class VideoLinkWidget {
  constructor(src, title) { this.src = src; this.title = title }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-linkv-wrap'

    // ── Single-line header ──────────────────────────────────
    const header = document.createElement('div')
    header.className = 'cm-linkv-header'

    const iconEl = document.createElement('span')
    iconEl.className = 'cm-linkv-icon'
    iconEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.43" stroke-linecap="round" stroke-linejoin="round"><path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>'

    const titleText = (() => {
      if (this.title) return this.title
      const parts = this.src.split(/[\\/]/)
      return parts[parts.length - 1] || this.src
    })()

    const titleEl = document.createElement('span')
    titleEl.className = 'cm-linkv-title'
    titleEl.textContent = titleText

    header.appendChild(iconEl)
    header.appendChild(titleEl)
    wrap.appendChild(header)

    // ── Video element ───────────────────────────────────────
    // Remote/already-loadable sources (http(s), blob, data) work anywhere —
    // the browser fetches them directly, guest or host. A LOCAL path only
    // resolves through Tauri's `_convertFileSrc`; PLAN_CONCURRENCY.md §18.4
    // decided (2026-08-19) that video is excluded from the room's asset map
    // for v1 — a multi-MB file has no business on a WebRTC data channel
    // shared with live keystrokes (same reasoning hostAssets.js's own comment
    // already applies to its 2MB image cap, just more so). So rather than
    // pointing <video> at a bare relative path that will just 404 for a
    // guest, show an explicit placeholder — same shape as assetsPlugin.js's
    // `LocalImageWidget` "not available" state, honest instead of broken.
    const isRemote = /^(https?:|blob:|data:)/i.test(this.src)
    if (!isRemote && !_convertFileSrc) {
      const ph = document.createElement('div')
      ph.className = 'cm-linkv-unavailable'
      ph.textContent = '🎬 video — not available in shared notes yet'
      wrap.appendChild(ph)
      return wrap
    }

    const video = document.createElement('video')
    video.className = 'cm-linkv-video'
    video.controls = true
    video.preload = 'metadata'
    let resolvedSrc = this.src
    if (_convertFileSrc && !isRemote) {
      try { resolvedSrc = _convertFileSrc(this.src) } catch { /**/ }
    }
    video.src = resolvedSrc

    // Seek to first frame once metadata is loaded so it shows as a thumbnail
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = 0.001
    }, { once: true })

    wrap.appendChild(video)

    return wrap
  }
  eq(o) { return o instanceof VideoLinkWidget && o.src === this.src && o.title === this.title }
  compare(o) { return this.eq(o) }
  get estimatedHeight() { return 220 }
  destroy() {}
  ignoreEvent() { return false }
  coordsAt() { return null }
}

// ─── /linkf, /linkw, /linkv — Enter key notifies React to open picker/modal ───
// onPickRef is a React ref whose .current is set to a callback each render.
// Calling native dialogs from inside CM keymaps can crash the app on macOS —
// so we just signal React and let the effect/JSX handle the actual dialog.
export function makeLinkCommands(cm, onPickRef) {
  const { Prec } = cm.state
  return Prec.high(cm.view.keymap.of([{
    key: 'Enter',
    run: (view) => {
      const { state } = view
      const line = state.doc.lineAt(state.selection.main.head)
      const txt = line.text.trim()
      const onPick = typeof onPickRef === 'function' ? onPickRef : onPickRef?.current
      if (txt === '/linkf') { onPick?.({ type: 'file',  lineFrom: line.from, lineTo: line.to }); return true }
      if (txt === '/linkw') { onPick?.({ type: 'web',   lineFrom: line.from, lineTo: line.to }); return true }
      if (txt === '/linkv') { onPick?.({ type: 'video', lineFrom: line.from, lineTo: line.to }); return true }
      return false
    },
  }]))
}

// ─── /color, /font, /spacing, /size — keymap only ────────────────────────────
// Detection + coord lookup lives in the EditorView.updateListener (see below).
// This function only provides the Prec.high keymap so Enter/Tab/↑↓ work.
export function makeInlineCmdPlugin(cm, navRef) {
  const { Prec } = cm.state
  const { keymap: keymapFacet } = cm.view

  const CMD_RE = /^\s*\/(color|font|spacing|size|align|columns|bold|italic|bi|strike|highlight|code|sup|sub)(?::([^\s]*))?$/
  const shared = { selectedIdx: 0, type: null }

  function detect(state) {
    const cur = state.selection.main.head
    const line = state.doc.lineAt(cur)
    const m = line.text.match(CMD_RE)
    if (!m) return null
    return { type: m[1], hint: (m[2] || '').toLowerCase(), lineFrom: line.from, lineTo: line.to }
  }

  return Prec.high(keymapFacet.of([
    {
      key: 'Escape',
      run: _view => {
        const result = detect(_view.state)
        if (!result) return false
        _inlineCmdSelectedIdx.current = 0
        shared.selectedIdx = 0; shared.type = null
        navRef?.current?.()
        return false  // let Escape propagate
      },
    },
    {
      key: 'ArrowDown',
      run: _view => {
        const result = detect(_view.state)
        if (!result) return false
        const count = _getOptionCount(result.type)
        if (count > 0) {
          const newIdx = (_inlineCmdSelectedIdx.current + 1) % count
          _inlineCmdSelectedIdx.current = newIdx
          navRef?.current?.()
        }
        return true  // consume — prevents cursor moving off the command line
      },
    },
    {
      key: 'ArrowUp',
      run: _view => {
        const result = detect(_view.state)
        if (!result) return false
        const count = _getOptionCount(result.type)
        if (count > 0) {
          const newIdx = (_inlineCmdSelectedIdx.current - 1 + count) % count
          _inlineCmdSelectedIdx.current = newIdx
          navRef?.current?.()
        }
        return true  // consume — prevents cursor moving off the command line
      },
    },
    {
      key: 'Tab',
      run: view => {
        const result = detect(view.state)
        if (!result) return false
        _confirmInlineCmd(view, result.type, _inlineCmdSelectedIdx.current, result.hint, result.lineFrom, result.lineTo)
        shared.selectedIdx = 0; shared.type = null; _inlineCmdSelectedIdx.current = 0
        return true
      },
    },
    {
      key: 'Enter',
      run: view => {
        const result = detect(view.state)
        if (!result) return false
        _confirmInlineCmd(view, result.type, _inlineCmdSelectedIdx.current, result.hint, result.lineFrom, result.lineTo)
        shared.selectedIdx = 0; shared.type = null; _inlineCmdSelectedIdx.current = 0
        return true
      },
    },
  ]))
}

// Shared mutable ref for selectedIdx — written by the keymap, read by React render
export const _inlineCmdSelectedIdx = { current: 0 }

export const INLINE_COLORS = [
  { name: 'Red',     value: '#e53935' },
  { name: 'Orange',  value: '#f4511e' },
  { name: 'Amber',   value: '#f59f00' },
  { name: 'Yellow',  value: '#e6c20a' },
  { name: 'Green',   value: '#2e7d32' },
  { name: 'Teal',    value: '#00796b' },
  { name: 'Cyan',    value: '#0097a7' },
  { name: 'Blue',    value: '#1565c0' },
  { name: 'Indigo',  value: '#3949ab' },
  { name: 'Violet',  value: '#6a1b9a' },
  { name: 'Purple',  value: '#8e24aa' },
  { name: 'Pink',    value: '#d81b60' },
  { name: 'Rose',    value: '#c2185b' },
  { name: 'Brown',   value: '#6d4c41' },
  { name: 'Slate',   value: '#546e7a' },
  { name: 'Gray',    value: '#757575' },
  { name: 'Silver',  value: '#9e9e9e' },
  { name: 'Muted',   value: 'var(--textDim)' },
  { name: 'Accent',  value: 'var(--accent)' },
  { name: 'Default', value: 'inherit' },
]

export const INLINE_FONTS = [
  { name: 'Default',       value: 'var(--nb-ff)' },
  { name: 'Georgia',       value: 'Georgia, serif' },
  { name: 'Palatino',      value: '"Palatino Linotype", Palatino, serif' },
  { name: 'Garamond',      value: '"EB Garamond", Garamond, serif' },
  { name: 'Times',         value: '"Times New Roman", Times, serif' },
  { name: 'Arial',         value: 'Arial, sans-serif' },
  { name: 'Helvetica',     value: 'Helvetica, Arial, sans-serif' },
  { name: 'Verdana',       value: 'Verdana, Geneva, sans-serif' },
  { name: 'Trebuchet',     value: '"Trebuchet MS", sans-serif' },
  { name: 'Optima',        value: '"Optima", "Segoe UI", sans-serif' },
  { name: 'Gill Sans',     value: '"Gill Sans", "Gill Sans MT", sans-serif' },
  { name: 'Futura',        value: '"Futura", "Century Gothic", sans-serif' },
  { name: 'Courier',       value: '"Courier New", Courier, monospace' },
  { name: 'Menlo',         value: 'Menlo, Monaco, Consolas, monospace' },
  { name: 'SF Mono',       value: '"SF Mono", "Fira Code", monospace' },
]

export const INLINE_SPACINGS = [
  { name: 'Tight',    value: '1.3', preview: '1.3×' },
  { name: 'Compact',  value: '1.5', preview: '1.5×' },
  { name: 'Normal',   value: '1.8', preview: '1.8×' },
  { name: 'Relaxed',  value: '2.2', preview: '2.2×' },
  { name: 'Double',   value: '2.8', preview: '2.8×' },
]

export const INLINE_SIZES = [
  { name: 'XS',     value: '0.72em', preview: 'Aa' },
  { name: 'Small',  value: '0.85em', preview: 'Aa' },
  { name: 'Normal', value: '1em',    preview: 'Aa' },
  { name: 'Large',  value: '1.2em',  preview: 'Aa' },
  { name: 'XL',     value: '1.5em',  preview: 'Aa' },
  { name: 'XXL',    value: '2em',    preview: 'Aa' },
  { name: 'Huge',   value: '2.8em',  preview: 'Aa' },
]

export const INLINE_ALIGNS = [
  { name: 'Left',    value: 'left'    },
  { name: 'Center',  value: 'center'  },
  { name: 'Right',   value: 'right'   },
  { name: 'Justify', value: 'justify' },
]

export const INLINE_COLUMNS = [
  { name: '1 Column',  value: '1', preview: '1×' },
  { name: '2 Columns', value: '2', preview: '2×' },
  { name: '3 Columns', value: '3', preview: '3×' },
  { name: '4 Columns', value: '4', preview: '4×' },
]

export function _getOptionCount(type) {
  if (type === 'color') return INLINE_COLORS.length
  if (type === 'font') return INLINE_FONTS.length
  if (type === 'spacing') return INLINE_SPACINGS.length
  if (type === 'size') return INLINE_SIZES.length
  if (type === 'align') return INLINE_ALIGNS.length
  if (type === 'columns') return INLINE_COLUMNS.length
  return 0
}

export function _confirmInlineCmd(view, type, selectedIdx, hint, lineFrom, lineTo) {
  let marker = ''
  if (type === 'color') {
    // If hint matches a named color, use it; otherwise use selected
    const byName = INLINE_COLORS.find(c => c.name.toLowerCase() === hint)
    const opt = byName || INLINE_COLORS[Math.min(selectedIdx, INLINE_COLORS.length - 1)]
    if (opt) marker = `{color:${opt.value}}`
  } else if (type === 'font') {
    const byName = hint && INLINE_FONTS.find(f => f.name.toLowerCase().startsWith(hint))
    const opt = byName || INLINE_FONTS[Math.min(selectedIdx, INLINE_FONTS.length - 1)]
    if (opt) marker = `{font:${opt.value}}`
  } else if (type === 'spacing') {
    const byName = hint && INLINE_SPACINGS.find(s => s.name.toLowerCase().startsWith(hint))
    const opt = byName || INLINE_SPACINGS[Math.min(selectedIdx, INLINE_SPACINGS.length - 1)]
    if (opt) marker = `{spacing:${opt.value}}`
  } else if (type === 'size') {
    const byName = hint && INLINE_SIZES.find(s => s.name.toLowerCase().startsWith(hint))
    const opt = byName || INLINE_SIZES[Math.min(selectedIdx, INLINE_SIZES.length - 1)]
    if (opt) marker = `{size:${opt.value}}`
  } else if (type === 'align') {
    const byName = hint && INLINE_ALIGNS.find(a => a.name.toLowerCase().startsWith(hint) || a.value.startsWith(hint))
    const opt = byName || INLINE_ALIGNS[Math.min(selectedIdx, INLINE_ALIGNS.length - 1)]
    if (opt) marker = `{align:${opt.value}}`
  } else if (type === 'columns') {
    const byName = hint && INLINE_COLUMNS.find(c => c.value === hint || c.name.toLowerCase().startsWith(hint))
    const opt = byName || INLINE_COLUMNS[Math.min(selectedIdx, INLINE_COLUMNS.length - 1)]
    if (opt) marker = `{columns:${opt.value}}`
  } else if (['bold','italic','bi','strike','highlight','code','sup','sub'].includes(type)) {
    marker = `{${type}}`
  }
  if (!marker) return
  view.dispatch({
    changes: { from: lineFrom, to: lineTo, insert: marker },
    selection: { anchor: lineFrom + marker.length },
  })
}

// ─── Auto-close {//} when user types // after an open inline-cmd span ────────
export function makeInlineCmdCloseHandler(cm) {
  return cm.view.EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== '/') return false
    const { state } = view
    const docText = state.doc.toString()
    const charBefore = from > 0 ? docText[from - 1] : ''
    // Only trigger on second slash (user just typed the second /)
    if (charBefore !== '/') return false
    // Don't convert if preceded by : (e.g., https://)
    if (from >= 2 && docText[from - 2] === ':') return false
    // Check if there's an unclosed {color:...}, {font:...}, or {spacing:...} before cursor
    const textBefore = docText.slice(0, from - 1) // text before the first slash
    const openRe = /\{(color|font|spacing|size|align|columns|bold|italic|bi|strike|highlight|code|sup|sub)(?::[^}]+)?\}/g
    const closeRe = /\{\/\/\}/g
    let openCount = 0, closeCount = 0
    let m
    while ((m = openRe.exec(textBefore)) !== null) openCount++
    while ((m = closeRe.exec(textBefore)) !== null) closeCount++
    if (openCount <= closeCount) return false // no unclosed span
    // Replace the first / and insert {//}
    view.dispatch({
      changes: { from: from - 1, to, insert: '{//}' },
      selection: { anchor: from - 1 + 4 },
    })
    return true
  })
}

// ─── Live preview plugin ──────────────────────────────────────────────────────
// `assets` — optional `{ assetsMap, assetsMetaMap }`, the Yjs maps a shared
// room publishes local images into (src/lib/collab/hostAssets.js). Threaded
// straight through to every `ImgWidget` — see its own header comment
// (PLAN_CONCURRENCY.md §18.4 "Phase B") for when it actually gets consulted.
// No caller passes this yet; NotebookView.jsx's own real editor always has a
// `notebookDir`, so this is purely a capability for Phase D's guest wiring —
// zero behavior change until something other than `null` flows in here.
//
// `hasVault` — default `true` (NotebookView.jsx's own real editor always has
// one, zero behavior change there). An empty `notebooks`/`library` array is
// ambiguous on its own — a genuinely empty vault is a real, valid host state
// — so "no vault to check at all" (a guest, PLAN_CONCURRENCY.md §18.5) needs
// its own explicit signal rather than being inferred from empty arrays. Only
// consulted by the wikilink resolver, to pick the `unavailable` state over
// `new` — see WikiWidget's own header comment for why those two must stay
// visually and semantically distinct.
//
// `questionStoreApi` — optional `{ getFlashcardDecks(), addCardToDeck() }`,
// threaded straight to every `QuestionWidget` — see its own header comment
// for why this is injected rather than read from a hard `useAppStore`
// import. `null` (NotebookView.jsx passes a real one; nothing else does yet)
// makes a `?[question]` widget behave exactly as before this param existed —
// empty deck list, add-to-deck a no-op.
export function makeLivePlugin(cm, RangeSetBuilder, notebooks, library, sketchbooks = [], flashcardDecks = [], notebookDir = null, isPreview = false, assets = null, hasVault = true, questionStoreApi = null) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view
  const { StateField } = cm.state
  const { syntaxTree, foldedRanges, foldEffect, unfoldEffect } = cm.language

  // Patch widget classes to extend WidgetType so CM6 properly handles them
  for (const Cls of [HRWidget, ColumnsWidget, CheckboxWidget, ImgWidget, ListMarkerWidget, MathWidget, WikiWidget, LinkWidget, TableWidget, HabitsWidget, TaskBlockWidget, SupWidget, SubWidget, TimerWidget, MathZoneWidget, CalendarWidget, TimeRefWidget, FnRefWidget, DueDateWidget, TagWidget, QuestionWidget, FileLinkWidget, WebLinkWidget, VideoLinkWidget, StatusWidget, FoldArrowWidget, DiagramWidget]) {
    if (!(Cls.prototype instanceof WidgetType)) {
      Object.setPrototypeOf(Cls.prototype, WidgetType.prototype)
    }
  }

  const PUNCT_NODES = new Set([
    'EmphasisMark', 'HeaderMark', 'CodeMark', 'StrikethroughMark',
    'LinkMark', 'ImageMark', 'QuoteMark', 'TaskMarker',
    'TableDelimiter',
  ])

  const SPAN_MAP = {
    StrongEmphasis: null, // handled specially
    Emphasis:       'cm-lv-i',
    Strikethrough:  'cm-lv-s',
    InlineCode:     'cm-lv-c',
    Highlight:      'cm-lv-hl',
    Link:           'cm-lv-lnk',
    Image:          'cm-lv-lnk',
  }

  const LINE_MAP = {
    ATXHeading1: 'cm-lv-h1', ATXHeading2: 'cm-lv-h2', ATXHeading3: 'cm-lv-h3',
    ATXHeading4: 'cm-lv-h4', ATXHeading5: 'cm-lv-h5', ATXHeading6: 'cm-lv-h6',
  }
  const CODE_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'IndentedCode'])

  // The set of nodes whose marks we want to hide/show as a unit
  const INLINE_ANCESTORS = new Set(['Emphasis','StrongEmphasis','Strikethrough','InlineCode','Link','Image','Highlight'])

  /** Shared: parse markdown table text and push a TableWidget decoration */
  function _renderTableDeco(doc, from, to, inCur, inlines) {
    const tableText = doc.sliceString(from, to)
    const tableLines = tableText.split('\n').filter(l => l.trim())
    if (tableLines.length < 2) return
    // Must have a separator row (|---|---| or |:--|--:|)
    if (!/^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?$/.test(tableLines[1].trim())) return
    const parseRow = row => {
      const trimmed = row.trim()
      const inner = trimmed.replace(/^(?<!\\)\|/, '').replace(/(?<!\\)\|$/, '')
      return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
    }
    const headers = parseRow(tableLines[0])
    const sep = parseRow(tableLines[1])
    const aligns = sep.map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left')
    const isSepRow = l => parseRow(l).every(c => /^:?-+:?$/.test(c))
    const rows = tableLines.slice(2).filter(l => /\|/.test(l) && !isSepRow(l))
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const thHtml = headers.map((h, i) => `<th style="text-align:${aligns[i]||'left'}">${esc(h)}</th>`).join('')
    const tbHtml = rows.map(r => {
      const cells = parseRow(r)
      const norm  = Array.from({ length: headers.length }, (_, i) => cells[i] ?? '')
      return `<tr>${norm.map((c, i) => `<td style="text-align:${aligns[i]||'left'}">${esc(c)}</td>`).join('')}</tr>`
    }).join('')
    const html = `<table class="nb-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table>`
    // block: true requires both positions to be line starts
    const tLineFrom = doc.lineAt(from).from
    const lastLine = doc.lineAt(Math.max(from, Math.min(to - 1, doc.length - 1)))
    // Position after the last table line's \n = start of next line (a valid line start)
    const tLineTo = lastLine.to < doc.length ? lastLine.to + 1 : doc.length
    inlines.push({ from: tLineFrom, to: tLineTo, deco: Decoration.replace({ widget: new TableWidget(html) }) })
  }

  /** Build a RangeSet of block-replace table decorations for a given EditorState.
   *  Must live in a StateField because block: true is forbidden in ViewPlugin.
   *  Tables always render as widgets; editing is done via inline cell inputs. */
  function _buildTableDecos(state) {
    const builder = new RangeSetBuilder()
    const doc  = state.doc
    const full = docString(doc)
    if (!full.includes('|')) return builder.finish() // no tables — skip the regex scan
    const decos = []
    // Match header row \n separator row \n optional body rows.
    // Body rows: \|?[^\n]+ (anything with at least one char — no trailing-pipe requirement)
    const tableRe = /^(\|[^\n]+\|?)\n(\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?)((?:\n\|[^\n]+)*)/gm
    let tm
    while ((tm = tableRe.exec(full)) !== null) {
      const tFrom   = tm.index
      const tTo     = tm.index + tm[0].length
      const rawText = tm[0]
      const tableLines = rawText.split('\n').filter(l => l.trim())
      if (tableLines.length < 2) continue
      if (!/^[\s|:-]+$/.test(tableLines[1])) continue
      const parseRow = row => {
        const trimmed = row.trim()
        const inner = trimmed.replace(/^(?<!\\)\|/, '').replace(/(?<!\\)\|$/, '')
        return inner.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
      }
      const headers = parseRow(tableLines[0])
      const sep     = parseRow(tableLines[1])
      const aligns  = sep.map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : 'left')
      const isSepRow = l => parseRow(l).every(c => /^:?-+:?$/.test(c))
      const rows    = tableLines.slice(2).filter(l => /\|/.test(l) && !isSepRow(l))
      const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      const thHtml = headers.map((h, i) => `<th style="text-align:${aligns[i]||'left'}">${esc(h)}</th>`).join('')
      const tbHtml = rows.map(r => {
        const cells = parseRow(r)
        const norm  = Array.from({ length: headers.length }, (_, i) => cells[i] ?? '')
        return `<tr>${norm.map((c, i) => `<td style="text-align:${aligns[i]||'left'}">${esc(c)}</td>`).join('')}</tr>`
      }).join('')
      const html = `<table class="nb-table"><thead><tr>${thHtml}</tr></thead><tbody>${tbHtml}</tbody></table>`
      const tLineFrom = doc.lineAt(tFrom).from
      const lastLine  = doc.lineAt(Math.max(tFrom, Math.min(tTo - 1, doc.length - 1)))
      const tLineTo   = lastLine.to < doc.length ? lastLine.to + 1 : doc.length
      if (tLineTo > tLineFrom) decos.push({ from: tLineFrom, to: tLineTo, html, rawText })
    }
    decos.sort((a, b) => a.from - b.from)
    for (const { from, to, html, rawText } of decos) {
      try { builder.add(from, to, Decoration.replace({ widget: new TableWidget(html, rawText), block: true })) } catch { /**/ }
    }
    try { return builder.finish() } catch { return Decoration.none }
  }

  function build(view) {
    const { state } = view
    const cur = state.selection.main.head
    const doc = state.doc
    const inCur = isPreview ? () => false : (f, t) => cur >= f && cur <= t
    const fullDoc = docString(doc)

    const inlines  = []
    const lineDecs = []

    // Frontmatter range (chars) — computed up front so the HR handler skips the
    // opening/closing `---` (they'd otherwise render as horizontal rules and
    // overlap the properties-card decoration).
    const _fm = parseFrontmatter(fullDoc)
    const fmEnd = _fm && _fm.props.length ? _fm.length : 0

    // ── Heading fold-range pre-scan ─────────────────────────────────────────
    // A section's fold range (end of heading line → last line before the next
    // heading of equal-or-higher level, or doc end) needs the full heading list
    // up front, so this runs as its own light pass before the main walk below.
    const _foldInfo = new Map() // headingLinePos -> { foldFrom, foldTo, collapsed }
    if (!isPreview) {
      try {
        const _headings = []
        syntaxTree(state).iterate({
          enter(node) {
            if (LINE_MAP[node.name]) {
              _headings.push({ pos: doc.lineAt(node.from).from, level: +node.name.slice(-1) })
            }
          },
        })
        const folded = foldedRanges(state)
        for (let i = 0; i < _headings.length; i++) {
          const h = _headings[i]
          const hLine = doc.lineAt(h.pos)
          let endPos = doc.length
          for (let j = i + 1; j < _headings.length; j++) {
            if (_headings[j].level <= h.level) { endPos = doc.lineAt(_headings[j].pos).from; break }
          }
          const foldFrom = hLine.to
          const foldTo = endPos > foldFrom ? (endPos - (endPos < doc.length ? 1 : 0)) : foldFrom
          if (foldTo <= foldFrom) continue // nothing below this heading — no arrow
          let collapsed = false
          folded.between(foldFrom, foldFrom, (rf) => { if (rf === foldFrom) collapsed = true })
          _foldInfo.set(h.pos, { foldFrom, foldTo, collapsed })
        }
      } catch { /**/ }
    }

    try {
      syntaxTree(state).iterate({
        enter(node) {
          const { from, to, name } = node
          if (from >= to) return

          // ── Code block ──────────────────────────────────────────────────
          if (CODE_BLOCKS.has(name)) {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-cb' }) } catch { /**/ }
            }
            return false
          }

          // ── Horizontal rule ─────────────────────────────────────────────
          if (name === 'HorizontalRule') {
            const ln = doc.lineAt(from)
            if (ln.from < fmEnd) return false   // inside frontmatter — not an HR
            if (!inCur(ln.from, ln.to)) {
              inlines.push({ from: ln.from, to: ln.to, deco: Decoration.replace({ widget: new HRWidget() }) })
            }
            return false
          }

          // ── Table — handled in tableDecoField (block: true requires StateField) ──
          if (name === 'Table') return false

          // ── Task checkbox ────────────────────────────────────────────────
          if (name === 'TaskMarker') {
            const raw = doc.sliceString(from, to)
            const ck  = /\[[xX]\]/.test(raw)
            if (!inCur(from, to)) {
              inlines.push({ from, to, deco: Decoration.replace({ widget: new CheckboxWidget(ck, from) }) })
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── Image — replace entire image node (not the line) ────────────
          if (name === 'Image') {
            const raw = doc.sliceString(from, to)
            // Match ![alt](src =Nx) — optional =Nx width spec
            const m   = raw.match(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+=(\d+)x)?/)
            if (m) {
              if (!inCur(from, to)) {
                // Width comes from the alt (`caption|600`), falling back to the
                // legacy `=600x` spec so existing notes still size correctly.
                // Width and alignment both live in the alt (`caption:center|600`)
                // and are stripped from the caption the reader sees.
                const parsedAlt = parseImgAlt(m[1])
                const imgWidth = parsedAlt.width || (m[3] ? parseInt(m[3]) : 0)
                // Replace only the image syntax, not the whole line
                inlines.push({ from, to, deco: Decoration.replace({ widget: new ImgWidget(m[2], parsedAlt.alt, notebookDir, from, imgWidth, parsedAlt.align, assets), block: false }) })
                return false
              }
            }
          }

          // ── Math: inline $…$ and block $$…$$ ───────────────────────────
          if (name === 'InlineMath' || name === 'BlockMath' || name === 'MathSpan') {
            const raw = doc.sliceString(from, to)
            const isBlock = name === 'BlockMath'
            const tex = raw.replace(/^\$+\n?/, '').replace(/\n?\$+$/, '')
            if (!inCur(from, to)) {
              inlines.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(tex, isBlock, from, to) }) })
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── List marker ─────────────────────────────────────────────────
          if (name === 'ListMark') {
            const ln = doc.lineAt(from)
            if (!inCur(ln.from, ln.to)) {
              // Don't show bullet for task list items — they have their own checkbox widget
              let isTaskItem = false
              const parentItem = node.node.parent // ListItem
              if (parentItem && parentItem.name === 'ListItem') {
                let sib = parentItem.firstChild
                while (sib) {
                  if (sib.name === 'TaskMarker') { isTaskItem = true; break }
                  sib = sib.nextSibling
                }
              }
              if (isTaskItem) {
                // Hide '- ' (dash + trailing space) so only the checkbox shows
                const spaceAfter = to < doc.length && doc.sliceString(to, to + 1) === ' ' ? 1 : 0
                inlines.push({ from, to: to + spaceAfter, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
              } else {
                let isOrdered = false
                let p = node.node.parent
                while (p) {
                  if (p.name === 'OrderedList') { isOrdered = true; break }
                  if (p.name === 'BulletList') break
                  p = p.parent
                }
                const markerText = isOrdered ? doc.sliceString(from, to) : '•'
                // Include the trailing space in the replace range so the widget
                // controls the full "marker + gap" width, preventing text jump
                const spaceAfter = to < doc.length && doc.sliceString(to, to + 1) === ' ' ? 1 : 0
                inlines.push({ from, to: to + spaceAfter, deco: Decoration.replace({ widget: new ListMarkerWidget(markerText, isOrdered) }) })
              }
            } else {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            }
            return false
          }

          // ── Heading line decoration ──────────────────────────────────────
          if (LINE_MAP[name]) {
            try { lineDecs.push({ pos: doc.lineAt(from).from, cls: LINE_MAP[name] }) } catch { /**/ }
            // Hide heading marks (# / ## / etc.) when cursor is not on this heading line
            try {
              const headingLine = doc.lineAt(from)
              const cursorOnLine = cur >= headingLine.from && cur <= headingLine.to
              const fi = _foldInfo.get(headingLine.from)
              let child = node.node.firstChild
              while (child) {
                if (child.name === 'HeaderMark') {
                  // +1 to also hide the space after the #
                  const markTo = Math.min(child.to + 1, headingLine.to)
                  if (!cursorOnLine && fi) {
                    // Foldable heading, not being edited — show the fold arrow
                    // in place of the (still hidden) # marks instead of just hiding them.
                    inlines.push({
                      from: child.from, to: markTo,
                      deco: Decoration.replace({ widget: new FoldArrowWidget(fi.collapsed, fi.foldFrom, fi.foldTo) }),
                    })
                  } else {
                    inlines.push({
                      from: child.from, to: markTo,
                      deco: Decoration.mark({ class: cursorOnLine ? 'cm-lv-p' : 'cm-lv-hidden' }),
                    })
                  }
                }
                child = child.nextSibling
              }
            } catch { /**/ }
          }

          // ── Blockquote line decoration ───────────────────────────────────
          if (name === 'Blockquote') {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-bq' }) } catch { /**/ }
            }
            // Hide QuoteMark (>) when cursor is not inside the blockquote
            try {
              const cursorInBq = inCur(from, to)
              node.node.cursor().iterate(inner => {
                if (inner.name === 'QuoteMark') {
                  // +1 to consume the space after '>'
                  const markTo = Math.min(inner.to + 1, doc.lineAt(inner.from).to)
                  inlines.push({
                    from: inner.from, to: markTo,
                    deco: Decoration.mark({ class: cursorInBq ? 'cm-lv-p' : 'cm-lv-hidden' }),
                  })
                }
              })
            } catch { /**/ }
          }

          // ── List item: depth + ordered/unordered ─────────────────────────
          if (name === 'ListItem') {
            try {
              const linePos = doc.lineAt(from).from
              let p = node.node.parent
              let depth = 0
              let isOrdered = false
              while (p) {
                if (p.name === 'BulletList' || p.name === 'OrderedList') {
                  if (depth === 0) isOrdered = p.name === 'OrderedList'
                  depth++
                }
                p = p.parent
              }
              const depthCls = `cm-lv-depth-${Math.min(depth, 4)}`
              const cls = isOrdered
                ? `cm-lv-li cm-lv-oli ${depthCls}`
                : `cm-lv-li ${depthCls}`
              lineDecs.push({ pos: linePos, cls })
            } catch { /**/ }
          }

          // ── Inline content span ──────────────────────────────────────────
          // Obsidian approach: marks inside a span are NEVER replaced — they
          // are styled with font-size:0 via cm-lv-p (cursor off) or shown
          // dimly (cursor on). This avoids the RangeSetBuilder overlap-skip
          // issue that causes the opening ** to remain visible.
          if (name === 'StrongEmphasis') {
            const cursorInSpan = inCur(from, to)
            // Check if this contains an Emphasis child (making it bold-italic)
            let hasEmphasis = false
            let child = node.node.firstChild
            while (child) {
              if (child.name === 'Emphasis') { hasEmphasis = true; break }
              child = child.nextSibling
            }
            // Check if there's actual non-whitespace text content between markers
            const rawContent = doc.sliceString(from, to)
            const markerLen = hasEmphasis ? 3 : 2
            const innerText = rawContent.slice(markerLen, rawContent.length - markerLen)
            const hasRealContent = innerText.trim().length > 0

            if (hasRealContent) {
              const cls = hasEmphasis ? 'cm-lv-bi' : 'cm-lv-b'
              inlines.push({ from, to, deco: Decoration.mark({ class: cls }) })

              // Hide ALL EmphasisMark nodes (covers **, ***, etc.)
              child = node.node.firstChild
              while (child) {
                if (child.name === 'EmphasisMark') {
                  inlines.push({
                    from: child.from, to: child.to,
                    deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                  })
                }
                if (child.name === 'Emphasis') {
                  let grandchild = child.firstChild
                  while (grandchild) {
                    if (grandchild.name === 'EmphasisMark') {
                      inlines.push({
                        from: grandchild.from, to: grandchild.to,
                        deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                      })
                    }
                    grandchild = grandchild.nextSibling
                  }
                }
                child = child.nextSibling
              }
            }
            // If no real content, don't hide syntax — show as-is
            return false
          } else if (SPAN_MAP[name] !== undefined) {
            if (SPAN_MAP[name]) {
              const cursorInSpan = inCur(from, to)
              // Check if Emphasis wraps StrongEmphasis (bold-italic: ***text***)
              let emphCls = SPAN_MAP[name]
              if (name === 'Emphasis') {
                let ch = node.node.firstChild
                while (ch) {
                  if (ch.name === 'StrongEmphasis') { emphCls = 'cm-lv-bi'; break }
                  ch = ch.nextSibling
                }
              }
              // Check if there's actual non-whitespace text wrapped
              const rawContent = doc.sliceString(from, to)
              const markLen = name === 'InlineCode' ? 1 : name === 'Strikethrough' || name === 'Highlight' ? 2 : 1
              const innerText = rawContent.slice(markLen, rawContent.length - markLen)
              const hasRealContent = innerText.trim().length > 0 || name === 'Link' || name === 'Image'

              if (!hasRealContent) {
                // No real content — don't format or hide, show syntax as-is
                return false
              }

              // For Link: replace whole syntax with a widget when cursor is off (no mark needed)
              if (name === 'Link' && !cursorInSpan) {
                const raw = doc.sliceString(from, to)
                const lm = raw.match(/^\[([^\]]*)\]\(([^\s)]*)\)$/)
                if (lm) {
                  // Skip — let QuestionWidget own the whole ?[...](...)  range
                  const prevChar = from > 0 ? doc.sliceString(from - 1, from) : ''
                  if (prevChar !== '?') {
                    inlines.push({ from, to, deco: Decoration.replace({ widget: new LinkWidget(lm[1], lm[2]) }) })
                  }
                  return false
                }
              }
              inlines.push({ from, to, deco: Decoration.mark({ class: emphCls }) })
              // Hide marks as zero-width (Obsidian style) rather than replace
              let child = node.node.firstChild
              while (child) {
                if (PUNCT_NODES.has(child.name)) {
                  inlines.push({
                    from: child.from, to: child.to,
                    deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                  })
                }
                // Also hide marks inside nested StrongEmphasis (for ***text***)
                if (child.name === 'StrongEmphasis') {
                  let gc = child.firstChild
                  while (gc) {
                    if (gc.name === 'EmphasisMark') {
                      inlines.push({
                        from: gc.from, to: gc.to,
                        deco: Decoration.mark({ class: cursorInSpan ? 'cm-lv-p' : 'cm-lv-hidden' }),
                      })
                    }
                    gc = gc.nextSibling
                  }
                }
                child = child.nextSibling
              }
              return false
            }
          }

          // ── Heading mark (# ## ### …) hiding ────────────────────────────
          if (name === 'HeaderMark') {
            const ln = doc.lineAt(from)
            const cls = inCur(ln.from, ln.to) ? 'cm-lv-p' : 'cm-lv-hidden'
            inlines.push({ from, to, deco: Decoration.mark({ class: cls }) })
            return false
          }

          // ── Cursor-aware punctuation hiding (inline spans only) ──────────
          // Marks belonging to StrongEmphasis, Emphasis, Link, etc. are already
          // handled in their parent's branch above with return false — this
          // fallback only catches orphaned or unrecognised marks.
          if (PUNCT_NODES.has(name) && name !== 'ListMark' && name !== 'TaskMarker'
              && name !== 'EmphasisMark' && name !== 'HeaderMark'
              && name !== 'LinkMark' && name !== 'ImageMark'
              && name !== 'CodeMark' && name !== 'StrikethroughMark') {
            const parent = node.node.parent
            if (!parent || !INLINE_ANCESTORS.has(parent.name)) return

            let ancestor = parent
            while (ancestor.parent && INLINE_ANCESTORS.has(ancestor.parent.name)) {
              ancestor = ancestor.parent
            }
            const af = ancestor.from
            const at = ancestor.to
            if (inCur(af, at)) {
              inlines.push({ from, to, deco: Decoration.mark({ class: 'cm-lv-p' }) })
            } else {
              inlines.push({ from, to, deco: Decoration.replace({}) })
            }
          }
        },
      })
    } catch (e) {
      console.warn('[LivePreview] tree walk error (suppressed):', e?.message)
    }

    // ── Legacy `![alt](src =600x)` images ─────────────────────────────────
    // That width syntax isn't valid CommonMark, so the parser never emits an
    // Image node for it and the markdown would show as raw text. Notes written
    // before the switch to `![alt|600](src)` still contain it, so match them
    // directly here. New resizes write the `|600` form (see the resize handle).
    try {
      const reLegacy = /!\[([^\]]*)\]\(([^\s)]+)\s+=(\d+)x\)/g
      let lm
      while ((lm = reLegacy.exec(fullDoc)) !== null) {
        const from = lm.index, to = from + lm[0].length
        if (inCur(from, to)) continue
        // Don't add a second widget over one the tree already produced.
        if (inlines.some(d => d.deco.spec?.widget && d.from < to && d.to > from)) continue
        // Marks the parser emitted inside this range (the bare URL, etc.) are
        // stripped later by the existing replace-vs-mark reconciliation.
        const pa = parseImgAlt(lm[1])
        inlines.push({
          from, to,
          deco: Decoration.replace({ widget: new ImgWidget(lm[2], pa.alt, notebookDir, from, pa.width || parseInt(lm[3], 10) || 0, pa.align, assets), block: false }),
        })
      }
    } catch { /**/ }

    // ── Headings without space (e.g. #Title treated same as # Title) ──────
    try {
      for (let li = 1; li <= doc.lines; li++) {
        const ln = doc.line(li)
        const m = ln.text.match(/^(#{1,6})([^\s#])/)
        if (!m) continue
        const level = m[1].length
        // Skip if tree already handled this as ATXHeading
        const alreadyDecorated = lineDecs.some(d => d.pos === ln.from)
        if (alreadyDecorated) continue
        lineDecs.push({ pos: ln.from, cls: `cm-lv-h${level}` })
        const hashEnd = ln.from + m[1].length
        const hashCls = inCur(ln.from, ln.to) ? 'cm-lv-p' : 'cm-lv-hidden'
        inlines.push({ from: ln.from, to: hashEnd, deco: Decoration.mark({ class: hashCls }) })
      }
    } catch { /**/ }

    // ── Math via regex fallback ───────────────────────────────────────────
    try {
      const full = fullDoc
      const reBlock = /\$\$([\s\S]*?)\$\$/gm
      let mb
      while ((mb = reBlock.exec(full)) !== null) {
        const bf = mb.index, bt = mb.index + mb[0].length
        const already = inlines.some(d => d.from <= bf && d.to >= bt && d.deco.spec?.widget instanceof MathWidget)
        if (!already) {
          if (!inCur(bf, bt)) {
            inlines.push({ from: bf, to: bt, deco: Decoration.replace({ widget: new MathWidget(mb[1].trim(), true, bf, bt) }) })
          }
        }
      }
      const reInline = /\$([^$\n]+)\$/g
      let mi
      while ((mi = reInline.exec(full)) !== null) {
        const mf = mi.index, mt = mi.index + mi[0].length
        const already = inlines.some(d => d.from <= mf && d.to >= mt && d.deco.spec?.widget instanceof MathWidget)
        if (!already) {
          if (!inCur(mf, mt)) {
            inlines.push({ from: mf, to: mt, deco: Decoration.replace({ widget: new MathWidget(mi[1], false, mf, mt) }) })
          }
        }
      }
    } catch { /**/ }

    // ── Wikilinks via regex (with optional (sketch)/(flash) suffix) ─────
    try {
      const full = fullDoc
      const re = /\[\[([^\]\n]{1,120})\]\](?:\((sketch|flash)\))?/g
      let m
      while ((m = re.exec(full)) !== null) {
        const wf = m.index, wt = m.index + m[0].length
        const title = m[1].trim()
        const suffix = m[2] // 'sketch', 'flash', or undefined
        const nb = notebooks.find(n => n.title?.toLowerCase() === title.toLowerCase())
        const bk = !nb && library.find(b => b.title?.toLowerCase() === title.toLowerCase())
        const sb = !nb && !bk && sketchbooks.find(s => s.title?.toLowerCase() === title.toLowerCase())
        const fd = !nb && !bk && !sb && flashcardDecks.find(d => d.title?.toLowerCase() === title.toLowerCase())
        if (inCur(wf, wt)) {
          inlines.push({ from: wf, to: wt, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else if (!hasVault) {
          // No vault to check at all (guest) — never claim "doesn't exist,
          // click to create"; nothing CAN be created here. See WikiWidget's
          // own comment for why this is a distinct state from `new`.
          inlines.push({ from: wf, to: wt, deco: Decoration.replace({ widget: new WikiWidget(title, 'cm-wl cm-wl-unavailable', 'unavailable', '') }) })
        } else {
          const forceType = suffix === 'sketch' ? 'new-sketch' : suffix === 'flash' ? 'new-flash' : null
          const type = nb ? 'notebook' : bk ? 'book' : sb ? 'sketchbook' : fd ? 'flashcard' : (forceType || 'new')
          const id   = nb ? nb.id : bk ? bk.id : sb ? sb.id : fd ? fd.id : ''
          const cls  = nb ? 'cm-wl cm-wl-nb' : bk ? 'cm-wl cm-wl-bk' : sb ? 'cm-wl cm-wl-sb' : fd ? 'cm-wl cm-wl-fd' : 'cm-wl cm-wl-new'
          inlines.push({ from: wf, to: wt, deco: Decoration.replace({ widget: new WikiWidget(title, cls, type, id) }) })
        }
      }
    } catch { /**/ }

    // ── Superscript ^text^ and subscript ~text~ via regex ─────────────────
    try {
      const full = fullDoc
      const reSup = /\^([^\^\n]+)\^/g
      let sm
      while ((sm = reSup.exec(full)) !== null) {
        const sf = sm.index, st = sm.index + sm[0].length
        if (!inCur(sf, st)) {
          inlines.push({ from: sf, to: st, deco: Decoration.replace({ widget: new SupWidget(sm[1]) }) })
        }
      }
      const reSub = /(?<!~)~([^~\n]+)~(?!~)/g
      let sbm
      while ((sbm = reSub.exec(full)) !== null) {
        const sbf = sbm.index, sbt = sbm.index + sbm[0].length
        if (!inCur(sbf, sbt)) {
          inlines.push({ from: sbf, to: sbt, deco: Decoration.replace({ widget: new SubWidget(sbm[1]) }) })
        }
      }
    } catch { /**/ }

    // ── YAML frontmatter --- … --- at doc start → properties card ──────────
    try {
      if (fmEnd && !inCur(0, fmEnd)) {
        // Replace through the last char of the closing --- line (exclude the
        // trailing newline so the following block keeps its own line).
        let to = fmEnd
        while (to > 0 && (fullDoc[to - 1] === '\n')) to--
        const html = frontmatterHtml(_fm.props)
        const key = 'fm:' + _fm.props.map(p => p.key + '=' + p.values.join(',')).join('|')
        inlines.push({ from: 0, to, deco: Decoration.replace({ widget: new HtmlBlockWidget(html, key) }) })
      }
    } catch { /**/ }

    // ── Highlight ==text== → <mark> (mark, keeps text editable) ────────────
    try {
      const reHl = /==([^=\n]+)==/g
      let hm2
      while ((hm2 = reHl.exec(fullDoc)) !== null) {
        const hf = hm2.index, ht = hm2.index + hm2[0].length
        if (inCur(hf, ht)) continue
        // hide the == markers, mark the inner text
        inlines.push({ from: hf, to: hf + 2, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        inlines.push({ from: hf + 2, to: ht - 2, deco: Decoration.mark({ class: 'nb-hl' }) })
        inlines.push({ from: ht - 2, to: ht, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
      }
    } catch { /**/ }

    // ── Comment %%text%% → dimmed (kept in source, muted in live) ──────────
    try {
      const reCm = /%%[\s\S]*?%%/g
      let cm2
      while ((cm2 = reCm.exec(fullDoc)) !== null) {
        const cf = cm2.index, ct = cm2.index + cm2[0].length
        if (!inCur(cf, ct)) inlines.push({ from: cf, to: ct, deco: Decoration.mark({ class: 'cm-lv-comment' }) })
      }
    } catch { /**/ }

    // ── progress:: / rating:: / /toc — block widgets (revert to raw on cursor) ──
    try {
      for (let n = 1; n <= doc.lines; n++) {
        const ln = doc.line(n)
        const t  = ln.text.trim()
        if (inCur(ln.from, ln.to)) continue
        let html = null, key = null
        const pM = t.match(/^progress::\s*(\d+)\s*\/\s*(\d+)(?:\s+(.+))?$/i)
        const rM = t.match(/^rating::\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?$/i)
        if (pM) {
          const cur2 = +pM[1], max = Math.max(1, +pM[2])
          const pct = Math.max(0, Math.min(100, Math.round((cur2 / max) * 100)))
          const label = pM[3] ? esc(pM[3]) : ''
          html = `<div class="nb-progress"><div class="nb-progress-top"><span>${label}</span><span class="nb-progress-num">${cur2}/${max}</span></div><div class="nb-progress-track"><div class="nb-progress-fill" style="width:${pct}%"></div></div></div>`
          key = `p:${t}`
        } else if (rM) {
          const val = +rM[1], out = rM[2] ? +rM[2] : 5
          let stars = ''
          for (let i = 1; i <= out; i++) stars += `<span class="nb-star${i <= val ? ' on' : ''}">${i <= val ? '★' : '☆'}</span>`
          html = `<div class="nb-rating">${stars}</div>`
          key = `r:${t}`
        } else if (/^(?:\/toc|\[toc\]|\{toc\})$/i.test(t)) {
          const heads = []
          for (let h = 1; h <= doc.lines; h++) {
            const hmm = doc.line(h).text.match(/^(#{1,6})(?:[ \t]+|(?=[^\s#]))(.+?)(?:\s+\{#([^}]+)\})?\s*$/)
            if (hmm) heads.push({ level: hmm[1].length, text: hmm[2] })
          }
          const items = heads.length
            ? heads.map(h => `<div class="nb-toc-item" style="padding-left:${(h.level - 1) * 14}px">${esc(h.text)}</div>`).join('')
            : '<div class="nb-toc-empty">No headings yet</div>'
          html = `<div class="nb-toc"><div class="nb-toc-head">Contents</div>${items}</div>`
          key = `t:${heads.map(h => h.level + h.text).join('|')}`
        }
        if (html) {
          try { inlines.push({ from: ln.from, to: ln.to, deco: Decoration.replace({ widget: new HtmlBlockWidget(html, key) }) }) } catch { /**/ }
        }
      }
    } catch { /**/ }

    // ── Hide =:.N precision specifier in accepted equations ────────────────
    try {
      const fullEq = fullDoc
      const precRe = /=:\.(\d+)\s/g
      let pm
      while ((pm = precRe.exec(fullEq)) !== null) {
        const hideFrom = pm.index + 1 // after the '='
        const hideTo = pm.index + pm[0].length - 1 // before the trailing space
        if (!inCur(pm.index, hideTo + 1)) {
          inlines.push({ from: hideFrom, to: hideTo, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        }
      }
    } catch { /**/ }

    // ── Definition lists (dt / dd lines) ─────────────────────────────────────
    try {
      for (let n = 1; n <= doc.lines; n++) {
        const ln = doc.line(n)
        const t  = ln.text
        if (/^:\s+/.test(t)) {
          // Definition ": text" — indent + muted border-left style
          lineDecs.push({ pos: ln.from, cls: 'cm-lv-dd' })
          const colonEnd = ln.from + t.match(/^:\s+/)[0].length
          if (!inCur(ln.from, ln.to)) {
            inlines.push({ from: ln.from, to: colonEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
          }
        } else if (
          t.trim() && !/^[#\-*+>|`~\d]/.test(t) && !/^\//.test(t) &&
          n < doc.lines && /^:\s+/.test(doc.line(n + 1).text)
        ) {
          // Term — line before a definition
          lineDecs.push({ pos: ln.from, cls: 'cm-lv-dt' })
        }
      }
    } catch { /**/ }

    // ── Footnote refs [^id] inline ────────────────────────────────────────────
    try {
      const full = fullDoc
      const fnRe = /\[\^([^\]\n]+)\]/g
      let fm
      while ((fm = fnRe.exec(full)) !== null) {
        const ff = fm.index, ft = fm.index + fm[0].length
        // Skip if it's a definition line [^id]: (starts the line)
        const lineAtPos = doc.lineAt(ff)
        if (/^\[\^/.test(lineAtPos.text) && lineAtPos.text.includes(']: ')) continue
        const already = inlines.some(d => d.from <= ff && d.to >= ft)
        if (!already && !inCur(ff, ft)) {
          inlines.push({ from: ff, to: ft, deco: Decoration.replace({ widget: new FnRefWidget(fm[1]) }) })
        }
      }
      // Style footnote definition lines
      for (let n = 1; n <= doc.lines; n++) {
        const ln = doc.line(n)
        if (/^\[\^[^\]]+\]:/.test(ln.text)) {
          lineDecs.push({ pos: ln.from, cls: 'cm-lv-fn-def' })
        }
      }
    } catch { /**/ }

    // ── /habits block widget ─────────────────────────────────────────────
    try {
      const habitsRe = /^\/habits(?::(.*))?$/gm
      let hm
      while ((hm = habitsRe.exec(fullDoc)) !== null) {
        const hLine = doc.lineAt(hm.index)
        const hFrom = hLine.from
        const hTo = hLine.to
        // Never collapse — user edits via widget UI (same as /calendar)
        inlines.push({ from: hFrom, to: hTo, deco: Decoration.replace({ widget: new HabitsWidget(hm[1] || '', hm[0], hFrom) }) })
      }
    } catch { /**/ }

    // ── /timer block widget ─────────────────────────────────────────────
    try {
      const timerRe = /^\/timer(?:\s+(.+))?$/gm
      let tm
      while ((tm = timerRe.exec(fullDoc)) !== null) {
        const timerLine = doc.lineAt(tm.index)
        const tFrom = timerLine.from
        const tTo = timerLine.to
        if (inCur(tFrom, tTo)) continue
        if (!tm[1]) {
          inlines.push({ from: tFrom, to: tTo, deco: Decoration.replace({ widget: new TimerWidget(0, '', tm[0]) }) })
        } else {
          const raw = tm[1].trim()
          const parts = raw.match(/^(\S+)(?:\s+(.+))?$/)
          if (parts) {
            const timeStr = parts[1], label = parts[2] || ''
            let totalSec = 0
            const hms = timeStr.match(/^(\d+):(\d{2}):(\d{2})$/)
            const ms = timeStr.match(/^(\d+):(\d{2})$/)
            const m = timeStr.match(/^(\d+)$/)
            if (hms) totalSec = parseInt(hms[1]) * 3600 + parseInt(hms[2]) * 60 + parseInt(hms[3])
            else if (ms) totalSec = parseInt(ms[1]) * 60 + parseInt(ms[2])
            else if (m) totalSec = parseInt(m[1]) * 60
            if (totalSec > 0) {
              inlines.push({ from: tFrom, to: tTo, deco: Decoration.replace({ widget: new TimerWidget(totalSec, label, tm[0]) }) })
            } else {
              // Invalid/unrecognized time format — show as empty editable timer
              inlines.push({ from: tFrom, to: tTo, deco: Decoration.replace({ widget: new TimerWidget(0, '', tm[0]) }) })
            }
          }
        }
      }
    } catch { /**/ }

    // ── /math zone command badges ────────────────────────────────────────
    try {
      const mathCmdRe = /^\/(?:math(?:\s+end)?|endmath)\s*$/gim
      let mzm
      while ((mzm = mathCmdRe.exec(fullDoc)) !== null) {
        const mzLine = doc.lineAt(mzm.index)
        if (inCur(mzLine.from, mzLine.to)) continue
        const kind = /end/i.test(mzm[0]) ? 'end' : 'start'
        inlines.push({ from: mzLine.from, to: mzLine.to, deco: Decoration.replace({ widget: new MathZoneWidget(kind) }) })
      }
    } catch { /**/ }

    // ── /pomo block widget ──────────────────────────────────────────────
    try {
      const pomoRe = /^\/pomo$/gm
      let pm
      while ((pm = pomoRe.exec(fullDoc)) !== null) {
        const pomoLine = doc.lineAt(pm.index)
        const pFrom = pomoLine.from
        const pTo = pomoLine.to
        if (inCur(pFrom, pTo)) continue
        inlines.push({ from: pFrom, to: pTo, deco: Decoration.replace({ widget: new PomoWidget(pm[0]) }) })
      }
    } catch { /**/ }

    // ── /calendar block widget ──────────────────────────────────────────
    try {
      const calRe = /^\/calendar(?::([^\n]*))?$/gm
      let cm2
      while ((cm2 = calRe.exec(fullDoc)) !== null) {
        const cFrom = doc.lineAt(cm2.index).from
        const cTo = doc.lineAt(cm2.index + cm2[0].length).to
        // Never collapse calendar — user edits via widget UI, not raw markdown
        const rawData = cm2[1] || ''
        inlines.push({ from: cFrom, to: cTo, deco: Decoration.replace({ widget: new CalendarWidget(rawData, cm2[0]) }) })
      }
    } catch { /**/ }

    // ── /linkf file badge ────────────────────────────────────────────────────
    try {
      const linkfRe = /^\/linkf:(.+)$/gm
      let lf
      while ((lf = linkfRe.exec(fullDoc)) !== null) {
        const lfLine = doc.lineAt(lf.index)
        const lfFrom = lfLine.from, lfTo = lfLine.to
        if (inCur(lfFrom, lfTo)) continue
        const parts = lf[1].split('|')
        const path = parts[0].trim()
        const name = parts[1]?.trim() || path.split(/[/\\]/).pop() || path
        inlines.push({ from: lfFrom, to: lfTo, deco: Decoration.replace({ widget: new FileLinkWidget(path, name) }) })
      }
    } catch { /**/ }

    // ── /linkw web viewer ────────────────────────────────────────────────────
    try {
      const linkwRe = /^\/linkw:(.+)$/gm
      let lw
      while ((lw = linkwRe.exec(fullDoc)) !== null) {
        const lwLine = doc.lineAt(lw.index)
        const lwFrom = lwLine.from, lwTo = lwLine.to
        if (inCur(lwFrom, lwTo)) continue
        const parts = lw[1].split('|')
        const url = parts[0].trim()
        const title = parts[1]?.trim() || ''
        inlines.push({ from: lwFrom, to: lwTo, deco: Decoration.replace({ widget: new WebLinkWidget(url, title) }) })
      }
    } catch { /**/ }

    // ── /linkv video player ──────────────────────────────────────────────────
    try {
      const linkvRe = /^\/linkv:(.+)$/gm
      let lv
      while ((lv = linkvRe.exec(fullDoc)) !== null) {
        const lvLine = doc.lineAt(lv.index)
        const lvFrom = lvLine.from, lvTo = lvLine.to
        if (inCur(lvFrom, lvTo)) continue
        const parts = lv[1].split('|')
        const src = parts[0].trim()
        const title = parts[1]?.trim() || ''
        inlines.push({ from: lvFrom, to: lvTo, deco: Decoration.replace({ widget: new VideoLinkWidget(src, title) }) })
      }
    } catch { /**/ }

    // ── Predictive formatting from opening syntax ─────────────────────────
    // When the cursor is on a line with unclosed formatting tokens,
    // apply the formatting class from the opening token to the cursor position
    try {
      const curLine = doc.lineAt(cur)
      const lineText = curLine.text
      const colPos = cur - curLine.from
      const textBeforeCursor = lineText.slice(0, colPos)

      const OPEN_TOKENS = [
        { token: '***', cls: 'cm-lv-bi' },
        { token: '___', cls: 'cm-lv-bi' },
        { token: '**',  cls: 'cm-lv-b' },
        { token: '__',  cls: 'cm-lv-b' },
        { token: '*',   cls: 'cm-lv-i' },
        { token: '_',   cls: 'cm-lv-i' },
        { token: '~~',  cls: 'cm-lv-s' },
        { token: '==',  cls: 'cm-lv-hl' },
      ]

      for (const { token, cls } of OPEN_TOKENS) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const count = (textBeforeCursor.match(new RegExp(escaped, 'g')) || []).length
        if (count % 2 === 1) {
          // Found unclosed opening token — apply formatting from token to cursor
          const lastIdx = textBeforeCursor.lastIndexOf(token)
          if (lastIdx >= 0) {
            // If the character immediately after the opening token is a space,
            // don't treat it as formatting (user rejected formatting)
            const charAfterToken = lineText[lastIdx + token.length]
            if (charAfterToken === ' ' || charAfterToken === undefined) break

            const fmtFrom = curLine.from + lastIdx + token.length
            const fmtTo = cur
            if (fmtFrom < fmtTo) {
              // Check if this range isn't already decorated
              const alreadyDeco = inlines.some(d => d.from <= fmtFrom && d.to >= fmtTo && d.deco.spec?.class === cls)
              if (!alreadyDeco) {
                inlines.push({ from: fmtFrom, to: fmtTo, deco: Decoration.mark({ class: cls }) })
                // Also dim the opening token
                const tokenFrom = curLine.from + lastIdx
                const tokenTo = tokenFrom + token.length
                inlines.push({ from: tokenFrom, to: tokenTo, deco: Decoration.mark({ class: 'cm-lv-p' }) })
              }
            }
          }
          break // only match the first (longest) unclosed token
        }
      }
    } catch { /**/ }

    // ── Due-date tokens ::YYYY-MM-DD or ::+2d etc. ───────────────────────
    try {
      const full = fullDoc
      const duRe = /::(\d{4}-\d{2}-\d{2}(?:,\d{1,2}:\d{2})?|\d{2}-\d{2}-(?:\d{4}|\d{2})(?:,\d{1,2}:\d{2})?|\d{1,2}:\d{2}|\+\d+[dh])/g
      let dm
      while ((dm = duRe.exec(full)) !== null) {
        const from = dm.index, to = dm.index + dm[0].length
        if (inCur(from, to)) {
          inlines.push({ from, to: from + 2, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from, to, deco: Decoration.replace({ widget: new DueDateWidget(dm[1]) }) })
        }
      }
    } catch { /**/ }

    // ── Tag tokens ::tagname (letter-start, not a due-date) ──────────────
    try {
      const full = fullDoc
      const tagRe = /::([a-zA-Z][a-zA-Z0-9_-]*)/g
      let tm
      while ((tm = tagRe.exec(full)) !== null) {
        const from = tm.index, to = tm.index + tm[0].length
        if (inCur(from, to)) {
          inlines.push({ from, to: from + 2, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from, to, deco: Decoration.replace({ widget: new TagWidget(tm[1]) }) })
        }
      }
    } catch { /**/ }

    // ── status:: field → clickable status badge ──────────────────────────
    try {
      const full = fullDoc
      const statusRe = /^[ \t]*status::[ \t]*(\w+)[ \t]*$/gim
      let sm
      while ((sm = statusRe.exec(full)) !== null) {
        const from = sm.index, to = sm.index + sm[0].length
        if (inCur(from, to)) continue
        inlines.push({ from, to, deco: Decoration.replace({ widget: new StatusWidget(sm[1], from) }) })
      }
    } catch { /**/ }

    // ── ?[question](ref) review/flashcard widgets ────────────────────────
    try {
      const qRe = /\?\[([^\]]*)\]\(([^)]*)\)/g
      let qm
      while ((qm = qRe.exec(fullDoc)) !== null) {
        const from = qm.index, to = qm.index + qm[0].length
        if (inCur(from, to)) {
          inlines.push({ from, to: from + 1, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from, to, deco: Decoration.replace({ widget: new QuestionWidget(qm[1], qm[2], qm[0], from, questionStoreApi) }) })
        }
      }
    } catch { /**/ }

    // ── @time references (@HH:MM, @hh:mmam/pm, @HH, @Hham/pm) ─────────
    try {
      const full = fullDoc
      // Match @14:30, @2:30pm, @14, @2pm, @2am, etc.
      const timeRefRe = /(?<!\w)@(\d{1,2})(?::(\d{2}))?\s*(am|pm|AM|PM)?(?!\w)/g
      let trm
      while ((trm = timeRefRe.exec(full)) !== null) {
        const from = trm.index, to = trm.index + trm[0].length
        let h = parseInt(trm[1])
        const m = trm[2] ? parseInt(trm[2]) : null
        const ampm = trm[3]?.toLowerCase()
        // Skip bare numbers that aren't valid times (e.g. @999)
        if (!ampm && h > 23) continue
        if (ampm && (h < 1 || h > 12)) continue
        if (m !== null && m > 59) continue
        let display
        if (ampm) {
          // 12h format — display as-is
          display = m !== null
            ? `${h}:${String(m).padStart(2,'0')} ${ampm.toUpperCase()}`
            : `${h} ${ampm.toUpperCase()}`
        } else {
          // 24h format — convert to 12h display
          const suffix = h >= 12 ? 'PM' : 'AM'
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
          display = m !== null
            ? `${h12}:${String(m).padStart(2,'0')} ${suffix}`
            : `${h12} ${suffix}`
        }
        if (inCur(from, to)) {
          inlines.push({ from, to: from + 1, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from, to, deco: Decoration.replace({ widget: new TimeRefWidget(trm[0], display) }) })
        }
      }
    } catch { /**/ }

    // ── Inline CMD spans: {color:X}…{//}, {bold}…{//}, {align:X}…{//}, etc. ──
    try {
      // Returns CSS inline-style string for mark decorations.
      // Returns null for align/columns (handled as line decorations separately).
      function inlineStyleAttr(type, value) {
        if (type === 'color')     return `color:${value}`
        if (type === 'font')      return `font-family:${value}`
        if (type === 'spacing')   return `line-height:${value}`
        if (type === 'size')      return `font-size:${value}`
        if (type === 'bold')      return 'font-weight:700'
        if (type === 'italic')    return 'font-style:italic'
        if (type === 'bi')        return 'font-weight:700;font-style:italic'
        if (type === 'strike')    return 'text-decoration:line-through'
        if (type === 'highlight') return 'background:#ffe06699;border-radius:3px;padding:0 2px'
        if (type === 'code')      return 'font-family:SF Mono,Menlo,Consolas,monospace;background:var(--nb-code-bg,var(--surfaceAlt));border-radius:4px;padding:1px 4px;font-size:.87em;color:var(--nb-code-color,inherit)'
        if (type === 'sup')       return 'font-size:.75em;vertical-align:super'
        if (type === 'sub')       return 'font-size:.75em;vertical-align:sub'
        // align + columns → null (use line decorations)
        return null
      }

      // Returns line-level style string for align; null for others.
      // columns handled as a block widget in columnsDecoField (not per-line).
      function lineStyleAttr(type, value) {
        if (type === 'align') return `text-align:${value}`
        return null
      }

      // Enumerate doc lines overlapping [startPos, endPos) and push line decos
      function pushLineDecos(startPos, endPos, style) {
        let lp = doc.lineAt(Math.max(0, startPos)).from
        while (lp < endPos && lp < doc.length) {
          lineDecs.push({ pos: lp, style })
          const ln = doc.lineAt(lp)
          if (ln.to >= endPos) break
          lp = ln.to + 1
        }
      }

      // Collect all {//} positions upfront so Pass 2 can use them as boundaries
      const allClosePositions = []
      const consumedCloseSet  = new Set()
      const closeRe = /\{\/\/\}/g
      let closeMatch
      while ((closeMatch = closeRe.exec(fullDoc)) !== null) allClosePositions.push(closeMatch.index)

      // All supported types — value is optional for bold/italic/bi/strike/highlight/code/sup/sub
      const ALL_TYPES = 'color|font|spacing|size|align|columns|bold|italic|bi|strike|highlight|code|sup|sub'

      // ── Pass 1: closed spans — full {type[:val]}...{//} pairs ───────────
      const spanRe = new RegExp(`\\{(${ALL_TYPES})(?::([^}]+))?\\}([\\s\\S]*?)\\{\\/\\/\\}`, 'g')
      const closedOpenStarts = new Set()
      let sm
      while ((sm = spanRe.exec(fullDoc)) !== null) {
        const type     = sm[1]
        const rawVal   = sm[2] ?? null   // null for value-less types like {bold}
        const value    = rawVal != null ? rawVal.trim() : ''
        const spanStart = sm.index
        const spanEnd  = sm.index + sm[0].length
        const openLen  = rawVal != null
          ? 1 + type.length + 1 + rawVal.length + 1  // {type:rawVal}
          : 1 + type.length + 1                       // {type}
        const openEnd    = spanStart + openLen
        const closeStart = spanEnd - 4  // {//} is 4 chars

        if (openEnd > spanEnd || closeStart < openEnd) continue
        closedOpenStarts.add(spanStart)
        consumedCloseSet.add(closeStart)

        // Opening marker — hide unless cursor is inside it
        if (inCur(spanStart, openEnd)) {
          inlines.push({ from: spanStart, to: openEnd, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from: spanStart, to: openEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        }

        // Content — apply inline style or line decoration
        if (openEnd < closeStart) {
          const ls = lineStyleAttr(type, value)
          if (ls) {
            pushLineDecos(openEnd, closeStart, ls)
          } else {
            const s = inlineStyleAttr(type, value)
            if (s) inlines.push({ from: openEnd, to: closeStart, deco: Decoration.mark({ attributes: { style: s } }) })
          }
        }

        // Closing marker — hide unless cursor is inside it
        if (inCur(closeStart, spanEnd)) {
          inlines.push({ from: closeStart, to: spanEnd, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from: closeStart, to: spanEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        }
      }

      // ── Pass 2: open (unclosed) spans — styled to next {//} or doc end ───
      const openTagRe = new RegExp(`\\{(${ALL_TYPES})(?::([^}]+))?\\}`, 'g')
      let ot
      while ((ot = openTagRe.exec(fullDoc)) !== null) {
        const oStart = ot.index
        const oEnd   = ot.index + ot[0].length
        const type   = ot[1]
        const rawVal = ot[2] ?? null
        const value  = rawVal != null ? rawVal.trim() : ''

        // Skip tags already matched by Pass 1
        if (closedOpenStarts.has(oStart)) continue

        // Hide/show the opening marker based on cursor position
        if (inCur(oStart, oEnd)) {
          inlines.push({ from: oStart, to: oEnd, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from: oStart, to: oEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        }

        // Find nearest unconsumed {//} after this opener
        const nextClose = allClosePositions.find(p => p >= oEnd && !consumedCloseSet.has(p))
        const styleEnd  = nextClose != null ? nextClose : doc.length

        // Apply style from end of opener to boundary
        if (oEnd < styleEnd) {
          const ls = lineStyleAttr(type, value)
          if (ls) {
            pushLineDecos(oEnd, styleEnd, ls)
          } else {
            const s = inlineStyleAttr(type, value)
            if (s) inlines.push({ from: oEnd, to: styleEnd, deco: Decoration.mark({ attributes: { style: s } }) })
          }
        }

        // Hide the boundary {//} if one was found
        if (nextClose != null) {
          consumedCloseSet.add(nextClose)
          const closeEnd = nextClose + 4
          if (inCur(nextClose, closeEnd)) {
            inlines.push({ from: nextClose, to: closeEnd, deco: Decoration.mark({ class: 'cm-lv-p' }) })
          } else {
            inlines.push({ from: nextClose, to: closeEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
          }
        }
      }

      // Hide any {//} markers not consumed by either pass
      for (const pos of allClosePositions) {
        if (consumedCloseSet.has(pos)) continue
        const closeEnd = pos + 4
        if (inCur(pos, closeEnd)) {
          inlines.push({ from: pos, to: closeEnd, deco: Decoration.mark({ class: 'cm-lv-p' }) })
        } else {
          inlines.push({ from: pos, to: closeEnd, deco: Decoration.mark({ class: 'cm-lv-hidden' }) })
        }
      }
    } catch { /**/ }

    // ── Sort and build ────────────────────────────────────────────────────
    inlines.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to)

    // Remove mark decorations that overlap with replace-widget ranges.
    // Overlapping mark+replace in a CM6 RangeSet causes errors that silently drop widgets.
    const replRanges = inlines.filter(d => d.deco.spec?.widget).map(d => [d.from, d.to])
    const safeInlines = replRanges.length === 0 ? inlines : inlines.filter(({ from, to, deco }) => {
      if (deco.spec?.widget) return true  // always keep replace widgets
      for (const [rf, rt] of replRanges) {
        if (from >= rf && from < rt) return false   // mark starts inside a replace
        if (from < rf && to > rf) return false      // mark overlaps replace's left edge
      }
      return true
    })

    const sb = new RangeSetBuilder()
    let lastReplTo = -1
    for (const { from, to, deco } of safeInlines) {
      if (from < 0 || to > doc.length || from >= to) continue
      const isReplace = !!deco.spec?.widget
      if (from < lastReplTo) continue
      try {
        sb.add(from, to, deco)
        if (isReplace) lastReplTo = to
      } catch { /**/ }
    }

    lineDecs.sort((a, b) => a.pos - b.pos)
    const lb = new RangeSetBuilder()
    const seen = new Set()
    for (const { pos, cls, style } of lineDecs) {
      const k = `${pos}:${cls||''}:${style||''}`
      if (seen.has(k)) continue; seen.add(k)
      const decoOpts = {}
      if (cls) decoOpts.class = cls
      if (style) decoOpts.attributes = { style }
      if (!cls && !style) continue
      try { lb.add(pos, pos, Decoration.line(decoOpts)) } catch { /**/ }
    }

    let spans, lines
    try { spans = sb.finish() } catch { spans = Decoration.none }
    try { lines = lb.finish() } catch { lines = Decoration.none }
    return { spans, lines }
  }

  // ── /task block decorations live in a StateField (multi-line replace forbidden in ViewPlugin) ──
  const taskDecoField = StateField.define({
    create(state) { return _buildTaskDecos(docString(state.doc), Decoration, RangeSetBuilder) },
    update(decos, tr) {
      if (!tr.docChanged) return decos
      return _buildTaskDecos(docString(tr.newDoc), Decoration, RangeSetBuilder)
    },
    provide: f => cm.view.EditorView.decorations.from(f),
  })

  // ── Table decorations also live in a StateField (block: true, multi-line) ──
  const tableDecoField = StateField.define({
    create(state) { return _buildTableDecos(state) },
    update(decos, tr) {
      if (!tr.docChanged) return decos
      return _buildTableDecos(tr.state)
    },
    provide: f => cm.view.EditorView.decorations.from(f),
  })

  // ── {columns:N}…{//} block widget — replaces per-line column-count approach ──
  const columnsDecoField = StateField.define({
    create(state) { return _buildColumnsDecos(state, Decoration, RangeSetBuilder, isPreview) },
    update(decos, tr) {
      if (!tr.docChanged && !tr.selectionSet) return decos
      return _buildColumnsDecos(tr.state, Decoration, RangeSetBuilder, isPreview)
    },
    provide: f => cm.view.EditorView.decorations.from(f),
  })

  // ```mermaid / ```svg → rendered diagram (block widget, same pattern as columns)
  const diagramDecoField = StateField.define({
    create(state) { return _buildDiagramDecos(state, Decoration, RangeSetBuilder, isPreview) },
    update(decos, tr) {
      if (!tr.docChanged && !tr.selectionSet) return decos
      return _buildDiagramDecos(tr.state, Decoration, RangeSetBuilder, isPreview)
    },
    provide: f => cm.view.EditorView.decorations.from(f),
  })

  return [taskDecoField, tableDecoField, columnsDecoField, diagramDecoField, ViewPlugin.fromClass(
    class {
      constructor(view) {
        try { const r = build(view); this.decorations = r.spans; this.lineDecos = r.lines }
        catch { this.decorations = Decoration.none; this.lineDecos = Decoration.none }
      }
      update(upd) {
        // Fold/unfold changes neither the doc nor the selection, so without this
        // the heading fold-arrow widget never rebuilds and its chevron keeps
        // pointing "open" even after the section collapses.
        const foldChanged = upd.transactions.some(tr =>
          tr.effects.some(e => e.is(foldEffect) || e.is(unfoldEffect)))
        if (upd.docChanged || upd.selectionSet || foldChanged) {
          try { const r = build(upd.view); this.decorations = r.spans; this.lineDecos = r.lines }
          catch { this.decorations = Decoration.none; this.lineDecos = Decoration.none }
        }
      }
    },
    {
      decorations: v => v.decorations,
      provide: plugin => [
        cm.view.EditorView.decorations.of(v => {
          try { return v.plugin(plugin)?.lineDecos ?? Decoration.none }
          catch { return Decoration.none }
        }),
      ],
    }
  )]
}

// ─── /task block decoration builder (StateField — multi-line replace forbidden in ViewPlugin) ───
export function _buildTaskDecos(fullDoc, Decoration, RangeSetBuilder) {
  const builder = new RangeSetBuilder()
  try {
    if (!fullDoc.includes('/kanban') && !fullDoc.includes('/task')) return builder.finish() // no boards — skip line scan
    const lines = fullDoc.split('\n')
    const lineStarts = []
    let pos = 0
    for (const l of lines) { lineStarts.push(pos); pos += l.length + 1 }

    const decos = []
    for (let li = 0; li < lines.length; li++) {
      if (!lines[li].match(/^\/(?:task|kanban)(?::.*)?$/)) continue
      const block = parseTaskBlock(fullDoc, li)
      if (!block) continue

      const blockFrom = lineStarts[block.startLine]
      const blockTo   = lineStarts[block.endLine] + lines[block.endLine].length

      const columns = block.columns.map(col => ({
        title: col.title,
        tasks: col.tasks.map(task => {
          const cbIdx = lines[task.lineIdx].search(/\[[ xX]\]/)
          return { text: task.text, done: task.done, date: task.date || null, cbPos: lineStarts[task.lineIdx] + (cbIdx >= 0 ? cbIdx : 0) }
        }),
      }))
      const rawMd = fullDoc.slice(blockFrom, blockTo)
      decos.push({ from: blockFrom, to: blockTo, widget: new TaskBlockWidget(block.boardTitle, columns, rawMd, blockFrom) })
      li = block.endLine
    }
    decos.sort((a, b) => a.from - b.from)
    for (const { from, to, widget } of decos) {
      builder.add(from, to, Decoration.replace({ widget }))
    }
  } catch { /**/ }
  return builder.finish()
}

// ─── {columns:N}…{//} block decoration builder ───────────────────────────────
export function _buildColumnsDecos(state, Decoration, RangeSetBuilder, isPreview) {
  const builder = new RangeSetBuilder()
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  try {
    const full = docString(state.doc)
    if (!full.includes('{columns:')) return builder.finish() // no column blocks
    const cur  = state.selection.main.head
    const re   = /\{columns:(\d+)\}([\s\S]*?)\{\/\/\}/g
    let m
    while ((m = re.exec(full)) !== null) {
      const n        = Math.min(Math.max(parseInt(m[1]) || 2, 1), 6)
      const blockFrom = state.doc.lineAt(m.index).from
      const blockTo   = state.doc.lineAt(m.index + m[0].length).to
      if (!isPreview && cur >= blockFrom && cur <= blockTo) continue
      const innerText = m[2].trim()
      const paras = innerText.split(/\n\n+/)
      const innerHtml = paras.map(p => `<p style="margin:0 0 0.8em 0">${esc(p.replace(/\n/g,'<br>'))}</p>`).join('')
      try { builder.add(blockFrom, blockTo, Decoration.replace({ widget: new ColumnsWidget(n, innerHtml, m[0]), block: true })) } catch { /**/ }
    }
  } catch { /**/ }
  return builder.finish()
}

// ─── Checkbox click handler (live mode) ──────────────────────────────────────
export function makeCheckboxHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target
      if (!el.classList.contains('cm-cb')) return false
      const pos = parseInt(el.dataset.pos || '0', 10)
      if (!pos && el.dataset.pos !== '0') return false
      try {
        const line = view.state.doc.lineAt(pos)
        const txt  = line.text
        const newTxt = /\[[xX]\]/.test(txt)
          ? txt.replace(/\[[xX]\]/, '[ ]')
          : txt.replace(/\[ \]/, '[x]')
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newTxt } })
        e.preventDefault()
        return true
      } catch { return false }
    },
  })
}

// ─── status:: badge click handler — cycles Todo → Doing → Blocked → Review → Done ──
export function makeStatusHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target.closest('.cm-status-badge')
      if (!el) return false
      e.preventDefault()
      const pos = parseInt(el.dataset.pos || '0', 10)
      if (isNaN(pos)) return true
      try {
        const line = view.state.doc.lineAt(pos)
        const m = line.text.match(/^([ \t]*status::[ \t]*)(\w+)([ \t]*)$/i)
        if (!m) return true
        const nextIdx = (_statusDefIdx(m[2]) + 1) % _STATUS_DEFS.length
        const newTxt = m[1] + _STATUS_DEFS[nextIdx].value + m[3]
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newTxt } })
      } catch { /**/ }
      return true
    },
  })
}

// ─── Heading fold-arrow click handler — toggles CM6's native fold state ──────
export function makeHeadingFoldHandler(cm) {
  const { foldEffect, unfoldEffect, foldedRanges } = cm.language
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target.closest('.cm-fold-arrow')
      if (!el) return false
      e.preventDefault()
      const from = parseInt(el.dataset.foldFrom || '-1', 10)
      const to = parseInt(el.dataset.foldTo || '-1', 10)
      if (from < 0 || to <= from) return true
      let isFolded = false
      try { foldedRanges(view.state).between(from, from, (rf) => { if (rf === from) isFolded = true }) } catch { /**/ }
      view.dispatch({ effects: (isFolded ? unfoldEffect : foldEffect).of({ from, to }) })
      return true
    },
  })
}

// ─── Hyperlink + file/web/video link click handler ───────────────────────────
// `assets` — optional `{ assetsMap }` (same shape as ImgWidget's, PLAN_
// CONCURRENCY.md §18.4/§18.6). NotebookView.jsx never passes it (`_invoke`
// always wins there — a host opens the real file in Finder, same as before
// this param existed); the guest wiring passes it so clicking a badge for a
// `guest-asset:` key downloads the room-published bytes instead of a no-op.
export function makeLinkHandler(cm, assets = null) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e) {
      // Prevent CM from claiming cursor-placement on these widgets
      if (e.target.closest('.cm-linkv-wrap') || e.target.closest('.cm-linkw-wrap') || e.target.closest('.cm-linkf-badge')) {
        e.preventDefault()
        return true
      }
      return false
    },
    click(e, view) {
      // /linkf — open file with default app (host), or download the room's
      // published bytes (guest — no "default app" concept in a browser, and
      // no real filesystem path to open even if there were).
      const badge = e.target.closest('.cm-linkf-badge')
      if (badge) {
        const path = badge.dataset.linkfPath
        if (path && _invoke) {
          _invoke('open_in_finder', { path }).catch(console.warn)
        } else if (path && assets?.assetsMap) {
          const bytes = assets.assetsMap.get(path)
          if (bytes) {
            const blob = new Blob([bytes])
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = badge.dataset.linkfName || path
            a.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }
        }
        e.preventDefault(); return true
      }

      // /linkw — open in the user's native browser (safe, sandboxed)
      const wOpen = e.target.closest('.cm-linkw-open-btn')
      if (wOpen) {
        e.preventDefault()
        const url = wOpen.dataset.linkwUrl
        if (url) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('plugin:shell|open', { path: url }).catch(() => window.open(url, '_blank'))
          }).catch(() => window.open(url, '_blank'))
        }
        return true
      }

      // Handle clicks on .cm-lv-lnk inline decorations (when cursor is on the link)
      const el = e.target.closest('.cm-lv-lnk')
      if (!el) return false
      // Try to find URL from the line's markdown source — look for [text](url)
      const pos = view.posAtDOM(el)
      if (pos == null) return false
      const line = view.state.doc.lineAt(pos)
      const lineText = line.text
      // Match markdown link pattern [text](url)
      const linkRe = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g
      let m, href = null
      while ((m = linkRe.exec(lineText)) !== null) {
        const linkStart = line.from + m.index
        const linkEnd   = linkStart + m[0].length
        if (pos >= linkStart && pos <= linkEnd) { href = m[2]; break }
      }
      // Also try bare URLs
      if (!href) {
        const bareRe = /(https?:\/\/[^\s)>\]]+)/g
        while ((m = bareRe.exec(lineText)) !== null) {
          const urlStart = line.from + m.index
          const urlEnd   = urlStart + m[0].length
          if (pos >= urlStart && pos <= urlEnd) { href = m[1]; break }
        }
      }
      if (!href) return false
      e.preventDefault()
      e.stopPropagation()
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('plugin:shell|open', { path: href }).catch(() => window.open(href, '_blank'))
      }).catch(() => window.open(href, '_blank'))
      return true
    },
  })
}

// ─── Wikilink click handler (live mode) ──────────────────────────────────────
export function makeWikiHandler(cm, onNavRef) {
  return cm.view.EditorView.domEventHandlers({
    click(e) {
      const el = e.target.closest('.cm-wl')
      if (!el) return false
      const fn = typeof onNavRef === 'function' ? onNavRef : onNavRef?.current
      if (fn) fn(el.dataset.wlTitle, el.dataset.wlType, el.dataset.wlId)
      e.preventDefault(); return true
    },
    mousedown(e) {
      // Also handle mousedown for replace-decoration widgets where click may not fire
      const el = e.target.closest('.cm-wl')
      if (!el) return false
      e.preventDefault()
      const fn = typeof onNavRef === 'function' ? onNavRef : onNavRef?.current
      if (fn) fn(el.dataset.wlTitle, el.dataset.wlType, el.dataset.wlId)
      return true
    },
  })
}

// ─── /todo checkbox click handler ────────────────────────────────────────────
export function makeTodoHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!e.target.closest('.cm-todo-block-w')) return false
      e.preventDefault()
      const cb = e.target.closest('.cm-cb[data-pos]')
      if (!cb) return true
      const pos = parseInt(cb.dataset.pos || '0', 10)
      if (isNaN(pos)) return true
      try {
        const line = view.state.doc.lineAt(pos)
        const txt  = line.text
        const newTxt = /\[[xX]\]/.test(txt)
          ? txt.replace(/\[[xX]\]/, '[ ]')
          : txt.replace(/\[ \]/, '[x]')
        view.dispatch({ changes: { from: line.from, to: line.to, insert: newTxt } })
      } catch { /**/ }
      return true
    },
  })
}

// ─── /task board interaction handler ─────────────────────────────────────────
export function makeTaskHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!e.target.closest('.cm-task-board-w')) return false
      e.preventDefault()
      const cb = e.target.closest('.cm-cb[data-pos]')
      if (cb) {
        const pos = parseInt(cb.dataset.pos || '0', 10)
        if (!isNaN(pos)) {
          try {
            const line = view.state.doc.lineAt(pos)
            const txt  = line.text
            const newTxt = /\[[xX]\]/.test(txt)
              ? txt.replace(/\[[xX]\]/, '[ ]')
              : txt.replace(/\[ \]/, '[x]')
            view.dispatch({ changes: { from: line.from, to: line.to, insert: newTxt } })
          } catch { /**/ }
        }
      }
      return true
    },
    keydown(e, view) {
      const inp = e.target
      if (inp.tagName !== 'INPUT' || !inp.classList.contains('cm-task-add-input')) return false
      if (e.key !== 'Enter') return false
      const text = inp.value.trim()
      if (!text) return false
      const board = inp.closest('.cm-task-board')
      if (!board) return false
      const colIdx   = parseInt(inp.dataset.colIdx || '0', 10)
      const blockFrom = parseInt(board.dataset.blockFrom || '0', 10)
      const blockTo   = parseInt(board.dataset.blockTo   || '0', 10)

      const docStr = view.state.doc.toString()
      const block = parseTaskBlock(docStr, view.state.doc.lineAt(blockFrom).number - 1)
      if (!block) return false

      const cols = block.columns.map(c => ({ ...c, tasks: [...c.tasks] }))
      if (colIdx >= 0 && colIdx < cols.length) {
        cols[colIdx].tasks.push({ text, done: false })
      }
      const newText = serializeTaskBlock(block.boardTitle, cols)
      const lineFrom = view.state.doc.lineAt(blockFrom).from
      const lineTo   = view.state.doc.lineAt(Math.min(blockTo, view.state.doc.length - 1)).to
      view.dispatch({ changes: { from: lineFrom, to: lineTo, insert: newText } })
      inp.value = ''
      e.preventDefault()
      return true
    },
  })
}

// ─── Math click → inline MathQuill editing ───────────────────────────────────
export function makeMathClickHandler(cm) {
  return cm.view.EditorView.domEventHandlers({
    click(e, view) {
      const el = e.target.closest('.cm-math-mq')
      if (!el) return false

      const latex   = el.dataset.latex ?? ''
      const display = el.dataset.display === '1'

      // Build overlay anchored to the widget position
      const rect = el.getBoundingClientRect()

      const overlay = document.createElement('div')
      overlay.className = 'nb-math-editor-overlay'
      overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 6}px;
        left: ${rect.left - 8}px;
        min-width: ${Math.max(rect.width + 16, 160)}px;
        background: var(--surface, #161b22);
        border: 1.5px solid var(--accent, #388bfd);
        border-radius: 8px;
        padding: 6px 10px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.55);
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 8px;
      `

      const mqSpan = document.createElement('span')
      mqSpan.style.cssText = 'display:inline-block; min-width:60px; flex:1;'
      overlay.appendChild(mqSpan)

      const doneBtn = document.createElement('button')
      doneBtn.textContent = '✓'
      doneBtn.style.cssText = `
        background: var(--accent, #388bfd); color: #fff;
        border: none; border-radius: 5px; padding: 2px 8px;
        cursor: pointer; font-size: 12px; flex-shrink: 0;
      `
      overlay.appendChild(doneBtn)

      document.body.appendChild(overlay)

      getMQ().then(MQ => {
        if (!MQ) { overlay.remove(); return }

        let mqField = null
        try {
          mqField = MQ.MathField(mqSpan, {
            spaceBehavesLikeTab: true,
            handlers: { enter: commit },
          })
          mqField.latex(latex)
          mqField.focus()
        } catch {
          overlay.remove()
          return
        }

        function commit() {
          if (!mqField) return
          const newLatex = mqField.latex()
          overlay.remove()
          // Find the original syntax in the document and replace it
          const docStr = view.state.doc.toString()
          const wrap = display ? `$$${latex}$$` : `$${latex}$`
          const idx = docStr.indexOf(wrap)
          if (idx >= 0) {
            const newWrap = display ? `$$${newLatex}$$` : `$${newLatex}$`
            view.dispatch({ changes: { from: idx, to: idx + wrap.length, insert: newWrap } })
          }
          view.focus()
        }

        doneBtn.onclick = commit

        const handleKey = (ev) => {
          if (ev.key === 'Escape') { overlay.remove(); view.focus(); document.removeEventListener('keydown', handleKey) }
        }
        document.addEventListener('keydown', handleKey)

        const handleOutside = (ev) => {
          if (!overlay.contains(ev.target)) {
            commit()
            document.removeEventListener('mousedown', handleOutside)
            document.removeEventListener('keydown', handleKey)
          }
        }
        setTimeout(() => document.addEventListener('mousedown', handleOutside), 80)
      })

      return true
    }
  })
}

// ─── Source mode formatting plugin (mark decorations only, no syntax hiding) ──
export function makeSourcePlugin(cm) {
  const { ViewPlugin, Decoration } = cm.view
  const { RangeSetBuilder } = cm.state
  const { syntaxTree } = cm.language

  const SPAN_MAP = {
    StrongEmphasis: 'cm-lv-b',
    Emphasis:       'cm-lv-i',
    Strikethrough:  'cm-lv-s',
    InlineCode:     'cm-lv-c',
    Highlight:      'cm-lv-hl',
    Link:           'cm-lv-lnk',
    Image:          'cm-lv-lnk',
  }
  const LINE_MAP = {
    ATXHeading1: 'cm-lv-h1', ATXHeading2: 'cm-lv-h2', ATXHeading3: 'cm-lv-h3',
    ATXHeading4: 'cm-lv-h4', ATXHeading5: 'cm-lv-h5', ATXHeading6: 'cm-lv-h6',
  }
  const CODE_BLOCKS = new Set(['FencedCode', 'CodeBlock', 'IndentedCode'])

  function build(view) {
    const { state } = view
    const doc = state.doc
    const marks = []
    const lineDecs = []

    try {
      syntaxTree(state).iterate({
        enter(node) {
          const { from, to, name } = node
          if (from >= to) return

          if (CODE_BLOCKS.has(name)) {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-cb' }) } catch { /**/ }
            }
            return false
          }

          if (name === 'Blockquote') {
            const ls = doc.lineAt(from).number
            const le = doc.lineAt(Math.min(to, doc.length - 1)).number
            for (let n = ls; n <= le; n++) {
              try { lineDecs.push({ pos: doc.line(n).from, cls: 'cm-lv-bq' }) } catch { /**/ }
            }
            return false
          }

          const lineCls = LINE_MAP[name]
          if (lineCls) {
            try { lineDecs.push({ pos: doc.lineAt(from).from, cls: lineCls }) } catch { /**/ }
            return // descend into children
          }

          const spanCls = SPAN_MAP[name]
          if (spanCls) marks.push({ from, to, cls: spanCls })
        }
      })
    } catch { /**/ }

    marks.sort((a, b) => a.from !== b.from ? a.from - b.from : b.to - a.to)
    const sb = new RangeSetBuilder()
    for (const { from, to, cls } of marks) {
      if (from < 0 || to > doc.length || from >= to) continue
      try { sb.add(from, to, Decoration.mark({ class: cls })) } catch { /**/ }
    }

    lineDecs.sort((a, b) => a.pos - b.pos)
    const lb = new RangeSetBuilder()
    const seen = new Set()
    for (const { pos, cls, style } of lineDecs) {
      const k = `${pos}:${cls||''}:${style||''}`
      if (seen.has(k)) continue; seen.add(k)
      const decoOpts = {}
      if (cls) decoOpts.class = cls
      if (style) decoOpts.attributes = { style }
      if (!cls && !style) continue
      try { lb.add(pos, pos, Decoration.line(decoOpts)) } catch { /**/ }
    }

    return { spans: sb.finish(), lines: lb.finish() }
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        try { const r = build(view); this.decorations = r.spans; this.lineDecos = r.lines }
        catch { this.decorations = Decoration.none; this.lineDecos = Decoration.none }
      }
      update(upd) {
        if (upd.docChanged || upd.viewportChanged) {
          try { const r = build(upd.view); this.decorations = r.spans; this.lineDecos = r.lines }
          catch { /**/ }
        }
      }
    },
    {
      decorations: v => v.decorations,
      provide: plugin => [
        cm.view.EditorView.decorations.of(v => {
          try { return v.plugin(plugin)?.lineDecos ?? Decoration.none }
          catch { return Decoration.none }
        }),
      ],
    }
  )
}

// ─── View mode button ─────────────────────────────────────────────────────────
export const VIEW_MODE_CYCLE = ['live', 'source', 'preview']
export const IconSrc = () => (
  <Pencil size={15} strokeWidth={1.4} />
)
export const IconPrev = () => (
  <Eye size={15} strokeWidth={1.4} />
)
export const IconLive = () => <IconQuill size={15} />
export const MODE_META = {
  live:    { icon: <IconLive />, label: 'Live',    title: 'Live preview' },
  source:  { icon: <IconSrc />,  label: 'Source',  title: 'Source mode' },
  preview: { icon: <IconPrev />, label: 'Preview', title: 'Reading view' },
}

export function ViewModeBtn({ viewMode, setViewMode }) {
  const [phase,    setPhase]    = useState('visible')
  const [shown,    setShown]    = useState(viewMode)
  const [dropOpen, setDropOpen] = useState(false)
  const holdTimer = useRef(null)
  const didLong   = useRef(false)
  const wrapRef   = useRef(null)
  const prevRef   = useRef(viewMode)

  useEffect(() => {
    const prev = prevRef.current; prevRef.current = viewMode
    if (prev === viewMode) return
    const t0 = setTimeout(() => setPhase('exiting'),  0)
    const t1 = setTimeout(() => { setShown(viewMode); setPhase('entering') }, 150)
    const t2 = setTimeout(() => setPhase('visible'),  300)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2) }
  }, [viewMode])

  useEffect(() => {
    if (!dropOpen) return
    const h = e => { if (!wrapRef.current?.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [dropOpen])

  return (
    <div style={{ position:'relative', flexShrink:0 }} ref={wrapRef}>
      <button className="gnos-settings-btn"
        title={MODE_META[viewMode].title}
        onMouseDown={() => { didLong.current=false; holdTimer.current=setTimeout(()=>{ didLong.current=true; setDropOpen(d=>!d) },300) }}
        onMouseUp={() => clearTimeout(holdTimer.current)}
        onMouseLeave={() => clearTimeout(holdTimer.current)}
        onClick={() => { if(didLong.current)return; setViewMode(viewMode === 'source' ? 'live' : 'source'); setDropOpen(false) }}
      >
        <span style={{ display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .18s,transform .18s', ...(phase==='exiting'?{opacity:0,transform:'scale(.6) rotate(-15deg)',position:'absolute'}:phase==='entering'?{opacity:0,transform:'scale(.6) rotate(15deg)'}:{opacity:1,transform:'none'}) }}>
          {MODE_META[shown].icon}
        </span>
      </button>
      {dropOpen && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden', boxShadow:'0 12px 40px rgba(0,0,0,.45)', minWidth:130, zIndex:9300, animation:'vm-drop .12s cubic-bezier(.4,0,.2,1)' }}>
          {VIEW_MODE_CYCLE.map(m => (
            <button key={m} onMouseDown={e => { e.preventDefault(); setViewMode(m); setDropOpen(false) }}
              style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 14px', border:'none', background:'none', width:'100%', cursor:'pointer', textAlign:'left', fontSize:13, fontFamily:'inherit', color: viewMode===m?'var(--accent)':'var(--text)', transition:'background .08s' }}>
              {MODE_META[m].icon}
              <span style={{ flex:1, fontWeight:500 }}>{MODE_META[m].label}</span>
              {viewMode===m && <span style={{ fontSize:11, opacity:.7 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

