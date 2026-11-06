package com.deyo.rbw.utils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public final class ConfigMigration {

    private ConfigMigration() {
    }

    public static boolean removeLegacyApiSection(Path configPath) throws IOException {
        if (!Files.isRegularFile(configPath)) {
            return false;
        }
        List<String> lines = new ArrayList<>(Files.readAllLines(configPath, StandardCharsets.UTF_8));
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).matches("^api:\\s*(#.*)?$")) {
                start = i;
                break;
            }
        }
        if (start < 0) {
            return false;
        }

        int end = start + 1;
        while (end < lines.size()) {
            String line = lines.get(end);
            if (line.isEmpty() || line.startsWith(" ") || line.startsWith("\t")) {
                end++;
            } else {
                break;
            }
        }

        lines.subList(start, end).clear();
        Files.write(configPath, lines, StandardCharsets.UTF_8);
        return true;
    }
}
