package com.deyo.rbw.update;

import com.deyo.rbw.RankedBedwars;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.zip.ZipFile;

/**
 * Downloads the newest plugin jar from GitHub releases and stages it for
 * replacement when the server process exits.
 *
 * <p>Minecraft loads plugin jars at startup and keeps them open, so the plugin
 * cannot replace its own jar while it is running (especially on Windows).
 * Instead, this updater blocks accidental downgrades, verifies the download,
 * and starts a tiny detached script that waits for the server PID to exit,
 * backs up the old jar, copies the new one into place, and writes an applied
 * marker. The next server restart loads the new jar.</p>
 */
public class PluginUpdater {

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final long MAX_DOWNLOAD_BYTES = 50L * 1024L * 1024L;
    private static final long MAX_METADATA_BYTES = 2L * 1024L * 1024L;
    private static final long CLOCK_SKEW_TOLERANCE_SECONDS = 600L;
    private static final Object UPDATE_LOCK = new Object();

    public enum Status {
        DISABLED,
        UNSUPPORTED,
        UP_TO_DATE,
        STAGED,
        DOWNGRADE_PREVENTED,
        FAILED
    }

    public static final class Result {
        public final Status status;
        public final String message;
        public final String tag;
        public final String sha256;

        Result(Status status, String message, String tag, String sha256) {
            this.status = status;
            this.message = message;
            this.tag = tag;
            this.sha256 = sha256;
        }

        public boolean isStaged() {
            return status == Status.STAGED;
        }
    }

    static final class Options {
        final boolean enabled;
        final String repo;
        final String assetName;
        final String apiBase;
        final String token;
        final boolean includePrereleases;
        final boolean backup;
        final boolean allowDowngrade;
        final boolean allowInsecureHttp;

        Options(
                boolean enabled,
                String repo,
                String assetName,
                String apiBase,
                String token,
                boolean includePrereleases,
                boolean backup,
                boolean allowDowngrade,
                boolean allowInsecureHttp
        ) {
            this.enabled = enabled;
            this.repo = repo == null ? "" : repo.trim();
            this.assetName = assetName == null || assetName.trim().isEmpty() ? "rbw-plugin.jar" : assetName.trim();
            this.apiBase = trimTrailingSlash(apiBase == null || apiBase.trim().isEmpty() ? "https://api.github.com" : apiBase.trim());
            this.token = token == null ? "" : token.trim();
            this.includePrereleases = includePrereleases;
            this.backup = backup;
            this.allowDowngrade = allowDowngrade;
            this.allowInsecureHttp = allowInsecureHttp;
        }

        static Options fromConfig(RankedBedwars plugin) {
            String token = plugin.getConfig().getString("auto-update.github-token", "");
            if (token == null || token.trim().isEmpty()) {
                token = System.getenv("RBW_GITHUB_TOKEN");
            }
            if (token == null || token.trim().isEmpty()) {
                token = System.getenv("GITHUB_TOKEN");
            }

            return new Options(
                    plugin.getConfig().getBoolean("auto-update.enabled", true),
                    plugin.getConfig().getString("auto-update.github-repo", "deyoyk/RankedBedwarsV2"),
                    plugin.getConfig().getString("auto-update.asset-name", "rbw-plugin.jar"),
                    plugin.getConfig().getString("auto-update.api-base", "https://api.github.com"),
                    token,
                    plugin.getConfig().getBoolean("auto-update.include-prereleases", false),
                    plugin.getConfig().getBoolean("auto-update.backup-current-jar", true),
                    plugin.getConfig().getBoolean("auto-update.allow-downgrade", false),
                    false
            );
        }

        private static String trimTrailingSlash(String value) {
            String result = value;
            while (result.endsWith("/")) {
                result = result.substring(0, result.length() - 1);
            }
            return result;
        }
    }

    interface ProcessStarter {
        Process start(List<String> command, Path logFile) throws IOException;
    }

    private static final class AssetInfo {
        final String name;
        final String downloadUrl;
        final String digest;
        final long size;
        final Instant createdAt;

        AssetInfo(String name, String downloadUrl, String digest, long size, Instant createdAt) {
            this.name = name;
            this.downloadUrl = downloadUrl;
            this.digest = digest;
            this.size = size;
            this.createdAt = createdAt;
        }
    }

    private static final class ReleaseInfo {
        final String tag;
        final Instant publishedAt;
        final List<AssetInfo> assets;

        ReleaseInfo(String tag, Instant publishedAt, List<AssetInfo> assets) {
            this.tag = tag;
            this.publishedAt = publishedAt;
            this.assets = assets;
        }
    }

    private static final class PendingUpdate {
        String tag;
        String asset;
        String sha256;
        String staged;
        String target;
        String downloadedAt;
    }

    private final RankedBedwars plugin;
    private final Path currentJar;
    private final Path updatesDir;
    private final Path stagedDir;
    private final Path pendingFile;
    private final Path lastUpdateFile;
    private final Path logFile;
    private final Options options;
    private final Instant localBuildTimeOverride;
    private final AtomicBoolean checking = new AtomicBoolean(false);
    private volatile ProcessStarter processStarter = this::launchProcess;
    private Long waitForPidOverride;

    public PluginUpdater(RankedBedwars plugin) {
        this(
                plugin,
                resolveCurrentJar(),
                plugin.getDataFolder().toPath(),
                Options.fromConfig(plugin),
                null
        );
    }

    PluginUpdater(
            RankedBedwars plugin,
            Path currentJar,
            Path dataDir,
            Options options,
            Instant localBuildTimeOverride
    ) {
        this.plugin = plugin;
        this.currentJar = normalizeJarPath(currentJar);
        this.updatesDir = dataDir.resolve("updates").toAbsolutePath().normalize();
        this.stagedDir = updatesDir.resolve("staged");
        this.pendingFile = updatesDir.resolve("pending-update.json");
        this.lastUpdateFile = updatesDir.resolve("last-update.json");
        this.logFile = updatesDir.resolve("updater.log");
        this.options = options;
        this.localBuildTimeOverride = localBuildTimeOverride;
    }

    void setProcessStarter(ProcessStarter processStarter) {
        this.processStarter = processStarter;
    }

    void setWaitForPidForTest(Long pid) {
        this.waitForPidOverride = pid;
    }

    private long waitForPid() {
        return waitForPidOverride != null ? waitForPidOverride : ProcessHandle.current().pid();
    }

    public void checkForUpdatesAsync() {
        if (!options.enabled) {
            plugin.debug("Auto-update is disabled");
            return;
        }
        if (currentJar == null) {
            plugin.getLogger().info("Auto-update skipped: plugin is not running from a jar file");
            return;
        }
        if (!checking.compareAndSet(false, true)) {
            return;
        }

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                logResult(checkForUpdates());
            } catch (Throwable error) {
                plugin.getLogger().log(Level.WARNING, "Auto-update check failed", error);
            } finally {
                checking.set(false);
            }
        });
    }

    public Result checkForUpdates() {
        synchronized (UPDATE_LOCK) {
            return checkForUpdatesLocked();
        }
    }

    private Result checkForUpdatesLocked() {
        if (!options.enabled) {
            return new Result(Status.DISABLED, "Auto-update is disabled", null, null);
        }
        if (currentJar == null || !Files.isRegularFile(currentJar)) {
            return new Result(Status.UNSUPPORTED, "Plugin is not running from a jar file", null, null);
        }
        if (!options.repo.matches("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")) {
            return new Result(Status.FAILED, "Invalid auto-update.github-repo: " + options.repo, null, null);
        }

        try {
            ReleaseInfo release = fetchLatestRelease();
            if (release == null) {
                return new Result(Status.FAILED, "No GitHub release found", null, null);
            }
            AssetInfo asset = selectAsset(release.assets);
            if (asset == null) {
                return new Result(
                        Status.FAILED,
                        "Latest release " + release.tag + " has no matching jar asset",
                        release.tag,
                        null
                );
            }

            String currentHash = sha256(currentJar);
            if (asset.digest != null && asset.digest.equalsIgnoreCase(currentHash)) {
                discardPendingUpdate();
                return new Result(Status.UP_TO_DATE, "Already on latest release " + release.tag, release.tag, currentHash);
            }

            Instant remoteTime = asset.createdAt != null ? asset.createdAt : release.publishedAt;
            Instant localBuildTime = resolveLocalBuildTime();
            if (!options.allowDowngrade
                    && remoteTime != null
                    && localBuildTime != null
                    && localBuildTime.isAfter(remoteTime.plusSeconds(CLOCK_SKEW_TOLERANCE_SECONDS))) {
                discardPendingUpdate();
                return new Result(
                        Status.DOWNGRADE_PREVENTED,
                        "Local build (" + localBuildTime + ") is newer than latest release " + release.tag,
                        release.tag,
                        currentHash
                );
            }

            PendingUpdate existing = readPending();
            if (existing != null) {
                if (!samePath(Paths.get(existing.target), currentJar)) {
                    cleanupPending(existing);
                    existing = null;
                } else if (existing.sha256 != null
                        && asset.digest != null
                        && existing.sha256.equalsIgnoreCase(asset.digest)
                        && Files.isRegularFile(Paths.get(existing.staged))) {
                    return new Result(
                            Status.STAGED,
                            "Update " + release.tag + " is already staged for the next restart",
                            release.tag,
                            existing.sha256
                    );
                } else {
                    cleanupPending(existing);
                }
            }

            Files.createDirectories(stagedDir);
            Path downloaded = Files.createTempFile(updatesDir, "download-", ".tmp");
            try {
                DownloadResult download = download(asset, downloaded);
                if (asset.digest != null && !asset.digest.equalsIgnoreCase(download.sha256)) {
                    return new Result(
                            Status.FAILED,
                            "Checksum mismatch for " + asset.name + " (expected " + asset.digest + ", got " + download.sha256 + ")",
                            release.tag,
                            download.sha256
                    );
                }
                if (asset.digest == null && download.sha256.equalsIgnoreCase(currentHash)) {
                    discardPendingUpdate();
                    return new Result(Status.UP_TO_DATE, "Downloaded jar matches current jar", release.tag, currentHash);
                }
                if (!looksLikeJar(downloaded)) {
                    return new Result(Status.FAILED, "Downloaded asset is not a valid jar", release.tag, download.sha256);
                }
                if (!options.allowDowngrade && !containsUpdaterClass(downloaded)) {
                    return new Result(
                            Status.FAILED,
                            "Refusing update: the release jar does not contain the auto-updater. "
                                    + "Set auto-update.allow-downgrade=true only if you intentionally want to remove auto-updates.",
                            release.tag,
                            download.sha256
                    );
                }

                Path staged = stagedDir.resolve("rbw-plugin-" + safeFileName(release.tag) + ".jar");
                Files.move(downloaded, staged, StandardCopyOption.REPLACE_EXISTING);

                PendingUpdate pending = new PendingUpdate();
                pending.tag = release.tag;
                pending.asset = asset.name;
                pending.sha256 = download.sha256;
                pending.staged = staged.toString();
                pending.target = currentJar.toString();
                pending.downloadedAt = Instant.now().toString();
                writePending(pending);

                if (!isWindows()) {
                    try {
                        installDirect(pending, staged);
                        return new Result(
                                Status.STAGED,
                                "Downloaded " + asset.name + " from release " + release.tag
                                        + "; the jar was replaced immediately, restart to load it",
                                release.tag,
                                download.sha256
                        );
                    } catch (Exception installError) {
                        plugin.getLogger().warning(
                                "Auto-update: immediate replacement failed, it will apply on shutdown: "
                                        + installError.getMessage()
                        );
                    }
                }

                return new Result(
                        Status.STAGED,
                        "Downloaded " + asset.name + " from release " + release.tag
                                + "; it will replace the plugin jar when the server stops",
                        release.tag,
                        download.sha256
                );
            } finally {
                Files.deleteIfExists(downloaded);
            }
        } catch (Exception error) {
            return new Result(Status.FAILED, error.getMessage() == null ? error.toString() : error.getMessage(), null, null);
        }
    }

    /**
     * Called during plugin disable. Starts a detached script that waits for
     * this JVM to exit, then swaps the jar. Safe to call when no update is
     * staged.
     */
    public boolean applyStagedUpdate() {
        synchronized (UPDATE_LOCK) {
            return applyStagedUpdateLocked();
        }
    }

    private boolean applyStagedUpdateLocked() {
        if (currentJar == null) return false;

        PendingUpdate pending = readPending();
        if (pending == null) return false;

        Path staged = Paths.get(pending.staged);
        Path target = Paths.get(pending.target);
        if (!Files.isRegularFile(staged)) {
            plugin.getLogger().warning("Auto-update: staged jar is missing: " + staged);
            return false;
        }
        if (!samePath(target, currentJar)) {
            plugin.getLogger().warning("Auto-update: staged target no longer matches the running jar");
            return false;
        }

        try {
            String currentHash = sha256(currentJar);
            if (pending.sha256 != null && pending.sha256.equalsIgnoreCase(currentHash)) {
                cleanupPending(pending);
                return false;
            }

            Files.createDirectories(updatesDir);
            if (!isWindows()) {
                try {
                    installDirect(pending, staged);
                    return true;
                } catch (Exception directError) {
                    plugin.getLogger().warning(
                            "Auto-update: direct replacement failed, falling back to shutdown script: " + directError.getMessage()
                    );
                }
            }
            Path script = createApplyScript(pending);
            List<String> command = buildScriptCommand(script);
            Process process = processStarter.start(command, logFile);
            if (process == null) {
                plugin.getLogger().warning("Auto-update: could not start the replacement process");
                return false;
            }
            plugin.getLogger().info(
                    "Auto-update: " + pending.tag + " staged; the jar will be replaced after this server process exits"
            );
            return true;
        } catch (Exception error) {
            plugin.getLogger().log(Level.WARNING, "Auto-update: failed to stage replacement script", error);
            return false;
        }
    }

    private void installDirect(PendingUpdate pending, Path staged) throws Exception {
        Path backup = options.backup
                ? updatesDir.resolve("backups").resolve(
                        currentJar.getFileName().toString() + "." + System.currentTimeMillis() + ".bak"
                )
                : updatesDir.resolve("old-" + System.currentTimeMillis() + ".jar");
        Files.createDirectories(backup.getParent());

        Files.move(currentJar, backup, StandardCopyOption.REPLACE_EXISTING);
        try {
            Files.move(staged, currentJar, StandardCopyOption.REPLACE_EXISTING);
        } catch (Exception error) {
            Files.move(backup, currentJar, StandardCopyOption.REPLACE_EXISTING);
            throw error;
        }
        if (!options.backup) {
            Files.deleteIfExists(backup);
        }

        writeAppliedState(pending);
        Files.deleteIfExists(pendingFile);
        plugin.getLogger().info("Auto-update: installed " + pending.tag + "; restart to load it");
    }

    private void writeAppliedState(PendingUpdate pending) throws IOException {
        JsonObject applied = new JsonObject();
        applied.addProperty("tag", pending.tag);
        applied.addProperty("asset", pending.asset);
        applied.addProperty("sha256", pending.sha256);
        applied.addProperty("appliedAt", Instant.now().toString());
        applied.addProperty("target", pending.target);
        Files.write(
                lastUpdateFile,
                applied.toString().getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE
        );
    }

    private ReleaseInfo fetchLatestRelease() throws IOException {
        String url;
        if (options.includePrereleases) {
            url = options.apiBase + "/repos/" + options.repo + "/releases?per_page=20";
        } else {
            url = options.apiBase + "/repos/" + options.repo + "/releases/latest";
        }

        String body = httpGet(url, MAX_METADATA_BYTES);
        JsonElement root = JsonParser.parseString(body);
        if (root.isJsonArray()) {
            JsonArray releases = root.getAsJsonArray();
            for (JsonElement element : releases) {
                JsonObject release = element.getAsJsonObject();
                if (isTruthy(release, "draft")) continue;
                if (!options.includePrereleases && isTruthy(release, "prerelease")) continue;
                return parseRelease(release);
            }
            return null;
        }
        if (!root.isJsonObject()) {
            throw new IOException("Unexpected GitHub release response");
        }
        return parseRelease(root.getAsJsonObject());
    }

    private ReleaseInfo parseRelease(JsonObject release) {
        String tag = getString(release, "tag_name");
        Instant published = parseInstant(getString(release, "published_at"));
        List<AssetInfo> assets = new ArrayList<>();
        JsonElement assetsElement = release.get("assets");
        if (assetsElement != null && assetsElement.isJsonArray()) {
            for (JsonElement element : assetsElement.getAsJsonArray()) {
                if (!element.isJsonObject()) continue;
                JsonObject asset = element.getAsJsonObject();
                String name = getString(asset, "name");
                String downloadUrl = getString(asset, "browser_download_url");
                if (name == null || downloadUrl == null) continue;
                String digest = getString(asset, "digest");
                if (digest != null && digest.toLowerCase(Locale.ROOT).startsWith("sha256:")) {
                    digest = digest.substring("sha256:".length());
                }
                long size = asset.has("size") ? asset.get("size").getAsLong() : -1L;
                Instant created = parseInstant(getString(asset, "created_at"));
                assets.add(new AssetInfo(name, downloadUrl, digest, size, created));
            }
        }
        return new ReleaseInfo(tag, published, assets);
    }

    private AssetInfo selectAsset(List<AssetInfo> assets) {
        AssetInfo exact = null;
        List<AssetInfo> candidates = new ArrayList<>();
        for (AssetInfo asset : assets) {
            String lower = asset.name.toLowerCase(Locale.ROOT);
            if (asset.name.equalsIgnoreCase(options.assetName)) {
                exact = asset;
            } else if (lower.endsWith(".jar")
                    && !lower.startsWith("original-")
                    && !lower.contains("-sources")
                    && !lower.contains("-javadoc")) {
                candidates.add(asset);
            }
        }
        if (exact != null) return exact;
        candidates.sort(Comparator.comparingLong((AssetInfo a) -> a.size).reversed());
        return candidates.isEmpty() ? null : candidates.get(0);
    }

    private DownloadResult download(AssetInfo asset, Path destination) throws IOException {
        if (!options.allowInsecureHttp && !asset.downloadUrl.startsWith("https://")) {
            throw new IOException("Refusing non-HTTPS update asset URL");
        }

        HttpURLConnection connection = openConnection(asset.downloadUrl);
        connection.setRequestProperty("Accept", "application/octet-stream");
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("Update download failed with HTTP " + status);
            }
            MessageDigest digest = newDigest();
            long total = 0L;
            try (InputStream input = connection.getInputStream();
                 OutputStream output = Files.newOutputStream(
                         destination,
                         StandardOpenOption.CREATE,
                         StandardOpenOption.TRUNCATE_EXISTING,
                         StandardOpenOption.WRITE
                 )) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_DOWNLOAD_BYTES) {
                        throw new IOException("Update asset exceeds the size limit");
                    }
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
            }
            return new DownloadResult(toHex(digest.digest()), total);
        } finally {
            connection.disconnect();
        }
    }

    private String httpGet(String url, long maxBytes) throws IOException {
        HttpURLConnection connection = openConnection(url);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("GitHub API returned HTTP " + status + " for " + url);
            }
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[16 * 1024];
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                int read;
                long total = 0L;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > maxBytes) {
                        throw new IOException("GitHub API response is too large");
                    }
                    output.write(buffer, 0, read);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", "RankedBedwars-AutoUpdater");
        if (!options.token.isEmpty()) {
            connection.setRequestProperty("Authorization", "Bearer " + options.token);
        }
        return connection;
    }

    private Path createApplyScript(PendingUpdate pending) throws IOException {
        boolean windows = isWindows();
        String extension = windows ? ".ps1" : ".sh";
        Path script = updatesDir.resolve("apply-update-" + safeFileName(pending.tag) + extension);
        Path backup = updatesDir.resolve("backups")
                .resolve(currentJar.getFileName().toString() + "." + System.currentTimeMillis() + ".bak");
        Files.createDirectories(backup.getParent());

        JsonObject applied = new JsonObject();
        applied.addProperty("tag", pending.tag);
        applied.addProperty("asset", pending.asset);
        applied.addProperty("sha256", pending.sha256);
        applied.addProperty("appliedAt", Instant.now().toString());
        applied.addProperty("target", pending.target);
        String appliedJson = applied.toString();

        String content = windows
                ? windowsScript(pending, script, backup, appliedJson)
                : unixScript(pending, script, backup, appliedJson);
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (windows) {
            // Windows PowerShell 5.1 needs a UTF-8 BOM to read non-ASCII paths
            // correctly.
            byte[] bom = new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
            byte[] withBom = new byte[bom.length + bytes.length];
            System.arraycopy(bom, 0, withBom, 0, bom.length);
            System.arraycopy(bytes, 0, withBom, bom.length, bytes.length);
            bytes = withBom;
        }
        Files.write(
                script,
                bytes,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE
        );
        return script;
    }

    private String windowsScript(PendingUpdate pending, Path script, Path backup, String appliedJson) {
        StringBuilder out = new StringBuilder();
        out.append("$ErrorActionPreference = 'SilentlyContinue'\n");
        out.append("$pidToWait = ").append(waitForPid()).append("\n");
        out.append("$source = ").append(psQuote(pending.staged)).append("\n");
        out.append("$target = ").append(psQuote(currentJar.toString())).append("\n");
        out.append("$backup = ").append(psQuote(backup.toString())).append("\n");
        out.append("$pending = ").append(psQuote(pendingFile.toString())).append("\n");
        out.append("$state = ").append(psQuote(lastUpdateFile.toString())).append("\n");
        out.append("$log = ").append(psQuote(logFile.toString())).append("\n");
        out.append("function Write-UpdateLog([string]$message) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' ' + $message) }\n");
        out.append("$waited = 0\n");
        out.append("while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {\n");
        out.append("  Start-Sleep -Seconds 1\n");
        out.append("  $waited++\n");
        out.append("  if ($waited -ge 900) { Write-UpdateLog 'timed out waiting for server exit'; exit 1 }\n");
        out.append("}\n");
        out.append("$moved = $false\n");
        out.append("for ($i = 0; $i -lt 30; $i++) {\n");
        out.append("  try {\n");
        if (options.backup) {
            // Backup is best-effort; a backup failure must never block the
            // actual update.
            out.append("    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force -ErrorAction SilentlyContinue }\n");
        }
        out.append("    Copy-Item -LiteralPath $source -Destination $target -Force -ErrorAction Stop\n");
        out.append("    Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue\n");
        out.append("    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLower()\n");
        out.append("    ").append(psQuote(appliedJson)).append(" | Set-Content -LiteralPath $state -Encoding UTF8\n");
        out.append("    Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue\n");
        out.append("    $moved = $true\n");
        out.append("    Write-UpdateLog 'update applied'\n");
        out.append("    break\n");
        out.append("  } catch { Write-UpdateLog $_.Exception.Message; Start-Sleep -Seconds 2 }\n");
        out.append("}\n");
        out.append("if (-not $moved) { Write-UpdateLog 'update failed after retries' }\n");
        out.append("Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue\n");
        return out.toString();
    }

    private String unixScript(PendingUpdate pending, Path script, Path backup, String appliedJson) {
        StringBuilder out = new StringBuilder();
        out.append("#!/bin/sh\n");
        out.append("PID=").append(waitForPid()).append("\n");
        out.append("SOURCE=").append(shQuote(pending.staged)).append("\n");
        out.append("TARGET=").append(shQuote(currentJar.toString())).append("\n");
        out.append("BACKUP=").append(shQuote(backup.toString())).append("\n");
        out.append("PENDING=").append(shQuote(pendingFile.toString())).append("\n");
        out.append("STATE=").append(shQuote(lastUpdateFile.toString())).append("\n");
        out.append("LOG=").append(shQuote(logFile.toString())).append("\n");
        out.append("log() { printf '%s %s\\n' \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" \"$1\" >> \"$LOG\"; }\n");
        out.append("waited=0\n");
        out.append("while kill -0 \"$PID\" 2>/dev/null; do\n");
        out.append("  sleep 1\n");
        out.append("  waited=$((waited + 1))\n");
        out.append("  if [ \"$waited\" -ge 900 ]; then log 'timed out waiting for server exit'; exit 1; fi\n");
        out.append("done\n");
        out.append("i=0\n");
        out.append("while [ \"$i\" -lt 30 ]; do\n");
        if (options.backup) {
            out.append("  [ -f \"$TARGET\" ] && cp -f \"$TARGET\" \"$BACKUP\" 2>/dev/null\n");
        }
        out.append("  if cp -f \"$SOURCE\" \"$TARGET\"; then\n");
        out.append("    printf '%s\\n' ").append(shQuote(appliedJson)).append(" > \"$STATE\"\n");
        out.append("    rm -f \"$PENDING\" \"$SOURCE\"\n");
        out.append("    log 'update applied'\n");
        out.append("    rm -f \"$0\"\n");
        out.append("    exit 0\n");
        out.append("  fi\n");
        out.append("  i=$((i + 1))\n");
        out.append("  sleep 2\n");
        out.append("done\n");
        out.append("log 'update failed after retries'\n");
        out.append("rm -f \"$0\"\n");
        out.append("exit 1\n");
        return out.toString();
    }

    private List<String> buildScriptCommand(Path script) throws IOException {
        List<String> command = new ArrayList<>();
        if (isWindows()) {
            Path wrapper = updatesDir.resolve("run-update.cmd");
            String content = "@echo off\r\n"
                    + "start \"\" /b powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \""
                    + script.toString() + "\"\r\n";
            Files.write(
                    wrapper,
                    content.getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE
            );
            command.add("cmd.exe");
            command.add("/c");
            command.add(wrapper.toString());
        } else {
            command.add("/bin/sh");
            command.add(script.toString());
        }
        return command;
    }

    private Process launchProcess(List<String> command, Path logFile) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(true);
        Files.createDirectories(logFile.getParent());
        builder.redirectOutput(ProcessBuilder.Redirect.appendTo(logFile.toFile()));
        return builder.start();
    }

    private void logResult(Result result) {
        switch (result.status) {
            case STAGED:
                plugin.getLogger().warning("Auto-update: " + result.message);
                break;
            case DOWNGRADE_PREVENTED:
                plugin.getLogger().info("Auto-update: " + result.message + "; skipping downgrade");
                break;
            case UP_TO_DATE:
                plugin.getLogger().info("Auto-update: " + result.message);
                break;
            case FAILED:
                plugin.getLogger().warning("Auto-update: " + result.message);
                break;
            default:
                plugin.debug("Auto-update: " + result.message);
        }
    }

    private PendingUpdate readPending() {
        if (!Files.isRegularFile(pendingFile)) return null;
        try {
            String json = new String(Files.readAllBytes(pendingFile), StandardCharsets.UTF_8);
            JsonObject object = JsonParser.parseString(json).getAsJsonObject();
            PendingUpdate pending = new PendingUpdate();
            pending.tag = getString(object, "tag");
            pending.asset = getString(object, "asset");
            pending.sha256 = getString(object, "sha256");
            pending.staged = getString(object, "staged");
            pending.target = getString(object, "target");
            pending.downloadedAt = getString(object, "downloadedAt");
            if (pending.staged == null || pending.target == null) return null;
            return pending;
        } catch (Exception error) {
            plugin.getLogger().warning("Auto-update: could not read pending update state: " + error.getMessage());
            return null;
        }
    }

    private void writePending(PendingUpdate pending) throws IOException {
        JsonObject object = new JsonObject();
        object.addProperty("tag", pending.tag);
        object.addProperty("asset", pending.asset);
        object.addProperty("sha256", pending.sha256);
        object.addProperty("staged", pending.staged);
        object.addProperty("target", pending.target);
        object.addProperty("downloadedAt", pending.downloadedAt);

        Path temp = updatesDir.resolve("pending-update.json.tmp");
        Files.write(
                temp,
                object.toString().getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE
        );
        Files.move(temp, pendingFile, StandardCopyOption.REPLACE_EXISTING);
    }

    private void cleanupPending(PendingUpdate pending) {
        try {
            if (pending.staged != null) {
                Files.deleteIfExists(Paths.get(pending.staged));
            }
            Files.deleteIfExists(pendingFile);
        } catch (Exception error) {
            plugin.getLogger().warning("Auto-update: could not clean up staged update: " + error.getMessage());
        }
    }

    private void discardPendingUpdate() {
        PendingUpdate pending = readPending();
        if (pending != null && (pending.target == null || samePath(Paths.get(pending.target), currentJar))) {
            cleanupPending(pending);
        }
    }

    private Instant resolveLocalBuildTime() {
        if (localBuildTimeOverride != null) return localBuildTimeOverride;
        try (InputStream input = PluginUpdater.class.getClassLoader().getResourceAsStream("build-info.properties")) {
            if (input != null) {
                Properties properties = new Properties();
                properties.load(input);
                Instant parsed = parseInstant(properties.getProperty("build.timestamp"));
                if (parsed != null) return parsed;
            }
        } catch (Exception ignored) {
        }
        // Older jars do not contain build-info. Let those update normally
        // instead of guessing from file mtimes (which change on download).
        return null;
    }

    private static Path resolveCurrentJar() {
        try {
            URL location = PluginUpdater.class.getProtectionDomain().getCodeSource().getLocation();
            Path path = Paths.get(location.toURI());
            if (Files.isRegularFile(path) && path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".jar")) {
                return path.toAbsolutePath().normalize();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static Path normalizeJarPath(Path path) {
        if (path == null) return null;
        try {
            return path.toRealPath();
        } catch (Exception ignored) {
            return path.toAbsolutePath().normalize();
        }
    }

    private static boolean samePath(Path left, Path right) {
        if (left == null || right == null) return false;
        return left.toAbsolutePath().normalize().equals(right.toAbsolutePath().normalize());
    }

    private static String sha256(Path path) throws Exception {
        MessageDigest digest = newDigest();
        try (InputStream input = Files.newInputStream(path)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return toHex(digest.digest());
    }

    private static MessageDigest newDigest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 is not available", error);
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            out.append(Character.forDigit((value >> 4) & 0xF, 16));
            out.append(Character.forDigit(value & 0xF, 16));
        }
        return out.toString();
    }

    private static boolean containsUpdaterClass(Path path) {
        try (ZipFile zip = new ZipFile(path.toFile())) {
            return zip.getEntry("com/deyo/rbw/update/PluginUpdater.class") != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean looksLikeJar(Path path) {
        try (InputStream input = Files.newInputStream(path)) {
            byte[] header = new byte[4];
            int read = input.read(header);
            if (read < 4) return false;
            if (header[0] != 0x50 || header[1] != 0x4B) return false;
            return (header[2] == 0x03 && header[3] == 0x04)
                    || (header[2] == 0x05 && header[3] == 0x06)
                    || (header[2] == 0x07 && header[3] == 0x08);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    private static String safeFileName(String value) {
        if (value == null || value.trim().isEmpty()) return "latest";
        return value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    private static String getString(JsonObject object, String key) {
        JsonElement element = object.get(key);
        if (element == null || element.isJsonNull() || !element.isJsonPrimitive()) return null;
        return element.getAsString();
    }

    private static boolean isTruthy(JsonObject object, String key) {
        JsonElement element = object.get(key);
        return element != null && !element.isJsonNull() && element.isJsonPrimitive() && element.getAsBoolean();
    }

    private static Instant parseInstant(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        String trimmed = value.trim();
        try {
            return Instant.parse(trimmed);
        } catch (Exception ignored) {
        }
        try {
            return OffsetDateTime.parse(trimmed).toInstant();
        } catch (Exception ignored) {
        }
        try {
            return ZonedDateTime.parse(trimmed).toInstant();
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String psQuote(String value) {
        return "'" + (value == null ? "" : value.replace("'", "''")) + "'";
    }

    private static String shQuote(String value) {
        return "'" + (value == null ? "" : value.replace("'", "'\\''")) + "'";
    }

    private static final class DownloadResult {
        final String sha256;
        final long size;

        DownloadResult(String sha256, long size) {
            this.sha256 = sha256;
            this.size = size;
        }
    }
}
