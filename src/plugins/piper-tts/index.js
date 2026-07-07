/**
 * Piper TTS — bundled Gnos plugin.
 * Registers a TTSProvider that uses the bundled Piper binary via Tauri.
 */

import manifest from './manifest.json'

let _api = null
let _audioEl = null
let _voices  = []

async function getVoices() {
  try {
    _voices = await _api.invoke('piper_list_voices')
    return _voices
  } catch {
    return []
  }
}

async function speak(text, voice, rate) {
  stop()
  const wavPath = await _api.invoke('piper_speak', { text, voice, speed: rate })
  return new Promise((resolve, reject) => {
    const { convertFileSrc } = window.__TAURI_INTERNALS__
      ? { convertFileSrc: (p) => window.__TAURI_INTERNALS__.convertFileSrc(p) }
      : { convertFileSrc: (p) => p }
    // Use dynamic import to get convertFileSrc cleanly
    import('@tauri-apps/api/core').then(({ convertFileSrc: cfs }) => {
      _audioEl = new Audio(cfs(wavPath))
      _audioEl.playbackRate = 1 // Piper controls rate via --length_scale
      _audioEl.onended  = () => { _audioEl = null; resolve() }
      _audioEl.onerror  = () => { _audioEl = null; reject(new Error('Piper audio error')) }
      _audioEl.play().catch(reject)
    })
  })
}

function stop() {
  if (_audioEl) { _audioEl.pause(); _audioEl.src = ''; _audioEl = null }
}

function pause() {
  if (_audioEl && !_audioEl.paused) _audioEl.pause()
}

function resume() {
  if (_audioEl && _audioEl.paused) _audioEl.play().catch(() => {})
}

export default {
  manifest,

  async onLoad(api) {
    _api = api

    // Install bundled binary/voices on first run (idempotent)
    try { await api.invoke('piper_install_bundled') } catch { /* not critical */ }

    const voices = await getVoices()
    if (voices.length === 0) {
      // No voices available — don't register as provider
      console.info('[piper-tts] No voices found, TTS provider not registered.')
      return
    }

    api.tts.registerProvider({
      id:         'piper',
      name:       'Piper TTS',
      getVoices,
      speak,
      stop,
      pause,
      resume,
    })

    console.info(`[piper-tts] Loaded with voices: ${voices.join(', ')}`)
  },

  onUnload() {
    stop()
    _api = null
  },
}
