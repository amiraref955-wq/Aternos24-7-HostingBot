'use strict';

/**
 * Telegram notifications via the official Bot API (no external dependencies).
 * Setup:
 *   1. Create a bot with @BotFather on Telegram -> get the bot token.
 *   2. Send any message to your new bot (so it knows your chat id).
 *   3. Get your chat id from https://api.telegram.org/bot<TOKEN>/getUpdates
 *   4. Put botToken + chatId into settings.json -> "telegram" section.
 */
const https = require('https');
const { log } = require('../utils/logger');

let lastSend = 0;
const RATE_LIMIT_MS = 3000; // Telegram allows ~1 msg/sec, keep a safe margin

function isConfigured(telegram) {
  return !!(telegram && telegram.enabled && telegram.botToken && telegram.chatId);
}

function send(telegram, text) {
  if (!isConfigured(telegram)) return;

  const now = Date.now();
  if (now - lastSend < RATE_LIMIT_MS) {
    log('Telegram', 'Rate limited - skipping message');
    return;
  }
  lastSend = now;

  try {
    const payload = JSON.stringify({
      chat_id: String(telegram.chatId),
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${telegram.botToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload, 'utf8')
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        log('Telegram', `Send failed with HTTP ${res.statusCode}`);
      } else {
        res.resume(); // drain
      }
    });
    req.on('timeout', () => { req.destroy(); log('Telegram', 'Request timed out'); });
    req.on('error', (e) => log('Telegram', `Error sending message: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (e) {
    log('Telegram', `Message build error: ${e.message}`);
  }
}

module.exports = { send, isConfigured };
