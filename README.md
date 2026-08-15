# Ranked Bedwars System

A Discord bot + Minecraft plugin pairing that runs ranked Bedwars matchmaking — ELO-based queues, live scoring, seasons, and screenshares — connected by a WebSocket bridge between Discord and your Bedwars server.

## Features

- **ELO-based queues** using Discord voice channels, with ranked/unranked modes and random or captain (picking) matchmaking
- **Party system** with size limits and dedicated party roles
- **Full statistics tracking** — kills, beds, finals, winstreaks, levels, ELO history — plus leaderboards and seasons/chapters
- **In-game integration** — auto-warp players to arenas, live queue status in the action bar, in-game verification codes
- **Scoring & moderation** — game scoring, voiding with requests, strikes, bans and mutes that sync to the game server, screenshare sessions
- **Permission system** driven by the plugin's `permission.yml` (command → Discord role IDs)
- **REST API** for users, leaderboards, games, seasons, queues and maps
- **Dual Bedwars support** — works with BedWars1058 (25.6+) and MBedwars (5.3.2+)

## Architecture

```
+---------------------+   WebSocket, AUTH_KEY   +---------------------+
|    Discord Bot      | <---------------------> |   Minecraft Plugin  |
| (Node.js, discord.js|  /rbw/websocket:25565   |  (Spigot 1.8.8)    |
+---------------------+                         +---------------------+
        |                                                 |
        | MongoDB                                         | BedWars1058 / MBedwars
        v                                                 v
+---------------------+                         +---------------------+
|       MongoDB       |                         |     Game Server     |
+---------------------+                         +---------------------+
```

## Setup

- [Discord Bot Setup](RBW-LATEST-BOT/README.md) — hosting, configuration, commands, WebSocket & REST API reference
- [In-Game Plugin Setup](RBW-LATEST-Ingame/README.md) — connecting your Bedwars server to the bot

### Quick start

```bash
# Discord bot
cd RBW-LATEST-BOT
npm install
npm run build
npm start

# Minecraft plugin
cd RBW-LATEST-Ingame
mvn clean package   # jar lands in target/
```

## Testing

```bash
cd RBW-LATEST-BOT   # Jest unit tests + ESLint
npm test
npm run lint

cd RBW-LATEST-Ingame   # JUnit 5 + Mockito
mvn test
```

## Support

For issues and support, contact [confessingtoday](https://discord.gg/ygueB6rZRX) on Discord.
