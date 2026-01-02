package com.deyo.rbw.commands;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.UserData;
import com.deyo.rbw.utils.APIClient;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.concurrent.CompletableFuture;

public class StatsCmd implements CommandExecutor {
    private final RankedBedwars plugin;
    private final APIClient apiClient;

    public StatsCmd(RankedBedwars plugin, APIClient apiClient) {
        this.plugin = plugin;
        this.apiClient = apiClient;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage(ChatColor.RED + "This command can only be used by players!");
            return true;
        }
        Player player = (Player) sender;
        String ign = player.getName();

        player.sendMessage(ChatColor.GRAY + "Fetching your stats...");
        CompletableFuture<UserData> future = apiClient.getUserData(ign);
        future.thenAccept(userData -> {
            if (userData == null) {
                player.sendMessage(ChatColor.RED + "Failed to fetch your stats from the API.");
                return;
            }
            player.sendMessage(ChatColor.GOLD + "--- Your Ranked Bedwars Stats ---");
            player.sendMessage(ChatColor.YELLOW + "ELO: " + ChatColor.WHITE + userData.getElo());
            player.sendMessage(ChatColor.YELLOW + "Wins: " + ChatColor.WHITE + userData.getWins());
            player.sendMessage(ChatColor.YELLOW + "Losses: " + ChatColor.WHITE + userData.getLosses());
            player.sendMessage(ChatColor.YELLOW + "Games: " + ChatColor.WHITE + userData.getGames());
            player.sendMessage(ChatColor.YELLOW + "MVPs: " + ChatColor.WHITE + userData.getMvps());
            player.sendMessage(ChatColor.YELLOW + "Kills: " + ChatColor.WHITE + userData.getKills());
            player.sendMessage(ChatColor.YELLOW + "Deaths: " + ChatColor.WHITE + userData.getDeaths());
            player.sendMessage(ChatColor.YELLOW + "Beds Broken: " + ChatColor.WHITE + userData.getBedBroken());
            player.sendMessage(ChatColor.YELLOW + "Final Kills: " + ChatColor.WHITE + userData.getFinalKills());
            player.sendMessage(ChatColor.YELLOW + "WLR: " + ChatColor.WHITE + userData.getWlr());
            player.sendMessage(ChatColor.YELLOW + "KDR: " + ChatColor.WHITE + userData.getKdr());
        });
        return true;
    }
}
