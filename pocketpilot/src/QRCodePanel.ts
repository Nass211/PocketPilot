import * as vscode from 'vscode';
import * as os from 'os';
import * as QRCode from 'qrcode';

interface QRCodePanelOptions {
    authToken: string;
    port: number;
    tunnelUrl: string | null;
}

export class QRCodePanel {
    private panel: vscode.WebviewPanel | null = null;

    async show(context: vscode.ExtensionContext, options: QRCodePanelOptions): Promise<void> {
        const localIp = getLocalIP();
        const localUrl = `ws://${localIp}:${options.port}`;
        const remoteUrl = options.tunnelUrl
            ? options.tunnelUrl.replace('https://', 'wss://')
            : null;

        const payload = JSON.stringify({
            url: remoteUrl ?? localUrl,
            localUrl,
            token: options.authToken,
        });

        const qrDataUrl = await QRCode.toDataURL(payload, { width: 280, margin: 2 });

        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'pocketpilotQR',
                'PocketPilot — Connect',
                vscode.ViewColumn.One,
                { enableScripts: false },
            );

            this.panel.onDidDispose(() => {
                this.panel = null;
            });
        }

        this.panel.webview.html = this.getHtml(qrDataUrl, localUrl, remoteUrl, options.authToken);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }

    private getHtml(qrDataUrl: string, localUrl: string, remoteUrl: string | null, token: string): string {
        const maskedToken = token.slice(0, 8) + '-****-****';
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>PocketPilot Connect</title>
	<style>
		body {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			min-height: 100vh;
			margin: 0;
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
		h1 { font-size: 1.4em; margin-bottom: 0.5em; }
		.qr { margin: 1em 0; border-radius: 12px; }
		.info { text-align: center; font-size: 0.85em; opacity: 0.8; line-height: 1.6; }
		.url { font-family: var(--vscode-editor-font-family); font-size: 0.82em; word-break: break-all; }
		.label { font-weight: bold; margin-top: 0.6em; display: block; }
	</style>
</head>
<body>
	<h1>Connect PocketPilot</h1>
	<img class="qr" src="${qrDataUrl}" alt="QR Code" />
	<div class="info">
		<span class="label">Local</span>
		<span class="url">${localUrl}</span>
		${remoteUrl ? `<span class="label">Remote (Tunnel)</span><span class="url">${remoteUrl}</span>` : ''}
		<span class="label">Token</span>
		<span class="url">${maskedToken}</span>
	</div>
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
