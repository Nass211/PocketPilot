# 📘 File 2/6 — `src/WebSocketManager.ts` — The Connection Engine

> The core of the whole extension. It opens a WebSocket server, authenticates the phone, keeps the connection alive with heartbeats, and buffers messages if the phone disconnects.

---

## Imports

```typescript
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { IncomingMessage, OutgoingMessage } from "./types";
```

| Import                               | From                      | Why                                                                                                                         |
| ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `WebSocketServer`                    | `ws` (npm)                | Creates the server that listens for connections                                                                             |
| `WebSocket`                          | `ws` (npm)                | The type representing a single connection. Also has static constants like `WebSocket.OPEN`                                  |
| `randomUUID`                         | Node.js built-in `crypto` | Not actually used here (leftover from draft) — token comes from `extension.ts`                                              |
| `EventEmitter`                       | Node.js built-in `events` | Pattern for emitting custom events (`connected`, `disconnected`, `message`) so other code can listen                        |
| `IncomingMessage`, `OutgoingMessage` | Our `types.ts`            | The protocol types. `import type` means "only import the type, don't import any runtime code" — it's erased at compile time |

---

## Constants

```typescript
const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_DEAD_MS = 10_000;
const MAX_BUFFER_SIZE = 100;
```

| Constant                | Value        | Meaning                                                                           |
| ----------------------- | ------------ | --------------------------------------------------------------------------------- |
| `AUTH_TIMEOUT_MS`       | 5 seconds    | After connecting, the phone has 5s to send the auth token. If not → kicked        |
| `HEARTBEAT_INTERVAL_MS` | 5 seconds    | We send a `ping` every 5 seconds                                                  |
| `HEARTBEAT_DEAD_MS`     | 10 seconds   | If no `pong` received for 10s → phone is dead → disconnect                        |
| `MAX_BUFFER_SIZE`       | 100 messages | If the phone is disconnected, we store up to 100 messages. Older ones get dropped |

The `5_000` syntax is just TypeScript/JS numeric separators — `5_000` = `5000`. Makes big numbers readable.

---

## The Class

```typescript
export class WebSocketManager extends EventEmitter {
```

**`extends EventEmitter`** — This gives the class `.on()`, `.emit()`, and `.once()` methods. Instead of passing callback functions into the constructor, other code does:

```typescript
wsManager.on("connected", () => {
  /* phone connected */
});
wsManager.on("disconnected", () => {
  /* phone left */
});
wsManager.on("message", (msg) => {
  /* phone sent something */
});
```

This is the **Observer pattern** — the manager doesn't need to know WHO is listening, it just broadcasts events.

---

## Private Properties

```typescript
private wss: WebSocketServer | null = null;
private activeSocket: WebSocket | null = null;
private authToken: string;
private messageBuffer: OutgoingMessage[] = [];
private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
private lastPong: number = 0;
```

| Property         | Type                                     | Purpose                                                                                                                   |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `wss`            | `WebSocketServer \| null`                | The server itself. `null` when stopped                                                                                    |
| `activeSocket`   | `WebSocket \| null`                      | The ONE connected phone. `null` when no phone is connected. **This is the single-client lock** — only one phone at a time |
| `authToken`      | `string`                                 | The secret token phones must provide to connect                                                                           |
| `messageBuffer`  | `OutgoingMessage[]`                      | Queue of messages waiting to be sent when phone reconnects                                                                |
| `heartbeatTimer` | `ReturnType<typeof setInterval> \| null` | Handle to the repeating timer so we can stop it later                                                                     |
| `lastPong`       | `number`                                 | Timestamp (ms) of the last pong received. Used to detect dead connections                                                 |

**`private`** = only this class can access these. Outside code can't do `wsManager.activeSocket`.

**`ReturnType<typeof setInterval>`** — This TypeScript utility type means "whatever type `setInterval` returns." In Node.js it returns a `NodeJS.Timeout`, in browsers it returns a `number`. This keeps it portable.

---

## `start(port)` — Start the Server

```typescript
start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        this.wss = new WebSocketServer({ port });

        this.wss.on('listening', () => resolve());
        this.wss.on('error', (err) => reject(err));
        this.wss.on('connection', (ws) => this.handleConnection(ws));
    });
}
```

Creates a WebSocket server on the given port. Returns a **Promise** that:

- **Resolves** (succeeds) when the server is ready to accept connections
- **Rejects** (fails) if the port is already in use

The `'connection'` event fires every time a new client connects. We hand it off to `handleConnection`.

---

## `stop()` — Shut Everything Down

```typescript
stop(): void {
    this.stopHeartbeat();
    if (this.activeSocket) {
        this.activeSocket.close();
        this.activeSocket = null;
    }
    this.wss?.close();
    this.wss = null;
}
```

Tears down in order: heartbeat timer → active connection → server. The `?.` is optional chaining — if `wss` is already null, skip `.close()`.

---

## `send(msg)` — Send a Message (With Buffering)

```typescript
send(msg: OutgoingMessage): void {
    if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
        this.activeSocket.send(JSON.stringify(msg));
    } else {
        this.messageBuffer.push(msg);
        if (this.messageBuffer.length > MAX_BUFFER_SIZE) {
            this.messageBuffer.shift(); // drop oldest
        }
    }
}
```

**If connected:** serialize the typed message to JSON and send it over the wire.

**If NOT connected:** push it into the buffer. If the buffer exceeds 100 messages, `.shift()` removes the **oldest** one (FIFO — first in, first out). When the phone reconnects, `flushBuffer()` sends all queued messages.

Why buffer? Imagine Copilot finishes generating a response while the phone is briefly disconnected (switching WiFi, etc.). Without the buffer, that response would be lost.

---

## `handleConnection(ws)` — New Connection Arrives

This is the **gatekeeper**. Every new WebSocket connection goes through here.

### Step 1: Single-Client Lock

```typescript
if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
  ws.send(
    JSON.stringify({
      type: "error",
      code: "SESSION_OCCUPIED",
      message: "Another device is already connected",
    } satisfies OutgoingMessage),
  );
  ws.close();
  return;
}
```

If someone is already connected → reject the new connection with an error. Only **one phone at a time**. The `satisfies OutgoingMessage` is a TypeScript check that says "verify this object matches the OutgoingMessage type, but don't change its type." It catches typos at compile time.

### Step 2: Auth Handshake

```typescript
const authTimeout = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'error', code: 'AUTH_TIMEOUT', ... }));
    ws.close();
}, AUTH_TIMEOUT_MS);
```

Start a 5-second countdown. If the phone doesn't authenticate in time → kick it.

```typescript
ws.once("message", (raw) => {
  clearTimeout(authTimeout);
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    /* close */
  }

  if (msg.type !== "auth" || msg.token !== this.authToken) {
    // Wrong token → close
  }

  this.acceptConnection(ws);
});
```

`.once('message', ...)` listens for **exactly one** message and then removes the listener. The first message MUST be `{ type: 'auth', token: '...' }`. If it's anything else or the token is wrong → rejected.

**Why `raw.toString()`?** WebSocket data arrives as a `Buffer` (raw bytes). We convert to string, then parse as JSON.

---

## `acceptConnection(ws)` — Phone is Authenticated

```typescript
private acceptConnection(ws: WebSocket): void {
    this.activeSocket = ws;
    this.lastPong = Date.now();
    this.startHeartbeat();
    this.flushBuffer();
    this.emit('connected');
```

1. Store the socket as `activeSocket` (now the phone "owns" the connection)
2. Set `lastPong` to now (so the heartbeat doesn't immediately think it's dead)
3. Start sending pings every 5s
4. Send all buffered messages
5. Emit `'connected'` event (extension.ts listens for this to update the status bar)

Then we set up **permanent message listeners**:

```typescript
ws.on("message", (raw) => {
  let msg = JSON.parse(raw.toString());
  if (msg.type === "pong") {
    this.lastPong = Date.now();
    return;
  }
  this.emit("message", msg);
});
```

- `pong` → silently update timestamp (heartbeat logic)
- Everything else → emit as a `'message'` event for `extension.ts` to handle

```typescript
ws.on("close", () => this.cleanup());
ws.on("error", () => this.cleanup());
```

Whether the phone disconnects cleanly or crashes → run cleanup.

---

## Heartbeat

```typescript
private startHeartbeat(): void {
    this.stopHeartbeat(); // clear any existing timer
    this.heartbeatTimer = setInterval(() => {
        if (Date.now() - this.lastPong > HEARTBEAT_DEAD_MS) {
            this.activeSocket.close();
            this.cleanup();
            return;
        }
        this.activeSocket.send(JSON.stringify({ type: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);
}
```

Every 5 seconds:

1. Check: has it been >10s since the last pong? → Phone is dead → disconnect
2. Otherwise → send a `ping`

The phone must respond with `pong` within 10s or it's considered disconnected.

---

## `flushBuffer()` and `cleanup()`

```typescript
private flushBuffer(): void {
    for (const msg of this.messageBuffer) {
        this.activeSocket?.send(JSON.stringify(msg));
    }
    this.messageBuffer = [];
}

private cleanup(): void {
    this.stopHeartbeat();
    this.activeSocket = null;
    this.emit('disconnected');
}
```

- `flushBuffer` — sends all buffered messages, then clears the array
- `cleanup` — stops heartbeat, nulls out the socket, tells listeners the phone is gone

---

## Connection Lifecycle Summary

```
1. Server starts (port 3000)
2. Phone connects → handleConnection()
3. Single-client check → OK
4. 5s auth timer starts
5. Phone sends { type: 'auth', token: '...' }
6. Token matches → acceptConnection()
7. Heartbeat starts (ping every 5s)
8. Buffered messages flushed
9. 'connected' event emitted
10. Messages flow back and forth...
11. Phone disconnects → cleanup() → 'disconnected' event
12. Back to step 2, waiting for next connection
```

---

> **Next:** `src/StatusBarManager.ts`
