package com.deyo.rbw.utils;

import com.deyo.rbw.models.LeaderboardEntry;
import com.deyo.rbw.models.UserData;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import org.bukkit.configuration.file.FileConfiguration;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.Type;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.logging.Logger;

public class APIClient {
    private final String baseUrl;
    private final Gson gson;
    private final Logger logger;

    public APIClient(Gson gson, Logger logger, FileConfiguration config) {
        this.gson = gson;
        this.logger = logger;
        
        String host = "websocket.deyo.lol";
        int port = config.getInt("port", 25506);
        String endpoint = "/rbw/api";
        
        this.baseUrl = "http://" + host + ":" + port + endpoint;
        logger.info("API Client initialized with base URL: " + this.baseUrl);
    }

    public CompletableFuture<UserData> getUserData(String ign) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String url = baseUrl + "/user?ign=" + ign;
                String response = makeHttpRequest(url);
                if (response != null) {
                    if (response.equals("NaN")) {
                        return createDefaultUserData();
                    }
                    return gson.fromJson(response, UserData.class);
                }
            } catch (Exception e) {
                logger.warning("Failed to fetch user data for " + ign + ": " + e.getMessage());
            }
            return createDefaultUserData();
        });
    }

    public CompletableFuture<Map<Integer, LeaderboardEntry>> getLeaderboard(String mode, int page) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                String url = baseUrl + "/leaderboard?mode=" + mode + "&page=" + page;
                String response = makeHttpRequest(url);
                if (response != null) {
                    if (response.equals("NaN")) {
                        Map<Integer, LeaderboardEntry> leaderboard = new HashMap<>();
                        leaderboard.put(-1, createDefaultLeaderboardEntry());
                        return leaderboard;
                    }
                    Type type = new TypeToken<Map<String, LeaderboardEntry>>(){}.getType();
                    Map<String, LeaderboardEntry> rawData = gson.fromJson(response, type);
                    Map<Integer, LeaderboardEntry> leaderboard = new HashMap<>();
                    for (Map.Entry<String, LeaderboardEntry> entry : rawData.entrySet()) {
                        try {
                            int position = Integer.parseInt(entry.getKey());
                            leaderboard.put(position, entry.getValue());
                        } catch (NumberFormatException e) {
                        }
                    }
                    return leaderboard;
                }
            } catch (Exception e) {
                logger.warning("Failed to fetch leaderboard for mode " + mode + " page " + page + ": " + e.getMessage());
            }
            return new HashMap<>();
        });
    }

    private String makeHttpRequest(String urlString) throws IOException {
        URL url = new URL(urlString);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(5000);

        int responseCode = connection.getResponseCode();
        if (responseCode == HttpURLConnection.HTTP_OK) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream()));
            StringBuilder response = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                response.append(line);
            }
            reader.close();
            return response.toString();
        } else {
            logger.warning("HTTP request failed with response code: " + responseCode);
            if (responseCode == HttpURLConnection.HTTP_NOT_FOUND) {
                return "NaN";
            }
            return null;
        }
    }

    private UserData createDefaultUserData() {
        UserData userData = new UserData();
        userData.set_id("0");
        userData.setDiscordId("0");
        userData.setIgn("Unknown");
        userData.setElo(0);
        userData.setWins(0);
        userData.setLosses(0);
        userData.setGames(0);
        userData.setMvps(0);
        userData.setKills(0);
        userData.setDeaths(0);
        userData.setBedBroken(0);
        userData.setFinalKills(0);
        userData.setDiamonds(0);
        userData.setIrons(0);
        userData.setGold(0);
        userData.setEmeralds(0);
        userData.setBlocksPlaced(0);
        userData.setIsbanned(false);
        userData.setIsmuted(false);
        userData.setIsfrozen(false);
        userData.setWinstreak(0);
        userData.setLosestreak(0);
        userData.setKdr(0.0);
        userData.setWlr(0.0);
        userData.set__v(0);
        return userData;
    }

    private LeaderboardEntry createDefaultLeaderboardEntry() {
        return new LeaderboardEntry("Unknown", 0.0);
    }
}
