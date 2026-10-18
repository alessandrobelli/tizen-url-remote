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

const VIEW = { width: 1920, height: 1080 };

test('moveCursor moves right by the step', () => {
  assert.deepEqual({ ...TVURL.moveCursor({ x: 100, y: 100 }, 'right', 20, VIEW) }, { x: 120, y: 100, scrollX: 0, scrollY: 0 });
});

test('moveCursor moves up by the step', () => {
  assert.deepEqual({ ...TVURL.moveCursor({ x: 100, y: 100 }, 'up', 20, VIEW) }, { x: 100, y: 80, scrollX: 0, scrollY: 0 });
});

test('moveCursor scrolls the page instead of leaving the bottom edge', () => {
  const next = TVURL.moveCursor({ x: 100, y: 1075 }, 'down', 20, VIEW);
  assert.equal(next.y, 1079);
  assert.equal(next.scrollY, 20);
});

test('moveCursor scrolls up at the top edge', () => {
  const next = TVURL.moveCursor({ x: 100, y: 0 }, 'up', 20, VIEW);
  assert.equal(next.y, 0);
  assert.equal(next.scrollY, -20);
});

test('moveCursor clamps at the left edge and scrolls left', () => {
  const next = TVURL.moveCursor({ x: 5, y: 100 }, 'left', 20, VIEW);
  assert.equal(next.x, 0);
  assert.equal(next.scrollX, -20);
});

// cursorStep(previousStep, msSinceLastMove)
test('cursorStep speeds up while the key is held', () => {
  const first = TVURL.cursorStep(0, Infinity);
  assert.ok(TVURL.cursorStep(first, 100) > first);
});

test('cursorStep resets after a pause', () => {
  const first = TVURL.cursorStep(0, Infinity);
  const fast = TVURL.cursorStep(TVURL.cursorStep(first, 100), 100);
  assert.equal(TVURL.cursorStep(fast, 1000), first);
});

test('cursorStep never exceeds the maximum', () => {
  let step = TVURL.cursorStep(0, Infinity);
  for (let i = 0; i < 100; i++) step = TVURL.cursorStep(step, 50);
  assert.ok(step <= 80);
});

test('chooseCandidate ignores a container that wraps the current element', () => {
  const wrapper = rect(90, 90, 300, 70);
  assert.equal(TVURL.chooseCandidate(FROM, [{ rect: wrapper, item: 'wrapper' }], 'right'), null);
});
