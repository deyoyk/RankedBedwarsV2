import { Client, ActivityType } from 'discord.js';

export class StatusRotationTask {
  private client: Client;
  private statusInterval: NodeJS.Timeout | null = null;
  private currentIndex = 0;

  private readonly statuses = [
    {
      name: 'Ayor Ranked Bedwars',
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
    this.statusInterval = setInterval(() => {
      this.rotateStatus();
    }, 10000);

    this.rotateStatus();
    console.log('[StatusRotationTask] Started status rotation (changes every 10 seconds)');
  }

  public stop() {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
      console.log('[StatusRotationTask] Stopped status rotation');
    }
  }

  private rotateStatus() {
    try {
      const status = this.statuses[this.currentIndex];
      this.client.user?.setActivity(status.name, { type: status.type });
      this.client.user?.setStatus('idle');
      
      this.currentIndex = (this.currentIndex + 1) % this.statuses.length;
    } catch (error) {
      console.error('[StatusRotationTask] Error rotating status:', error);
    }
  }
}