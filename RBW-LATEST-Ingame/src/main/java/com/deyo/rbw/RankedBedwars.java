package com.deyo.rbw;

import com.deyo.rbw.commands.AdminCommand;
import com.deyo.rbw.commands.CallCmd;
import com.deyo.rbw.commands.QueueCmd;
import com.deyo.rbw.listeners.PlayerListener;
import com.deyo.rbw.managers.GameDataManager;
import com.deyo.rbw.managers.MapManager;
import com.deyo.rbw.managers.WebSocketManager;
import com.deyo.rbw.placeholders.RankedBedwarsExpansion;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;


public class RankedBedwars extends JavaPlugin {
    private WebSocketManager webSocketManager;
    private GameDataManager gameDataManager;
    private MapManager mapManager;
    private final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private AdminCommand adminCommand;
    private CallCmd callCommand;
    private QueueCmd queueCommand;
    private RankedBedwarsExpansion placeholderExpansion;

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

    @Override
    public void onEnable() {
        
        saveDefaultConfig();
        
        
        savePermissionsFile();
        
        initializeManagers();
        AdminCommand adminCmd = new AdminCommand(this);
        setAdminCommand(adminCmd);
        getCommand("rankedbedwars").setExecutor(adminCmd);

        callCommand = new CallCmd(this);
        getCommand("call").setExecutor(callCommand);

        queueCommand = new QueueCmd(this);
        getCommand("queue").setExecutor(queueCommand);

        // Register /ss command
        com.deyo.rbw.commands.SsCmd ssCmd = new com.deyo.rbw.commands.SsCmd(this);
        getCommand("ss").setExecutor(ssCmd);

        
        com.deyo.rbw.utils.APIClient apiClient = new com.deyo.rbw.utils.APIClient(getGson(), getLogger(), getConfig());
        com.deyo.rbw.commands.StatsCmd statsCmd = new com.deyo.rbw.commands.StatsCmd(this, apiClient);
        getCommand("stats").setExecutor(statsCmd);
        
        if (com.deyo.rbw.bedwars.BedwarsAPIManager.initialize(this)) {
            com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().registerListeners();
        } else {
            getLogger().severe("No supported BedWars plugin found! The plugin may not function correctly.");
        }
        
        getServer().getPluginManager().registerEvents(new PlayerListener(this), this);
        
        
        if (getServer().getPluginManager().getPlugin("PlaceholderAPI") != null) {
            placeholderExpansion = new RankedBedwarsExpansion(this);
            placeholderExpansion.register();
            getLogger().info("PlaceholderAPI integration enabled!");
        }
        
        getLogger().info("rankedbedwars has been enabled!");
    }

    @Override
    public void onDisable() {
        
        if (placeholderExpansion != null) {
            placeholderExpansion.unregister();
        }
        
        if (webSocketManager != null) {
            webSocketManager.shutdown();
        }
        getLogger().info("rankedbedwars has been disabled!");
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

    public MapManager getMapManager() {
        return mapManager;
    }

    public Gson getGson() {
        return gson;
    }
    
    public RankedBedwarsExpansion getPlaceholderExpansion() {
        return placeholderExpansion;
    }

    public com.deyo.rbw.bedwars.BedwarsAPIManager getbedwarsAPIManager() {
        return new com.deyo.rbw.bedwars.BedwarsAPIManager();
    }

    public boolean isBedWars1058() {
        return com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
               com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getName().equals("BedWars1058");
    }

    public boolean isMBedwars() {
        return com.deyo.rbw.bedwars.BedwarsAPIManager.isAvailable() && 
               com.deyo.rbw.bedwars.BedwarsAPIManager.getImplementation().getName().equals("MBedwars");
    }

    private void savePermissionsFile() {
        java.io.File permissionFile = new java.io.File(getDataFolder(), "permission.yml");
        if (!permissionFile.exists()) {
            saveResource("permission.yml", false);
            getLogger().info("Created default permission.yml file");
        }
    }
}
