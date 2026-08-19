/**
 * Calendar.jsx — FullCalendar + EventModal + MonthYearPicker + MiniCalendar.
 * Extracted from LibraryView.jsx. Used by CalendarView (full page) and
 * LibraryView's planner tab (embedded).
 */
import { useState, useRef, useEffect } from 'react'
import useAppStore from '@/store/useAppStore'
import { saveCalendarEvents } from '@/lib/storage'
import QuickAccess from '@/components/QuickAccess'
import SegmentedControl from '@/components/SegmentedControl'
import { AlertTriangle, AlignLeft, Calendar, CalendarArrowDown, Check, ChevronDown, ChevronLeft, Clock, MapPin, MoveRight, Navigation, Palette, Plus, RefreshCw } from 'lucide-react'

// Tinted event chip — readable on every theme (no white-on-hex).
const eventChip = (c) => ({
  background: `color-mix(in srgb, ${c} 18%, var(--surface))`,
  color: `color-mix(in srgb, ${c} 62%, var(--text))`,
  borderLeft: `3px solid ${c}`,
})

// ── Shared helpers ────────────────────────────────────────────────────────────
const EVENT_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316','#84CC16','#6B7280','#14B8A6','#A855F7']
const fmt2 = n => String(n).padStart(2,'0')
const dkey = (y,m,d) => `${y}-${fmt2(m+1)}-${fmt2(d)}`
const makeEvtId  = () => `evt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`

function eventsForDateKey(dateKey, events) {
  return events.filter(e => {
    if (e.date === dateKey) return true
    if (!e.recurrence || e.recurrence === 'none') return false
    const base   = new Date(e.date + 'T00:00:00')
    const target = new Date(dateKey + 'T00:00:00')
    if (target <= base) return false
    if (e.recurrenceEndDate && target > new Date(e.recurrenceEndDate + 'T00:00:00')) return false
    const diffDays = Math.round((target - base) / 86400000)
    if (e.recurrence === 'daily')   return true
    if (e.recurrence === 'weekly')  return diffDays % 7 === 0
    if (e.recurrence === 'monthly') return target.getDate() === base.getDate()
    if (e.recurrence === 'yearly')  return target.getDate() === base.getDate() && target.getMonth() === base.getMonth()
    if (e.recurrence === 'custom') {
      const interval = e.customInterval || 1
      const unit = e.customUnit || 'week'
      if (unit === 'day') return diffDays % interval === 0
      if (unit === 'week') {
        const weeksDiff = Math.floor(diffDays / 7)
        if (e.customDays?.length > 0) {
          return e.customDays.includes(target.getDay()) && weeksDiff % interval === 0
        }
        return diffDays % (interval * 7) === 0
      }
      if (unit === 'month') {
        const monthsDiff = (target.getFullYear() * 12 + target.getMonth()) - (base.getFullYear() * 12 + base.getMonth())
        return target.getDate() === base.getDate() && monthsDiff % interval === 0
      }
      if (unit === 'year') {
        return target.getDate() === base.getDate() && target.getMonth() === base.getMonth() && (target.getFullYear() - base.getFullYear()) % interval === 0
      }
    }
    return false
  })
}

// ── EventModal ────────────────────────────────────────────────────────────────
// ── Mini calendar for EventModal date picker ──────────────────────────────────
const _MINI_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function MiniCalendar({ value, onChange }) {
  const todayKey = new Date().toISOString().slice(0,10)
  const [view, setView] = useState(() => {
    const d = value ? new Date(value+'T00:00:00') : new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const { y, m } = view
  const first = new Date(y, m, 1).getDay()
  const dim   = new Date(y, m+1, 0).getDate()
  const CELLS = 35
  const prevMonth = () => { const d=new Date(y,m-1,1); setView({y:d.getFullYear(),m:d.getMonth()}) }
  const nextMonth = () => { const d=new Date(y,m+1,1); setView({y:d.getFullYear(),m:d.getMonth()}) }
  const navBtnStyle = {width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,lineHeight:1,transition:'background 0.1s,color 0.1s'}
  return (
    <div style={{userSelect:'none',background:'var(--surfaceAlt)',borderRadius:10,padding:10,border:'1px solid var(--border)'}}>
      {/* Month nav */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <button onClick={prevMonth} style={navBtnStyle}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--surface)';e.currentTarget.style.color='var(--text)'}}
          onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)'}}>‹</button>
        <span style={{fontSize:12,fontWeight:700,color:'var(--text)',letterSpacing:'-0.01em'}}>{_MINI_MONTHS[m]} {y}</span>
        <button onClick={nextMonth} style={navBtnStyle}
          onMouseEnter={e=>{e.currentTarget.style.background='var(--surface)';e.currentTarget.style.color='var(--text)'}}
          onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)'}}>›</button>
      </div>
      {/* Day-of-week headers */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:3}}>
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d,i)=>(
          <div key={i} style={{fontSize:9,fontWeight:700,textAlign:'center',color:'var(--textDim)',padding:'2px 0',textTransform:'uppercase',letterSpacing:'0.04em'}}>{d}</div>
        ))}
      </div>
      {/* Calendar grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
        {Array.from({length:CELLS},(_,i)=>{
          const dn = i - first + 1
          const cell = new Date(y, m, dn)
          const dk = `${cell.getFullYear()}-${String(cell.getMonth()+1).padStart(2,'0')}-${String(cell.getDate()).padStart(2,'0')}`
          const inMonth = dn>=1 && dn<=dim
          const isToday = dk===todayKey
          const isSel   = dk===value
          return (
            <div key={i} onClick={()=>inMonth&&onChange(dk)}
              style={{textAlign:'center',fontSize:11,fontWeight:isSel||isToday?700:400,
                padding:'5px 2px',borderRadius:6,cursor:inMonth?'pointer':'default',
                background:isSel?'var(--accent)':isToday?'color-mix(in srgb,var(--accent) 15%,transparent)':'transparent',
                color:isSel?'#fff':isToday?'var(--accent)':inMonth?'var(--text)':'var(--textDim)',
                opacity:inMonth?1:0.35,transition:'background 0.1s'}}>
              {cell.getDate()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EventModal({ event, onSave, onDelete, onClose }) {
  const [form, setForm] = useState({
    title:             event?.title             || '',
    date:              event?.date              || new Date().toISOString().slice(0,10),
    startTime:         event?.startTime         || '',
    endTime:           event?.endTime           || '',
    allDay:            event?.allDay            ?? true,
    location:          event?.location          || '',
    color:             event?.color             || EVENT_COLORS[0],
    recurrence:        event?.recurrence        || 'none',
    recurrenceEndDate: event?.recurrenceEndDate || '',
    customInterval:    event?.customInterval    || 1,
    customUnit:        event?.customUnit        || 'week',
    customDays:        event?.customDays        || [],
    description:       event?.description       || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const isNew = !event?.id
  // Date picker starts collapsed — a compact date row expands to the MiniCalendar.
  const [showDatePicker, setShowDatePicker] = useState(false)
  const dateLabel = new Date(form.date + 'T00:00:00')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })

  const openMaps = () => {
    if (!form.location.trim()) return
    const q = encodeURIComponent(form.location.trim())
    // Use the native maps:// scheme so the OS opens Maps.app, not a browser.
    const nativeUrl = `maps://?daddr=${q}`
    import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('plugin:shell|open', { path: nativeUrl })
    ).catch(() => {})
  }

  const inputStyle = {
    background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 9,
    color: 'var(--text)', fontSize: 13, padding: '8px 11px',
    fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
  }
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 10 }
  const iconStyle = { flexShrink: 0, color: 'var(--textDim)', opacity: 0.7 }

  return (
    <>
      <style>{`@keyframes evtSlideIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}`}</style>
      {/* Backdrop — absolute so it stays inside the calendar card */}
      <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.35)',zIndex:90,backdropFilter:'blur(2px)',borderRadius:10}} onClick={onClose}/>
      {/* Right-side panel — absolute inside the calendar card */}
      <div style={{position:'absolute',top:0,right:0,bottom:0,width:380,maxWidth:'100%',zIndex:91,
        display:'flex',flexDirection:'column',
        background:'var(--surface)',borderLeft:'1px solid var(--border)',
        boxShadow:'-12px 0 36px rgba(0,0,0,0.25)',borderRadius:'0 10px 10px 0',
        animation:'evtSlideIn 0.2s cubic-bezier(0.16,1,0.3,1)'}}
        onClick={e=>e.stopPropagation()}>
        {/* Color accent bar */}
        <div style={{height:3,background:form.color,flexShrink:0,transition:'background 0.15s'}}/>
        {/* Header */}
        <div style={{padding:'16px 18px 13px',borderBottom:'1px solid var(--borderSubtle)',flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
          <button onClick={onClose} style={{width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'none',color:'var(--textDim)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'background 0.1s'}}
            onMouseEnter={e=>e.currentTarget.style.background='var(--surfaceAlt)'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>
            <ChevronLeft size={12} strokeWidth={1.6} />
          </button>
          <input value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Event title" autoFocus
            style={{flex:1,background:'none',border:'none',color:'var(--text)',fontSize:17,fontWeight:700,padding:0,fontFamily:'inherit',outline:'none',letterSpacing:'-0.01em',minWidth:0}}/>
        </div>
        {/* Scrollable body */}
        <div style={{flex:1,overflowY:'auto',padding:'16px 18px 24px',display:'flex',flexDirection:'column',gap:12}}>
          {/* Date — compact row, expands to the mini calendar */}
          <div style={rowStyle}>
            <Calendar size={15} strokeWidth={1.4} style={iconStyle} />
            <button onClick={()=>setShowDatePicker(v=>!v)}
              style={{...inputStyle,flex:1,textAlign:'left',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',
                borderColor:showDatePicker?'var(--accent)':'var(--border)'}}>
              {dateLabel}
              <ChevronDown size={10} strokeWidth={1.5} style={{opacity:0.5,transition:'transform 0.15s',transform:showDatePicker?'rotate(180deg)':'none'}} />
            </button>
          </div>
          {showDatePicker && <MiniCalendar value={form.date} onChange={d=>{set('date',d);setShowDatePicker(false)}}/>}
          <div style={{height:1,background:'var(--borderSubtle)',margin:'2px 0'}}/>
          {/* All-day toggle */}
          <div style={{...rowStyle,justifyContent:'space-between'}}>
            <span style={{fontSize:13,color:'var(--textDim)',display:'flex',alignItems:'center',gap:8}}>
              <Clock size={15} strokeWidth={1.4} style={iconStyle} />
              All day
            </span>
            <button onClick={()=>set('allDay',!form.allDay)}
              style={{width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',position:'relative',padding:0,
                background:form.allDay?'var(--accent)':'var(--borderSubtle)',transition:'background 0.18s'}}>
              <div style={{width:18,height:18,borderRadius:'50%',background:'white',position:'absolute',top:2,
                left:form.allDay?20:2,transition:'left 0.18s',boxShadow:'0 1px 4px rgba(0,0,0,0.25)'}}/>
            </button>
          </div>
          {/* Times */}
          {!form.allDay && (
            <div style={{...rowStyle}}>
              <Clock size={15} strokeWidth={1.4} style={iconStyle} />
              <input type="time" value={form.startTime} onChange={e=>set('startTime',e.target.value)} style={{...inputStyle,flex:1}}/>
              <MoveRight size={12} strokeWidth={1.5} style={{flexShrink:0,opacity:0.4}} />
              <input type="time" value={form.endTime} onChange={e=>set('endTime',e.target.value)} style={{...inputStyle,flex:1}}/>
            </div>
          )}
          {/* Location + directions */}
          <div style={rowStyle}>
            <MapPin size={15} strokeWidth={1.4} style={iconStyle} />
            <input value={form.location} onChange={e=>set('location',e.target.value)} placeholder="Add location" style={{...inputStyle,flex:1}}/>
            {form.location.trim() && (
              <button onClick={openMaps} title="Get directions"
                style={{width:32,height:32,borderRadius:8,border:'1px solid var(--border)',background:'var(--surfaceAlt)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,color:'var(--textDim)',transition:'background 0.1s,color 0.1s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--accent)';e.currentTarget.style.color='#fff'}}
                onMouseLeave={e=>{e.currentTarget.style.background='var(--surfaceAlt)';e.currentTarget.style.color='var(--textDim)'}}>
                <Navigation size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          {/* Recurrence */}
          <div style={rowStyle}>
            <RefreshCw size={15} strokeWidth={1.4} style={iconStyle} />
            <select value={form.recurrence} onChange={e=>set('recurrence',e.target.value)} style={{...inputStyle,flex:1,cursor:'pointer'}}>
              {[['none','Does not repeat'],['daily','Daily'],['weekly','Weekly'],['monthly','Monthly'],['yearly','Yearly'],['custom','Custom…']].map(([v,l])=>(
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          {form.recurrence==='custom' && (
            <div style={{background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'var(--textDim)',whiteSpace:'nowrap'}}>Every</span>
                <input type="number" min="1" max="99" value={form.customInterval} onChange={e=>set('customInterval',Math.max(1,parseInt(e.target.value)||1))}
                  style={{...inputStyle,width:52,height:32,padding:'0 8px',textAlign:'center',flexShrink:0}}/>
                <select value={form.customUnit} onChange={e=>set('customUnit',e.target.value)} style={{...inputStyle,flex:1,height:32,padding:'0 8px',cursor:'pointer'}}>
                  <option value="day">day(s)</option>
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </select>
              </div>
              {form.customUnit==='week' && (
                <div style={{display:'flex',gap:4}}>
                  {[['S',0],['M',1],['T',2],['W',3],['T',4],['F',5],['S',6]].map(([lbl,d])=>{
                    const active = form.customDays.includes(d)
                    return (
                      <button key={d} onClick={()=>set('customDays',active?form.customDays.filter(x=>x!==d):[...form.customDays,d].sort())}
                        style={{flex:1,height:32,borderRadius:8,border:`1px solid ${active?'var(--accent)':'var(--border)'}`,
                          background:active?'var(--accent)':'var(--surface)',color:active?'#fff':'var(--textDim)',
                          fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                        {lbl}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {form.recurrence!=='none' && (
            <div style={rowStyle}>
              <Calendar size={15} strokeWidth={1.4} style={iconStyle} />
              <input type="date" value={form.recurrenceEndDate} onChange={e=>set('recurrenceEndDate',e.target.value)}
                style={{...inputStyle,flex:1}} placeholder="Recurrence end date"/>
            </div>
          )}
          {/* Color — single row of circle swatches (sketch-picker language) */}
          <div style={rowStyle}>
            <Palette size={15} strokeWidth={1.4} style={iconStyle} />
            <div style={{display:'flex',flexWrap:'wrap',gap:7,flex:1,alignItems:'center'}}>
              {EVENT_COLORS.map(c=>(
                <button key={c} onClick={()=>set('color',c)} title={c}
                  style={{width:18,height:18,borderRadius:'50%',background:c,cursor:'pointer',padding:0,border:'none',
                    boxShadow:form.color===c?`0 0 0 2px var(--surface),0 0 0 3.5px ${c}`:'none',
                    transform:form.color===c?'scale(1.15)':'scale(1)',transition:'all 0.12s'}}/>
              ))}
            </div>
          </div>
          {/* Description */}
          <div style={rowStyle}>
            <AlignLeft size={15} strokeWidth={1.4} style={{...iconStyle,alignSelf:'flex-start',marginTop:9}} />
            <textarea value={form.description} onChange={e=>set('description',e.target.value)} placeholder="Add notes" rows={3}
              style={{...inputStyle,flex:1,resize:'none',lineHeight:1.55}}/>
          </div>
        </div>
        {/* Footer */}
        <div style={{padding:'12px 18px 16px',borderTop:'1px solid var(--borderSubtle)',flexShrink:0,display:'flex',gap:8}}>
          {!isNew && (
            <button onClick={onDelete}
              style={{padding:'9px 16px',borderRadius:10,border:'1px solid rgba(248,81,73,0.3)',background:'rgba(248,81,73,0.06)',color:'#f85149',cursor:'pointer',fontSize:13,fontWeight:600,fontFamily:'inherit',transition:'background 0.12s',flexShrink:0}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(248,81,73,0.14)'}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(248,81,73,0.06)'}>
              Delete
            </button>
          )}
          <button onClick={()=>form.title.trim()&&onSave(form)} disabled={!form.title.trim()}
            style={{flex:1,padding:'10px',borderRadius:10,border:'none',
              background:form.title.trim()?'var(--accent)':'var(--surfaceAlt)',
              color:form.title.trim()?'#fff':'var(--textDim)',
              cursor:form.title.trim()?'pointer':'default',fontSize:13,fontWeight:700,
              fontFamily:'inherit',transition:'opacity 0.12s',opacity:form.title.trim()?1:0.45}}>
            {isNew ? 'Create Event' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── MonthYearPicker ───────────────────────────────────────────────────────────
const _CAL_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function MonthYearPicker({ viewDate, onSelect, onClose }) {
  const [pickerYear, setPickerYear] = useState(viewDate.getFullYear())
  const curMonth = viewDate.getMonth()
  const curYear  = viewDate.getFullYear()
  return (
    <div style={{position:'absolute',top:44,left:0,zIndex:50,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:14,
      boxShadow:'0 8px 32px rgba(0,0,0,0.22)',width:260,userSelect:'none'}}
      onMouseDown={e=>e.stopPropagation()}>
      {/* Backdrop click to close */}
      <div style={{position:'fixed',inset:0,zIndex:-1}} onClick={onClose}/>
      {/* Year row */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <button onClick={()=>setPickerYear(y=>y-1)}
          style={{width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s'}}
          onMouseEnter={e=>e.currentTarget.style.background='var(--border)'}
          onMouseLeave={e=>e.currentTarget.style.background='var(--surfaceAlt)'}>‹</button>
        <span style={{fontSize:15,fontWeight:700,color:'var(--text)'}}>{pickerYear}</span>
        <button onClick={()=>setPickerYear(y=>y+1)}
          style={{width:26,height:26,borderRadius:6,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',cursor:'pointer',fontSize:15,display:'flex',alignItems:'center',justifyContent:'center',transition:'background 0.1s'}}
          onMouseEnter={e=>e.currentTarget.style.background='var(--border)'}
          onMouseLeave={e=>e.currentTarget.style.background='var(--surfaceAlt)'}>›</button>
      </div>
      {/* Month grid */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:4}}>
        {_CAL_MONTHS.map((lbl,mi)=>{
          const isCur = mi===curMonth && pickerYear===curYear
          return (
            <button key={mi} onClick={()=>onSelect(pickerYear,mi)}
              style={{padding:'7px 4px',borderRadius:7,border:'none',cursor:'pointer',fontSize:12,fontWeight:isCur?700:500,
                background:isCur?'var(--accent)':'var(--surfaceAlt)',
                color:isCur?'#fff':'var(--text)',transition:'background 0.12s,color 0.12s'}}
              onMouseEnter={e=>{ if(!isCur){e.currentTarget.style.background='var(--border)'}}}
              onMouseLeave={e=>{ if(!isCur){e.currentTarget.style.background='var(--surfaceAlt)'}}}>
              {lbl}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FullCalendar ──────────────────────────────────────────────────────────────
export function FullCalendar({ notebookEvents = {}, fullHeight = false }) {
  const today    = new Date()
  const todayKey = today.toISOString().slice(0,10)
  const events              = useAppStore(s => s.calendarEvents)
  const setCalendarEventsStore = useAppStore(s => s.setCalendarEventsStore)
  const calendarStartHour   = useAppStore(s => s.calendarStartHour ?? 7)
  const calendarEndHour     = useAppStore(s => s.calendarEndHour ?? 21)
  const calendarWeekStart   = useAppStore(s => s.calendarWeekStart ?? 0)
  const [viewMode,     setViewMode]     = useState('month')
  const [viewDate,     setViewDate]     = useState(new Date())
  const [selectedDay,  setSelectedDay]  = useState(null) // kept for potential future use
  const [editingEvent, setEditingEvent] = useState(null) // {event, isNew}
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [icsImporting,    setIcsImporting]    = useState(false)
  const [icsResult,       setIcsResult]       = useState(null) // { added, skipped }
  const [sysEvents,       setSysEvents]       = useState([])   // macOS EventKit, read-only
  const icsInputRef = useRef(null)

  const persist = async (evts) => { setCalendarEventsStore(evts); await saveCalendarEvents(evts) }

  // ── System calendar (macOS EventKit) — read-only overlay ────────────────────
  // Fetches events around the visible month; merged into the day lookups below.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const anchor = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
        const start = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1).getTime() / 1000
        const end   = new Date(anchor.getFullYear(), anchor.getMonth() + 2, 0).getTime() / 1000
        const raw = await invoke('eventkit_fetch', { start, end })
        if (cancelled || !Array.isArray(raw)) return
        setSysEvents(raw.map(e => {
          const sd = new Date(e.start * 1000)
          return {
            id: `sys_${e.id}`,
            title: e.title || 'Untitled',
            date: dkey(sd.getFullYear(), sd.getMonth(), sd.getDate()),
            startTime: e.all_day ? null : `${fmt2(sd.getHours())}:${fmt2(sd.getMinutes())}`,
            endTime: e.all_day ? null : (() => { const ed = new Date(e.end * 1000); return `${fmt2(ed.getHours())}:${fmt2(ed.getMinutes())}` })(),
            allDay: e.all_day,
            location: e.location || '',
            color: '#8A8A8E',       // neutral — system events read as muted
            source: 'system',
            readOnly: true,
          }
        }))
      } catch { /* non-macOS, denied, or not in Tauri — silently no system events */ }
    })()
    return () => { cancelled = true }
  }, [viewDate])

  // Full-page mode: the titlebar's Import .ics button (App.jsx left zone) fires
  // this event; the mounted calendar opens its own hidden file picker.
  useEffect(() => {
    if (!fullHeight) return
    const fn = () => icsInputRef.current?.click()
    window.addEventListener('gnos:import-ics', fn)
    return () => window.removeEventListener('gnos:import-ics', fn)
  }, [fullHeight])

  // ── .ics import ──────────────────────────────────────────────────────────────
  function parseIcs(text) {
    const evts = []
    const blocks = text.split(/BEGIN:VEVENT/i).slice(1)
    for (const block of blocks) {
      try {
        const end = block.indexOf('END:VEVENT')
        const body = end > -1 ? block.slice(0, end) : block
        const get = key => {
          // Handle folded lines (RFC 5545: continuation lines start with space/tab)
          const unfolded = body.replace(/\r?\n[ \t]/g, '')
          const m = unfolded.match(new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, 'mi'))
          return m ? m[1].trim() : null
        }
        const summary = get('SUMMARY')?.replace(/\\,/g,',').replace(/\\n/g,' ').replace(/\\;/g,';') || 'Untitled'
        const dtstart = get('DTSTART') || ''
        const dtend   = get('DTEND') || ''

        // Parse DTSTART — DATE (YYYYMMDD) or DATETIME (YYYYMMDDTHHmmssZ)
        const parseIcsDate = (s) => {
          if (!s) return null
          const d = s.replace(/[TZ]/g,'')
          if (d.length >= 8) {
            const y=d.slice(0,4), mo=d.slice(4,6), day=d.slice(6,8)
            const h=d.slice(8,10)||'00', min=d.slice(10,12)||'00'
            return { dateKey:`${y}-${mo}-${day}`, time:`${h}:${min}`, isAllDay: s.length===8 }
          }
          return null
        }
        const start = parseIcsDate(dtstart)
        if (!start) continue

        const startObj = parseIcsDate(dtend)
        const color = EVENT_COLORS[0]
        evts.push({
          id: makeEvtId(),
          title: summary,
          date: start.dateKey,
          startTime: start.isAllDay ? null : start.time,
          endTime: startObj && !startObj.isAllDay ? startObj.time : null,
          allDay: start.isAllDay,
          color,
          source: 'ics',
          createdAt: new Date().toISOString(),
        })
      } catch { /* skip malformed blocks */ }
    }
    return evts
  }

  const handleIcsFile = async (file) => {
    if (!file) return
    setIcsImporting(true)
    setIcsResult(null)
    try {
      const text = await file.text()
      const parsed = parseIcs(text)
      if (!parsed.length) { setIcsResult({ added: 0, skipped: 0 }); setIcsImporting(false); return }
      // Deduplicate against existing events by title + date
      const existing = new Set(events.map(e => `${e.title}|${e.date}`))
      const fresh = parsed.filter(e => !existing.has(`${e.title}|${e.date}`))
      const skipped = parsed.length - fresh.length
      if (fresh.length) await persist([...events, ...fresh])
      setIcsResult({ added: fresh.length, skipped })
      setTimeout(() => setIcsResult(null), 4000)
    } catch (err) {
      console.warn('[Gnos] .ics import failed:', err)
      setIcsResult({ error: true })
      setTimeout(() => setIcsResult(null), 3000)
    }
    setIcsImporting(false)
  }

  const allEventsForDate = (dateKey) => {
    const appEvts = eventsForDateKey(dateKey, events)
    const nbEvts  = (notebookEvents[dateKey] || []).map((t,i) => ({
      id:`nb_${dateKey}_${i}`, title: typeof t==='string'?t:String(t),
      date:dateKey, color:'#6B7280', source:'notebook', allDay:true,
    }))
    const sysEvts = sysEvents.filter(e => e.date === dateKey)
    return [...appEvts, ...nbEvts, ...sysEvts]
  }

  const handleSave = async (form) => {
    const now = new Date().toISOString()
    if (!editingEvent?.event?.id) {
      await persist([...events, {...form, id:makeEvtId(), createdAt:now, source:'app'}])
    } else {
      await persist(events.map(e => e.id===editingEvent.event.id ? {...e,...form} : e))
    }
    setEditingEvent(null)
  }
  const handleDelete = async () => {
    if (editingEvent?.event?.id) await persist(events.filter(e=>e.id!==editingEvent.event.id))
    setEditingEvent(null)
  }

  const prev = () => { const d=new Date(viewDate); if(viewMode==='month')d.setMonth(d.getMonth()-1); else if(viewMode==='week')d.setDate(d.getDate()-7); else d.setDate(d.getDate()-1); setViewDate(d) }
  const next = () => { const d=new Date(viewDate); if(viewMode==='month')d.setMonth(d.getMonth()+1); else if(viewMode==='week')d.setDate(d.getDate()+7); else d.setDate(d.getDate()+1); setViewDate(d) }

  const headerLabel = viewMode==='month'
    ? viewDate.toLocaleDateString('en-US',{month:'long',year:'numeric'})
    : viewMode==='week'
    ? (()=>{ const sun=new Date(viewDate); sun.setDate(sun.getDate()-sun.getDay()); const sat=new Date(sun); sat.setDate(sat.getDate()+6); return `${sun.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sat.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}` })()
    : viewDate.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})

  // ── Month grid (always 5 weeks = 35 cells, overflow dates clickable) ──
  const MonthGrid = () => {
    const y=viewDate.getFullYear(), mo=viewDate.getMonth()
    const first=new Date(y,mo,1).getDay(), dim=new Date(y,mo+1,0).getDate()
    // Always render 35 cells (5 rows × 7)
    const CELLS = 35
    return (
      <div style={fullHeight?{flex:1,display:'flex',flexDirection:'column',minHeight:0}:{}}>
        {/* Day-of-week header */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0,marginBottom:4,flexShrink:0}}>
          {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>(
            <div key={d} style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textAlign:'center',padding:'4px 0 5px',textTransform:'uppercase',letterSpacing:'0.06em'}}>{d}</div>
          ))}
        </div>
        {/* 5-week grid — gap creates visible grid lines */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:1,
          background:'var(--border)',borderRadius:6,overflow:'hidden',
          ...(fullHeight?{flex:1,gridTemplateRows:'repeat(5,1fr)',minHeight:0}:{gridTemplateRows:'repeat(5,minmax(72px,auto))'})
        }}>
          {Array.from({length:CELLS},(_,i)=>{
            const dn=i-first+1
            const cell=new Date(y,mo,dn) // JS handles negative/overflow day nums
            const dk2=dkey(cell.getFullYear(),cell.getMonth(),cell.getDate())
            const inMonth=dn>=1&&dn<=dim
            const evts=allEventsForDate(dk2)
            const isToday=dk2===todayKey, isSel=selectedDay===dk2
            const handleClick=()=>{
              if(inMonth){
                setViewMode('day')
                setViewDate(new Date(cell.getFullYear(),cell.getMonth(),cell.getDate()))
              } else {
                setViewDate(new Date(cell.getFullYear(),cell.getMonth(),1))
              }
            }
            return (
              <div key={i} onClick={handleClick}
                style={{padding:'5px 5px 4px',cursor:'pointer',overflow:'hidden',
                  background:isSel?'color-mix(in srgb,var(--accent) 12%,var(--surface))':isToday?'color-mix(in srgb,var(--accent) 6%,var(--surface))':inMonth?'var(--surface)':'var(--surfaceAlt)',
                  outline:isSel?'2px solid var(--accent)':'none',outlineOffset:-1,
                  transition:'background 0.1s',opacity:inMonth?1:0.55,
                  ...(fullHeight?{minHeight:0}:{minHeight:72})}}>
                <div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:3,
                  background:isToday?'var(--accent)':'none',
                  fontSize:11,fontWeight:isToday?700:inMonth?500:400,
                  color:isToday?'#fff':inMonth?'var(--text)':'var(--textDim)'}}>
                  {cell.getDate()}
                </div>
                {evts.slice(0,3).map(ev=>(
                  <div key={ev.id} onClick={e=>{e.stopPropagation();!ev.readOnly&&ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}}
                    style={{fontSize:10,lineHeight:1.3,padding:'1px 4px 1px 5px',borderRadius:3,marginBottom:1,
                      ...eventChip(ev.color||'var(--accent)'),whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',
                      cursor:ev.source!=='notebook'?'pointer':'default',fontWeight:600}}>
                    {!ev.allDay&&ev.startTime&&<span style={{opacity:0.85}}>{ev.startTime} </span>}{ev.title}
                  </div>
                ))}
                {evts.length>3&&<div style={{fontSize:9,color:'var(--textDim)',padding:'0 2px'}}>+{evts.length-3}</div>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Time grid (week / day) ──
  const HOURS = Array.from({length: calendarEndHour - calendarStartHour}, (_,i) => i + calendarStartHour)

  const TimeGrid = ({ days, fullHeight: fh }) => {
    const gridRef  = useRef()
    const dragRef2 = useRef(null)
    const [localDrag, setLocalDrag] = useState(null)
    const [slotH, setSlotH]  = useState(52)  // px per hour, dynamic when fullHeight

    const HEADER_H = 28
    // When fullHeight, resize to fill container; otherwise fixed 52px slots
    useEffect(() => {
      if (!fh || !gridRef.current) return
      const obs = new ResizeObserver(entries => {
        const h = entries[0].contentRect.height
        const newH = Math.max(24, Math.floor((h - HEADER_H) / HOURS.length))
        setSlotH(newH)
      })
      obs.observe(gridRef.current)
      return () => obs.disconnect()
    }, [fh])

    // 15-minute slots derived from slotH
    const PX_PER_SLOT = slotH / 4
    const startSlot = calendarStartHour * 4
    const endSlot   = calendarEndHour * 4 - 1
    const getSlot = (clientY) => {
      const el = gridRef.current
      if (!el) return startSlot
      const rect = el.getBoundingClientRect()
      const relY = Math.max(0, clientY - rect.top + el.scrollTop - HEADER_H)
      return Math.max(startSlot, Math.min(endSlot, startSlot + Math.floor(relY / PX_PER_SLOT)))
    }
    const slotToTime = (slot) => `${fmt2(Math.floor(slot/4))}:${fmt2((slot%4)*15)}`

    const onPointerDown = (e, dateKey) => {
      if (e.button !== 0) return
      e.preventDefault()
      const s = getSlot(e.clientY)
      dragRef2.current = { dateKey, startH: s, endH: s }
      setLocalDrag({ ...dragRef2.current })
      const onMove = (ev) => {
        if (!dragRef2.current) return
        const s2 = getSlot(ev.clientY)
        dragRef2.current = { ...dragRef2.current, endH: s2 }
        setLocalDrag({ ...dragRef2.current })
      }
      const onUp = () => {
        if (dragRef2.current) {
          const { dateKey:dk3, startH, endH } = dragRef2.current
          const s=Math.min(startH,endH), en=Math.max(startH,endH)
          // +2 so ghost and saved time are consistent (match the ghost display of dE+1)
          const endSlotVal = Math.min(endSlot, en + 2)
          setEditingEvent({ event:{ date:dk3, allDay:false, startTime:slotToTime(s), endTime:slotToTime(endSlotVal) }, isNew:true })
        }
        dragRef2.current = null; setLocalDrag(null)
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }

    return (
      <div ref={gridRef} style={{...(fh?{flex:1,minHeight:0,overflow:'hidden'}:{maxHeight:440,overflowY:'auto'}),position:'relative',userSelect:'none'}}>
        <div style={{display:'grid',gridTemplateColumns:`44px repeat(${days.length},1fr)`}}>
          {/* Time label column */}
          <div>
            <div style={{height:28}}/>
            {HOURS.map(h=>(
              <div key={h} style={{height:slotH,display:'flex',alignItems:'flex-start',justifyContent:'flex-end',paddingRight:6,paddingTop:4}}>
                <span style={{fontSize:10,color:'var(--textDim)',fontVariantNumeric:'tabular-nums'}}>
                  {h===0?'12a':h<12?`${h}a`:h===12?'12p':`${h-12}p`}
                </span>
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map(({ dateKey, label, isToday }) => {
            const timedEvts = allEventsForDate(dateKey).filter(e => !e.allDay && e.startTime)
            const allDayEvts = allEventsForDate(dateKey).filter(e => e.allDay || !e.startTime)
            const isDrag = localDrag?.dateKey === dateKey
            const dS = isDrag ? Math.min(localDrag.startH, localDrag.endH) : 0
            const dE = isDrag ? Math.max(localDrag.startH, localDrag.endH)+1 : 0
            return (
              <div key={dateKey} style={{borderLeft:'1px solid var(--borderSubtle)',position:'relative'}}>
                {/* Day header — click to go to day view */}
                <div onClick={()=>{ setViewMode('day'); setViewDate(new Date(dateKey+'T00:00:00')) }}
                  style={{height:28,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,
                  color:isToday?'var(--accent)':'var(--textDim)',borderBottom:'1px solid var(--borderSubtle)',
                  position:'sticky',top:0,background:'var(--surface)',zIndex:5,cursor:'pointer',
                  transition:'background 0.1s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--surfaceAlt)'}
                  onMouseLeave={e=>e.currentTarget.style.background='var(--surface)'}>
                  {label}
                </div>
                {/* All-day strip */}
                {allDayEvts.length>0&&(
                  <div style={{padding:'2px 3px',borderBottom:'1px solid var(--borderSubtle)',minHeight:18}}>
                    {allDayEvts.slice(0,2).map(ev=>(
                      <div key={ev.id} onClick={()=>!ev.readOnly&&ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}
                        style={{fontSize:10,padding:'1px 4px 1px 5px',borderRadius:3,marginBottom:1,...eventChip(ev.color||'var(--accent)'),fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}}>
                        {ev.title}
                      </div>
                    ))}
                    {allDayEvts.length>2&&<div style={{fontSize:9,color:'var(--textDim)'}}>+{allDayEvts.length-2}</div>}
                  </div>
                )}
                {/* Hour slots — 52px/hr, 15-min grid lines at 13px */}
                <div style={{position:'relative'}} onPointerDown={e=>onPointerDown(e,dateKey)}>
                  {HOURS.map(h=>(
                    <div key={h} style={{height:slotH,position:'relative',borderBottom:'1px solid color-mix(in srgb,var(--border) 55%,transparent)'}}>
                      <div style={{position:'absolute',top:'25%',left:0,right:0,height:'1px',background:'color-mix(in srgb,var(--border) 25%,transparent)'}}/>
                      <div style={{position:'absolute',top:'50%',left:0,right:0,height:'1px',background:'color-mix(in srgb,var(--border) 35%,transparent)'}}/>
                      <div style={{position:'absolute',top:'75%',left:0,right:0,height:'1px',background:'color-mix(in srgb,var(--border) 25%,transparent)'}}/>
                    </div>
                  ))}
                  {/* Drag ghost */}
                  {isDrag&&(
                    <div style={{position:'absolute',top:(dS-startSlot)*PX_PER_SLOT,height:Math.max(PX_PER_SLOT,(dE-dS+1)*PX_PER_SLOT),left:2,right:2,borderRadius:5,
                      background:'color-mix(in srgb,var(--accent) 22%,transparent)',border:'1px solid var(--accent)',pointerEvents:'none',zIndex:3}}>
                      <div style={{fontSize:10,color:'var(--accent)',padding:'2px 5px',fontWeight:600,lineHeight:1.3}}>{slotToTime(dS)} – {slotToTime(Math.min(endSlot,dE+1))}</div>
                    </div>
                  )}
                  {/* Timed events */}
                  {timedEvts.map(ev=>{
                    const [sh,sm]=(ev.startTime||'0:00').split(':').map(Number)
                    const [eh,em]=(ev.endTime||ev.startTime||'1:00').split(':').map(Number)
                    const topPx=(sh-calendarStartHour)*slotH+(sm/60)*slotH
                    const htPx=Math.max(22,(eh+em/60-sh-sm/60)*slotH)
                    const openMapsEv = (e) => {
                      e.stopPropagation()
                      const q = encodeURIComponent(ev.location)
                      import('@tauri-apps/api/core').then(({invoke})=>invoke('plugin:shell|open',{path:`maps://?daddr=${q}`})).catch(()=>{})
                    }
                    return (
                      <div key={ev.id}
                        onPointerDown={e=>e.stopPropagation()}
                        onClick={e=>{e.stopPropagation();!ev.readOnly&&ev.source!=='notebook'&&setEditingEvent({event:ev,isNew:false})}}
                        style={{position:'absolute',top:topPx,left:2,right:2,height:htPx,
                          background:`color-mix(in srgb,${ev.color||'var(--accent)'} 20%,var(--surface))`,
                          borderRadius:5,padding:'3px 5px 3px 6px',cursor:'pointer',overflow:'hidden',zIndex:2,
                          border:`1px solid color-mix(in srgb,${ev.color||'var(--accent)'} 40%,transparent)`,
                          borderLeftWidth:3,borderLeftColor:ev.color||'var(--accent)'}}>
                        <div style={{fontSize:10,fontWeight:600,color:`color-mix(in srgb,${ev.color||'var(--accent)'} 62%,var(--text))`,lineHeight:1.2}}>{ev.title}</div>
                        {ev.location&&<div onClick={openMapsEv} style={{fontSize:9,color:'var(--textDim)',cursor:'pointer',textDecoration:'underline',textDecorationColor:'var(--border)'}}>📍{ev.location}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const getWeekDays = () => {
    const start = new Date(viewDate)
    const dayOfWeek = start.getDay()
    const diff = (dayOfWeek - calendarWeekStart + 7) % 7
    start.setDate(start.getDate() - diff)
    return Array.from({length:7},(_,i)=>{ const d=new Date(start); d.setDate(d.getDate()+i); return { dateKey:dkey(d.getFullYear(),d.getMonth(),d.getDate()), label:d.toLocaleDateString('en-US',{weekday:'short',day:'numeric'}), isToday:d.toDateString()===today.toDateString() } })
  }

  return (
    <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:12,marginBottom:fullHeight?0:8,
      position:'relative',overflow:'hidden',
      ...(fullHeight?{flex:1,display:'flex',flexDirection:'column',minHeight:0}:{})}}>

      {/* Hidden .ics file input */}
      <input ref={icsInputRef} type="file" accept=".ics,text/calendar" style={{display:'none'}}
        onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; if(f) handleIcsFile(f) }} />

      {/* Toolbar — inline when embedded, portaled into the global header when full-page */}
      {(() => {
        const icsToast = icsResult && (
          <div style={{fontSize:11,fontWeight:600,color:icsResult.error?'#f85149':'var(--text)',
            background:icsResult.error?'rgba(248,81,73,0.1)':'var(--surfaceAlt)',
            border:`1px solid ${icsResult.error?'rgba(248,81,73,0.3)':'var(--border)'}`,
            borderRadius:7,padding:'0 10px',height:28,display:'flex',alignItems:'center',gap:5,whiteSpace:'nowrap'}}>
            {icsResult.error
              ? <><AlertTriangle size={11} strokeWidth={2} />Import failed</>
              : icsResult.added === 0
                ? <><Check size={11} strokeWidth={2} />No new events</>
                : <><Check size={11} strokeWidth={2} />{`${icsResult.added} event${icsResult.added!==1?'s':''} imported${icsResult.skipped?` · ${icsResult.skipped} skipped`:''}`}</>}
          </div>
        )
        const navControls = (
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <button onClick={prev} style={{width:28,height:28,borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--text)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,lineHeight:1}}>‹</button>
          <button onClick={next} style={{width:28,height:28,borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--text)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,lineHeight:1}}>›</button>
          <button onClick={()=>setViewDate(new Date())} style={{height:28,padding:'0 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer'}}>Today</button>
          <button onClick={()=>setShowMonthPicker(v=>!v)}
            style={{height:28,padding:'0 10px',borderRadius:7,border:'1px solid var(--border)',background:showMonthPicker?'var(--accent)':'none',color:showMonthPicker?'#fff':'var(--text)',fontSize:13,fontWeight:700,cursor:'pointer',transition:'background 0.12s,color 0.12s',marginLeft:2,display:'flex',alignItems:'center',gap:4}}>
            {headerLabel}
            <ChevronDown size={10} strokeWidth={1.5} style={{opacity:0.6,transition:'transform 0.15s',transform:showMonthPicker?'rotate(180deg)':'none'}} />
          </button>
        </div>
        )
        const actionControls = (
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          {/* .ics toast rides here when embedded; full-page shows it by the date nav */}
          {!fullHeight && icsToast}
          {/* Import Calendar (.ics) button — full-page uses the titlebar button instead */}
          {!fullHeight && <button
            onClick={()=>icsInputRef.current?.click()}
            disabled={icsImporting}
            title="Import calendar events from a .ics file (iCalendar — exported from Apple Calendar, Google Calendar, Outlook, etc.)"
            style={{height:28,padding:'0 10px',borderRadius:7,border:'1px solid var(--border)',background:'var(--surfaceAlt)',
              color:'var(--textDim)',fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,
              opacity:icsImporting?0.5:1,transition:'background 0.12s,color 0.12s,border-color 0.12s'}}
            onMouseEnter={e=>{if(!icsImporting){e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--text)'}}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--textDim)'}}>
            <CalendarArrowDown size={13} strokeWidth={1.4} />
            {icsImporting ? 'Importing…' : 'Import .ics'}
          </button>}
          <button onClick={()=>setEditingEvent({event:{date:todayKey},isNew:true})}
            title="New event"
            style={{height:28,padding:fullHeight?'0 8px':'0 12px',borderRadius:7,
              border:'1px solid var(--border)',background:'var(--surfaceAlt)',color:'var(--text)',
              fontSize:11,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:5,
              transition:'background 0.12s,border-color 0.12s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)'}}>
            <Plus size={12} strokeWidth={1.7} color="var(--accent)" />
            {fullHeight ? null : 'Event'}
          </button>
          <SegmentedControl
            options={[{value:'month',label:'Month'},{value:'week',label:'Week'},{value:'day',label:'Day'}]}
            value={viewMode} onChange={setViewMode} />
        </div>
        )
        return fullHeight ? (
          <>
            {/* Date nav stays with the grid; actions ride the global header */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'flex-start',marginBottom:10,gap:8,flexShrink:0}}>
              {navControls}
              {icsToast}
            </div>
            <QuickAccess>{actionControls}</QuickAccess>
          </>
        ) : (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:6,flexShrink:0}}>
            {navControls}
            {actionControls}
          </div>
        )
      })()}
      {/* Month/year picker dropdown */}
      {showMonthPicker&&(
        <MonthYearPicker
          viewDate={viewDate}
          onSelect={(y,m)=>{ setViewDate(new Date(y,m,1)); setShowMonthPicker(false) }}
          onClose={()=>setShowMonthPicker(false)}
        />
      )}
      {viewMode==='month'&&<div style={fullHeight?{flex:1,display:'flex',flexDirection:'column',minHeight:0}:{}}><MonthGrid/></div>}
      {viewMode==='week'&&<TimeGrid days={getWeekDays()} fullHeight={fullHeight}/>}
      {viewMode==='day'&&<TimeGrid days={[{dateKey:dkey(viewDate.getFullYear(),viewDate.getMonth(),viewDate.getDate()),label:viewDate.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}),isToday:viewDate.toDateString()===today.toDateString()}]} fullHeight={fullHeight}/>}
      {editingEvent&&<EventModal event={editingEvent.event} onSave={handleSave} onDelete={handleDelete} onClose={()=>setEditingEvent(null)}/>}
    </div>
  )
}
