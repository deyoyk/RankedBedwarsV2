package com.deyo.rbw;

import com.deyo.rbw.utils.ConfigMigration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

public class ConfigMigrationTest {

    @TempDir
    Path tempDir;

    @Test
    public void removesLegacyApiSectionAndKeepsComments() throws Exception {
        Path config = tempDir.resolve("config.yml");
        Files.write(config, (
                "bot_url: \"127.0.0.1:25565\"\n" +
                "auth_key: \"secret\"\n" +
                "\n" +
                "api:\n" +
                "  host: \"websocket.deyo.lol\"\n" +
                "  port: 25506\n" +
                "\n" +
                "# keep this comment\n" +
                "auto-update:\n" +
                "  enabled: true\n"
        ).getBytes(StandardCharsets.UTF_8));

        assertTrue(ConfigMigration.removeLegacyApiSection(config));

        String updated = new String(Files.readAllBytes(config), StandardCharsets.UTF_8);
        assertFalse(updated.contains("api:\n"));
        assertFalse(updated.contains("websocket.deyo.lol"));
        assertTrue(updated.contains("bot_url: \"127.0.0.1:25565\""));
        assertTrue(updated.contains("# keep this comment"));
        assertTrue(updated.contains("auto-update:"));
    }

    @Test
    public void leavesConfigWithoutLegacyApiAlone() throws Exception {
        Path config = tempDir.resolve("config.yml");
        String original = "bot_url: \"127.0.0.1:25565\"\n";
        Files.write(config, original.getBytes(StandardCharsets.UTF_8));

        assertFalse(ConfigMigration.removeLegacyApiSection(config));

        assertTrue(original.equals(new String(Files.readAllBytes(config), StandardCharsets.UTF_8)));
    }
}
