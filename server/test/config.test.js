import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const VALID = {
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_CHAT_ID: '42',
  API_TOKEN: 'a-long-enough-token-1234',
};

test('valid env produces config with defaults', () => {
  const config = loadConfig(VALID);
  assert.equal(config.port, 3000);
  assert.equal(config.dataFile, '/data/state.json');
  assert.equal(config.allowedChatId, '42');
});

test('missing variables are all named in one error', () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN.*TELEGRAM_CHAT_ID.*API_TOKEN/);
});

test('short API token is rejected', () => {
  assert.throws(() => loadConfig({ ...VALID, API_TOKEN: 'short' }), /API_TOKEN/);
});

test('non-numeric chat id is rejected', () => {
  assert.throws(() => loadConfig({ ...VALID, TELEGRAM_CHAT_ID: 'me' }), /TELEGRAM_CHAT_ID/);
});

test('PORT and DATA_FILE can be overridden', () => {
  const config = loadConfig({ ...VALID, PORT: '8080', DATA_FILE: '/tmp/x.json' });
  assert.equal(config.port, 8080);
  assert.equal(config.dataFile, '/tmp/x.json');
});
