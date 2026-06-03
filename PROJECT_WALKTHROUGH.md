# PocketPilot — Full Project Walkthrough

> **What is PocketPilot?**  
> A system that lets you **control GitHub Copilot from your phone**. It's made of two parts: a **VS Code extension** (the backend) and a **React Native mobile app** (the frontend). Your phone connects to VS Code over WebSockets, and you can send prompts, switch AI models, approve tool executions, see file diffs — all from your pocket.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Connection Flow — How The Phone Talks To VS Code](#2-connection-flow)
3. [The VS Code Extension (Backend)](#3-the-vs-code-extension)
4. [The Mobile App (Frontend)](#4-the-mobile-app)
5. [Feature Deep-Dives](#5-feature-deep-dives)
6. [Message Protocol (The "API")](#6-message-protocol)
7. [Key Design Decisions & Patterns](#7-key-design-decisions--patterns)
8. [Tech Stack Summary](#8-tech-stack-summary)

---

## 1. High-Level Architecture

```
┌──────────────────────┐         WebSocket (JSON)         ┌──────────────────────┐
│   📱 Mobile App      │ ◄──────────────────────────────► │   💻 VS Code Ext     │
│   (React Native /    │    ws://IP:3000  (LAN)           │   (TypeScript)       │
│    Expo)             │    wss://xxx.trycloudflare.com   │                      │
│                      │         (Tunnel)                 │                      │
│  • Chat UI           │                                  │  • WebSocketManager  │
│  • Voice recording   │                                  │  • SessionManager    │
│  • Permissions modal │                                  │  • TunnelManager     │
│  • Diff viewer       │                                  │  • StatusManager     │
│  • Model/mode picker │                                  │  • SidebarProvider   │
└──────────────────────┘                                  └────────┬─────────────┘
                                                                   │
                                                                   │ Copilot SDK
                                                                   ▼
                                                          ┌──────────────────────┐
                                                          │  GitHub Copilot CLI  │
                                                          │  (LLM Backend)      │
                                                          └──────────────────────┘
```

**In plain English:** The extension starts a WebSocket server on port 3000. The phone connects to it (either over your local Wi-Fi or through a cloud tunnel). When you type a prompt on your phone, it gets sent over WebSocket to the extension, which passes it to GitHub Copilot's SDK. Copilot streams its response back, and the extension forwards each token chunk to the phone in real-time.

---

## 2. Connection Flow

This is the first thing that happens when you use PocketPilot:

### Step 1: Extension generates a QR code

When VS Code activates, `extension.ts` generates a **UUID auth token** (stored permanently via `context.globalState`) and starts a WebSocket server on port 3000. The sidebar dashboard (`SidebarProvider.ts`) renders a QR code containing:

```json
{
  "url": "wss://xxx.trycloudflare.com",   // or ws://192.168.1.5:3000
  "localUrl": "ws://192.168.1.5:3000",
  "token": "a1b2c3d4-..."
}
```

The QR is built using the `qrcode` npm library, encoding a JSON payload with the connection URL and the auth token.

### Step 2: Phone scans QR and connects

On the phone, `ConnectScreen.tsx` opens the camera via `expo-camera`, scans the QR, parses the JSON, and calls `handleConnect()`. This implements a **local-first strategy**:

1. Try the LAN IP first (`ws://192.168.1.5:3000`) — faster, lower latency
2. If LAN fails after 3 seconds, **fall back to the tunnel URL** (`wss://...`)
3. If everything fails after 15 seconds total, show an error with a "Scan QR Code" quick-action

### Step 3: Authentication handshake

Once the WebSocket opens, the phone immediately sends `{ type: 'auth', token: '...' }`. On the extension side, `WebSocketManager.ts` validates this token within a 5-second window. If the token matches, the connection is accepted. If not, the socket is closed with an `UNAUTHORIZED` error.

Only **one phone can connect at a time** — the WebSocket manager enforces a single-client lock. If another device tries to connect while one is active, it gets a `SESSION_OCCUPIED` error.

### Step 4: Initial state sync

After auth succeeds, the extension sends a `connected` message with the current workspace info:

```json
{
  "type": "connected",
  "project": "PocketPilot",
  "branch": "main",
  "model": "auto",
  "mode": "ask",
  "hasHistory": false
}
```

It also sends `models_available` with the list of LLM models the user has access to.

---

## 3. The VS Code Extension

Located in `/pocketpilot/src/`. Here's what each file does:

### `extension.ts` — The Orchestrator

This is the **entry point**. When VS Code loads the extension, `activate()` runs and:

1. Creates/loads a persistent auth token (UUID)
2. Instantiates all manager classes (Status, Tunnel, WebSocket, Session, QR)
3. Registers VS Code commands (`showQRCode`, `toggleTunnel`, `copyAuthToken`, `clearHistory`)
4. Sets up a **chat participant** (`@pocketpilot` in VS Code's chat panel) so you can also use it from the editor
5. Wires all event listeners — when the SessionManager emits a `chunk`, it forwards it to the phone via WebSocket
6. Starts the WebSocket server on port 3000

The `handleIncomingMessage()` function is the **message router** — it receives JSON from the phone and dispatches to the right SessionManager method based on the `type` field (`prompt`, `switch_model`, `permission`, `cancel_task`, etc.).

### `SessionManager.ts` — The Brain (1300+ lines)

This is the **core logic file**. It manages the Copilot SDK lifecycle:

**Key responsibilities:**
- **Copilot client lifecycle**: Starts/stops the background Copilot CLI daemon process via `@github/copilot-sdk`
- **Session management**: Creates or resumes Copilot sessions (persisted across restarts via `globalState`)
- **Prompt dispatch**: The `sendPrompt()` method sends user prompts to Copilot with retry logic for auth failures and model unavailability
- **Mode system**: Three modes with different system prompts — `ask` (Q&A), `agent` (code execution), `plan` (step-by-step planning)
- **Permission handling**: Queue-based system where tool execution requests are forwarded to the phone for approval
- **Git diff tracking**: Snapshots the workspace state before each prompt, then compares after to detect which files the AI modified
- **Model management**: Supports switching models, blocks certain models (Sonnet), implements smart fallback when a model is unavailable

**How `sendPrompt()` works (the most important method):**

```
User types "fix the login bug" on phone
  → WebSocket delivers { type: 'prompt', content: '...', mode: 'agent' }
  → extension.ts calls session.sendPrompt(content, mode, model)
  → SessionManager snapshots git state (snapshotWorkspaceState)
  → Ensures a CopilotSession exists (ensureSession)
  → Calls session.sendAndWait() with the prompt
  → Copilot streams tokens → SessionManager emits 'chunk' events
  → extension.ts forwards chunks to phone via wsManager.send()
  → When done: emits 'done', runs emitModifiedFiles() to detect file changes
  → If files changed: sends 'files_modified' with git diffs to the phone
```

**Permission flow:**  
When Copilot wants to run a terminal command or write a file, the SDK calls `handlePermissionRequest()`. This:
1. Auto-approves if "allow all" was selected this session
2. Auto-approves read-only operations in agent mode
3. Otherwise, queues the request and forwards it to the phone
4. Phone shows a modal with Allow / Allow Session / Allow All / Deny
5. The decision resolves the Promise, and the SDK continues or aborts

### `WebSocketManager.ts` — The Communication Layer

Manages the WebSocket server. Key features:

- **Single-client lock**: Only one phone at a time
- **Auth handshake**: 5-second timeout for the token
- **Heartbeat system**: Sends `ping` every 5 seconds, expects `pong` back. If no pong for 10 seconds, considers the connection dead
- **Message buffer**: If the phone disconnects briefly, messages are queued (up to 100) and flushed when it reconnects

### `TunnelManager.ts` — Remote Access

Enables phone access when not on the same Wi-Fi. Implements a **multi-provider fallback chain**:

1. **Cloudflare Quick Tunnel** (primary) — spawns `cloudflared tunnel --url http://localhost:3000`, parses the generated `*.trycloudflare.com` URL from stderr
2. **SSH reverse tunnel** (fallback) — tries `serveo.net` first, then `localhost.run`, using `ssh -R 80:localhost:3000`
3. **Localtunnel** (last resort) — uses the `lt` npm CLI

Each provider has its own timeout (15s for Cloudflare, 20s for SSH, 20s for localtunnel). If all fail, a detailed error lists what went wrong.

### `StatusManager.ts` — Centralized State

Acts as a **single source of truth** for the extension's state. Stores:
- Server status (running/stopped)
- Phone connection status
- Tunnel status and URL
- Current model, mode, activity text

When any state changes via `update()`, it:
1. Updates the VS Code status bar item (the text at the bottom of the editor)
2. Emits `stateChanged` so the sidebar dashboard updates in real-time

### `SidebarProvider.ts` — The Dashboard

Renders an HTML webview in VS Code's sidebar with:
- Live status indicators (green/yellow/red dots for server, phone, tunnel)
- Quick action buttons (Show QR, Toggle Tunnel, Clear History, Copy Token)
- A live QR code for phone scanning
- Connection URLs (local + tunnel)
- Session info (current model, mode, activity)

Uses VS Code's `postMessage` API for two-way communication between the webview HTML and the extension TypeScript.

### `QRCodePanel.ts` — Full-Screen QR

A simpler standalone webview panel that shows the QR code in a larger format when the user runs the "Show QR Code" command.

---

## 4. The Mobile App

Located in `/application/src/`. Built with **React Native + Expo**.

### App Architecture

```
App.tsx
  └─ ThemeProvider (dark/light mode context)
     └─ AppProvider (WebSocket context — global connection state)
        └─ NavigationContainer
           ├─ ConnectScreen  (QR scan + manual URL entry)
           ├─ ChatScreen     (main chat interface)
           └─ SettingsScreen (preferences)
```

### `App.tsx` — Entry Point

Wraps everything in two context providers:
- **ThemeProvider**: Manages dark/light mode with themed color tokens
- **AppProvider**: Initializes the `useWebSocket` hook and makes it available globally via React Context

### `ConnectScreen.tsx` — Connection Setup

Features:
- **QR Scanner**: Uses `expo-camera` to scan the JSON-encoded QR code
- **Manual entry**: Text fields for URL and token
- **Connection history**: Saved connections via AsyncStorage, shown in a FlatList for quick reconnect
- **Smart URL normalization**: Auto-converts `192.168.1.5:3000` → `ws://192.168.1.5:3000`, `https://...` → `wss://...`
- **Stale tunnel detection**: Skips auto-reconnect for old `trycloudflare.com` URLs since they expire on restart

### `ChatScreen.tsx` — The Main Interface

This is the most complex screen. It includes:

- **Message list**: FlatList rendering `MessageBubble` components with markdown support
- **Mode selector**: Toggle between Ask / Agent / Plan modes
- **Model selector**: Dropdown to switch LLM models (GPT-4o, Gemini, etc.)
- **Text input** with multiline support
- **Attachment menu**: Camera, Gallery, File picker — uses `expo-image-picker` and `expo-document-picker`
- **Voice recording**: Tap mic → record → transcribe via Groq Whisper → text appears in input
- **Permission modal**: Spring-animated overlay for approving/denying tool actions
- **User input modal**: When Copilot asks a question, this modal pops up
- **Action buttons**: After plan mode, shows "Start Implementation" / "Revise Plan" / "Cancel"
- **File diff summary**: Shows modified file chips after agent mode; tap to see full diff
- **Toast notifications**: Animated fade-in/out bar for tool status updates
- **Cancel button**: Stops active generation via `cancel_task` message

### Hooks

**`useChat.ts`** — Manages chat message state:
- `sendPrompt()`: Adds user + placeholder assistant messages, converts attachments to base64, sends over WebSocket
- `onChunk()`: Appends streaming text to the latest assistant message
- `onDone()`: Marks streaming complete
- `onError()`: Appends error text to the message bubble
- `clearHistory()`: Resets message array

**`useWebSocket.ts`** — Manages connection state:
- Maintains states: `status`, `project`, `branch`, `model`, `mode`, `availableModels`, `activity`, `modifiedFiles`
- `connect()`: Creates a `WebSocketService` instance and connects
- The `onMessage` handler is a big switch statement routing incoming message types to state updates or callbacks

### Services

**`websocket.ts`** — Low-level WebSocket client:
- Handles connect/disconnect/reconnect lifecycle
- **Exponential backoff**: 1s → 2s → 4s → 8s... capped at 30s
- **Tunnel escalation**: After 3 consecutive local failures, auto-switches to the tunnel URL
- **Ping/pong**: Responds to server pings automatically

**`groqService.ts`** — Groq AI integration for two features:
- `transcribeAudio()`: Sends recorded audio to Groq's Whisper Large V3 Turbo API for speech-to-text
- `analyzeImage()`: Sends images to Groq's Llama Scout vision model for image analysis

**`storage.ts`** — AsyncStorage wrapper:
- Saves/loads connection history (max 10 entries)
- Persists user preferences (default mode, model)

### Components

| Component | Purpose |
|---|---|
| `MessageBubble` | Renders a single chat message with markdown, code highlighting |
| `MarkdownRenderer` | Converts markdown to styled React Native components |
| `DiffViewer` | Shows file change chips + full-screen diff modal with GitHub-style coloring |
| `PermissionModal` | Spring-animated modal for Allow/Deny decisions |
| `UserInputModal` | Text input modal when Copilot asks a question |
| `ActionButtons` | Horizontal action chips (Start Implementation, Revise Plan) |
| `ModeSelector` | Ask/Agent/Plan toggle bar |
| `ModelSelector` | LLM model dropdown picker |
| `StreamingIndicator` | Animated "thinking" dots with activity text |
| `ConnectionStatus` | Connection state indicator |
| `Logo` | SVG logo component |

---

## 5. Feature Deep-Dives

### 5.1 Three Operating Modes

Each mode sets a different **system prompt** that shapes Copilot's behavior:

| Mode | Behavior | System Prompt (summary) |
|---|---|---|
| **Ask** | Q&A only, no file changes | "Answer questions clearly. Don't suggest file changes unless asked." |
| **Agent** | Autonomous code execution | "Write code, suggest file changes, run terminal commands. Explain what you're doing." |
| **Plan** | Planning without execution | "Create a step-by-step plan. Do NOT implement — only plan. Wait for approval." |

In **Plan mode**, after Copilot generates a plan, the extension emits `action_required` with three buttons. If the user clicks "Start Implementation", the mode auto-switches to Agent and sends "Please implement the plan above step by step."

### 5.2 Streaming Responses

Responses stream **token by token** using the Copilot SDK's `assistant.message_delta` event:

```
SDK emits token "Hello"  → SessionManager emits 'chunk' 
                         → extension.ts calls wsManager.send({ type: 'chunk', content: 'Hello' })
                         → Phone's useWebSocket dispatches to useChat.onChunk()
                         → onChunk appends "Hello" to the last assistant message
                         → React re-renders MessageBubble with updated text
```

### 5.3 Permission System (Queue-Based)

The permission system uses a **queue** to handle concurrent tool requests:

1. Copilot SDK calls `handlePermissionRequest()` for each tool it wants to use
2. Each request creates a Promise and pushes it to `pendingPermissionQueue`
3. Only the **first** item in the queue is shown on the phone
4. When the user responds, the first item is resolved, and the next one is shown
5. "Allow All" auto-resolves everything in the queue
6. In Agent mode, read-only operations (file reads, URL fetches) are auto-approved

This queue design prevents a bug where concurrent Promises would "orphan" each other.

### 5.4 Git Diff Tracking

After each prompt in Agent mode, the extension detects what files changed:

1. **Before the prompt**: `snapshotWorkspaceState()` runs `git diff HEAD --name-only` and `git ls-files --others` to record all currently dirty/untracked files
2. **After the prompt**: `emitModifiedFiles()` runs the same commands and **subtracts** the baseline to find only **newly changed** files
3. For each new file, it runs `git diff HEAD -- "file"` to get the actual unified diff
4. Sends `{ type: 'files_modified', files: [...] }` to the phone

The phone renders these as **tappable chips** showing filename + `+additions` / `-deletions`. Tapping opens a full-screen modal with GitHub-style colored diff lines.

### 5.5 Voice Input (Groq Whisper)

1. User taps the mic button → `expo-av` starts recording in HIGH_QUALITY mode
2. User taps again to stop → recording is saved to a local URI
3. The audio file is sent to Groq's Whisper Large V3 Turbo API as multipart form data
4. Transcribed text is placed in the input field (NOT auto-sent, so user can review/edit)
5. User presses send manually

### 5.6 File Attachments

Users can attach images (camera/gallery) or files:

1. `expo-image-picker` or `expo-document-picker` captures the file
2. Attachment metadata (URI, name, MIME type) is stored in state and shown as thumbnails
3. When sending, `useChat.sendPrompt()` converts each file to **base64** using `FileReader`
4. The extension receives base64 data, writes it to `.pocketpilot/uploads/` in the workspace
5. Passes the file path to Copilot SDK as an attachment

### 5.7 Remote Tunneling

For when your phone isn't on the same Wi-Fi:

The tunnel manager tries three providers in sequence. Each spawns a child process and parses stdout/stderr for the generated URL using regex patterns. The QR code automatically updates to include both the tunnel URL and the local URL, so the phone can try local first and fall back to tunnel.

### 5.8 Session Persistence

- The Copilot session ID is stored in `globalState` so it survives VS Code restarts
- On reconnect, `ensureSession()` tries `resumeSession()` first to restore conversation history
- If resume fails (e.g., model no longer available), it falls back to creating a new session
- User preferences (mode, model) are also persisted in `globalState`

---

## 6. Message Protocol

All communication uses JSON over WebSocket. Here's the complete protocol:

### Phone → Extension

| Type | Purpose | Key Fields |
|---|---|---|
| `auth` | Authentication handshake | `token` |
| `pong` | Heartbeat reply | — |
| `prompt` | Send a chat message | `content`, `mode`, `model?`, `attachments?` |
| `permission` | Permission decision | `id`, `decision` (allow/deny/allow_session/allow_all) |
| `user_input` | Answer to a question | `answer` |
| `action` | Action button click | `action` (start_implementation/revise_plan/cancel) |
| `switch_model` | Change LLM model | `model` |
| `switch_mode` | Change operating mode | `mode` (ask/agent/plan) |
| `clear_history` | Reset conversation | — |
| `cancel_task` | Stop generation | — |
| `get_workspace_info` | Request project info | — |

### Extension → Phone

| Type | Purpose | Key Fields |
|---|---|---|
| `ping` | Heartbeat check | — |
| `connected` | Connection confirmed | `project`, `branch`, `model`, `mode`, `hasHistory` |
| `chunk` | Streaming token | `content` |
| `done` | Generation complete | — |
| `error` | Error occurred | `code`, `message` |
| `permission_request` | Approve/deny prompt | `id`, `kind`, `command` |
| `user_input_request` | Ask user a question | `question`, `choices?` |
| `action_required` | Show action buttons | `actions[]` |
| `model_switched` | Model changed | `model` |
| `mode_switched` | Mode changed | `mode` |
| `activity` | Status update text | `label` |
| `files_modified` | File diffs after agent | `files[]` with `diff`, `additions`, `deletions` |
| `models_available` | Available LLM list | `models[]` with `id`, `displayName` |
| `notification` | Toast notification | `title`, `body` |
| `cli_status` | Copilot daemon status | `status` (running/crashed/reconnecting) |

---

## 7. Key Design Decisions & Patterns

### Event-Driven Architecture
Both the extension and app use the **EventEmitter** pattern. The SessionManager emits events (`chunk`, `done`, `error`, `permission_request`), and `extension.ts` subscribes to forward them over WebSocket. This keeps concerns separated.

### Single Source of Truth (StatusManager)
Instead of scattered state across multiple files, `StatusManager` holds all UI state centrally. Any change goes through `update()`, which notifies all subscribers (status bar + sidebar). This eliminates stale-status bugs.

### Queue-Based Permission Handling
Concurrent SDK permission requests are queued to prevent Promise orphaning. Only one modal shows at a time. This was a specific fix for a deadlock bug where multiple simultaneous requests would cause the extension to hang.

### Local-First Connectivity
The connection flow always tries the LAN address first (lower latency, no external dependency) before falling back to cloud tunnels. This is transparent to the user.

### Smart Model Fallback
If a selected model returns a 400 error, `sendPrompt()` queries the SDK for available models and picks a fallback automatically (prefers other Gemini variants → GPT-4o → any available → auto).

### React Context for Global State
The mobile app uses React Context (`AppProvider`) to make the WebSocket connection available everywhere without prop drilling. The `useWebSocket` hook is instantiated once and shared.

---

## 8. Tech Stack Summary

### VS Code Extension
| Technology | Purpose |
|---|---|
| TypeScript | Language |
| `@github/copilot-sdk` | Interface to GitHub Copilot CLI |
| `ws` | WebSocket server |
| `qrcode` | QR code generation |
| Webpack | Module bundling |
| VS Code Extension API | Commands, webviews, chat participants, status bar |

### Mobile App
| Technology | Purpose |
|---|---|
| React Native + Expo | Cross-platform mobile framework |
| TypeScript | Language |
| React Navigation | Screen navigation (Stack navigator) |
| AsyncStorage | Persistent local storage |
| expo-camera | QR code scanning |
| expo-av | Audio recording for voice input |
| expo-image-picker | Camera & gallery access |
| expo-document-picker | File attachment selection |
| expo-haptics | Tactile feedback on interactions |
| Groq API (Whisper) | Speech-to-text transcription |
| react-native-markdown-display | Markdown rendering in chat |
| react-syntax-highlighter | Code block syntax highlighting |

---

## 9. Deep-Dive: The GitHub Copilot SDK — The Brain of PocketPilot

The `@github/copilot-sdk` (version `^0.2.2-preview.0`) is **the most critical dependency** in the entire project. Without it, PocketPilot would just be a chat app with no AI. The SDK is what gives us access to GitHub Copilot's LLM models, tool execution, and agentic capabilities. Here's exactly how it works under the hood.

### 9.1 What IS the Copilot SDK?

The Copilot SDK is a **TypeScript library** published by GitHub that provides a programmatic interface to Copilot's AI backend. Instead of using Copilot through VS Code's built-in chat panel, the SDK lets you build **your own AI applications** on top of Copilot's infrastructure.

It exposes two core classes that we import:

```typescript
// SessionManager.ts — lines 6-15
import {
    CopilotClient,      // Manages the background Copilot CLI daemon process
    CopilotSession,     // Represents an active conversation with the AI
} from '@github/copilot-sdk';

import type {
    PermissionRequest,        // Shape of a tool-execution approval request
    PermissionRequestResult,  // Shape of our response (approved / denied)
    SessionConfig,            // Options for creating/resuming sessions
    ModelInfo,                // Shape of model metadata from listModels()
} from '@github/copilot-sdk';
```

### 9.2 The Daemon Architecture (CopilotClient)

The SDK doesn't make HTTP calls directly to GitHub's API. Instead, it **spawns a native binary** (the Copilot CLI) as a child process that runs in the background. This daemon handles all the authentication, API communication, and token management with GitHub's servers.

**How we start it:**

```typescript
// SessionManager.ts — startClient()
const cliPath = findCopilotCliPath(this.context.extensionPath);

this.client = new CopilotClient({
    cliPath,                    // Path to the native copilot binary
    autoStart: true,            // Auto-start the daemon
    githubToken: this.githubToken,  // VS Code GitHub auth token
    useLoggedInUser: false,     // We provide the token ourselves
});

await this.client.start();   // Spawns the daemon process
```

**The CLI binary resolution problem:** The SDK uses `import.meta.resolve` internally to find the Copilot CLI binary, but that fails in VS Code's webpack/CommonJS environment. So we built `findCopilotCliPath()` (lines 22–66) which manually searches for the platform-specific native binary:

- Linux x64: `@github/copilot-linux-x64/copilot`
- macOS ARM: `@github/copilot-darwin-arm64/copilot`
- Windows x64: `@github/copilot-win32-x64/copilot.exe`
- Fallback: `@github/copilot/index.js` (JavaScript entrypoint)

**Authentication:** The client needs a GitHub token to authenticate with Copilot's backend. We get this through VS Code's built-in GitHub auth API:

```typescript
const authSession = await vscode.authentication.getSession(
    'github',
    ['read:user'],
    { createIfNone: interactive },
);
return authSession?.accessToken;
```

### 9.3 Sessions — The Conversation Container (CopilotSession)

A **session** is a persistent conversation with the AI. It maintains the full message history, the current model, and the system prompt configuration. Two key operations:

**Creating a new session:**
```typescript
const config: SessionConfig = {
    streaming: true,                    // We want token-by-token streaming
    workingDirectory: workDir,          // The workspace folder path
    onPermissionRequest: (req) => ..., // Callback when AI needs tool approval
    onUserInputRequest: (req) => ..., // Callback when AI asks a question
    systemMessage: { ... },            // System prompt customization
    infiniteSessions: { enabled: true }, // Don't expire after inactivity
};

const session = await this.client.createSession(config);
```

**Resuming an existing session (conversation persistence):**
```typescript
// We save the session ID to VS Code's globalState after creation
await this.context.globalState.update('pocketpilot.sessionId', session.sessionId);

// On next startup, we try to resume it — this restores the full chat history
const lastSessionId = this.context.globalState.get<string>('pocketpilot.sessionId');
const session = await this.client.resumeSession(lastSessionId, config);
```

This is why your conversation survives VS Code restarts — the SDK stores session data on disk, and we just resume it by ID.

### 9.4 Sending Prompts — The Core Loop

When you type a message on your phone, this is the exact SDK call that runs:

```typescript
// SessionManager.ts — sendPrompt()
const session = await this.ensureSession();

// Optional: switch to a specific model for this prompt
await session.setModel('gpt-4o');

// Send the prompt and WAIT for the full response to complete
await session.sendAndWait(
    { prompt: content, attachments: sdkAttachments },
    600_000   // 10-minute timeout
);
```

`sendAndWait()` is a **blocking** call — it doesn't return until Copilot finishes its entire response (or the timeout expires). But we still get **real-time streaming** because of events (see next section).

### 9.5 The Event System — Real-Time Streaming

The SDK uses an **event-driven model**. While `sendAndWait()` is running, the session emits events for every token, every tool call, and every state change. We subscribe to these events to pipe them to the phone:

```typescript
// SessionManager.ts — wireSessionEvents()

// 1. Streaming text chunks (each token as it arrives)
session.on('assistant.message_delta', (event) => {
    this.emit('chunk', event.data.deltaContent);
    // → forwarded to phone → appended to chat bubble in real-time
});

// 2. Reasoning/thinking tokens (like Claude's thinking blocks)
session.on('assistant.reasoning_delta', (event) => {
    this.emit('chunk', event.data.deltaContent);
});

// 3. Response complete — the AI stopped generating
session.on('session.idle', () => {
    this.emitModifiedFiles();  // Detect file changes via git diff
    this.emit('done');         // Tell the phone to stop the loading indicator
});

// 4. Error during generation
session.on('session.error', (event) => {
    this.emit('error', 'SESSION_ERROR', event.data.message);
});

// 5. Tool execution started (AI wants to run a command, read a file, etc.)
session.on('tool.execution_start', (event) => {
    // Show "Running command: npm install" on the phone
    this.emit('activity', `Running: ${event.data.toolName}`);
});

// 6. Tool execution finished
session.on('tool.execution_complete', (event) => {
    this.emit('activity', `✓ ${event.data.toolName}`);
});

// 7. Model changed by the session itself
session.on('session.model_change', (event) => {
    this.emit('model_switched', event.data.newModel);
});
```

**This event system is what makes the "ChatGPT-like" streaming experience possible.** Without it, the user would have to wait for the entire response to finish before seeing anything.

### 9.6 Tool Permissions — The SDK's Safety Gate

When Copilot's AI decides it needs to **execute a shell command**, **read a file**, or **write to disk**, the SDK doesn't just do it. It calls our `onPermissionRequest` callback and **blocks** until we respond. This is the SDK's built-in safety mechanism.

```typescript
// The callback we provide in SessionConfig:
onPermissionRequest: (request: PermissionRequest) => {
    // request.kind = 'shell' | 'read' | 'write' | 'mcp' | 'url'
    // We return a Promise that resolves when the phone user decides

    return new Promise<PermissionRequestResult>((resolve) => {
        // Queue the request and forward to phone
        this.pendingPermissionQueue.push({ id, resolve });
        this.emit('permission_request', id, request.kind, description);
    });
    // The Promise stays pending until the phone user taps Allow/Deny
    // Only then does resolve() get called and the SDK continues
}
```

**What the SDK does with our response:**
- `{ kind: 'approved' }` → The SDK executes the tool (runs the command, writes the file)
- `{ kind: 'denied-interactively-by-user' }` → The SDK tells the AI "user refused", and the AI adapts

### 9.7 Model Management

The SDK provides methods to query and switch between AI models:

```typescript
// List all models the user has access to
const modelInfos: ModelInfo[] = await this.client.listModels();
// Returns: [{ id: 'gpt-4o', name: 'GPT-4o', policy: {...} }, ...]

// Switch model for the current session
await session.setModel('gemini-2.5-pro');

// Cancel generation
await session.abort();

// Delete a session from disk
await this.client.deleteSession(sessionId);
```

**Problem we solved:** The SDK's `listModels()` often returns an incomplete list (it only shows models the user has explicitly used). So we maintain a hardcoded `KNOWN_COPILOT_MODELS` list and merge them together:

```typescript
// Merge: start with SDK models, then add known models the SDK missed
const seenIds = new Set(sdkModels.map(m => m.id));
for (const known of KNOWN_COPILOT_MODELS) {
    if (!seenIds.has(known.id)) {
        supplemented.push(known);
    }
}
```

### 9.8 System Prompts — How Modes Work

The SDK lets us customize the system message that shapes the AI's behavior. We use this to implement our three modes:

```typescript
systemMessage: {
    mode: 'customize',   // Extend the default system prompt
    sections: {
        custom_instructions: {
            action: (content) => {
                // Append our mode-specific instructions to the existing prompt
                return content + '\n\n' + MODE_INSTRUCTIONS[this._currentMode];
            },
        },
    },
}
```

The `'customize'` mode means we **extend** Copilot's default system prompt rather than replacing it. This keeps all of Copilot's built-in capabilities (code search, tool use, etc.) while adding our mode-specific behavior on top.

### 9.9 What Problems Does the SDK Solve?

Without the Copilot SDK, building PocketPilot would require:

| Problem | Without SDK | With SDK |
|---|---|---|
| **LLM Access** | Need our own API keys, pay per token, manage rate limits | Uses the user's existing GitHub Copilot subscription — free for us |
| **Authentication** | Build our own OAuth flow, token refresh, etc. | One call to `vscode.authentication.getSession('github')` |
| **Streaming** | Manually implement SSE/WebSocket to an API, parse chunks | Subscribe to `assistant.message_delta` events |
| **Tool Execution** | Build our own sandboxed file/shell execution layer | SDK provides built-in tools with a permission callback |
| **Conversation Memory** | Store/manage chat history ourselves, implement context windows | Sessions persist automatically, resume by ID |
| **Model Switching** | Different APIs for GPT/Claude/Gemini, different formats | `session.setModel('gemini-2.5-pro')` — one line |
| **Code Understanding** | Need embeddings, file indexing, semantic search | Copilot already indexes the workspace through VS Code |
| **Safety** | Build permission UI, sandboxing, command validation | `onPermissionRequest` callback blocks until user approves |

**In short:** The SDK turns what would be a months-long project (building a secure, multi-model AI coding assistant with streaming, tool use, and workspace awareness) into something we can wrap with a WebSocket bridge and a mobile UI. The SDK is the brain; PocketPilot is the nervous system that extends it to your phone.

---

> **Summary:** PocketPilot is a two-part system — a VS Code extension that wraps GitHub Copilot's SDK and exposes it over WebSockets, and a React Native app that connects to it. The extension manages sessions, permissions, tunnels, and state; the app provides the chat UI, voice input, file attachments, and diff viewing. Everything communicates through a typed JSON protocol over WebSocket with auth, heartbeat, and reconnection built in. At its core, the `@github/copilot-sdk` provides the AI backbone — handling LLM access, streaming, tool execution, and session persistence — while PocketPilot extends that power to your mobile device with a secure, robust communication layer.
