import { registerVcLeaveCleanupListener } from './handlers/VcLeaveCleanupListener';
import { Client, GatewayIntentBits } from 'discord.js';
import mongoose from 'mongoose';
import config, { validateConfig } from './config/config';
import { CommandManager } from './managers/CommandManager';
import { WebSocketManager } from './websocket/WebSocketManager';
import { ApiManager } from './api/ApiManager';
import { BotStatusTask } from './tasks/BotStatusTask';
import { PartyCleanupTask } from './tasks/PartyCleanupTask';
import { ChannelsCleanupTask } from './tasks/ChannelsCleanupTask';
import { StatusRotationTask } from './tasks/StatusRotationTask';
import { ScreenshareCleanupTask } from './tasks/ScreenshareCleanupTask';
import { EloDecayTask } from './tasks/EloDecayTask';
import { WorkersManager } from './managers/WorkersManager';
import { GuildJoinListener } from './handlers/GuildJoinListener';
import type { GameManager } from './Matchmaking/GameManager';
import { setBrandIcon } from './utils/betterembed';

declare global {
  
  var _gameManager: GameManager | undefined;
}


 


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});


registerVcLeaveCleanupListener(client);

if (!process.env.AUTH_KEY) {
  console.error('[Bot] AUTH_KEY environment variable is not set. Refusing to start (WebSocket/API would be unauthenticated).');
  process.exit(1);
}

const configErrors = validateConfig(config);
if (configErrors.length > 0) {
  console.error('[Bot] Invalid configuration:');
  for (const e of configErrors) console.error(`  - ${e}`);
  console.error('[Bot] Fix .env (see .env.example) and restart.');
  process.exit(1);
}

const wsPort = parseInt(config.websocketport, 10) || 25565;
const wsPath = '/rbw/websocket'; 

const wsManager = new WebSocketManager(wsPort, client, wsPath); 

const apiManager = new ApiManager(client, wsManager);


const commandManager = new CommandManager(client, wsManager);


let botStatusTask: BotStatusTask;
let partyCleanupTask: PartyCleanupTask;
let channelsCleanupTask: ChannelsCleanupTask;
let statusRotationTask: StatusRotationTask;
let screenshareCleanupTask: ScreenshareCleanupTask;
let eloDecayTask: EloDecayTask;
let gameManager: GameManager | undefined;
let workersManager: WorkersManager;

client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`);
  setBrandIcon(client.user?.displayAvatarURL({ size: 64 }));
  try {
    const mongouri = config.mongoUri;
    const dbname = config.dbname;
    
    console.log('[MongoDB] Attempting MongoDB connection...');
    try {
      const maskedUri = new URL(mongouri);
      if (maskedUri.password) maskedUri.password = '***';
      if (maskedUri.username) maskedUri.username = '***';
      console.log('[MongoDB] URI:', maskedUri.toString());
    } catch {
      console.log('[MongoDB] URI:', mongouri.split('@').pop());
    }


    
    await mongoose.connect(mongouri, {
      dbName: dbname,
      retryWrites: true,
      w: 'majority'
    });
    
    console.log('[MongoDB] Connected to MongoDB');
    

    workersManager = WorkersManager.getInstance(client);
    await workersManager.initialize();

    await commandManager.registerSlashCommands();
    await apiManager.start();
    botStatusTask = new BotStatusTask(client, wsManager);
    await botStatusTask.start();
    partyCleanupTask = new PartyCleanupTask(client);
    partyCleanupTask.start();
    channelsCleanupTask = new ChannelsCleanupTask(client);
    statusRotationTask = new StatusRotationTask(client);
    statusRotationTask.start();
    screenshareCleanupTask = new ScreenshareCleanupTask(client);
    screenshareCleanupTask.start();
    eloDecayTask = new EloDecayTask(client);
    eloDecayTask.start();

    const { GameManager } = await import('./Matchmaking/GameManager');
    gameManager = new GameManager(client, wsManager);
    
    
    global._gameManager = gameManager;
    
    wsManager.setGameManager(gameManager);

    await gameManager.recoverActiveGames();
    await gameManager.recoverPendingSettlements();
    gameManager.startSettlementRecoveryLoop();

    const queueListener = new (await import('./handlers/QueueListener')).QueueListener(client, wsManager, gameManager);
    await queueListener.initialize();
    client.on('voiceStateUpdate', (oldState, newState) => {
      void queueListener.handleVoiceStateUpdate(oldState, newState);
    });
    console.log('[QueueListener] Voice state listener registered');
    channelsCleanupTask.start();

    new GuildJoinListener(client);

    const { BanManager } = await import('./managers/BanManager');
    const { MuteManager } = await import('./managers/MuteManager');
    setInterval(async () => {
      const guild = client.guilds.cache.first();
      if (guild) {
        try {
          await BanManager.autoUnban(guild);
          await MuteManager.autoUnmute(guild);
        } catch (intervalError) {
          console.error('[Bot] Error in auto-unban/unmute interval:', intervalError);
        }
      }
    }, 60 * 1000); 
  } catch (error) {
    console.error('Error during startup:', error);
    process.exit(1);
  }
});


process.on('unhandledRejection', (reason) => {
  console.error('[Bot] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Bot] Uncaught exception:', error);
});



client.login(config.token);