import test from 'node:test';
import assert from 'node:assert/strict';
import { framePoint } from '../src/camera-controls.js';

test('tap position maps through the cover crop and the selfie mirror', () => {
  const box = { left: 0, top: 0, width: 390, height: 844 }, frame = { width: 1920, height: 1080 }; // landscape frame, sides cropped
  assert.deepEqual(framePoint(195, 422, box, frame, false), { x: 0.5, y: 0.5 });
  const left = framePoint(0, 0, box, frame, false);
  const visible = 390 / (1920 * 844 / 1080); // share of frame width on screen
  assert.ok(Math.abs(left.x - (1 - visible) / 2) < 1e-9 && left.y === 0);
  assert.equal(framePoint(0, 0, box, frame, true).x, 1 - left.x);
});
