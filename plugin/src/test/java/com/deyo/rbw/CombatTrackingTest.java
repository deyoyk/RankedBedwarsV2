package com.deyo.rbw;

import com.deyo.rbw.models.Game;
import com.deyo.rbw.models.GameInstance;
import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.Team;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

public class CombatTrackingTest {

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
    public void accumulatesDamageBothWays() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        GameInstance game = createGame(a, b, mockPlayer("C"), mockPlayer("D"));

        game.recordDamage("A", "B", 7.5);
        game.recordDamage("A", "B", 2.5);
        game.recordDamage("B", "A", 4.0);

        assertEquals(10.0, game.getGame().getPlayerDamageDealt().get("A"));
        assertEquals(4.0, game.getGame().getPlayerDamageTaken().get("A"));
        assertEquals(4.0, game.getGame().getPlayerDamageDealt().get("B"));
        assertEquals(10.0, game.getGame().getPlayerDamageTaken().get("B"));
    }

    @Test
    public void tracksFightsPerOpponent() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        Player c = mockPlayer("C");
        GameInstance game = createGame(a, b, c, mockPlayer("D"));

        game.recordDamage("A", "B", 6.0);
        game.recordKill("A", "B", false);
        game.recordKill("A", "C", true);

        Game.FightStats vsB = game.getGame().getPlayerFights().get("A").get("B");
        assertEquals(1, vsB.getKills());
        assertEquals(6.0, vsB.getDamage());
        Game.FightStats vsC = game.getGame().getPlayerFights().get("A").get("C");
        assertEquals(1, vsC.getKills());
        assertEquals(0.0, vsC.getDamage());
    }

    @Test
    public void ignoresSelfDamageAndNonPositiveAmounts() {
        Player a = mockPlayer("A");
        GameInstance game = createGame(a, mockPlayer("B"), mockPlayer("C"), mockPlayer("D"));

        game.recordDamage("A", "A", 10.0);
        game.recordDamage("A", "B", 0.0);
        game.recordDamage("A", "B", -3.0);
        game.recordDamage(null, "B", 5.0);

        assertEquals(0.0, game.getGame().getPlayerDamageDealt().get("A"));
        assertEquals(0.0, game.getGame().getPlayerDamageTaken().get("B"));
        assertNull(game.getGame().getPlayerFights().get("A"));
    }

    @Test
    public void tracksStreaksAndFirstBlood() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        GameInstance game = createGame(a, b, mockPlayer("C"), mockPlayer("D"));

        game.recordKill("A", "B", false);
        game.recordKill("A", "C", false);
        game.recordKill("B", "A", false);

        assertEquals("A", game.getGame().getFirstBlood());
        assertEquals(2, game.getGame().getPlayerMaxStreak().get("A"));
        assertEquals(1, game.getGame().getPlayerMaxStreak().get("B"));
    }

    @Test
    public void creditsAssistsToRecentDamagers() {
        Player a = mockPlayer("A");
        Player b = mockPlayer("B");
        Player c = mockPlayer("C");
        GameInstance game = createGame(a, b, c, mockPlayer("D"));

        game.recordDamage("C", "B", 5.0);
        game.recordKill("A", "B", false);

        assertEquals(1, game.getGame().getPlayerAssists().get("C"));
        assertEquals(0, game.getGame().getPlayerAssists().get("A"));
    }
}
