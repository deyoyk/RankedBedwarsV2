package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression tests for main-thread safety: console commands received over the
 * WebSocket must be dispatched on the Bukkit main thread, never directly from
 * the WebSocket callback thread.
 */
public class WebSocketManagerThreadingTest {

    private RankedBedwars plugin;
    private WebSocketManager manager;
    private BukkitScheduler scheduler;
    private ConsoleCommandSender console;
    private MockedStatic<Bukkit> bukkit;
    private final AtomicReference<Runnable> capturedTask = new AtomicReference<>();

    @BeforeEach
    public void setUp() {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("RBW-Test"));

        Server server = mock(Server.class);
        when(plugin.getServer()).thenReturn(server);

        scheduler = mock(BukkitScheduler.class);
        when(server.getScheduler()).thenReturn(scheduler);

        console = mock(ConsoleCommandSender.class);

        bukkit = mockStatic(Bukkit.class);
        bukkit.when(Bukkit::isPrimaryThread).thenReturn(false);
        bukkit.when(Bukkit::getScheduler).thenReturn(scheduler);
        bukkit.when(Bukkit::getConsoleSender).thenReturn(console);

        when(scheduler.runTask(any(), any(Runnable.class))).thenAnswer(inv -> {
            capturedTask.set(inv.getArgument(1));
            return mock(BukkitTask.class);
        });

        manager = new WebSocketManager(plugin);
    }

    @AfterEach
    public void tearDown() {
        bukkit.close();
    }

    private void runCapturedTask() {
        Runnable task = capturedTask.get();
        org.junit.jupiter.api.Assertions.assertNotNull(task, "command was not scheduled on the main thread");
        task.run();
    }

    @Test
    public void botBanIsDispatchedOnMainThread() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "Steve");
        msg.addProperty("reason", "Cheating");
        msg.addProperty("duration", 7);

        manager.handleBotBan(msg);

        verify(scheduler).runTask(any(), any(Runnable.class));
        runCapturedTask();
        bukkit.verify(() -> Bukkit.dispatchCommand(console, "ban Steve 7 Cheating"));
    }

    @Test
    public void botBanWithoutDurationIsPermanent() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "Steve");
        msg.addProperty("reason", "Cheating");

        manager.handleBotBan(msg);

        runCapturedTask();
        bukkit.verify(() -> Bukkit.dispatchCommand(console, "ban Steve Cheating"));
    }

    @Test
    public void botMuteIsDispatchedOnMainThread() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "Steve");
        msg.addProperty("reason", "Spam");
        msg.addProperty("duration", 120);

        manager.handleBotMute(msg);

        runCapturedTask();
        bukkit.verify(() -> Bukkit.dispatchCommand(console, "mute Steve 120 Spam"));
    }

    @Test
    public void botUnbanIsDispatchedOnMainThread() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "Steve");
        msg.addProperty("reason", "Appeal");

        manager.handleBotUnban(msg);

        runCapturedTask();
        bukkit.verify(() -> Bukkit.dispatchCommand(console, "unban Steve Appeal"));
    }

    @Test
    public void botUnmuteIsDispatchedOnMainThread() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "Steve");
        msg.addProperty("reason", "Done");

        manager.handleBotUnmute(msg);

        runCapturedTask();
        bukkit.verify(() -> Bukkit.dispatchCommand(console, "unmute Steve Done"));
    }

    @Test
    public void invalidIgnIsRejectedWithoutDispatchingAnything() {
        JsonObject msg = new JsonObject();
        msg.addProperty("ign", "not valid ign with spaces!");
        msg.addProperty("reason", "Cheating");

        manager.handleBotBan(msg);

        verify(scheduler, never()).runTask(any(), any(Runnable.class));
        bukkit.verify(() -> Bukkit.dispatchCommand(any(), any()), never());
    }
}
