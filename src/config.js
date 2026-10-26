'use strict';

/**
 * Config loader with defaults merge + save support.
 * User settings.json always wins over defaults, so existing deployments
 * keep working even when new config sections are introduced.
 */
const fs = require('fs');
const path = require('path');

// src/config.js -> project root is one level up
const APP_ROOT = path.join(__dirname, '..');
const BUNDLED_SETTINGS = path.join(APP_ROOT, 'settings.json');

const DEFAULTS = {
  name: 'Minecraft AFK Bot',
  'bot-account': {
    username: 'PlayerBot',
    password: '',
    type: 'offline'
  },
  server: {
    ip: 'localhost',
    port: 25565,
    version: '',
    'try-creative': false
  },
  position: {
    enabled: false,
    x: 0,
    y: 100,
    z: 0
  },
  utils: {
    'auto-auth': { enabled: false, password: '' },
    'anti-afk': { enabled: true, sneak: true },
    'chat-messages': { enabled: false, repeat: true, 'repeat-delay': 120, messages: [] },
    'chat-log': true,
    'auto-reconnect': true,
    'auto-reconnect-delay': 3000,
    'max-reconnect-delay': 120000,
    'periodic-rejoin': { enabled: false, 'min-interval': 20, 'max-interval': 60 }
  },
  movement: {
    enabled: true,
    'circle-walk': { enabled: false, radius: 4, speed: 3000 },
    'look-around': { enabled: true, interval: 5000 },
    'random-jump': { enabled: false, interval: 10000 }
  },
  modules: {
    avoidMobs: false,
    combat: false,
    beds: false,
    chat: true,
    'console-commands': true
  },
  combat: {
    'attack-mobs': true,
    'auto-eat': true
  },
  beds: {
    'pick-up-day': false,
    'place-night': false
  },
  discord: {
    enabled: false,
    webhookUrl: '',
    events: { connect: true, disconnect: true, chat: false }
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    events: { connect: true, disconnect: true, kick: true, errors: false }
  },
  dashboard: {
    enabled: true,
    password: 'changeme',
    title: 'Aternos Bot Panel'
  },
  chat: {
    respond: true
  },
  'live-viewer': {
    enabled: true,
    'view-distance': 3,
    'max-clients': 2
  }
};

function isPlainObject(obj) {
  return obj && typeof obj === 'object' && !Array.isArray(obj);
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source || {})) {
    if (isPlainObject(source[key]) && isPlainObject(target[key])) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

/* ============================================================
 *  Persistence location
 * ============================================================
 *  On Railway / Render / any container host the app folder is
 *  EPHEMERAL: every restart or redeploy resets it, so settings
 *  saved from the panel would silently revert to the image copy.
 *
 *  Fix: attach a persistent volume. Railway injects
 *  RAILWAY_VOLUME_MOUNT_PATH automatically when a volume is
 *  attached (or set DATA_DIR manually, e.g. DATA_DIR=/data).
 *  When a usable data dir exists, settings.json lives there and
 *  survives redeploys. A fresh volume is auto-seeded from the
 *  bundled settings.json so the first boot starts with the
 *  committed configuration.
 */
function resolveDataDir() {
  const wanted = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR;
  if (!wanted) return null;
  try {
    fs.mkdirSync(wanted, { recursive: true });
    fs.accessSync(wanted, fs.constants.W_OK);
    console.log(`[Config] Persistent storage enabled: ${wanted}`);
    return wanted;
  } catch (e) {
    console.log(`[Config] WARNING: data dir "${wanted}" is not writable (${e.code || e.message}).`);
    console.log('[Config] Falling back to the app folder - settings WILL be lost on redeploy!');
    return null;
  }
}

const DATA_DIR = resolveDataDir();
const SETTINGS_PATH = DATA_DIR ? path.join(DATA_DIR, 'settings.json') : path.join(APP_ROOT, 'settings.json');

// First boot on a fresh volume: seed it with the bundled settings.json
// (or bare defaults when the repo ships without one).
if (DATA_DIR && !fs.existsSync(SETTINGS_PATH)) {
  try {
    const seed = fs.existsSync(BUNDLED_SETTINGS)
      ? fs.readFileSync(BUNDLED_SETTINGS, 'utf8')
      : JSON.stringify(DEFAULTS, null, 2);
    fs.writeFileSync(SETTINGS_PATH, seed, 'utf8');
    console.log(`[Config] Seeded fresh data dir with initial settings -> ${SETTINGS_PATH}`);
  } catch (e) {
    console.log(`[Config] Could not seed data dir: ${e.message}`);
  }
}

let config = null;

function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    console.log(`[Config] Failed to read settings.json: ${e.message} - using defaults`);
  }
  config = deepMerge(DEFAULTS, raw);
  return config;
}

function getConfig() {
  if (!config) loadConfig();
  return config;
}

// Merge a partial config object into the live config and persist to disk.
// Returns the merged config.
function saveConfig(partial) {
  config = deepMerge(config, partial);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

module.exports = { loadConfig, getConfig, saveConfig, SETTINGS_PATH, DATA_DIR, APP_ROOT, DEFAULTS };
