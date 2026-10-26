'use strict';

/**
 * Central bot state - single source of truth shared across all subsystems.
 * Also hosts the event bus used by the dashboard (SSE) for realtime updates.
 */
const { EventEmitter } = require('events');

const botState = {
  // Connection
  connected: false,
  username: null,
  serverVersion: null,
  spawnTime: null,
  startTime: Date.now(),
  lastActivity: Date.now(),

  // Reconnection bookkeeping
  reconnectAttempts: 0,
  reconnectsCount: 0,
  manualStop: false,
  forceReconnect: false,
  wasThrottled: false,

  // Live in-game data (updated on spawn/health events)
  health: null,
  food: null,
  gameMode: null,
  position: null,
  players: {},        // { username: { ping, gamemode } }

  // Ring buffers (for dashboard)
  errors: [],
  chatLog: [],
  consoleLog: [],
  connectionHistory: []
};

const MAX_ERRORS = 50;
const MAX_CHAT = 200;
const MAX_CONSOLE = 400;
const MAX_HISTORY = 100;

// Event bus for realtime distribution (dashboard SSE subscribes to this)
const bus = new EventEmitter();
bus.setMaxListeners(100);

function pushError(entry) {
  const item = { type: entry.type || 'error', message: entry.message || entry.reason || 'Unknown', time: entry.time || Date.now() };
  botState.errors.push(item);
  if (botState.errors.length > MAX_ERRORS) botState.errors.shift();
  bus.emit('error', item);
  return item;
}

function pushChat(entry) {
  const item = { username: entry.username || null, text: entry.text || '', time: entry.time || Date.now() };
  botState.chatLog.push(item);
  if (botState.chatLog.length > MAX_CHAT) botState.chatLog.shift();
  bus.emit('chat', item);
  return item;
}

function pushConsole(entry) {
  const item = { text: entry.text || '', level: entry.level || 'info', time: entry.time || Date.now() };
  botState.consoleLog.push(item);
  if (botState.consoleLog.length > MAX_CONSOLE) botState.consoleLog.shift();
  bus.emit('console', item);
  return item;
}

function pushHistory(entry) {
  const item = { event: entry.event, detail: entry.detail || '', time: entry.time || Date.now() };
  botState.connectionHistory.push(item);
  if (botState.connectionHistory.length > MAX_HISTORY) botState.connectionHistory.shift();
  bus.emit('history', item);
  return item;
}

// Emit state changes so the dashboard can update instantly
function emitState(reason) {
  bus.emit('state', { reason: reason || 'update', state: snapshot() });
}

// Serializable snapshot for the dashboard / health endpoint
function snapshot() {
  return {
    connected: botState.connected,
    username: botState.username,
    serverVersion: botState.serverVersion,
    startTime: botState.startTime,
    spawnTime: botState.spawnTime,
    lastActivity: botState.lastActivity,
    reconnectAttempts: botState.reconnectAttempts,
    reconnectsCount: botState.reconnectsCount,
    manualStop: botState.manualStop,
    health: botState.health,
    food: botState.food,
    gameMode: botState.gameMode,
    position: botState.position,
    players: botState.players,
    memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
    uptime: Math.floor((Date.now() - botState.startTime) / 1000)
  };
}

module.exports = {
  botState,
  bus,
  pushError,
  pushChat,
  pushConsole,
  pushHistory,
  emitState,
  snapshot
};
