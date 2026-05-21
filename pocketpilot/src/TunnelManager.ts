import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

const CF_TIMEOUT_MS = 15_000;   // 15s for Cloudflare (fail fast so we can fallback)
const SSH_TIMEOUT_MS = 20_000;  // 20s for SSH tunnel
const LT_TIMEOUT_MS  = 20_000; // 20s for localtunnel

export class TunnelManager extends EventEmitter {
    private process: ChildProcess | null = null;
    private _tunnelUrl: string | null = null;
    private _provider: string = '';
    private extensionRoot: string;

    constructor(extensionRoot: string) {
        super();
        this.extensionRoot = extensionRoot;
    }

    get tunnelUrl(): string | null {
        return this._tunnelUrl;
    }

    get provider(): string {
        return this._provider;
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    // ── Binary resolution ──────────────────────────────────────────

    private getCloudflaredPath(): string {
        const bundledName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
        const bundledPath = path.join(this.extensionRoot, bundledName);
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }
        return 'cloudflared';
    }

    private getLocaltunnelPath(): string | null {
        const candidates = [
            path.join(this.extensionRoot, 'node_modules', '.bin', 'lt'),
            path.join(this.extensionRoot, 'node_modules', '.bin', 'lt.cmd'),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) { return p; }
        }
        return null;
    }

    /** Check if cloudflared is installed. */
    async checkInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const bin = this.getCloudflaredPath();
            const proc = spawn(bin, ['--version']);
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
        });
    }

    // ── Main entry point: try providers in order ───────────────────

    /**
     * Start a tunnel.  Tries providers in order:
     *   1. Cloudflare Quick Tunnel
     *   2. SSH tunnel via serveo.net then localhost.run  (zero install)
     *   3. localtunnel (lt)  (if npm-installed)
     */
    async start(port: number, progress?: (msg: string) => void): Promise<string> {
        if (this.isRunning) {
            if (this._tunnelUrl) { return this._tunnelUrl; }
            this.stop();
        }

        const errors: string[] = [];

        // ── 1. Cloudflare ────────────────────────────────────────
        try {
            progress?.('Trying Cloudflare tunnel…');
            const url = await this.startCloudflare(port);
            this._provider = 'cloudflare';
            return url;
        } catch (cfErr: any) {
            errors.push(`Cloudflare: ${(cfErr.message ?? '').split('\n')[0]}`);
            progress?.('Cloudflare failed — trying SSH tunnel…');
        }

        // ── 2. SSH (serveo.net → localhost.run) ───────────────────
        try {
            const url = await this.startSSHTunnel(port);
            return url;
        } catch (sshErr: any) {
            errors.push(`SSH: ${(sshErr.message ?? '').split('\n')[0]}`);
            progress?.('SSH tunnel failed — trying localtunnel…');
        }

        // ── 3. localtunnel (lt) ──────────────────────────────────
        const ltPath = this.getLocaltunnelPath();
        if (ltPath) {
            try {
                const url = await this.startLocaltunnel(port, ltPath);
                this._provider = 'localtunnel';
                return url;
            } catch (ltErr: any) {
                errors.push(`localtunnel: ${(ltErr.message ?? '').split('\n')[0]}`);
            }
        }

        // ── All failed ───────────────────────────────────────────
        throw new Error(
            `All tunnel providers failed:\n\n` +
            errors.map(e => `  • ${e}`).join('\n') +
            `\n\nCheck your internet connection and try again.`
        );
    }

    // ── Provider: Cloudflare Quick Tunnel ─────────────────────────

    private startCloudflare(port: number): Promise<string> {
        const bin = this.getCloudflaredPath();

        return new Promise((resolve, reject) => {
            this.process = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`]);

            let resolved = false;
            let log = '';

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.stop();
                    reject(new Error(`Cloudflare timed out (${CF_TIMEOUT_MS / 1000}s).\n${log.slice(-300)}`));
                }
            }, CF_TIMEOUT_MS);

            const handle = (data: Buffer) => {
                const text = data.toString();
                log += text;

                const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match && !resolved) {
                    resolved = true;
                    this._tunnelUrl = match[0];
                    clearTimeout(timeout);
                    this.emit('url', this._tunnelUrl);
                    resolve(this._tunnelUrl);
                    return;
                }

                // Fast-fail on known server errors
                if (!resolved && (
                    text.includes('failed to request quick Tunnel') ||
                    text.includes('status_code="500') ||
                    text.includes('Internal Server Error') ||
                    text.includes('connection refused') ||
                    text.includes('no such host')
                )) {
                    resolved = true;
                    clearTimeout(timeout);
                    this.stop();
                    const line = log.split('\n').find(l => l.includes('failed') || l.includes('ERR')) || text.trim();
                    reject(new Error(line));
                }
            };

            this.process.stderr?.on('data', handle);
            this.process.stdout?.on('data', handle);
            this.process.on('error', (err) => { clearTimeout(timeout); if (!resolved) { resolved = true; this.stop(); reject(err); } });
            this.process.on('close', (code) => {
                this._tunnelUrl = null; this.process = null; this.emit('stopped');
                if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`cloudflared exited ${code}.\n${log.slice(-300)}`)); }
            });
        });
    }

    // ── Provider: SSH tunnel (tries serveo.net, then localhost.run) ──

    private async startSSHTunnel(port: number): Promise<string> {
        // Try serveo.net first — clean output, reliable
        try {
            const url = await this.startSSHProvider(port, {
                host: 'serveo.net',
                // Output: "Forwarding HTTP traffic from https://xxxxx.serveo.net"
                urlRegex: /https:\/\/[a-z0-9]+\.serveo\.net/,
            });
            this._provider = 'serveo.net';
            return url;
        } catch {
            // Fall through to localhost.run
        }

        // Try localhost.run
        const url = await this.startSSHProvider(port, {
            host: 'localhost.run',
            user: 'nokey',
            // The actual tunnel URL uses .lhr.life domain (NOT .localhost.run which is banner text)
            urlRegex: /https:\/\/[a-z0-9]+\.lhr\.life/,
            linePrefix: 'your url is:',
        });
        this._provider = 'localhost.run';
        return url;
    }

    private startSSHProvider(port: number, opts: {
        host: string;
        user?: string;
        urlRegex: RegExp;
        linePrefix?: string;
    }): Promise<string> {
        return new Promise((resolve, reject) => {
            const target = opts.user ? `${opts.user}@${opts.host}` : opts.host;
            this.process = spawn('ssh', [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ServerAliveInterval=30',
                '-o', 'ConnectTimeout=10',
                '-R', `80:localhost:${port}`,
                target,
            ]);

            let resolved = false;
            let log = '';

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.stop();
                    reject(new Error(`SSH tunnel to ${opts.host} timed out (${SSH_TIMEOUT_MS / 1000}s).\n${log.slice(-300)}`));
                }
            }, SSH_TIMEOUT_MS);

            const handle = (data: Buffer) => {
                const text = data.toString();
                log += text;

                // Primary: match the specific tunnel URL pattern
                const match = text.match(opts.urlRegex);
                if (match && !resolved) {
                    resolved = true;
                    this._tunnelUrl = match[0];
                    clearTimeout(timeout);
                    this.emit('url', this._tunnelUrl);
                    resolve(this._tunnelUrl);
                    return;
                }

                // Secondary: parse "your url is: https://..." lines
                if (opts.linePrefix && !resolved) {
                    for (const line of text.split('\n')) {
                        const lower = line.toLowerCase();
                        if (lower.includes(opts.linePrefix)) {
                            const urlMatch = line.match(/https:\/\/\S+/);
                            if (urlMatch) {
                                resolved = true;
                                this._tunnelUrl = urlMatch[0].replace(/[*\s]+$/, '');
                                clearTimeout(timeout);
                                this.emit('url', this._tunnelUrl);
                                resolve(this._tunnelUrl);
                                return;
                            }
                        }
                    }
                }
            };

            this.process.stdout?.on('data', handle);
            this.process.stderr?.on('data', handle);
            this.process.on('error', (err) => { clearTimeout(timeout); if (!resolved) { resolved = true; this.stop(); reject(err); } });
            this.process.on('close', (code) => {
                this._tunnelUrl = null; this.process = null; this.emit('stopped');
                if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`ssh → ${opts.host} exited ${code}.\n${log.slice(-300)}`)); }
            });
        });
    }

    // ── Provider: localtunnel (lt) ────────────────────────────────

    private startLocaltunnel(port: number, ltBin: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.process = spawn(ltBin, ['--port', String(port)], {
                shell: process.platform === 'win32',
            });

            let resolved = false;
            let log = '';

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.stop();
                    reject(new Error(`localtunnel timed out.\n${log.slice(-300)}`));
                }
            }, LT_TIMEOUT_MS);

            const handle = (data: Buffer) => {
                const text = data.toString();
                log += text;

                const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
                if (match && !resolved) {
                    resolved = true;
                    this._tunnelUrl = match[0];
                    clearTimeout(timeout);
                    this.emit('url', this._tunnelUrl);
                    resolve(this._tunnelUrl);
                }
            };

            this.process.stdout?.on('data', handle);
            this.process.stderr?.on('data', handle);
            this.process.on('error', (err) => { clearTimeout(timeout); if (!resolved) { resolved = true; this.stop(); reject(err); } });
            this.process.on('close', (code) => {
                this._tunnelUrl = null; this.process = null; this.emit('stopped');
                if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`lt exited ${code}.`)); }
            });
        });
    }

    // ── Stop ──────────────────────────────────────────────────────

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this._tunnelUrl = null;
        this._provider = '';
    }
}
