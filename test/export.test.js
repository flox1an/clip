import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportFilm, outputSize } from '../src/export.js';
import { t } from '../src/i18n/index.js';

const source = { blob: new Blob(['not media']), fit: 'cover', mirror: false, hasAudio: false, width: 1080, height: 1920 };
const sources = new Map([['a', source]]);
const segment = (sourceId, start, end, speed = 1) => ({ sourceId, start, end, duration: 4, speed });

test('empty timeline, missing media and invalid bounds fail before any encoding', async () => {
  await assert.rejects(exportFilm([], sources), { message: t('export.empty') });
  await assert.rejects(exportFilm([segment('missing', 0, 1)], sources), { message: t('export.missing') });
  await assert.rejects(exportFilm([segment('a', 0, 1), segment('a', 1, 5)], sources), RangeError);
  await assert.rejects(exportFilm([segment('a', 0, 1, 0)], sources), RangeError);
});

test('mixed source resolutions share one even portrait 9:16 output', () => {
  assert.deepEqual(outputSize([{ width: 1920, height: 1080 }, { width: 720, height: 1280 }]), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize([{ width: 640, height: 480 }]), { width: 720, height: 1280 });
  assert.deepEqual(outputSize([{ width: 3840, height: 2160 }]), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize([{ width: 1000, height: 900 }]), { width: 900, height: 1600 });
});
