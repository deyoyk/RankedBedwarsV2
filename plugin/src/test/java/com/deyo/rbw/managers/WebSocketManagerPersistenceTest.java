package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.util.Collections;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A game ending while the bot is disconnected must still persist a pending
 * payload; otherwise the result is lost forever.
 */
public class WebSocketManagerPersistenceTest {

    private RankedBedwars plugin;
    private GameDataManager dataManager;
    private BukkitScheduler scheduler;
    private MockedStatic<Bukkit> bukkit;
    private final AtomicReference<Runnable> asyncTask = new AtomicReference<>();

    @BeforeEach
    public void setUp() {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("WS-Persistence-Test"));
        when(plugin.isEnabled()).thenReturn(false);

        dataManager = mock(GameDataManager.class);
        when(plugin.getGameDataManager()).thenReturn(dataManager);
        when(plugin.getMapManager()).thenReturn(null);

        scheduler = mock(BukkitScheduler.class);
        when(scheduler.runTask(any(), any(Runnable.class))).thenAnswer(inv -> {
            inv.getArgument(1, Runnable.class).run();
            return mock(BukkitTask.class);
        });
        when(scheduler.runTaskAsynchronously(any(), any(Runnable.class))).thenAnswer(inv -> {
            asyncTask.set(inv.getArgument(1));
            return mock(BukkitTask.class);
        });
        when(scheduler.runTaskLaterAsynchronously(any(), any(Runnable.class), anyLong()))
                .thenReturn(mock(BukkitTask.class));

        bukkit = mockStatic(Bukkit.class);
        bukkit.when(Bukkit::getScheduler).thenReturn(scheduler);
        bukkit.when(Bukkit::getOnlinePlayers).thenReturn(Collections.emptyList());
    }

    @AfterEach
    public void tearDown() {
        bukkit.close();
        asyncTask.set(null);
    }

    private Game game() {
        return new Game(
                "77",
                "Aquarius",
                true,
                Collections.singletonList("A"),
                Collections.singletonList("B"),
                Collections.emptyList(),
                Collections.emptyList(),
                System.currentTimeMillis() - 600000,
                600,
                "01/01/2026");
    }

    private void runAsyncTask() {
        Runnable task = asyncTask.getAndSet(null);
        org.junit.jupiter.api.Assertions.assertNotNull(task);
        task.run();
    }

    @Test
    public void scoringPayloadIsPersistedWhileDisconnected() {
        WebSocketManager manager = new WebSocketManager(plugin);

        manager.sendGameScoring(game());
        runAsyncTask();

        verify(dataManager).savePendingScoringPayload(eq("77"), any(JsonObject.class));
    }

    @Test
    public void voidingPayloadIsPersistedWhileDisconnected() {
        WebSocketManager manager = new WebSocketManager(plugin);

        manager.sendGameVoiding("77", "player left");
        runAsyncTask();

        verify(dataManager).savePendingVoidingPayload(eq("77"), any(JsonObject.class));
    }
}
