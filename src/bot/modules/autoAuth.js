'use strict';

/**
 * Auto-Auth module - reactively answers /register and /login prompts.
 * Includes a 10s failsafe in case the prompt is missed.
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, log, state } = ctx;
  const authCfg = (config.utils && config.utils['auto-auth']) || {};
  const password = authCfg.password || '';

  let authHandled = false;

  const tryAuth = (type) => {
    if (authHandled || !ctx.alive()) return;
    authHandled = true;
    if (type === 'register') {
      bot.chat(`/register ${password} ${password}`);
      log('Auth', 'Detected register prompt - sent /register');
    } else {
      bot.chat(`/login ${password}`);
      log('Auth', 'Detected login prompt - sent /login');
    }
  };

  bot.on('messagestr', (message) => {
    if (authHandled) return;
    const msg = message.toLowerCase();
    if (msg.includes('/register') || msg.includes('register ') || msg.includes('지정된 비밀번호')) {
      tryAuth('register');
    } else if (msg.includes('/login') || msg.includes('login ') || msg.includes('로그인')) {
      tryAuth('login');
    }
  });

  // Failsafe: if no prompt detected after 10s, try login anyway
  setTimeout(() => {
    if (!authHandled && ctx.alive()) {
      log('Auth', 'No prompt detected after 10s - sending /login as failsafe');
      bot.chat(`/login ${password}`);
      authHandled = true;
    }
  }, 10000);

  log('AutoAuth', 'Module enabled');
}

module.exports = { init };
