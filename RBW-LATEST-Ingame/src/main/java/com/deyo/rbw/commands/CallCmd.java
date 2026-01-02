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
    private final Map<String, Player> pendingCalls = new ConcurrentHashMap<>();
    private static CallCmd instance;

    public CallCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        instance = this;
    }

    public static CallCmd getInstance() {
        return instance;
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

        
        pendingCalls.put(callId, player);
        
        
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
        Player player = pendingCalls.remove(callId);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.GREEN + "✓ Call successful! The target player has been notified.");
        }
    }
    

    public void handleCallFailure(String callId, String reason) {
        Player player = pendingCalls.remove(callId);
        if (player != null && player.isOnline()) {
            player.sendMessage(ChatColor.RED + "✗ Call failed: " + reason);
        }
    }
}
