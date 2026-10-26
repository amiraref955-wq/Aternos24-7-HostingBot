'use strict';

/**
 * ============================================================
 *  Minecraft AFK Bot v3.0 - Advanced Edition
 * ============================================================
 *  Modular architecture:
 *    src/config.js            - settings loader (defaults merge + save)
 *    src/state.js             - central state + event bus
 *    src/utils/logger.js      - logging with dashboard console capture
 *    src/bot/botManager.js    - bot lifecycle & reconnection engine
 *    src/bot/modules/*        - in-game modules (anti-afk, combat, ...)
 *    src/notifications/*      - Discord webhook + Telegram
 *    src/dashboard/*          - advanced web control panel (auth + SSE)
 *    src/keepalive.js         - Render self-ping + memory monitor
 *
 *  Entry point: wires everything together and installs crash recovery.
 */

const { loadConfig, getConfig } = require('./src/config');
const { initConsoleCapture, log } = require('./src/utils/logger');
const { botState, pushError, pushHistory } = require('./src/state');
const { BotManager } = require('./src/bot/botManager');
const { notify } = require('./src/notifications');
const { startDashboard } = require('./src/dashboard/server');
const { startSelfPing, startMemoryMonitor } = require('./src/keepalive');
const readline = require('readline');

// Capture every console.log into the dashboard feed
initConsoleCapture();

// Load settings (merged with defaults)
loadConfig();
const config = getConfig();

// Warn about the default dashboard password
if (!config.dashboard || !config.dashboard.password || config.dashboard.password === 'changeme') {
  console.log('');
  console.log('  ============================================================');
  console.log('   [SECURITY] Dashboard password is the default "changeme"!');
  console.log('   Change it in settings.json -> dashboard.password');
  console.log('   or from the panel: Settings -> Dashboard Security.');
  console.log('  ============================================================');
  console.log('');
}

// Create the bot manager
const botManager = new BotManager(config, notify);

// Start the advanced web dashboard
startDashboard(config, botManager, require('./src/config').saveConfig);

// Keep-alive systems (Render self-ping + memory logging)
startSelfPing();
startMemoryMonitor();

// ---------- Console commands (works locally; harmless on Render) ----------
// say <msg>  - chat message | cmd <cmd> - server command | status | reconnect
if (config.modules && config.modules['console-commands']) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (!botManager.isConnected()) {
      console.log('[Console] Bot not connected');
      return;
    }
    if (trimmed.startsWith('say ')) {
      botManager.sendChat(trimmed.slice(4));
    } else if (trimmed.startsWith('cmd ')) {
      botManager.sendChat('/' + trimmed.slice(4));
    } else if (trimmed === 'status') {
      console.log(`Connected: ${botState.connected}, Uptime: ${Math.floor((Date.now() - botState.startTime) / 1000)}s`);
    } else if (trimmed === 'reconnect') {
      console.log('[Console] Manual reconnect requested');
      botManager.reconnectNow();
    } else {
      botManager.sendChat(trimmed);
    }
  });
}

// ---------- Crash recovery - immortal mode ----------
process.on('uncaughtException', (err) => {
  const msg = (err && err.message) || 'Unknown';
  console.log(`[FATAL] Uncaught Exception: ${msg}`);
  pushError({ type: 'uncaught', message: msg });

  const isNetworkError = msg.includes('PartialReadError') || msg.includes('ECONNRESET') ||
    msg.includes('EPIPE') || msg.includes('ETIMEDOUT') || msg.includes('timed out') ||
    msg.includes('write after end') || msg.includes('This socket has been ended');

  if (isNetworkError) {
    console.log('[FATAL] Known network/protocol error - recovering gracefully...');
  }

  if (config.utils && config.utils['auto-reconnect'] && !botState.manualStop) {
    botManager.crashRecover(isNetworkError);
  }
});

process.on('unhandledRejection', (reason) => {
  console.log(`[FATAL] Unhandled Rejection: ${reason}`);
  pushError({ type: 'rejection', message: String(reason) });
});

process.on('SIGTERM', () => {
  console.log('[System] SIGTERM received.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[System] Manual stop requested. Exiting...');
  process.exit(0);
});

// ---------- Boot banner ----------
console.log('='.repeat(56));
console.log('   Minecraft AFK Bot v3.0 - Advanced Edition');
console.log('='.repeat(56));
console.log(`   Server          : ${config.server.ip}:${config.server.port}`);
console.log(`   Bot username    : ${config['bot-account'].username}`);
console.log(`   MC Version      : ${config.server.version || 'auto-detect'}`);
console.log(`   Auto-Reconnect  : ${config.utils['auto-reconnect'] ? 'Enabled' : 'Disabled'}`);
console.log(`   Dashboard       : ${config.dashboard && config.dashboard.enabled ? 'Enabled (password protected)' : 'Disabled'}`);
console.log(`   Discord notify  : ${config.discord && config.discord.enabled ? 'Enabled' : 'Disabled'}`);
console.log(`   Telegram notify : ${config.telegram && config.telegram.enabled ? 'Enabled' : 'Disabled'}`);
console.log('='.repeat(56));

pushHistory({ event: 'startup', detail: `Bot v3.0 started -> ${config.server.ip}:${config.server.port}` });

// Start the bot
botManager.createBot();
