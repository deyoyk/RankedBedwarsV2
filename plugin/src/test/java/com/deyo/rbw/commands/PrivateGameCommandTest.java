package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.managers.WebSocketManager;
import com.google.gson.JsonObject;
import org.bukkit.Server;
import org.bukkit.command.Command;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class PrivateGameCommandTest {
    private RankedBedwars plugin;
    private WebSocketManager wsManager;
    private Player player;
    private PrivateCmd command;

    @BeforeEach
    public void setUp() {
        plugin = mock(RankedBedwars.class);
        wsManager = mock(WebSocketManager.class);
        player = mock(Player.class);
        Server server = mock(Server.class);
        BukkitScheduler scheduler = mock(BukkitScheduler.class);

        when(plugin.getServer()).thenReturn(server);
        when(server.getScheduler()).thenReturn(scheduler);
        when(scheduler.runTaskTimerAsynchronously(eq(plugin), any(Runnable.class), anyLong(), anyLong()))
                .thenReturn(mock(BukkitTask.class));
        when(plugin.getWebSocketManager()).thenReturn(wsManager);
        when(wsManager.isConnected()).thenReturn(true);
        when(player.getName()).thenReturn("Steve");
        when(player.getUniqueId()).thenReturn(UUID.randomUUID());
        when(player.hasPermission("rankedbedwars.private")).thenReturn(true);
        when(player.isOnline()).thenReturn(true);

        command = new PrivateCmd(plugin);
    }

    @Test
    public void payloadContainsMapWhenProvided() {
        JsonObject json = PrivateCmd.buildPayload("Steve", "req-1", " Quad ");

        assertEquals("privatefromingame", json.get("type").getAsString());
        assertEquals("Steve", json.get("ign").getAsString());
        assertEquals("req-1", json.get("uuid").getAsString());
        assertEquals("Quad", json.get("map").getAsString());
    }

    @Test
    public void payloadOmitsBlankMap() {
        JsonObject json = PrivateCmd.buildPayload("Steve", "req-1", "  ");

        assertFalse(json.has("map"));
    }

    @Test
    public void sendsPrivateGameRequestWithMap() {
        PrivateCmd local = new PrivateCmd(plugin);

        assertTrue(local.onCommand(player, mock(Command.class), "private", new String[]{"Quad"}));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(wsManager).sendMessage(payload.capture());
        assertTrue(payload.getValue().contains("\"type\":\"privatefromingame\""));
        assertTrue(payload.getValue().contains("\"map\":\"Quad\""));
        verify(player).sendMessage(org.mockito.ArgumentMatchers.contains("Private game request sent"));
    }

    @Test
    public void clearsPendingStateWhenWebSocketSendFails() {
        PrivateCmd local = new PrivateCmd(plugin);
        doThrow(new RuntimeException("socket down")).when(wsManager).sendMessage(anyString());
        when(plugin.getLogger()).thenReturn(java.util.logging.Logger.getLogger("Private-Cmd-Test"));

        assertTrue(local.onCommand(player, mock(Command.class), "private", new String[]{}));
        verify(player).sendMessage(org.mockito.ArgumentMatchers.contains("Failed to send private game request"));

        local.onCommand(player, mock(Command.class), "private", new String[]{});
        verify(player).sendMessage(org.mockito.ArgumentMatchers.contains("Please wait"));
        verify(player, org.mockito.Mockito.never())
                .sendMessage(org.mockito.ArgumentMatchers.contains("already have a pending private game request"));
    }
}
