package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.managers.WebSocketManager;
import com.google.gson.JsonArray;
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
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class PartyCommandTest {
    private RankedBedwars plugin;
    private WebSocketManager wsManager;
    private Player player;
    private PartyCmd command;

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
        when(scheduler.runTask(any(), any(Runnable.class))).thenAnswer(inv -> {
            inv.getArgument(1, Runnable.class).run();
            return mock(BukkitTask.class);
        });
        when(plugin.getWebSocketManager()).thenReturn(wsManager);
        when(wsManager.isConnected()).thenReturn(true);
        when(player.getName()).thenReturn("Steve");
        when(player.getUniqueId()).thenReturn(UUID.randomUUID());
        when(player.hasPermission("rankedbedwars.party")).thenReturn(true);
        when(player.isOnline()).thenReturn(true);

        command = new PartyCmd(plugin);
    }

    private JsonObject result(boolean ok, String message) {
        JsonObject json = new JsonObject();
        json.addProperty("type", "party_result");
        json.addProperty("request_id", "req");
        json.addProperty("ign", "Steve");
        json.addProperty("action", "list");
        json.addProperty("ok", ok);
        json.addProperty("message", message);
        return json;
    }

    @Test
    public void sendsPartyCommandWithActionAndTarget() {
        assertTrue(command.onCommand(player, mock(Command.class), "party", new String[]{"invite", "Alex"}));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(wsManager).sendMessage(payload.capture());
        JsonObject json = com.google.gson.JsonParser.parseString(payload.getValue()).getAsJsonObject();
        assertEquals("party_command", json.get("type").getAsString());
        assertEquals("invite", json.get("action").getAsString());
        assertEquals("Alex", json.get("target").getAsString());
        assertFalse(json.has("map"));
    }

    @Test
    public void sendsQueueMapWithRestOfArguments() {
        assertTrue(command.onCommand(player, mock(Command.class), "party", new String[]{"queue", "Katsu", "4v4"}));

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(wsManager).sendMessage(payload.capture());
        JsonObject json = com.google.gson.JsonParser.parseString(payload.getValue()).getAsJsonObject();
        assertEquals("queue", json.get("action").getAsString());
        assertEquals("Katsu 4v4", json.get("map").getAsString());
    }

    @Test
    public void rejectsUnknownActionAndMissingTargets() {
        assertTrue(command.onCommand(player, mock(Command.class), "party", new String[]{"nuke"}));
        verify(wsManager, never()).sendMessage(any(String.class));

        assertTrue(command.onCommand(player, mock(Command.class), "party", new String[]{"invite"}));
        verify(player).sendMessage(contains("Usage: /party invite"));
    }

    @Test
    public void rendersPartyViewFromResult() {
        command.onCommand(player, mock(Command.class), "party", new String[]{"list"});
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(wsManager).sendMessage(payload.capture());
        String requestId = com.google.gson.JsonParser.parseString(payload.getValue()).getAsJsonObject()
                .get("request_id").getAsString();

        JsonObject party = new JsonObject();
        party.addProperty("party_id", "p1");
        party.addProperty("leader", "Alex");
        JsonArray members = new JsonArray();
        members.add("Steve");
        members.add("Bob");
        party.add("members", members);
        party.addProperty("open", false);
        party.addProperty("private_games", true);
        party.addProperty("max", 8);

        JsonObject json = result(true, "");
        json.addProperty("request_id", requestId);
        json.add("party", party);

        command.handlePartyResult(json);

        verify(player).sendMessage(contains("Alex"));
        verify(player).sendMessage(contains("Steve, Bob"));
        verify(player).sendMessage(contains("Private games: on"));
    }

    @Test
    public void showsErrorMessagesFromBot() {
        command.onCommand(player, mock(Command.class), "party", new String[]{"leave"});
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(wsManager).sendMessage(payload.capture());
        String requestId = com.google.gson.JsonParser.parseString(payload.getValue()).getAsJsonObject()
                .get("request_id").getAsString();

        JsonObject json = result(false, "You're not in a party.");
        json.addProperty("request_id", requestId);

        command.handlePartyResult(json);

        verify(player).sendMessage(contains("You're not in a party."));
    }

    @Test
    public void unknownRequestIdsAreIgnored() {
        command.handlePartyResult(result(true, "done"));
        verify(player, never()).sendMessage(any(String.class));
    }
}
