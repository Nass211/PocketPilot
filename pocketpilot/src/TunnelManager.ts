import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';

const TUNNEL_TIMEOUT_MS = 15_000;

export class TunnelManager extends EventEmitter {
    private process: ChildProcess | null = null;
    private _tunnelUrl: string | null = null;
    private extensionRoot: string;

    constructor(extensionRoot: string) {
        super();
        this.extensionRoot = extensionRoot;
    }

    get tunnelUrl(): string | null {
        return this._tunnelUrl;
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    /**
     * Resolve the cloudflared binary path.
     * 1. Check for a bundled binary next to the extension (e.g. pocketpilot/cloudflared)
     * 2. Fall back to the system PATH
     */
    private getCloudflaredPath(): string {
        // Check for bundled binary in the extension root directory
        const bundledName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
        const bundledPath = path.join(this.extensionRoot, bundledName);
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }
        // Fall back to system PATH
        return 'cloudflared';
    }

    /** Check if cloudflared is installed (bundled or system). */
    async checkInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const bin = this.getCloudflaredPath();
            const proc = spawn(bin, ['--version']);
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
        });
    }

    /** Start a Cloudflare quick tunnel for the given port. Resolves with the public URL. */
    async start(port: number): Promise<string> {
        if (this.isRunning) {
            if (this._tunnelUrl) {
                return this._tunnelUrl;
            }
            this.stop();
        }

        const bin = this.getCloudflaredPath();

        return new Promise((resolve, reject) => {
            this.process = spawn(bin, [
                'tunnel', '--url', `http://localhost:${port}`,
            ]);

            const timeout = setTimeout(() => {
                this.stop();
                reject(new Error('Tunnel startup timed out'));
            }, TUNNEL_TIMEOUT_MS);

            // cloudflared prints the URL to stderr
            this.process.stderr?.on('data', (data: Buffer) => {
                const output = data.toString();
                const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match && !this._tunnelUrl) {
                    this._tunnelUrl = match[0];
                    clearTimeout(timeout);
                    this.emit('url', this._tunnelUrl);
                    resolve(this._tunnelUrl);
                }
            });

            this.process.on('error', (err) => {
                clearTimeout(timeout);
                this.stop();
                reject(err);
            });

            this.process.on('close', () => {
                this._tunnelUrl = null;
                this.process = null;
                this.emit('stopped');
            });
        });
    }

    stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this._tunnelUrl = null;
    }
}
