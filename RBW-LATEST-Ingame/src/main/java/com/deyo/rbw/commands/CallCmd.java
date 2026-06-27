package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

public class CallCmd implements CommandExecutor, TabCompleter {
    private final RankedBedwars plugin;
    private final Map<String, PendingCall> pendingCalls = new ConcurrentHashMap<>();

    private static final long CALL_TIMEOUT_MS = 60_000;

    public CallCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpiredCalls, 1200L, 1200L);
    }

    private static class PendingCall {
        final Player player;
        final long timestamp;

        PendingCall(Player player) {
            this.player = player;
            this.timestamp = System.currentTimeMillis();
        }
    }

    private void cleanupExpiredCalls() {
        long now = System.currentTimeMillis();
        pendingCalls.entrySet().removeIf(entry -> {
            PendingCall call = entry.getValue();
            return !call.player.isOnline() || (now - call.timestamp) > CALL_TIMEOUT_MS;
        });
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }

        Player player = (Player) sender;

        if (!player.hasPermission("rankedbedwars.call")) {
            player.sendMessage(ChatColor.RED + "You don't have permission to use this command!");
            return true;
        }

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            player.sendMessage(ChatColor.RED + "WebSocket is not connected! Cannot send call request.");
            return true;
        }

        if (args.length < 1) {
            player.sendMessage(ChatColor.RED + "Usage: /call <player>");
            player.sendMessage(ChatColor.GRAY + "Example: /call BankruptSky");
            return true;
        }

        String targetIgn = args[0];
        String requesterIgn = player.getName();

        if (targetIgn.equalsIgnoreCase(requesterIgn)) {
            player.sendMessage(ChatColor.RED + "You cannot call yourself!");
            return true;
        }

        String callId = UUID.randomUUID().toString();
        JsonObject json = new JsonObject();
        json.addProperty("type", "callcmd");
        json.addProperty("callId", callId);
        json.addProperty("requester", requesterIgn);
        json.addProperty("target", targetIgn);

        pendingCalls.put(callId, new PendingCall(player));

        plugin.getWebSocketManager().sendMessage(json.toString());

        player.sendMessage(ChatColor.GREEN + "Call request sent to " + ChatColor.YELLOW + targetIgn + ChatColor.GREEN + "!");
        player.sendMessage(ChatColor.GRAY + "Waiting for response...");

        plugin.debug("Call command executed: " + requesterIgn + " -> " + targetIgn);

        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!(sender instanceof Player)) {
            return Collections.emptyList();
        }

        Player player = (Player) sender;

        if (!player.hasPermission("rankedbedwars.call")) {
            return Collections.emptyList();
        }

        if (args.length == 1) {
            List<String> playerNames = new ArrayList<>();

            for (Player onlinePlayer : plugin.getServer().getOnlinePlayers()) {
                if (!onlinePlayer.getName().equalsIgnoreCase(player.getName())) {
                    playerNames.add(onlinePlayer.getName());
                }
            }

            return playerNames.stream()
                    .filter(name -> name.toLowerCase().startsWith(args[0].toLowerCase()))
                    .collect(Collectors.toList());
        }

        return Collections.emptyList();
    }

    public void handleCallSuccess(String callId) {
        PendingCall pending = pendingCalls.remove(callId);
        if (pending != null && pending.player.isOnline()) {
            pending.player.sendMessage(ChatColor.GREEN + "Call successful! The target player has been notified.");
        }
    }

    public void handleCallFailure(String callId, String reason) {
        PendingCall pending = pendingCalls.remove(callId);
        if (pending != null && pending.player.isOnline()) {
            pending.player.sendMessage(ChatColor.RED + "Call failed: " + reason);
        }
    }
}
