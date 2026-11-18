import { test } from 'node:test';
import { deepStrictEqual } from 'node:assert';
import { restoredSelection } from '../src/trim.js';
test('preserves valid selection on returning to editor', () => deepStrictEqual(restoredSelection(10, {start: 2, end: 7}), {start: 2, end: 7}));
test('new or invalid selection defaults to full clip', () => { deepStrictEqual(restoredSelection(10, null), {start: 0, end: 10}); deepStrictEqual(restoredSelection(5, {start: 2, end: 7}), {start: 0, end: 5}); });
