import useAppStore from '@/store/useAppStore'
import { GnosNavButton } from '@/components/SideNav'
import { FullCalendar } from './LibraryView'

export default function CalendarView() {
  const goBack = useAppStore(s => s.goBack)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px 8px', borderBottom: '1px solid var(--borderSubtle)', flexShrink: 0 }}>
        <GnosNavButton />
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Calendar</span>
      </div>
      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px 24px' }}>
        <FullCalendar />
      </div>
    </div>
  )
}
