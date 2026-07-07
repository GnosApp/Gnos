// Shared notebook CodeMirror plugins, extracted from NotebookView so the quick-note
// editor can opt into the same rich behaviours. Each factory takes the loaded CM
// module bundle (`cm`) and returns CM extensions.
//
// Currently exports the math-calc subsystem (inline `expr=` calculator, `/math`
// zones, variable scope, natural-language date math). Behaviour is unchanged from
// when it lived in NotebookView — do not edit here without keeping both callers green.


// ─── Math.js + Algebrite inline calculator (ghost hint for `expr=`) ─────────
// Lazy-loads mathjs and algebrite. Shows result as ghost text after `=`.
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

export function makeMathCalcPlugin(cm) {
  const { ViewPlugin, Decoration, WidgetType } = cm.view

  class MathGhostWidget extends WidgetType {
    constructor(text) { super(); this.text = text }
    toDOM() {
      const span = document.createElement('span')
      span.className = 'cm-ghost-hint cm-math-ghost'
      span.textContent = this.text
      span.setAttribute('aria-hidden', 'true')
      return span
    }
    eq(o) { return o instanceof MathGhostWidget && o.text === this.text }
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
    }
    mathLib = m
  })
  getAlgebrite().then(a => { algLib = a })

  // Patterns that should go directly to Algebrite (symbolic CAS)
  const CAS_RE = /\b(integral|integrate|roots|solve|factor|expand|taylor|defint|laplace)\b/i

  // Comprehensive date/time math
  function tryDateMath(expr) {
    const lower = expr.toLowerCase().trim()
    const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
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
      const today = new Date(now); today.setHours(0,0,0,0)
      if (s === 'today') return new Date(today)
      if (s === 'tomorrow')  { const d = new Date(today); d.setDate(d.getDate()+1); return d }
      if (s === 'yesterday') { const d = new Date(today); d.setDate(d.getDate()-1); return d }
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
      if (s === 'next week')  { const d = new Date(today); d.setDate(d.getDate()+7); return d }
      if (s === 'last week')  { const d = new Date(today); d.setDate(d.getDate()-7); return d }
      if (s === 'next month') { const d = new Date(today); d.setMonth(d.getMonth()+1); return d }
      if (s === 'last month') { const d = new Date(today); d.setMonth(d.getMonth()-1); return d }
      if (s === 'next year')  { const d = new Date(today); d.setFullYear(d.getFullYear()+1); return d }
      if (s === 'last year')  { const d = new Date(today); d.setFullYear(d.getFullYear()-1); return d }
      // time: "9am", "9:30am", "14:30"
      const timeM = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
      if (timeM) {
        const d = new Date(now); let h = parseInt(timeM[1],10); const m = parseInt(timeM[2]||'0',10)
        if (timeM[3]==='pm' && h!==12) h+=12; if (timeM[3]==='am' && h===12) h=0
        d.setHours(h,m,0,0); return d
      }
      const time24M = s.match(/^(\d{1,2}):(\d{2})$/)
      if (time24M) { const d = new Date(now); d.setHours(parseInt(time24M[1],10),parseInt(time24M[2],10),0,0); return d }
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
        const d = new Date(today); d.setMonth(parseInt(mdM[1],10)-1, parseInt(mdM[2],10)); return d
      }
      // ISO "YYYY-MM-DD" → parse as local (avoid UTC shift from new Date)
      const isoM = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
      if (isoM) return new Date(parseInt(isoM[1],10), parseInt(isoM[2],10)-1, parseInt(isoM[3],10))
      // Try JS date parsing
      const parsed = new Date(s)
      if (!isNaN(parsed.getTime())) return parsed
      return null
    }

    function applyDur(d, sign, n, unit) {
      const r = new Date(d)
      const u = normUnit(unit)
      if (u==='second') r.setSeconds(r.getSeconds()+sign*n)
      else if (u==='minute') r.setMinutes(r.getMinutes()+sign*n)
      else if (u==='hour') r.setHours(r.getHours()+sign*n)
      else if (u==='day') r.setDate(r.getDate()+sign*n)
      else if (u==='week') r.setDate(r.getDate()+sign*n*7)
      else if (u==='month') r.setMonth(r.getMonth()+sign*n)
      else if (u==='year') r.setFullYear(r.getFullYear()+sign*n)
      return r
    }

    function isTimeUnit(u) { const c = normUnit(u); return c==='second' || c==='minute' || c==='hour' }

    function fmtDate(d) { return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}) }
    function fmtTime(d) { return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' @ '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) }
    function fmt(d, wasTime) { return wasTime ? fmtTime(d) : fmtDate(d) }

    // Phrase matchers first: they embed a date that V8's lenient `new Date`
    // would otherwise extract in the standalone base check below.

    // "days/weeks/months until [date]"
    const untilM = lower.match(/^(?:how many )?(days|hours|weeks|months) until (.+)$/)
    if (untilM) {
      const d = parseBase(untilM[2])
      if (d && !isNaN(d.getTime())) {
        const ms = d.getTime() - Date.now()
        if (untilM[1]==='days')   { const n=Math.ceil(ms/86400000); return `${n} day${Math.abs(n)!==1?'s':''}` }
        if (untilM[1]==='hours')  { const n=Math.ceil(ms/3600000); return `${n} hour${Math.abs(n)!==1?'s':''}` }
        if (untilM[1]==='weeks')  { const n=Math.ceil(ms/604800000); return `${n} week${Math.abs(n)!==1?'s':''}` }
        if (untilM[1]==='months') { const n=Math.round(ms/2629800000); return `${n} month${Math.abs(n)!==1?'s':''}` }
      }
    }

    // "days/weeks/months since [date]"
    const sinceM = lower.match(/^(?:how many )?(days|hours|weeks|months) since (.+)$/)
    if (sinceM) {
      const d = parseBase(sinceM[2])
      if (d && !isNaN(d.getTime())) {
        const ms = Date.now() - d.getTime()
        if (sinceM[1]==='days')   { const n=Math.floor(ms/86400000); return `${n} day${n!==1?'s':''}` }
        if (sinceM[1]==='hours')  { const n=Math.floor(ms/3600000); return `${n} hour${n!==1?'s':''}` }
        if (sinceM[1]==='weeks')  { const n=Math.floor(ms/604800000); return `${n} week${n!==1?'s':''}` }
        if (sinceM[1]==='months') { const n=Math.floor(ms/2629800000); return `${n} month${n!==1?'s':''}` }
      }
    }

    // Standalone: "today", "tomorrow", "yesterday", "next monday", etc.
    const base = parseBase(lower)
    if (base) return fmtDate(base)

    // "base +/- N units"
    const durRe = new RegExp(`^(.+?)\\s*([+-])\\s*(\\d+)\\s*(${UNITS})$`)
    const durM = lower.match(durRe)
    if (durM) {
      const b = parseBase(durM[1].trim())
      if (b) {
        const sign = durM[2]==='+' ? 1 : -1
        const n = parseInt(durM[3],10), u = durM[4]
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
        return `${n} day${Math.abs(n)!==1?'s':''}`
      }
    }

    // "N units ago"
    const agoM = lower.match(new RegExp(`^(\\d+)\\s*(${UNITS})\\s+ago$`))
    if (agoM) {
      const r = applyDur(new Date(), -1, parseInt(agoM[1],10), agoM[2])
      return fmt(r, isTimeUnit(agoM[2]))
    }
    // "in N units"
    const inM = lower.match(new RegExp(`^in\\s+(\\d+)\\s*(${UNITS})$`))
    if (inM) {
      const r = applyDur(new Date(), 1, parseInt(inM[1],10), inM[2])
      return fmt(r, isTimeUnit(inM[2]))
    }

    return null
  }

  // Convert natural language math to evaluatable expression
  function naturalLangToExpr(expr) {
    let s = expr.toLowerCase()
    s = s.replace(/^(?:what is|calculate|compute|find|evaluate)\s+/i, '')
    s = s.replace(/\bplus\b/g, '+')
    s = s.replace(/\bminus\b/g, '-')
    s = s.replace(/\btimes\b/g, '*')
    s = s.replace(/\bdivided by\b/g, '/')
    s = s.replace(/\bsquared\b/g, '^2')
    s = s.replace(/\bcubed\b/g, '^3')
    s = s.replace(/\bsquare root of\b/g, 'sqrt(')
    // Close open sqrt( if we added it
    if (s.includes('sqrt(') && !s.includes(')')) s += ')'
    s = s.replace(/\bpercent of\b/g, '/100 *')
    return s
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
  // Keeps plain prose and lists ("Groceries: 40") from being treated as math.
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

  // ─── Document scope scan ──────────────────────────────────────────────────
  // Scans math-zone lines top-to-bottom for "Name: expression" patterns.
  // Returns { varDefs, scope, zones } where scope maps token → numeric value.
  function buildDocScope(state) {
    const varDefs = []  // [{ name, token, value, lineFrom, lineEnd, nameFrom, nameEnd, colonFrom, rhsFrom }]
    const scope   = {}
    const zones   = computeMathZones(state)
    if (!zones.length) return { varDefs, scope, zones }
    for (let ln = 1; ln <= state.doc.lines; ln++) {
      if (!inMathZone(zones, ln)) continue
      const line = state.doc.line(ln)
      const m    = line.text.match(/^(.+?):\s*(.+)$/)
      if (!m) continue
      const name   = m[1].trim()
      const valStr = m[2].trim()
      // Skip markdown artifacts (headings, lists, blockquotes, URLs, code fences…)
      if (!name || /^[-*#>|`\\]/.test(name) || /[:/\\]/.test(name)) continue
      // Variable names must start with a letter and be reasonably short
      if (!/^[a-zA-Z]/.test(name) || name.length > 50) continue
      // Only treat as a variable definition if the RHS looks numeric-capable:
      // it must contain at least one digit, OR reference an already-defined variable.
      // This prevents plain prose lines like "Note: See above" from being highlighted.
      const hasDigit = /\d/.test(valStr)
      const refsKnownVar = varDefs.some(v => {
        const esc = v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(?<![_a-zA-Z0-9])${esc}(?![_a-zA-Z0-9])`, 'i').test(valStr)
      })
      if (!hasDigit && !refsKnownVar) continue
      const token       = getVarToken(name)
      const substituted = applyVarSubstitution(valStr, varDefs)
      let value = null
      if (mathLib) {
        try {
          const r = mathLib.evaluate(substituted, { ...scope })
          if (r !== undefined && r !== null && typeof r !== 'function') {
            const n = typeof r === 'number' ? r : parseFloat(String(r))
            if (!isNaN(n)) value = n
          }
        } catch { /* non-numeric def — still register for autocomplete/deco */ }
      }
      // Compute exact character positions for decorations
      const nameFrom  = line.from + m[1].search(/\S/)   // skip any leading spaces
      const nameEnd   = nameFrom + name.length
      const colonFrom = line.from + m[1].length          // position of the ':'
      const rhsFrom   = line.from + m[0].length - m[2].length  // start of RHS text
      varDefs.push({ name, token, value, lineFrom: line.from, lineEnd: line.to, nameFrom, nameEnd, colonFrom, rhsFrom })
      if (value !== null) scope[token] = value
    }
    return { varDefs, scope, zones }
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

  // ─── Scope state field ───────────────────────────────────────────────────
  // Caches the document scope; rebuilt only on doc changes, not cursor moves.
  const docScopeField = cm.state.StateField.define({
    create: state => buildDocScope(state),
    update: (val, tr) => tr.docChanged ? buildDocScope(tr.state) : val,
  })

  function evalExpr(expr, scope = {}) {
    // Strip thousands-separator commas (e.g. 1,000 → 1000, 1,000,000 → 1000000)
    expr = expr.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, m => m.replace(/,/g, ''))

    // Try date math first
    const dateResult = tryDateMath(expr)
    if (dateResult !== null) return dateResult

    // Natural language conversion
    const naturalExpr = naturalLangToExpr(expr)

    // Route CAS-like expressions to Algebrite first
    if (algLib && CAS_RE.test(expr)) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil') return r
      } catch { /* fall through to mathjs */ }
    }
    // Try math.js (also handles unit conversions like "5 km to miles")
    if (mathLib) {
      try {
        const result = mathLib.evaluate(expr, { ...scope })
        if (result === undefined || result === null || typeof result === 'function') return null
        return String(typeof result === 'object' && result.toString ? result.toString() : result)
      } catch { /* try natural language variant */ }
      // Try the natural language converted expression
      if (naturalExpr !== expr) {
        try {
          const result = mathLib.evaluate(naturalExpr, { ...scope })
          if (result !== undefined && result !== null && typeof result !== 'function') {
            return String(typeof result === 'object' && result.toString ? result.toString() : result)
          }
        } catch { /* fall through */ }
      }
    }
    // Algebrite fallback for anything math.js couldn't handle
    if (algLib) {
      try {
        const r = algLib.run(expr)
        if (r && r !== 'Stop' && r !== 'nil') return r
      } catch { /* give up */ }
    }
    return null
  }

  const mathPlugin = ViewPlugin.fromClass(class {
    constructor(view) { this.deco = Decoration.none; this._hint = null; this._compute(view) }
    update(upd) { if (upd.docChanged || upd.selectionSet) this._compute(upd.view) }
    _compute(view) {
      if (!mathLib && !algLib) { this.deco = Decoration.none; this._hint = null; return }
      const { state } = view
      const cur = state.selection.main
      if (!cur.empty) { this.deco = Decoration.none; this._hint = null; return }
      const line = state.doc.lineAt(cur.head)
      const col = cur.head - line.from
      const textBefore = line.text.slice(0, col)

      // Read cached scope (rebuilt by docScopeField only on doc changes)
      const { varDefs, scope, zones } = state.field(docScopeField)

      // Calculator is opt-in — only lines inside a /math zone evaluate
      if (!inMathZone(zones, line.number)) { this.deco = Decoration.none; this._hint = null; return }

      // Support =:.N precision syntax: "2*32.12321 =:.2" rounds to 2 decimals
      const precMatch = textBefore.match(/^(.*?)([^=\n]+)=:\.(\d+)\s*$/)
      const plainMatch = textBefore.match(/^(.*?)([^=\n]+)=\s*$/)
      const match = precMatch || plainMatch
      if (!match) { this.deco = Decoration.none; this._hint = null; return }
      const precision = precMatch ? parseInt(precMatch[3]) : null
      let rawExpr = match[2].trim()

      // Strip "Name: " prefix from variable definition lines so the RHS is evaluated.
      // e.g. "Catering price: Friends * Food price =" → evaluate "Friends * Food price"
      const colonM = rawExpr.match(/^[^:]+:\s*(.+)$/)
      if (colonM) rawExpr = colonM[1].trim()

      // Strip list prefixes and markdown formatting
      rawExpr = rawExpr.replace(/^(?:[-*+]|\d+\.)\s+/, '')
      rawExpr = rawExpr.replace(/\*{2,}|[_~`]+/g, '')

      // Substitute variable names → tokens
      let expr = applyVarSubstitution(rawExpr, varDefs)

      // Check if this expression references any defined variables
      const hasVarRef = varDefs.some(v => v.value !== null && expr.includes(v.token))

      if (!hasVarRef) {
        // Original math isolation logic for plain numeric expressions
        const mathStart = expr.match(/((?:(?:sin|cos|tan|log|ln|sqrt|abs|ceil|floor|round|exp|pow|FV|PV|PMT|NPV|integral|solve|factor|expand)\s*\(|[-+]?\s*[\d(]).*$)/i)
        if (mathStart) expr = mathStart[1].trim()
        else {
          const mathPart = expr.match(/([\d(][\d\s+\-*/^().,%]*[\d)])\s*$/)
          if (mathPart) expr = mathPart[1].trim()
        }
        if (!expr || /^[a-zA-Z]{4,}$/.test(expr)) { this.deco = Decoration.none; this._hint = null; return }
        if (!/[+\-*/^%()]/.test(expr) && !/\b(sin|cos|tan|log|ln|sqrt|abs|ceil|floor|round|exp|pow|FV|PV|PMT|NPV)\s*\(/i.test(expr) && !/\bto\b/i.test(expr)) {
          this.deco = Decoration.none; this._hint = null; return
        }
      }

      let result = evalExpr(expr, scope)
      if (!result) { this.deco = Decoration.none; this._hint = null; return }

      // Apply precision rounding if =:.N was used
      if (precision !== null) {
        const num = parseFloat(result)
        if (!isNaN(num)) result = num.toFixed(precision)
      }

      const resultStr = ' ' + result
      const builder = new cm.state.RangeSetBuilder()
      try {
        builder.add(cur.head, cur.head, Decoration.widget({ widget: new MathGhostWidget(resultStr), side: 1 }))
      } catch { /* ignore */ }
      this.deco = builder.finish()
      this._hint = { pos: cur.head, insert: resultStr }
    }
    get decorations() { return this.deco }
  }, { decorations: v => v.decorations })

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
            const to   = from + name.length
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
    const line     = context.state.doc.lineAt(context.pos)
    const lineText = line.text
    // Only activate on expression/definition lines
    if (!lineText.includes(':') && !lineText.includes('=')) return null
    const { varDefs, zones } = buildDocScope(context.state)
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
  const varUpdateEffect    = cm.state.StateEffect.define()
  const varUpdateField     = cm.state.StateField.define({
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
        const newNum    = parseFloat(result)
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

  const mathKeymap = cm.view.keymap.of([{
    key: 'Tab',
    run: view => {
      const plugin = view.plugin(mathPlugin)
      if (!plugin?._hint) return false
      const { pos, insert } = plugin._hint
      if (view.state.selection.main.head !== pos) return false
      view.dispatch({
        changes: { from: pos, to: pos, insert },
        selection: { anchor: pos + insert.length },
      })
      return true
    },
  }])

  // ─── Prose number decorator ───────────────────────────────────────────────
  // Applies uniform tabular-nums + slightly heavier weight to all digit sequences
  // in editor text (the highlight style only fires inside code contexts).
  const _numRE   = /(?<![_a-zA-Z#])\d+(?:[.,]\d+)*/g
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
          const end  = Math.min(line.to, to)
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

  return [docScopeField, varUpdateField, mathPlugin, varDecoPlugin, varResultDecoPlugin, numberDecoPlugin, liveResultPlugin, mathKeymap, varAutocompletion]
}
