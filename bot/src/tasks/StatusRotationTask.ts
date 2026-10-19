import { Client, ActivityType } from 'discord.js';
import config from '../config/config';


export class StatusRotationTask {
  private client: Client;
  private statusInterval: NodeJS.Timeout | null = null;
  private currentIndex = 0;

  private readonly statuses = [
    {
      name: config.bot_stats_text,
      type: ActivityType.Playing
    },
    {
      name: 'By @loqkey',
      type: ActivityType.Playing
    }
  ];

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    if (this.statusInterval) {
      return;
    }
    this.statusInterval = setInterval(() => {
      void this.rotateStatus().catch((error) => {
        console.error('[StatusRotationTask] Error rotating status:', error);
      });
    }, 10000);

    void this.rotateStatus().catch((error) => {
      console.error('[StatusRotationTask] Error rotating status:', error);
    });
    console.log('[StatusRotationTask] Started status rotation (changes every 10 seconds)');
  }

  public stop() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  private async rotateStatus() {
    const status = this.statuses[this.currentIndex];
    await this.client.user?.setActivity(status.name, { type: status.type });
    await this.client.user?.setStatus('idle');

    this.currentIndex = (this.currentIndex + 1) % this.statuses.length;
  }
}