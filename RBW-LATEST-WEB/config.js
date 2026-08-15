// Ranked Bedwars web UI — deploy-time configuration.
//
// apiBase: leave "" when the site is served by the bot itself (same origin).
//          For a separately hosted site, point it at the bot, e.g.
//          "https://rbw.example.com" or "http://1.2.3.4:25565".
//
// apiKey:  required unless the bot runs with RBW_PUBLIC_API=true. Put the same
//          value as the bot's AUTH_KEY here (loaded from the bot's /rbw/web/config
//          endpoint when served same-origin; edit this file if hosting elsewhere).
const RBW_CONFIG = {
  apiBase: '',
  apiKey: '',
};
