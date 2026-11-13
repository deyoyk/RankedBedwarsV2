package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

public class GameDataManagerTeamLookupTest {

    private JsonObject team(String... players) {
        JsonObject json = new JsonObject();
        com.google.gson.JsonArray array = new com.google.gson.JsonArray();
        for (String player : players) {
            array.add(player);
        }
        json.add("players", array);
        return json;
    }

    @Test
    public void remembersTeamsPerGameId() {
        RankedBedwars plugin = org.mockito.Mockito.mock(RankedBedwars.class);
        when(plugin.getConfig()).thenReturn(new org.bukkit.configuration.file.YamlConfiguration());
        GameDataManager data = new GameDataManager(plugin, Runnable::run);
        data.rememberGameTeams("77", team("A", "B"), team("C"));

        assertEquals(List.of("A", "B"), data.findGameTeamPlayers("77", 1));
        assertEquals(List.of("C"), data.findGameTeamPlayers("77", 2));
        assertTrue(data.findGameTeamPlayers("77", 3).isEmpty());
        assertTrue(data.findGameTeamPlayers("404", 1).isEmpty());
    }

    @Test
    public void forgetGameTeamsClearsTheRoster() {
        RankedBedwars plugin = org.mockito.Mockito.mock(RankedBedwars.class);
        when(plugin.getConfig()).thenReturn(new org.bukkit.configuration.file.YamlConfiguration());
        GameDataManager data = new GameDataManager(plugin, Runnable::run);
        data.rememberGameTeams("77", team("A"), team("B"));
        data.forgetGameTeams("77");

        assertTrue(data.findGameTeamPlayers("77", 1).isEmpty());
    }
}
