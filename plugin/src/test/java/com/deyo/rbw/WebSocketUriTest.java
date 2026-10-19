package com.deyo.rbw;

import com.deyo.rbw.managers.WebSocketManager;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class WebSocketUriTest {

    @Test
    public void plainHostGetsDefaultPort() {
        assertEquals("ws://rbw.deyo.lol:25565/rbw/websocket", WebSocketManager.buildWebSocketUri("rbw.deyo.lol"));
    }

    @Test
    public void hostWithPortKeepsIt() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("localhost:8080"));
    }

    @Test
    public void hostWithSchemeIsNotDoubled() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("ws://localhost:8080"));
    }

    @Test
    public void wssSchemeIsPreserved() {
        assertEquals("wss://rbw.deyo.lol:25565/rbw/websocket", WebSocketManager.buildWebSocketUri("wss://rbw.deyo.lol"));
    }

    @Test
    public void trailingSlashesAreTrimmed() {
        assertEquals("ws://localhost:8080/rbw/websocket", WebSocketManager.buildWebSocketUri("localhost:8080///"));
    }

    @Test
    public void nullFallsBackToLocalhostWithDefaultPort() {
        assertEquals("ws://localhost:25565/rbw/websocket", WebSocketManager.buildWebSocketUri(null));
    }

    @Test
    public void emptyFallsBackToLocalhostWithDefaultPort() {
        assertEquals("ws://localhost:25565/rbw/websocket", WebSocketManager.buildWebSocketUri("  "));
    }

    @Test
    public void theDefaultConfigValueWorks() {
        assertEquals("ws://127.0.0.1:25565/rbw/websocket", WebSocketManager.buildWebSocketUri("127.0.0.1:25565"));
    }
}
