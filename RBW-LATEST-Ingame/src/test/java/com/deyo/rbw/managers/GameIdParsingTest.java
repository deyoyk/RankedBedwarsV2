package com.deyo.rbw.managers;

import com.deyo.rbw.managers.WebSocketManager;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class GameIdParsingTest {

    @Test
    public void numericGameIdIsParsed() {
        JsonObject json = new JsonObject();
        json.addProperty("gameid", 1234);
        assertEquals(1234, WebSocketManager.parseGameId(json));
    }

    @Test
    public void stringGameIdIsParsed() {
        JsonObject json = new JsonObject();
        json.addProperty("gameid", "1234");
        assertEquals(1234, WebSocketManager.parseGameId(json));
    }

    @Test
    public void missingGameIdReturnsMinusOne() {
        JsonObject json = new JsonObject();
        json.addProperty("other", "x");
        assertEquals(-1, WebSocketManager.parseGameId(json));
    }

    @Test
    public void nullGameIdReturnsMinusOne() {
        JsonObject json = new JsonObject();
        json.add("gameid", com.google.gson.JsonNull.INSTANCE);
        assertEquals(-1, WebSocketManager.parseGameId(json));
    }

    @Test
    public void nonNumericGameIdReturnsMinusOneWithoutThrowing() {
        JsonObject json = new JsonObject();
        json.addProperty("gameid", "abc-123-uuid");
        assertEquals(-1, WebSocketManager.parseGameId(json));
    }
}
