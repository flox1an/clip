import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import de from '../src/i18n/de.js';
import en from '../src/i18n/en.js';

// Every key the UI asks for exists in every language, so no screen shows a raw key or falls back mid-sentence.
test('all languages define every key used in the source', () => {
  const blocks = Object.entries({ de, en }).map(([lang, messages]) => [lang, new Set(Object.keys(messages))]);
  const used = new Set();
  const root = new URL('../src/', import.meta.url);
  for (const file of readdirSync(root, { recursive: true })) {
    if (!file.endsWith('.js') || file.startsWith('i18n')) continue;
    const code = readFileSync(new URL(file, root), 'utf8');
    for (const [, key] of code.matchAll(/\bt\('([\w.]+)'/g)) used.add(key);
    for (const [, id] of code.matchAll(/look\('(\w+)'/g)) used.add(`look.${id}`);
  }
  assert.ok(used.size > 50, 'key scan found too few keys');
  for (const [lang, keys] of blocks) for (const key of used) assert.ok(keys.has(key), `${lang} is missing ${key}`);
  const [[, first], ...rest] = blocks;
  for (const [lang, keys] of rest) assert.deepEqual([...keys].sort(), [...first].sort(), `${lang} differs from ${blocks[0][0]}`);
});
