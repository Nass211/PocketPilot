# 📘 File 4/6 — `src/TunnelManager.ts` — Cloudflare Tunnel

> Makes your local WebSocket server accessible from the internet so your phone can connect from anywhere (not just your WiFi). Uses Cloudflare's free "quick tunnels" feature.

---

## Why Do We Need This?

Without a tunnel, your WebSocket server runs on `ws://192.168.1.10:3000` — that's a **local IP**. It only works if your phone is on the **same WiFi network**. If you're at a coffee shop on different networks, or using mobile data, it won't work.

A tunnel gives you a **public URL** like `https://random-words.trycloudflare.com` that routes traffic from the internet to your local port 3000. No port forwarding, no firewall config, no paying for a server.

---

## Imports & Constant

```typescript
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

const TUNNEL_TIMEOUT_MS = 15_000;
```

- `spawn` — Node.js function to run external programs as child processes. We use it to run the `cloudflared` CLI tool.
- `ChildProcess` — the TypeScript type for a spawned process.
- `EventEmitter` — same pattern as WebSocketManager. Emits `'url'` and `'stopped'` events.
- `15_000` — 15 second timeout. Tunnels take a few seconds to establish because Cloudflare needs to allocate a subdomain.

---

## Properties

```typescript
private process: ChildProcess | null = null;
private _tunnelUrl: string | null = null;
```

- `process` — the running `cloudflared` program. `null` when no tunnel is active.
- `_tunnelUrl` — the public URL (e.g., `https://abc-xyz.trycloudflare.com`). The `_` prefix is a convention meaning "this is backing a getter" (not a strict rule, just style).

```typescript
get tunnelUrl(): string | null { return this._tunnelUrl; }
get isRunning(): boolean { return this.process !== null && !this.process.killed; }
```

**Getters** — accessed like properties (`tunnelManager.tunnelUrl`) but are actually methods. They're read-only from outside.

---

## `checkInstalled()` — Is cloudflared available?

```typescript
async checkInstalled(): Promise<boolean> {
    return new Promise((resolve) => {
        const proc = spawn('cloudflared', ['--version']);
        proc.on('error', () => resolve(false));   // command not found
        proc.on('close', (code) => resolve(code === 0));  // ran but maybe failed
    });
}
```

Tries to run `cloudflared --version`. If the command doesn't exist → `'error'` event fires → returns `false`. If it runs and exits with code 0 (success) → returns `true`.

This is called before starting a tunnel so we can show a helpful "install cloudflared" error instead of a cryptic crash.

---

## `start(port)` — Open the Tunnel

```typescript
async start(port: number): Promise<string> {
    if (this.isRunning) {
        if (this._tunnelUrl) return this._tunnelUrl;  // already running, return existing URL
        this.stop();  // running but no URL yet (stuck) → kill and restart
    }
```

Guard clause: if a tunnel is already running with a URL, just return it. If it's running but stuck (no URL), kill it and restart.

```typescript
    return new Promise((resolve, reject) => {
        this.process = spawn('cloudflared', [
            'tunnel', '--url', `http://localhost:${port}`,
        ]);
```

This runs: `cloudflared tunnel --url http://localhost:3000`

Cloudflare's "quick tunnel" feature — it creates a temporary public URL pointing to your local port. No account or config needed.

### Timeout

```typescript
const timeout = setTimeout(() => {
  this.stop();
  reject(new Error("Tunnel startup timed out"));
}, TUNNEL_TIMEOUT_MS);
```

If 15 seconds pass and we still haven't gotten a URL → give up.

### Parsing the URL

```typescript
this.process.stderr?.on("data", (data: Buffer) => {
  const output = data.toString();
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !this._tunnelUrl) {
    this._tunnelUrl = match[0];
    clearTimeout(timeout);
    this.emit("url", this._tunnelUrl);
    resolve(this._tunnelUrl);
  }
});
```

**Why `stderr`?** Cloudflared prints its status messages to stderr (not stdout). This is common for CLI tools — stdout is for "real output", stderr is for diagnostic/log info.

**The regex** `/https:\/\/[a-z0-9-]+\.trycloudflare\.com/` matches URLs like `https://hungry-fox-123.trycloudflare.com`. Breakdown:

- `https:\/\/` — literal `https://` (slashes escaped)
- `[a-z0-9-]+` — one or more lowercase letters, digits, or hyphens (the random subdomain)
- `\.trycloudflare\.com` — literal `.trycloudflare.com`

**`!this._tunnelUrl`** — only capture the FIRST match. Cloudflared might print the URL multiple times in its logs.

### Error & Close

```typescript
this.process.on("error", (err) => {
  clearTimeout(timeout);
  this.stop();
  reject(err);
});

this.process.on("close", () => {
  this._tunnelUrl = null;
  this.process = null;
  this.emit("stopped");
});
```

- `error` — cloudflared crashed or couldn't start → clean up and reject the promise
- `close` — process ended (either we killed it or it crashed) → reset state and emit `'stopped'`

---

## `stop()` — Kill the Tunnel

```typescript
stop(): void {
    if (this.process) {
        this.process.kill();  // sends SIGTERM to the process
        this.process = null;
    }
    this._tunnelUrl = null;
}
```

`.kill()` sends a SIGTERM signal to the cloudflared process, asking it to shut down gracefully.

---

> **Next:** `src/QRCodePanel.ts`
