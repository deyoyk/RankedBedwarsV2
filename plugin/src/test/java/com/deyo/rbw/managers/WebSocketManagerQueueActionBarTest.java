package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

public class WebSocketManagerQueueActionBarTest {

    @SuppressWarnings("unchecked")
    private Map<String, String> collect(JsonObject queue) throws Exception {
        WebSocketManager manager = new WebSocketManager(mock(RankedBedwars.class));
        Method method = WebSocketManager.class.getDeclaredMethod(
                "collectQueueActionBars", JsonObject.class, Map.class);
        method.setAccessible(true);
        Map<String, String> bars = new HashMap<>();
        method.invoke(manager, queue, bars);
        return bars;
    }

    @Test
    public void buildsQueueRangeAndSizeForEveryQueuedPlayer() throws Exception {
        JsonObject queue = new JsonObject();
        queue.addProperty("min_elo", 0);
        queue.addProperty("max_elo", 600);
        queue.addProperty("current_players", 1);
        queue.addProperty("max_players", 8);
        JsonArray players = new JsonArray();
        players.add("Steve");
        players.add("Alex");
        queue.add("players", players);

        Map<String, String> bars = collect(queue);

        assertEquals("§6In Queue §e[0-600] §f1/8", bars.get("Steve"));
        assertEquals("§6In Queue §e[0-600] §f1/8", bars.get("Alex"));
    }

    @Test
    public void ignoresQueuesWithoutPlayers() throws Exception {
        JsonObject queue = new JsonObject();
        queue.addProperty("min_elo", 0);
        queue.addProperty("max_elo", 600);
        queue.addProperty("current_players", 0);
        queue.addProperty("max_players", 8);

        assertTrue(collect(queue).isEmpty());
    }
}
