# Plugin

Minecraft side of Ranked Bedwars. Warps players into arenas, reports results to the bot, handles verification codes and synced bans. Works with BedWars1058 or MBedwars on Spigot/Paper 1.8.8.

## Install it

1. Download the jar: https://github.com/deyoyk/RankedBedwarsV2/releases
2. Drop it into your server `plugins/` folder.
3. Restart the server. This creates `plugins/rankedbedwars/config.yml` and `permission.yml`.

To build it yourself: `cd plugin` then `mvn clean package`. The jar lands in `target/`.

## Auto updates

On startup the plugin checks the latest GitHub release for `rbw-plugin.jar`.
If it is newer than the running jar, it downloads and SHA-256 verifies it,
then stages it for replacement.

Minecraft cannot replace a plugin jar while it is loaded (especially on
Windows), so the swap happens after the server process exits:

1. Start the server. The new jar is downloaded in the background.
2. Stop/restart the server normally.
3. The detached updater waits for the server PID to exit, backs up the old jar
   to `plugins/rankedbedwars/updates/backups/`, and copies the new jar into
   place.
4. The next server start runs the updated plugin.

Local builds newer than the latest GitHub release are not downgraded. To
disable the behaviour:

```yaml
auto-update:
  enabled: false
```

Private repos can use `auto-update.github-token` or the `RBW_GITHUB_TOKEN`
environment variable. The updater log is
`plugins/rankedbedwars/updates/updater.log`. Run `/rbw update` to check
immediately and see the result in game.

This feature ships in the jar built from this version. Deploy that jar once;
after that it updates itself from GitHub releases.

## Config it

Open `plugins/rankedbedwars/config.yml` and set these two values:

```yaml
bot_url: "YOUR-BOT-IP:25565"
auth_key: "same-secret-as-bot-AUTH_KEY"
```

`bot_url` is your bot address with port. The port defaults to 25565 when omitted. It is used for both the WebSocket and the in-game stats/PlaceholderAPI HTTP calls, because the bot serves both on the same port. `auth_key` must match the bot `AUTH_KEY` exactly. Then run `/rbw reload` in game.

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

## PlaceholderAPI

General player placeholders use `%rbw_<stat>%`:

```text
elo, level, experience, peak_elo, playtime_seconds, playtime_minutes,
playtime_hours, playtime_days, playtime_formatted, wins, losses, games, win_rate,
kills, deaths, kdr, wlr, final_kills, final_deaths, final_kd,
bed_broken, mvps, diamonds, irons, gold, emeralds, blocks_placed,
damage_dealt, damage_taken, assists, best_streak, first_bloods,
kills_per_game, deaths_per_game, final_kills_per_game,
beds_per_game, mvps_per_game, assists_per_game,
mvp_rate, bed_break_rate, first_blood_rate
```

Aliases such as `fk`, `fd`, `bb`, `ws`, `ls`, `kd`, `wl`, `dd`, `dt`,
`exp`, `xp`, and both `snake_case`/`nounderscore` forms are supported.

Live game placeholders use `%rbw_game_<stat>%` or `%rbw_ingame_<stat>%`:

```text
game_id, game_map, game_arena, game_ranked, game_mode,
game_duration, game_duration_seconds, game_duration_minutes,
game_duration_formatted, game_team, game_team_name, game_team_size,
game_team_players, game_players, game_first_blood,
game_has_first_blood, game_kills, game_deaths, game_final_kills,
game_bed_breaks, game_blocks_placed, game_diamonds, game_irons,
game_gold, game_emeralds, game_damage_dealt, game_damage_taken,
game_assists, game_streak, game_best_streak, game_kdr,
game_team_kills, game_team_deaths, game_team_final_kills,
game_team_beds, game_team_blocks_placed, game_team_damage_dealt,
game_team_damage_taken, game_team_assists, game_team_best_streak
```

Leaderboard placeholders support the same modes:

```text
%rbw_top_elo_1%              -> player name at #1
%rbw_top_elo_1_value%        -> value at #1
%rbw_top_final_kills_1%      -> aliases such as final_kills work too
%rbw_top_1_elo%              -> position-first form is accepted too
%rbw_leaderboard_elo_1%      -> leaderboard_<mode>_<pos>
%rbw_lb_elo_1%               -> lb_<mode>_<pos>
%rbw_version%                -> installed plugin version (verify the loaded jar)
```

Unknown leaderboard modes return `Invalid Mode` and unknown leaderboard placeholders return `N/A`
instead of leaving the raw `%rbw_...%` text on screen.

Players who are in a queue see a repeating action bar such as
`In Queue [0-600] 1/8`; it refreshes every second while they remain queued.