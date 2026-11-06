package com.deyo.rbw;

import com.deyo.rbw.commands.AdminCommand;
import com.deyo.rbw.commands.CallCmd;
import com.deyo.rbw.commands.PrivateCmd;
import com.deyo.rbw.commands.QueueCmd;
import com.deyo.rbw.models.LiveGameStats;
import com.deyo.rbw.listeners.PlayerListener;
import com.deyo.rbw.managers.GameDataManager;
import com.deyo.rbw.managers.MapManager;
import com.deyo.rbw.managers.WebSocketManager;
import com.deyo.rbw.placeholders.RankedBedwarsExpansion;
import com.deyo.rbw.update.PluginUpdater;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.File;
import java.nio.file.Path;
import java.util.logging.Level;


public class RankedBedwars extends JavaPlugin {
    private WebSocketManager webSocketManager;
    private GameDataManager gameDataManager;
    private MapManager mapManager;
    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private AdminCommand adminCommand;
    private CallCmd callCommand;
    private QueueCmd queueCommand;
    private PrivateCmd privateCommand;
    private RankedBedwarsExpansion placeholderExpansion;
    private com.deyo.rbw.utils.APIClient apiClient;
    private PluginUpdater pluginUpdater;
    private BukkitTask updateCheckTask;
    private boolean updateShutdownHookRegistered;

    public AdminCommand getAdminCommand() {
        return adminCommand;
    }

    public void setAdminCommand(AdminCommand adminCommand) {
        this.adminCommand = adminCommand;
    }
    
    public CallCmd getCallCommand() {
        return callCommand;
    }
    
    public QueueCmd getQueueCommand() {
        return queueCommand;
    }

    public PrivateCmd getPrivateCommand() {
        return privateCommand;
    }

    @Override
    public void onEnable() {
        
        saveDefaultConfig();
        migrateConfig();

        // Check for a newer release in the background. The jar itself is
        // swapped after this process exits, so the next restart runs it.
        pluginUpdater = new PluginUpdater(this);
        pluginUpdater.checkForUpdatesAsync();
        registerUpdateShutdownHook();
        if (updateCheckTask == null) {
            updateCheckTask = getServer().getScheduler().runTaskTimer(
                    this,
                    () -> {
                        if (pluginUpdater != null) {
                            pluginUpdater.checkForUpdatesAsync();
                        }
                    },
                    20L * 60L * 5L,
                    20L * 60L * 5L
            );
        }

        savePermissionsFile();
        
        initializeManagers();
        AdminCommand adminCmd = new AdminCommand(this);
        setAdminCommand(adminCmd);
        getCommand("rankedbedwars").setExecutor(adminCmd);

        callCommand = new CallCmd(this);
        getCommand("call").setExecutor(callCommand);

        queueCommand = new QueueCmd(this);
        getCommand("queue").setExecutor(queueCommand);

        privateCommand = new PrivateCmd(this);
        getCommand("private").setExecutor(privateCommand);

        com.deyo.rbw.commands.SsCmd ssCmd = new com.deyo.rbw.commands.SsCmd(this);
        getCommand("ss").setExecutor(ssCmd);

        
        apiClient = new com.deyo.rbw.utils.APIClient(getGson(), getLogger(), getConfig());
        com.deyo.rbw.commands.StatsCmd statsCmd = new com.deyo.rbw.commands.StatsCmd(this, apiClient);
        getCommand("stats").setExecutor(statsCmd);
        
        if (com.deyo.rbw.bedwars.BedwarsAPIManager.initialize(this)) {
            com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().registerListeners();
        } else {
            getLogger().severe("No supported BedWars plugin found! The plugin may not function correctly.");
        }
        
        getServer().getPluginManager().registerEvents(new PlayerListener(this), this);
        
        
        if (getServer().getPluginManager().getPlugin("PlaceholderAPI") != null) {
            registerPlaceholderExpansion();
            // External PlaceholderAPI expansions may load after this plugin.
            // Re-check once the server has finished enabling everything.
            getServer().getScheduler().runTaskLater(this, this::registerPlaceholderExpansion, 40L);
        }
        
        getLogger().info("rankedbedwars has been enabled!");
    }

    private void registerPlaceholderExpansion() {
        if (getServer().getPluginManager().getPlugin("PlaceholderAPI") == null) {
            return;
        }
        try {
            if (placeholderExpansion == null) {
                placeholderExpansion = new RankedBedwarsExpansion(this);
            }
            me.clip.placeholderapi.expansion.PlaceholderExpansion existing =
                    me.clip.placeholderapi.PlaceholderAPIPlugin.getInstance()
                            .getLocalExpansionManager().getExpansion("rbw");
            if (existing != null && existing != placeholderExpansion) {
                existing.unregister();
                getLogger().info("Replaced stale rbw placeholder expansion: "
                        + existing.getClass().getName());
            }
            if (!placeholderExpansion.isRegistered() && !placeholderExpansion.register()) {
                getLogger().warning("PlaceholderAPI expansion could not be registered!");
                return;
            }
            getLogger().info("PlaceholderAPI integration enabled! (%rbw_version% = "
                    + getDescription().getVersion() + ")");
            runPlaceholderSelfTest();
        } catch (Throwable error) {
            getLogger().warning("PlaceholderAPI registration failed: " + error.getMessage());
        }
    }

    private void runPlaceholderSelfTest() {
        try {
            String selfTest = me.clip.placeholderapi.PlaceholderAPI.setPlaceholders(
                    (org.bukkit.OfflinePlayer) null, "%rbw_top_elo_1%");
            getLogger().info("Placeholder self-test %rbw_top_elo_1% -> " + selfTest);
        } catch (Throwable selfTestError) {
            getLogger().warning("Placeholder self-test failed: " + selfTestError.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (updateCheckTask != null) {
            updateCheckTask.cancel();
            updateCheckTask = null;
        }
        if (placeholderExpansion != null) {
            placeholderExpansion.unregister();
        }
        
        if (webSocketManager != null) {
            webSocketManager.shutdown();
        }
        if (apiClient != null) {
            apiClient.shutdown();
        }
        getLogger().info("rankedbedwars has been disabled!");
    }

    private void migrateConfig() {
        Path configPath = new File(getDataFolder(), "config.yml").toPath();
        try {
            if (com.deyo.rbw.utils.ConfigMigration.removeLegacyApiSection(configPath)) {
                reloadConfig();
                getLogger().info("Removed legacy api config section; bot_url now covers both WebSocket and HTTP API.");
            }
        } catch (Exception error) {
            getLogger().log(Level.WARNING, "Could not remove legacy api config section", error);
        }
    }

    private void registerUpdateShutdownHook() {
        if (updateShutdownHookRegistered) {
            return;
        }
        updateShutdownHookRegistered = true;
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try {
                PluginUpdater updater = RankedBedwars.this.pluginUpdater;
                if (updater != null) {
                    updater.applyStagedUpdate();
                }
            } catch (Throwable error) {
                getLogger().log(Level.WARNING, "Auto-update replacement could not be started", error);
            }
        }, "RBW-AutoUpdate"));
    }

    private void initializeManagers() {
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                webSocketManager = new WebSocketManager(this);
                webSocketManager.initialize();

                gameDataManager = new GameDataManager(this);
                getLogger().info("Game data storage " + (gameDataManager.isEnabled() ? "enabled" : "disabled") + " in configuration");
                mapManager = new MapManager(this);
                mapManager.startMapAutoRefresh();
                
                
				getServer().getScheduler().runTaskLater(RankedBedwars.this, () -> {
					if (com.deyo.rbw.bedwars.BedwarsAPIManager.initialize(RankedBedwars.this)) {
						getLogger().info("Using " + com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getName() + " implementation!");
						com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().initializeMaps();
					} else {
						getLogger().severe("No supported BedWars plugin found! The plugin may not function correctly.");
					}
				}, 40L * 20L);
            } catch (Exception e) {
                getLogger().log(Level.SEVERE, "Failed to initialize managers", e);
            }
        });
    }

    public void debug(String message) {
        if (getConfig().getBoolean("debug")) {
            getLogger().info("[DEBUG] " + message);
        }
    }

    public void reload() {
        reloadConfig();
        migrateConfig();

        pluginUpdater = new PluginUpdater(this);

        savePermissionsFile();
        
        
        if (placeholderExpansion != null) {
            placeholderExpansion.clearCache();
        }

        
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            if (webSocketManager != null) {
                webSocketManager.shutdown();
            }
            webSocketManager = new WebSocketManager(this);
            webSocketManager.initialize();
            
            gameDataManager = new GameDataManager(this);
            getLogger().info("Game data storage " + (gameDataManager.isEnabled() ? "enabled" : "disabled") + " after reload");
            getLogger().info("rankedbedwars has been reloaded!");
        });
    }

    public WebSocketManager getWebSocketManager() {
        return webSocketManager;
    }

    public GameDataManager getGameDataManager() {
        return gameDataManager;
    }

    public PluginUpdater getPluginUpdater() {
        return pluginUpdater;
    }

    public MapManager getMapManager() {
        return mapManager;
    }

    public Gson getGson() {
        return gson;
    }
    
    public RankedBedwarsExpansion getPlaceholderExpansion() {
        return placeholderExpansion;
    }

    public boolean isBedWars1058() {
        return com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
               com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getName().equals("BedWars1058");
    }

    public boolean isMBedwars() {
        return com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
               com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getName().equals("MBedwars");
    }

    /**
     * Single source of truth for "is this player currently inside a BedWars arena".
     * The BedWars plugin owns this state, not the RBW game database.
     */
    public boolean isInBedwarsGame(org.bukkit.entity.Player player) {
        if (player == null || !com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable()) {
            return false;
        }
        try {
            return com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getArenaByPlayer(player) != null;
        } catch (Exception e) {
            debug("Could not read BedWars arena for " + player.getName() + ": " + e.getMessage());
            return false;
        }
    }

    public LiveGameStats getLiveGameStats(org.bukkit.entity.Player player) {
        if (player == null || !com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable()) {
            return null;
        }
        try {
            if (isMBedwars()) {
                com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation impl =
                        (com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation)
                                com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation();
                return impl.getListener() != null ? impl.getListener().getLiveGameStats(player) : null;
            }
            if (isBedWars1058()) {
                com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation impl =
                        (com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation)
                                com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation();
                return impl.getListener() != null ? impl.getListener().getLiveGameStats(player) : null;
            }
        } catch (Exception e) {
            getLogger().warning("Could not read live game stats for " + player.getName() + ": " + e.getMessage());
        }
        return null;
    }

    private void savePermissionsFile() {
        java.io.File permissionFile = new java.io.File(getDataFolder(), "permission.yml");
        if (!permissionFile.exists()) {
            saveResource("permission.yml", false);
            getLogger().info("Created default permission.yml file");
        }
    }
}
