# Ranked Bedwars In-Game Plugin

The Minecraft side of the Ranked Bedwars system. It connects your Bedwars server to the Discord bot over WebSocket: it warps players into arenas, reports game results, handles verification codes, syncs bans/mutes, and shows live queue status in the action bar. It works with both BedWars1058 and MBedwars.

See [Discord Bot Setup](../RBW-LATEST-BOT/README.md) for the bot side.

---

## 1. Requirements

| Requirement | Version |
|---|---|
| Java | 11+ (target in `pom.xml`) |
| Server software | Spigot/Paper **1.8.8** (build target — newer versions may work but are not the build target; `api-version: 1.13`) |
| Bedwars plugin | **BedWars1058 25.6+** or **MBedwars 5.3.2+** (one of them — the plugin auto-detects which is installed) |
| PlaceholderAPI | Optional (soft-dependency — if present, `%rankedbedwars_*%` placeholders get registered) |
| Discord bot | Must be running and reachable (see its README — the bot **refuses to start without `AUTH_KEY`**) |

The plugin soft-depends on PlaceholderAPI, MBedwars and BedWars1058, so it loads fine even when some are missing (it logs `No supported BedWars plugin found!` if neither Bedwars plugin is present).

---

## 2. Installation

```bash
mvn clean package
```

The shaded JAR is `target/RankedBedwars-1.0.0.jar`. (Or grab the release jar from the repo — no extra dependencies to install; gson is shaded in, and the two vendored libs are bundled, see [Note on vendored libraries](#10-note-on-vendored-libraries).)

1. Copy the JAR into your server's `plugins/` folder.
2. Restart the server (first start generates `plugins/rankedbedwars/config.yml` and `permission.yml`).
3. Edit the config (next section), then `/rbw reload` or restart again.

---

## 3. FIRST-TIME CONNECTION (the critical section)

1. Open `plugins/rankedbedwars/config.yml`:

```yaml
websocket:
  host: "ws://localhost:8080"     # <-- MUST point at your bot server
  auth_key: "change_me_in_production"   # <-- MUST match the bot's AUTH_KEY
```

2. **`websocket.host`** — set it to your bot's address. It already includes the scheme (`ws://` or `wss://`); the plugin strips it and always appends the path, so `ws://localhost:8080` never becomes `ws://ws://localhost:8080`. If you omit a port here, you can add a separate `websocket.port` key:

```yaml
websocket:
  host: "play.deyo.lol"   # no port in the host
  port: 25565             # optional separate key (also triggers a TCP pre-check)
  auth_key: "change_me_in_production"
```

> **Gotcha:** the bot's default port is **25565** (`WEBSOCKETPORT`), but the plugin's default host is `ws://localhost:8080`. Unless your bot actually listens on 8080, you must change `websocket.host` — otherwise the plugin just retries a connection nobody answers.

3. **`websocket.auth_key`** — must match the bot's `AUTH_KEY` in its `.env` **exactly** (it's case-sensitive). On a mismatch the bot replies `auth_failure` and closes the connection.

4. Test it:

```
/rbw status   → WebSocket: Connected / Disconnected
/rbw ping     → WebSocket server ping: 12 ms
```

5. What "connected" looks like in the console:

```
[INFO] WebSocket Connection ESTABLISHED
[INFO] WebSocket authentication successful
[INFO] Successfully sent map data to WebSocket server (attempt 0)
```

If it stays on `Connection refused` or `authentication failed`, see [Troubleshooting](#8-troubleshooting).

---

## 4. Full `config.yml` reference

The plugin config only has four sections — **all Discord channel/category/role IDs live in the bot's `.env`, not here** (see the bot README's config table).

| Key | Default | Description |
|---|---|---|
| `websocket.host` | `ws://localhost:8080` | Bot address. May include `ws://`/`wss://` scheme (handled automatically) |
| `websocket.port` | *(not present)* | Optional. If set, used as the connection port and a raw TCP pre-check runs on startup |
| `websocket.auth_key` | `change_me_in_production` | **Must equal the bot's `AUTH_KEY`** |
| `api.host` | `websocket.deyo.lol` | REST API host for `/stats` (the bot's REST API, port below) |
| `api.port` | `25506` | REST API port for `/stats` |
| `data-storage.enabled` | `true` | Store raw game data locally (debugging; authoritative stats live in MongoDB via the bot) |
| `data-storage.folder-path` | `games` | Folder (inside the plugin folder) for that data |
| `debug` | `false` | Prints every WebSocket message etc. to the console |

For reference, the IDs that *are* configured on the bot side (`.env`) and what they do:

- Channels: `gamesChannel` (game start notifications), `scoringChannel` (results), `voidingChannel` (void notices), `alertsChannel` (general alerts), `punishmentsChannel` (ban/mute logs), `strikerequestsChannel` / `voidrequestsChannel` / `screensharerequestsChannel` (request queues), `botstatusChannel` (bot status).
- Categories: `gameCategory` (per-game text channels), `voiceCategory` (team voice channels), `screenshareCategory` (screenshare VCs).
- `waitingvc` — fallback voice channel for users who can't join a queue.
- Roles: `registered`, `nonRegistered`, `banned`, `frozen`, `screensharer`, `muted` — restriction/state roles the bot applies.
- Roles: `partyof2Queue` / `partyof3Queue` / `partyof4Queue` — party-size roles that bypass `PARTY_QUEUE_SIZE` / `COMMON_PARTY_SIZE`.

---

## 5. `permission.yml`

This file controls **who may use each Discord command** (it is not Bukkit permissions — it's sent to the bot over WebSocket on connect):

```yaml
# Each command maps to a list of Discord role IDs
wipeeveryone:
  - 321323432423423423
  - 432423423423423423
wipe:
  - "everyone"      # "everyone" = any Discord member
help:
  - "everyone"
addqueue:
  - "everyone"
```

Rules:

- The key is the **Discord slash command name** (`addqueue`, `score`, `ban`, `stats`, ...).
- The value is a list of **Discord role IDs**; the special value `"everyone"` allows all members. (The file header also notes each command can only have one list of roles.)
- Commands **not listed** here are denied by the bot ("Permissions for this command not set yet, please contact an admin") — add an entry for every command you want usable.
- Sent to the bot when the plugin connects and on `/rbw reloadpermissions`. Changes to this file need `/rbw reloadpermissions` (or a reconnect) to take effect.

---

## 6. `plugin.yml` commands

| Command | Permission | Default | Description |
|---|---|---|---|
| `/rbw` (alias `/rankedbedwars`) | `rankedbedwars.use` | true | Admin command, subcommands below |
| `/ss <ign> <reason>` | `rankedbedwars.ss` | op | Request a screenshare on a player |
| `/call <player>` | `rankedbedwars.call` | *(undeclared)* | Call another player via the bot (grants voice access) |
| `/queue` | `rankedbedwars.queue` | true | Queue for a ranked game (from in-game) |
| `/stats` | `rankedbedwars.stats` | *(undeclared)* | Show your ranked stats from the REST API |

> `rankedbedwars.call` and `rankedbedwars.stats` are referenced but **not declared** in `plugin.yml`'s permission section — grant them via a permissions plugin (or let players use them; the `/call` and `/queue` commands check `rankedbedwars.admin`-style gating where applicable). Admin subcommands check `rankedbedwars.admin` in code (fallback: ops).

`/rbw` subcommands:

| Subcommand | Description |
|---|---|
| `/rbw status` | Show connection state, data storage and debug mode |
| `/rbw ping` | Round-trip latency to the bot (ms) |
| `/rbw reload` | Reload config + permission.yml and reconnect the WebSocket |
| `/rbw maps` | List reserved (available), locked (in use) and disabled maps |
| `/rbw refresh` | Re-initialize map data and resend it to the bot |
| `/rbw test [message]` | Send a test message over the WebSocket |
| `/rbw disablemap <map>` / `/rbw enablemap <map>` | Disable/enable a map |
| `/rbw reloadpermissions` | Reload permission.yml and resend it to the bot |
| `/rbw clearcache` | Clear the PlaceholderAPI cache |

> `/rbw groups [reload]` appears in the help text but is **not implemented** in the command switch (it falls through to help).

---

## 7. Connection flow (how it works)

```
Plugin starts
   → builds ws://host[:port]/rbw/websocket
   → connects (30 s timeout, TCP no-delay)
   → sends { type: "auth", auth_key }          ← must match bot AUTH_KEY
   → bot replies auth_success                  (or auth_failure + close)
   → plugin sends server_status, permission (from permission.yml), maps_info
   → bot broadcasts queuestatus every 3 s  → shown as action bar in-game
```

- **Reconnection** is automatic: 5 s initial delay, multiplied per attempt, capped at 60 s, retrying forever. After 5 failed attempts it logs a severe warning and notifies admins in-game, but keeps trying.
- A dead connection is detected by the bot's 30 s heartbeat (ping/pong) and closed.
- `/rbw reload` shuts down the old socket and connects fresh with the new config.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `WebSocket connection refused - Bot server appears to be offline` | The bot isn't running or isn't reachable. Check the bot with `pm2 status` / `systemctl status`; check your firewall (bot port, default **25565/tcp**, must be open); verify `websocket.host`. |
| `WebSocket authentication failed: Invalid authentication key` | `websocket.auth_key` doesn't equal the bot's `AUTH_KEY` (case-sensitive). Fix and `/rbw reload`. |
| `ws://ws://...` in the log | Shouldn't happen anymore — the plugin strips an existing scheme from `websocket.host` (`buildWebSocketUri`). If you see it, you're running an older jar. |
| `Failed to send map data after 3 attempts` / maps not showing in `/maps` | MapManager wasn't ready at connect time. Run `/rbw refresh` (re-initializes maps and resends) or `/rbw reload` once the arena list is loaded. |
| `/rbw ping` hangs or says "WebSocket is not connected!" | No connection — see first row. If connected but pong never returns, the 30 s ping timeout in `/rbw ping` is 30 s (check `pm2 logs` on the bot side). |
| `Connection timed out` | Network/firewall issue between your MC server and the bot host (or ISP throttling). |
| Bot says "Permissions for this command not set yet" | That command has no entry in `permission.yml`; add one and `/rbw reloadpermissions`. |
| In-game action bar queue info not updating | `queuestatus` only broadcasts while a plugin is connected; confirm `/rbw status` shows Connected. |

---

## 9. Testing

```bash
mvn test   # JUnit 5 + Mockito suite (src/test/java) — runs compile + tests + package
```

---

## 10. Note on vendored libraries

`src/main/java/com/deyo/rbw/libs/` contains two JARs referenced as `system`-scope dependencies:

- `bungeecord-chat-1.8.jar` — legacy chat API for the 1.8.8 build target.
- `bedwars-api-25.6.jar` — the BedWars1058 API. The official repo (`repo.andrei1058.dev`) now serves a JS challenge page instead of artifacts for unauthenticated Maven clients, which corrupts the local cache. This jar was built from the BedWars1058 GitHub source at tag `25.6` (the `bedwars-api` module, with `ISidebar/ISidebarService/PlayerSidebarInitEvent` classes compiled against bundled sidebar stubs).

To rebuild it yourself:

```bash
git clone --branch 25.6 --depth 1 https://github.com/andrei1058/BedWars1058
cd BedWars1058/bedwars-api
mvn package -DskipTests
# then replace libs/bedwars-api-25.6.jar with target/bedwars-api-25.6.jar
```

---

## Support

For issues and support, contact [confessingtoday](https://discord.gg/ygueB6rZRX) on Discord.
