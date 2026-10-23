package com.deyo.rbw.managers;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.configuration.file.FileConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.InputStreamReader;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class GameDataManagerTest {

    @TempDir
    Path tempDir;

    private RankedBedwars plugin;
    private GameDataManager manager;

    private static final java.util.concurrent.ExecutorService TEST_EXECUTOR =
            java.util.concurrent.Executors.newCachedThreadPool();

    @BeforeEach
    public void setUp() {
        plugin = mock(RankedBedwars.class);
        FileConfiguration config = mock(FileConfiguration.class);
        when(config.getBoolean(anyString(), anyBoolean())).thenAnswer(inv -> inv.getArgument(1));
        when(config.getString(anyString(), anyString())).thenAnswer(inv -> inv.getArgument(1));
        when(plugin.getConfig()).thenReturn(config);
        when(plugin.getDataFolder()).thenReturn(tempDir.toFile());
        when(plugin.getLogger()).thenReturn(Logger.getLogger("GameData-Test"));
        when(plugin.getGson()).thenReturn(new Gson());

        manager = new GameDataManager(plugin, TEST_EXECUTOR::execute);
    }

    private File warpFile(String gameId) {
        String date = new SimpleDateFormat("yyyy-MM-dd").format(new Date());
        return new File(new File(tempDir.toFile(), "games/" + date), "game_" + gameId + "_warp.json");
    }

    private int warpEntryCount(File file) {
        if (!file.exists()) return -1;
        try (InputStreamReader reader = new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8)) {
            return JsonParser.parseReader(reader).getAsJsonArray().size();
        } catch (Exception e) {
            return -2;
        }
    }

    @Test
    public void concurrentWarpsLoseNoEntries() throws Exception {
        int writers = 20;
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(writers);
        for (int i = 0; i < writers; i++) {
            new Thread(() -> {
                try {
                    start.await();
                    manager.saveGameWarpData("99", "Aquarius", new JsonObject(), new JsonObject(), true);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            }).start();
        }
        start.countDown();
        assertTrue(done.await(10, TimeUnit.SECONDS));

        File file = warpFile("99");
        long deadline = System.currentTimeMillis() + 15000;
        int count = warpEntryCount(file);
        while (count != writers && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
            count = warpEntryCount(file);
        }
        assertEquals(writers, count);
    }

    @Test
    public void corruptWarpFileIsBackedUpInsteadOfDiscarded() throws Exception {
        File file = warpFile("7");
        assertTrue(file.getParentFile().mkdirs());
        Files.write(file.toPath(), "not json at all{{{".getBytes(StandardCharsets.UTF_8));

        manager.saveGameWarpData("7", "Aquarius", new JsonObject(), new JsonObject(), true);

        long deadline = System.currentTimeMillis() + 10000;
        while (warpEntryCount(file) != 1 && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }
        assertEquals(1, warpEntryCount(file));

        File[] backups = file.getParentFile().listFiles(
                (dir, name) -> name.startsWith("game_7_warp.json.corrupt-"));
        assertTrue(backups != null && backups.length == 1);
        String preserved = new String(Files.readAllBytes(backups[0].toPath()), StandardCharsets.UTF_8);
        assertEquals("not json at all{{{", preserved);
    }
}
