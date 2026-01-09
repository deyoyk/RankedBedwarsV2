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
import java.util.logging.Level;



 
public class WebSocketManager {
    private final RankedBedwars plugin;
    @Getter
    private WebSocketClient client;
    private String host;
    private int port;
    private boolean explicitPortConfigured = false;
    private int reconnectDelay;
    private boolean reconnectScheduled = false;

    public WebSocketManager(RankedBedwars plugin) {
        this.plugin = plugin;
    }

    public void initialize() {
        
        FileConfiguration config = plugin.getConfig();
        host = config.getString("websocket.host", "rbw.deyo.lol");
        explicitPortConfigured = config.contains("websocket.port");
        if (explicitPortConfigured) {
            port = config.getInt("websocket.port");
        }
        reconnectDelay = 5;
        
        plugin.getLogger().info("Initializing WebSocket connection...");
        if (explicitPortConfigured) {
            plugin.getLogger().info("Target server: " + host + ":" + port);
            plugin.getLogger().info("Full WebSocket URL: ws://" + host + ":" + port + "/rbw/websocket");
        } else {
            plugin.getLogger().info("Target server: " + host);
            plugin.getLogger().info("Full WebSocket URL: ws://" + host + "/rbw/websocket");
        }
        plugin.getLogger().info("If connection fails, ensure the RankedBedwars bot is running and accessible");
        
        // Test basic connectivity first
        if (explicitPortConfigured) {
            testConnectivity();
        }
        
        connect();
    }
    
    private void testConnectivity() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                plugin.getLogger().info("Testing basic connectivity to " + host + ":" + port + "...");
                
                java.net.Socket testSocket = new java.net.Socket();
                testSocket.setSoTimeout(10000); // 10 second timeout
                testSocket.connect(new java.net.InetSocketAddress(host, port), 10000);
                testSocket.close();
                
                plugin.getLogger().info("Basic connectivity test PASSED - server is reachable");
            } catch (java.io.IOException e) {
                plugin.getLogger().warning("Basic connectivity test FAILED: " + e.getMessage());
                plugin.getLogger().warning("This suggests the server/port is not accessible from this network");
                plugin.getLogger().warning("Please verify:");
                plugin.getLogger().warning("1. The server " + host + " is online");
                plugin.getLogger().warning("2. Port " + port + " is open and accessible");
                plugin.getLogger().warning("3. No firewall is blocking the connection");
                plugin.getLogger().warning("4. Your network allows outbound connections to this port");
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
            URI serverUri = new URI(explicitPortConfigured
                    ? ("ws://" + host + ":" + port + "/rbw/websocket")
                    : ("ws://" + host + "/rbw/websocket"));
            client = new WebSocketClient(serverUri) {
                @Override
                public void onOpen(ServerHandshake handshake) {
                    boolean wasReconnecting = reconnectAttempts > 0;
                    reconnectAttempts = 0; 
                    reconnectScheduled = false; 
                    
                    JsonObject authMsg = new JsonObject();
                    authMsg.addProperty("type", "auth");
                    authMsg.addProperty("auth_key", plugin.getConfig().getString("websocket.auth_key", System.getenv("AUTH_KEY") != null ? System.getenv("AUTH_KEY") : "change_me_in_production"));
                    send(authMsg.toString());
                    
                    Bukkit.getScheduler().runTask(plugin, WebSocketManager.this::displayConnectionSuccess);
                    
                    if (wasReconnecting) {
                        plugin.getLogger().info("WebSocket connection re-established after " + (wasReconnecting ? "reconnection attempts" : "initial connection"));
                        Bukkit.getOnlinePlayers().stream()
                            .filter(p -> p.hasPermission("rankedbedwars.admin") || p.isOp())
                            .forEach(p -> p.sendMessage("§a[RankedBedwars] §2WebSocket connection re-established successfully."));
                    }
                    
                    sendInitialData();
                    notifyReconnection();
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
                                plugin.getLogger().warning("WebSocket connection timed out - This could indicate:");
                                plugin.getLogger().warning("1. Network connectivity issues");
                                plugin.getLogger().warning("2. Firewall blocking the connection");
                                plugin.getLogger().warning("3. Server overload or high latency");
                                plugin.getLogger().warning("4. ISP throttling or blocking WebSocket connections");
                                plugin.getLogger().warning("Consider using a VPN if the issue persists");
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
            
            // Set connection timeout (30 seconds)
            client.setConnectionLostTimeout(30);
            
            // Set TCP no delay for better responsiveness
            client.setTcpNoDelay(true);
            
            // Add additional logging for debugging
            plugin.getLogger().info("Attempting WebSocket connection to: " + serverUri.toString());
            plugin.getLogger().info("Connection timeout set to 30 seconds");
            plugin.getLogger().info("TCP NoDelay enabled for better performance");
            
            // Connect with timeout
            boolean connected = client.connectBlocking(30, java.util.concurrent.TimeUnit.SECONDS);
            if (!connected) {
                plugin.getLogger().warning("WebSocket connection timed out after 30 seconds");
                plugin.getLogger().info("Trying alternative connection method...");
                
                // Fallback to non-blocking connection
                client.connect();
                
                // Give it a bit more time
                Bukkit.getScheduler().runTaskLater(plugin, () -> {
                    if (client == null || !client.isOpen()) {
                        plugin.getLogger().warning("Alternative connection method also failed");
                        scheduleReconnect();
                    }
                }, 20L * 10); // Wait 10 more seconds
            }
        } catch (URISyntaxException e) {
            plugin.getLogger().log(Level.SEVERE, "Invalid WebSocket URI", e);
        } catch (InterruptedException e) {
            plugin.getLogger().log(Level.WARNING, "WebSocket connection interrupted", e);
            Thread.currentThread().interrupt();
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
                            for (org.bukkit.plugin.Plugin p : org.bukkit.Bukkit.getPluginManager().getPlugins()) {
                                if (p instanceof com.deyo.rbw.RankedBedwars) {
                                    com.deyo.rbw.RankedBedwars rbw = (com.deyo.rbw.RankedBedwars) p;
                                    if (rbw.getAdminCommand() != null) {
                                        rbw.getAdminCommand().handleWebSocketPong(pingId);
                                    }
                                }
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
        String uuid = json.has("uuid") ? json.get("uuid").getAsString() : null;
        if (uuid != null) {
            org.bukkit.command.PluginCommand ssCmd = plugin.getServer().getPluginCommand("ss");
            if (ssCmd != null && ssCmd.getExecutor() instanceof com.deyo.rbw.commands.SsCmd) {
                ((com.deyo.rbw.commands.SsCmd) ssCmd.getExecutor()).handleAutossSuccess(uuid);
            }
        }
    }

    private void handleAutossFail(JsonObject json) {
        String uuid = json.has("uuid") ? json.get("uuid").getAsString() : null;
        if (uuid != null) {
            org.bukkit.command.PluginCommand ssCmd = plugin.getServer().getPluginCommand("ss");
            if (ssCmd != null && ssCmd.getExecutor() instanceof com.deyo.rbw.commands.SsCmd) {
                ((com.deyo.rbw.commands.SsCmd) ssCmd.getExecutor()).handleAutossFail(uuid);
            }
        }
    }



    private void handleScreenshareDontLog(JsonObject json) {
        String ign = json.has("ign") ? json.get("ign").getAsString() : null;
        String uuid = json.has("uuid") ? json.get("uuid").getAsString() : null;
        if (ign == null || uuid == null) {
            JsonObject response = new JsonObject();
            response.addProperty("type", "screensharedontlog_failure");
            response.addProperty("reason", "Missing ign or uuid");
            if (uuid != null) response.addProperty("uuid", uuid);
            sendMessage(response.toString());
            return;
        }
        org.bukkit.entity.Player player = Bukkit.getPlayerExact(ign);
        if (player != null && player.isOnline()) {
            player.sendMessage("§c[RankedBedwars] §eYou are being requested for screenshare, do not log off the server.");
            
            //sendActionBar(player, "§cYOU ARE BEING SCREENSHARED DO NOT LOG OFF");
            
            JsonObject response = new JsonObject();
            response.addProperty("type", "screensharedontlog_success");
            response.addProperty("uuid", uuid);
            sendMessage(response.toString());
        } else {
            JsonObject response = new JsonObject();
            response.addProperty("type", "screensharedontlog_failure");
            response.addProperty("reason", "Player not online");
            response.addProperty("uuid", uuid);
            sendMessage(response.toString());
        }
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
        
        if (team1Json.has("players")) {
            JsonArray playersArray = team1Json.getAsJsonArray("players");
            for (JsonElement playerElement : playersArray) {
                allPlayers.add(playerElement.getAsString());
            }
        }
        
        if (team2Json.has("players")) {
            JsonArray playersArray = team2Json.getAsJsonArray("players");
            for (JsonElement playerElement : playersArray) {
                allPlayers.add(playerElement.getAsString());
            }
        }
        
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
                Bukkit.getOnlinePlayers().stream()
                    .filter(p -> p.hasPermission("rankedbedwars.admin") || p.isOp())
                    .forEach(p -> p.sendMessage("§c[RankedBedwars] §4WebSocket connection is closed. Cannot send messages to the bot. Please contact deyo."));
                
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
            json.addProperty("gameid", game.getGameId());
            
            if (game.getMvps() != null && !game.getMvps().isEmpty()) {
                JsonArray mvpsArray = new JsonArray();
                for (String mvp : game.getMvps()) {
                    mvpsArray.add(mvp);
                }
                json.add("mvps", mvpsArray);
            }
            if (game.getBedBreakers() != null && !game.getBedBreakers().isEmpty()) {
                JsonArray bedBreakersArray = new JsonArray();
                for (String breaker : game.getBedBreakers()) {
                    bedBreakersArray.add(breaker);
                }
                json.add("bedsbroken", bedBreakersArray);
            }
            JsonObject playersJson = new JsonObject();
            for (String playerName : game.getPlayerKills().keySet()) {
                JsonObject playerJson = new JsonObject();
                playerJson.addProperty("kills", game.getPlayerKills().getOrDefault(playerName, 0));
                playerJson.addProperty("deaths", game.getPlayerDeaths().getOrDefault(playerName, 0));
                playerJson.addProperty("finalkills", game.getPlayerFinalKills().getOrDefault(playerName, 0));
                playerJson.addProperty("blocksplaced", game.getPlayerBlocksPlaced().getOrDefault(playerName, 0));
                playerJson.addProperty("diamonds", game.getPlayerDiamondsCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("irons", game.getPlayerIronCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("gold", game.getPlayerGoldCollected().getOrDefault(playerName, 0));
                playerJson.addProperty("emeralds", game.getPlayerEmeraldsCollected().getOrDefault(playerName, 0));
                playersJson.add(playerName, playerJson);
            }
            json.add("players", playersJson);
            
            int winningTeamNumber = game.getWinningTeamNumber();
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
            json.add("winningteamignlist", winningTeamIgnList);
            
            sendMessage(json.toString());

            if (plugin.getMapManager() != null) {
                String mapName = game.getMap();
                plugin.getMapManager().unlockMap(mapName);
                plugin.debug("Unlocked map after scoring: " + mapName);
            }
        });
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
                
                scheduleMapDataSending();
                plugin.debug("Initial data sending process started");
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error sending initial data to WebSocket", e);
            }
        });
    }
    private void scheduleMapDataSending() {
        sendMapDataIfReady(0);
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            if (isConnected() && plugin.getMapManager() != null && !plugin.getMapManager().getMapNames().isEmpty()) {
                Bukkit.getScheduler().runTask(plugin, () -> {
                    plugin.getMapManager().sendMapInfoToBot();
                    plugin.debug("Auto-sent map data to WebSocket server");
                });
            }
        }, 20L, 20L);
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
    private void notifyReconnection() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            plugin.debug("WebSocket reconnection notification - checking for additional data to send");
        });
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
        
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            plugin.getLogger().severe("Failed to connect to WebSocket server after " + reconnectAttempts + " attempts");
            plugin.getLogger().severe("The RankedBedwars bot appears to be offline. Please contact deyo.");
            
            Bukkit.getOnlinePlayers().stream()
                .filter(p -> p.hasPermission("rankedbedwars.admin") || p.isOp())
                .forEach(p -> p.sendMessage("§4[RankedBedwars] §cFailed to connect to WebSocket after " + 
                    reconnectAttempts + " attempts. The bot is likely offline. Please contact deyo."));
            
            reconnectScheduled = false;
            return;
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
            if (client == null || !client.isOpen()) {
                plugin.getLogger().info("Attempting to reconnect to WebSocket server... (Attempt " + reconnectAttempts + ")");
                connect();
            } else {
                plugin.debug("WebSocket is already connected, skipping reconnection attempt");
            }
        }, currentDelay * 20L);
    }
    public boolean isConnected() {
        boolean connected = client != null && client.isOpen();
        if (connected) {
            ensureDataSync();
        }
        return connected;
    }
    private void ensureDataSync() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            if (plugin.getMapManager() != null && !plugin.getMapManager().getMapNames().isEmpty()) {
                plugin.debug("Ensuring WebSocket data synchronization");
            }
        });
    }
    public void shutdown() {
        plugin.getLogger().info("Shutting down WebSocket connection...");
        
        reconnectScheduled = false;
        
        if (client != null && client.isOpen()) {
            try {
                client.closeBlocking();
                plugin.getLogger().info("WebSocket connection closed");
            } catch (InterruptedException e) {
                plugin.getLogger().log(Level.WARNING, "Error closing WebSocket connection", e);
                Thread.currentThread().interrupt();
            }
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
        plugin.getLogger().info("Target Host: " + host);
        plugin.getLogger().info("Target Port: " + port);
        plugin.getLogger().info("Full URL: ws://" + host + ":" + port + "/rbw/websocket");
        plugin.getLogger().info("Current Connection State: " + (isConnected() ? "CONNECTED" : "DISCONNECTED"));
        plugin.getLogger().info("Reconnect Attempts: " + reconnectAttempts);
        plugin.getLogger().info("Reconnect Scheduled: " + reconnectScheduled);
        
        // Test basic connectivity
        testConnectivity();
        
        plugin.getLogger().info("=== End Diagnosis ===");
    }
    
    private void handleCallSuccess(JsonObject json) {
        if (json.has("callId")) {
            String callId = json.get("callId").getAsString();
            if (plugin.getCallCommand() != null) {
                plugin.getCallCommand().handleCallSuccess(callId);
            }
        }
    }
    
    private void handleCallFailure(JsonObject json) {
        if (json.has("callId")) {
            String callId = json.get("callId").getAsString();
            String reason = json.has("reason") ? json.get("reason").getAsString() : "Unknown error";
            if (plugin.getCallCommand() != null) {
                plugin.getCallCommand().handleCallFailure(callId, reason);
            }
        }
    }
    
    private void handleQueueSuccess(JsonObject json) {
        if (json.has("uuid")) {
            String uuid = json.get("uuid").getAsString();
            if (plugin.getQueueCommand() != null) {
                plugin.getQueueCommand().handleQueueSuccess(uuid);
            }
        }
    }
    
    private void handleQueueFailure(JsonObject json) {
        if (json.has("uuid")) {
            String uuid = json.get("uuid").getAsString();
            String reason = json.has("reason") ? json.get("reason").getAsString() : "Unknown error";
            if (plugin.getQueueCommand() != null) {
                plugin.getQueueCommand().handleQueueFailure(uuid, reason);
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
                
                for (String queueId : queues.keySet()) {
                    JsonObject queue = queues.getAsJsonObject(queueId);
                    
                    if (!queue.has("players")) {
                        continue;
                    }
                    
                    JsonArray playersArray = queue.getAsJsonArray("players");
                    java.util.List<String> queuePlayers = new java.util.ArrayList<>();
                    for (int i = 0; i < playersArray.size(); i++) {
                        queuePlayers.add(playersArray.get(i).getAsString());
                    }
                    
                    int minElo = queue.get("minElo").getAsInt();
                    int maxElo = queue.get("maxElo").getAsInt();
                    int currentPlayers = queue.get("currentPlayers").getAsInt();
                    int maxPlayers = queue.get("maxPlayers").getAsInt();
                    boolean isRanked = queue.get("isRanked").getAsBoolean();
                    boolean isPicking = queue.get("isPicking").getAsBoolean();
                    
                    String queueMessage = String.format("§6In Queue [§e%d-%d§6] §f%d/%d §7Ranked: %s §7Picking: %s", 
                        minElo, maxElo, currentPlayers, maxPlayers,
                        isRanked ? "§atrue" : "§cfalse",
                        isPicking ? "§atrue" : "§cfalse"
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
                
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Error handling queue status", e);
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

    public void handleBotBan(JsonObject json) {
        String ign = json.get("ign").getAsString();
        String reason = json.get("reason").getAsString();
        // String banId = json.get("id").getAsString(); // not used
        String command;
        if (json.has("duration") && !json.get("duration").isJsonNull()) {
            int duration = json.get("duration").getAsInt();
            command = String.format("ban %s %d %s", ign, duration, reason);
        } else {
            command = String.format("ban %s %s", ign, reason);
        }
        org.bukkit.Bukkit.dispatchCommand(org.bukkit.Bukkit.getConsoleSender(), command);
    }

    public void handleBotMute(JsonObject json) {
        String ign = json.get("ign").getAsString();
        String reason = json.get("reason").getAsString();
        // String muteId = json.get("id").getAsString(); // not used
        String command;
        if (json.has("duration") && !json.get("duration").isJsonNull()) {
            int duration = json.get("duration").getAsInt();
            command = String.format("mute %s %d %s", ign, duration, reason);
        } else {
            command = String.format("mute %s %s", ign, reason);
        }
        org.bukkit.Bukkit.dispatchCommand(org.bukkit.Bukkit.getConsoleSender(), command);
    }

    public void handleBotUnban(JsonObject json) {
        String ign = json.get("ign").getAsString();
        String reason = json.get("reason").getAsString();
        // String targetId = json.get("id").getAsString(); // not used
        String command = String.format("unban %s %s", ign, reason);
        org.bukkit.Bukkit.dispatchCommand(org.bukkit.Bukkit.getConsoleSender(), command);
    }

    public void handleBotUnmute(JsonObject json) {
        String ign = json.get("ign").getAsString();
        String reason = json.get("reason").getAsString();
        // String targetId = json.get("id").getAsString(); // not used
        String command = String.format("unmute %s %s", ign, reason);
        org.bukkit.Bukkit.dispatchCommand(org.bukkit.Bukkit.getConsoleSender(), command);
    }

	private void handleScoringSuccess(JsonObject json) {
		int gameId = json.has("gameid") ? json.get("gameid").getAsInt() : -1;
		if (!json.has("players") || !json.get("players").isJsonArray()) {
			plugin.getLogger().warning("scoringsuccess missing players array");
			return;
		}
		JsonArray playersArray = json.getAsJsonArray("players");
		String message = "§6§l[RBW] §aGame §e#" + gameId + " §ahas been scored.";
		for (int i = 0; i < playersArray.size(); i++) {
			String playerName = playersArray.get(i).getAsString();
			org.bukkit.entity.Player player = Bukkit.getPlayerExact(playerName);
			if (player != null && player.isOnline()) {
				player.sendMessage(message);
			}
		}
	}

	private void handleGameVoided(JsonObject json) {
		int gameId = json.has("gameid") ? json.get("gameid").getAsInt() : -1;
		String reason = json.has("reason") && !json.get("reason").isJsonNull() ? json.get("reason").getAsString() : "unspecified";
		if (!json.has("players") || !json.get("players").isJsonArray()) {
			plugin.getLogger().warning("gamevoided missing players array");
			return;
		}
		JsonArray playersArray = json.getAsJsonArray("players");
		String message = "§6§l[RBW] §cGame §e#" + gameId + " §chas been voided. §7Reason: §f" + reason;
		for (int i = 0; i < playersArray.size(); i++) {
			String playerName = playersArray.get(i).getAsString();
			org.bukkit.entity.Player player = Bukkit.getPlayerExact(playerName);
			if (player != null && player.isOnline()) {
				player.sendMessage(message);
			}
		}
	}
}
