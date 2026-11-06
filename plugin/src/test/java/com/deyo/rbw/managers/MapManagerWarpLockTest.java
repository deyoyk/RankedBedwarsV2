package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.bedwars.BedwarsAPI;
import com.deyo.rbw.bedwars.BedwarsAPIManager;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression tests for failed-warp map release. A wedged lock used to make
 * every bot retry fail with "map already locked".
 */
public class MapManagerWarpLockTest {

    private RankedBedwars plugin;
    private MapManager manager;
    private BukkitScheduler scheduler;
    private MockedStatic<Bukkit> bukkit;
    private WebSocketManager wsManager;
    private final AtomicReference<Runnable> lastAsyncTask = new AtomicReference<>();

    @BeforeEach
    public void setUp() throws Exception {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("MapLock-Test"));

        wsManager = mock(WebSocketManager.class);
        when(plugin.getWebSocketManager()).thenReturn(wsManager);

        scheduler = mock(BukkitScheduler.class);
        when(scheduler.runTaskAsynchronously(any(), any(Runnable.class))).thenAnswer(inv -> {
            lastAsyncTask.set(inv.getArgument(1));
            return mock(BukkitTask.class);
        });
        when(scheduler.runTaskLaterAsynchronously(any(), any(Runnable.class), anyLong()))
                .thenReturn(mock(BukkitTask.class));

        bukkit = mockStatic(Bukkit.class);
        bukkit.when(Bukkit::getScheduler).thenReturn(scheduler);

        manager = new MapManager(plugin);
        putStringMap("physicalArenaToGroupMap", "arena", "group");
        putGroup("arenaGroups", "group");
    }

    @AfterEach
    public void tearDown() {
        bukkit.close();
    }

    @SuppressWarnings("unchecked")
    private void putStringMap(String fieldName, String key, String value) throws Exception {
        Field field = MapManager.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        ((Map<String, String>) field.get(manager)).put(key, value);
    }

    @SuppressWarnings("unchecked")
    private void putGroup(String fieldName, String key) throws Exception {
        Field field = MapManager.class.getDeclaredField(fieldName);
        field.setAccessible(true);
        ((Map<String, MapManager.ArenaGroup>) field.get(manager)).put(key, mock(MapManager.ArenaGroup.class));
    }

    @SuppressWarnings("unchecked")
    private void putPendingWarp(String key, long timestamp) throws Exception {
        Field field = MapManager.class.getDeclaredField("pendingWarpLocks");
        field.setAccessible(true);
        ((Map<String, Long>) field.get(manager)).put(key, timestamp);
    }

    @SuppressWarnings("unchecked")
    private void putGameMapping(String gameId, String arena) throws Exception {
        putStringMap("gameIdToPhysicalArenaMap", gameId, arena);
        putStringMap("physicalArenaToGameIdMap", arena, gameId);
    }

    @Test
    public void warpRegistersArenaToGameMappingForScoring() throws Exception {
        BedwarsAPI implementation = mock(BedwarsAPI.class);
        try (org.mockito.MockedStatic<BedwarsAPIManager> api = mockStatic(BedwarsAPIManager.class)) {
            api.when(BedwarsAPIManager::isAvailable).thenReturn(true);
            api.when(BedwarsAPIManager::getImplementation).thenReturn(implementation);

            manager.warpPlayersToGame("123", "arena", new JsonObject(), new JsonObject(), true);
        }

        assertEquals("123", manager.getGameIdForArena("arena"));
    }

    @Test
    public void failedWarpReleasesMapAndGameMapping() throws Exception {
        manager.lockMap("arena");
        putGameMapping("123", "arena");
        putPendingWarp("arena", System.currentTimeMillis());

        assertTrue(manager.isMapLocked("arena"));
        manager.sendWarpFailureUnknown("123");

        assertFalse(manager.isMapLocked("arena"));
        assertNull(manager.getGameIdForArena("arena"));
    }

    @Test
    public void failingAWarpForAnotherGameDoesNotStealTheLock() throws Exception {
        manager.lockMap("arena");
        putGameMapping("other-game", "arena");
        putPendingWarp("arena", System.currentTimeMillis());

        manager.clearWarpFailureState("unrelated-game");

        assertTrue(manager.isMapLocked("arena"));
    }

    @Test
    public void activeGamesAreReAnnouncedAfterReconnect() throws Exception {
        manager.lockMap("arena");
        putGameMapping("123", "arena");

        manager.sendActiveGameStates();
        Runnable task = lastAsyncTask.getAndSet(null);
        org.junit.jupiter.api.Assertions.assertNotNull(task);
        task.run();

        verify(wsManager).sendMessage(contains("\"warp_success\""));
        verify(wsManager).sendMessage(contains("\"123\""));
    }

    @Test
    public void releaseGameUnlocksMapAndClearsMapping() throws Exception {
        manager.lockMap("arena");
        putGameMapping("123", "arena");
        putPendingWarp("arena", System.currentTimeMillis());

        manager.releaseGame("arena");

        assertFalse(manager.isMapLocked("arena"));
        assertNull(manager.getGameIdForArena("arena"));
    }

    @Test
    public void stalePendingWarpLockExpires() throws Exception {
        manager.lockMap("arena");
        putStringMap("gameIdToPhysicalArenaMap", "999", "arena");
        putStringMap("physicalArenaToGameIdMap", "arena", "999");
        putPendingWarp("arena", System.currentTimeMillis() - 16 * 60 * 1000L);

        assertFalse(manager.isMapLocked("arena"));

        Field lockedField = MapManager.class.getDeclaredField("lockedArenaGroups");
        lockedField.setAccessible(true);
        Set<String> locked = (Set<String>) lockedField.get(manager);
        assertFalse(locked.contains("group"));
    }
}
