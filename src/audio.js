// One shared AudioContext for the editor. iOS ignores media element volume, so preview levels go through
// Web Audio gains. While the microphone is open iOS switches to a voice-call style audio session (quieter,
// echo-cancelled, dull); a context created or kept across that stays in it. So the camera releases the
// context, and the editor creates a fresh one in "playback" mode (Safari 16.4+ Audio Session API).
let context;
export function audioContext() {
  if (!context) {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    context = new AudioContext();
  }
  return context;
}
// Call inside a user gesture: browsers start the context suspended.
export function resumeAudio() {
  const ctx = audioContext();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}
// Before the camera opens the microphone.
export function releaseAudio() {
  context?.close().catch(() => {});
  context = null;
  if (navigator.audioSession) navigator.audioSession.type = 'auto';
}

// Duration and a coarse waveform for the music picker.
export async function readMusic(blob, bars = 96) {
  const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const data = buffer.getChannelData(0), size = Math.max(1, Math.floor(data.length / bars)), peaks = [];
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = i * size, end = Math.min(data.length, j + size); j < end; j += 16) peak = Math.max(peak, Math.abs(data[j]));
    peaks.push(peak);
  }
  const max = Math.max(...peaks) || 1;
  return { duration: buffer.duration, peaks: peaks.map(p => p / max) };
}
