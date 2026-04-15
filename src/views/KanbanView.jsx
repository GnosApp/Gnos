import { KanbanBoard } from './LibraryView'

export default function KanbanView() {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px 32px', background: 'var(--bg)' }}>
      <KanbanBoard />
    </div>
  )
}
