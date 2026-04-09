import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { WebSocketManager } from './WebSocketManager';
import { StatusBarManager } from './StatusBarManager';
import { TunnelManager } from './TunnelManager';
import { QRCodePanel } from './QRCodePanel';
import type { IncomingMessage } from './types';

const WS_PORT = 3000;

let wsManager: WebSocketManager | null = null;
let statusBar: StatusBarManager | null = null;
let tunnelManager: TunnelManager | null = null;
let qrPanel: QRCodePanel | null = null;

export async function activate(context: vscode.ExtensionContext) {

	// ── Auth token (generate once, persist forever) ─────────────────
	let authToken = context.globalState.get<string>('pocketpilot.authToken');
	if (!authToken) {
		authToken = randomUUID();
		await context.globalState.update('pocketpilot.authToken', authToken);
	}

	// ── Managers ────────────────────────────────────────────────────
	statusBar = new StatusBarManager();
	statusBar.show();

	tunnelManager = new TunnelManager();
	qrPanel = new QRCodePanel();
	wsManager = new WebSocketManager(authToken);

	// ── WebSocket events ────────────────────────────────────────────
	wsManager.on('connected', () => {
		statusBar?.setConnected();
		vscode.window.showInformationMessage('PocketPilot: Phone connected!');
	});

	wsManager.on('disconnected', () => {
		statusBar?.setWaiting();
		vscode.window.showInformationMessage('PocketPilot: Phone disconnected');
	});

	wsManager.on('message', (msg: IncomingMessage) => {
		handleIncomingMessage(msg, wsManager!);
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
		// History storage is part of Phase 2 (SDK). For now just confirm.
		vscode.window.showInformationMessage('PocketPilot: Session history cleared');
	});

	// ── Chat participant (stub — full SDK wiring is Phase 2) ────────
	const participant = vscode.chat.createChatParticipant(
		'pocketpilot.assistant',
		async (request, _context, stream, token) => {
			const [model] = await vscode.lm.selectChatModels({
				vendor: 'copilot',
				family: 'gpt-4o',
			});

			if (!model) {
				stream.markdown('No Copilot model available.');
				return;
			}

			const messages = [
				vscode.LanguageModelChatMessage.User(request.prompt),
			];

			const response = await model.sendRequest(messages, {}, token);
			let fullResponse = '';

			for await (const chunk of response.text) {
				stream.markdown(chunk);
				wsManager?.send({ type: 'chunk', content: chunk });
				fullResponse += chunk;
			}

			wsManager?.send({ type: 'done' });
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
	);

	// ── Auto-start the server ───────────────────────────────────────
	try {
		await wsManager.start(WS_PORT);
		statusBar.setWaiting();
	} catch {
		statusBar.setError('port busy');
	}
}

export function deactivate() {
	wsManager?.stop();
	tunnelManager?.stop();
	statusBar?.dispose();
	qrPanel?.dispose();
}

// ── Message handler (Phase 2 will expand this significantly) ────────

function handleIncomingMessage(msg: IncomingMessage, ws: WebSocketManager): void {
	switch (msg.type) {
		case 'prompt': {
			const MODES: Record<string, string> = {
				ask: '',
				agent: '/agent ',
				plan: '/plan ',
			};
			const prefix = MODES[msg.mode] ?? '';
			vscode.commands.executeCommand(
				'workbench.action.chat.open',
				{ query: `@pocketpilot ${prefix}${msg.content}` },
			);
			break;
		}

		case 'get_workspace_info': {
			const folder = vscode.workspace.workspaceFolders?.[0];
			ws.send({
				type: 'workspace_info',
				project: folder?.name ?? 'unknown',
				branch: '',       // TODO: read git branch in Phase 2
				files: [],        // TODO: populate in Phase 2
			});
			break;
		}

		case 'clear_history':
			vscode.commands.executeCommand('pocketpilot.clearHistory');
			break;

		case 'cancel_task':
			// TODO: Phase 2 — cancel active SDK task
			break;

		default:
			// Other message types handled in Phase 2
			break;
	}
}