package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.bedwars.BedwarsAPIManager;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;

import java.lang.reflect.Method;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Enhanced Map Manager that handles arena groups with multiple knockback variants.
 * 
 * Arena Structure:
 * - Physical arenas: rbw4v4katsu, hrbw4v4katsu, prbw4v4katsu
 * - Arena Group: "4v4katsu" containing 3 variants (Vanilla, Hypixel, Practice)
 * - When one variant is in use, the entire group is locked
 * 
 * JSON Structure Example:
 * {
 *   "type": "arena_groups_info",
 *   "timestamp": 1625097600000,
 *   "version": "2.0",
 *   "summary": {
 *     "total_groups": 5,
 *     "available_groups": 3,
 *     "locked_groups": 1,
 *     "disabled_groups": 1,
 *     "total_variants": 15
 *   },
 *   "arena_groups": {
 *     "available": [...],
 *     "locked": [...],
 *     "disabled": [...]
 *   },
 *   "system": {
 *     "total_physical_arenas": 15,
 *     "active_games": 2,
 *     "pattern_matching": "^(rbw|hrbw|prbw)(.+)$",
 *     "supported_variants": [...]
 *   }
 * }
 * 
 * Arena Group JSON Structure:
 * {
 *   "group_id": "4v4katsu",
 *   "display_name": "Katsu 4v4",
 *   "max_players": 8,
 *   "teams": ["red", "blue"],
 *   "variants": {
 *     "vanilla": {
 *       "display_name": "Vanilla",
 *       "prefix": "rbw",
 *       "physical_arena_name": "rbw4v4katsu",
 *       "is_currently_used": false,
 *       "knockback_type": "vanilla",
 *       "description": "Standard Minecraft knockback physics"
 *     },
 *     "hypixel": {
 *       "display_name": "Hypixel",
 *       "prefix": "hrbw",
 *       "physical_arena_name": "hrbw4v4katsu",
 *       "is_currently_used": true,
 *       "knockback_type": "hypixel",
 *       "description": "Hypixel-style knockback physics for competitive play"
 *     },
 *     "practice": {
 *       "display_name": "Practice",
 *       "prefix": "prbw",
 *       "physical_arena_name": "prbw4v4katsu",
 *       "is_currently_used": false,
 *       "knockback_type": "practice",
 *       "description": "Practice mode with specialized knockback settings"
 *     }
 *   },
 *   "status": {
 *     "is_locked": true,
 *     "is_disabled": false,
 *     "currently_used_variant": "hypixel",
 *     "currently_used_arena": "hrbw4v4katsu"
 *   },
 *   "metadata": {
 *     "total_variants": 3,
 *     "group_type": "knockback_variants",
 *     "created_from_pattern": true
 *   }
 * }
 */
public class MapManager {

    private final RankedBedwars plugin;
    
    
    private final Map<String, ArenaGroup> arenaGroups = new ConcurrentHashMap<>();
    private final Map<String, String> physicalArenaToGroupMap = new ConcurrentHashMap<>();
    private final Map<String, String> gameIdToPhysicalArenaMap = new ConcurrentHashMap<>();
    
    
    private final Set<String> lockedArenaGroups = ConcurrentHashMap.newKeySet();
    private final Set<String> disabledArenaGroups = ConcurrentHashMap.newKeySet();
    private final Set<String> allowedGroups = new HashSet<>();
    
    
    

    public MapManager(RankedBedwars plugin) {
        this.plugin = plugin;
    }
    

    public static class ArenaGroup {
        private final String groupId;           
        private final String displayName;       
        private final int maxPlayers;
        private final List<String> teamNames;
        private final Map<ArenaVariant, String> variants = new HashMap<>();  
        private ArenaVariant currentlyUsed = null;     
        
        public ArenaGroup(String groupId, String displayName, int maxPlayers, List<String> teamNames) {
            this.groupId = groupId;
            this.displayName = displayName;
            this.maxPlayers = maxPlayers;
            this.teamNames = new ArrayList<>(teamNames);
        }
        
        public void addVariant(ArenaVariant variant, String physicalArenaName) {
            variants.put(variant, physicalArenaName);
        }
        
        public boolean hasVariant(ArenaVariant variant) {
            return variants.containsKey(variant);
        }
        
        public String getPhysicalArenaName(ArenaVariant variant) {
            return variants.get(variant);
        }
        
        public Set<ArenaVariant> getAvailableVariants() {
            return variants.keySet();
        }
        
        public String getGroupId() { return groupId; }
        public String getDisplayName() { return displayName; }
        public int getMaxPlayers() { return maxPlayers; }
        public List<String> getTeamNames() { return teamNames; }
        public ArenaVariant getCurrentlyUsed() { return currentlyUsed; }
        public void setCurrentlyUsed(ArenaVariant variant) { this.currentlyUsed = variant; }
        
        public Set<String> getAllPhysicalArenaNames() {
            return new HashSet<>(variants.values());
        }
        
        /**
         * Get the best available variant for a ranked game preference
         */
        public ArenaVariant getBestVariant(boolean isRanked) {
            if (isRanked) {
                
                if (variants.containsKey(ArenaVariant.HYPIXEL)) return ArenaVariant.HYPIXEL;
                if (variants.containsKey(ArenaVariant.VANILLA)) return ArenaVariant.VANILLA;
                if (variants.containsKey(ArenaVariant.PRACTICE)) return ArenaVariant.PRACTICE;
            } else {
                
                if (variants.containsKey(ArenaVariant.VANILLA)) return ArenaVariant.VANILLA;
                if (variants.containsKey(ArenaVariant.HYPIXEL)) return ArenaVariant.HYPIXEL;
                if (variants.containsKey(ArenaVariant.PRACTICE)) return ArenaVariant.PRACTICE;
            }
            return null;
        }
    }
    
    /**
     * Arena variants based on knockback type
     */
    public enum ArenaVariant {
        VANILLA("rbw", "Vanilla"),
        HYPIXEL("hrbw", "Hypixel"),
        PRACTICE("prbw", "Practice");
        
        private final String prefix;
        private final String displayName;
        
        ArenaVariant(String prefix, String displayName) {
            this.prefix = prefix;
            this.displayName = displayName;
        }
        
        public String getPrefix() { return prefix; }
        public String getDisplayName() { return displayName; }
        
        public static ArenaVariant fromPrefix(String prefix) {
            for (ArenaVariant variant : values()) {
                if (variant.prefix.equals(prefix)) {
                    return variant;
                }
            }
            return null;
        }
    }


    
    private static class ArenaGroupInfo {
        final String groupId;
        final ArenaVariant variant;
        
        ArenaGroupInfo(String groupId, ArenaVariant variant) {
            this.groupId = groupId;
            this.variant = variant;
        }
    }


    private ArenaGroupInfo extractArenaGroupInfo(String physicalArenaName) {
        return new ArenaGroupInfo(physicalArenaName, ArenaVariant.VANILLA);
    }

    
    public Set<String> getAllowedGroups() {
        return new HashSet<>(allowedGroups);
    }

    public void initializeMaps() {
        
        
        if (BedwarsAPIManager.isAvailable()) {
            BedwarsAPIManager.getImplementation().initializeMaps();
        } else {
            plugin.getLogger().warning("Cannot initialize maps: No BedWars implementation is available");
        }
    }

    public void addMap(String name, String displayName, int maxPlayers, List<String> teamNames) {
        

        
        
        ArenaGroupInfo groupInfo = extractArenaGroupInfo(name);
        String groupId = groupInfo.groupId;
        ArenaVariant variant = groupInfo.variant;
        
        
        ArenaGroup arenaGroup = arenaGroups.get(groupId);
        if (arenaGroup == null) {
            
            String groupDisplayName = (displayName == null || displayName.isEmpty()) ? groupId : displayName;
            
            arenaGroup = new ArenaGroup(groupId, groupDisplayName, maxPlayers, teamNames);
            arenaGroups.put(groupId, arenaGroup);
            plugin.debug("Created new arena group: " + groupId);
        }
        
        
        arenaGroup.addVariant(variant, name);
        physicalArenaToGroupMap.put(name, groupId);
        
        plugin.debug("Added arena '" + name + "' as " + variant.getDisplayName() + " variant of group '" + groupId + "'");
    }
    
    public void finishMapInitialization(String implementationName) {
        plugin.getLogger().info("Initialized " + arenaGroups.size() + " arena groups from " + implementationName);
        sendMapInfoToBot();
    }

    public void sendMapInfoToBot() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
			JsonObject mapsJson = new JsonObject();
			mapsJson.addProperty("type", "maps_info");
            JsonArray reserved = new JsonArray();
            JsonArray locked = new JsonArray();
            JsonArray disabled = new JsonArray();
            JsonArray all = new JsonArray();

            for (ArenaGroup arenaGroup : arenaGroups.values()) {
                JsonObject entry = new JsonObject();
                entry.addProperty("name", arenaGroup.getDisplayName());
                entry.addProperty("maxplayers", arenaGroup.getMaxPlayers());
                
            
                all.add(entry);

                if (isArenaGroupDisabled(arenaGroup.getGroupId())) {
                    disabled.add(entry);
                } else if (isArenaGroupLocked(arenaGroup.getGroupId())) {
                    locked.add(entry);
                } else {
                    reserved.add(entry);
                }
            }

            mapsJson.add("reserved", reserved);
            mapsJson.add("locked", locked);
            mapsJson.add("disabled", disabled);
            mapsJson.add("all", all);

            if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                plugin.getWebSocketManager().sendMessage(mapsJson.toString());
                plugin.debug("Sent simplified maps information via WebSocket");
            } else {
                String reason = plugin.getWebSocketManager() == null ? "WebSocketManager is null" : "WebSocket not connected";
                plugin.getLogger().warning("Could not send maps information: " + reason);
                plugin.debug("Maps tracked: " + arenaGroups.size());
            }
        });
    }
    

    
    
    public void disableArenaGroup(String groupId) {
        disabledArenaGroups.add(groupId);
        plugin.debug("Disabled arena group: " + groupId);
        sendMapInfoToBot();
    }
    
    public void enableArenaGroup(String groupId) {
        disabledArenaGroups.remove(groupId);
        plugin.debug("Enabled arena group: " + groupId);
        sendMapInfoToBot();
    }

    public boolean isArenaGroupDisabled(String groupId) {
        return disabledArenaGroups.contains(groupId);
    }
    
    
    public void disableMap(String physicalArenaName) {
        String groupId = physicalArenaToGroupMap.get(physicalArenaName);
        if (groupId != null) {
            disableArenaGroup(groupId);
        } else {
            plugin.getLogger().warning("Cannot disable arena '" + physicalArenaName + "' - not found in any group");
        }
    }

    public void enableMap(String physicalArenaName) {
        String groupId = physicalArenaToGroupMap.get(physicalArenaName);
        if (groupId != null) {
            enableArenaGroup(groupId);
        } else {
            plugin.getLogger().warning("Cannot enable arena '" + physicalArenaName + "' - not found in any group");
        }
    }

    public boolean isMapDisabled(String physicalArenaName) {
        String groupId = physicalArenaToGroupMap.get(physicalArenaName);
        return groupId != null && isArenaGroupDisabled(groupId);
    }

    public void warpPlayersToGame(String gameId, String requestedMap, JsonObject team1Json, JsonObject team2Json, boolean isRanked) {
        plugin.debug("Warping players for game #" + gameId + " on requested map " + requestedMap + " (ranked: " + isRanked + ")");

        String physicalArenaToUse = requestedMap;

        if (!physicalArenaToGroupMap.containsKey(physicalArenaToUse)) {
            plugin.getLogger().warning("Map not found: " + requestedMap);
            sendWarpFailedArenaNotFound(gameId, requestedMap);
            return;
        }

        if (isMapDisabled(physicalArenaToUse)) {
            plugin.getLogger().warning("Map is disabled: " + physicalArenaToUse);
            sendWarpFailedArenaNotFound(gameId, requestedMap);
            return;
        }

        if (isMapLocked(physicalArenaToUse)) {
            plugin.getLogger().warning("Map is already locked: " + physicalArenaToUse);
            sendWarpFailedArenaNotFound(gameId, requestedMap);
            return;
        }

        cleanupExistingGameForMap(physicalArenaToUse);

        lockMap(physicalArenaToUse);

        gameIdToPhysicalArenaMap.put(gameId, physicalArenaToUse);

        if (plugin.getGameDataManager() != null) {
            plugin.getGameDataManager().saveGameWarpData(gameId, physicalArenaToUse, team1Json, team2Json, isRanked);
        }

        if (BedwarsAPIManager.isAvailable()) {
            BedwarsAPIManager.getImplementation().warpPlayersToGame(gameId, physicalArenaToUse, team1Json, team2Json, isRanked);
        } else {
            sendWarpFailureUnknown(gameId);
            plugin.getLogger().warning("Cannot warp players: No BedWars implementation is available");
        }
    }
    
    
    public void lockArenaGroup(String groupId) {
        lockedArenaGroups.add(groupId);
        plugin.debug("Locked arena group: " + groupId);
        sendMapInfoToBot();
    }
    
    public void unlockArenaGroup(String groupId) {
        lockedArenaGroups.remove(groupId);
        ArenaGroup group = arenaGroups.get(groupId);
        if (group != null) {
            group.setCurrentlyUsed(null); 
        }
        plugin.debug("Unlocked arena group: " + groupId);
        sendMapInfoToBot();
    }
    
    public boolean isArenaGroupLocked(String groupId) {
        return lockedArenaGroups.contains(groupId);
    }
    
    /**
     * Clean up any existing game data for the specified arena group
     */
    public void cleanupExistingGameForArenaGroup(String groupId) {
        plugin.debug("Cleaning up existing game data for arena group: " + groupId);
        
        ArenaGroup group = arenaGroups.get(groupId);
        if (group == null) {
            plugin.debug("Arena group not found: " + groupId);
            return;
        }
        
        
        for (String physicalArenaName : group.getAllPhysicalArenaNames()) {
            cleanupExistingGameForMap(physicalArenaName);
        }
        
        
        group.setCurrentlyUsed(null);
        
        plugin.debug("Completed cleanup for arena group: " + groupId);
    }
    
    
    public void sendWarpSuccess(String gameId) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_success");
            response.addProperty("gameId", gameId);
            if (plugin.getWebSocketManager() != null) {
                plugin.getWebSocketManager().sendMessage(response.toString());
            }
        });
    }

    public void sendWarpFailedArenaNotFound(String gameId, String mapName) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_failed_arena_not_found");
            response.addProperty("gameId", gameId);
            response.addProperty("map", mapName);
            if (plugin.getWebSocketManager() != null) {
                plugin.getWebSocketManager().sendMessage(response.toString());
            }
        });
    }

    public void sendWarpFailedOfflinePlayers(String gameId, List<String> offlinePlayers) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_failed_offline_players");
            response.addProperty("gameId", gameId);
            JsonArray offlineArray = new JsonArray();
            for (String ign : offlinePlayers) {
                offlineArray.add(ign);
            }
            response.add("offline_players", offlineArray);
            if (plugin.getWebSocketManager() != null) {
                plugin.getWebSocketManager().sendMessage(response.toString());
            }
        });
    }
    public void sendWarpFailureUnknown(String gameId) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_failure_unknown");
            response.addProperty("gameid", gameId);
            if (plugin.getWebSocketManager() != null) {
                plugin.getWebSocketManager().sendMessage(response.toString());
            }
        });
    }
    public String getGameIdForArena(String arenaName) {
        for (Map.Entry<String, String> entry : gameIdToPhysicalArenaMap.entrySet()) {
            if (entry.getValue().equals(arenaName)) {
                return entry.getKey();
            }
        }
        return null;
    }

    /**
     * Cleans up any existing game data for the specified physical arena
     * This includes removing game instances from listeners and clearing the game ID mapping
     */
    public void cleanupExistingGameForMap(String mapName) {
        plugin.debug("Cleaning up existing game data for map: " + mapName);
        
        
        String existingGameId = null;
        for (Map.Entry<String, String> entry : gameIdToPhysicalArenaMap.entrySet()) {
            if (entry.getValue().equals(mapName)) {
                existingGameId = entry.getKey();
                break;
            }
        }
        
        if (existingGameId != null) {
            plugin.debug("Found existing game ID: " + existingGameId + " for map: " + mapName + " - removing it");
            gameIdToPhysicalArenaMap.remove(existingGameId);
        }
        
        
        if (plugin.isMBedwars()) {
            
            try {
                if (com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
                    com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation() instanceof com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation) {
                    
                    com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation impl = 
                        (com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation) com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation();
                    
                    com.deyo.rbw.listeners.MBedwarsListener listener = impl.getListener();
                    if (listener != null) {
                        plugin.debug("Cleaning up MBedwars listener game instances for map: " + mapName);
                        listener.cleanupGameInstanceForMap(mapName);
                    } else {
                        plugin.debug("MBedwars listener is null, skipping cleanup");
                    }
                }
            } catch (Exception e) {
                plugin.debug("Error cleaning up MBedwars listener: " + e.getMessage());
            }
        }
        
        if (plugin.isBedWars1058()) {
            
            try {
                if (com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
                    com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation() instanceof com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation) {
                    
                    com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation impl = 
                        (com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation) com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation();
                    
                    com.deyo.rbw.listeners.BedWars1058Listener listener = impl.getListener();
                    if (listener != null) {
                        plugin.debug("Cleaning up BedWars1058 listener game trackers for map: " + mapName);
                        listener.cleanupGameTrackerForMap(mapName);
                    } else {
                        plugin.debug("BedWars1058 listener is null, skipping cleanup");
                    }
                }
            } catch (Exception e) {
                plugin.debug("Error cleaning up BedWars1058 listener: " + e.getMessage());
            }
        }
        
        plugin.debug("Completed cleanup for map: " + mapName + (existingGameId != null ? " (removed game ID: " + existingGameId + ")" : " (no existing game ID found)"));
    }

    
    public Set<String> getMapNames() {
        return new HashSet<>(physicalArenaToGroupMap.keySet());
    }
    
    
    public Set<String> getArenaGroupIds() {
        return new HashSet<>(arenaGroups.keySet());
    }
    
    public ArenaGroup getArenaGroup(String groupId) {
        return arenaGroups.get(groupId);
    }
    
    public String getArenaGroupId(String physicalArenaName) {
        return physicalArenaToGroupMap.get(physicalArenaName);
    }
    
    
    public void lockMap(String mapName) {
        String groupId = physicalArenaToGroupMap.get(mapName);
        if (groupId != null) {
            lockArenaGroup(groupId);
        } else {
            plugin.getLogger().warning("Cannot lock arena '" + mapName + "' - not found in any group");
        }
    }
    
    public void unlockMap(String mapName) {
        String groupId = physicalArenaToGroupMap.get(mapName);
        if (groupId != null) {
            unlockArenaGroup(groupId);
        } else {
            plugin.getLogger().warning("Cannot unlock arena '" + mapName + "' - not found in any group");
        }
    }
    
    public boolean isMapLocked(String mapName) {
        String groupId = physicalArenaToGroupMap.get(mapName);
        return groupId != null && isArenaGroupLocked(groupId);
    }
    
    public Set<String> getReservedMaps() {
        
        return arenaGroups.keySet().stream()
                .filter(groupId -> !isArenaGroupLocked(groupId) && !isArenaGroupDisabled(groupId))
                .collect(java.util.stream.Collectors.toSet());
    }

    public Set<String> getLockedMaps() {
        
        return lockedArenaGroups.stream()
                .filter(groupId -> !isArenaGroupDisabled(groupId))
                .collect(java.util.stream.Collectors.toSet());
    }
    
    public void startMapAutoRefresh() {
        Bukkit.getScheduler().runTaskLater(plugin, this::initializeMaps, 20L);

        
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                if (!arenaGroups.isEmpty()) {
                    sendMapInfoToBot();
                    plugin.debug("Periodic arena groups data sync with WebSocket server");
                }
            }
        }, 600L, 600L);

        
        Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if (!com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable()) {
                return;
            }
            
            Set<String> locked = new HashSet<>(lockedArenaGroups);
            for (String groupId : locked) {
                ArenaGroup group = arenaGroups.get(groupId);
                if (group == null) continue;
                
                boolean isEmpty = true;
                
                
                for (String physicalArenaName : group.getAllPhysicalArenaNames()) {
                    Object arena = com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByName(physicalArenaName);
                    
                    try {
                        if (arena != null) {
                            
                            try {
                                Object players = arena.getClass().getMethod("getPlayers").invoke(arena);
                                if (players instanceof Collection<?>) {
                                    if (!((Collection<?>) players).isEmpty()) {
                                        isEmpty = false;
                                        break;
                                    }
                                }
                            } catch (Exception e) {
                                plugin.getLogger().fine("Could not check players with getPlayers method: " + e.getMessage());
                                
                                if (arena instanceof de.marcely.bedwars.api.arena.Arena) {
                                    if (!((de.marcely.bedwars.api.arena.Arena) arena).getPlayers().isEmpty()) {
                                        isEmpty = false;
                                        break;
                                    }
                                } else if (arena.getClass().getName().contains("andrei1058")) {
                                    
                                    Method getPlayersMethod = arena.getClass().getMethod("getPlayers");
                                    Object playersObj = getPlayersMethod.invoke(arena);
                                    if (playersObj instanceof Collection<?>) {
                                        if (!((Collection<?>) playersObj).isEmpty()) {
                                            isEmpty = false;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (Exception e) {
                        plugin.getLogger().warning("Error checking if arena is empty: " + e.getMessage());
                    }
                }
                
                if (isEmpty) {
                    unlockArenaGroup(groupId);
                    plugin.debug("Auto-unlocked arena group '" + groupId + "' because all its arenas are empty.");
                }
            }
        }, 100L, 100L); 
    }
    
    public Set<String> getDisabledMaps() {
        return new HashSet<>(disabledArenaGroups);
    }
    
    public Set<String> getDisabledArenaGroups() {
        return new HashSet<>(disabledArenaGroups);
    }
    
    /**
     * Get all arena groups that are currently available (not locked or disabled)
     */
    public Set<String> getAvailableArenaGroups() {
        Set<String> available = new HashSet<>();
        for (String groupId : arenaGroups.keySet()) {
            if (!isArenaGroupLocked(groupId) && !isArenaGroupDisabled(groupId)) {
                available.add(groupId);
            }
        }
        return available;
    }
    
    /**
     * Get the best variant for a given arena group based on game type
     */
    public String getBestArenaForGroup(String groupId, boolean isRanked) {
        ArenaGroup group = arenaGroups.get(groupId);
        if (group == null) return null;
        
        ArenaVariant bestVariant = group.getBestVariant(isRanked);
        return bestVariant != null ? group.getPhysicalArenaName(bestVariant) : null;
    }
    
    /**
     * Check if an arena group has a specific variant
     */
    public boolean hasVariant(String groupId, ArenaVariant variant) {
        ArenaGroup group = arenaGroups.get(groupId);
        return group != null && group.hasVariant(variant);
    }
    
    /**
     * Get all physical arena names for a specific arena group
     */
    public Set<String> getPhysicalArenasForGroup(String groupId) {
        ArenaGroup group = arenaGroups.get(groupId);
        return group != null ? group.getAllPhysicalArenaNames() : new HashSet<>();
    }
    
    /**
     * Force unlock all arena groups (admin utility)
     */
    public void unlockAllArenaGroups() {
        Set<String> lockedGroupsCopy = new HashSet<>(lockedArenaGroups);
        for (String groupId : lockedGroupsCopy) {
            unlockArenaGroup(groupId);
        }
        plugin.getLogger().info("Unlocked all arena groups (" + lockedGroupsCopy.size() + " groups)");
    }
    
    /**
     * Manually add an arena group with specific variants (for advanced setup)
     */
    public boolean addArenaGroup(String groupId, String displayName, int maxPlayers, List<String> teamNames, 
                                Map<ArenaVariant, String> variants) {
        if (arenaGroups.containsKey(groupId)) {
            plugin.getLogger().warning("Arena group already exists: " + groupId);
            return false;
        }
        
        ArenaGroup group = new ArenaGroup(groupId, displayName, maxPlayers, teamNames);
        
        
        for (Map.Entry<ArenaVariant, String> entry : variants.entrySet()) {
            String physicalArenaName = entry.getValue();
            
            
            if (physicalArenaToGroupMap.containsKey(physicalArenaName)) {
                plugin.getLogger().warning("Physical arena '" + physicalArenaName + 
                                         "' is already mapped to group: " + physicalArenaToGroupMap.get(physicalArenaName));
                continue;
            }
            
            group.addVariant(entry.getKey(), physicalArenaName);
            physicalArenaToGroupMap.put(physicalArenaName, groupId);
        }
        
        arenaGroups.put(groupId, group);
        plugin.getLogger().info("Manually added arena group: " + groupId + " with " + 
                               group.getAvailableVariants().size() + " variants");
        
        sendMapInfoToBot();
        return true;
    }

    /**
     * Get arena group statistics
     */
    public JsonObject getArenaGroupStatistics() {
        JsonObject stats = new JsonObject();
        
        stats.addProperty("total_groups", arenaGroups.size());
        stats.addProperty("total_physical_arenas", physicalArenaToGroupMap.size());
        stats.addProperty("locked_groups", lockedArenaGroups.size());
        stats.addProperty("disabled_groups", disabledArenaGroups.size());
        stats.addProperty("available_groups", getAvailableArenaGroups().size());
        stats.addProperty("active_games", gameIdToPhysicalArenaMap.size());
        
        
        JsonObject variantStats = new JsonObject();
        for (ArenaVariant variant : ArenaVariant.values()) {
            int count = 0;
            for (ArenaGroup group : arenaGroups.values()) {
                if (group.hasVariant(variant)) {
                    count++;
                }
            }
            variantStats.addProperty(variant.name().toLowerCase(), count);
        }
        stats.add("variant_distribution", variantStats);
        
        return stats;
    }
    
    /**
     * Validate arena group integrity and report any issues
     */
    public List<String> validateArenaGroups() {
        List<String> issues = new ArrayList<>();
        
        for (Map.Entry<String, ArenaGroup> entry : arenaGroups.entrySet()) {
            String groupId = entry.getKey();
            ArenaGroup group = entry.getValue();
            
            
            if (group.getAvailableVariants().isEmpty()) {
                issues.add("Arena group '" + groupId + "' has no variants");
            }
            
            
            for (ArenaVariant variant : group.getAvailableVariants()) {
                String physicalArena = group.getPhysicalArenaName(variant);
                if (physicalArena == null || physicalArena.isEmpty()) {
                    issues.add("Arena group '" + groupId + "' variant '" + variant + "' has no physical arena");
                }
                
                
                String mappedGroup = physicalArenaToGroupMap.get(physicalArena);
                if (!groupId.equals(mappedGroup)) {
                    issues.add("Physical arena '" + physicalArena + "' mapping inconsistency: " +
                              "group says '" + groupId + "' but mapping says '" + mappedGroup + "'");
                }
            }
            
            
            for (Map.Entry<String, String> mapEntry : physicalArenaToGroupMap.entrySet()) {
                String physicalArena = mapEntry.getKey();
                String mappedGroupId = mapEntry.getValue();
                
                ArenaGroup mappedGroup = arenaGroups.get(mappedGroupId);
                if (mappedGroup == null) {
                    issues.add("Physical arena '" + physicalArena + "' is mapped to non-existent group '" + mappedGroupId + "'");
                    continue;
                }
                
                boolean found = false;
                for (ArenaVariant variant : mappedGroup.getAvailableVariants()) {
                    if (physicalArena.equals(mappedGroup.getPhysicalArenaName(variant))) {
                        found = true;
                        break;
                    }
                }
                
                if (!found) {
                    issues.add("Physical arena '" + physicalArena + "' is mapped to group '" + mappedGroupId + 
                              "' but group doesn't contain this arena");
                }
            }
        }
        
        if (issues.isEmpty()) {
            plugin.getLogger().info("Arena group validation successful - no issues found");
        } else {
            plugin.getLogger().warning("Arena group validation found " + issues.size() + " issues:");
            for (String issue : issues) {
                plugin.getLogger().warning("  - " + issue);
            }
        }
        
        return issues;
    }
}

