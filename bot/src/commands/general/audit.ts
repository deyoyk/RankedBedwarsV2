import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import AuditLog from '../../models/AuditLog';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { escapeRegex } from '../../utils/regexEscape';

const { infoEmbed } = embedsFor('Audit');

export async function audit(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  const actor = interaction.options.getUser('actor');
  const target = interaction.options.getUser('target');
  const action = (interaction.options.getString('action') || '').trim();
  const category = interaction.options.getString('category');
  const success = interaction.options.getString('result');
  const limit = Math.min(25, Math.max(1, interaction.options.getInteger('limit') ?? 10));
  const page = Math.max(1, interaction.options.getInteger('page') ?? 1);

  const filter: Record<string, unknown> = {};
  if (actor) filter.actorId = actor.id;
  if (target) filter.targetId = target.id;
  if (action) filter.action = { $regex: escapeRegex(action), $options: 'i' };
  if (category) filter.category = category;
  if (success) filter.success = success === 'success';

  try {
    const total = await AuditLog.countDocuments(filter);
    const entries = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    if (entries.length === 0) {
      await safeReply(interaction, infoEmbed('No audit entries match those filters.', 'Audit Log', true));
      return;
    }

    const lines = entries.map(entry => {
      const when = `<t:${Math.floor(new Date(entry.createdAt).getTime() / 1000)}:R>`;
      const result = entry.success ? '✅' : '❌';
      const who = entry.actorId ? `<@${entry.actorId}>` : 'System';
      const against = entry.targetId
        ? ` → ${entry.targetType || 'user'} <@${entry.targetId}>`
        : entry.targetName ? ` → ${entry.targetName}` : '';
      const command = entry.commandName ? ` \`/${entry.commandName}\`` : '';
      const reason = entry.reason ? `\n> ${entry.reason.slice(0, 150)}` : '';
      const error = entry.error ? `\n> ${entry.error.slice(0, 150)}` : '';
      return `${result} ${when} \`${entry.action}\`${command}\n> ${who}${against}${reason}${error}`;
    });

    const pages = Math.max(1, Math.ceil(total / limit));
    const embed = infoEmbed(lines.join('\n\n').slice(0, 4000),
      `Audit Log · ${total} entr${total === 1 ? 'y' : 'ies'} · page ${page}/${pages}`, true);
    embed.builder.setTimestamp();
    await safeReply(interaction, embed);
  } catch (error) {
    await replyCommandError(interaction, error, 'load the audit log', '[audit]');
  }
}
