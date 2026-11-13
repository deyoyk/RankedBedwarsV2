package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.bedwars.BedwarsAPI;
import com.deyo.rbw.bedwars.BedwarsAPIManager;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class HostPrivateGameTest {

    private RankedBedwars plugin;
    private MapManager mapManager;
    private WebSocketManager wsManager;
    private GameDataManager dataManager;
    private BedwarsAPI implementation;
    private final List<String> sentMessages = new ArrayList<>();
    private MockedStatic<Bukkit> bukkit;
    private MockedStatic<BedwarsAPIManager> api;

    @BeforeEach
    public void setUp() throws Exception {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("Host-Private-Test"));
        wsManager = mock(WebSocketManager.class);
        dataManager = mock(GameDataManager.class);
        mapManager = new MapManager(plugin);
        when(plugin.getWebSocketManager()).thenReturn(wsManager);
        when(plugin.getGameDataManager()).thenReturn(dataManager);
        when(plugin.getMapManager()).thenReturn(mapManager);

        Server server = mock(Server.class);
        BukkitScheduler scheduler = mock(BukkitScheduler.class);
        when(scheduler.runTask(any(), any(Runnable.class))).thenAnswer(inv -> {
            inv.getArgument(1, Runnable.class).run();
            return mock(BukkitTask.class);
        });
        when(scheduler.runTaskAsynchronously(any(), any(Runnable.class))).thenAnswer(inv -> {
            inv.getArgument(1, Runnable.class).run();
            return mock(BukkitTask.class);
        });
        when(scheduler.runTaskLaterAsynchronously(any(), any(Runnable.class), anyLong()))
                .thenReturn(mock(BukkitTask.class));

        bukkit = mockStatic(Bukkit.class);
        bukkit.when(Bukkit::getScheduler).thenReturn(scheduler);
        bukkit.when(Bukkit::getOnlinePlayers).thenReturn(java.util.Collections.emptyList());
        bukkit.when(Bukkit::isPrimaryThread).thenReturn(true);
        bukkit.when(() -> Bukkit.getPlayerExact(any())).thenAnswer(inv -> {
            String ign = inv.getArgument(0);
            if (ign == null) return null;
            Player player = mock(Player.class);
            when(player.getName()).thenReturn(ign);
            when(player.isOnline()).thenReturn(true);
            return player;
        });

        implementation = mock(BedwarsAPI.class);
        api = mockStatic(BedwarsAPIManager.class);
        api.when(BedwarsAPIManager::isAvailable).thenReturn(true);
        api.when(BedwarsAPIManager::getImplementation).thenReturn(implementation);

        mapManager.addMap("rbwtest", "Test", 8, Arrays.asList("red", "blue"));
    }

    @AfterEach
    public void tearDown() {
        bukkit.close();
        api.close();
    }

    private WebSocketManager newCapturingManager() {
        return new WebSocketManager(plugin) {
            @Override
            public void sendMessage(String message) {
                sentMessages.add(message);
            }
        };
    }

    private void handleHost(WebSocketManager manager, JsonObject request) throws Exception {
        Method method = WebSocketManager.class.getDeclaredMethod("handleHostPrivateGameAsync", JsonObject.class);
        method.setAccessible(true);
        method.invoke(manager, request);
    }

    private JsonObject flatRequest(String requestId, String map, String... players) {
        JsonObject json = new JsonObject();
        json.addProperty("type", "host_private_game");
        json.addProperty("request_id", requestId);
        json.addProperty("map", map);
        JsonArray array = new JsonArray();
        for (String player : players) {
            array.add(player);
        }
        json.add("players", array);
        return json;
    }

    private JsonObject lastSentResult() {
        assertFalse(sentMessages.isEmpty());
        return com.google.gson.JsonParser.parseString(sentMessages.get(sentMessages.size() - 1)).getAsJsonObject();
    }

    @Test
    public void splitsFlatPartyIntoTwoTeamsAndWarps() throws Exception {
        handleHost(newCapturingManager(), flatRequest("pg_1", "random", "A", "B", "C", "D"));

        ArgumentCaptor<String> gameId = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> team1 = ArgumentCaptor.forClass(Object.class);
        ArgumentCaptor<Object> team2 = ArgumentCaptor.forClass(Object.class);
        verify(implementation).warpPlayersToGame(gameId.capture(), eq("rbwtest"), team1.capture(), team2.capture(), eq(false));

        assertEquals("pg_1", gameId.getValue());
        JsonObject t1 = (JsonObject) team1.getValue();
        JsonObject t2 = (JsonObject) team2.getValue();
        assertEquals(2, t1.getAsJsonArray("players").size());
        assertEquals(2, t2.getAsJsonArray("players").size());
    }

    @Test
    public void warpSuccessAnswersTheBotRequest() throws Exception {
        handleHost(newCapturingManager(), flatRequest("pg_2", "random", "A", "B"));

        mapManager.sendWarpSuccess("pg_2");

        JsonObject json = lastSentResult();
        assertEquals("host_private_game_result", json.get("type").getAsString());
        assertEquals("pg_2", json.get("request_id").getAsString());
        assertTrue(json.get("ok").getAsBoolean());
        assertEquals("rbwtest", json.get("map").getAsString());
        assertEquals(2, json.getAsJsonArray("players").size());
    }

    @Test
    public void unknownMapFailsTheRequest() throws Exception {
        handleHost(newCapturingManager(), flatRequest("pg_3", "missing-map", "A", "B"));

        JsonObject json = lastSentResult();
        assertEquals("host_private_game_result", json.get("type").getAsString());
        assertFalse(json.get("ok").getAsBoolean());
        assertTrue(json.get("message").getAsString().contains("not available"));
        verify(implementation, never()).warpPlayersToGame(anyString(), anyString(), any(), any(), anyBoolean());
    }

    @Test
    public void partyOfOneIsRejected() throws Exception {
        handleHost(newCapturingManager(), flatRequest("pg_4", "random", "A"));

        JsonObject json = lastSentResult();
        assertTrue(json.get("message").getAsString().contains("at least 2"));
        verify(implementation, never()).warpPlayersToGame(anyString(), anyString(), any(), any(), anyBoolean());
    }

    @Test
    public void lockedGroupIsNotPickedForRandom() throws Exception {
        mapManager.lockMap("rbwtest");

        handleHost(newCapturingManager(), flatRequest("pg_5", "random", "A", "B"));

        JsonObject json = lastSentResult();
        assertFalse(json.get("ok").getAsBoolean());
        assertTrue(json.get("message").getAsString().contains("No arena"));
        verify(implementation, never()).warpPlayersToGame(anyString(), anyString(), any(), any(), anyBoolean());
    }

    @Test
    public void warpFailureReleasesTheMapAndFailsTheRequest() throws Exception {
        WebSocketManager manager = newCapturingManager();
        when(plugin.getWebSocketManager()).thenReturn(manager);
        handleHost(manager, flatRequest("pg_6", "random", "A", "B"));

        sentMessages.clear();
        mapManager.sendWarpFailedArenaNotFound("pg_6", "rbwtest");

        JsonObject json = lastSentResult();
        assertEquals("host_private_game_result", json.get("type").getAsString());
        assertFalse(json.get("ok").getAsBoolean());
        assertFalse(mapManager.isMapLocked("rbwtest"));
    }

    @Test
    public void privateGamesAreMarkedSoTheyAreNotScored() throws Exception {
        handleHost(newCapturingManager(), flatRequest("pg_7", "random", "A", "B"));

        assertTrue(mapManager.isPrivateWarp("pg_7"));
        verify(implementation).warpPlayersToGame(eq("pg_7"), eq("rbwtest"), any(), any(), eq(false));
    }
}
