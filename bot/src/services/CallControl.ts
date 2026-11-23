import { Guild, GuildMember, OverwriteType, PermissionOverwriteOptions, PermissionsBitField, VoiceBasedChannel } from 'discord.js';
import Game from '../models/Game';
import OpenCall, { IOpenedRole } from '../models/OpenCall';
import { CALL_ROLE_LABELS, CallRoleService, OpenTier, rolesForTier, TIER_ROLES } from './CallRoleService';

export const OPEN_TIERS: OpenTier[] = ['pups', 'pugs', 'premium', 'everyone'];

export interface CallGame {
  gameId: number | string;
  team1: string[];
  team2: string[];
  channels: { team1Voice: string; team2Voice: string; picking?: string };
}

export interface CallContext {
  guild: Guild;
  voice: VoiceBasedChannel;
  game: CallGame;
  requesterId: string;
}

export type CallResult = { ok: true; message: string } | { ok: false; message: string };

const fail = (message: string): CallResult => ({ ok: false, message });

export function teamOf(game: CallGame, voiceId: string): string[] | null {
  if (voiceId === game.channels.team1Voice) return game.team1;
  if (voiceId === game.channels.team2Voice) return game.team2;
  return null;
}

export async function findTeamCall(guild: Guild, teammateId: string, requesterId: string): Promise<CallContext | { error: string }> {
  const game = await Game.findOne({
    state: { $in: ['pending', 'active'] },
    $or: [{ team1: teammateId }, { team2: teammateId }],
  }).sort({ startTime: -1 }).select('gameId team1 team2 channels').lean() as CallGame | null;
  if (!game) {
    return { error: "That player isn't in a game right now." };
  }
  const voiceId = game.team1.includes(teammateId) ? game.channels.team1Voice : game.channels.team2Voice;
  const voice = guild.channels.cache.get(voiceId) ?? await guild.channels.fetch(voiceId).catch(() => null);
  if (!voice?.isVoiceBased()) {
    return { error: "That player's team voice channel is gone." };
  }
  if (game.team1.includes(requesterId) || game.team2.includes(requesterId)) {
    return { error: "You're in that game already." };
  }
  return { guild, voice, game, requesterId };
}

export async function findCall(guild: Guild, requesterId: string, teamOnly: boolean): Promise<CallContext | { error: string }> {
  const member: GuildMember | null = guild.members.cache.get(requesterId) ?? await guild.members.fetch(requesterId).catch(() => null);
  const voice = member?.voice?.channel;
  if (!voice) {
    return { error: "You're not in a voice channel on Discord." };
  }
  const game = await Game.findOne({
    $or: [
      { 'channels.team1Voice': voice.id },
      { 'channels.team2Voice': voice.id },
      { 'channels.picking': voice.id },
    ],
  }).select('gameId team1 team2 channels').lean() as CallGame | null;
  if (!game) {
    return { error: "You're not in a game voice channel." };
  }
  if (teamOnly) {
    const team = teamOf(game, voice.id);
    if (!team || !team.includes(requesterId)) {
      return { error: 'Only players on this team can do that, from their team voice channel.' };
    }
  }
  return { guild, voice, game, requesterId };
}

export async function addToCall(ctx: CallContext, targetId: string, muted: boolean): Promise<CallResult> {
  await ctx.voice.permissionOverwrites.create(targetId, {
    ViewChannel: true,
    Connect: true,
    Speak: !muted,
    Stream: !muted,
    UseVAD: true,
  });
  return { ok: true, message: muted ? `<@${targetId}> can join <#${ctx.voice.id}> but can't talk.` : `<@${targetId}> can join <#${ctx.voice.id}>.` };
}

export async function removeFromCall(ctx: CallContext, targetId: string): Promise<CallResult> {
  if (teamOf(ctx.game, ctx.voice.id)?.includes(targetId)) {
    return fail("You can't remove someone on your own team.");
  }
  await ctx.voice.permissionOverwrites.create(targetId, { ViewChannel: true, Connect: false });
  const inside = ctx.voice.members.get(targetId);
  if (inside) {
    await inside.voice.disconnect('Removed with /call remove').catch(() => undefined);
  }
  return { ok: true, message: `<@${targetId}> can't join <#${ctx.voice.id}> any more.` };
}

export async function unmuteInCall(ctx: CallContext, targetId: string): Promise<CallResult> {
  await ctx.voice.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, Speak: true, Stream: true });
  await bounce(ctx, targetId);
  return { ok: true, message: `<@${targetId}> can talk in <#${ctx.voice.id}> now.` };
}

export async function muteInCall(ctx: CallContext, targetId: string): Promise<CallResult> {
  await ctx.voice.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true, Speak: false, Stream: false });
  await bounce(ctx, targetId);
  return { ok: true, message: `<@${targetId}> can't talk in <#${ctx.voice.id}> now.` };
}

async function bounce(ctx: CallContext, targetId: string): Promise<void> {
  const inside = ctx.voice.members.get(targetId);
  const waiting = ctx.game.channels.picking ? ctx.guild.channels.cache.get(ctx.game.channels.picking) : null;
  if (inside && waiting?.isVoiceBased() && waiting.id !== ctx.voice.id) {
    await inside.voice.setChannel(waiting).catch(() => undefined);
    await inside.voice.setChannel(ctx.voice).catch(() => undefined);
  }
}

export async function openCall(ctx: CallContext, tier: OpenTier): Promise<CallResult> {
  const roles = rolesForTier(tier, CallRoleService.current(), ctx.guild.roles.everyone.id);
  if (roles.length === 0) {
    const needed = tier === 'everyone' ? [] : TIER_ROLES[tier].map(key => CALL_ROLE_LABELS[key]);
    return fail(`No ${needed.join(', ')} role is set yet. An admin picks them in \`/rbwconfig\` → Call Roles.`);
  }
  const existing = await OpenCall.findOne({ channelId: ctx.voice.id }).lean();
  const saved: IOpenedRole[] = existing ? [...existing.roles] : [];
  for (const id of roles) {
    if (!saved.some(role => role.id === id)) {
      const overwrite = ctx.voice.permissionOverwrites.cache.get(id);
      saved.push({ id, allow: overwrite ? overwrite.allow.bitfield.toString() : null, deny: overwrite ? overwrite.deny.bitfield.toString() : null });
    }
  }
  await OpenCall.updateOne({ channelId: ctx.voice.id },
    { $set: { tier, roles: saved, openedBy: ctx.requesterId, at: new Date() } }, { upsert: true });
  for (const id of roles) {
    await ctx.voice.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true, Speak: true }, { type: OverwriteType.Role });
  }
  return { ok: true, message: `<#${ctx.voice.id}> is open to ${tier === 'everyone' ? 'everyone' : tierLabel(tier)}.` };
}

export function tierLabel(tier: OpenTier): string {
  return tier === 'everyone' ? 'everyone' : TIER_ROLES[tier].map(key => CALL_ROLE_LABELS[key]).join(', ');
}

export function restoreOptions(allow: string | null, deny: string | null): PermissionOverwriteOptions {
  const options: PermissionOverwriteOptions = {};
  for (const name of new PermissionsBitField(BigInt(allow ?? '0')).toArray()) {
    options[name as keyof PermissionOverwriteOptions] = true;
  }
  for (const name of new PermissionsBitField(BigInt(deny ?? '0')).toArray()) {
    options[name as keyof PermissionOverwriteOptions] = false;
  }
  return options;
}

export function staysOnClose(memberId: string, team: string[], overwriteAllowsConnect: boolean): boolean {
  return team.includes(memberId) || overwriteAllowsConnect;
}

export async function closeCall(ctx: CallContext): Promise<CallResult> {
  const open = await OpenCall.findOne({ channelId: ctx.voice.id }).lean();
  if (!open) {
    return fail(`<#${ctx.voice.id}> isn't open.`);
  }
  for (const role of open.roles) {
    await ctx.voice.permissionOverwrites.delete(role.id).catch(() => undefined);
    if (role.allow !== null || role.deny !== null) {
      await ctx.voice.permissionOverwrites.create(role.id, restoreOptions(role.allow, role.deny), { type: OverwriteType.Role });
    }
  }
  await OpenCall.deleteOne({ channelId: ctx.voice.id });
  const team = teamOf(ctx.game, ctx.voice.id) ?? [];
  let kicked = 0;
  for (const [id, member] of ctx.voice.members) {
    const own = ctx.voice.permissionOverwrites.cache.get(id);
    if (!staysOnClose(id, team, Boolean(own?.allow.has(PermissionsBitField.Flags.Connect)))) {
      await member.voice.disconnect('The call was closed').catch(() => undefined);
      kicked++;
    }
  }
  return { ok: true, message: `<#${ctx.voice.id}> is closed again${kicked ? `; ${kicked} non-team member${kicked === 1 ? ' was' : 's were'} moved out` : ''}.` };
}
