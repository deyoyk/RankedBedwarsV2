package com.deyo.rbw.models;

import java.util.Set;

public interface LiveGameStats {
    String getGameId();
    String getMap();
    String getArenaName();
    boolean isRanked();
    long getStartTime();
    int getDuration();
    String getTeam(String playerName);
    String getFirstBlood();
    Set<String> getPlayers();
    int getKills(String playerName);
    int getDeaths(String playerName);
    int getFinalKills(String playerName);
    int getBedsDestroyed(String playerName);
    int getBlocksPlaced(String playerName);
    int getDiamonds(String playerName);
    int getIrons(String playerName);
    int getGold(String playerName);
    int getEmeralds(String playerName);
    double getDamageDealt(String playerName);
    double getDamageTaken(String playerName);
    int getAssists(String playerName);
    int getBestStreak(String playerName);
    int getCurrentStreak(String playerName);
}
