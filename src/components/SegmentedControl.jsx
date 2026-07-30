/**
 * SegmentedControl — shared pill-group switcher used across views
 * (graph tab switcher, calendar month/week/day, etc.).
 * options: [{ value, label?, icon? }] — icon is a React node (14px svg);
 * icon-only options use label as the tooltip. size: 'sm' (24px) | 'md' (28px)
 */
export default function SegmentedControl({ options, value, onChange, size = 'sm' }) {
  const h = size === 'md' ? 28 : 24
  return (
    <div style={{ display: 'flex', gap: 3, background: 'var(--surfaceAlt)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, flexShrink: 0 }}>
      {options.map(o => {
        const active = o.value === value
        const iconOnly = o.icon && !o.showLabel
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            title={o.label}
            style={{
              height: h, padding: iconOnly ? '0 8px' : '0 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 5,
              background: active ? 'var(--surface)' : 'none',
              color: active ? 'var(--text)' : 'var(--textDim)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}>
            {o.icon}
            {iconOnly ? null : o.label}
          </button>
        )
      })}
    </div>
  )
}
