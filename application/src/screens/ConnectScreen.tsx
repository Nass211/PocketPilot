import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import { StorageService, SavedConnection } from '../services/storage';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '../context/AppContext';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import Logo from '../components/Logo';

/**
 * Normalize a user-typed URL into a valid WebSocket URL.
 * - Bare IP:port (e.g. "192.168.1.5:3000") → ws://192.168.1.5:3000
 * - https://... → wss://...
 * - http://...  → ws://...
 * - ws:// / wss:// → kept as-is
 */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('https://')) {
    return trimmed.replace('https://', 'wss://');
  }
  if (trimmed.startsWith('http://')) {
    return trimmed.replace('http://', 'ws://');
  }
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
    return trimmed;
  }
  // Bare IP:port — prefix ws://
  return `ws://${trimmed}`;
}

export default function ConnectScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const ws = useAppContext();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState<string>('');

  // Timer refs for local→tunnel fallback and total connection timeout
  const connectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track connected state (avoids stale closure in setTimeout callbacks)
  const isConnectedRef = useRef(false);

  useEffect(() => {
    loadConnections();
    checkLastConnection();
  }, []);

  const loadConnections = async () => {
    const conns = await StorageService.getAllConnections();
    setConnections(conns);
  };

  // Clean up all connection timers
  const clearAllTimers = () => {
    if (connectionTimerRef.current) {
      clearTimeout(connectionTimerRef.current);
      connectionTimerRef.current = null;
    }
    if (totalTimeoutRef.current) {
      clearTimeout(totalTimeoutRef.current);
      totalTimeoutRef.current = null;
    }
  };

  const abortConnection = (message: string) => {
    clearAllTimers();
    ws.disconnect();
    setIsConnecting(false);
    setConnectionAttempt('');
    isConnectedRef.current = false;
    Alert.alert('Connection Failed', message, [
      { text: 'Scan QR Code', onPress: () => startScan() },
      { text: 'OK', style: 'cancel' },
    ]);
  };

  const checkLastConnection = async () => {
    // Only auto-connect on first load if we are disconnected
    if (ws.status === 'disconnected') {
      const last = await StorageService.getLastConnection();
      if (last) {
        // Skip auto-reconnect for stale tunnel URLs — cloudflare quick tunnels
        // generate a new random URL each time, so saved wss:// URLs are almost
        // certainly dead. Force user to scan a fresh QR code instead.
        const isStaleTunnel = last.url.startsWith('wss://') && last.url.includes('trycloudflare.com');
        if (isStaleTunnel) {
          console.log('Skipping auto-reconnect: saved tunnel URL is likely stale');
          return;
        }
        handleConnect(last.url, last.token, last.localUrl);
      }
    } else if (ws.status === 'connected') {
      navigation.replace('Chat');
    }
  };

  useEffect(() => {
    if (ws.status === 'connected') {
       // Connection successful — clean up all timers and navigate
       isConnectedRef.current = true;
       clearAllTimers();
       setConnectionAttempt('');
       navigation.replace('Chat');
       setIsConnecting(false);
    } else if (ws.status === 'reconnecting' && isConnecting) {
       // Update the status text so user knows what's happening
       setConnectionAttempt((prev) =>
         prev.includes('tunnel') ? 'Tunnel connection lost, retrying…' : 'Connection failed, retrying…'
       );
    }
  }, [ws.status]);


  const startScan = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) return Alert.alert('Permission required', 'Camera access is required.');
    }
    setScanning(true);
  };

  const handleBarcodeScanned = ({ data }: any) => {
    setScanning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    try {
      const parsed = JSON.parse(data);
      if (parsed.url && parsed.token) {
        setUrl(parsed.url);
        setToken(parsed.token);
        
        // Auto connect after scan
        handleConnect(parsed.url, parsed.token, parsed.localUrl);
      } else {
        throw new Error("Invalid JSON format");
      }
    } catch (e) {
      Alert.alert('Error', "This QR Code is not a valid PocketPilot access.");
    }
  };

  const handleConnect = async (primaryUrl: string, authToken: string, fallbackLocalUrl?: string) => {
    if (!primaryUrl || !authToken) return;
    
    // Reset state
    isConnectedRef.current = false;
    clearAllTimers();
    setIsConnecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Save for later
    await StorageService.saveConnection({
      url: primaryUrl,
      localUrl: fallbackLocalUrl || '',
      token: authToken,
      label: `Connection ${new Date().toLocaleDateString()}`,
      lastUsed: Date.now()
    });

    loadConnections();
    
    // Determine if we have both local and tunnel URLs from QR payload.
    // QR format: { url: tunnel_or_local, localUrl: always_LAN, token }
    // When tunnel active: url = "wss://..." (tunnel), localUrl = "ws://IP:3000" (LAN)
    // When no tunnel:     url = "ws://IP:3000" (LAN),  localUrl = "ws://IP:3000" (same)
    const hasBothUrls = fallbackLocalUrl && fallbackLocalUrl !== primaryUrl;

    if (hasBothUrls) {
      // Local-first strategy: try the LAN address first (faster, lower latency)
      setConnectionAttempt(`Trying local network (${fallbackLocalUrl})…`);
      ws.connect(fallbackLocalUrl, authToken, fallbackLocalUrl, primaryUrl);

      // If local doesn't connect within 3 seconds, fall back to tunnel
      connectionTimerRef.current = setTimeout(() => {
        if (!isConnectedRef.current) {
          console.log('Local connection timed out after 3s, falling back to tunnel');
          ws.disconnect();
          setConnectionAttempt(`Local failed — trying tunnel…`);
          ws.connect(primaryUrl, authToken, fallbackLocalUrl, primaryUrl);
        }
      }, 3000);

      // Total timeout: give up after 15s (3s local + 12s tunnel)
      totalTimeoutRef.current = setTimeout(() => {
        if (!isConnectedRef.current) {
          abortConnection(
            `Could not reach the VS Code extension.\n\n` +
            `Tried: ${fallbackLocalUrl} → ${primaryUrl}\n\n` +
            `• Scan a fresh QR code from VS Code\n` +
            `• Make sure the extension is running\n` +
            `• Enable tunnel if not on the same Wi-Fi`
          );
        }
      }, 15000);
    } else {
      // Single URL — connect directly
      const isTunnel = primaryUrl.startsWith('wss://');
      setConnectionAttempt(isTunnel ? `Connecting via tunnel…` : `Connecting to ${primaryUrl}…`);
      ws.connect(primaryUrl, authToken);

      // Total timeout: give up after 10s
      totalTimeoutRef.current = setTimeout(() => {
        if (!isConnectedRef.current) {
          abortConnection(
            isTunnel
              ? `Tunnel connection failed.\n\nTried: ${primaryUrl}\n\n• Tunnel URLs expire on restart — scan a fresh QR code`
              : `Could not reach the VS Code extension.\n\n` +
                `Tried: ${primaryUrl}\n\n` +
                `• Your phone must be on the same Wi-Fi as your computer\n` +
                `• Or enable tunnel in VS Code and scan a new QR code`
          );
        }
      }, 10000);
    }
  };

  // --- UI Renders ---

  if (scanning) {
    return (
      <View style={styles.container}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
             barcodeTypes: ["qr"],
          }}
        />
        <TouchableOpacity style={styles.cancelScanButton} onPress={() => setScanning(false)}>
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <Logo width={100} height={100} />
      </View>
      <Text style={styles.title}>PocketPilot</Text>
      
      <View style={styles.card}>
         <TouchableOpacity style={styles.scanButton} onPress={startScan}>
           <Text style={styles.buttonText}>📷 Scan QR Code</Text>
         </TouchableOpacity>
         
         <View style={styles.divider}>
           <View style={styles.line}/>
           <Text style={styles.dividerText}>OR MANUALLY</Text>
           <View style={styles.line}/>
         </View>

         <TextInput
            style={styles.input}
            placeholder="IP / URL (e.g. 192.168.1.10:3000)"
            placeholderTextColor={colors.textSecondary}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
         />
         <TextInput
            style={styles.input}
            placeholder="Access Token (UUID)"
            placeholderTextColor={colors.textSecondary}
            value={token}
            onChangeText={setToken}
            secureTextEntry
         />

         <TouchableOpacity 
            style={[styles.primaryButton, (!url || !token || isConnecting) && styles.disabledButton]} 
            disabled={!url || !token || isConnecting}
            onPress={() => handleConnect(normalizeUrl(url), token)}
         >
           {isConnecting || ws.status === 'connecting' || ws.status === 'authenticating' ? (
              <ActivityIndicator color={colors.background} />
           ) : (
              <Text style={styles.buttonText}>Connect</Text>
           )}
         </TouchableOpacity>

         {isConnecting && connectionAttempt ? (
           <Text style={styles.connectionAttemptText}>{connectionAttempt}</Text>
         ) : null}
      </View>

      {connections.length > 0 && (
         <View style={styles.historyContainer}>
            <Text style={styles.historyTitle}>Recent connections</Text>
            <FlatList
               data={connections}
               keyExtractor={(item) => item.url + item.lastUsed}
               renderItem={({ item, index }) => (
                  <TouchableOpacity 
                    style={styles.historyItem} 
                    onPress={() => handleConnect(item.url, item.token, item.localUrl)}
                  >
                     <View style={styles.historyDetails}>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                           {index === 0 && <View style={styles.activeDot} />}
                           <Text style={styles.historyLabel} numberOfLines={1}>{item.label || item.url}</Text>
                        </View>
                        <Text style={styles.historyUrl} numberOfLines={1}>{item.url}</Text>
                     </View>
                     <Text style={styles.historyDate}>
                       {new Date(item.lastUsed).toLocaleDateString()}
                     </Text>
                  </TouchableOpacity>
               )}
            />
         </View>
      )}
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    color: colors.accent,
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
    letterSpacing: 1,
  },
  card: {
    backgroundColor: colors.surface,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scanButton: {
    backgroundColor: colors.border,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.textSecondary,
    marginHorizontal: 12,
    fontSize: 12,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: colors.inputBackground,
    color: colors.text,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    fontSize: 16,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  disabledButton: {
    opacity: 0.5,
  },
  buttonText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelScanButton: {
     position: 'absolute',
     bottom: 50,
     alignSelf: 'center',
     backgroundColor: 'rgba(0,0,0,0.7)',
     paddingVertical: 16,
     paddingHorizontal: 40,
     borderRadius: 30,
  },
  connectionAttemptText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
  historyContainer: {
    marginTop: 32,
    flex: 1,
  },
  historyTitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 16,
    textTransform: 'uppercase',
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759', // Success colors usually hardcoded or passed via theme, we use standard green
    marginRight: 8,
  },
  historyDetails: {
    flex: 1,
    marginRight: 16,
  },
  historyLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  historyUrl: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  historyDate: {
    color: colors.textSecondary,
    fontSize: 12,
  },
});