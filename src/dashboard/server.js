'use strict';

/**
 * Dashboard HTTP server:
 *  - serves the static control panel (public/)
 *  - REST API with session auth (login, bot controls, chat, settings)
 *  - SSE stream for realtime state/chat/console updates
 *  - keeps legacy endpoints (/health, /ping, /tutorial) working
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { log } = require('../utils/logger');
const { botState, bus, snapshot, emitState, pushChat } = require('../state');
const auth = require('./auth');
const { formatUptime } = require('../utils/helpers');
const { DATA_DIR } = require('../config');

const APP_VERSION = require('../../package.json').version;

function startDashboard(config, botManager, saveConfigFn) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const PUBLIC_DIR = path.join(__dirname, 'public');

  // ---------- public (unauthenticated) routes ----------

  app.get('/health', (req, res) => {
    // Legacy shape preserved + extras
    res.json({
      status: botState.connected ? 'connected' : 'disconnected',
      uptime: Math.floor((Date.now() - botState.startTime) / 1000),
      coords: botState.position,
      lastActivity: botState.lastActivity,
      reconnectAttempts: botState.reconnectAttempts,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      username: botState.username,
      serverVersion: botState.serverVersion,
      playersOnline: Object.keys(botState.players).length
    });
  });

  app.get('/ping', (req, res) => res.send('pong'));

  app.get('/tutorial', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>${config.name} - Setup Guide</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #cbd5e1; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1, h2 { color: #2dd4bf; }
    h1 { border-bottom: 2px solid #334155; padding-bottom: 10px; }
    .card { background: #1e293b; padding: 25px; border-radius: 12px; margin-bottom: 20px; border: 1px solid #334155; }
    a { color: #38bdf8; text-decoration: none; }
    code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #e2e8f0; font-family: monospace; }
    .btn-home { display: inline-block; margin-bottom: 20px; padding: 8px 16px; background: #334155; color: white; border-radius: 6px; text-decoration: none; }
  </style>
</head>
<body>
  <a href="/" class="btn-home">Back to Dashboard</a>
  <h1>Setup Guide (Under 15 Minutes)</h1>
  <div class="card">
    <h2>Step 1: Configure Aternos</h2>
    <ol>
      <li>Go to <strong>Aternos</strong>.</li>
      <li>Install <strong>Paper/Bukkit</strong> software.</li>
      <li>Enable <strong>Cracked</strong> mode (Green Switch).</li>
      <li>Install Plugins: <code>ViaVersion</code>, <code>ViaBackwards</code>, <code>ViaRewind</code>.</li>
    </ol>
  </div>
  <div class="card">
    <h2>Step 2: GitHub Setup</h2>
    <ol>
      <li>Download this code as ZIP and extract.</li>
      <li>Edit <code>settings.json</code> with your IP/Port (or use the dashboard Settings tab).</li>
      <li>Upload all files to a new <strong>GitHub Repository</strong>.</li>
    </ol>
  </div>
  <div class="card">
    <h2>Step 3: Render (Free 24/7 Hosting)</h2>
    <ol>
      <li>Go to <a href="https://render.com" target="_blank">Render.com</a> and create a Web Service.</li>
      <li>Connect your GitHub.</li>
      <li>Build Command: <code>npm install</code></li>
      <li>Start Command: <code>npm start</code></li>
      <li><strong>Magic:</strong> The bot automatically pings itself to stay awake!</li>
    </ol>
  </div>
  <div class="card">
    <h2>Step 4: Control Panel</h2>
    <ol>
      <li>Open your Render URL - you'll see the login screen.</li>
      <li>Default password: <code>changeme</code> (set your own in settings.json &rarr; <code>dashboard.password</code> or from the Settings tab).</li>
      <li>From the panel you can connect/disconnect the bot, send chat, watch the console live and edit settings.</li>
    </ol>
  </div>
  <p style="text-align: center; margin-top: 40px; color: #64748b;">AFK Bot Dashboard v3</p>
</body>
</html>`);
  });

  // ---------- auth ----------

  app.post('/api/login', auth.loginHandler);
  app.post('/api/logout', auth.logoutHandler);
  app.get('/api/session', auth.sessionHandler);

  // Everything below requires a valid session
  app.use('/api', auth.authMiddleware());

  // ---------- bot control API ----------

  app.get('/api/status', (req, res) => {
    res.json({
      ...snapshot(),
      server: {
        ip: config.server ? config.server.ip : null,
        port: config.server ? config.server.port : null,
        version: config.server ? config.server.version : ''
      },
      botName: config.name,
      manualStop: botState.manualStop,
      reconnecting: botManager.isReconnecting,
      history: botState.connectionHistory.slice(-30),
      errors: botState.errors.slice(-20),
      discordEnabled: !!(config.discord && config.discord.enabled),
      telegramEnabled: !!(config.telegram && config.telegram.enabled),
      storage: {
        persistent: Boolean(DATA_DIR),
        path: DATA_DIR || 'container (ephemeral - attach a volume!)'
      },
      version: APP_VERSION
    });
  });

  app.post('/api/bot/connect', (req, res) => {
    log('Dashboard', 'Command: connect');
    botManager.connect();
    res.json({ ok: true, message: 'Connecting...' });
  });

  app.post('/api/bot/disconnect', (req, res) => {
    log('Dashboard', 'Command: disconnect');
    botManager.disconnect();
    res.json({ ok: true, message: 'Bot disconnected from the server' });
  });

  app.post('/api/bot/reconnect', (req, res) => {
    log('Dashboard', 'Command: reconnect');
    botManager.reconnectNow();
    res.json({ ok: true, message: 'Reconnecting...' });
  });

  app.post('/api/chat', (req, res) => {
    const message = (req.body && req.body.message) || '';
    const err = botManager.sendChat(message);
    if (err) return res.status(400).json({ ok: false, error: err });
    pushChat({ username: botState.username, text: message });
    res.json({ ok: true });
  });

  // ---------- Live View (manual control) ----------

  app.post('/api/bot/control', (req, res) => {
    const { state, value } = req.body || {};
    if (!state) return res.status(400).json({ ok: false, error: 'state required' });
    const err = botManager.setControl(state, !!value);
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/clear-controls', (req, res) => {
    const err = botManager.clearControls();
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/look', (req, res) => {
    const { yaw, pitch } = req.body || {};
    const err = botManager.look(Number(yaw), Number(pitch));
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/look-at', (req, res) => {
    const { x, y, z } = req.body || {};
    if (x == null || y == null || z == null) return res.status(400).json({ ok: false, error: 'x, y, z required' });
    const err = botManager.lookAt(Number(x), Number(y), Number(z));
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/attack', (req, res) => {
    const err = botManager.attack();
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/activate', (req, res) => {
    const err = botManager.activateItem();
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/hotbar', (req, res) => {
    const { slot } = req.body || {};
    const err = botManager.setHotbar(Number(slot));
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  app.post('/api/bot/drop', (req, res) => {
    const err = botManager.dropHeld();
    if (err) return res.status(400).json({ ok: false, error: err });
    res.json({ ok: true });
  });

  // ---------- logs ----------

  app.get('/api/logs', (req, res) => {
    const type = req.query.type || 'console';
    if (type === 'chat') return res.json({ items: botState.chatLog.slice(-100) });
    res.json({ items: botState.consoleLog.slice(-150) });
  });

  // ---------- settings ----------

  app.get('/api/settings', (req, res) => {
    res.json(config);
  });

  // Fields that require a reconnect to take effect
  const RECONNECT_KEYS = ['server.ip', 'server.port', 'server.version', 'bot-account.username', 'bot-account.password', 'bot-account.type'];

  app.post('/api/settings', (req, res) => {
    const partial = req.body;
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
      return res.status(400).json({ ok: false, error: 'Invalid settings payload' });
    }

    try {
      const before = JSON.stringify({
        ip: config.server && config.server.ip,
        port: config.server && config.server.port,
        version: config.server && config.server.version,
        username: config['bot-account'] && config['bot-account'].username
      });

      saveConfigFn(partial);
      log('Dashboard', 'Settings updated from dashboard');

      const after = JSON.stringify({
        ip: config.server && config.server.ip,
        port: config.server && config.server.port,
        version: config.server && config.server.version,
        username: config['bot-account'] && config['bot-account'].username
      });

      const needsReconnect = before !== after;
      emitState('settings-updated');
      res.json({
        ok: true,
        needsReconnect,
        message: needsReconnect
          ? 'Saved. Server/account settings changed - press Reconnect to apply.'
          : 'Saved and applied live.'
      });
    } catch (e) {
      log('Dashboard', `Settings save failed: ${e.message}`);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ---------- SSE realtime stream ----------

  const sseClients = new Set();

  function sseSend(client, event, data) {
    try {
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) { /* client gone */ }
  }

  function broadcast(event, data) {
    sseClients.forEach(client => sseSend(client, event, data));
  }

  bus.on('state', (d) => broadcast('state', d));
  bus.on('chat', (d) => broadcast('chat', d));
  bus.on('console', (d) => broadcast('console', d));
  bus.on('error', (d) => broadcast('error', d));
  bus.on('history', (d) => broadcast('history', d));

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');

    const client = { req, res };
    sseClients.add(client);

    // Initial snapshot so the UI is immediately populated
    sseSend(client, 'snapshot', {
      state: snapshot(),
      chat: botState.chatLog.slice(-50),
      console: botState.consoleLog.slice(-100),
      history: botState.connectionHistory.slice(-30),
      errors: botState.errors.slice(-20)
    });

    // Heartbeat keeps proxies from closing the stream
    const hb = setInterval(() => {
      try { res.write(': hb\n\n'); } catch (e) { /* ignore */ }
    }, 25000);

    req.on('close', () => {
      clearInterval(hb);
      sseClients.delete(client);
    });
  });

  // ---------- static dashboard ----------

  app.use(express.static(PUBLIC_DIR));

  // SPA-ish fallback: everything else gets the panel
  app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // ---------- listen with port fallback ----------

  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    log('Server', `Dashboard ready on port ${server.address().port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const fallbackPort = Number(PORT) + 1;
      log('Server', `Port ${PORT} in use - trying port ${fallbackPort}`);
      server.listen(fallbackPort, '0.0.0.0');
    } else {
      log('Server', `HTTP server error: ${err.message}`);
    }
  });

  return { app, server, broadcast };
}

module.exports = { startDashboard };
