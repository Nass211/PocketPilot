# 📘 File 6/6 — `src/extension.ts` — The Orchestrator

> This is the entry point. VS Code calls `activate()` when the extension starts and `deactivate()` when it shuts down. This file wires all the managers together, registers all commands, and handles incoming messages from the phone.

---

## Imports

```typescript
import * as vscode from "vscode";
import { randomUUID } from "crypto";
import { WebSocketManager } from "./WebSocketManager";
import { StatusBarManager } from "./StatusBarManager";
import { TunnelManager } from "./TunnelManager";
import { QRCodePanel } from "./QRCodePanel";
import type { IncomingMessage } from "./types";
```

All 4 managers + the message type. This is the only file that imports everything — it's the glue.

---

## Module-Level Variables

```typescript
const WS_PORT = 3000;

let wsManager: WebSocketManager | null = null;
let statusBar: StatusBarManager | null = null;
let tunnelManager: TunnelManager | null = null;
let qrPanel: QRCodePanel | null = null;
```

These are **module-level** (not inside a function). They live for the entire lifetime of the extension. They're `let` (not `const`) because they get assigned in `activate()` and cleaned up in `deactivate()`.

Why `| null`? They start as `null` before `activate()` runs, and get set back to `null` on `deactivate()`.

---

## `activate()` — Extension Starts

VS Code calls this automatically when the extension activates (which for us is `onStartupFinished` — right after VS Code finishes loading).

### Auth Token

```typescript
let authToken = context.globalState.get<string>("pocketpilot.authToken");
if (!authToken) {
  authToken = randomUUID();
  await context.globalState.update("pocketpilot.authToken", authToken);
}
```

- `context.globalState` — a persistent key-value store provided by VS Code. Data survives restarts, updates, even reinstalls. It's per-extension.
- `get<string>('pocketpilot.authToken')` — try to read a previously stored token. The `<string>` is a generic type parameter telling TypeScript "the value is a string."
- If no token exists (first run) → generate a UUID v4 (like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`) and store it.

**Why persist it?** So the phone doesn't need to re-scan the QR code every time you restart VS Code. Same token = same QR code = phone auto-reconnects.

### Create Managers

```typescript
statusBar = new StatusBarManager();
statusBar.show();
tunnelManager = new TunnelManager();
qrPanel = new QRCodePanel();
wsManager = new WebSocketManager(authToken);
```

Instantiate all 4 managers. The auth token is passed to WebSocketManager so it knows what token to expect from phones.

### WebSocket Events

```typescript
wsManager.on("connected", () => {
  statusBar?.setConnected();
  vscode.window.showInformationMessage("PocketPilot: Phone connected!");
});

wsManager.on("disconnected", () => {
  statusBar?.setWaiting();
  vscode.window.showInformationMessage("PocketPilot: Phone disconnected");
});

wsManager.on("message", (msg: IncomingMessage) => {
  handleIncomingMessage(msg, wsManager!);
});
```

This is where the EventEmitter pattern pays off. We listen for events from the WebSocket manager and react:

- Phone connects → update status bar + show toast notification
- Phone disconnects → reset status bar
- Phone sends a message → route it to the handler

The `!` in `wsManager!` is the **non-null assertion operator** — it tells TypeScript "I promise this is not null right now" (we just created it two lines above, so it's safe).

---

## Commands

VS Code commands are actions users trigger from the Command Palette (Ctrl+Shift+P).

### `startServer` / `stopServer`

```typescript
const startServer = vscode.commands.registerCommand(
  "pocketpilot.startServer",
  async () => {
    if (wsManager?.isConnected) {
      vscode.window.showWarningMessage("PocketPilot server already running");
      return;
    }
    try {
      await wsManager!.start(WS_PORT);
      statusBar?.setWaiting();
    } catch (err: any) {
      statusBar?.setError("port busy");
    }
  },
);
```

- Check if already running → warn and bail
- Try to start on port 3000 → if port is taken, show error
- `catch (err: any)` — the `: any` type annotation on catch is required because TypeScript's strict mode types caught errors as `unknown` by default

`stopServer` stops both the WebSocket server AND the tunnel (if active).

### `enableTunnel` / `disableTunnel`

```typescript
const enableTunnel = vscode.commands.registerCommand(
  "pocketpilot.enableTunnel",
  async () => {
    const installed = await tunnelManager!.checkInstalled();
    if (!installed) {
      vscode.window.showErrorMessage("PocketPilot: cloudflared not found...");
      return;
    }
    statusBar?.setBusy("starting tunnel…");
    const url = await tunnelManager!.start(WS_PORT);
    statusBar?.setConnected();
  },
);
```

1. Check if `cloudflared` CLI is installed → if not, show error with install link
2. Set status bar to "busy" with spinning icon
3. Start the tunnel → get the public URL
4. Update status bar

### `showQRCode`

```typescript
const showQR = vscode.commands.registerCommand(
  "pocketpilot.showQRCode",
  async () => {
    await qrPanel!.show(context, {
      authToken: authToken!,
      port: WS_PORT,
      tunnelUrl: tunnelManager?.tunnelUrl ?? null,
    });
  },
);
```

Opens the QR code webview. Passes current auth token, port, and tunnel URL (if any). Remember the status bar also triggers this command on click.

### `copyAuthToken` / `clearHistory`

```typescript
// Copy token to clipboard for manual connection
await vscode.env.clipboard.writeText(authToken!);

// Clear history (Phase 2 will actually clear SDK session data)
vscode.window.showInformationMessage("PocketPilot: Session history cleared");
```

`copyAuthToken` — for debugging/manual testing when you can't scan QR.
`clearHistory` — placeholder for Phase 2 when we have actual session data.

---

## Chat Participant (Stub)

```typescript
const participant = vscode.chat.createChatParticipant(
    'pocketpilot.assistant',
    async (request, _context, stream, token) => { ... }
);
participant.iconPath = new vscode.ThemeIcon('rocket');
```

**What is a Chat Participant?** It registers `@pocketpilot` in VS Code's Copilot Chat. When you type `@pocketpilot explain this code`, this handler runs.

Parameters of the handler:

- `request` — contains `request.prompt` (what the user typed)
- `_context` — chat history (unused for now, hence the `_` prefix convention)
- `stream` — write to this to send text back to the chat panel (`stream.markdown(...)`)
- `token` — a `CancellationToken` for aborting the request

```typescript
const [model] = await vscode.lm.selectChatModels({
  vendor: "copilot",
  family: "gpt-4o",
});
```

`vscode.lm.selectChatModels()` — asks VS Code for available language models matching the filter. The `[model]` destructures the first result from the array. If no models match, `model` is `undefined`.

```typescript
const messages = [vscode.LanguageModelChatMessage.User(request.prompt)];
const response = await model.sendRequest(messages, {}, token);

for await (const chunk of response.text) {
  stream.markdown(chunk);
  wsManager?.send({ type: "chunk", content: chunk });
}
wsManager?.send({ type: "done" });
```

1. Build a message array with the user's prompt
2. Send it to the model → get a streaming response
3. **`for await...of`** — this is an **async iterator**. The model produces chunks one at a time. Each iteration waits for the next chunk.
4. Each chunk is sent to BOTH the VS Code chat panel (`stream.markdown`) AND the phone (`wsManager.send`)
5. After all chunks, send `done` to the phone

This is the **stub** — in Phase 2, the Copilot SDK replaces this with persistent sessions, tool use, permissions, etc.

---

## Disposables

```typescript
context.subscriptions.push(
  startServer,
  stopServer,
  enableTunnel,
  disableTunnel,
  showQR,
  copyToken,
  clearHistory,
  participant,
  { dispose: () => statusBar?.dispose() },
  { dispose: () => wsManager?.stop() },
  { dispose: () => tunnelManager?.stop() },
  { dispose: () => qrPanel?.dispose() },
);
```

**The Disposable pattern** — VS Code's way of managing cleanup. Everything pushed into `context.subscriptions` gets automatically disposed when the extension deactivates.

The `{ dispose: () => ... }` syntax creates an inline disposable object. It's a shorthand instead of creating a full class.

---

## Auto-Start

```typescript
try {
  await wsManager.start(WS_PORT);
  statusBar.setWaiting();
} catch {
  statusBar.setError("port busy");
}
```

At the bottom of `activate()`, we immediately start the server. No need for the user to manually run a command. If port 3000 is busy → show error in status bar (but don't crash the extension).

---

## `deactivate()` — Extension Shuts Down

```typescript
export function deactivate() {
  wsManager?.stop();
  tunnelManager?.stop();
  statusBar?.dispose();
  qrPanel?.dispose();
}
```

Belt and suspenders cleanup. The disposables in `context.subscriptions` should handle this, but we do it explicitly too just in case.

---

## `handleIncomingMessage()` — The Message Router

```typescript
function handleIncomingMessage(msg: IncomingMessage, ws: WebSocketManager): void {
    switch (msg.type) {
        case 'prompt': { ... }
        case 'get_workspace_info': { ... }
        case 'clear_history': ...
        case 'cancel_task': ...
        default: break;
    }
}
```

This is where **type narrowing** from `types.ts` shines. Inside `case 'prompt':`, TypeScript knows `msg` has `content` and `mode`.

### Handling `prompt`

```typescript
const MODES: Record<string, string> = {
  ask: "",
  agent: "/agent ",
  plan: "/plan ",
};
const prefix = MODES[msg.mode] ?? "";
vscode.commands.executeCommand("workbench.action.chat.open", {
  query: `@pocketpilot ${prefix}${msg.content}`,
});
```

- `Record<string, string>` — a TypeScript utility type meaning "an object where keys and values are both strings"
- Builds a query string like `@pocketpilot /agent Create a REST API` and opens VS Code's chat panel with it
- The `/agent` and `/plan` prefixes are Copilot Chat's built-in slash commands for switching modes

### Handling `get_workspace_info`

```typescript
const folder = vscode.workspace.workspaceFolders?.[0];
ws.send({
  type: "workspace_info",
  project: folder?.name ?? "unknown",
  branch: "", // TODO: Phase 2
  files: [], // TODO: Phase 2
});
```

Gets the first workspace folder name and sends it back. Branch and file list are Phase 2 features.

---

## How Everything Connects

```
┌─────────────────────────────────────────────────┐
│                  extension.ts                     │
│                                                   │
│  activate() creates:                              │
│    ┌──────────────────┐  ┌──────────────────┐    │
│    │ WebSocketManager  │  │  StatusBarManager │    │
│    │                   │  │  (updates UI)     │    │
│    │  events ──────────┼──┤                   │    │
│    └──────────────────┘  └──────────────────┘    │
│    ┌──────────────────┐  ┌──────────────────┐    │
│    │  TunnelManager    │  │   QRCodePanel     │    │
│    │  (cloudflared)    │  │   (webview)       │    │
│    └──────────────────┘  └──────────────────┘    │
│                                                   │
│  handleIncomingMessage() routes phone messages     │
│  Chat participant bridges Copilot ↔ phone          │
└─────────────────────────────────────────────────┘
```

---

> **You've read all 6 files.** You now understand the complete Phase 1 codebase. Phase 2 will expand `handleIncomingMessage` and replace the chat participant stub with the Copilot SDK.
