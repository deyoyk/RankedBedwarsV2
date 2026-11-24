import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, Message } from 'discord.js';
import User from '../models/User';
import type { OpenTier } from './CallRoleService';
import {
  addToCall, CallContext, CallResult, closeCall, findCall, findTeamCall, muteInCall, openCall, removeFromCall, teamOf,
  tierLabel, unmuteInCall,
} from './CallControl';

export type CallAction = 'add' | 'remove' | 'open' | 'close' | 'mute' | 'unmute' | 'request';
export type VoteKind = 'open' | 'close' | 'mute' | 'unmute' | 'request';

export const VOTE_MS = 2 * 60 * 1000;
const GRAY = 0x808080;
const GOLD = 0xf0b232;
const PLAIN = 0x2b2d31;

export interface CallVote {
  id: string;
  kind: VoteKind;
  ctx: CallContext;
  requesterId: string;
  targetId?: string;
  tier?: OpenTier;
  pool: string[];
  voters: Set<string>;
  needed: number;
  expires: number;
  done: boolean;
  messages: Message[];
}

export interface CallNotifier {
  send(payload: object): void;
}

export interface Line {
  ctx: CallContext;
  text: (name: (id: string) => string) => string;
  note?: string;
  to: string[];
  ping?: string[];
  vote?: CallVote;
  discord?: 'channel' | 'dm' | 'none';
}

export function neededVotes(kind: VoteKind, poolSize: number): number {
  if (kind === 'open') return Math.max(1, poolSize);
  if (kind === 'close' || kind === 'unmute') return Math.min(2, Math.max(1, poolSize));
  return 1;
}

export class CallFlow {
  private static votes = new Map<string, CallVote>();
  private static guests = new Map<string, string>();
  private static next = 1;
  static notifier: () => CallNotifier | undefined = () => global._wsManager;

  static addedBy(channelId: string, targetId: string): string | undefined {
    return CallFlow.guests.get(`${channelId}:${targetId}`);
  }

  static async run(guild: Guild, requesterId: string, action: CallAction,
                   options: { targetId?: string; muted?: boolean; tier?: OpenTier } = {}): Promise<CallResult> {
    const targetId = options.targetId ?? '';
    if (action === 'request') {
      const ctx = await findTeamCall(guild, targetId, requesterId);
      if ('error' in ctx) return { ok: false, message: ctx.error };
      const team = teamOf(ctx.game, ctx.voice.id) ?? [];
      const vote = CallFlow.startVote('request', ctx, requesterId, team, { targetId: requesterId });
      await CallFlow.say({ ctx, text: n => `${n(requesterId)} has requested to join your voice channel.`, to: team, vote });
      return { ok: true, message: 'Your request was sent to their team.' };
    }
    const ctx = await findCall(guild, requesterId, action !== 'add' && action !== 'remove');
    if ('error' in ctx) return { ok: false, message: ctx.error };
    const team = teamOf(ctx.game, ctx.voice.id) ?? [];
    if (action === 'add' || action === 'remove') {
      const result = action === 'add' ? await addToCall(ctx, targetId, Boolean(options.muted)) : await removeFromCall(ctx, targetId);
      if (!result.ok) return result;
      if (action === 'add') CallFlow.guests.set(`${ctx.voice.id}:${targetId}`, requesterId);
      await CallFlow.say({
        ctx,
        text: n => action === 'add'
          ? `${n(requesterId)} has added ${n(targetId)} to the voice channel.`
          : `${n(requesterId)} has removed ${n(targetId)} from the voice channel.`,
        note: action === 'add' && options.muted ? '(suppressed)' : undefined,
        to: team, ping: [targetId],
      });
      return result;
    }
    if (action === 'mute') {
      const caller = CallFlow.addedBy(ctx.voice.id, targetId);
      if (!caller || caller === requesterId || !team.includes(caller)) {
        const result = await muteInCall(ctx, targetId);
        if (result.ok) {
          await CallFlow.say({ ctx, text: n => `${n(requesterId)} has muted ${n(targetId)}.`, note: '(suppressed)', to: team, ping: [targetId] });
        }
        return result;
      }
      const vote = CallFlow.startVote('mute', ctx, requesterId, [caller], { targetId });
      await CallFlow.say({ ctx, text: n => `${n(requesterId)} is requesting to mute ${n(targetId)}.`, to: [caller], vote, discord: 'dm' });
      await CallFlow.say({ ctx, text: n => `Requested ${n(caller)} to mute ${n(targetId)}.`, to: [requesterId], discord: 'none' });
      return { ok: true, message: `Requested <@${caller}> to mute <@${targetId}>.` };
    }
    const vote = CallFlow.startVote(action, ctx, requesterId, team, { targetId, tier: options.tier });
    await CallFlow.say({
      ctx,
      text: n => action === 'open'
        ? `${n(requesterId)} has requested to open the voice channel to ${tierLabel(options.tier ?? 'everyone')}.`
        : action === 'close'
          ? `${n(requesterId)} has requested to close the voice channel and kick all outsiders.`
          : `${n(requesterId)} has requested to unmute ${n(targetId)}.`,
      to: team, ping: action === 'unmute' ? [targetId] : [], vote,
    });
    if (vote.voters.size >= vote.needed) {
      return CallFlow.finish(vote);
    }
    return { ok: true, message: `Asked your team (${vote.voters.size}/${vote.needed}).` };
  }

  private static startVote(kind: VoteKind, ctx: CallContext, requesterId: string, pool: string[],
                           extra: { targetId?: string; tier?: OpenTier }): CallVote {
    CallFlow.forgetOld();
    const vote: CallVote = {
      id: String(CallFlow.next++),
      kind, ctx, requesterId, pool,
      targetId: extra.targetId, tier: extra.tier,
      voters: new Set(pool.includes(requesterId) ? [requesterId] : []),
      needed: neededVotes(kind, pool.length),
      expires: Date.now() + VOTE_MS,
      done: false,
      messages: [],
    };
    CallFlow.votes.set(vote.id, vote);
    return vote;
  }

  static async vote(voteId: string, voterId: string): Promise<CallResult> {
    const vote = CallFlow.votes.get(voteId);
    if (!vote || vote.done || vote.expires < Date.now()) {
      return { ok: false, message: 'That request is over.' };
    }
    if (!vote.pool.includes(voterId)) {
      return { ok: false, message: "That request isn't yours to answer." };
    }
    if (vote.voters.has(voterId)) {
      return { ok: false, message: `You already approved (${vote.voters.size}/${vote.needed}).` };
    }
    vote.voters.add(voterId);
    if (vote.voters.size >= vote.needed) {
      return CallFlow.finish(vote);
    }
    for (const message of vote.messages) {
      await message.edit({ components: [CallFlow.button(vote)] }).catch(() => undefined);
    }
    await CallFlow.say({ ctx: vote.ctx, text: n => `${n(voterId)} approved.`, to: vote.pool, vote, discord: 'none' });
    return { ok: true, message: `Approved (${vote.voters.size}/${vote.needed}).` };
  }

  private static async finish(vote: CallVote): Promise<CallResult> {
    vote.done = true;
    CallFlow.votes.delete(vote.id);
    for (const message of vote.messages) {
      await message.edit({ components: [] }).catch(() => undefined);
    }
    const target = vote.targetId ?? '';
    let result: CallResult;
    if (vote.kind === 'open') result = await openCall(vote.ctx, vote.tier ?? 'everyone');
    else if (vote.kind === 'close') result = await closeCall(vote.ctx);
    else if (vote.kind === 'unmute') result = await unmuteInCall(vote.ctx, target);
    else if (vote.kind === 'mute') result = await muteInCall(vote.ctx, target);
    else {
      result = await addToCall(vote.ctx, target, true);
      if (result.ok) CallFlow.guests.set(`${vote.ctx.voice.id}:${target}`, [...vote.voters][0] ?? vote.requesterId);
    }
    const team = teamOf(vote.ctx.game, vote.ctx.voice.id) ?? [];
    await CallFlow.say({
      ctx: vote.ctx,
      text: n => result.ok ? CallFlow.doneText(vote, n) : `Couldn't do that: ${result.message.replace(/<[@#&]+\d+>/g, 'them').replace(/`/g, '')}`,
      note: result.ok && (vote.kind === 'request' || vote.kind === 'mute') ? '(suppressed)' : undefined,
      to: vote.kind === 'request' ? [...team, target] : team,
      ping: target ? [target] : [],
    });
    return result;
  }

  static doneText(vote: CallVote, n: (id: string) => string): string {
    const target = vote.targetId ?? '';
    switch (vote.kind) {
      case 'open': return `The voice channel is open to ${tierLabel(vote.tier ?? 'everyone')}.`;
      case 'close': return 'The voice channel is closed and outsiders were moved out.';
      case 'unmute': return `${n(target)} can talk now.`;
      case 'mute': return `${n(target)} was muted.`;
      default: return `${n(target)} was let into the voice channel.`;
    }
  }

  private static forgetOld(): void {
    const now = Date.now();
    for (const [id, vote] of CallFlow.votes) {
      if (vote.expires < now) CallFlow.votes.delete(id);
    }
  }

  static async say(line: Line): Promise<void> {
    const named = new Set([...line.to, ...(line.ping ?? [])]);
    line.text(id => {
      named.add(id);
      return '';
    });
    const ids = [...named];
    const users = await User.find({ discordId: { $in: ids } }).select('discordId ign').lean() as Array<{ discordId: string; ign?: string }>;
    const ign = new Map(users.map(u => [u.discordId, u.ign || 'someone']));
    const vote = line.vote;
    CallFlow.notifier()?.send({
      type: 'call_alert',
      recipients: line.to.map(id => ign.get(id)).filter((name): name is string => Boolean(name)),
      text: line.text(id => ign.get(id) ?? 'someone'),
      note: line.note ?? null,
      vote_id: vote ? vote.id : null,
      count: vote ? vote.voters.size : null,
      needed: vote ? vote.needed : null,
    });
    const where = line.discord ?? 'channel';
    if (where === 'none') return;
    const payload = {
      embeds: [CallFlow.embed(line)],
      components: vote ? [CallFlow.button(vote)] : [],
    };
    if (where === 'dm') {
      for (const id of line.to) {
        const member = line.ctx.guild.members.cache.get(id);
        const sent = await member?.send(payload).catch(() => null);
        if (sent && vote) vote.messages.push(sent);
      }
      return;
    }
    const channel = line.ctx.voice;
    if (!('send' in channel) || typeof channel.send !== 'function') return;
    const ping = line.ping ?? [];
    const sent = await channel.send({
      ...payload,
      content: ping.length ? ping.map(id => `<@${id}>`).join(' ') : undefined,
      allowedMentions: { users: ping },
    }).catch(() => null);
    if (sent && vote) vote.messages.push(sent);
  }

  static embed(line: Line): EmbedBuilder {
    const text = `**[VC]** ${line.text(id => `<@${id}>`)}${line.note ? `\n-# ${line.note}` : ''}`;
    return new EmbedBuilder().setColor(line.vote ? GOLD : line.note ? GRAY : PLAIN).setDescription(text);
  }

  static button(vote: CallVote): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`call:vote:${vote.id}`).setLabel(`Approve (${vote.voters.size}/${vote.needed})`).setStyle(ButtonStyle.Success),
    );
  }
}
