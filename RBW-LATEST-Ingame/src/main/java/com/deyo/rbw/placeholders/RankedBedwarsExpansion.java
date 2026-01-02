package com.deyo.rbw.placeholders;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.LeaderboardEntry;
import com.deyo.rbw.models.UserData;
import com.deyo.rbw.utils.APIClient;
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class RankedBedwarsExpansion extends PlaceholderExpansion {
    
    private final RankedBedwars plugin;
    private final APIClient apiClient;
    
    
    private final Map<String, CachedUserData> userDataCache = new ConcurrentHashMap<>();
    private final Map<String, CachedLeaderboard> leaderboardCache = new ConcurrentHashMap<>();
    
    
    private static final long USER_CACHE_TTL = TimeUnit.MINUTES.toMillis(5); 
    private static final long LEADERBOARD_CACHE_TTL = TimeUnit.MINUTES.toMillis(2); 
    
    
    private static final Set<String> VALID_MODES = Set.of(
        "elo", "kills", "deaths", "wins", "losses", "games",
        "winstreak", "losestreak", "kdr", "wlr", "finalKills", "bedBroken", "mvps",
        "diamonds", "irons", "gold", "emeralds", "blocksPlaced"
    );
    
    
    private static final Pattern TOP_PATTERN = Pattern.compile("top_([a-z]+)_([0-9]+)");
    private static final Pattern TOP_VALUE_PATTERN = Pattern.compile("top_([a-z]+)_([0-9]+)_value");
    
    public RankedBedwarsExpansion(RankedBedwars plugin) {
        this.plugin = plugin;
        this.apiClient = new APIClient(plugin.getGson(), plugin.getLogger(), plugin.getConfig());
        
        
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpiredCache, 20L * 60L, 20L * 60L); 
    }

    @Override
    public @NotNull String getIdentifier() {
        return "rbw";
    }

    @Override
    public @NotNull String getAuthor() {
        return "Deyo";
    }

    @Override
    public @NotNull String getVersion() {
        return plugin.getDescription().getVersion();
    }

    @Override
    public boolean persist() {
        return true;
    }

    @Override
    public boolean canRegister() {
        return true;
    }

    @Override
    public @Nullable String onRequest(OfflinePlayer player, @NotNull String params) {
        if (player == null) {
            return null;
        }

        String playerName = player.getName();
        if (playerName == null) {
            return null;
        }

        
        switch (params.toLowerCase()) {
            case "elo":
                return getCachedUserStat(playerName, "elo");
            case "wins":
                return getCachedUserStat(playerName, "wins");
            case "losses":
                return getCachedUserStat(playerName, "losses");
            case "games":
                return getCachedUserStat(playerName, "games");
            case "kills":
                return getCachedUserStat(playerName, "kills");
            case "deaths":
                return getCachedUserStat(playerName, "deaths");
            case "kdr":
                return getCachedUserStat(playerName, "kdr");
            case "wlr":
                return getCachedUserStat(playerName, "wlr");
            case "winstreak":
                return getCachedUserStat(playerName, "winstreak");
            case "losestreak":
                return getCachedUserStat(playerName, "losestreak");
            case "finalkills":
                return getCachedUserStat(playerName, "finalKills");
            case "bedbroken":
                return getCachedUserStat(playerName, "bedBroken");
            case "mvps":
                return getCachedUserStat(playerName, "mvps");
            case "diamonds":
                return getCachedUserStat(playerName, "diamonds");
            case "irons":
                return getCachedUserStat(playerName, "irons");
            case "gold":
                return getCachedUserStat(playerName, "gold");
            case "emeralds":
                return getCachedUserStat(playerName, "emeralds");
            case "blocksplaced":
                return getCachedUserStat(playerName, "blocksPlaced");
            default:
                
                return handleLeaderboardPlaceholder(params);
        }
    }

    private String getCachedUserStat(String playerName, String stat) {
        CachedUserData cached = userDataCache.get(playerName.toLowerCase());
        
        if (cached != null && !cached.isExpired()) {
            return getUserStatValue(cached.getData(), stat);
        }
        
        
        fetchUserDataAsync(playerName);
        return "Loading...";
    }
    
    private String getUserStatValue(UserData userData, String stat) {
        if (userData == null) {
            return "0";
        }
        
        switch (stat) {
            case "elo":
                return String.valueOf(userData.getElo());
            case "wins":
                return String.valueOf(userData.getWins());
            case "losses":
                return String.valueOf(userData.getLosses());
            case "games":
                return String.valueOf(userData.getGames());
            case "kills":
                return String.valueOf(userData.getKills());
            case "deaths":
                return String.valueOf(userData.getDeaths());
            case "kdr":
                return String.format("%.2f", userData.getKdr());
            case "wlr":
                return String.format("%.2f", userData.getWlr());
            case "winstreak":
                return String.valueOf(userData.getWinstreak());
            case "losestreak":
                return String.valueOf(userData.getLosestreak());
            case "finalKills":
                return String.valueOf(userData.getFinalKills());
            case "bedBroken":
                return String.valueOf(userData.getBedBroken());
            case "mvps":
                return String.valueOf(userData.getMvps());
            case "diamonds":
                return String.valueOf(userData.getDiamonds());
            case "irons":
                return String.valueOf(userData.getIrons());
            case "gold":
                return String.valueOf(userData.getGold());
            case "emeralds":
                return String.valueOf(userData.getEmeralds());
            case "blocksPlaced":
                return String.valueOf(userData.getBlocksPlaced());
            default:
                return "0";
        }
    }
    
    private String handleLeaderboardPlaceholder(String params) {
        
        Matcher topValueMatcher = TOP_VALUE_PATTERN.matcher(params);
        if (topValueMatcher.matches()) {
            String mode = topValueMatcher.group(1);
            int position = Integer.parseInt(topValueMatcher.group(2));
            return getCachedLeaderboardValue(mode, position);
        }
        
        Matcher topMatcher = TOP_PATTERN.matcher(params);
        if (topMatcher.matches()) {
            String mode = topMatcher.group(1);
            int position = Integer.parseInt(topMatcher.group(2));
            return getCachedLeaderboardPlayer(mode, position);
        }
        
        return null;
    }
    
    private String getCachedLeaderboardPlayer(String mode, int position) {
        if (!VALID_MODES.contains(mode)) {
            return "Invalid Mode";
        }
        
        String cacheKey = mode + "_" + getPageFromPosition(position);
        CachedLeaderboard cached = leaderboardCache.get(cacheKey);
        
        if (cached != null && !cached.isExpired()) {
            LeaderboardEntry entry = cached.getData().get(position);
            return entry != null ? entry.getIgn() : "N/A";
        }
        
        
        fetchLeaderboardAsync(mode, getPageFromPosition(position));
        return "Loading...";
    }
    
    private String getCachedLeaderboardValue(String mode, int position) {
        if (!VALID_MODES.contains(mode)) {
            return "Invalid Mode";
        }
        
        String cacheKey = mode + "_" + getPageFromPosition(position);
        CachedLeaderboard cached = leaderboardCache.get(cacheKey);
        
        if (cached != null && !cached.isExpired()) {
            LeaderboardEntry entry = cached.getData().get(position);
            if (entry != null) {
                if (mode.equals("kdr") || mode.equals("wlr")) {
                    return String.format("%.2f", entry.getValue());
                } else {
                    return String.valueOf((int) entry.getValue());
                }
            }
            return "0";
        }
        
        
        fetchLeaderboardAsync(mode, getPageFromPosition(position));
        return "Loading...";
    }
    
    private int getPageFromPosition(int position) {
        return ((position - 1) / 10) + 1;
    }
    
    private void fetchUserDataAsync(String playerName) {
        CompletableFuture<UserData> future = apiClient.getUserData(playerName);
        future.thenAccept(userData -> {
            if (userData != null) {
                userDataCache.put(playerName.toLowerCase(), new CachedUserData(userData));
                plugin.debug("Cached user data for " + playerName);
            }
        }).exceptionally(throwable -> {
            plugin.getLogger().warning("Failed to fetch user data for " + playerName + ": " + throwable.getMessage());
            return null;
        });
    }
    
    private void fetchLeaderboardAsync(String mode, int page) {
        String cacheKey = mode + "_" + page;
        CompletableFuture<Map<Integer, LeaderboardEntry>> future = apiClient.getLeaderboard(mode, page);
        future.thenAccept(leaderboard -> {
            if (leaderboard != null && !leaderboard.isEmpty()) {
                leaderboardCache.put(cacheKey, new CachedLeaderboard(leaderboard));
                plugin.debug("Cached leaderboard data for " + mode + " page " + page);
            }
        }).exceptionally(throwable -> {
            plugin.getLogger().warning("Failed to fetch leaderboard for " + mode + " page " + page + ": " + throwable.getMessage());
            return null;
        });
    }
    
    private void cleanupExpiredCache() {
        long currentTime = System.currentTimeMillis();
        
        
        userDataCache.entrySet().removeIf(entry -> entry.getValue().isExpired(currentTime));
        
        
        leaderboardCache.entrySet().removeIf(entry -> entry.getValue().isExpired(currentTime));
        
        plugin.debug("Cleaned up expired cache entries");
    }
    
    public void clearCache() {
        userDataCache.clear();
        leaderboardCache.clear();
        plugin.getLogger().info("Cleared all placeholder caches");
    }
    
    
    private static class CachedUserData {
        private final UserData data;
        private final long cacheTime;
        
        public CachedUserData(UserData data) {
            this.data = data;
            this.cacheTime = System.currentTimeMillis();
        }
        
        public UserData getData() {
            return data;
        }
        
        public boolean isExpired() {
            return isExpired(System.currentTimeMillis());
        }
        
        public boolean isExpired(long currentTime) {
            return (currentTime - cacheTime) > USER_CACHE_TTL;
        }
    }
    
    private static class CachedLeaderboard {
        private final Map<Integer, LeaderboardEntry> data;
        private final long cacheTime;
        
        public CachedLeaderboard(Map<Integer, LeaderboardEntry> data) {
            this.data = data;
            this.cacheTime = System.currentTimeMillis();
        }
        
        public Map<Integer, LeaderboardEntry> getData() {
            return data;
        }
        
        public boolean isExpired() {
            return isExpired(System.currentTimeMillis());
        }
        
        public boolean isExpired(long currentTime) {
            return (currentTime - cacheTime) > LEADERBOARD_CACHE_TTL;
        }
    }
}
