# 🤖 Aternos 24/7 Hosting Bot — v3.2 Advanced Edition

A Minecraft bot that keeps an Aternos server online 24/7 by automatically joining it with a Mineflayer-based bot — now with a **live web control panel**, **modular architecture**, and **Telegram notifications**.

Perfect for SMPs or small multiplayer servers that shut down when no players are online.

---

## ✨ What's New in v3.0

*    **🖥️ Advanced Web Panel** — login-protected control dashboard on your hosted domain:
     *    Connect / Disconnect (pull the bot out of the server) / Reconnect with one click
     *    Live server chat feed + send messages & commands from the browser
     *    Live console stream (realtime, via Server-Sent Events)
     *    Player list, bot position, health/food, memory, reconnect stats
     *    Full settings editor — change settings without touching files
*    **🎮 Live View (NEW!)** — first-person-style manual control of the bot from your browser:
     *    **Radar** — top-down view of every player, mob, and dropped item within 32 blocks (auto-rotates with the bot's facing direction)
     *    **HUD** — health/food/oxygen/XP bars, position, yaw/pitch, block under feet, full inventory grid
     *    **Manual control** — `WASD` to move, `Space` to jump, `Shift` to sneak, `Ctrl` to sprint, number keys to select hotbar, mouse clicks to attack / use items, middle-drag to look around
     *    See what the bot sees, in real time — and drive it yourself
*    **🌍 Real 3D World View (NEW!)** — an actual live 3D render of the world from the bot's eyes:
     *    Powered by prismarine-viewer — real block textures, sky, terrain, buildings, mobs
     *    Runs on the SAME port as the panel (`/viewer` path) — works on Render's free tier
     *    Session-protected (only logged-in panel users can watch)
     *    Configurable view distance & max simultaneous viewers (Settings → Live 3D Viewer)
*    **📲 Telegram Notifications** — get pinged on connect / disconnect / kick
*    **🔔 Discord Notifications** — same reliable webhook system as before
*    **🧩 Modular Codebase** — split into clean modules (bot manager, modules, notifications, dashboard)
*    **🛡️ Hardened** — session auth with rate-limited login, crash recovery, leak-safe interval registry

### Carried over from v2.x

*    **Auto-Connect**: automatically joins your server.
*    **Infinite Uptime**: prevents AFK kicks and server shutdowns.
*    **Smart Reconnect**: exponential backoff + throttle detection.
*    **Render-Ready**: self-ping keeps the free instance awake.
*    **Plugin Support**: works with Paper/Spigot/Bukkit (auto-auth included).

---

## 🛠️ Requirements

*   **GitHub Account**
*   **Aternos Server**
*   **Render Account** (for free 24/7 hosting)
*   **Common Sense!** 🧠

### 🐳 Deploying to Railway (or any Docker host)

This repo ships with a `Dockerfile` (Node 22 LTS, production deps only).
Railway / Render / Fly.io **auto-detect** it — just point the service at this
repository and deploy, no build configuration needed. The panel listens on the
platform-injected `PORT` automatically.

---

## 🚀 Setup Guide

We have made setup super easy! Check out the guide below:

[**Detailed Google Doc Guide**](https://docs.google.com/document/d/1Fl0dRzP6O30ehp5-QcaB11IobF8I1JJhKUipzCWiCYA/edit?tab=t.0).

---

## 🖥️ Using the Web Panel

1. Open your Render URL (or `http://localhost:5000` locally).
2. Log in with your dashboard password.
   *   **Default password: `changeme`** — ⚠️ change it immediately!
   *   Change it in `settings.json` → `dashboard.password`, or from the panel: **Settings → Dashboard Security → Save**.
3. Use the tabs:
   *   **Overview** — live status, controls (Connect / Disconnect / Reconnect), players, history, errors.
   *   **Live View** — 🎮 manual control + 🌍 real 3D world view! Click **Load 3D View** to see the world through the bot's eyes (first load takes a few seconds). Click **Take Control** to drive the bot: `WASD` to move, mouse on the radar to look around, left-click to attack, right-click to use the held item, number keys `1`–`9` to pick hotbar slots.
   *   **Chat** — read server chat live and send messages (prefix `/` to run commands).
   *   **Console** — full realtime bot console.
   *   **Settings** — edit everything (server, account, messages, movement, notifications, 3D viewer) and save. Server/account changes need a **Reconnect** to apply; everything else applies live.

---

## 📲 Telegram Notifications (Optional)

1. Message **@BotFather** on Telegram → `/newbot` → copy the **bot token**.
2. Send any message to your new bot, then open:
   `https://api.telegram.org/bot<TOKEN>/getUpdates` → find your **chat id**.
3. In `settings.json` (or from the panel → Settings → Telegram):
   ```json
   "telegram": {
     "enabled": true,
     "botToken": "123456:ABC-DEF...",
     "chatId": "123456789",
     "events": { "connect": true, "disconnect": true, "kick": true }
   }
   ```

## 💬 Discord Notifications (Optional)

Set `discord.enabled` to `true` and paste your webhook URL into `discord.webhookUrl`.

---

## ⚙️ Project Structure

```
├── index.js                  # Entry point (wires everything together)
├── settings.json             # Your configuration (edit this)
├── src/
│   ├── config.js             # Settings loader with defaults merge + save
│   ├── state.js              # Central bot state + realtime event bus
│   ├── keepalive.js          # Render self-ping + memory monitor
│   ├── bot/
│   │   ├── botManager.js     # Lifecycle, reconnection engine, manual controls
│   │   └── modules/          # antiAfk, autoAuth, chatMessages, movement,
│   │                         # combat, avoidMobs, beds, chat, position
│   ├── notifications/        # Discord webhook + Telegram + dispatcher
│   └── dashboard/
│       ├── server.js         # REST API + SSE stream + legacy endpoints
│       ├── auth.js           # Session auth (HMAC cookies + rate limiting)
│       └── public/           # Panel frontend (HTML/CSS/JS, zero frameworks)
```

### Key settings

| Setting | Default | Description |
|---------|---------|-------------|
| `server.ip` / `server.port` | — | Your Aternos server address |
| `bot-account.username` | — | Bot's in-game name |
| `bot-account.type` | `offline` | `offline` (cracked) / `microsoft` / `mojang` |
| `utils.auto-auth.password` | — | Auth password for AuthMe-style plugins |
| `utils.chat-messages` | — | Auto chat messages + repeat delay (seconds) |
| `dashboard.password` | `changeme` | **Web panel password — change it!** |
| `discord.enabled` | `false` | Discord webhook notifications |
| `telegram.enabled` | `false` | Telegram notifications |

---

## ⚠️ Disclaimer

This project is not affiliated with Aternos, Mojang, or Microsoft. Use at your own risk. Misuse may violate platform terms of service. This bot does not bypass Aternos queue limits; it only keeps the server active once it is online.

> 🔐 **Security note:** `settings.json` contains your passwords (auth password, panel password). If you fork this into a **public** repository, consider keeping those fields empty and setting them via the panel after deployment, or keep the repo private.

---

## ❤️ Credits

*   **Slobos (Discord: sloboscc)** — Original creator & idea. (The GOAT 🐐)
*   **Mr.Juice (Discord: Mr.Juice3046)** — Updates, Guide, & Maintenance.
*   **amiraref955-wq** — v3.0 Advanced Edition.

**License**: MIT License
