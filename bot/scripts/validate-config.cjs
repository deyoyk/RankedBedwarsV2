const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['.env', '.env.example']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
    }
    if (f === '.env') break;
  }
}
const isSnow = v => /^\d{17,20}$/.test((v || '').trim());
const errors = [];
if (!process.env.DISCORD_TOKEN?.trim()) errors.push('DISCORD_TOKEN is required');
if (!isSnow(process.env.CLIENT_ID)) errors.push('CLIENT_ID must be 17-20 digits');
if (!isSnow(process.env.GUILD_ID)) errors.push('GUILD_ID must be 17-20 digits');
if (!process.env.AUTH_KEY?.trim()) errors.push('AUTH_KEY is required');
if (!process.env.MONGO_URI?.trim()) errors.push('MONGO_URI is required');
const port = parseInt(process.env.WEBSOCKETPORT || '25565', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('WEBSOCKETPORT must be 1-65535');
const SNOW_KEYS = ['CLIENT_ID','GUILD_ID','GAME_CATEGORY_ID','VOICE_CATEGORY_ID','SCREEN_SHARE_CATEGORY_ID','GAMES_CHANNEL_ID','SCORING_CHANNEL_ID','VOIDING_CHANNEL_ID','ALERTS_CHANNEL_ID','PUNISHMENTS_CHANNEL_ID','STRIKE_REQUESTS_CHANNEL_ID','VOID_REQUESTS_CHANNEL_ID','SCREEN_SHARE_REQUESTS_CHANNEL_ID','BOT_STATUS_CHANNEL_ID','WAITING_ROOM_ID','REGISTERED_ROLE_ID','NON_REGISTERED_ROLE_ID','BANNED_ROLE_ID','MUTED_ROLE_ID','SCREEN_SHARER_ROLE_ID','FROZEN_ROLE_ID','PARTY_OF_2_ROLE_ID','PARTY_OF_3_ROLE_ID','PARTY_OF_4_ROLE_ID'];
for (const k of SNOW_KEYS) {
  const v = (process.env[k] || '').trim();
  if (v && !isSnow(v)) errors.push(`${k} is not a valid snowflake: ${v}`);
}
if (errors.length) {
  console.error('Config invalid:');
  errors.forEach(e => console.error(' - ' + e));
  process.exit(1);
}
console.log('Config OK');
