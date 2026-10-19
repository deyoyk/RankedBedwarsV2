package com.deyo.rbw;

import com.deyo.rbw.models.GameInstance;
import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.Team;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class GameTimelineTest {

    private Arena mockArena(String name, Player... players) {
        Arena arena = Mockito.mock(Arena.class);
        Mockito.when(arena.getName()).thenReturn(name);
        Mockito.when(arena.getDisplayName()).thenReturn(name);
        Mockito.when(arena.getPlayers()).thenReturn(Arrays.asList(players));
        return arena;
    }

    private Player mockPlayer(String name) {
        Player player = Mockito.mock(Player.class);
        Mockito.when(player.getName()).thenReturn(name);
        return player;
    }

    private Team mockTeam(String name) {
        Team team = Mockito.mock(Team.class);
        Mockito.when(team.getDisplayName()).thenReturn(name);
        return team;
    }

    @Test
    public void recordsFullEventTimeline() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        Player c = mockPlayer("C");
        Player d = mockPlayer("D");
        Arena arena = mockArena("TimelineArena", a, b, c, d);
        Team red = mockTeam("Red");
        Team blue = mockTeam("Blue");
        Mockito.when(arena.getPlayerTeam(a)).thenReturn(red);
        Mockito.when(arena.getPlayerTeam(b)).thenReturn(red);
        Mockito.when(arena.getPlayerTeam(c)).thenReturn(blue);
        Mockito.when(arena.getPlayerTeam(d)).thenReturn(blue);

        GameInstance game = new GameInstance("1", arena, true);

        game.recordKill("A", "B", true);
        game.recordDeath("C");
        game.recordBedBreak("A", "Blue");
        game.recordBlocksPlaced("D", 1);
        game.recordResourceCollection("C", GameInstance.ResourceType.IRON, 64);
        game.recordPlayerLeave("D");
        game.recordGameEnd(red);

        List<Map<String, Object>> timeline = game.getGame().getTimeline();

        assertEquals("game_start", timeline.get(0).get("type"));
        assertEquals(0L, timeline.get(0).get("timestamp"));

        long joinCount = timeline.stream()
                .filter(event -> "player_join".equals(event.get("type")))
                .count();
        assertEquals(4, joinCount);

        assertEvent(timeline, "kill", "A", "B");
        assertEvent(timeline, "final_kill", "A", "B");
        assertEvent(timeline, "bed_break", "A", "Blue");
        assertEvent(timeline, "block_place", "D", null);
        assertEvent(timeline, "resource_pickup", "C", null);
        assertEvent(timeline, "player_leave", "D", null);

        Map<String, Object> killDeath = findEvent(timeline, "death", "B");
        assertNotNull(killDeath, "missing death event for victim B");
        assertEquals("A", killDeath.get("target"));

        Map<String, Object> standaloneDeath = findEvent(timeline, "death", "C");
        assertNotNull(standaloneDeath, "missing standalone death event for C");
        assertEquals(null, standaloneDeath.get("target"));

        long deathCount = timeline.stream()
                .filter(event -> "death".equals(event.get("type")))
                .count();
        assertEquals(2, deathCount);

        Map<String, Object> gameEnd = findEvent(timeline, "game_end");
        assertNotNull(gameEnd);
        assertEquals("Red", gameEnd.get("player"));
        assertEquals("Red", gameEnd.get("team"));

        Map<String, Object> bedBreak = findEvent(timeline, "bed_break");
        assertEquals("Blue", bedBreak.get("team"));

        Map<String, Object> blockPlace = findEvent(timeline, "block_place");
        assertEquals(1, blockPlace.get("amount"));

        Map<String, Object> pickup = findEvent(timeline, "resource_pickup");
        assertEquals(64, pickup.get("amount"));

        long previous = -1;
        for (Map<String, Object> event : timeline) {
            Object ts = event.get("timestamp");
            assertNotNull(ts);
            long timestamp = ((Number) ts).longValue();
            assertTrue(timestamp >= 0, "timestamps must be non-negative, got " + timestamp);
            assertTrue(timestamp >= previous, "timestamps must be non-decreasing");
            previous = timestamp;
        }
    }

    private void assertEvent(List<Map<String, Object>> timeline, String type, String player, String target) {
        Map<String, Object> event = findEvent(timeline, type);
        assertNotNull(event, "missing timeline event of type " + type);
        assertEquals(player, event.get("player"));
        assertEquals(target, event.get("target"));
    }

    private Map<String, Object> findEvent(List<Map<String, Object>> timeline, String type) {
        return timeline.stream()
                .filter(event -> type.equals(event.get("type")))
                .findFirst()
                .orElse(null);
    }

    private Map<String, Object> findEvent(List<Map<String, Object>> timeline, String type, String player) {
        return timeline.stream()
                .filter(event -> type.equals(event.get("type")) && player.equals(event.get("player")))
                .findFirst()
                .orElse(null);
    }
}
