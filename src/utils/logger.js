'use strict';

/**
 * Logger with global console capture.
 * Every console.log line (including mineflayer internals) is mirrored into
 * the central ring buffer so the dashboard console tab shows everything live.
 */
const { pushConsole } = require('../state');

const originalConsoleLog = console.log.bind(console);

let initialized = false;

function log(tag, message) {
  originalConsoleLog(`[${tag}] ${message}`);
}

/**
 * Wrap console.log so all output appears in the dashboard console feed.
 * Safe to call once at boot.
 */
function initConsoleCapture() {
  if (initialized) return;
  initialized = true;

  console.log = (...args) => {
    const text = args
      .map(a => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return a.message;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      })
      .join(' ');

    originalConsoleLog(text);

    const level = text.includes('[FATAL]') || text.includes('Error')
      ? 'error'
      : text.includes('[Cleanup]') || text.includes('skipping') ? 'warn' : 'info';

    pushConsole({ text, level });
  };
}

module.exports = { log, initConsoleCapture };
