import * as vscode from 'vscode';
import * as os from 'os';
import * as QRCode from 'qrcode';
import { StatusManager, PocketPilotState } from './StatusManager';

const WS_PORT = 3000;

/**
 * WebviewViewProvider for the PocketPilot sidebar dashboard.
 *
 * Renders a rich HTML dashboard with:
 *  - Live status indicators (server, phone, tunnel)
 *  - Quick-action buttons
 *  - Connection info (URLs, token)
 *  - QR code for phone scanning
 *  - Current session info (model, mode, activity)
 *
 * Subscribes to StatusManager for live updates.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'pocketpilot.dashboard';

    private view: vscode.WebviewView | undefined;
    private statusManager: StatusManager;
    private authToken: string;
    private tunnelUrl: string | null = null;

    constructor(
        private readonly extensionUri: vscode.Uri,
        statusManager: StatusManager,
        authToken: string,
    ) {
        this.statusManager = statusManager;
        this.authToken = authToken;

        // Subscribe to state changes and push them to the webview
        statusManager.on('stateChanged', (state: PocketPilotState) => {
            this.tunnelUrl = state.tunnelUrl;
            this.postMessage({ type: 'state', ...state });
            // Regenerate QR code when tunnel changes
            if (state.tunnel === 'active' || state.tunnel === 'off') {
                this.sendQRCode();
            }
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.getHtml();

        // Handle messages from the webview (button clicks)
        webviewView.webview.onDidReceiveMessage((msg) => {
            switch (msg.command) {
                case 'showQR':
                    vscode.commands.executeCommand('pocketpilot.showQRCode');
                    break;
                case 'toggleTunnel':
                    vscode.commands.executeCommand('pocketpilot.toggleTunnel');
                    break;
                case 'clearHistory':
                    vscode.commands.executeCommand('pocketpilot.clearHistory');
                    break;
                case 'copyToken':
                    vscode.commands.executeCommand('pocketpilot.copyAuthToken');
                    break;
                case 'copyUrl':
                    if (msg.url) {
                        vscode.env.clipboard.writeText(msg.url);
                        vscode.window.showInformationMessage('URL copied to clipboard');
                    }
                    break;
            }
        });

        // Send initial state + QR code
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.postMessage({ type: 'state', ...this.statusManager.getState() });
                this.sendQRCode();
            }
        });

        // Initial push
        setTimeout(() => {
            this.postMessage({ type: 'state', ...this.statusManager.getState() });
            this.sendQRCode();
        }, 100);
    }

    private postMessage(msg: any): void {
        this.view?.webview.postMessage(msg);
    }

    private async sendQRCode(): Promise<void> {
        try {
            const localIp = getLocalIP();
            const localUrl = `ws://${localIp}:${WS_PORT}`;
            const remoteUrl = this.tunnelUrl
                ? this.tunnelUrl.replace('https://', 'wss://')
                : null;

            const payload = JSON.stringify({
                url: remoteUrl ?? localUrl,
                localUrl,
                token: this.authToken,
            });

            const qrDataUrl = await QRCode.toDataURL(payload, { width: 220, margin: 2 });
            this.postMessage({ type: 'qrcode', dataUrl: qrDataUrl, localUrl, remoteUrl });
        } catch {
            // QR generation failed — not critical
        }
    }

    private getHtml(): string {
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PocketPilot</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            padding: 12px;
            line-height: 1.5;
        }

        /* ── Status Section ── */
        .status-section {
            margin-bottom: 16px;
        }
        .status-section h3 {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            font-weight: 600;
        }

        .status-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 0;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .dot-green { background: #34C759; box-shadow: 0 0 4px rgba(52,199,89,0.4); }
        .dot-yellow { background: #FFCC02; box-shadow: 0 0 4px rgba(255,204,2,0.4); }
        .dot-red { background: #FF3B30; box-shadow: 0 0 4px rgba(255,59,48,0.3); }
        .dot-gray { background: #636366; }
        .dot-pulse {
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        .status-label {
            font-size: 12px;
            flex: 1;
        }
        .status-value {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        /* ── Buttons ── */
        .actions {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 16px;
        }
        .action-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            border: 1px solid var(--vscode-button-secondaryBorder, var(--vscode-widget-border));
            border-radius: 4px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            font-family: inherit;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .action-btn.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        .action-btn.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .action-btn .icon { font-size: 14px; }

        /* ── QR Code ── */
        .qr-section {
            text-align: center;
            margin-bottom: 16px;
        }
        .qr-section img {
            border-radius: 8px;
            max-width: 100%;
            margin: 8px 0;
        }
        .qr-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        /* ── Info ── */
        .info-section {
            margin-bottom: 16px;
        }
        .info-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0;
            gap: 8px;
        }
        .info-key {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        .info-value {
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
            color: var(--vscode-foreground);
            word-break: break-all;
            text-align: right;
        }
        .copy-btn {
            background: none;
            border: none;
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            font-size: 11px;
            padding: 0 2px;
        }
        .copy-btn:hover { text-decoration: underline; }

        /* ── Divider ── */
        .divider {
            height: 1px;
            background: var(--vscode-widget-border);
            margin: 12px 0;
        }

        /* ── Session ── */
        .session-info {
            font-size: 12px;
        }
        .session-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 3px 0;
        }
        .session-badge {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .activity-text {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <!-- Status -->
    <div class="status-section">
        <h3>Status</h3>
        <div class="status-row">
            <span id="dot-server" class="status-dot dot-gray"></span>
            <span class="status-label">Server</span>
            <span id="val-server" class="status-value">stopped</span>
        </div>
        <div class="status-row">
            <span id="dot-phone" class="status-dot dot-gray"></span>
            <span class="status-label">Phone</span>
            <span id="val-phone" class="status-value">disconnected</span>
        </div>
        <div class="status-row">
            <span id="dot-tunnel" class="status-dot dot-gray"></span>
            <span class="status-label">Tunnel</span>
            <span id="val-tunnel" class="status-value">off</span>
        </div>
    </div>

    <div class="divider"></div>

    <!-- Quick Actions -->
    <div class="status-section">
        <h3>Quick Actions</h3>
        <div class="actions">
            <button class="action-btn primary" id="btn-qr">
                <span class="icon">📱</span> Show QR Code
            </button>
            <button class="action-btn" id="btn-tunnel">
                <span class="icon">🌐</span>
                <span id="btn-tunnel-label">Enable Tunnel</span>
            </button>
            <button class="action-btn" id="btn-clear">
                <span class="icon">🗑️</span> Clear History
            </button>
            <button class="action-btn" id="btn-token">
                <span class="icon">🔑</span> Copy Auth Token
            </button>
        </div>
    </div>

    <div class="divider"></div>

    <!-- QR Code -->
    <div class="qr-section" id="qr-section">
        <h3 style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px;font-weight:600;">
            Connect Phone
        </h3>
        <img id="qr-img" src="" alt="QR Code" style="display:none;" />
        <div class="qr-label">Scan with PocketPilot app</div>
    </div>

    <div class="divider"></div>

    <!-- Connection Info -->
    <div class="info-section">
        <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:8px;font-weight:600;">
            Connection
        </h3>
        <div class="info-row">
            <span class="info-key">Local</span>
            <span class="info-value" id="val-local">—</span>
            <button class="copy-btn" id="copy-local">copy</button>
        </div>
        <div class="info-row" id="row-tunnel-url" style="display:none;">
            <span class="info-key">Tunnel</span>
            <span class="info-value" id="val-tunnel-url">—</span>
            <button class="copy-btn" id="copy-tunnel">copy</button>
        </div>
    </div>

    <div class="divider"></div>

    <!-- Session Info -->
    <div class="status-section">
        <h3>Session</h3>
        <div class="session-info">
            <div class="session-row">
                <span class="info-key">Model</span>
                <span class="session-badge" id="val-model">auto</span>
            </div>
            <div class="session-row">
                <span class="info-key">Mode</span>
                <span class="session-badge" id="val-mode">ask</span>
            </div>
            <div class="session-row" id="row-activity" style="display:none;">
                <span class="activity-text" id="val-activity"></span>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // ── Elements ────────────────────────────────────────────
        const dotServer = document.getElementById('dot-server');
        const dotPhone = document.getElementById('dot-phone');
        const dotTunnel = document.getElementById('dot-tunnel');
        const valServer = document.getElementById('val-server');
        const valPhone = document.getElementById('val-phone');
        const valTunnel = document.getElementById('val-tunnel');
        const btnTunnelLabel = document.getElementById('btn-tunnel-label');
        const qrImg = document.getElementById('qr-img');
        const valLocal = document.getElementById('val-local');
        const valTunnelUrl = document.getElementById('val-tunnel-url');
        const rowTunnelUrl = document.getElementById('row-tunnel-url');
        const valModel = document.getElementById('val-model');
        const valMode = document.getElementById('val-mode');
        const rowActivity = document.getElementById('row-activity');
        const valActivity = document.getElementById('val-activity');

        // ── Button handlers ─────────────────────────────────────
        document.getElementById('btn-qr').addEventListener('click', () => {
            vscode.postMessage({ command: 'showQR' });
        });
        document.getElementById('btn-tunnel').addEventListener('click', () => {
            vscode.postMessage({ command: 'toggleTunnel' });
        });
        document.getElementById('btn-clear').addEventListener('click', () => {
            vscode.postMessage({ command: 'clearHistory' });
        });
        document.getElementById('btn-token').addEventListener('click', () => {
            vscode.postMessage({ command: 'copyToken' });
        });
        document.getElementById('copy-local').addEventListener('click', () => {
            vscode.postMessage({ command: 'copyUrl', url: valLocal.textContent });
        });
        document.getElementById('copy-tunnel').addEventListener('click', () => {
            vscode.postMessage({ command: 'copyUrl', url: valTunnelUrl.textContent });
        });

        // ── State updates ───────────────────────────────────────
        window.addEventListener('message', (event) => {
            const msg = event.data;

            if (msg.type === 'state') {
                // Server
                dotServer.className = 'status-dot ' + (msg.server === 'running' ? 'dot-green' : 'dot-red');
                valServer.textContent = msg.server;

                // Phone
                dotPhone.className = 'status-dot ' + (msg.phone === 'connected' ? 'dot-green' : 'dot-gray');
                valPhone.textContent = msg.phone;

                // Tunnel
                const tunnelDotMap = {
                    'off': 'dot-gray',
                    'starting': 'dot-yellow dot-pulse',
                    'active': 'dot-green',
                    'error': 'dot-red',
                };
                dotTunnel.className = 'status-dot ' + (tunnelDotMap[msg.tunnel] || 'dot-gray');
                let tunnelLabel = msg.tunnel;
                if (msg.tunnel === 'active' && msg.tunnelProvider) {
                    tunnelLabel = msg.tunnelProvider;
                }
                valTunnel.textContent = tunnelLabel;

                // Tunnel button label
                if (msg.tunnel === 'active' || msg.tunnel === 'starting') {
                    btnTunnelLabel.textContent = 'Disable Tunnel';
                } else {
                    btnTunnelLabel.textContent = 'Enable Tunnel';
                }

                // Tunnel URL row
                if (msg.tunnelUrl) {
                    rowTunnelUrl.style.display = 'flex';
                    valTunnelUrl.textContent = msg.tunnelUrl;
                } else {
                    rowTunnelUrl.style.display = 'none';
                }

                // Session
                valModel.textContent = msg.model || 'auto';
                valMode.textContent = msg.mode || 'ask';

                if (msg.activity && msg.session === 'busy') {
                    rowActivity.style.display = 'flex';
                    valActivity.textContent = msg.activity;
                } else {
                    rowActivity.style.display = 'none';
                }
            }

            if (msg.type === 'qrcode') {
                qrImg.src = msg.dataUrl;
                qrImg.style.display = 'block';
                valLocal.textContent = msg.localUrl;
                if (msg.remoteUrl) {
                    rowTunnelUrl.style.display = 'flex';
                    valTunnelUrl.textContent = msg.remoteUrl;
                }
            }
        });
    </script>
</body>
</html>`;
    }
}

function getLocalIP(): string {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        if (!iface) { continue; }
        for (const info of iface) {
            if (info.family === 'IPv4' && !info.internal) {
                return info.address;
            }
        }
    }
    return '127.0.0.1';
}
