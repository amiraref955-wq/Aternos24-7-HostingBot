'use strict';

/**
 * BotManager - owns the mineflayer bot instance and its full lifecycle:
 * creation, connection timeouts, reconnection with exponential backoff,
 * throttle detection, manual controls (for the dashboard), periodic rejoin
 * and crash-recovery support.
 */
const mineflayer = require('mineflayer');
const { Movements, pathfinder } = require('mineflayer-pathfinder');
const { initializeModules } = require('./modules');
const { log } = require('../utils/logger');
const {
  botState, pushError, pushChat, pushHistory, emitState
} = require('../state');

// Classify a mineflayer entity into a radar-friendly kind
function entityKind(en) {
  if (!en) return 'unknown';
  if (en.type === 'player') return 'player';
  const HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch',
    'blaze', 'ghast', 'slime', 'magma_cube', 'silverfish', 'cave_spider',
    'guardian', 'elder_guardian', 'shulker', 'vex', 'vindicator', 'evoker',
    'pillager', 'ravager', 'hoglin', 'piglin', 'zoglin', 'warden', 'wither', 'phantom'];
  const PASSIVE = ['cow', 'sheep', 'pig', 'chicken', 'horse', 'donkey', 'mule', 'llama',
    'trader_llama', 'cat', 'ocelot', 'wolf', 'parrot', 'rabbit', 'fox', 'turtle',
    'cod', 'salmon', 'pufferfish', 'tropical_fish', 'squid', 'glow_squid',
    'axolotl', 'goat', 'frog', 'tadpole', 'allay', 'sniffer', 'camel', 'armadillo',
    'villager', 'wandering_trader', 'bat', 'mooshroom', 'bee', 'panda', 'polar_bear', 'strider'];
  const name = String(en.name || en.type || '').toLowerCase();
  if (HOSTILE.includes(name)) return 'hostile';
  if (PASSIVE.includes(name)) return 'passive';
  if (en.type === 'item' || en.type === 'item_entity') return 'item';
  if (en.type === 'mob' || en.kind === 'hostile') return 'hostile';
  if (en.type === 'animal') return 'passive';
  return en.type || 'unknown';
}

class BotManager {
  constructor(config, notifyFn) {
    this.config = config;
    this.notify = notifyFn;
    this.bot = null;

    // Timers
    this.activeIntervals = [];
    this.reconnectTimeoutId = null;
    this.connectionTimeoutId = null;
    this.periodicRejoinTimeoutId = null;
    this.isReconnecting = false;
    this.spawnHandled = false;
  }

  // ---------- interval registry (leak-safe) ----------

  addInterval(callback, delay) {
    const id = setInterval(callback, delay);
    this.activeIntervals.push(id);
    return id;
  }

  clearAllIntervals() {
    if (this.activeIntervals.length) {
      log('Cleanup', `Clearing ${this.activeIntervals.length} intervals`);
      this.activeIntervals.forEach(id => clearInterval(id));
      this.activeIntervals = [];
    }
  }

  // ---------- timeout helpers ----------

  clearBotTimeouts() {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
  }

  // ---------- reconnection delay ----------

  getReconnectDelay() {
    if (botState.wasThrottled) {
      botState.wasThrottled = false;
      const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
      log('Bot', `Throttle detected - using extended delay: ${throttleDelay / 1000}s`);
      return throttleDelay;
    }

    // Back off after a duplicate-login kick: stop the endless tug-of-war
    // between two sessions sharing one username. The OTHER session then
    // holds the name and stabilizes instead of both sides kicking each
    // other every few seconds.
    if (botState.wasDuplicateLogin) {
      botState.wasDuplicateLogin = false;
      const dupDelay = 45000 + Math.floor(Math.random() * 30000);
      log('Bot', `Duplicate-login kick - backing off ${Math.round(dupDelay / 1000)}s to avoid the username war`);
      return dupDelay;
    }

    const utils = this.config.utils || {};
    const baseDelay = utils['auto-reconnect-delay'] || 3000;
    const maxDelay = utils['max-reconnect-delay'] || 120000;
    const delay = Math.min(baseDelay * Math.pow(2, botState.reconnectAttempts), maxDelay);
    return delay + Math.floor(Math.random() * 2000);
  }

  // ---------- public control API (used by dashboard & console) ----------

  /** Manual connect from the dashboard */
  connect() {
    botState.manualStop = false;
    botState.forceReconnect = false;
    this.clearBotTimeouts();
    this.isReconnecting = false;
    this.createBot();
  }

  /** Manual disconnect from the dashboard - bot leaves the server and stays out */
  disconnect() {
    if (!this.bot) {
      botState.manualStop = true;
      this.clearBotTimeouts();
      this.isReconnecting = false;
      emitState('manual-disconnect');
      return;
    }
    log('Bot', 'Manual disconnect requested from dashboard');
    botState.manualStop = true;
    botState.forceReconnect = false;
    this.isReconnecting = false;
    this.clearBotTimeouts();
    try {
      this.bot.removeAllListeners();
      this.bot.end();
    } catch (e) { /* ignore */ }
    this.bot = null;
    botState.connected = false;
    pushHistory({ event: 'manual-disconnect', detail: 'Stopped from dashboard' });
    emitState('manual-disconnect');
  }

  /** Force an immediate reconnect (skips manual-stop and auto-reconnect config) */
  reconnectNow() {
    log('Bot', 'Manual reconnect requested');
    botState.manualStop = false;
    botState.forceReconnect = true;
    if (this.bot) {
      try {
        this.bot.removeAllListeners();
        this.bot.end();
      } catch (e) { /* ignore */ }
      this.bot = null;
    }
    this.clearBotTimeouts();
    this.clearAllIntervals();
    botState.connected = false;
    this.isReconnecting = false;
    setTimeout(() => {
      if (!botState.manualStop) this.createBot();
    }, 1000);
  }

  /** True when a bot object exists and is connected */
  isConnected() {
    return !!(this.bot && botState.connected);
  }

  /** Send a chat message or command to the server. Returns error string or null. */
  sendChat(message) {
    if (!this.isConnected()) return 'Bot is not connected';
    if (!message || !String(message).trim()) return 'Empty message';
    try {
      this.bot.chat(String(message).trim());
      return null;
    } catch (e) {
      return e.message;
    }
  }

  // ---------- live manual control (dashboard "Live" tab) ----------

  /**
   * Set a movement control state.
   * @param {string} state forward|back|left|right|jump|sneak|sprint
   * @param {boolean} value true=pressed, false=released
   */
  setControl(state, value) {
    if (!this.isConnected() || typeof this.bot.setControlState !== 'function') return 'Bot is not connected';
    if (!['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].includes(state)) return 'Invalid control state';
    try {
      this.bot.setControlState(state, !!value);
      return null;
    } catch (e) { return e.message; }
  }

  /** Release all movement control states */
  clearControls() {
    if (!this.isConnected()) return 'Bot is not connected';
    try { this.bot.clearControlStates(); return null; } catch (e) { return e.message; }
  }

  /** Set look direction (yaw/pitch in radians) */
  look(yaw, pitch) {
    if (!this.isConnected()) return 'Bot is not connected';
    if (typeof yaw !== 'number' || typeof pitch !== 'number') return 'Invalid yaw/pitch';
    try { this.bot.look(yaw, pitch, false); return null; } catch (e) { return e.message; }
  }

  /** Look at a specific world coordinate */
  lookAt(x, y, z) {
    if (!this.isConnected()) return 'Bot is not connected';
    try {
      const vec3 = require('vec3');
      this.bot.lookAt(vec3(Number(x), Number(y), Number(z)));
      return null;
    } catch (e) { return e.message; }
  }

  /** Attack the entity currently in line of sight, or nothing if none */
  attack() {
    if (!this.isConnected()) return 'Bot is not connected';
    try {
      const ent = this.bot.entityAtCursor(4);
      if (ent) this.bot.attack(ent);
      return ent ? null : 'Nothing in range';
    } catch (e) { return e.message; }
  }

  /** Right-click / activate held item */
  activateItem() {
    if (!this.isConnected()) return 'Bot is not connected';
    try { this.bot.activateItem(); return null; } catch (e) { return e.message; }
  }

  /** Set hotbar slot 0-8 */
  setHotbar(slot) {
    if (!this.isConnected()) return 'Bot is not connected';
    if (typeof slot !== 'number' || slot < 0 || slot > 8) return 'Invalid slot';
    try { this.bot.setQuickBarSlot(slot); return null; } catch (e) { return e.message; }
  }

  /** Drop / toss the held item stack */
  dropHeld() {
    if (!this.isConnected()) return 'Bot is not connected';
    try {
      const held = this.bot.inventory.slots[this.bot.quickBarSlot + 36];
      if (held) this.bot.tossStack(held);
      return held ? null : 'Nothing to drop';
    } catch (e) { return e.message; }
  }

  // ---------- core lifecycle ----------

  createBot() {
    if (this.isReconnecting) {
      log('Bot', 'Already reconnecting, skipping...');
      return;
    }
    if (botState.manualStop) {
      log('Bot', 'Manual stop is active - skipping auto create');
      return;
    }

    // Cleanup previous bot properly to avoid ghost bots
    if (this.bot) {
      this.clearAllIntervals();
      try {
        this.bot.removeAllListeners();
        this.bot.end();
      } catch (e) {
        log('Cleanup', `Error ending previous bot: ${e.message}`);
      }
      this.bot = null;
    }

    const server = this.config.server || {};
    const account = this.config['bot-account'] || {};
    log('Bot', 'Creating bot instance...');
    log('Bot', `Connecting to ${server.ip}:${server.port}`);

    try {
      // version:false lets mineflayer auto-detect the server version
      const botVersion = server.version && String(server.version).trim() !== '' ? server.version : false;
      this.bot = mineflayer.createBot({
        username: account.username,
        password: account.password || undefined,
        auth: account.type,
        host: server.ip,
        port: server.port,
        version: botVersion,
        hideErrors: false,
        checkTimeoutInterval: 600000
      });

      this.bot.loadPlugin(pathfinder);
      botState.username = account.username;
      emitState('bot-created');

      // Connection timeout - end the dead attempt and schedule a retry
      this.clearBotTimeouts();
      this.connectionTimeoutId = setTimeout(() => {
        if (!botState.connected) {
          log('Bot', 'Connection timeout - no spawn received');
          try {
            this.bot.removeAllListeners();
            this.bot.end();
          } catch (e) { /* ignore */ }
          this.bot = null;
          this.scheduleReconnect();
        }
      }, 150000); // 150s - Aternos can take 90-120s to spawn a player

      this.wireEvents();
    } catch (err) {
      log('Bot', `Failed to create bot: ${err.message}`);
      pushError({ type: 'create', message: err.message });
      this.scheduleReconnect();
    }
  }

  wireEvents() {
    const bot = this.bot;
    const cfg = this.config;

    // Guard against spawn firing twice (happens on some servers)
    this.spawnHandled = false;

    bot.once('spawn', () => {
      if (this.spawnHandled) return;
      this.spawnHandled = true;

      this.clearBotTimeouts();
      botState.connected = true;
      botState.manualStop = false;
      botState.forceReconnect = false;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      botState.reconnectsCount++;
      botState.spawnTime = Date.now();
      botState.serverVersion = bot.version;
      this.isReconnecting = false;

      log('Bot', `[+] Successfully spawned on server! (Version: ${bot.version})`);
      pushHistory({ event: 'connect', detail: `Spawned as ${botState.username} on ${cfg.server.ip}` });
      emitState('spawn');
      this.notify(cfg, 'connect', `Connected to \`${cfg.server.ip}\``);

      // Attach the live 3D viewer (best effort - never block the bot)
      try {
        require('./liveViewer').setBot(bot);
      } catch (e) {
        log('Viewer', `Failed to attach viewer: ${e.message}`);
      }

      // Use bot.version (auto-detected) so minecraft-data always matches the server
      const mcData = require('minecraft-data')(bot.version);
      const defaultMove = new Movements(bot, mcData);
      defaultMove.allowFreeMotion = false;
      defaultMove.canDig = false;
      defaultMove.liquidCost = 1000;
      defaultMove.fallDamageCost = 1000;

      // Module context - alive() guards every interval, touch() tracks activity
      const ctx = {
        config: cfg,
        intervals: { add: (fn, d) => this.addInterval(fn, d) },
        log,
        alive: () => !!(this.bot && botState.connected && this.bot.entity),
        touch: () => { botState.lastActivity = Date.now(); }
      };

      initializeModules(bot, mcData, defaultMove, ctx);

      // Periodic position sync for the dashboard
      this.addInterval(() => {
        if (!this.isConnected() || !this.bot.entity) return;
        botState.position = {
          x: Math.floor(this.bot.entity.position.x),
          y: Math.floor(this.bot.entity.position.y),
          z: Math.floor(this.bot.entity.position.z)
        };
        emitState('position');
      }, 5000);

      // Optional creative mode attempt (requires OP)
      setTimeout(() => {
        if (this.isConnected() && cfg.server && cfg.server['try-creative']) {
          bot.chat('/gamemode creative');
          log('INFO', 'Attempted to set creative mode (requires OP)');
        }
      }, 3000);

      // Creative-mode confirmation listener
      bot.on('messagestr', (message) => {
        if (
          message.includes('commands.gamemode.success.self') ||
          message.includes('Set own game mode to Creative Mode')
        ) {
          botState.gameMode = 'creative';
          log('INFO', 'Bot is now in Creative Mode.');
        }
      });
    });

    // Live in-game stats for the dashboard
    bot.on('health', () => {
      botState.health = bot.health;
      botState.food = bot.food;
      botState.oxygenLevel = bot.oxygenLevel;
      botState.experience = bot.experience;
      botState.level = bot.level;
      botState.gameMode = bot.game ? botState.gameMode : botState.gameMode;
      emitState('health');
    });

    // High-rate live telemetry for the Live View tab (position/yaw/pitch/inventory/entities)
    this.addInterval(() => {
      if (!this.isConnected() || !this.bot.entity) return;
      try {
        const e = this.bot.entity;
        botState.position = {
          x: Math.floor(e.position.x),
          y: Math.floor(e.position.y),
          z: Math.floor(e.position.z)
        };
        botState.yaw = e.yaw;
        botState.pitch = e.pitch;
        botState.heldSlot = this.bot.quickBarSlot;

        // Inventory snapshot
        const items = (this.bot.inventory && this.bot.inventory.items) ? this.bot.inventory.items() : [];
        botState.inventory = items.map(it => ({
          slot: it.slot,
          name: it.name,
          count: it.count,
          displayName: (it.displayName || it.name || '').toString()
        }));

        // Nearby entities (within 32 blocks) - filter to keep payload small
        const all = Object.values(this.bot.entities || {});
        const me = e.position;
        botState.nearbyEntities = all
          .filter(en => {
            if (!en || !en.position || en === e) return false;
            if (!en.type || en.type === 'object') return false;
            const dx = en.position.x - me.x;
            const dz = en.position.z - me.z;
            const dy = en.position.y - me.y;
            return (dx * dx + dy * dy + dz * dz) <= 32 * 32;
          })
          .map(en => {
            const dx = en.position.x - me.x;
            const dy = en.position.y - me.y;
            const dz = en.position.z - me.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const kind = entityKind(en);
            return {
              id: en.id,
              type: en.type,
              name: (en.username || en.name || en.displayName || en.type || '').toString(),
              pos: { x: en.position.x, y: en.position.y, z: en.position.z },
              dx: dx, dz: dz,
              distance: Math.round(distance * 10) / 10,
              kind
            };
          })
          .slice(0, 60); // cap

        // Block under the bot
        try {
          const b = this.bot.blockAt(e.position.offset(0, -1, 0));
          if (b) botState.blockUnder = { name: b.name, position: { x: b.position.x, y: b.position.y, z: b.position.z } };
        } catch (_) { /* ignore */ }

        emitState('live-tick');
      } catch (_) { /* ignore - don't crash telemetry loop */ }
    }, 200);

    bot.on('messagestr', (message) => {
      pushChat({ text: message });
    });

    bot.on('playerJoined', (player) => {
      if (player && player.username) {
        botState.players[player.username] = { ping: player.ping || 0 };
        emitState('player-joined');
      }
    });

    bot.on('playerLeft', (player) => {
      if (player && player.username) {
        delete botState.players[player.username];
        emitState('player-left');
      }
    });

    // 'kicked' fires before 'end'. Do NOT reconnect here -
    // 'end' is the single source of reconnect truth (prevents double-trigger).
    bot.on('kicked', (reason) => {
      const kickReason = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      log('Bot', `Kicked: ${kickReason}`);
      botState.connected = false;
      pushError({ type: 'kicked', reason: kickReason });
      pushHistory({ event: 'kick', detail: kickReason.slice(0, 200) });
      this.clearAllIntervals();

      const reasonStr = kickReason.toLowerCase();
      if (reasonStr.includes('throttl') || reasonStr.includes('wait before reconnect') || reasonStr.includes('too fast')) {
        log('Bot', 'Throttle kick detected - will use extended reconnect delay');
        botState.wasThrottled = true;
      }

      // Duplicate-login war: another session/bot is using the SAME username.
      // Typical when the bot is deployed on TWO hosts at once (Render + Railway,
      // two services, or a local copy) - each login kicks the other forever.
      if (reasonStr.includes('another location') || reasonStr.includes('already logged in') || reasonStr.includes('you logged in from')) {
        botState.wasDuplicateLogin = true;
        botState.duplicateLoginKicks = (botState.duplicateLoginKicks || 0) + 1;
        log('Bot', 'DUPLICATE LOGIN detected - another session is using this username!');
        log('Bot', '>> If this bot runs on two hosts (Render + Railway, two services, local copy), STOP one of them.');
        pushHistory({
          event: 'duplicate-login',
          detail: `Two bots share the username "${botState.username}" (kick #${botState.duplicateLoginKicks}). Stop the other instance!`
        });
        this.notify(cfg, 'duplicate-login', 'Another session is using the bot username - stop the second instance!');
      }

      this.notify(cfg, 'kick', kickReason.slice(0, 300));
      emitState('kicked');
    });

    // 'end' handles all reconnection logic
    bot.on('end', (reason) => {
      log('Bot', `Disconnected: ${reason || 'Unknown reason'}`);
      const wasForced = botState.forceReconnect;
      const wasManual = botState.manualStop;
      botState.connected = false;
      botState.players = {};
      botState.spawnTime = null;
      botState.health = null;
      botState.food = null;
      this.clearAllIntervals();
      this.spawnHandled = false;
      emitState('end');

      // Drop 3D viewer clients - they will see "bot offline" until reconnect
      try {
        require('./liveViewer').clearBot();
      } catch (e) { /* ignore */ }

      if (!wasManual && reason !== 'Periodic Rejoin') {
        pushHistory({ event: 'disconnect', detail: String(reason || 'Unknown').slice(0, 200) });
        this.notify(cfg, 'disconnect', reason || 'Unknown');
      }

      if (wasForced) {
        // reconnectNow() already schedules the retry itself
        return;
      }
      if (wasManual) {
        log('Bot', 'Manual stop active - not reconnecting');
        return;
      }

      const utils = cfg.utils || {};
      if (utils['auto-reconnect']) {
        this.scheduleReconnect();
      }
    });

    bot.on('error', (err) => {
      const msg = (err && err.message) || '';
      log('Bot', `Error: ${msg}`);
      pushError({ type: 'error', message: msg });
      // Don't reconnect on error - the 'end' event handles it
    });
  }

  scheduleReconnect() {
    this.clearBotTimeouts();

    // Don't stack reconnects if one is already pending
    if (this.isReconnecting) {
      log('Bot', 'Reconnect already scheduled, skipping duplicate.');
      return;
    }
    if (botState.manualStop) {
      log('Bot', 'Manual stop active - reconnect cancelled');
      return;
    }

    this.isReconnecting = true;
    botState.reconnectAttempts++;

    const delay = this.getReconnectDelay();
    log('Bot', `Reconnecting in ${Math.round(delay / 1000)}s (attempt #${botState.reconnectAttempts})`);
    emitState('reconnect-scheduled');

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.isReconnecting = false;
      this.createBot();
    }, delay);
  }

  // ---------- periodic rejoin ----------

  schedulePeriodicRejoin() {
    const pr = (this.config.utils && this.config.utils['periodic-rejoin']) || {};
    if (!pr.enabled) return;

    const min = (pr['min-interval'] || 20) * 60 * 1000;
    const max = (pr['max-interval'] || 60) * 60 * 1000;
    const delay = min + Math.floor(Math.random() * (max - min));

    this.periodicRejoinTimeoutId = setTimeout(() => {
      if (!this.isConnected()) return;
      log('Bot', 'Periodic rejoin triggered - cycling connection');
      pushHistory({ event: 'periodic-rejoin', detail: 'Cycling connection' });
      try {
        this.bot.end('Periodic Rejoin');
      } catch (e) { /* ignore */ }
    }, delay);
  }

  // ---------- crash recovery (called from process handlers) ----------

  crashRecover(isNetworkError) {
    this.clearAllIntervals();
    botState.connected = false;
    emitState('crash-recovery');

    // Reset a stuck reconnect flag (old code had a ReferenceError here!)
    if (this.isReconnecting) {
      log('FATAL', 'isReconnecting was stuck - resetting before crash recovery');
      this.isReconnecting = false;
      if (this.reconnectTimeoutId) {
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
      }
    }

    setTimeout(() => {
      this.scheduleReconnect();
    }, isNetworkError ? 5000 : 10000);
  }
}

module.exports = { BotManager };
