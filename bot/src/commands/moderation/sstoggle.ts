import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import { ScreenshareSwitch, ScreenshareSwitchView } from '../../services/ScreenshareSwitch';

const { errorEmbed, infoEmbed, successEmbed } = embedsFor('Screenshare');

export function describeScreenshareSwitch(state: ScreenshareSwitchView): string {
  if (state.enabled) {
    return 'Screensharing is **on**: `/screenshare` and `/ss` in game work.';
  }
  const since = state.by ? `\n-# Turned off by <@${state.by}> <t:${Math.floor(state.at.getTime() / 1000)}:R>.` : '';
  return `Screensharing is **off**: \`/screenshare\` and \`/ss\` in game are refused.${since}`;
}

export async function sstoggle(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const mode = interaction.options.getString('mode');
  if (!mode) {
    await safeReply(interaction, infoEmbed(describeScreenshareSwitch(ScreenshareSwitch.current()), 'Screensharing'));
    return;
  }
  const enabled = mode === 'on';
  if (ScreenshareSwitch.current().enabled === enabled) {
    await safeReply(interaction, infoEmbed(`Screensharing is already **${mode}**.`, 'Screensharing'));
    return;
  }
  try {
    const state = await ScreenshareSwitch.set(enabled, interaction.user.id);
    await safeReply(interaction, successEmbed(describeScreenshareSwitch(state)
      + (enabled ? '' : '\n-# Screenshares already open carry on; staff can still close them.')));
  } catch (error) {
    await safeReply(interaction, errorEmbed(error instanceof Error ? error.message : 'That did not work.'));
  }
}
