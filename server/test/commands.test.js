import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCommand, parseCommand } from '../src/commands.js';

function memoryStore() {
  let state = { url: '', version: 0 };
  return {
    get: () => ({ ...state }),
    setUrl: (url) => { state = { url, version: state.version + 1 }; },
    bumpVersion: () => { state = { url: state.url, version: state.version + 1 }; },
  };
}

test('parseCommand splits name and argument', () => {
  assert.deepEqual(parseCommand('/url https://a.example/ '), { name: 'url', arg: 'https://a.example/' });
});

test('parseCommand strips the @BotName suffix used in groups', () => {
  assert.deepEqual(parseCommand('/current@MyTvBot'), { name: 'current', arg: '' });
});

test('parseCommand returns null for plain text', () => {
  assert.equal(parseCommand('hello'), null);
});

test('/url sets a valid https url', () => {
  const store = memoryStore();
  handleCommand('/url https://example.com/page', store);
  assert.equal(store.get().url, 'https://example.com/page');
});

test('/url normalises the url', () => {
  const store = memoryStore();
  handleCommand('/url https://Example.com', store);
  assert.equal(store.get().url, 'https://example.com/');
});

test('/url without argument does not change state', () => {
  const store = memoryStore();
  const reply = handleCommand('/url', store);
  assert.equal(store.get().version, 0);
  assert.match(reply, /Usage/);
});

test('/url rejects non-http schemes', () => {
  const store = memoryStore();
  const reply = handleCommand('/url javascript:alert(1)', store);
  assert.equal(store.get().version, 0);
  assert.match(reply, /http/);
});

test('/url rejects garbage', () => {
  const store = memoryStore();
  handleCommand('/url not a url', store);
  assert.equal(store.get().version, 0);
});

test('/current reports the url and version', () => {
  const store = memoryStore();
  store.setUrl('https://example.com/');
  assert.match(handleCommand('/current', store), /https:\/\/example\.com\/.*1/s);
});

test('/current with no url says so', () => {
  assert.match(handleCommand('/current', memoryStore()), /No URL/);
});

test('/reload bumps the version and keeps the url', () => {
  const store = memoryStore();
  store.setUrl('https://example.com/');
  handleCommand('/reload', store);
  assert.deepEqual(store.get(), { url: 'https://example.com/', version: 2 });
});

test('/reload with no url set refuses', () => {
  const store = memoryStore();
  handleCommand('/reload', store);
  assert.equal(store.get().version, 0);
});

test('unknown command returns help', () => {
  assert.match(handleCommand('/foo', memoryStore()), /\/url/);
});

test('plain text returns help', () => {
  assert.match(handleCommand('hi', memoryStore()), /\/url/);
});
