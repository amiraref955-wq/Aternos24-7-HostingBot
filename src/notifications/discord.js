'use strict';

/**
 * Discord webhook notifications (no external dependencies).
 */
const http = require('http');
const https = require('https');
const { log } = require('../utils/logger');

let lastSend = 0;
const RATE_LIMIT_MS = 5000; // min 5s between webhook calls

function isConfigured(discord) {
  return !!(discord && discord.enabled && discord.webhookUrl && !discord.webhookUrl.includes('YOUR_DISCORD'));
}

function send(discord, content, color = 0x0099ff) {
  if (!isConfigured(discord)) return;

  // Rate limiting to avoid spam when the bot is flapping
  const now = Date.now();
  if (now - lastSend < RATE_LIMIT_MS) {
    log('Discord', 'Rate limited - skipping webhook');
    return;
  }
  lastSend = now;

  try {
    const protocol = discord.webhookUrl.startsWith('https') ? https : http;
    const urlParts = new URL(discord.webhookUrl);

    const payload = JSON.stringify({
      username: discord.username || 'AFK Bot',
      embeds: [{
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: 'Aternos AFK Bot v3' }
      }]
    });

    const options = {
      hostname: urlParts.hostname,
      port: urlParts.port || 443,
      path: urlParts.pathname + urlParts.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Buffer.byteLength handles non-ASCII (e.g. usernames with accents/emoji)
        'Content-Length': Buffer.byteLength(payload, 'utf8')
      }
    };

    const req = protocol.request(options, () => { /* silent success */ });
    req.on('error', (e) => log('Discord', `Error sending webhook: ${e.message}`));
    req.write(payload);
    req.end();
  } catch (e) {
    log('Discord', `Webhook build error: ${e.message}`);
  }
}

module.exports = { send, isConfigured };
