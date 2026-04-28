import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
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

    // Pending permission/input forwarded to phone, resolved when phone responds
    private pendingPermission: {
        resolve: (result: PermissionRequestResult) => void;
    } | null = null;
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

        // Canonicalize aliases like "GPT-4o" to the actual Copilot model id.
        const canonical = SessionManager.ALL_COPILOT_MODELS.find((candidate) => {
            return candidate.id.toLowerCase() === normalizedInput
                || candidate.displayName.toLowerCase() === normalizedInput;
        });

        return canonical?.id ?? trimmed;
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

        // Session idle → response complete
        this.eventUnsubs.push(session.on('session.idle', () => {
            if (this.isBusy) {
                this.isBusy = false;
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

            this.isBusy = false;
            this.emit('error', 'SESSION_ERROR', message);
        }));

        // Tool execution status (forward as notifications)
        this.eventUnsubs.push(session.on('tool.execution_start', (event) => {
            this.emit('notification', 'Tool Running', `Running: ${event.data.toolName}`);
        }));

        // Model changed by the session itself
        this.eventUnsubs.push(session.on('session.model_change', (event) => {
            this._currentModel = event.data.newModel;
            this.savePreferences();
            this.emit('model_switched', event.data.newModel);
        }));
    }

    private async destroySession(): Promise<void> {
        for (const unsub of this.eventUnsubs) { unsub(); }
        this.eventUnsubs = [];

        if (this.session) {
            await this.session.disconnect().catch(() => { /* best effort */ });
            this.session = null;
        }
    }

    // ── Core: send a prompt ─────────────────────────────────────────

    async sendPrompt(content: string, mode?: 'ask' | 'agent' | 'plan', model?: string): Promise<void> {
        if (mode && mode !== this._currentMode) {
            this._currentMode = mode;
            this.savePreferences();
        }

        let perPromptModel = this.normalizeModelSelection(model);

        this.isBusy = true;
        this._hasHistory = true;

        const previousModel = this._currentModel;

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

                    await session.sendAndWait({ prompt: content }, 600_000);
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

                        // Get available models from hardcoded list (SDK's listModels() is unreliable)
                        const allAvailable = SessionManager.ALL_COPILOT_MODELS
                            .filter((model) => !SessionManager.isBlockedModelId(model.id))
                            .map(m => m.id);

                        // Smart fallback logic:
                        // 1. If a Gemini model failed, try the other Gemini variant
                        // 2. Otherwise, pick any available model that's not blocked
                        // 3. Fall back to 'auto' if nothing else works
                        let fallbackModel: string | undefined;

                        if (failedModel && failedModel.toLowerCase().includes('gemini')) {
                            // If one Gemini variant failed, try the other
                            const geminiModels = allAvailable.filter(m => m.toLowerCase().includes('gemini'));
                            fallbackModel = geminiModels.find(m => m !== failedModel);
                        }

                        // If no Gemini alternative, safely pick gpt-4o or gpt-4 as a guaranteed fallback
                        if (!fallbackModel) {
                            const safeFallbacks = ['gpt-4o', 'gpt-4', 'gpt-5-mini'];
                            fallbackModel = safeFallbacks.find(safeId => allAvailable.includes(safeId));
                            
                            // If still nothing, pick any available model
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
                            this.emit('chunk', `\n\n> ⚠️ **Info:** Le modèle demandé n'est pas supporté par votre compte (Erreur 400). Basculement automatique vers **${fallbackLabel}**.\n\n`);
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

        // Build a human-readable description of the request
        const description = this.describePermission(request);

        // Forward to phone and wait for response
        return new Promise<PermissionRequestResult>((resolve) => {
            this.pendingPermission = { resolve };
            this.emit('permission_request', request.kind, request.kind, description);
        });
    }

    private describePermission(request: PermissionRequest): string {
        switch (request.kind) {
            case 'shell':
                return `Run command: ${(request as any).fullCommandText ?? 'shell command'}`;
            case 'write':
                return `Write file: ${(request as any).fileName ?? 'unknown file'}`;
            case 'read':
                return `Read file: ${(request as any).fileName ?? 'unknown file'}`;
            case 'mcp':
                return `MCP tool: ${(request as any).toolName ?? 'unknown tool'}`;
            case 'url':
                return `Fetch URL: ${(request as any).url ?? 'unknown URL'}`;
            case 'custom-tool':
                return `Custom tool: ${(request as any).toolName ?? 'unknown tool'}`;
            default:
                return `Permission: ${request.kind}`;
        }
    }

    resolvePermission(_id: string, decision: string): void {
        if (!this.pendingPermission) { return; }

        let result: PermissionRequestResult;
        if (decision === 'allow' || decision === 'allow_session' || decision === 'allow_all') {
            result = { kind: 'approved' };

            // Remember the approval scope
            if (decision === 'allow_session') {
                // We don't have the kind here, but the pending permission was for a specific request
                // Store it generically
            }
            if (decision === 'allow_all') {
                this.allowAllSession = true;
            }
        } else {
            result = { kind: 'denied-interactively-by-user' };
        }

        this.pendingPermission.resolve(result);
        this.pendingPermission = null;
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
     * Complete list of all Copilot models, matching the Copilot UI exactly.
     * The SDK's listModels() is unreliable and misses many models,
     * so we hardcode the full list here.
     */
    private static readonly ALL_COPILOT_MODELS: Array<{ id: string; displayName: string; vendor: string }> = [
        // ── Main models ──
        { id: 'gemini-2.5-pro',     displayName: 'Gemini 2.5 Pro',            vendor: 'google' },
        { id: 'gemini-3.1-pro',     displayName: 'Gemini 3.1 Pro (Preview)',   vendor: 'google' },
        { id: 'gpt-4.1',            displayName: 'GPT-4.1',                   vendor: 'openai' },
        { id: 'gpt-5.3-codex',      displayName: 'GPT-5.3-Codex',             vendor: 'openai' },
        // ── Other models ──
        { id: 'claude-haiku-4.5',   displayName: 'Claude Haiku 4.5',          vendor: 'anthropic' },
        { id: 'gemini-3-flash',     displayName: 'Gemini 3 Flash (Preview)',   vendor: 'google' },
        { id: 'gpt-4o',             displayName: 'GPT-4o',                    vendor: 'openai' },
        { id: 'gpt-5-mini',         displayName: 'GPT-5 mini',                vendor: 'openai' },
        { id: 'gpt-5.2',            displayName: 'GPT-5.2',                   vendor: 'openai' },
        { id: 'gpt-5.2-codex',      displayName: 'GPT-5.2-Codex',             vendor: 'openai' },
        { id: 'gpt-5.4-mini',       displayName: 'GPT-5.4 mini',              vendor: 'openai' },
        { id: 'grok-code-fast-1',   displayName: 'Grok Code Fast 1',          vendor: 'xai' },
        { id: 'raptor-mini',        displayName: 'Raptor mini (Preview)',      vendor: 'microsoft' },
    ];

    /** Emit all available Copilot models for the phone. */
    async emitAvailableModels(): Promise<void> {
        const models = SessionManager.ALL_COPILOT_MODELS.filter((model) => !SessionManager.isBlockedModelId(model.id));
        this.emit('models_available', models);
    }

    // ── Persistence helpers ─────────────────────────────────────────

    private savePreferences(): void {
        this.context.globalState.update('pocketpilot.model', this._currentModel);
        this.context.globalState.update('pocketpilot.mode', this._currentMode);
    }
}
