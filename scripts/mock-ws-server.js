const { WebSocketServer } = require('ws');

const PORT = 8787;
const wss = new WebSocketServer({ port: PORT });

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function streamText(ws, text, chunkSize = 14, delayMs = 90) {
  let index = 0;

  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN) {
      clearInterval(timer);
      return;
    }

    if (index >= text.length) {
      clearInterval(timer);
      safeSend(ws, { type: 'done' });
      return;
    }

    const chunk = text.slice(index, index + chunkSize);
    index += chunkSize;
    safeSend(ws, { type: 'chunk', text: chunk });
  }, delayMs);
}

wss.on('connection', (ws) => {
  const state = {
    mode: 'agent',
    model: 'gpt-5.4',
  };

  safeSend(ws, {
    type: 'info',
    text: 'Mock WebSocket connected. Envoyez un prompt pour voir le streaming.',
  });

  ws.on('message', (raw) => {
    let message;

    try {
      message = JSON.parse(String(raw));
    } catch {
      safeSend(ws, { type: 'info', text: 'Message JSON invalide ignore.' });
      return;
    }

    if (message.type === 'setMode') {
      state.mode = String(message.mode || 'ask');
      safeSend(ws, { type: 'info', text: `Mode actif: ${state.mode}` });
      return;
    }

    if (message.type === 'setModel') {
      state.model = String(message.model || 'gpt-5.4');
      safeSend(ws, { type: 'info', text: `Modele actif: ${state.model}` });
      return;
    }

    if (message.type === 'permissionResponse') {
      safeSend(ws, {
        type: 'info',
        text: message.allowed ? 'Permission accordee.' : 'Permission refusee.',
      });
      return;
    }

    if (message.type === 'prompt') {
      const prompt = String(message.text || '').trim();

      if (!prompt) {
        safeSend(ws, { type: 'info', text: 'Prompt vide.' });
        return;
      }

      const response = [
        `Mode: ${state.mode}.`,
        `Modele: ${state.model}.`,
        `Prompt recu: ${prompt}`,
        'Streaming mock en cours...',
      ].join(' ');

      streamText(ws, response);

      setTimeout(() => {
        safeSend(ws, {
          type: 'fileEdited',
          filename: 'src/auth.ts',
          diff: [
            '-const token = null;',
            '+const token = signJwt(userId, secret);',
            ' const expiresIn = 3600;',
          ],
        });
      }, 500);

      setTimeout(() => {
        safeSend(ws, {
          type: 'permissionRequest',
          command: 'npm install jsonwebtoken',
        });
      }, 900);
    }
  });
});

console.log(`Mock WebSocket server running on ws://localhost:${PORT}`);
