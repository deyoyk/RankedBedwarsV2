package com.deyo.rbw.bedwars;

import com.deyo.rbw.RankedBedwars;
import org.bukkit.Bukkit;

public class BedwarsAPIManager {

    private static BedwarsAPI implementation;
    private static boolean initialized = false;

    public static boolean initialize(RankedBedwars plugin) {
        if (initialized) return implementation != null;
        
        
        if (Bukkit.getPluginManager().getPlugin("MBedwars") != null) {
            try {
                
                Class<?> implClass = Class.forName("com.deyo.rbw.bedwars.mbedwars.MBedwarsImplementation");
                implementation = (BedwarsAPI) implClass.getDeclaredConstructor().newInstance();
                implementation.initialize(plugin);
                
                plugin.getLogger().info("Successfully loaded MBedwars integration!");
                initialized = true;
                return true;
            } catch (Exception e) {
                plugin.getLogger().severe("Failed to load MBedwars implementation: " + e.getMessage());
                e.printStackTrace();
            }
        }
        
        
        else if (Bukkit.getPluginManager().getPlugin("BedWars1058") != null) {
            try {
                
                Class<?> implClass = Class.forName("com.deyo.rbw.bedwars.bedwars1058.BedWars1058Implementation");
                implementation = (BedwarsAPI) implClass.getDeclaredConstructor().newInstance();
                implementation.initialize(plugin);
                
                plugin.getLogger().info("Successfully loaded BedWars1058 integration!");
                initialized = true;
                return true;
            } catch (Exception e) {
                plugin.getLogger().severe("Failed to load BedWars1058 implementation: " + e.getMessage());
                e.printStackTrace();
            }
        }
        
        
        plugin.getLogger().severe("No supported BedWars plugin found! Please install MBedwars or BedWars1058.");
        initialized = true;
        return false;
    }

    public static BedwarsAPI getImplementation() {
        return implementation;
    }
    
    public static boolean isAvailable() {
        return implementation != null && implementation.isAvailable();
    }
}
