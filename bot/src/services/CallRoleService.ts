import CallRoles from '../models/CallRoles';

export type CallRoleKey = 'pups' | 'pugstrial' | 'pugs' | 'premium';
export type OpenTier = 'pups' | 'pugs' | 'premium' | 'everyone';

export const CALL_ROLE_LABELS: Record<CallRoleKey, string> = {
  pups: 'Pups',
  pugstrial: 'Pugs Trial',
  pugs: 'Pugs',
  premium: 'Premium',
};

export const TIER_ROLES: Record<Exclude<OpenTier, 'everyone'>, CallRoleKey[]> = {
  pups: ['pups', 'pugstrial', 'pugs', 'premium'],
  pugs: ['pugs', 'premium'],
  premium: ['premium'],
};

export type CallRoleSettings = Partial<Record<CallRoleKey, string>>;

export function rolesForTier(tier: OpenTier, settings: CallRoleSettings, everyoneId: string): string[] {
  if (tier === 'everyone') {
    return [everyoneId];
  }
  return TIER_ROLES[tier].map(key => settings[key]).filter((id): id is string => Boolean(id));
}

export class CallRoleService {
  private static guildId = '';
  private static settings: CallRoleSettings = {};

  static async load(guildId: string): Promise<void> {
    CallRoleService.guildId = guildId;
    const doc = await CallRoles.findOne({ guildId }).lean();
    CallRoleService.settings = doc ? { pups: doc.pups, pugstrial: doc.pugstrial, pugs: doc.pugs, premium: doc.premium } : {};
  }

  static current(): CallRoleSettings {
    return CallRoleService.settings;
  }

  static async set(key: CallRoleKey, roleId: string | null): Promise<CallRoleSettings> {
    if (!CallRoleService.guildId) {
      throw new Error('Call roles are not loaded yet');
    }
    const next = { ...CallRoleService.settings, [key]: roleId || undefined };
    await CallRoles.updateOne({ guildId: CallRoleService.guildId },
      roleId ? { $set: { [key]: roleId } } : { $unset: { [key]: '' } }, { upsert: true });
    CallRoleService.settings = next;
    return next;
  }
}
