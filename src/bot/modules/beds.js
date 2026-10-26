'use strict';

/**
 * Bed module - sleeps in a nearby bed at night (place-night only).
 * Uses a local isTryingToSleep guard instead of the stale bot.isSleeping.
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, intervals, log } = ctx;
  let isTryingToSleep = false;

  log('Beds', 'Module enabled');

  intervals.add(async () => {
    if (!ctx.alive()) return;
    if (!config.beds || !config.beds['place-night']) return;

    try {
      const isNight = bot.time.timeOfDay >= 12500 && bot.time.timeOfDay <= 23500;

      if (isNight && !isTryingToSleep) {
        const bedBlock = bot.findBlock({
          matching: block => block.name.includes('bed'),
          maxDistance: 8
        });

        if (bedBlock) {
          isTryingToSleep = true;
          try {
            await bot.sleep(bedBlock);
            log('Bed', 'Sleeping...');
          } catch (e) {
            // Can't sleep - maybe not night enough or monsters nearby
          } finally {
            isTryingToSleep = false;
          }
        }
      }
    } catch (e) {
      isTryingToSleep = false;
      log('Bed', `Error: ${e.message}`);
    }
  }, 10000);
}

module.exports = { init };
