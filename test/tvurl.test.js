'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the browser script without a DOM: it only exposes window.TVURL.
const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'tvurl.js'), 'utf8');
const sandbox = { btoa, atob };
vm.runInNewContext(source, sandbox);
const TVURL = sandbox.TVURL;

const CFG = { api: 'https://tv.example.com', token: 'abc123', nav: true, v: 4 };

test('payload round-trips through encode/decode', () => {
  assert.deepEqual({ ...TVURL.decodePayload(TVURL.encodePayload(CFG)) }, CFG);
});

test('decodePayload rejects garbage', () => {
  assert.equal(TVURL.decodePayload('%%%not-base64'), null);
});

test('decodePayload rejects config without token', () => {
  assert.equal(TVURL.decodePayload(TVURL.encodePayload({ api: 'https://x' })), null);
});

test('addPayload uses the hash when the URL has none', () => {
  assert.match(TVURL.addPayload('https://site.example/page?q=1', CFG), /^https:\/\/site\.example\/page\?q=1#tvurl=/);
});

test('addPayload uses the query when the URL already has a hash route', () => {
  const url = TVURL.addPayload('https://site.example/#/home', CFG);
  assert.match(url, /^https:\/\/site\.example\/\?tvurl=[^#]+#\/home$/);
});

test('addPayload appends with & when a query exists before the hash', () => {
  assert.match(TVURL.addPayload('https://s.example/?a=1#/x', CFG), /\?a=1&tvurl=[^#]+#\/x$/);
});

const ROUND_TRIPS = [
  'https://site.example/',
  'https://site.example/page?q=1',
  'https://site.example/#/home',
  'https://site.example/?a=1#/x',
  'https://site.example/path?a=1&b=2',
];

for (const url of ROUND_TRIPS) {
  test(`extractPayload restores the original URL: ${url}`, () => {
    const found = TVURL.extractPayload(TVURL.addPayload(url, CFG));
    assert.equal(found.cleanUrl, url);
    assert.equal(found.config.token, 'abc123');
  });
}

test('extractPayload returns null when there is no payload', () => {
  assert.equal(TVURL.extractPayload('https://site.example/?q=tvurl'), null);
});

test('extractPayload keeps other params when payload is first in the query', () => {
  const encoded = encodeURIComponent(TVURL.encodePayload(CFG));
  assert.equal(TVURL.extractPayload(`https://s.example/?tvurl=${encoded}&b=2`).cleanUrl, 'https://s.example/?b=2');
});

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height };
}

const FROM = rect(100, 100, 50, 50);

test('scoreCandidate excludes elements behind the direction', () => {
  assert.equal(TVURL.scoreCandidate(FROM, rect(0, 100, 50, 50), 'right'), -1);
});

test('chooseCandidate picks the nearest element on the same row', () => {
  const near = rect(200, 100, 50, 50);
  const far = rect(400, 100, 50, 50);
  const pick = TVURL.chooseCandidate(FROM, [{ rect: far, item: 'far' }, { rect: near, item: 'near' }], 'right');
  assert.equal(pick, 'near');
});

test('chooseCandidate prefers the same row over a slightly closer element on another row', () => {
  const sameRow = rect(260, 100, 50, 50);
  const otherRow = rect(200, 300, 50, 50);
  const pick = TVURL.chooseCandidate(FROM, [{ rect: otherRow, item: 'other' }, { rect: sameRow, item: 'same' }], 'right');
  assert.equal(pick, 'same');
});

test('chooseCandidate moves down to the element below', () => {
  const below = rect(100, 200, 50, 50);
  const right = rect(200, 100, 50, 50);
  const pick = TVURL.chooseCandidate(FROM, [{ rect: right, item: 'right' }, { rect: below, item: 'below' }], 'down');
  assert.equal(pick, 'below');
});

test('chooseCandidate returns null when nothing is in that direction', () => {
  assert.equal(TVURL.chooseCandidate(FROM, [{ rect: rect(0, 0, 10, 10), item: 'x' }], 'down'), null);
});

// --- Back closes popups ---------------------------------------------------

for (const label of ['×', '✕', '✖', 'x', 'X', 'Close', 'close dialog', 'Chiudi', 'Dismiss']) {
  test(`isCloseLabel accepts "${label}"`, () => {
    assert.equal(TVURL.isCloseLabel(label), true);
  });
}

for (const label of ['', 'Play', 'Next episode', 'Xbox', 'Closed captions', 'OK']) {
  test(`isCloseLabel rejects "${label}"`, () => {
    assert.equal(TVURL.isCloseLabel(label), false);
  });
}

// --- Row navigation --------------------------------------------------------

const VIEW = { width: 1920, height: 1080 };

test('verticalPool keeps only on-screen candidates when moving up/down', () => {
  const pool = TVURL.verticalPool([
    { rect: rect(100, 500, 200, 300), item: 'visible' },
    { rect: rect(2500, 500, 200, 300), item: 'scrolled-off-right' },
  ], 'down', VIEW);
  assert.deepEqual([...pool.map((c) => c.item)], ['visible']); // copy: array comes from the vm realm
});

test('verticalPool falls back to all candidates when none are on screen', () => {
  const pool = TVURL.verticalPool([{ rect: rect(2500, 500, 200, 300), item: 'off' }], 'up', VIEW);
  assert.equal(pool.length, 1);
});

test('verticalPool leaves left/right moves untouched', () => {
  const pool = TVURL.verticalPool([{ rect: rect(2500, 500, 200, 300), item: 'off' }, { rect: rect(0, 0, 10, 10), item: 'on' }], 'right', VIEW);
  assert.equal(pool.length, 2);
});

// --- Player keys -----------------------------------------------------------

test('playerAction maps remote keys to player actions', () => {
  assert.deepEqual(
    [13, 10252, 415, 19, 39, 417, 37, 412, 38].map(TVURL.playerAction),
    ['toggle', 'toggle', 'play', 'pause', 'forward', 'forward', 'rewind', 'rewind', null]
  );
});

function fakeVideo(paused, currentTime, duration) {
  return {
    paused, currentTime, duration,
    play() { this.paused = false; },
    pause() { this.paused = true; },
  };
}

test('applyPlayerAction toggle plays a paused video', () => {
  const video = fakeVideo(true, 0, 100);
  TVURL.applyPlayerAction(video, 'toggle');
  assert.equal(video.paused, false);
});

test('applyPlayerAction toggle pauses a playing video', () => {
  const video = fakeVideo(false, 0, 100);
  TVURL.applyPlayerAction(video, 'toggle');
  assert.equal(video.paused, true);
});

test('applyPlayerAction forward skips 10 seconds', () => {
  const video = fakeVideo(false, 30, 100);
  TVURL.applyPlayerAction(video, 'forward');
  assert.equal(video.currentTime, 40);
});

test('applyPlayerAction forward stops at the end', () => {
  const video = fakeVideo(false, 95, 100);
  TVURL.applyPlayerAction(video, 'forward');
  assert.equal(video.currentTime, 100);
});

test('applyPlayerAction rewind stops at zero', () => {
  const video = fakeVideo(false, 4, 100);
  TVURL.applyPlayerAction(video, 'rewind');
  assert.equal(video.currentTime, 0);
});

test('chooseCandidate ignores a container that wraps the current element', () => {
  const wrapper = rect(90, 90, 300, 70);
  assert.equal(TVURL.chooseCandidate(FROM, [{ rect: wrapper, item: 'wrapper' }], 'right'), null);
});
