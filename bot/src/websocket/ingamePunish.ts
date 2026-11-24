import type { Guild } from 'discord.js';
import { BanManager } from '../managers/BanManager';
import { MuteManager } from '../managers/MuteManager';
import type { WebSocketNotifier } from '../managers/punishmentHelpers';
import { choosePunishment } from '../utils/modCommands';
import { recordAudit } from '../services/AuditService';

export interface IngamePunishPayload {
  type: 'ingame_punish';
  request_id?: string;
  action?: string;
  ign?: string;
  staff?: string;
  preset?: string | null;
  minutes?: number | null;
  permanent?: boolean;
  reason?: string | null;
}

export interface IngamePunishDeps {
  findUser(ign: string): Promise<{ discordId: string } | null>;
  guild(): Guild | null;
  botId(): string;
  notifier: WebSocketNotifier;
}

export interface IngamePunishResult {
  type: 'ingame_punish_result';
  request_id: string;
  ok: boolean;
  error?: 'not_registered' | 'not_punished' | 'invalid' | 'failed';
  message?: string;
  duration?: string;
  reason?: string;
  preset?: string;
}

export function typedDuration(msg: IngamePunishPayload): string {
  if (msg.permanent) {
    return 'perm';
  }
  const minutes = Number(msg.minutes);
  return Number.isFinite(minutes) && minutes > 0 ? `${Math.ceil(minutes)}m` : '';
}

export async function handleIngamePunish(msg: IngamePunishPayload, deps: IngamePunishDeps): Promise<IngamePunishResult> {
  const reply = (fields: Partial<IngamePunishResult>): IngamePunishResult =>
    ({ type: 'ingame_punish_result', request_id: String(msg.request_id || ''), ok: false, ...fields });
  const action = String(msg.action || '').toLowerCase();
  const ign = String(msg.ign || '').trim();
  const staff = String(msg.staff || '').trim() || 'Console';
  if (!ign || !['ban', 'mute', 'unban', 'unmute'].includes(action)) {
    await recordAudit({
      action: 'punishment.in_game_invalid',
      category: 'moderation',
      source: 'minecraft',
      success: false,
      actorId: staff,
      targetName: ign || undefined,
      error: 'Missing player or action',
      metadata: { action: msg.action, requestId: msg.request_id },
    });
    return reply({ error: 'invalid', message: 'Missing player or action.' });
  }
  const guild = deps.guild();
  const target = await deps.findUser(ign);
  if (!guild || !target) {
    await recordAudit({
      action: 'punishment.in_game_failed',
      category: 'moderation',
      source: 'minecraft',
      success: false,
      actorId: staff,
      guildId: guild?.id,
      targetName: ign,
      error: `${ign} isn't registered on the ranked bot`,
      metadata: { action, requestId: msg.request_id },
    });
    return reply({ error: 'not_registered', message: `${ign} isn't registered on the ranked bot.` });
  }
  const staffUser = staff === 'Console' ? null : await deps.findUser(staff);
  const moderatorId = staffUser?.discordId || deps.botId();
  try {
    if (action === 'unban' || action === 'unmute') {
      const reason = String(msg.reason || '').trim() || `${action === 'unban' ? 'Unbanned' : 'Unmuted'} in game by ${staff}`;
      const undone = action === 'unban'
        ? await BanManager.unban(guild, target.discordId, moderatorId, reason, deps.notifier, { staff })
        : await MuteManager.unmute(guild, target.discordId, moderatorId, reason, deps.notifier, { staff });
      return undone ? reply({ ok: true, reason }) : reply({ error: 'not_punished', message: `${ign} isn't ${action === 'unban' ? 'banned' : 'muted'} on Discord.` });    }
    const type = action as 'ban' | 'mute';
    const chosen = await choosePunishment(type, target.discordId, msg.preset ? String(msg.preset) : null,
      typedDuration(msg), String(msg.reason || '').trim());
    if ('error' in chosen) {
      return reply({ error: 'invalid', message: chosen.error.replace(/`/g, '') });
    }
    const options = { ...chosen.options, staff };
    if (type === 'ban') {
      await BanManager.ban(guild, target.discordId, moderatorId, chosen.duration, chosen.reason, deps.notifier, options);
    } else {
      await MuteManager.mute(guild, target.discordId, moderatorId, chosen.duration, chosen.reason, deps.notifier, options);
    }
    return reply({ ok: true, duration: chosen.duration, reason: chosen.reason, preset: chosen.options.preset });
  } catch (error) {
    return reply({ error: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
}
