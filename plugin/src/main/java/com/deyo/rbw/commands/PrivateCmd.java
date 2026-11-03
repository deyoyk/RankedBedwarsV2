package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class PrivateCmd implements CommandExecutor {
    private final RankedBedwars plugin;
    private final Map<String, PendingPrivateGame> pendingRequests = new ConcurrentHashMap<>();
    private final Map<String, String> pendingByPlayer = new ConcurrentHashMap<>();
    private final Map<String, Long> lastRequestAt = new ConcurrentHashMap<>();

    private static final long REQUEST_TIMEOUT_MS = 120_000;
    private static final long REQUEST_COOLDOWN_MS = 10_000;

    public PrivateCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpiredRequests, 1200L, 1200L);
    }

    private static class PendingPrivateGame {
        final Player player;
        final long timestamp;

        PendingPrivateGame(Player player) {
            this.player = player;
            this.timestamp = System.currentTimeMillis();
        }
    }

    static JsonObject buildPayload(String ign, String requestUuid, String map) {
        JsonObject json = new JsonObject();
        json.addProperty("type", "privatefromingame");
        json.addProperty("ign", ign);
        json.addProperty("uuid", requestUuid);
        if (map != null && !map.trim().isEmpty()) {
            json.addProperty("map", map.trim());
        }
        return json;
    }

    private void cleanupExpiredRequests() {
        long now = System.currentTimeMillis();
        pendingRequests.entrySet().removeIf(entry -> {
            PendingPrivateGame request = entry.getValue();
            return !request.player.isOnline() || (now - request.timestamp) > REQUEST_TIMEOUT_MS;
        });
        pendingByPlayer.entrySet().removeIf(entry -> !pendingRequests.containsKey(entry.getValue()));
        lastRequestAt.entrySet().removeIf(entry -> (now - entry.getValue()) > REQUEST_TIMEOUT_MS);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }

        Player player = (Player) sender;
        if (!player.hasPermission("rankedbedwars.private")) {
            player.sendMessage(ChatColor.RED + "You don't have permission to use this command!");
            return true;
        }

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            player.sendMessage(ChatColor.RED + "WebSocket is not connected! Cannot send private game request.");
            return true;
        }

        String playerIgn = player.getName();
        String playerKey = player.getUniqueId().toString();

        if (pendingByPlayer.containsKey(playerKey)) {
            player.sendMessage(ChatColor.RED + "You already have a pending private game request!");
            return true;
        }

        long now = System.currentTimeMillis();
        Long lastRequest = lastRequestAt.get(playerKey);
        if (lastRequest != null && (now - lastRequest) < REQUEST_COOLDOWN_MS) {
            long waitSeconds = (REQUEST_COOLDOWN_MS - (now - lastRequest) + 999) / 1000;
            player.sendMessage(ChatColor.RED + "Please wait " + waitSeconds + "s before starting another private game.");
            return true;
        }

        String requestUuid = UUID.randomUUID().toString();
        String map = args.length > 0 ? String.join(" ", Arrays.copyOfRange(args, 0, args.length)).trim() : "";
        JsonObject json = buildPayload(playerIgn, requestUuid, map);

        pendingRequests.put(requestUuid, new PendingPrivateGame(player));
        pendingByPlayer.put(playerKey, requestUuid);
        lastRequestAt.put(playerKey, now);

        try {
            plugin.getWebSocketManager().sendMessage(json.toString());
        } catch (Exception sendError) {
            pendingRequests.remove(requestUuid);
            pendingByPlayer.remove(playerKey, requestUuid);
            player.sendMessage(ChatColor.RED + "Failed to send private game request. Please try again.");
            plugin.getLogger().warning("Failed to send private game request for " + playerIgn + ": " + sendError);
            return true;
        }

        player.sendMessage(ChatColor.GREEN + "Private game request sent!");
        player.sendMessage(ChatColor.GRAY + "Waiting for the party to be validated...");
        plugin.debug("Private game command executed: " + playerIgn + " (UUID: " + requestUuid + ")");
        return true;
    }

    public void handlePrivateSuccess(String uuid, String map) {
        PendingPrivateGame pending = pendingRequests.remove(uuid);
        if (pending != null) {
            pendingByPlayer.remove(pending.player.getUniqueId().toString(), uuid);
        }
        if (pending != null && pending.player.isOnline()) {
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                if (pending.player.isOnline()) {
                    String suffix = map == null || map.isEmpty() ? "" : " on " + map;
                    pending.player.sendMessage(ChatColor.GREEN + "Private game started" + suffix + "!");
                }
            });
        }
    }

    public void handlePrivateFailure(String uuid, String reason) {
        PendingPrivateGame pending = pendingRequests.remove(uuid);
        if (pending != null) {
            pendingByPlayer.remove(pending.player.getUniqueId().toString(), uuid);
        }
        if (pending != null && pending.player.isOnline()) {
            plugin.getServer().getScheduler().runTask(plugin, () -> {
                if (pending.player.isOnline()) {
                    pending.player.sendMessage(ChatColor.RED + "Private game failed: " + reason);
                }
            });
        }
    }
}
