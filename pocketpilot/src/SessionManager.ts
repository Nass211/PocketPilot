import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { EventEmitter } from 'events';
import {
    CopilotClient,
    CopilotSession,
} from '@github/copilot-sdk';
import type {
    PermissionRequest,
    PermissionRequestResult,
    SessionConfig,
    ModelInfo,
} from '@github/copilot-sdk';

/**
 * Resolve the @github/copilot CLI entry point.
 * The SDK's built-in resolution uses import.meta.resolve which fails
 * in the webpack/CJS bundle VS Code loads. We locate it manually.
 */
function findCopilotCliPath(extensionPath: string): string | undefined {
    const nativeCandidates: string[] = [];

    // Prefer native binaries so the SDK spawns them directly.
    if (process.platform === 'linux' && process.arch === 'x64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-linux-x64', 'copilot'));
    }
    if (process.platform === 'linux' && process.arch === 'arm64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-linux-arm64', 'copilot'));
    }
    if (process.platform === 'darwin' && process.arch === 'x64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-darwin-x64', 'copilot'));
    }
    if (process.platform === 'darwin' && process.arch === 'arm64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-darwin-arm64', 'copilot'));
    }
    if (process.platform === 'win32' && process.arch === 'x64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-win32-x64', 'copilot.exe'));
    }
    if (process.platform === 'win32' && process.arch === 'arm64') {
        nativeCandidates.push(join(extensionPath, 'node_modules', '@github', 'copilot-win32-arm64', 'copilot.exe'));
    }

    for (const candidate of nativeCandidates) {
        if (existsSync(candidate)) { return candidate; }
    }

    // Fallback to JS entrypoint if no native binary package is present.
    const fromExtension = join(extensionPath, 'node_modules', '@github', 'copilot', 'index.js');
    if (existsSync(fromExtension)) { return fromExtension; }

    const fromSdk = join(
        extensionPath,
        'node_modules',
        '@github',
        'copilot-sdk',
        'node_modules',
        '@github',
        'copilot',
        'index.js',
    );
    if (existsSync(fromSdk)) { return fromSdk; }

    return undefined;
}

export class SessionManager extends EventEmitter {
    private static readonly BLOCKED_MODEL_IDS = new Set([
        'claude-sonnet-4.5',
    ]);

    private static isBlockedModelId(model: string): boolean {
        const normalized = model.toLowerCase();
        return SessionManager.BLOCKED_MODEL_IDS.has(normalized) || normalized.includes('sonnet');
    }

    private client: CopilotClient | null = null;
    private session: CopilotSession | null = null;
    private context: vscode.ExtensionContext;
    private githubToken: string | undefined;

    private _currentModel: string = 'auto';
    private _currentMode: 'ask' | 'agent' | 'plan' = 'ask';
    private _hasHistory = false;
    private isBusy = false;

    // Pending permission/input forwarded to phone, resolved when phone responds.
    // Uses a queue so multiple concurrent SDK permission requests don't orphan
    // each other's Promises (which was causing the "stuck forever" bug).
    private pendingPermissionQueue: Array<{
        id: string;
        resolve: (result: PermissionRequestResult) => void;
        kind?: string;
    }> = [];
    private pendingUserInput: {
        resolve: (result: { answer: string; wasFreeform: boolean }) => void;
    } | null = null;
    private waitingForRevision = false;

    // Session-level permission memory (reset on disconnect)
    private sessionApprovals = new Map<string, boolean>();
    private allowAllSession = false;

    // Event unsubscribe functions for the current session
    private eventUnsubs: (() => void)[] = [];

    private static readonly MODE_INSTRUCTIONS: Record<string, string> = {
        ask: [
            'You are a helpful coding assistant.',
            'Answer questions clearly and concisely.',
            'Focus on explaining concepts, reviewing code, and answering technical questions.',
            'Do not suggest file changes unless explicitly asked.',
        ].join(' '),
        agent: [
            'You are a coding agent.',
            'Help the user by writing code, suggesting file changes, and running terminal commands.',
            'Always explain what you are doing before making changes.',
        ].join(' '),
        plan: [
            'You are a planning assistant.',
            'When given a task, create a detailed numbered step-by-step implementation plan.',
            'Do NOT implement anything — only plan.',
            'After presenting the plan, wait for the user to approve before taking any action.',
        ].join(' '),
    };

    constructor(context: vscode.ExtensionContext) {
        super();
        this.context = context;

        // Restore mode preference; model starts in auto to avoid stale lock-in.
        const savedMode = context.globalState.get<string>('pocketpilot.mode');
        if (savedMode && ['ask', 'agent', 'plan'].includes(savedMode)) {
            this._currentMode = savedMode as 'ask' | 'agent' | 'plan';
        }
    }

    // ── Getters ─────────────────────────────────────────────────────

    get currentModel(): string { return this._currentModel; }
    get currentMode(): string { return this._currentMode; }
    get hasHistory(): boolean { return this._hasHistory; }

    private normalizeModelSelection(model?: string): string | undefined {
        const trimmed = model?.trim();
        if (!trimmed || trimmed.toLowerCase() === 'auto') { 
            return undefined; 
        }

        const normalizedInput = trimmed.toLowerCase();
        if (SessionManager.isBlockedModelId(normalizedInput)) {
            return undefined;
        }

        return trimmed;
    }

    private getPinnedModel(): string | undefined {
        // Only return a pinned model if it's explicitly set and NOT blocked
        if (this._currentModel === 'auto' || SessionManager.isBlockedModelId(this._currentModel)) {
            return undefined;
        }
        return this._currentModel;
    }

    private isModelUnavailableError(err: unknown): boolean {
        let message = '';
        if (typeof err === 'string') {
            message = err;
        } else if (err && typeof err === 'object') {
            message = (err as { message?: string }).message || String(err);
        }
        
        return /Model\s+"[^"]+"\s+is not available/i.test(message) ||
               /The requested model is not supported/i.test(message) ||
               /400.*model/i.test(message);
    }

    private isMissingAuthContextError(err: unknown): boolean {
        const message = (err as { message?: string })?.message ?? '';
        return /Session was not created with authentication info or custom provider/i.test(message)
            || /Session was not created with authentication info/i.test(message);
    }

    private async getGitHubAccessToken(interactive: boolean): Promise<string | undefined> {
        try {
            const authSession = await vscode.authentication.getSession(
                'github',
                ['read:user'],
                { createIfNone: interactive },
            );
            return authSession?.accessToken;
        } catch {
            return undefined;
        }
    }

    private async rebuildClientWithInteractiveAuth(): Promise<boolean> {
        const token = await this.getGitHubAccessToken(true);
        if (!token) {
            return false;
        }

        this.githubToken = token;
        await this.stopClient();
        await this.startClient();
        return true;
    }

    private buildSessionConfig(workDir: string | undefined): SessionConfig {
        const config: SessionConfig = {
            streaming: true,
            workingDirectory: workDir,
            onPermissionRequest: (req) => this.handlePermissionRequest(req),
            onUserInputRequest: (req) => this.handleUserInputRequest(req),
            systemMessage: this.buildSystemMessage(),
            infiniteSessions: { enabled: true },
        };

        const pinnedModel = this.getPinnedModel();
        if (pinnedModel) {
            config.model = pinnedModel;
        }

        return config;
    }

    // ── Client lifecycle ────────────────────────────────────────────

    async startClient(): Promise<void> {
        if (this.client) { return; }

        const cliPath = findCopilotCliPath(this.context.extensionPath);
        if (!cliPath) {
            throw new Error(
                'Could not find Copilot CLI. Make sure @github/copilot is installed or GitHub Copilot extension is active.'
            );
        }

        console.log(`[PocketPilot] Using Copilot CLI at: ${cliPath}`);

        // Try VS Code GitHub auth first so sessions always have explicit auth info.
        if (!this.githubToken) {
            this.githubToken = await this.getGitHubAccessToken(false);
        }

        this.client = new CopilotClient({
            cliPath,
            autoStart: true,
            ...(this.githubToken
                ? { githubToken: this.githubToken, useLoggedInUser: false }
                : { useLoggedInUser: true }),
        });

        await this.client.start();
        this.emit('cli_status', 'running');
    }

    async stopClient(): Promise<void> {
        await this.destroySession();
        if (this.client) {
            await this.client.stop().catch(() => this.client?.forceStop());
            this.client = null;
        }
    }

    // ── Session lifecycle ───────────────────────────────────────────

    private async ensureSession(): Promise<CopilotSession> {
        if (this.session) { return this.session; }

        if (!this.client) {
            await this.startClient();
        }

        const workDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const config = this.buildSessionConfig(workDir);

        // Try to resume the last session for this workspace
        const lastSessionId = this.context.globalState.get<string>('pocketpilot.sessionId');
        if (lastSessionId) {
            try {
                const session = await this.client!.resumeSession(lastSessionId, config);
                this.wireSessionEvents(session);
                this.session = session;
                this._hasHistory = true;
                return session;
            } catch (err) {
                if (this.isModelUnavailableError(err)) {
                    // Model baked into the session is no longer available.
                    // Reset to auto regardless of whether we explicitly pinned it.
                    this._currentModel = 'auto';
                    this.savePreferences();
                    this.emit('model_switched', 'auto');

                    try {
                        const fallbackSession = await this.client!.resumeSession(
                            lastSessionId,
                            this.buildSessionConfig(workDir),
                        );
                        this.wireSessionEvents(fallbackSession);
                        this.session = fallbackSession;
                        this._hasHistory = true;
                        return fallbackSession;
                    } catch {
                        await this.context.globalState.update('pocketpilot.sessionId', undefined);
                    }
                } else {
                    // Session no longer exists or can't be resumed — create fresh
                    await this.context.globalState.update('pocketpilot.sessionId', undefined);
                }
            }
        }

        let session: CopilotSession;
        try {
            session = await this.client!.createSession(config);
        } catch (err) {
            if (this.isModelUnavailableError(err)) {
                this._currentModel = 'auto';
                this.savePreferences();
                this.emit('model_switched', 'auto');
                session = await this.client!.createSession(this.buildSessionConfig(workDir));
            } else {
                throw err;
            }
        }

        this.wireSessionEvents(session);
        this.session = session;

        // Persist session ID for resume across restarts
        await this.context.globalState.update('pocketpilot.sessionId', session.sessionId);

        return session;
    }

    private buildSystemMessage(): SessionConfig['systemMessage'] {
        return {
            mode: 'customize' as const,
            sections: {
                custom_instructions: {
                    action: (content: string) => {
                        return content + '\n\n' + SessionManager.MODE_INSTRUCTIONS[this._currentMode];
                    },
                },
            },
        };
    }

    private wireSessionEvents(session: CopilotSession): void {
        // Unsubscribe any previous event handlers
        for (const unsub of this.eventUnsubs) { unsub(); }
        this.eventUnsubs = [];

        // Streaming chunks → phone
        this.eventUnsubs.push(session.on('assistant.message_delta', (event) => {
            this.emit('chunk', event.data.deltaContent);
        }));

        // Reasoning / thinking deltas → phone (like Claude's thinking UI)
        this.eventUnsubs.push(session.on('assistant.reasoning_delta' as any, (event: any) => {
            const content = event?.data?.deltaContent;
            if (content) {
                // Wrap reasoning in a blockquote so it renders as a "thinking" block
                this.emit('chunk', content);
            }
        }));

        // Session idle → response complete
        this.eventUnsubs.push(session.on('session.idle', () => {
            if (this.isBusy) {
                this.isBusy = false;
                this.emit('activity', ''); // Clear activity status
                this.emit('done');

                // In plan mode, offer action buttons
                if (this._currentMode === 'plan') {
                    this.emit('action_required', [
                        { id: 'start_implementation', label: 'Start Implementation', style: 'primary' },
                        { id: 'revise_plan', label: 'Revise Plan', style: 'secondary' },
                         { id: 'cancel', label: 'Cancel', style: 'danger' },
                    ]);
                }
            }
        }));

        // Session errors
        this.eventUnsubs.push(session.on('session.error', (event) => {
            const message = event.data.message ?? '';

            // Model-unavailable errors are auto-recovered by sendPrompt() retry logic.
            // Don't forward them to the phone — just reset and let the retry handle it.
            if (this.isModelUnavailableError({ message })) {
                // Return gracefully. The sendPrompt catch block will handle the fallback logic.
                return;
            }

            // Auth errors: surface a clear message and let sendPrompt's retry logic
            // attempt interactive re-auth. Suppress SESSION_ERROR here so the phone
            // doesn't show two separate error bubbles (SESSION_ERROR + REQUEST_FAILED).
            if (this.isMissingAuthContextError({ message })) {
                this.isBusy = false;
                this.emit('error', 'AUTH_REQUIRED',
                    'GitHub authentication is required. Sign in to GitHub in VS Code and retry.');
                return;
            }

            this.isBusy = false;
            this.emit('activity', '');
            this.emit('error', 'SESSION_ERROR', message);
        }));

        // Tool execution start → emit inline progress AND activity status
        this.eventUnsubs.push(session.on('tool.execution_start', (event) => {
            const toolName = event.data.toolName || 'tool';

            // Format a human-readable activity label
            const label = this.formatToolLabel(toolName);
            this.emit('activity', label);
            this.emit('notification', 'Tool Running', `Running: ${toolName}`);

            // Emit inline thinking chunk so the user sees what's happening in the chat
            this.emit('chunk', `\n\n> 🔧 **${label}**\n\n`);
        }));

        // Tool execution complete → update inline progress
        this.eventUnsubs.push(session.on('tool.execution_complete' as any, (event: any) => {
            const toolName = event?.data?.toolName || 'tool';
            const label = this.formatToolLabel(toolName);
            this.emit('activity', `✓ ${label}`);
        }));

        // Model changed by the session itself
        this.eventUnsubs.push(session.on('session.model_change', (event) => {
            this._currentModel = event.data.newModel;
            this.savePreferences();
            this.emit('model_switched', event.data.newModel);
        }));
    }

    /** Convert a raw tool name like 'edit_file' to a readable label like 'Editing file' */
    private formatToolLabel(toolName: string): string {
        const labels: Record<string, string> = {
            'read_file': 'Reading file',
            'edit_file': 'Editing file',
            'write_file': 'Writing file',
            'list_directory': 'Listing directory',
            'search_files': 'Searching files',
            'run_command': 'Running command',
            'grep_search': 'Searching code',
            'file_search': 'Searching files',
            'execute_command': 'Running command',
            'create_file': 'Creating file',
            'delete_file': 'Deleting file',
            'view': 'Reading file',
            'bash': 'Running command',
        };
        return labels[toolName] || toolName.replace(/_/g, ' ');
    }

    private async destroySession(): Promise<void> {
        for (const unsub of this.eventUnsubs) { unsub(); }
        this.eventUnsubs = [];

        // Flush pending permission queue to prevent leaked Promises
        for (const queued of this.pendingPermissionQueue) {
            queued.resolve({ kind: 'denied-interactively-by-user' });
        }
        this.pendingPermissionQueue = [];

        if (this.session) {
            await this.session.disconnect().catch(() => { /* best effort */ });
            this.session = null;
        }
    }

    // ── Core: send a prompt ─────────────────────────────────────────

    async sendPrompt(
        content: string,
        mode?: 'ask' | 'agent' | 'plan',
        model?: string,
        attachments?: Array<{ name: string; mimeType: string; data: string }>,
    ): Promise<void> {
        if (mode && mode !== this._currentMode) {
            this._currentMode = mode;
            this.savePreferences();
        }

        let perPromptModel = this.normalizeModelSelection(model);

        this.isBusy = true;
        this._hasHistory = true;

        const previousModel = this._currentModel;

        // Save image attachments to workspace temp dir so Copilot can read them
        const sdkAttachments: Array<{ type: 'file'; path: string; displayName?: string }> = [];
        if (attachments && attachments.length > 0) {
            const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsFolder) {
                const uploadDir = join(wsFolder, '.pocketpilot', 'uploads');
                if (!existsSync(uploadDir)) {
                    mkdirSync(uploadDir, { recursive: true });
                }
                for (const att of attachments) {
                    try {
                        const ext = att.name.split('.').pop() || 'jpg';
                        const fileName = `upload-${Date.now()}.${ext}`;
                        const filePath = join(uploadDir, fileName);
                        writeFileSync(filePath, Buffer.from(att.data, 'base64'));
                        sdkAttachments.push({ type: 'file', path: filePath, displayName: att.name });
                    } catch (e) {
                        // Skip failed attachments silently
                    }
                }
            }
        }

        try {
            let retriedAfterAuth = false;
            let retriedAfterModel = false;

            while (true) {
                try {
                    const session = await this.ensureSession();

                    // Optional per-prompt override without permanently pinning model.
                    if (perPromptModel) {
                        try {
                            await session.setModel(perPromptModel);
                            this.emit('model_switched', perPromptModel);
                        } catch (err: any) {
                            // If the model set fails immediately here, it's caught and handled gracefully in catch
                            throw err;
                        }
                    }

                    const msgOptions: any = { prompt: content };
                    if (sdkAttachments.length > 0) {
                        msgOptions.attachments = sdkAttachments;
                    }

                    await session.sendAndWait(msgOptions, 600_000);
                    break;
                } catch (err: any) {
                    const msg = err?.message ?? '';

                    if (!retriedAfterAuth && this.isMissingAuthContextError(err)) {
                        retriedAfterAuth = true;
                        const reauthed = await this.rebuildClientWithInteractiveAuth();
                        if (reauthed) {
                            continue;
                        }

                        this.emit(
                            'error',
                            'AUTH_REQUIRED',
                            'GitHub authentication is required. Sign in to GitHub in VS Code and retry.',
                        );
                        break;
                    }

                    // If model is unavailable, try a smart fallback and retry once
                    if (!retriedAfterModel && this.isModelUnavailableError(err)) {
                        retriedAfterModel = true;
                        
                        const wasAutoRequested = (!perPromptModel || perPromptModel === 'auto') && this._currentModel === 'auto';
                        const failedModel = perPromptModel || this._currentModel;

                        // Query the SDK for available models dynamically
                        let allAvailable: string[] = [];
                        try {
                            const modelInfos = await this.client!.listModels();
                            allAvailable = modelInfos
                                .filter((m) => !SessionManager.isBlockedModelId(m.id))
                                .filter((m) => !m.policy || m.policy.state !== 'disabled')
                                .map(m => m.id);
                        } catch { /* SDK call failed — will fall back to auto */ }

                        // Smart fallback logic:
                        // 1. If a Gemini model failed, try the other Gemini variant
                        // 2. Otherwise, pick any available model that's not blocked
                        // 3. Fall back to 'auto' if nothing else works
                        let fallbackModel: string | undefined;

                        if (failedModel && failedModel.toLowerCase().includes('gemini')) {
                            const geminiModels = allAvailable.filter(m => m.toLowerCase().includes('gemini'));
                            fallbackModel = geminiModels.find(m => m !== failedModel);
                        }

                        if (!fallbackModel) {
                            const safeFallbacks = ['gpt-4o', 'gpt-4', 'gpt-5-mini'];
                            fallbackModel = safeFallbacks.find(safeId => allAvailable.includes(safeId));
                            
                            if (!fallbackModel) {
                                fallbackModel = allAvailable.find((candidate) => 
                                    candidate.toLowerCase() !== 'auto' && candidate !== failedModel
                                );
                            }
                        }

                        // Last resort: use 'auto'
                        this._currentModel = fallbackModel ?? 'auto';
                        perPromptModel = undefined; // Force cleared
                        this.savePreferences();
                        this.emit('model_switched', this._currentModel);

                        // Only notify the UI visually if the user explicitly asked for a specific model that failed
                        if (!wasAutoRequested) {
                            const fallbackLabel = this._currentModel === 'auto' ? 'Auto' : this._currentModel;
                            this.emit('chunk', `\n\n> ⚠️ **Info:** The requested model is not supported by your account (Error 400). Automatically switching to **${fallbackLabel}**.\n\n`);
                        }

                        await this.destroySession();
                        await this.context.globalState.update('pocketpilot.sessionId', undefined);
                        continue;
                    }

                    // sendAndWait throws on timeout or abort — only emit if unexpected
                    if (!msg.includes('abort') && !msg.includes('cancel')) {
                        this.emit('error', 'REQUEST_FAILED',
                            msg || 'Failed to get response from model');
                    }
                    break;
                }
            }
        } finally {
            this.isBusy = false;

            // Restore model after per-prompt override so it doesn't stick
            if (perPromptModel && this.session) {
                try {
                    if (previousModel === 'auto') {
                        // SDK doesn't have a literal 'auto' model — just reset our tracking
                        this._currentModel = 'auto';
                    } else {
                        await this.session.setModel(previousModel);
                        this._currentModel = previousModel;
                    }
                    this.emit('model_switched', this._currentModel);
                } catch { /* best effort restore */ }
            }
        }
    }

    // ── Cancel ──────────────────────────────────────────────────────

    async cancelCurrentTask(): Promise<void> {
        if (this.session) {
            await this.session.abort().catch(() => { /* best effort */ });
        }
    }

    // ── Mode switching ──────────────────────────────────────────────

    switchMode(mode: 'ask' | 'agent' | 'plan'): void {
        this._currentMode = mode;
        this.savePreferences();
        this.emit('mode_switched', mode);
    }

    // ── Model switching ─────────────────────────────────────────────

    async switchModel(newModel: string): Promise<void> {
        const rawModel = newModel?.trim() ?? '';
        const normalized = this.normalizeModelSelection(rawModel);

        if (rawModel && rawModel.toLowerCase().includes('sonnet')) {
            this._currentModel = 'auto';
            this.savePreferences();
            this.emit('model_switched', 'auto');
            this.emit('error', 'MODEL_NOT_AVAILABLE', 'Model "claude-sonnet-4.5" has been removed from PocketPilot');
            return;
        }

        if (!normalized || normalized === 'auto') {
            this._currentModel = 'auto';
            this.savePreferences();
            this.emit('model_switched', 'auto');
            return;
        }

        try {
            if (this.session) {
                await this.session.setModel(normalized);
            }
            this._currentModel = normalized;
            this.savePreferences();
            this.emit('model_switched', normalized);
        } catch (err: any) {
            this.emit('error', 'MODEL_NOT_AVAILABLE',
                err?.message ?? `Model "${normalized}" is not available`);
        }
    }

    // ── History management ──────────────────────────────────────────

    async clearHistory(): Promise<void> {
        const oldId = this.session?.sessionId;
        await this.destroySession();

        // Delete the old session data from disk
        if (oldId && this.client) {
            await this.client.deleteSession(oldId).catch(() => { /* best effort */ });
        }

        await this.context.globalState.update('pocketpilot.sessionId', undefined);
        this._hasHistory = false;
        this.sessionApprovals.clear();
        this.allowAllSession = false;
    }

    // ── Permission handling (SDK → phone → SDK) ─────────────────────

    private async handlePermissionRequest(
        request: PermissionRequest,
    ): Promise<PermissionRequestResult> {
        // Auto-approve if user selected "allow all" this session
        if (this.allowAllSession) {
            return { kind: 'approved' };
        }

        // Auto-approve if this specific kind was already approved this session
        if (this.sessionApprovals.get(request.kind)) {
            return { kind: 'approved' };
        }

        // In agent mode, auto-approve read-only operations so tools don't pile up.
        // The user explicitly chose agent mode to let the AI work autonomously.
        // Only truly destructive operations (write, shell) still prompt.
        const readOnlyKinds = new Set(['read', 'mcp', 'url']);
        if (this._currentMode === 'agent' && readOnlyKinds.has(request.kind)) {
            return { kind: 'approved' };
        }

        // Build a human-readable description of the request
        const description = this.describePermission(request);
        const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Forward to phone and wait for response — queue-based so concurrent
        // requests don't clobber each other.
        return new Promise<PermissionRequestResult>((resolve) => {
            this.pendingPermissionQueue.push({ id: requestId, resolve, kind: request.kind });

            // Only emit to the phone if this is the first item in the queue
            // (i.e. no modal is currently showing). Otherwise the phone will
            // be prompted when the current one is resolved.
            if (this.pendingPermissionQueue.length === 1) {
                this.emit('permission_request', requestId, request.kind, description);
            }
        });
    }

    private describePermission(request: PermissionRequest): string {
        const r = request as any;

        // Helper: extract the best file identifier from the request
        const getFile = (): string => {
            // The SDK uses different field names depending on the version
            const raw = r.filePath || r.fileName || r.path || r.file || r.uri || '';
            if (!raw) { return 'unknown file'; }
            // Show just the basename for readability, full path in parentheses
            const parts = String(raw).split('/');
            const base = parts[parts.length - 1];
            return parts.length > 1 ? `${base} (${raw})` : base;
        };

        switch (request.kind) {
            case 'shell':
                return `Run command: ${r.fullCommandText || r.command || r.commandLine || 'shell command'}`;
            case 'write':
                return `Write file: ${getFile()}`;
            case 'read':
                return `Read file: ${getFile()}`;
            case 'mcp':
                return `MCP tool: ${r.toolName || r.name || 'unknown tool'}`;
            case 'url':
                return `Fetch URL: ${r.url || 'unknown URL'}`;
            case 'custom-tool':
                return `Custom tool: ${r.toolName || r.name || 'unknown tool'}`;
            default:
                return `Permission: ${request.kind}`;
        }
    }

    resolvePermission(_id: string, decision: string): void {
        if (this.pendingPermissionQueue.length === 0) { return; }

        // Dequeue the first (currently visible) permission request
        const current = this.pendingPermissionQueue.shift()!;

        let result: PermissionRequestResult;
        if (decision === 'allow' || decision === 'allow_session' || decision === 'allow_all') {
            result = { kind: 'approved' };

            // Remember the approval scope
            if (decision === 'allow_session' && current.kind) {
                this.sessionApprovals.set(current.kind, true);
            }
            if (decision === 'allow_all') {
                this.allowAllSession = true;

                // Auto-resolve everything else in the queue
                for (const queued of this.pendingPermissionQueue) {
                    queued.resolve({ kind: 'approved' });
                }
                this.pendingPermissionQueue = [];
            }
        } else {
            result = { kind: 'denied-interactively-by-user' };
        }

        current.resolve(result);

        // If there are more requests queued and we didn't just "allow all",
        // auto-approve requests whose kind is now remembered, then emit the
        // next one that still needs manual approval.
        while (this.pendingPermissionQueue.length > 0) {
            const next = this.pendingPermissionQueue[0];
            if (this.allowAllSession || (next.kind && this.sessionApprovals.get(next.kind))) {
                this.pendingPermissionQueue.shift()!;
                next.resolve({ kind: 'approved' });
            } else {
                // Emit the next request to the phone
                const desc = `Permission: ${next.kind ?? 'unknown'}`;
                this.emit('permission_request', next.id, next.kind ?? 'unknown', desc);
                break;
            }
        }
    }

    // ── User input handling (SDK → phone → SDK) ─────────────────────

    private async handleUserInputRequest(
        request: { question: string; choices?: string[] },
    ): Promise<{ answer: string; wasFreeform: boolean }> {
        return new Promise<{ answer: string; wasFreeform: boolean }>((resolve) => {
            this.pendingUserInput = { resolve };
            this.emit('user_input_request', request.question, request.choices);
        });
    }

    resolveUserInput(answer: string): void {
        // Plan revision flow
        if (this.waitingForRevision) {
            this.waitingForRevision = false;
            this.sendPrompt(`Please revise the plan based on this feedback: ${answer}`, 'plan');
            return;
        }

        if (this.pendingUserInput) {
            this.pendingUserInput.resolve({ answer, wasFreeform: true });
            this.pendingUserInput = null;
        }
    }

    resetSessionPermissions(): void {
        this.sessionApprovals.clear();
        this.allowAllSession = false;
        // Deny any outstanding permission requests so their Promises don't leak
        for (const queued of this.pendingPermissionQueue) {
            queued.resolve({ kind: 'denied-interactively-by-user' });
        }
        this.pendingPermissionQueue = [];
    }

    // ── Action buttons (plan mode) ──────────────────────────────────

    async handleAction(action: string): Promise<void> {
        switch (action) {
            case 'start_implementation':
                this.switchMode('agent');
                await this.sendPrompt(
                    'Please implement the plan above step by step.'
                );
                break;

            case 'revise_plan':
                this.waitingForRevision = true;
                this.emit('user_input_request',
                    'What would you like to change in the plan?');
                break;

            case 'cancel':
                break;

            default:
                break;
        }
    }

    // ── Workspace info ──────────────────────────────────────────────

    async getWorkspaceInfo(): Promise<{
        project: string; branch: string; files: string[];
    }> {
        const folder = vscode.workspace.workspaceFolders?.[0];
        const project = folder?.name ?? 'unknown';

        let branch = '';
        if (folder) {
            try {
                branch = execSync('git branch --show-current', {
                    cwd: folder.uri.fsPath,
                    encoding: 'utf8',
                    timeout: 3000,
                }).trim();
            } catch { /* not a git repo or git not installed */ }
        }

        let files: string[] = [];
        try {
            const uris = await vscode.workspace.findFiles(
                '**/*', '**/node_modules/**', 500
            );
            files = uris.map(u => vscode.workspace.asRelativePath(u));
        } catch { /* ignore */ }

        return { project, branch, files };
    }

    // ── Copilot SDK availability ────────────────────────────────────

    async checkCopilotAvailable(): Promise<boolean> {
        try {
            if (!this.client) { await this.startClient(); }
            const response = await this.client!.ping();
            return !!response;
        } catch {
            return false;
        }
    }

    async getAvailableModels(): Promise<string[]> {
        try {
            if (!this.client) { await this.startClient(); }
            const models: ModelInfo[] = await this.client!.listModels();
            return models.map(m => m.id);
        } catch {
            return [];
        }
    }

    /**
     * Known Copilot models — used as a supplement when the SDK's listModels()
     * doesn't return the full set (which it often doesn't).
     * Models the user doesn't have access to will fail gracefully at use time.
     */
    private static readonly KNOWN_COPILOT_MODELS: Array<{ id: string; displayName: string }> = [
        { id: 'claude-haiku-4.5',   displayName: 'Claude Haiku 4.5'         },
        { id: 'gemini-2.5-pro',     displayName: 'Gemini 2.5 Pro'           },
        { id: 'gpt-4.1',            displayName: 'GPT-4.1'                  },
        { id: 'gpt-4o',             displayName: 'GPT-4o'                   },
        { id: 'gpt-5-mini',         displayName: 'GPT-5 mini'               },
        { id: 'raptor-mini',        displayName: 'Raptor mini (Preview)'    },
    ];

    /** Emit all available Copilot models for the phone, dynamically from the SDK. */
    async emitAvailableModels(): Promise<void> {
        let sdkModels: Array<{ id: string; displayName: string; vendor: string }> = [];

        try {
            if (!this.client) {
                await this.startClient();
            }
            const modelInfos = await this.client!.listModels();

            console.log(`[PocketPilot] listModels() returned ${modelInfos.length} models: ${modelInfos.map(m => m.id).join(', ')}`);

            sdkModels = modelInfos
                .filter((m) => !SessionManager.isBlockedModelId(m.id))
                .map((m) => ({
                    id: m.id,
                    displayName: m.name || m.id,
                    vendor: '',
                }));
        } catch (err) {
            console.log(`[PocketPilot] listModels() failed: ${(err as Error)?.message}`);
        }

        // Merge: start with SDK models, then add known models the SDK missed
        const seenIds = new Set(sdkModels.map(m => m.id.toLowerCase()));
        const supplemented = [...sdkModels];

        for (const known of SessionManager.KNOWN_COPILOT_MODELS) {
            if (!seenIds.has(known.id.toLowerCase()) && !SessionManager.isBlockedModelId(known.id)) {
                supplemented.push({ id: known.id, displayName: known.displayName, vendor: '' });
                seenIds.add(known.id.toLowerCase());
            }
        }

        console.log(`[PocketPilot] Emitting ${supplemented.length} models to phone: ${supplemented.map(m => m.id).join(', ')}`);
        this.emit('models_available', supplemented);
    }

    // ── Persistence helpers ─────────────────────────────────────────

    private savePreferences(): void {
        this.context.globalState.update('pocketpilot.model', this._currentModel);
        this.context.globalState.update('pocketpilot.mode', this._currentMode);
    }
}
