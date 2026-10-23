# Bot

Discord bot for Ranked Bedwars. Queues, matchmaking, scoring, seasons, punishments. Stores everything in MongoDB and talks to your Minecraft server over WebSocket.

## You need

- Node.js 20 or newer
- MongoDB 6 or newer (local or Atlas)
- A Discord bot token and server

## Start it

```bash
cd bot
npm install
npm run setup
```

Open `.env` and fill in these values:

| Value | What it is |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `CLIENT_ID` | Bot application ID from the Developer Portal |
| `GUILD_ID` | Your Discord server ID (right click the server with Developer Mode on) |
| `MONGO_URI` | MongoDB connection string |
| `AUTH_KEY` | Any random secret. Must match the plugin config exactly |
| `WEBSOCKETPORT` | Port for WebSocket and API. Default 25565 |

Everything else in `.env.example` is optional and has working defaults. Channel and role IDs can be added later.

Then check the config and run:

```bash
npm run validate
npm run build
npm start
```

Keep it running with pm2:

```bash
npm i -g pm2
pm2 start dist/index.js --name rbw-bot
pm2 save
```

Or with Docker:

```bash
npm run setup
docker compose up -d --build
```

## Commands

All commands are slash commands: `/register`, `/stats`, `/leaderboard`, `/party`, `/queue`, `/score`, `/ban`, `/addqueue`, `/startseason`, `/help` and more. Use `/help` in Discord for the full list.

Command permissions come from the plugin's `permission.yml`. See `plugin/README.md`.

## Tests

```bash
npm test
npm run lint
```

Tests run on Jest with ts-jest. Use `npm test`; other runners (e.g. `bun test`) are not supported because the suite relies on Jest module mocking.

## Field-name migration

Stored field names follow camelCase (`winStreak`, `isBanned`, `queueId`, `elo_before`). If you are
upgrading from a version that stored the old names (`winstreak`, `isbanned`, `queueid`, `oldElo`
and friends), run the migration once against your database:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/deyorbw DBNAME=deyorbw npm run migrate
```

It renames the fields on users, season stats, recent games and queues, and prints a per-collection
summary. Back up your database first.
