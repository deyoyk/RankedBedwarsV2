package com.deyo.rbw.placeholders;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.managers.WebSocketManager;
import com.deyo.rbw.models.LeaderboardEntry;
import com.deyo.rbw.models.LiveGameStats;
import com.deyo.rbw.models.UserData;
import com.deyo.rbw.utils.APIClient;
import me.clip.placeholderapi.expansion.PlaceholderExpansion;
import org.bukkit.OfflinePlayer;
import org.bukkit.entity.Player;
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
    private final Set<String> pendingUserFetches = ConcurrentHashMap.newKeySet();
    private final Set<String> pendingLeaderboardFetches = ConcurrentHashMap.newKeySet();
    
    
    private static final long USER_CACHE_TTL = TimeUnit.MINUTES.toMillis(5); 
    private static final long LEADERBOARD_CACHE_TTL = TimeUnit.MINUTES.toMillis(2); 
    
    
    private static final Set<String> VALID_MODES = Set.of(
        "elo", "kills", "deaths", "wins", "losses", "games",
        "winStreak", "loseStreak", "kdr", "wlr", "finalKills", "finalDeaths",
        "bedBroken", "mvps", "diamonds", "irons", "gold", "emeralds", "blocksPlaced",
        "level", "experience", "playtimeSeconds", "peakElo",
        "damageDealt", "damageTaken", "assists", "bestStreak", "firstBloods"
    );

    private static final Map<String, String> MODE_ALIASES;
    static {
        Map<String, String> aliases = new HashMap<>();
        aliases.put("winstreak", "winStreak");
        aliases.put("win_streak", "winStreak");
        aliases.put("losestreak", "loseStreak");
        aliases.put("lose_streak", "loseStreak");
        aliases.put("finalkills", "finalKills");
        aliases.put("final_kills", "finalKills");
        aliases.put("fk", "finalKills");
        aliases.put("finaldeaths", "finalDeaths");
        aliases.put("final_deaths", "finalDeaths");
        aliases.put("fd", "finalDeaths");
        aliases.put("bedbroken", "bedBroken");
        aliases.put("bed_broken", "bedBroken");
        aliases.put("beds", "bedBroken");
        aliases.put("bb", "bedBroken");
        aliases.put("blocksplaced", "blocksPlaced");
        aliases.put("blocks_placed", "blocksPlaced");
        aliases.put("damagedealt", "damageDealt");
        aliases.put("damage_dealt", "damageDealt");
        aliases.put("dd", "damageDealt");
        aliases.put("damagetaken", "damageTaken");
        aliases.put("damage_taken", "damageTaken");
        aliases.put("dt", "damageTaken");
        aliases.put("beststreak", "bestStreak");
        aliases.put("best_streak", "bestStreak");
        aliases.put("higheststreak", "bestStreak");
        aliases.put("highest_streak", "bestStreak");
        aliases.put("firstbloods", "firstBloods");
        aliases.put("first_bloods", "firstBloods");
        aliases.put("firstblood", "firstBloods");
        aliases.put("first_blood", "firstBloods");
        aliases.put("fb", "firstBloods");
        aliases.put("playtime", "playtimeSeconds");
        aliases.put("playtimeseconds", "playtimeSeconds");
        aliases.put("playtime_seconds", "playtimeSeconds");
        aliases.put("seconds_played", "playtimeSeconds");
        aliases.put("peakelo", "peakElo");
        aliases.put("peak_elo", "peakElo");
        aliases.put("exp", "experience");
        aliases.put("xp", "experience");
        MODE_ALIASES = Collections.unmodifiableMap(aliases);
    }
    
    
    private static final Pattern TOP_PATTERN = Pattern.compile("top_([a-z_]+)_([0-9]+)");
    private static final Pattern TOP_VALUE_PATTERN = Pattern.compile("top_([a-z_]+)_([0-9]+)_value");
    
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
        String normalizedParams = params.toLowerCase(Locale.ROOT);
        if (normalizedParams.startsWith("ingame_")) {
            normalizedParams = "game_" + normalizedParams.substring("ingame_".length());
        } else if (normalizedParams.startsWith("match_")) {
            normalizedParams = "game_" + normalizedParams.substring("match_".length());
        }
        if (normalizedParams.startsWith("game_")) {
            String gameValue = handleGamePlaceholder(normalizedParams, player);
            if (gameValue != null) {
                return gameValue;
            }
        }

        if (player == null) {
            return handleLeaderboardPlaceholder(normalizedParams);
        }

        String playerName = player.getName();
        if (playerName == null) {
            return handleLeaderboardPlaceholder(normalizedParams);
        }

        switch (normalizedParams) {
            case "elo":
                return getCachedUserStat(playerName, "elo");
            case "ign":
            case "name":
                return getCachedUserStat(playerName, "ign");
            case "discordid":
            case "discord_id":
                return getCachedUserStat(playerName, "discord_id");
            case "banned":
                return getCachedUserStat(playerName, "banned");
            case "muted":
                return getCachedUserStat(playerName, "muted");
            case "frozen":
                return getCachedUserStat(playerName, "frozen");
            case "level":
                return getCachedUserStat(playerName, "level");
            case "experience":
            case "exp":
            case "xp":
                return getCachedUserStat(playerName, "experience");
            case "playtime":
            case "playtime_seconds":
            case "playtimeseconds":
            case "seconds_played":
                return getCachedUserStat(playerName, "playtime_seconds");
            case "playtime_minutes":
            case "playtimeminutes":
                return getCachedUserStat(playerName, "playtime_minutes");
            case "playtime_hours":
            case "playtimehours":
                return getCachedUserStat(playerName, "playtime_hours");
            case "playtime_days":
            case "playtimedays":
                return getCachedUserStat(playerName, "playtime_days");
            case "playtime_formatted":
            case "playtimeformatted":
            case "playtime_pretty":
                return getCachedUserStat(playerName, "playtime_formatted");
            case "peakelo":
            case "peak_elo":
                return getCachedUserStat(playerName, "peak_elo");
            case "wins":
            case "gameswon":
            case "games_won":
                return getCachedUserStat(playerName, "wins");
            case "losses":
            case "gameslost":
            case "games_lost":
                return getCachedUserStat(playerName, "losses");
            case "games":
            case "gamesplayed":
            case "games_played":
                return getCachedUserStat(playerName, "games");
            case "winrate":
            case "win_rate":
            case "winpercentage":
            case "win_percentage":
                return getCachedUserStat(playerName, "win_rate");
            case "kills":
                return getCachedUserStat(playerName, "kills");
            case "deaths":
                return getCachedUserStat(playerName, "deaths");
            case "kdr":
            case "kd":
            case "killdeathratio":
            case "kill_death_ratio":
                return getCachedUserStat(playerName, "kdr");
            case "wlr":
            case "wl":
            case "winlossratio":
            case "win_loss_ratio":
                return getCachedUserStat(playerName, "wlr");
            case "winstreak":
            case "win_streak":
            case "currentstreak":
            case "current_streak":
                return getCachedUserStat(playerName, "win_streak");
            case "losestreak":
            case "lose_streak":
                return getCachedUserStat(playerName, "lose_streak");
            case "finalkills":
            case "final_kills":
            case "fk":
                return getCachedUserStat(playerName, "final_kills");
            case "finaldeaths":
            case "final_deaths":
            case "fd":
                return getCachedUserStat(playerName, "final_deaths");
            case "finalkd":
            case "final_kd":
            case "finalkdr":
            case "final_kdr":
                return getCachedUserStat(playerName, "final_kd");
            case "bedbroken":
            case "bed_broken":
            case "beds":
            case "bb":
                return getCachedUserStat(playerName, "bed_broken");
            case "mvps":
                return getCachedUserStat(playerName, "mvps");
            case "diamonds":
                return getCachedUserStat(playerName, "diamonds");
            case "irons":
            case "iron":
                return getCachedUserStat(playerName, "irons");
            case "gold":
                return getCachedUserStat(playerName, "gold");
            case "emeralds":
            case "emerald":
                return getCachedUserStat(playerName, "emeralds");
            case "blocksplaced":
            case "blocks_placed":
                return getCachedUserStat(playerName, "blocks_placed");
            case "damagedealt":
            case "damage_dealt":
            case "dd":
                return getCachedUserStat(playerName, "damage_dealt");
            case "damagetaken":
            case "damage_taken":
            case "dt":
                return getCachedUserStat(playerName, "damage_taken");
            case "assists":
                return getCachedUserStat(playerName, "assists");
            case "beststreak":
            case "best_streak":
            case "higheststreak":
            case "highest_streak":
                return getCachedUserStat(playerName, "best_streak");
            case "firstbloods":
            case "first_bloods":
            case "firstblood":
            case "first_blood":
            case "fb":
                return getCachedUserStat(playerName, "first_bloods");
            case "kills_per_game":
            case "killspg":
            case "kpg":
                return getCachedUserStat(playerName, "kills_per_game");
            case "deaths_per_game":
            case "deathspg":
            case "dpg":
                return getCachedUserStat(playerName, "deaths_per_game");
            case "final_kills_per_game":
            case "finalkillspg":
            case "fkpg":
                return getCachedUserStat(playerName, "final_kills_per_game");
            case "beds_per_game":
            case "bedspg":
            case "bbpg":
                return getCachedUserStat(playerName, "beds_per_game");
            case "mvps_per_game":
            case "mvpspg":
                return getCachedUserStat(playerName, "mvps_per_game");
            case "assists_per_game":
            case "assistspg":
                return getCachedUserStat(playerName, "assists_per_game");
            case "mvp_rate":
            case "mvprate":
                return getCachedUserStat(playerName, "mvp_rate");
            case "bed_rate":
            case "bedbreakrate":
            case "bed_break_rate":
                return getCachedUserStat(playerName, "bed_break_rate");
            case "firstblood_rate":
            case "first_blood_rate":
                return getCachedUserStat(playerName, "first_blood_rate");
            default:
                
                return handleLeaderboardPlaceholder(normalizedParams);
        }
    }

    private String handleGamePlaceholder(String params, OfflinePlayer player) {
        Player online = player != null ? player.getPlayer() : null;
        LiveGameStats game = online != null ? plugin.getLiveGameStats(online) : null;
        if (game == null) {
            return params.contains("map") || params.contains("arena") || params.contains("id")
                    || params.contains("team") || params.contains("first_blood") || params.contains("mode")
                    ? "N/A" : "0";
        }

        String playerName = online.getName();
        String team = game.getTeam(playerName);
        switch (params) {
            case "game_id":
                return game.getGameId();
            case "game_map":
                return game.getMap();
            case "game_arena":
                return game.getArenaName();
            case "game_ranked":
                return String.valueOf(game.isRanked());
            case "game_mode":
                return game.isRanked() ? "Ranked" : "Casual";
            case "game_duration":
            case "game_duration_seconds":
                return String.valueOf(game.getDuration());
            case "game_duration_minutes":
                return String.valueOf(game.getDuration() / 60);
            case "game_duration_formatted":
                return formatDuration(game.getDuration());
            case "game_team":
            case "game_team_name":
                return team != null ? team : "N/A";
            case "game_team_size":
                return String.valueOf(teamPlayerNames(game, team).size());
            case "game_team_players":
                return String.join(", ", teamPlayerNames(game, team));
            case "game_players":
                return String.valueOf(game.getPlayers().size());
            case "game_first_blood":
            case "game_firstblood":
            case "game_first_blood_player":
                return game.getFirstBlood() != null ? game.getFirstBlood() : "None";
            case "game_has_first_blood":
            case "game_first_blood_set":
                return String.valueOf(game.getFirstBlood() != null);
            case "game_kills":
                return String.valueOf(game.getKills(playerName));
            case "game_deaths":
                return String.valueOf(game.getDeaths(playerName));
            case "game_final_kills":
            case "game_finalkills":
                return String.valueOf(game.getFinalKills(playerName));
            case "game_bed_breaks":
            case "game_bedbreaks":
            case "game_beds":
            case "game_beds_destroyed":
                return String.valueOf(game.getBedsDestroyed(playerName));
            case "game_blocks_placed":
            case "game_blocksplaced":
                return String.valueOf(game.getBlocksPlaced(playerName));
            case "game_diamonds":
                return String.valueOf(game.getDiamonds(playerName));
            case "game_irons":
            case "game_iron":
                return String.valueOf(game.getIrons(playerName));
            case "game_gold":
                return String.valueOf(game.getGold(playerName));
            case "game_emeralds":
            case "game_emerald":
                return String.valueOf(game.getEmeralds(playerName));
            case "game_damage_dealt":
            case "game_damagedealt":
                return String.valueOf(Math.round(game.getDamageDealt(playerName)));
            case "game_damage_taken":
            case "game_damagetaken":
                return String.valueOf(Math.round(game.getDamageTaken(playerName)));
            case "game_assists":
                return String.valueOf(game.getAssists(playerName));
            case "game_streak":
            case "game_current_streak":
            case "game_currentstreak":
                return String.valueOf(game.getCurrentStreak(playerName));
            case "game_best_streak":
            case "game_beststreak":
                return String.valueOf(game.getBestStreak(playerName));
            case "game_kdr":
            case "game_kd":
                return formatRatio(game.getKills(playerName), game.getDeaths(playerName));
            case "game_team_kills":
                return String.valueOf(sumInt(game, team, name -> game.getKills(name)));
            case "game_team_deaths":
                return String.valueOf(sumInt(game, team, name -> game.getDeaths(name)));
            case "game_team_final_kills":
            case "game_team_finalkills":
                return String.valueOf(sumInt(game, team, name -> game.getFinalKills(name)));
            case "game_team_beds":
            case "game_team_bed_breaks":
                return String.valueOf(sumInt(game, team, name -> game.getBedsDestroyed(name)));
            case "game_team_blocks_placed":
                return String.valueOf(sumInt(game, team, name -> game.getBlocksPlaced(name)));
            case "game_team_damage_dealt":
                return String.valueOf(Math.round(sumDouble(game, team, name -> game.getDamageDealt(name))));
            case "game_team_damage_taken":
                return String.valueOf(Math.round(sumDouble(game, team, name -> game.getDamageTaken(name))));
            case "game_team_assists":
                return String.valueOf(sumInt(game, team, name -> game.getAssists(name)));
            case "game_team_best_streak":
                return String.valueOf(maxInt(game, team, name -> game.getBestStreak(name)));
            default:
                return null;
        }
    }

    private List<String> teamPlayerNames(LiveGameStats game, String team) {
        if (team == null) return Collections.emptyList();
        List<String> players = new ArrayList<>();
        for (String name : game.getPlayers()) {
            if (team.equals(game.getTeam(name))) players.add(name);
        }
        Collections.sort(players);
        return players;
    }

    private int sumInt(LiveGameStats game, String team, java.util.function.ToIntFunction<String> value) {
        int total = 0;
        for (String name : teamPlayerNames(game, team)) total += value.applyAsInt(name);
        return total;
    }

    private double sumDouble(LiveGameStats game, String team, java.util.function.ToDoubleFunction<String> value) {
        double total = 0;
        for (String name : teamPlayerNames(game, team)) total += value.applyAsDouble(name);
        return total;
    }

    private int maxInt(LiveGameStats game, String team, java.util.function.ToIntFunction<String> value) {
        int max = 0;
        for (String name : teamPlayerNames(game, team)) max = Math.max(max, value.applyAsInt(name));
        return max;
    }

    private String formatDuration(int seconds) {
        if (seconds < 0) seconds = 0;
        int minutes = seconds / 60;
        int remaining = seconds % 60;
        if (minutes >= 60) {
            return (minutes / 60) + "h " + (minutes % 60) + "m";
        }
        return minutes + "m " + remaining + "s";
    }

    private String formatRatio(int numerator, int denominator) {
        if (denominator <= 0) return String.valueOf(numerator);
        return String.format("%.2f", (double) numerator / denominator);
    }

    private String getCachedUserStat(String playerName, String stat) {
        if (!isApiAvailable()) {
            return fallbackUserStat(stat);
        }

        CachedUserData cached = userDataCache.get(playerName.toLowerCase());
        
        if (cached != null && !cached.isExpired()) {
            return getUserStatValue(cached.getData(), stat);
        }
        
        
        fetchUserDataAsync(playerName);
        return fallbackUserStat(stat);
    }

    private boolean isApiAvailable() {
        WebSocketManager manager = plugin.getWebSocketManager();
        return manager != null && manager.isConnected();
    }

    private String fallbackUserStat(String stat) {
        switch (stat) {
            case "ign":
            case "discord_id":
                return "N/A";
            case "playtime_formatted":
                return "0s";
            case "banned":
            case "muted":
            case "frozen":
                return "false";
            default:
                return "0";
        }
    }
    
    private String getUserStatValue(UserData userData, String stat) {
        if (userData == null) {
            return "0";
        }
        
        switch (stat) {
            case "elo":
                return String.valueOf(userData.getElo());
            case "ign":
                return userData.getIgn() != null ? userData.getIgn() : "Unknown";
            case "discord_id":
                return userData.getDiscordId() != null ? userData.getDiscordId() : "0";
            case "banned":
                return String.valueOf(userData.isBanned());
            case "muted":
                return String.valueOf(userData.isMuted());
            case "frozen":
                return String.valueOf(userData.isFrozen());
            case "level":
                return String.valueOf(userData.getLevel());
            case "experience":
            case "exp":
            case "xp":
                return String.valueOf(userData.getExperience());
            case "peak_elo":
            case "peakelo":
                return String.valueOf(userData.getPeakElo());
            case "playtime_seconds":
                return String.valueOf(userData.getPlaytimeSeconds());
            case "playtime_minutes":
                return String.valueOf(userData.getPlaytimeSeconds() / 60);
            case "playtime_hours":
                return String.format("%.1f", userData.getPlaytimeSeconds() / 3600.0);
            case "playtime_days":
                return String.format("%.1f", userData.getPlaytimeSeconds() / 86400.0);
            case "playtime_formatted":
                return formatDuration(userData.getPlaytimeSeconds());
            case "wins":
                return String.valueOf(userData.getWins());
            case "losses":
                return String.valueOf(userData.getLosses());
            case "games":
                return String.valueOf(userData.getGames());
            case "win_rate":
                return userData.getGames() > 0
                        ? String.format("%.1f", (userData.getWins() * 100.0) / userData.getGames())
                        : "0.0";
            case "kills":
                return String.valueOf(userData.getKills());
            case "deaths":
                return String.valueOf(userData.getDeaths());
            case "kdr":
                return String.format("%.2f", userData.getKdr());
            case "wlr":
                return String.format("%.2f", userData.getWlr());
            case "winstreak":
            case "win_streak":
                return String.valueOf(userData.getWinStreak());
            case "losestreak":
            case "lose_streak":
                return String.valueOf(userData.getLoseStreak());
            case "finalKills":
            case "finalkills":
            case "final_kills":
                return String.valueOf(userData.getFinalKills());
            case "finalDeaths":
            case "finaldeaths":
            case "final_deaths":
                return String.valueOf(userData.getFinalDeaths());
            case "final_kd":
                return userData.getFinalDeaths() > 0
                        ? String.format("%.2f", (double) userData.getFinalKills() / userData.getFinalDeaths())
                        : String.valueOf(userData.getFinalKills());
            case "bedBroken":
            case "bedbroken":
            case "bed_broken":
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
            case "blocksplaced":
            case "blocks_placed":
                return String.valueOf(userData.getBlocksPlaced());
            case "damageDealt":
            case "damagedealt":
            case "damage_dealt":
                return String.valueOf(Math.round(userData.getDamageDealt()));
            case "damageTaken":
            case "damagetaken":
            case "damage_taken":
                return String.valueOf(Math.round(userData.getDamageTaken()));
            case "assists":
                return String.valueOf(userData.getAssists());
            case "bestStreak":
            case "beststreak":
            case "best_streak":
                return String.valueOf(userData.getBestStreak());
            case "firstBloods":
            case "firstbloods":
            case "first_bloods":
                return String.valueOf(userData.getFirstBloods());
            case "kills_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getKills() / userData.getGames())
                        : "0.00";
            case "deaths_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getDeaths() / userData.getGames())
                        : "0.00";
            case "final_kills_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getFinalKills() / userData.getGames())
                        : "0.00";
            case "beds_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getBedBroken() / userData.getGames())
                        : "0.00";
            case "mvps_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getMvps() / userData.getGames())
                        : "0.00";
            case "assists_per_game":
                return userData.getGames() > 0
                        ? String.format("%.2f", (double) userData.getAssists() / userData.getGames())
                        : "0.00";
            case "mvp_rate":
                return userData.getGames() > 0
                        ? String.format("%.1f", (userData.getMvps() * 100.0) / userData.getGames())
                        : "0.0";
            case "bed_break_rate":
                return userData.getGames() > 0
                        ? String.format("%.1f", (userData.getBedBroken() * 100.0) / userData.getGames())
                        : "0.0";
            case "first_blood_rate":
                return userData.getGames() > 0
                        ? String.format("%.1f", (userData.getFirstBloods() * 100.0) / userData.getGames())
                        : "0.0";
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
        String normalizedMode = normalizeMode(mode);
        if (!isValidMode(normalizedMode)) {
            return "Invalid Mode";
        }
        if (!isApiAvailable()) {
            return "N/A";
        }
        
        String cacheKey = normalizedMode + "_" + getPageFromPosition(position);
        CachedLeaderboard cached = leaderboardCache.get(cacheKey);
        
        if (cached != null && !cached.isExpired()) {
            LeaderboardEntry entry = cached.getData().get(position);
            return entry != null ? entry.getIgn() : "N/A";
        }
        
        
        fetchLeaderboardAsync(normalizedMode, getPageFromPosition(position));
        return "N/A";
    }
    
    private String getCachedLeaderboardValue(String mode, int position) {
        String normalizedMode = normalizeMode(mode);
        if (!isValidMode(normalizedMode)) {
            return "Invalid Mode";
        }
        if (!isApiAvailable()) {
            return "0";
        }
        
        String cacheKey = normalizedMode + "_" + getPageFromPosition(position);
        CachedLeaderboard cached = leaderboardCache.get(cacheKey);
        
        if (cached != null && !cached.isExpired()) {
            LeaderboardEntry entry = cached.getData().get(position);
            if (entry != null) {
                if (normalizedMode.equals("kdr") || normalizedMode.equals("wlr")) {
                    return String.format("%.2f", entry.getValue());
                } else {
                    return String.valueOf((int) entry.getValue());
                }
            }
            return "0";
        }
        
        
        fetchLeaderboardAsync(normalizedMode, getPageFromPosition(position));
        return "0";
    }

    private boolean isValidMode(String mode) {
        return VALID_MODES.contains(mode) || MODE_ALIASES.containsKey(mode);
    }

    private String normalizeMode(String mode) {
        return MODE_ALIASES.getOrDefault(mode, mode);
    }
    
    private int getPageFromPosition(int position) {
        return ((position - 1) / 10) + 1;
    }
    
    private void fetchUserDataAsync(String playerName) {
        String cacheKey = playerName.toLowerCase();
        if (!pendingUserFetches.add(cacheKey)) {
            return;
        }
        CompletableFuture<UserData> future = apiClient.getUserData(playerName);
        future.thenAccept(userData -> {
            pendingUserFetches.remove(cacheKey);
            if (userData != null) {
                userDataCache.put(cacheKey, new CachedUserData(userData));
                plugin.debug("Cached user data for " + playerName);
            }
        }).exceptionally(throwable -> {
            pendingUserFetches.remove(cacheKey);
            plugin.getLogger().warning("Failed to fetch user data for " + playerName + ": " + throwable.getMessage());
            return null;
        });
    }
    
    private void fetchLeaderboardAsync(String mode, int page) {
        String cacheKey = mode + "_" + page;
        if (!pendingLeaderboardFetches.add(cacheKey)) {
            return;
        }
        CompletableFuture<Map<Integer, LeaderboardEntry>> future = apiClient.getLeaderboard(mode, page);
        future.thenAccept(leaderboard -> {
            pendingLeaderboardFetches.remove(cacheKey);
            if (leaderboard != null && !leaderboard.isEmpty()) {
                leaderboardCache.put(cacheKey, new CachedLeaderboard(leaderboard));
                plugin.debug("Cached leaderboard data for " + mode + " page " + page);
            }
        }).exceptionally(throwable -> {
            pendingLeaderboardFetches.remove(cacheKey);
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
