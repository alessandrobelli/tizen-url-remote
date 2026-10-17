const MIN_TOKEN_LENGTH = 16;

export function loadConfig(env) {
  const missing = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'API_TOKEN'].filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (!/^-?\d+$/.test(env.TELEGRAM_CHAT_ID)) {
    throw new Error('TELEGRAM_CHAT_ID must be a numeric Telegram chat ID');
  }
  if (env.API_TOKEN.length < MIN_TOKEN_LENGTH) {
    throw new Error(`API_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return {
    botToken: env.TELEGRAM_BOT_TOKEN,
    allowedChatId: env.TELEGRAM_CHAT_ID,
    apiToken: env.API_TOKEN,
    port: Number(env.PORT) || 3000,
    dataFile: env.DATA_FILE || '/data/state.json',
    initialUrl: env.INITIAL_URL || '',
  };
}
