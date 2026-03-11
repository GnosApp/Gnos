// Simple toast notification — matches the original .toast CSS class

export default function Toast({ message, error }) {
  if (!message) return null
  return (
    <div className={`toast${error ? ' error' : ''}`} style={{ zIndex: 9999 }}>
      {!error && <div className="spinner" />}
      {message}
    </div>
  )
}