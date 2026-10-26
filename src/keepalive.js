'use strict';

/**
 * Keep-alive systems:
 *  - Self-ping: pings the Render external URL so the free instance never sleeps.
 *  - Memory monitor: periodic heap usage logging (also feeds the dashboard).
 */
const http = require('http');
const https = require('https');
const { log } = require('./utils/logger');
const { emitState } = require('./state');

const SELF_PING_INTERVAL = 10 * 60 * 1000;   // 10 min
const MEMORY_LOG_INTERVAL = 5 * 60 * 1000;   // 5 min

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    log('KeepAlive', 'No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)');
    return;
  }
  setInterval(() => {
    const protocol = renderUrl.startsWith('https') ? https : http;
    protocol.get(`${renderUrl}/ping`, () => { /* silent success */ })
      .on('error', (err) => log('KeepAlive', `Self-ping failed: ${err.message}`));
  }, SELF_PING_INTERVAL);
  log('KeepAlive', 'Self-ping system started (every 10 min)');
}

function startMemoryMonitor() {
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(2);
    log('Memory', `Heap: ${heapMB} MB | RSS: ${rssMB} MB`);
    emitState('memory-tick');
  }, MEMORY_LOG_INTERVAL);
}

module.exports = { startSelfPing, startMemoryMonitor };
