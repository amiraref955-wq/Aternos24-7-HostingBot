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
  wireLiveView();

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

  // Live View update (HUD + radar + inventory)
  if (typeof updateLiveView === 'function') updateLiveView(s);
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
      // Leaving the Live tab: release keyboard controls & disable takeover
      if (btn.dataset.tab !== 'live' && liveCtl.enabled) {
        disableTakeover();
      }
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

/* ============ Live View (radar + HUD + manual control) ============ */

const liveCtl = {
  enabled: false,         // keyboard takeover active
  keysDown: new Set(),     // currently-pressed control keys
  radarCanvas: null,
  radarCtx: null,
  lastLookSent: 0,        // throttle look updates
  dragYaw: null,          // mouse drag start yaw
  dragStart: null,        // {x, y, yaw, pitch}
  pointerLocked: false,
  lookYaw: 0,
  lookPitch: 0
};

function wireLiveView() {
  liveCtl.radarCanvas = $('radar');
  liveCtl.radarCtx = liveCtl.radarCanvas.getContext('2d');

  $('live-toggle').addEventListener('click', () => {
    if (liveCtl.enabled) disableTakeover();
    else enableTakeover();
  });

  // Keyboard input (only when takeover is on)
  document.addEventListener('keydown', onLiveKeyDown);
  document.addEventListener('keyup', onLiveKeyUp);

  // Radar mouse interaction: click + drag to look around (relative to current yaw)
  const canvas = liveCtl.radarCanvas;
  canvas.addEventListener('mousedown', onRadarMouseDown);
  document.addEventListener('mousemove', onRadarMouseMove);
  document.addEventListener('mouseup', onRadarMouseUp);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // Prevent page scrolling while clicking the canvas
  canvas.addEventListener('click', onRadarClick);

  // Window blur = release everything
  window.addEventListener('blur', () => {
    if (liveCtl.enabled) releaseAllControls();
  });
}

function enableTakeover() {
  liveCtl.enabled = true;
  const btn = $('live-toggle');
  btn.classList.add('active');
  btn.textContent = '⏸ Release Control';
  $('live-banner-text').textContent = 'Manual control active — WASD to move, mouse on radar to look, clicks to attack/use.';
  toast('Manual control enabled');
}

function disableTakeover() {
  liveCtl.enabled = false;
  releaseAllControls();
  const btn = $('live-toggle');
  btn.classList.remove('active');
  btn.textContent = '▶ Take Control';
  $('live-banner-text').textContent = 'Manual Control — see what the bot sees and drive it directly from this panel.';
  if (document.pointerLockElement) document.exitPointerLock();
  toast('Manual control released');
}

const KEY_MAP = {
  'KeyW': 'forward', 'ArrowUp': 'forward',
  'KeyS': 'back',    'ArrowDown': 'back',
  'KeyA': 'left',    'ArrowLeft': 'left',
  'KeyD': 'right',   'ArrowRight': 'right',
  'Space': 'jump',
  'ShiftLeft': 'sneak', 'ShiftRight': 'sneak',
  'ControlLeft': 'sprint', 'ControlRight': 'sprint'
};

function onLiveKeyDown(e) {
  if (!liveCtl.enabled) return;
  // Don't intercept when typing into an input/textarea
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  // Number keys 1-9 = hotbar
  if (e.code && e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 9) {
      e.preventDefault();
      postBotAction('/api/bot/hotbar', { slot: n - 1 });
      return;
    }
  }

  // Q = drop item
  if (e.code === 'KeyQ') {
    e.preventDefault();
    postBotAction('/api/bot/drop', {});
    return;
  }

  // Escape = release takeover
  if (e.code === 'Escape') {
    e.preventDefault();
    disableTakeover();
    return;
  }

  const action = KEY_MAP[e.code];
  if (action) {
    e.preventDefault();
    if (!liveCtl.keysDown.has(action)) {
      liveCtl.keysDown.add(action);
      postBotAction('/api/bot/control', { state: action, value: true });
    }
  }
}

function onLiveKeyUp(e) {
  if (!liveCtl.enabled) return;
  const action = KEY_MAP[e.code];
  if (action) {
    e.preventDefault();
    liveCtl.keysDown.delete(action);
    postBotAction('/api/bot/control', { state: action, value: false });
  }
}

function releaseAllControls() {
  if (!liveCtl.keysDown.size) return;
  liveCtl.keysDown.forEach(state => {
    postBotAction('/api/bot/control', { state, value: false });
  });
  liveCtl.keysDown.clear();
  // Belt-and-braces: server-side clear as well
  postBotAction('/api/bot/clear-controls', {});
}

// Radar mouse handling — drag = look, click = attack/use
function onRadarMouseDown(e) {
  if (!liveCtl.enabled) return;
  e.preventDefault();
  if (e.button === 0) {
    // left = attack
    postBotAction('/api/bot/attack', {});
  } else if (e.button === 2) {
    // right = use item
    postBotAction('/api/bot/activate', {});
  } else if (e.button === 1) {
    // middle = drag-look
    liveCtl.dragStart = { x: e.clientX, y: e.clientY, yaw: liveCtl.lookYaw, pitch: liveCtl.lookPitch };
  }
}

function onRadarMouseMove(e) {
  if (!liveCtl.enabled) return;
  if (e.buttons & 4 && liveCtl.dragStart) {
    // middle-drag look
    const dx = e.clientX - liveCtl.dragStart.x;
    const dy = e.clientY - liveCtl.dragStart.y;
    const newYaw = liveCtl.dragStart.yaw - dx * 0.01;
    const newPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, liveCtl.dragStart.pitch - dy * 0.01));
    sendLook(newYaw, newPitch);
  } else if (liveCtl.pointerLocked) {
    // pointer-lock mouselook (FPS-style)
    const newYaw = liveCtl.lookYaw - e.movementX * 0.0025;
    const newPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, liveCtl.lookPitch - e.movementY * 0.0025));
    sendLook(newYaw, newPitch);
  }
}

function onRadarMouseUp(e) {
  if (e.button === 1) liveCtl.dragStart = null;
}

function onRadarClick(e) {
  // No-op so far; attack/use happens on mousedown
}

function sendLook(yaw, pitch) {
  liveCtl.lookYaw = yaw;
  liveCtl.lookPitch = pitch;
  const now = Date.now();
  if (now - liveCtl.lastLookSent < 60) return; // throttle ~16/s
  liveCtl.lastLookSent = now;
  postBotAction('/api/bot/look', { yaw, pitch });
}

async function postBotAction(url, body) {
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) { /* ignore transient errors */ }
}

/* ---------- Live View renderer ---------- */
function updateLiveView(s) {
  if (!s) return;

  // HUD
  const p = s.position;
  $('hud-position').textContent = p ? `X: ${p.x}  Y: ${p.y}  Z: ${p.z}` : '—';
  if (s.yaw != null) {
    const facing = facingFromYaw(s.yaw);
    $('hud-facing').textContent = `${facing}  (${Math.round(s.yaw * 180 / Math.PI)}°, ${Math.round(s.pitch * 180 / Math.PI)}°)`;
    liveCtl.lookYaw = s.yaw;
    liveCtl.lookPitch = s.pitch || 0;
  } else {
    $('hud-facing').textContent = '—';
  }
  $('hud-block').textContent = s.blockUnder ? s.blockUnder.name : (s.connected ? 'air?' : '—');

  // Bars
  const hp = Math.max(0, Math.min(20, s.health || 0));
  const food = Math.max(0, Math.min(20, s.food || 0));
  const oxy = Math.max(0, Math.min(20, s.oxygenLevel != null ? s.oxygenLevel : 20));
  const xpLevel = s.level || 0;
  const xpBar = Math.max(0, Math.min(1, s.experience || 0));
  $('bar-health').style.width = `${(hp / 20) * 100}%`;
  $('bar-food').style.width = `${(food / 20) * 100}%`;
  $('bar-oxygen').style.width = `${(oxy / 20) * 100}%`;
  $('bar-xp').style.width = `${xpBar * 100}%`;
  $('val-health').textContent = hp.toFixed(1);
  $('val-food').textContent = food.toFixed(1);
  $('val-oxygen').textContent = oxy.toFixed(0);
  $('val-xp').textContent = `L${xpLevel}`;

  // Inventory
  renderInventory(s.inventory || [], s.heldSlot);

  // Radar
  drawRadar(s);
}

function facingFromYaw(yaw) {
  // Minecraft yaw: 0 = south (+Z), -π/2 = west (-X), ±π = north (-Z), π/2 = east (+X)
  const deg = ((yaw * 180 / Math.PI) + 360) % 360;
  if (deg >= 45 && deg < 135) return 'West';
  if (deg >= 135 && deg < 225) return 'North';
  if (deg >= 225 && deg < 315) return 'East';
  return 'South';
}

function renderInventory(items, heldSlot) {
  const grid = $('inv-grid');
  grid.innerHTML = '';
  // Mineflayer slot layout: 0-8 = crafting/armor, 9-35 = main inv, 36-44 = hotbar
  // We display 27 main inv slots + 9 hotbar slots = 36 total
  // Map slot ids: main inv slots 9-35 (3 rows of 9), hotbar 36-44
  const slotMap = {};
  items.forEach(it => { slotMap[it.slot] = it; });

  // Main inventory (rows 1-3, slots 9-35)
  for (let i = 9; i <= 35; i++) {
    grid.appendChild(makeInvSlot(slotMap[i], i, false));
  }
  // Hotbar (slots 36-44)
  for (let i = 36; i <= 44; i++) {
    const isHeld = (heldSlot != null && i === heldSlot + 36);
    grid.appendChild(makeInvSlot(slotMap[i], i, true, isHeld));
  }
}

function makeInvSlot(item, slotId, isHotbar, isHeld) {
  const div = document.createElement('div');
  div.className = 'inv-slot' + (isHotbar ? ' hotbar' : '') + (isHeld ? ' held' : '');
  if (item) {
    div.title = item.displayName || item.name;
    div.textContent = shortenItemName(item.displayName || item.name);
    if (item.count > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'count';
      cnt.textContent = item.count;
      div.appendChild(cnt);
    }
  }
  // Click hotbar slot = select it
  if (isHotbar) {
    div.addEventListener('click', () => {
      postBotAction('/api/bot/hotbar', { slot: slotId - 36 });
    });
    div.style.cursor = 'pointer';
  }
  return div;
}

function shortenItemName(name) {
  if (!name) return '';
  // Take the part after the last underscore if it's snake_case
  let n = String(name).replace(/_/g, ' ').trim();
  if (n.length > 14) n = n.slice(0, 12) + '…';
  return n;
}

function drawRadar(s) {
  const cv = liveCtl.radarCanvas;
  const ctx = liveCtl.radarCtx;
  if (!cv || !ctx) return;

  // Match canvas backing store to displayed size
  const dpr = window.devicePixelRatio || 1;
  const cssW = cv.clientWidth;
  if (cv.width !== Math.round(cssW * dpr)) {
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssW * dpr);
  }
  const W = cv.width, H = cv.height;
  const cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) / 2 - 6;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#060a16';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Range rings (8 / 16 / 24 / 32 blocks)
  const rangeBlocks = 32;
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
  ctx.lineWidth = 1;
  for (let r = 8; r <= 32; r += 8) {
    const ringR = (r / rangeBlocks) * radius;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // Range label
    ctx.fillStyle = 'rgba(100, 116, 139, 0.7)';
    ctx.font = `${Math.round(10 * dpr)}px sans-serif`;
    ctx.fillText(`${r}m`, cx + 3, cy - ringR + 11);
  }

  // Cross hair (N/S/E/W axes)
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // N/E/S/W labels (player-relative: top = -Z = North)
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = `bold ${Math.round(11 * dpr)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - radius - 0);
  ctx.fillText('S', cx, cy + radius + 0);
  ctx.fillText('E', cx + radius, cy);
  ctx.fillText('W', cx - radius, cy);

  // Entities
  const entities = s.nearbyEntities || [];
  // In MC, yaw 0 = looking south (+Z). Our radar: north = -Z = up.
  // Rotate radar by yaw so the bot's facing direction points UP (FPS-like).
  const yaw = s.yaw || 0;
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw);

  entities.forEach(en => {
    // Rotate entity offset by -yaw so the bot always faces up on radar
    const dx = en.dx || 0;
    const dz = en.dz || 0;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    const px = cx + (rx / rangeBlocks) * radius;
    const py = cy + (rz / rangeBlocks) * radius;
    if (Math.hypot(px - cx, py - cy) > radius) return;

    let color, size;
    switch (en.kind) {
      case 'player':   color = '#38bdf8'; size = 5 * dpr; break;
      case 'hostile':  color = '#f87171'; size = 4.5 * dpr; break;
      case 'passive':  color = '#4ade80'; size = 4.5 * dpr; break;
      case 'item':     color = '#fbbf24'; size = 3 * dpr; break;
      default:         color = '#94a3b8'; size = 3.5 * dpr;
    }

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();

    // Label for nearby players/mobs
    if (en.kind === 'player' || (en.distance != null && en.distance < 6)) {
      ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
      ctx.font = `${Math.round(9 * dpr)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(en.name.slice(0, 12), px + size + 2, py + 3);
    }
  });

  // Bot at center (always drawn last, on top)
  ctx.fillStyle = '#2dd4bf';
  ctx.shadowColor = '#2dd4bf';
  ctx.shadowBlur = 10 * dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, 6 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Direction indicator: bot yaw is 0 in rotated space, so triangle points UP
  // Pitch indicator (subtle): use pitch to set triangle length
  const pitch = s.pitch || 0;
  const len = (12 + Math.abs(pitch) * 6) * dpr;
  ctx.fillStyle = '#2dd4bf';
  ctx.beginPath();
  ctx.moveTo(cx, cy - len);
  ctx.lineTo(cx - 4 * dpr, cy - 4 * dpr);
  ctx.lineTo(cx + 4 * dpr, cy - 4 * dpr);
  ctx.closePath();
  ctx.fill();
}
