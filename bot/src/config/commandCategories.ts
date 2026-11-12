export type CommandCategory = 'admin' | 'staff' | 'player';

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  admin: 'Admin',
  staff: 'Staff',
  player: 'Player',
};

const CATEGORY_COMMANDS: Record<CommandCategory, string[]> = {
  admin: [
    'rbwconfig', 'queuecontrol', 'addqueue', 'removequeue', 'edit', 'unregister', 'fixall', 'addelo', 'removeelo',
    'wipe', 'wipeeveryone', 'startseason', 'endseason', 'forceregister', 'forcerename', 'gamescount', 'win', 'lose',
  ],
  staff: [
    'score', 'void', 'forcevoid', 'retry', 'strike', 'unstrike', 'ban', 'unban', 'mute', 'unmute', 'history', 'ssclose',
  ],
  player: [
    'help', 'register', 'queues', 'queue', 'games', 'gameinfo', 'maps', 'ranks', 'bonus', 'party', 'call', 'nick',
    'refresh', 'settings', 'statreset', 'claimelo', 'info', 'leaderboard', 'recentgames', 'level', 'listseasons',
    'seasoninfo', 'strikerequest', 'voidrequest', 'screenshare',
  ],
};

const CATEGORY_OF = new Map<string, CommandCategory>(
  (Object.keys(CATEGORY_COMMANDS) as CommandCategory[]).flatMap(category =>
    CATEGORY_COMMANDS[category].map(command => [command, category] as const)),
);

/** Commands nobody has put in a category are Admin, so a new command starts locked down. */
export function categoryOf(command: string): CommandCategory {
  return CATEGORY_OF.get(command) ?? 'admin';
}

export function commandsIn(category: CommandCategory): string[] {
  return CATEGORY_COMMANDS[category];
}
