import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type { IncomingMessage, OutgoingMessage } from './types';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_DEAD_MS = 10_000;
const MAX_BUFFER_SIZE = 100;

export class WebSocketManager extends EventEmitter {
    private wss: WebSocketServer | null = null;
    private activeSocket: WebSocket | null = null;
    private authToken: string;
    private messageBuffer: OutgoingMessage[] = [];
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private lastPong: number = 0;

    constructor(authToken: string) {
        super();
        this.authToken = authToken;
    }

    // ── Public API ──────────────────────────────────────────────────

    start(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            this.wss = new WebSocketServer({ port });

            this.wss.on('listening', () => {
                resolve();
            });

            this.wss.on('error', (err) => {
                reject(err);
            });

            this.wss.on('connection', (ws) => {
                this.handleConnection(ws);
            });
        });
    }

    stop(): void {
        this.stopHeartbeat();
        if (this.activeSocket) {
            this.activeSocket.close();
            this.activeSocket = null;
        }
        this.wss?.close();
        this.wss = null;
    }

    /** Send a typed message to the connected phone. Buffers if disconnected. */
    send(msg: OutgoingMessage): void {
        if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
            this.activeSocket.send(JSON.stringify(msg));
        } else {
            this.messageBuffer.push(msg);
            if (this.messageBuffer.length > MAX_BUFFER_SIZE) {
                this.messageBuffer.shift();
            }
        }
    }

    get isConnected(): boolean {
        return this.activeSocket !== null && this.activeSocket.readyState === WebSocket.OPEN;
    }

    // ── Connection handling ─────────────────────────────────────────

    private handleConnection(ws: WebSocket): void {
        // Single‑client lock
        if (this.activeSocket && this.activeSocket.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'error',
                code: 'SESSION_OCCUPIED',
                message: 'Another device is already connected',
            } satisfies OutgoingMessage));
            ws.close();
            return;
        }

        // Auth handshake — first message must be { type: 'auth', token }
        const authTimeout = setTimeout(() => {
            ws.send(JSON.stringify({
                type: 'error',
                code: 'AUTH_TIMEOUT',
                message: 'Authentication timed out',
            } satisfies OutgoingMessage));
            ws.close();
        }, AUTH_TIMEOUT_MS);

        ws.once('message', (raw) => {
            clearTimeout(authTimeout);

            let msg: IncomingMessage;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                ws.send(JSON.stringify({
                    type: 'error',
                    code: 'INVALID_MESSAGE',
                    message: 'Failed to parse JSON',
                } satisfies OutgoingMessage));
                ws.close();
                return;
            }

            if (msg.type !== 'auth' || msg.token !== this.authToken) {
                ws.send(JSON.stringify({
                    type: 'error',
                    code: 'UNAUTHORIZED',
                    message: 'Invalid auth token',
                } satisfies OutgoingMessage));
                ws.close();
                return;
            }

            // Auth passed — accept the connection
            this.acceptConnection(ws);
        });
    }

    private acceptConnection(ws: WebSocket): void {
        this.activeSocket = ws;
        this.lastPong = Date.now();
        this.startHeartbeat();
        this.flushBuffer();

        this.emit('connected');

        ws.on('message', (raw) => {
            let msg: IncomingMessage;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                this.send({ type: 'error', code: 'INVALID_MESSAGE', message: 'Failed to parse JSON' });
                return;
            }

            if (msg.type === 'pong') {
                this.lastPong = Date.now();
                return;
            }

            this.emit('message', msg);
        });

        ws.on('close', () => {
            this.cleanup();
        });

        ws.on('error', () => {
            this.cleanup();
        });
    }

    // ── Heartbeat ───────────────────────────────────────────────────

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) {
                this.cleanup();
                return;
            }

            // Check if phone is dead (no pong received recently)
            if (Date.now() - this.lastPong > HEARTBEAT_DEAD_MS) {
                this.activeSocket.close();
                this.cleanup();
                return;
            }

            // Send ping
            this.activeSocket.send(JSON.stringify({ type: 'ping' } satisfies OutgoingMessage));
        }, HEARTBEAT_INTERVAL_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    // ── Buffer ──────────────────────────────────────────────────────

    private flushBuffer(): void {
        for (const msg of this.messageBuffer) {
            this.activeSocket?.send(JSON.stringify(msg));
        }
        this.messageBuffer = [];
    }

    // ── Cleanup ─────────────────────────────────────────────────────

    private cleanup(): void {
        this.stopHeartbeat();
        this.activeSocket = null;
        this.emit('disconnected');
    }
}
