import * as vscode from 'vscode';
import { EventEmitter } from 'events';

export interface PocketPilotState {
    server: 'stopped' | 'running';
    phone: 'disconnected' | 'connected';
    tunnel: 'off' | 'starting' | 'active' | 'error';
    tunnelUrl: string | null;
    tunnelProvider: string;
    session: 'idle' | 'busy';
    activity: string;
    model: string;
    mode: string;
}

/**
 * Single source of truth for all PocketPilot state.
 *
 * Both the status bar item AND the sidebar webview subscribe to changes.
 * This eliminates stale-status bugs because every transition goes through
 * one place — `update()` — which notifies all subscribers automatically.
 */
export class StatusManager extends EventEmitter {
    private state: PocketPilotState = {
        server: 'stopped',
        phone: 'disconnected',
        tunnel: 'off',
        tunnelUrl: null,
        tunnelProvider: '',
        session: 'idle',
        activity: '',
        model: 'auto',
        mode: 'ask',
    };

    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        super();
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
        this.statusBarItem.command = 'pocketpilot.showQRCode';
        this.syncStatusBar();
        this.statusBarItem.show();
    }

    /** Get a snapshot of current state */
    getState(): Readonly<PocketPilotState> {
        return { ...this.state };
    }

    /** Update one or more state fields. Notifies all subscribers. */
    update(patch: Partial<PocketPilotState>): void {
        let changed = false;
        for (const [key, value] of Object.entries(patch)) {
            if ((this.state as any)[key] !== value) {
                (this.state as any)[key] = value;
                changed = true;
            }
        }
        if (changed) {
            this.syncStatusBar();
            this.emit('stateChanged', this.getState());
        }
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }

    // ── Status bar rendering ─────────────────────────────────────────

    private syncStatusBar(): void {
        const s = this.state;

        if (s.session === 'busy') {
            const label = s.activity || 'generating…';
            this.statusBarItem.text = `$(sync~spin) PocketPilot — ${label}`;
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = label;
            return;
        }

        if (s.phone === 'connected') {
            this.statusBarItem.text = '$(broadcast) PocketPilot — phone connected';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Phone is connected';
            return;
        }

        if (s.tunnel === 'active') {
            const via = s.tunnelProvider ? ` (${s.tunnelProvider})` : '';
            this.statusBarItem.text = `$(broadcast) PocketPilot — tunnel ready${via}`;
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = `Tunnel active — scan QR to connect phone${via}`;
            return;
        }

        if (s.tunnel === 'starting') {
            this.statusBarItem.text = '$(sync~spin) PocketPilot — starting tunnel…';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Starting tunnel…';
            return;
        }

        if (s.tunnel === 'error') {
            this.statusBarItem.text = '$(error) PocketPilot — tunnel failed';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this.statusBarItem.tooltip = 'Tunnel failed — click to retry';
            return;
        }

        if (s.server === 'running') {
            this.statusBarItem.text = '$(broadcast) PocketPilot — waiting';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'Click to show QR code';
            return;
        }

        // server stopped / error
        this.statusBarItem.text = '$(error) PocketPilot — port busy';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.tooltip = 'Server could not start';
    }
}
