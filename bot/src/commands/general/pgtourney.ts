import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import { TourneyService, TourneyView } from '../../services/TourneyService';

const { errorEmbed, infoEmbed, successEmbed } = embedsFor('Tourney');

export function describeTourney(state: TourneyView): string {
  if (!state.enabled) {
    return 'Tourney mode is **off**: private games can be spectated.';
  }
  const who = state.source === 'minecraft' ? `\`${state.by}\` in game` : `<@${state.by}>`;
  return `Tourney mode is **on**: private games can't be spectated.\n-# Turned on by ${who} <t:${Math.floor(state.at.getTime() / 1000)}:R>.`;
}

export async function pgtourney(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const mode = interaction.options.getString('mode');
  if (!mode) {
    await safeReply(interaction, infoEmbed(describeTourney(TourneyService.current()), 'Private game tourney mode'));
    return;
  }
  const enabled = mode === 'on';
  if (TourneyService.current().enabled === enabled) {
    await safeReply(interaction, infoEmbed(`Tourney mode is already **${mode}**.`, 'Private game tourney mode'));
    return;
  }
  try {
    const state = await TourneyService.set(enabled, interaction.user.id, 'discord');
    await safeReply(interaction, successEmbed(`${describeTourney(state)}\n-# The Minecraft server follows as soon as it's connected.`));
  } catch (error) {
    await safeReply(interaction, errorEmbed(error instanceof Error ? error.message : 'That did not work.'));
  }
}
