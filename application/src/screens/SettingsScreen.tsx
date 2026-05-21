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
     if (ws?.send) {
       ws.send({ type: 'get_workspace_info' });
     }
  }, []);

  // Derive connection status text from ws.status
  const statusLabel = useMemo(() => {
    switch (ws.status) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting…';
      case 'authenticating': return 'Authenticating…';
      case 'reconnecting': return 'Reconnecting…';
      default: return 'Disconnected';
    }
  }, [ws.status]);

  const statusColor = ws.status === 'connected' ? '#4caf50' : '#ff9800';

  const handleDisconnect = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      "Disconnect",
      "Are you sure you want to disconnect from Copilot?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Disconnect", 
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
       "Clear History",
       "This will delete all current messages. Continue?",
       [
         { text: "Cancel", style: "cancel" },
         {
           text: "Clear",
           style: "destructive",
           onPress: () => {
              ws.send({ type: 'clear_history' });
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
        <Text style={styles.sectionTitle}>Active Connection</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Project</Text>
            <Text style={styles.value}>{ws.project || 'N/A'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Branch</Text>
            <Text style={styles.value}>{ws.branch || 'main'}</Text>
          </View>
          
          <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Workspace</Text>
        <View style={styles.card}>
          <TouchableOpacity 
             style={styles.actionRow} 
             onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                ws.send({ type: 'get_workspace_info' });
             }}
          >
            <Text style={styles.actionText}>Refresh workspace</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>History & Data</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.actionRow} onPress={handleClearHistory}>
            <Text style={[styles.actionText, { color: '#FF3B30' }]}>Clear all history</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Dark Mode</Text>
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
    color: '#FF3B30',
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