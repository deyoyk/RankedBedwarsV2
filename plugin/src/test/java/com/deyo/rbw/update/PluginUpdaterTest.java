package com.deyo.rbw.update;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Logger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

public class PluginUpdaterTest {

    private static final byte[] OLD_JAR = new byte[]{0x50, 0x4B, 0x03, 0x04, 'o', 'l', 'd'};

    @TempDir
    Path tempDir;

    private RankedBedwars plugin;
    private HttpServer server;
    private Path currentJar;
    private Path dataDir;
    private byte[] newJar;
    private final AtomicReference<byte[]> servedAsset = new AtomicReference<>();
    private final AtomicReference<String> releaseJson = new AtomicReference<>();
    private int port;

    @BeforeEach
    public void setUp() throws Exception {
        plugin = mock(RankedBedwars.class);
        when(plugin.getLogger()).thenReturn(Logger.getLogger("Updater-Test"));

        currentJar = tempDir.resolve("RankedBedwars.jar");
        Files.write(currentJar, OLD_JAR);
        dataDir = tempDir.resolve("data");
        newJar = newJarBytes();

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/repos/owner/repo/releases/latest", exchange -> {
            byte[] body = releaseJson.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.createContext("/download/rbw-plugin.jar", exchange -> {
            byte[] body = servedAsset.get();
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.createContext("/redirect/rbw-plugin.jar", exchange -> {
            exchange.getResponseHeaders().add("Location", "/download/rbw-plugin.jar");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.start();
        port = server.getAddress().getPort();
    }

    @AfterEach
    public void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    private PluginUpdater.Options options() {
        return new PluginUpdater.Options(
                true,
                "owner/repo",
                "rbw-plugin.jar",
                "http://127.0.0.1:" + port,
                "",
                false,
                true,
                false,
                true
        );
    }

    private PluginUpdater updater(Instant localBuildTime) {
        return new PluginUpdater(plugin, currentJar, dataDir, options(), localBuildTime);
    }

    private void releaseWith(String tag, byte[] asset, String digest, String createdAt) {
        releaseWith(tag, asset, digest, createdAt, "/download/rbw-plugin.jar");
    }

    private void releaseWith(String tag, byte[] asset, String digest, String createdAt, String downloadPath) {
        JsonObject release = new JsonObject();
        release.addProperty("tag_name", tag);
        release.addProperty("published_at", createdAt);
        JsonArray assets = new JsonArray();

        JsonObject other = new JsonObject();
        other.addProperty("name", "release-notes.txt");
        other.addProperty("browser_download_url", "http://127.0.0.1:" + port + "/download/notes.txt");
        other.addProperty("created_at", createdAt);
        assets.add(other);

        JsonObject jar = new JsonObject();
        jar.addProperty("name", "rbw-plugin.jar");
        jar.addProperty("size", asset.length);
        jar.addProperty("created_at", createdAt);
        jar.addProperty("browser_download_url", "http://127.0.0.1:" + port + downloadPath);
        if (digest != null) {
            jar.addProperty("digest", "sha256:" + digest);
        }
        assets.add(jar);

        release.add("assets", assets);
        releaseJson.set(release.toString());
        servedAsset.set(asset);
    }

    private static byte[] newJarBytes() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("com/deyo/rbw/update/PluginUpdater.class"));
            zip.write(new byte[]{1, 2, 3, 4});
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("plugin.yml"));
            zip.write("name: rankedbedwars\n".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return out.toByteArray();
    }

    private static byte[] jarWithoutUpdaterBytes() throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("plugin.yml"));
            zip.write("name: rankedbedwars\n".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return out.toByteArray();
    }

    private static String sha256(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(bytes);
        StringBuilder out = new StringBuilder();
        for (byte value : hash) {
            out.append(String.format("%02x", value));
        }
        return out.toString();
    }

    @Test
    public void upToDateWhenRemoteDigestMatchesCurrentJar() throws Exception {
        releaseWith("v6", OLD_JAR, sha256(OLD_JAR), "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.UP_TO_DATE, result.status);
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void downloadsAndStagesNewJar() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.STAGED, result.status);
        assertEquals(sha256(newJar), result.sha256);
        Path pending = dataDir.resolve("updates/pending-update.json");
        assertTrue(Files.exists(pending));
        String json = new String(Files.readAllBytes(pending), StandardCharsets.UTF_8);
        assertTrue(json.contains("\"tag\":\"v6\""));
        assertTrue(json.contains(sha256(newJar)));
    }

    @Test
    public void followsGitHubAssetRedirect() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z", "/redirect/rbw-plugin.jar");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.STAGED, result.status, result.message);
        assertTrue(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void refusesUpdateThatWouldRemoveTheUpdater() throws Exception {
        byte[] plainJar = jarWithoutUpdaterBytes();
        releaseWith("v6", plainJar, sha256(plainJar), "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.FAILED, result.status);
        assertTrue(result.message.contains("does not contain the auto-updater"));
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void rejectsChecksumMismatch() throws Exception {
        releaseWith("v6", newJar, "0000000000000000000000000000000000000000000000000000000000000000",
                "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.FAILED, result.status);
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void comparesDownloadWhenReleaseHasNoDigest() throws Exception {
        releaseWith("v6", OLD_JAR, null, "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2020-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.UP_TO_DATE, result.status);
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void doesNotDowngradeNewerLocalBuild() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z");

        PluginUpdater.Result result = updater(Instant.parse("2027-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.DOWNGRADE_PREVENTED, result.status);
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void downgradeCheckDiscardsAnOlderStagedUpdate() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z");
        assertEquals(PluginUpdater.Status.STAGED, updater(Instant.parse("2020-01-01T00:00:00Z"))
                .checkForUpdates().status);
        assertTrue(Files.exists(dataDir.resolve("updates/pending-update.json")));

        PluginUpdater.Result result = updater(Instant.parse("2027-01-01T00:00:00Z")).checkForUpdates();

        assertEquals(PluginUpdater.Status.DOWNGRADE_PREVENTED, result.status);
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
    }

    @Test
    public void appliesStagedUpdateThroughDetachedStarter() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z");
        PluginUpdater updater = updater(Instant.parse("2020-01-01T00:00:00Z"));
        assertEquals(PluginUpdater.Status.STAGED, updater.checkForUpdates().status);

        AtomicReference<List<String>> command = new AtomicReference<>();
        updater.setProcessStarter((cmd, log) -> {
            command.set(cmd);
            return mock(Process.class);
        });

        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        assertTrue(updater.applyStagedUpdate());
        if (!windows) {
            assertArrayEquals(newJar, Files.readAllBytes(currentJar));
            assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
            assertTrue(Files.exists(dataDir.resolve("updates/last-update.json")));
            return;
        }
        assertNotNull(command.get());
        assertFalse(command.get().isEmpty());
        assertTrue(Files.exists(dataDir.resolve("updates/pending-update.json")));

        Path script = Files.list(dataDir.resolve("updates"))
                .filter(path -> path.getFileName().toString().startsWith("apply-update-"))
                .findFirst()
                .orElse(null);
        assertNotNull(script);
        String content = new String(Files.readAllBytes(script), StandardCharsets.UTF_8);
        assertTrue(content.contains(currentJar.toString()));
        assertTrue(content.contains("pending-update.json"));
    }

    @Test
    public void generatedScriptReplacesJarAndCleansPendingState() throws Exception {
        releaseWith("v6", newJar, sha256(newJar), "2026-01-01T00:00:00Z");
        PluginUpdater updater = updater(Instant.parse("2020-01-01T00:00:00Z"));
        assertEquals(PluginUpdater.Status.STAGED, updater.checkForUpdates().status);
        updater.setWaitForPidForTest(2147480000L);
        updater.setProcessStarter((cmd, log) -> mock(Process.class));

        assertTrue(updater.applyStagedUpdate());

        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        if (windows) {
            Path script = Files.list(dataDir.resolve("updates"))
                    .filter(path -> path.getFileName().toString().startsWith("apply-update-"))
                    .findFirst()
                    .orElse(null);
            assertNotNull(script);

            ProcessBuilder builder = new ProcessBuilder(
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy", "Bypass",
                    "-File", script.toString()
            );
            builder.redirectErrorStream(true);
            Process process = builder.start();
            assertTrue(process.waitFor(60, TimeUnit.SECONDS), "update script did not finish");
            assertEquals(0, process.exitValue());
        }

        assertArrayEquals(newJar, Files.readAllBytes(currentJar));
        assertFalse(Files.exists(dataDir.resolve("updates/pending-update.json")));
        assertTrue(Files.exists(dataDir.resolve("updates/last-update.json")));
    }
}
