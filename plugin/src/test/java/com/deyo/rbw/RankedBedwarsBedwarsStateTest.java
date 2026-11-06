package com.deyo.rbw;

import com.deyo.rbw.bedwars.BedwarsAPI;
import com.deyo.rbw.bedwars.BedwarsAPIManager;
import org.bukkit.entity.Player;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class RankedBedwarsBedwarsStateTest {

    @AfterEach
    public void resetImplementation() throws Exception {
        Field field = BedwarsAPIManager.class.getDeclaredField("implementation");
        field.setAccessible(true);
        field.set(null, null);
    }

    @Test
    public void usesTheBedwarsArenaAsTheSingleGameStateSource() throws Exception {
        Player player = mock(Player.class);
        BedwarsAPI api = mock(BedwarsAPI.class);
        when(api.isAvailable()).thenReturn(true);
        when(api.getArenaByPlayer(player)).thenReturn(new Object());

        Field field = BedwarsAPIManager.class.getDeclaredField("implementation");
        field.setAccessible(true);
        field.set(null, api);

        RankedBedwars plugin = mock(RankedBedwars.class, CALLS_REAL_METHODS);

        assertTrue(plugin.isInBedwarsGame(player));
    }

    @Test
    public void playersOutsideAnArenaAreNotInGame() throws Exception {
        Player player = mock(Player.class);
        BedwarsAPI api = mock(BedwarsAPI.class);
        when(api.isAvailable()).thenReturn(true);
        when(api.getArenaByPlayer(player)).thenReturn(null);

        Field field = BedwarsAPIManager.class.getDeclaredField("implementation");
        field.setAccessible(true);
        field.set(null, api);

        RankedBedwars plugin = mock(RankedBedwars.class, CALLS_REAL_METHODS);

        assertFalse(plugin.isInBedwarsGame(player));
        assertFalse(plugin.isInBedwarsGame(null));
    }
}
