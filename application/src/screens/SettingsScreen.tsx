import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Alert, ScrollView, Platform } from 'react-native';
import { useAppContext } from '../context/AppContext';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SettingsScreen({ navigation, route }: any) {
  const ws = useAppContext();
  const { colors, theme, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);

  useEffect(() => {
     // Optional: If you had a listener in ws for 'workspace_info' you could set it
     if (ws?.send) {
       ws.send({ type: 'get_workspace_info' });
     }
  }, []);

  const handleDisconnect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      "Déconnexion",
      "Êtes-vous sûr de vouloir vous déconnecter de Copilot ?",
      [
        { text: "Annuler", style: "cancel" },
        { 
          text: "Déconnecter", 
          style: "destructive",
          onPress: () => {
            ws.disconnect();
            navigation.replace('Connect');
          }
        }
      ]
    );
  };

  const handleClearHistory = () => {
     Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
     Alert.alert(
       "Effacer l'historique",
       "Cette action supprimera tous les messages actuels. Continuer ?",
       [
         { text: "Annuler", style: "cancel" },
         {
           text: "Effacer",
           style: "destructive",
           onPress: () => {
              ws.send({ type: 'clear_history' });
              // Needs to clear local messages array in ChatScreen.
              if (route.params?.onClear) {
                route.params.onClear();
              }
              navigation.goBack();
           }
         }
       ]
     );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>
      <ScrollView>
        <Text style={styles.sectionTitle}>Connexion Active</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Statut</Text>
            <Text style={styles.value}>{ws.status}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Projet</Text>
            <Text style={styles.value}>{ws.project || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Branche</Text>
            <Text style={styles.value}>{ws.branch || 'main'}</Text>
          </View>
          
          <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
            <Text style={styles.disconnectText}>Déconnecter</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Espace de Travail</Text>
        <View style={styles.card}>
          <TouchableOpacity 
             style={styles.actionRow} 
             onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                ws.send({ type: 'get_workspace_info' });
             }}
          >
            <Text style={styles.actionText}>Rafraîchir workspace</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Historique & Données</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={handleClearHistory}>
            <Text style={[styles.actionText, { color: '#FF3B30' }]}>Effacer l'historique global</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Apparence</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Mode Sombre</Text>
            <Switch
               value={theme === 'dark'}
               onValueChange={toggleTheme}
               trackColor={{ false: '#767577', true: colors.accent }}
            />
          </View>
        </View>

        <Text style={styles.versionText}>PocketPilot v1.0.0{'\n'}Code with AI ⚡</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginLeft: 16,
    marginTop: 24,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: {
    color: colors.text,
    fontSize: 16,
  },
  value: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  disconnectButton: {
    padding: 16,
    alignItems: 'center',
  },
  disconnectText: {
    color: '#FF3B30', // standard danger color
    fontSize: 16,
    fontWeight: '600',
  },
  actionRow: {
    padding: 16,
  },
  actionText: {
    color: colors.accent,
    fontSize: 16,
  },
  versionText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 40,
    marginBottom: 20,
    lineHeight: 18,
  }
});