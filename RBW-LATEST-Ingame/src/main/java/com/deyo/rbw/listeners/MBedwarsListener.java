package com.deyo.rbw.listeners;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.deyo.rbw.models.GameInstance;
import com.google.gson.JsonObject;
import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.ArenaStatus;
import de.marcely.bedwars.api.arena.Team;
import de.marcely.bedwars.api.event.arena.ArenaBedBreakEvent;
import de.marcely.bedwars.api.event.arena.RoundEndEvent;
import de.marcely.bedwars.api.event.arena.RoundStartEvent;
import de.marcely.bedwars.api.event.player.PlayerIngameDeathEvent;
import de.marcely.bedwars.api.event.player.PlayerKillPlayerEvent;
import de.marcely.bedwars.api.event.player.PlayerQuitArenaEvent;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerPickupItemEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitRunnable;

import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import java.util.concurrent.ConcurrentHashMap;



 
public class MBedwarsListener implements Listener {
    private final RankedBedwars plugin;
    private final Map<String, GameInstance> gameInstances = new ConcurrentHashMap<>();
    private final Map<String, Long> recentPvpKills = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> preGamePlayers = new ConcurrentHashMap<>();

    public MBedwarsListener(RankedBedwars plugin) {
        this.plugin = plugin;
    }


    public void cleanupGameInstanceForMap(String mapName) {
        if (gameInstances.containsKey(mapName)) {
            plugin.debug("Cleaning up existing game instance for map: " + mapName);
            gameInstances.remove(mapName);
            preGamePlayers.remove(mapName);
            plugin.debug("Cleaned up game instance for map: " + mapName);
        }
    }


    @EventHandler
    public void onRoundStart(RoundStartEvent event) {
        Arena arena = event.getArena();
        String arenaName = arena.getName();
        plugin.debug("Round started in arena: " + arenaName);
        String gameId = plugin.getMapManager().getGameIdForArena(arenaName);
        if (gameId == null) {
            return;
        }
        GameInstance gameInstance = new GameInstance(gameId, arena, true);
        gameInstances.put(arenaName, gameInstance);

        
        Set<String> players = new HashSet<>();
        for (Player player : arena.getPlayers()) {
            players.add(player.getName());
        }
        preGamePlayers.put(arenaName, players);

        sendGameStartNotification(gameId, arenaName);
    }

    

    @EventHandler
    public void onPlayerDeath(PlayerIngameDeathEvent event) {
        Arena arena = event.getArena();
        String arenaName = arena.getName();
        Player player = event.getPlayer();
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null) return;
        Long lastPvpTime = recentPvpKills.get(player.getName());
        long currentTime = System.currentTimeMillis();
        if (lastPvpTime == null || (currentTime - lastPvpTime) > 100) {
            gameInstance.recordDeath(player.getName());
            plugin.debug("Player " + player.getName() + " died from non-PVP cause in arena " + arenaName);
        } else {
            plugin.debug("Player " + player.getName() + " death already recorded from PVP in arena " + arenaName);
        }
    }

    @EventHandler
    public void onPlayerKill(PlayerKillPlayerEvent event) {
        if (event.getKiller() == null) return;
        Arena arena = event.getArena();
        String arenaName = arena.getName();
        Player killer = event.getKiller();
        Player victim = event.getDamaged();
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null) return;
        recentPvpKills.put(victim.getName(), System.currentTimeMillis());
        boolean isFinalKill = false;
        Team victimTeam = arena.getPlayerTeam(victim);
        if (victimTeam != null && arena.isBedDestroyed(victimTeam)) {
            isFinalKill = true;
        }
        gameInstance.recordKill(killer.getName(), victim.getName(), isFinalKill);
        plugin.debug("Player " + killer.getName() + " killed " + victim.getName() + " (final: " + isFinalKill + ") in arena " + arenaName);
    }

    @EventHandler
    public void onBedBreak(ArenaBedBreakEvent event) {
        Arena arena = event.getArena();
        String arenaName = arena.getName();
        Player player = event.getPlayer();
        Team team = event.getTeam();
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null) return;
        String teamName;
        try {
            teamName = team.getDisplayName();
        } catch (Exception e) {
            teamName = team.toString();
        }
        gameInstance.recordBedBreak(player.getName(), teamName);
    }

    @EventHandler
    public void onRoundEnd(RoundEndEvent event) {
        Arena arena = event.getArena();
        String arenaName = arena.getName();
        plugin.debug("Round ended in arena: " + arenaName);
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null || event.getArena().getPlayers().isEmpty()) return;
        Team winningTeam = null;
        for (Team team : arena.getEnabledTeams()) {
            if (!arena.isBedDestroyed(team) || arena.getPlayersInTeam(team).size() > 0) {
                winningTeam = team;
                break;
            }
        }
        if (winningTeam != null) {
            gameInstance.recordGameEnd(winningTeam);
        }
        Game game = gameInstance.toGame();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                plugin.getWebSocketManager().sendGameScoring(game);
                plugin.debug("Sent game scoring data via WebSocket for game #" + game.getGameId());
            } else {
                plugin.getLogger().warning("WebSocket is unavailable, could not send game scoring data");
            }
            if (plugin.getGameDataManager() != null) {
                plugin.getGameDataManager().saveGameResultData(game);
                plugin.debug("Saved game result data to JSON for game #" + game.getGameId());
            }
        });
        if (plugin.getMapManager() != null) {
            plugin.getMapManager().unlockMap(arenaName);
        }
        preGamePlayers.remove(arenaName);
        gameInstances.remove(arenaName);
        for (String playerName : game.getPlayerKills().keySet()) {
            recentPvpKills.remove(playerName);
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        Player player = event.getPlayer();
        Object arenaObj = com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByPlayer(player);
        if (arenaObj == null || !(arenaObj instanceof Arena)) return;
        
        Arena arena = (Arena) arenaObj;
        String arenaName = arena.getName();
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null) return;
        gameInstance.recordBlocksPlaced(player.getName(), 1);
        plugin.debug("Player " + player.getName() + " placed a block in arena " + arenaName);
    }

    @EventHandler
    public void onItemPickup(PlayerPickupItemEvent event) {
        if (event.isCancelled()) return;
        Player player = event.getPlayer();
        Object arenaObj = com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByPlayer(player);
        if (arenaObj == null || !(arenaObj instanceof Arena)) return;
        
        Arena arena = (Arena) arenaObj;
        String arenaName = arena.getName();
        GameInstance gameInstance = gameInstances.get(arenaName);
        if (gameInstance == null) return;
        
        ItemStack item = event.getItem().getItemStack();
        if (item == null) return;
        
        Material material = item.getType();
        int amount = item.getAmount();
        
        
        if (!event.getItem().isValid() || event.getItem().isDead()) return;
        
        GameInstance.ResourceType resourceType = null;
        switch (material) {
            case IRON_INGOT:
                resourceType = GameInstance.ResourceType.IRON;
                break;
            case GOLD_INGOT:
                resourceType = GameInstance.ResourceType.GOLD;
                break;
            case DIAMOND:
                resourceType = GameInstance.ResourceType.DIAMOND;
                break;
            case EMERALD:
                resourceType = GameInstance.ResourceType.EMERALD;
                break;
            default:
                return;
        }
        
        
        gameInstance.recordResourceCollection(player.getName(), resourceType, amount);
        plugin.debug("Player " + player.getName() + " collected " + amount + " " + resourceType.name().toLowerCase() + " in arena " + arenaName);
    }

    @EventHandler
    public void onPlayerAreanaLeave(PlayerQuitArenaEvent event){
        Player player = event.getPlayer();
        Arena arena = event.getArena();
        if (arena == null) return;
        
        String arenaName = arena.getName();
        Set<String> players = preGamePlayers.get(arenaName);
        
        if(arena.getStatus()==ArenaStatus.LOBBY){
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
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        Object arenaObj = com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByPlayer(player);
        if (arenaObj == null || !(arenaObj instanceof Arena)) return;
        
        Arena arena = (Arena) arenaObj;
        String arenaName = arena.getName();
        Set<String> players = preGamePlayers.get(arenaName);
        
        if(arena.getStatus()==ArenaStatus.LOBBY){
            if (players != null && players.contains(player.getName())) {
                String gameId = plugin.getMapManager().getGameIdForArena(arenaName);
                if (gameId == null) {
                return;
                }
                
                attemptGameRetry(gameId, player.getName(), arenaName, 5);
            }
        }
    }

    private void sendVoidNotification(String gameId, String playerName) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) return;
        
        String arenaName = null;
        
        for (Map.Entry<String, GameInstance> entry : gameInstances.entrySet()) {
            if (entry.getValue().getGame().getGameId().equals(gameId)) {
                arenaName = entry.getKey();
                break;
            }
        }
        if (arenaName != null) {
            preGamePlayers.remove(arenaName);
            gameInstances.remove(arenaName);
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("type", "voiding");
            json.addProperty("gameid", gameId);
            json.addProperty("reason", "[system] voided because player: " + playerName + " left before arena starts");
            plugin.getWebSocketManager().sendMessage(json.toString());
            plugin.debug("Sent void notification for game #" + gameId + " due to player " + playerName + " leaving");
        });
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
                    json.addProperty("gameid", gameId);
                    plugin.getWebSocketManager().sendMessage(json.toString());
                    plugin.debug("Sent retry notification for game #" + gameId + " (Attempt " + (retryCount + 1) + "/" + maxRetries + ")");
                });
                
                
                Object arenaObj = com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByName(arenaName);
                if (arenaObj != null && arenaObj instanceof Arena) {
                    Arena arena = (Arena) arenaObj;
                    for (Player p : arena.getPlayers()) {
                        p.sendMessage("§c[rankedbedwars] Attempting to restore game... Player " + playerName + " left. Retry " + (retryCount + 1) + "/" + maxRetries);
                    }
                }
                
                retryCount++;
            }
        }.runTaskTimer(plugin, 0L, 100L); 
    }

    

    private void sendGameStartNotification(String gameId, String arenaName) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) return;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("type", "game_start");
            json.addProperty("game_id", gameId);
            json.addProperty("arena", arenaName);
            json.addProperty("timestamp", System.currentTimeMillis());
            plugin.getWebSocketManager().sendMessage(json.toString());
            plugin.debug("Sent game start notification for game #" + gameId);
        });
    }
}
