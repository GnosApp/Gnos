// Shared audio element that persists across AudioPlayerView mounts/unmounts.
// This lets a mini-player continue playback when the user navigates away.

let _audio = null

export function getGlobalAudio() {
  if (!_audio) _audio = new Audio()
  return _audio
}
