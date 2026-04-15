# 📘 File 1/6 — `src/types.ts` — The Message Protocol

> **Why this file first?** Every single other file in the project imports from `types.ts`. It defines the "language" that the phone and the extension speak to each other. If you don't understand the protocol, nothing else will make sense. This is the contract — the rulebook — that both sides agree to follow.

---

## Table of Contents

1. [What is this file?](#1-what-is-this-file)
2. [Why do we need it?](#2-why-do-we-need-it)
3. [TypeScript Concepts Used](#3-typescript-concepts-used)
4. [Line-by-Line Breakdown: IncomingMessage](#4-line-by-line-breakdown-incomingmessage)
5. [Line-by-Line Breakdown: ActionButton](#5-line-by-line-breakdown-actionbutton)
6. [Line-by-Line Breakdown: OutgoingMessage](#6-line-by-line-breakdown-outgoingmessage)
7. [How the Protocol Works in Practice](#7-how-the-protocol-works-in-practice)
8. [Why Union Types and Not an Enum](#8-why-union-types-and-not-an-enum)
9. [Recap](#9-recap)

---

## 1. What is this file?

`types.ts` is a **type definition file**. It contains zero runtime code — nothing in here "runs" when the extension starts. It only exists so that TypeScript can **check our code at compile time** and warn us if we try to send or receive a message that doesn't follow the protocol.

Think of it like a blueprint for a house. The blueprint itself doesn't build anything, but every builder (every other file) looks at it to know what to build.

**What it defines:**

| Export            | What it is                                                                  |
| ----------------- | --------------------------------------------------------------------------- |
| `IncomingMessage` | Every possible message the **phone can send** to the extension              |
| `OutgoingMessage` | Every possible message the **extension can send** to the phone              |
| `ActionButton`    | A small reusable shape (interface) used inside one of the outgoing messages |

---

## 2. Why do we need it?

Without this file, every time we do `JSON.parse(rawMessage)` on a WebSocket message, we'd get `any` — which means TypeScript has no idea what shape the data has. We could accidentally write `msg.tokken` (typo) and TypeScript wouldn't catch it.

With this file, when we cast a parsed message to `IncomingMessage`, TypeScript knows:

- The `type` field can only be one of a fixed set of strings
- Each `type` comes with specific additional fields
- If we forget to handle a type, the compiler can tell us

This is called **type safety** — the compiler acts as a safety net.

---

## 3. TypeScript Concepts Used

Before we go line by line, here are the TypeScript features this file uses. You need to understand these first.

### 3.1 — `export`

```typescript
export type IncomingMessage = ...
```

The `export` keyword means "make this available to other files." Without it, `IncomingMessage` would be private to this file and no one could import it. Other files import it like this:

```typescript
import { IncomingMessage } from "./types";
```

### 3.2 — `type` alias

```typescript
type IncomingMessage = ...
```

A `type` alias gives a name to a type. It's like a variable, but for types instead of values. You can't do `new IncomingMessage()` — it's not a class. It only exists in TypeScript's type system and is completely erased when compiled to JavaScript.

### 3.3 — Object literal type

```typescript
{
  type: "auth";
  token: string;
}
```

This describes an object that:

- **Must** have a property `type` whose value is exactly the string `'auth'` (not any string — only `'auth'`)
- **Must** have a property `token` whose value is a `string`
- Can have **nothing else**

The `'auth'` is called a **string literal type** — it's a type that allows only one specific value.

### 3.4 — Union type (`|`)

```typescript
type IncomingMessage =
  | { type: "auth"; token: string }
  | { type: "pong" }
  | { type: "prompt"; content: string; mode: "ask" | "agent" | "plan" };
```

The `|` (pipe) means **OR**. So `IncomingMessage` is:

- EITHER an object with `type: 'auth'` and a `token`
- OR an object with `type: 'pong'`
- OR an object with `type: 'prompt'`, a `content`, and a `mode`
- OR ... (and so on)

This is called a **discriminated union** because every variant has a common field (`type`) that lets you tell them apart. The `type` field is the **discriminant** (the thing that discriminates/distinguishes between variants).

### 3.5 — `interface`

```typescript
export interface ActionButton {
  id: string;
  label: string;
  style: "primary" | "secondary" | "danger";
}
```

An `interface` is similar to a `type` alias for objects. It defines the shape of an object. The main difference from `type` is that interfaces can be extended/merged, but for our purposes, they work the same way.

We use `interface` here because `ActionButton` is a standalone reusable shape (like a data class), while `type` is used for the unions because unions can't be expressed with `interface`.

### 3.6 — Optional property (`?`)

```typescript
{ type: 'action'; action: '...' | '...'; diffId?: string }
```

The `?` after `diffId` means this property is **optional** — the object may or may not have it. When it's present, it must be a `string`. When it's absent, accessing it gives `undefined`.

---

## 4. Line-by-Line Breakdown: `IncomingMessage`

These are messages the **phone sends to the extension** (incoming = coming IN to VS Code).

```typescript
// ── Phone → Extension ──────────────────────────────────────────────
```

This is a comment. The arrow `→` tells us the direction: **from phone, to extension**. It's just for human readability.

---

```typescript
export type IncomingMessage =
```

We're defining and exporting a type called `IncomingMessage`. Everything after the `=` is what this type looks like.

---

### Variant 1: `auth`

```typescript
| { type: 'auth'; token: string }
```

**When is this sent?** This is the **very first message** the phone sends after connecting to the WebSocket. It's the phone proving it's authorized to connect.

**Fields:**

- `type: 'auth'` — identifies this as an authentication message
- `token: string` — the secret token the phone scanned from the QR code. The extension checks if this matches the token it generated. If it doesn't match → connection rejected.

**Flow:**

```
Phone connects to WebSocket
Phone sends: { "type": "auth", "token": "abc-123-..." }
Extension checks: does "abc-123-..." match my stored token?
  → Yes: connection accepted, send back "connected" message
  → No: connection closed immediately
```

---

### Variant 2: `pong`

```typescript
| { type: 'pong' }
```

**When is this sent?** Every 5 seconds, the extension sends a `ping` to the phone. The phone must reply with `pong` to prove it's still alive. This is called a **heartbeat**.

**Fields:**

- `type: 'pong'` — that's it. No other data needed. It's just "yes I'm still here."

**Why?** WebSocket connections can die silently (phone loses WiFi, app crashes, etc.). Without heartbeats, the extension would think the phone is still connected when it's not. The heartbeat detects dead connections within ~10 seconds.

---

### Variant 3: `prompt`

```typescript
| { type: 'prompt'; content: string; mode: 'ask' | 'agent' | 'plan' }
```

**When is this sent?** When the user types a message on their phone and hits send. This is the **main message type** — it's the user asking Copilot to do something.

**Fields:**

- `type: 'prompt'` — identifies this as a user prompt
- `content: string` — the actual text the user typed, e.g. `"Create a function that sorts an array"`
- `mode: 'ask' | 'agent' | 'plan'` — which Copilot mode to use:
  - `'ask'` — just answer the question (read-only, no file changes)
  - `'agent'` — go ahead and make changes to files
  - `'plan'` — create a step-by-step plan before doing anything

**Note:** The `mode` field uses a **string literal union** (`'ask' | 'agent' | 'plan'`). This means the value must be one of exactly those three strings. TypeScript will reject `'Ask'` or `'AGENT'` or `'edit'`.

---

### Variant 4: `permission`

```typescript
| { type: 'permission'; id: string; decision: 'allow' | 'allow_session' | 'allow_all' | 'deny' }
```

**When is this sent?** When Copilot wants to do something potentially dangerous (like running a terminal command or editing a file), the extension asks the phone for permission. This is the phone's response.

**Fields:**

- `type: 'permission'` — identifies this as a permission response
- `id: string` — which permission request this answers (there could be multiple pending). This ID was sent by the extension in a `permission_request` message.
- `decision` — what the user chose:
  - `'allow'` — allow this one time only
  - `'allow_session'` — allow for the rest of this session (until disconnect)
  - `'allow_all'` — always allow this type of action
  - `'deny'` — no, don't do it

---

### Variant 5: `user_input`

```typescript
| { type: 'user_input'; answer: string }
```

**When is this sent?** Sometimes Copilot needs additional information mid-task. The extension sends a `user_input_request` to the phone, and this is the phone's response.

**Fields:**

- `type: 'user_input'` — identifies this as a user input response
- `answer: string` — what the user typed in response to the question

**Example flow:**

```
Extension asks: "Which database do you want to use? (PostgreSQL, MySQL, SQLite)"
Phone shows the question to the user
User types: "PostgreSQL"
Phone sends: { "type": "user_input", "answer": "PostgreSQL" }
```

---

### Variant 6: `action`

```typescript
| { type: 'action'; action: 'start_implementation' | 'revise_plan' | 'cancel' | 'accept_diff' | 'reject_diff'; diffId?: string }
```

**When is this sent?** When the extension presents the user with action buttons (like "Accept changes" or "Revise plan"), the phone sends back their choice.

**Fields:**

- `type: 'action'` — identifies this as an action response
- `action` — which button they pressed:
  - `'start_implementation'` — after seeing a plan, "yes, go ahead and implement it"
  - `'revise_plan'` — "no, the plan needs changes"
  - `'cancel'` — "forget the whole thing"
  - `'accept_diff'` — "apply these code changes to my file"
  - `'reject_diff'` — "don't apply these changes"
- `diffId?: string` — **optional**. Only present for `accept_diff` and `reject_diff`, to specify WHICH diff is being accepted/rejected (there could be diffs for multiple files).

---

### Variant 7: `switch_model`

```typescript
| { type: 'switch_model'; model: string }
```

**When is this sent?** When the user wants to change which AI model Copilot uses (e.g., switch from GPT-4o to Claude).

**Fields:**

- `type: 'switch_model'`
- `model: string` — the model identifier, e.g. `"gpt-4o"`, `"claude-sonnet"`. This is a plain `string` (not a union of specific models) because new models get added all the time — we don't want to hardcode a list.

---

### Variant 8: `switch_mode`

```typescript
| { type: 'switch_mode'; mode: 'ask' | 'agent' | 'plan' }
```

**When is this sent?** When the user wants to change the Copilot mode WITHOUT sending a prompt. For example, switching from "ask" to "agent" mode before typing their next message.

**Fields:**

- `type: 'switch_mode'`
- `mode: 'ask' | 'agent' | 'plan'` — same mode options as in the `prompt` message

**Difference from `prompt`:** The `prompt` message includes a mode AND a message. This message ONLY changes the mode — no text is sent to Copilot.

---

### Variant 9: `clear_history`

```typescript
| { type: 'clear_history' }
```

**When is this sent?** When the user wants to start a fresh conversation, erasing all previous context.

**Fields:** Just the type. Nothing else needed. The extension will clear its stored conversation history.

---

### Variant 10: `get_workspace_info`

```typescript
| { type: 'get_workspace_info' }
```

**When is this sent?** When the phone wants to know about the current VS Code workspace — the project name, current git branch, and file list. Typically sent right after connecting.

**Fields:** Just the type. The extension responds with a `workspace_info` outgoing message.

---

### Variant 11: `cancel_task`

```typescript
| { type: 'cancel_task' }
```

**When is this sent?** When the user wants to stop the currently running Copilot task (e.g., Copilot is generating a long response and the user wants to abort).

**Fields:** Just the type. The extension will cancel the active language model request.

---

## 5. Line-by-Line Breakdown: `ActionButton`

```typescript
export interface ActionButton {
  id: string;
  label: string;
  style: "primary" | "secondary" | "danger";
}
```

This is a helper type used inside the `action_required` outgoing message. It describes a button that the phone should display.

**Fields:**

- `id: string` — a unique identifier for this button, e.g. `"start_implementation"`. When the user taps it, the phone sends an `action` message with this ID.
- `label: string` — the text shown on the button, e.g. `"Start Implementation"` or `"Cancel"`
- `style` — how the button should look:
  - `'primary'` — main action, highlighted (usually blue). Example: "Accept"
  - `'secondary'` — alternative action, less prominent. Example: "Revise"
  - `'danger'` — destructive action, typically red. Example: "Cancel" or "Reject changes"

**Why is this an `interface` and not inline?** Because it's used as an **array** inside `action_required` (`actions: ActionButton[]`). Defining it separately keeps things clean and lets the phone app import and use this type too.

---

## 6. Line-by-Line Breakdown: `OutgoingMessage`

These are messages the **extension sends to the phone** (outgoing = going OUT from VS Code).

```typescript
// ── Extension → Phone ──────────────────────────────────────────────
```

Direction comment: **from extension, to phone**.

---

### Variant 1: `ping`

```typescript
| { type: 'ping' }
```

**When is this sent?** Every 5 seconds, automatically by the WebSocketManager. It's the extension's heartbeat saying "are you still there?"

**Flow:**

```
Extension sends: { "type": "ping" }
  ← Phone must reply with: { "type": "pong" }
  If no pong within 10 seconds → phone is considered dead → disconnect
```

---

### Variant 2: `connected`

```typescript
| { type: 'connected'; project: string; branch: string; model: string; mode: string; hasHistory: boolean }
```

**When is this sent?** Immediately after the phone successfully authenticates. It's the extension's "welcome" message.

**Fields:**

- `type: 'connected'`
- `project: string` — the workspace folder name, e.g. `"PocketPilot"`
- `branch: string` — current git branch, e.g. `"extension"`
- `model: string` — currently active AI model, e.g. `"gpt-4o"`
- `mode: string` — currently active mode, e.g. `"ask"`
- `hasHistory: boolean` — whether there's a previous conversation that can be resumed. The phone app can use this to show a "Resume conversation?" prompt.

**Why all this info at once?** So the phone can set up its entire UI in one shot without needing to make multiple requests. One message, all the context.

---

### Variant 3: `chunk`

```typescript
| { type: 'chunk'; content: string }
```

**When is this sent?** While Copilot is generating a response. AI models don't produce the entire answer at once — they produce it **token by token** (a token is roughly a word or part of a word). Each token is sent as a chunk.

**Fields:**

- `type: 'chunk'`
- `content: string` — a small piece of the response, e.g. `"Here"`, `"'s"`, `" how"`, `" you"`, `" can"` ...

**Why stream chunks?** If Copilot generates a 500-word answer, the user would have to wait for the entire thing before seeing anything. With streaming, they see words appear in real-time, just like ChatGPT's typing effect. This is called **streaming** or **server-sent events style**.

The phone app accumulates chunks: `"Here" + "'s" + " how" + " you" + " can" + ...` until it receives a `done` message.

---

### Variant 4: `done`

```typescript
| { type: 'done' }
```

**When is this sent?** After the last `chunk`. It tells the phone "the response is complete, you can stop the loading indicator."

**Flow:**

````
Extension sends: { "type": "chunk", "content": "Here" }
Extension sends: { "type": "chunk", "content": "'s the code:" }
Extension sends: { "type": "chunk", "content": "\n```js\nconst x = 1;\n```" }
Extension sends: { "type": "done" }
Phone: stops loading animation, finalizes the message bubble
````

---

### Variant 5: `permission_request`

```typescript
| { type: 'permission_request'; id: string; kind: string; command: string }
```

**When is this sent?** When Copilot wants to do something that needs user approval.

**Fields:**

- `type: 'permission_request'`
- `id: string` — unique ID for this request. The phone sends it back in the `permission` response so the extension knows which request is being answered.
- `kind: string` — the category of permission, e.g. `"terminal"`, `"fileEdit"`, `"fileCreate"`
- `command: string` — the specific thing Copilot wants to do, e.g. `"npm install express"` or `"Edit src/index.ts"`

**Example:**

```json
{
  "type": "permission_request",
  "id": "perm-001",
  "kind": "terminal",
  "command": "rm -rf node_modules && npm install"
}
```

Phone shows: "Copilot wants to run a terminal command: `rm -rf node_modules && npm install`. Allow?"

---

### Variant 6: `user_input_request`

```typescript
| { type: 'user_input_request'; question: string; choices?: string[] }
```

**When is this sent?** When Copilot needs the user to answer a question mid-task.

**Fields:**

- `type: 'user_input_request'`
- `question: string` — the question to display
- `choices?: string[]` — **optional** list of suggested answers. If present, the phone can show them as buttons. If absent, show a free text input.

**Example with choices:**

```json
{
  "type": "user_input_request",
  "question": "Which testing framework should I use?",
  "choices": ["Jest", "Vitest", "Mocha"]
}
```

**Example without choices (free text):**

```json
{
  "type": "user_input_request",
  "question": "What should the component be named?"
}
```

---

### Variant 7: `action_required`

```typescript
| { type: 'action_required'; actions: ActionButton[] }
```

**When is this sent?** When Copilot needs the user to choose what to do next. For example, after generating a plan: "Do you want to start implementation, revise, or cancel?"

**Fields:**

- `type: 'action_required'`
- `actions: ActionButton[]` — an array of buttons to display (uses the `ActionButton` interface we defined earlier)

**Example:**

```json
{
  "type": "action_required",
  "actions": [
    {
      "id": "start_implementation",
      "label": "Start Implementation",
      "style": "primary"
    },
    { "id": "revise_plan", "label": "Revise Plan", "style": "secondary" },
    { "id": "cancel", "label": "Cancel", "style": "danger" }
  ]
}
```

---

### Variant 8: `diff`

```typescript
| { type: 'diff'; id: string; file: string; before: string; after: string }
```

**When is this sent?** When Copilot has made (or wants to make) changes to a file. The phone shows a diff view so the user can review the changes.

**Fields:**

- `type: 'diff'`
- `id: string` — unique ID for this diff. Used when the user accepts or rejects it.
- `file: string` — the file path, e.g. `"src/index.ts"`
- `before: string` — the file content BEFORE the change
- `after: string` — the file content AFTER the change

The phone app can use a diff library to highlight what changed (red for removed lines, green for added lines).

---

### Variant 9: `workspace_info`

```typescript
| { type: 'workspace_info'; project: string; branch: string; files: string[] }
```

**When is this sent?** In response to a `get_workspace_info` incoming message.

**Fields:**

- `type: 'workspace_info'`
- `project: string` — workspace folder name
- `branch: string` — current git branch
- `files: string[]` — list of files in the workspace (useful for the phone to show a file tree)

---

### Variant 10: `model_switched`

```typescript
| { type: 'model_switched'; model: string }
```

**When is this sent?** After the extension successfully switches to a different AI model, confirming the switch.

**Fields:**

- `type: 'model_switched'`
- `model: string` — the new active model name

---

### Variant 11: `mode_switched`

```typescript
| { type: 'mode_switched'; mode: string }
```

**When is this sent?** After the extension successfully switches to a different Copilot mode, confirming the switch.

**Fields:**

- `type: 'mode_switched'`
- `mode: string` — the new active mode

---

### Variant 12: `error`

```typescript
| { type: 'error'; code: string; message: string }
```

**When is this sent?** When something goes wrong on the extension side.

**Fields:**

- `type: 'error'`
- `code: string` — a machine-readable error code, e.g. `"MODEL_NOT_AVAILABLE"`, `"WORKSPACE_NOT_OPEN"`. The phone can use this to show different UI for different errors.
- `message: string` — a human-readable error description, e.g. `"The model claude-opus is not available in your Copilot subscription"`

**Why both `code` and `message`?** The `code` is for the app's logic (e.g., `if code === 'MODEL_NOT_AVAILABLE'` → show a model picker). The `message` is for the user to read. This is a very common API design pattern.

---

### Variant 13: `cli_status`

```typescript
| { type: 'cli_status'; status: 'running' | 'crashed' | 'reconnecting' }
```

**When is this sent?** To inform the phone about the state of the Copilot CLI/SDK backend.

**Fields:**

- `type: 'cli_status'`
- `status`:
  - `'running'` — everything is working normally
  - `'crashed'` — the backend crashed (the extension will try to restart it)
  - `'reconnecting'` — the extension is trying to reconnect to the backend

The phone can show a small indicator (e.g., a yellow dot) when the backend isn't running.

---

### Variant 14: `notification`

```typescript
| { type: 'notification'; title: string; body: string }
```

**When is this sent?** For general notifications that don't fit into other categories. Like a push notification on the phone.

**Fields:**

- `type: 'notification'`
- `title: string` — the notification title, e.g. `"Task Complete"`
- `body: string` — the notification body, e.g. `"All 5 files have been updated successfully"`

---

## 7. How the Protocol Works in Practice

Here's a complete real-world flow from connection to asking a question:

```
1. Phone opens WebSocket connection to ws://192.168.1.10:3000
2. Phone → Extension:  { type: "auth", token: "a1b2c3d4-..." }
3. Extension validates token ✓
4. Extension → Phone:   { type: "connected", project: "PocketPilot", branch: "extension", model: "gpt-4o", mode: "ask", hasHistory: false }
5. Extension → Phone:   { type: "ping" }
6. Phone → Extension:   { type: "pong" }
   ... (heartbeat repeats every 5 seconds) ...
7. Phone → Extension:   { type: "prompt", content: "Explain the WebSocket code", mode: "ask" }
8. Extension → Phone:   { type: "chunk", content: "The WebSocket" }
9. Extension → Phone:   { type: "chunk", content: " server is created" }
10. Extension → Phone:  { type: "chunk", content: " using the `ws` library..." }
11. Extension → Phone:  { type: "done" }
```

And a more complex flow with permissions:

```
1. Phone → Extension:  { type: "prompt", content: "Install express and create a server", mode: "agent" }
2. Extension → Phone:  { type: "chunk", content: "I'll install express first..." }
3. Extension → Phone:  { type: "permission_request", id: "p1", kind: "terminal", command: "npm install express" }
4. Phone → Extension:  { type: "permission", id: "p1", decision: "allow" }
5. Extension runs the command...
6. Extension → Phone:  { type: "chunk", content: "Now creating the server file..." }
7. Extension → Phone:  { type: "diff", id: "d1", file: "server.js", before: "", after: "const express = require('express');\n..." }
8. Phone → Extension:  { type: "action", action: "accept_diff", diffId: "d1" }
9. Extension applies the diff...
10. Extension → Phone: { type: "done" }
```

---

## 8. Why Union Types and Not an Enum

You might wonder: "Why not use an enum for message types?"

```typescript
// ❌ We did NOT do this
enum MessageType {
  Auth = "auth",
  Pong = "pong",
  Prompt = "prompt",
  // ...
}
```

Reasons:

1. **Enums generate runtime code.** TypeScript enums compile to JavaScript objects. Our union types compile to... nothing. Zero bytes. They're purely compile-time.

2. **Enums don't carry associated data.** An enum can say "this is a prompt message" but can't say "a prompt message has `content` and `mode`." We'd need a separate interface for each message type AND the enum. The discriminated union does both in one declaration.

3. **Discriminated unions work with `switch`.** TypeScript is smart enough to narrow the type automatically:

```typescript
function handle(msg: IncomingMessage) {
  switch (msg.type) {
    case "auth":
      // TypeScript KNOWS msg has .token here
      console.log(msg.token); // ✅ no error
      break;
    case "prompt":
      // TypeScript KNOWS msg has .content and .mode here
      console.log(msg.content); // ✅ no error
      console.log(msg.token); // ❌ ERROR — prompt doesn't have .token
      break;
  }
}
```

This is called **type narrowing** — TypeScript narrows the type based on the `switch` case. This is the single biggest advantage of discriminated unions, and it's used everywhere in our other files.

---

## 9. Recap

| Concept                                  | What You Learned                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------- |
| **Type aliases** (`type X = ...`)        | A name for a type. No runtime code generated.                                       |
| **Union types** (`A \| B \| C`)          | "One of these options." Each option is a variant.                                   |
| **Discriminated unions**                 | A union where every variant has a shared field (`type`) that distinguishes them.    |
| **String literal types** (`'auth'`)      | A type that allows only one exact string value.                                     |
| **Interface** (`interface X { ... }`)    | Defines the shape of an object.                                                     |
| **Optional properties** (`field?: type`) | The field may or may not exist on the object.                                       |
| **Type narrowing**                       | TypeScript auto-detects the specific variant inside a `switch` on the discriminant. |

**The mental model:** `types.ts` is a dictionary. When you see a message being sent or received in any other file, come back here to look up what it means and what fields it has.

---

> **Next file:** `src/WebSocketManager.ts` — the server that sends and receives all these messages.
