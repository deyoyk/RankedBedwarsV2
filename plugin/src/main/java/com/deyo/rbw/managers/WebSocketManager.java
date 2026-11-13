package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import lombok.Getter;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.stream.Collectors;



 
public class WebSocketManager {
    private final RankedBedwars plugin;
    @Getter
    private WebSocketClient client;
    private String host;
    private int port;
    private String scheme;
    private String authKey;
    private int reconnectDelay;
    private final AtomicBoolean reconnectScheduled = new AtomicBoolean(false);
    private final AtomicInteger reconnectAttempts = new AtomicInteger(0);
    private BukkitTask pendingScoringTask;
    private BukkitTask actionBarTask;
    private final java.util.Map<String, String> actionBars = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Set<java.util.UUID> actionBarFallbackShown = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.Map<String, java.util.function.Consumer<JsonObject>> leaderboardCallbacks = new java.util.concurrent.ConcurrentHashMap<>();
    private final java.util.Map<String, java.util.function.Consumer<JsonObject>> statsCallbacks = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile java.lang.reflect.Method paperActionBarMethod;
    private volatile boolean paperActionBarResolved;

    public WebSocketManager(RankedBedwars plugin) {
        this.plugin = plugin;
    }

    public void initialize() {
        
        FileConfiguration config = plugin.getConfig();
        String configured = config.getString("bot_url", null);
        if (configured == null || configured.trim().isEmpty()) {
            String legacyHost = config.getString("websocket.host", "rbw.deyo.lol");
            if (config.contains("websocket.port")) {
                String[] legacy = parseTarget(legacyHost);
                legacyHost = legacy[0] + "://" + legacy[1] + ":" + config.getInt("websocket.port");
            }
            configured = legacyHost;
            plugin.getLogger().warning("bot_url is not set in config.yml, falling back to legacy websocket.host. Set bot_url instead, e.g. bot_url: \"127.0.0.1:25565\"");
        }
        String[] target = parseTarget(configured);
        scheme = target[0];
        host = target[1];
        port = Integer.parseInt(target[2]);
        String authEnv = System.getenv("AUTH_KEY");
        String authDefault = authEnv != null ? authEnv : "change_me_in_production";
        authKey = config.getString("auth_key", config.getString("websocket.auth_key", authDefault));
        reconnectDelay = 5;
        
        plugin.getLogger().info("Initializing WebSocket connection...");
        plugin.getLogger().info("Target bot: " + host + ":" + port);
        plugin.getLogger().info("Full WebSocket URL: " + buildWebSocketUri());
        plugin.getLogger().info("If connection fails, ensure the RankedBedwars bot is running and accessible");
        
        testConnectivity();
        
        connect();
        if (pendingScoringTask == null) {
            pendingScoringTask = plugin.getServer().getScheduler().runTaskTimerAsynchronously(
                plugin,
                this::sendPendingScoringPayloads,
                30 * 20L,
                30 * 20L
            );
        }
    }

    static String[] parseTarget(String botUrl) {
        String raw = botUrl == null ? "" : botUrl.trim();
        String parsedScheme = "ws";
        if (raw.regionMatches(true, 0, "wss://", 0, 6)) {
            parsedScheme = "wss";
            raw = raw.substring(6);
        } else if (raw.regionMatches(true, 0, "https://", 0, 8)) {
            parsedScheme = "wss";
            raw = raw.substring(8);
        } else if (raw.regionMatches(true, 0, "ws://", 0, 5)) {
            raw = raw.substring(5);
        } else if (raw.regionMatches(true, 0, "http://", 0, 7)) {
            raw = raw.substring(7);
        }
        while (raw.endsWith("/")) {
            raw = raw.substring(0, raw.length() - 1);
        }
        if (raw.isEmpty()) {
            raw = "localhost";
        }
        String parsedHost = raw;
        String parsedPort = "25565";
        int colon = raw.lastIndexOf(':');
        if (colon >= 0 && raw.substring(colon + 1).matches("\\d+")) {
            parsedHost = raw.substring(0, colon);
            parsedPort = raw.substring(colon + 1);
            if (parsedHost.isEmpty()) {
                parsedHost = "localhost";
            }
        }
        return new String[]{parsedScheme, parsedHost, parsedPort};
    }

    /**
     * Builds the WebSocket URI from the configured bot address.
     * Accepts a plain "host:port" value and adds the scheme itself, so
     * config files never need a "ws://" prefix. A missing port defaults
     * to the bot default of 25565.
     */
    public static String buildWebSocketUri(String botUrl) {
        String[] target = parseTarget(botUrl);
        return target[0] + "://" + target[1] + ":" + target[2] + "/rbw/websocket";
    }

    public static String buildApiBaseUrl(String botUrl) {
        String[] target = parseTarget(botUrl);
        String scheme = "wss".equals(target[0]) ? "https" : "http";
        return scheme + "://" + target[1] + ":" + target[2] + "/rbw/api";
    }

    private String buildWebSocketUri() {
        return scheme + "://" + host + ":" + port + "/rbw/websocket";
    }
    
    private void testConnectivity() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                plugin.getLogger().info("Testing basic connectivity to " + host + ":" + port + "...");
                
                java.net.Socket testSocket = new java.net.Socket();
                testSocket.setSoTimeout(10000);
                testSocket.connect(new java.net.InetSocketAddress(host, port), 10000);
                testSocket.close();
                
                plugin.getLogger().info("Basic connectivity test PASSED - server is reachable");
            } catch (java.io.IOException e) {
                plugin.getLogger().warning("Basic connectivity test FAILED: " + e.getMessage());
                plugin.getLogger().warning("Check that " + host + ":" + port + " is reachable and no firewall blocks it");
            }
        });
    }
    

    
    private void displayConnectionSuccess() {
        org.bukkit.command.ConsoleCommandSender console = Bukkit.getConsoleSender();
        console.sendMessage("");
        console.sendMessage("§6WebSocket §aConnection §2ESTABLISHED");
        console.sendMessage("");
        
        plugin.getLogger().info("WebSocket connection established - automatically sending initial data");
    }

    private void connect() {
        if (client != null && client.isOpen()) {
            plugin.debug("connection already exists");
            return;
        }
        
        try {
            URI serverUri = new URI(buildWebSocketUri());
            client = new WebSocketClient(serverUri) {
                @Override
                public void onOpen(ServerHandshake handshake) {
                    boolean wasReconnecting = reconnectAttempts.get() > 0;
                    reconnectAttempts.set(0); 
                    reconnectScheduled.set(false); 
                    
                    JsonObject authMsg = new JsonObject();
                    authMsg.addProperty("type", "auth");
                    authMsg.addProperty("auth_key", authKey);
                    send(authMsg.toString());
                    
                    Bukkit.getScheduler().runTask(plugin, WebSocketManager.this::displayConnectionSuccess);
                    
                    if (wasReconnecting) {
                        plugin.getLogger().info("WebSocket connection re-established after reconnection attempts");
                        notifyAdmins("§a[RankedBedwars] §2WebSocket connection re-established successfully.");
                    }
                    
                    sendInitialData();
                }
                @Override
                public void onMessage(String message) {
                    try {
                        handleIncomingMessage(message);
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.WARNING, "Error handling WebSocket message: " + message, e);
                    }
                }
                @Override
                public void onClose(int code, String reason, boolean remote) {
                    stopActionBarTask();
                    if (remote) {
                        plugin.getLogger().warning("WebSocket connection closed by server: " + reason + " (code: " + code + ")");
                        plugin.getLogger().warning("The RankedBedwars bot might have restarted or shut down");
                    } else {
                        plugin.getLogger().warning("WebSocket connection closed: " + reason + " (code: " + code + ")");
                    }
                    
                    if (plugin.isEnabled() && !reconnectScheduled.get()) {
                        scheduleReconnect();
                    }
                }
                @Override
                public void onError(Exception ex) {
                    if (client == null || !client.isOpen()) {
                        if (ex instanceof java.net.ConnectException) {
                            String message = ex.getMessage();
                            if (message.contains("Connection refused")) {
                                plugin.getLogger().warning("WebSocket connection refused - Bot server appears to be offline");
                                plugin.getLogger().warning("Make sure the RankedBedwars bot is running on " + host + ":" + port);
                            } else if (message.contains("Connection timed out")) {
                                plugin.getLogger().warning("WebSocket connection timed out - check network, firewall, and bot load");
                            } else {
                                plugin.getLogger().warning("WebSocket connection error: " + message);
                            }
                        } else {
                            plugin.getLogger().log(Level.WARNING, "WebSocket error", ex);
                        }
                        scheduleReconnect();
                    } else {
                        plugin.getLogger().log(Level.WARNING, "WebSocket error (but still connected)", ex);
                    }
                }
            };
            
            client.setConnectionLostTimeout(30);
            client.setTcpNoDelay(true);

            plugin.getLogger().info("Attempting WebSocket connection to: " + serverUri.toString());

            boolean connected = client.connectBlocking(30, java.util.concurrent.TimeUnit.SECONDS);
            if (!connected) {
                plugin.getLogger().warning("WebSocket connection timed out after 30 seconds");

                Bukkit.getScheduler().runTaskLater(plugin, () -> {
                    if (client == null || !client.isOpen()) {
                        plugin.getLogger().warning("Alternative connection method also failed");
                        scheduleReconnect();
                    }
                }, 20L * 10);
            }
        } catch (InterruptedException e) {
            plugin.getLogger().log(Level.WARNING, "WebSocket connection interrupted", e);
            Thread.currentThread().interrupt();
            scheduleReconnect();
        } catch (URISyntaxException | IllegalStateException e) {
            plugin.getLogger().log(Level.WARNING, "WebSocket connection failed", e);
            scheduleReconnect();
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Unexpected error during WebSocket connection", e);
            scheduleReconnect();
        }
    }
    private void handleIncomingMessage(String message) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            plugin.debug("Received WebSocket message: " + message);
            JsonObject json;
            try {
                json = JsonParser.parseString(message).getAsJsonObject();
                if (!json.has("type")) {
                    plugin.getLogger().warning("Received WebSocket message without 'type' field: " + message);
                    return;
                }
                String type = json.get("type").getAsString();
                switch (type) {
                    case "auth_success":
                        plugin.getLogger().info("WebSocket authentication successful");
                        break;
                    case "auth_failure":
                        plugin.getLogger().warning("WebSocket authentication failed: " + 
                            (json.has("message") ? json.get("message").getAsString() : "Invalid authentication key"));
                        if (client != null) {
                            client.close();
                        }
                        break;
                    case "verification":
                        Bukkit.getScheduler().runTask(plugin, () -> handleVerification(json));
                        break;
                    case "warp_players":
                        handleWarpPlayersAsync(json);
                        break;
                    case "check_player":
                        Bukkit.getScheduler().runTask(plugin, () -> handleCheckPlayer(json));
                        break;
                    case "check_bedwars_players":
                        Bukkit.getScheduler().runTask(plugin, () -> handleCheckBedwarsPlayers(json));
                        break;
                    case "request_maps":
                        if (plugin.getMapManager() != null) {
                            plugin.getMapManager().sendMapInfoToBot();
                        }
                        break;
                    case "pong":
                        if (json.has("ping_id")) {
                            String pingId = json.get("ping_id").getAsString();
                            if (plugin.getAdminCommand() != null) {
                                plugin.getAdminCommand().handleWebSocketPong(pingId);
                            }
                        }
                        break;
                    case "ping":
                        sendPong();
                        break;
                    case "callsuccess":
                        handleCallSuccess(json);
                        break;
                    case "callfailure":
                        handleCallFailure(json);
                        break;
                    case "queuefromingame_success":
                        handleQueueSuccess(json);
                        break;
                    case "queuefromingame_fail":
                        handleQueueFailure(json);
                        break;
                    case "privatefromingame_success":
                        handlePrivateSuccess(json);
                        break;
                    case "privatefromingame_fail":
                        handlePrivateFailure(json);
                        break;
                    case "party_result":
                        Bukkit.getScheduler().runTask(plugin, () -> handlePartyResult(json));
                        break;
                    case "party_notify":
                        Bukkit.getScheduler().runTask(plugin, () -> handlePartyNotify(json));
                        break;
                    case "party_invite":
                        Bukkit.getScheduler().runTask(plugin, () -> handlePartyInvite(json));
                        break;
                    case "party_duel":
                        Bukkit.getScheduler().runTask(plugin, () -> handlePartyDuel(json));
                        break;
                    case "host_private_game":
                        handleHostPrivateGameAsync(json);
                        break;
                    case "vc_chat":
                        Bukkit.getScheduler().runTask(plugin, () -> handleVcChat(json));
                        break;
                    case "scoringsettled":
                        handleScoringSettled(json);
                        break;
                    case "queuestatus":
                        handleQueueStatus(json);
                        break;
                    case "leaderboard_data":
                        handleLeaderboardData(json);
                        break;
                    case "stats_data":
                        handleStatsData(json);
                        break;
                    case "screensharedontlog":
                        Bukkit.getScheduler().runTask(plugin, () -> handleScreenshareDontLog(json));
                        break;
                    case "autoss_success":
                        Bukkit.getScheduler().runTask(plugin, () -> handleAutossSuccess(json));
                        break;
                    case "autoss_fail":
                        Bukkit.getScheduler().runTask(plugin, () -> handleAutossFail(json));
                        break;
                    case "botban":
                        handleBotBan(json);
                        break;
                    case "botmute":
                        handleBotMute(json);
                        break;
                    case "botunban":
                        handleBotUnban(json);
                        break;
                    case "botunmute":
                        handleBotUnmute(json);
                        break;
					case "scoringsuccess":
						Bukkit.getScheduler().runTask(plugin, () -> handleScoringSuccess(json));
						break;
					case "gamevoided":
						Bukkit.getScheduler().runTask(plugin, () -> handleGameVoided(json));
						break;
                    default:
                        plugin.getLogger().warning("Unknown message type: " + type);
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error parsing WebSocket message", e);
            }
        });
    }

    private void handleAutossSuccess(JsonObject json) {
        forwardAutoss(json, true);
    }

    private void handleAutossFail(JsonObject json) {
        forwardAutoss(json, false);
    }

    private void forwardAutoss(JsonObject json, boolean success) {
        String uuid = json.has("uuid") ? json.get("uuid").getAsString() : null;
        if (uuid != null) {
            org.bukkit.command.PluginCommand ssCmd = plugin.getServer().getPluginCommand("ss");
            if (ssCmd != null && ssCmd.getExecutor() instanceof com.deyo.rbw.commands.SsCmd) {
                com.deyo.rbw.commands.SsCmd executor = (com.deyo.rbw.commands.SsCmd) ssCmd.getExecutor();
                if (success) {
                    executor.handleAutossSuccess(uuid);
                } else {
                    executor.handleAutossFail(uuid);
                }
            }
        }
    }



    private void handleScreenshareDontLog(JsonObject json) {
        String ign = json.has("ign") ? json.get("ign").getAsString() : null;
        String uuid = json.has("uuid") ? json.get("uuid").getAsString() : null;
        if (ign == null || uuid == null) {
            replyDontLog(uuid, false, "Missing ign or uuid");
            return;
        }
        org.bukkit.entity.Player player = Bukkit.getPlayerExact(ign);
        if (player != null && player.isOnline()) {
            player.sendMessage("§c[RankedBedwars] §eYou are being requested for screenshare, do not log off the server.");
            replyDontLog(uuid, true, null);
        } else {
            replyDontLog(uuid, false, "Player not online");
        }
    }

    private void replyDontLog(String uuid, boolean success, String reason) {
        JsonObject response = new JsonObject();
        response.addProperty("type", success ? "screensharedontlog_success" : "screensharedontlog_failure");
        if (reason != null) {
            response.addProperty("reason", reason);
        }
        if (uuid != null) {
            response.addProperty("uuid", uuid);
        }
        sendMessage(response.toString());
    }
    private void handleVerification(JsonObject json) {
        String ign = json.get("ign").getAsString();
        String code = json.get("code").getAsString();
        org.bukkit.entity.Player player = Bukkit.getPlayerExact(ign);
        if (player != null) {
            player.sendMessage("§6§l[RBW] §aYour verification code is: §e§l" + code);
            player.sendMessage("§6§l[RBW] §aEnter this code on Discord to complete verification.");
            plugin.getLogger().info("Sent verification code to player: " + ign);
        } else {
            plugin.getLogger().info("Player not online for verification: " + ign);
        }
    }
    private void handleWarpPlayersAsync(JsonObject json) {
        String gameId = json.get("game_id").getAsString();
        String map = json.get("map").getAsString();
        boolean isRanked = json.get("is_ranked").getAsBoolean();
        JsonObject team1Json = json.getAsJsonObject("team1");
        JsonObject team2Json = json.getAsJsonObject("team2");
        plugin.getLogger().info("Received warp request for game #" + gameId + " on map " + map);


        if (!com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() || 
            !com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().arenaExists(map)) {
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_failed_arena_not_found");
            response.addProperty("game_id", gameId);
            response.addProperty("map", map);
            sendMessage(response.toString());
            plugin.getLogger().warning("Warp failed: arena not found for map '" + map + "'");
            return;
        }

        
        java.util.List<String> allPlayers = new java.util.ArrayList<>();
        allPlayers.addAll(readTeamNames(team1Json));
        allPlayers.addAll(readTeamNames(team2Json));
        
        java.util.List<String> offlinePlayers = new java.util.ArrayList<>();
        for (String ign : allPlayers) {
            if (Bukkit.getPlayerExact(ign) == null) {
                offlinePlayers.add(ign);
            }
        }
        if (!offlinePlayers.isEmpty()) {
            
            JsonObject response = new JsonObject();
            response.addProperty("type", "warp_failed_offline_players");
            response.addProperty("game_id", gameId);
            JsonArray offlineArray = new JsonArray();
            for (String ign : offlinePlayers) {
                offlineArray.add(ign);
            }
            response.add("offline_players", offlineArray);
            sendMessage(response.toString());
            plugin.getLogger().warning("Warp failed for offline players: " + offlinePlayers);
            
            return;
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            plugin.getMapManager().warpPlayersToGame(gameId, map, team1Json, team2Json, isRanked);
        });
    }
    private java.util.List<String> readTeamNames(JsonObject team) {
        java.util.List<String> names = new java.util.ArrayList<>();
        if (team.has("players")) {
            for (JsonElement playerElement : team.getAsJsonArray("players")) {
                names.add(playerElement.getAsString());
            }
        }
        return names;
    }
    private void handleCheckPlayer(JsonObject json) {
        String ign = json.get("ign").getAsString();
        Player player = Bukkit.getPlayerExact(ign);
        JsonObject response = new JsonObject();
        response.addProperty("type", "player_status");
        response.addProperty("ign", ign);
        response.addProperty("online", player != null);
        response.addProperty("original_ign_case", ign);
        sendMessage(response.toString());
    }
    private void handleCheckBedwarsPlayers(JsonObject json) {
        JsonObject response = new JsonObject();
        response.addProperty("type", "bedwars_players_status");
        if (json.has("request_id")) {
            response.addProperty("request_id", json.get("request_id").getAsString());
        }

        JsonObject players = new JsonObject();
        JsonObject onlinePlayers = new JsonObject();
        if (json.has("igns") && json.get("igns").isJsonArray()) {
            for (JsonElement element : json.getAsJsonArray("igns")) {
                String ign = element.getAsString();
                Player player = Bukkit.getPlayerExact(ign);
                onlinePlayers.addProperty(ign, player != null);
                players.addProperty(ign, plugin.isInBedwarsGame(player));
            }
        }
        response.add("players", players);
        response.add("online", onlinePlayers);
        sendMessage(response.toString());
    }
    private void sendPong() {
        JsonObject pong = new JsonObject();
        pong.addProperty("type", "pong");
        pong.addProperty("timestamp", System.currentTimeMillis());
        
        pong.addProperty("server_online", Bukkit.getOnlinePlayers().size());
        pong.addProperty("server_max", Bukkit.getMaxPlayers());
        pong.addProperty("server_tps", getServerTPS());
        
        sendMessage(pong.toString());
    }
    
    private double getServerTPS() {
        try {
            Object serverInstance = Bukkit.getServer().getClass().getMethod("getServer").invoke(Bukkit.getServer());
            double[] tps = (double[]) serverInstance.getClass().getField("recentTps").get(serverInstance);
            return tps[0]; 
        } catch (Exception e) {
            return 20.0;
        }
    }

    public void sendMessage(String message) {
        if (client != null && client.isOpen()) {
            client.send(message);
            
            if (!message.contains("\"type\":\"maps_info\"")) {
                plugin.debug("Sent WebSocket message: " + message);
            }
        } else {
            plugin.getLogger().warning("Cannot send WebSocket message: connection is closed");
            
            if (!reconnectScheduled.get()) {
                notifyAdmins("§c[RankedBedwars] §4WebSocket connection is closed. Cannot send messages to the bot. Please contact deyo.");
                
                if (plugin.isEnabled()) {
                    scheduleReconnect();
                }
            }
        }
    }
    public void sendGameScoring(Game game) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("type", "scoring");
            json.addProperty("game_id", game.getGameId());
            
            if (game.getMvps() != null && !game.getMvps().isEmpty()) {
                json.add("mvps", toJsonArray(game.getMvps()));
            }
            if (game.getBedBreakers() != null && !game.getBedBreakers().isEmpty()) {
                json.add("beds_broken", toJsonArray(game.getBedBreakers()));
            }
            JsonObject playersJson = new JsonObject();
            for (String playerName : game.getPlayerKills().keySet()) {
                JsonObject playerJson = new JsonObject();
                playerJson.addProperty("kills", game.getPlayerKills().getOrDefault(playerName, 0));
                playerJson.addProperty("deaths", game.getPlayerDeaths().getOrDefault(playerName, 0));
                playerJson.addProperty("final_kills", game.getPlayerFinalKills().getOrDefault(playerName, 0));
                playerJson.addProperty("blocks_placed", game.getPlayerBlocksPlaced().getOrDefault(playerName, 0));
                playerJson.addProperty("diamonds", game.getPlayerDiamondsCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("irons", game.getPlayerIronCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("gold", game.getPlayerGoldCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("emeralds", game.getPlayerEmeraldsCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("damage_dealt", game.getPlayerDamageDealt().getOrDefault(playerName, 0.0));
                playerJson.addProperty("damage_taken", game.getPlayerDamageTaken().getOrDefault(playerName, 0.0));
                playerJson.addProperty("assists", game.getPlayerAssists().getOrDefault(playerName, 0));
                playerJson.addProperty("max_streak", game.getPlayerMaxStreak().getOrDefault(playerName, 0));
                playerJson.addProperty("first_blood", playerName.equals(game.getFirstBlood()));
                JsonObject fightsJson = new JsonObject();
                Map<String, Game.FightStats> fights = game.getPlayerFights().getOrDefault(playerName, java.util.Collections.emptyMap());
                for (Map.Entry<String, Game.FightStats> fight : fights.entrySet()) {
                    JsonObject fightJson = new JsonObject();
                    fightJson.addProperty("kills", fight.getValue().getKills());
                    fightJson.addProperty("damage_dealt", fight.getValue().getDamage());
                    fightsJson.add(fight.getKey(), fightJson);
                }
                playerJson.add("fights", fightsJson);
                playersJson.add(playerName, playerJson);
            }
            json.add("players", playersJson);
            
            if (game.getTimeline() != null && !game.getTimeline().isEmpty()) {
                JsonArray timelineArray = new JsonArray();
                for (Map<String, Object> event : game.getTimeline()) {
                    JsonObject eventJson = new JsonObject();
                    for (Map.Entry<String, Object> entry : event.entrySet()) {
                        Object value = entry.getValue();
                        if (value instanceof Number) eventJson.addProperty(entry.getKey(), (Number) value);
                        else if (value instanceof Boolean) eventJson.addProperty(entry.getKey(), (Boolean) value);
                        else if (value == null) eventJson.add(entry.getKey(), com.google.gson.JsonNull.INSTANCE);
                        else eventJson.addProperty(entry.getKey(), String.valueOf(value));
                    }
                    timelineArray.add(eventJson);
                }
                json.add("timeline", timelineArray);
            }
            
            int winningTeamNumber = game.getWinningTeamNumber();
            if (winningTeamNumber == 1 || winningTeamNumber == 2) {
                JsonArray winningTeamIgnList = new JsonArray();
                if (winningTeamNumber == 1) {
                    for (String player : game.getTeam1()) {
                        winningTeamIgnList.add(player);
                    }
                } else {
                    for (String player : game.getTeam2()) {
                        winningTeamIgnList.add(player);
                    }
                }
                json.add("winning_team_ign_list", winningTeamIgnList);
            } else {
                plugin.getLogger().warning("Not sending winning team for game " + game.getGameId() + ": winner not tracked");
            }
            
            if (plugin.getGameDataManager() != null) {
                plugin.getGameDataManager().savePendingScoringPayload(String.valueOf(game.getGameId()), json);
            }
            sendMessage(json.toString());

            if (plugin.getMapManager() != null) {
                String mapName = game.getMap();
                plugin.getMapManager().unlockMap(mapName);
                plugin.debug("Unlocked map after scoring: " + mapName);
            }
        });
    }
    public void sendGameVoiding(String gameId, String reason) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            JsonObject json = new JsonObject();
            json.addProperty("type", "voiding");
            json.addProperty("game_id", gameId);
            json.addProperty("reason", reason);
            if (plugin.getGameDataManager() != null) {
                plugin.getGameDataManager().savePendingVoidingPayload(gameId, json);
            }
            sendMessage(json.toString());
        });
    }

    private JsonArray toJsonArray(java.util.Collection<String> values) {
        JsonArray array = new JsonArray();
        for (String value : values) {
            array.add(value);
        }
        return array;
    }
    private void sendInitialData() {
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                plugin.getLogger().info("Sending initial data to WebSocket server...");
                JsonObject statusMessage = new JsonObject();
                statusMessage.addProperty("type", "server_status");
                statusMessage.addProperty("status", "connected");
                statusMessage.addProperty("timestamp", System.currentTimeMillis());
                sendMessage(statusMessage.toString());
                
                sendMapDataIfReady(0);
                if (plugin.getMapManager() != null) {
                    plugin.getMapManager().sendActiveGameStates();
                }
                sendPendingScoringPayloads();
                plugin.debug("Initial data sending process started");
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error sending initial data to WebSocket", e);
            }
        });
    }

    private void sendPendingScoringPayloads() {
        if (!isConnected() || plugin.getGameDataManager() == null) {
            return;
        }
        for (JsonObject payload : plugin.getGameDataManager().getPendingScoringPayloads()) {
            try {
                sendMessage(payload.toString());
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Failed to resend pending scoring payload", e);
            }
        }
    }
    private void sendMapDataIfReady(int attempt) {
        if (!isConnected()) {
            plugin.debug("WebSocket not connected, skipping map data send (attempt " + attempt + ")");
            return;
        }
        if (plugin.getMapManager() != null && !plugin.getMapManager().getMapNames().isEmpty()) {
            plugin.getMapManager().sendMapInfoToBot();
            plugin.getLogger().info("Successfully sent map data to WebSocket server (attempt " + attempt + ")");
        } else {
            plugin.debug("MapManager not ready or no maps available (attempt " + attempt + ")");
            if (attempt >= 3) {
                plugin.getLogger().warning("Failed to send map data after 3 attempts - MapManager may not be initialized");
            }
        }
    }
    public void resendInitialData() {
        if (isConnected()) {
            sendInitialData();
        } else {
            plugin.getLogger().warning("Cannot resend initial data: WebSocket not connected");
        }
    }
    private static final int MAX_RECONNECT_ATTEMPTS = 5;
    private static final int MAX_RECONNECT_DELAY_SECONDS = 60;

    private void scheduleReconnect() {
        if (!reconnectScheduled.compareAndSet(false, true)) {
            return;
        }
        if (!plugin.isEnabled()) {
            plugin.getLogger().warning("Plugin is disabled, not scheduling WebSocket reconnection.");
            reconnectScheduled.set(false);
            return;
        }

        if (client != null && client.isOpen()) {
            plugin.debug("WebSocket is already connected, skipping reconnection schedule");
            reconnectScheduled.set(false);
            return;
        }

        int attempt = reconnectAttempts.incrementAndGet();

        long exponential = (long) reconnectDelay * (1L << Math.min(attempt - 1, 4));
        long capped = Math.min(exponential, MAX_RECONNECT_DELAY_SECONDS);
        long jitterSeconds = ThreadLocalRandom.current().nextLong(0, 2);
        long currentDelay = Math.min(capped + jitterSeconds, MAX_RECONNECT_DELAY_SECONDS);

        plugin.getLogger().info("Scheduling WebSocket reconnection in " + currentDelay + " seconds (Attempt " + attempt + ")");

        if (attempt == MAX_RECONNECT_ATTEMPTS) {
            plugin.getLogger().severe("Failed to connect to WebSocket server after " + attempt + " attempts");
            plugin.getLogger().severe("The RankedBedwars bot appears to be offline. Please contact deyo.");
            notifyAdmins("§4[RankedBedwars] §cFailed to connect to WebSocket after " +
                attempt + " attempts. The bot is likely offline. Please contact deyo.");
        }

        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            if (!plugin.isEnabled()) {
                plugin.getLogger().warning("Plugin is disabled, aborting scheduled WebSocket reconnection.");
                reconnectScheduled.set(false);
                return;
            }

            if (client != null && client.isOpen()) {
                plugin.debug("WebSocket is already connected, canceling reconnection attempt");
                reconnectScheduled.set(false);
                return;
            }

            reconnectScheduled.set(false);
            plugin.getLogger().info("Attempting to reconnect to WebSocket server... (Attempt " + reconnectAttempts.get() + ")");
            connect();
        }, currentDelay * 20L);
    }

    /**
     * Sends a message to all admins/ops on the Bukkit main thread. Safe to
     * call from any thread (WebSocket threads, async scheduler threads).
     */
    private void notifyAdmins(String message) {
        Bukkit.getScheduler().runTask(plugin, () ->
            Bukkit.getOnlinePlayers().stream()
                .filter(p -> p.hasPermission("rankedbedwars.admin") || p.isOp())
                .forEach(p -> p.sendMessage(message))
        );
    }
    public boolean isConnected() {
        return client != null && client.isOpen();
    }
    public void shutdown() {
        plugin.getLogger().info("Shutting down WebSocket connection...");
        
        reconnectScheduled.set(false);
        stopActionBarTask();
        leaderboardCallbacks.clear();
        statsCallbacks.clear();

        if (client != null && client.isOpen()) {
            client.close(1000, "Plugin disabling");
        }
        client = null;
    }

    public void sendPingWithId(String pingId) {
        JsonObject pong = new JsonObject();
        pong.addProperty("type", "ping");
        pong.addProperty("ping_id", pingId);
        pong.addProperty("timestamp", System.currentTimeMillis());
        sendMessage(pong.toString());
    }

    public void requestLeaderboard(String mode, int page, java.util.function.Consumer<JsonObject> callback) {
        if (client == null || !client.isOpen()) {
            callback.accept(emptyLeaderboardResponse());
            return;
        }
        String requestId = "lb_" + System.currentTimeMillis() + "_" + ThreadLocalRandom.current().nextInt(100000);
        leaderboardCallbacks.put(requestId, callback);

        JsonObject request = new JsonObject();
        request.addProperty("type", "leaderboard_request");
        request.addProperty("request_id", requestId);
        request.addProperty("mode", mode);
        request.addProperty("page", page);
        sendMessage(request.toString());

        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            java.util.function.Consumer<JsonObject> pending = leaderboardCallbacks.remove(requestId);
            if (pending != null) {
                pending.accept(emptyLeaderboardResponse());
            }
        }, 100L);
    }

    private void handleLeaderboardData(JsonObject json) {
        if (!json.has("request_id")) return;
        java.util.function.Consumer<JsonObject> callback =
                leaderboardCallbacks.remove(json.get("request_id").getAsString());
        if (callback != null) {
            callback.accept(json);
        }
    }

    public void requestUserStats(String ign, java.util.function.Consumer<JsonObject> callback) {
        if (client == null || !client.isOpen()) {
            callback.accept(new JsonObject());
            return;
        }
        String requestId = "stats_" + System.currentTimeMillis() + "_" + ThreadLocalRandom.current().nextInt(100000);
        statsCallbacks.put(requestId, callback);

        JsonObject request = new JsonObject();
        request.addProperty("type", "stats_request");
        request.addProperty("request_id", requestId);
        request.addProperty("ign", ign);
        sendMessage(request.toString());

        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            java.util.function.Consumer<JsonObject> pending = statsCallbacks.remove(requestId);
            if (pending != null) {
                pending.accept(new JsonObject());
            }
        }, 100L);
    }

    private void handleStatsData(JsonObject json) {
        if (!json.has("request_id")) return;
        java.util.function.Consumer<JsonObject> callback =
                statsCallbacks.remove(json.get("request_id").getAsString());
        if (callback != null) {
            callback.accept(json);
        }
    }

    private JsonObject emptyLeaderboardResponse() {
        JsonObject response = new JsonObject();
        response.add("entries", new JsonObject());
        return response;
    }

    public void resetReconnectionState() {
        reconnectAttempts.set(0);
        reconnectScheduled.set(false);
        plugin.getLogger().info("WebSocket reconnection state has been reset");
    }
    
    public void diagnoseConnection() {
        plugin.getLogger().info("=== WebSocket Connection Diagnosis ===");
        plugin.getLogger().info("Target Bot: " + host + ":" + port);
        plugin.getLogger().info("Full URL: " + buildWebSocketUri());
        plugin.getLogger().info("Current Connection State: " + (isConnected() ? "CONNECTED" : "DISCONNECTED"));
        plugin.getLogger().info("Reconnect Attempts: " + reconnectAttempts.get());
        plugin.getLogger().info("Reconnect Scheduled: " + reconnectScheduled.get());
        
        testConnectivity();
        
        plugin.getLogger().info("=== End Diagnosis ===");
    }
    
    private void handleCallSuccess(JsonObject json) {
        if (json.has("call_id") && plugin.getCallCommand() != null) {
            plugin.getCallCommand().handleCallSuccess(json.get("call_id").getAsString());
        }
    }

    private void handleCallFailure(JsonObject json) {
        if (json.has("call_id") && plugin.getCallCommand() != null) {
            String reason = json.has("reason") ? json.get("reason").getAsString() : "Unknown error";
            plugin.getCallCommand().handleCallFailure(json.get("call_id").getAsString(), reason);
        }
    }

    private void handleQueueSuccess(JsonObject json) {
        if (json.has("uuid") && plugin.getQueueCommand() != null) {
            plugin.getQueueCommand().handleQueueSuccess(json.get("uuid").getAsString());
        }
    }

    private void handleQueueFailure(JsonObject json) {
        if (json.has("uuid") && plugin.getQueueCommand() != null) {
            String reason = json.has("reason") ? json.get("reason").getAsString() : "Unknown error";
            plugin.getQueueCommand().handleQueueFailure(json.get("uuid").getAsString(), reason);
        }
    }

    private void handlePrivateSuccess(JsonObject json) {
        if (json.has("uuid") && plugin.getPrivateCommand() != null) {
            String map = json.has("map") ? json.get("map").getAsString() : "";
            plugin.getPrivateCommand().handlePrivateSuccess(json.get("uuid").getAsString(), map);
        }
    }

    private void handlePrivateFailure(JsonObject json) {
        if (json.has("uuid") && plugin.getPrivateCommand() != null) {
            String reason = json.has("reason") ? json.get("reason").getAsString() : "Unknown error";
            plugin.getPrivateCommand().handlePrivateFailure(json.get("uuid").getAsString(), reason);
        }
    }

    private void handleHostPrivateGameAsync(JsonObject json) {
        String requestId = json.has("request_id") ? json.get("request_id").getAsString() : "";
        String requestedMap = json.has("map") && !json.get("map").isJsonNull() ? json.get("map").getAsString() : "random";

        List<List<String>> teams = new ArrayList<>();
        if (json.has("teams") && json.get("teams").isJsonArray()) {
            for (JsonElement element : json.getAsJsonArray("teams")) {
                teams.add(readStringList(element.getAsJsonArray()));
            }
        } else {
            List<String> players = json.has("players") && json.get("players").isJsonArray()
                    ? readStringList(json.getAsJsonArray("players"))
                    : Collections.emptyList();
            if (players.size() < 2) {
                replyHostPrivateGame(requestId, false, "A private game needs at least 2 players", null, players, Collections.emptyList());
                return;
            }
            teams.add(new ArrayList<>(players.subList(0, players.size() / 2)));
            teams.add(new ArrayList<>(players.subList(players.size() / 2, players.size())));
        }

        String arena = pickPrivateArena(requestedMap);
        if (arena == null) {
            replyHostPrivateGame(requestId, false, requestedMap.equalsIgnoreCase("random")
                    ? "No arena is free right now" : "Arena '" + requestedMap + "' is not available", null, Collections.emptyList(), Collections.emptyList());
            return;
        }

        JsonObject team1 = new JsonObject();
        team1.add("players", toJsonArray(teams.get(0)));
        JsonObject team2 = new JsonObject();
        team2.add("players", toJsonArray(teams.get(1)));

        List<String> allPlayers = new ArrayList<>();
        allPlayers.addAll(teams.get(0));
        allPlayers.addAll(teams.get(1));
        List<String> missing = allPlayers.stream()
                .filter(ign -> Bukkit.getPlayerExact(ign) == null)
                .collect(Collectors.toList());

        Bukkit.getScheduler().runTask(plugin, () -> {
            if (plugin.getMapManager() == null) {
                replyHostPrivateGame(requestId, false, "The server is still starting up", arena, Collections.emptyList(), missing);
                return;
            }
            plugin.getMapManager().hostPrivateGame(requestId, arena, team1, team2, missing, () ->
                replyHostPrivateGame(requestId, true, "Hosting on " + arena, arena, joinedPlayers(allPlayers), missing));
        });
    }

    private List<String> joinedPlayers(List<String> allPlayers) {
        return allPlayers.stream()
                .filter(ign -> Bukkit.getPlayerExact(ign) != null)
                .collect(Collectors.toList());
    }

    private List<String> readStringList(JsonArray array) {
        List<String> values = new ArrayList<>();
        for (JsonElement element : array) {
            values.add(element.getAsString());
        }
        return values;
    }

    /** Resolves the requested map/group to a free physical arena, or null when nothing is usable. */
    private String pickPrivateArena(String requestedMap) {
        if (plugin.getMapManager() == null) {
            return null;
        }
        MapManager maps = plugin.getMapManager();
        if (requestedMap == null || requestedMap.isEmpty() || requestedMap.equalsIgnoreCase("random")) {
            for (String groupId : maps.getAvailableArenaGroups()) {
                String arena = maps.getBestArenaForGroup(groupId, false);
                if (arena != null) {
                    return arena;
                }
            }
            return null;
        }
        if (maps.getArenaGroupIds().contains(requestedMap)) {
            return maps.getBestArenaForGroup(requestedMap, false);
        }
        if (maps.getMapNames().contains(requestedMap)) {
            return requestedMap;
        }
        return null;
    }

    private void replyHostPrivateGame(String requestId, boolean ok, String message, String map,
                                      List<String> players, List<String> missing) {
        JsonObject response = new JsonObject();
        response.addProperty("type", "host_private_game_result");
        response.addProperty("request_id", requestId);
        response.addProperty("ok", ok);
        response.addProperty("message", message);
        if (map != null) {
            response.addProperty("map", map);
        }
        response.add("players", toJsonArray(players));
        response.add("missing", toJsonArray(missing));
        sendMessage(response.toString());
    }

    public void sendHostPrivateGameResult(String requestId, boolean ok, String message) {
        replyHostPrivateGame(requestId, ok, message, null, Collections.emptyList(), Collections.emptyList());
    }

    private void handlePartyResult(JsonObject json) {
        if (plugin.getPartyCommand() != null) {
            plugin.getPartyCommand().handlePartyResult(json);
        }
    }

    private void handlePartyNotify(JsonObject json) {
        if (!json.has("igns") || !json.get("igns").isJsonArray()) {
            return;
        }
        String message = json.has("message") ? json.get("message").getAsString() : "";
        for (String ign : readStringList(json.getAsJsonArray("igns"))) {
            Player player = Bukkit.getPlayerExact(ign);
            if (player != null) {
                player.sendMessage(ChatColor.GOLD + "[Party] " + ChatColor.WHITE + message);
            }
        }
    }

    private void handlePartyInvite(JsonObject json) {
        if (!json.has("ign")) {
            return;
        }
        String from = json.has("from") ? json.get("from").getAsString() : "Someone";
        if (plugin.getPartyCommand() != null) {
            plugin.getPartyCommand().handlePartyInvite(json.get("ign").getAsString(), from);
        } else {
            Player player = Bukkit.getPlayerExact(json.get("ign").getAsString());
            if (player != null) {
                player.sendMessage(ChatColor.YELLOW + from + " invited you to their party. Use /party accept to join.");
            }
        }
    }

    private void handlePartyDuel(JsonObject json) {
        if (!json.has("ign")) {
            return;
        }
        String from = json.has("from") ? json.get("from").getAsString() : "Someone";
        int size = json.has("size") ? json.get("size").getAsInt() : 0;
        if (plugin.getPartyCommand() != null) {
            plugin.getPartyCommand().handlePartyDuel(json.get("ign").getAsString(), from, size);
        } else {
            Player player = Bukkit.getPlayerExact(json.get("ign").getAsString());
            if (player != null) {
                player.sendMessage(ChatColor.YELLOW + from + "'s party (" + size + ") challenged you to a duel. Use /party duel " + from + " to accept.");
            }
        }
    }

    /** Discord VC chat for a ranked game, shown to that team's players in game. */
    private void handleVcChat(JsonObject json) {
        if (!json.has("game_id") || !json.has("team") || !json.has("ign") || !json.has("message")) {
            return;
        }
        if (plugin.getGameDataManager() == null) {
            return;
        }
        String gameId = json.get("game_id").getAsString();
        int team = json.get("team").getAsInt();
        String ign = json.get("ign").getAsString();
        String message = json.get("message").getAsString();
        Integer elo = json.has("elo") && !json.get("elo").isJsonNull() ? json.get("elo").getAsInt() : null;
        boolean registered = json.has("registered") && json.get("registered").getAsBoolean();

        List<String> receivers = plugin.getGameDataManager().findGameTeamPlayers(gameId, team);
        if (receivers == null || receivers.isEmpty()) {
            return;
        }

        String prefix = registered
                ? ChatColor.AQUA + "VC " + (elo != null ? ChatColor.GRAY + "[" + elo + "] " : "") + ChatColor.YELLOW + ign + ChatColor.GRAY + ": "
                : ChatColor.AQUA + "VC " + ChatColor.GRAY + "[" + ChatColor.RED + "NR" + ChatColor.GRAY + "] " + ChatColor.YELLOW + ign + ChatColor.GRAY + ": ";
        String line = prefix + ChatColor.WHITE + message;

        for (String receiver : receivers) {
            Player player = Bukkit.getPlayerExact(receiver);
            if (player != null) {
                player.sendMessage(line);
            }
        }
    }

    private void handleQueueStatus(JsonObject json) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                if (!json.has("queues")) {
                    return;
                }
                JsonObject queues = json.getAsJsonObject("queues");
                java.util.Map<String, String> bars = new java.util.HashMap<>();
                for (String queueId : queues.keySet()) {
                    JsonElement queueElement = queues.get(queueId);
                    if (queueElement != null && queueElement.isJsonObject()) {
                        collectQueueActionBars(queueElement.getAsJsonObject(), bars);
                    }
                }
                Bukkit.getScheduler().runTask(plugin, () -> updateQueueActionBars(bars));
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error handling queue status", e);
            }
        });
    }

    private void collectQueueActionBars(JsonObject queue, java.util.Map<String, String> bars) {
        if (queue == null || !queue.has("players") || !queue.get("players").isJsonArray()) {
            return;
        }

        int minElo = queue.has("min_elo") ? queue.get("min_elo").getAsInt() : 0;
        int maxElo = queue.has("max_elo") ? queue.get("max_elo").getAsInt() : 0;
        int currentPlayers = queue.has("current_players") ? queue.get("current_players").getAsInt() : 0;
        int maxPlayers = queue.has("max_players") ? queue.get("max_players").getAsInt() : 0;
        String queueMessage = String.format("§6In Queue §e[%d-%d] §f%d/%d",
                minElo, maxElo, currentPlayers, maxPlayers);

        JsonArray playersArray = queue.getAsJsonArray("players");
        for (int i = 0; i < playersArray.size(); i++) {
            JsonElement playerElement = playersArray.get(i);
            if (playerElement != null && playerElement.isJsonPrimitive()) {
                bars.put(playerElement.getAsString(), queueMessage);
            }
        }
    }

    private void updateQueueActionBars(java.util.Map<String, String> bars) {
        actionBars.clear();
        actionBars.putAll(bars);
        if (actionBars.isEmpty()) {
            stopActionBarTask();
        } else {
            startActionBarTask();
        }
    }

    private void startActionBarTask() {
        if (actionBarTask != null) {
            return;
        }
        actionBarTask = Bukkit.getScheduler().runTaskTimer(plugin, this::pushQueueActionBars, 0L, 20L);
    }

    private void pushQueueActionBars() {
        if (actionBars.isEmpty()) {
            stopActionBarTask();
            return;
        }
        for (java.util.Map.Entry<String, String> entry : actionBars.entrySet()) {
            Player player = Bukkit.getPlayerExact(entry.getKey());
            if (player != null && player.isOnline()) {
                sendActionBar(player, entry.getValue());
            }
        }
    }

    private void stopActionBarTask() {
        if (actionBarTask != null) {
            actionBarTask.cancel();
            actionBarTask = null;
        }
        actionBars.clear();
    }
    
    private void sendActionBar(Player player, String message) {
        String legacyMessage = org.bukkit.ChatColor.translateAlternateColorCodes('&', message);

        if (!paperActionBarResolved) {
            paperActionBarResolved = true;
            try {
                paperActionBarMethod = player.getClass().getMethod("sendActionBar", String.class);
            } catch (NoSuchMethodException ignored) {
            }
        }
        if (paperActionBarMethod != null) {
            try {
                paperActionBarMethod.invoke(player, legacyMessage);
                return;
            } catch (Exception spigotError) {
                plugin.getLogger().log(Level.FINE, "Paper action bar send failed, falling back to NMS", spigotError);
            }
        }

        try {
            Class<?> craftPlayerClass = Class.forName("org.bukkit.craftbukkit." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".entity.CraftPlayer");
            java.lang.reflect.Method getHandleMethod = craftPlayerClass.getMethod("getHandle");
            Object entityPlayer = getHandleMethod.invoke(player);
            Class<?> playerConnectionClass = entityPlayer.getClass().getField("playerConnection").getType();
            java.lang.reflect.Method sendPacketMethod = playerConnectionClass.getMethod("sendPacket", Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".Packet"));
            Class<?> chatSerializerClass = Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".IChatBaseComponent$ChatSerializer");

            String jsonMessage = "{\"text\":\"" + escapeJson(legacyMessage) + "\"}";
            Object chatBaseComponent = chatSerializerClass.getMethod("a", String.class).invoke(null, jsonMessage);

            Class<?> packetPlayOutChatClass = Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".PacketPlayOutChat");
            Object packetPlayOutChat = packetPlayOutChatClass.getConstructor(Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".IChatBaseComponent"), byte.class).newInstance(chatBaseComponent, (byte) 2);
            sendPacketMethod.invoke(entityPlayer.getClass().getField("playerConnection").get(entityPlayer), packetPlayOutChat);
        } catch (Exception e) {
            if (actionBarFallbackShown.add(player.getUniqueId())) {
                plugin.getLogger().log(Level.WARNING, "Could not send action bar to " + player.getName()
                        + "; sending it as a chat message instead", e);
                player.sendMessage("§8[§6Queue§8] " + legacyMessage);
            }
        }
    }

    private static String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static final java.util.regex.Pattern IGN_PATTERN = java.util.regex.Pattern.compile("^[a-zA-Z0-9_]{1,16}$");

    private boolean isValidIgn(String ign) {
        return ign != null && IGN_PATTERN.matcher(ign).matches();
    }

    public void handleBotBan(JsonObject json) {
        handleTimedPunishment(json, "ban", "botban");
    }

    public void handleBotMute(JsonObject json) {
        handleTimedPunishment(json, "mute", "botmute");
    }

    public void handleBotUnban(JsonObject json) {
        handleSimplePunishment(json, "unban", "botunban");
    }

    public void handleBotUnmute(JsonObject json) {
        handleSimplePunishment(json, "unmute", "botunmute");
    }

    private void handleTimedPunishment(JsonObject json, String command, String logLabel) {
        String ign = json.get("ign").getAsString();
        if (!isValidIgn(ign)) {
            plugin.getLogger().warning("Rejected " + logLabel + " with invalid IGN: " + ign);
            return;
        }
        String reason = json.get("reason").getAsString();
        String duration = json.has("duration") && !json.get("duration").isJsonNull()
                ? " " + json.get("duration").getAsInt()
                : "";
        dispatchCommandOnMainThread(command + " " + ign + duration + " " + reason);
    }

    private void handleSimplePunishment(JsonObject json, String command, String logLabel) {
        String ign = json.get("ign").getAsString();
        if (!isValidIgn(ign)) {
            plugin.getLogger().warning("Rejected " + logLabel + " with invalid IGN: " + ign);
            return;
        }
        dispatchCommandOnMainThread(command + " " + ign + " " + json.get("reason").getAsString());
    }

    /**
     * Runs a console command on the Bukkit main thread. dispatchCommand is not
     * thread-safe and executes synchronously, so it must never run on a
     * WebSocket or async scheduler thread.
     */
    private void dispatchCommandOnMainThread(String command) {
        if (Bukkit.isPrimaryThread()) {
            Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
        } else {
            Bukkit.getScheduler().runTask(plugin, () -> Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command));
        }
    }

	private void handleScoringSuccess(JsonObject json) {
		int scoredGameId = parseGameId(json);
		if (scoredGameId > 0 && plugin.getGameDataManager() != null) {
			plugin.getGameDataManager().markScoringDelivered(String.valueOf(scoredGameId));
		}
		notifyGamePlayers(json, "§6§l[RBW] §aGame §e#" + scoredGameId + " §ahas been scored.", "scoringsuccess missing players array");
	}

	private void handleScoringSettled(JsonObject json) {
		int settledGameId = parseGameId(json);
		if (settledGameId > 0 && plugin.getGameDataManager() != null) {
			plugin.getGameDataManager().markScoringDelivered(String.valueOf(settledGameId));
		}
	}

	private void handleGameVoided(JsonObject json) {
		int voidedGameId = parseGameId(json);
		if (voidedGameId > 0 && plugin.getGameDataManager() != null) {
			plugin.getGameDataManager().markScoringDelivered(String.valueOf(voidedGameId));
		}
		String reason = json.has("reason") && !json.get("reason").isJsonNull() ? json.get("reason").getAsString() : "unspecified";
		notifyGamePlayers(json, "§6§l[RBW] §cGame §e#" + voidedGameId + " §chas been voided. §7Reason: §f" + reason, "gamevoided missing players array");
	}

    private void notifyGamePlayers(JsonObject json, String message, String missingPlayersWarning) {
		if (!json.has("players") || !json.get("players").isJsonArray()) {
			plugin.getLogger().warning(missingPlayersWarning);
			return;
		}
		JsonArray playersArray = json.getAsJsonArray("players");
		for (int i = 0; i < playersArray.size(); i++) {
			String playerName = playersArray.get(i).getAsString();
			org.bukkit.entity.Player player = Bukkit.getPlayerExact(playerName);
			if (player != null && player.isOnline()) {
				player.sendMessage(message);
			}
		}
	}

	/**
	 * Parses the game_id from a bot message. The bot may send it as a number or
	 * as a string; non-numeric ids are tolerated and reported as -1 instead of
	 * throwing NumberFormatException.
	 */
	static int parseGameId(JsonObject json) {
		if (!json.has("game_id") || json.get("game_id").isJsonNull()) {
			return -1;
		}
		JsonElement gameIdElement = json.get("game_id");
		try {
			return gameIdElement.isJsonPrimitive() && gameIdElement.getAsJsonPrimitive().isNumber()
					? gameIdElement.getAsInt()
					: Integer.parseInt(gameIdElement.getAsString());
		} catch (NumberFormatException e) {
			return -1;
		}
	}
}
