// Time values are seconds. Callers must pass metadata duration, not a guess.
export function validateTrim(start, end, duration) {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0) throw new RangeError('Invalid media duration or trim bounds');
  if (start < 0 || end > duration || start >= end) throw new RangeError('Trim selection must lie within the clip and have positive duration');
  return { start, end, duration: end - start };
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

// Restore a selection only when it remains valid for the loaded clip.
export function restoredSelection(duration, previous) {
  if (previous) {
    try { validateTrim(previous.start, previous.end, duration); return { start: previous.start, end: previous.end }; } catch {}
  }
  return { start: 0, end: duration };
}
