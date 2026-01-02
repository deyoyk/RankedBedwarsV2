package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
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

    public AdminCommand(RankedBedwars plugin) {
        this.plugin = plugin;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.hasPermission("rankedbedwars.admin")) {
            sender.sendMessage(ChatColor.GOLD + "Ranked Bedwars System" + ChatColor.GRAY + " By Deyo & Zercode");
            sender.sendMessage(ChatColor.GRAY + " You want this plugin? Contact Deyo on Zerocode https://discord.com/invite/23hPVuuam3");
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
            case "reloadpermissions":
                reloadPermissions(sender);
                break;
            case "clearcache":
                clearPlaceholderCache(sender);
                break;
            default:
                sendHelp(sender);
                break;
        }

        return true;
    }

    private void sendHelp(CommandSender sender) {
        sender.sendMessage(ChatColor.GOLD + "Ranked Bedwars Admin" + ChatColor.GRAY + " By Deyo & Zercode LLC");
        sender.sendMessage(ChatColor.GOLD + "/rbw reload " + ChatColor.GRAY + "- Reload the plugin");
        sender.sendMessage(ChatColor.GOLD + "/rbw status " + ChatColor.GRAY + "- Check plugin status");
        sender.sendMessage(ChatColor.GOLD + "/rbw maps " + ChatColor.GRAY + "- List available maps");
        sender.sendMessage(ChatColor.GOLD + "/rbw refresh " + ChatColor.GRAY + "- Refresh and resend map data");
        sender.sendMessage(ChatColor.GOLD + "/rbw test [message] " + ChatColor.GRAY + "- Send a test message via WebSocket");
        sender.sendMessage(ChatColor.GOLD + "/rbw ping " + ChatColor.GRAY + "- Show server tick ping (mspt)");
        sender.sendMessage(ChatColor.GOLD + "/rbw disablemap <map> " + ChatColor.GRAY + "- Disable a map for play");
        sender.sendMessage(ChatColor.GOLD + "/rbw enablemap <map> " + ChatColor.GRAY + "- Enable a previously disabled map");
        sender.sendMessage(ChatColor.GOLD + "/rbw groups [reload] " + ChatColor.GRAY + "- Show/reload arena group configuration");
        sender.sendMessage(ChatColor.GOLD + "/rbw reloadpermissions " + ChatColor.GRAY + "- Reload permissions and send to WebSocket");
        sender.sendMessage(ChatColor.GOLD + "/rbw clearcache " + ChatColor.GRAY + "- Clear PlaceholderAPI cache");
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
            sender.sendMessage(ChatColor.GOLD + "WebSocket server ping: " + ChatColor.GREEN + latency + " ms");
        }
    }

    private void sendStatus(CommandSender sender) {
        sender.sendMessage(ChatColor.GRAY + "----- " + ChatColor.GOLD + "rankedbedwars Status" + ChatColor.GRAY + " -----");

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

    private void reloadPermissions(CommandSender sender) {
        sender.sendMessage(ChatColor.YELLOW + "Reloading permissions...");

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            sender.sendMessage(ChatColor.RED + "WebSocket not connected! Permissions will be reloaded but not sent.");
        }
        
        try {
            // Reload the permission file
            java.io.File permissionFile = new java.io.File(plugin.getDataFolder(), "permission.yml");
            if (!permissionFile.exists()) {
                plugin.saveResource("permission.yml", false);
                sender.sendMessage(ChatColor.GREEN + "Created default permission.yml file.");
            }
            
            // Send updated permissions to WebSocket
            if (plugin.getWebSocketManager() != null && plugin.getWebSocketManager().isConnected()) {
                plugin.getWebSocketManager().resendPermissionsData();
                sender.sendMessage(ChatColor.GREEN + "Permissions reloaded and sent to WebSocket server successfully!");
            } else {
                sender.sendMessage(ChatColor.YELLOW + "Permissions reloaded but NOT sent (WebSocket disconnected).");
            }
        } catch (Exception e) {
            sender.sendMessage(ChatColor.RED + "Error reloading permissions: " + e.getMessage());
            plugin.getLogger().severe("Error reloading permissions: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!sender.hasPermission("rankedbedwars.admin")) {
            return Collections.emptyList();
        }
        if (args.length == 1) {
            List<String> completions = Arrays.asList("reload", "status", "maps", "refresh", "test", "ping", "disablemap", "enablemap", "groups", "reloadpermissions", "clearcache");
            return completions.stream().filter(s -> s.startsWith(args[0].toLowerCase())).collect(Collectors.toList());
        }
        if (args.length == 2 && (args[0].equalsIgnoreCase("disablemap") || args[0].equalsIgnoreCase("enablemap"))) {
            if (plugin.getMapManager() != null) {
                return plugin.getMapManager().getMapNames().stream().filter(s -> s.startsWith(args[1])).collect(Collectors.toList());
            }
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("groups")) {
            return Collections.singletonList("reload");
        }
        return Collections.emptyList();
    }
}
