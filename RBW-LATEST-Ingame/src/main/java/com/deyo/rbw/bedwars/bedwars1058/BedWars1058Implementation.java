package com.deyo.rbw.bedwars.bedwars1058;

import com.andrei1058.bedwars.api.BedWars;
import com.andrei1058.bedwars.api.arena.GameState;
import com.andrei1058.bedwars.api.arena.IArena;
import com.andrei1058.bedwars.api.arena.team.ITeam;
import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.bedwars.BedwarsAPI;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import com.deyo.rbw.listeners.BedWars1058Listener;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

public class BedWars1058Implementation implements BedwarsAPI {
    
    private RankedBedwars plugin;
    private BedWars bedwars1058API;
    private BedWars1058Listener listener;
    
    @Override
    public void initialize(RankedBedwars plugin) {
        this.plugin = plugin;
        
        try {
            this.bedwars1058API = Bukkit.getServicesManager().getRegistration(BedWars.class).getProvider();
            if (this.bedwars1058API == null) {
                plugin.getLogger().severe("Failed to get BedWars1058 API!");
            } else {
                plugin.getLogger().info("Successfully initialized BedWars1058 API");
            }
        } catch (Exception e) {
            plugin.getLogger().severe("Error initializing BedWars1058 API: " + e.getMessage());
        }
    }
    
    @Override
    public void registerListeners() {
        
        Bukkit.getScheduler().runTask(plugin, () -> {
            listener = new BedWars1058Listener(plugin);
            plugin.getServer().getPluginManager().registerEvents(listener, plugin);
            plugin.getLogger().info("BedWars1058 listeners registered!");
        });
    }
    
    @Override
    public String getName() {
        return "BedWars1058";
    }
    
    @Override
    public boolean arenaExists(String arenaName) {
        if (bedwars1058API == null) return false;
        return bedwars1058API.getArenaUtil().getArenaByName(arenaName) != null;
    }
    
    @Override
    public Object getArenaByName(String arenaName) {
        if (bedwars1058API == null) return null;
        return bedwars1058API.getArenaUtil().getArenaByName(arenaName);
    }
    
    @Override
    public Object getArenaByPlayer(Player player) {
        if (bedwars1058API == null) return null;
        return bedwars1058API.getArenaUtil().getArenaByPlayer(player);
    }
    
    @Override
    public void warpPlayersToGame(String gameId, String mapName, Object team1Obj, Object team2Obj, boolean isRanked) {
        if (bedwars1058API == null) {
            plugin.getLogger().severe("BedWars1058 API is not available, cannot warp players!");
            return;
        }
        
        com.google.gson.JsonObject team1Json = (com.google.gson.JsonObject) team1Obj;
        com.google.gson.JsonObject team2Json = (com.google.gson.JsonObject) team2Obj;
        
        plugin.debug("Warping players for game #" + gameId + " on map " + mapName + " (ranked: " + isRanked + ")");
        
        
        plugin.getMapManager().lockMap(mapName);
        
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                
                IArena arena = bedwars1058API.getArenaUtil().getArenaByName(mapName);
                if (arena == null) {
                    plugin.getLogger().warning("Arena not found: " + mapName);
                    plugin.getMapManager().sendWarpFailedArenaNotFound(gameId, mapName);
                    return;
                }
                
                
                if (arena.getStatus() != GameState.waiting) {
                    plugin.getLogger().warning("Arena is not in WAITING status: " + mapName + " (status: " + arena.getStatus() + ")");
                    
                    plugin.getMapManager().sendWarpFailedArenaNotFound(gameId, mapName);
                    return;
                }
                
                
                List<String> team1Players = parseTeamPlayers(team1Json);
                List<String> team2Players = parseTeamPlayers(team2Json);
                
                
                List<String> offlinePlayers = new ArrayList<>();
                List<String> allPlayers = new ArrayList<>();
                allPlayers.addAll(team1Players);
                allPlayers.addAll(team2Players);
                
                for (String playerName : allPlayers) {
                    Player player = Bukkit.getPlayerExact(playerName);
                    if (player == null) {
                        offlinePlayers.add(playerName);
                    }
                }
                
                if (!offlinePlayers.isEmpty()) {
                    plugin.getLogger().warning("Warp failed for offline players: " + offlinePlayers);
                    plugin.getMapManager().sendWarpFailedOfflinePlayers(gameId, offlinePlayers);
                    return;
                }
                
                
                Collection<ITeam> availableTeams = arena.getTeams();
                if (availableTeams.size() < 2) {
                    plugin.getLogger().warning("Not enough teams in arena: " + mapName);
                    plugin.getMapManager().sendWarpFailureUnknown(gameId);
                    return;
                }
                
                // Find Green and Red teams specifically - Team1 = Green, Team2 = Red
                ITeam greenTeam = null;
                ITeam redTeam = null;
                
                for (ITeam team : availableTeams) {
                    String teamName = team.getName().toLowerCase();
                    if (teamName.contains("green")) {
                        greenTeam = team;
                    } else if (teamName.contains("red")) {
                        redTeam = team;
                    }
                }
                
                // If specific teams not found, use first two available teams
                if (greenTeam == null || redTeam == null) {
                    List<ITeam> teams = new ArrayList<>(availableTeams);
                    if (greenTeam == null) greenTeam = teams.get(0);
                    if (redTeam == null) redTeam = teams.get(1);
                    plugin.debug("Using fallback teams for arena " + mapName + " - Green: " + greenTeam.getName() + ", Red: " + redTeam.getName());
                } else {
                    plugin.debug("Found specific teams for arena " + mapName + " - Green: " + greenTeam.getName() + ", Red: " + redTeam.getName());
                }
                
                
                registerCustomTeamAssigner(arena, team1Players, team2Players);
                
                
                for (String playerName : team1Players) {
                    Player player = Bukkit.getPlayerExact(playerName);
                    if (player != null) {
                        warpPlayerToArena(player, arena, greenTeam);
                    }
                }
                
                for (String playerName : team2Players) {
                    Player player = Bukkit.getPlayerExact(playerName);
                    if (player != null) {
                        warpPlayerToArena(player, arena, redTeam);
                    }
                }
                
                
                storeTeamInfo(arena, team1Players, team2Players);
                
                
                Bukkit.getScheduler().runTaskLater(plugin, () -> {
                    if (arena.getStatus() == GameState.waiting || arena.getStatus() == GameState.starting) {
                        arena.changeStatus(GameState.starting);
                        
                        try {
                            
                            if (arena.getStartingTask() != null) {
                                arena.getStartingTask().setCountdown(0);
                            }
                            plugin.debug("Arena force started with 5 second countdown: " + mapName);
                        } catch (Exception e) {
                            plugin.getLogger().warning("Could not set countdown: " + e.getMessage());
                        }
                    }
                    
                    plugin.getMapManager().sendWarpSuccess(gameId);
                }, 20L);
                
            } catch (Exception e) {
                plugin.getLogger().warning("Error warping players to game: " + e.getMessage());
                e.printStackTrace();
                plugin.getMapManager().sendWarpFailureUnknown(gameId);
            }
        });
    }
    
    private void registerCustomTeamAssigner(IArena arena, List<String> team1Players, List<String> team2Players) {
        try {
            
            teamAssignments.put(arena.getArenaName(), new TeamAssignment(team1Players, team2Players));
            plugin.debug("Custom team assigner registered for arena: " + arena.getArenaName());
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to register custom team assigner: " + e.getMessage());
        }
    }
    
    
    private static final java.util.Map<String, TeamAssignment> teamAssignments = new ConcurrentHashMap<>();
    
    public static class TeamAssignment {
        private final List<String> team1;
        private final List<String> team2;
        
        public TeamAssignment(List<String> team1, List<String> team2) {
            this.team1 = team1;
            this.team2 = team2;
        }
        
        public List<String> getTeam1() { return team1; }
        public List<String> getTeam2() { return team2; }
    }
    
    public static TeamAssignment getTeamAssignment(String arenaName) {
        return teamAssignments.get(arenaName);
    }
    
    private void warpPlayerToArena(Player player, IArena arena, ITeam team) {
        
        IArena currentArena = bedwars1058API.getArenaUtil().getArenaByPlayer(player);
        if (currentArena != null) {
            currentArena.removePlayer(player, false);
        }
        
        
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            try {
                if (!arena.addPlayer(player, true)) {
                    plugin.getLogger().warning("Failed to add player " + player.getName() + " to arena");
                } else {
                    plugin.debug("Added player " + player.getName() + " to arena " + arena.getArenaName());
                    
                    
                    
                }
            } catch (Exception e) {
                plugin.getLogger().warning("Error adding player to arena: " + e.getMessage());
            }
        }, 5L);
    }
    
    private List<String> parseTeamPlayers(com.google.gson.JsonObject teamJson) {
        List<String> players = new ArrayList<>();
        
        try {
            if (teamJson.has("players")) {
                com.google.gson.JsonArray playersArray = teamJson.getAsJsonArray("players");
                for (com.google.gson.JsonElement playerElement : playersArray) {
                    players.add(playerElement.getAsString());
                }
            } else {
                
                for (String key : teamJson.keySet()) {
                    if (teamJson.get(key).isJsonArray()) {
                        com.google.gson.JsonArray arr = teamJson.get(key).getAsJsonArray();
                        if (arr.size() == 1) {
                            players.add(arr.get(0).getAsString());
                        } else if (arr.size() > 1) {
                            for (com.google.gson.JsonElement element : arr) {
                                players.add(element.getAsString());
                            }
                        }
                    } else {
                        players.add(teamJson.get(key).getAsString());
                    }
                }
            }
        } catch (Exception e) {
            plugin.getLogger().warning("Error parsing team players: " + e.getMessage());
        }
        
        return players;
    }
    
    private void storeTeamInfo(IArena arena, List<String> team1Players, List<String> team2Players) {
        
        plugin.getGameDataManager().saveGameWarpData(
                plugin.getMapManager().getGameIdForArena(arena.getArenaName()),
                arena.getArenaName(),
                createTeamJsonObject(team1Players),
                createTeamJsonObject(team2Players),
                true
        );
    }
    
    private com.google.gson.JsonObject createTeamJsonObject(List<String> players) {
        com.google.gson.JsonObject teamJson = new com.google.gson.JsonObject();
        int playerIndex = 0;
        for (String player : players) {
            teamJson.addProperty("player" + playerIndex++, player);
        }
        return teamJson;
    }
    

    
    
    
    @Override
    public void initializeMaps() {
        if (bedwars1058API == null) return;
        
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                Collection<? extends IArena> arenas = bedwars1058API.getArenaUtil().getArenas();
                plugin.getLogger().info("Found " + arenas.size() + " arenas from BedWars1058");
                
                for (IArena arena : arenas) {
                    plugin.getMapManager().addMap(
                            arena.getArenaName(),
                            arena.getDisplayName(),
                            arena.getMaxPlayers(),
                            getTeamNames(arena)
                    );
                }
                
                plugin.getMapManager().finishMapInitialization("BedWars1058");
            } catch (Exception e) {
                plugin.getLogger().warning("Error initializing maps from BedWars1058: " + e.getMessage());
                e.printStackTrace();
            }
        });
    }
    
    private List<String> getTeamNames(IArena arena) {
        List<String> teamNames = new ArrayList<>();
        for (ITeam team : arena.getTeams()) {
            teamNames.add(team.getName());
        }
        return teamNames;
    }
    
    @Override
    public String getArenaGroup(Object arena) {
        if (arena == null) return null;
        if (arena instanceof IArena) {
            return ((IArena) arena).getGroup();
        }
        return null;
    }
    
    @Override
    public boolean isAvailable() {
        return Bukkit.getPluginManager().getPlugin("BedWars1058") != null && bedwars1058API != null;
    }
    

    public BedWars1058Listener getListener() {
        return listener;
    }
}
