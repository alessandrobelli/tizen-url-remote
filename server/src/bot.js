import { handleCommand } from './commands.js';

const LONG_POLL_SECONDS = 30;
const RETRY_DELAY_MS = 5000;

// Minimal Telegram Bot API client (long polling, no webhook, no dependencies).
export function createTelegramClient(botToken) {
  const base = `https://api.telegram.org/bot${botToken}`;

  async function call(method, body, timeoutMs) {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      throw new Error(`Telegram ${method} failed: HTTP ${res.status} ${data.description || ''}`.trim());
    }
    return data.result;
  }

  return {
    getUpdates: (offset) =>
      call('getUpdates', { offset, timeout: LONG_POLL_SECONDS, allowed_updates: ['message'] },
        (LONG_POLL_SECONDS + 10) * 1000),
    sendMessage: (chatId, text) =>
      call('sendMessage', { chat_id: chatId, text, link_preview_options: { is_disabled: true } }, 10000),
  };
}

// Fetches one batch of updates, answers the allowed chat, returns the next offset.
export async function pollOnce({ telegram, store, allowedChatId, offset, log }) {
  const updates = await telegram.getUpdates(offset);
  let next = offset;

  for (const update of updates) {
    next = Math.max(next, update.update_id + 1);
    const msg = update.message;
    if (!msg || typeof msg.text !== 'string') continue;

    if (String(msg.chat.id) !== String(allowedChatId)) {
      // Logged so you can discover your own chat ID on first setup.
      log.warn(`Ignoring message from chat ${msg.chat.id}`);
      continue;
    }

    const reply = handleCommand(msg.text, store);
    try {
      await telegram.sendMessage(msg.chat.id, reply);
    } catch (err) {
      log.error(`Reply to chat ${msg.chat.id} failed: ${err.message}`);
    }
  }
  return next;
}

export async function runBot({ telegram, store, allowedChatId, log, signal }) {
  let offset = 0;
  while (!signal.aborted) {
    try {
      offset = await pollOnce({ telegram, store, allowedChatId, offset, log });
    } catch (err) {
      if (signal.aborted) break;
      log.error(`Polling failed, retrying in ${RETRY_DELAY_MS / 1000}s: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
