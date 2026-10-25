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
    private final Map<String, Integer> playerCurrentStreak = new HashMap<>();
    private final Map<String, Map<String, Long>> lastDamageAt = new HashMap<>();
    private static final long ASSIST_WINDOW_MS = 10_000L;
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
        addTimelineEvent(0L, "game_start", null, null, null, null);
        initializePlayerTracking(arena);
    }

    private void addTimelineEvent(long timestamp, String type, String player, String target, Integer amount, String team) {
        Map<String, Object> event = new HashMap<>();
        event.put("type", type);
        event.put("player", player);
        event.put("target", target);
        event.put("amount", amount);
        event.put("team", team);
        event.put("timestamp", timestamp);
        game.getTimeline().add(event);
    }

    private void addTimelineEvent(String type, String player, String target, Integer amount, String team) {
        addTimelineEvent(System.currentTimeMillis() - game.getStartTime(), type, player, target, amount, team);
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
                game.getPlayerDamageDealt().put(player.getName(), 0.0);
                game.getPlayerDamageTaken().put(player.getName(), 0.0);
                game.getPlayerAssists().put(player.getName(), 0);
                game.getPlayerMaxStreak().put(player.getName(), 0);
                playerCurrentStreak.put(player.getName(), 0);
                addTimelineEvent("player_join", player.getName(), null, null, null);
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

    public void recordDamage(String dealer, String victim, double amount) {
        if (dealer == null || dealer.isEmpty() || victim == null || victim.isEmpty()) {
            return;
        }
        if (dealer.equals(victim) || amount <= 0) {
            return;
        }
        game.getPlayerDamageDealt().put(dealer, game.getPlayerDamageDealt().getOrDefault(dealer, 0.0) + amount);
        game.getPlayerDamageTaken().put(victim, game.getPlayerDamageTaken().getOrDefault(victim, 0.0) + amount);
        Game.FightStats fight = game.getPlayerFights()
                .computeIfAbsent(dealer, k -> new HashMap<>())
                .computeIfAbsent(victim, k -> new Game.FightStats());
        fight.setDamage(fight.getDamage() + amount);
        lastDamageAt
                .computeIfAbsent(victim, k -> new HashMap<>())
                .put(dealer, System.currentTimeMillis());
    }

    public void recordKill(String killer, String victim, boolean isFinal) {
        if (killer == null || killer.isEmpty() || victim == null || victim.isEmpty()) {
            return;
        }
        game.getPlayerKills().put(killer, game.getPlayerKills().getOrDefault(killer, 0) + 1);
        addTimelineEvent("kill", killer, victim, null, null);
        if (isFinal) {
            game.getPlayerFinalKills().put(killer, game.getPlayerFinalKills().getOrDefault(killer, 0) + 1);
            addTimelineEvent("final_kill", killer, victim, null, null);
        }
        game.getPlayerDeaths().put(victim, game.getPlayerDeaths().getOrDefault(victim, 0) + 1);
        addTimelineEvent("death", victim, killer, null, null);
        Game.FightStats fight = game.getPlayerFights()
                .computeIfAbsent(killer, k -> new HashMap<>())
                .computeIfAbsent(victim, k -> new Game.FightStats());
        fight.setKills(fight.getKills() + 1);
        if (game.getFirstBlood() == null) {
            game.setFirstBlood(killer);
            addTimelineEvent("first_blood", killer, victim, null, null);
        }
        int streak = playerCurrentStreak.getOrDefault(killer, 0) + 1;
        playerCurrentStreak.put(killer, streak);
        if (streak > game.getPlayerMaxStreak().getOrDefault(killer, 0)) {
            game.getPlayerMaxStreak().put(killer, streak);
        }
        playerCurrentStreak.put(victim, 0);
        recordAssists(killer, victim);
    }

    private void recordAssists(String killer, String victim) {
        Map<String, Long> damagers = lastDamageAt.get(victim);
        if (damagers == null) {
            return;
        }
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Long> entry : damagers.entrySet()) {
            String damager = entry.getKey();
            if (damager.equals(killer)) {
                continue;
            }
            if (now - entry.getValue() <= ASSIST_WINDOW_MS) {
                game.getPlayerAssists().put(damager, game.getPlayerAssists().getOrDefault(damager, 0) + 1);
                addTimelineEvent("assist", damager, victim, null, null);
            }
        }
    }

    public void recordDeath(String player) {
        game.getPlayerDeaths().put(player, game.getPlayerDeaths().getOrDefault(player, 0) + 1);
        addTimelineEvent("death", player, null, null, null);
    }

    public void recordBedBreak(String player, String teamName) {
        game.getPlayerBedsDestroyed().put(player, game.getPlayerBedsDestroyed().getOrDefault(player, 0) + 1);
        bedBreakers.add(player);
        brokenBeds.put(teamName, player);
        addTimelineEvent("bed_break", player, teamName, null, teamName);
    }

    public void recordBlocksPlaced(String player, int count) {
        game.getPlayerBlocksPlaced().put(player, game.getPlayerBlocksPlaced().getOrDefault(player, 0) + count);
        addTimelineEvent("block_place", player, null, 1, null);
    }

    public void recordPlayerLeave(String player) {
        addTimelineEvent("player_leave", player, null, null, null);
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
        resourceMap.put(player, currentAmount + amount);
        addTimelineEvent("resource_pickup", player, null, amount, null);
    }

    public void recordGameEnd(Team winningTeam) {
        if (winningTeam == null) {
            return;
        }
        this.winningTeam = winningTeam;
        this.endTime = System.currentTimeMillis();
        String winningTeamName = getTeamName(winningTeam);
        for (Map.Entry<String, String> entry : playerTeams.entrySet()) {
            if (entry.getValue().equals(winningTeamName)) {
                game.getPlayerTeamWon().put(entry.getKey(), true);
            }
        }
        addTimelineEvent("game_end", winningTeamName, null, null, winningTeamName);
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
        game.setDuration(duration);
        Set<String> brokenTeams = brokenBeds.keySet();
        for (Map.Entry<String, String> entry : playerTeams.entrySet()) {
            String player = entry.getKey();
            String team = entry.getValue();
            game.getPlayerBedBroken().put(player, brokenTeams.contains(team));
        }
        Game snapshot = new Game(
            game.getGameId(), game.getMap(), game.isRanked(),
            new ArrayList<>(game.getTeam1()), new ArrayList<>(game.getTeam2()),
            new ArrayList<>(game.getMvps()), new ArrayList<>(game.getBedBreakers()),
            game.getStartTime(), game.getDuration(), game.getDate());
        snapshot.getPlayerKills().putAll(game.getPlayerKills());
        snapshot.getPlayerDeaths().putAll(game.getPlayerDeaths());
        snapshot.getPlayerFinalKills().putAll(game.getPlayerFinalKills());
        snapshot.getPlayerBedsDestroyed().putAll(game.getPlayerBedsDestroyed());
        snapshot.getPlayerBlocksPlaced().putAll(game.getPlayerBlocksPlaced());
        snapshot.getPlayerDiamondsCollected().putAll(game.getPlayerDiamondsCollected());
        snapshot.getPlayerEmeraldsCollected().putAll(game.getPlayerEmeraldsCollected());
        snapshot.getPlayerGoldCollected().putAll(game.getPlayerGoldCollected());
        snapshot.getPlayerIronCollected().putAll(game.getPlayerIronCollected());
        snapshot.getPlayerDamageDealt().putAll(game.getPlayerDamageDealt());
        snapshot.getPlayerDamageTaken().putAll(game.getPlayerDamageTaken());
        snapshot.getPlayerAssists().putAll(game.getPlayerAssists());
        snapshot.getPlayerMaxStreak().putAll(game.getPlayerMaxStreak());
        snapshot.getPlayerTeamWon().putAll(game.getPlayerTeamWon());
        snapshot.getPlayerTeamName().putAll(game.getPlayerTeamName());
        snapshot.getPlayerBedBroken().putAll(game.getPlayerBedBroken());
        for (Map.Entry<String, Map<String, Game.FightStats>> entry : game.getPlayerFights().entrySet()) {
            Map<String, Game.FightStats> fightsCopy = new HashMap<>();
            for (Map.Entry<String, Game.FightStats> fight : entry.getValue().entrySet()) {
                fightsCopy.put(fight.getKey(), new Game.FightStats(fight.getValue().getKills(), fight.getValue().getDamage()));
            }
            snapshot.getPlayerFights().put(entry.getKey(), fightsCopy);
        }
        if (game.getFirstBlood() != null) {
            snapshot.setFirstBlood(game.getFirstBlood());
        }
        snapshot.getTimeline().addAll(game.getTimeline());
        return snapshot;
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
