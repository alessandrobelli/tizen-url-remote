const HELP = [
  'Commands:',
  '/url <link> - show this link on the TV',
  '/current - show the current link',
  '/reload - reopen the current link on the TV',
].join('\n');

// "/url@MyBot https://x" -> { name: 'url', arg: 'https://x' }
export function parseCommand(text) {
  const match = /^\/([a-z]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  if (!match) return null;
  return { name: match[1].toLowerCase(), arg: (match[2] || '').trim() };
}

function normaliseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.href;
}

// Returns the reply text for a message from the allowed chat.
export function handleCommand(text, store) {
  const command = parseCommand(text);
  if (!command) return HELP;

  switch (command.name) {
    case 'url': {
      if (!command.arg) return 'Usage: /url https://example.com';
      const url = normaliseUrl(command.arg);
      if (!url) return 'That is not a valid http(s) link.';
      store.setUrl(url);
      return `TV will open:\n${url}`;
    }
    case 'current': {
      const { url, version } = store.get();
      if (!url) return 'No URL set yet. Use /url <link>.';
      return `Current URL:\n${url}\n(version ${version})`;
    }
    case 'reload': {
      if (!store.get().url) return 'No URL set yet. Use /url <link>.';
      store.bumpVersion();
      return 'TV will reload the current URL.';
    }
    default:
      return HELP;
  }
}
