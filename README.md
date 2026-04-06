# PocketPilot

React + Vite + Tailwind PWA pour piloter un agent via WebSocket natif.

## Démarrage

```bash
npm install
npm start
```

Ouvrez ensuite l’application avec un paramètre `ws`:

```text
http://localhost:5173/?ws=wss://mon-tunnel.trycloudflare.com
```

## Scripts

- `npm start` lance Vite en développement.
- `npm run build` produit le build de production dans `dist/`.
- `npm run preview` sert le build localement.

## Protocole WebSocket

- `{"type":"setMode","mode":"agent"}`
- `{"type":"setModel","model":"claude-sonnet-4.6"}`
- `{"type":"prompt","text":"..."}`
- `{"type":"chunk","text":"..."}`
- `{"type":"fileEdited","filename":"auth.ts","diff":[...]}`
- `{"type":"permissionRequest","command":"npm install jsonwebtoken"}`
- `{"type":"permissionResponse","allowed":true}`