const { WebSocketServer } = require('ws');

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`Mock WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected');

  // 6. Au démarrage, envoie automatiquement au client :
  const initialMessages = [
    {
      type: "fileEdited",
      filename: "auth.ts",
      diff: ["- old line", "+ new line"]
    },
    {
      type: "permissionRequest",
      command: "npm install jsonwebtoken"
    },
    {
      type: "modelsAvailable",
      models: ["gpt-5.4", "claude-sonnet-4.6"]
    }
  ];

  initialMessages.forEach(msg => {
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'prompt') {
        console.log(`[prompt] Reçu: ${message.text}`);
        const responseText = `Voici ma réponse simulée pour le prompt : ${message.text}`;
        
        let index = 0;
        // 2. Simule un streaming caractère par caractère
        const intervalId = setInterval(() => {
          if (index < responseText.length) {
            ws.send(JSON.stringify({
              type: "chunk",
              text: responseText[index]
            }));
            index++;
          } else {
            clearInterval(intervalId);
          }
        }, 50); // Délai de 50ms entre chaque caractère
      }
      // 3. Quand il reçoit { "type": "setMode", "mode": "agent" }
      else if (message.type === 'setMode') {
        console.log(`[setMode] Le mode a été défini sur : ${message.mode}`);
      }
      // 4. Quand il reçoit { "type": "setModel", "model": "..." }
      else if (message.type === 'setModel') {
        console.log(`[setModel] Le modèle a été défini sur : ${message.model}`);
      }
      // 5. Quand il reçoit { "type": "permissionResponse", "allowed": true }
      else if (message.type === 'permissionResponse') {
        console.log(`[permissionResponse] Permission accordée : ${message.allowed}`);
      }
      else {
        console.log(`Message type inconnu: ${message.type}`);
      }

    } catch (err) {
      console.error('Erreur lors du parsing du message JSON:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('Client déconnecté');
  });
});
