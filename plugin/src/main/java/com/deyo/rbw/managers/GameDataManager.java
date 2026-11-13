package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.deyo.rbw.models.Game;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.FileConfiguration;

import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.logging.Level;



public class GameDataManager {

    private static final int WARP_LOCK_STRIPES = 64;
    private static final Object[] WARP_LOCK_POOL = new Object[WARP_LOCK_STRIPES];

    static {
        for (int i = 0; i < WARP_LOCK_STRIPES; i++) {
            WARP_LOCK_POOL[i] = new Object();
        }
    }

    private static Object lockFor(File file) {
        String key;
        try {
            key = file.getCanonicalPath();
        } catch (IOException e) {
            key = file.getAbsolutePath();
        }
        return WARP_LOCK_POOL[(key.hashCode() & 0x7fffffff) % WARP_LOCK_STRIPES];
    }
    
    private final RankedBedwars plugin;
    private final ThreadLocal<SimpleDateFormat> dateFormat = ThreadLocal.withInitial(() -> new SimpleDateFormat("yyyy-MM-dd"));
    private final ThreadLocal<SimpleDateFormat> timeFormat = ThreadLocal.withInitial(() -> new SimpleDateFormat("HH-mm-ss"));
    private final File dataFolder;
    private final File pendingScoringFolder;
    private final boolean enabled;
    private final Executor asyncRunner;

    public GameDataManager(RankedBedwars plugin) {
        this(plugin, task -> Bukkit.getScheduler().runTaskAsynchronously(plugin, task));
    }

    GameDataManager(RankedBedwars plugin, Executor asyncRunner) {
        this.plugin = plugin;
        this.asyncRunner = asyncRunner;
        
        FileConfiguration config = plugin.getConfig();
        this.enabled = config.getBoolean("data-storage.enabled", true);
        
        String folderPath = config.getString("data-storage.folder-path", "games");
        this.dataFolder = new File(plugin.getDataFolder(), folderPath);
        this.pendingScoringFolder = new File(plugin.getDataFolder(), "pending-scoring");
        
        if (enabled && !dataFolder.exists() && !dataFolder.mkdirs() && !dataFolder.exists()) {
            plugin.getLogger().warning("Failed to create data directory: " + dataFolder.getAbsolutePath());
        }
        if (!pendingScoringFolder.exists() && !pendingScoringFolder.mkdirs() && !pendingScoringFolder.exists()) {
            plugin.getLogger().warning("Failed to create pending scoring directory: " + pendingScoringFolder.getAbsolutePath());
        }
    }
    public void saveGameWarpData(String gameId, String mapName, JsonObject team1Json, JsonObject team2Json, boolean isRanked) {
        if (!enabled) {
            return;
        }
        
        asyncRunner.execute(() -> {
            try {
                JsonObject warpData = new JsonObject();
                warpData.addProperty("type", "warp_data");
                warpData.addProperty("game_id", gameId);
                warpData.addProperty("map", mapName);
                warpData.addProperty("is_ranked", isRanked);
                warpData.addProperty("timestamp", System.currentTimeMillis());
                warpData.addProperty("date", dateFormat.get().format(new Date()));
                
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
        final String snapshot;
        try {
            snapshot = plugin.getGson().toJson(game);
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Failed to serialize game result data", e);
            return;
        }

        asyncRunner.execute(() -> {
            try {
                JsonObject resultJson = JsonParser.parseString(snapshot).getAsJsonObject();

                resultJson.addProperty("type", "game_result");
                resultJson.addProperty("saved_at", System.currentTimeMillis());

                saveToFile(resultJson, game.getGameId(), "result");

            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Failed to save game result data", e);
            }
        });
    }
    public void savePendingScoringPayload(String gameId, JsonObject payload) {
        if (gameId == null || gameId.isEmpty()) {
            return;
        }
        writePending("game_" + gameId + ".json", payload);
    }

    public void savePendingVoidingPayload(String gameId, JsonObject payload) {
        if (gameId == null || gameId.isEmpty()) {
            return;
        }
        writePending("game_" + gameId + "_void.json", payload);
    }

    private void writePending(String fileName, JsonObject payload) {
        try {
            if (!pendingScoringFolder.exists() && !pendingScoringFolder.mkdirs() && !pendingScoringFolder.exists()) {
                plugin.getLogger().warning("Failed to create pending scoring directory: " + pendingScoringFolder.getAbsolutePath());
                return;
            }
            File target = new File(pendingScoringFolder, fileName);
            synchronized (lockFor(target)) {
                try (OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(target), StandardCharsets.UTF_8)) {
                    plugin.getGson().toJson(payload, writer);
                }
            }
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Failed to persist pending game message " + fileName, e);
        }
    }

    public void markScoringDelivered(String gameId) {
        if (gameId == null || gameId.isEmpty()) {
            return;
        }
        File target = new File(pendingScoringFolder, "game_" + gameId + ".json");
        File voidTarget = new File(pendingScoringFolder, "game_" + gameId + "_void.json");
        try {
            synchronized (lockFor(target)) {
                Files.deleteIfExists(target.toPath());
            }
            synchronized (lockFor(voidTarget)) {
                Files.deleteIfExists(voidTarget.toPath());
            }
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to delete delivered game message: " + target.getAbsolutePath());
        }
    }

    public List<JsonObject> getPendingScoringPayloads() {
        List<JsonObject> payloads = new ArrayList<>();
        File[] files = pendingScoringFolder.listFiles((dir, name) -> name.endsWith(".json"));
        if (files == null) {
            return payloads;
        }
        for (File file : files) {
            try {
                synchronized (lockFor(file)) {
                    try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) {
                        JsonObject payload = JsonParser.parseReader(reader).getAsJsonObject();
                        payloads.add(payload);
                    }
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "Failed to read pending scoring payload " + file.getName(), e);
            }
        }
        return payloads;
    }

    private void saveToFile(JsonObject data, String gameId, String type) throws IOException {
        String date = dateFormat.get().format(new Date());
        File dateFolder = new File(dataFolder, date);
        if (!dateFolder.exists() && !dateFolder.mkdirs() && !dateFolder.exists()) {
            plugin.getLogger().warning("Failed to create date directory: " + dateFolder.getAbsolutePath());
            return;
        }
        String timestamp = timeFormat.get().format(new Date());
        String filename = String.format("game_%s_%s_%s.json", gameId, type, timestamp);
        File file = new File(dateFolder, filename);

        try (OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
            plugin.getGson().toJson(data, writer);
            plugin.debug("Saved game " + type + " data to " + file.getAbsolutePath());
        }
    }

    private void appendToWarpFile(JsonObject warpData, String gameId) throws IOException {
        String date = dateFormat.get().format(new Date());
        File dateFolder = new File(dataFolder, date);
        if (!dateFolder.exists() && !dateFolder.mkdirs() && !dateFolder.exists()) {
            plugin.getLogger().warning("Failed to create date directory: " + dateFolder.getAbsolutePath());
            return;
        }

        String filename = String.format("game_%s_warp.json", gameId);
        File file = new File(dateFolder, filename);

        synchronized (lockFor(file)) {
            JsonArray warpsArray;

            if (file.exists()) {
                boolean corrupt = false;
                JsonArray parsed = null;
                try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) {
                    try {
                        parsed = JsonParser.parseReader(reader).getAsJsonArray();
                    } catch (Exception e) {
                        corrupt = true;
                    }
                } catch (Exception e) {
                    corrupt = true;
                }
                if (corrupt) {
                    File backup = new File(dateFolder, filename + ".corrupt-" + System.currentTimeMillis() + ".json");
                    if (file.renameTo(backup)) {
                        plugin.getLogger().warning("Backed up corrupt warp file to " + backup.getName());
                    }
                    warpsArray = new JsonArray();
                } else {
                    warpsArray = parsed != null ? parsed : new JsonArray();
                }
            } else {
                warpsArray = new JsonArray();
            }

            warpsArray.add(warpData);

            try (OutputStreamWriter writer = new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8)) {
                plugin.getGson().toJson(warpsArray, writer);
                plugin.debug("Updated game warp data in " + file.getAbsolutePath());
            }
        }
    }
    
    public boolean isEnabled() {
        return enabled;
    }

    private final Map<String, List<String>[]> gameTeams = new java.util.concurrent.ConcurrentHashMap<>();

    @SuppressWarnings("unchecked")
    public void rememberGameTeams(String gameId, JsonObject team1Json, JsonObject team2Json) {
        List<String> team1 = readTeamNames(team1Json);
        List<String> team2 = readTeamNames(team2Json);
        gameTeams.put(gameId, new List[]{team1, team2});
    }

    public List<String> findGameTeamPlayers(String gameId, int team) {
        List<String>[] teams = gameTeams.get(gameId);
        if (teams == null || team < 1 || team > teams.length) {
            return Collections.emptyList();
        }
        return teams[team - 1];
    }

    public void forgetGameTeams(String gameId) {
        gameTeams.remove(gameId);
    }

    private List<String> readTeamNames(JsonObject team) {
        List<String> names = new ArrayList<>();
        if (team != null && team.has("players")) {
            for (JsonElement element : team.getAsJsonArray("players")) {
                names.add(element.getAsString());
            }
        }
        return names;
    }
}
