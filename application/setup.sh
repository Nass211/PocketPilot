#!/bin/bash

# Activer l'arrêt en cas d'erreur
set -e

echo "🚀 Démarrage de l'installation de PocketPilot (Expo SDK 51)..."

echo "📦 Installation des dépendances via npm..."
npm install

echo "🔄 Alignement des dépendances natives avec npx expo install..."
npx expo install

echo "✅ Vérification des types TypeScript..."
npx tsc --noEmit

echo "🎉 Installation et vérification terminées avec succès !"
echo "👉 Vous pouvez maintenant lancer l'application avec : npx expo start"
