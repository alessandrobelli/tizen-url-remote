// Local end-to-end harness for desktop Chrome. Separate ports = separate
// origins, like on the TV:
//   :8080  launcher (docs/)              -> open http://localhost:8080/
//   :3000  real API (server/src/api.js), token "local-test-token-123"
//   :3001  fake bot: /cmd?text=/url%20http://localhost:8082/  (runs real command handler)
//   :8081  test site A, :8082 test site B (both load tvurl.js to simulate injection)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../../server/src/store.js';
import { createApiServer } from '../../server/src/api.js';
import { handleCommand } from '../../server/src/commands.js';

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = join(here, '..', '..', 'docs');
const pagesDir = join(here, 'pages');
const TOKEN = 'local-test-token-123';
const TYPES = { '.html': 'text/html', '.js': 'application/javascript' };

function staticServer(rootDir, defaultFile) {
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = normalize(join(rootDir, path === '/' ? defaultFile : path));
    if (!file.startsWith(rootDir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
}

const store = createStore(join(mkdtempSync(join(tmpdir(), 'tvurl-manual-')), 'state.json'), 'http://localhost:8081/');

createApiServer({ store, apiToken: TOKEN }).listen(3000);
createServer((req, res) => {
  const text = new URL(req.url, 'http://x').searchParams.get('text') || '';
  const reply = handleCommand(text, store);
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end(reply);
}).listen(3001);
staticServer(docsDir, 'index.html').listen(8080);
staticServer(pagesDir, 'site-a.html').listen(8081);
staticServer(pagesDir, 'site-b.html').listen(8082);

console.log(`Launcher: http://localhost:8080/   (API http://localhost:3000, token ${TOKEN})`);
console.log('Change URL: http://localhost:3001/cmd?text=/url%20http://localhost:8082/');
