'use strict';

/**
 * Chat Messages module - repeats configured messages in the server chat.
 * Reads the message list LIVE from config so edits from the dashboard
 * take effect on the very next tick without a restart.
 */

function init(bot, mcData, defaultMove, ctx) {
  const { config, intervals, log, state } = ctx;
  const cfg = () => (config.utils && config.utils['chat-messages']) || {};
  const c = cfg();

  if (!c.enabled) return;

  log('ChatMessages', `Module enabled (${(c.messages || []).length} messages, repeat: ${!!c.repeat})`);

  if (c.repeat) {
    let i = 0;
    intervals.add(() => {
      if (!ctx.alive()) return;
      const cur = cfg();
      const messages = cur.messages || [];
      if (messages.length === 0) return; // guard against empty list
      // Wrap index if the list shrank while running
      if (i >= messages.length) i = 0;
      bot.chat(messages[i]);
      ctx.touch();
      i = (i + 1) % messages.length;
    }, (c['repeat-delay'] || 120) * 1000);
  } else {
    (c.messages || []).forEach((msg, idx) => {
      setTimeout(() => { if (ctx.alive()) bot.chat(msg); }, idx * 1000);
    });
  }
}

module.exports = { init };
