'use strict';

/**
 * Notification dispatcher - routes events to Discord and/or Telegram
 * based on the event flags configured in settings.json.
 *
 * Event types: "connect" | "disconnect" | "kick" | "error"
 */
const discord = require('./discord');
const telegram = require('./telegram');
const { log } = require('../utils/logger');

const COLORS = {
  connect: 0x4ade80,
  disconnect: 0xf87171,
  kick: 0xff0000,
  error: 0xfbbf24,
  info: 0x0099ff
};

const ICONS = {
  connect: '[+]',
  disconnect: '[-]',
  kick: '[!]',
  error: '[x]',
  info: '[i]'
};

/**
 * @param {object} config - live config object (reads discord/telegram sections each call)
 * @param {string} type   - one of: connect | disconnect | kick | error | info
 * @param {string} message - human readable message (markdown allowed for Discord)
 */
function notify(config, type, message) {
  const icon = ICONS[type] || ICONS.info;
  const text = `${icon} **${type.toUpperCase()}**: ${message}`;

  // Discord
  const dEvents = (config.discord && config.discord.events) || {};
  if (type === 'info' || dEvents[type]) {
    try { discord.send(config.discord, text, COLORS[type] || COLORS.info); } catch (e) { /* never crash on notifications */ }
  }

  // Telegram
  const tEvents = (config.telegram && config.telegram.events) || {};
  if (type === 'info' || tEvents[type]) {
    const tgText = text.replace(/\*\*/g, '').replace(/`/g, '');
    try { telegram.send(config.telegram, tgText); } catch (e) { /* never crash on notifications */ }
  }
}

module.exports = { notify };
