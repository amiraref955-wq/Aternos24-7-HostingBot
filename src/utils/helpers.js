'use strict';

/**
 * Shared helpers.
 */

// Format seconds as "1h 2m 3s"
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// Format a timestamp as HH:MM:SS
function formatTime(ts) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

// Clamp a number between min and max
function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}

// Safe random integer in [min, max]
function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

module.exports = { formatUptime, formatTime, clamp, randomInt };
