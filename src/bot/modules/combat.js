'use strict';

/**
 * Combat module - attacks nearby mobs with a 1.9+ attack cooldown and
 * target locking, plus auto-eat when hunger drops.
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, log } = ctx;

  let lastAttackTime = 0;
  let lockedTarget = null;
  let lockedTargetExpiry = 0;

  log('Combat', 'Module enabled');

  // Use physicsTick (not the deprecated physicTick)
  bot.on('physicsTick', () => {
    if (!ctx.alive()) return;
    // Live toggle support
    if (!config.combat || !config.combat['attack-mobs']) return;

    const now = Date.now();
    // 1.9+ attack cooldown - at least 620ms between swings
    if (now - lastAttackTime < 620) return;

    try {
      // Only pick a new target if the current one is gone or the lock expired
      if (lockedTarget && now < lockedTargetExpiry && bot.entities[lockedTarget.id] && lockedTarget.position) {
        const dist = bot.entity.position.distanceTo(lockedTarget.position);
        if (dist < 4) {
          bot.attack(lockedTarget);
          lastAttackTime = now;
          return;
        } else {
          lockedTarget = null;
        }
      }

      // Pick a new target
      const mobs = Object.values(bot.entities).filter(e =>
        e.type === 'mob' && e.position &&
        bot.entity.position.distanceTo(e.position) < 4
      );
      if (mobs.length > 0) {
        lockedTarget = mobs[0];
        lockedTargetExpiry = now + 3000; // stick to the same mob for 3 seconds
        bot.attack(lockedTarget);
        lastAttackTime = now;
      }
    } catch (e) {
      log('Combat', `Error: ${e.message}`);
    }
  });

  // Auto-eat: check foodPoints property on the item directly (works reliably)
  bot.on('health', () => {
    if (!ctx.alive()) return;
    if (!config.combat || !config.combat['auto-eat']) return;
    try {
      if (bot.food < 14) {
        const food = bot.inventory.items().find(i => i.foodPoints && i.foodPoints > 0);
        if (food) {
          bot.equip(food, 'hand')
            .then(() => bot.consume())
            .catch(e => log('AutoEat', `Error: ${e.message}`));
        }
      }
    } catch (e) {
      log('AutoEat', `Error: ${e.message}`);
    }
  });
}

module.exports = { init };
