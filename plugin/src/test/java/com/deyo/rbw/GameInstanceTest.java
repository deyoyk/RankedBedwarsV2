package com.deyo.rbw;

import com.deyo.rbw.models.Game;
import com.deyo.rbw.models.GameInstance;
import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.Team;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class GameInstanceTest {

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

    private GameInstance createGame(Player a, Player b, Player c, Player d) {
        Arena arena = mockArena("TestArena", a, b, c, d);
        Team red = mockTeam("Red");
        Team blue = mockTeam("Blue");
        Mockito.when(arena.getPlayerTeam(a)).thenReturn(red);
        Mockito.when(arena.getPlayerTeam(b)).thenReturn(red);
        Mockito.when(arena.getPlayerTeam(c)).thenReturn(blue);
        Mockito.when(arena.getPlayerTeam(d)).thenReturn(blue);
        return new GameInstance("1", arena, true);
    }

    @Test
    public void tracksKillsDeathsAndFinalKills() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        GameInstance game = createGame(a, mockPlayer("C"), mockPlayer("D"), b);

        game.recordKill("A", "B", true);
        game.recordKill("A", "C", false);

        assertEquals(2, game.getGame().getPlayerKills().get("A"));
        assertEquals(1, game.getGame().getPlayerFinalKills().get("A"));
        assertEquals(1, game.getGame().getPlayerDeaths().get("B"));
        assertEquals(1, game.getGame().getPlayerDeaths().get("C"));
    }

    @Test
    public void recordsBedBreaks() {
        Player a = mockPlayer("A");
        GameInstance game = createGame(a, mockPlayer("B"), mockPlayer("C"), mockPlayer("D"));

        game.recordBedBreak("A", "Blue");
        game.recordBedBreak("B", "Blue");

        assertEquals(1, game.getGame().getPlayerBedsDestroyed().get("A"));
        assertTrue(game.getGame().getBedBreakers().contains("A"));
        assertTrue(game.getGame().getBedBreakers().contains("B"));
    }

    @Test
    public void recordsFullStackResourcePickups() {
        Player a = mockPlayer("A");
        GameInstance game = createGame(a, mockPlayer("B"), mockPlayer("C"), mockPlayer("D"));

        game.recordResourceCollection("A", GameInstance.ResourceType.IRON, 64);
        game.recordResourceCollection("A", GameInstance.ResourceType.IRON, 32);

        assertEquals(96, game.getGame().getPlayerIronCollected().get("A"));
    }

    @Test
    public void ignoresInvalidResourceAmounts() {
        Player a = mockPlayer("A");
        GameInstance game = createGame(a, mockPlayer("B"), mockPlayer("C"), mockPlayer("D"));

        game.recordResourceCollection("A", GameInstance.ResourceType.GOLD, 0);
        game.recordResourceCollection("A", GameInstance.ResourceType.GOLD, -5);

        assertEquals(0, game.getGame().getPlayerGoldCollected().get("A"));
    }

    @Test
    public void determinesWinningTeamPlayers() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        Player c = mockPlayer("C");
        Player d = mockPlayer("D");
        GameInstance game = createGame(a, b, c, d);

        Team red = mockTeam("Red");
        game.recordGameEnd(red);

        assertEquals(Arrays.asList("A", "B"), game.getWinningTeamPlayers());
        assertEquals(Arrays.asList("C", "D"), game.getLosingTeamPlayers());

        Game converted = game.toGame();
        assertEquals(1, converted.getWinningTeamNumber());
    }

    @Test
    public void mvpIsHighestKillPlayer() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        GameInstance game = createGame(a, mockPlayer("C"), mockPlayer("D"), b);

        game.recordKill("A", "B", true);
        game.recordKill("A", "C", false);
        game.recordKill("C", "A", false);

        assertEquals(Collections.singletonList("A"), game.getMVPs());
    }
}
