import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addSegment, trimSegment, splitSegment, moveSegment, removeSegment, setSpeed, setLook, setAudio, filmLength, undo, locateFilmTime } from '../src/project.js';
const clip = { id: 'a', sourceId: 'original', duration: 10 };
test('trim and split retain the source and do not mutate earlier states', () => {
  const original = addSegment(createProject(), clip);
  const trimmed = trimSegment(original, 'a', 2, 8);
  const split = splitSegment(trimmed, 'a', 5, 'b');
  assert.deepEqual(split.segments.map(s => [s.sourceId,s.start,s.end]), [['original',2,5],['original',5,8]]);
  assert.deepEqual([original.segments[0].start, original.segments[0].end], [0,10]);
  assert.deepEqual(undo(split).segments, trimmed.segments);
  assert.deepEqual(undo(undo(split)).segments, original.segments);
});
test('reorder and source/film time mapping use half-open boundaries', () => {
  let p = splitSegment(addSegment(createProject(), clip), 'a', 4, 'b');
  p = moveSegment(p, 'b', -1);
  assert.deepEqual(locateFilmTime(p, 0), {segmentId:'b',sourceId:'original',sourceTime:4});
  assert.deepEqual(locateFilmTime(p, 6), {segmentId:'a',sourceId:'original',sourceTime:0});
  assert.throws(() => locateFilmTime(p, 10), RangeError);
  assert.equal(undo(p).segments[0].id, 'a');
});
test('invalid edits are rejected without changing the project', () => {
  const p = addSegment(createProject(), clip);
  assert.throws(() => splitSegment(p, 'a', 0, 'b'));
  assert.throws(() => splitSegment(p, 'a', 5, 'a'));
  assert.throws(() => trimSegment(p, 'a', 8, 2));
  assert.throws(() => moveSegment(p, 'a', -1));
  assert.throws(() => addSegment(p, clip));
  assert.throws(() => locateFilmTime(p, NaN));
  assert.equal(p.segments.length, 1);
  assert.equal(p.segments[0].end, 10);
});
test('speed scales film time and survives split; removal selects a neighbour', () => {
  let p = setSpeed(addSegment(createProject(), clip), 'a', 2);
  assert.equal(filmLength(p), 5);
  assert.deepEqual(locateFilmTime(p, 1), { segmentId: 'a', sourceId: 'original', sourceTime: 2 });
  p = splitSegment(p, 'a', 4, 'b');
  assert.deepEqual(p.segments.map(s => s.speed), [2, 2]);
  assert.equal(filmLength(p), 5);
  p = removeSegment(p, 'b');
  assert.equal(p.activeId, 'a');
  assert.equal(filmLength(p), 2);
  assert.throws(() => setSpeed(p, 'a', 7), RangeError);
  assert.equal(undo(p).segments.length, 2);
});
test('looks and audio mix are part of the undoable project state', () => {
  let p = splitSegment(addSegment(createProject(), clip), 'a', 5, 'b');
  p = setLook(p, ['a', 'b'], { look: 'noir', strength: 0.6, exposure: -0.4 });
  assert.deepEqual(p.segments.map(s => [s.look, s.strength, s.exposure]), [['noir', 0.6, -0.4], ['noir', 0.6, -0.4]]);
  p = setAudio(p, { musicId: 'm', musicStart: 12, original: 0.3 });
  assert.deepEqual(p.audio, { musicId: 'm', musicStart: 12, original: 0.3, music: 1 });
  assert.equal(undo(p).audio.musicId, null);
  assert.equal(undo(undo(p)).segments[0].look, 'normal');
  assert.throws(() => setAudio(p, { original: 2 }), RangeError);
  assert.throws(() => setLook(p, ['a'], { look: 'noir', strength: 1.5 }), RangeError);
  assert.throws(() => setLook(p, ['a'], { look: 'noir', exposure: 2 }), RangeError);
});
