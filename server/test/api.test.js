import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/api.js';

const TOKEN = 'secret-token';
const store = {
  get: () => ({ url: 'https://example.com/', version: 3 }),
};
let server;
let base;

before(async () => {
  server = createApiServer({ store, apiToken: TOKEN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /state with a valid bearer token returns url and version', async () => {
  const res = await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://example.com/', version: 3 });
});

test('GET /state ignores the cache-buster query string', async () => {
  const res = await fetch(`${base}/state?t=123`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 200);
});

test('GET /state without a token returns 401', async () => {
  const res = await fetch(`${base}/state`);
  assert.equal(res.status, 401);
});

test('GET /state with a wrong token returns 401', async () => {
  const res = await fetch(`${base}/state`, { headers: { Authorization: 'Bearer nope' } });
  assert.equal(res.status, 401);
});

test('GET /state is not cacheable', async () => {
  const res = await fetch(`${base}/state`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('responses allow any origin (the TV script runs on arbitrary sites)', async () => {
  const res = await fetch(`${base}/state`);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('CORS preflight allows the Authorization header', async () => {
  const res = await fetch(`${base}/state`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-headers'), /Authorization/i);
});

test('GET /health needs no token', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

test('unknown path returns 404', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test('POST /state is not allowed', async () => {
  const res = await fetch(`${base}/state`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(res.status, 405);
});
