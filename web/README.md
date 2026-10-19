# Web

Stats website for Ranked Bedwars. Player stats, game recaps, leaderboards, seasons.

## Start it

Nothing to install. The bot serves this folder automatically. Open:

```
http://your-bot-host:25565/
```

## Config it

To host the site somewhere else (Vercel, Netlify, any static host), copy this folder and edit `config.js`:

```js
const RBW_CONFIG = {
  apiBase: 'http://your-bot-host:25565',
  apiKey: 'your-bot-AUTH_KEY',
};
```

Set `apiBase` to your bot address. Set `apiKey` to your bot `AUTH_KEY`, unless the bot has `RBW_PUBLIC_API=true` in its env, which allows keyless read-only access.
