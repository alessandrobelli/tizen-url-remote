import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createApiServer } from './api.js';
import { createTelegramClient, runBot } from './bot.js';

const log = {
  info: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
};

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(`Config error: ${err.message}`);
  process.exit(1);
}

const store = createStore(config.dataFile, config.initialUrl);
const server = createApiServer({ store, apiToken: config.apiToken });
const controller = new AbortController();

server.listen(config.port, () => log.info(`API listening on :${config.port}`));
runBot({
  telegram: createTelegramClient(config.botToken),
  store,
  allowedChatId: config.allowedChatId,
  log,
  signal: controller.signal,
});
log.info('Telegram bot polling started');

function shutdown() {
  controller.abort();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
