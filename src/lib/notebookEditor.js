// Shared notebook CodeMirror plugins, extracted from NotebookView so the quick-note
// editor can opt into the same rich behaviours. Each factory takes the loaded CM
// module bundle (`cm`) and returns CM extensions.
//
// Exports the math-calc subsystem: inline `expr=` calculator, `/math` zones,
// variable scope, natural-language math (word numbers, percentages, magnitudes),
// date/time + timezone math, offline currency/CSS units, per-line right-column
// results (numi-style) with prev/sum/total/average aggregates.
// Used by both NotebookView and QuickNoteView — keep both callers green.


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

export function makeMathCalcPlugin(cm) {
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
    const key = expr + ' ' + Object.keys(scope).map(k => k + ':' + String(scope[k])).join(',')
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

  const varAutocompletion = cm.autocomplete.autocompletion({
    override: [varCompleteSource],
    icons: false,
    closeOnBlur: true,
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
