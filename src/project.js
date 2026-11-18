// Non-destructive timeline: source media are managed separately and never mutated.
import { validateTrim } from './trim.js';

export const SPEEDS = [0.5, 1, 2, 3];
const copy = state => ({ segments: state.segments.map(segment => ({ ...segment })), activeId: state.activeId, audio: { ...state.audio } });
export const DEFAULT_AUDIO = Object.freeze({ musicId: null, musicStart: 0, original: 1, music: 1 });
export function createProject() { return { segments: [], activeId: null, audio: { ...DEFAULT_AUDIO }, history: [] }; }
function edit(project, fn) {
  const next = copy(project);
  fn(next);
  return { ...next, history: [...project.history, copy(project)] };
}
function indexOf(state, id) {
  const index = state.segments.findIndex(segment => segment.id === id);
  if (index < 0) throw new RangeError('Unknown segment');
  return index;
}
function validateSpeed(speed) {
  if (!SPEEDS.includes(speed)) throw new RangeError('Invalid speed');
}
// look: id; strength: 0–1; exposure: −1…1, shifts mid-grey for looks with a contrast curve.
function validateLook({ look, strength, exposure }) {
  if (typeof look !== 'string' || !look || !(strength >= 0 && strength <= 1) || !(exposure >= -1 && exposure <= 1)) throw new RangeError('Invalid look');
}
// Film seconds a segment occupies after its speed is applied.
export const segmentLength = segment => (segment.end - segment.start) / segment.speed;
export const filmLength = project => project.segments.reduce((total, segment) => total + segmentLength(segment), 0);
export function addSegment(project, segment) {
  const { id, sourceId, duration, start = 0, end = duration, speed = 1, look = 'normal', strength = 1, exposure = 0 } = segment;
  if (typeof id !== 'string' || !id || typeof sourceId !== 'string' || !sourceId || project.segments.some(s => s.id === id)) throw new RangeError('Invalid or duplicate segment ID');
  validateTrim(start, end, duration);
  validateSpeed(speed);
  validateLook({ look, strength, exposure });
  return edit(project, next => { next.segments.push({ id, sourceId, duration, start, end, speed, look, strength, exposure }); next.activeId = id; });
}
export function trimSegment(project, id, start, end) {
  const segment = project.segments[indexOf(project, id)];
  validateTrim(start, end, segment.duration);
  return edit(project, next => Object.assign(next.segments[indexOf(next, id)], { start, end }));
}
export function setSpeed(project, id, speed) {
  indexOf(project, id);
  validateSpeed(speed);
  return edit(project, next => { next.segments[indexOf(next, id)].speed = speed; });
}
// ids: the segments to change; pass every id to apply a look to the whole film.
export function setLook(project, ids, { look, strength = 1, exposure = 0 }) {
  ids.forEach(id => indexOf(project, id));
  validateLook({ look, strength, exposure });
  return edit(project, next => { for (const id of ids) Object.assign(next.segments[indexOf(next, id)], { look, strength, exposure }); });
}
// Music choice and the balance between recorded sound and music, both 0–1.
export function setAudio(project, patch) {
  const audio = { ...project.audio, ...patch };
  if ((audio.musicId !== null && (typeof audio.musicId !== 'string' || !audio.musicId)) || !(audio.musicStart >= 0) || !(audio.original >= 0 && audio.original <= 1) || !(audio.music >= 0 && audio.music <= 1)) throw new RangeError('Invalid audio settings');
  return edit(project, next => { next.audio = audio; });
}
export function splitSegment(project, id, at, newId) {
  const segment = project.segments[indexOf(project, id)];
  if (typeof newId !== 'string' || !newId || project.segments.some(s => s.id === newId) || !Number.isFinite(at) || at <= segment.start || at >= segment.end) throw new RangeError('Invalid split');
  return edit(project, next => {
    const index = indexOf(next, id), current = next.segments[index];
    next.segments.splice(index, 1, { ...current, end: at }, { ...current, id: newId, start: at });
    next.activeId = newId;
  });
}
export function moveSegment(project, id, direction) {
  const index = indexOf(project, id), target = index + direction;
  if (![1, -1].includes(direction) || target < 0 || target >= project.segments.length) throw new RangeError('Invalid move');
  return edit(project, next => { const [segment] = next.segments.splice(index, 1); next.segments.splice(target, 0, segment); });
}
export function removeSegment(project, id) {
  const index = indexOf(project, id);
  return edit(project, next => {
    next.segments.splice(index, 1);
    next.activeId = next.segments[Math.min(index, next.segments.length - 1)]?.id ?? null;
  });
}
export function undo(project) {
  if (!project.history.length) return project;
  return { ...copy(project.history.at(-1)), history: project.history.slice(0, -1) };
}
export function locateFilmTime(project, time) {
  if (!Number.isFinite(time) || time < 0) throw new RangeError('Invalid film time');
  let offset = 0;
  for (const segment of project.segments) {
    const length = segmentLength(segment);
    if (time < offset + length) return { segmentId: segment.id, sourceId: segment.sourceId, sourceTime: segment.start + (time - offset) * segment.speed };
    offset += length;
  }
  throw new RangeError('Film time outside timeline');
}
