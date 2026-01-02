package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.managers.WebSocketManager;
import com.google.gson.JsonObject;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

import java.util.UUID;

public class SsCmd implements CommandExecutor {
    private final RankedBedwars plugin;

    public SsCmd(RankedBedwars plugin) {
        this.plugin = plugin;
    }


    private final java.util.Map<String, Player> pendingSsRequests = new java.util.concurrent.ConcurrentHashMap<>();

    private void addPendingRequest(String uuid, Player player) {
        pendingSsRequests.put(uuid, player);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(ChatColor.RED + "Usage: /ss <ign> <reason>");
            return true;
        }
        Player player = (Player) sender;
        String targetIgn = args[0];
        String requestIgn = player.getName();
        String reason = String.join(" ", java.util.Arrays.copyOfRange(args, 1, args.length));
        String uuid = UUID.randomUUID().toString();

        WebSocketManager ws = plugin.getWebSocketManager();
        if (ws == null || !ws.isConnected()) {
            player.sendMessage(ChatColor.RED + "WebSocket is not connected! Cannot send SS request.");
            return true;
        }

        JsonObject json = new JsonObject();
        json.addProperty("type", "autoss");
        json.addProperty("targetign", targetIgn);
        json.addProperty("requestign", requestIgn);
        json.addProperty("uuid", uuid);
        json.addProperty("reason", reason);
        ws.sendMessage(json.toString());

        addPendingRequest(uuid, player);
        player.sendMessage(ChatColor.GREEN + "SS request sent to " + ChatColor.YELLOW + targetIgn + ChatColor.GREEN + "! Waiting for response...");
        return true;
    }

    public void handleAutossSuccess(String uuid) {
        Player player = pendingSsRequests.remove(uuid);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.GREEN + "SS request succeeded!");
        }
    }

    public void handleAutossFail(String uuid) {
        Player player = pendingSsRequests.remove(uuid);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.RED + "SS request failed!");
        }
    }
}
