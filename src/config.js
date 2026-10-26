'use strict';

/**
 * Config loader with defaults merge + save support.
 * User settings.json always wins over defaults, so existing deployments
 * keep working even when new config sections are introduced.
 */
const fs = require('fs');
const path = require('path');

// src/config.js -> project root is one level up
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');

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

module.exports = { loadConfig, getConfig, saveConfig, SETTINGS_PATH, DEFAULTS };
