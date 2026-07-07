import { useEffect, useMemo, useState } from 'react'
import { loadReadingLog } from '@/lib/storage'

// ─────────────────────────────────────────────────────────────────────────────
// ProfileContent — the shared Stats + Review tab bodies used by both the in-app
// ProfileModal (LibraryView) and the standalone profile window (ProfileWindowView).
// Self-loads the reading log and computes every stat from the `library` /
// `notebooks` props. Renders the body for the requested `tab` ('stats' | 'review')
// and null for anything else, so the modal can keep owning Calendar/Habits.
// ─────────────────────────────────────────────────────────────────────────────

export function ProfileStatCard({ value, label }) {
  return (
    <div style={{ textAlign:'center', padding:'10px 6px' }}>
      <div style={{ fontSize:28, fontWeight:800, color:'var(--text)', lineHeight:1, letterSpacing:'-0.02em', fontVariantNumeric:'tabular-nums' }}>{value}</div>
      <div style={{ fontSize:10, color:'var(--textDim)', marginTop:5, textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:600, opacity:0.7 }}>{label}</div>
    </div>
  )
}

export default function ProfileContent({ tab = 'stats', library = [], notebooks = [] }) {
  const [log, setLog] = useState({})
  const [reviewPeriod, setReviewPeriod] = useState('week')

  useEffect(() => { loadReadingLog().then(setLog).catch(() => setLog({})) }, [])

  const today = new Date().toISOString().slice(0, 10)

  const { totalMinutes, avgDaily, todayMins, streak, booksFinished, heatmapDays } = useMemo(() => {
    const total = Object.values(log).reduce((a, b) => a + b, 0)
    const days  = Object.keys(log).length
    const tMins = Math.round(log[today] || 0)
    let s = 0
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = d.toISOString().slice(0, 10)
      if ((log[k] || 0) >= 1) s++; else break
    }
    const finished = library.filter(b => (b.currentChapter || 0) >= Math.max((b.totalChapters || 1) - 1, 1)).length
    const heat = []
    for (let i = 83; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const k = d.toISOString().slice(0, 10)
      const m = log[k] || 0
      const level = m === 0 ? 0 : m < 10 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4
      heat.push({ k, m, level })
    }
    return { totalMinutes: total, avgDaily: days > 0 ? total / days : 0, todayMins: tMins, streak: s, booksFinished: finished, heatmapDays: heat }
  }, [log, library, today])

  const topBooks = useMemo(() =>
    library.map(b => ({ ...b, chaptersRead: b.currentChapter || 0 })).sort((a,b)=>b.chaptersRead-a.chaptersRead).slice(0,5),
    [library]
  )

  const reviewStats = useMemo(() => {
    const days = reviewPeriod==='week'?7:reviewPeriod==='month'?30:365
    const dateKeys = []
    for (let i=days-1;i>=0;i--) { const d=new Date();d.setDate(d.getDate()-i);dateKeys.push(d.toISOString().slice(0,10)) }
    const minutes = dateKeys.reduce((s,k)=>s+(log[k]||0),0)
    const daysActive = dateKeys.filter(k=>(log[k]||0)>=1).length
    const notesCreated = notebooks.filter(n=>{ const d=n.createdAt?.slice(0,10); return d&&d>=dateKeys[0]&&d<=dateKeys[dateKeys.length-1] }).length
    let streak2=0; for(let i=dateKeys.length-1;i>=0;i--){if((log[dateKeys[i]]||0)>=1)streak2++;else break}
    const booksFinishedInPeriod = library.filter(b=>{ const f=(b.currentChapter||0)>=Math.max((b.totalChapters||1)-1,1); return f&&b.updatedAt&&b.updatedAt.slice(0,10)>=dateKeys[0] }).length
    const bars = dateKeys.map(k=>({k,m:Math.round(log[k]||0)}))
    const maxM = Math.max(...bars.map(b=>b.m),1)
    return { minutes:Math.round(minutes),daysActive,notesCreated,streak:streak2,booksFinishedInPeriod,bars,maxM }
  }, [log,notebooks,library,reviewPeriod])

  const heatAlpha = ['0','0.22','0.45','0.7','1']

  if (tab === 'review') {
    return (
      <div>
        <div style={{display:'inline-flex',alignItems:'center',marginBottom:20,background:'var(--surfaceAlt)',border:'1px solid var(--border)',borderRadius:9,padding:3,boxShadow:'inset 0 1px 2px rgba(0,0,0,0.15)'}}>
          {[['week','Week'],['month','Month'],['year','Year']].map(([p,l])=>(
            <button key={p} onClick={()=>setReviewPeriod(p)} style={{height:24,padding:'0 12px',fontSize:11,fontWeight:600,borderRadius:6,border:'none',cursor:'pointer',fontFamily:'inherit',background:reviewPeriod===p?'var(--accent)':'none',color:reviewPeriod===p?'#fff':'var(--textDim)',transition:'all 0.15s'}}>{l}</button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:0,marginBottom:8,borderBottom:'1px solid var(--borderSubtle)',paddingBottom:8}}>
          <ProfileStatCard value={reviewStats.minutes} label="Min Studied"/>
          <ProfileStatCard value={reviewStats.daysActive} label="Days Active"/>
          <ProfileStatCard value={reviewStats.streak} label="Streak"/>
          <ProfileStatCard value={reviewStats.notesCreated} label="Notes Created"/>
          <ProfileStatCard value={reviewStats.booksFinishedInPeriod} label="Books Finished"/>
          <ProfileStatCard value={`${Math.round(reviewStats.minutes/60*10)/10}h`} label="Hours"/>
        </div>
        <div style={{fontSize:11,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:10}}>
          Daily Activity — {reviewPeriod==='week'?'Last 7 Days':reviewPeriod==='month'?'Last 30 Days':'Last 365 Days'}
        </div>
        <div style={{position:'relative',display:'flex',alignItems:'flex-end',gap:reviewPeriod==='year'?1:3,height:120,marginBottom:16}}>
          {reviewStats.bars.map((bar,i)=>(
            <div key={i} title={`${bar.k}: ${bar.m} min`} style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
              <div style={{height:bar.m===0?2:Math.max(4,Math.round((bar.m/reviewStats.maxM)*116)),borderRadius:2,background:bar.m===0?'var(--surfaceAlt)':'var(--accent)',opacity:bar.m===0?0.4:1,transition:'height 0.2s'}}/>
            </div>
          ))}
          {(()=>{
            const vals=reviewStats.bars.map(b=>b.m); const n=vals.length; if(n<2)return null
            const sX=vals.reduce((s,_,i)=>s+i,0),sY=vals.reduce((s,v)=>s+v,0),sXY=vals.reduce((s,v,i)=>s+i*v,0),sX2=vals.reduce((s,_,i)=>s+i*i,0)
            const den=n*sX2-sX*sX,slope=den?(n*sXY-sX*sY)/den:0,intercept=(sY-slope*sX)/n
            const pts=vals.map((_,i)=>`${(i/(n-1))*100},${120-(Math.min(Math.max(slope*i+intercept,0),reviewStats.maxM)/reviewStats.maxM)*116}`).join(' ')
            return (<svg viewBox="0 0 100 120" preserveAspectRatio="none" style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',overflow:'visible'}}><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.55" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/></svg>)
          })()}
        </div>
        {reviewPeriod!=='year'&&(<div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'var(--textDim)',opacity:0.6,marginBottom:4}}><span>{reviewStats.bars[0]?.k.slice(5)}</span><span>{reviewStats.bars[reviewStats.bars.length-1]?.k.slice(5)}</span></div>)}
      </div>
    )
  }

  if (tab === 'stats') {
    return (<>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:0,marginBottom:8,borderBottom:'1px solid var(--borderSubtle)',paddingBottom:8}}>
        <ProfileStatCard value={streak}                                   label="Day Streak"/>
        <ProfileStatCard value={Math.round(avgDaily)}                     label="Avg Min/Day"/>
        <ProfileStatCard value={todayMins}                                label="Today (min)"/>
        <ProfileStatCard value={booksFinished}                            label="Finished"/>
        <ProfileStatCard value={Math.round(totalMinutes)}                 label="Total Min"/>
        <ProfileStatCard value={`${Math.round(totalMinutes/60*10)/10}h`} label="Total Hours"/>
      </div>
      <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.09em',marginBottom:8,marginTop:4,opacity:0.6}}>Activity — Last 12 Weeks</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(12,1fr)',gridTemplateRows:'repeat(7,1fr)',gridAutoFlow:'column',gap:3,marginBottom:10}}>
        {heatmapDays.map((d,i)=>(
          <div key={i} title={`${d.k}: ${Math.round(d.m)} min`} style={{height:10,borderRadius:2,background:d.level===0?'var(--surfaceAlt)':`color-mix(in srgb, var(--accent) ${Math.round(parseFloat(heatAlpha[d.level])*100)}%, transparent)`,border:d.level===0?'1px solid var(--borderSubtle)':'none'}}/>
        ))}
      </div>
      {/* Heatmap legend */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4,marginTop:4,marginBottom:6}}>
        <span style={{fontSize:9,color:'var(--textDim)',opacity:0.6}}>Less</span>
        {[0,1,2,3,4].map(l=>(
          <div key={l} style={{width:10,height:10,borderRadius:2,
            background:l===0?'var(--surfaceAlt)':`color-mix(in srgb, var(--accent) ${Math.round(parseFloat(heatAlpha[l])*100)}%, transparent)`,
            border:l===0?'1px solid var(--borderSubtle)':'none'}}/>
        ))}
        <span style={{fontSize:9,color:'var(--textDim)',opacity:0.6}}>More</span>
      </div>
      {topBooks.length > 0 && (<>
        <div style={{fontSize:10,fontWeight:700,color:'var(--textDim)',textTransform:'uppercase',letterSpacing:'0.09em',marginBottom:10,marginTop:4,opacity:0.6}}>Top Books by Progress</div>
        {topBooks.map((b,i)=>{
          const progressPct = b.totalChapters > 1 ? Math.round(((b.currentChapter||0)/(b.totalChapters-1))*100) : 0
          return (
            <div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0',borderTop:i>0?'1px solid var(--borderSubtle)':'none'}}>
              <div style={{width:24,height:24,borderRadius:4,background:b.coverDataUrl?'none':'var(--surfaceAlt)',flexShrink:0,overflow:'hidden'}}>
                {b.coverDataUrl?<img src={b.coverDataUrl} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--textDim)'}}>{i+1}</div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</div>
                <div style={{fontSize:10,color:'var(--textDim)'}}>{b.author||'Unknown'}</div>
              </div>
              <div style={{width:60,flexShrink:0}}>
                <div style={{height:4,background:'var(--surfaceAlt)',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${progressPct}%`,background:'var(--accent)',borderRadius:2}}/>
                </div>
                <div style={{fontSize:9,color:'var(--textDim)',textAlign:'right',marginTop:2}}>{progressPct}%</div>
              </div>
            </div>
          )
        })}
      </>)}
    </>)
  }

  return null
}
