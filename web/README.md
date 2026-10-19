# Web

Stats website for Ranked Bedwars. Player stats, game recaps, leaderboards, seasons. Built with Next.js and exported as static files.

## Start it

The bot serves the built site automatically. Build it once, then open it:

```bash
cd web
npm install
npm run build
```

Then open `http://your-bot-host:25565/`. Rebuild after pulling site changes.

Run it locally while developing:

```bash
npm run dev
```

## Config it

To host the site somewhere else (Vercel, Netlify, any static host), deploy the `out/` folder produced by `npm run build` and edit `public/config.js` before building:

```js
const RBW_CONFIG = {
  apiBase: 'http://your-bot-host:25565',
  apiKey: 'your-bot-AUTH_KEY',
};
```

Set `apiBase` to your bot address. Set `apiKey` to your bot `AUTH_KEY`, unless the bot has `RBW_PUBLIC_API=true` in its env, which allows keyless read-only access.
