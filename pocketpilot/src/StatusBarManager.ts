import * as vscode from 'vscode';

type StatusState = 'waiting' | 'connected' | 'tunnel_ready' | 'busy' | 'error';

export class StatusBarManager {
    private item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'pocketpilot.showQRCode';
        this.setWaiting();
    }

    show(): void {
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }

    setWaiting(): void {
        this.item.text = '$(broadcast) PocketPilot — waiting';
        this.item.backgroundColor = undefined;
        this.item.tooltip = 'Click to show QR code';
    }

    setConnected(device?: string): void {
        const label = device ?? 'phone';
        this.item.text = `$(broadcast) PocketPilot — ${label} connected`;
        this.item.backgroundColor = undefined;
        this.item.tooltip = 'Phone is connected';
    }

    setTunnelReady(): void {
        this.item.text = '$(broadcast) PocketPilot — tunnel ready';
        this.item.backgroundColor = undefined;
        this.item.tooltip = 'Tunnel active — scan QR to connect phone';
    }

    setBusy(task: string): void {
        this.item.text = `$(sync~spin) PocketPilot — ${task}`;
        this.item.backgroundColor = undefined;
        this.item.tooltip = task;
    }

    setError(msg: string): void {
        this.item.text = `$(error) PocketPilot — ${msg}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.item.tooltip = msg;
    }
}
