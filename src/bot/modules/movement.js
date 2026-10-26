'use strict';

/**
 * Movement module - circle walking, random jumping, looking around.
 * Uses the mineflayer-pathfinder plugin for circle walking.
 * Toggles are read LIVE from config on every tick.
 */
const { GoalBlock } = require('mineflayer-pathfinder').goals;

function startCircleWalk(bot, defaultMove, ctx) {
  const { config, intervals, log } = ctx;
  let angle = 0;
  let lastPathTime = 0;

  intervals.add(() => {
    if (!ctx.alive()) return;
    const cw = (config.movement && config.movement['circle-walk']) || {};
    if (!cw.enabled) return; // live toggle support

    const now = Date.now();
    if (now - lastPathTime < 2000) return;
    lastPathTime = now;
    try {
      const radius = cw.radius || 4;
      const x = bot.entity.position.x + Math.cos(angle) * radius;
      const z = bot.entity.position.z + Math.sin(angle) * radius;
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(Math.floor(x), Math.floor(bot.entity.position.y), Math.floor(z)));
      angle += Math.PI / 4;
      ctx.touch();
    } catch (e) {
      log('CircleWalk', `Error: ${e.message}`);
    }
  }, (config.movement && config.movement['circle-walk'] && config.movement['circle-walk'].speed) || 3000);
}

function startRandomJump(bot, defaultMove, ctx) {
  const { config, intervals, log } = ctx;

  intervals.add(() => {
    if (!ctx.alive() || typeof bot.setControlState !== 'function') return;
    const rj = (config.movement && config.movement['random-jump']) || {};
    if (!rj.enabled) return; // live toggle support
    const cw = (config.movement && config.movement['circle-walk']) || {};
    if (cw.enabled) return; // circle-walk keeps the bot moving already
    try {
      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot && typeof bot.setControlState === 'function') bot.setControlState('jump', false);
      }, 300);
      ctx.touch();
    } catch (e) {
      log('RandomJump', `Error: ${e.message}`);
    }
  }, (config.movement && config.movement['random-jump'] && config.movement['random-jump'].interval) || 10000);
}

function startLookAround(bot, defaultMove, ctx) {
  const { config, intervals, log } = ctx;

  intervals.add(() => {
    if (!ctx.alive()) return;
    const la = (config.movement && config.movement['look-around']) || {};
    if (!la.enabled) return; // live toggle support
    try {
      const yaw = (Math.random() * Math.PI * 2) - Math.PI;
      const pitch = (Math.random() * Math.PI / 2) - Math.PI / 4;
      bot.look(yaw, pitch, false);
      ctx.touch();
    } catch (e) {
      log('LookAround', `Error: ${e.message}`);
    }
  }, (config.movement && config.movement['look-around'] && config.movement['look-around'].interval) || 5000);
}

function init(bot, mcData, defaultMove, ctx) {
  const { config, log } = ctx;
  if (!config.movement || config.movement.enabled === false) return;

  log('Movement', 'Module enabled');
  startCircleWalk(bot, defaultMove, ctx);
  startRandomJump(bot, defaultMove, ctx);
  startLookAround(bot, defaultMove, ctx);
}

module.exports = { init };
