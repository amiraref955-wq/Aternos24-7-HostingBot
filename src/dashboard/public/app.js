'use strict';

/* ============ AFK Bot Panel v3 - Frontend logic ============ */

const $ = (id) => document.getElementById(id);

const state = {
  es: null,           // EventSource
  statusTimer: null,
  settingsCache: null,
  chatCount: 0,
  consoleCount: 0
};

/* ============ Boot: check session ============ */
document.addEventListener('DOMContentLoaded', async () => {
  wireLogin();
  wireTabs();
  wireControls();
  wireChat();
  wireSettings();

  try {
    const r = await fetch('/api/session');
    if (r.ok) showMain();
    else showLogin();
  } catch (e) {
    showLogin();
  }
});

/* ============ Login ============ */
function wireLogin() {
  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('login-error');
    errBox.classList.add('hidden');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('login-password').value })
      });
      const data = await r.json();
      if (r.ok) {
        $('login-password').value = '';
        showMain();
      } else {
        errBox.textContent = data.error || 'Login failed';
        errBox.classList.remove('hidden');
      }
    } catch (err) {
      errBox.textContent = 'Server unreachable';
      errBox.classList.remove('hidden');
    }
  });

  $('logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
  });
}

function showLogin() {
  $('login-view').classList.remove('hidden');
  $('main-view').classList.add('hidden');
  if (state.es) { state.es.close(); state.es = null; }
  if (state.statusTimer) { clearInterval(state.statusTimer); state.statusTimer = null; }
}

function showMain() {
  $('login-view').classList.add('hidden');
  $('main-view').classList.remove('hidden');
  connectSSE();
  loadSettings();
  state.statusTimer = setInterval(pollStatus, 5000); // backup polling (SSE is primary)
  pollStatus();
}

/* ============ SSE realtime stream ============ */
function connectSSE() {
  if (state.es) state.es.close();

  const es = new EventSource('/api/events');
  state.es = es;

  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    applyState(data.state);
    $('chat-feed').innerHTML = '';
    state.chatCount = 0;
    (data.chat || []).forEach(c => appendChat(c, true));
    $('console-feed').innerHTML = '';
    state.consoleCount = 0;
    (data.console || []).forEach(c => appendConsole(c, true));
    renderHistory(data.history || []);
    renderErrors(data.errors || []);
  });

  es.addEventListener('state', (e) => {
    const data = JSON.parse(e.data);
    applyState(data.state);
  });

  es.addEventListener('chat', (e) => {
    appendChat(JSON.parse(e.data), false);
  });

  es.addEventListener('console', (e) => {
    appendConsole(JSON.parse(e.data), false);
  });

  es.addEventListener('history', (e) => {
    // Full history refresh is cheap; poll status handles it
  });

  es.onerror = () => {
    setStatus('connecting', 'Reconnecting...');
    // EventSource auto-retries; nothing else needed
  };
}

/* ============ Status / Overview ============ */
async function pollStatus() {
  try {
    const r = await fetch('/api/status');
    if (r.status === 401) return showLogin();
    const data = await r.json();
    applyState(data);
    renderHistory(data.history || []);
    renderErrors(data.errors || []);
  } catch (e) { /* server briefly down */ }
}

function applyState(s) {
  if (!s) return;

  // Status pill
  if (s.connected) setStatus('online', 'Online & Running');
  else if (s.reconnecting) setStatus('connecting', 'Reconnecting...');
  else if (s.manualStop) setStatus('offline', 'Stopped');
  else setStatus('offline', 'Offline');

  // Uptime
  const up = s.spawnTime ? Math.floor((Date.now() - s.spawnTime) / 1000) : s.uptime || 0;
  $('uptime-label').textContent = fmtUptime(up);

  // Stats
  $('stat-server').textContent = s.server && s.server.ip ? `${s.server.ip}:${s.server.port}` : '—';
  $('stat-version').textContent = `${s.username || '—'} / ${s.serverVersion || 'auto'}`;
  const p = s.position;
  $('stat-position').textContent = p
    ? `${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`
    : (s.connected ? 'spawn...' : '—');
  $('stat-health').textContent =
    (s.health != null ? `${Math.round(s.health)} ❤` : '—') + ' / ' +
    (s.food != null ? `${Math.round(s.food)} 🍗` : '—');
  $('stat-memory').textContent = s.memoryUsage != null ? `${s.memoryUsage} MB` : '—';
  $('stat-reconnects').textContent = s.reconnectsCount != null ? s.reconnectsCount : 0;

  // Players
  const players = s.players || {};
  const names = Object.keys(players);
  $('players-count').textContent = names.length;
  const list = $('players-list');
  list.innerHTML = '';
  if (names.length === 0) {
    list.innerHTML = '<li class="dim">Nobody yet</li>';
  } else {
    names.forEach(n => {
      const li = document.createElement('li');
      const ping = players[n] && players[n].ping != null ? players[n].ping : '?';
      li.innerHTML = `<span>👤 ${escapeHtml(n)}</span><span class="dim">${ping} ms</span>`;
      list.appendChild(li);
    });
  }
}

function setStatus(kind, text) {
  const pill = $('status-pill');
  pill.className = 'pill pill-' + kind;
  $('status-text').textContent = text;
}

function fmtUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${h}h ${m}m ${sec}s`;
}

function fmtTime(ts) {
  return new Date(ts).toTimeString().slice(0, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str == null ? '' : str);
  return div.innerHTML;
}

/* ============ Tabs ============ */
function wireTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ============ Controls ============ */
function wireControls() {
  $('btn-connect').addEventListener('click', () => botAction('/api/bot/connect', 'Connecting...'));
  $('btn-disconnect').addEventListener('click', () => {
    if (confirm('Remove the bot from the server? It will stay out until you press Connect.')) {
      botAction('/api/bot/disconnect', 'Bot removed from server');
    }
  });
  $('btn-reconnect').addEventListener('click', () => botAction('/api/bot/reconnect', 'Reconnecting...'));
}

async function botAction(url, okMsg) {
  try {
    const r = await fetch(url, { method: 'POST' });
    if (r.status === 401) return showLogin();
    const data = await r.json();
    toast(data.message || okMsg);
    setTimeout(pollStatus, 800);
  } catch (e) {
    toast('Action failed - server unreachable');
  }
}

/* ============ Chat ============ */
function wireChat() {
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('chat-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      if (r.status === 401) return showLogin();
      const data = await r.json();
      if (!data.ok) toast(data.error || 'Failed to send');
    } catch (err) {
      toast('Failed to send - server unreachable');
    }
  });
}

function appendChat(c, bulk) {
  const feed = $('chat-feed');
  const isSelf = c.username && document.body.contains(feed) && state.selfName === c.username;
  const div = document.createElement('div');
  div.className = 'chat-line' + (c.username ? (isSelf ? ' chat-self' : '') : ' chat-server');
  const time = `<span class="chat-time">${fmtTime(c.time)}</span>`;
  if (c.username) {
    div.innerHTML = `${time}<span class="chat-username">${escapeHtml(c.username)}:</span> ${escapeHtml(c.text)}`;
  } else {
    div.innerHTML = `${time}<span>${escapeHtml(c.text)}</span>`;
  }
  feed.appendChild(div);

  // Cap the feed
  state.chatCount++;
  if (feed.children.length > 300) feed.removeChild(feed.firstChild);
  if (!bulk) feed.scrollTop = feed.scrollHeight;
}

/* ============ Console ============ */
function appendConsole(c, bulk) {
  const feed = $('console-feed');
  const div = document.createElement('div');
  div.className = 'console-line' + (c.level === 'error' ? ' console-error' : c.level === 'warn' ? ' console-warn' : '');
  div.textContent = c.text;
  feed.appendChild(div);

  state.consoleCount++;
  if (feed.children.length > 400) feed.removeChild(feed.firstChild);
  if (!bulk && $('console-autoscroll').checked) feed.scrollTop = feed.scrollHeight;
}

/* ============ History / Errors ============ */
function renderHistory(items) {
  const list = $('history-list');
  if (!items || items.length === 0) {
    list.innerHTML = '<li class="dim">No events yet</li>';
    return;
  }
  list.innerHTML = '';
  [...items].reverse().forEach(h => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="hist-${escapeHtml(h.event)}">${escapeHtml(h.event)} ${h.detail ? '- ' + escapeHtml(h.detail) : ''}</span><span class="hist-time">${fmtTime(h.time)}</span>`;
    list.appendChild(li);
  });
}

function renderErrors(items) {
  const list = $('errors-list');
  if (!items || items.length === 0) {
    list.innerHTML = '<li class="dim">No errors 🎉</li>';
    return;
  }
  list.innerHTML = '';
  [...items].reverse().forEach(err => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="err-time">${fmtTime(err.time)}</span>[${escapeHtml(err.type)}] ${escapeHtml(err.message).slice(0, 220)}</span>`;
    list.appendChild(li);
  });
}

/* ============ Settings ============ */
const SETTING_SECTIONS = [
  {
    title: 'Server', keys: [
      ['server.ip', 'Server IP', 'text'],
      ['server.port', 'Port', 'number'],
      ['server.version', 'MC Version (empty = auto)', 'text'],
      ['server.try-creative', 'Try creative mode (needs OP)', 'bool']
    ]
  },
  {
    title: 'Bot Account', keys: [
      ['bot-account.username', 'Username', 'text'],
      ['bot-account.password', 'Password (online mode)', 'text'],
      ['bot-account.type', 'Auth type (offline / mojang / microsoft)', 'text']
    ]
  },
  {
    title: 'Auto Auth', keys: [
      ['utils.auto-auth.enabled', 'Enabled', 'bool'],
      ['utils.auto-auth.password', 'Auth password', 'text']
    ]
  },
  {
    title: 'Chat Messages', keys: [
      ['utils.chat-messages.enabled', 'Enabled', 'bool'],
      ['utils.chat-messages.repeat', 'Repeat forever', 'bool'],
      ['utils.chat-messages.repeat-delay', 'Repeat delay (seconds)', 'number'],
      ['utils.chat-messages.messages', 'Messages (one per line)', 'list']
    ]
  },
  {
    title: 'Anti-AFK & Movement', keys: [
      ['utils.anti-afk.enabled', 'Anti-AFK enabled', 'bool'],
      ['utils.anti-afk.sneak', 'Sneak', 'bool'],
      ['movement.circle-walk.enabled', 'Circle walk', 'bool'],
      ['movement.circle-walk.radius', 'Circle radius', 'number'],
      ['movement.circle-walk.speed', 'Circle step (ms)', 'number'],
      ['movement.random-jump.enabled', 'Random jump', 'bool'],
      ['movement.random-jump.interval', 'Jump interval (ms)', 'number'],
      ['movement.look-around.enabled', 'Look around', 'bool'],
      ['movement.look-around.interval', 'Look interval (ms)', 'number']
    ]
  },
  {
    title: 'Modules', keys: [
      ['modules.avoidMobs', 'Avoid mobs', 'bool'],
      ['modules.combat', 'Combat', 'bool'],
      ['modules.beds', 'Beds', 'bool'],
      ['modules.chat', 'Chat module', 'bool'],
      ['combat.attack-mobs', 'Attack mobs', 'bool'],
      ['combat.auto-eat', 'Auto eat', 'bool'],
      ['chat.respond', 'Respond to greetings', 'bool']
    ]
  },
  {
    title: 'Reconnection', keys: [
      ['utils.auto-reconnect', 'Auto reconnect', 'bool'],
      ['utils.auto-reconnect-delay', 'Base delay (ms)', 'number'],
      ['utils.max-reconnect-delay', 'Max delay (ms)', 'number']
    ]
  },
  {
    title: 'Discord Notifications', keys: [
      ['discord.enabled', 'Enabled', 'bool'],
      ['discord.webhookUrl', 'Webhook URL', 'text'],
      ['discord.events.connect', 'Notify: connect', 'bool'],
      ['discord.events.disconnect', 'Notify: disconnect', 'bool'],
      ['discord.events.chat', 'Mirror chat', 'bool']
    ]
  },
  {
    title: 'Telegram Notifications', keys: [
      ['telegram.enabled', 'Enabled', 'bool'],
      ['telegram.botToken', 'Bot token (from @BotFather)', 'text'],
      ['telegram.chatId', 'Chat ID', 'text'],
      ['telegram.events.connect', 'Notify: connect', 'bool'],
      ['telegram.events.disconnect', 'Notify: disconnect', 'bool'],
      ['telegram.events.kick', 'Notify: kick', 'bool']
    ]
  },
  {
    title: 'Dashboard Security', keys: [
      ['dashboard.password', 'Panel password (change it!)', 'text']
    ]
  }
];

function getVal(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setVal(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof cur[keys[i]] !== 'object' || cur[keys[i]] === null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (r.status === 401) return showLogin();
    const cfg = await r.json();
    state.settingsCache = cfg;
    renderSettings(cfg);
  } catch (e) { /* ignore */ }
}

function renderSettings(cfg) {
  const form = $('settings-form');
  form.innerHTML = '';

  SETTING_SECTIONS.forEach(section => {
    const fs = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = section.title;
    fs.appendChild(legend);

    const row = document.createElement('div');
    row.className = 'field-row';

    section.keys.forEach(([path, label, type]) => {
      if (type === 'bool') {
        const lab = document.createElement('label');
        lab.className = 'field-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.path = path;
        input.checked = !!getVal(cfg, path);
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(' ' + label));
        fs.appendChild(lab);
      } else {
        const field = document.createElement('div');
        field.className = 'field';
        const lab = document.createElement('label');
        lab.textContent = label;
        field.appendChild(lab);

        let input;
        if (type === 'list') {
          input = document.createElement('textarea');
          const val = getVal(cfg, path);
          input.value = Array.isArray(val) ? val.join('\n') : '';
        } else {
          input = document.createElement('input');
          input.type = type;
          if (type === 'password') input.autocomplete = 'new-password';
          const val = getVal(cfg, path);
          input.value = val == null ? '' : val;
        }
        input.dataset.path = path;
        field.appendChild(input);
        row.appendChild(field);
      }
    });

    fs.appendChild(row);
    form.appendChild(fs);
  });
}

function collectSettings() {
  const out = {};
  document.querySelectorAll('#settings-form [data-path]').forEach(el => {
    const path = el.dataset.path;
    if (el.type === 'checkbox') {
      setVal(out, path, el.checked);
    } else if (el.tagName === 'TEXTAREA') {
      setVal(out, path, el.value.split('\n').map(s => s.trim()).filter(Boolean));
    } else if (el.type === 'number') {
      setVal(out, path, Number(el.value) || 0);
    } else {
      setVal(out, path, el.value);
    }
  });
  return out;
}

function wireSettings() {
  $('settings-save').addEventListener('click', async () => {
    const msgBox = $('settings-msg');
    msgBox.classList.add('hidden');
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectSettings())
      });
      if (r.status === 401) return showLogin();
      const data = await r.json();
      msgBox.textContent = data.message || (data.ok ? 'Saved' : 'Save failed');
      msgBox.className = 'settings-msg ' + (data.ok ? (data.needsReconnect ? 'warn' : 'ok') : 'err');
      if (data.ok) {
        toast('Settings saved');
        // Reload settings to reflect server-side merge
        setTimeout(loadSettings, 400);
      }
    } catch (e) {
      msgBox.textContent = 'Save failed - server unreachable';
      msgBox.className = 'settings-msg err';
    }
    msgBox.classList.remove('hidden');
  });

  $('settings-reload').addEventListener('click', loadSettings);
}

/* ============ Toast ============ */
let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
