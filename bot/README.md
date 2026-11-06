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

## Deploy via GitHub Actions (SFTP)

There is a separate manual workflow:
`.github/workflows/deploy-bot-sftp.yml`.

Add these as **repository secrets** (Settings → Secrets and variables →
Actions → Secrets → New repository secret):

| Secret | Value |
|---|---|
| `SFTP_HOST` | SFTP/SSH hostname |
| `SFTP_USERNAME` | SFTP username |
| `SFTP_PASSWORD` | SFTP password |

Repository variables with the same names also work, but use secrets for the
password. If you created **environment** secrets instead, the job must declare
that environment; move them to repository secrets or tell me the environment
name so it can be added to the workflow.

Then open **Actions → Deploy bot to SFTP → Run workflow**.

The workflow:

1. Downloads `rbw-bot.zip` from the latest published GitHub release, or a
   specific `release_tag` you provide.
2. Preserves the remote `.env`, deletes everything else in the target
   directory, uploads the zip, extracts it, and removes the zip.
3. Defaults to `/home/container` and port `22`; both are workflow inputs.

The remote host must also allow SSH command execution because SFTP alone
cannot unzip files. If the server does not have `unzip`, the workflow falls
back to `python3 -m zipfile`.

Publish a release first if the Actions workflow says no release was found.

## Pterodactyl

`npm build` is not a valid npm command. Use one of these as the server's
startup command:

```text
npm install --include=dev && npm run build && npm start
```

or upload the bot and use the included script:

```text
bash pterodactyl-start.sh
```

The script installs dev dependencies (Pterodactyl often sets
`NODE_ENV=production`, but `tsup`/`typescript` are needed to build), builds
the bot, and starts it.

## Commands

All commands are slash commands: `/register`, `/stats`, `/leaderboard`, `/party`, `/queue`, `/score`, `/ban`, `/addqueue`, `/startseason`, `/help` and more. Use `/help` in Discord for the full list.

Command permissions come from the plugin's `permission.yml`. See `plugin/README.md`.

## Tests

```bash
npm test
npm run lint
```

Tests run on Jest with ts-jest. Use `npm test`; other runners (e.g. `bun test`) are not supported because the suite relies on Jest module mocking.
