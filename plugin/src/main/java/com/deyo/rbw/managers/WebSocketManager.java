package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import lombok.Getter;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Map;
import java.util.logging.Level;



 
public class WebSocketManager {
    private final RankedBedwars plugin;
    @Getter
    private WebSocketClient client;
    private String host;
    private int port;
    private String scheme;
    private String authKey;
    private int reconnectDelay;
    private boolean reconnectScheduled = false;

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
    }

    static String[] parseTarget(String botUrl) {
        String raw = botUrl == null ? "" : botUrl.trim();
        String parsedScheme = "ws";
        if (raw.regionMatches(true, 0, "wss://", 0, 6)) {
            parsedScheme = "wss";
            raw = raw.substring(6);
        } else if (raw.regionMatches(true, 0, "ws://", 0, 5)) {
            raw = raw.substring(5);
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
        console.sendMessage("§6ZeroCode Studios §f- §cRankedBedwars Bot");
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
                    boolean wasReconnecting = reconnectAttempts > 0;
                    reconnectAttempts = 0; 
                    reconnectScheduled = false; 
                    
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
                    if (remote) {
                        plugin.getLogger().warning("WebSocket connection closed by server: " + reason + " (code: " + code + ")");
                        plugin.getLogger().warning("The RankedBedwars bot might have restarted or shut down");
                    } else {
                        plugin.getLogger().warning("WebSocket connection closed: " + reason + " (code: " + code + ")");
                    }
                    
                    if (plugin.isEnabled() && !reconnectScheduled) {
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
                    case "queuestatus":
                        handleQueueStatus(json);
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

        if (plugin.getMapManager() != null) {
            plugin.debug("Cleaning up existing game data before warping to prevent conflicts with game #" + gameId + " on map " + map);
            plugin.getMapManager().cleanupExistingGameForMap(map);
            plugin.debug("Cleanup completed, proceeding with warp request for game #" + gameId);
        }

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
        boolean isOnline = Bukkit.getPlayerExact(ign) != null;
        JsonObject response = new JsonObject();
        response.addProperty("type", "player_status");
        response.addProperty("ign", ign);
        response.addProperty("online", isOnline);
        response.addProperty("original_ign_case", ign);
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
            
            if (!reconnectScheduled) {
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
            
            sendMessage(json.toString());

            if (plugin.getMapManager() != null) {
                String mapName = game.getMap();
                plugin.getMapManager().unlockMap(mapName);
                plugin.debug("Unlocked map after scoring: " + mapName);
            }
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
                
                sendPermissionData();

                sendMapDataIfReady(0);
                plugin.debug("Initial data sending process started");
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error sending initial data to WebSocket", e);
            }
        });
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
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_ATTEMPTS = 5;
    
    private void scheduleReconnect() {
        if (reconnectScheduled) {
            return;
        }
        if (!plugin.isEnabled()) {
            plugin.getLogger().warning("Plugin is disabled, not scheduling WebSocket reconnection.");
            return;
        }
        
        if (client != null && client.isOpen()) {
            plugin.debug("WebSocket is already connected, skipping reconnection schedule");
            return;
        }
        
        reconnectScheduled = true;
        reconnectAttempts++;
        
        int currentDelay = Math.min(reconnectDelay * reconnectAttempts, 60); 
        
        plugin.getLogger().info("Scheduling WebSocket reconnection in " + currentDelay + " seconds (Attempt " + reconnectAttempts + ")");
        
        if (reconnectAttempts == MAX_RECONNECT_ATTEMPTS) {
            plugin.getLogger().severe("Failed to connect to WebSocket server after " + reconnectAttempts + " attempts");
            plugin.getLogger().severe("The RankedBedwars bot appears to be offline. Please contact deyo.");
            notifyAdmins("§4[RankedBedwars] §cFailed to connect to WebSocket after " +
                reconnectAttempts + " attempts. The bot is likely offline. Please contact deyo.");
        }

        Bukkit.getScheduler().runTaskLaterAsynchronously(plugin, () -> {
            if (!plugin.isEnabled()) {
                plugin.getLogger().warning("Plugin is disabled, aborting scheduled WebSocket reconnection.");
                reconnectScheduled = false;
                return;
            }
            
            if (client != null && client.isOpen()) {
                plugin.debug("WebSocket is already connected, canceling reconnection attempt");
                reconnectScheduled = false;
                return;
            }
            
            reconnectScheduled = false;
            plugin.getLogger().info("Attempting to reconnect to WebSocket server... (Attempt " + reconnectAttempts + ")");
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
        
        reconnectScheduled = false;
        
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

    private void sendPermissionData() {
        try {
            java.io.File permissionFile = new java.io.File(plugin.getDataFolder(), "permission.yml");
            if (!permissionFile.exists()) {
                plugin.saveResource("permission.yml", false);
                plugin.getLogger().info("Created default permission.yml file");
            }
            
            org.bukkit.configuration.file.YamlConfiguration permConfig = org.bukkit.configuration.file.YamlConfiguration.loadConfiguration(permissionFile);
            JsonObject permissionsJson = new JsonObject();
            permissionsJson.addProperty("type", "permission");
            
            for (String key : permConfig.getKeys(false)) {
                JsonArray userArray = new JsonArray();
                for (String user : permConfig.getStringList(key)) {
                    userArray.add(user);
                }
                permissionsJson.add(key, userArray);
            }
            
            plugin.debug("Sending permissions data to WebSocket server");
            sendMessage(permissionsJson.toString());
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Error sending permission data to WebSocket", e);
        }
    }

    public void resendPermissionsData() {
        if (isConnected()) {
            plugin.getLogger().info("Manually resending permissions data...");
            sendPermissionData();
        } else {
            plugin.getLogger().warning("Cannot resend permissions data: WebSocket not connected");
        }
    }
    

    public void resetReconnectionState() {
        reconnectAttempts = 0;
        reconnectScheduled = false;
        plugin.getLogger().info("WebSocket reconnection state has been reset");
    }
    
    public void diagnoseConnection() {
        plugin.getLogger().info("=== WebSocket Connection Diagnosis ===");
        plugin.getLogger().info("Target Bot: " + host + ":" + port);
        plugin.getLogger().info("Full URL: " + buildWebSocketUri());
        plugin.getLogger().info("Current Connection State: " + (isConnected() ? "CONNECTED" : "DISCONNECTED"));
        plugin.getLogger().info("Reconnect Attempts: " + reconnectAttempts);
        plugin.getLogger().info("Reconnect Scheduled: " + reconnectScheduled);
        
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
    
    private void handleQueueStatus(JsonObject json) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                if (!json.has("queues")) {
                    return;
                }
                JsonObject queues = json.getAsJsonObject("queues");
                for (String queueId : queues.keySet()) {
                    showQueueStatus(queues.getAsJsonObject(queueId));
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error handling queue status", e);
            }
        });
    }

    private void showQueueStatus(JsonObject queue) {
        if (!queue.has("players")) {
            return;
        }
        JsonArray playersArray = queue.getAsJsonArray("players");
        java.util.List<String> queuePlayers = new java.util.ArrayList<>();
        for (int i = 0; i < playersArray.size(); i++) {
            queuePlayers.add(playersArray.get(i).getAsString());
        }
        String queueMessage = String.format("§6In Queue [§e%d-%d§6] §f%d/%d §7Ranked: %s §7Picking: %s",
            queue.get("min_elo").getAsInt(), queue.get("max_elo").getAsInt(),
            queue.get("current_players").getAsInt(), queue.get("max_players").getAsInt(),
            queue.get("is_ranked").getAsBoolean() ? "§atrue" : "§cfalse",
            queue.get("is_picking").getAsBoolean() ? "§atrue" : "§cfalse"
        );
        Bukkit.getScheduler().runTask(plugin, () -> {
            for (String playerName : queuePlayers) {
                org.bukkit.entity.Player player = Bukkit.getPlayerExact(playerName);
                if (player != null && player.isOnline()) {
                    sendActionBar(player, queueMessage);
                }
            }
        });
    }
    
    private void sendActionBar(org.bukkit.entity.Player player, String message) {
        try {
            Class<?> craftPlayerClass = Class.forName("org.bukkit.craftbukkit." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".entity.CraftPlayer");
            java.lang.reflect.Method getHandleMethod = craftPlayerClass.getMethod("getHandle");
            Object entityPlayer = getHandleMethod.invoke(player);
            Class<?> playerConnectionClass = entityPlayer.getClass().getField("playerConnection").getType();
            java.lang.reflect.Method sendPacketMethod = playerConnectionClass.getMethod("sendPacket", Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".Packet"));
            Class<?> chatSerializerClass = Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".IChatBaseComponent$ChatSerializer");

            Object chatBaseComponent = chatSerializerClass.getMethod("a", String.class).invoke(null,
                    "{\"text\":\"" + org.bukkit.ChatColor.translateAlternateColorCodes('&', message) + "\",\"bold\":true,\"color\":\"red\",\"italic\":false}");

            Class<?> packetPlayOutChatClass = Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".PacketPlayOutChat");
            Object packetPlayOutChat = packetPlayOutChatClass.getConstructor(Class.forName("net.minecraft.server." + Bukkit.getServer().getClass().getPackage().getName().split("\\.")[3] + ".IChatBaseComponent"), byte.class).newInstance(chatBaseComponent, (byte) 2);
            sendPacketMethod.invoke(entityPlayer.getClass().getField("playerConnection").get(entityPlayer), packetPlayOutChat);
        } catch (ClassNotFoundException | NoSuchMethodException | IllegalAccessException | java.lang.reflect.InvocationTargetException | NoSuchFieldException | InstantiationException e) {
            player.sendMessage("§8[§6Queue§8] " + message);
        }
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
		notifyGamePlayers(json, "§6§l[RBW] §aGame §e#" + parseGameId(json) + " §ahas been scored.", "scoringsuccess missing players array");
	}

	private void handleGameVoided(JsonObject json) {
		String reason = json.has("reason") && !json.get("reason").isJsonNull() ? json.get("reason").getAsString() : "unspecified";
		notifyGamePlayers(json, "§6§l[RBW] §cGame §e#" + parseGameId(json) + " §chas been voided. §7Reason: §f" + reason, "gamevoided missing players array");
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
