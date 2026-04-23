import { WebSocketMessage } from '../types/messages';

type MessageCallback = (msg: any) => void;
type StatusCallback = (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;

interface WebSocketOptions {
  url: string;
  localUrl?: string;
  tunnelUrl?: string;
  token: string;
  onMessage: MessageCallback;
  onStatusChange?: StatusCallback;
}

export class WebSocketService {
  private ws: WebSocket | null = null;
  private localUrl: string | null;
  private tunnelUrl: string | null;
  private activeUrl: string;
  private token: string;
  
  private onMessage: MessageCallback;
  private onStatusChange?: StatusCallback;
  
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // 30 seconds max backoff
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;

  // Tunnel fallback: after MAX_LOCAL_FAILURES consecutive failures on localUrl,
  // automatically escalate to the tunnel URL.
  private localReconnectFailures = 0;
  private static readonly MAX_LOCAL_FAILURES = 3;

  constructor(options: WebSocketOptions) {
    this.activeUrl = options.url;
    this.localUrl = options.localUrl ?? null;
    this.tunnelUrl = options.tunnelUrl ?? null;
    this.token = options.token;
    this.onMessage = options.onMessage;
    this.onStatusChange = options.onStatusChange;
  }

  /**
   * Returns the URL currently being used for the connection.
   */
  public getActiveUrl(): string {
    return this.activeUrl;
  }

  /**
   * Connecte le WebSocket au serveur fourni
   */
  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isIntentionalClose = false;
    this.updateStatus('connecting');

    try {
      this.ws = new WebSocket(this.activeUrl);
      
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (error) {
      console.warn('WebSocket connection error:', error);
      this.updateStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Déconnexion intentionnelle (ne déclenchera pas de reconnexion)
   */
  public disconnect() {
    this.isIntentionalClose = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.updateStatus('disconnected');
  }

  /**
   * Envoi d'un message sérialisé en JSON
   */
  public send(msg: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('WebSocket is not open. Cannot send message:', msg);
    }
  }

  /**
   * Gère l'ouverture de la connexion et envoie le token d'authentification
   */
  private handleOpen() {
    console.log('WebSocket connected to', this.activeUrl);
    this.reconnectAttempts = 0; // Réinitialise le compteur de reconnexion
    this.localReconnectFailures = 0; // Reset local failure counter on successful open
    this.updateStatus('connected');
    
    // Authentification instantanée dès l'ouverture
    this.send({ type: 'auth', token: this.token });
  }

  /**
   * Réception d'un message du serveur
   */
  private handleMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      
      // Gestion interne stricte du ping/pong
      if (data.type === 'ping') {
        this.send({ type: 'pong' });
        return; // Le ping n'a pas besoin de remonter à l'UI
      }
      
      // Transmission des autres messages via callback
      this.onMessage(data);
    } catch (error) {
      console.warn('WebSocket message parsing error:', error);
    }
  }

  /**
   * Gestion de la fermeture inattendue/attendue
   */
  private handleClose(event: CloseEvent) {
    console.log(`WebSocket closed (Code: ${event.code})`);
    
    if (this.isIntentionalClose) {
      this.updateStatus('disconnected');
    } else {
      this.updateStatus('error');
      this.scheduleReconnect();
    }
  }

  private handleError(_event: Event) {
    console.warn('WebSocket error on', this.activeUrl);
    this.updateStatus('error');
  }

  /**
   * Reconnexion automatique avec backoff exponentiel: 1s, 2s, 4s, 8s... (max 30s)
   * After MAX_LOCAL_FAILURES consecutive failures on the local URL, automatically
   * switches to the tunnel URL if one is available.
   */
  private scheduleReconnect() {
    if (this.isIntentionalClose) return;

    // Tunnel escalation: if currently on localUrl and it keeps failing, switch to tunnel
    if (this.localUrl && this.tunnelUrl && this.activeUrl === this.localUrl) {
      this.localReconnectFailures++;
      if (this.localReconnectFailures >= WebSocketService.MAX_LOCAL_FAILURES) {
        console.log(`Local reconnect failed ${WebSocketService.MAX_LOCAL_FAILURES} times, switching to tunnel URL`);
        this.activeUrl = this.tunnelUrl;
        this.localReconnectFailures = 0;
        this.reconnectAttempts = 0; // Reset backoff for the new URL
      }
    }

    // Calcul du backoff exponentiel
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    console.log(`Scheduling reconnect in ${delay}ms (Attempt ${this.reconnectAttempts + 1})`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private updateStatus(status: 'disconnected' | 'connecting' | 'connected' | 'error') {
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }
}
