package com.deyo.rbw.bedwars;

import com.deyo.rbw.RankedBedwars;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;

public class BedwarsPluginUtil {
    
    public enum BedwarsType {
        MBEDWARS,
        BEDWARS1058,
        UNKNOWN
    }
    
    private static BedwarsType detectedType = null;
    private static boolean checkedPlugins = false;
    
    public static BedwarsType detectBedwarsPlugin(RankedBedwars plugin) {
        if (detectedType != null) {
            return detectedType;
        }
        
        if (!checkedPlugins) {
            Plugin mbedwars = Bukkit.getPluginManager().getPlugin("MBedwars");
            Plugin bedwars1058 = Bukkit.getPluginManager().getPlugin("BedWars1058");
            
            if (mbedwars != null && mbedwars.isEnabled()) {
                detectedType = BedwarsType.MBEDWARS;
                plugin.getLogger().info("Detected MBedwars plugin (version " + mbedwars.getDescription().getVersion() + ")");
            } else if (bedwars1058 != null && bedwars1058.isEnabled()) {
                detectedType = BedwarsType.BEDWARS1058;
                plugin.getLogger().info("Detected BedWars1058 plugin (version " + bedwars1058.getDescription().getVersion() + ")");
                plugin.getLogger().warning("BedWars1058 support is not fully implemented yet!");
            } else {
                detectedType = BedwarsType.UNKNOWN;
                plugin.getLogger().severe("No supported BedWars plugin detected! Please install MBedwars or BedWars1058.");
            }
            
            checkedPlugins = true;
        }
        
        return detectedType;
    }
    
    public static boolean isMBedwars(RankedBedwars plugin) {
        return detectBedwarsPlugin(plugin) == BedwarsType.MBEDWARS;
    }
    
    public static boolean isBedWars1058(RankedBedwars plugin) {
        return detectBedwarsPlugin(plugin) == BedwarsType.BEDWARS1058;
    }
}
