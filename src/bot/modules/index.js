'use strict';

/**
 * Module registry - initializes all in-game modules after spawn.
 * Order matters: position first (pathfinder goal), then movement,
 * then defensive/offensive modules.
 */
const { log } = require('../../utils/logger');

const MODULES = [
  'position',
  'movement',
  'antiAfk',
  'autoAuth',
  'chatMessages',
  'avoidMobs',
  'combat',
  'beds',
  'chatRespond'
];

function initializeModules(bot, mcData, defaultMove, ctx) {
  log('Modules', 'Initializing all modules...');
  for (const name of MODULES) {
    try {
      const mod = require(`./${name}.js`);
      mod.init(bot, mcData, defaultMove, ctx);
    } catch (e) {
      // A broken module must never take down the whole bot
      log('Modules', `Failed to init "${name}": ${e.message}`);
    }
  }
  log('Modules', 'All modules initialized!');
}

module.exports = { initializeModules };
