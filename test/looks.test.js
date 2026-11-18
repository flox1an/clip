import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, lookById } from '../src/looks.js';

const apply = ({ m, o }, rgb) => [0, 1, 2].map(r => m[r * 3] * rgb[0] + m[r * 3 + 1] * rgb[1] + m[r * 3 + 2] * rgb[2] + o[r]);

test('normal is the identity and unknown ids fall back to it', () => {
  assert.deepEqual(apply(lookById('normal'), [0.2, 0.5, 0.9]), [0.2, 0.5, 0.9]);
  assert.equal(lookById('gone').id, 'normal');
});
test('black-and-white looks give equal channels; every look keeps mid-grey near grey', () => {
  for (const id of ['mono', 'noir']) { const [r, g, b] = apply(lookById(id), [0.8, 0.3, 0.1]); assert.ok(Math.abs(r - g) < 1e-9 && Math.abs(g - b) < 1e-9); }
  for (const look of LOOKS) for (const v of apply(look, [0.5, 0.5, 0.5])) assert.ok(v > 0.35 && v < 0.65, look.id);
});
