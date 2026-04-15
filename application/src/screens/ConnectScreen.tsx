import React from 'react';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Camera, CameraView, useCameraPermissions } from 'expo-camera';
import { StorageService, SavedConnection } from '../services/storage';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '../context/AppContext';
import { useTheme, ThemeColors } from '../context/ThemeContext';
import Logo from '../components/Logo';

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

  useEffect(() => {
    loadConnections();
    checkLastConnection();
  }, []);

  const loadConnections = async () => {
    const conns = await StorageService.getAllConnections();
    setConnections(conns);
  };

  const checkLastConnection = async () => {
    // Only auto-connect on first load if we are disconnected
    if (ws.status === 'disconnected') {
      const last = await StorageService.getLastConnection();
      if (last) {
        handleConnect(last.url, last.token, last.localUrl);
      }
    } else if (ws.status === 'connected') {
      navigation.replace('Chat');
    }
  };

  useEffect(() => {
    if (ws.status === 'connected') {
       navigation.replace('Chat');
       setIsConnecting(false);
    } else if ((ws.status as any) === 'error') {
       setIsConnecting(false);
       Alert.alert('Error', 'Unable to connect');
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

  const handleConnect = async (primaryUrl: string, authToken: string, fallbackUrl?: string) => {
    if (!primaryUrl || !authToken) return;
    
    setIsConnecting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Save for later
    await StorageService.saveConnection({
      url: primaryUrl,
      localUrl: fallbackUrl || '',
      token: authToken,
      label: `Connection ${new Date().toLocaleDateString()}`,
      lastUsed: Date.now()
    });

    loadConnections();
    
    // Connect WS
    ws.connect(primaryUrl, authToken);
    // Timeout fallback (simplified) could be added here
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
            onPress={() => handleConnect(url, token)}
         >
           {isConnecting || ws.status === 'connecting' || ws.status === 'authenticating' ? (
              <ActivityIndicator color={colors.background} />
           ) : (
              <Text style={styles.buttonText}>Connect</Text>
           )}
         </TouchableOpacity>
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