import { PermissionFlagsBits } from 'discord.js';

export interface VoiceOverwrite {
  id: string;
  allow: bigint[];
  deny: bigint[];
}

export function teamVoiceOverwrites(everyoneRoleId: string, playerIds: string[]): VoiceOverwrite[] {
  return [
    {
      id: everyoneRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Speak],
      deny: [PermissionFlagsBits.Connect],
    },
    ...playerIds.map(id => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.Stream,
      ],
      deny: [],
    })),
  ];
}
