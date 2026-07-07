// Shared form controls — the ONE place toggles, sliders and selects are defined.
// Styling lives in global.css under .gnos-toggle / .gnos-slider / .gnos-select.

export function Toggle({ on, onChange, disabled, title }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!on}
      disabled={disabled}
      title={title}
      className={`gnos-toggle${on ? ' on' : ''}`}
      onClick={() => { if (!disabled) onChange?.(!on) }}
    >
      <span className="gnos-toggle-knob" />
    </button>
  )
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, onCommit, disabled, style, className, title }) {
  const num = v => (typeof v === 'number' ? v : parseFloat(v))
  const pct = Math.max(0, Math.min(100, ((num(value) - num(min)) / (num(max) - num(min))) * 100))
  return (
    <input
      type="range"
      className={`gnos-slider${className ? ' ' + className : ''}`}
      min={min} max={max} step={step} value={value}
      disabled={disabled}
      title={title}
      onChange={e => onChange?.(+e.target.value)}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      style={{ '--fill': `${pct}%`, ...style }}
    />
  )
}

export function Select({ value, onChange, options, children, disabled, style, className, title }) {
  return (
    <select
      className={`gnos-select${className ? ' ' + className : ''}`}
      value={value}
      disabled={disabled}
      title={title}
      onChange={e => onChange?.(e.target.value)}
      style={style}
    >
      {options
        ? options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)
        : children}
    </select>
  )
}
