package com.deyo.rbw.bedwars.mbedwars;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.bedwars.BedwarsAPI;
import com.deyo.rbw.listeners.MBedwarsListener;
import com.google.gson.JsonObject;
import de.marcely.bedwars.api.GameAPI;
import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.ArenaStatus;
import de.marcely.bedwars.api.arena.Team;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

public class MBedwarsImplementation implements BedwarsAPI {
    
    private RankedBedwars plugin;
    private MBedwarsListener listener;
    
    @Override
    public void initialize(RankedBedwars plugin) {
        this.plugin = plugin;
        
        
    }
    
    @Override
    public void registerListeners() {
        
        Bukkit.getScheduler().runTask(plugin, () -> {
            de.marcely.bedwars.api.BedwarsAPI.onReady(() -> {
                listener = new MBedwarsListener(plugin);
                plugin.getServer().getPluginManager().registerEvents(listener, plugin);
                plugin.getLogger().info("MBedwars API is ready, registered MBedwars listeners!");
            });
        });
    }
    
    @Override
    public String getName() {
        return "MBedwars";
    }


    public MBedwarsListener getListener() {
        return listener;
    }
    
    @Override
    public boolean arenaExists(String arenaName) {
        return getArenaByName(arenaName) != null;
    }
    
    @Override
    public Object getArenaByName(String arenaName) {
        try {
            return GameAPI.get().getArenaByName(arenaName);
        } catch (Exception e) {
            plugin.getLogger().warning("Error getting MBedwars arena by name: " + e.getMessage());
            return null;
        }
    }
    
    @Override
    public Object getArenaByPlayer(Player player) {
        try {
            return GameAPI.get().getArenaByPlayer(player);
        } catch (Exception e) {
            plugin.getLogger().warning("Error getting MBedwars arena by player: " + e.getMessage());
            return null;
        }
    }
    
    @Override
    public void warpPlayersToGame(String gameId, String mapName, Object team1, Object team2, boolean isRanked) {
        
        JsonObject team1Json = (JsonObject) team1;
        JsonObject team2Json = (JsonObject) team2;
        
        plugin.debug("Warping players for game #" + gameId + " on map " + mapName + " (ranked: " + isRanked + ")");
        
        plugin.getMapManager().lockMap(mapName);
        
        try {
            Arena arena = GameAPI.get().getArenaByName(mapName);
            if (arena == null) {
                plugin.getLogger().warning("Arena not found: " + mapName);
                plugin.getMapManager().sendWarpFailedArenaNotFound(gameId, mapName);
                return;
            }
            
            if (arena.getStatus() != ArenaStatus.LOBBY) {
                plugin.getLogger().warning("Arena is not in LOBBY status: " + mapName + " (status: " + arena.getStatus() + ")");
                
                plugin.getMapManager().sendWarpFailedArenaNotFound(gameId, mapName);
                return;
            }
            
            
            List<String> team1Players = parseTeamPlayers(team1Json);
            List<String> team2Players = parseTeamPlayers(team2Json);
            
            List<String> offlinePlayers = new ArrayList<>();
            List<String> allPlayers = new ArrayList<>();
            allPlayers.addAll(team1Players);
            allPlayers.addAll(team2Players);
            
            for (String ign : allPlayers) {
                if (Bukkit.getPlayerExact(ign) == null) {
                    offlinePlayers.add(ign);
                }
            }
            
            if (!offlinePlayers.isEmpty()) {
                plugin.getLogger().warning("Warp failed for offline players: " + offlinePlayers);
                plugin.getMapManager().sendWarpFailedOfflinePlayers(gameId, offlinePlayers);
                return;
            }
            
            List<Team> enabledTeams = new ArrayList<>(arena.getEnabledTeams());
            Team redTeam = null;
            Team greenTeam = null;
            
            for (Team t : enabledTeams) {
                String initials = null;
                try {
                    initials = t.getInitials();
                } catch (Exception ignored) {}
                
                if (initials != null) {
                    if (initials.equalsIgnoreCase("r")) redTeam = t;
                    if (initials.equalsIgnoreCase("g")) greenTeam = t;
                }
            }
            
            if (redTeam == null || greenTeam == null) {
                plugin.getLogger().warning("Red or Green team not found in arena: " + mapName);
                plugin.getMapManager().sendWarpFailureUnknown(gameId);
                return;
            }
            
            // Team1 = Green, Team2 = Red
            for (String playerName : team1Players) {
                Player player = Bukkit.getPlayerExact(playerName);
                if (player != null) {
                    warpPlayerToArena(player, arena, greenTeam);
                }
            }
            
            // Team2 = Red
            for (String playerName : team2Players) {
                Player player = Bukkit.getPlayerExact(playerName);
                if (player != null) {
                    warpPlayerToArena(player, arena, redTeam);
                }
            }
            
            
            
            storeTeamInfo(arena, team1Players, team2Players);
            Bukkit.getScheduler().runTaskLater(plugin, () -> {                    plugin.getMapManager().sendWarpSuccess(gameId);
                }, 20L);
                
                try {
                    arena.setStatus(ArenaStatus.RUNNING);
                    plugin.debug("Arena status set to STARTING for map: " + mapName);
                } catch (Exception e) {
                    plugin.getLogger().warning("Error setting arena status: " + e.getMessage());
                }
            
            

            
        } catch (Exception e) {
            plugin.getLogger().warning("Error warping players to game: " + e.getMessage());
            plugin.getMapManager().sendWarpFailureUnknown(gameId);
        }
    }
    
    private List<String> parseTeamPlayers(JsonObject teamJson) {
        List<String> players = new ArrayList<>();
        
        if (teamJson.has("players")) {
            try {
                com.google.gson.JsonArray playersArray = teamJson.getAsJsonArray("players");
                for (com.google.gson.JsonElement playerElement : playersArray) {
                    players.add(playerElement.getAsString());
                }
            } catch (Exception e) {
                plugin.getLogger().warning("Error parsing team players: " + e.getMessage());
            }
        }
        
        return players;
    }
    
    private void storeTeamInfo(Arena arena, List<String> team1Players, List<String> team2Players) {
        
        plugin.getGameDataManager().saveGameWarpData(
                plugin.getMapManager().getGameIdForArena(arena.getName()),
                arena.getName(),
                createTeamJsonObject(team1Players),
                createTeamJsonObject(team2Players),
                true
        );
    }
    
    private JsonObject createTeamJsonObject(List<String> players) {
        JsonObject teamJson = new JsonObject();
        int playerIndex = 0;
        for (String player : players) {
            teamJson.addProperty("player" + playerIndex++, player);
        }
        return teamJson;
    }
    
    

    private void warpPlayerToArena(Player player, Arena arena, Team team) {
        Arena currentArena = GameAPI.get().getArenaByPlayer(player);
        if (currentArena != null) {
            currentArena.kickPlayer(player);
        }
        
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            try {
                boolean teamAssigned = false;
                try {
                    Class<?>[] paramTypes = {Player.class, Team.class};
                    arena.getClass().getMethod("addPlayer", paramTypes).invoke(arena, player, team);
                    teamAssigned = true;
                    plugin.debug("Added player " + player.getName() + " with team directly using addPlayer(player, team)");
                } catch (Exception ignored) {
                }
                
                if (!teamAssigned) {
                    arena.addPlayer(player);
                    
                    try {
                        arena.setPlayerTeam(player, team);
                        teamAssigned = true;
                    } catch (Exception e1) {
                        try {
                            Class<?>[] paramTypes = {Player.class, Team.class};
                            arena.getClass().getMethod("setTeam", paramTypes).invoke(arena, player, team);
                            teamAssigned = true;
                        } catch (Exception e2) {
                            plugin.getLogger().warning("Failed to assign team for player " + player.getName() + ": " + e2.getMessage());
                        }
                    }
                }
                
                if (teamAssigned) {
                    plugin.debug("Player " + player.getName() + " warped to arena " + arena.getName() + " with team " + team);
                } else {
                    plugin.getLogger().warning("Player " + player.getName() + " added to arena but team assignment failed");
                }
            } catch (Exception e) {
                plugin.getLogger().warning("Failed to add player " + player.getName() + " to arena: " + e.getMessage());
            }
        }, 5L);
    }
    
    @Override
    public void initializeMaps() {
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                Collection<Arena> arenas = GameAPI.get().getArenas();
                
                for (Arena arena : arenas) {
                    String name = arena.getName();
                    
                    Collection<Team> enabledTeams = arena.getEnabledTeams();
                    int numTeams = enabledTeams.size();
                    int maxPlayers = arena.getPlayersPerTeam() * numTeams;
                    
                    List<String> teamNames = new ArrayList<>();
                    for (Team team : enabledTeams) {
                        String teamName = null;
                        
                        try {
                            teamName = (String) team.getClass().getMethod("getName").invoke(team);
                        } catch (Exception ignored) {}
                        
                        if (teamName == null) {
                            try {
                                teamName = (String) team.getClass().getMethod("getDisplayName").invoke(team);
                            } catch (Exception ignored) {}
                        }
                        
                        if (teamName == null) {
                            teamName = "Team-" + teamNames.size() + 1;
                        }
                        
                        teamNames.add(teamName);
                        plugin.debug("Found team: " + teamName + " for arena " + name);
                    }
                    
                    plugin.getMapManager().addMap(
                            name,
                            arena.getDisplayName(),
                            maxPlayers,
                            teamNames
                    );
                }
                
                plugin.getMapManager().finishMapInitialization("MBedwars");
            } catch (Exception e) {
                plugin.getLogger().warning("Error initializing maps: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }
    
    @Override
    public String getArenaGroup(Object arena) {
        try {
            Arena mbedwarsArena = (Arena) arena;
            return mbedwarsArena.getName();
        } catch (Exception e) {
            plugin.getLogger().warning("Error getting arena group: " + e.getMessage());
            return null;
        }
    }
    
    @Override
    public boolean isAvailable() {
        return Bukkit.getPluginManager().getPlugin("MBedwars") != null;
    }
}
