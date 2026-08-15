package com.deyo.rbw;

import com.deyo.rbw.managers.WebSocketManager;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class WebSocketUriTest {

    @Test
    public void plainHostBuildsWsUri() {
        assertEquals("ws://rbw.deyo.lol/rbw/websocket", WebSocketManager.buildWebSocketUri("rbw.deyo.lol"));
    }

    @Test
    public void hostWithPortBuildsWsUri() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("localhost:8080"));
    }

    @Test
    public void hostWithSchemeIsNotDoubled() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("ws://localhost:8080"));
    }

    @Test
    public void wssSchemeIsPreserved() {
        assertEquals("wss://rbw.deyo.lol/rbw/websocket", WebSocketManager.buildWebSocketUri("wss://rbw.deyo.lol"));
    }

    @Test
    public void trailingSlashesAreTrimmed() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("ws://localhost:8080///"));
    }

    @Test
    public void nullHostFallsBackToLocalhost() {
        assertEquals("ws://localhost/rbw/websocket", WebSocketManager.buildWebSocketUri(null));
    }

    @Test
    public void emptyHostFallsBackToLocalhost() {
        assertEquals("ws://localhost/rbw/websocket", WebSocketManager.buildWebSocketUri("  "));
    }

    @Test
    public void theDefaultConfigValueWorks() {
        // config.yml ships with host: "ws://localhost:8080"
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("ws://localhost:8080"));
    }
}
