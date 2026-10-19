package com.deyo.rbw.listeners;

import com.deyo.rbw.RankedBedwars;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;



 
public class PlayerListener implements Listener {
    private final RankedBedwars plugin;

    public PlayerListener(RankedBedwars plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        sendPlayerStatusUpdate(event.getPlayer(), true);
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        sendPlayerStatusUpdate(event.getPlayer(), false);
    }

    private void sendPlayerStatusUpdate(Player player, boolean online) {
        if (plugin.getWebSocketManager() == null || !plugin.getWebSocketManager().isConnected()) return;
        String ign = player.getName();
        if (ign == null || ign.isEmpty()) return;
        org.bukkit.Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            com.google.gson.JsonObject json = new com.google.gson.JsonObject();
            json.addProperty("type", "player_status_update");
            json.addProperty("ign", ign);
            json.addProperty("online", online);
            json.addProperty("original_ign_case", ign);
            plugin.getWebSocketManager().sendMessage(json.toString());
        });
    }
}
