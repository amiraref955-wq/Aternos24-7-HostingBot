'use strict';

/**
 * Avoid Mobs module - backs away from nearby mobs/players.
 * Skipped automatically when combat is enabled (they conflict).
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, intervals, log } = ctx;
  const safeDistance = 5;

  log('AvoidMobs', 'Module enabled');

  intervals.add(() => {
    if (!ctx.alive() || typeof bot.setControlState !== 'function') return;
    // Live check: combat module takes priority when enabled
    if (config.modules && config.modules.combat) return;
    try {
      const entities = Object.values(bot.entities).filter(e =>
        e.type === 'mob' || (e.type === 'player' && e.username !== bot.username)
      );
      for (const e of entities) {
        if (!e.position) continue;
        const distance = bot.entity.position.distanceTo(e.position);
        if (distance < safeDistance) {
          bot.setControlState('back', true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === 'function') bot.setControlState('back', false);
          }, 500);
          break;
        }
      }
    } catch (e) {
      log('AvoidMobs', `Error: ${e.message}`);
    }
  }, 2000);
}

module.exports = { init };
