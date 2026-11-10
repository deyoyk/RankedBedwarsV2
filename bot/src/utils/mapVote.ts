export interface MapVoteCount {
  name: string;
  votes: number;
}

export interface MapVoteResult {
  winner: string | null;
  tied: string[];
  counts: MapVoteCount[];
  totalVotes: number;
}

export function tallyMapVotes(votes: Map<string, string>, candidates: string[]): MapVoteResult {
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  const counts = uniqueCandidates.map(name => ({ name, votes: 0 }));
  const byName = new Map(counts.map(entry => [entry.name, entry]));

  let totalVotes = 0;
  for (const selected of votes.values()) {
    const entry = byName.get(selected);
    if (!entry) continue;
    entry.votes += 1;
    totalVotes += 1;
  }

  const highest = counts.reduce((max, entry) => Math.max(max, entry.votes), 0);
  const tied = counts.filter(entry => entry.votes === highest).map(entry => entry.name);

  return {
    winner: tied[0] ?? null,
    tied,
    counts,
    totalVotes,
  };
}
