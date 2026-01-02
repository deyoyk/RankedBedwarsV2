package com.deyo.rbw.models;

import lombok.Data;

@Data
public class LeaderboardEntry {
    private String ign;
    private double value;
    
    
    public LeaderboardEntry() {
        this.ign = "NaN";
        this.value = Double.NaN;
    }

    public LeaderboardEntry(String ign, double value) {
        this.ign = ign;
        this.value = value;
    }
}
