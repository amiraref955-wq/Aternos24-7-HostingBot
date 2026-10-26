'use strict';

/**
 * Chat module - logs chat, mirrors to Discord/Telegram (optional) and
 * responds to basic greetings / !tp commands.
 * Every incoming chat line is also pushed to the dashboard chat feed.
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, log } = ctx;

  log('Chat', 'Module enabled');

  bot.on('chat', (username, message) => {
    if (!ctx.alive() || username === bot.username) return;

    try {
      // Optional mirror of chat to Discord
      const dEvents = (config.discord && config.discord.events) || {};
      if (config.discord && config.discord.enabled && dEvents.chat) {
        require('../../notifications').notify(config, 'info', `💬 **${username}**: ${message}`);
      }

      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('hello') || lowerMsg.includes('hi')) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith('!tp ')) {
          const target = message.split(' ')[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      log('Chat', `Error: ${e.message}`);
    }
  });
}

module.exports = { init };
