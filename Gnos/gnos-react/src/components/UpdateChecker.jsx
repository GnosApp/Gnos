import { useEffect, useState, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo]   = useState(null)  // { version, current_version, body }
  const [phase, setPhase]             = useState('idle') // idle | downloading | done | error
  const [downloaded, setDownloaded]   = useState(0)
  const [total, setTotal]             = useState(null)
  const [errorMsg, setErrorMsg]       = useState('')
  const unlisten = useRef(null)

  // Check for updates ~3 seconds after launch so it doesn't block startup
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const info = await invoke('check_for_updates')
        if (info) setUpdateInfo(info)
      } catch {
        // silently ignore — update server may not be configured yet
      }
    }, 3000)
    return () => clearTimeout(t)
  }, [])

  function dismiss() {
    setUpdateInfo(null)
    setPhase('idle')
    setDownloaded(0)
    setTotal(null)
    setErrorMsg('')
    if (unlisten.current) { unlisten.current(); unlisten.current = null }
  }

  async function startUpdate() {
    setPhase('downloading')
    setDownloaded(0)
    setTotal(null)

    unlisten.current = await listen('update-download-progress', ({ payload }) => {
      setDownloaded(d => d + (payload.chunk ?? 0))
      if (payload.total != null) setTotal(payload.total)
    })

    try {
      await invoke('download_and_install_update')
      // App will restart — if we somehow get here, show done
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setErrorMsg(String(e))
      if (unlisten.current) { unlisten.current(); unlisten.current = null }
    }
  }

  if (!updateInfo) return null

  const percent = total && downloaded ? Math.min(100, Math.round((downloaded / total) * 100)) : null

  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 99999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '16px 18px', width: 300,
      boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>
          Update available
        </span>
        {phase === 'idle' && (
          <button
            onClick={dismiss}
            style={{ background: 'none', border: 'none', color: 'var(--textDim)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}
          >×</button>
        )}
      </div>

      {/* Version line */}
      <div style={{ fontSize: 12, color: 'var(--textDim)' }}>
        v{updateInfo.current_version} → <strong style={{ color: 'var(--accent)' }}>v{updateInfo.version}</strong>
      </div>

      {/* Release notes (trimmed) */}
      {updateInfo.body && (
        <div style={{
          fontSize: 11, color: 'var(--textDim)', lineHeight: 1.5,
          maxHeight: 72, overflowY: 'auto',
          borderTop: '1px solid var(--borderSubtle)', paddingTop: 8,
        }}>
          {updateInfo.body}
        </div>
      )}

      {/* Progress bar */}
      {phase === 'downloading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ height: 4, borderRadius: 4, background: 'var(--borderSubtle)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4,
              background: 'var(--accent)',
              width: percent != null ? `${percent}%` : '40%',
              transition: percent != null ? 'width 0.2s ease' : undefined,
              animation: percent == null ? 'gnos-update-indeterminate 1.2s ease-in-out infinite' : undefined,
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--textDim)', textAlign: 'right' }}>
            {percent != null ? `${percent}%` : 'Downloading…'}
          </span>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div style={{ fontSize: 11, color: '#f85149', borderTop: '1px solid var(--borderSubtle)', paddingTop: 6 }}>
          {errorMsg}
        </div>
      )}

      {/* Actions */}
      {phase === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: '6px 0', border: '1px solid var(--border)',
              borderRadius: 6, background: 'none', color: 'var(--textDim)',
              cursor: 'pointer', fontSize: 12, fontWeight: 500,
            }}
          >
            Later
          </button>
          <button
            onClick={startUpdate}
            style={{
              flex: 1, padding: '6px 0', border: 'none',
              borderRadius: 6, background: 'var(--accent)', color: '#fff',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            Update & Restart
          </button>
        </div>
      )}

      {phase === 'error' && (
        <button
          onClick={dismiss}
          style={{
            padding: '6px 0', border: '1px solid var(--border)',
            borderRadius: 6, background: 'none', color: 'var(--textDim)',
            cursor: 'pointer', fontSize: 12,
          }}
        >
          Dismiss
        </button>
      )}

      <style>{`
        @keyframes gnos-update-indeterminate {
          0%   { transform: translateX(-100%); width: 40%; }
          100% { transform: translateX(350%);  width: 40%; }
        }
      `}</style>
    </div>
  )
}
