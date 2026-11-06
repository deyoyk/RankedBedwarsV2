package com.deyo.rbw.update;

import com.deyo.rbw.RankedBedwars;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.logging.Logger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Opt-in integration check against the real GitHub release API.
 * Run with: mvn -Dtest=PluginUpdaterLiveTest -Drbw.liveUpdateTest=true test
 */
public class PluginUpdaterLiveTest {

    @TempDir
    Path tempDir;

    @Test
    public void downloadsRealLatestRelease() throws Exception {
        Assumptions.assumeTrue(
                Boolean.getBoolean("rbw.liveUpdateTest"),
                "set -Drbw.liveUpdateTest=true to call the real GitHub API"
        );

        RankedBedwars plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("Updater-Live-Test"));

        Path currentJar = tempDir.resolve("RankedBedwars.jar");
        Files.write(currentJar, new byte[]{0x50, 0x4B, 0x03, 0x04, 'o', 'l', 'd'});

        PluginUpdater.Options options = new PluginUpdater.Options(
                true,
                "deyoyk/RankedBedwarsV2",
                "rbw-plugin.jar",
                "https://api.github.com",
                System.getenv("GITHUB_TOKEN"),
                false,
                true,
                false,
                false
        );
        PluginUpdater updater = new PluginUpdater(
                plugin,
                currentJar,
                tempDir.resolve("data"),
                options,
                Instant.parse("2020-01-01T00:00:00Z")
        );

        PluginUpdater.Result result = updater.checkForUpdates();

        assertEquals(PluginUpdater.Status.STAGED, result.status, result.message);
        assertNotNull(result.tag);
        assertNotNull(result.sha256);
        assertTrue(result.sha256.matches("[0-9a-f]{64}"));
        assertTrue(Files.exists(tempDir.resolve("data/updates/pending-update.json")));
    }
}
