import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollOnce } from '../src/bot.js';

const ALLOWED = 111;

function memoryStore() {
  let state = { url: '', version: 0 };
  return {
    get: () => ({ ...state }),
    setUrl: (url) => { state = { url, version: state.version + 1 }; },
    bumpVersion: () => { state = { url: state.url, version: state.version + 1 }; },
  };
}

function fakeTelegram(updates) {
  const sent = [];
  const offsets = [];
  return {
    sent,
    offsets,
    getUpdates: async (offset) => { offsets.push(offset); return updates; },
    sendMessage: async (chatId, text) => { sent.push({ chatId, text }); },
  };
}

function message(updateId, chatId, text) {
  return { update_id: updateId, message: { chat: { id: chatId }, text } };
}

const silentLog = { info() {}, warn() {}, error() {} };

test('message from the allowed chat updates the store and gets a reply', async () => {
  const telegram = fakeTelegram([message(5, ALLOWED, '/url https://example.com/')]);
  const store = memoryStore();
  await pollOnce({ telegram, store, allowedChatId: ALLOWED, offset: 0, log: silentLog });
  assert.equal(store.get().url, 'https://example.com/');
  assert.equal(telegram.sent[0].chatId, ALLOWED);
});

test('message from another chat is ignored without a reply', async () => {
  const telegram = fakeTelegram([message(5, 999, '/url https://evil.example/')]);
  const store = memoryStore();
  await pollOnce({ telegram, store, allowedChatId: ALLOWED, offset: 0, log: silentLog });
  assert.equal(store.get().version, 0);
  assert.equal(telegram.sent.length, 0);
});

test('returns the offset after the highest update id', async () => {
  const telegram = fakeTelegram([message(5, ALLOWED, '/current'), message(9, 999, 'x')]);
  const next = await pollOnce({ telegram, store: memoryStore(), allowedChatId: ALLOWED, offset: 0, log: silentLog });
  assert.equal(next, 10);
});

test('keeps the offset when there are no updates', async () => {
  const telegram = fakeTelegram([]);
  const next = await pollOnce({ telegram, store: memoryStore(), allowedChatId: ALLOWED, offset: 7, log: silentLog });
  assert.equal(next, 7);
});

test('updates without text (stickers, edits) are skipped', async () => {
  const telegram = fakeTelegram([{ update_id: 3, edited_message: { chat: { id: ALLOWED } } }]);
  await pollOnce({ telegram, store: memoryStore(), allowedChatId: ALLOWED, offset: 0, log: silentLog });
  assert.equal(telegram.sent.length, 0);
});

test('a failed reply does not stop later updates from being processed', async () => {
  const telegram = fakeTelegram([message(1, ALLOWED, '/current'), message(2, ALLOWED, '/url https://b.example/')]);
  const store = memoryStore();
  telegram.sendMessage = async () => { throw new Error('network down'); };
  const next = await pollOnce({ telegram, store, allowedChatId: ALLOWED, offset: 0, log: silentLog });
  assert.equal(store.get().url, 'https://b.example/');
  assert.equal(next, 3);
});
