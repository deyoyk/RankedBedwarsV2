package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.update.PluginUpdater;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.concurrent.ConcurrentHashMap;
import java.util.UUID;



public class AdminCommand implements CommandExecutor, TabCompleter {
    private final RankedBedwars plugin;
    
    private final ConcurrentHashMap<String, Long> pendingPings = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CommandSender> pingSenders = new ConcurrentHashMap<>();

    private static final long PING_TIMEOUT_MS = 30_000;

    public AdminCommand(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpiredPings, 600L, 600L);
    }

    private void cleanupExpiredPings() {
        long now = System.currentTimeMillis();
        pendingPings.entrySet().removeIf(entry -> {
            if ((now - entry.getValue()) > PING_TIMEOUT_MS) {
                pingSenders.remove(entry.getKey());
                return true;
            }
            return false;
        });
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("rankedbedwars.admin")) {
            sender.sendMessage(ChatColor.GOLD + "Ranked Bedwars System" + ChatColor.GRAY + " By Deyo");
            return true;
        }

        if (args.length == 0) {
            sendHelp(sender);
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "ping":
                sendPing(sender);
                break;
            case "reload":
                plugin.reload();
                sender.sendMessage(ChatColor.GREEN + "rankedbedwars has been reloaded.");
                break;
            case "status":
                sendStatus(sender);
                break;
            case "maps":
                sendMaps(sender);
                break;
            case "refresh":
                refreshData(sender);
                break;
            case "test":
                sendTest(sender, args);
                break;
            case "disablemap":
                if (args.length < 2) {
                    sender.sendMessage(ChatColor.RED + "Usage: /rbw disablemap <map>");
                } else {
                    String mapName = args[1];
                    if (plugin.getMapManager() != null && plugin.getMapManager().getMapNames().contains(mapName)) {
                        plugin.getMapManager().disableMap(mapName);
                        sender.sendMessage(ChatColor.YELLOW + "Map disabled: " + mapName);
                    } else {
                        sender.sendMessage(ChatColor.RED + "Map not found: " + mapName);
                    }
                }
                break;
            case "enablemap":
                if (args.length < 2) {
                    sender.sendMessage(ChatColor.RED + "Usage: /rbw enablemap <map>");
                } else {
                    String mapName = args[1];
                    if (plugin.getMapManager() != null && plugin.getMapManager().getMapNames().contains(mapName)) {
                        plugin.getMapManager().enableMap(mapName);
                        sender.sendMessage(ChatColor.GREEN + "Map enabled: " + mapName);
                    } else {
                        sender.sendMessage(ChatColor.RED + "Map not found: " + mapName);
                    }
                }
                break;
            case "clearcache":
                clearPlaceholderCache(sender);
                break;
            case "update":
                checkUpdate(sender);
                break;
            default:
                sendHelp(sender);
                break;
        }

        return true;
    }

    private void sendHelp(CommandSender sender) {
        sender.sendMessage(ChatColor.GOLD + "Ranked Bedwars Admin" + ChatColor.GRAY + " By Deyo");
        sender.sendMessage(ChatColor.GOLD + "/rbw reload " + ChatColor.GRAY + "- Reload the plugin");
        sender.sendMessage(ChatColor.GOLD + "/rbw status " + ChatColor.GRAY + "- Check plugin status");
        sender.sendMessage(ChatColor.GOLD + "/rbw maps " + ChatColor.GRAY + "- List available maps");
        sender.sendMessage(ChatColor.GOLD + "/rbw refresh " + ChatColor.GRAY + "- Refresh and resend map data");
        sender.sendMessage(ChatColor.GOLD + "/rbw test [message] " + ChatColor.GRAY + "- Send a test message via WebSocket");
        sender.sendMessage(ChatColor.GOLD + "/rbw ping " + ChatColor.GRAY + "- Show server tick ping (mspt)");
        sender.sendMessage(ChatColor.GOLD + "/rbw disablemap <map> " + ChatColor.GRAY + "- Disable a map for play");
        sender.sendMessage(ChatColor.GOLD + "/rbw enablemap <map> " + ChatColor.GRAY + "- Enable a previously disabled map");
        sender.sendMessage(ChatColor.GOLD + "/rbw clearcache " + ChatColor.GRAY + "- Clear PlaceholderAPI cache");
        sender.sendMessage(ChatColor.GOLD + "/rbw update " + ChatColor.GRAY + "- Check GitHub for a plugin update");
    }

    private void checkUpdate(CommandSender sender) {
        PluginUpdater updater = plugin.getPluginUpdater();
        if (updater == null) {
            sender.sendMessage(ChatColor.RED + "Auto-update is not initialized.");
            return;
        }
        sender.sendMessage(ChatColor.GOLD + "Checking GitHub for updates...");
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            PluginUpdater.Result result = updater.checkForUpdates();
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                ChatColor color = result.status == PluginUpdater.Status.FAILED
                        || result.status == PluginUpdater.Status.DOWNGRADE_PREVENTED
                        ? ChatColor.YELLOW
                        : ChatColor.GREEN;
                sender.sendMessage(color + "Auto-update: " + result.message);
                if (result.isStaged()) {
                    sender.sendMessage(ChatColor.GRAY + "The jar will be replaced when the server stops. /reload does not replace a running jar.");
                }
            });
        });
    }

    private void clearPlaceholderCache(CommandSender sender) {
        if (plugin.getPlaceholderExpansion() != null) {
            plugin.getPlaceholderExpansion().clearCache();
            sender.sendMessage(ChatColor.GREEN + "PlaceholderAPI cache cleared successfully!");
        } else {
            sender.sendMessage(ChatColor.RED + "PlaceholderAPI integration is not enabled!");
        }
    }
    private void sendPing(CommandSender sender) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            sender.sendMessage(ChatColor.RED + "WebSocket is not connected!");
            return;
        }
        String pingId = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        pendingPings.put(pingId, now);
        pingSenders.put(pingId, sender);
        plugin.getWebSocketManager().sendPingWithId(pingId);
        sender.sendMessage(ChatColor.GRAY + "Pinging WebSocket server...");
    }

    
    public void handleWebSocketPong(String pingId) {
        Long sent = pendingPings.remove(pingId);
        CommandSender sender = pingSenders.remove(pingId);
        if (sent != null && sender != null) {
            long latency = System.currentTimeMillis() - sent;
            plugin.getServer().getScheduler().runTask(plugin, () ->
                sender.sendMessage(ChatColor.GOLD + "WebSocket server ping: " + ChatColor.GREEN + latency + " ms")
            );
        }
    }

    private void sendStatus(CommandSender sender) {
        sender.sendMessage(ChatColor.GRAY + "----- " + ChatColor.GOLD + "rankedbedwars Status" + ChatColor.GRAY + " -----");

        sender.sendMessage(ChatColor.GOLD + "Version: " + ChatColor.GREEN + plugin.getDescription().getVersion());

        boolean placeholderRegistered = false;
        try {
            placeholderRegistered = plugin.getPlaceholderExpansion() != null
                    && plugin.getPlaceholderExpansion().isRegistered();
        } catch (Throwable ignored) {
        }
        sender.sendMessage(ChatColor.GOLD + "PlaceholderAPI: " +
                (placeholderRegistered ? ChatColor.GREEN + "Registered" : ChatColor.RED + "Not registered"));

        boolean websocketConnected = plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected();

        sender.sendMessage(ChatColor.GOLD + "WebSocket: " +
                (websocketConnected ? ChatColor.GREEN + "Connected" : ChatColor.RED + "Disconnected"));

        boolean dataStorageEnabled = plugin.getGameDataManager() != null && plugin.getGameDataManager().isEnabled();
        sender.sendMessage(ChatColor.GOLD + "Game Data Storage: " +
                (dataStorageEnabled ? ChatColor.GREEN + "Enabled" : ChatColor.GRAY + "Disabled"));

        sender.sendMessage(ChatColor.GOLD + "Debug Mode: " +
                (plugin.getConfig().getBoolean("debug") ? ChatColor.GREEN + "Enabled" : ChatColor.GRAY + "Disabled"));
    }

    private void sendMaps(CommandSender sender) {
        sender.sendMessage(ChatColor.GRAY + "----- " + ChatColor.GOLD + "Map Status" + ChatColor.GRAY + " -----");

        if (plugin.getMapManager() == null || plugin.getMapManager().getMapNames().isEmpty()) {
            sender.sendMessage(ChatColor.RED + "No maps available!");
            return;
        }

        Set<String> reservedMaps = plugin.getMapManager().getReservedMaps();
        Set<String> lockedMaps = plugin.getMapManager().getLockedMaps();
        Set<String> disabledMaps = plugin.getMapManager().getDisabledMaps();

        sender.sendMessage(ChatColor.GREEN + "Reserved Maps (Available): " + ChatColor.GRAY + reservedMaps.size());
        for (String mapName : reservedMaps) {
            sender.sendMessage(ChatColor.GRAY + "  - " + ChatColor.GREEN + mapName);
        }

        sender.sendMessage(ChatColor.RED + "Locked Maps (In Use): " + ChatColor.GRAY + lockedMaps.size());
        for (String mapName : lockedMaps) {
            sender.sendMessage(ChatColor.GRAY + "  - " + ChatColor.RED + mapName);
        }

        sender.sendMessage(ChatColor.DARK_GRAY + "Disabled Maps: " + ChatColor.GRAY + disabledMaps.size());
        for (String mapName : disabledMaps) {
            sender.sendMessage(ChatColor.GRAY + "  - " + ChatColor.DARK_GRAY + mapName);
        }
    }


    private void sendTest(CommandSender sender, String[] args) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            sender.sendMessage(ChatColor.RED + "WebSocket is not connected!");
            return;
        }
        String msg = args.length > 1 ? String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length)) : "Hello from rankedbedwars!";
        com.google.gson.JsonObject json = new com.google.gson.JsonObject();
        json.addProperty("type", "test");
        json.addProperty("message", msg);
        plugin.getWebSocketManager().sendMessage(json.toString());
        sender.sendMessage(ChatColor.GREEN + "Test message sent via WebSocket: " + msg);
    }

    private void refreshData(CommandSender sender) {
        sender.sendMessage(ChatColor.YELLOW + "Refreshing map data...");

        if (plugin.getMapManager() == null) {
            sender.sendMessage(ChatColor.RED + "MapManager not available!");
            return;
        }

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            sender.sendMessage(ChatColor.RED + "WebSocket not connected!");
            return;
        }

        plugin.getMapManager().initializeMaps();
        plugin.getWebSocketManager().resendInitialData();

        sender.sendMessage(ChatColor.GREEN + "Map data refreshed and sent to WebSocket server!");
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!sender.hasPermission("rankedbedwars.admin")) {
            return Collections.emptyList();
        }
        if (args.length == 1) {
            List<String> completions = Arrays.asList("reload", "status", "maps", "refresh", "test", "ping", "disablemap", "enablemap", "clearcache", "update");
            return completions.stream().filter(s -> s.startsWith(args[0].toLowerCase())).collect(Collectors.toList());
        }
        if (args.length == 2 && (args[0].equalsIgnoreCase("disablemap") || args[0].equalsIgnoreCase("enablemap"))) {
            if (plugin.getMapManager() != null) {
                return plugin.getMapManager().getMapNames().stream().filter(s -> s.startsWith(args[1])).collect(Collectors.toList());
            }
        }
        return Collections.emptyList();
    }
}
