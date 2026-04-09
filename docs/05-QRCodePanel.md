# 📘 File 5/6 — `src/QRCodePanel.ts` — The QR Code Webview

> Generates a QR code containing the connection info and displays it in a VS Code panel so you can scan it with your phone.

---

## Imports

```typescript
import * as vscode from "vscode";
import * as os from "os";
import * as QRCode from "qrcode";
```

- `vscode` — for creating a webview panel
- `os` — Node.js built-in, used to detect your computer's local IP address
- `QRCode` — npm package `qrcode`. Generates QR codes as PNG data URLs

---

## Options Interface

```typescript
interface QRCodePanelOptions {
  authToken: string;
  port: number;
  tunnelUrl: string | null;
}
```

This defines what info the panel needs to generate the QR code. Passed in by `extension.ts` when the user runs the command. `tunnelUrl` is `null` if no tunnel is active.

---

## `show()` — The Main Method

### Step 1: Build the URLs

```typescript
const localIp = getLocalIP();
const localUrl = `ws://${localIp}:${options.port}`;
const remoteUrl = options.tunnelUrl
  ? options.tunnelUrl.replace("https://", "wss://")
  : null;
```

- `localUrl` → `ws://192.168.1.10:3000` (your WiFi address)
- `remoteUrl` → `wss://random.trycloudflare.com` (tunnel address, if active)

**`ws://` vs `wss://`** — `ws` is plain WebSocket, `wss` is WebSocket Secure (encrypted, like `https`). Cloudflare tunnels are always HTTPS, so the WebSocket upgrade must use `wss`.

### Step 2: Build the QR Payload

```typescript
const payload = JSON.stringify({
  url: remoteUrl ?? localUrl,
  localUrl,
  token: options.authToken,
});
```

The QR code encodes this JSON string. The phone scans it and gets everything it needs:

- `url` — the preferred connection URL (tunnel if available, local otherwise)
- `localUrl` — always included as a fallback
- `token` — the auth secret

### Step 3: Generate QR Image

```typescript
const qrDataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 2 });
```

`toDataURL` returns a **data URL** — a base64-encoded PNG image embedded as a string like `data:image/png;base64,iVBORw0KGgo...`. This can be directly used in an `<img>` tag's `src` without needing a file on disk.

### Step 4: Create or Reuse the Webview Panel

```typescript
if (this.panel) {
  this.panel.reveal(); // bring existing panel to front
} else {
  this.panel = vscode.window.createWebviewPanel(
    "pocketpilotQR", // internal ID
    "PocketPilot — Connect", // title shown on tab
    vscode.ViewColumn.One, // show in the main editor column
    { enableScripts: false }, // no JavaScript in the webview (security)
  );

  this.panel.onDidDispose(() => {
    this.panel = null;
  });
}
```

**Webview** = an iframe-like HTML panel inside VS Code. It can display any HTML.

`enableScripts: false` — the webview has **no JavaScript**. This is a deliberate security choice. Our QR page is pure HTML/CSS, no interactivity needed. Disabling scripts prevents any XSS attack if somehow malicious content got injected.

`onDidDispose` — when the user closes the tab, set `this.panel = null` so we know to create a new one next time.

---

## `getHtml()` — The HTML Template

```typescript
private getHtml(qrDataUrl: string, localUrl: string, remoteUrl: string | null, token: string): string {
    const maskedToken = token.slice(0, 8) + '-****-****';
    return /* html */ `<!DOCTYPE html>
    <html>...</html>`;
}
```

Returns a full HTML page as a string. Key points:

- **`maskedToken`** — shows only the first 8 characters of the token. Security measure — if someone glances at your screen, they can't see the full token.
- **`/* html */`** — a magic comment that tells VS Code "this template literal contains HTML" so you get syntax highlighting.
- **CSS variables** like `var(--vscode-foreground)` and `var(--vscode-editor-background)` — these are VS Code's theme colors. The webview automatically inherits them, so the QR panel matches your dark/light theme.
- **`${remoteUrl ? ... : ''}`** — conditional rendering. If there's a tunnel URL, show it. If not, show nothing.

---

## `getLocalIP()` — Helper Function

```typescript
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      if (info.family === "IPv4" && !info.internal) {
        return info.address;
      }
    }
  }
  return "127.0.0.1";
}
```

Finds your computer's local network IP (like `192.168.1.10`).

- `os.networkInterfaces()` — returns all network interfaces (WiFi, Ethernet, loopback, etc.)
- We look for one that is **IPv4** (not IPv6) and **not internal** (not the loopback `127.0.0.1`)
- If nothing found → fall back to `127.0.0.1` (localhost, which only works on the same machine)

This is a **standalone function** (not a class method) because it's a pure utility — it doesn't need any class state.

---

> **Next:** `src/extension.ts` — the final boss
