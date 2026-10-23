const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGO_URI;
  const dbName = process.env.DBNAME;
  if (!uri) {
    console.error('Missing MONGO_URI env var');
    process.exit(1);
  }
  if (!dbName) {
    console.error('Missing DBNAME env var');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName });
  const db = mongoose.connection.db;
  if (!db) {
    console.error('No database connection');
    process.exit(1);
  }

  const topLevelRenames = {
    winstreak: 'winStreak',
    losestreak: 'loseStreak',
    isbanned: 'isBanned',
    ismuted: 'isMuted',
    isfrozen: 'isFrozen',
  };

  async function renameTopLevel(collectionName) {
    const res = await db.collection(collectionName).updateMany({}, { $rename: topLevelRenames });
    return res.modifiedCount || 0;
  }

  async function renameRecentGames(collectionName) {
    const renames = [
      { from: 'queueid', to: 'queueId' },
      { from: 'oldElo', to: 'elo_before' },
      { from: 'newElo', to: 'elo_after' },
      { from: 'ismvp', to: 'isMvp' },
    ];
    let total = 0;
    for (const { from, to } of renames) {
      const rename = {};
      rename[`recentGames.$[elem].${from}`] = `recentGames.$[elem].${to}`;
      const filter = {};
      filter[`elem.${from}`] = { $exists: true };
      const res = await db.collection(collectionName).updateMany({}, { $rename: rename }, { arrayFilters: [filter] });
      total += res.modifiedCount || 0;
    }
    return total;
  }

  const usersTop = await renameTopLevel('users');
  const usersNested = await renameRecentGames('users');
  console.log(`users: top-level modified=${usersTop} recentGames modified=${usersNested} total=${usersTop + usersNested}`);

  const seasonTop = await renameTopLevel('seasonstats');
  const seasonNested = await renameRecentGames('seasonstats');
  console.log(`seasonstats: top-level modified=${seasonTop} recentGames modified=${seasonNested} total=${seasonTop + seasonNested}`);

  const queuesRes = await db.collection('queues').updateMany({}, { $rename: { ispicking: 'isPicking' } });
  const queuesModified = queuesRes.modifiedCount || 0;
  console.log(`queues: modified=${queuesModified}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
