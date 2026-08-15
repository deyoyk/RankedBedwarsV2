package com.deyo.rbw;

import com.deyo.rbw.models.Game;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class GameTest {

    private Game makeGame(List<String> team1, List<String> team2) {
        return new Game("1", "MapA", true, team1, team2,
                Collections.emptyList(), Collections.emptyList(),
                System.currentTimeMillis(), 0, "2026-01-01");
    }

    @Test
    public void winningTeamIsDetectedFromTeam1() {
        Game game = makeGame(Arrays.asList("A", "B"), Arrays.asList("C", "D"));
        game.getPlayerTeamWon().put("B", true);
        assertEquals(1, game.getWinningTeamNumber());
    }

    @Test
    public void winningTeamIsDetectedFromTeam2() {
        Game game = makeGame(Arrays.asList("A", "B"), Arrays.asList("C", "D"));
        game.getPlayerTeamWon().put("C", true);
        assertEquals(2, game.getWinningTeamNumber());
    }

    @Test
    public void unknownWinnerReturnsZeroInsteadOfDefaultingToTeam1() {
        Game game = makeGame(Arrays.asList("A", "B"), Arrays.asList("C", "D"));
        assertEquals(0, game.getWinningTeamNumber());
    }

    @Test
    public void gettersReturnConfiguredValues() {
        Game game = new Game("42", "Lighthouse", false,
                Arrays.asList("A"), Arrays.asList("B"),
                Arrays.asList("A"), Arrays.asList("B"),
                123456789L, 10, "2026-01-01");
        assertEquals("42", game.getGameId());
        assertEquals("Lighthouse", game.getMap());
        assertEquals(false, game.isRanked());
        assertEquals(Arrays.asList("A"), game.getTeam1());
        assertEquals(Arrays.asList("B"), game.getTeam2());
        assertEquals(10, game.getDuration());
    }
}
