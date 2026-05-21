import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { WebSocketManager } from './WebSocketManager';
import { StatusBarManager } from './StatusBarManager';
import { TunnelManager } from './TunnelManager';
import { QRCodePanel } from './QRCodePanel';
import { SessionManager } from './SessionManager';
import type { IncomingMessage, ActionButton } from './types';

const WS_PORT = 3000;

let wsManager: WebSocketManager | null = null;
let statusBar: StatusBarManager | null = null;
let tunnelManager: TunnelManager | null = null;
let qrPanel: QRCodePanel | null = null;
let session: SessionManager | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let outputChannelRevealed = false;

export async function activate(context: vscode.ExtensionContext) {

	// ── Auth token (generate once, persist forever) ─────────────────
	let authToken = context.globalState.get<string>('pocketpilot.authToken');
	if (!authToken) {
		authToken = randomUUID();
		await context.globalState.update('pocketpilot.authToken', authToken);
	}

	// ── Managers ────────────────────────────────────────────────────
	outputChannel = vscode.window.createOutputChannel('PocketPilot');
	statusBar = new StatusBarManager();
	statusBar.show();

	tunnelManager = new TunnelManager(context.extensionPath);
	qrPanel = new QRCodePanel();
	wsManager = new WebSocketManager(authToken);
	session = new SessionManager(context);

	// Start the Copilot SDK client in the background
	session.startClient().catch((err) => {
		vscode.window.showWarningMessage(
			`PocketPilot: Could not start Copilot CLI — ${err.message ?? 'unknown error'}. Make sure GitHub Copilot CLI is installed.`
		);
	});

	// ── Wire session events → WebSocket + OutputChannel ────────────
	session.on('chunk', (content: string) => {
		wsManager?.send({ type: 'chunk', content });
		outputChannel?.append(content);
	});

	session.on('done', () => {
		wsManager?.send({ type: 'done' });
		outputChannel?.appendLine('\n');
		// Restore to the correct idle state
		if (wsManager?.isConnected) {
			statusBar?.setConnected();
		} else if (tunnelManager?.isRunning) {
			statusBar?.setTunnelReady();
		} else {
			statusBar?.setWaiting();
		}
	});

	session.on('error', (code: string, message: string) => {
		wsManager?.send({ type: 'error', code, message });
		outputChannel?.appendLine(`[Error] ${code}: ${message}`);
		// Brief error flash, then restore correct idle state
		statusBar?.setError('error');
		setTimeout(() => {
			if (wsManager?.isConnected) {
				statusBar?.setConnected();
			} else if (tunnelManager?.isRunning) {
				statusBar?.setTunnelReady();
			} else {
				statusBar?.setWaiting();
			}
		}, 3000);
	});

	session.on('model_switched', (model: string) => {
		wsManager?.send({ type: 'model_switched', model });
		outputChannel?.appendLine(`[Model] Switched to: ${model}`);
	});

	session.on('mode_switched', (mode: string) => {
		wsManager?.send({ type: 'mode_switched', mode });
		outputChannel?.appendLine(`[Mode] Switched to: ${mode}`);
	});

	session.on('action_required', (actions: ActionButton[]) => {
		wsManager?.send({ type: 'action_required', actions });
	});

	session.on('permission_request', (id: string, kind: string, command: string) => {
		wsManager?.send({ type: 'permission_request', id, kind, command });
	});

	session.on('user_input_request', (question: string, choices?: string[]) => {
		wsManager?.send({ type: 'user_input_request', question, choices });
	});

	session.on('cli_status', (status: string) => {
		wsManager?.send({ type: 'cli_status', status: status as 'running' | 'crashed' | 'reconnecting' });
	});

	session.on('notification', (title: string, body: string) => {
		wsManager?.send({ type: 'notification', title, body });
		outputChannel?.appendLine(`[${title}] ${body}`);
	});

	session.on('activity', (label: string) => {
		wsManager?.send({ type: 'activity', label });
	});

	session.on('models_available', (models: Array<{ id: string; displayName: string; vendor: string }>) => {
		wsManager?.send({ type: 'models_available', models });
	});

	// ── WebSocket events ────────────────────────────────────────────
	wsManager.on('connected', async () => {
		statusBar?.setConnected();
		vscode.window.showInformationMessage('PocketPilot: Phone connected!');

		// Always send the connected message first, even if workspace info lookup fails.
		// Without this, the phone stays stuck at "authenticating" / "Disconnected".
		let info = { project: 'Unknown', branch: 'main' };
		try {
			info = await session!.getWorkspaceInfo();
		} catch { /* workspace info is best-effort */ }

		wsManager?.send({
			type: 'connected',
			project: info.project,
			branch: info.branch,
			model: session!.currentModel,
			mode: session!.currentMode,
			hasHistory: session!.hasHistory,
		});

		// Send available models so the phone only shows what the user has access to
		session!.emitAvailableModels().catch(() => { /* best effort */ });
	});

	wsManager.on('disconnected', () => {
		if (tunnelManager?.isRunning) {
			statusBar?.setTunnelReady();
		} else {
			statusBar?.setWaiting();
		}
		session?.resetSessionPermissions();
		session?.cancelCurrentTask().catch(() => { });
		vscode.window.showInformationMessage('PocketPilot: Phone disconnected');
	});

	wsManager.on('message', (msg: IncomingMessage) => {
		handleIncomingMessage(msg);
	});

	// ── Start WebSocket server ──────────────────────────────────────
	const startServer = vscode.commands.registerCommand('pocketpilot.startServer', async () => {
		if (wsManager?.isConnected) {
			vscode.window.showWarningMessage('PocketPilot server already running');
			return;
		}
		try {
			await wsManager!.start(WS_PORT);
			statusBar?.setWaiting();
			vscode.window.showInformationMessage(`PocketPilot server ready on port ${WS_PORT}`);
		} catch (err: any) {
			statusBar?.setError('port busy');
			vscode.window.showErrorMessage(`PocketPilot: Failed to start — ${err.message}`);
		}
	});

	const stopServer = vscode.commands.registerCommand('pocketpilot.stopServer', () => {
		wsManager?.stop();
		tunnelManager?.stop();
		statusBar?.setWaiting();
		vscode.window.showInformationMessage('PocketPilot server stopped');
	});

	// ── Tunnel commands ─────────────────────────────────────────────
	const enableTunnel = vscode.commands.registerCommand('pocketpilot.enableTunnel', async () => {
		try {
			statusBar?.setBusy('Starting tunnel…');
			const url = await tunnelManager!.start(WS_PORT, (msg) => {
				statusBar?.setBusy(msg);
			});
			statusBar?.setTunnelReady();
			const via = tunnelManager!.provider ? ` via ${tunnelManager!.provider}` : '';
			vscode.window.showInformationMessage(`✅ PocketPilot tunnel ready${via}: ${url}`);
		} catch (err: any) {
			statusBar?.setError('tunnel failed');
			const action = await vscode.window.showErrorMessage(
				`PocketPilot tunnel error: ${err.message}`,
				'Retry',
				'Dismiss'
			);
			if (action === 'Retry') {
				vscode.commands.executeCommand('pocketpilot.enableTunnel');
			}
		}
	});

	const disableTunnel = vscode.commands.registerCommand('pocketpilot.disableTunnel', () => {
		tunnelManager?.stop();
		vscode.window.showInformationMessage('PocketPilot tunnel stopped');
	});

	// ── QR code ─────────────────────────────────────────────────────
	const showQR = vscode.commands.registerCommand('pocketpilot.showQRCode', async () => {
		await qrPanel!.show(context, {
			authToken: authToken!,
			port: WS_PORT,
			tunnelUrl: tunnelManager?.tunnelUrl ?? null,
		});
	});

	// ── Utility commands ────────────────────────────────────────────
	const copyToken = vscode.commands.registerCommand('pocketpilot.copyAuthToken', async () => {
		await vscode.env.clipboard.writeText(authToken!);
		vscode.window.showInformationMessage('PocketPilot: Auth token copied to clipboard');
	});

	const clearHistory = vscode.commands.registerCommand('pocketpilot.clearHistory', async () => {
		await session?.clearHistory();
		vscode.window.showInformationMessage('PocketPilot: Session history cleared');
	});

	// ── Chat participant (uses SessionManager for shared history) ────
	const participant = vscode.chat.createChatParticipant(
		'pocketpilot.assistant',
		async (request, _chatContext, stream, token) => {
			// Pipe session chunks into the VS Code chat stream
			const onChunk = (content: string) => stream.markdown(content);
			session!.on('chunk', onChunk);

			// Link VS Code's cancellation to the session
			const disposable = token.onCancellationRequested(() => {
				session!.cancelCurrentTask();
			});

			try {
				await session!.sendPrompt(request.prompt);
			} finally {
				session!.off('chunk', onChunk);
				disposable.dispose();
			}
		},
	);

	participant.iconPath = new vscode.ThemeIcon('rocket');

	// ── Register disposables ────────────────────────────────────────
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
		{ dispose: () => outputChannel?.dispose() },
	);

	// ── Auto-start the server ───────────────────────────────────────
	try {
		await wsManager.start(WS_PORT);
		statusBar.setWaiting();
	} catch {
		statusBar.setError('port busy');
	}
}

export async function deactivate() {
	await session?.stopClient().catch(() => { });
	wsManager?.stop();
	tunnelManager?.stop();
	statusBar?.dispose();
	qrPanel?.dispose();
	outputChannel?.dispose();
}

// ── Message handler ─────────────────────────────────────────────────

function handleIncomingMessage(msg: IncomingMessage): void {
	switch (msg.type) {
		case 'prompt':
			// Log prompt to OutputChannel and auto-reveal on first use
			outputChannel?.appendLine(`\n[Phone → Copilot] (${msg.mode}${msg.model ? ', model: ' + msg.model : ''})`);
			outputChannel?.appendLine(msg.content);
			outputChannel?.appendLine('---');
			if (!outputChannelRevealed) {
				outputChannelRevealed = true;
				outputChannel?.show(true); // true = preserve editor focus
			}
			statusBar?.setBusy('generating…');
			session?.sendPrompt(msg.content, msg.mode, msg.model, msg.attachments).catch((err) => {
				// Prevent unhandled promise rejection from crashing the extension host
				const message = err?.message ?? 'Unknown error sending prompt';
				outputChannel?.appendLine(`[Error] sendPrompt crashed: ${message}`);
				wsManager?.send({ type: 'error', code: 'REQUEST_FAILED', message });
				wsManager?.send({ type: 'done' });
				if (wsManager?.isConnected) {
					statusBar?.setConnected();
				} else {
					statusBar?.setWaiting();
				}
			});
			break;

		case 'switch_model':
			statusBar?.setBusy('switching model…');
			session?.switchModel(msg.model).catch((err) => {
				outputChannel?.appendLine(`[Error] switchModel: ${err?.message}`);
			}).finally(() => {
				// Always restore status bar after model switch
				if (wsManager?.isConnected) {
					statusBar?.setConnected();
				} else {
					statusBar?.setWaiting();
				}
			});
			break;

		case 'switch_mode':
			session?.switchMode(msg.mode);
			break;

		case 'permission':
			session?.resolvePermission(msg.id, msg.decision);
			break;

		case 'user_input':
			session?.resolveUserInput(msg.answer);
			break;

		case 'action':
			session?.handleAction(msg.action);
			break;

		case 'get_workspace_info':
			session?.getWorkspaceInfo().then(info => {
				wsManager?.send({ type: 'workspace_info', ...info });
			}).catch(() => {
				wsManager?.send({
					type: 'workspace_info',
					project: 'unknown', branch: '', files: [],
				});
			});
			break;

		case 'clear_history':
			session?.clearHistory().then(() => {
				wsManager?.send({
					type: 'notification',
					title: 'History Cleared',
					body: 'Conversation history has been cleared',
				});
			});
			break;

		case 'cancel_task':
			session?.cancelCurrentTask().catch(() => { });
			if (wsManager?.isConnected) {
				statusBar?.setConnected();
			} else if (tunnelManager?.isRunning) {
				statusBar?.setTunnelReady();
			} else {
				statusBar?.setWaiting();
			}
			// IMPORTANT: Send 'done' so the phone's isGenerating flag resets.
			// Without this, the phone UI stays stuck in "generating" state.
			wsManager?.send({ type: 'done' });
			wsManager?.send({ type: 'notification', title: 'Cancelled', body: 'Task cancelled' });
			break;

		default:
			break;
	}
}