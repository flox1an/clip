import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateTrim, formatDuration } from '../src/trim.js';

test('valid trim range preserves boundaries and computes duration', () => {
  assert.deepEqual(validateTrim(1, 4.5, 5), { start: 1, end: 4.5, duration: 3.5 });
  assert.deepEqual(validateTrim(0, 5, 5), { start: 0, end: 5, duration: 5 });
});
test('invalid and non-finite ranges are rejected', () => {
  for (const args of [[-1, 2, 3], [1, 4, 3], [2, 2, 3], [3, 2, 3], [0, 1, Infinity], [0, NaN, 3], [0, 0, 0]]) {
    assert.throws(() => validateTrim(...args), RangeError);
  }
});
test('time formatting safely handles metadata and elapsed time', () => {
  assert.equal(formatDuration(61.9), '01:01');
  assert.equal(formatDuration(Infinity), '--:--');
  assert.equal(formatDuration(-1), '--:--');
});
