import CommandPermissions from '../models/CommandPermissions';
import { categoryOf, CommandCategory } from '../config/commandCategories';

export interface PermissionSettings {
  admin: string[];
  staff: string[];
  player: string[];
  playerEveryone: boolean;
}

const DEFAULTS: PermissionSettings = { admin: [], staff: [], player: [], playerEveryone: true };

/**
 * Who may use each command, set with /rbwconfig and kept per server in MongoDB.
 * Categories stack: Admin roles can also use Staff and Player commands, Staff roles Player commands.
 */
export class PermissionService {
  private static guildId = '';
  private static settings: PermissionSettings = { ...DEFAULTS };

  static async load(guildId: string): Promise<void> {
    PermissionService.guildId = guildId;
    const doc = await CommandPermissions.findOne({ guildId }).lean();
    PermissionService.settings = doc
      ? { admin: doc.admin ?? [], staff: doc.staff ?? [], player: doc.player ?? [], playerEveryone: doc.playerEveryone ?? true }
      : { ...DEFAULTS };
  }

  static current(): PermissionSettings {
    return PermissionService.settings;
  }

  /** ['everyone'], or the role IDs that may use the command; empty means server administrators only. */
  static rolesFor(command: string): string[] {
    const { admin, staff, player, playerEveryone } = PermissionService.settings;
    const category = categoryOf(command);
    if (category === 'player') {
      return playerEveryone ? ['everyone'] : unique([...player, ...staff, ...admin]);
    }
    return category === 'staff' ? unique([...staff, ...admin]) : [...admin];
  }

  static async update(change: Partial<Record<CommandCategory, string[]>> & { playerEveryone?: boolean }): Promise<PermissionSettings> {
    if (!PermissionService.guildId) {
      throw new Error('Permissions are not loaded yet');
    }
    const next: PermissionSettings = { ...PermissionService.settings, ...change };
    await CommandPermissions.updateOne({ guildId: PermissionService.guildId }, { $set: next }, { upsert: true });
    PermissionService.settings = next;
    return next;
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}
