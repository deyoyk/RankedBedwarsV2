package com.deyo.rbw.placeholders;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.managers.WebSocketManager;
import com.deyo.rbw.models.LeaderboardEntry;
import com.deyo.rbw.models.LiveGameStats;
import com.deyo.rbw.models.UserData;
import com.google.gson.Gson;
import org.bukkit.OfflinePlayer;
import org.bukkit.Server;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class PlaceholderExpansionTest {
    private RankedBedwars plugin;
    private RankedBedwarsExpansion expansion;

    @BeforeEach
    public void setUp() {
        plugin = mock(RankedBedwars.class);
        Server server = mock(Server.class);
        BukkitScheduler scheduler = mock(BukkitScheduler.class);
        FileConfiguration config = mock(FileConfiguration.class);

        when(plugin.getServer()).thenReturn(server);
        when(server.getScheduler()).thenReturn(scheduler);
        when(scheduler.runTaskTimerAsynchronously(any(), any(Runnable.class), anyLong(), anyLong()))
                .thenReturn(mock(BukkitTask.class));
        when(plugin.getConfig()).thenReturn(config);
        when(plugin.getGson()).thenReturn(new Gson());
        when(plugin.getLogger()).thenReturn(Logger.getLogger("Placeholder-Test"));
        when(plugin.getDescription()).thenReturn(mock(org.bukkit.plugin.PluginDescriptionFile.class));

        expansion = new RankedBedwarsExpansion(plugin);
    }

    private String userStat(UserData user, String stat) throws Exception {
        Method method = RankedBedwarsExpansion.class.getDeclaredMethod(
                "getUserStatValue", UserData.class, String.class);
        method.setAccessible(true);
        return (String) method.invoke(expansion, user, stat);
    }

    @SuppressWarnings("unchecked")
    private void cacheLeaderboard(String key, Map<Integer, LeaderboardEntry> data) throws Exception {
        Field field = RankedBedwarsExpansion.class.getDeclaredField("leaderboardCache");
        field.setAccessible(true);
        Map<String, Object> cache = (Map<String, Object>) field.get(expansion);
        Class<?> cachedType = Class.forName(
                "com.deyo.rbw.placeholders.RankedBedwarsExpansion$CachedLeaderboard");
        Constructor<?> constructor = cachedType.getDeclaredConstructor(Map.class);
        constructor.setAccessible(true);
        cache.put(key, constructor.newInstance(data));
    }

    @Test
    public void exposesNewGeneralPlayerStats() throws Exception {
        UserData user = new UserData();
        user.setLevel(12);
        user.setExperience(3456);
        user.setPeakElo(1777);
        user.setPlaytimeSeconds(3661);
        user.setWins(10);
        user.setGames(20);
        user.setFinalKills(30);
        user.setFinalDeaths(10);

        assertEquals("12", userStat(user, "level"));
        assertEquals("3456", userStat(user, "experience"));
        assertEquals("1777", userStat(user, "peak_elo"));
        assertEquals("1h 1m", userStat(user, "playtime_formatted"));
        assertEquals("50.0", userStat(user, "win_rate"));
        assertEquals("3.00", userStat(user, "final_kd"));
    }

    @Test
    public void exposesPerGameDerivedStats() throws Exception {
        UserData user = new UserData();
        user.setGames(10);
        user.setKills(25);
        user.setDeaths(20);
        user.setFinalKills(15);
        user.setBedBroken(5);
        user.setMvps(2);
        user.setAssists(8);
        user.setFirstBloods(1);
        user.setPlaytimeSeconds(86400);

        assertEquals("2.50", userStat(user, "kills_per_game"));
        assertEquals("2.00", userStat(user, "deaths_per_game"));
        assertEquals("1.50", userStat(user, "final_kills_per_game"));
        assertEquals("0.50", userStat(user, "beds_per_game"));
        assertEquals("0.20", userStat(user, "mvps_per_game"));
        assertEquals("0.80", userStat(user, "assists_per_game"));
        assertEquals("20.0", userStat(user, "mvp_rate"));
        assertEquals("50.0", userStat(user, "bed_break_rate"));
        assertEquals("10.0", userStat(user, "first_blood_rate"));
        assertEquals("1.0", userStat(user, "playtime_days"));
    }

    @Test
    public void exposesLiveGameStatsForScoreboardUse() {
        OfflinePlayer offline = mock(OfflinePlayer.class);
        Player online = mock(Player.class);
        LiveGameStats game = mock(LiveGameStats.class);

        when(offline.getName()).thenReturn("Steve");
        when(offline.getPlayer()).thenReturn(online);
        when(online.getName()).thenReturn("Steve");
        when(plugin.getLiveGameStats(online)).thenReturn(game);

        when(game.getGameId()).thenReturn("42");
        when(game.getMap()).thenReturn("Aquarius");
        when(game.getArenaName()).thenReturn("Aquarius-1");
        when(game.isRanked()).thenReturn(true);
        when(game.getDuration()).thenReturn(125);
        when(game.getTeam("Steve")).thenReturn("Red");
        when(game.getPlayers()).thenReturn(Set.of("Steve", "Alex"));
        when(game.getTeam("Alex")).thenReturn("Red");
        when(game.getKills("Steve")).thenReturn(2);
        when(game.getKills("Alex")).thenReturn(3);
        when(game.getDeaths("Steve")).thenReturn(1);
        when(game.getDeaths("Alex")).thenReturn(2);
        when(game.getFirstBlood()).thenReturn("Steve");

        assertEquals("42", expansion.onRequest(offline, "game_id"));
        assertEquals("Aquarius", expansion.onRequest(offline, "game_map"));
        assertEquals("Red", expansion.onRequest(offline, "game_team"));
        assertEquals("2m 5s", expansion.onRequest(offline, "game_duration_formatted"));
        assertEquals("2", expansion.onRequest(offline, "game_kills"));
        assertEquals("5", expansion.onRequest(offline, "game_team_kills"));
        assertEquals("3", expansion.onRequest(offline, "game_team_deaths"));
        assertEquals("Steve", expansion.onRequest(offline, "game_first_blood"));
        assertEquals("2m 5s", expansion.onRequest(offline, "ingame_duration_formatted"));
    }

    @Test
    public void returnsSafeDefaultsOutsideAGame() {
        OfflinePlayer offline = mock(OfflinePlayer.class);
        when(offline.getName()).thenReturn("Steve");
        when(offline.getPlayer()).thenReturn(null);

        assertEquals("0", expansion.onRequest(offline, "game_kills"));
        assertEquals("N/A", expansion.onRequest(offline, "game_map"));
    }

    @Test
    public void normalizesLeaderboardModeAliases() throws Exception {
        Method normalize = RankedBedwarsExpansion.class.getDeclaredMethod("normalizeMode", String.class);
        normalize.setAccessible(true);

        assertEquals("winStreak", normalize.invoke(expansion, "win_streak"));
        assertEquals("finalKills", normalize.invoke(expansion, "final_kills"));
        assertEquals("finalDeaths", normalize.invoke(expansion, "fd"));
        assertEquals("bedBroken", normalize.invoke(expansion, "bb"));
        assertEquals("playtimeSeconds", normalize.invoke(expansion, "playtime"));
        assertEquals("damageDealt", normalize.invoke(expansion, "damage_dealt"));
    }

    @Test
    public void globalLeaderboardPlaceholdersDoNotRequireAPlayer() {
        WebSocketManager manager = mock(WebSocketManager.class);
        when(manager.isConnected()).thenReturn(false);
        when(plugin.getWebSocketManager()).thenReturn(manager);

        assertEquals("0", expansion.onRequest(null, "top_wins_1_value"));
        assertEquals("N/A", expansion.onRequest(null, "top_wins_1"));
        assertEquals("0", expansion.onRequest(null, "top_elo_1_value"));
    }

    @Test
    public void cachedLeaderboardPlaceholdersResolveWithoutAPlayer() throws Exception {
        WebSocketManager manager = mock(WebSocketManager.class);
        when(manager.isConnected()).thenReturn(true);
        when(plugin.getWebSocketManager()).thenReturn(manager);
        cacheLeaderboard("wins_1", Map.of(1, new LeaderboardEntry("Steve", 42)));
        cacheLeaderboard("kdr_1", Map.of(1, new LeaderboardEntry("Alex", 1.75)));

        assertEquals("42", expansion.onRequest(null, "top_wins_1_value"));
        assertEquals("Steve", expansion.onRequest(null, "top_wins_1"));
        assertEquals("1.75", expansion.onRequest(null, "top_kdr_1_value"));
    }

    @Test
    public void playerPlaceholdersUseFallbacksWhenApiIsDisconnected() {
        OfflinePlayer offline = mock(OfflinePlayer.class);
        when(offline.getName()).thenReturn("Steve");

        WebSocketManager manager = mock(WebSocketManager.class);
        when(manager.isConnected()).thenReturn(false);
        when(plugin.getWebSocketManager()).thenReturn(manager);

        assertEquals("0", expansion.onRequest(offline, "wins"));
        assertEquals("0", expansion.onRequest(offline, "elo"));
        assertEquals("N/A", expansion.onRequest(offline, "ign"));
        assertEquals("false", expansion.onRequest(offline, "banned"));
    }

    @Test
    public void playerPlaceholdersUseFallbacksWhenApiManagerIsMissing() {
        OfflinePlayer offline = mock(OfflinePlayer.class);
        when(offline.getName()).thenReturn("Steve");
        when(plugin.getWebSocketManager()).thenReturn(null);

        assertEquals("0", expansion.onRequest(offline, "wins"));
        assertEquals("0", expansion.onRequest(null, "top_wins_1_value"));
        assertEquals("N/A", expansion.onRequest(null, "top_wins_1"));
    }
}
