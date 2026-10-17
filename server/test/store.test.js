import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';

function tempFile() {
  return join(mkdtempSync(join(tmpdir(), 'tvurl-')), 'state.json');
}

test('new store starts with empty url and version 0', () => {
  const store = createStore(tempFile());
  assert.deepEqual(store.get(), { url: '', version: 0 });
});

test('setUrl stores the url and bumps the version', () => {
  const store = createStore(tempFile());
  store.setUrl('https://example.com/');
  assert.deepEqual(store.get(), { url: 'https://example.com/', version: 1 });
});

test('bumpVersion keeps the url and bumps the version', () => {
  const store = createStore(tempFile());
  store.setUrl('https://example.com/');
  store.bumpVersion();
  assert.deepEqual(store.get(), { url: 'https://example.com/', version: 2 });
});

test('state is persisted and reloaded from disk', () => {
  const file = tempFile();
  createStore(file).setUrl('https://example.com/');
  assert.deepEqual(createStore(file).get(), { url: 'https://example.com/', version: 1 });
});

test('initial url is used only when no state file exists', () => {
  const file = tempFile();
  assert.equal(createStore(file, 'https://init.example/').get().url, 'https://init.example/');
  createStore(file, 'https://init.example/').setUrl('https://other.example/');
  assert.equal(createStore(file, 'https://init.example/').get().url, 'https://other.example/');
});

test('corrupt state file fails fast with the file path in the message', () => {
  const file = tempFile();
  writeFileSync(file, '{not json');
  assert.throws(() => createStore(file), new RegExp('state.json'));
});

test('get returns a copy that cannot mutate the store', () => {
  const store = createStore(tempFile());
  store.get().url = 'hacked';
  assert.equal(store.get().url, '');
});

test('file on disk is valid JSON after a write', () => {
  const file = tempFile();
  createStore(file).setUrl('https://example.com/');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
});
