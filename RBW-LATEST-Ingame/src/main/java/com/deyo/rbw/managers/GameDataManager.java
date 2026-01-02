package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.logging.Level;


 
public class GameDataManager {
    
    private final RankedBedwars plugin;
    private final SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd");
    private final SimpleDateFormat timeFormat = new SimpleDateFormat("HH-mm-ss");
    private final File dataFolder;
    private final boolean enabled;
    
    public GameDataManager(RankedBedwars plugin) {
        this.plugin = plugin;
        
        FileConfiguration config = plugin.getConfig();
        this.enabled = config.getBoolean("data-storage.enabled", true);
        
        String folderPath = config.getString("data-storage.folder-path", "games");
        this.dataFolder = new File(plugin.getDataFolder(), folderPath);
        
        if (enabled && !dataFolder.exists() && !dataFolder.mkdirs()) {
            plugin.getLogger().warning("Failed to create data directory: " + dataFolder.getAbsolutePath());
        }
    }
    public void saveGameWarpData(String gameId, String mapName, JsonObject team1Json, JsonObject team2Json, boolean isRanked) {
        if (!enabled) {
            return;
        }
        
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                JsonObject warpData = new JsonObject();
                warpData.addProperty("type", "warp_data");
                warpData.addProperty("game_id", gameId);
                warpData.addProperty("map", mapName);
                warpData.addProperty("is_ranked", isRanked);
                warpData.addProperty("timestamp", System.currentTimeMillis());
                warpData.addProperty("date", dateFormat.format(new Date()));
                
                warpData.add("team1", team1Json);
                warpData.add("team2", team2Json);
                
                appendToWarpFile(warpData, gameId);
                
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Failed to save game warp data", e);
            }
        });
    }
    
    public void saveGameResultData(Game game) {
        if (!enabled) {
            return;
        }
        
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                String json = plugin.getGson().toJson(game);
                JsonObject resultJson = JsonParser.parseString(json).getAsJsonObject();
                
                resultJson.addProperty("type", "game_result");
                resultJson.addProperty("saved_at", System.currentTimeMillis());
                
                saveToFile(resultJson, game.getGameId(), "result");
                
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Failed to save game result data", e);
            }
        });
    }
    private void saveToFile(JsonObject data, String gameId, String type) throws IOException {
        String date = dateFormat.format(new Date());
        File dateFolder = new File(dataFolder, date);
        if (!dateFolder.exists() && !dateFolder.mkdirs()) {
            plugin.getLogger().warning("Failed to create date directory: " + dateFolder.getAbsolutePath());
            return;
        }
        String timestamp = timeFormat.format(new Date());
        String filename = String.format("game_%s_%s_%s.json", gameId, type, timestamp);
        File file = new File(dateFolder, filename);
        
        try (FileWriter writer = new FileWriter(file)) {
            plugin.getGson().toJson(data, writer);
            plugin.debug("Saved game " + type + " data to " + file.getAbsolutePath());
        }
    }
    
    private void appendToWarpFile(JsonObject warpData, String gameId) throws IOException {
        String date = dateFormat.format(new Date());
        File dateFolder = new File(dataFolder, date);
        if (!dateFolder.exists() && !dateFolder.mkdirs()) {
            plugin.getLogger().warning("Failed to create date directory: " + dateFolder.getAbsolutePath());
            return;
        }

        
        String filename = String.format("game_%s_warp.json", gameId);
        File file = new File(dateFolder, filename);
        
        JsonArray warpsArray;
        
        
        if (file.exists()) {
            
            java.io.FileReader reader = new java.io.FileReader(file);
            try {
                
                warpsArray = JsonParser.parseReader(reader).getAsJsonArray();
            } catch (Exception e) {
                
                reader.close();
                reader = new java.io.FileReader(file);
                JsonObject existingObject = JsonParser.parseReader(reader).getAsJsonObject();
                warpsArray = new JsonArray();
                warpsArray.add(existingObject);
            }
            reader.close();
        } else {
            
            warpsArray = new JsonArray();
        }
        
        
        warpsArray.add(warpData);
        
        
        try (FileWriter writer = new FileWriter(file)) {
            plugin.getGson().toJson(warpsArray, writer);
            plugin.debug("Updated game warp data in " + file.getAbsolutePath());
        }
    }
    
    public boolean isEnabled() {
        return enabled;
    }
}
