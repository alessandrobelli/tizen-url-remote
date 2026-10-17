import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

// The TV script runs inside whatever site is open, so CORS must allow any
// origin. Max-Age keeps Chrome from preflighting every 5s poll.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Max-Age': '7200',
};

function tokenMatches(header, expected) {
  const match = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function send(res, status, body) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

export function createApiServer({ store, apiToken }) {
  return createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (path === '/health') {
      send(res, 200, { ok: true });
      return;
    }
    if (path !== '/state') {
      send(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'GET') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }
    if (!tokenMatches(req.headers.authorization, apiToken)) {
      send(res, 401, { error: 'invalid token' });
      return;
    }
    send(res, 200, store.get());
  });
}
