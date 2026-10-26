'use strict';

/**
 * Anti-AFK module - arm swinging, hotbar cycling, teabagging, micro-walk, sneak.
 * All config values are read LIVE inside callbacks so dashboard changes apply instantly.
 */
const { randomInt } = require('../../utils/helpers');

function init(bot, mcData, defaultMove, ctx) {
  const { config, intervals, log } = ctx;

  log('AntiAFK', 'Module enabled');

  // Arm swinging
  intervals.add(() => {
    if (!ctx.alive()) return;
    try { bot.swingArm(); } catch (e) { }
  }, randomInt(10000, 60000));

  // Hotbar cycling
  intervals.add(() => {
    if (!ctx.alive()) return;
    try {
      bot.setQuickBarSlot(randomInt(0, 8));
    } catch (e) { }
  }, randomInt(30000, 120000));

  // Teabagging (occasionally)
  intervals.add(() => {
    if (!ctx.alive() || typeof bot.setControlState !== 'function') return;
    if (Math.random() > 0.9) {
      let count = randomInt(2, 5);
      const doTeabag = () => {
        if (count <= 0 || !ctx.alive() || typeof bot.setControlState !== 'function') return;
        try {
          bot.setControlState('sneak', true);
          setTimeout(() => {
            if (bot && typeof bot.setControlState === 'function') bot.setControlState('sneak', false);
            count--;
            setTimeout(doTeabag, 150);
          }, 150);
        } catch (e) { }
      };
      doTeabag();
    }
  }, randomInt(120000, 300000));

  // Micro-walk (only when circle-walk is NOT running, to avoid fighting the pathfinder)
  intervals.add(() => {
    if (!ctx.alive() || typeof bot.setControlState !== 'function') return;
    const movement = config.movement || {};
    if (movement['circle-walk'] && movement['circle-walk'].enabled) return;
    try {
      const yaw = Math.random() * Math.PI * 2;
      bot.look(yaw, 0, true);
      bot.setControlState('forward', true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === 'function') bot.setControlState('forward', false);
      }, randomInt(500, 2000));
      ctx.touch();
    } catch (e) {
      log('AntiAFK', `Walk error: ${e.message}`);
    }
  }, randomInt(120000, 480000));

  // Persistent sneak if configured
  if (config.utils && config.utils['anti-afk'] && config.utils['anti-afk'].sneak) {
    try {
      if (typeof bot.setControlState === 'function') bot.setControlState('sneak', true);
    } catch (e) { }
  }
}

module.exports = { init };
