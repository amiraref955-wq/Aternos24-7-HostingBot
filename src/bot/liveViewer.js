'use strict';

/**
 * LiveViewer - real 3D first-person view of the bot through the browser.
 *
 * Uses prismarine-viewer's WorldView (chunk streaming) but attaches to the
 * SAME express/http server as the dashboard under the /viewer path, so it
 * works on single-port hosts like Render's free tier.
 *
 * Protocol (socket.io):
 *   server -> client: version, position, loadChunk, unloadChunk,
 *                     blockUpdate, entity, primitive
 *   client -> server: mouseClick (optional, unused here)
 *
 * The web client is served from node_modules/prismarine-viewer/public and
 * connects to `window.location.pathname + "socket.io"`, which resolves to
 * /viewer/socket.io - exactly where our io server is mounted.
 */

const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const compression = require('compression');
const { WorldView } = require('prismarine-viewer/viewer/lib/worldView');
const { log } = require('../utils/logger');
const { getConfig } = require('../config');
const { isAuthed } = require('../dashboard/auth');

// The viewer's static web client lives inside the npm package
const VIEWER_PUBLIC = path.join(
  path.dirname(require.resolve('prismarine-viewer/package.json')),
  'public'
);

class LiveViewer {
  constructor() {
    this.io = null;
    this.bot = null;
    this.sockets = new Set(); // active viewer sockets (with their WorldView)
  }

  /**
   * Wire the viewer into the dashboard's express app + http server.
   * Called once at boot. Auth is enforced on both HTTP and websocket.
   */
  attachServer(expressApp, httpServer) {
    // Static client files (three.js bundle, textures, block states)
    expressApp.use(
      '/viewer',
      (req, res, next) => {
        // Page-level auth: same session cookie as the dashboard
        if (!isAuthed(req.headers.cookie)) return res.status(401).send('Unauthorized - log in to the panel first');
        next();
      },
      compression(),
      express.static(VIEWER_PUBLIC)
    );

    this.io = new Server(httpServer, {
      path: '/viewer/socket.io',
      perMessageDeflate: { threshold: 16 * 1024 }, // chunk JSON compresses very well
      pingInterval: 25000,
      pingTimeout: 60000
    });

    // Handshake auth - reject sockets without a valid dashboard session
    this.io.use((socket, next) => {
      if (isAuthed(socket.handshake.headers.cookie)) return next();
      next(new Error('unauthorized'));
    });

    this.io.on('connection', (socket) => this.onConnection(socket));
    log('Viewer', 'Live 3D viewer mounted at /viewer (socket path /viewer/socket.io)');
  }

  /** Handle a browser client connecting to the viewer */
  onConnection(socket) {
    const cfg = (getConfig()['live-viewer']) || {};
    if (cfg.enabled === false) {
      socket.emit('viewer-status', { error: '3D viewer is disabled in settings' });
      socket.disconnect(true);
      return;
    }

    // Cap concurrent viewers - each one streams chunks and costs memory
    const maxClients = Math.max(1, cfg['max-clients'] || 2);
    if (this.sockets.size >= maxClients) {
      log('Viewer', 'Max clients reached - rejecting viewer connection');
      socket.emit('viewer-status', { error: 'Too many viewers connected' });
      socket.disconnect(true);
      return;
    }

    if (!this.bot || !this.bot.world || !this.bot.entity) {
      socket.emit('viewer-status', { error: 'Bot is not connected yet' });
      socket.disconnect(true);
      return;
    }

    const viewDistance = Math.max(2, Math.min(8, cfg['view-distance'] || 3));
    log('Viewer', `Viewer client connected (${this.sockets.size + 1}/${maxClients}, viewDistance=${viewDistance})`);

    socket.emit('version', this.bot.version);

    // Stream world chunks to this client
    const worldView = new WorldView(this.bot.world, viewDistance, this.bot.entity.position, socket);
    try {
      worldView.init(this.bot.entity.position); // pushes the initial chunk spiral
    } catch (e) {
      log('Viewer', `worldView.init error: ${e.message}`);
    }
    worldView.listenToBot(this.bot);

    // First-person camera follows the bot's head
    const botPosition = () => {
      if (!this.bot || !this.bot.entity) return;
      // Convert Minecraft yaw/pitch to the three.js camera convention:
      //   MC: yaw 0 = +Z (south), CCW; pitch + = down
      //   THREE: rotation.y 0 = -Z, CW; rotation.x + = up
      // => cameraYaw = -mcYaw + PI, cameraPitch = -mcPitch
      const e = this.bot.entity;
      socket.emit('position', {
        pos: e.position,
        yaw: -e.yaw + Math.PI,
        pitch: -e.pitch,
        addMesh: false
      });
      worldView.updatePosition(e.position);
    };
    this.bot.on('move', botPosition);

    socket.on('disconnect', () => {
      if (this.bot) this.bot.removeListener('move', botPosition);
      try { worldView.removeListenersFromBot(this.bot); } catch (e) { /* bot already gone */ }
      this.sockets.delete(entry);
      log('Viewer', `Viewer client disconnected (${this.sockets.size} left)`);
    });

    const entry = { socket, worldView };
    this.sockets.add(entry);
  }

  /** Called by BotManager when a bot spawns - starts streaming to viewers */
  setBot(bot) {
    this.bot = bot;
    log('Viewer', 'Bot attached - 3D viewer streaming enabled');
  }

  /** Called by BotManager when the bot ends - drop all viewer clients */
  clearBot() {
    this.bot = null;
    for (const { socket } of this.sockets) {
      try { socket.disconnect(true); } catch (e) { /* ignore */ }
    }
    this.sockets.clear();
  }
}

// Singleton - shared between index.js (attach) and botManager.js (lifecycle)
module.exports = new LiveViewer();
module.exports.LiveViewer = LiveViewer;
