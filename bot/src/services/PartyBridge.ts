import { ButtonInteraction, Client, ComponentType, Guild, Message } from 'discord.js';
import Party from '../models/Party';
import User from '../models/User';
import { PartyService, type PartyDocument, type PartyEvent } from './PartyService';
import { PrivateGameService } from './PrivateGameService';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import { botCommandsChannelId, postIn } from '../utils/notifyChannel';
import { embedsFor } from '../utils/betterembed';

const { errorEmbed, successEmbed, themedEmbed, themedFrom } = embedsFor('Party');

/**
 * The in-game /party commands. The Minecraft server sends party_command and gets party_result back;
 * party members who are online in game hear about joins, leaves and the rest (party_notify), invites
 * show up in game (party_invite) or, for a player who isn't online, in the bot commands channel.
 * Parties are the same ones /party on Discord uses.
 */
interface PartyCommandPayload {
  type: 'party_command';
  request_id?: string;
  ign?: string;
  action?: string;
  target?: string;
  map?: string;
}

interface PartyView {
  party_id: string;
  leader: string;
  members: string[];
  open: boolean;
  private_games: boolean;
  max: number;
}

interface UserLite {
  discordId: string;
  ign?: string;
  elo?: number;
  partyId?: string;
}

const DUEL_TIMEOUT_MS = 2 * 60 * 1000;

export class PartyBridge {
  /** The challenged party -> who challenged it. */
  private readonly duels = new Map<string, { fromPartyId: string; expiresAt: number }>();

  constructor(private readonly client: Client, private readonly ws: WebSocketManager) {}

  start(): void {
    this.ws.setGlobalHandler('party_command', (msg) => {
      void this.handle(msg as unknown as PartyCommandPayload);
    });
    PartyService.listener = (event) => {
      void this.onEvent(event);
    };
    console.log('[PartyBridge] In-game /party commands are linked');
  }

  // ---- helpers ----

  private guild(): Guild | undefined {
    return this.client.guilds.cache.first();
  }

  private async userByIgn(ign: string): Promise<UserLite | null> {
    if (!ign) return null;
    return await User.findOne({ ign }).collation({ locale: 'en', strength: 2 })
      .select('discordId ign elo partyId').lean() as UserLite | null;
  }

  private async ignsOf(ids: string[]): Promise<Map<string, string>> {
    const docs = await User.find({ discordId: { $in: ids } }).select('discordId ign').lean() as UserLite[];
    return new Map(docs.map(d => [d.discordId, d.ign || d.discordId]));
  }

  private async view(party: PartyDocument | { partyId: string; leader: string; members: string[]; isPrivate?: boolean; privateGames?: boolean; maxMembers?: number }): Promise<PartyView> {
    const names = await this.ignsOf([...party.members]);
    return {
      party_id: party.partyId,
      leader: names.get(party.leader) || party.leader,
      members: party.members.filter(id => id !== party.leader).map(id => names.get(id) || id),
      open: !party.isPrivate,
      private_games: Boolean(party.privateGames),
      max: party.maxMembers ?? 8,
    };
  }

  private reply(msg: PartyCommandPayload, ok: boolean, message: string, extra: Record<string, unknown> = {}): void {
    this.ws.send({ type: 'party_result', request_id: msg.request_id, ign: msg.ign, action: msg.action, ok, message, ...extra });
  }

  /** Tells these players in game (the server shows it to the ones who are online). */
  private async notify(memberIds: string[], message: string, exceptIgn?: string): Promise<void> {
    if (!memberIds.length) return;
    const names = await this.ignsOf([...new Set(memberIds)]);
    const igns = [...names.values()].filter(n => !exceptIgn || n.toLowerCase() !== exceptIgn.toLowerCase());
    if (igns.length) this.ws.send({ type: 'party_notify', igns, message });
  }

  private async isInGame(ign: string): Promise<boolean> {
    const status = await this.ws.checkPlayerOnline(ign, 2500).catch(() => ({ online: null }));
    return status.online === true;
  }

  /** Friendly text for PartyService's short errors. */
  private static why(error?: string): string {
    switch (error) {
      case 'Not in a party': return "You're not in a party.";
      case 'Not party leader': return 'Only the party leader can do that.';
      case 'User not registered': return "You're not registered. Use /register on Discord.";
      case 'Target user not registered': return "That player isn't registered on Discord.";
      case 'Target user already in party': return 'That player is already in a party.';
      case 'User has party invites disabled': return 'That player has party invites turned off.';
      case 'User already in party': return "They're already in your party.";
      case 'Party is full': return 'The party is full.';
      case 'Already in a party': return "You're already in a party. Leave it first (/party leave).";
      case 'Party is private': return "That party is closed. Ask the leader for an invite.";
      case 'User not in party': return "That player isn't in your party.";
      case 'Cannot kick yourself': return "You can't kick yourself. Use /party disband.";
      case 'Already the leader': return "You're already the leader.";
      default: return error || 'Something went wrong.';
    }
  }

  // ---- commands ----

  private async handle(msg: PartyCommandPayload): Promise<void> {
    const action = (msg.action || '').toLowerCase();
    try {
      const me = await this.userByIgn(msg.ign || '');
      if (!me) {
        this.reply(msg, false, "You're not registered. Use /register on Discord first.");
        return;
      }
      const guild = this.guild();
      if (!guild) {
        this.reply(msg, false, 'The Discord server is not available right now.');
        return;
      }
      switch (action) {
        case 'list':
        case 'info':
          return await this.list(msg, me);
        case 'invite':
          return await this.invite(msg, me, guild);
        case 'accept':
        case 'join':
          return await this.join(msg, me, guild);
        case 'leave':
          return await this.leave(msg, me, guild);
        case 'disband':
          return await this.disband(msg, me, guild);
        case 'kick':
          return await this.kick(msg, me, guild);
        case 'promote':
        case 'transfer':
          return await this.promote(msg, me);
        case 'private':
          return await this.togglePrivate(msg, me);
        case 'open':
        case 'close':
          return await this.setOpen(msg, me, action === 'open');
        case 'queue':
          return await this.queue(msg, me, guild);
        case 'duel':
          return await this.duel(msg, me, guild);
        default:
          this.reply(msg, false, 'Unknown party command.');
      }
    } catch (error) {
      console.error(`[PartyBridge] /party ${action} for ${msg.ign} failed:`, error);
      this.reply(msg, false, 'Something went wrong on Discord. Try again.');
    }
  }

  private async myParty(me: UserLite): Promise<PartyDocument | null> {
    const validation = await PartyService.validatePartyAccess(me.discordId);
    return validation.isValid && validation.party ? validation.party : null;
  }

  private async list(msg: PartyCommandPayload, me: UserLite): Promise<void> {
    const party = await this.myParty(me);
    if (!party) {
      this.reply(msg, false, "You're not in a party.");
      return;
    }
    this.reply(msg, true, '', { party: await this.view(party) });
  }

  private async invite(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const target = await this.userByIgn(msg.target || '');
    if (!target || !target.ign) {
      this.reply(msg, false, `${msg.target} isn't registered on Discord.`);
      return;
    }
    if (target.discordId === me.discordId) {
      this.reply(msg, false, "You can't invite yourself.");
      return;
    }
    let party = await this.myParty(me);
    if (!party) {
      // Inviting someone starts a party, closed until the leader opens it.
      const created = await PartyService.createParty(me.discordId, { isPrivate: true });
      if (!created.success || !created.party) {
        this.reply(msg, false, PartyBridge.why(created.error));
        return;
      }
      party = created.party;
    }
    const result = await PartyService.inviteToParty(me.discordId, target.discordId, guild, 'game');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    if (await this.isInGame(target.ign)) {
      this.ws.send({ type: 'party_invite', ign: target.ign, from: me.ign, party_id: party.partyId });
      this.reply(msg, true, `Invited ${target.ign}. They have 5 minutes to accept.`);
      await this.notify(party.members, `${me.ign} invited ${target.ign} to the party.`, me.ign);
      return;
    }
    // Not online in game: invite them on Discord, in the bot commands channel.
    const sent = await postIn(this.client, botCommandsChannelId(), {
      content: `<@${target.discordId}>`,
      embeds: result.embed ? [result.embed.setFooter({ text: `Invited from in game by ${me.ign}` })] : [],
      components: result.components ?? [],
      allowedMentions: { users: [target.discordId] },
    });
    if (!sent) {
      this.reply(msg, false, `${target.ign} isn't online, and no bot commands channel is set up to invite them on Discord.`);
      return;
    }
    this.watchInvite(sent, party.partyId, target.discordId, guild);
    this.reply(msg, true, `${target.ign} isn't online, so they were invited on Discord.`);
    await this.notify(party.members, `${me.ign} invited ${target.ign} to the party (on Discord).`, me.ign);
  }

  /** The Accept / Decline buttons on an invite posted from in game. */
  private watchInvite(message: Message, partyId: string, targetId: string, guild: Guild): void {
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: PartyService.INVITE_TIMEOUT,
    });
    let done = false;
    collector.on('collect', async (button: ButtonInteraction) => {
      if (button.user.id !== targetId) {
        await button.reply({ embeds: [errorEmbed('This invitation is not for you!', 'Party Error').builder], ephemeral: true }).catch(() => undefined);
        return;
      }
      done = true;
      collector.stop();
      const base = message.embeds[0]?.toJSON();
      if (button.customId.startsWith('party_accept_')) {
        const accepted = await PartyService.acceptInvite(partyId, targetId, guild);
        await button.update({
          embeds: [accepted.success
            ? (base ? themedFrom(base).setDescription(`<@${targetId}> has joined the party!`).setColor('success') : successEmbed('Joined the party!').builder)
            : errorEmbed(PartyBridge.why(accepted.message), 'Party Error').builder],
          components: [],
        }).catch(() => undefined);
      } else {
        PartyService.clearInvite(partyId, targetId);
        await button.update({
          embeds: [base ? themedFrom(base).setDescription(`<@${targetId}> declined the invitation.`).setColor('info') : errorEmbed('Declined.').builder],
          components: [],
        }).catch(() => undefined);
      }
    });
    collector.on('end', async () => {
      if (done) return;
      await message.edit({ embeds: [errorEmbed('This invitation has expired.', 'Party Invitation Expired').builder], components: [] }).catch(() => undefined);
    });
  }

  /** /party accept <leader> (an invite) or /party join <player> (an open party). */
  private async join(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const invites = PartyService.pendingInvites(me.discordId);
    let partyId: string | undefined;
    if (msg.target) {
      const other = await this.userByIgn(msg.target);
      if (!other || !other.partyId) {
        this.reply(msg, false, `${msg.target} isn't in a party.`);
        return;
      }
      partyId = other.partyId;
    } else if (invites.length > 0) {
      partyId = invites[0];
    } else {
      this.reply(msg, false, 'Usage: /party join <player>');
      return;
    }
    const party = await Party.findOne({ partyId });
    if (!party) {
      this.reply(msg, false, 'That party no longer exists.');
      return;
    }
    const result = invites.includes(partyId)
      ? await PartyService.acceptInvite(partyId, me.discordId, guild, 'game')
      : await PartyService.joinParty(me.discordId, partyId, guild, 'game');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    const fresh = await Party.findOne({ partyId });
    const leader = (await this.ignsOf([party.leader])).get(party.leader) || 'the leader';
    this.reply(msg, true, `You joined ${leader}'s party.`);
    await this.notify(fresh?.members ?? party.members, `${me.ign} joined the party.`, me.ign);
  }

  private async leave(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const party = await this.myParty(me);
    if (!party) {
      this.reply(msg, false, "You're not in a party.");
      return;
    }
    if (party.leader === me.discordId) {
      const next = party.members.find(id => id !== me.discordId);
      if (!next) {
        await this.disband(msg, me, guild);
        return;
      }
      // The leader leaves: the next member takes over.
      const promoted = await PartyService.promoteToLeader(me.discordId, next, 'game');
      if (!promoted.success) {
        this.reply(msg, false, PartyBridge.why(promoted.message));
        return;
      }
      const newLeader = (await this.ignsOf([next])).get(next) || 'someone';
      const left = await PartyService.leaveParty(me.discordId, guild, 'game');
      if (!left.success) {
        this.reply(msg, false, PartyBridge.why(left.message));
        return;
      }
      this.reply(msg, true, `You left the party. ${newLeader} is the leader now.`);
      await this.notify(party.members.filter(id => id !== me.discordId), `${me.ign} left the party. ${newLeader} is the leader now.`);
      return;
    }
    const left = await PartyService.leaveParty(me.discordId, guild, 'game');
    if (!left.success) {
      this.reply(msg, false, PartyBridge.why(left.message));
      return;
    }
    this.reply(msg, true, 'You left the party.');
    await this.notify(party.members.filter(id => id !== me.discordId), `${me.ign} left the party.`);
  }

  private async disband(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const result = await PartyService.disbandParty(me.discordId, guild, 'game');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    this.reply(msg, true, 'The party was disbanded.');
    await this.notify(result.party?.members ?? [], `${me.ign} disbanded the party.`, me.ign);
  }

  private async kick(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const target = await this.userByIgn(msg.target || '');
    if (!target) {
      this.reply(msg, false, `${msg.target} isn't registered on Discord.`);
      return;
    }
    const before = await this.myParty(me);
    const result = await PartyService.kickFromParty(me.discordId, target.discordId, guild, 'game');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    this.reply(msg, true, `${target.ign} was kicked from the party.`);
    await this.notify(before?.members ?? [], `${target.ign} was kicked from the party.`, me.ign);
  }

  private async promote(msg: PartyCommandPayload, me: UserLite): Promise<void> {
    const target = await this.userByIgn(msg.target || '');
    if (!target) {
      this.reply(msg, false, `${msg.target} isn't registered on Discord.`);
      return;
    }
    const result = await PartyService.promoteToLeader(me.discordId, target.discordId, 'game');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    this.reply(msg, true, `${target.ign} is the party leader now.`);
    await this.notify(result.party?.members ?? [], `${target.ign} is the party leader now.`, me.ign);
  }

  private async togglePrivate(msg: PartyCommandPayload, me: UserLite): Promise<void> {
    const party = await this.myParty(me);
    if (!party) {
      this.reply(msg, false, "You're not in a party.");
      return;
    }
    const result = await PartyService.setPrivateGames(me.discordId, !party.privateGames);
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    const on = Boolean(result.party?.privateGames);
    this.reply(msg, true, on
      ? 'Private games ON: /party queue picks a map and starts a private game.'
      : 'Private games OFF: /party queue joins the ranked queue.');
    await this.notify(party.members, `${me.ign} turned private games ${on ? 'on' : 'off'}.`, me.ign);
  }

  private async setOpen(msg: PartyCommandPayload, me: UserLite, open: boolean): Promise<void> {
    const result = await PartyService.updatePartySettings(me.discordId, 'private', open ? 'false' : 'true');
    if (!result.success) {
      this.reply(msg, false, PartyBridge.why(result.message));
      return;
    }
    this.reply(msg, true, open
      ? `The party is open: anyone can /party join ${me.ign}.`
      : 'The party is closed: invite only.');
    await this.notify(result.party?.members ?? [], `${me.ign} ${open ? 'opened' : 'closed'} the party.`, me.ign);
  }

  /**
   * /party queue: with private games on, the leader's pick of map starts a private game for the
   * party. Otherwise (or without a party) it's the normal queue, answered as queuefromingame_*.
   */
  private async queue(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const party = await this.myParty(me);
    if (!party || !party.privateGames) {
      await this.ws.handleQueueFromInGame({ type: 'queuefromingame', ign: me.ign || msg.ign || '', uuid: msg.request_id || '' });
      return;
    }
    if (party.leader !== me.discordId) {
      this.reply(msg, false, 'Only the party leader can start a private game.');
      return;
    }
    const map = (msg.map || '').trim();
    const result = await PrivateGameService.startPrivateGame(me.discordId, guild, this.ws, map ? { map } : {});
    if (!result.success) {
      this.reply(msg, false, result.message || 'Could not start the private game.');
      return;
    }
    this.reply(msg, true, `Private game #${result.gameId} on ${result.map} is starting!`, { game_id: result.gameId, map: result.map });
    await this.notify(party.members, `Private game #${result.gameId} on ${result.map} is starting!`, me.ign);
  }

  /**
   * /party duel <player>: challenges that player's party (both need private games on and the same
   * size). The other leader accepts with /party duel <challenger>.
   */
  private async duel(msg: PartyCommandPayload, me: UserLite, guild: Guild): Promise<void> {
    const mine = await this.myParty(me);
    if (!mine) {
      this.reply(msg, false, "You're not in a party.");
      return;
    }
    if (mine.leader !== me.discordId) {
      this.reply(msg, false, 'Only the party leader can duel.');
      return;
    }
    if (!mine.privateGames) {
      this.reply(msg, false, 'Turn on private games first (/party private).');
      return;
    }
    const other = await this.userByIgn(msg.target || '');
    if (!other || !other.partyId) {
      this.reply(msg, false, `${msg.target} isn't in a party.`);
      return;
    }
    const theirs = await Party.findOne({ partyId: other.partyId });
    if (!theirs || theirs.partyId === mine.partyId) {
      this.reply(msg, false, theirs ? "That's your own party." : `${msg.target} isn't in a party.`);
      return;
    }
    const now = Date.now();
    const incoming = this.duels.get(mine.partyId);
    if (incoming && incoming.fromPartyId === theirs.partyId && incoming.expiresAt >= now) {
      // Accepting their challenge.
      this.duels.delete(mine.partyId);
      const map = (msg.map || '').trim();
      const result = await PrivateGameService.startDuel(theirs.partyId, mine.partyId, guild, this.ws, map ? { map } : {});
      if (!result.success) {
        this.reply(msg, false, result.message || 'Could not start the duel.');
        return;
      }
      const text = `Duel accepted! Game #${result.gameId} on ${result.map} is starting.`;
      this.reply(msg, true, text, { game_id: result.gameId, map: result.map });
      await this.notify([...mine.members, ...theirs.members], text, me.ign);
      return;
    }
    if (!theirs.privateGames) {
      this.reply(msg, false, `${msg.target}'s party doesn't have private games on.`);
      return;
    }
    if (theirs.members.length !== mine.members.length) {
      this.reply(msg, false, `Your parties are different sizes (${mine.members.length} vs ${theirs.members.length}).`);
      return;
    }
    this.duels.set(theirs.partyId, { fromPartyId: mine.partyId, expiresAt: now + DUEL_TIMEOUT_MS });
    const names = await this.ignsOf([theirs.leader]);
    const leaderIgn = names.get(theirs.leader) || '';
    this.reply(msg, true, `Duel request sent to ${leaderIgn}'s party. It runs out in 2 minutes.`);
    await this.notify(mine.members, `${me.ign} challenged ${leaderIgn}'s party to a duel.`, me.ign);
    if (leaderIgn && await this.isInGame(leaderIgn)) {
      this.ws.send({ type: 'party_duel', ign: leaderIgn, from: me.ign, size: mine.members.length });
    } else {
      const embed = themedEmbed('warning')
        .setTitle('Duel Request')
        .setDescription(`<@${theirs.leader}>, **${me.ign}**'s party (${mine.members.length}) challenged yours to a private game.`)
        .addFields({ name: 'Accept', value: `Join the server and type \`/party duel ${me.ign}\` within 2 minutes.` });
      await postIn(this.client, botCommandsChannelId(), {
        content: `<@${theirs.leader}>`,
        embeds: [embed],
        allowedMentions: { users: [theirs.leader] },
      });
    }
  }

  // ---- things done on Discord, told in game ----

  private async onEvent(event: PartyEvent): Promise<void> {
    if (event.source === 'game') return; // the in-game command told everyone already
    try {
      const names = await this.ignsOf([event.userId, ...(event.actorId ? [event.actorId] : [])]);
      const who = names.get(event.userId) || 'Someone';
      const by = event.actorId ? names.get(event.actorId) || 'The leader' : '';
      switch (event.type) {
        case 'invite':
          if (by) this.ws.send({ type: 'party_invite', ign: who, from: by, party_id: event.partyId });
          return;
        case 'join':
          return await this.notify(event.members, `${who} joined the party.`);
        case 'leave':
          return await this.notify(event.members, `${who} left the party.`);
        case 'kick':
          return await this.notify(event.members, `${who} was kicked from the party.`);
        case 'promote':
          return await this.notify(event.members, `${who} is the party leader now.`);
        case 'disband':
          return await this.notify(event.members, `${by || who} disbanded the party.`);
      }
    } catch (error) {
      console.error('[PartyBridge] Could not tell the server about a party change:', error);
    }
  }
}
