package com.deyo.rbw.models;

import de.marcely.bedwars.api.arena.Arena;
import de.marcely.bedwars.api.arena.Team;
import org.bukkit.entity.Player;

import java.util.*;
import java.util.stream.Collectors;



 
public class GameInstance {
    private final Game game;
    private final String arenaName;
    private final String displayName;
    private final Map<String, String> playerTeams = new HashMap<>();
    private final List<String> bedBreakers = new ArrayList<>();
    private final Map<String, String> brokenBeds = new HashMap<>();
    private Team winningTeam;
    private long endTime;

    public GameInstance(String gameId, Arena arena, boolean isRanked) {
        this.arenaName = arena.getName();
        this.displayName = arena.getDisplayName();
        this.game = new Game(
            gameId,
            arena.getName(),
            isRanked,
            new ArrayList<>(),
            new ArrayList<>(),
            new ArrayList<>(),
            bedBreakers,
            System.currentTimeMillis(),
            0,
            new java.text.SimpleDateFormat("dd/MM/yyyy").format(new Date())
        );
        initializePlayerTracking(arena);
    }

    private void initializePlayerTracking(Arena arena) {
        for (Player player : arena.getPlayers()) {
            Team team = arena.getPlayerTeam(player);
            if (team != null) {
                String teamName = getTeamName(team);
                playerTeams.put(player.getName(), teamName);
                game.getPlayerTeamName().put(player.getName(), teamName);
                game.getPlayerTeamWon().put(player.getName(), false);
                game.getPlayerKills().put(player.getName(), 0);
                game.getPlayerDeaths().put(player.getName(), 0);
                game.getPlayerFinalKills().put(player.getName(), 0);
                game.getPlayerBedsDestroyed().put(player.getName(), 0);
                game.getPlayerBlocksPlaced().put(player.getName(), 0);
                game.getPlayerDiamondsCollected().put(player.getName(), 0);
                game.getPlayerEmeraldsCollected().put(player.getName(), 0);
                game.getPlayerGoldCollected().put(player.getName(), 0);
                game.getPlayerIronCollected().put(player.getName(), 0);
            }
        }
    }

    private String getTeamName(Team team) {
        try {
            return team.getDisplayName();
        } catch (Exception e) {
            try {
                return (String) team.getClass().getMethod("getName").invoke(team);
            } catch (Exception ex) {
                return team.toString();
            }
        }
    }

    public void recordKill(String killer, String victim, boolean isFinal) {
        game.getPlayerKills().put(killer, game.getPlayerKills().getOrDefault(killer, 0) + 1);
        if (isFinal) {
            game.getPlayerFinalKills().put(killer, game.getPlayerFinalKills().getOrDefault(killer, 0) + 1);
        }
        game.getPlayerDeaths().put(victim, game.getPlayerDeaths().getOrDefault(victim, 0) + 1);
    }

    public void recordDeath(String player) {
        game.getPlayerDeaths().put(player, game.getPlayerDeaths().getOrDefault(player, 0) + 1);
    }

    public void recordBedBreak(String player, String teamName) {
        game.getPlayerBedsDestroyed().put(player, game.getPlayerBedsDestroyed().getOrDefault(player, 0) + 1);
        bedBreakers.add(player);
        brokenBeds.put(teamName, player);
    }

    public void recordBlocksPlaced(String player, int count) {
        game.getPlayerBlocksPlaced().put(player, game.getPlayerBlocksPlaced().getOrDefault(player, 0) + count);
    }

    public void recordResourceCollection(String player, ResourceType resourceType, int amount) {
        if (player == null || resourceType == null || amount <= 0) return;
        
        
        Map<String, Integer> resourceMap;
        switch (resourceType) {
            case DIAMOND:
                resourceMap = game.getPlayerDiamondsCollected();
                break;
            case EMERALD:
                resourceMap = game.getPlayerEmeraldsCollected();
                break;
            case GOLD:
                resourceMap = game.getPlayerGoldCollected();
                break;
            case IRON:
                resourceMap = game.getPlayerIronCollected();
                break;
            default:
                return;
        }
        
        
        int currentAmount = resourceMap.getOrDefault(player, 0);
        
        if (amount > 64) return; 
        resourceMap.put(player, currentAmount + amount);
    }

    public void recordGameEnd(Team winningTeam) {
        this.winningTeam = winningTeam;
        this.endTime = System.currentTimeMillis();
        String winningTeamName = getTeamName(winningTeam);
        for (Map.Entry<String, String> entry : playerTeams.entrySet()) {
            if (entry.getValue().equals(winningTeamName)) {
                game.getPlayerTeamWon().put(entry.getKey(), true);
            }
        }
    }

    public int getDuration() {
        long end = endTime > 0 ? endTime : System.currentTimeMillis();
        return (int)((end - game.getStartTime()) / 1000);
    }

    public List<String> getWinningTeamPlayers() {
        if (winningTeam == null) return Collections.emptyList();
        String winningTeamName = getTeamName(winningTeam);
        return playerTeams.entrySet().stream()
                .filter(entry -> entry.getValue().equals(winningTeamName))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    public List<String> getLosingTeamPlayers() {
        if (winningTeam == null) return Collections.emptyList();
        String winningTeamName = getTeamName(winningTeam);
        return playerTeams.entrySet().stream()
                .filter(entry -> !entry.getValue().equals(winningTeamName))
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    public List<String> getMVPs() {
        Map<String, Integer> playerScores = new HashMap<>();
        for (String player : game.getPlayerKills().keySet()) {
            int score = game.getPlayerFinalKills().getOrDefault(player, 0) * 5 + game.getPlayerKills().getOrDefault(player, 0);
            playerScores.put(player, score);
        }
        int highestScore = playerScores.values().stream().mapToInt(Integer::intValue).max().orElse(-1);
        return playerScores.entrySet().stream()
                .filter(entry -> entry.getValue() == highestScore)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
    }

    public Game getGame() {
        return game;
    }

    public Game toGame() {
        int duration = getDuration();
        List<String> mvps = getMVPs();
        List<String> team1 = getWinningTeamPlayers();
        List<String> team2 = getLosingTeamPlayers();
        game.getMvps().clear();
        game.getMvps().addAll(mvps);
        game.getTeam1().clear();
        game.getTeam1().addAll(team1);
        game.getTeam2().clear();
        game.getTeam2().addAll(team2);
        try {
            java.lang.reflect.Field durationField = Game.class.getDeclaredField("duration");
            durationField.setAccessible(true);
            durationField.setInt(game, duration);
        } catch (Exception ignored) {}
        // Populate playerBedBroken
        Set<String> brokenTeams = brokenBeds.keySet();
        for (Map.Entry<String, String> entry : playerTeams.entrySet()) {
            String player = entry.getKey();
            String team = entry.getValue();
            game.getPlayerBedBroken().put(player, brokenTeams.contains(team));
        }
        return game;
    }

    public String getArenaName() {
        return arenaName;
    }

    public String getDisplayName() {
        return displayName;
    }

    public Team getWinningTeam() {
        return winningTeam;
    }

    public Map<String, String> getPlayerTeams() {
        return Collections.unmodifiableMap(playerTeams);
    }

    public List<String> getBedBreakers() {
        return Collections.unmodifiableList(bedBreakers);
    }

    public Map<String, String> getBrokenBeds() {
        return Collections.unmodifiableMap(brokenBeds);
    }

    public enum ResourceType {
        DIAMOND, EMERALD, GOLD, IRON
    }
}
