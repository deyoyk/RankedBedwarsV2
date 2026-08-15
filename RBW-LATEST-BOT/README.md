# Ranked Bedwars Discord Bot

The Discord side of the Ranked Bedwars system. It manages ELO queues (voice channels), matchmaking, scoring, seasons, screenshares, punishments, and talks to your Minecraft server over a WebSocket. It stores all data in MongoDB.

See [In-Game Plugin Setup](../RBW-LATEST-Ingame/README.md) for the Minecraft side.

---

## 1. Hosting

### Requirements

| Resource | Minimum | Recommended |
|---|---|---|
| VPS | 1 vCPU / 1 GB RAM | 2 vCPU / 2 GB RAM |
| OS | Ubuntu 22.04 / Debian 12 | same |
| Node.js | 18+ | 20 / 22 LTS |
| MongoDB | 6.0 | 6.0+ (local or Atlas) |

- The bot needs to be reachable from your Minecraft server on the WebSocket port — host it on a VPS with a public IP, not on your gaming PC.
- MongoDB can run on the same VPS (don't expose it to the internet) or use [MongoDB Atlas](https://www.mongodb.com/atlas) free tier.

### Step-by-step

**1. Create the VPS** — any provider works. Make sure the firewall allows the ports below.

**2. Install Node.js (via nvm)**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v   # should print v22.x.x
```

**3. Install MongoDB**

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

**4. Open firewall ports**

```bash
sudo ufw allow 25565/tcp   # WebSocket + REST API (both served on this port)
sudo ufw enable
```

- `25565/tcp` — the WebSocket server and the REST API share this port (default, change via `WEBSOCKETPORT`).
- `27017/tcp` — MongoDB. **Do not** open it to the public; it must stay internal (bind to 127.0.0.1 or use Atlas).

**5. Upload the code and install**

```bash
git clone <your-repo-url> RankedBedwars
cd RankedBedwars/RBW-LATEST-BOT
npm install
cp .env.example .env
nano .env   # fill in DISCORD_TOKEN, MONGO_URI, AUTH_KEY and all IDs
```

**6. Run with PM2** (auto-restart on crash/reboot)

```bash
npm i -g pm2
npm run build
pm2 start dist/index.js --name rbw-bot
pm2 save
pm2 startup   # prints a command — run it, then pm2 save again
```

Logs:

```bash
pm2 logs rbw-bot          # follow logs
pm2 restart rbw-bot       # after editing .env or rebuilding
```

**Optional — systemd unit instead of PM2**

```ini
# /etc/systemd/system/rbw-bot.service
[Unit]
Description=Ranked Bedwars Discord Bot
After=network.target mongod.service

[Service]
WorkingDirectory=/home/deploy/RankedBedwars/RBW-LATEST-BOT
ExecStart=/home/deploy/.nvm/versions/node/v22.14.0/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now rbw-bot
journalctl -u rbw-bot -f
```

> **Important:** the bot refuses to start if `AUTH_KEY` is not set (`process.exit(1)` at startup). If you changed `.env`, restart the process — PM2 does not reload env vars on its own.

---

## 2. Configuration

Copy `.env.example` to `.env` and fill it in. Every variable read by the code:

| Variable | Default | Description | Required |
|---|---|---|---|
| `AUTH_KEY` | — (bot **exits** if missing) | Shared secret for WebSocket + REST API. Must match the plugin's `websocket.auth_key` exactly. Change it to something random. | **Yes** |
| `DISCORD_TOKEN` | — | Bot token from the Discord Developer Portal | **Yes** |
| `MONGO_URI` | `dedass` (placeholder — set a real one!) | MongoDB connection string | **Yes** |
| `CLIENT_ID` | `` | Bot application ID | Yes (slash commands) |
| `GUILD_ID` | `` | ID of the Discord server the bot runs in | Yes (single-guild bot) |
| `DBNAME` | `deyorbw` | MongoDB database name | |
| `WEBSOCKETPORT` | `25565` | Port for the WebSocket **and** REST API (they share it) | |
| `APIPORT` | `3000` | Accepted but **not used** — the API serves on `WEBSOCKETPORT` | |
| `PREFIX_ENABLED` | `false` | Enable legacy message commands (`=ban`, `=stats`, ...) | |
| `PREFIX` | `=` | Prefix for message commands | |
| `WORKERS_ENABLED` | `false` | Use additional bot accounts for high load | |
| `WORKER_TOKEN_1` … `WORKER_TOKEN_N` | — | Tokens of worker bots (all detected automatically) | |
| `WAITING_ROOM_ID` | `` | Voice channel users are moved to when they can't join a queue | |
| `GAME_CATEGORY_ID` | `` | Category where per-game text channels are created | |
| `VOICE_CATEGORY_ID` | `` | Category where team voice channels are created | |
| `SCREEN_SHARE_CATEGORY_ID` | `` | Category for screenshare voice channels | |
| `GAMES_CHANNEL_ID` | `` | Channel for game start notifications | |
| `SCORING_CHANNEL_ID` | `` | Channel for game results | |
| `VOIDING_CHANNEL_ID` | `` | Channel for voided-game notifications | |
| `ALERTS_CHANNEL_ID` | `` | General bot alerts and notifications | |
| `PUNISHMENTS_CHANNEL_ID` | `` | Ban/mute/unban notifications | |
| `STRIKE_REQUESTS_CHANNEL_ID` | `` | Strike request notifications | |
| `VOID_REQUESTS_CHANNEL_ID` | `` | Game void request notifications | |
| `SCREEN_SHARE_REQUESTS_CHANNEL_ID` | `` | Screenshare request notifications | |
| `BOT_STATUS_CHANNEL_ID` | `` | Bot online/offline status updates | |
| `REGISTERED_ROLE_ID` | `` | Role given to registered users | |
| `NON_REGISTERED_ROLE_ID` | `` | Role for unregistered users | |
| `BANNED_ROLE_ID` | `` | Role restricting banned users | |
| `FROZEN_ROLE_ID` | `` | Role that blocks queue participation | |
| `SCREEN_SHARER_ROLE_ID` | `` | Role marking users being screenshared | |
| `MUTED_ROLE_ID` | `` | Role preventing users from talking | |
| `PARTY_OF_2_ROLE_ID` | `` | Role for parties of 2 (bypasses party size limits) | |
| `PARTY_OF_3_ROLE_ID` | `` | Role for parties of 3 | |
| `PARTY_OF_4_ROLE_ID` | `` | Role for parties of 4 | |
| `COMMON_PARTY_SIZE` | `4` | Default party size for common queues (private games) | |
| `PARTY_QUEUE_SIZE` | `4` | Default party size limit for public queues | |
| `SERVER_IP` | `play.deyo.lol` | Your server IP (used by the bot) | |
| `BOT_STATS_TEXT` | `DEYO RANKED BEDWARS` | Bot status text | |
| `EMBED_DEFAULT_*` / `EMBED_ERROR_*` / `EMBED_SUCCESS_*` | see `.env.example` | Embed text, color, title, footer, ephemeral per embed type | |

> `SERVER_NAME` and `INVITE_LINK` exist in `.env.example` but are **not** read by the code.

---

## 3. Discord Application Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it into `DISCORD_TOKEN`. Copy the **Application ID** into `CLIENT_ID`.
3. **Bot tab → Privileged Gateway Intents** — enable all of these:
   - **Server Members Intent** — **REQUIRED**. The bot tracks roles and member presence constantly; without it, registration, roles, and bans break.
   - **Message Content Intent** — needed for prefix commands (`=ban`, etc.).
   - **Presence Intent** — not required by the code; can stay off.
   - Voice States and Messages are non-privileged intents and are always on; the bot also uses Guilds, GuildMessages, GuildVoiceStates, and MessageContent in code.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`. Give the bot these permissions (or an admin-managed role set):
   - Manage Channels, Manage Roles, Manage Nicknames
   - Move Members, Connect, Speak (voice management)
   - View Channels, Send Messages, Embed Links, Attach Files
   - Kick/Ban not needed — punishments are role-based.
5. Open the generated invite URL, add the bot to your server, and copy the server ID into `GUILD_ID` (enable Developer Mode in Discord → right-click server → Copy Server ID).
6. Create all the roles/channels/categories from the config table above and paste their IDs into `.env` (right-click anything with Developer Mode enabled to copy IDs).
7. Slash commands are registered automatically at startup (`application.commands.set`).

---

## 4. Permissions

Command permissions are **not** configured in the bot — they come from the Minecraft plugin's `permission.yml`:

- The plugin sends a `permission` message over WebSocket on connect (`/rbw reloadpermissions` resends it).
- The bot maps each command name to a list of Discord role IDs (or `everyone`).

How `checkPermission` decides (see `src/utils/permissions.ts`):

| State | Result |
|---|---|
| Command not present in the permission data | Denied — "Permissions for this command not set yet" |
| Role list contains `everyone` (or is empty) | Everyone may use it |
| Any of the listed role IDs is on the caller | Allowed |
| Otherwise | Denied |

The `config.roles.*` env vars are the *runtime* roles the bot assigns to users: `registered`, `nonRegistered` (given/removed on registration), `banned`, `muted`, `frozen`, `screensharer` (applied by the moderation commands), and `partyof2Queue`/`partyof3Queue`/`partyof4Queue` (party-size roles).

---

## 5. Commands

All commands are slash commands, plus the same commands work with the prefix when `PREFIX_ENABLED=true` (e.g. `=ban`, `=stats`, `=help`).

### Player

| Command | Description |
|---|---|
| `/register ign:<ign>` | Register your Discord account to an in-game name (verification code is sent in-game) |
| `/stats [user]` | View player stats |
| `/leaderboard [mode] [page]` | Leaderboard for any stat (elo, wins, kills, beds, level, ...) |
| `/recentgames [page] [user]` | Recent games |
| `/party action:...` | Party management: create, invite, leave, info, disband, kick, promote, settings, list, join |
| `/queue` | Show players in the current queue |
| `/call user:<user>` | Grant a player access to your game voice channel |
| `/nick action:set\|remove [nickname]` | Set or remove your server nickname |
| `/settings` | Edit your user settings |
| `/changetheme` | Change your stats-image theme |
| `/themes` | List owned themes and current theme |
| `/refresh` | Refresh your nickname and roles |
| `/history userid:<id> type:ban\|mute\|strike` | View a user's punishment history |
| `/strikerequest gameid: target: reason:` | Request a strike against a player |
| `/voidrequest gameid: reason:` | Request to void a game |
| `/screenshare user: reason:` | Request a screenshare on a user |
| `/level [user]` | View level and experience |
| `/seasoninfo` | Current season info and allowed items |

### Moderator

| Command | Description |
|---|---|
| `/score gameid: winningteam: [mvps] [bedbreaks] [reason]` | Report a game score (winning team 1 or 2) |
| `/void gameid: reason:` | Void a game |
| `/forcevoid` | Force-void the game tied to the current channel |
| `/ban user: duration: reason:` | Ban a user (e.g. `1d`, `1h`) |
| `/unban userid:` | Unban a user |
| `/mute user: duration: reason:` | Mute a user |
| `/unmute userid:` | Unmute a user |
| `/strike user: [reason]` | Issue a strike |
| `/unstrike user: [reason]` | Remove a strike |
| `/win user:` / `/lose user:` | Manually award a win/loss |
| `/ssclose reason:` | Close a screenshare session |

### Admin

| Command | Description |
|---|---|
| `/addqueue channelid: maxplayers: minelo: maxelo: isranked: ispicking: [bypassroles]` | Create a new queue (voice channel) |
| `/removequeue channelid:` | Remove a queue |
| `/queuecontrol enable\|disable type:ranked\|unranked\|specific [queueid]` | Enable/disable queues |
| `/addelo roleid: startelo: endelo: winelo: loseelo: mvpelo: [bedelo]` | Add an ELO rank bound to a Discord role |
| `/removeelo roleid:` | Remove an ELO rank |
| `/forceregister user: ign:` | Register a user for them |
| `/forcerename user: newign:` | Rename a registered IGN |
| `/unregister user:` | Unregister a user |
| `/wipe user:` | Wipe a user's stats (keeps bans/mutes/strikes) |
| `/wipeeveryone` | Wipe all stats (keeps bans/mutes/strikes) |
| `/fixall` | Fix roles and nicknames for all users in the database |
| `/edit user: stat: value:` | Edit any statistic (elo, wins, kdr, ...) |
| `/thememanage` | Give or take a user's theme |
| `/gamescount` | Chart of games played per day and state |

### Game

| Command | Description |
|---|---|
| `/retry` | Retry a game |
| `/games [page]` | List games |
| `/gameinfo gameid:` | Detailed info for a game |
| `/queues [page]` | List queues |
| `/ranks` | List ELO ranks |
| `/maps` | Show available maps (reserved/locked/disabled) and select mode |
| `/help` | Help menu (category select + pagination) |

### Season

| Command | Description |
|---|---|
| `/startseason season: chapter: name: [description]` | Start a new season |
| `/endseason` | End the current active season and migrate data |
| `/listseasons` | List all seasons |

---

## 6. Queues

A **queue is a Discord voice channel** with an ELO window. Players join the voice channel, the bot tracks them there, and broadcasts queue status to the plugin every 3 seconds (shown in-game as an action bar).

- `/addqueue channelid:<voice channel ID> maxplayers:<n> minelo:<elo> maxelo:<elo> isranked:<true/false> ispicking:<true/false> [bypassroles:"roleid1,roleid2"]`
  - `ispicking: true` = captain-based picking mode; `false` = random teams.
  - `bypassroles` = comma-separated Discord role IDs that bypass restrictions for this queue.
- `/removequeue channelid:<id>` — deletes a queue.
- `/queuecontrol enable|disable type:ranked|unranked|specific [queueid]` — bulk-enable/disable queues by type, or a single queue. Disabled queues no longer accept players.
- Parties: use `/party` to group up; party members are subject to `PARTY_QUEUE_SIZE` (public queues) and `COMMON_PARTY_SIZE` (private games), and the `PARTY_OF_2/3/4_ROLE_ID` roles bypass those limits.

---

## 7. Ranks

ELO ranks are Discord roles with a numeric window:

- `/addelo roleid:<discord role> startelo:<elo> endelo:<elo> winelo:<+elo per win> loseelo:<-elo per loss> mvpelo:<bonus> [bedelo:<bonus per bed>]`
- `/removeelo roleid:<discord role>` — removes the rank.
- `/ranks` — shows the configured rank list.

Ranks are used for role assignment when players cross ELO thresholds.

---

## 8. Seasons

Seasons are numbered **season + chapter** (e.g. Season 1, Chapter 2) and reset the leaderboard with a fresh set of rules:

- `/startseason season:<number> chapter:<number> name:<name> [description]` — starts a new active season.
- `/endseason` — ends the currently active season and migrates its data (stats, games) into the season archive.
- `/listseasons` — lists all seasons.
- `/seasoninfo` — shows the current season and its allowed items.

---

## 9. WebSocket Protocol

**Endpoint:** `ws://<bot-host>:<WEBSOCKETPORT>/rbw/websocket` (e.g. `ws://play.deyo.lol:25565/rbw/websocket`).

The first message **must** be authentication:

```json
{ "type": "auth", "auth_key": "your_auth_key" }
```

The bot replies `auth_success` and closes the connection on a wrong key. All messages are JSON objects with a `type` field.

### Plugin → Bot

| Type | Payload (key fields) | Meaning |
|---|---|---|
| `auth` | `auth_key` | First message, mandatory |
| `server_status` | `status`, `timestamp` | Sent after connect |
| `permission` | `{command: [roleIds]}` | Command → allowed Discord roles |
| `maps_info` | `reserved`, `locked`, `disabled` | Arena lists sent on connect |
| `player_status` | `ign`, `online`, `original_ign_case` | Reply to `check_player` |
| `player_status_update` | `ign`, `online` | Player join/leave events |
| `ping` | `ping_id`, `timestamp` | Latency probe |
| `pong` | `ping_id`, `timestamp`, `server_online`, `server_max`, `server_tps` | Reply to bot `ping` |
| `scoring` | `gameid`, `mvps`, `bedsbroken`, `players`, `winningteamignlist`, `timeline` | Full game result |
| `voiding` | `gameid`, `reason` | Void a game |
| `game_start` | `game_id`, `arena`, `timestamp` | Game started in an arena |
| `retrygame` | — | Retry request |
| `autoss` | `targetign`, `requestign`, `uuid` | Auto screenshare request from in-game `/ss` |
| `queuefromingame` | `ign`, `uuid` | In-game `/queue` — bot moves user into a queue VC |
| `callcmd` | `callId`, `requester`, `target` | In-game `/call` — bot grants voice access |
| `screensharedontlog_success` / `screensharedontlog_failure` | `uuid`, `reason?` | Result of a don't-log-off check |
| `warp_success` / `warp_failed_arena_not_found` / `warp_failed_offline_players` / `warp_failure_unknown` | `game_id`, `map`, `offline_players?` | Warp acknowledgements |

### Bot → Plugin

| Type | Payload (key fields) | Meaning |
|---|---|---|
| `auth_success` / `auth_failure` | `message` | Authentication result |
| `verification` | `ign`, `code` | Verification code to whisper in-game |
| `warp_players` | `game_id`, `map`, `is_ranked`, `team1`, `team2` | Warp players to a map's arena |
| `check_player` | `ign` | Is this IGN online? (10 s timeout) |
| `ping` | `ping_id`, `timestamp` | Latency probe (bot → plugin) |
| `queuestatus` | `queues`, `timestamp` | Broadcast every 3 s while connected |
| `screensharedontlog` | `ign`, `uuid` | Tell player not to log off |
| `botban` / `botmute` | `ign`, `reason`, `duration?` | Execute in-game ban/mute |
| `botunban` / `botunmute` | `ign`, `reason` | Execute in-game unban/unmute |
| `scoringsuccess` | `gameid`, `players` | Game was scored |
| `gamevoided` | `gameid`, `reason`, `players` | Game was voided |
| `callsuccess` / `callfailure` | `callId`, `reason?` | Result of `callcmd` |
| `queuefromingame_success` / `queuefromingame_fail` | `uuid`, `reason?` | Result of `queuefromingame` |
| `autoss_success` / `autoss_fail` | `uuid` | Result of `autoss` |

---

## 10. REST API

Same port as the WebSocket (`http://<bot-host>:<WEBSOCKETPORT>/rbw/api`). Authenticate every request with `x-api-key: <AUTH_KEY>` header or `?key=<AUTH_KEY>` — requests without a matching key get `401`. CORS is enabled. There is currently **no rate limiting** on the API.

| Group | Endpoint |
|---|---|
| Root | `/rbw/api` — status + full endpoint list |
| Users | `/rbw/api/user?ign=<ign>` or `?discordid=<id>`, `/rbw/api/search/users?query=&limit=`, `/rbw/api/online-players`, `/rbw/api/level?ign=|discordid=`, `/rbw/api/user/:discordid/games`, `/rbw/api/user/:discordid/recent-games`, `/rbw/api/user/:discordid/punishment-history`, `/rbw/api/user/:discordid/season-history`, `/rbw/api/user/:discordid/winstreak-history`, `/rbw/api/user/:discordid/elo-history`, `/rbw/api/user/:discordid/compare/:targetid` |
| Leaderboards | `/rbw/api/leaderboard?mode=&page=`, `/rbw/api/leaderboard/top-players?mode=&limit=`, `/rbw/api/stats/top?stat=&limit=`, `/rbw/api/stats/global` |
| Games | `/rbw/api/game/:gameid`, `/rbw/api/games/recent?limit=`, `/rbw/api/games/live` |
| Seasons | `/rbw/api/seasons`, `/rbw/api/seasons/current`, `/rbw/api/seasons/:season/:chapter`, `/rbw/api/seasons/:season/:chapter/stats`, `/rbw/api/seasons/:season/:chapter/leaderboard`, `/rbw/api/seasons/:season/:chapter/games` |
| Queues / ranks / maps | `/rbw/api/queues`, `/rbw/api/eloranks`, `/rbw/api/maps` |
| Punishments | `/rbw/api/punishments/:type` (`bans`\|`mutes`\|`strikes`), `/rbw/api/baninfo?id=`, `/rbw/api/muteinfo?ign=|discordid=`, `/rbw/api/strikeinfo?ign=|discordid=` |
| Misc | `/rbw/api/knockback/votes`, `/rbw/api/knockback/vote`, `/rbw/api/server/status` |

Example:

```bash
curl -H "x-api-key: your_auth_key" "http://localhost:25565/rbw/api/user?ign=Notch"
```

---

## 11. Website

A dependency-free web UI ships in `RBW-LATEST-WEB/` (player stats, game recaps
with the full event timeline, leaderboards for every stat, season boards and
player comparison). The bot serves it automatically on the same port:

- Visit `http://your-host:25565/` — static files are served before auth/rate
  limiting, so they never count against API limits.
- For a public site set `RBW_PUBLIC_API=true` in the bot's env (read-only API
  access without a key; a wrong key is still rejected). Otherwise put your
  `AUTH_KEY` in `RBW-LATEST-WEB/config.js`.
- Each page is a lazily-loaded ES module; API responses are cached in memory +
  localStorage with TTLs, so navigating the site barely touches the backend.
- Hosting the site elsewhere: copy `RBW-LATEST-WEB/`, set `apiBase` in
  `config.js` to the bot's URL, and deploy as static files anywhere
  (Vercel/Netlify/GitHub Pages).

---

## 12. Testing

```bash
npm test        # Jest unit tests (runInBand)
npm run lint    # ESLint over src/
npm run build   # tsup build to dist/
```

Development: `npm run dev` runs the bot via ts-node without a build step.
