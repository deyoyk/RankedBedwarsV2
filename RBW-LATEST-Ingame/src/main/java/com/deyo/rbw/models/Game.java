package com.deyo.rbw.models;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * @author deyo
 * @created 2025-06-26
 * @updated 2025-06-26
 */

 
public class Game {
    private final String gameId;
    private final String map;
    private final boolean ranked;
    private final List<String> team1;
    private final List<String> team2;
    private final List<String> mvps;
    private final List<String> bedBreakers;
    private final long startTime;
    private final int duration;
    private final String date;

    
    private final Map<String, Integer> playerKills = new HashMap<>();
    private final Map<String, Integer> playerDeaths = new HashMap<>();
    private final Map<String, Integer> playerFinalKills = new HashMap<>();
    private final Map<String, Integer> playerBedsDestroyed = new HashMap<>();
    private final Map<String, Integer> playerBlocksPlaced = new HashMap<>();
    private final Map<String, Integer> playerDiamondsCollected = new HashMap<>();
    private final Map<String, Integer> playerEmeraldsCollected = new HashMap<>();
    private final Map<String, Integer> playerGoldCollected = new HashMap<>();
    private final Map<String, Integer> playerIronCollected = new HashMap<>();
    private final Map<String, Boolean> playerTeamWon = new HashMap<>();
    private final Map<String, String> playerTeamName = new HashMap<>();
    private final Map<String, Boolean> playerBedBroken = new HashMap<>();

    public Game(String gameId, String map, boolean ranked, List<String> team1, List<String> team2,
                List<String> mvps, List<String> bedBreakers, long startTime, int duration, String date) {
        this.gameId = gameId;
        this.map = map;
        this.ranked = ranked;
        this.team1 = team1;
        this.team2 = team2;
        this.mvps = mvps;
        this.bedBreakers = bedBreakers;
        this.startTime = startTime;
        this.duration = duration;
        this.date = date;
    }

    public String getGameId() { return gameId; }
    public String getMap() { return map; }
    public boolean isRanked() { return ranked; }
    public List<String> getTeam1() { return team1; }
    public List<String> getTeam2() { return team2; }
    public List<String> getMvps() { return mvps; }
    public List<String> getBedBreakers() { return bedBreakers; }
    public long getStartTime() { return startTime; }
    public int getDuration() { return duration; }
    public String getDate() { return date; }

    public Map<String, Integer> getPlayerKills() { return playerKills; }
    public Map<String, Integer> getPlayerDeaths() { return playerDeaths; }
    public Map<String, Integer> getPlayerFinalKills() { return playerFinalKills; }
    public Map<String, Integer> getPlayerBedsDestroyed() { return playerBedsDestroyed; }
    public Map<String, Integer> getPlayerBlocksPlaced() { return playerBlocksPlaced; }
    public Map<String, Integer> getPlayerDiamondsCollected() { return playerDiamondsCollected; }
    public Map<String, Integer> getPlayerEmeraldsCollected() { return playerEmeraldsCollected; }
    public Map<String, Integer> getPlayerGoldCollected() { return playerGoldCollected; }
    public Map<String, Integer> getPlayerIronCollected() { return playerIronCollected; }
    public Map<String, Boolean> getPlayerTeamWon() { return playerTeamWon; }
    public Map<String, String> getPlayerTeamName() { return playerTeamName; }
    public Map<String, Boolean> getPlayerBedBroken() { return playerBedBroken; }
    

    public int getWinningTeamNumber() {
        
        boolean team1Won = false;
        for (String player : team1) {
            if (playerTeamWon.getOrDefault(player, false)) {
                team1Won = true;
                break;
            }
        }
        
        
        boolean team2Won = false;
        for (String player : team2) {
            if (playerTeamWon.getOrDefault(player, false)) {
                team2Won = true;
                break;
            }
        }
        
        
        if (team2Won && !team1Won) {
            return 2;
        } else {
            return 1; 
        }
    }
}
