# Plugin

Minecraft side of Ranked Bedwars. Warps players into arenas, reports results to the bot, handles verification codes and synced bans. Works with BedWars1058 or MBedwars on Spigot/Paper 1.8.8.

## Install it

1. Download the jar: https://github.com/deyoyk/RankedBedwarsV2/releases
2. Drop it into your server `plugins/` folder.
3. Restart the server. This creates `plugins/rankedbedwars/config.yml` and `permission.yml`.

To build it yourself: `cd plugin` then `mvn clean package`. The jar lands in `target/`.

## Config it

Open `plugins/rankedbedwars/config.yml` and set these two values:

```yaml
bot_url: "YOUR-BOT-IP:25565"
auth_key: "same-secret-as-bot-AUTH_KEY"
```

`bot_url` is your bot address with port. The port defaults to 25565 when omitted. `auth_key` must match the bot `AUTH_KEY` exactly. Then run `/rbw reload` in game.

Check it worked:

```
/rbw status   -> WebSocket: Connected
/rbw ping     -> round trip time in ms
```

## permission.yml

This file decides who can use each Discord command. Each command maps to Discord role IDs, or `everyone`:

```yaml
score:
  - 123456789012345678
help:
  - "everyone"
```

Commands missing from this file are denied. After editing, run `/rbw reloadpermissions`.

## Test it

```bash
mvn test
```
