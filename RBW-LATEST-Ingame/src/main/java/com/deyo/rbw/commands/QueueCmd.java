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
    private final Map<String, Player> pendingQueues = new ConcurrentHashMap<>();
    private static QueueCmd instance;

    public QueueCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        instance = this;
    }
    

    public static QueueCmd getInstance() {
        return instance;
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

        
        pendingQueues.put(requestUuid, player);
        
        
        plugin.getWebSocketManager().sendMessage(json.toString());

        
        player.sendMessage(ChatColor.GREEN + "Queue request sent!");
        player.sendMessage(ChatColor.GRAY + "Waiting for response...");

        
        plugin.debug("Queue command executed: " + playerIgn + " (UUID: " + requestUuid + ")");

        return true;
    }
    

    public void handleQueueSuccess(String uuid) {
        Player player = pendingQueues.remove(uuid);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.GREEN + "✓ Successfully joined the queue!");
        }
    }
    

    public void handleQueueFailure(String uuid, String reason) {
        Player player = pendingQueues.remove(uuid);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.RED + "✗ Queue failed: " + reason);
        }
    }
}
