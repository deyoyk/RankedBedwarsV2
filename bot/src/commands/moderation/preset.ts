import { AutocompleteInteraction, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import type { PresetType } from '../../models/PunishmentPreset';
import { checkStrikes, describeSteps, parseSteps, PunishmentPresets } from '../../services/PunishmentPresets';
import { StrikeRuleService, describeAction } from '../../services/StrikeRuleService';
import { MAX_IMPORT_BYTES, parsePresetFile } from '../../services/PresetImport';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

const { errorEmbed, successEmbed, infoEmbed } = embedsFor('Presets');

export async function preset(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await safeReply(interaction, errorEmbed('Only server administrators can manage punishment presets.', undefined, true));
    return;
  }
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'add') {
      const type = interaction.options.getString('type', true) as PresetType;
      const durations = interaction.options.getString('durations') || '';
      if (type !== 'strike' && !durations.trim()) {
        await safeReply(interaction, errorEmbed('A ban or mute preset needs durations, like `1d, 7d, perm`.'));
        return;
      }
      const steps = type === 'strike' ? [] : parseSteps(durations);
      const strikes = type === 'strike' ? checkStrikes(interaction.options.getInteger('strikes') ?? 1) : undefined;
      const saved = await PunishmentPresets.save(interaction.options.getString('name', true), type, steps,
        interaction.options.getString('reason', true), interaction.user.id, strikes);
      await recordAudit({
        ...auditInteractionContext(interaction),
        action: 'config.preset_save',
        category: 'config',
        source: 'discord',
        success: true,
        targetType: 'preset',
        targetId: saved.name,
        after: { name: saved.name, type: saved.type, steps, strikes, reason: saved.reason },
      });
      await safeReply(interaction, successEmbed(
        `Saved the **${saved.type}** preset \`${saved.name}\`.\n**Steps:** ${describeSteps(saved)}\n**Reason:** ${saved.reason}\n\n`
        + `Use it with \`/${saved.type} preset:${saved.name}\` here`
        + (saved.type === 'strike' ? '.' : `, or pick it from the menu \`/${saved.type} <player>\` opens in game.`)));
      return;
    }
    if (sub === 'import') {
      const file = interaction.options.getAttachment('file', true);
      if (file.size > MAX_IMPORT_BYTES) {
        await safeReply(interaction, errorEmbed('That file is too big. Presets fit in well under 256 KB.'));
        return;
      }
      const response = await fetch(file.url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        await safeReply(interaction, errorEmbed("Couldn't download that file from Discord. Try again."));
        return;
      }
      const parsed = parsePresetFile(await response.text());
      const count = await PunishmentPresets.saveAll(parsed.presets, interaction.user.id);
      const rules = parsed.strikeRules ? await StrikeRuleService.replace(parsed.strikeRules) : null;
      await recordAudit({
        ...auditInteractionContext(interaction),
        action: 'config.preset_import',
        category: 'config',
        source: 'discord',
        success: true,
        targetType: 'preset',
        targetId: file.name,
        after: { presets: parsed.presets.map(p => p.name), strikeRules: rules },
      });
      const byType = (type: string) => parsed.presets.filter(p => p.type === type).length;
      const lines = [
        `Imported **${count}** presets: ${byType('ban')} ban, ${byType('mute')} mute and ${byType('strike')} strike.`,
        'Presets with the same names were replaced; your other presets were left alone.',
      ];
      if (rules) {
        const ruleLines = rules.rules.map(r => `${r.strikes} → ${describeAction(r.action)}`).join(', ');
        lines.push('', `**Strike rules:** ${ruleLines || 'none'}; any other number → ${describeAction(rules.otherwise)}.`);
      }
      lines.push('-# `/preset list` shows them all.');
      await safeReply(interaction, successEmbed(lines.join('\n')));
      return;
    }
    if (sub === 'remove') {
      const name = interaction.options.getString('name', true);
      const removed = await PunishmentPresets.remove(name);
      await recordAudit({
        ...auditInteractionContext(interaction),
        action: 'config.preset_remove',
        category: 'config',
        source: 'discord',
        success: removed,
        targetType: 'preset',
        targetId: name.toLowerCase(),
        error: removed ? undefined : 'Preset not found',
      });
      await safeReply(interaction, removed
        ? successEmbed(`Removed the preset \`${name.toLowerCase()}\`. Past punishments keep their record of it.`)
        : errorEmbed(`There's no preset called \`${name}\`.`));
      return;
    }
    const presets = await PunishmentPresets.all();
    const lines = presets.map(p => `**${p.name}** · ${p.type} · ${describeSteps(p)}\n-# ${p.reason}`);
    await safeReply(interaction, infoEmbed(lines.length ? lines.join('\n') : 'No presets yet. Add one with `/preset add`.',
      'Punishment presets'));
  } catch (error) {
    await safeReply(interaction, errorEmbed(error instanceof Error ? error.message : 'That didn\'t work.'));
  }
}

export async function presetAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const type = ['ban', 'mute', 'strike'].includes(interaction.commandName) ? interaction.commandName : null;
  const typed = String(focused.value || '').toLowerCase();
  const presets = (await PunishmentPresets.all())
    .filter(p => (type === null || p.type === type) && p.name.includes(typed))
    .slice(0, 25);
  await interaction.respond(presets.map(p => ({ name: `${p.name} (${p.type}: ${describeSteps(p)})`.slice(0, 100), value: p.name })));
}
