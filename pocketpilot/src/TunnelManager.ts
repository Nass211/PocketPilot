import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

const TUNNEL_TIMEOUT_MS = 15_000;

export class TunnelManager extends EventEmitter {
    private process: ChildProcess | null = null;
    private _tunnelUrl: string | null = null;

    get tunnelUrl(): string | null {
        return this._tunnelUrl;
    }

    get isRunning(): boolean {
        return this.process !== null && !this.process.killed;
    }

    /** Check if cloudflared is installed. */
    async checkInstalled(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('cloudflared', ['--version']);
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

        return new Promise((resolve, reject) => {
            this.process = spawn('cloudflared', [
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
