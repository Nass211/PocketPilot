# 📘 File 3/6 — `src/StatusBarManager.ts` — The Status Bar UI

> The simplest file. Manages the little text at the bottom-left of VS Code that shows "PocketPilot — waiting" / "phone connected" / etc.

---

## The Full Code (it's short)

This is only ~48 lines, so let's cover it all.

---

## Import & Type

```typescript
import * as vscode from "vscode";

type StatusState = "waiting" | "connected" | "busy" | "error";
```

- `import * as vscode` — imports the entire VS Code API as a namespace. Every VS Code extension does this.
- `StatusState` — a string literal union type documenting the 4 possible states. It's defined but not directly used in the code (it's for documentation / future use).

---

## Constructor

```typescript
export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left, // left side of status bar
      100, // priority (higher = more to the left)
    );
    this.item.command = "pocketpilot.showQRCode";
    this.setWaiting();
  }
}
```

**`vscode.window.createStatusBarItem(alignment, priority)`** — creates a new item in VS Code's bottom status bar.

- `StatusBarAlignment.Left` — left side (right side has things like line number, encoding, etc.)
- `100` — priority. Higher number = further left. 100 is high enough to be visible but not push out Git branch info.

**`this.item.command`** — when the user **clicks** the status bar item, this VS Code command runs. We set it to `pocketpilot.showQRCode` — so clicking the status bar opens the QR code panel. This is a convenient shortcut.

---

## The 4 States

### `setWaiting()`

```typescript
setWaiting(): void {
    this.item.text = '$(broadcast) PocketPilot — waiting';
    this.item.backgroundColor = undefined;
    this.item.tooltip = 'Click to show QR code';
}
```

- `$(broadcast)` — this is a **VS Code icon** (codicon). The `$()` syntax embeds an icon inline in text. `broadcast` looks like a signal/antenna icon. Full list: https://code.visualstudio.com/api/references/icons-in-labels
- `backgroundColor = undefined` — reset to default (no special color)
- `tooltip` — text shown on hover

### `setConnected(device?)`

```typescript
setConnected(device?: string): void {
    const label = device ?? 'phone';
    this.item.text = `$(broadcast) PocketPilot — ${label} connected`;
}
```

- `device?: string` — optional parameter. If the phone sends a device name, we show it. Otherwise default to `'phone'`.
- `??` is the **nullish coalescing operator** — if `device` is `undefined` or `null`, use `'phone'` instead.

### `setBusy(task)`

```typescript
setBusy(task: string): void {
    this.item.text = `$(sync~spin) PocketPilot — ${task}`;
}
```

- `$(sync~spin)` — the `sync` icon with a `~spin` modifier that makes it **animate** (spinning). This is the loading spinner you see in VS Code sometimes.
- `task` describes what's happening, e.g. `"starting tunnel…"` or `"generating response…"`

### `setError(msg)`

```typescript
setError(msg: string): void {
    this.item.text = `$(error) PocketPilot — ${msg}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
}
```

- `$(error)` — an X/error icon
- `ThemeColor('statusBarItem.errorBackground')` — uses VS Code's built-in theme color for errors (usually red). This makes the status bar item turn red, matching whatever color theme the user has.

---

## `show()` and `dispose()`

```typescript
show(): void { this.item.show(); }
dispose(): void { this.item.dispose(); }
```

- `show()` — makes the item visible. Called once during activation.
- `dispose()` — removes the item permanently. Called when the extension deactivates. This is VS Code's cleanup pattern — every created resource must be disposed.

---

> **Next:** `src/TunnelManager.ts`
