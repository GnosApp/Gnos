import { FullCalendar } from '@/components/Calendar'

export default function CalendarView() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px 20px 16px' }}>
      <FullCalendar fullHeight />
    </div>
  )
}
