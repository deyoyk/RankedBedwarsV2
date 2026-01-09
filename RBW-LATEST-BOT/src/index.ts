import { registerVcLeaveCleanupListener } from './handlers/VcLeaveCLeanuplistner';
import { Client, GatewayIntentBits, ChatInputCommandInteraction, Interaction, RepliableInteraction, Message } from 'discord.js';
import mongoose from 'mongoose';
import config from './config/config';
import { QueueListener } from './handlers/QueueListener';
import { CommandManager } from './managers/CommandManager';
import { WebSocketManager } from './websocket/WebSocketManager';
import { ApiManager } from './api/ApiManager';
import { BotStatusTask } from './tasks/BotStatusTask';
import { PartyCleanupTask } from './tasks/PartyCleanupTask';
import { ChannelsCleanupTask } from './tasks/ChannelsCleanupTask';
import { StatusRotationTask } from './tasks/StatusRotationTask';
import { ScreenshareCleanupTask } from './tasks/ScreenshareCleanupTask';
import { WorkersManager } from './managers/WorkersManager';

import { GuildJoinListener } from './handlers/GuildJoinListener';


declare global {
  
  var _gameManager: import('./Matchmaking/GameManager').GameManager | undefined;
}


 


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});


registerVcLeaveCleanupListener(client);

const wsPort = parseInt(config.websocketport) || 8080; 
const wsPath = '/rbw/websocket'; 

const wsManager = new WebSocketManager(wsPort, client, wsPath); 

const apiManager = new ApiManager(client, wsManager);


let queueListener: any;
const commandManager = new CommandManager(client, wsManager);


let botStatusTask: BotStatusTask;
let partyCleanupTask: PartyCleanupTask;
let channelsCleanupTask: ChannelsCleanupTask;
let statusRotationTask: StatusRotationTask;
let screenshareCleanupTask: ScreenshareCleanupTask;
let gameManager: any;
let workersManager: WorkersManager;

client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user?.tag}`);
  try {
    const mongouri = config.mongoUri;
    const dbname = config.dbname;
    
    console.log('[MongoDB] Attempting MongoDB connection...');
    console.log('[MongoDB] URI:', mongouri);


    
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
    channelsCleanupTask.start();
    statusRotationTask = new StatusRotationTask(client);
    statusRotationTask.start();
    screenshareCleanupTask = new ScreenshareCleanupTask(client);
    screenshareCleanupTask.start();

    const { GameManager } = await import('./Matchmaking/GameManager');
    gameManager = new GameManager(client, wsManager);
    
    
    global._gameManager = gameManager;
    
    wsManager.setGameManager(gameManager);

    queueListener = new (await import('./handlers/QueueListener')).QueueListener(client, wsManager, gameManager);

    new GuildJoinListener(client);

    const { BanManager } = await import('./managers/BanManager');
    const { MuteManager } = await import('./managers/MuteManager');
    setInterval(async () => {
      const guild = client.guilds.cache.first();
      if (guild) {
        await BanManager.autoUnban(guild);
        await MuteManager.autoUnmute(guild);
      }
    }, 60 * 1000); 
  } catch (error) {
    console.error('Error during startup:', error);
    process.exit(1);
  }
});



client.on('voiceStateUpdate', async (oldState, newState) => {
  if (queueListener) {
    await queueListener.handleVoiceStateUpdate(oldState, newState);
  }
});

client.login(config.token);