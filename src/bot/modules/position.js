'use strict';

/**
 * Position module - walks the bot to a configured spawn position.
 * Only runs if circle-walk is disabled (they fight over the pathfinder).
 */
const { GoalBlock } = require('mineflayer-pathfinder').goals;

function init(bot, mcData, defaultMove, ctx) {
  const { config, log } = ctx;
  const pos = config.position || {};
  const movement = config.movement || {};

  if (!pos.enabled) return;
  if (movement['circle-walk'] && movement['circle-walk'].enabled) return;

  try {
    bot.pathfinder.setMovements(defaultMove);
    bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    log('Position', `Navigating to ${pos.x}, ${pos.y}, ${pos.z}...`);
  } catch (e) {
    log('Position', `Error: ${e.message}`);
  }
}

module.exports = { init };
