# PocketPilot 📱
> Contrôlez GitHub Copilot depuis votre téléphone 🚀

L'application **PocketPilot** transforme votre smartphone en un client natif interactif pour piloter *GitHub Copilot* tournant sur votre instance VS Code d'ordinateur. Conversez, validez des permissions et déclenchez des actions complexes sans même toucher à votre clavier d'ordinateur.

---

## ✨ Fonctionnalités
- **🚀 Copilot Complet** : Interagissez avec votre IDE à distance.
- **⚡ Streaming Temps-Réel**: Génération Markdown ultra-fluide avec clignotement.
- **📷 Authentification magique** : Oubliez les mots de passe, scannez le QR Code Expo !
- **🧠 3 Modes natifs** : Ask, Agent et Plan avec interface dynamique.
- **🛠️ Modales intelligentes** : Validez au clic des accès fichiers en écriture, ou remplissez les formulaires de l'Agent.
- **🗂️ Reconnexion silencieuse** : Reprenez un travail là où vous l'avez laissé.
- **🌑 Dark Mode Only** : L'esthétisme VS Code Dracula.

---

## 📋 Prérequis
- Node.js 18+
- [Expo CLI](https://expo.dev/) installé globalement.
- Extension VS Code **PocketPilot** installée sur l'ordinateur cible.
- Un abonnement GitHub Copilot actif sur le VS Code hôte.
- Le téléphone et l'ordinateur branchés sur le même réseau local (ou via l'URL ngrok/localtonet).

---

## 🚀 Installation & Lancement

```bash
git clone https://github.com/Nass211/PocketPilot.git
cd application
./setup.sh
npx expo start
```

*Note : Pour une experience optimale sans fil sur un iPhone privé, téléchargez l'application "Expo Go" depuis l'App Store / Play Store au préalable.*

---

## ⚙️ Configuration VS Code
1. Ouvrez l'extension PocketPilot dans VS Code.
2. Cliquez sur l'icône de l'appareil "Link Mobile".
3. Un QR Code s'affiche dans votre IDE. Il contient automatiquement votre URL locale temporaire et un token UUID unique.
4. Laissez l'extension tourner !

---

## 📱 Utilisation
1. Ouvrez **PocketPilot** sur votre mobile.
2. Cliquez sur **Scanner QR Code** (Acceptez la permission caméra).
3. Scanner l'écran de votre ordinateur.
4. **C'est fini !** Choisissez le mode (Ask / Agent / Plan) et demandez à Copilot de coder à votre place !

---

## 🏗️ Architecture

```
application/src/
├── App.tsx                    # Point d'entrée, Navigateur Stack Expo
├── constants.ts               # Palette de couleurs et temps de timeout
├── context/
│   └── AppContext.tsx         # Contexte React de l'état WebSocket global
├── hooks/
│   ├── useChat.ts             # Logique d'empilement du stream Assistant vs User
│   └── useWebSocket.ts        # État et callback de la websocket
├── services/
│   ├── storage.ts             # Persistence Async et récupération des sessions
│   └── websocket.ts           # Classe native générant la reconnexion expo backoff
├── types/
│   └── messages.ts            # Interfaces TypeScript strictes (Payloads JSON)
├── components/                # Tous les élements visuels (0% de logique WS)
│   ├── ActionButtons.tsx      # Bandeau du constructeur Mode Plan
│   ├── ConnectionStatus.tsx   # Badge cliquable statut serveur/CLI
│   ├── MarkdownRenderer.tsx   # Formatteur Markdown + Hightlighter Code
│   ├── MessageBubble.tsx      # Une bulle de composant finale
│   ├── ModeSelector.tsx       # Boutons Ask/Agent/Plan
│   ├── ModelSelector.tsx      # Bottom sheet choix d'une IA (ex: Claude 3.5)
│   ├── PermissionModal.tsx    # Modale 100% bloquante d'autorisation fichier
│   ├── StreamingIndicator.tsx # 3 points de sauts animés SVG
│   └── UserInputModal.tsx     # Modale bloquante de formulaire Ask
└── screens/
    ├── ChatScreen.tsx         # Layout clavier, affichage du tchat et Hook de socket
    ├── ConnectScreen.tsx      # Page principale QR Code et listing sessions précédentes
    └── SettingsScreen.tsx     # Outil de debug optionnel
```

---

## 🔌 Protocole WebSocket

| Direction | Type JSON | Description |
| :--- | :--- | :--- |
| **Phone ➡️ Ext** | `auth` | Envoi du Bearer Token / UUID |
| **Phone ➡️ Ext** | `prompt` | Envoi du message clavier {content, mode} |
| **Phone ➡️ Ext** | `permission` | Envoi de l'approbation {id, decision: "allow"} |
| **Phone ➡️ Ext** | `user_input` | Envoi du formulaire de l'agent |
| **Phone ➡️ Ext** | `cancel_task` | Ordre d'arrêt immédiat du stream en cours |
| **Ext ➡️ Phone** | `connected` | Confirmation WS et envoi {branch, project} |
| **Ext ➡️ Phone** | `chunk` | Paragraphe brut Markdown (partiel en stream) |
| **Ext ➡️ Phone** | `done` | Signal de fin d'écriture de Copilot |
| **Ext ➡️ Phone** | `permission_req`| Lock l'UI pour une lecture/écriture de VS Code |

---

## 🛠️ Stack Technique

| Besoin | Librairie | Version |
| :--- | :--- | :--- |
| **Framework** | `react-native` / `expo` | ~0.74 / ~51.0.0 |
| **Caméra QR** | `expo-camera` | ~15.0.12 |
| **Stockage** | `@react-.../async-storage` | 1.23.1 |
| **Format Markdown** | `react-native-markdown-display` | 7.0.0-alpha.2 |
| **Code Highlighting**| `react-native-syntax-highlighter` | 2.1.0 |
| **Navigation** | `@react-navigation/native` | ^6.1.17 |
| **Retours tactiles** | `expo-haptics` | ~13.0.1 |

---

## 🐛 Dépannage (Erreurs)

| Code Erreur | Signification | Solution |
| :--- | :--- | :--- |
| `SESSION_OCCUPIED` | Un autre portable contrôle Copilot | Déconnectez l'ancien ou appuyez sur *Forcer la Session*. |
| `UNAUTHORIZED` | Token invalide ou QR expiré | Scannez de nouveau le QR code frais. |
| `AUTH_TIMEOUT` | VS Code n'a pas répondu assez vite | Relancez via *Connexions Récentes*. |
| `MODEL_NOT_AVAILABLE`| Le modèle IA n'est pas autorisé | Rétablissez le Dropdown sur **"auto"**. |
| `REQUEST_FAILED` | Timeout VS Code interne | L'agent a craché ou la wifi est trop faible. |

---

## 📄 Licence
Ce projet est développé sous licence **MIT**.
