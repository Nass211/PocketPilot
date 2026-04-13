import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

// -------------------------------------------------------------
// Utilitaire pour récupérer l'IP locale (LAN) de la machine
// -------------------------------------------------------------
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      // Ignorer l'IPv6 et les interfaces internes (localhost)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = 3000;
const IP = getLocalIpAddress();
const wss = new WebSocketServer({ port: PORT });

// -------------------------------------------------------------
// Gestion des statuts CLI
// -------------------------------------------------------------
const CLI_STATUSES = ['running', 'crashed', 'reconnecting'];
let cliStatusIndex = 0;

setInterval(() => {
  const status = CLI_STATUSES[cliStatusIndex];
  cliStatusIndex = (cliStatusIndex + 1) % CLI_STATUSES.length;
  broadcast({ type: 'cli_status', status });
}, 30000);

function broadcast(msg: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

// -------------------------------------------------------------
// Logique par connexion Client
// -------------------------------------------------------------
wss.on('connection', (ws) => {
  console.log('✅ Nouvelle connexion entrante ! En attente d\'authentification...');

  let isAuthenticated = false;
  let hasHistory = false;
  let activeStreamTimeout: NodeJS.Timeout | null = null;
  let lastPongTime = Date.now();

  // 1. Authentification dans les 5 secondes
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) {
      console.log('❌ Timeout d\'authentification. Fermeture de la connexion.');
      ws.close();
    }
  }, 5000);

  // 2. Heartbeat (Ping toutes les 5s, warning si pas de pong après 10s)
  const heartbeatInterval = setInterval(() => {
    ws.send(JSON.stringify({ type: 'ping' }));
    if (Date.now() - lastPongTime > 10000) {
      console.warn('⚠️ Warning: Pas de Pong reçu depuis 10s (mode test: connexion maintenue)');
    }
  }, 5000);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('⬇️ Reçu:', data.type);

      // Gestion du Pong
      if (data.type === 'pong') {
        lastPongTime = Date.now();
        return;
      }

      // 1. Authentification
      if (data.type === 'auth') {
        clearTimeout(authTimeout);
        isAuthenticated = true;
        console.log('🔓 Client authentifié avec le token:', data.token);
        
        ws.send(JSON.stringify({
          type: 'connected',
          project: 'PocketPilot-Test',
          branch: 'main',
          model: 'GPT-4o',
          mode: 'ask',
          hasHistory
        }));
        return;
      }

      if (!isAuthenticated) return;

      // 4. Autres messages gérés
      switch (data.type) {
        case 'cancel_task':
          console.log('🛑 Annulation de la tâche (arrêt du stream)');
          if (activeStreamTimeout) clearTimeout(activeStreamTimeout);
          break;

        case 'clear_history':
          console.log('🗑️ Historique effacé');
          hasHistory = false;
          break;

        case 'get_workspace_info':
          ws.send(JSON.stringify({
            type: 'workspace_info',
            project: 'PocketPilot-Test',
            branch: 'main',
            files: ['src/App.tsx', 'src/hooks/useWebSocket.ts', 'src/screens/ChatScreen.tsx']
          }));
          break;

        case 'switch_model':
          ws.send(JSON.stringify({ type: 'model_switched', model: data.model }));
          break;

        case 'switch_mode':
          ws.send(JSON.stringify({ type: 'mode_switched', mode: data.mode }));
          break;

        case 'user_input':
          console.log('👤 Input utilisateur reçu:', data.answer);
          // Simuler la suite du flux avec un done pour débloquer l'interface
          ws.send(JSON.stringify({ type: 'done' }));
          break;

        case 'permission':
          console.log('🔑 Permission accordée:', data.id);
          // L'Id de perm était "perm-1"
          streamResponse(ws, "Permission reçue. Voici le contenu du fichier `src/index.ts`:\n\n```typescript\nconsole.log('Hello');\n```");
          break;

        case 'action':
          console.log('⚡ Action cliquée:', data.actionId);
          if (data.actionId === 'start_implementation') {
            ws.send(JSON.stringify({ type: 'mode_switched', mode: 'agent' }));
          }
          break;

        case 'prompt':
          hasHistory = true;
          console.log(`🤖 Prompt reçu (mode: ${data.mode}):`, data.content);
          
          if (data.mode === 'ask') {
            const answer = `Voici ma réponse à : **${data.content}**\n\n\`\`\`typescript\nconst example = 'Hello PocketPilot';\n\`\`\`\n\nC'est tout !`;
            streamResponse(ws, answer);
          } 
          else if (data.mode === 'agent') {
            ws.send(JSON.stringify({ type: 'notification', title: 'Tool', body: 'Lecture fichier...' }));
            
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: 'permission_request',
                id: 'perm-1',
                kind: 'read',
                command: 'Read file: src/index.ts'
              }));
            }, 1000);
          }
          else if (data.mode === 'plan') {
            const planText = "Voici un plan d'action :\n1. Analyser le code\n2. Créer les composants\n3. Tester l'implémentation\n\nQue voulez-vous faire ?";
            streamResponse(ws, planText, () => {
              ws.send(JSON.stringify({
                type: 'action_required',
                actions: [
                  { id: 'start_implementation', label: 'Start', style: 'primary' },
                  { id: 'revise_plan', label: 'Revise', style: 'secondary' },
                  { id: 'cancel', label: 'Cancel', style: 'danger' }
                ]
              }));
            });
          }
          break;
      }
    } catch (err) {
      console.error('Erreur parsing message:', err);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Client déconnecté');
    clearInterval(heartbeatInterval);
    if (activeStreamTimeout) clearTimeout(activeStreamTimeout);
  });

  // Utilitaire pour streamer du texte chunk par chunk
  function streamResponse(client: WebSocket, text: string, onComplete?: () => void) {
    if (activeStreamTimeout) {
        clearTimeout(activeStreamTimeout);
    }
    
    let index = 0;
    const chunkSize = 10;
    
    ws.send(JSON.stringify({ type: 'chat_updated', content: '' }));

    function sendNextChunk() {
      if (index < text.length) {
        const chunk = text.slice(index, index + chunkSize);
        index += chunkSize;
        client.send(JSON.stringify({ type: 'chat_updated', content: chunk }));
        activeStreamTimeout = setTimeout(sendNextChunk, 50);
      } else {
        client.send(JSON.stringify({ type: 'done' }));
        if (onComplete) onComplete();
      }
    }
    
    sendNextChunk();
  }
});

// -------------------------------------------------------------
// Démarrage & Affichage QR Code
// -------------------------------------------------------------
console.log('🚀 Mock Server Démarré !');
console.log(`📡 Écoute sur ws://${IP}:${PORT}\n`);

const testToken = "test-token-1234";

const connectionPayload = {
  url: `ws://${IP}:${PORT}`,
  localUrl: `ws://${IP}:${PORT}`,
  token: testToken
};

console.log('📱 Scanner ce QR Code avec PocketPilot :');
qrcode.generate(JSON.stringify(connectionPayload), { small: true });

console.log('\n--- Informations de Connexion Manuelle ---');
console.log(`URL   : ws://${IP}:${PORT}`);
console.log(`Token : ${testToken}`);
console.log('------------------------------------------\n');

// USAGE :
// cd server-mock
// npm install
// npm run mock          → lancer le serveur
// Scanner le QR affiché avec PocketPilot
// Tester les 3 modes : Ask / Agent / Plan
