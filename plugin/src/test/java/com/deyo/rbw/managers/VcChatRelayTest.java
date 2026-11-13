package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

public class VcChatRelayTest {

    private RankedBedwars plugin;
    private GameDataManager dataManager;
    private final Map<String, Player> online = new ConcurrentHashMap<>();
    private MockedStatic<Bukkit> bukkit;

    @BeforeEach
    public void setUp() throws Exception {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("VcChat-Test"));
        dataManager = mock(GameDataManager.class);
        when(plugin.getGameDataManager()).thenReturn(dataManager);

        Server server = mock(Server.class);
        BukkitScheduler scheduler = mock(BukkitScheduler.class);
        when(scheduler.runTask(any(), any(Runnable.class))).thenAnswer(inv -> {
            inv.getArgument(1, Runnable.class).run();
            return mock(BukkitTask.class);
        });

        bukkit = mockStatic(Bukkit.class);
        bukkit.when(Bukkit::getScheduler).thenReturn(scheduler);
        bukkit.when(() -> Bukkit.getPlayerExact(any())).thenAnswer(inv -> online.get(inv.getArgument(0)));
    }

    @AfterEach
    public void tearDown() {
        bukkit.close();
    }

    private void deliver(JsonObject json) throws Exception {
        WebSocketManager manager = new WebSocketManager(plugin);
        Method method = WebSocketManager.class.getDeclaredMethod("handleVcChat", JsonObject.class);
        method.setAccessible(true);
        method.invoke(manager, json);
    }

    private JsonObject chat(String gameId, int team, String ign, String message) {
        JsonObject json = new JsonObject();
        json.addProperty("type", "vc_chat");
        json.addProperty("game_id", gameId);
        json.addProperty("team", team);
        json.addProperty("ign", ign);
        json.addProperty("elo", 1000);
        json.addProperty("registered", true);
        json.addProperty("message", message);
        return json;
    }

    @Test
    public void teamPlayersReceiveTheMessage() throws Exception {
        Player receiver = mock(Player.class);
        when(receiver.isOnline()).thenReturn(true);
        online.put("Receiver", receiver);
        when(dataManager.findGameTeamPlayers("77", 1)).thenReturn(java.util.List.of("Receiver", "Offline"));

        deliver(chat("77", 1, "Sender", "hello"));

        verify(receiver).sendMessage(contains("Sender"));
        verify(receiver).sendMessage(contains("hello"));
    }

    @Test
    public void otherTeamAndUnknownGamesGetNothing() throws Exception {
        Player receiver = mock(Player.class);
        when(receiver.isOnline()).thenReturn(true);
        online.put("Receiver", receiver);
        when(dataManager.findGameTeamPlayers("77", 2)).thenReturn(java.util.List.of("Receiver"));

        deliver(chat("77", 1, "Sender", "hello"));
        deliver(chat("404", 1, "Sender", "hello"));

        verify(receiver, never()).sendMessage(any(String.class));
    }

    @Test
    public void unregisteredSendersShowAsNr() throws Exception {
        Player receiver = mock(Player.class);
        when(receiver.isOnline()).thenReturn(true);
        online.put("Receiver", receiver);
        when(dataManager.findGameTeamPlayers("77", 1)).thenReturn(java.util.List.of("Receiver"));

        JsonObject json = chat("77", 1, "Stranger", "hi");
        json.addProperty("registered", false);
        json.remove("elo");
        deliver(json);

        verify(receiver).sendMessage(contains("NR"));
    }
}
