import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Every key the UI asks for exists in every language, so no screen shows a raw key or falls back mid-sentence.
test('all languages define every key used in the source', async () => {
  const codes = readdirSync(new URL('../src/i18n/', import.meta.url)).filter(file => file !== 'index.js').map(file => file.replace('.js', ''));
  const blocks = await Promise.all(codes.map(async code => [code, new Set(Object.keys((await import(`../src/i18n/${code}.js`)).default))]));
  assert.ok(blocks.length >= 2);
  const { LANGUAGES } = await import('../src/i18n/index.js');
  assert.deepEqual([...LANGUAGES].sort(), codes.sort(), 'every language file is registered in index.js');
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

// A translation that drops or renames a {placeholder} would show it raw or lose the value.
test('translations keep the placeholders of the English text', async () => {
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
  const { default: en } = await import('../src/i18n/en.js');
  const { LANGUAGES } = await import('../src/i18n/index.js');
  for (const code of LANGUAGES) {
    const { default: messages } = await import(`../src/i18n/${code}.js`);
    for (const [key, text] of Object.entries(en)) assert.equal(placeholders(messages[key]), placeholders(text), `${code}: ${key}`);
  }
});
