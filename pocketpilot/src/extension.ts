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

	tunnelManager = new TunnelManager();
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
		statusBar?.setConnected();
	});

	session.on('error', (code: string, message: string) => {
		wsManager?.send({ type: 'error', code, message });
		outputChannel?.appendLine(`[Error] ${code}: ${message}`);
		statusBar?.setError('error');
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

	// ── WebSocket events ────────────────────────────────────────────
	wsManager.on('connected', async () => {
		statusBar?.setConnected();
		vscode.window.showInformationMessage('PocketPilot: Phone connected!');

		// Send initial state to the phone
		try {
			const info = await session!.getWorkspaceInfo();
			wsManager?.send({
				type: 'connected',
				project: info.project,
				branch: info.branch,
				model: session!.currentModel,
				mode: session!.currentMode,
				hasHistory: session!.hasHistory,
			});
		} catch { /* workspace info is best-effort */ }
	});

	wsManager.on('disconnected', () => {
		statusBar?.setWaiting();
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
		const installed = await tunnelManager!.checkInstalled();
		if (!installed) {
			vscode.window.showErrorMessage(
				'PocketPilot: cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
			);
			return;
		}
		try {
			statusBar?.setBusy('starting tunnel…');
			const url = await tunnelManager!.start(WS_PORT);
			statusBar?.setConnected();
			vscode.window.showInformationMessage(`PocketPilot tunnel: ${url}`);
		} catch (err: any) {
			statusBar?.setError('tunnel failed');
			vscode.window.showErrorMessage(`PocketPilot tunnel error: ${err.message}`);
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
			session?.sendPrompt(msg.content, msg.mode, msg.model);
			break;

		case 'switch_model':
			statusBar?.setBusy('switching model…');
			session?.switchModel(msg.model);
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
			statusBar?.setConnected();
			wsManager?.send({ type: 'notification', title: 'Cancelled', body: 'Task cancelled' });
			break;

		default:
			break;
	}
}