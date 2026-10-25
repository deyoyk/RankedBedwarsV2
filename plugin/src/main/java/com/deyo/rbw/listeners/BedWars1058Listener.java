package com.deyo.rbw.listeners;

import com.andrei1058.bedwars.api.arena.GameState;
import com.andrei1058.bedwars.api.arena.IArena;
import com.andrei1058.bedwars.api.arena.team.ITeam;
import com.andrei1058.bedwars.api.events.gameplay.GameEndEvent;
import com.andrei1058.bedwars.api.events.gameplay.GameStateChangeEvent;
import com.andrei1058.bedwars.api.events.gameplay.TeamAssignEvent;
import com.andrei1058.bedwars.api.events.player.PlayerBedBreakEvent;
import com.andrei1058.bedwars.api.events.player.PlayerKillEvent;
import com.andrei1058.bedwars.api.events.player.PlayerLeaveArenaEvent;
import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;

import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.projectiles.ProjectileSource;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerPickupItemEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitRunnable;

import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class BedWars1058Listener implements Listener {
    
    private final RankedBedwars plugin;
    private final Map<String, BW1058GameTracker> gameTrackers = new ConcurrentHashMap<>();
    private final Map<String, BW1058GameTracker> playerTrackerIndex = new ConcurrentHashMap<>();
    private final Map<String, Long> recentPvpKills = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> preGamePlayers = new ConcurrentHashMap<>();
    
    public BedWars1058Listener(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupStaleData, 6000L, 6000L);
    }

    private void cleanupStaleData() {
        long now = System.currentTimeMillis();
        recentPvpKills.entrySet().removeIf(entry -> (now - entry.getValue()) > 300_000);
    }

    /**
     * Returns the BedWars API provider, or null when it is not registered yet
     * (e.g. BedWars1058 is still loading or was reloaded).
     */
    private com.andrei1058.bedwars.api.BedWars getBedwarsAPI() {
        org.bukkit.plugin.ServicesManager services = Bukkit.getServicesManager();
        org.bukkit.plugin.RegisteredServiceProvider<com.andrei1058.bedwars.api.BedWars> registration =
                services.getRegistration(com.andrei1058.bedwars.api.BedWars.class);
        return registration == null ? null : registration.getProvider();
    }

    @EventHandler
    public void onTeamAssign(TeamAssignEvent event){
        IArena arena = event.getArena();
        if (gameTrackers.containsKey(arena.getArenaName())) {
            event.setCancelled(true);
        }
    }
    

    public void cleanupGameTrackerForMap(String mapName) {
        BW1058GameTracker removed = gameTrackers.remove(mapName);
        if (removed != null) {
            plugin.debug("Cleaning up existing game tracker for map: " + mapName);
            unindexTracker(removed);
            preGamePlayers.remove(mapName);
            plugin.debug("Cleaned up game tracker for map: " + mapName);
        }
    }
    
    @EventHandler
    public void onGameStateChange(GameStateChangeEvent event) {
        IArena arena = event.getArena();
        String arenaName = arena.getArenaName();
        
        
        if (event.getNewState() == GameState.playing) {
            plugin.debug("Game started in arena: " + arenaName);
            String gameId = plugin.getMapManager().getGameIdForArena(arenaName);
            if (gameId == null) {
                return;
            }
            
            
            
            boolean isRanked = plugin.getMapManager().getGameIdForArena(arenaName) != null;
            BW1058GameTracker gameTracker = new BW1058GameTracker(gameId, arena, isRanked);
            gameTrackers.put(arenaName, gameTracker);
            
            
            Set<String> players = new HashSet<>();
            for (Player player : arena.getPlayers()) {
                players.add(player.getName());
            }
            for (String playerName : players) {
                playerTrackerIndex.put(playerName, gameTracker);
            }
            preGamePlayers.put(arenaName, players);
            
            
            sendGameStartNotification(gameId, arenaName);
        }
    }
    
    private static class BW1058GameTracker {
        private final String gameId;
        private final String arenaName;
        private final boolean isRanked;
        private final long startTime;
        private long endTime;
        private ITeam winningTeam;
        
        
        private final Map<String, String> playerTeams = new HashMap<>();
        private final List<String> bedBreakers = new ArrayList<>();
        private final Map<String, String> brokenBeds = new HashMap<>();
        
        
        private final Map<String, Integer> playerKills = new HashMap<>();
        private final Map<String, Integer> playerDeaths = new HashMap<>();
        private final Map<String, Integer> playerFinalKills = new HashMap<>();
        private final Map<String, Integer> playerBedsDestroyed = new HashMap<>();
        private final Map<String, Integer> playerBlocksPlaced = new HashMap<>();
        private final Map<String, Integer> playerDiamondsCollected = new HashMap<>();
        private final Map<String, Integer> playerEmeraldsCollected = new HashMap<>();
        private final Map<String, Integer> playerGoldCollected = new HashMap<>();
        private final Map<String, Integer> playerIronCollected = new HashMap<>();
        private final Map<String, Double> playerDamageDealt = new HashMap<>();
        private final Map<String, Double> playerDamageTaken = new HashMap<>();
        private final Map<String, Integer> playerAssists = new HashMap<>();
        private final Map<String, Integer> playerMaxStreak = new HashMap<>();
        private final Map<String, Integer> playerCurrentStreak = new HashMap<>();
        private final Map<String, Map<String, Game.FightStats>> playerFights = new HashMap<>();
        private final Map<String, Map<String, Long>> lastDamageAt = new HashMap<>();
        private String firstBlood;
        private static final long ASSIST_WINDOW_MS = 10_000L;
        private final Map<String, Boolean> playerTeamWon = new HashMap<>();
        private final List<Map<String, Object>> timeline = new ArrayList<>();
        
        public BW1058GameTracker(String gameId, IArena arena, boolean isRanked) {
            this.gameId = gameId;
            this.arenaName = arena.getArenaName();
            this.isRanked = isRanked;
            this.startTime = System.currentTimeMillis();
            
            
            for (Player player : arena.getPlayers()) {
                ITeam team = arena.getTeam(player);
                if (team != null) {
                    String teamName = team.getName();
                    playerTeams.put(player.getName(), teamName);
                    playerTeamWon.put(player.getName(), false);
                    playerKills.put(player.getName(), 0);
                    playerDeaths.put(player.getName(), 0);
                    playerFinalKills.put(player.getName(), 0);
                    playerBedsDestroyed.put(player.getName(), 0);
                    playerBlocksPlaced.put(player.getName(), 0);
                    playerDiamondsCollected.put(player.getName(), 0);
                    playerEmeraldsCollected.put(player.getName(), 0);
                    playerGoldCollected.put(player.getName(), 0);
                    playerIronCollected.put(player.getName(), 0);
                    playerDamageDealt.put(player.getName(), 0.0);
                    playerDamageTaken.put(player.getName(), 0.0);
                    playerAssists.put(player.getName(), 0);
                    playerMaxStreak.put(player.getName(), 0);
                    playerCurrentStreak.put(player.getName(), 0);
                }
            }
            
            addTimelineEvent(0L, "game_start", null, null, null, null);
            for (Player player : arena.getPlayers()) {
                addTimelineEvent("player_join", player.getName(), null, null, null);
            }
        }
        
        private void addTimelineEvent(long timestamp, String type, String player, String target, Integer amount, String team) {
            Map<String, Object> event = new HashMap<>();
            event.put("type", type);
            event.put("player", player);
            event.put("target", target);
            event.put("amount", amount);
            event.put("team", team);
            event.put("timestamp", timestamp);
            timeline.add(event);
        }
        
        private void addTimelineEvent(String type, String player, String target, Integer amount, String team) {
            addTimelineEvent(System.currentTimeMillis() - startTime, type, player, target, amount, team);
        }
        
        public void recordDamage(String dealer, String victim, double amount) {
            if (dealer == null || dealer.isEmpty() || victim == null || victim.isEmpty()) {
                return;
            }
            if (dealer.equals(victim) || amount <= 0) {
                return;
            }
            playerDamageDealt.put(dealer, playerDamageDealt.getOrDefault(dealer, 0.0) + amount);
            playerDamageTaken.put(victim, playerDamageTaken.getOrDefault(victim, 0.0) + amount);
            Game.FightStats fight = playerFights
                    .computeIfAbsent(dealer, k -> new HashMap<>())
                    .computeIfAbsent(victim, k -> new Game.FightStats());
            fight.setDamage(fight.getDamage() + amount);
            lastDamageAt
                    .computeIfAbsent(victim, k -> new HashMap<>())
                    .put(dealer, System.currentTimeMillis());
        }

        public void recordKill(String killer, String victim, boolean isFinal) {
            if (killer == null || killer.isEmpty() || victim == null || victim.isEmpty()) {
                return;
            }
            playerKills.put(killer, playerKills.getOrDefault(killer, 0) + 1);
            addTimelineEvent("kill", killer, victim, null, null);
            if (isFinal) {
                playerFinalKills.put(killer, playerFinalKills.getOrDefault(killer, 0) + 1);
                addTimelineEvent("final_kill", killer, victim, null, null);
            }
            playerDeaths.put(victim, playerDeaths.getOrDefault(victim, 0) + 1);
            addTimelineEvent("death", victim, killer, null, null);
            Game.FightStats fight = playerFights
                    .computeIfAbsent(killer, k -> new HashMap<>())
                    .computeIfAbsent(victim, k -> new Game.FightStats());
            fight.setKills(fight.getKills() + 1);
            if (firstBlood == null) {
                firstBlood = killer;
                addTimelineEvent("first_blood", killer, victim, null, null);
            }
            int streak = playerCurrentStreak.getOrDefault(killer, 0) + 1;
            playerCurrentStreak.put(killer, streak);
            if (streak > playerMaxStreak.getOrDefault(killer, 0)) {
                playerMaxStreak.put(killer, streak);
            }
            playerCurrentStreak.put(victim, 0);
            recordAssists(killer, victim);
        }

        private void recordAssists(String killer, String victim) {
            Map<String, Long> damagers = lastDamageAt.get(victim);
            if (damagers == null) {
                return;
            }
            long now = System.currentTimeMillis();
            for (Map.Entry<String, Long> entry : damagers.entrySet()) {
                String damager = entry.getKey();
                if (damager.equals(killer)) {
                    continue;
                }
                if (now - entry.getValue() <= ASSIST_WINDOW_MS) {
                    playerAssists.put(damager, playerAssists.getOrDefault(damager, 0) + 1);
                    addTimelineEvent("assist", damager, victim, null, null);
                }
            }
        }

        public boolean isTracking(String playerName) {
            return playerTeams.containsKey(playerName);
        }
        
        public void recordDeath(String player) {
            playerDeaths.put(player, playerDeaths.getOrDefault(player, 0) + 1);
            addTimelineEvent("death", player, null, null, null);
        }
        
        public void recordBedBreak(String player, String teamName) {
            playerBedsDestroyed.put(player, playerBedsDestroyed.getOrDefault(player, 0) + 1);
            bedBreakers.add(player);
            brokenBeds.put(teamName, player);
            addTimelineEvent("bed_break", player, teamName, null, teamName);
        }
        
        public void recordBlocksPlaced(String player, int count) {
            playerBlocksPlaced.put(player, playerBlocksPlaced.getOrDefault(player, 0) + count);
            addTimelineEvent("block_place", player, null, 1, null);
        }
        
        public void recordPlayerLeave(String player) {
            addTimelineEvent("player_leave", player, null, null, null);
        }
        
        public void recordResourceCollection(String player, ResourceType resourceType, int amount) {
            if (player == null || resourceType == null || amount <= 0) return;
            
            Map<String, Integer> resourceMap;
            switch (resourceType) {
                case DIAMOND:
                    resourceMap = playerDiamondsCollected;
                    break;
                case EMERALD:
                    resourceMap = playerEmeraldsCollected;
                    break;
                case GOLD:
                    resourceMap = playerGoldCollected;
                    break;
                case IRON:
                    resourceMap = playerIronCollected;
                    break;
                default:
                    return;
            }
            
            int currentAmount = resourceMap.getOrDefault(player, 0);
            resourceMap.put(player, currentAmount + amount);
            addTimelineEvent("resource_pickup", player, null, amount, null);
        }
        
        public void recordGameEnd(ITeam winningTeam) {
            this.winningTeam = winningTeam;
            this.endTime = System.currentTimeMillis();
            
            String winningTeamName = winningTeam.getName();
            for (Map.Entry<String, String> entry : playerTeams.entrySet()) {
                if (entry.getValue().equals(winningTeamName)) {
                    playerTeamWon.put(entry.getKey(), true);
                }
            }
            addTimelineEvent("game_end", winningTeamName, null, null, winningTeamName);
        }
        
        public int getDuration() {
            long end = endTime > 0 ? endTime : System.currentTimeMillis();
            return (int)((end - startTime) / 1000);
        }
        
        public List<String> getWinningPlayers() {
            if (winningTeam == null) return Collections.emptyList();
            
            String winningTeamName = winningTeam.getName();
            return playerTeams.entrySet().stream()
                    .filter(entry -> entry.getValue().equals(winningTeamName))
                    .map(Map.Entry::getKey)
                    .collect(Collectors.toList());
        }
        
        public List<String> getLosingPlayers() {
            if (winningTeam == null) return Collections.emptyList();
            
            String winningTeamName = winningTeam.getName();
            return playerTeams.entrySet().stream()
                    .filter(entry -> !entry.getValue().equals(winningTeamName))
                    .map(Map.Entry::getKey)
                    .collect(Collectors.toList());
        }
        

        
        private List<String> getMVPs() {
            Map<String, Integer> playerScores = new HashMap<>();
            for (String player : playerKills.keySet()) {
                int score = playerFinalKills.getOrDefault(player, 0) * 5 + playerKills.getOrDefault(player, 0);
                playerScores.put(player, score);
            }
            
            int highestScore = playerScores.values().stream().mapToInt(Integer::intValue).max().orElse(-1);
            return playerScores.entrySet().stream()
                    .filter(entry -> entry.getValue() == highestScore && entry.getValue() > 0)
                    .map(Map.Entry::getKey)
                    .collect(Collectors.toList());
        }
        
        public enum ResourceType {
            DIAMOND, EMERALD, GOLD, IRON
        }
    }
    
    @EventHandler
    public void onEntityDamageByEntity(EntityDamageByEntityEvent event) {
        if (event.isCancelled()) return;
        if (!(event.getEntity() instanceof Player)) return;
        Player dealer = resolveDamager(event.getDamager());
        if (dealer == null) return;
        Player victim = (Player) event.getEntity();
        if (dealer.getName().equals(victim.getName())) return;
        BW1058GameTracker tracker = playerTrackerIndex.get(victim.getName());
        if (tracker != null && tracker.isTracking(victim.getName()) && tracker.isTracking(dealer.getName())) {
            tracker.recordDamage(dealer.getName(), victim.getName(), event.getFinalDamage());
        }
    }

    private void unindexTracker(BW1058GameTracker tracker) {
        playerTrackerIndex.entrySet().removeIf(entry -> entry.getValue() == tracker);
    }

    private Player resolveDamager(Entity damager) {
        if (damager instanceof Player) return (Player) damager;
        if (damager instanceof Projectile) {
            ProjectileSource shooter = ((Projectile) damager).getShooter();
            if (shooter instanceof Player) return (Player) shooter;
        }
        return null;
    }

    @EventHandler
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (playerTrackerIndex.get(player.getName()) == null) return;
        com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
        if (bedwarsAPI == null) return;
        
        IArena arena = bedwarsAPI.getArenaUtil().getArenaByPlayer(player);
        if (arena == null) return;
        
        String arenaName = arena.getArenaName();
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        Long lastPvpTime = recentPvpKills.get(player.getName());
        long currentTime = System.currentTimeMillis();
        
        if (lastPvpTime == null || (currentTime - lastPvpTime) > 100) {
            gameTracker.recordDeath(player.getName());
            plugin.debug("Player " + player.getName() + " died from non-PVP cause in arena " + arenaName);
        } else {
            plugin.debug("Player " + player.getName() + " death already recorded from PVP in arena " + arenaName);
        }
    }
    
    @EventHandler
    public void onPlayerKill(PlayerKillEvent event) {
        Player killer = event.getKiller();
        Player victim = event.getVictim();
        
        if (killer == null) return;
        if (playerTrackerIndex.get(killer.getName()) == null) return;
        
        com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
        if (bedwarsAPI == null) return;
        
        IArena arena = bedwarsAPI.getArenaUtil().getArenaByPlayer(killer);
        if (arena == null) return;
        
        String arenaName = arena.getArenaName();
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        recentPvpKills.put(victim.getName(), System.currentTimeMillis());
        boolean isFinalKill = event.getCause().isFinalKill();
        
        gameTracker.recordKill(killer.getName(), victim.getName(), isFinalKill);
        plugin.debug("Player " + killer.getName() + " killed " + victim.getName() + " (final: " + isFinalKill + ") in arena " + arenaName);
    }
    
    @EventHandler
    public void onBedBreak(PlayerBedBreakEvent event) {
        Player player = event.getPlayer();
        IArena arena = event.getArena();
        ITeam team = event.getVictimTeam();
        
        String arenaName = arena.getArenaName();
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        String teamName = team.getName();
        gameTracker.recordBedBreak(player.getName(), teamName);
        plugin.debug("Player " + player.getName() + " broke the bed of team " + teamName + " in arena " + arenaName);
    }
    
    @EventHandler
    public void onGameEnd(GameEndEvent event) {
        IArena arena = event.getArena();
        String arenaName = arena.getArenaName();
        plugin.debug("Game ended in arena: " + arenaName);
        
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        ITeam winningTeam = null;
        try {
            winningTeam = event.getTeamWinner();
        } catch (Exception ignored) {}
        
        if (winningTeam == null) {
            winningTeam = findLastStandingTeam(arena);
        }
        
        if (winningTeam != null) {
            gameTracker.recordGameEnd(winningTeam);

            Game game = convertToGame(gameTracker);
            
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                    plugin.getWebSocketManager().sendGameScoring(game);
                    plugin.debug("Sent game scoring data via WebSocket for game #" + game.getGameId());
                } else {
                    plugin.getLogger().warning("WebSocket is unavailable, could not send game data");
                }
                
                plugin.getGameDataManager().saveGameResultData(game);
            });
        }
        
        plugin.getMapManager().unlockMap(arenaName);
        gameTrackers.remove(arenaName);
        unindexTracker(gameTracker);
        preGamePlayers.remove(arenaName);
        
        for (String playerName : gameTracker.playerKills.keySet()) {
            recentPvpKills.remove(playerName);
        }
    }
    
    private ITeam findLastStandingTeam(IArena arena) {
        for (ITeam team : arena.getTeams()) {
            if (!team.getMembers().isEmpty() && !team.isBedDestroyed()) {
                return team;
            }
        }
        for (ITeam team : arena.getTeams()) {
            if (!team.getMembers().isEmpty()) {
                return team;
            }
        }
        return null;
    }
    
    private Game convertToGame(BW1058GameTracker tracker) {
        List<String> team1 = tracker.getWinningPlayers();
        List<String> team2 = tracker.getLosingPlayers();
        List<String> mvps = tracker.getMVPs();
        
        Game game = new Game(
            tracker.gameId,
            tracker.arenaName,
            tracker.isRanked,
            team1,
            team2,
            mvps,
            tracker.bedBreakers,
            tracker.startTime,
            tracker.getDuration(),
            new SimpleDateFormat("dd/MM/yyyy").format(new Date())
        );
        
        
        for (Map.Entry<String, Integer> entry : tracker.playerKills.entrySet()) {
            game.getPlayerKills().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerDeaths.entrySet()) {
            game.getPlayerDeaths().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerFinalKills.entrySet()) {
            game.getPlayerFinalKills().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerBedsDestroyed.entrySet()) {
            game.getPlayerBedsDestroyed().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerBlocksPlaced.entrySet()) {
            game.getPlayerBlocksPlaced().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerDiamondsCollected.entrySet()) {
            game.getPlayerDiamondsCollected().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerEmeraldsCollected.entrySet()) {
            game.getPlayerEmeraldsCollected().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerGoldCollected.entrySet()) {
            game.getPlayerGoldCollected().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerIronCollected.entrySet()) {
            game.getPlayerIronCollected().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Double> entry : tracker.playerDamageDealt.entrySet()) {
            game.getPlayerDamageDealt().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Double> entry : tracker.playerDamageTaken.entrySet()) {
            game.getPlayerDamageTaken().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerAssists.entrySet()) {
            game.getPlayerAssists().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Integer> entry : tracker.playerMaxStreak.entrySet()) {
            game.getPlayerMaxStreak().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, Map<String, Game.FightStats>> entry : tracker.playerFights.entrySet()) {
            Map<String, Game.FightStats> copy = new HashMap<>();
            for (Map.Entry<String, Game.FightStats> fight : entry.getValue().entrySet()) {
                copy.put(fight.getKey(), new Game.FightStats(fight.getValue().getKills(), fight.getValue().getDamage()));
            }
            game.getPlayerFights().put(entry.getKey(), copy);
        }
        if (tracker.firstBlood != null) {
            game.setFirstBlood(tracker.firstBlood);
        }
        for (Map.Entry<String, Boolean> entry : tracker.playerTeamWon.entrySet()) {
            game.getPlayerTeamWon().put(entry.getKey(), entry.getValue());
        }
        for (Map.Entry<String, String> entry : tracker.playerTeams.entrySet()) {
            game.getPlayerTeamName().put(entry.getKey(), entry.getValue());
        }
        game.getTimeline().addAll(tracker.timeline);
        
        return game;
    }
    
    @EventHandler
    public void onPlayerLeaveArena(PlayerLeaveArenaEvent event) {
        IArena arena = event.getArena();
        Player player = event.getPlayer();
        
        if (arena == null) return;
        
        handlePlayerLeave(player, arena);
    }
    
    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
        if (bedwarsAPI == null) return;
        
        IArena arena = bedwarsAPI.getArenaUtil().getArenaByPlayer(player);
        if (arena == null) return;
        
        handlePlayerLeave(player, arena);
    }
    
    private void handlePlayerLeave(Player player, IArena arena) {
        String arenaName = arena.getArenaName();
        Set<String> players = preGamePlayers.get(arenaName);
        
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker != null) {
            gameTracker.recordPlayerLeave(player.getName());
        }
        
        if (arena.getStatus() == GameState.waiting || arena.getStatus() == GameState.starting) {
            if (players != null && players.contains(player.getName())) {
                String gameId = plugin.getMapManager().getGameIdForArena(arenaName);
                if (gameId == null) {
                    return;
                }
                
                attemptGameRetry(gameId, player.getName(), arenaName, 5);
            }
        }
    }
    
    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        if (playerTrackerIndex.get(player.getName()) == null) return;
        com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
        if (bedwarsAPI == null) return;
        
        IArena arena = bedwarsAPI.getArenaUtil().getArenaByPlayer(player);
        if (arena == null) return;
        
        String arenaName = arena.getArenaName();
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        gameTracker.recordBlocksPlaced(player.getName(), 1);
    }
    
    @EventHandler
    public void onPlayerPickupItem(PlayerPickupItemEvent event) {
        ItemStack pickupItem = event.getItem().getItemStack();
        if (pickupItem == null) return;
        Material pickupMaterial = pickupItem.getType();
        if (pickupMaterial != Material.IRON_INGOT && pickupMaterial != Material.GOLD_INGOT
                && pickupMaterial != Material.DIAMOND && pickupMaterial != Material.EMERALD) return;
        Player player = event.getPlayer();
        if (playerTrackerIndex.get(player.getName()) == null) return;
        com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
        if (bedwarsAPI == null) return;
        
        IArena arena = bedwarsAPI.getArenaUtil().getArenaByPlayer(player);
        if (arena == null) return;
        
        String arenaName = arena.getArenaName();
        BW1058GameTracker gameTracker = gameTrackers.get(arenaName);
        if (gameTracker == null) return;
        
        ItemStack item = event.getItem().getItemStack();
        BW1058GameTracker.ResourceType resourceType = null;
        
        if (item.getType() == Material.IRON_INGOT) {
            resourceType = BW1058GameTracker.ResourceType.IRON;
        } else if (item.getType() == Material.GOLD_INGOT) {
            resourceType = BW1058GameTracker.ResourceType.GOLD;
        } else if (item.getType() == Material.DIAMOND) {
            resourceType = BW1058GameTracker.ResourceType.DIAMOND;
        } else if (item.getType() == Material.EMERALD) {
            resourceType = BW1058GameTracker.ResourceType.EMERALD;
        }
        
        if (resourceType != null) {
            gameTracker.recordResourceCollection(player.getName(), resourceType, item.getAmount());
        }
    }
    
    private void attemptGameRetry(String gameId, String playerName, String arenaName, int maxRetries) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) return;
        
        new BukkitRunnable() {
            private int retryCount = 0;
            
            @Override
            public void run() {
                if (retryCount >= maxRetries) {
                    sendVoidNotification(gameId, playerName);
                    this.cancel();
                    return;
                }
                
                Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                    JsonObject json = new JsonObject();
                    json.addProperty("type", "retrygame");
                    json.addProperty("game_id", gameId);
                    plugin.getWebSocketManager().sendMessage(json.toString());
                    plugin.debug("Sent retry notification for game #" + gameId + " (Attempt " + (retryCount + 1) + "/" + maxRetries + ")");
                });
                
                com.andrei1058.bedwars.api.BedWars bedwarsAPI = getBedwarsAPI();
                IArena arena = bedwarsAPI.getArenaUtil().getArenaByName(arenaName);
                if (arena != null) {
                    for (Player p : arena.getPlayers()) {
                        p.sendMessage("§c[rankedbedwars] Attempting to restore game... Player " + playerName + " left. Retry " + (retryCount + 1) + "/" + maxRetries);
                    }
                }
                
                retryCount++;
            }
        }.runTaskTimer(plugin, 0L, 100L);
    }
    
    private void sendVoidNotification(String gameId, String playerName) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) return;
        
        
        String arenaName = null;
        for (Map.Entry<String, BW1058GameTracker> entry : gameTrackers.entrySet()) {
            if (entry.getValue().gameId.equals(gameId)) {
                arenaName = entry.getKey();
                break;
            }
        }
        
        
        if (arenaName != null) {
            BW1058GameTracker removed = gameTrackers.remove(arenaName);
            if (removed != null) {
                unindexTracker(removed);
            }
            preGamePlayers.remove(arenaName);
        }
        
        
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("type", "voiding");
            json.addProperty("game_id", gameId);
            json.addProperty("reason", "[system] voided because player: " + playerName + " left before arena starts");
            plugin.getWebSocketManager().sendMessage(json.toString());
            plugin.debug("Sent void notification for game #" + gameId + " due to player " + playerName + " leaving");
        });
    }
    
    private void sendGameStartNotification(String gameId, String arenaName) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                JsonObject data = new JsonObject();
                data.addProperty("type", "game_start");
                data.addProperty("game_id", gameId);
                data.addProperty("map", arenaName);
                data.addProperty("timestamp", System.currentTimeMillis());
                plugin.getWebSocketManager().sendMessage(data.toString());
                plugin.debug("Sent game start notification for game #" + gameId);
            }
        });
    }
}
