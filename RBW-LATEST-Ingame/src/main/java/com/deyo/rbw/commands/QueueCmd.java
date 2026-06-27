package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class QueueCmd implements CommandExecutor {
    private final RankedBedwars plugin;
    private final Map<String, PendingQueue> pendingQueues = new ConcurrentHashMap<>();

    private static final long QUEUE_TIMEOUT_MS = 60_000;

    public QueueCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpiredQueues, 1200L, 1200L);
    }

    private static class PendingQueue {
        final Player player;
        final long timestamp;

        PendingQueue(Player player) {
            this.player = player;
            this.timestamp = System.currentTimeMillis();
        }
    }

    private void cleanupExpiredQueues() {
        long now = System.currentTimeMillis();
        pendingQueues.entrySet().removeIf(entry -> {
            PendingQueue queue = entry.getValue();
            return !queue.player.isOnline() || (now - queue.timestamp) > QUEUE_TIMEOUT_MS;
        });
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }

        Player player = (Player) sender;

        if (!player.hasPermission("rankedbedwars.queue")) {
            player.sendMessage(ChatColor.RED + "You don't have permission to use this command!");
            return true;
        }

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            player.sendMessage(ChatColor.RED + "WebSocket is not connected! Cannot send queue request.");
            return true;
        }

        String playerIgn = player.getName();

        String requestUuid = UUID.randomUUID().toString();
        JsonObject json = new JsonObject();
        json.addProperty("type", "queuefromingame");
        json.addProperty("ign", playerIgn);
        json.addProperty("uuid", requestUuid);

        pendingQueues.put(requestUuid, new PendingQueue(player));

        plugin.getWebSocketManager().sendMessage(json.toString());

        player.sendMessage(ChatColor.GREEN + "Queue request sent!");
        player.sendMessage(ChatColor.GRAY + "Waiting for response...");

        plugin.debug("Queue command executed: " + playerIgn + " (UUID: " + requestUuid + ")");

        return true;
    }

    public void handleQueueSuccess(String uuid) {
        PendingQueue pending = pendingQueues.remove(uuid);
        if (pending != null && pending.player.isOnline()) {
            pending.player.sendMessage(ChatColor.GREEN + "Successfully joined the queue!");
        }
    }

    public void handleQueueFailure(String uuid, String reason) {
        PendingQueue pending = pendingQueues.remove(uuid);
        if (pending != null && pending.player.isOnline()) {
            pending.player.sendMessage(ChatColor.RED + "Queue failed: " + reason);
        }
    }
}
