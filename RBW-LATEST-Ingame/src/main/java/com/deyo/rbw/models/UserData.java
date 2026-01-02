package com.deyo.rbw.models;

import lombok.Data;
import java.util.List;

@Data
public class UserData {
    private String _id;
    private String discordId;
    private String ign;
    private int elo;
    private int wins;
    private int losses;
    private int games;
    private int mvps;
    private int kills;
    private int deaths;
    private int bedBroken;
    private int finalKills;
    private int diamonds;
    private int irons;
    private int gold;
    private int emeralds;
    private int blocksPlaced;
    private boolean isbanned;
    private boolean ismuted;
    private boolean isfrozen;
    private int winstreak;
    private int losestreak;
    private double kdr;
    private double wlr;

    private int __v;



}
