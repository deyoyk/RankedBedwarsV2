
**Ranked BedWars** developed by the one and only **Deyo**.

**Discord:** deyodyalan

**Note:** I only accept paid setup requests. I do not work for free.

This repository contains the Discord bot only.

## Features

- Ranked BedWars queues with ELO-based team balancing
- Random and captain-pick queue modes
- Party queues, private/invite-only parties, queue controls, and automatic queue cleanup
- Automatic game text/voice channel creation, player movement, and cleanup
- Player stat cards with ELO, levels, win rates, rankings, and combat stats
- Match start and result cards with MVP and bed-breaker highlights
- Configurable multi-MVP support per scored game
- Configurable multi-bed-breaker support per scored game
- Seasons, leaderboards, recent games, and ELO decay
- Discord scoring, void, and edit workflows
- Player progression with XP, levels, win streaks, and bounty bonuses
- Moderation tools for bans, mutes, strikes, and timed punishments
- Worker bot support for high-volume Discord operations
- Web dashboard for player stats and leaderboards

## Parts

- `bot/` - Discord bot. Start with `bot/README.md`.

## Setup

1. Install dependencies in `bot/` with `npm ci`.
2. Copy `bot/.env.example` to `bot/.env` and fill it in.
3. Start the bot with `npm start`.
