package com.deyo.rbw.bedwars;

import com.deyo.rbw.RankedBedwars;
import org.bukkit.entity.Player;

public interface BedwarsAPI {

    void initialize(RankedBedwars plugin);

    void registerListeners();

    String getName();
    
    boolean arenaExists(String arenaName);
    
    Object getArenaByName(String arenaName);
    
    Object getArenaByPlayer(Player player);
    
    String getArenaGroup(Object arena);
    
    void warpPlayersToGame(String gameId, String mapName, Object team1, Object team2, boolean isRanked);
    
    void initializeMaps();
    
    boolean isAvailable();
}
