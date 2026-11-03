import config from '../config/config';

export function maxPartySizeForQueue(
  queue: { isRanked?: boolean; maxPlayers: number },
  roleSizes: readonly number[],
): number {
  const partyRolesConfigured = Boolean(
    config.roles.partyof2Queue || config.roles.partyof3Queue || config.roles.partyof4Queue,
  );
  const rankedBase = partyRolesConfigured ? config.PartyQueueSize : config.CommonPartySize;
  const base = queue.isRanked === true ? rankedBase : config.CommonPartySize;
  const roleMax = roleSizes.reduce((max, size) => Math.max(max, size), 0);
  const configured = Math.max(1, base || 1, roleMax);
  const capped = Math.min(config.CommonPartySize || 8, configured);
  const capacity = Number.isFinite(queue.maxPlayers) && queue.maxPlayers > 0
    ? Math.floor(queue.maxPlayers / 2)
    : 1;
  return Math.max(1, Math.min(capacity, capped));
}
