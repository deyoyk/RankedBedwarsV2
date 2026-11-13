package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * In-game /party backed by the Discord bot's parties (PartyBridge). The command is sent as
 * party_command and answered with party_result; party_notify/party_invite/party_duel push
 * party activity to players who are online.
 */
public class PartyCmd implements CommandExecutor, TabCompleter {
    private final RankedBedwars plugin;
    private final Map<String, PendingCommand> pending = new ConcurrentHashMap<>();
    private final Map<String, String> pendingByPlayer = new ConcurrentHashMap<>();

    private static final long REQUEST_TIMEOUT_MS = 120_000;
    private static final List<String> ACTIONS = Arrays.asList(
            "list", "invite", "accept", "join", "leave", "disband", "kick", "promote",
            "private", "open", "close", "queue", "duel");

    private static class PendingCommand {
        final Player player;
        final long timestamp;

        PendingCommand(Player player) {
            this.player = player;
            this.timestamp = System.currentTimeMillis();
        }
    }

    public PartyCmd(RankedBedwars plugin) {
        this.plugin = plugin;
        plugin.getServer().getScheduler().runTaskTimerAsynchronously(plugin, this::cleanupExpired, 1200L, 1200L);
    }

    private void cleanupExpired() {
        long now = System.currentTimeMillis();
        pending.entrySet().removeIf(entry -> !entry.getValue().player.isOnline()
                || (now - entry.getValue().timestamp) > REQUEST_TIMEOUT_MS);
        pendingByPlayer.entrySet().removeIf(entry -> !pending.containsKey(entry.getValue()));
    }

    static JsonObject buildPayload(String ign, String requestId, String action, String target, String map) {
        JsonObject json = new JsonObject();
        json.addProperty("type", "party_command");
        json.addProperty("request_id", requestId);
        json.addProperty("ign", ign);
        json.addProperty("action", action);
        if (target != null && !target.isEmpty()) {
            json.addProperty("target", target);
        }
        if (map != null && !map.isEmpty()) {
            json.addProperty("map", map);
        }
        return json;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }

        Player player = (Player) sender;
        if (!player.hasPermission("rankedbedwars.party")) {
            player.sendMessage(ChatColor.RED + "You don't have permission to use this command!");
            return true;
        }

        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) {
            player.sendMessage(ChatColor.RED + "WebSocket is not connected! Cannot use party commands.");
            return true;
        }

        String action = args.length > 0 ? args[0].toLowerCase(Locale.ROOT) : "list";
        if (!ACTIONS.contains(action)) {
            sendUsage(player);
            return true;
        }

        String target = null;
        String map = null;
        switch (action) {
            case "invite":
            case "kick":
            case "promote":
                if (args.length < 2) {
                    player.sendMessage(ChatColor.RED + "Usage: /party " + action + " <player>");
                    return true;
                }
                target = args[1];
                break;
            case "join":
            case "accept":
            case "duel":
                if (args.length > 1) {
                    target = args[1];
                }
                if (action.equals("duel") && args.length > 2) {
                    map = String.join(" ", Arrays.copyOfRange(args, 2, args.length)).trim();
                }
                break;
            case "queue":
                if (args.length > 1) {
                    map = String.join(" ", Arrays.copyOfRange(args, 1, args.length)).trim();
                }
                break;
            default:
                break;
        }

        String requestId = UUID.randomUUID().toString();
        JsonObject json = buildPayload(player.getName(), requestId, action, target, map);

        pending.put(requestId, new PendingCommand(player));
        pendingByPlayer.put(player.getUniqueId().toString(), requestId);

        try {
            plugin.getWebSocketManager().sendMessage(json.toString());
        } catch (Exception sendError) {
            pending.remove(requestId);
            pendingByPlayer.remove(player.getUniqueId().toString(), requestId);
            player.sendMessage(ChatColor.RED + "Failed to send the party command. Please try again.");
            plugin.getLogger().warning("Failed to send party command for " + player.getName() + ": " + sendError);
            return true;
        }

        if (action.equals("list") || action.equals("info")) {
            player.sendMessage(ChatColor.GRAY + "Fetching your party...");
        }
        return true;
    }

    private void sendUsage(Player player) {
        player.sendMessage(ChatColor.RED + "Usage: /party <list|invite|accept|leave|disband|kick|promote|private|open|close|queue|duel>");
    }

    public void handlePartyResult(JsonObject json) {
        String requestId = json.has("request_id") ? json.get("request_id").getAsString() : null;
        if (requestId == null) {
            return;
        }
        PendingCommand pendingCommand = pending.remove(requestId);
        if (pendingCommand == null) {
            return;
        }
        pendingByPlayer.remove(pendingCommand.player.getUniqueId().toString(), requestId);
        if (!pendingCommand.player.isOnline()) {
            return;
        }

        boolean ok = json.has("ok") && json.get("ok").getAsBoolean();
        String message = json.has("message") ? json.get("message").getAsString() : "";

        List<String> lines = new ArrayList<>();
        if (ok && json.has("party") && json.get("party").isJsonObject()) {
            lines.addAll(renderParty(json.getAsJsonObject("party")));
        } else if (!message.isEmpty()) {
            lines.add(ok ? ChatColor.GREEN + message : ChatColor.RED + message);
        } else if (ok) {
            lines.add(ChatColor.GREEN + "Done.");
        }

        if (!lines.isEmpty()) {
            for (String line : lines) {
                pendingCommand.player.sendMessage(line);
            }
        }
    }

    private List<String> renderParty(JsonObject party) {
        List<String> lines = new ArrayList<>();
        String leader = party.has("leader") ? party.get("leader").getAsString() : "?";
        lines.add(ChatColor.GOLD + "Party " + ChatColor.GRAY + "led by " + ChatColor.YELLOW + leader);
        if (party.has("members") && party.get("members").isJsonArray()) {
            String members = streamStrings(party.getAsJsonArray("members")).collect(Collectors.joining(", "));
            lines.add(ChatColor.GOLD + "Members: " + ChatColor.WHITE + (members.isEmpty() ? "none" : members));
        }
        boolean open = party.has("open") && party.get("open").getAsBoolean();
        boolean privateGames = party.has("private_games") && party.get("private_games").getAsBoolean();
        lines.add(ChatColor.GRAY + "Open: " + (open ? "yes" : "no")
                + ChatColor.GRAY + " | Private games: " + (privateGames ? "on" : "off"));
        return lines;
    }

    private java.util.stream.Stream<String> streamStrings(JsonArray array) {
        List<String> values = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) {
            values.add(array.get(i).getAsString());
        }
        return values.stream();
    }

    public void handlePartyInvite(String ign, String from) {
        Player player = Bukkit.getPlayerExact(ign);
        if (player != null) {
            player.sendMessage(ChatColor.YELLOW + from + " invited you to their party. Use " + ChatColor.GOLD + "/party accept" + ChatColor.YELLOW + " to join.");
        }
    }

    public void handlePartyDuel(String ign, String from, int size) {
        Player player = Bukkit.getPlayerExact(ign);
        if (player != null) {
            player.sendMessage(ChatColor.YELLOW + from + "'s party (" + size + ") challenged you to a duel. Use "
                    + ChatColor.GOLD + "/party duel " + from + ChatColor.YELLOW + " to accept.");
        }
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!(sender instanceof Player) || !sender.hasPermission("rankedbedwars.party")) {
            return Collections.emptyList();
        }
        if (args.length == 1) {
            return ACTIONS.stream().filter(a -> a.startsWith(args[0].toLowerCase(Locale.ROOT)))
                    .collect(Collectors.toList());
        }
        if (args.length == 2 && Arrays.asList("invite", "kick", "promote", "join", "accept", "duel").contains(args[0].toLowerCase(Locale.ROOT))) {
            return plugin.getServer().getOnlinePlayers().stream()
                    .map(Player::getName)
                    .filter(name -> name.toLowerCase(Locale.ROOT).startsWith(args[1].toLowerCase(Locale.ROOT)))
                    .collect(Collectors.toList());
        }
        return Collections.emptyList();
    }
}
